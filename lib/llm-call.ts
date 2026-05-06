/**
 * Single-source per-backend completion adapters.
 *
 * Until C3.3, the spawner had `runCloudflare` / `runOllama` and the judge
 * resolver had its own `buildCloudflareTransport` / `buildOllamaTransport`
 * — two implementations of "fetch from Cloudflare with auth + parse the
 * response." That's the same drift problem the unified backend resolver
 * solved at the env layer, repeated at the wire layer.
 *
 * Now: one adapter per backend, lives here. Both spawn-shape callers
 * (`lib/spawner.ts` for fleet agents) and request-shape callers
 * (`lib/coordination-judge.ts` via `lib/llm-backend-resolver.ts`)
 * delegate to these. If the operator's Cloudflare token rolls or the
 * response shape shifts, exactly one place updates.
 *
 * This module is **adapters only** — no cache, no rate-limit, no
 * telemetry. Those are caller concerns:
 *   - Spawner: cost tracker, registration, child-process management.
 *   - Judge: 1h LRU cache, 30/min rate limit, 3s timeout, fallback-deny.
 * If a third consumer shows up that needs cache + rate-limit, lift the
 * judge's wrapper out into a `createLLMClient` factory here. Premature
 * to do that for one caller.
 *
 * Adapters use `lib/secret-env.getSecret` so encrypted managed creds
 * (the spawner's existing pattern) work alongside `process.env`.
 */

import { getSecret } from './secret-env.js';

export interface LLMCompletionRequest {
  prompt: string;
  model: string;
  /** Optional max tokens. Adapters that don't expose this field (Ollama
   *  uses num_predict; Cloudflare uses max_tokens) translate as needed.
   *  Pass undefined to use the adapter's default. */
  maxTokens?: number;
  /** Optional abort signal. Adapters thread it through to fetch. */
  signal?: AbortSignal;
  /** Optional env override. Adapters read from `env` if provided, else
   *  fall back to `process.env`. Used by tests to inject creds without
   *  mutating real env. */
  env?: NodeJS.ProcessEnv;
}

