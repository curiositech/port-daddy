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

/** Cloudflare Workers AI rates, keyed by exact `@cf/...` model id. */
export const WORKERS_AI_RATES: Record<string, WorkersAiRate> = {
  '@cf/openai/gpt-oss-120b': { input: 0.35, output: 0.75 },
  '@cf/qwen/qwen3-30b-a3b-fp8': { input: 0.051, output: 0.335 },
};

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
