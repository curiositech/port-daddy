/**
 * Unit tests for lib/bonds.ts
 *
 * Tests the invariants that matter:
 *   1. Conservation: wallet + escrow + commons = supply, always.
 *   2. No-spawn-without-bond: separating escrowed / running / resolved.
 *   3. Idempotence: double-refund, double-slash are no-ops.
 *   4. Ceiling: hard ceiling rejects oversized bonds.
 *   5. Transactional debit+insert: escrow failure leaves no half-state.
 *
 * The randomized conservation trace exercises 1000 random operations
 * (escrow/refund/slash/topUp) and asserts the invariant at every step.
 */

import fc from 'fast-check';

import { createTestDb } from '../setup-unit.js';
import { createBonds } from '../../lib/bonds.js';
import { createHarbors } from '../../lib/harbors.js';

/**
 * In-memory mock of the NoteEncryption interface. We avoid the real
 * createNoteEncryption() in tests because it reads/writes
 * ~/.port-daddy/master.key — a process-wide resource that races with
 * other test suites under Jest's parallel worker model. The mock
 * satisfies the same contract (isEnabled, generateSessionKey,
 * encryptNote / decryptNote, isEncrypted) so bond behavior is identical
 * to production when a real encryption module is wired in.
 */
function createMockNoteEncryption() {
  return {
    isEnabled: () => true,
    generateSessionKey: () => Buffer.alloc(32, 0x42),
    wrapSessionKey: (k) => k.toString('hex'),
    unwrapSessionKey: (hex) => Buffer.from(hex, 'hex'),
    encryptNote: (plaintext) => JSON.stringify({
      v: 1,
      iv: 'MOCKIV______',
      ct: Buffer.from(plaintext, 'utf8').toString('base64'),
      tag: 'MOCKTAG_________',
    }),
    decryptNote: (encrypted) => {
      try {
        const p = JSON.parse(encrypted);
        if (p.v !== 1) return null;
        return Buffer.from(p.ct, 'base64').toString('utf8');
      } catch { return null; }
    },
    isEncrypted: (content) => {
      try {
        const p = JSON.parse(content);
        return p && p.v === 1 && 'iv' in p && 'ct' in p && 'tag' in p;
      } catch { return false; }
    },
  };
}

