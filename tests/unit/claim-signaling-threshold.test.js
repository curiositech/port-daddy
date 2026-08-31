/**
 * Unit tests for the claim-signaling discount-factor threshold.
 *
 * Mirrors the closed-form analysis mechanized in
 * whitepaper/formal/z3/economics-delta-threshold/delta-threshold.z3 and whitepaper/formal/tla/economics-claim-signaling/claim_signaling.tla
 * for the corrected prisoner's-dilemma stage game
 * (T,T)=(3,3), (T,F)=(0,4), (F,T)=(4,0), (F,F)=(1,1):
 *
 *   one-shot gain g = 4 - 3 = 1, per-round punishment loss L = 3 - 1 = 2,
 *   3-round graduated trigger  =>  IC iff 1 <= 2(d + d^2 + d^3),
 *   i.e. the IC cubic f(d) = 2d^3 + 2d^2 + 2d - 1 crosses zero at delta*.
 *
 * Dependency-free on purpose: pure arithmetic, no imports from lib/.
 * If these numbers drift from the registered whitepaper/formal artifacts, one side is stale.
 */
import { describe, test, expect } from '@jest/globals';

/** The IC cubic: positive above delta*, negative below. */
function icCubic(d) {
  return 2 * d ** 3 + 2 * d ** 2 + 2 * d - 1;
}

/**
 * Net one-shot deviation payoff under the 3-round graduated trigger:
 * gain 1 now, minus the discounted per-round loss of 2 over the
 * punishment window. Positive means deviation pays (IC fails).
 */
function deviationPayoff(d) {
  return 1 - 2 * (d + d ** 2 + d ** 3);
}

/** Grim-trigger deviation payoff: 1 - 2 * d / (1 - d). Crosses zero at d = 1/3. */
function grimDeviationPayoff(d) {
  return 1 - (2 * d) / (1 - d);
}

/** Bisect f on [lo, hi] assuming f(lo) < 0 < f(hi). */
function bisectRoot(f, lo, hi, iterations = 200) {
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe('claim-signaling / IC cubic root', () => {
  test('cubic changes sign across [0.342, 0.343]', () => {
    expect(icCubic(0.342)).toBeLessThan(0);
    expect(icCubic(0.343)).toBeGreaterThan(0);
  });

  test('unique root delta* lies in [0.342, 0.343] (delta* ~ 0.342508)', () => {
    const root = bisectRoot(icCubic, 0, 1);
    expect(root).toBeGreaterThanOrEqual(0.342);
    expect(root).toBeLessThanOrEqual(0.343);
    expect(root).toBeCloseTo(0.3425080314, 8);
  });

  test('root is unique in (0, 1): cubic is strictly increasing there', () => {
    // f'(d) = 6d^2 + 4d + 2 > 0 for all real d, so at most one real root.
    // Sample the derivative sign across the interval as the executable check.
    for (let d = 0; d <= 1.0001; d += 0.05) {
      const derivative = 6 * d ** 2 + 4 * d + 2;
      expect(derivative).toBeGreaterThan(0);
    }
  });

  test('the voided calibration root 0.2531 does not satisfy the corrected cubic', () => {
    // Old (void) cubic 3d^3+3d^2+3d-1 had its root near 0.2531; the corrected
    // game's cubic is still far from zero there. Documents the correction.
    expect(icCubic(0.2531)).toBeLessThan(-0.15);
  });
});

describe('claim-signaling / one-shot deviation sign flip', () => {
  test('deviation strictly pays below delta* (IC fails)', () => {
    expect(deviationPayoff(0.30)).toBeGreaterThan(0);
    expect(deviationPayoff(0.34)).toBeGreaterThan(0);
  });

  test('deviation strictly loses above delta* (IC holds)', () => {
    expect(deviationPayoff(0.35)).toBeLessThan(0);
    expect(deviationPayoff(0.9)).toBeLessThan(0);
  });

  test('deviation payoff is ~0 exactly at the root', () => {
    const root = bisectRoot(icCubic, 0, 1);
    expect(Math.abs(deviationPayoff(root))).toBeLessThan(1e-12);
  });

  test('at the working operating point delta = 0.9, net deviation is -3.878', () => {
    expect(deviationPayoff(0.9)).toBeCloseTo(-3.878, 10);
  });
});

describe('claim-signaling / grim-trigger bound', () => {
  test('grim deviation payoff crosses zero exactly at delta = 1/3', () => {
    expect(grimDeviationPayoff(1 / 3)).toBeCloseTo(0, 12);
    expect(grimDeviationPayoff(1 / 3 - 0.01)).toBeGreaterThan(0); // fails below
    expect(grimDeviationPayoff(1 / 3 + 0.01)).toBeLessThan(0); // holds above
  });

  test('graduated (k=3) threshold sits just above the grim bound', () => {
    const root = bisectRoot(icCubic, 0, 1);
    expect(root).toBeGreaterThan(1 / 3);
    expect(root - 1 / 3).toBeLessThan(0.01); // "barely 0.009" per the whitepaper
  });
});
