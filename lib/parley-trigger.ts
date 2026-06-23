/**
 * Parley trigger (RCP-2a) — the entry gate of the parley protocol (ADR-0086).
 *
 * A parley is expensive; convening on every flicker of disagreement burns the
 * parallelism it was meant to protect (the MAS-overhead Goodhart the realism
 * check warns about). So the decision to convene is a **signal-detection**
 * problem with asymmetric costs — the same SDT spine as the operator's
 * force-zoom threshold (Ledger RQ-7). Port windags' economic gate:
 *
 *     convene  ⇔  P(fail) · waste · |unresolved|  >  parleyCost
 *
 * The signal comes from the RCP-14 argument graph (`lib/discourse-lineage.ts`):
 * a non-empty `unresolvedContradictions` is "two agents disagree and nobody has
 * reconciled it." This module is pure — it reads a `ThreadDigest` + a cost model
 * and returns a decision. It does NOT convene anything; the daemon-side convener
 * (ADR-0086, unbuilt) consumes this, and `pd tube --lineage` surfaces it as a
 * recommendation.
 *
 * Scope note: this fires the CONTRADICTION shape (debate-with-judge). The
 * DUPLICATION shape (Contract-Net) needs the convergence detector (RCP-1,
 * unbuilt) to supply an overlap signal, so it is out of scope here.
 */

import type { ThreadDigest } from './discourse-lineage.js';

export type ParleyShape = 'debate-with-judge';

export interface ParleyCosts {
  /** Downstream waste if one unresolved conflict ships (USD or any consistent unit). */
  wastePerUnresolved: number;
  /** Cost of convening + running the parley, in the SAME unit as waste. */
  parleyCost: number;
  /**
   * P(an unresolved contradiction actually causes downstream failure) in [0,1].
   * Defaults to 1 — an unresolved contradiction is, by construction, a real
   * divergence; callers with a calibrated model should pass their own.
   */
  pFail?: number;
}

export interface ParleyLimits {
  /** Parley rounds already run on this thread (loop guard). Default 0. */
  priorRounds?: number;
  /** Max rounds before refusing to re-convene (ADR-0086: 2). */
  maxRounds?: number;
  /** Depth of the envelope `delegationChain` (ping-pong / upward-delegation guard). Default 0. */
  delegationDepth?: number;
  /** Max delegation depth before refusing (ADR-0086 default 4). */
  maxDelegationDepth?: number;
}

export type ParleyTermination = 'max-rounds' | 'delegation-depth';

export interface ParleyDecision {
  convene: boolean;
  /** The protocol shape to run when `convene` is true. */
  shape?: ParleyShape;
  /** Number of unresolved contradictions driving the decision. */
  unresolved: number;
  /** P(fail) · waste · unresolved. */
  expectedWaste: number;
  /** expectedWaste − parleyCost. Positive ⇒ convening is worth it. */
  margin: number;
  /** Set when a hard limit refused the parley regardless of economics. */
  terminated: ParleyTermination | null;
  /** One-line human-readable rationale. */
  reason: string;
}

const DEFAULT_MAX_ROUNDS = 2;
const DEFAULT_MAX_DELEGATION_DEPTH = 4;

function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 1;
  return Math.min(1, Math.max(0, p));
}

/**
 * Decide whether to convene a parley for one conversation thread.
 *
 * Termination (hard limits) is checked FIRST — an over-budget or looping thread
 * must not re-convene even when the economics say yes (ADR-0086 §5).
 */
export function shouldConvene(
  digest: ThreadDigest,
  costs: ParleyCosts,
  limits: ParleyLimits = {},
): ParleyDecision {
  const unresolved = digest.unresolvedContradictions.length;
  const pFail = clampProb(costs.pFail ?? 1);
  const expectedWaste = pFail * costs.wastePerUnresolved * unresolved;
  const margin = expectedWaste - costs.parleyCost;

  const base = { unresolved, expectedWaste, margin };

  // 1. Hard termination — loop / budget guards beat the economics.
  const maxRounds = limits.maxRounds ?? DEFAULT_MAX_ROUNDS;
  if ((limits.priorRounds ?? 0) >= maxRounds) {
    return { ...base, convene: false, terminated: 'max-rounds',
      reason: `already ran ${limits.priorRounds} parley round(s) (max ${maxRounds}) — escalate to the operator instead` };
  }
  const maxDepth = limits.maxDelegationDepth ?? DEFAULT_MAX_DELEGATION_DEPTH;
  if ((limits.delegationDepth ?? 0) > maxDepth) {
    return { ...base, convene: false, terminated: 'delegation-depth',
      reason: `delegation depth ${limits.delegationDepth} exceeds ${maxDepth} — likely ping-pong; escalate instead` };
  }

  // 2. Signal: no unresolved contradiction ⇒ nothing to convene about.
  if (unresolved === 0) {
    return { ...base, convene: false, terminated: null,
      reason: 'no unresolved contradictions — let informal parallel work continue' };
  }

  // 3. Economics: convene only when expected waste clears the parley's cost.
  if (margin > 0) {
    return { ...base, convene: true, shape: 'debate-with-judge', terminated: null,
      reason: `expected waste ${expectedWaste.toFixed(2)} > parley cost ${costs.parleyCost.toFixed(2)} across ${unresolved} unresolved contradiction(s)` };
  }
  return { ...base, convene: false, terminated: null,
    reason: `expected waste ${expectedWaste.toFixed(2)} ≤ parley cost ${costs.parleyCost.toFixed(2)} — coordinating costs more than the conflict; proceed` };
}
