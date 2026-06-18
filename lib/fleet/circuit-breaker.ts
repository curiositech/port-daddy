/**
 * FleetCircuitBreaker — ADR-0060 §"The circuit-breaker / halt control plane".
 *
 * The breaker watches two independent failure mechanics (Nygard, *Release It!*:
 * a breaker is a physics-based countermeasure to a specific failure mode, not a
 * decorative best-practice) and trips a *scope* — a single lineage subtree
 * (`root:<rootId>`) or the whole fleet (`global`) — to OPEN.
 *
 *   1. Budget exhaustion  — realized cost + reserved bond under a scope exceeds
 *                           its ceiling. Trips → PAUSE the scope AND signals the
 *                           caller to refund in-flight bonds (budget exhaustion
 *                           is not agent misbehavior; the operator should not be
 *                           punished for a runaway lineage they can stop).
 *   2. Error-rate         — a rolling window of the last N launch outcomes in a
 *                           scope shows >threshold failures. Trips → PAUSE only.
 *                           NEVER halts running agents and NEVER slashes; an
 *                           error-rate trip is a reversible "stop admitting"
 *                           state the operator resolves. Requires a MINIMUM
 *                           SAMPLE before it can trip, so genuinely-hard work
 *                           that fails a few times early does not self-trip
 *                           (ADR-0060 "hard parts" §2).
 *
 * Tripping to OPEN means: the Conductor refuses every `proposed` launch in that
 * scope (I5/I4). It does NOT, on its own, kill running agents — only an operator
 * HALT or a *budget* trip's refund signal touches live agents. This separation
 * is deliberate: PAUSE is soft and reversible; HALT is total and operator-owned.
 *
 * The breaker is pure and synchronous: it holds no timers and no DB handle. The
 * Conductor feeds it cost/outcome events and reads `isOpen(scope)` inside the
 * same admission transaction that escrows the bond, so admission and breaker
 * state share one lock (no TOCTOU between "breaker is closed" and "spawn").
 */

export type BreakerScope = string; // 'global' | `root:${rootId}`

export type TripReason = 'lineage-budget' | 'global-budget' | 'error-rate';

/** What action the Conductor should take when a scope newly trips. */
export type TripDisposition =
  | 'pause-and-refund' // budget exhaustion: stop admitting + refund in-flight bonds
  | 'pause'; // error-rate: stop admitting only; never kill, never slash

export interface BreakerState {
  scope: BreakerScope;
  open: boolean;
  reason: TripReason | null;
  disposition: TripDisposition | null;
  /** ms epoch of the trip, or null if closed. */
  trippedAt: number | null;
}

