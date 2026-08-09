/**
 * LM Studio backend — first-class spawner backend (local, no API key).
 *
 * LM Studio runs an **OpenAI-compatible** Chat Completions API on the
 * operator's machine (`http://localhost:1234/v1` by default, chat at
 * `/v1/chat/completions`). It serves whatever model is currently loaded in
 * the app; `GET /v1/models` reports that loaded model id. Because the wire
 * format is identical to OpenAI's, this module *reuses* the OpenAI adapter
 * (exactly like `groq.ts`) with a base-url override and a placeholder key.
 *
 * Auth: NONE. LM Studio's local server does not require an API key. The
 * OpenAI adapter insists on a non-empty `apiKey` (it short-circuits with a
 * "key not set" error otherwise), so we hand it a harmless placeholder
 * (`'lm-studio'`) that LM Studio simply ignores. The `Authorization` header
 * carrying that placeholder is a no-op for the local server.
 *
 * Cost: $0 — inference runs on local hardware. The spawner's outer wrapper
 * records this as a free local backend (see lib/cost-tracker.ts).
 *
 * Server may be OFF. When it is, the underlying fetch fails and the adapter
 * returns `{ ok: false, error }` (no throw); readiness (lib/backend-readiness.ts)
 * surfaces the "Start the LM Studio local server" next step before launch.
 *
 * Base URL override: `LMSTUDIO_API_BASE` (or `LMSTUDIO_BASE_URL`) env, else
 * the default below.
 */

import type { LLMCompletionRequest, LLMCompletionResult } from '../../llm-call.js';
import { openaiAdapter } from './openai.js';
import { resolveModel } from '../../model-registry.js';

export const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';

/**
 * Placeholder auth token. LM Studio's local server ignores it; it only exists
 * to satisfy the OpenAI adapter's non-empty-key guard. Never a real secret.
 */
const LMSTUDIO_PLACEHOLDER_KEY = 'lm-studio';

/**
 * LM Studio adapter. Delegates to the OpenAI adapter with LM Studio's local
 * base URL and a placeholder key injected via the override. Returns
 * `ok: false` with an explanatory error (no throw) when the local server is
 * unreachable.
 */
export const lmstudioAdapter = async (
  req: LLMCompletionRequest,
): Promise<LLMCompletionResult> => {
  const e = req.env ?? process.env;
  const baseUrl = e.LMSTUDIO_API_BASE || e.LMSTUDIO_BASE_URL || LMSTUDIO_DEFAULT_BASE_URL;

  return openaiAdapter(req, {
    apiKey: LMSTUDIO_PLACEHOLDER_KEY,
    baseUrl,
    missingKeyError:
      'LM Studio local server is not reachable. Start it (Developer → Start Server) and load a model.',
  });
};

// ─── Default model ────────────────────────────────────────────────────────────
// LM Studio serves whatever model is loaded in the app, so the concrete id is
// resolved at runtime. `'local-model'` is the conventional placeholder; the
// loaded model's real id is reported by `GET /v1/models`. The operator's
// intended prime here is Qwen 3 Next Coder. Routed through the registry
// (lib/model-registry-data.ts lmstudio table) so this placeholder has one
// canonical home instead of being hand-duplicated per call site.
export const DEFAULT_LMSTUDIO_MODEL = resolveModel({ backend: 'lmstudio', capability: 'cheap' });

/** Per-spawn timeout (ms). Default 5 minutes, matching other backends. */
export const DEFAULT_LMSTUDIO_TIMEOUT_MS = 5 * 60 * 1000;
