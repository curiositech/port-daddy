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
// Reuse the operator's existing local embedder + cosine metric for the semantic
// cache tier — no new embedding service, no external vector DB (ADR-0059).
import { cosineSimilarity, type LocalEmbedder } from './semantic-resolver.js';

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
  /**
   * Optional live-token sink. When present, an adapter that can stream WILL,
   * calling this with each text fragment as it arrives.
   *
   * The rationale for making it optional rather than a separate `streamX`
   * function per provider: streaming and non-streaming differ only in how the
   * response body is read, and every caller wants the same final
   * `LLMCompletionResult` either way. Splitting the API would have doubled the
   * adapter surface and guaranteed the two halves drift — the exact shape the
   * canonical registry work exists to stop elsewhere in this repo.
   *
   * The final result is UNCHANGED by streaming: `text` is still the whole
   * completion. A caller that ignores deltas gets identical behavior, and a
   * caller that consumes them must not also append `text`, or the operator sees
   * every turn twice.
   */
  onTextDelta?: (delta: string) => void;

  /**
   * How hard a reasoning-capable model should think, by name.
   *
   * Advisory, not a demand: the adapter clamps it to what the chosen model
   * actually accepts (resolveReasoningEffort, lib/model-registry.ts), because the
   * accepted set differs per model and an unsupported value is an HTTP 400
   * before a single token is spent. Omit it to get the model's own cheapest
   * supported rung, which is what cost-capped smokes want.
   *
   * Ignored by backends with no such concept — the field is a request for
   * thinking depth, not a provider-specific parameter passthrough.
   */
  reasoningEffort?: string;
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
  /** Raw parsed provider response, surfaced for full-depth transcript
   *  extraction (reasoning / tool calls / messages). Gemini: the parsed
   *  generateContent object. Cloudflare: the parsed `result` object. The
   *  flattened `text` field is kept for back-compat; `raw` is additive and
   *  undefined when a backend has no richer structure to expose. */
  raw?: unknown;
}

export type LLMAdapter = (req: LLMCompletionRequest) => Promise<LLMCompletionResult>;

/**
 * Is this response actually an event stream?
 *
 * The design rule this encodes: `stream: true` is a REQUEST, not a guarantee.
 * A gateway, a proxy, or a model that does not support streaming can answer
 * with ordinary JSON, and parsing that as SSE finds zero frames — which reads as
 * an empty completion and fails a run that in fact succeeded. Checking the
 * content type makes the degradation honest: no deltas, same answer.
 *
 * @param res The provider response.
 * @returns True when the body should be read as SSE.
 */
function isEventStream(res: Response): boolean {
  // Defensive about `headers` itself being absent, not only about the header:
  // every test that exercises an API backend mocks `fetch` with a hand-built
  // object, and reading through a missing property would turn a behavioural
  // improvement into a crash in code that has nothing to do with it.
  try {
    return (res.headers?.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
  } catch {
    return false;
  }
}

/**
 * Read a `text/event-stream` body, handing each `data:` payload to a parser.
 *
 * The rationale for writing it once and sharing it: the three providers that
 * stream here differ ONLY in the shape inside `data:` — the framing, the `[DONE]` sentinel, the
 * partial-line buffering across chunk boundaries, and the "flush whatever is
 * left at EOF" rule are identical, and are exactly the parts that are subtly
 * wrong when each provider gets its own copy. A frame split across two network
 * chunks is the classic version of that bug: it drops a token silently, which
 * reads to an operator as the model having said less than it did.
 *
 * @param body The response body stream.
 * @param onFrame Called with each decoded `data:` payload, minus the sentinel.
 * @param signal Optional abort signal, checked between chunks.
 * @returns How many frames were seen, and the raw text consumed. The caller
 *          needs both: a stream that yielded ZERO frames is not an empty
 *          completion, it is a body that was not an event stream after all, and
 *          the raw text is the only place its real error is written.
 */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (payload: string) => void,
  signal?: AbortSignal,
): Promise<{ frames: number; raw: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let frames = 0;
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      buffer += chunk;
      // SSE events are separated by a blank line; anything after the last one is
      // a partial frame that must survive until the next chunk arrives.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          frames += 1;
          onFrame(payload);
        }
      }
    }
    // EOF without a trailing blank line still carries a final frame.
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== '[DONE]') {
        frames += 1;
        onFrame(payload);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { frames, raw };
}

