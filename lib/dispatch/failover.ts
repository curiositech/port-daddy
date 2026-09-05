/**
 * Cross-backend failover for dispatch: resume the work, do not restart it.
 *
 * WHY THIS EXISTS (ADR-0131, operator directive 2026-08-22). Dispatch was
 * single-backend by accident rather than by design: a run that died because the
 * chosen backend was rate-limited, uninstalled, or having an outage died
 * outright, and the only recovery was an operator re-proposing the same goal by
 * hand — which throws away the claim, the worktree, and everything the dead body
 * had already learned, and double-spends the budget.
 *
 * The design here is deliberately NOT "retry harder". A retry on the same
 * backend is correct for exactly one class of failure — a transient one, where
 * the backend is fine and the moment was bad — and is wasted for every other
 * class. So this module answers three separate questions, and keeps them
 * separate because conflating them is how a retry loop becomes a spend loop:
 *
 *   1. Is this failure worth ANOTHER attempt at all?  (a validation error is
 *      not; the same goal will fail the same way on every backend)
 *   2. If so, on the SAME backend or the NEXT one?  (rate-limited → same, once;
 *      binary absent → next, immediately — retrying a missing binary is pure
 *      latency)
 *   3. Which backend is next, and is there budget left to try it?
 *
 * WHAT THIS MODULE DOES NOT DO. It does not mint the successor, settle the
 * predecessor, or touch a worktree — it is a pure decision function over a
 * dispatch and an error, so the policy is testable without a database, a
 * Conductor, or a filesystem. `runClaimedDispatch` owns the acting-on.
 *
 * THE SALVAGE RULE. A dispatch that is about to fail over settles to `salvage`,
 * never to `failed`. This is not cosmetic: the worker reaps the worktree of a
 * `failed` dispatch, and the worktree is where the transcript the successor's
 * handoff capsule is built from lives. Reaping it first would leave the
 * successor with nothing but the original goal text — a restart wearing a
 * successor's name, which is precisely what ADR-0118 exists to prevent.
 */

import { isWitnessedBackendFailure } from '../agent-resilience.js';
import type { Dispatch, DispatchBackend } from './queue.js';
import { DEFAULT_BACKEND } from './runner.js';

/**
 * The default order a succession walks when nothing more specific is declared.
 *
 * Ordered by instrumentation honesty, not by preference alone: `cli:claude-code`
 * is first because it is the only backend with a verified squid adapter today,
 * so a successor landing there keeps the controls the operator can actually use
 * (ADR-0134's per-backend matrix). The rest follow in descending harness
 * capability. A backend that has no adapter still runs — at a disclosed tier —
 * because refusing to fail over is worse than failing over to limited controls.
 */
export const DEFAULT_FAILOVER_CHAIN: readonly DispatchBackend[] = [
  'cli:claude-code',
  'cli:codex',
  'cli:gemini',
  'cli:agy',
];

/**
 * Hard cap on successors per original dispatch.
 *
 * Two, not "until the chain is exhausted". Each attempt costs a worktree, a
 * claim window, and real budget, and a goal that has failed on three different
 * bodies is far more likely to be a bad goal than to be three unlucky backends —
 * at which point more attempts spend money to reach the same answer more slowly.
 * The operator sees the chain and can re-propose deliberately.
 */
export const MAX_FAILOVER_ATTEMPTS = 2;

/** What the runner should do with a failure. */
export interface FailoverDecision {
  /** `none` = settle as it is; the caller does nothing extra. */
  action: 'none' | 'retry-same-backend' | 'failover';
  /** Present when `action === 'failover'`: the body to try next. */
  nextBackend?: DispatchBackend;
  /** The remaining chain AFTER `nextBackend`, to freeze onto the successor. */
  remainingChain?: DispatchBackend[];
  /** Budget the successor may spend — the original minus what is already spent. */
  remainingBudgetUsd?: number;
  /** One sentence, for the receipt and the lane. Always populated. */
  reason: string;
}

