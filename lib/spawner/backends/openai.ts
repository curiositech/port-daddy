/**
 * OpenAI backend — first-class spawner backend.
 *
 * Mirrors the cloudflare backend's shape: a single HTTP adapter that
 * returns `LLMCompletionResult` (ok / text / token counts / error). The
 * spawner's outer wrapper handles cost recording, telemetry policy,
 * coordination, and bond escrow — this module is HTTP-only.
 *
 * Which models are supported is NOT listed here — it is whatever
 * `config/models.yaml` catalogues, reachable through resolveModel(). A list in a
 * comment is a list that goes stale: this one still stopped at gpt-5/mini/nano
 * long after the registry had moved the ladder to the 5.4/5.5/5.6 generation.
 *
 * Auth: `OPENAI_API_KEY` from getSecret() or env. `OPENAI_BASE_URL` lets
 * tests / proxies / Azure deployments redirect without code changes
 * (default `https://api.openai.com/v1`).
 *
 * TWO API SHAPES, AND WHY EACH IS USED. Native OpenAI reasoning models (o-series,
 * every gpt-5 generation) take the Responses API (`/responses`): one typed
 * `output[]` array of items rather than `choices[]`, `max_output_tokens` rather
 * than `max_tokens`, NAMED streaming events (`response.output_text.delta`)
 * rather than unnamed data frames, and — the reason it is not merely a newer
 * spelling — a `reasoning.effort` knob and typed reasoning items that Chat
 * Completions has no field for. The current models serve BOTH shapes, so this is
 * a choice rather than a constraint, and it is made in favour of the shape that
 * can express what these models actually do.
 *
 * OpenAI-compatible providers and explicit base URL redirects (tests, proxies,
 * Azure, Groq, DeepSeek, LM Studio) keep the Chat Completions path, because
 * compatibility with THAT shape is the contract they serve — `/responses` is
 * OpenAI's own endpoint, not a standard those providers implement.
 */

import { getSecret } from '../../secret-env.js';
import { resolveReasoningEffort } from '../../model-registry.js';
import type { LLMCompletionRequest, LLMCompletionResult } from '../../llm-call.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Models that use Responses API on native OpenAI, or `max_completion_tokens`
 *  when an OpenAI-compatible Chat Completions endpoint is explicitly selected. */
const REASONING_MODEL_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];

function isReasoningModel(model: string): boolean {
  const lc = model.toLowerCase();
  return REASONING_MODEL_PREFIXES.some((p) => lc.startsWith(p));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textFromContentPart(part: unknown): string {
  if (typeof part === 'string') return part;
  if (!isObject(part)) return '';
  const text = part.text;
  if (typeof text === 'string') return text;
  const nestedText = part.output_text;
  return typeof nestedText === 'string' ? nestedText : '';
}

function extractOpenAIText(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string' && data.output_text) {
    return data.output_text;
  }

  const output = data.output;
  if (Array.isArray(output)) {
    const chunks: string[] = [];
    for (const item of output) {
      if (!isObject(item)) continue;
      if (item.type && item.type !== 'message') continue;
      const content = item.content;
      if (typeof content === 'string') {
        chunks.push(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          chunks.push(textFromContentPart(part));
        }
      }
    }
    const text = chunks.join('');
    if (text) return text;
  }

  const choices = data.choices as Array<{ message?: { content?: unknown }; text?: string }> | undefined;
  const chunks: string[] = [];
  for (const choice of choices ?? []) {
    const content = choice.message?.content;
    if (typeof content === 'string') {
      chunks.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        chunks.push(textFromContentPart(part));
      }
    } else if (typeof choice.text === 'string') {
      chunks.push(choice.text);
    }
  }
  return chunks.join('');
}

function extractOpenAIUsage(data: Record<string, unknown>): {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
} {
  const usage = data.usage as
    | {
      input_tokens?: number;
      output_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      prompt_tokens_details?: { cached_tokens?: number };
    }
    | undefined;

  return {
    inputTokens:
      typeof usage?.input_tokens === 'number'
        ? usage.input_tokens
        : typeof usage?.prompt_tokens === 'number'
          ? usage.prompt_tokens
          : undefined,
    outputTokens:
      typeof usage?.output_tokens === 'number'
        ? usage.output_tokens
        : typeof usage?.completion_tokens === 'number'
          ? usage.completion_tokens
          : undefined,
    cachedInputTokens:
      typeof usage?.input_tokens_details?.cached_tokens === 'number'
        ? usage.input_tokens_details.cached_tokens
        : typeof usage?.prompt_tokens_details?.cached_tokens === 'number'
          ? usage.prompt_tokens_details.cached_tokens
          : undefined,
  };
}