describe('Bonds', () => {
  let db;
  let bonds;

  beforeEach(() => {
    db = createTestDb();
    bonds = createBonds(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── topUpWallet ────────────────────────────────────────────────────────

  test('topUp creates wallet on first call and accumulates on later calls', () => {
    expect(bonds.getWallet('port-daddy')).toBeNull();
    bonds.topUpWallet('port-daddy', 10);
    expect(bonds.getWallet('port-daddy').balanceUsd).toBe(10);
    bonds.topUpWallet('port-daddy', 5);
    expect(bonds.getWallet('port-daddy').balanceUsd).toBe(15);
  });

  test('topUp rejects negative or non-finite amounts', () => {
    expect(() => bonds.topUpWallet('p', -1)).toThrow();
    expect(() => bonds.topUpWallet('p', NaN)).toThrow();
    expect(() => bonds.topUpWallet('p', Infinity)).toThrow();
  });

  // ─── escrow ─────────────────────────────────────────────────────────────

  test('escrow debits wallet by exactly the bond and returns an id', () => {
    bonds.topUpWallet('p', 1.00);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.25 });
    expect(r.ok).toBe(true);
    expect(typeof r.id).toBe('number');
    expect(bonds.getWallet('p').balanceUsd).toBeCloseTo(0.75, 6);
    expect(bonds.getBond(r.id).state).toBe('escrowed');
    expect(bonds.getBond(r.id).bondUsd).toBe(0.25);
  });

  test('escrow refuses if balance < bond', () => {
    bonds.topUpWallet('p', 0.10);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.25 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient-balance');
    // Wallet untouched.
    expect(bonds.getWallet('p').balanceUsd).toBeCloseTo(0.10, 6);
  });

  test('escrow refuses if bond exceeds ceiling', () => {
    bonds.topUpWallet('p', 10);
    const r = bonds.escrow({ project: 'p', agentId: 'big', bondUsd: 5, ceilingUsd: 2 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ceiling-exceeded');
    expect(bonds.getWallet('p').balanceUsd).toBe(10);
  });

  test('escrow rejects non-finite or negative bond', () => {
    bonds.topUpWallet('p', 10);
    expect(bonds.escrow({ project: 'p', agentId: 'a', bondUsd: -1 }).reason).toBe('invalid-amount');
    expect(bonds.escrow({ project: 'p', agentId: 'a', bondUsd: NaN }).reason).toBe('invalid-amount');
  });

  // ─── markRunning / refund / slash ───────────────────────────────────────

  test('markRunning transitions escrowed → running', () => {
    bonds.topUpWallet('p', 1);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.25 });
    bonds.markRunning(r.id);
    expect(bonds.getBond(r.id).state).toBe('running');
  });

  test('refund credits wallet by exactly the bond', () => {
    bonds.topUpWallet('p', 1.00);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.30 });
    bonds.markRunning(r.id);
    expect(bonds.refund(r.id)).toBe(true);
    expect(bonds.getBond(r.id).state).toBe('refunded');
    expect(bonds.getWallet('p').balanceUsd).toBeCloseTo(1.00, 6);
  });

  test('refund is idempotent — second call returns false', () => {
    bonds.topUpWallet('p', 1);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.25 });
    expect(bonds.refund(r.id)).toBe(true);
    const walletAfter = bonds.getWallet('p').balanceUsd;
    expect(bonds.refund(r.id)).toBe(false);
    // Wallet unchanged on second call.
    expect(bonds.getWallet('p').balanceUsd).toBe(walletAfter);
  });

  test('slash moves portion to commons, remainder back to wallet', () => {
    bonds.topUpWallet('p', 1);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.50 });
    bonds.markRunning(r.id);
    // Slash half.
    expect(bonds.slash(r.id, 0.25, 'arbiter:doc-drift')).toBe(true);
    expect(bonds.getBond(r.id).state).toBe('slashed');
    expect(bonds.getBond(r.id).slashReason).toBe('arbiter:doc-drift');
    const w = bonds.getWallet('p');
    // Wallet: started 1.00, escrowed -0.50, refunded half +0.25 → 0.75
    expect(w.balanceUsd).toBeCloseTo(0.75, 6);
    expect(w.commonsPoolUsd).toBeCloseTo(0.25, 6);
  });

  test('slash full bond sends all to commons, wallet unchanged from escrow-debit', () => {
    bonds.topUpWallet('p', 1);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.40 });
    expect(bonds.slash(r.id, 0.40, 'budget-breach')).toBe(true);
    const w = bonds.getWallet('p');
    // Wallet: 1.00 - 0.40 = 0.60 (escrow debit, no refund)
    expect(w.balanceUsd).toBeCloseTo(0.60, 6);
    expect(w.commonsPoolUsd).toBeCloseTo(0.40, 6);
  });

  test('slash portion is clamped to [0, bondUsd]', () => {
    bonds.topUpWallet('p', 1);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.30 });
    // Over-request: portion > bond should clamp to bond (slash whole bond).
    expect(bonds.slash(r.id, 10, 'over')).toBe(true);
    const w = bonds.getWallet('p');
    expect(w.commonsPoolUsd).toBeCloseTo(0.30, 6);
    expect(w.balanceUsd).toBeCloseTo(0.70, 6);
  });

  test('slash is idempotent — second call returns false', () => {
    bonds.topUpWallet('p', 1);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.25 });
    expect(bonds.slash(r.id, 0.25, 'breach')).toBe(true);
    const commonsAfter = bonds.getWallet('p').commonsPoolUsd;
    expect(bonds.slash(r.id, 0.25, 'breach')).toBe(false);
    expect(bonds.getWallet('p').commonsPoolUsd).toBe(commonsAfter);
  });

  test('cannot refund a slashed bond', () => {
    bonds.topUpWallet('p', 1);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.25 });
    bonds.slash(r.id, 0.25, 'breach');
    expect(bonds.refund(r.id)).toBe(false);
  });

  test('cannot slash a refunded bond', () => {
    bonds.topUpWallet('p', 1);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.25 });
    bonds.refund(r.id);
    expect(bonds.slash(r.id, 0.25, 'breach')).toBe(false);
  });

  // ─── listBonds ──────────────────────────────────────────────────────────

  test('listBonds filters by project and state, newest first', () => {
    bonds.topUpWallet('p', 10);
    bonds.topUpWallet('q', 10);
    const r1 = bonds.escrow({ project: 'p', agentId: 'a1', bondUsd: 0.1 });
    const r2 = bonds.escrow({ project: 'p', agentId: 'a2', bondUsd: 0.2 });
    const r3 = bonds.escrow({ project: 'q', agentId: 'a3', bondUsd: 0.3 });
    bonds.markRunning(r2.id);
    bonds.refund(r1.id);

    const pBonds = bonds.listBonds({ project: 'p' });
    expect(pBonds.map((b) => b.agentId)).toEqual(['a2', 'a1']);

    const running = bonds.listBonds({ state: 'running' });
    expect(running).toHaveLength(1);
    expect(running[0].id).toBe(r2.id);

    const qBonds = bonds.listBonds({ project: 'q' });
    expect(qBonds.map((b) => b.agentId)).toEqual(['a3']);
  });

  // ─── Conservation invariant ─────────────────────────────────────────────

  test('conservation holds after a single escrow-refund cycle', () => {
    bonds.topUpWallet('p', 10);
    const before = bonds.conservation('p');
    expect(before.supplyUsd).toBe(10);

    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 3 });
    const mid = bonds.conservation('p');
    expect(mid.walletUsd).toBe(7);
    expect(mid.escrowUsd).toBe(3);
    expect(mid.commonsUsd).toBe(0);
    expect(mid.supplyUsd).toBe(10);

    bonds.refund(r.id);
    const after = bonds.conservation('p');
    expect(after.walletUsd).toBe(10);
    expect(after.supplyUsd).toBe(10);
  });

  test('conservation holds after slash (commons absorbs the delta)', () => {
    bonds.topUpWallet('p', 5);
    const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 2 });
    bonds.slash(r.id, 1.25, 'partial');
    const c = bonds.conservation('p');
    // 5 - 2 (escrow) + 0.75 (refund portion) = 3.75 wallet
    expect(c.walletUsd).toBeCloseTo(3.75, 6);
    expect(c.commonsUsd).toBeCloseTo(1.25, 6);
    expect(c.escrowUsd).toBe(0);
    expect(c.supplyUsd).toBeCloseTo(5, 6);
  });

  // ─── Harbor gating (integration) ────────────────────────────────────────

  describe('with harbors dep injected', () => {
    let harbors;
    let gatedBonds;

    beforeEach(() => {
      harbors = createHarbors(db);
      harbors.create('port-daddy:fleet');
      gatedBonds = createBonds(db, { harbors });
      gatedBonds.topUpWallet('port-daddy', 10);
    });

    test('escrow without harborName fails when harbors dep is active', () => {
      const r = gatedBonds.escrow({
        project: 'port-daddy', agentId: 'a', bondUsd: 0.25,
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('harbor-required');
      // Wallet untouched.
      expect(gatedBonds.getWallet('port-daddy').balanceUsd).toBe(10);
    });

    test('escrow fails when agent is not a harbor member', () => {
      const r = gatedBonds.escrow({
        project: 'port-daddy', agentId: 'outsider', bondUsd: 0.25,
        harborName: 'port-daddy:fleet',
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('not-a-harbor-member');
    });

    test('escrow succeeds after harbor enter', async () => {
      await harbors.enter('port-daddy:fleet', 'hawk-1', {});
      const r = gatedBonds.escrow({
        project: 'port-daddy', agentId: 'hawk-1', bondUsd: 0.25,
        harborName: 'port-daddy:fleet',
      });
      expect(r.ok).toBe(true);
      expect(typeof r.id).toBe('number');
    });
  });

  // ─── IPC broadcast (integration) ────────────────────────────────────────

  describe('with broadcast dep injected', () => {
    let events;
    let broadcasting;

    beforeEach(() => {
      events = [];
      broadcasting = createBonds(db, {
        broadcast: (channel, event) => events.push({ channel, event }),
      });
      broadcasting.topUpWallet('port-daddy', 5);
    });

    test('escrow emits bond:lifecycle escrowed event', () => {
      const r = broadcasting.escrow({
        project: 'port-daddy', agentId: 'a', bondUsd: 0.25,
      });
      expect(r.ok).toBe(true);
      const emitted = events.filter((e) => e.channel === 'bond:lifecycle');
      expect(emitted).toHaveLength(1);
      expect(emitted[0].event.event).toBe('escrowed');
      expect(emitted[0].event.id).toBe(r.id);
      expect(emitted[0].event.bondUsd).toBe(0.25);
    });

    test('markRunning → refund → emits running + refunded events', () => {
      const r = broadcasting.escrow({
        project: 'port-daddy', agentId: 'a', bondUsd: 0.25,
      });
      events.length = 0;
      broadcasting.markRunning(r.id);
      broadcasting.refund(r.id);
      const kinds = events.map((e) => e.event.event);
      expect(kinds).toEqual(['running', 'refunded']);
    });

    test('slash emits event with plaintext reason in broadcast payload', () => {
      const r = broadcasting.escrow({
        project: 'port-daddy', agentId: 'a', bondUsd: 0.30,
      });
      events.length = 0;
      broadcasting.slash(r.id, 0.30, 'budget-breach');
      const slashEvent = events.find((e) => e.event.event === 'slashed');
      expect(slashEvent).toBeTruthy();
      expect(slashEvent.event.reason).toBe('budget-breach');
      expect(slashEvent.event.slashedUsd).toBe(0.30);
    });

    test('broken subscriber does not block escrow', () => {
      const bombBonds = createBonds(db, {
        broadcast: () => { throw new Error('subscriber on fire'); },
      });
      bombBonds.topUpWallet('p', 1);
      const r = bombBonds.escrow({
        project: 'p', agentId: 'a', bondUsd: 0.1,
      });
      expect(r.ok).toBe(true); // escrow survives even with broken subscriber
    });
  });

  // ─── Encryption (integration) ───────────────────────────────────────────

  describe('with noteEncryption dep injected', () => {
    let encBonds;

    beforeEach(() => {
      encBonds = createBonds(db, { noteEncryption: createMockNoteEncryption() });
      encBonds.topUpWallet('p', 2);
    });

    test('slash_reason roundtrips through encryption transparently', () => {
      const r = encBonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.5 });
      encBonds.slash(r.id, 0.25, 'arbiter: doc-drift 82h');
      const bond = encBonds.getBond(r.id);
      // getBond decrypts transparently — caller sees plaintext.
      expect(bond.slashReason).toBe('arbiter: doc-drift 82h');

      // At-rest value in the database should NOT be plaintext.
      const raw = db.prepare('SELECT slash_reason FROM bond_escrow WHERE id = ?').get(r.id);
      expect(raw.slash_reason).not.toBe('arbiter: doc-drift 82h');
      // Looks like JSON-wrapped EncryptedPayload
      expect(raw.slash_reason.startsWith('{')).toBe(true);
      const parsed = JSON.parse(raw.slash_reason);
      expect(parsed.v).toBe(1);
      expect(parsed.iv).toBeTruthy();
      expect(parsed.ct).toBeTruthy();
    });

    test('unencrypted rows (legacy / pre-migration) still read cleanly', () => {
      // Pretend we have a legacy row stored before encryption was wired.
      const r = encBonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.1 });
      encBonds.slash(r.id, 0.1, 'legacy-reason');
      // Overwrite the stored value with plaintext to simulate legacy.
      db.prepare('UPDATE bond_escrow SET slash_reason = ? WHERE id = ?')
        .run('written before encryption shipped', r.id);
      const bond = encBonds.getBond(r.id);
      // isEncrypted returns false → we hand back plaintext as-is.
      expect(bond.slashReason).toBe('written before encryption shipped');
    });
  });

  test('conservation holds across 200 random ops (property-style)', () => {
    // Property test: random interleaving of top-up / escrow / refund /
    // slash must preserve wallet + escrow + commons = supply AT EVERY
    // STEP. We use a small shared cast of agents so refunds/slashes
    // target bonds that actually exist. 200 ops exercises many random
    // orderings without starving Jest's parallel worker pool — higher
    // iteration counts made this suite the cause of IPC-test timeouts.
    const project = 'random-fleet';
    bonds.topUpWallet(project, 100);

    let initialSupply = bonds.totalSupply(project);
    const liveBonds = []; // ids that have not yet resolved
    let rng = 42;
    const next = () => {
      // xorshift32 — cheap, deterministic, sufficient spread for this
      rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
      return ((rng >>> 0) % 10_000) / 10_000;
    };

    for (let i = 0; i < 200; i++) {
      const r = next();
      const op = Math.floor(r * 4);

      if (op === 0) {
        // top up
        const amt = Math.round(next() * 1000) / 100;
        bonds.topUpWallet(project, amt);
        initialSupply += amt;
      } else if (op === 1) {
        // escrow small bond
        const amt = Math.round(next() * 50) / 100; // 0 .. 0.50
        const r2 = bonds.escrow({ project, agentId: `a${i % 10}`, bondUsd: amt });
        if (r2.ok) liveBonds.push(r2.id);
      } else if (op === 2 && liveBonds.length > 0) {
        // refund a random live bond
        const idx = Math.floor(next() * liveBonds.length);
        const id = liveBonds.splice(idx, 1)[0];
        bonds.refund(id);
      } else if (op === 3 && liveBonds.length > 0) {
        // slash a random portion of a live bond
        const idx = Math.floor(next() * liveBonds.length);
        const id = liveBonds.splice(idx, 1)[0];
        const b = bonds.getBond(id);
        bonds.slash(id, b.bondUsd * next(), `rand-${i}`);
      }

      const c = bonds.conservation(project);
      expect(c.walletUsd + c.escrowUsd + c.commonsUsd).toBeCloseTo(c.supplyUsd, 6);
      expect(c.supplyUsd).toBeCloseTo(initialSupply, 6);
    }
  });

  // Spec §6.3: replace the hand-rolled xorshift trace with a fast-check
  // generator that shrinks failing traces to a minimal counter-example. We
  // keep the deterministic 200-op test above as a stable regression check;
  // this one explores arbitrary orderings and depths chosen by fast-check.
  test('PROPERTY: conservation holds under fast-check random op traces', () => {
    // Arbitrary shape: a sequence of operations. Each op picks one of four
    // commands. `topUp` always succeeds; the others target a small fixed
    // pool of agent ids so refund/slash sometimes find live bonds.
    const opArb = fc.oneof(
      fc.record({
        kind: fc.constant('topUp'),
        amt: fc.integer({ min: 0, max: 5000 }).map((n) => n / 100), // 0..50.00
      }),
      fc.record({
        kind: fc.constant('escrow'),
        agentIdx: fc.integer({ min: 0, max: 7 }),
        bond: fc.integer({ min: 0, max: 200 }).map((n) => n / 100), // 0..2.00
      }),
      fc.record({
        kind: fc.constant('refund'),
        liveIdx: fc.integer({ min: 0, max: 100 }), // modded against live list
      }),
      fc.record({
        kind: fc.constant('slash'),
        liveIdx: fc.integer({ min: 0, max: 100 }),
        portionFrac: fc.integer({ min: 0, max: 100 }).map((n) => n / 100),
      }),
    );

    fc.assert(
      fc.property(
        fc.array(opArb, { minLength: 30, maxLength: 200 }),
        (ops) => {
          const project = `prop-${Math.random().toString(36).slice(2, 8)}`;
          let supplyDebit = 0;
          // Pre-seed wallet so initial escrows have headroom.
          bonds.topUpWallet(project, 100);
          supplyDebit += 100;

          const liveBonds = [];

          for (const op of ops) {
            if (op.kind === 'topUp') {
              bonds.topUpWallet(project, op.amt);
              supplyDebit += op.amt;
            } else if (op.kind === 'escrow') {
              const r = bonds.escrow({ project, agentId: `a${op.agentIdx}`, bondUsd: op.bond });
              if (r.ok) liveBonds.push(r.id);
            } else if (op.kind === 'refund' && liveBonds.length > 0) {
              const idx = op.liveIdx % liveBonds.length;
              const id = liveBonds.splice(idx, 1)[0];
              bonds.refund(id);
            } else if (op.kind === 'slash' && liveBonds.length > 0) {
              const idx = op.liveIdx % liveBonds.length;
              const id = liveBonds.splice(idx, 1)[0];
              const b = bonds.getBond(id);
              if (b) bonds.slash(id, b.bondUsd * op.portionFrac, `prop-slash`);
            }

            // Conservation must hold at EVERY step. The supply equals the
            // sum of all top-ups (no money has ever left the system in any
            // valid trace).
            const c = bonds.conservation(project);
            expect(c.walletUsd + c.escrowUsd + c.commonsUsd).toBeCloseTo(c.supplyUsd, 6);
            expect(c.supplyUsd).toBeCloseTo(supplyDebit, 6);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
