/**
 * The compulsion — rent → slash policy + breach ledger (ADR-0050, phase 7).
 *
 * ADVISORY-ONLY LANDING. These tests pin the SAFE 80% that ships: the pure
 * graduated-slash policy (`rent-slash.ts`) and the per-principal escalation
 * ledger (`rent-breach-ledger.ts`). The money-moving enforcer and the HTTP
 * routes are deliberately NOT in this PR (quarantined behind ADR-0087 signed
 * verdicts), so there is nothing here that can move a bond — by design.
 *
 * What is locked:
 *   • mode resolution fails SAFE to advisory (typo never arms enforce);
 *   • first miss is grace (fraction 0), repeats escalate linearly,
 *     capped at maxFraction (a slash never takes the whole bond);
 *   • amount math is double-clamped into [0, bondUsd];
 *   • the ledger remembers escalation across commits, decays on cure, and
 *     resets after a quiet window — keyed on the principal (Sybil defense);
 *   • the injected clock is required (Law 1: the agent never supplies wall time).
 */

import { describe, test, expect } from '@jest/globals';
import Database from 'better-sqlite3';
import {
  resolveRentSlashMode,
  computeRentSlash,
  rentSlashAmountUsd,
  DEFAULT_RENT_SLASH_MODE,
  DEFAULT_RENT_SLASH_POLICY,
} from '../../lib/coast-guard/rent-slash.js';
import {
  createRentBreachLedger,
  DEFAULT_RENT_BREACH_LEDGER_POLICY,
} from '../../lib/coast-guard/rent-breach-ledger.js';

const PRINCIPAL = 'port-daddy:review:econ';
const PROJECT = 'port-daddy';

function breach(over = {}) {
  return { principal: PRINCIPAL, project: PROJECT, breachCount: 1, commitsWithoutNote: 1, ...over };
}

describe('resolveRentSlashMode — fail-safe to advisory', () => {
  test('unset resolves to advisory (the non-debiting default)', () => {
    expect(resolveRentSlashMode({})).toBe('advisory');
    expect(DEFAULT_RENT_SLASH_MODE).toBe('advisory');
  });

  test('empty / whitespace / typo all resolve to advisory — never enforce', () => {
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: '' })).toBe('advisory');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: '   ' })).toBe('advisory');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'enforcee' })).toBe('advisory');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'ENFROCE' })).toBe('advisory');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'on' })).toBe('advisory');
  });

  test('off and enforce require the exact (case-insensitive, trimmed) word', () => {
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'off' })).toBe('off');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'OFF' })).toBe('off');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: '  enforce  ' })).toBe('enforce');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'Enforce' })).toBe('enforce');
  });
});

describe('computeRentSlash — graduated, first-miss-free, capped', () => {
  test('first miss is grace: no slash, fraction 0, reason points at the note', () => {
    const d = computeRentSlash(breach({ breachCount: 1 }));
    expect(d.shouldSlash).toBe(false);
    expect(d.fraction).toBe(0);
    expect(d.escalationStep).toBe(0);
    expect(d.reason).toMatch(/pd note/);
  });

  test('second breach is the first fine: 10% (one step past grace)', () => {
    const d = computeRentSlash(breach({ breachCount: 2 }));
    expect(d.shouldSlash).toBe(true);
    expect(d.fraction).toBeCloseTo(0.1, 10);
    expect(d.escalationStep).toBe(1);
  });

  test('escalates linearly with repetition', () => {
    expect(computeRentSlash(breach({ breachCount: 3 })).fraction).toBeCloseTo(0.2, 10);
    expect(computeRentSlash(breach({ breachCount: 4 })).fraction).toBeCloseTo(0.3, 10);
  });

  test('hard cap at maxFraction — a slash never takes the whole bond', () => {
    const d = computeRentSlash(breach({ breachCount: 99 }));
    expect(d.fraction).toBe(DEFAULT_RENT_SLASH_POLICY.maxFraction);
    expect(d.fraction).toBeLessThanOrEqual(0.5);
  });

  test('respects a custom policy (grace/base/cap)', () => {
    const policy = { graceBreaches: 2, baseFraction: 0.05, maxFraction: 0.2 };
    expect(computeRentSlash(breach({ breachCount: 2 }), policy).shouldSlash).toBe(false); // still grace
    expect(computeRentSlash(breach({ breachCount: 3 }), policy).fraction).toBeCloseTo(0.05, 10);
    expect(computeRentSlash(breach({ breachCount: 99 }), policy).fraction).toBe(0.2); // custom cap
  });

  test('a non-integer / negative breachCount is floored and never negative', () => {
    expect(computeRentSlash(breach({ breachCount: 2.9 })).escalationStep).toBe(1);
    expect(computeRentSlash(breach({ breachCount: -5 })).shouldSlash).toBe(false);
  });
});

describe('rentSlashAmountUsd — double-clamped into [0, bondUsd]', () => {
  test('zero when the decision does not slash', () => {
    const grace = computeRentSlash(breach({ breachCount: 1 }));
    expect(rentSlashAmountUsd(grace, 10)).toBe(0);
  });

  test('fraction of the bond when it does slash', () => {
    const d = computeRentSlash(breach({ breachCount: 2 })); // 10%
    expect(rentSlashAmountUsd(d, 2)).toBeCloseTo(0.2, 10);
  });

  test('never exceeds the bond and never goes negative even on degenerate bonds', () => {
    const d = computeRentSlash(breach({ breachCount: 99 })); // capped 50%
    expect(rentSlashAmountUsd(d, 4)).toBeCloseTo(2, 10);
    expect(rentSlashAmountUsd(d, 0)).toBe(0);
    expect(rentSlashAmountUsd(d, -10)).toBe(0);
    expect(rentSlashAmountUsd(d, NaN)).toBe(0);
    expect(rentSlashAmountUsd(d, Infinity)).toBe(0);
  });
});

