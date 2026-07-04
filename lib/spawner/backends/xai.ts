/**
 * xAI (Grok) backend — first-class spawner backend.
 *
 * xAI serves its Grok models behind an **OpenAI-compatible** Chat Completions
 * API. The wire format is identical to `lib/spawner/backends/openai.ts`:
 * `POST {base}/chat/completions` with `{ model, messages }` and a
 * `usage: { prompt_tokens, completion_tokens }` block on the response.
 *
 * Rather than duplicate the OpenAI adapter, this module *reuses* it with a
 * base-url + api-key override (`XAI_API_BASE` default `https://api.x.ai/v1`,
 * key `XAI_API_KEY`). The spawner's outer wrapper handles cost recording,
 * telemetry policy, coordination, and bond escrow — this module is HTTP-only.
 * (Mirrors `groq.ts` / `deepseek.ts`.)
 *
 * Auth: `XAI_API_KEY` from getSecret() (encrypted keychain) or env. The daemon
 * resolves the key through lib/secret-env.getSecret, so the canonical operator
 * action is `pd secret set XAI_API_KEY`.
 */

import { getSecret } from '../../secret-env.js';
import type { LLMCompletionRequest, LLMCompletionResult } from '../../llm-call.js';
import { openaiAdapter } from './openai.js';

export const XAI_DEFAULT_BASE_URL = 'https://api.x.ai/v1';

/**
 * xAI adapter. Delegates to the OpenAI adapter with xAI's base URL and API key
 * injected via the `env` override. Reads creds from getSecret() first
 * (encrypted managed store), falls back to process.env. Returns `ok: false`
 * with explanatory error when the key is missing — no throw.
 */
export const xaiAdapter = async (
  req: LLMCompletionRequest,
): Promise<LLMCompletionResult> => {
  const e = req.env ?? process.env;
  const apiKey = getSecret('XAI_API_KEY') || e.XAI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'XAI_API_KEY is not set. Run: pd secret set XAI_API_KEY' };
  }

  const baseUrl = e.XAI_API_BASE || e.XAI_BASE_URL || XAI_DEFAULT_BASE_URL;

  // Reuse the OpenAI adapter via an explicit credential override. Passing
  // apiKey/baseUrl directly (rather than through env) ensures the OpenAI
  // adapter's getSecret('OPENAI_API_KEY') lookup can't shadow the xAI key —
  // the same shadowing bug groq.ts/deepseek.ts guard against when multiple
  // keys are present in the daemon's secret cache.
  return openaiAdapter(req, {
    apiKey,
    baseUrl,
    missingKeyError: 'XAI_API_KEY is not set. Run: pd secret set XAI_API_KEY',
  });
};

// ─── Supported model list (xAI production text/chat models, 2026-06) ──────────
// Source: https://docs.x.ai/docs/models
//   - grok-2-latest      → general-purpose Grok 2
//   - grok-code-fast-1   → fast, cheap coder model
//   - grok-3             → flagship reasoning model
export const SUPPORTED_XAI_MODELS = [
  'grok-2-latest',
  'grok-code-fast-1',
  'grok-3',
] as const;

export type SupportedXaiModel = (typeof SUPPORTED_XAI_MODELS)[number];

// Default mirrors the model-tiers.json `low` tier (grok-code-fast-1), which is
// the priced DEFAULT_OPERATOR_XAI_MODEL the telemetry gate falls back to.
export const DEFAULT_XAI_MODEL: SupportedXaiModel = 'grok-code-fast-1';

/** Per-spawn timeout (ms). Default 5 minutes, matching other remote backends. */
export const DEFAULT_XAI_TIMEOUT_MS = 5 * 60 * 1000;
