/**
 * Tests for lib/fleet/circuit-breaker.ts — the FleetCircuitBreaker (ADR-0060).
 *
 * Two independent failure mechanics, exhaustively:
 *   • budget (lineage + global) → trips to pause-and-refund
 *   • error-rate → trips to pause ONLY, and ONLY with a minimum sample
 *
 * These are real-bug tests: each asserts a safety property that, if violated,
 * lets a runaway lineage blow past its ceiling or a cold-start self-trip.
 */

import {
  createFleetCircuitBreaker,
  GLOBAL_SCOPE,
} from '../../lib/fleet/circuit-breaker.js';

let clock;
function makeBreaker(overrides = {}) {
  clock = 1_700_000_000_000;
  return createFleetCircuitBreaker({ now: () => clock, ...overrides });
}

describe('budget reservation (I4 LINEAGE_BUDGET_CONSERVED)', () => {
  test('reserve succeeds up to the ceiling and refuses past it', () => {
    const b = makeBreaker();
    b.registerScope('root:a', 10);
    expect(b.reserve('root:a', 6)).toBe(true);
    expect(b.reserve('root:a', 4)).toBe(true); // exactly hits ceiling — allowed
    expect(b.reserve('root:a', 0.01)).toBe(false); // would exceed — refused
  });

  test('a refused reservation does NOT mutate accounting (no partial debit)', () => {
    const b = makeBreaker();
    b.registerScope('root:a', 10);
    expect(b.reserve('root:a', 8)).toBe(true);
    expect(b.reserve('root:a', 5)).toBe(false); // 8+5 > 10
    // The refused 5 left nothing behind: a 2 still fits (8+2=10).
    expect(b.reserve('root:a', 2)).toBe(true);
  });

  test('TOCTOU: two concurrent children that each pass alone cannot BOTH spawn past the ceiling', () => {
    const b = makeBreaker();
    b.registerScope('root:a', 10);
    // Each child wants $6. Alone, each fits ($6 ≤ $10). Together they would be
    // $12 > $10. Because reserve() debits synchronously, the second is refused.
    const childA = b.reserve('root:a', 6);
    const childB = b.reserve('root:a', 6);
    expect(childA).toBe(true);
    expect(childB).toBe(false);
    // Exactly one child got through.
    expect([childA, childB].filter(Boolean).length).toBe(1);
  });

  test('exceeding the ceiling on reserve trips the lineage budget breaker (pause-and-refund)', () => {
    const b = makeBreaker();
    b.registerScope('root:a', 5);
    b.reserve('root:a', 5);
    expect(b.isOpen('root:a')).toBe(false);
    expect(b.reserve('root:a', 1)).toBe(false);
    expect(b.isOpen('root:a')).toBe(true);
    expect(b.state('root:a').reason).toBe('lineage-budget');
    expect(b.state('root:a').disposition).toBe('pause-and-refund');
  });

  test('global ceiling exceeded trips with reason global-budget', () => {
    const b = makeBreaker();
    b.registerScope(GLOBAL_SCOPE, 3);
    b.reserve(GLOBAL_SCOPE, 3);
    expect(b.reserve(GLOBAL_SCOPE, 1)).toBe(false);
    expect(b.state(GLOBAL_SCOPE).reason).toBe('global-budget');
  });

  test('null ceiling is unbounded — never refuses on budget', () => {
    const b = makeBreaker();
    b.registerScope('root:a', null);
    expect(b.reserve('root:a', 1_000_000)).toBe(true);
    expect(b.isOpen('root:a')).toBe(false);
  });

  test('release returns reserved budget to the scope', () => {
    const b = makeBreaker();
    b.registerScope('root:a', 10);
    b.reserve('root:a', 9);
    expect(b.reserve('root:a', 2)).toBe(false); // 9+2 > 10
    b.release('root:a', 5); // now only 4 reserved
    expect(b.reserve('root:a', 6)).toBe(true); // 4+6 = 10, fits
  });

  test('realized cost from outcomes counts against the ceiling and can trip it', () => {
    const b = makeBreaker();
    b.registerScope('root:a', 5);
    b.reserve('root:a', 5);
    // Settle the launch with realized cost above the reservation → exceeds ceiling.
    const disp = b.recordOutcome('root:a', { success: true, realizedUsd: 6, reservedUsd: 5 });
    expect(disp).toBe('pause-and-refund');
    expect(b.isOpen('root:a')).toBe(true);
  });
});

