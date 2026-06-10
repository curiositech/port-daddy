/**
 * The compulsion — coordination is the price of the sandbox (ADR-0050).
 *
 * Locks the mechanism-design keystone: a voyage keeps its Coast-Guard sandbox
 * only while it pays coordination rent. These tests pin the verdict priority
 * (owing a note outranks drift/idle), the reclaim safety gate (the live main
 * checkout is NEVER reclaimable), and the honesty contract (no reason string
 * names a bypass).
 */

import { describe, test, expect } from '@jest/globals';
import {
  evaluateLeaseRent,
  isReclaimableSandbox,
  shouldReclaim,
  DEFAULT_RENT_POLICY,
} from '../../lib/coast-guard/compulsion.js';

/** A fully-paid lease: committed, every commit noted, recently active, rebased. */
function paidFacts(over = {}) {
  return {
    commitsSinceLastNote: 0,
    commitsTotal: 3,
    notesTotal: 3,
    claimsTotal: 2,
    commitsBehindBase: 1,
    ageMs: 5 * 60 * 1000,
    lastSignalAgeMs: 60 * 1000,
    ...over,
  };
}

describe('evaluateLeaseRent — commit ⇒ note publish (the load-bearing rule)', () => {
  test('a paid lease is allowed', () => {
    const e = evaluateLeaseRent(paidFacts());
    expect(e.verdict).toBe('paid');
    expect(e.action).toBe('allow');
    expect(e.rentDue.commitsWithoutNote).toBe(0);
  });

  test('a commit with no note blocks the next commit', () => {
    const e = evaluateLeaseRent(paidFacts({ commitsSinceLastNote: 1 }));
    expect(e.verdict).toBe('rent-due');
    expect(e.action).toBe('block-commit');
    expect(e.rentDue.commitsWithoutNote).toBe(1);
    expect(e.reason).toMatch(/pd note/);
  });

  test('rent-due outranks every reclaim state (priority order)', () => {
    // Simultaneously owing a note AND idle AND drifted — the active debt wins.
    const e = evaluateLeaseRent(
      paidFacts({
        commitsSinceLastNote: 2,
        notesTotal: 0,
        claimsTotal: 0,
        ageMs: 99 * 60 * 1000,
        commitsBehindBase: 999,
        lastSignalAgeMs: 99 * 60 * 60 * 1000,
      }),
    );
    expect(e.verdict).toBe('rent-due');
    expect(e.action).toBe('block-commit');
  });

  test('negative commitsSinceLastNote is clamped to zero (never owes negative rent)', () => {
    const e = evaluateLeaseRent(paidFacts({ commitsSinceLastNote: -5 }));
    expect(e.verdict).toBe('paid');
    expect(e.rentDue.commitsWithoutNote).toBe(0);
  });
});

describe('evaluateLeaseRent — feed suggestibility (idle reclaim)', () => {
  test('zero notes + zero claims past the grace window is idle → reclaim', () => {
    const e = evaluateLeaseRent(
      paidFacts({ notesTotal: 0, claimsTotal: 0, ageMs: DEFAULT_RENT_POLICY.idleGraceMs + 1 }),
    );
    expect(e.verdict).toBe('idle');
    expect(e.action).toBe('reclaim');
  });

  test('a freshly-started dark lease inside the grace window is still paid (cold ≠ dead)', () => {
    const e = evaluateLeaseRent(
      paidFacts({ notesTotal: 0, claimsTotal: 0, ageMs: DEFAULT_RENT_POLICY.idleGraceMs - 1 }),
    );
    expect(e.verdict).toBe('paid');
  });

  test('a single claim is enough signal to keep an old lease', () => {
    const e = evaluateLeaseRent(
      paidFacts({ notesTotal: 0, claimsTotal: 1, ageMs: 99 * 60 * 1000 }),
    );
    expect(e.verdict).toBe('paid');
  });
});

