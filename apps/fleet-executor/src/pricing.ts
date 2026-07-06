/**
 * Workers AI cost derivation for the cloud fleet.
 *
 * The executor reviews PRs on Cloudflare Workers AI. Each `env.AI.run(...)`
 * returns a `usage` block (prompt/completion tokens); this module turns those
 * token counts + the model id into a USD figure so `fleet_runs` carries real
 * spend instead of a reserved-null `neurons` stub.
 *
 * Rates mirror the daemon's authoritative table (lib/cost-tracker.ts MODEL_RATES,
 * Cloudflare Workers AI rows) so the relay/pd-console cost and the daemon cost
 * agree. Rates are USD per 1,000,000 tokens. When a model has no known rate the
 * cost is `null` (binder ch09 cost model: "unknown values stay null, never
 * guessed") — the token counts are still recorded, so cost can be back-derived
 * later once the rate is known.
 *
 * Keep this table in sync with lib/cost-tracker.ts when a Workers AI model id or
 * its price changes. This is deliberately a small, self-contained duplicate: a
 * Cloudflare Worker cannot import the daemon's Node-only lib, and the alternative
 * (record tokens only, derive cost on the daemon) leaves the relay's own Cloud
 * Fleet pane costless.
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
  '@cf/zai-org/glm-4.7-flash': { input: 0.06, output: 0.4 },
  '@cf/nvidia/nemotron-3-120b-a12b': { input: 0.5, output: 1.5 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { input: 0.27, output: 0.85 },
  '@cf/meta/llama-3.1-8b-instruct': { input: 0.282, output: 0.827 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 0.293, output: 2.253 },
  '@cf/meta/llama-3.1-70b-instruct-fp8-fast': { input: 0.293, output: 2.253 },
  '@cf/moonshotai/kimi-k2-instruct': { input: 0.95, output: 4.0 },
};

/** True when we have a rate for this model id (so cost is real, not guessed). */
export function isPricedModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKERS_AI_RATES, model);
}

/**
 * Cost in USD for one model's token spend, or `null` when the model has no
 * known rate. `inputTokens`/`outputTokens` are the summed prompt/completion
 * tokens for every call made against that model.
 */
export function costForModel(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const rate = WORKERS_AI_RATES[model];
  if (!rate) return null;
  const usd = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  // Round to 6 decimals — sub-cent Workers AI costs must not vanish to 0.
  return Math.round(usd * 1e6) / 1e6;
}
