/**
 * Backend factory for the coordination judge.
 *
 * Coxswain's judge (lib/coordination-judge.ts) is a backend-agnostic
 * `transport` interface. This file resolves the active backend the same
 * way the rest of the fleet does — `PD_JUDGE_BACKEND` (override) →
 * `PD_FLEET_DEFAULT_BACKEND` → repo defaults — and returns the matching
 * `JudgeTransport`. If nothing is configured, it returns `null` and the
 * judge runs in disabled mode (no DMs).
 *
 * The point: the operator picks claude / codex / cloudflare / ollama at
 * the fleet level, the judge inherits it, no second config surface to
 * forget about.
 *
 * Models default to whatever `lib/backend-telemetry-policy.ts` already
 * declares as the "operator" tier for each backend — those are picked to
 * be cheap-and-fast, which matches the judge's needs (single yes/no
 * verdict, ~200 tokens out).
 */

import type { JudgeTransport } from './coordination-judge.js';
import {
  DEFAULT_OPERATOR_CLAUDE_MODEL,
  DEFAULT_OPERATOR_CODEX_MODEL,
  DEFAULT_OPERATOR_CLOUDFLARE_MODEL,
} from './backend-telemetry-policy.js';

export type JudgeBackend = 'claude' | 'codex' | 'cloudflare' | 'ollama' | 'custom';

export interface ResolvedJudgeBackend {
  backend: JudgeBackend;
  model: string;
  transport: JudgeTransport;
}

export interface ResolveJudgeBackendOptions {
  /** Override the env-based backend pick. */
  backend?: JudgeBackend;
  /** Override the per-backend default model. */
  model?: string;
  /** Inject a transport directly (skip the backend → transport mapping). */
  transport?: JudgeTransport;
  /** For tests: substitute env reads. */
  env?: NodeJS.ProcessEnv;
}

function readEnv(env: NodeJS.ProcessEnv | undefined, key: string): string | undefined {
  const val = (env ?? process.env)[key];
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined;
}

/**
 * Pick the backend identifier for the judge. Resolution order:
 *
 *   1. Explicit `options.backend`.
 *   2. PD_JUDGE_BACKEND env var (operator override just for the judge,
 *      e.g. "I'm running claude for the fleet but I want the judge on
 *      cloudflare so it's free").
 *   3. PD_FLEET_DEFAULT_BACKEND / PORT_DADDY_FLEET_DEFAULT_BACKEND env
 *      vars — the same knob the fleet engine reads.
 *   4. null → no backend, judge stays disabled.
 */
export function resolveJudgeBackendName(options: ResolveJudgeBackendOptions = {}): JudgeBackend | null {
  if (options.backend) return options.backend;
  const env = options.env;
  const candidate = readEnv(env, 'PD_JUDGE_BACKEND')
    || readEnv(env, 'PD_FLEET_DEFAULT_BACKEND')
    || readEnv(env, 'PORT_DADDY_FLEET_DEFAULT_BACKEND');
  if (!candidate) return null;
  switch (candidate.toLowerCase()) {
    case 'claude':
    case 'claude-cli':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'cloudflare':
    case 'cf':
      return 'cloudflare';
    case 'ollama':
    case 'local':
      return 'ollama';
    default:
      return null;
  }
}

/**
 * Default cheap model for each backend. Read directly from the existing
 * backend-telemetry-policy so the judge tracks whatever the rest of the
 * fleet calls "operator-tier."
 */
export function defaultJudgeModelFor(backend: JudgeBackend): string {
  switch (backend) {
    case 'claude': return DEFAULT_OPERATOR_CLAUDE_MODEL;
    case 'codex': return DEFAULT_OPERATOR_CODEX_MODEL;
    case 'cloudflare': return DEFAULT_OPERATOR_CLOUDFLARE_MODEL;
    case 'ollama': return readEnv(undefined, 'PD_OLLAMA_JUDGE_MODEL') || 'qwen2.5-coder:1.5b';
    default: return '';
  }
}

/**
 * Cloudflare Workers AI transport. Direct fetch, no spawner overhead. The
 * judge is the only caller, so we don't need spawner's registration /
 * cost tracking / telemetry layers.
 */