describe('error-rate breaker (min-sample guard)', () => {
  test('does NOT trip below the minimum sample even at 100% failure', () => {
    const b = makeBreaker({ errorRateMinSample: 4, errorRateThreshold: 0.5 });
    b.registerScope('root:a', null);
    // 3 failures — below the min sample of 4. Must NOT trip.
    for (let i = 0; i < 3; i++) {
      const d = b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 });
      expect(d).toBeNull();
    }
    expect(b.isOpen('root:a')).toBe(false);
  });

  test('trips to PAUSE (not pause-and-refund) once min sample is met and rate exceeds threshold', () => {
    const b = makeBreaker({ errorRateMinSample: 4, errorRateThreshold: 0.5 });
    b.registerScope('root:a', null);
    b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 });
    b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 });
    b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 });
    const d = b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 }); // 4th, 100%
    expect(d).toBe('pause');
    expect(b.state('root:a').disposition).toBe('pause');
    expect(b.state('root:a').reason).toBe('error-rate');
  });

  test('exactly at threshold does NOT trip (strictly-greater)', () => {
    const b = makeBreaker({ errorRateMinSample: 4, errorRateThreshold: 0.5, errorRateWindow: 4 });
    b.registerScope('root:a', null);
    // 2 fail / 2 ok = 0.5 exactly → not > 0.5 → no trip.
    b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 });
    b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 });
    b.recordOutcome('root:a', { success: true, realizedUsd: 0, reservedUsd: 0 });
    const d = b.recordOutcome('root:a', { success: true, realizedUsd: 0, reservedUsd: 0 });
    expect(d).toBeNull();
    expect(b.isOpen('root:a')).toBe(false);
  });

  test('error-rate trip never returns pause-and-refund (no slash, no kill signal)', () => {
    const b = makeBreaker({ errorRateMinSample: 4, errorRateThreshold: 0.5 });
    b.registerScope('root:a', null);
    let disp = null;
    for (let i = 0; i < 5; i++) {
      disp = b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 }) ?? disp;
    }
    expect(disp).toBe('pause');
  });
});

describe('scope semantics', () => {
  test('a global trip pauses every lineage scope (isOpen returns true for all)', () => {
    const b = makeBreaker();
    b.registerScope(GLOBAL_SCOPE, 1);
    b.registerScope('root:a', 100);
    b.reserve(GLOBAL_SCOPE, 1);
    expect(b.reserve(GLOBAL_SCOPE, 1)).toBe(false); // trips global
    expect(b.isOpen('root:a')).toBe(true); // even though root:a has headroom
    expect(b.isOpen('root:b')).toBe(true);
  });

  test('a lineage trip does NOT pause sibling lineages', () => {
    const b = makeBreaker();
    b.registerScope('root:a', 1);
    b.registerScope('root:b', 100);
    b.reserve('root:a', 1);
    expect(b.reserve('root:a', 1)).toBe(false); // trips root:a only
    expect(b.isOpen('root:a')).toBe(true);
    expect(b.isOpen('root:b')).toBe(false);
  });

  test('close() resets a scope to CLOSED and clears the error window', () => {
    const b = makeBreaker({ errorRateMinSample: 4, errorRateThreshold: 0.5 });
    b.registerScope('root:a', null);
    for (let i = 0; i < 4; i++) b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 });
    expect(b.isOpen('root:a')).toBe(true);
    b.close('root:a');
    expect(b.isOpen('root:a')).toBe(false);
    // Window cleared: 3 fresh failures should not re-trip (below min sample again).
    for (let i = 0; i < 3; i++) b.recordOutcome('root:a', { success: false, realizedUsd: 0, reservedUsd: 0 });
    expect(b.isOpen('root:a')).toBe(false);
  });

  test('openScopes lists every currently-open scope', () => {
    const b = makeBreaker();
    b.registerScope('root:a', 0);
    b.reserve('root:a', 1); // trips
    const open = b.openScopes();
    expect(open.map((s) => s.scope)).toContain('root:a');
  });
});