/**
 * The classification of one failure, exposed so a caller can log WHY without
 * re-deriving it.
 */
export interface FailureShape {
  code: string;
  /** True when the backend itself is absent on this machine. */
  backendAbsent: boolean;
  /** True when the failure is the kind a second attempt could survive. */
  transient: boolean;
}

/**
 * Classify a dispatch failure for failover purposes.
 *
 * Only exact in-process host witnesses can authorize spending on another body.
 * Display prose, Error instances and JSON clones have no such provenance.
 *
 * @param error The adapter's closed, locally witnessed terminal failure.
 * @returns The shape of the failure.
 */
export function classifyForFailover(
  error: unknown,
): FailureShape {
  if (!isWitnessedBackendFailure(error)) return { code: 'INTERNAL', backendAbsent: false, transient: false };
  const code = error.code;
  const transient = error.retryable && (code === 'RATE_LIMITED' || code === 'TIMEOUT' || code === 'UNAVAILABLE');
  return { code, backendAbsent: code === 'BACKEND_ABSENT', transient };
}

/** Everything `decideFailover` needs that is not on the dispatch itself. */
export interface FailoverContext {
  /** The backend this attempt actually ran on. */
  backend: DispatchBackend;
  /** The adapter's failure text. */
  errorMessage: string | null | undefined;
  /** In-process host witness, never a deserialized error or display message. */
  error?: unknown;
  /** Spend on THIS attempt, so the successor's budget can be reduced by it. */
  costUsd?: number | null;
  /**
   * Preference order to use when the dispatch carries no frozen chain — the
   * durable agent's `backendPreferences` when one exists, else the catalog
   * default. Only consulted for a FIRST failure; a succession already underway
   * uses its own frozen chain so a mid-flight profile edit cannot redirect it.
   */
  preferredChain?: readonly string[];
  /**
   * A backend the caller knows is unusable right now — a tripped circuit
   * breaker, a backend the operator disabled. Skipped when picking next.
   */
  isUnavailable?: (backend: DispatchBackend) => boolean;
  /** Whether this dispatch has already had its one same-backend retry. */
  alreadyRetriedSameBackend?: boolean;
}

/**
 * Decide what happens after a dispatch attempt fails.
 *
 * Pure by design: given the same dispatch and context it returns the same
 * decision, with no I/O and no clock. That is what lets the policy — which spends real money —
 * be pinned by tests rather than observed in production.
 *
 * @param dispatch The dispatch that just failed (its stored chain and budget matter).
 * @param ctx The attempt's backend, error, spend, and the caller's availability view.
 * @returns The action to take, with the successor's backend, chain and budget when failing over.
 */
export function decideFailover(dispatch: Dispatch, ctx: FailoverContext): FailoverDecision {
  const shape = classifyForFailover(ctx.error);

  if (!shape.backendAbsent && !shape.transient) {
    return {
      action: 'none',
      reason: `${shape.code}: no witnessed recoverable failure; another body is not authorized`,
    };
  }

  const attempt = dispatch.failoverAttempt ?? 0;
  if (attempt >= MAX_FAILOVER_ATTEMPTS) {
    return {
      action: 'none',
      reason: `failover cap reached (${MAX_FAILOVER_ATTEMPTS} successors); an operator decides from here`,
    };
  }

  // One same-backend retry, and only for a genuinely transient cause. A missing
  // binary is deliberately excluded: it will still be missing on the retry.
  if (shape.transient && !shape.backendAbsent && !ctx.alreadyRetriedSameBackend) {
    return {
      action: 'retry-same-backend',
      reason: `${shape.code} on ${ctx.backend}: transient, one retry on the same body before changing it`,
    };
  }

  const chain = remainingChainFor(dispatch, ctx);
  const next = chain.find((b) => b !== ctx.backend && !(ctx.isUnavailable?.(b) ?? false));
  if (!next) {
    return {
      action: 'none',
      reason: `no further backend available after ${ctx.backend}`,
    };
  }

  const remainingBudgetUsd = remainingBudget(dispatch, ctx.costUsd);
  if (remainingBudgetUsd !== null && remainingBudgetUsd <= 0) {
    return {
      action: 'none',
      reason: `budget exhausted on ${ctx.backend}; a successor would have nothing to spend`,
    };
  }

  return {
    action: 'failover',
    nextBackend: next,
    remainingChain: chain.filter((b) => b !== next && b !== ctx.backend),
    ...(remainingBudgetUsd !== null ? { remainingBudgetUsd } : {}),
    reason: shape.backendAbsent
      ? `${ctx.backend} is not available on this machine; continuing on ${next}`
      : `${shape.code} on ${ctx.backend}; continuing on ${next}`,
  };
}