function noTextResponseError(data: Record<string, unknown>): string {
  const status = typeof data.status === 'string' ? data.status : '';
  const details = isObject(data.incomplete_details) ? data.incomplete_details : undefined;
  const reason = typeof details?.reason === 'string' ? details.reason : '';
  if (status === 'incomplete' && reason) {
    return `OpenAI returned no text response (response incomplete: ${reason})`;
  }
  return 'OpenAI returned no text response';
}

/**
 * Internal override for OpenAI-compatible providers (e.g. Groq) that
 * reuse this adapter. When supplied, `apiKey` / `baseUrl` win over the
 * OpenAI credential resolution — this avoids getSecret('OPENAI_API_KEY')
 * shadowing the provider's own key. `missingKeyError` lets the caller
 * surface a provider-specific "key not set" message.
 */
export interface OpenAICompatibleOverride {
  apiKey?: string;
  baseUrl?: string;
  missingKeyError?: string;
}

/**
 * Consume an OpenAI-shaped chat-completion event stream.
 *
 * The rationale for sharing it across every OpenAI-compatible backend (OpenAI,
 * Groq, DeepSeek, xAI, LM Studio): they emit the identical wire shape — which is the whole
 * reason those adapters delegate here rather than each carrying a copy. The
 * per-frame concerns that go subtly wrong when duplicated are the ones handled
 * here: frames split across network chunks, the `[DONE]` sentinel, and the
 * usage-only final chunk that `stream_options.include_usage` appends after the
 * content is finished.
 *
 * @param body The response body stream.
 * @param onTextDelta The caller's live sink.
 * @param signal Optional abort signal, checked between chunks.
 * @returns The same completion result shape a non-streamed call returns.
 */
async function readOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<LLMCompletionResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let raw = '';
  let frames = 0;
  let usage: Record<string, any> | undefined;

  const handleFrame = (payload: string): void => {
    try {
      const chunk = JSON.parse(payload) as Record<string, any>;
      if (chunk?.usage) usage = chunk.usage;
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        text += delta;
        try {
          onTextDelta(delta);
        } catch {
          // A caller's sink throwing is a UI problem, never a completion one.
        }
      }
    } catch {
      // Skip a malformed frame rather than losing the rest of the completion.
    }
  };

  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      buffer += chunk;
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          frames += 1;
          handleFrame(payload);
        }
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== '[DONE]') {
        frames += 1;
        handleFrame(payload);
      }
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    reader.releaseLock();
  }

  if (!text) {
    // Zero frames means the body was never an event stream, whatever the
    // content type claimed, so the provider's real error is written in it —
    // reporting "no text response" for a quota or auth failure sends an
    // operator hunting a model problem that does not exist.
    return {
      ok: false,
      error: errorFromNonStreamBody(raw, 'OpenAI stream returned no text response'),
    };
  }
  return {
    ok: true,
    text,
    inputTokens: normalizeStreamTokens(usage?.prompt_tokens),
    outputTokens: normalizeStreamTokens(usage?.completion_tokens),
    cachedInputTokens: normalizeStreamTokens(usage?.prompt_tokens_details?.cached_tokens),
  };
}

/**
 * Pull a provider's error out of a body that was NOT an event stream.
 *
 * WHY: a provider can answer with HTTP 200 and `content-type: text/event-stream`
 * and still send a plain JSON error object — Gemini does exactly this on a quota
 * failure, and there is no reason to assume the OpenAI-compatible fleet never
 * will. Every honest check passes, the SSE parser finds zero frames, and "no
 * text response" then hides the real cause behind a message that reads like a
 * model problem.
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
      const code = parsed?.error?.code ?? parsed?.error?.type;
      return code ? `${code}: ${message}` : message;
    }
  } catch {
    // Not JSON either; the truncated body still beats a generic "no response".
  }
  return `${fallback} (body: ${text.slice(0, 200)})`;
}

/**
 * Coerce a streamed usage number, keeping "absent" distinct from "zero".
 *
 * The distinction is load-bearing: the telemetry policy treats undefined as
 * unknown and refuses to invent a cost, while zero would assert a free call.
 *
 * @param value The raw usage field.
 * @returns The count, or undefined when the provider did not report one.
 */
function normalizeStreamTokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Is this response actually an event stream?
 *
 * The design rule this encodes: `stream: true` is a REQUEST, not a guarantee —
 * a gateway or a model that declines it answers with ordinary JSON, and parsing
 * that as SSE finds no frames and reports an empty completion for a run that in
 * fact succeeded.
 *
 * Deliberately defensive about `headers` itself being absent, not only about the
 * header: every test in this repo that exercises an API backend mocks `fetch`
 * with a hand-built object, and reading through a missing property would turn a
 * behavioural improvement into a crash in code that has nothing to do with it.
 *
 * @param res The provider response (possibly a test double).
 * @returns True when the body should be read as SSE.
 */
function isEventStreamResponse(res: Response): boolean {
  try {
    return (res.headers?.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
  } catch {
    return false;
  }
}

/**
 * Consume a Responses-API event stream (the GPT-5 / o-series shape).
 *
 * A different event vocabulary from chat completions, and the design difference
 * matters for one reason worth stating: the Responses stream interleaves REASONING
 * events with output-text events. Only `response.output_text.delta` is the
 * answer; streaming the reasoning events too would splice the model's
 * scratchpad into what the operator reads.
 *
 * @param body The response body stream.
 * @param onTextDelta The caller's live sink.
 * @param signal Optional abort signal, checked between chunks.
 * @returns The same completion result shape a non-streamed call returns.
 */
async function readResponsesStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<LLMCompletionResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let raw = '';
  let frames = 0;
  let usage: Record<string, any> | undefined;
  let errorMessage: string | null = null;

  const handleFrame = (payload: string): void => {
    try {
      const evt = JSON.parse(payload) as Record<string, any>;
      const type = evt?.type;
      if (type === 'response.output_text.delta') {
        const delta = evt?.delta;
        if (typeof delta === 'string' && delta) {
          text += delta;
          try {
            onTextDelta(delta);
          } catch {
            // A caller's sink throwing is a UI problem, never a completion one.
          }
        }
        return;
      }
      // The terminal event carries the totals; a failed/incomplete response
      // carries the reason, which must not be reported as an empty success.
      if (type === 'response.completed' || type === 'response.incomplete') {
        usage = evt?.response?.usage ?? usage;
        return;
      }
      if (type === 'response.failed' || type === 'error') {
        errorMessage =
          evt?.response?.error?.message
          ?? evt?.error?.message
          ?? evt?.message
          ?? 'OpenAI Responses stream failed';
      }
    } catch {
      // Skip a malformed frame rather than losing the rest of the completion.
    }
  };

  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      buffer += chunk;
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          frames += 1;
          handleFrame(payload);
        }
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== '[DONE]') {
        frames += 1;
        handleFrame(payload);
      }
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    reader.releaseLock();
  }

  if (errorMessage) return { ok: false, error: errorMessage };
  if (!text) {
    return {
      ok: false,
      error: errorFromNonStreamBody(raw, 'OpenAI Responses stream returned no text response'),
    };
  }
  return {
    ok: true,
    text,
    inputTokens: normalizeStreamTokens(usage?.input_tokens),
    outputTokens: normalizeStreamTokens(usage?.output_tokens),
    cachedInputTokens: normalizeStreamTokens(usage?.input_tokens_details?.cached_tokens),
  };
}

