/**
 * Workers AI spend derivation for the cloud fleet (ADR-0116/0117).
 *
 * Each `env.AI.run(...)` returns a `usage` block; the executor sums those tokens
 * per ship ({@link ShipMetrics}) and this module turns the token counts + the
 * model id into a USD figure so one `fleet_run_spend` row per ship carries real
 * spend. Rates mirror the two Workers AI models the fleet actually routes to
 * (the ROLE-based `deriveCfModel` in fleet.ts): the code-review bot on
 * gpt-oss-120b ($0.35/$0.75 per M tok) and every other ship on qwen3-30b
 * ($0.051/$0.335 per M tok). A model with no known rate contributes 0 — the
 * token counts are still recorded, so cost can be back-derived once a rate is
 * known (`cost_usd` is NOT NULL DEFAULT 0 in the D1 contract, never guessed up).
 *
 * Keep this table in sync with fleet.ts's REVIEW_BOT_CF_MODEL / CHEAP_CF_MODEL
 * rate comments if a Workers AI model id or its price changes.
 */

export interface WorkersAiRate {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
}

/**
 * Cloudflare Workers AI rates, keyed by exact `@cf/...` model id.
 *
 * Every id in fleet.ts's KNOWN_GOOD_CF_MODELS must have a row here (admission
 * contract; map-reduce-invariants.test.ts enforces it) — an honored model
 * without a rate meters $0, which is how the purser's gpt-oss-20b author
 * calls rode invisibly for a week. Rates verified against
 * developers.cloudflare.com/workers-ai/platform/pricing on 2026-08-22.
 */
export const WORKERS_AI_RATES: Record<string, WorkersAiRate> = {
  '@cf/openai/gpt-oss-120b': { input: 0.35, output: 0.75 },
  '@cf/openai/gpt-oss-20b': { input: 0.2, output: 0.3 },
  '@cf/qwen/qwen3-30b-a3b-fp8': { input: 0.051, output: 0.335 },
  '@cf/moonshotai/kimi-k2.7-code': { input: 0.95, output: 4.0 },
};

/**
 * Context window per model, in TOKENS, as published by Cloudflare.
 *
 * Here rather than in a comment because the MAP chunk budget is DERIVED from it
 * (see mapChunkCharLimit in execute.ts). The budget used to be a bare
 * `const MAP_CHUNK_CHAR_LIMIT = 12_000` with no recorded reasoning anywhere in
 * the source -- about 3,000 tokens, which is 9% of the cheap model's window and
 * 2% of the capable one's. Every diff over 12KB was therefore split for no
 * reason any model imposed, and each resulting reviewer got a partial view it
 * could not know was partial. That is where fabricated "X is missing" findings
 * come from; the prompt-level scope contract mitigates a wound we inflicted.
 *
 * A number nobody can justify is a number nobody can correct. Deriving the
 * budget from these means changing the MAP model changes the budget, and the
 * invariants suite fails if a model is used without an entry here.
 *
 * Source: developers.cloudflare.com/workers-ai/models/<id> (verified 2026-08-06).
 */
export const MODEL_CONTEXT_TOKENS: Record<string, number> = {
  '@cf/openai/gpt-oss-120b': 128_000,
  '@cf/openai/gpt-oss-20b': 128_000,
  '@cf/qwen/qwen3-30b-a3b-fp8': 32_768,
  // 262.1k per the model catalog (developers.cloudflare.com/ai/models,
  // snapshot 2026-08-12 in the internal skill's cloudflare-model-roster).
  '@cf/moonshotai/kimi-k2.7-code': 262_144,
};

/**
 * True when this model's context window is known, so a budget derived from it
 * is a real bound rather than a guess.
 *
 * @param model Workers AI model id
 * @returns whether {@link MODEL_CONTEXT_TOKENS} has an entry
 */
export function hasKnownContextWindow(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_CONTEXT_TOKENS, model);
}

/** True when we have a rate for this model id (so cost is real, not guessed). */
export function isPricedModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKERS_AI_RATES, model);
}

/**
 * USD cost for a model's token spend. An unpriced model yields 0 (the tokens are
 * still recorded on the row). Rounded to 6 decimals so sub-cent Workers AI costs
 * never vanish to 0 while priced.
 */
export function costUsdForModel(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = WORKERS_AI_RATES[model];
  if (!rate) return 0;
  const usd = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return Math.round(usd * 1e6) / 1e6;
}