/**
 * Pull a provider's error message out of a body that was NOT an event stream.
 *
 * WHY THIS IS NEEDED, with the case that produced it: Gemini answers a quota
 * failure with HTTP **200**, `content-type: text/event-stream`, and a plain JSON
 * error object as the body. Every honest check passes — the status is fine, the
 * content type says SSE — and the SSE parser then finds zero frames. Reporting
 * that as "returned no text response" is technically true and completely
 * useless: it hides a 429 behind a message that reads like a model problem, and
 * sends an operator hunting the wrong thing.
 *
 * @param raw The raw body text that yielded no frames.
 * @param fallback The message to use when no provider error can be read.
 * @returns The provider's own error message when there is one.
 */
function errorFromNonStreamBody(raw: string, fallback: string): string {
  const text = raw.trim();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as Record<string, any>;
    const message = parsed?.error?.message ?? parsed?.message;
    if (typeof message === 'string' && message) {
      const code = parsed?.error?.code;
      return code ? `${code}: ${message}` : message;
    }
  } catch {
    // Not JSON either. Fall through to the truncated raw body, which is still
    // more informative than a generic "no response".
  }
  return `${fallback} (body: ${text.slice(0, 200)})`;
}

/**
 * Emit a text fragment to a caller's delta sink without letting it break the run.
 *
 * The sink belongs to the caller — a transcript appender, an SSE writer — and a
 * throw from it is a UI problem, not a completion problem. The design rule is
 * that observing a response can never fail producing it.
 *
 * @param onTextDelta The caller's sink, if any.
 * @param delta The fragment.
 */
function emitDelta(onTextDelta: ((d: string) => void) | undefined, delta: string): void {
  if (!onTextDelta || !delta) return;
  try {
    onTextDelta(delta);
  } catch {
    // Deliberately swallowed: see above.
  }
}

function cloudflareModelPath(model: string): string {
  const normalized = model
    .trim()
    .replace(/^\/+/, '');
  const segments = normalized.split('/');
  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Cloudflare Workers AI model must be a slash-delimited model id without empty, dot, or dot-dot path segments');
  }
  return segments
    .map((segment) => encodeURIComponent(segment).replace(/%40/g, '@'))
    .join('/');
}

/**
 * Cloudflare Workers AI adapter. Reads creds from `getSecret` first
 * (encrypted managed store), falls back to `process.env`. Returns
 * `ok: false` with explanatory error when creds are missing — no throw.
 */
