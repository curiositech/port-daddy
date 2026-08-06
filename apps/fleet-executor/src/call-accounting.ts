/**
 * Per-AI-CALL accounting: model id + token usage + USD cost for exactly ONE
 * `env.AI.run(...)` result.
 *
 * Before this module, token usage was only ever ACCUMULATED across a ship's
 * whole run (execute.ts's `ShipMetrics` / `accumulateUsage`) and cost was only
 * derived once, at the ship level, in the `ship-spend` transcript step. That
 * answers "what did this ship cost in total" but not "what did THIS map chunk /
 * reduce / purser call cost, on which model" — the per-call detail the fleet
 * run page needs to make MAP/REDUCE/purser calls individually browsable.
 *
 * {@link perCallAccounting} is a pure, side-effect-free read of one `ai.run`
 * result; it does not replace `accumulateUsage` (which still owns the running
 * ShipMetrics totals) — callers use both: fold into the ship's cumulative
 * metrics AND stamp this call's own numbers onto its own transcript step.
 */

import { extractWorkersAiUsage } from './telemetry.js';
import { costUsdForModel, isPricedModel } from './spend.js';

export interface CallAccounting {
  model: string;
  /**
   * True iff the model actually returned a `usage` block. False ⇒ the token/
   * cost fields below are OMITTED (never zeroed) — a run page or caller must
   * render "not reported", never a 0 that reads as "this call was free" (the
   * 2026-08-04 green-theater invariant, extended to the per-call level).
   */
  usageReported: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  /**
   * USD cost for this ONE call, at `model`'s rate.
   *
   * OMITTED in both cases where the number would not be true: when the model
   * reported no usage, and when the model has no published rate. The second is
   * the subtler one -- costUsdForModel returns 0 for an unpriced model, so
   * stamping it would make an unpriced call indistinguishable from a genuinely
   * free one on a page whose whole job is to be believed.
   */
  costUsd?: number;
  /**
   * True when the model has no entry in WORKERS_AI_RATES. Tokens are still
   * recorded and correct; only the cost is unknowable. Present so a reader can
   * tell "we do not know what this cost" from "this cost nothing" -- an absent
   * `costUsd` alone cannot distinguish the two.
   */
  unpricedModel?: boolean;
}

/** Derive one call's accounting from its raw Workers AI result. Never throws. */
export function perCallAccounting(model: string, res: unknown): CallAccounting {
  const u = extractWorkersAiUsage(res);
  const usageReported = u.inputTokens != null || u.outputTokens != null;
  if (!usageReported) return { model, usageReported };
  const inputTokens = u.inputTokens ?? 0;
  const outputTokens = u.outputTokens ?? 0;
  const priced = isPricedModel(model);
  return {
    model,
    usageReported,
    inputTokens,
    outputTokens,
    cachedInputTokens: u.cachedInputTokens ?? 0,
    // Cost only when it can be true. See CallAccounting.costUsd.
    ...(priced
      ? { costUsd: costUsdForModel(model, inputTokens, outputTokens) }
      : { unpricedModel: true }),
  };
}
