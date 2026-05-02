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
 * The judge is intentionally cheap and constrained:
 *
 *   - Backend: Cloudflare Workers AI, default model `@cf/meta/llama-3.2-3b-instruct`.
 *     Pricing is fractions of a cent per call; bounded by rate limit.
 *   - Hard 3-second timeout per call. Beyond that, fall back to "no DM".
 *   - LRU-style cache keyed by `cacheKey` (issue's deterministic hash).
 *     Default TTL 1h. Same complaint within an hour gets the same verdict
 *     without burning tokens.
 *   - Per-minute rate limit (default 30 calls/min). If exceeded, fall back
 *     to "no DM" — we never queue, never delay; missing one borderline
 *     judgement is cheaper than building a backlog.
 *   - **Fallback-deny everywhere.** Auth missing, network failure, timeout,
 *     malformed JSON — all return `{ intervene: false, fellBack: true }`.
 *     Coxswain stays quiet rather than risk the wrong nudge.
 *
 * The deterministic-only audit + judge layering means: at LLM-unavailability,
 * coxswain still emits clear-signal DMs (e.g. "your channel has 12 publishes
 * and 0 subscribers"). The LLM is a tiebreaker, not a generator.
 */

import { createHash } from 'node:crypto';

export const DEFAULT_JUDGE_MODEL = '@cf/meta/llama-3.2-3b-instruct';
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

export interface JudgeTransport {
  /** Make the actual completion call. Implementations should respect the
   *  AbortSignal and surface errors as resolved-with-error rather than
   *  throwing — that way the judge's caller never has to try/catch. */
  complete(input: { prompt: string; model: string; signal: AbortSignal }): Promise<{
    ok: boolean;
    text?: string;
    error?: string;
  }>;
}

export interface JudgeOptions {
  /** Hard per-call timeout in ms. Default 3000. */
  timeoutMs?: number;
  /** Cache TTL in ms. Default 1h. Set <=0 to disable cache. */
  cacheTtlMs?: number;
  /** Max LLM calls per rolling 60s window. Default 30. */
  callsPerMinute?: number;
  /** Model identifier. Default `@cf/meta/llama-3.2-3b-instruct`. */
  model?: string;
  /** Force-disable the judge — every ask() returns intervene:false. Useful
   *  for tests, opt-out flags, or air-gapped operation. */
  disabled?: boolean;
  /** Inject a transport for tests OR to swap backends. When omitted, a
   *  default Cloudflare Workers AI transport is used (requires
   *  CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN env). */
  transport?: JudgeTransport;
  /** Cloudflare account id override (otherwise read from env). */
  cloudflareAccountId?: string;
  /** Cloudflare API token override (otherwise read from env). */
  cloudflareApiToken?: string;
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

interface CacheEntry {
  verdict: JudgeVerdict;
  insertedAt: number;
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
 * Default Cloudflare Workers AI transport. Mirrors the shape of
 * `runCloudflare` in lib/spawner.ts but skinned down to a single
 * non-streaming completion. Returns `ok: false` instead of throwing when
 * auth or network fails — caller treats that as "fall back".
 */
function createCloudflareTransport(opts: { accountId?: string; apiToken?: string }): JudgeTransport {
  return {
    async complete({ prompt, model, signal }) {
      // Lazy import of secret-env to keep this file dep-light at top level.
      const { getSecret } = await import('./secret-env.js');
      const accountId = opts.accountId
        || getSecret('CLOUDFLARE_ACCOUNT_ID')
        || process.env.CLOUDFLARE_ACCOUNT_ID
        || getSecret('CF_ACCOUNT_ID')
        || process.env.CF_ACCOUNT_ID;
      const token = opts.apiToken
        || getSecret('CLOUDFLARE_API_TOKEN')
        || getSecret('CLOUDFLARE_API_KEY')
        || getSecret('CF_API_TOKEN');

      if (!accountId) return { ok: false, error: 'CLOUDFLARE_ACCOUNT_ID missing' };
      if (!token) return { ok: false, error: 'CLOUDFLARE_API_TOKEN missing' };

      try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            // Plenty for a 1-line JSON verdict + reason.
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

export function createCoordinationJudge(options: JudgeOptions = {}): CoordinationJudge {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const callsPerMinute = options.callsPerMinute ?? DEFAULT_CALLS_PER_MINUTE;
  const model = options.model ?? DEFAULT_JUDGE_MODEL;
  const disabled = options.disabled ?? false;
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const transport = options.transport ?? createCloudflareTransport({
    accountId: options.cloudflareAccountId,
    apiToken: options.cloudflareApiToken,
  });

  const cache = new Map<string, CacheEntry>();
  const callTimestamps: number[] = [];
  const stats: JudgeStats = {
    cacheHits: 0,
    cacheMisses: 0,
    llmCalls: 0,
    llmFailures: 0,
    rateLimited: 0,
    disabledCalls: 0,
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
    const cutoff = t - 60_000;
    while (callTimestamps.length > 0 && callTimestamps[0] < cutoff) callTimestamps.shift();
    return callTimestamps.length < callsPerMinute;
  }

  function recordFallback(reason: string): JudgeVerdict {
    return { intervene: false, reason, cached: false, fellBack: true };
  }

  return {
    async ask(req: JudgeRequest) {
      const t = now();

      if (disabled) {
        stats.disabledCalls += 1;
        return recordFallback('judge disabled');
      }

      // Cache lookup first — TTL purge happens lazily on access.
      purgeStaleCache(t);
      const cached = cache.get(req.cacheKey);
      if (cached) {
        stats.cacheHits += 1;
        return { ...cached.verdict, cached: true, fellBack: cached.verdict.fellBack };
      }
      stats.cacheMisses += 1;

      if (!rateLimitOK(t)) {
        stats.rateLimited += 1;
        log('rate limit exceeded, falling back to no-intervention', { kind: req.kind });
        return recordFallback('rate limited');
      }

      callTimestamps.push(t);
      stats.llmCalls += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let result;
      try {
        result = await transport.complete({
          prompt: buildPrompt(req),
          model,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!result.ok) {
        stats.llmFailures += 1;
        log('judge transport failed, falling back', { kind: req.kind, error: result.error });
        return recordFallback(`transport: ${result.error || 'unknown'}`);
      }

      const parsed = parseVerdict(result.text || '');
      if (!parsed) {
        stats.llmFailures += 1;
        log('judge returned unparseable response, falling back', { kind: req.kind, text: (result.text || '').slice(0, 200) });
        return recordFallback('unparseable response');
      }

      const verdict: JudgeVerdict = {
        intervene: parsed.intervene,
        reason: parsed.reason || (parsed.intervene ? 'judge said yes' : 'judge said no'),
        cached: false,
        fellBack: false,
      };

      if (cacheTtlMs > 0) {
        cache.set(req.cacheKey, { verdict, insertedAt: t });
      }
      return verdict;
    },

    stats() {
      return { ...stats };
    },

    clearCache() {
      cache.clear();
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