export const cloudflareAdapter: LLMAdapter = async ({ prompt, model, maxTokens, signal, env, onTextDelta }) => {
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
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cloudflareModelPath(model)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        // Stream only when someone is listening. A streamed response costs an
        // extra parse and gives up the usage block on some models, so it is not
        // the free default it looks like.
        stream: Boolean(onTextDelta),
      }),
      signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => 'unknown error');
      // Self-diagnosing auth failures: a 401 with a token+account that work via
      // direct REST means the daemon RESOLVED different creds at runtime (stale
      // env snapshot / launchd-injected value shadowing the keychain). Surface
      // non-secret fingerprints so the transcript shows exactly which account +
      // token the daemon used, instead of an opaque "Authentication error".
      const acctTail = String(accountId).slice(-6);
      const tokFp = `${String(token).slice(0, 6)}…${String(token).slice(-4)}(${String(token).length})`;
      const diag = res.status === 401 || res.status === 403
        ? ` [resolved account …${acctTail}, token ${tokFp} — if this token+account work via direct ai/run, the daemon resolved a stale credential]`
        : '';
      return { ok: false, error: `Cloudflare Workers AI HTTP ${res.status}: ${txt}${diag}` };
    }
    // Take the streaming path only when the response ACTUALLY is an event
    // stream. Asking for `stream: true` is a request, not a guarantee — a
    // gateway, a proxy, or a model that does not support it can answer with
    // ordinary JSON, and parsing that as SSE finds no frames and reports an
    // empty completion. A run must not fail because an optimisation was
    // declined.
    if (onTextDelta && res.body && isEventStream(res)) {
      // Workers AI streams OpenAI-shaped chunks: choices[].delta.content, with
      // some models using `response` for the same fragment.
      let text = '';
      const stream = await readEventStream(
        res.body,
        (payload) => {
          try {
            const chunk = JSON.parse(payload) as Record<string, any>;
            const delta =
              chunk?.choices?.[0]?.delta?.content
              ?? chunk?.response
              ?? chunk?.delta
              ?? '';
            if (typeof delta === 'string' && delta) {
              text += delta;
              emitDelta(onTextDelta, delta);
            }
          } catch {
            // A malformed frame is skipped rather than failing the stream: the
            // rest of the completion is still worth having.
          }
        },
        signal,
      );
      if (!text) {
        // Zero frames means the body was never an event stream, whatever the
        // content type claimed — so the provider's real error lives in it.
        return {
          ok: false,
          error:
            stream.frames === 0
              ? errorFromNonStreamBody(stream.raw, 'Cloudflare Workers AI returned no text response')
              : 'Cloudflare Workers AI returned no text response',
        };
      }
      // Streamed Workers AI responses carry no usage block; undefined means
      // "unknown", which the cost tracker must not read as zero.
      return { ok: true, text };
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
      // Surface the parsed `result` object so the spawner can reconstruct
      // reasoning / tool_calls / message turns for the transcript.
      raw: result,
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

/**
 * Google Gemini adapter (REST `generateContent`).
 *
 * Uses the v1beta REST endpoint directly rather than the `@google/genai`
 * SDK — same house style as the cloudflare/openai backends (zero added
 * deps, exact usage extraction, fetch-only). The deprecated
 * `@google/generative-ai` SDK is intentionally NOT used.
 *
 * Auth: `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) from getSecret() first
 * (encrypted keychain), then env. Sent as the `x-goog-api-key` header.
 *
 * Exact telemetry: the response's `usageMetadata` carries
 * `promptTokenCount` and `candidatesTokenCount`. Gemini 2.5 models are
 * thinking models that also report `thoughtsTokenCount` — those tokens
 * are BILLED as output, so we fold them into outputTokens to keep cost
 * recording honest.
 */
function geminiApiBase(env: NodeJS.ProcessEnv): string {
  return (env.GEMINI_API_BASE || env.GOOGLE_GEMINI_API_BASE
    || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
}

export const geminiAdapter: LLMAdapter = async ({ prompt, model, maxTokens, signal, env, onTextDelta }) => {
  const e = env ?? process.env;
  const apiKey = getSecret('GEMINI_API_KEY')
    || e.GEMINI_API_KEY
    || getSecret('GOOGLE_API_KEY')
    || e.GOOGLE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'GEMINI_API_KEY is not set. Run: pd secret set GEMINI_API_KEY' };
  }

  // Reject path-injection in the model id (it goes into the URL path).
  const modelId = model.trim().replace(/^models\//, '');
  if (!modelId || /[/?#]/.test(modelId)) {
    return { ok: false, error: `Invalid Gemini model id: ${JSON.stringify(model)}` };
  }

  // includeThoughts surfaces the model's reasoning summary as `thought:true`
  // parts so the transcript can record a `thinking` turn — not just the final
  // answer. Supported on the Gemini 2.5 models this backend targets; thinking
  // tokens are already billed (folded into outputTokens below), so this adds
  // visibility at no extra cost.
  const generationConfig: Record<string, unknown> = {
    thinkingConfig: { includeThoughts: true },
  };
  if (typeof maxTokens === 'number' && maxTokens > 0) {
    generationConfig.maxOutputTokens = maxTokens;
  }
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  };

  // Gemini's streaming endpoint is a DIFFERENT method plus `alt=sse`; without
  // that query param it returns a JSON array rather than an event stream, which
  // parses as one enormous frame and defeats the point.
  const method = onTextDelta ? 'streamGenerateContent?alt=sse' : 'generateContent';

  try {
    const res = await fetch(
      `${geminiApiBase(e)}/models/${encodeURIComponent(modelId)}:${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => 'unknown error');
      return { ok: false, error: `Gemini HTTP ${res.status}: ${txt}` };
    }

    // Same rule as Cloudflare above: a response that is not an event stream is
    // read as JSON rather than parsed for frames that are not there.
    if (onTextDelta && res.body && isEventStream(res)) {
      let text = '';
      let thoughts = '';
      let lastChunk: Record<string, any> | undefined;
      const stream = await readEventStream(
        res.body,
        (payload) => {
          try {
            const chunk = JSON.parse(payload) as Record<string, any>;
            lastChunk = chunk;
            const parts = chunk?.candidates?.[0]?.content?.parts;
            if (!Array.isArray(parts)) return;
            for (const part of parts) {
              const fragment = typeof part?.text === 'string' ? part.text : '';
              if (!fragment) continue;
              // Thought parts are reasoning, not answer. They are ACCUMULATED
              // rather than dropped — the transcript records thinking as its own
              // turn — but they never reach the text sink, because streaming
              // them into the answer would splice the model's scratchpad into
              // what the operator reads.
              if (part?.thought === true) {
                thoughts += fragment;
                continue;
              }
              text += fragment;
              emitDelta(onTextDelta, fragment);
            }
          } catch {
            // Skip a malformed frame rather than losing the rest.
          }
        },
        signal,
      );
      if (!text) {
        // A stream that yielded ZERO frames was not a stream. Gemini answers a
        // quota failure with HTTP 200 + `text/event-stream` + a JSON error body,
        // and reporting that as "no text response" hides a 429 behind a message
        // that reads like a model problem.
        if (stream.frames === 0) {
          return {
            ok: false,
            error: errorFromNonStreamBody(stream.raw, 'Gemini returned no text response'),
          };
        }
        const finish = (lastChunk as Record<string, any> | undefined)?.candidates?.[0]?.finishReason;
        return {
          ok: false,
          error: `Gemini returned no text response${finish ? ` (finishReason: ${finish})` : ''}`,
        };
      }
      // Gemini repeats cumulative usage on every chunk, so the LAST one carries
      // the totals — this is one of the few streaming APIs where usage survives.
      const streamUsage = (lastChunk as Record<string, any> | undefined)?.usageMetadata ?? {};
      const inTok = normalizeTokenCount(streamUsage.promptTokenCount);
      const cand = normalizeTokenCount(streamUsage.candidatesTokenCount) ?? 0;
      const thought = normalizeTokenCount(streamUsage.thoughtsTokenCount) ?? 0;
      const outTok =
        streamUsage.candidatesTokenCount === undefined
        && streamUsage.thoughtsTokenCount === undefined
          ? undefined
          : cand + thought;
      // Rebuild a generateContent-shaped `raw` from what streamed, so the
      // transcript parser downstream sees the same structure it does on the
      // batch path. Without this, a streamed Gemini run would silently lose the
      // separate thinking turn that the non-streamed one records — a capability
      // regression hidden behind an optimisation.
      const raw = {
        candidates: [
          {
            content: {
              parts: [
                ...(thoughts ? [{ text: thoughts, thought: true }] : []),
                ...(text ? [{ text }] : []),
              ],
            },
            finishReason: (lastChunk as Record<string, any> | undefined)?.candidates?.[0]
              ?.finishReason,
          },
        ],
        usageMetadata: streamUsage,
      };
      return { ok: true, text, inputTokens: inTok, outputTokens: outTok, raw };
    }

    const data = await res.json() as Record<string, any>;
    if (data.error) {
      return { ok: false, error: `Gemini API error: ${data.error.message || JSON.stringify(data.error)}` };
    }
    const candidate = data?.candidates?.[0];
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .filter((p: { thought?: boolean }) => p?.thought !== true)
      .map((p: { text?: string }) => p?.text ?? '')
      .join('');
    if (!text) {
      // A blocked / empty completion is a real failure, not zero-token success.
      const finish = candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : '';
      return { ok: false, error: `Gemini returned no text response${finish}` };
    }
    const usage = data?.usageMetadata ?? {};
    const inputTokens = normalizeTokenCount(usage.promptTokenCount);
    // Thinking tokens are billed as output — fold them in so cost is exact.
    const candidateTokens = normalizeTokenCount(usage.candidatesTokenCount) ?? 0;
    const thoughtTokens = normalizeTokenCount(usage.thoughtsTokenCount) ?? 0;
    const outputTokens = usage.candidatesTokenCount === undefined && usage.thoughtsTokenCount === undefined
      ? undefined
      : candidateTokens + thoughtTokens;
    // Surface the parsed response so the spawner can reconstruct
    // thinking / functionCall / text turns for the transcript.
    return { ok: true, text, inputTokens, outputTokens, raw: data };
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
  /**
   * Opt OUT of the semantic tier for this call (default: on when the client has
   * an embedder). Set false for calls where a near-miss prompt must NOT reuse a
   * neighbour's answer (e.g. exact-identity lookups).
   */
  semantic?: boolean;
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
  /** Exact-match misses that then hit the semantic tier. */
  semanticHits: number;
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
  /**
   * Optional local embedder (lib/semantic-resolver.ts createLocalEmbedder).
   * When present AND cacheTtlMs > 0, an exact-match miss falls through to a
   * semantic tier: the prompt is embedded and compared (cosine) against cached
   * entries of the SAME model+maxTokens; a match at/above `semanticThreshold`
   * is served from cache. Absent → exact-match only (unchanged behaviour).
   */
  embedder?: LocalEmbedder;
  /**
   * Cosine threshold for a semantic hit. Default 0.95 — high precision, because
   * returning the wrong neighbour's answer is worse than a cache miss.
   */
  semanticThreshold?: number;
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
  /** Semantic-tier metadata (only populated when an embedder is configured). */
  prompt?: string;
  embedding?: number[];
  model?: string;
  maxTokens?: number;
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
  const embedder = options.embedder;
  const semanticThreshold = options.semanticThreshold ?? 0.95;
  const env = options.env;
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});

  const cache = new Map<string, ClientCacheEntry>();
  const callTimestamps: number[] = [];
  const stats: LLMClientStats = {
    cacheHits: 0,
    semanticHits: 0,
    cacheMisses: 0,
    llmCalls: 0,
    llmFailures: 0,
    rateLimited: 0,
    timedOut: 0,
  };

  /**
   * Semantic tier: embed the prompt and find the nearest cached entry of the
   * SAME model+maxTokens (cross-model reuse would return the wrong model's
   * answer). Best-effort — embedding failure (model not yet downloaded, etc.)
   * returns null so the call falls through to the adapter; it never blocks.
   * Returns the matched entry plus the freshly-computed query embedding so the
   * caller can reuse it when storing a miss (no double-embed).
   */
  async function semanticLookup(
    req: LLMClientCallRequest,
    model: string,
  ): Promise<{ hit: ClientCacheEntry | null; embedding: number[] | null }> {
    if (!embedder) return { hit: null, embedding: null };
    let embedding: number[];
    try {
      [embedding] = await embedder.embed([req.prompt]);
    } catch (err) {
      log('llm-call: semantic embed failed, skipping tier', { error: (err as Error).message });
      return { hit: null, embedding: null };
    }
    if (!embedding) return { hit: null, embedding: null };
    let best: ClientCacheEntry | null = null;
    let bestSim = -1;
    for (const v of cache.values()) {
      if (!v.embedding || v.model !== model || v.maxTokens !== (req.maxTokens ?? defaultMaxTokens)) continue;
      const sim = cosineSimilarity(embedding, v.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        best = v;
      }
    }
    return { hit: best && bestSim >= semanticThreshold ? best : null, embedding };
  }

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
      const model = req.model || defaultModel;
      let queryEmbedding: number[] | null = null;

      if (req.cacheKey && cacheTtlMs > 0) {
        purgeStaleCache(t);
        const hit = cache.get(req.cacheKey);
        if (hit) {
          stats.cacheHits += 1;
          return { ...hit.result, cached: true, fellBack: false };
        }
        stats.cacheMisses += 1;

        // Tier 2: semantic — a near-miss prompt reuses a neighbour's answer.
        if (embedder && req.semantic !== false) {
          const { hit: semHit, embedding } = await semanticLookup(req, model);
          queryEmbedding = embedding; // reuse on store, avoid a second embed
          if (semHit) {
            stats.semanticHits += 1;
            return { ...semHit.result, cached: true, fellBack: false };
          }
        }
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
        const entry: ClientCacheEntry = { result, insertedAt: t };
        if (embedder && req.semantic !== false) {
          // Store the embedding for the semantic tier. Reuse the one computed
          // during the miss lookup; only embed here if that was skipped.
          if (!queryEmbedding) {
            try {
              [queryEmbedding] = await embedder.embed([req.prompt]);
            } catch {
              queryEmbedding = null; // best-effort; entry still serves exact-match
            }
          }
          if (queryEmbedding) {
            entry.prompt = req.prompt;
            entry.embedding = queryEmbedding;
            entry.model = model;
            entry.maxTokens = req.maxTokens ?? defaultMaxTokens;
          }
        }
        cache.set(req.cacheKey, entry);
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