export interface BreakerConfig {
  /**
   * Error-rate threshold in [0,1]. A scope with a failure fraction strictly
   * greater than this (over a full window) trips. Default 0.5 (>50%).
   */
  errorRateThreshold?: number;
  /**
   * Minimum number of recorded outcomes in a scope before the error-rate
   * breaker may trip. Below this, error-rate is never evaluated (cold-start /
   * hard-task guard). ADR-0060 names ≥4. Default 4.
   */
  errorRateMinSample?: number;
  /**
   * How many of the most-recent outcomes per scope to consider. Default 8.
   */
  errorRateWindow?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface ScopeAccounting {
  /** Ceiling in USD; null = unbounded (only the global scope may be null). */
  ceilingUsd: number | null;
  /** Realized (settled) cost charged to the scope. */
  realizedUsd: number;
  /** Bond currently reserved (escrowed, not yet resolved) against the scope. */
  reservedUsd: number;
  /** Rolling outcome ring: true = success, false = failure. */
  outcomes: boolean[];
  state: BreakerState;
}

export interface FleetCircuitBreaker {
  /** Register/refresh a scope's ceiling. Idempotent; preserves accounting. */
  registerScope(scope: BreakerScope, ceilingUsd: number | null): void;
  /**
   * Reserve `usd` against a scope's ceiling. Returns false WITHOUT mutating if
   * the reservation would exceed the ceiling (the caller must not spawn). This
   * is the single-decision-point used inside the admission transaction.
   */
  reserve(scope: BreakerScope, usd: number): boolean;
  /** Release a previously-reserved amount (e.g. on refund / admission abort). */
  release(scope: BreakerScope, usd: number): void;
  /**
   * Record a launch outcome (settled). `realizedUsd` moves from reserved to
   * realized; `success` feeds the error-rate window. Returns the trip
   * disposition if THIS event newly tripped the scope (else null).
   */
  recordOutcome(
    scope: BreakerScope,
    params: { success: boolean; realizedUsd: number; reservedUsd: number },
  ): TripDisposition | null;
  /** True if the scope (or, when global trips, any scope) is OPEN. */
  isOpen(scope: BreakerScope): boolean;
  /** Operator/manual reset of a scope back to CLOSED. */
  close(scope: BreakerScope): void;
  state(scope: BreakerScope): BreakerState;
  /** All currently-open scope states (for `fleet:state` broadcast). */
  openScopes(): BreakerState[];
}

export const GLOBAL_SCOPE: BreakerScope = 'global';

export function createFleetCircuitBreaker(config: BreakerConfig = {}): FleetCircuitBreaker {
  const errorRateThreshold = config.errorRateThreshold ?? 0.5;
  const errorRateMinSample = Math.max(1, config.errorRateMinSample ?? 4);
  const errorRateWindow = Math.max(errorRateMinSample, config.errorRateWindow ?? 8);
  const now = config.now ?? Date.now;

  const scopes = new Map<BreakerScope, ScopeAccounting>();

  function ensure(scope: BreakerScope, ceilingUsd: number | null = null): ScopeAccounting {
    let acc = scopes.get(scope);
    if (!acc) {
      acc = {
        ceilingUsd,
        realizedUsd: 0,
        reservedUsd: 0,
        outcomes: [],
        state: { scope, open: false, reason: null, disposition: null, trippedAt: null },
      };
      scopes.set(scope, acc);
    }
    return acc;
  }

  function registerScope(scope: BreakerScope, ceilingUsd: number | null): void {
    const acc = ensure(scope, ceilingUsd);
    acc.ceilingUsd = ceilingUsd;
  }

  function trip(acc: ScopeAccounting, reason: TripReason, disposition: TripDisposition): void {
    acc.state.open = true;
    acc.state.reason = reason;
    acc.state.disposition = disposition;
    acc.state.trippedAt = now();
  }

  function reserve(scope: BreakerScope, usd: number): boolean {
    if (!(usd >= 0) || !Number.isFinite(usd)) return false;
    const acc = ensure(scope);
    if (acc.ceilingUsd != null) {
      const projected = acc.realizedUsd + acc.reservedUsd + usd;
      // Strictly-greater: a reservation that exactly hits the ceiling is allowed;
      // one that would exceed it is refused and trips the budget breaker.
      if (projected > acc.ceilingUsd + 1e-9) {
        if (!acc.state.open) {
          const reason: TripReason = scope === GLOBAL_SCOPE ? 'global-budget' : 'lineage-budget';
          trip(acc, reason, 'pause-and-refund');
        }
        return false;
      }
    }
    acc.reservedUsd += usd;
    return true;
  }

  function release(scope: BreakerScope, usd: number): void {
    const acc = scopes.get(scope);
    if (!acc) return;
    acc.reservedUsd = Math.max(0, acc.reservedUsd - Math.max(0, usd));
  }

  function recordOutcome(
    scope: BreakerScope,
    params: { success: boolean; realizedUsd: number; reservedUsd: number },
  ): TripDisposition | null {
    const acc = ensure(scope);
    // Move the resolved bond out of `reserved` and book the realized cost.
    acc.reservedUsd = Math.max(0, acc.reservedUsd - Math.max(0, params.reservedUsd));
    if (Number.isFinite(params.realizedUsd) && params.realizedUsd > 0) {
      acc.realizedUsd += params.realizedUsd;
    }
    // Update the rolling error-rate window.
    acc.outcomes.push(params.success);
    if (acc.outcomes.length > errorRateWindow) {
      acc.outcomes.splice(0, acc.outcomes.length - errorRateWindow);
    }

    const wasOpen = acc.state.open;

    // Budget check first: realized spend alone can exceed the ceiling.
    if (acc.ceilingUsd != null && acc.realizedUsd + acc.reservedUsd > acc.ceilingUsd + 1e-9) {
      if (!wasOpen) {
        const reason: TripReason = scope === GLOBAL_SCOPE ? 'global-budget' : 'lineage-budget';
        trip(acc, reason, 'pause-and-refund');
        return 'pause-and-refund';
      }
      return null;
    }

    // Error-rate check: only with a full minimum sample.
    if (acc.outcomes.length >= errorRateMinSample) {
      const failures = acc.outcomes.filter((ok) => !ok).length;
      const rate = failures / acc.outcomes.length;
      if (rate > errorRateThreshold) {
        if (!wasOpen) {
          trip(acc, 'error-rate', 'pause');
          return 'pause';
        }
      }
    }
    return null;
  }

  function isOpen(scope: BreakerScope): boolean {
    // A global trip pauses every scope; a lineage trip pauses only its own.
    const global = scopes.get(GLOBAL_SCOPE);
    if (global?.state.open) return true;
    return scopes.get(scope)?.state.open ?? false;
  }

  function close(scope: BreakerScope): void {
    const acc = scopes.get(scope);
    if (!acc) return;
    acc.state.open = false;
    acc.state.reason = null;
    acc.state.disposition = null;
    acc.state.trippedAt = null;
    // Reset the error-rate window on close so a resumed scope is not instantly
    // re-tripped by stale failures the operator already accounted for.
    acc.outcomes = [];
  }

  function state(scope: BreakerScope): BreakerState {
    return { ...ensure(scope).state };
  }

  function openScopes(): BreakerState[] {
    return [...scopes.values()].filter((a) => a.state.open).map((a) => ({ ...a.state }));
  }

  return {
    registerScope,
    reserve,
    release,
    recordOutcome,
    isOpen,
    close,
    state,
    openScopes,
  };
}