describe('rentBreachLedger — escalation memory, keyed on principal', () => {
  function freshLedger(policy) {
    const db = new Database(':memory:');
    return { db, ledger: createRentBreachLedger(db, policy) };
  }
  const T0 = 1_700_000_000_000;

  test('recordBreach increments and survives across commits', () => {
    const { ledger } = freshLedger();
    expect(ledger.recordBreach(PRINCIPAL, PROJECT, T0)).toBe(1);
    expect(ledger.recordBreach(PRINCIPAL, PROJECT, T0 + 1000)).toBe(2);
    expect(ledger.recordBreach(PRINCIPAL, PROJECT, T0 + 2000)).toBe(3);
    expect(ledger.getState(PRINCIPAL).breachCount).toBe(3);
  });

  test('cure decays escalation by one toward grace (graduated, not grim)', () => {
    const { ledger } = freshLedger();
    ledger.recordBreach(PRINCIPAL, PROJECT, T0);
    ledger.recordBreach(PRINCIPAL, PROJECT, T0 + 1000);
    ledger.recordBreach(PRINCIPAL, PROJECT, T0 + 2000); // count 3
    expect(ledger.cure(PRINCIPAL, T0 + 3000)).toBe(2);
    expect(ledger.cure(PRINCIPAL, T0 + 4000)).toBe(1);
    expect(ledger.cure(PRINCIPAL, T0 + 5000)).toBe(0);
    expect(ledger.cure(PRINCIPAL, T0 + 6000)).toBe(0); // floors at 0, never negative
  });

  test('a quiet window longer than resetWindowMs starts fresh', () => {
    const { ledger } = freshLedger(DEFAULT_RENT_BREACH_LEDGER_POLICY);
    ledger.recordBreach(PRINCIPAL, PROJECT, T0);
    ledger.recordBreach(PRINCIPAL, PROJECT, T0 + 1000); // count 2; last_event_at = T0 + 1000
    // Reset is measured from the LAST event, not the first — so the quiet window
    // must clear from T0 + 1000, the most recent activity.
    const afterWindow = T0 + 1000 + DEFAULT_RENT_BREACH_LEDGER_POLICY.resetWindowMs + 1;
    expect(ledger.recordBreach(PRINCIPAL, PROJECT, afterWindow)).toBe(1); // reset
  });

  test('escalation is per-principal — a neighbour cannot inherit or shed it (Sybil)', () => {
    const { ledger } = freshLedger();
    const other = 'port-daddy:review:other';
    ledger.recordBreach(PRINCIPAL, PROJECT, T0);
    ledger.recordBreach(PRINCIPAL, PROJECT, T0 + 1000); // PRINCIPAL → 2
    expect(ledger.recordBreach(other, PROJECT, T0 + 1500)).toBe(1); // independent
    expect(ledger.getState(PRINCIPAL).breachCount).toBe(2);
    expect(ledger.getState(other).breachCount).toBe(1);
  });

  test('getState returns null for an unknown principal; cure on it is a no-op 0', () => {
    const { ledger } = freshLedger();
    expect(ledger.getState('port-daddy:nobody:here')).toBeNull();
    expect(ledger.cure('port-daddy:nobody:here', T0)).toBe(0);
  });

  test('a non-finite clock is rejected (Law 1 — the agent never supplies wall time)', () => {
    const { ledger } = freshLedger();
    expect(() => ledger.recordBreach(PRINCIPAL, PROJECT, NaN)).toThrow(/Law 1/);
    expect(() => ledger.cure(PRINCIPAL, Infinity)).toThrow(/Law 1/);
  });
});

describe('policy + ledger compose into the graduated trigger', () => {
  test('a persistent dark-laner escalates to the cap, a curer walks back to grace', () => {
    const db = new Database(':memory:');
    const ledger = createRentBreachLedger(db);
    let t = 1_700_000_000_000;
    const bondUsd = 5;

    // Six straight breaches: grace, then 10/20/30/40/50% (capped).
    const fractions = [];
    for (let i = 0; i < 6; i++) {
      const count = ledger.recordBreach(PRINCIPAL, PROJECT, (t += 1000));
      fractions.push(computeRentSlash(breach({ breachCount: count })).fraction);
    }
    // Round to integer percent to dodge IEEE-754 noise (0.1 * 3 = 0.30000000000000004).
    expect(fractions.map((f) => Math.round(f * 100))).toEqual([0, 10, 20, 30, 40, 50]);

    // The 50% cap on a $5 bond is $2.50 — never the whole bond.
    const capped = computeRentSlash(breach({ breachCount: 6 }));
    expect(rentSlashAmountUsd(capped, bondUsd)).toBeCloseTo(2.5, 10);

    // Now cooperate: each cure decays one step back toward grace.
    expect(ledger.cure(PRINCIPAL, (t += 1000))).toBe(5);
    expect(ledger.cure(PRINCIPAL, (t += 1000))).toBe(4);
    const recovered = computeRentSlash(breach({ breachCount: ledger.getState(PRINCIPAL).breachCount }));
    expect(recovered.fraction).toBeCloseTo(0.3, 10); // walked down from the cap
  });
});