/**
 * The backends this succession may still try.
 *
 * A dispatch already in a succession uses its OWN frozen chain; only a first
 * failure consults the live preference order. The rationale for the distinction: a
 * chain read fresh at each hop would let an operator editing preferences
 * mid-flight change where a running succession goes, so the chain a lane shows
 * would not be the chain that ran.
 *
 * @param dispatch The failing dispatch.
 * @param ctx The context carrying the live preference order, if any.
 * @returns Candidate backends in order, already filtered to supported ones.
 */
function remainingChainFor(dispatch: Dispatch, ctx: FailoverContext): DispatchBackend[] {
  const declared = dispatch.failoverChain ?? ctx.preferredChain ?? DEFAULT_FAILOVER_CHAIN;
  const seen = new Set<string>();
  const chain: DispatchBackend[] = [];
  for (const raw of declared) {
    const backend = raw as DispatchBackend;
    // cli:* only. An API backend is a provider call, not an agent harness — it
    // has no worktree, no tools, and no transcript, so a dispatch cannot
    // continue on one however available it is (ADR-0118 body classes).
    if (!backend.startsWith('cli:')) continue;
    if (seen.has(backend)) continue;
    seen.add(backend);
    chain.push(backend);
  }
  if (chain.length === 0) chain.push(DEFAULT_BACKEND);
  return chain;
}

/**
 * Budget left for a successor: the original minus everything already spent.
 *
 * Clamped at zero rather than allowed to go negative, and returned as `null`
 * when the dispatch never carried a budget at all. The design intent is that
 * those stay different facts,
 * and collapsing them would turn "unbudgeted" into "broke".
 *
 * @param dispatch The failing dispatch.
 * @param attemptCostUsd Spend on the attempt that just failed.
 * @returns Remaining dollars, or null when the dispatch is unbudgeted.
 */
export function remainingBudget(
  dispatch: Dispatch,
  attemptCostUsd?: number | null,
): number | null {
  if (dispatch.budgetUsd == null || !Number.isFinite(dispatch.budgetUsd)) return null;
  const spentThisAttempt = Number.isFinite(attemptCostUsd ?? NaN) ? Number(attemptCostUsd) : 0;
  const alreadySpent = Number.isFinite(dispatch.costUsd ?? NaN) ? Number(dispatch.costUsd) : 0;
  const remaining = dispatch.budgetUsd - alreadySpent - spentThisAttempt;
  return remaining > 0 ? Number(remaining.toFixed(4)) : 0;
}

/**
 * Are two backends the same harness family?
 *
 * The purpose is deciding the CONTINUATION MODE, which is the whole difference
 * between a resume and a briefing: same family means the vendor's own session can be
 * resumed with witnessed evidence, so the successor picks up mid-thought;
 * different family means the successor gets a sanitized handoff capsule — a
 * brief, deliberately not a transcript replay (ADR-0118).
 *
 * @param a One backend.
 * @param b The other.
 * @returns True when a native resume is even a candidate.
 */
export function sameHarnessFamily(a: string, b: string): boolean {
  return a === b;
}