export const openaiAdapter = async (
  req: LLMCompletionRequest,
  override: OpenAICompatibleOverride = {},
): Promise<LLMCompletionResult> => {
  const e = req.env ?? process.env;
  const apiKey =
    override.apiKey
    || getSecret('OPENAI_API_KEY')
    || e.OPENAI_API_KEY
    || getSecret('OPENAI_KEY')
    || e.OPENAI_KEY;
  const baseUrl = (override.baseUrl || e.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  // An override caller (Groq) owns its own auth; never leak an OpenAI org
  // header into a third-party endpoint when an explicit base URL is set.
  const organization = override.baseUrl ? undefined : (e.OPENAI_ORG_ID || e.OPENAI_ORGANIZATION);

  if (!apiKey) {
    return { ok: false, error: override.missingKeyError || 'OPENAI_API_KEY is not set' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (organization) headers['OpenAI-Organization'] = organization;

  const hasExplicitBaseUrl = Boolean(override.baseUrl || e.OPENAI_BASE_URL);
  const useResponsesApi = isReasoningModel(req.model) && !hasExplicitBaseUrl;
  const responsesEffort = useResponsesApi
    ? resolveReasoningEffort(req.model, req.reasoningEffort)
    : undefined;
  const body: Record<string, unknown> = useResponsesApi
    ? {
      model: req.model,
      input: [{ role: 'user', content: req.prompt }],
      // Responses API caps count reasoning tokens against max_output_tokens, so
      // the effort rung is a real cost lever and Port Daddy's live smokes run on
      // tiny caps. It is resolved from the registry rather than hardcoded: the
      // accepted values differ PER MODEL, and the constant that used to sit here
      // ('minimal') is accepted by exactly one model in the current lineup. An
      // id this adapter has never seen resolves to undefined and the field is
      // omitted entirely — the API's own default is correct, and inventing a
      // value for an unknown model is a second guess on top of the first.
      ...(responsesEffort ? { reasoning: { effort: responsesEffort } } : {}),
      store: false,
      stream: Boolean(req.onTextDelta),
    }
    : {
      model: req.model,
      messages: [{ role: 'user', content: req.prompt }],
      // Stream only when a caller is listening: a streamed chat completion needs
      // `stream_options` to return usage at all, and usage is what the
      // fail-closed telemetry policy requires, so streaming is a real trade.
      stream: Boolean(req.onTextDelta),
      ...(req.onTextDelta ? { stream_options: { include_usage: true } } : {}),
    };
  if (typeof req.maxTokens === 'number' && req.maxTokens > 0) {
    if (useResponsesApi) {
      body.max_output_tokens = req.maxTokens;
    } else if (isReasoningModel(req.model)) {
      body.max_completion_tokens = req.maxTokens;
    } else {
      body.max_tokens = req.maxTokens;
    }
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/${useResponsesApi ? 'responses' : 'chat/completions'}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => 'unknown error');
    return { ok: false, error: `OpenAI HTTP ${res.status}: ${txt}` };
  }

  // Two streaming shapes, because OpenAI has two APIs and the whole GPT-5 family
  // routes through the Responses one — degrading THAT to batch would mean the
  // registry's entire openai ladder never streams, which is the opposite of the
  // point.
  // Only when the response ACTUALLY is an event stream: `stream: true` is a
  // request, not a guarantee, and parsing plain JSON as SSE finds no frames and
  // reports an empty completion for a run that succeeded.
  if (req.onTextDelta && res.body && isEventStreamResponse(res)) {
    return useResponsesApi
      ? await readResponsesStream(res.body, req.onTextDelta, req.signal)
      : await readOpenAIStream(res.body, req.onTextDelta, req.signal);
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: `OpenAI returned non-JSON response: ${(err as Error).message}` };
  }

  const text = extractOpenAIText(data);
  if (!text) {
    return { ok: false, error: noTextResponseError(data) };
  }

  const usage = extractOpenAIUsage(data);

  return {
    ok: true,
    text,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    raw: data,
  };
};

// ─── Supported model list ─────────────────────────────────────────────────────

export const SUPPORTED_OPENAI_MODELS = [
  // GPT-5 family
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  // GPT-4.1 family
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  // GPT-4o family
  'gpt-4o',
  'gpt-4o-mini',
  // o-series reasoning
  'o4-mini',
  'o3',
  'o1',
] as const;

export type SupportedOpenAIModel = (typeof SUPPORTED_OPENAI_MODELS)[number];

export const DEFAULT_OPENAI_MODEL: SupportedOpenAIModel = 'gpt-5-mini';

/** Per-spawn budget cap. Defensive default — operators can override via
 *  the fleet schema's `per_spawn_budget_usd_cap`. */
export const DEFAULT_OPENAI_PER_SPAWN_BUDGET_USD = 0.10;

/** Per-spawn timeout (ms). Default 5 minutes per task spec. */
export const DEFAULT_OPENAI_TIMEOUT_MS = 5 * 60 * 1000;