export interface LLMCompletionResult {
  ok: boolean;
  text?: string;
  error?: string;
  /** Token counts when the adapter can extract them. Undefined = no
   *  data available, not zero. Cost trackers should treat undefined as
   *  "unknown" rather than estimate. */
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export type LLMAdapter = (req: LLMCompletionRequest) => Promise<LLMCompletionResult>;

/**
 * Cloudflare Workers AI adapter. Reads creds from `getSecret` first
 * (encrypted managed store), falls back to `process.env`. Returns
 * `ok: false` with explanatory error when creds are missing — no throw.
 */
export const cloudflareAdapter: LLMAdapter = async ({ prompt, model, maxTokens, signal, env }) => {
  const e = env ?? process.env;
  const accountId = getSecret('CLOUDFLARE_ACCOUNT_ID')
    || e.CLOUDFLARE_ACCOUNT_ID
    || getSecret('CF_ACCOUNT_ID')
    || e.CF_ACCOUNT_ID;
  const token = getSecret('CLOUDFLARE_API_TOKEN')
    || getSecret('CLOUDFLARE_API_KEY')
    || getSecret('CF_API_TOKEN')
    || e.CLOUDFLARE_API_TOKEN
    || e.CLOUDFLARE_API_KEY
    || e.CF_API_TOKEN;

  if (!accountId) return { ok: false, error: 'CLOUDFLARE_ACCOUNT_ID is not set' };
  if (!token) return { ok: false, error: 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY is not set' };

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        stream: false,
      }),
      signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => 'unknown error');
      return { ok: false, error: `Cloudflare Workers AI HTTP ${res.status}: ${txt}` };
    }
    const data = await res.json() as Record<string, any>;
    const result = data.result ?? data;
    const usage = extractCloudflareUsage(result, data);
    const text = typeof result === 'string'
      ? result
      : result?.response
        || result?.text
        || result?.output_text
        || result?.choices?.[0]?.message?.content
        || '';
    if (!text) return { ok: false, error: 'Cloudflare Workers AI returned no text response' };
    return {
      ok: true,
      text,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

/**
 * Ollama adapter. Targets `OLLAMA_HOST` (default localhost:11434).
 * No creds, no managed-secret read — Ollama is a local-only server in
 * the supported deployments.
 */
export const ollamaAdapter: LLMAdapter = async ({ prompt, model, maxTokens, signal, env }) => {
  const e = env ?? process.env;
  const host = e.OLLAMA_HOST || 'http://localhost:11434';
  try {
    const res = await fetch(`${host.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: maxTokens ? { num_predict: maxTokens } : undefined,
      }),
      signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => 'unknown error');
      return { ok: false, error: `Ollama HTTP ${res.status}: ${txt}` };
    }
    const data = await res.json() as Record<string, any>;
    const text = data?.message?.content ?? data?.response ?? '';
    if (!text) return { ok: false, error: 'Ollama returned no text response' };
    return {
      ok: true,
      text,
      // Ollama returns prompt_eval_count + eval_count when available.
      inputTokens: typeof data?.prompt_eval_count === 'number' ? data.prompt_eval_count : undefined,
      outputTokens: typeof data?.eval_count === 'number' ? data.eval_count : undefined,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

// ────── Reusable client wrapper ──────
//
// Cache + rate-limit + hard timeout + fallback-deny are concerns every
// request-shape LLM caller wants. The judge had its own copy in
// `lib/coordination-judge.ts`; lifting them here means future actors
// (cartographer-similarity, channel-name suggester, etc.) get the same
// behavior without reinventing the wrapper. Spawn-shape callers
// (lib/spawner.ts) opt out entirely — they have their own cost-budget
// kill + per-project rate limiting.

export interface LLMClientCallRequest {
  prompt: string;
  /** Optional override of the client's default model. */
  model?: string;
  /** Optional cache key. When provided, a hit short-circuits the
   *  adapter call and returns the cached result with `cached: true`.
   *  When absent, the call always hits the adapter. */
  cacheKey?: string;
  /** Optional max tokens override. */
  maxTokens?: number;
}

export interface LLMClientResult extends LLMCompletionResult {
  /** True when this result was served from cache. */
  cached: boolean;
  /** True when the call fell back (rate limit, timeout, error) and
   *  ok:false was returned without a real adapter response. */
  fellBack: boolean;
}

export interface LLMClientStats {
  cacheHits: number;
  cacheMisses: number;
  llmCalls: number;
  llmFailures: number;
  rateLimited: number;
  timedOut: number;
}

export interface LLMClientOptions {
  /** The backend adapter to call. Required. */
  adapter: LLMAdapter;
  /** Default model for calls that don't override. */
  model?: string;
  /** Default max tokens for calls that don't override. */
  maxTokens?: number;
  /** Hard per-call timeout in ms. 0 / undefined → no timeout. */
  timeoutMs?: number;
  /** Cache TTL in ms. 0 → no caching. Default 0 (caller must opt in). */
  cacheTtlMs?: number;
  /** Max calls per rolling 60s window. 0 → unlimited. Default 0. */
  callsPerMinute?: number;
  /** Optional env passed through to the adapter. */
  env?: NodeJS.ProcessEnv;
  /** `Date.now` injection point for tests. */
  now?: () => number;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface LLMClient {
  complete(req: LLMClientCallRequest): Promise<LLMClientResult>;
  stats(): LLMClientStats;
  clearCache(): void;
}

interface ClientCacheEntry {
  result: LLMCompletionResult;
  insertedAt: number;
}

/**
 * Build a wrapped LLM client. Cache + rate-limit + timeout + fallback
 * all live here; the judge and any future request-shape actor compose
 * on top by translating the LLMCompletionResult into their own verdict
 * shape.
 *
 * Fallback-deny semantics: any failure (rate limit, timeout, adapter
 * error, abort) returns `{ ok: false, fellBack: true, error }` rather
 * than throwing. Callers never need try/catch.
 */
export function createLLMClient(options: LLMClientOptions): LLMClient {
  const adapter = options.adapter;
  const defaultModel = options.model ?? '';
  const defaultMaxTokens = options.maxTokens;
  const timeoutMs = options.timeoutMs ?? 0;
  const cacheTtlMs = options.cacheTtlMs ?? 0;
  const callsPerMinute = options.callsPerMinute ?? 0;
  const env = options.env;
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});

  const cache = new Map<string, ClientCacheEntry>();
  const callTimestamps: number[] = [];
  const stats: LLMClientStats = {
    cacheHits: 0,
    cacheMisses: 0,
    llmCalls: 0,
    llmFailures: 0,
    rateLimited: 0,
    timedOut: 0,
  };

  function purgeStaleCache(t: number): void {
    if (cacheTtlMs <= 0) {
      cache.clear();
      return;
    }
    const cutoff = t - cacheTtlMs;
    for (const [k, v] of cache) {
      if (v.insertedAt < cutoff) cache.delete(k);
    }
  }

  function rateLimitOK(t: number): boolean {
    if (callsPerMinute <= 0) return true;
    const cutoff = t - 60_000;
    while (callTimestamps.length > 0 && callTimestamps[0] < cutoff) callTimestamps.shift();
    return callTimestamps.length < callsPerMinute;
  }

  function fallback(error: string): LLMClientResult {
    return { ok: false, error, cached: false, fellBack: true };
  }

  return {
    async complete(req: LLMClientCallRequest): Promise<LLMClientResult> {
      const t = now();

      if (req.cacheKey && cacheTtlMs > 0) {
        purgeStaleCache(t);
        const hit = cache.get(req.cacheKey);
        if (hit) {
          stats.cacheHits += 1;
          return { ...hit.result, cached: true, fellBack: false };
        }
        stats.cacheMisses += 1;
      }

      if (!rateLimitOK(t)) {
        stats.rateLimited += 1;
        log('llm-call: rate limit exceeded', {});
        return fallback('rate limited');
      }

      callTimestamps.push(t);
      stats.llmCalls += 1;

      const controller = timeoutMs > 0 ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let result: LLMCompletionResult;
      try {
        try {
          result = await adapter({
            prompt: req.prompt,
            model: req.model || defaultModel,
            maxTokens: req.maxTokens ?? defaultMaxTokens,
            signal: controller?.signal,
            env,
          });
        } catch (err) {
          // Adapter is contract-bound to surface errors via ok:false, but
          // a timeout-induced abort can throw AbortError before resolution.
          if ((err as Error).name === 'AbortError') {
            stats.timedOut += 1;
            return fallback('timeout');
          }
          stats.llmFailures += 1;
          return fallback((err as Error).message || 'unknown');
        }
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (!result.ok) {
        stats.llmFailures += 1;
        log('llm-call: adapter failed', { error: result.error });
        return fallback(`adapter: ${result.error || 'unknown'}`);
      }

      if (req.cacheKey && cacheTtlMs > 0) {
        cache.set(req.cacheKey, { result, insertedAt: t });
      }

      return { ...result, cached: false, fellBack: false };
    },

    stats() {
      return { ...stats };
    },

    clearCache() {
      cache.clear();
    },
  };
}

function normalizeTokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value >= 0 ? Math.round(value) : undefined;
}

function extractCloudflareUsage(result: any, data: any): { inputTokens?: number; outputTokens?: number } {
  // Cloudflare exposes usage at result.usage or top-level data.usage depending
  // on model. Both layouts use prompt_tokens / completion_tokens.
  const usage = result?.usage ?? data?.usage ?? {};
  return {
    inputTokens: normalizeTokenCount(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: normalizeTokenCount(usage.completion_tokens ?? usage.output_tokens),
  };
}
