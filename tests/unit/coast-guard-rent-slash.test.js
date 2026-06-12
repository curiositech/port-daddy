/**
 * The compulsion — rent → slash (ADR-0050, phase 7).
 *
 * Closes the economic-enforcement loop: a repeated, egregious coordination-rent
 * breach turns into a GRADUATED, PROPORTIONATE bond slash. These tests pin the
 * four properties the design lives or dies on:
 *
 *   1. SAFE BY DEFAULT — the loop resolves to 'advisory' unless an operator sets
 *      PD_RENT_SLASH_MODE=enforce; advisory LOGS but debits NOTHING.
 *   2. GRADUATION — first miss is grace (no fine); repeated breaches escalate a
 *      small fraction, capped well below the whole bond.
 *   3. RIGHT PRINCIPAL — the slash targets the BREACHING principal's own bond,
 *      never a co-located neighbour's (Sybil/griefing defense).
 *   4. CONSERVATION — an enforced slash splits the bond and preserves
 *      wallet + escrow + commons = supply.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createBonds } from '../../lib/bonds.js';
import {
  resolveRentSlashMode,
  computeRentSlash,
  rentSlashAmountUsd,
  DEFAULT_RENT_SLASH_MODE,
  DEFAULT_RENT_SLASH_POLICY,
} from '../../lib/coast-guard/rent-slash.js';
import { applyRentSlash } from '../../lib/coast-guard/rent-slash-enforcer.js';
import {
  createRentBreachLedger,
  DEFAULT_RENT_BREACH_LEDGER_POLICY,
} from '../../lib/coast-guard/rent-breach-ledger.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Mode resolution — advisory by default; enforce only on explicit opt-in.
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveRentSlashMode — SAFE BY DEFAULT (no accidental debit)', () => {
  test('unset → advisory (the non-debiting default)', () => {
    expect(resolveRentSlashMode({})).toBe('advisory');
    expect(DEFAULT_RENT_SLASH_MODE).toBe('advisory');
  });

  test('empty / whitespace → advisory', () => {
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: '' })).toBe('advisory');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: '   ' })).toBe('advisory');
  });

  test('a typo never silently arms debiting — unknown values fail safe to advisory', () => {
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'enfroce' })).toBe('advisory');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'true' })).toBe('advisory');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'on' })).toBe('advisory');
  });

  test('explicit enforce (case-insensitive, trimmed) is the ONLY path to debiting', () => {
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'enforce' })).toBe('enforce');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'ENFORCE' })).toBe('enforce');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: '  Enforce  ' })).toBe('enforce');
  });

  test('explicit off disables the loop entirely', () => {
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'off' })).toBe('off');
    expect(resolveRentSlashMode({ PD_RENT_SLASH_MODE: 'OFF' })).toBe('off');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Graduated amount computation — first miss grace, escalation, cap.
// ─────────────────────────────────────────────────────────────────────────────
describe('computeRentSlash — graduated, proportionate, first-miss grace', () => {
  const breach = (over = {}) => ({
    principal: 'port-daddy:api:main',
    project: 'port-daddy',
    breachCount: 1,
    commitsWithoutNote: 1,
    ...over,
  });

  test('first miss (breachCount 1) is GRACE — no slash', () => {
    const d = computeRentSlash(breach({ breachCount: 1 }));
    expect(d.shouldSlash).toBe(false);
    expect(d.fraction).toBe(0);
    expect(d.escalationStep).toBe(0);
  });

  test('second breach is a small slice (one escalation step)', () => {
    const d = computeRentSlash(breach({ breachCount: 2 }));
    expect(d.shouldSlash).toBe(true);
    expect(d.escalationStep).toBe(1);
    expect(d.fraction).toBeCloseTo(DEFAULT_RENT_SLASH_POLICY.baseFraction, 6); // 10%
  });

  test('escalation is linear in breach count (3rd → 2 steps)', () => {
    const d = computeRentSlash(breach({ breachCount: 3 }));
    expect(d.escalationStep).toBe(2);
    expect(d.fraction).toBeCloseTo(DEFAULT_RENT_SLASH_POLICY.baseFraction * 2, 6); // 20%
  });

  test('escalation is CAPPED at maxFraction — never the whole bond, however many misses', () => {
    const d = computeRentSlash(breach({ breachCount: 999 }));
    expect(d.fraction).toBeCloseTo(DEFAULT_RENT_SLASH_POLICY.maxFraction, 6); // 50% cap
    expect(d.fraction).toBeLessThan(1); // categorically never the whole bond
  });

  test('the graduation is monotonic non-decreasing and bounded [0, maxFraction]', () => {
    let prev = -1;
    for (let n = 1; n <= 12; n++) {
      const d = computeRentSlash(breach({ breachCount: n }));
      expect(d.fraction).toBeGreaterThanOrEqual(prev);
      expect(d.fraction).toBeGreaterThanOrEqual(0);
      expect(d.fraction).toBeLessThanOrEqual(DEFAULT_RENT_SLASH_POLICY.maxFraction);
      prev = d.fraction;
    }
  });

  test('a custom policy widens grace + tunes the step (operator tuning)', () => {
    const policy = { graceBreaches: 2, baseFraction: 0.05, maxFraction: 0.25 };
    // breaches 1 and 2 are now grace
    expect(computeRentSlash(breach({ breachCount: 2 }), policy).shouldSlash).toBe(false);
    // breach 3 is the first real step
    const d = computeRentSlash(breach({ breachCount: 3 }), policy);
    expect(d.shouldSlash).toBe(true);
    expect(d.fraction).toBeCloseTo(0.05, 6);
  });

  test('rentSlashAmountUsd is fraction · bond, clamped to [0, bond]', () => {
    const graceDecision = computeRentSlash(breach({ breachCount: 1 }));
    expect(rentSlashAmountUsd(graceDecision, 1.0)).toBe(0); // grace → 0
    const step1 = computeRentSlash(breach({ breachCount: 2 }));
    expect(rentSlashAmountUsd(step1, 1.0)).toBeCloseTo(0.1, 6); // 10% of $1
    // never exceeds the bond, even with a (hypothetical) >1 fraction
    expect(rentSlashAmountUsd({ ...step1, fraction: 5 }, 1.0)).toBe(1.0);
    expect(rentSlashAmountUsd(step1, 0)).toBe(0); // no bond → nothing
  });

  test('no reason string names a bypass (honesty contract)', () => {
    for (const n of [1, 2, 5, 50]) {
      const d = computeRentSlash(breach({ breachCount: n }));
      expect(d.reason).not.toMatch(/--allow|--no-verify|--force|bypass|override|PD_[A-Z_]*OFF/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Enforcer — advisory logs-not-slashes; enforce slashes the right amount.
// ─────────────────────────────────────────────────────────────────────────────
describe('applyRentSlash — advisory vs enforce, principal targeting, conservation', () => {
  let db;
  let bonds;
  let logs;
  let logger;
  const project = 'port-daddy';
  const principal = 'port-daddy:api:main';

  beforeEach(() => {
    db = createTestDb();
    bonds = createBonds(db);
    logs = { info: [], warn: [] };
    logger = { info: (m) => logs.info.push(m), warn: (m) => logs.warn.push(m) };
    // Fund the wallet and escrow a $1 bond for the breaching principal.
    bonds.topUpWallet(project, 10);
  });

  afterEach(() => {
    if (db) db.close();
  });

  /** Escrow a $bondUsd bond keyed on `agentId` (the bond's identity). */
  function escrowFor(agentId, bondUsd) {
    const r = bonds.escrow({ project, agentId, bondUsd });
    expect(r.ok).toBe(true);
    bonds.markRunning(r.id);
    return r.id;
  }

  const breach = (over = {}) => ({ principal, project, breachCount: 2, commitsWithoutNote: 1, ...over });

  test('mode off → no log, no lookup, no debit', () => {
    escrowFor(principal, 1.0);
    const before = bonds.conservation(project);
    const out = applyRentSlash({ bonds, mode: 'off', logger }, breach());
    const after = bonds.conservation(project);

    expect(out.slashed).toBe(false);
    expect(out.skipReason).toBe('mode-off');
    expect(logs.info).toHaveLength(0);
    expect(logs.warn).toHaveLength(0);
    expect(after).toEqual(before);
  });

  test('ADVISORY (default) — LOGS the slash that WOULD happen, debits NOTHING', () => {
    const bondId = escrowFor(principal, 1.0);
    const before = bonds.conservation(project);

    const out = applyRentSlash({ bonds, mode: 'advisory', logger }, breach({ breachCount: 2 }));
    const after = bonds.conservation(project);

    // It identified the right bond + amount...
    expect(out.bondId).toBe(bondId);
    expect(out.amountUsd).toBeCloseTo(0.1, 6); // 10% of $1
    // ...but DID NOT slash.
    expect(out.slashed).toBe(false);
    expect(bonds.getBond(bondId).state).toBe('running'); // untouched
    // Wallet + commons + escrow are byte-for-byte unchanged.
    expect(after.walletUsd).toBeCloseTo(before.walletUsd, 9);
    expect(after.commonsUsd).toBeCloseTo(before.commonsUsd, 9);
    expect(after.escrowUsd).toBeCloseTo(before.escrowUsd, 9);
    expect(after.supplyUsd).toBeCloseTo(before.supplyUsd, 9);
    // It said, loudly, that no debit occurred and how to enable one.
    const advisoryLine = logs.warn.find((m) => m.includes('ADVISORY'));
    expect(advisoryLine).toMatch(/WOULD slash/);
    expect(advisoryLine).toMatch(/PD_RENT_SLASH_MODE=enforce/);
  });

  test('ADVISORY on a first miss → grace, logs the breach, no would-slash line', () => {
    escrowFor(principal, 1.0);
    const before = bonds.conservation(project);
    const out = applyRentSlash({ bonds, mode: 'advisory', logger }, breach({ breachCount: 1 }));
    const after = bonds.conservation(project);

    expect(out.skipReason).toBe('grace');
    expect(out.slashed).toBe(false);
    expect(out.amountUsd).toBe(0);
    expect(after).toEqual(before);
    expect(logs.info.some((m) => m.includes('breach detected'))).toBe(true);
    expect(logs.info.some((m) => m.includes('within grace'))).toBe(true);
  });

  test('ENFORCE — slashes the right graduated amount AND preserves conservation', () => {
    const bondId = escrowFor(principal, 1.0);
    const before = bonds.conservation(project);

    const out = applyRentSlash({ bonds, mode: 'enforce', logger }, breach({ breachCount: 3 }));
    const after = bonds.conservation(project);

    // breach #3 → 2 steps → 20% of the $1 bond = $0.20 to commons, $0.80 back to wallet.
    expect(out.slashed).toBe(true);
    expect(out.amountUsd).toBeCloseTo(0.2, 6);
    expect(bonds.getBond(bondId).state).toBe('slashed');

    expect(after.commonsUsd).toBeCloseTo(before.commonsUsd + 0.2, 6);
    // wallet: the $0.80 unslashed remainder returns; escrow drops by the full $1.
    expect(after.walletUsd).toBeCloseTo(before.walletUsd + 0.8, 6);
    expect(after.escrowUsd).toBeCloseTo(before.escrowUsd - 1.0, 6);
    // CONSERVATION: supply is invariant across the slash.
    expect(after.supplyUsd).toBeCloseTo(before.supplyUsd, 6);
    expect(after.supplyUsd).toBeCloseTo(after.walletUsd + after.escrowUsd + after.commonsUsd, 9);

    const enforcedLine = logs.warn.find((m) => m.includes('ENFORCED'));
    expect(enforcedLine).toMatch(/slashed \$0\.2000/);
  });

  test('ENFORCE on a first miss does NOT slash (grace holds even in enforce)', () => {
    const bondId = escrowFor(principal, 1.0);
    const before = bonds.conservation(project);
    const out = applyRentSlash({ bonds, mode: 'enforce', logger }, breach({ breachCount: 1 }));
    const after = bonds.conservation(project);

    expect(out.slashed).toBe(false);
    expect(out.skipReason).toBe('grace');
    expect(bonds.getBond(bondId).state).toBe('running');
    expect(after).toEqual(before);
  });

  test('PRINCIPAL TARGETING — slashes ONLY the breaching principal, never a neighbour', () => {
    const victimId = escrowFor('port-daddy:api:innocent-neighbour', 1.0);
    const breacherId = escrowFor(principal, 1.0);

    const out = applyRentSlash({ bonds, mode: 'enforce', logger }, breach({ breachCount: 5 }));

    // The breacher's bond was slashed; the neighbour's is pristine.
    expect(out.bondId).toBe(breacherId);
    expect(bonds.getBond(breacherId).state).toBe('slashed');
    expect(bonds.getBond(victimId).state).toBe('running'); // NOT touched
  });

  test('GRIEFING — a breach naming a principal with no bond cannot slash anyone', () => {
    // The neighbour holds a bond; the (would-be griefed) breacher holds none.
    const neighbourId = escrowFor('port-daddy:api:has-a-bond', 1.0);
    const before = bonds.conservation(project);

    const out = applyRentSlash(
      { bonds, mode: 'enforce', logger },
      breach({ principal: 'port-daddy:api:no-bond-here', breachCount: 9 }),
    );
    const after = bonds.conservation(project);

    expect(out.slashed).toBe(false);
    expect(out.skipReason).toBe('no-active-bond');
    expect(out.bondId).toBe(null);
    // The neighbour's bond and the whole ledger are untouched — no collateral slash.
    expect(bonds.getBond(neighbourId).state).toBe('running');
    expect(after).toEqual(before);
    expect(logs.warn.some((m) => m.includes('no active bond'))).toBe(true);
  });

  test('an already-resolved bond is not double-slashed (idempotent under enforce)', () => {
    const bondId = escrowFor(principal, 1.0);
    bonds.refund(bondId); // the bond is gone (refunded on clean exit)
    const before = bonds.conservation(project);

    const out = applyRentSlash({ bonds, mode: 'enforce', logger }, breach({ breachCount: 4 }));
    const after = bonds.conservation(project);

    // The refunded bond is no longer "live", so it isn't even resolved as a target.
    expect(out.slashed).toBe(false);
    expect(out.skipReason).toBe('no-active-bond');
    expect(after).toEqual(before);
  });

  test('ENFORCE escalation across repeated breaches keeps conservation each time', () => {
    // Three successive breaches, each against a fresh bond (a re-escrowed
    // principal), at rising breach counts. Conservation must hold after each.
    for (const n of [2, 3, 4]) {
      const id = escrowFor(principal, 1.0);
      const before = bonds.conservation(project);
      const out = applyRentSlash({ bonds, mode: 'enforce', logger }, breach({ breachCount: n }));
      const after = bonds.conservation(project);

      expect(out.slashed).toBe(true);
      expect(bonds.getBond(id).state).toBe('slashed');
      // expected fraction = 0.10 * (n - 1), capped at 0.50
      const expectedFraction = Math.min(0.1 * (n - 1), 0.5);
      expect(out.amountUsd).toBeCloseTo(expectedFraction, 6);
      expect(after.supplyUsd).toBeCloseTo(before.supplyUsd, 6);
      expect(after.supplyUsd).toBeCloseTo(after.walletUsd + after.escrowUsd + after.commonsUsd, 9);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Breach ledger — escalation memory; first-miss-vs-repeated; graduated decay.
// ─────────────────────────────────────────────────────────────────────────────
describe('createRentBreachLedger — escalation memory, graduated (not grim)', () => {
  let db;
  let ledger;
  const project = 'port-daddy';
  const principal = 'port-daddy:api:main';
  const t0 = 1_700_000_000_000;

  beforeEach(() => {
    db = createTestDb();
    ledger = createRentBreachLedger(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  test('first breach returns 1 (first miss); repeats increment monotonically', () => {
    expect(ledger.recordBreach(principal, project, t0)).toBe(1);
    expect(ledger.recordBreach(principal, project, t0 + 1000)).toBe(2);
    expect(ledger.recordBreach(principal, project, t0 + 2000)).toBe(3);
    expect(ledger.getState(principal).breachCount).toBe(3);
  });

  test('first-miss-vs-repeated: the count is exactly what drives slash escalation', () => {
    // The ledger count feeds computeRentSlash; first miss → grace, repeats → slash.
    const c1 = ledger.recordBreach(principal, project, t0);
    expect(computeRentSlash({ principal, project, breachCount: c1, commitsWithoutNote: 1 }).shouldSlash)
      .toBe(false); // first miss: grace
    const c2 = ledger.recordBreach(principal, project, t0 + 1000);
    expect(computeRentSlash({ principal, project, breachCount: c2, commitsWithoutNote: 1 }).shouldSlash)
      .toBe(true); // repeated: slash
  });

  test('cure decays the count toward zero (graduated, not grim)', () => {
    ledger.recordBreach(principal, project, t0);
    ledger.recordBreach(principal, project, t0 + 1000);
    ledger.recordBreach(principal, project, t0 + 2000); // count 3
    expect(ledger.cure(principal, t0 + 3000)).toBe(2);
    expect(ledger.cure(principal, t0 + 4000)).toBe(1);
    expect(ledger.cure(principal, t0 + 5000)).toBe(0);
    // A sustained cooperator is walked all the way back to a clean slate.
    expect(ledger.cure(principal, t0 + 6000)).toBe(0); // floors at 0, never negative
  });

  test('curing back to a clean slate means the next breach is a fresh first miss', () => {
    ledger.recordBreach(principal, project, t0); // 1
    ledger.recordBreach(principal, project, t0 + 1000); // 2
    ledger.cure(principal, t0 + 2000); // back to 1
    ledger.cure(principal, t0 + 3000); // back to 0 (clean)
    // After full de-escalation, the principal re-enters at the grace tier: the
    // next breach increments 0 → 1, a fresh first miss (which computeRentSlash
    // treats as grace — no fine).
    const next = ledger.recordBreach(principal, project, t0 + 4000);
    expect(next).toBe(1);
    expect(computeRentSlash({ principal, project, breachCount: next, commitsWithoutNote: 1 }).shouldSlash)
      .toBe(false);
  });

  test('a breach past the reset window starts fresh (no eternal grudge)', () => {
    ledger.recordBreach(principal, project, t0); // 1
    const lastEvent = t0 + 1000;
    ledger.recordBreach(principal, project, lastEvent); // 2
    // Staleness is measured from the LAST event, so go a window+ past that.
    const farLater = lastEvent + DEFAULT_RENT_BREACH_LEDGER_POLICY.resetWindowMs + 1;
    expect(ledger.recordBreach(principal, project, farLater)).toBe(1); // reset
    expect(ledger.getState(principal).firstBreachAt).toBe(farLater);
  });

  test('escalation is per-principal — one principal breaching does not count against another', () => {
    ledger.recordBreach('port-daddy:api:a', project, t0);
    ledger.recordBreach('port-daddy:api:a', project, t0 + 1000);
    expect(ledger.recordBreach('port-daddy:api:b', project, t0 + 2000)).toBe(1); // b's first miss
    expect(ledger.getState('port-daddy:api:a').breachCount).toBe(2);
    expect(ledger.getState('port-daddy:api:b').breachCount).toBe(1);
  });

  test('curing an unknown principal is a no-op returning 0', () => {
    expect(ledger.cure('never-breached', t0)).toBe(0);
    expect(ledger.getState('never-breached')).toBe(null);
  });

  test('a non-finite clock is rejected (Law 1: caller supplies a real clock)', () => {
    expect(() => ledger.recordBreach(principal, project, NaN)).toThrow(/Law 1/);
    expect(() => ledger.cure(principal, Infinity)).toThrow(/Law 1/);
  });
});