function buildCloudflareTransport(model: string, env?: NodeJS.ProcessEnv): JudgeTransport | null {
  const accountId = readEnv(env, 'CLOUDFLARE_ACCOUNT_ID')
    || readEnv(env, 'CF_ACCOUNT_ID');
  const token = readEnv(env, 'CLOUDFLARE_API_TOKEN')
    || readEnv(env, 'CLOUDFLARE_API_KEY')
    || readEnv(env, 'CF_API_TOKEN');
  if (!accountId || !token) return null;
  return {
    label: `cloudflare:${model}`,
    async complete({ prompt, model: callModel, signal }) {
      const useModel = callModel || model;
      try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(useModel)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            stream: false,
          }),
          signal,
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => 'unknown');
          return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
        }
        const data = await res.json() as Record<string, any>;
        const result = data.result ?? data;
        const text = typeof result === 'string'
          ? result
          : result?.response
            || result?.text
            || result?.output_text
            || result?.choices?.[0]?.message?.content
            || '';
        if (!text) return { ok: false, error: 'empty response' };
        return { ok: true, text };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}

/**
 * Ollama transport. Targets the local server at OLLAMA_HOST (default
 * http://localhost:11434), which matches the spawner's existing Ollama
 * conventions. Free for the operator since it's local — preferred when
 * the fleet runs entirely on-box.
 */
function buildOllamaTransport(model: string, env?: NodeJS.ProcessEnv): JudgeTransport | null {
  const host = readEnv(env, 'OLLAMA_HOST') || 'http://localhost:11434';
  return {
    label: `ollama:${model}`,
    async complete({ prompt, model: callModel, signal }) {
      const useModel = callModel || model;
      try {
        const res = await fetch(`${host.replace(/\/$/, '')}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: useModel,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            options: { num_predict: 200 },
          }),
          signal,
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => 'unknown');
          return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
        }
        const data = await res.json() as Record<string, any>;
        const text = data?.message?.content ?? data?.response ?? '';
        if (!text) return { ok: false, error: 'empty response' };
        return { ok: true, text };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}

/**
 * Claude / codex transports are deliberately not built here. The Anthropic
 * SDK and codex CLI are heavy enough that wiring them just for the judge
 * is overkill — and unlike cloudflare/ollama, both have their own
 * full-fledged spawner paths that already do registration, cost tracking,
 * and telemetry. If you want the judge on claude or codex, the right move
 * is either to (a) inject a custom transport that delegates to the
 * spawner's already-imported SDK call, or (b) leave the judge disabled
 * and rely on the deterministic-only audit. For the common case — fleet
 * configured to claude/codex but judge prefers free — set PD_JUDGE_BACKEND
 * to cloudflare or ollama.
 */
function notSupported(backend: JudgeBackend, model: string): JudgeTransport {
  return {
    label: `${backend}:unsupported`,
    async complete() {
      return {
        ok: false,
        error: `judge transport for backend '${backend}' (model '${model}') is not built into this binary; set PD_JUDGE_BACKEND to cloudflare or ollama, or inject a custom transport`,
      };
    },
  };
}

/**
 * Resolve the active judge backend + transport. Returns `null` when no
 * backend is configured — caller passes `transport: undefined` to
 * `createCoordinationJudge` and the judge silently disables itself.
 */
export function resolveJudgeBackend(options: ResolveJudgeBackendOptions = {}): ResolvedJudgeBackend | null {
  const backend = resolveJudgeBackendName(options);
  if (!backend) return null;
  const model = options.model || defaultJudgeModelFor(backend);

  if (options.transport) {
    return { backend, model, transport: options.transport };
  }

  let transport: JudgeTransport | null = null;
  switch (backend) {
    case 'cloudflare':
      transport = buildCloudflareTransport(model, options.env);
      break;
    case 'ollama':
      transport = buildOllamaTransport(model, options.env);
      break;
    case 'claude':
    case 'codex':
    case 'custom':
      transport = notSupported(backend, model);
      break;
  }

  if (!transport) return null;
  return { backend, model, transport };
}