describe('evaluateLeaseRent — stay rebased (stale reclaim)', () => {
  test('far behind AND long-silent is stale → reclaim', () => {
    const e = evaluateLeaseRent(
      paidFacts({
        commitsBehindBase: DEFAULT_RENT_POLICY.maxCommitsBehind + 1,
        lastSignalAgeMs: DEFAULT_RENT_POLICY.staleSignalMs + 1,
      }),
    );
    expect(e.verdict).toBe('stale');
    expect(e.action).toBe('reclaim');
  });

  test('far behind but recently active is NOT reclaimed (busy coordinating lease)', () => {
    const e = evaluateLeaseRent(
      paidFacts({
        commitsBehindBase: DEFAULT_RENT_POLICY.maxCommitsBehind + 50,
        lastSignalAgeMs: 60 * 1000,
      }),
    );
    expect(e.verdict).toBe('paid');
  });

  test('long-silent but rebased is NOT reclaimed on drift alone', () => {
    const e = evaluateLeaseRent(
      paidFacts({ commitsBehindBase: 0, lastSignalAgeMs: DEFAULT_RENT_POLICY.staleSignalMs + 1 }),
    );
    expect(e.verdict).toBe('paid');
  });
});

describe('isReclaimableSandbox — the safety gate (NEVER the live main checkout)', () => {
  const gate = { scratchRoot: '/Users/op/coding/tmp' };

  test('the main worktree is NEVER reclaimable, even inside the scratch root', () => {
    expect(
      isReclaimableSandbox(
        { worktreePath: '/Users/op/coding/tmp/whatever', isMainWorktree: true, branch: 'x' },
        gate,
      ),
    ).toBe(false);
  });

  test('a disposable sandbox under the scratch root is reclaimable', () => {
    expect(
      isReclaimableSandbox(
        { worktreePath: '/Users/op/coding/tmp/sortie-123', isMainWorktree: false, branch: 'voyage/x' },
        gate,
      ),
    ).toBe(true);
  });

  test('a worktree OUTSIDE the scratch root is never reclaimable', () => {
    expect(
      isReclaimableSandbox(
        { worktreePath: '/Users/op/coding/port-daddy', isMainWorktree: false, branch: 'feat/x' },
        gate,
      ),
    ).toBe(false);
  });

  test('the scratch root itself is not a sandbox (must be strictly inside)', () => {
    expect(
      isReclaimableSandbox(
        { worktreePath: '/Users/op/coding/tmp', isMainWorktree: false, branch: 'x' },
        gate,
      ),
    ).toBe(false);
  });

  test('a path that only prefix-matches the root string is rejected (no /tmp-evil)', () => {
    expect(
      isReclaimableSandbox(
        { worktreePath: '/Users/op/coding/tmp-evil/x', isMainWorktree: false, branch: 'x' },
        gate,
      ),
    ).toBe(false);
  });
});

describe('shouldReclaim — verdict AND gate must both agree before any teardown', () => {
  const gate = { scratchRoot: '/Users/op/coding/tmp' };
  const disposable = {
    worktreePath: '/Users/op/coding/tmp/sortie-1',
    isMainWorktree: false,
    branch: 'voyage/x',
  };

  test('reclaim verdict + disposable sandbox → reclaim', () => {
    const e = evaluateLeaseRent(paidFacts({ notesTotal: 0, claimsTotal: 0, ageMs: 99 * 60 * 1000 }));
    expect(e.action).toBe('reclaim');
    expect(shouldReclaim(e, disposable, gate)).toBe(true);
  });

  test('reclaim verdict on the MAIN checkout → never reclaim', () => {
    const e = evaluateLeaseRent(paidFacts({ notesTotal: 0, claimsTotal: 0, ageMs: 99 * 60 * 1000 }));
    const main = { worktreePath: '/Users/op/coding/port-daddy', isMainWorktree: true, branch: 'main' };
    expect(shouldReclaim(e, main, gate)).toBe(false);
  });

  test('paid verdict never reclaims, even a disposable sandbox', () => {
    const e = evaluateLeaseRent(paidFacts());
    expect(shouldReclaim(e, disposable, gate)).toBe(false);
  });
});

describe('honesty contract', () => {
  test('no reason string names a bypass flag', () => {
    const samples = [
      evaluateLeaseRent(paidFacts({ commitsSinceLastNote: 1 })),
      evaluateLeaseRent(paidFacts({ notesTotal: 0, claimsTotal: 0, ageMs: 99 * 60 * 1000 })),
      evaluateLeaseRent(
        paidFacts({
          commitsBehindBase: 999,
          lastSignalAgeMs: DEFAULT_RENT_POLICY.staleSignalMs + 1,
        }),
      ),
    ];
    for (const s of samples) {
      expect(s.reason).not.toMatch(/--allow|--no-verify|--force|bypass|override|PD_[A-Z_]*OFF/i);
    }
  });
});
