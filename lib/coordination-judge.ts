/**
 * Coordination judge.
 *
 * The deterministic side of coxswain's audit (lib/coordination-pipeline-audit.ts)
 * fires complaints in clear-signal cases without any LLM involvement. For
 * the *ambiguous middle* — channel similarity in [0.78, 0.92), silence in
 * [30min, 60min), naming patterns that almost match — those issues are
 * marked `needsJudge: true`. This module is the LLM yes/no on whether the
 * borderline case actually warrants a DM.
 *
 * **Thin wrapper over `lib/llm-call.ts`.** The judge no longer owns
 * cache / rate-limit / timeout / fallback machinery — those live in
 * `createLLMClient`, shared with every future request-shape actor. The
 * judge's remaining job:
 *
 *   1. Build the conservative-bias prompt.
 *   2. Parse the model's `{intervene, reason}` JSON (tolerant of
 *      code-fence wraps and trailing prose, since 3B-class models drift).
 *   3. Translate the LLMClient's result into the JudgeVerdict shape.
 *
 * **Backend-agnostic.** Caller injects either an `LLMClient` (preferred,
 * built via `createLLMClient` with cache/rate-limit/timeout configured)
 * or a raw `LLMTransport` for back-compat (the judge wraps it in a
 * default-configured client). If neither is supplied, the judge runs in
 * `disabled` mode — every `ask()` returns
 * `{ intervene: false, fellBack: true, reason: 'judge disabled' }`.
 *
 * The deterministic-only audit + judge layering means: at LLM-unavailability,
 * coxswain still emits clear-signal DMs (e.g. "your channel has 12 publishes
 * and 0 subscribers"). The LLM is a tiebreaker, not a generator.
 */

import { createHash } from 'node:crypto';
import { createLLMClient, type LLMClient, type LLMAdapter } from './llm-call.js';
import type { LLMTransport } from './llm-backend-resolver.js';

/** Re-exported for callers that already import this from the judge. New
 *  callers should pull `LLMTransport` directly from `llm-call`. */
export type JudgeTransport = LLMTransport;

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CALLS_PER_MINUTE = 30;

export interface JudgeRequest {
  /** Discriminator that selects the judge prompt's framing. Mirrors the
   *  audit issue's `kind`, so cache reuse stays predictable. */
  kind: string;
  /** The yes/no question the judge is being asked. Kept short so the
   *  borderline-case prompt fits comfortably under 300 tokens. */
  question: string;
  /** Evidence object — JSON-serialized into the prompt verbatim. Keep it
   *  small; the judge model is 3B parameters and starts hallucinating
   *  past a few hundred tokens of context. */
  context: Record<string, unknown>;
  /** Stable hash for cache key. Provided by the audit's `cooldownKey`. */
  cacheKey: string;
}

export interface JudgeVerdict {
  intervene: boolean;
  /** Short justification (≤120 chars). For DM payload + telemetry. */
  reason: string;
  /** True when this verdict was served from cache. */
  cached: boolean;
  /** True when the LLM was unavailable / errored / timed out and we
   *  defaulted to `intervene: false`. */
  fellBack: boolean;
}

export interface JudgeStats {
  cacheHits: number;
  cacheMisses: number;
  llmCalls: number;
  llmFailures: number;
  rateLimited: number;
  disabledCalls: number;
}

export interface JudgeOptions {
  /** Hard per-call timeout in ms. Default 3000. Forwarded to LLMClient. */
  timeoutMs?: number;
  /** Cache TTL in ms. Default 1h. Set <=0 to disable cache. */
  cacheTtlMs?: number;
  /** Max LLM calls per rolling 60s window. Default 30. */
  callsPerMinute?: number;
  /** Model identifier passed through. */
  model?: string;
  /** Force-disable the judge — every ask() returns intervene:false. Also
   *  automatic when neither `client` nor `transport` is supplied. */
  disabled?: boolean;
  /** Pre-built LLM client (preferred). The runner builds this via
   *  `lib/llm-backend-resolver.resolveLLMBackend` + `createLLMClient`,
   *  so cache + rate-limit + timeout settings are wired uniformly with
   *  every other request-shape actor. */
  client?: LLMClient;
  /** Back-compat: a raw transport. The judge wraps it in a default-
   *  configured LLMClient using the timeout/cache/rate-limit options
   *  above. Prefer `client` for new code. */
  transport?: JudgeTransport;
  /** `Date.now` injection point for cache TTL + rate-limit tests. */
  now?: () => number;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface CoordinationJudge {
  ask(req: JudgeRequest): Promise<JudgeVerdict>;
  stats(): JudgeStats;
  /** Drop the cache. For tests + manual reset. */
  clearCache(): void;
}

/**
 * Build the prompt sent to the judge. The judge's only job is to return
 * strict JSON `{"intervene": bool, "reason": "..."}`. We bias conservative
 * — the prompt explicitly tells the model to default to "no" when uncertain
 * — because false-positive DMs are noisier than false-negatives.
 */
function buildPrompt(req: JudgeRequest): string {
  const ctxJson = JSON.stringify(req.context, null, 2);
  return [
    'You are coxswain, the fleet communications officer.',
    'Decide whether to nudge the agent or actor about this borderline coordination issue.',
    'Be conservative: if the evidence is thin, ambiguous, or could plausibly be intentional, say no.',
    '',
    `Issue kind: ${req.kind}`,
    `Question: ${req.question}`,
    'Evidence:',
    ctxJson,
    '',
    'Reply with strict JSON only — no prose, no markdown.',
    'Schema: {"intervene": <true|false>, "reason": "<≤120 chars why>"}',
  ].join('\n');
}

/**
 * Parse the judge's response. The model is asked for strict JSON but tiny
 * models drift; tolerate a leading/trailing whitespace, code-fence wraps,
 * and trailing prose. If parsing fails, return null and the caller falls
 * back to "no".
 */
function parseVerdict(text: string): { intervene: boolean; reason: string } | null {
  if (!text) return null;
  const trimmed = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const candidate = trimmed.slice(start, end + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.intervene !== 'boolean') return null;
  const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, 120) : '';
  return { intervene: obj.intervene, reason };
}

