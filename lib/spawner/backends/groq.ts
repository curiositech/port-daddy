/**
 * Groq backend — first-class spawner backend.
 *
 * Groq serves open-weight models (Llama, OpenAI GPT-OSS, Kimi) on custom
 * LPU hardware behind an **OpenAI-compatible** Chat Completions API. That
 * means the wire format is identical to `lib/spawner/backends/openai.ts`:
 * `POST {base}/chat/completions` with `{ model, messages }` and a
 * `usage: { prompt_tokens, completion_tokens }` block on the response.
 *
 * Rather than duplicate the OpenAI adapter, this module *reuses* it with a
 * base-url + api-key override (`GROQ_API_BASE` default
 * `https://api.groq.com/openai/v1`, key `GROQ_API_KEY`). The spawner's outer
 * wrapper handles cost recording, telemetry policy, coordination, and bond
 * escrow — this module is HTTP-only.
 *
 * Auth: `GROQ_API_KEY` from getSecret() (encrypted keychain) or env.
 * The daemon resolves the key through lib/secret-env.getSecret, so the
 * canonical operator action is `pd secret set GROQ_API_KEY`.
 */

import { getSecret } from '../../secret-env.js';
import type { LLMCompletionRequest, LLMCompletionResult } from '../../llm-call.js';
import { openaiAdapter } from './openai.js';

export const GROQ_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Groq adapter. Delegates to the OpenAI adapter with Groq's base URL and
 * API key injected via the `env` override. Reads creds from getSecret()
 * first (encrypted managed store), falls back to process.env. Returns
 * `ok: false` with explanatory error when the key is missing — no throw.
 */
export const groqAdapter = async (
  req: LLMCompletionRequest,
): Promise<LLMCompletionResult> => {
  const e = req.env ?? process.env;
  const apiKey = getSecret('GROQ_API_KEY') || e.GROQ_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'GROQ_API_KEY is not set. Run: pd secret set GROQ_API_KEY' };
  }

  const baseUrl = e.GROQ_API_BASE || e.GROQ_BASE_URL || GROQ_DEFAULT_BASE_URL;

  // Reuse the OpenAI adapter via an explicit credential override. Passing
  // apiKey/baseUrl directly (rather than through env) ensures the OpenAI
  // adapter's getSecret('OPENAI_API_KEY') lookup can't shadow the Groq key —
  // a real bug we hit when both keys are present in the daemon's secret cache.
  return openaiAdapter(req, {
    apiKey,
    baseUrl,
    missingKeyError: 'GROQ_API_KEY is not set. Run: pd secret set GROQ_API_KEY',
  });
};

// ─── Supported model list (Groq production text/chat models, 2026-06) ─────────
// Source: https://console.groq.com/docs/models
export const SUPPORTED_GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'moonshotai/kimi-k2-instruct',
] as const;

export type SupportedGroqModel = (typeof SUPPORTED_GROQ_MODELS)[number];

export const DEFAULT_GROQ_MODEL: SupportedGroqModel = 'llama-3.3-70b-versatile';

/** Per-spawn timeout (ms). Default 5 minutes, matching other remote backends. */
export const DEFAULT_GROQ_TIMEOUT_MS = 5 * 60 * 1000;
