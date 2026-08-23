/**
 * Workers AI spend derivation for the cloud fleet (ADR-0116/0117).
 *
 * Each `env.AI.run(...)` returns a `usage` block; the executor sums those tokens
 * per ship ({@link ShipMetrics}) and this module turns the token counts + the
 * model id into a USD figure so one `fleet_run_spend` row per ship carries real
 * spend. A model with no known rate contributes 0 — the token counts are still
 * recorded, so cost can be back-derived once a rate is known (`cost_usd` is NOT
 * NULL DEFAULT 0 in the D1 contract, never guessed up).
 *
 * The rate and context tables below are DERIVED from config/models.yaml rather
 * than hand-maintained here. This file used to end with "keep this table in
 * sync with fleet.ts" — an instruction, which is what a repo writes down
 * instead of an invariant, and which had already failed by the time it was
 * read: price, context window, and selectability were three independent facts
 * about one model, so any of them could be right while the others were not.
 */

import { CF_PRICES, CF_CONTEXT_WINDOWS } from '../../shared/model-registry.generated.js';

export interface WorkersAiRate {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
}

/**
 * Cloudflare Workers AI rates, keyed by exact `@cf/...` model id.
 *
 * DERIVED (supplant, 2026-08-23) from config/models.yaml. This table used to be
 * hand-maintained beside the model constants it priced, with a comment asking
 * the next editor to keep the two in sync — and they diverged, which meant the
 * spend meter could silently price a run at another model's rate. Now a model
 * cannot be selectable without being priced, because both facts are the same
 * catalog row.
 */
export const WORKERS_AI_RATES: Record<string, WorkersAiRate> = CF_PRICES;

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
 * DERIVED (supplant, 2026-08-23) from config/models.yaml, for the same reason
 * as the rate table above: a model the executor can select but has no window
 * for degrades to a floor budget silently, which is how a stronger model with
 * four times the context ended up chunked as if it were the old one.
 *
 * Source: developers.cloudflare.com/workers-ai/models/<id>, recorded per row.
 */
export const MODEL_CONTEXT_TOKENS: Record<string, number> = CF_CONTEXT_WINDOWS;

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
