/**
 * Single resolver for LLM backend selection across every Port Daddy actor.
 *
 * Why this exists: spawn-shape (long-running fleet agents via the spawner)
 * and request-shape (one-shot completions like the coordination judge) used
 * to read env vars in two different places. Operators flipping between
 * claude / codex / cloudflare / ollama on the fleet would get drift — one
 * subsystem would still be on yesterday's backend.
 *
 * Now: one resolver. Env cascade in one file. The fleet engine's
 * `getFleetRuntimeDefaults()` delegates here for backend-name resolution
 * (it still owns model-tier and FleetAgent metadata, since that's
 * spawn-shape only). The judge calls `resolveLLMBackend({actor: 'judge'})`
 * to get a ready-to-use transport.
 *
 * Cascade for any actor `A`:
 *
 *   1. options.backend                       (programmatic override)
 *   2. PD_<A>_BACKEND env                    (per-actor pin — e.g.
 *                                             PD_JUDGE_BACKEND=cloudflare
 *                                             when the rest of the fleet
 *                                             is on claude)
 *   3. PD_FLEET_DEFAULT_BACKEND env          (the fleet's default — what
 *                                             every actor inherits)
 *   4. PORT_DADDY_FLEET_DEFAULT_BACKEND env  (legacy alias)
 *   5. null                                  (caller decides what null
 *                                             means — judge stays
 *                                             disabled, spawner errors)
 *
 * Per-backend default models come from `lib/backend-telemetry-policy`'s
 * operator tier — there is no second list of "what's a good cheap model
 * for X."
 *
 * Request-shape transports built here:
 *
 *   - cloudflare → direct fetch to /accounts/{id}/ai/run/{model}
 *   - ollama     → direct fetch to {OLLAMA_HOST}/api/chat
 *   - claude     → notSupported (use spawner, or inject a custom transport)
 *   - codex      → notSupported (same)
 *
 * Claude/codex are deliberately not built here. Both have full spawner
 * paths with cost tracking + telemetry + registration — wiring them just
 * for one-shot completions duplicates that. If you need it, set
 * `PD_<ACTOR>_BACKEND` to cloudflare/ollama, or inject a custom
 * `LLMTransport` via `options.transport`.
 */

import {
  DEFAULT_OPERATOR_CLAUDE_MODEL,
  DEFAULT_OPERATOR_CODEX_MODEL,
  DEFAULT_OPERATOR_CLOUDFLARE_MODEL,
} from './backend-telemetry-policy.js';
import { cloudflareAdapter, ollamaAdapter, type LLMAdapter } from './llm-call.js';
import { resolveModel } from './model-registry.js';

export type LLMBackend = 'claude' | 'codex' | 'cloudflare' | 'ollama' | 'custom';

export interface LLMCompletionRequest {
  prompt: string;
  /** Model identifier — informational for transports that target a fixed
   *  model. Pass empty string if the transport ignores it. */
  model: string;
  signal: AbortSignal;
}

export interface LLMCompletionResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface LLMTransport {
  /** Human-readable identifier surfaced in logs / stats. */
  label?: string;
  complete(input: LLMCompletionRequest): Promise<LLMCompletionResult>;
}

export type BackendSource = 'options' | 'actor-env' | 'fleet-default' | 'unset';

