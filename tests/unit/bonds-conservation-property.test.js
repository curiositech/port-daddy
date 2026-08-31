/**
 * tests/unit/bonds-conservation-property.test.js
 *
 * Property-based test for Bonded Commons §7.x No-Overdraft Lemma and
 * Conservation invariant — exercised against the REAL lib/bonds.ts code.
 *
 * Why fast-check, not Kani
 *   The Conservation Theorem TLA+ spec at whitepaper/formal/tla/bonded-conservation/
 *   models the abstract operations. The No-Overdraft Lemma additionally
 *   appeals to better-sqlite3's transaction isolation. Kani is the right
 *   tool for Rust; lib/bonds.ts is TypeScript hitting SQLite. The right
 *   tool here is property-based testing of the actual implementation,
 *   so the proof object is "the real code under random sequences of real
 *   operations holds the invariant" rather than "an abstraction of the
 *   real code holds it."
 *
 * Invariants under test
 *   (I1) Conservation: walletUsd + escrowUsd + commonsUsd === supplyUsd
 *        at all times, after every operation.
 *   (I2) No-Overdraft: an escrow never succeeds against insufficient
 *        wallet balance; wallet balance never goes negative.
 *   (I3) Slash splits faithfully: portionUsd capped at bondUsd; the
 *        unslashed portion returns to wallet, the slashed portion goes
 *        to commons.
 *   (I4) Refund is idempotent on already-terminated bonds (refund of a
 *        refunded or slashed bond returns false; no double-credit).
 *
 * The test runs ~100 property cases by default; bump fc.assert with
 * { numRuns: 1000 } locally to harden.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fc from 'fast-check';
import { createTestDb } from '../setup-unit.js';
import { createBonds } from '../../lib/bonds.js';

describe('lib/bonds.ts — No-Overdraft + Conservation properties', () => {
  let db;
  let bonds;
  const project = 'prop-test';

  beforeEach(() => {
    db = createTestDb();
    bonds = createBonds(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  function checkConservation(label) {
    const c = bonds.conservation(project);
    expect(c.supplyUsd).toBe(c.walletUsd + c.escrowUsd + c.commonsUsd);
    expect(c.walletUsd).toBeGreaterThanOrEqual(0);
    expect(c.escrowUsd).toBeGreaterThanOrEqual(0);
    expect(c.commonsUsd).toBeGreaterThanOrEqual(0);
    return c;
  }

  test('Conservation holds under random sequences of bond operations', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              op: fc.constant('topUp'),
              usd: fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
            }),
            fc.record({
              op: fc.constant('escrow'),
              agentIdx: fc.integer({ min: 0, max: 4 }),
              bondUsd: fc.double({ min: 0.01, max: 50, noNaN: true, noDefaultInfinity: true }),
            }),
            fc.record({
              op: fc.constant('refund'),
              bondIdx: fc.integer({ min: 0, max: 9 }),
            }),
            fc.record({
              op: fc.constant('slash'),
              bondIdx: fc.integer({ min: 0, max: 9 }),
              portionUsd: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
            }),
          ),
          { minLength: 1, maxLength: 30 },
        ),
        (operations) => {
          // Fresh DB per property case.
          if (db) db.close();
          db = createTestDb();
          bonds = createBonds(db);
          const liveBondIds = [];

          for (const op of operations) {
            switch (op.op) {
              case 'topUp':
                bonds.topUpWallet(project, op.usd);
                break;
              case 'escrow': {
                const r = bonds.escrow({
                  project,
                  agentId: `agent-${op.agentIdx}`,
                  bondUsd: op.bondUsd,
                });
                if (r.ok) {
                  liveBondIds.push(r.id);
                  // (I2) wallet must not be negative
                  const c = bonds.conservation(project);
                  expect(c.walletUsd).toBeGreaterThanOrEqual(0);
                } else {
                  // (I2) refusal must come from a known reason
                  expect([
                    'insufficient-balance',
                    'invalid-amount',
                    'wallet-not-found',
                    'ceiling-exceeded',
                  ]).toContain(r.reason);
                }
                break;
              }
              case 'refund': {
                if (liveBondIds.length === 0) break;
                const id = liveBondIds[op.bondIdx % liveBondIds.length];
                bonds.refund(id);
                break;
              }
              case 'slash': {
                if (liveBondIds.length === 0) break;
                const id = liveBondIds[op.bondIdx % liveBondIds.length];
                bonds.slash(id, op.portionUsd, 'property-test slash');
                break;
              }
            }

            // (I1) Conservation must hold after EVERY operation.
            checkConservation(op.op);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('No-Overdraft: escrow against insufficient balance is refused', () => {
    bonds.topUpWallet(project, 10);
    const ok = bonds.escrow({ project, agentId: 'a', bondUsd: 5 });
    expect(ok.ok).toBe(true);

    const overdraft = bonds.escrow({ project, agentId: 'b', bondUsd: 100 });
    expect(overdraft.ok).toBe(false);
    if (overdraft.ok === false) {
      expect(overdraft.reason).toBe('insufficient-balance');
    }

    const c = bonds.conservation(project);
    expect(c.walletUsd).toBe(5); // 10 - 5, not 10 - 5 - 100
    expect(c.escrowUsd).toBe(5);
    expect(c.commonsUsd).toBe(0);
    expect(c.supplyUsd).toBe(10);
  });

  test('No-Overdraft holds under randomized sequences (focused property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            wallet: fc.double({ min: 0.01, max: 50, noNaN: true, noDefaultInfinity: true }),
            tries: fc.array(
              fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
              { minLength: 1, maxLength: 10 },
            ),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (rounds) => {
          if (db) db.close();
          db = createTestDb();
          bonds = createBonds(db);

          for (const round of rounds) {
            bonds.topUpWallet(project, round.wallet);
            for (const bondUsd of round.tries) {
              const before = bonds.conservation(project);
              const r = bonds.escrow({ project, agentId: 'a', bondUsd });
              const after = bonds.conservation(project);
              if (r.ok) {
                // Successful escrow: wallet went down by exactly bondUsd,
                // escrow went up by exactly bondUsd, supply unchanged.
                expect(after.walletUsd).toBeCloseTo(before.walletUsd - bondUsd, 6);
                expect(after.escrowUsd).toBeCloseTo(before.escrowUsd + bondUsd, 6);
                expect(after.supplyUsd).toBeCloseTo(before.supplyUsd, 6);
              } else {
                // Failed escrow: nothing moved.
                expect(after.walletUsd).toBeCloseTo(before.walletUsd, 6);
                expect(after.escrowUsd).toBeCloseTo(before.escrowUsd, 6);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('Slash splits the bond between commons (slashed) and wallet (refunded)', () => {
    bonds.topUpWallet(project, 10);
    const r = bonds.escrow({ project, agentId: 'a', bondUsd: 4 });
    expect(r.ok).toBe(true);

    const before = bonds.conservation(project);
    bonds.slash(r.id, 1, 'partial');
    const after = bonds.conservation(project);

    // Slash 1 of a 4-bond → 3 refunded to wallet, 1 to commons.
    expect(after.walletUsd).toBeCloseTo(before.walletUsd + 3, 6);
    expect(after.escrowUsd).toBeCloseTo(before.escrowUsd - 4, 6);
    expect(after.commonsUsd).toBeCloseTo(before.commonsUsd + 1, 6);
    expect(after.supplyUsd).toBeCloseTo(before.supplyUsd, 6);
  });

  test('Slash with portion > bondUsd caps at bondUsd', () => {
    bonds.topUpWallet(project, 10);
    const r = bonds.escrow({ project, agentId: 'a', bondUsd: 4 });
    bonds.slash(r.id, 999, 'over-the-top');
    const c = bonds.conservation(project);
    expect(c.commonsUsd).toBe(4);
    expect(c.walletUsd).toBe(6);
    expect(c.escrowUsd).toBe(0);
    expect(c.supplyUsd).toBe(10);
  });

  test('Refund of an already-refunded bond is idempotent (no double-credit)', () => {
    bonds.topUpWallet(project, 10);
    const r = bonds.escrow({ project, agentId: 'a', bondUsd: 3 });
    expect(bonds.refund(r.id)).toBe(true);
    const after1 = bonds.conservation(project);

    expect(bonds.refund(r.id)).toBe(false);
    const after2 = bonds.conservation(project);

    expect(after2.walletUsd).toBe(after1.walletUsd);
    expect(after2.escrowUsd).toBe(after1.escrowUsd);
    expect(after2.supplyUsd).toBe(after1.supplyUsd);
  });

  test('Slash of an already-refunded bond is rejected (no double-spend)', () => {
    bonds.topUpWallet(project, 10);
    const r = bonds.escrow({ project, agentId: 'a', bondUsd: 3 });
    bonds.refund(r.id);
    const before = bonds.conservation(project);
    expect(bonds.slash(r.id, 1, 'too late')).toBe(false);
    const after = bonds.conservation(project);
    expect(after).toEqual(before);
  });
});
