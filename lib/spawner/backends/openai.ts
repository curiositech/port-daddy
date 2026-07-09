/**
 * OpenAI backend — first-class spawner backend.
 *
 * Mirrors the cloudflare backend's shape: a single HTTP adapter that
 * returns `LLMCompletionResult` (ok / text / token counts / error). The
 * spawner's outer wrapper handles cost recording, telemetry policy,
 * coordination, and bond escrow — this module is HTTP-only.
 *
 * Supported model families:
 *   - GPT-5: gpt-5, gpt-5-mini, gpt-5-nano
 *   - GPT-4.1: gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
 *   - GPT-4o: gpt-4o, gpt-4o-mini
 *   - Reasoning: o4-mini, o3, o1
 *
 * Auth: `OPENAI_API_KEY` from getSecret() or env. `OPENAI_BASE_URL` lets
 * tests / proxies / Azure deployments redirect without code changes
 * (default `https://api.openai.com/v1`).
 *
 * Native OpenAI reasoning models (o-series, gpt-5) use the Responses API
 * (`/responses`) with `max_output_tokens`. OpenAI-compatible providers and
 * explicit base URL redirects (tests, proxies, Azure, Groq, DeepSeek, LM Studio,
 * etc.) keep the Chat Completions path because that is the compatibility
 * contract they serve.
 */

import { getSecret } from '../../secret-env.js';
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
  const body: Record<string, unknown> = useResponsesApi
    ? {
      model: req.model,
      input: [{ role: 'user', content: req.prompt }],
      // Port Daddy's live transcript smokes use tiny caps for cost control.
      // Responses API caps include reasoning tokens, so keep default effort
      // minimal unless a future request shape exposes an explicit knob.
      reasoning: { effort: 'minimal' },
      store: false,
    }
    : {
      model: req.model,
      messages: [{ role: 'user', content: req.prompt }],
      stream: false,
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