export interface ResolveBackendNameOptions {
  /** Actor name. Drives the `PD_<ACTOR>_BACKEND` env override key. Pass
   *  `undefined` for fleet-default-only resolution (fleet engine uses
   *  this — there's no per-actor override at fleet startup). */
  actor?: string;
  /** Programmatic override. Skips env reads. For raw resolution this can
   *  be any string the spawner accepts (e.g. "claude-cli"); for the
   *  request-shape resolver below it must normalize to LLMBackend. */
  backend?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ResolveLLMBackendOptions extends ResolveBackendNameOptions {
  model?: string;
  /** Inject a transport directly. Bypasses backend → transport mapping. */
  transport?: LLMTransport;
}

export interface ResolvedRawBackend {
  /** Raw env string (trimmed). Distinguishes "claude-cli" from "claude"
   *  because the spawner uses both for different runtimes. */
  raw: string | null;
  source: BackendSource;
}

export interface ResolvedBackendName {
  backend: LLMBackend | null;
  source: BackendSource;
}

export interface ResolvedLLMBackend {
  backend: LLMBackend;
  model: string;
  transport: LLMTransport;
  source: BackendSource;
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const val = env[key];
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined;
}

/** Build the per-actor env key. `judge` → `PD_JUDGE_BACKEND`. */
export function actorBackendEnvKey(actor: string): string {
  return `PD_${actor.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_BACKEND`;
}

/**
 * Normalize a raw backend string to the request-shape `LLMBackend` set.
 * Collapses spawn-only variants (`claude-cli`, `codex-cli`) into their
 * family — request-shape callers don't care about CLI vs SDK because they
 * inject a transport. Returns `null` for unknown values.
 */
export function normalizeBackend(raw: string): LLMBackend | null {
  switch (raw.toLowerCase()) {
    case 'claude':
    case 'claude-cli':
      return 'claude';
    case 'codex':
    case 'codex-cli':
      return 'codex';
    case 'cloudflare':
    case 'cf':
      return 'cloudflare';
    case 'ollama':
    case 'local':
      return 'ollama';
    case 'custom':
      return 'custom';
    default:
      return null;
  }
}

/**
 * Run the env cascade and return the raw backend string. This is what
 * spawn-shape callers (fleet-engine) want — the spawner cares whether
 * the operator said `claude` or `claude-cli`.
 *
 *   options.backend  →  PD_<ACTOR>_BACKEND  →  PD_FLEET_DEFAULT_BACKEND
 *                    →  PORT_DADDY_FLEET_DEFAULT_BACKEND  →  null
 */
export function resolveRawBackendName(options: ResolveBackendNameOptions = {}): ResolvedRawBackend {
  if (options.backend) return { raw: options.backend, source: 'options' };
  const env = options.env ?? process.env;

  if (options.actor) {
    const actorRaw = readEnv(env, actorBackendEnvKey(options.actor));
    if (actorRaw) return { raw: actorRaw, source: 'actor-env' };
  }

  const fleetDefault = readEnv(env, 'PD_FLEET_DEFAULT_BACKEND')
    || readEnv(env, 'PORT_DADDY_FLEET_DEFAULT_BACKEND');
  if (fleetDefault) return { raw: fleetDefault, source: 'fleet-default' };

  return { raw: null, source: 'unset' };
}

/**
 * Resolve to the normalized LLMBackend type. Used by the request-shape
 * resolver below. Returns null when the raw value can't be normalized
 * (unknown backend) or wasn't set at all.
 */
export function resolveBackendName(options: ResolveBackendNameOptions = {}): ResolvedBackendName {
  const { raw, source } = resolveRawBackendName(options);
  if (!raw) return { backend: null, source };
  const normalized = normalizeBackend(raw);
  if (!normalized) return { backend: null, source: 'unset' };
  return { backend: normalized, source };
}

/**
 * Per-backend operator-tier default model. Read from
 * `backend-telemetry-policy` — same source the rest of the fleet uses for
 * "cheap and fast." Ollama is configurable via `PD_OLLAMA_DEFAULT_MODEL`
 * because the ollama tag pinned on the operator's local box varies.
 */
export function defaultModelFor(backend: LLMBackend, env: NodeJS.ProcessEnv = process.env): string {
  switch (backend) {
    case 'claude': return DEFAULT_OPERATOR_CLAUDE_MODEL;
    case 'codex': return DEFAULT_OPERATOR_CODEX_MODEL;
    case 'cloudflare': return DEFAULT_OPERATOR_CLOUDFLARE_MODEL;
    // PD_OLLAMA_DEFAULT_MODEL is an explicit operator override (the tag
    // pinned on their local box varies); absent that, resolve the registry's
    // one canonical ollama/cheap default instead of a locally-hardcoded tag —
    // this used to disagree with lib/spawner.ts and lib/fleet-runtime.ts's
    // own literal ollama defaults (ADR-0057 model-abstraction unification).
    case 'ollama': return readEnv(env, 'PD_OLLAMA_DEFAULT_MODEL')
      || resolveModel({ backend: 'ollama', capability: 'cheap' });
    default: return '';
  }
}

/**
 * Wrap a request-shape adapter (`lib/llm-call.ts`) as an `LLMTransport` —
 * the small interface the judge-style callers consume. The adapter
 * already handles the HTTP/SDK details and result-shape; the transport
 * just adds a label for telemetry and threads the right model through.
 */
function adapterToTransport(
  backend: LLMBackend,
  model: string,
  adapter: LLMAdapter,
  defaultMaxTokens: number,
  env: NodeJS.ProcessEnv,
): LLMTransport {
  return {
    label: `${backend}:${model}`,
    async complete({ prompt, model: callModel, signal }) {
      const useModel = callModel || model;
      const result = await adapter({
        prompt,
        model: useModel,
        maxTokens: defaultMaxTokens,
        signal,
        env,
      });
      return result;
    },
  };
}

const JUDGE_MAX_TOKENS = 200;

function buildCloudflareTransport(model: string, env: NodeJS.ProcessEnv): LLMTransport | null {
  // Don't materialize a transport if creds are missing — caller treats
  // null as "not configured." We can't ask the adapter for this directly
  // (it returns ok:false at call time), so peek at the env.
  const accountId = readEnv(env, 'CLOUDFLARE_ACCOUNT_ID') || readEnv(env, 'CF_ACCOUNT_ID');
  const token = readEnv(env, 'CLOUDFLARE_API_TOKEN')
    || readEnv(env, 'CLOUDFLARE_API_KEY')
    || readEnv(env, 'CF_API_TOKEN');
  if (!accountId || !token) return null;
  return adapterToTransport('cloudflare', model, cloudflareAdapter, JUDGE_MAX_TOKENS, env);
}

function buildOllamaTransport(model: string, env: NodeJS.ProcessEnv): LLMTransport {
  return adapterToTransport('ollama', model, ollamaAdapter, JUDGE_MAX_TOKENS, env);
}

function notSupportedTransport(backend: LLMBackend, model: string): LLMTransport {
  return {
    label: `${backend}:unsupported`,
    async complete() {
      return {
        ok: false,
        error: `request-shape transport for backend '${backend}' (model '${model}') is not built. Use the spawner for spawn-shape calls, or set PD_<ACTOR>_BACKEND to cloudflare or ollama, or inject a custom transport.`,
      };
    },
  };
}

/**
 * Full request-shape resolution: name → model → transport. Returns null
 * when no backend is configured (caller decides whether that's an error
 * or an opt-out).
 */
export function resolveLLMBackend(options: ResolveLLMBackendOptions = {}): ResolvedLLMBackend | null {
  const { backend, source } = resolveBackendName(options);
  if (!backend) return null;
  const env = options.env ?? process.env;
  const model = options.model || defaultModelFor(backend, env);

  if (options.transport) {
    return { backend, model, transport: options.transport, source };
  }

  let transport: LLMTransport | null = null;
  switch (backend) {
    case 'cloudflare':
      transport = buildCloudflareTransport(model, env);
      break;
    case 'ollama':
      transport = buildOllamaTransport(model, env);
      break;
    case 'claude':
    case 'codex':
    case 'custom':
      transport = notSupportedTransport(backend, model);
      break;
  }

  if (!transport) return null;
  return { backend, model, transport, source };
}