/**
 * Wrap a raw transport as an adapter. Only used when a caller passes
 * `transport` (back-compat) instead of a pre-built `client`.
 */
function transportToAdapter(transport: LLMTransport): LLMAdapter {
  return async ({ prompt, model, signal }) => transport.complete({ prompt, model, signal: signal! });
}

export function createCoordinationJudge(options: JudgeOptions = {}): CoordinationJudge {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const callsPerMinute = options.callsPerMinute ?? DEFAULT_CALLS_PER_MINUTE;
  const model = options.model ?? '';
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});

  // Resolve the client. Three paths:
  //   1. caller passed a fully-built client — use it as-is.
  //   2. caller passed a raw transport — wrap it with our defaults.
  //   3. nothing — judge runs disabled.
  const client: LLMClient | null = options.client
    ?? (options.transport
      ? createLLMClient({
        adapter: transportToAdapter(options.transport),
        model,
        timeoutMs,
        cacheTtlMs,
        callsPerMinute,
        now,
        log,
      })
      : null);
  const disabled = options.disabled ?? (client === null);

  let disabledCalls = 0;
  let parseFailures = 0;

  function fallbackVerdict(reason: string): JudgeVerdict {
    return { intervene: false, reason, cached: false, fellBack: true };
  }

  return {
    async ask(req: JudgeRequest): Promise<JudgeVerdict> {
      if (disabled || !client) {
        disabledCalls += 1;
        return fallbackVerdict('judge disabled');
      }

      const result = await client.complete({
        prompt: buildPrompt(req),
        model,
        cacheKey: req.cacheKey,
      });

      if (!result.ok) {
        // Map LLMClient's fallback shapes into judge-flavored reasons so
        // existing callers' regexes still match.
        const reason = result.error === 'rate limited'
          ? 'rate limited'
          : result.error === 'timeout'
            ? 'transport: timeout'
            : `transport: ${(result.error || 'unknown').replace(/^adapter:\s*/, '')}`;
        log('judge fallback', { kind: req.kind, reason });
        return { intervene: false, reason, cached: result.cached, fellBack: true };
      }

      const parsed = parseVerdict(result.text || '');
      if (!parsed) {
        parseFailures += 1;
        log('judge returned unparseable response, falling back', {
          kind: req.kind,
          text: (result.text || '').slice(0, 200),
        });
        return fallbackVerdict('unparseable response');
      }

      return {
        intervene: parsed.intervene,
        reason: parsed.reason || (parsed.intervene ? 'judge said yes' : 'judge said no'),
        cached: result.cached,
        fellBack: false,
      };
    },

    stats(): JudgeStats {
      const inner = client?.stats() ?? { cacheHits: 0, cacheMisses: 0, llmCalls: 0, llmFailures: 0, rateLimited: 0, timedOut: 0 };
      return {
        cacheHits: inner.cacheHits,
        cacheMisses: inner.cacheMisses,
        llmCalls: inner.llmCalls,
        // Parse failures (model returned text but not valid JSON) happen
        // *after* the adapter resolves, so the client can't count them.
        // Track them in the judge and roll up here.
        llmFailures: inner.llmFailures + inner.timedOut + parseFailures,
        rateLimited: inner.rateLimited,
        disabledCalls,
      };
    },

    clearCache() {
      client?.clearCache();
    },
  };
}

/**
 * Convenience: build a stable cacheKey from arbitrary parts. Used by the
 * runner when an issue's `cooldownKey` isn't a perfect fit (e.g. when
 * the runner wants to cache by a richer compound key including the
 * judge model id).
 */
export function buildJudgeCacheKey(parts: Array<string | number>): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}
