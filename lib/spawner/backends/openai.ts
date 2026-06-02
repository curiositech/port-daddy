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
 * The wire format is the Chat Completions API (`/chat/completions`).
 * Reasoning models (o-series, gpt-5) accept `max_completion_tokens`
 * instead of `max_tokens`; the adapter sets both — OpenAI ignores the
 * irrelevant one per the API contract.
 */

import { getSecret } from '../../secret-env.js';
import type { LLMCompletionRequest, LLMCompletionResult } from '../../llm-call.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Models that route via the responses/reasoning path. They accept
 *  `max_completion_tokens` and ignore `max_tokens`. The Chat Completions
 *  endpoint still accepts them; we just need to send the right field. */
const REASONING_MODEL_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];

function isReasoningModel(model: string): boolean {
  const lc = model.toLowerCase();
  return REASONING_MODEL_PREFIXES.some((p) => lc.startsWith(p));
}

export const openaiAdapter = async (
  req: LLMCompletionRequest,
): Promise<LLMCompletionResult> => {
  const e = req.env ?? process.env;
  const apiKey =
    getSecret('OPENAI_API_KEY')
    || e.OPENAI_API_KEY
    || getSecret('OPENAI_KEY')
    || e.OPENAI_KEY;
  const baseUrl = (e.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const organization = e.OPENAI_ORG_ID || e.OPENAI_ORGANIZATION;

  if (!apiKey) {
    return { ok: false, error: 'OPENAI_API_KEY is not set' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (organization) headers['OpenAI-Organization'] = organization;

  const body: Record<string, unknown> = {
    model: req.model,
    messages: [{ role: 'user', content: req.prompt }],
    stream: false,
  };
  // Reasoning models reject `max_tokens`; chat models reject
  // `max_completion_tokens` on older endpoints. Send the appropriate
  // field; OpenAI's API accepts the right one for each family.
  if (typeof req.maxTokens === 'number' && req.maxTokens > 0) {
    if (isReasoningModel(req.model)) {
      body.max_completion_tokens = req.maxTokens;
    } else {
      body.max_tokens = req.maxTokens;
    }
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
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

  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  const text = choices?.[0]?.message?.content ?? '';
  if (!text) {
    return { ok: false, error: 'OpenAI returned no text response' };
  }

  const usage = data.usage as
    | { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
    | undefined;

  return {
    ok: true,
    text,
    inputTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    cachedInputTokens:
      typeof usage?.prompt_tokens_details?.cached_tokens === 'number'
        ? usage.prompt_tokens_details.cached_tokens
        : undefined,
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
