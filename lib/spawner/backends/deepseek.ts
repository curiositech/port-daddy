/**
 * DeepSeek backend — first-class spawner backend.
 *
 * DeepSeek serves its V3 (`deepseek-chat`) and R1 (`deepseek-reasoner`) models
 * behind an **OpenAI-compatible** Chat Completions API. The wire format is
 * identical to `lib/spawner/backends/openai.ts`: `POST {base}/chat/completions`
 * with `{ model, messages }` and a `usage: { prompt_tokens, completion_tokens }`
 * block on the response.
 *
 * Rather than duplicate the OpenAI adapter, this module *reuses* it with a
 * base-url + api-key override (`DEEPSEEK_API_BASE` default
 * `https://api.deepseek.com/v1`, key `DEEPSEEK_API_KEY`). The spawner's outer
 * wrapper handles cost recording, telemetry policy, coordination, and bond
 * escrow — this module is HTTP-only. (Mirrors `groq.ts`.)
 *
 * Auth: `DEEPSEEK_API_KEY` (sk-…) from getSecret() (encrypted keychain) or env.
 * The daemon resolves the key through lib/secret-env.getSecret, so the
 * canonical operator action is `pd secret set DEEPSEEK_API_KEY`.
 */

import { getSecret } from '../../secret-env.js';
import type { LLMCompletionRequest, LLMCompletionResult } from '../../llm-call.js';
import { openaiAdapter } from './openai.js';

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

/**
 * DeepSeek adapter. Delegates to the OpenAI adapter with DeepSeek's base URL
 * and API key injected via the `env` override. Reads creds from getSecret()
 * first (encrypted managed store), falls back to process.env. Returns
 * `ok: false` with explanatory error when the key is missing — no throw.
 */
export const deepseekAdapter = async (
  req: LLMCompletionRequest,
): Promise<LLMCompletionResult> => {
  const e = req.env ?? process.env;
  const apiKey = getSecret('DEEPSEEK_API_KEY') || e.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'DEEPSEEK_API_KEY is not set. Run: pd secret set DEEPSEEK_API_KEY' };
  }

  const baseUrl = e.DEEPSEEK_API_BASE || e.DEEPSEEK_BASE_URL || DEEPSEEK_DEFAULT_BASE_URL;

  // Reuse the OpenAI adapter via an explicit credential override. Passing
  // apiKey/baseUrl directly (rather than through env) ensures the OpenAI
  // adapter's getSecret('OPENAI_API_KEY') lookup can't shadow the DeepSeek
  // key — the same shadowing bug groq.ts guards against when both keys are
  // present in the daemon's secret cache.
  return openaiAdapter(req, {
    apiKey,
    baseUrl,
    missingKeyError: 'DEEPSEEK_API_KEY is not set. Run: pd secret set DEEPSEEK_API_KEY',
  });
};

// ─── Supported model list (DeepSeek production text/chat models, 2026-06) ─────
// Source: https://api-docs.deepseek.com/quick_start/pricing
//   - deepseek-chat     → DeepSeek-V3 (general + coder)
//   - deepseek-reasoner → DeepSeek-R1 (reasoning)
export const SUPPORTED_DEEPSEEK_MODELS = [
  'deepseek-chat',
  'deepseek-reasoner',
] as const;

export type SupportedDeepseekModel = (typeof SUPPORTED_DEEPSEEK_MODELS)[number];

export const DEFAULT_DEEPSEEK_MODEL: SupportedDeepseekModel = 'deepseek-chat';

/** Per-spawn timeout (ms). Default 5 minutes, matching other remote backends. */
export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 5 * 60 * 1000;
