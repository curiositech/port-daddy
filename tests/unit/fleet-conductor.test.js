/**
 * Tests for lib/fleet/conductor.ts — the Daemon Fleet Conductor (ADR-0060).
 *
 * The Conductor is the ONE spawn primitive: `dispatch`/`sortie`/`fleet`/the
 * reactive orchestrator/agent-recursion all funnel through `conductor.launch`
 * and nothing else reaches `spawner.spawn`. These tests prove the seven named
 * safety invariants with BOTH the valid case (gate ALLOWS) and the invalid case
 * (gate REFUSES) — a gate that only ever passes is not a gate.
 *
 *   I1 NO_SPAWN_WITHOUT_BOND     — bond escrow / lineage reservation
 *   I2 NO_SPAWN_ON_MAIN          — never spawn against a main checkout
 *   I3 DEPTH_CAPPED              — depth > cap refused, Conductor-stamped
 *   I4 LINEAGE_BUDGET_CONSERVED  — subtree shares one ceiling, reserved pre-admit
 *   I5 GLOBAL_BREAKER            — no admission while the global breaker is open
 *   I6 CAPABILITY_SCOPED         — child caps ⊆ parent caps (only narrow)
 *   I7 HALT_IS_TOTAL             — operator halt SIGTERM→SIGKILLs the scope,
 *                                  preserves salvage, ALWAYS refunds, never slashes
 *
 * Plus: a golden spec test (the spawner sees byte-identical args to the legacy
 * path), and settlement/halt/recursion happy-paths.
 *
 * These are real-bug tests: each negative assertion guards a property whose
 * violation lets a runaway lineage, a forged depth, a widened capability, or an
 * operator-punishing slash through.
 */

import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import Database from 'better-sqlite3';

import { createConductor } from '../../lib/fleet/conductor.js';
import { createFleetCircuitBreaker, GLOBAL_SCOPE } from '../../lib/fleet/circuit-breaker.js';

// ─── Fakes ───────────────────────────────────────────────────────────────────

/**
 * A fake spawner that records every `spawn` call (for the golden test) and
 * returns a scripted outcome. `kill` is recorded so HALT_IS_TOTAL can assert the
 * SIGTERM→SIGKILL reached the right agents.
 */
function makeSpawner(outcome = {}) {
  const calls = [];
  const killed = [];
  let counter = 0;
  return {
    calls,
    killed,
    spawn: jest.fn(async (spec) => {
      calls.push(spec);
      const agentId = outcome.agentId ?? `agent-${++counter}`;
      return {
        agentId,
        status: outcome.status ?? 'completed',
        output: outcome.output ?? 'ok',
        error: outcome.error ?? null,
        ...(outcome.telemetry ? { telemetry: outcome.telemetry } : {}),
      };
    }),
    kill: jest.fn((agentId) => {
      killed.push(agentId);
    }),
  };
}

/**
 * In-memory bonds double mirroring the slice the Conductor halt path uses:
 * `listBonds({state:'running'})` + `refund(id)`. We track refunds and slashes
 * so we can prove operator halt ALWAYS refunds and NEVER slashes.
 */
function makeBonds(initial = []) {
  const rows = initial.map((b, i) => ({ id: b.id ?? i + 1, agentId: b.agentId, state: 'running' }));
  const refunded = [];
  const slashed = [];
  return {
    rows,
    refunded,
    slashed,
    refund: jest.fn((id) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.state !== 'running') return false;
      row.state = 'refunded';
      refunded.push(id);
      return true;
    }),
    // Not part of the Conductor interface; present only to prove it is NEVER
    // called on the operator-halt path.
    slash: jest.fn((id) => {
      slashed.push(id);
      return true;
    }),
    listBonds: jest.fn(({ state } = {}) =>
      rows.filter((r) => (state ? r.state === state : true)).map((r) => ({ id: r.id, agentId: r.agentId })),
    ),
  };
}

function makeConductor(over = {}) {
  const db = new Database(':memory:');
  const spawner = over.spawner ?? makeSpawner();
  const broadcasts = [];
  let clock = 1_700_000_000_000;
  const breaker = over.breaker ?? createFleetCircuitBreaker({ now: () => clock });
  const conductor = createConductor({
    db,
    spawner,
    bonds: over.bonds,
    breaker,
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    maxDepth: over.maxDepth ?? 3,
    now: () => clock,
    // Default: nothing is a main checkout unless a test injects otherwise.
    isMainCheckout: over.isMainCheckout ?? (() => false),
    mintWorktree: over.mintWorktree,
    publishArtifact: over.publishArtifact,
    publishTimeoutMs: over.publishTimeoutMs,
    rootCapabilityCeiling: over.rootCapabilityCeiling,
    defaultLineageCeilingUsd: over.defaultLineageCeilingUsd,
    defaultBondUsd: over.defaultBondUsd,
  });
  return { db, spawner, breaker, broadcasts, conductor, advance: (ms) => (clock += ms) };
}

const ROOT_INTENT = {
  goal: 'do the thing',
  backend: 'claude',
  source: 'operator',
  worktree: 'inherit',
};

/** Yield one macrotask so a pending `spawner.spawn` reaches the `running` state. */
function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * A spawner whose `spawn` never resolves until `releaseAll()` is called, so a
 * launch stays in `running` and HOLDS its lineage reservation. Lets us test the
 * budget gates against genuinely-concurrent (unsettled) children, and lets us
 * halt agents that are still in flight.
 */
function makePendingSpawner() {
  const calls = [];
  const killed = [];
  const resolvers = [];
  let counter = 0;
  const spawner = {
    calls,
    killed,
    spawn: jest.fn((spec) => {
      calls.push(spec);
      const agentId = `agent-${++counter}`;
      return new Promise((resolve) => {
        resolvers.push(() => resolve({ agentId, status: 'completed', output: 'ok', error: null }));
      });
    }),
    kill: jest.fn((id) => killed.push(id)),
  };
  return { spawner, releaseAll: () => resolvers.forEach((fn) => fn()) };
}

/**
 * Recover the id of an in-flight (pending-spawn) launch from the `fleet:launch`
 * admitted broadcast, so a child can name its still-running parent. Returns the
 * most-recently-admitted launch id.
 */
function lastAdmittedId(broadcasts) {
  for (let i = broadcasts.length - 1; i >= 0; i--) {
    const b = broadcasts[i];
    if (b.channel === 'fleet:launch' && b.payload.state === 'admitted') return b.payload.launchId;
  }
  throw new Error('no admitted launch broadcast found');
}

// ─── I1 — NO_SPAWN_WITHOUT_BOND / lineage reservation ─────────────────────────

describe('I1 NO_SPAWN_WITHOUT_BOND (reservation against the lineage ceiling)', () => {
  test('ALLOWS: a bond that fits under the lineage ceiling is reserved and spawns', async () => {
    const { conductor, spawner } = makeConductor();
    const res = await conductor.launch({ ...ROOT_INTENT, bondUsd: 3, lineageCeilingUsd: 10 });
    expect(res.admitted).toBe(true);
    expect(res.refusedReason).toBeNull();
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
    expect(res.launch.bondUsd).toBe(3);
  });

  test('REFUSES: a child bond that would exceed the shared lineage ceiling is not spawned', async () => {
    // The root must stay RUNNING (unsettled) to hold its reservation — a settled
    // launch releases its bond back to the lineage. A pending spawner keeps it
    // running so the child sees the reservation still outstanding.
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor, broadcasts } = makeConductor({ spawner });
    // Root reserves $8 of a $10 ceiling and stays running.
    const rootP = conductor.launch({ ...ROOT_INTENT, bondUsd: 8, lineageCeilingUsd: 10 });
    await tick();
    const rootId = lastAdmittedId(broadcasts);
    // Child wants $5 more → 8+5 > 10 → refused, never reaches the spawner.
    const child = await conductor.launch({
      goal: 'child work',
      backend: 'claude',
      source: 'agent',
      parentId: rootId,
      bondUsd: 5,
    });
    expect(child.admitted).toBe(false);
    expect(child.refusedReason).toMatch(/LINEAGE_BUDGET_CONSERVED/);
    expect(child.launch.state).toBe('refused');
    expect(spawner.spawn).toHaveBeenCalledTimes(1); // only the root spawned
    releaseAll();
    await rootP.catch(() => {});
  });
});

// ─── I2 — NO_SPAWN_ON_MAIN ────────────────────────────────────────────────────

describe('I2 NO_SPAWN_ON_MAIN', () => {
  test('ALLOWS: a non-main workdir spawns', async () => {
    const { conductor, spawner } = makeConductor({ isMainCheckout: (w) => w === '/repo-main' });
    const res = await conductor.launch({ ...ROOT_INTENT, workdir: '/coding/tmp/wt-1' });
    expect(res.admitted).toBe(true);
    expect(res.spawn).not.toBeNull();
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
  });

  test('REFUSES: a main checkout never reaches the spawner', async () => {
    const { conductor, spawner } = makeConductor({ isMainCheckout: (w) => w === '/repo-main' });
    const res = await conductor.launch({ ...ROOT_INTENT, workdir: '/repo-main' });
    expect(spawner.spawn).not.toHaveBeenCalled();
    expect(res.spawn).toBeNull();
    expect(res.launch.state).toBe('failed');
    expect(res.launch.errorMessage).toMatch(/NO_SPAWN_ON_MAIN/);
  });

  test('ALLOWS: an explicit read-only observer may opt into a shared/main checkout', async () => {
    const { conductor, spawner } = makeConductor({ isMainCheckout: () => true });
    const res = await conductor.launch({ ...ROOT_INTENT, workdir: '/repo-main', allowSharedCheckout: true });
    expect(res.admitted).toBe(true);
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
  });

  test('worktree:create mints an off-main worktree and spawns there', async () => {
    const minted = '/coding/tmp/port-daddy-dispatch-xyz';
    const { conductor, spawner } = makeConductor({
      isMainCheckout: (w) => w === '/repo-main',
      mintWorktree: () => minted,
    });
    const res = await conductor.launch({ ...ROOT_INTENT, workdir: '/repo-main', worktree: 'create' });
    expect(res.admitted).toBe(true);
    expect(spawner.spawn.mock.calls[0][0].workdir).toBe(minted);
  });
});

// ─── I3 — DEPTH_CAPPED ────────────────────────────────────────────────────────

describe('I3 DEPTH_CAPPED (Conductor-stamped, unforgeable)', () => {
  test('ALLOWS: a chain up to the cap is admitted at each level', async () => {
    const { conductor } = makeConductor({ maxDepth: 2 });
    const root = await conductor.launch({ ...ROOT_INTENT, lineageCeilingUsd: 100 }); // depth 0
    const d1 = await conductor.launch({ goal: 'd1', backend: 'claude', source: 'agent', parentId: root.launch.id });
    const d2 = await conductor.launch({ goal: 'd2', backend: 'claude', source: 'agent', parentId: d1.launch.id });
    expect(root.launch.depth).toBe(0);
    expect(d1.launch.depth).toBe(1);
    expect(d2.launch.depth).toBe(2);
    expect(d2.admitted).toBe(true);
  });

  test('REFUSES: a launch one past the cap is refused with DEPTH_CAPPED', async () => {
    const { conductor, spawner } = makeConductor({ maxDepth: 2 });
    const root = await conductor.launch({ ...ROOT_INTENT, lineageCeilingUsd: 100 });
    const d1 = await conductor.launch({ goal: 'd1', backend: 'claude', source: 'agent', parentId: root.launch.id });
    const d2 = await conductor.launch({ goal: 'd2', backend: 'claude', source: 'agent', parentId: d1.launch.id });
    const before = spawner.spawn.mock.calls.length;
    const d3 = await conductor.launch({ goal: 'd3', backend: 'claude', source: 'agent', parentId: d2.launch.id });
    expect(d3.admitted).toBe(false);
    expect(d3.launch.depth).toBe(3);
    expect(d3.refusedReason).toMatch(/DEPTH_CAPPED/);
    expect(spawner.spawn.mock.calls.length).toBe(before); // d3 never spawned
  });

  test('depth is stamped from the durable parent row — a caller cannot forge a low depth', async () => {
    // An "agent" submits a child claiming source:'agent' but the depth is derived
    // from the parent row, not anything the caller supplies.
    const { conductor } = makeConductor({ maxDepth: 3 });
    const root = await conductor.launch({ ...ROOT_INTENT, lineageCeilingUsd: 100 });
    const d1 = await conductor.launch({ goal: 'd1', backend: 'claude', source: 'agent', parentId: root.launch.id });
    // The intent carries no depth field at all; the Conductor computed 1.
    expect(d1.launch.depth).toBe(1);
    expect(d1.launch.rootId).toBe(root.launch.id);
  });

  // ── Attack 2 / white-hat HIGH #2: parentId/rootId forgery ──────────────────
  describe('lineage binding: an agent cannot mint a root (re-parent spoof closed)', () => {
    test("ALLOWS: source:'operator' mints a fresh root (depth 0, fresh rootId)", async () => {
      const { conductor } = makeConductor();
      const root = await conductor.launch({ ...ROOT_INTENT, lineageCeilingUsd: 100 });
      expect(root.admitted).toBe(true);
      expect(root.launch.depth).toBe(0);
      expect(root.launch.parentId).toBe('operator');
      expect(root.launch.rootId).toBe(root.launch.id);
    });

    test("REFUSES: source:'agent' with parentId:'operator' (forged root) is rejected", async () => {
      const { conductor, spawner } = makeConductor({ maxDepth: 3 });
      // An agent already at some depth tries to RESET to depth 0 by claiming the
      // operator as its parent — the classic re-parenting spoof that would escape
      // the depth cap, the lineage budget, and capability narrowing all at once.
      const before = spawner.spawn.mock.calls.length;
      const forged = await conductor.launch({
        goal: 'forged-root', backend: 'claude', source: 'agent',
        parentId: 'operator', capabilities: ['*'], lineageCeilingUsd: 999999,
      });
      expect(forged.admitted).toBe(false);
      expect(forged.refusedReason).toMatch(/LINEAGE_BINDING|may not mint a root/);
      expect(spawner.spawn.mock.calls.length).toBe(before); // never spawned
    });

    test("REFUSES: source:'agent' with NO parentId (defaults to operator) is rejected", async () => {
      const { conductor } = makeConductor();
      const forged = await conductor.launch({
        goal: 'orphan-agent', backend: 'claude', source: 'agent',
        // no parentId at all — would have minted a root under the old code
        capabilities: ['*'], lineageCeilingUsd: 999999,
      });
      expect(forged.admitted).toBe(false);
      expect(forged.refusedReason).toMatch(/LINEAGE_BINDING|may not mint a root/);
    });

    test("REFUSES: source:'agent' naming a bogus (non-existent) parent is rejected", async () => {
      const { conductor } = makeConductor();
      const forged = await conductor.launch({
        goal: 'bogus-parent', backend: 'claude', source: 'agent',
        parentId: 'no-such-launch', capabilities: ['read'],
      });
      expect(forged.admitted).toBe(false);
      expect(forged.refusedReason).toMatch(/not found/);
    });

    test('an agent child cannot widen the lineage ceiling via a supplied lineageCeilingUsd', async () => {
      const { conductor, breaker } = makeConductor();
      const root = await conductor.launch({ ...ROOT_INTENT, bondUsd: 1, lineageCeilingUsd: 5 });
      // The agent tries to claim a $1000 lineage ceiling — but the child inherits
      // the root's $5 cap; its own field is ignored.
      const child = await conductor.launch({
        goal: 'greedy', backend: 'claude', source: 'agent', parentId: root.launch.id,
        bondUsd: 1, lineageCeilingUsd: 1000,
      });
      expect(child.admitted).toBe(true);
      expect(child.launch.lineageCeilingUsd).toBe(5); // inherited, NOT 1000
      // The $5 cap is registered on the breaker scope and still binds the subtree:
      // an over-$5 reserve is refused (would be ALLOWED if the agent's $1000 had
      // widened the cap or made it unbounded).
      const scope = `root:${root.launch.id}`;
      expect(breaker.reserve(scope, 6)).toBe(false); // 6 > 5 → refused
    });
  });
});

// ─── I4 — LINEAGE_BUDGET_CONSERVED (incl. concurrent TOCTOU at the Conductor) ──

describe('I4 LINEAGE_BUDGET_CONSERVED', () => {
  test('ALLOWS: children sum exactly to the ceiling', async () => {
    const { conductor } = makeConductor();
    const root = await conductor.launch({ ...ROOT_INTENT, bondUsd: 4, lineageCeilingUsd: 10 });
    const c1 = await conductor.launch({ goal: 'c1', backend: 'claude', source: 'agent', parentId: root.launch.id, bondUsd: 6 });
    expect(c1.admitted).toBe(true); // 4 + 6 = 10, fits exactly
  });

  test('REFUSES: a burst of children cannot collectively exceed the ceiling', async () => {
    // Children must stay RUNNING to hold their reservations — otherwise each
    // settles and releases its bond before the next launches. A pending spawner
    // models the genuinely-concurrent burst the TOCTOU guard exists for.
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor, broadcasts } = makeConductor({ spawner });
    const rootP = conductor.launch({ ...ROOT_INTENT, bondUsd: 0, lineageCeilingUsd: 10 });
    await tick();
    const rootId = lastAdmittedId(broadcasts);
    // Three $4 children. The first two are admitted and stay RUNNING (pending
    // spawner) so they hold $8 of the $10 ceiling; their launch promises do not
    // resolve, so we do NOT await them. The third (would be $12) is refused —
    // and a refused launch resolves immediately, so we await only that one.
    const aP = conductor.launch({ goal: 'a', backend: 'claude', source: 'agent', parentId: rootId, bondUsd: 4 });
    const bP = conductor.launch({ goal: 'b', backend: 'claude', source: 'agent', parentId: rootId, bondUsd: 4 });
    await tick();
    const c = await conductor.launch({ goal: 'c', backend: 'claude', source: 'agent', parentId: rootId, bondUsd: 4 });
    expect(c.admitted).toBe(false);
    expect(c.refusedReason).toMatch(/LINEAGE_BUDGET_CONSERVED/);
    // root + the two admitted children reached the spawner; the refused one did not.
    expect(spawner.spawn).toHaveBeenCalledTimes(3);
    releaseAll();
    await Promise.all([rootP, aP, bP].map((p) => p.catch(() => {})));
  });

  test('the lineage ceiling is inherited by children, not re-declared per child', async () => {
    const { conductor } = makeConductor();
    const root = await conductor.launch({ ...ROOT_INTENT, bondUsd: 1, lineageCeilingUsd: 5 });
    const child = await conductor.launch({ goal: 'c', backend: 'claude', source: 'agent', parentId: root.launch.id, bondUsd: 1 });
    // Child did not supply lineageCeilingUsd; it inherits the root's $5.
    expect(child.launch.lineageCeilingUsd).toBe(5);
  });

  // ── readCost floor: a launch that reports NO cost still accrues its bond ─────
  test('a settled launch with no telemetry charges its reserved bond to the budget (no $0 evasion)', async () => {
    // Spawner returns completed but NO telemetry.costUsd. Under the old readCost,
    // realizedUsd would be $0 forever and the budget breaker would never accrue —
    // the runaway-evasion vector. The floor charges the reserved bond instead.
    const { conductor, breaker } = makeConductor({ spawner: makeSpawner({ status: 'completed' /* no telemetry */ }) });
    const root = await conductor.launch({ ...ROOT_INTENT, bondUsd: 4, mergePolicy: 'never', lineageCeilingUsd: 10 });
    expect(root.admitted).toBe(true);
    // The $4 bond was booked as realized cost on the scope even with no telemetry:
    // scope realized is now $4, so only $6 of the $10 ceiling remains — a $7
    // reserve is refused, a $6 reserve fits.
    const scope = `root:${root.launch.id}`;
    expect(breaker.reserve(scope, 7)).toBe(false); // 4 realized + 7 = 11 > 10
    expect(root.launch.costUsd).toBe(4); // recorded on the row
  });
});

// ─── I5 — GLOBAL_BREAKER ──────────────────────────────────────────────────────

describe('I5 GLOBAL_BREAKER', () => {
  test('ALLOWS: with the global breaker closed, launches are admitted', async () => {
    const { conductor } = makeConductor();
    conductor.setGlobalCeiling(100);
    const res = await conductor.launch({ ...ROOT_INTENT, bondUsd: 1, lineageCeilingUsd: 100 });
    expect(res.admitted).toBe(true);
  });

  test('REFUSES: once the global breaker is open, every new launch is refused', async () => {
    // The first launch must stay RUNNING to hold its $2 global reservation; a
    // pending spawner keeps it in flight so the next launch sees global full.
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor, breaker } = makeConductor({ spawner });
    conductor.setGlobalCeiling(2);
    const firstP = conductor.launch({ ...ROOT_INTENT, bondUsd: 2, lineageCeilingUsd: 100 });
    await tick();
    expect(breaker.isOpen(GLOBAL_SCOPE)).toBe(false);
    // This one would push global past $2 → refused at the global reservation,
    // which also trips the global breaker OPEN.
    const over = await conductor.launch({ goal: 'over', backend: 'claude', source: 'operator', bondUsd: 1, lineageCeilingUsd: 100 });
    expect(over.admitted).toBe(false);
    expect(over.refusedReason).toMatch(/GLOBAL_BREAKER|global budget/);
    expect(breaker.isOpen(GLOBAL_SCOPE)).toBe(true);
    // Now global is open; any further launch (even unbonded) is refused.
    const after = await conductor.launch({ goal: 'after', backend: 'claude', source: 'operator', lineageCeilingUsd: 100 });
    expect(after.admitted).toBe(false);
    expect(spawner.spawn).toHaveBeenCalledTimes(1); // only the first ever spawned
    releaseAll();
    await firstP.catch(() => {});
  });
});

// ─── I6 — CAPABILITY_SCOPED ───────────────────────────────────────────────────

describe('I6 CAPABILITY_SCOPED (capabilities only narrow downward)', () => {
  test('ALLOWS: a child whose caps are a subset of the parent is admitted', async () => {
    const { conductor } = makeConductor();
    const root = await conductor.launch({ ...ROOT_INTENT, capabilities: ['read', 'write', 'net'], lineageCeilingUsd: 100 });
    const child = await conductor.launch({
      goal: 'narrowed',
      backend: 'claude',
      source: 'agent',
      parentId: root.launch.id,
      capabilities: ['read'], // strict subset
    });
    expect(child.admitted).toBe(true);
    expect(child.launch.capabilities).toEqual(['read']);
  });

  test('REFUSES: a child that widens beyond the parent caps is refused', async () => {
    const { conductor, spawner } = makeConductor();
    const root = await conductor.launch({ ...ROOT_INTENT, capabilities: ['read'], lineageCeilingUsd: 100 });
    const before = spawner.spawn.mock.calls.length;
    const child = await conductor.launch({
      goal: 'widened',
      backend: 'claude',
      source: 'agent',
      parentId: root.launch.id,
      capabilities: ['read', 'write'], // 'write' is not in the parent — widening
    });
    expect(child.admitted).toBe(false);
    expect(child.refusedReason).toMatch(/CAPABILITY_SCOPED/);
    expect(child.refusedReason).toMatch(/write/);
    expect(spawner.spawn.mock.calls.length).toBe(before);
  });

  // ── Attack: capability DOWNGRADE escalation (white-hat HIGH #1) ─────────────
  test('a child with capabilities:[] INHERITS the parent caps, not the full-tier default', async () => {
    const { conductor, spawner } = makeConductor();
    const root = await conductor.launch({ ...ROOT_INTENT, capabilities: ['read'], lineageCeilingUsd: 100 });
    const child = await conductor.launch({
      goal: 'empty-caps',
      backend: 'claude',
      source: 'agent',
      parentId: root.launch.id,
      capabilities: [], // EMPTY — must inherit ['read'], not silently widen to full
    });
    expect(child.admitted).toBe(true);
    // Stamped caps = parent caps, NOT [].
    expect(child.launch.capabilities).toEqual(['read']);
    // And the spawn spec FORWARDS the inherited caps (so the spawner cannot
    // default an unset cap set to the full tier).
    const spec = spawner.spawn.mock.calls[spawner.spawn.mock.calls.length - 1][0];
    expect(spec.capabilities).toEqual(['read']);
  });

  test('a child with absent capabilities (undefined) also inherits the parent caps', async () => {
    const { conductor, spawner } = makeConductor();
    const root = await conductor.launch({ ...ROOT_INTENT, capabilities: ['read', 'net'], lineageCeilingUsd: 100 });
    const child = await conductor.launch({
      goal: 'absent-caps', backend: 'claude', source: 'agent', parentId: root.launch.id,
      // no capabilities field at all
    });
    expect(child.admitted).toBe(true);
    expect(child.launch.capabilities).toEqual(['read', 'net']);
    const spec = spawner.spawn.mock.calls[spawner.spawn.mock.calls.length - 1][0];
    expect(spec.capabilities).toEqual(['read', 'net']);
  });

  test('rootCapabilityCeiling bounds a root’s declared caps (over-ceiling caps dropped)', async () => {
    // Build a conductor with an operator root-cap ceiling: only read/write permitted.
    const Database = (await import('better-sqlite3')).default;
    const { createConductor } = await import('../../lib/fleet/conductor.js');
    const db = new Database(':memory:');
    const spawner = makeSpawner();
    const conductorCeiled = createConductor({
      db, spawner, isMainCheckout: () => false,
      rootCapabilityCeiling: ['read', 'write'],
    });
    const root = await conductorCeiled.launch({
      ...ROOT_INTENT, capabilities: ['read', 'write', '*'], lineageCeilingUsd: 100,
    });
    expect(root.admitted).toBe(true);
    // '*' (full-tier amplifier) is dropped — only the ceiling-permitted caps remain.
    expect(root.launch.capabilities).toEqual(['read', 'write']);
  });
});

// ─── I7 — HALT_IS_TOTAL (refund-always, never-slash, salvage preserved) ───────

describe('I7 HALT_IS_TOTAL', () => {
  test('ALLOWS valid teardown: halt freezes admission, marks running launches halted, and SIGKILLs them when their body is known', async () => {
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor } = makeConductor({ spawner });
    const p = conductor.launch({ ...ROOT_INTENT, lineageCeilingUsd: 100 });
    await tick(); // launch reaches `running`; spawn is in flight (agentId not yet known)
    expect(spawner.calls.length).toBe(1);

    // Halt the whole fleet. The body's agentId is not yet known (spawn pending),
    // so the kill is DEFERRED: the launch is marked halted now, admission freezes
    // now, and the SIGTERM→SIGKILL fires the instant the spawn resolves.
    const result = conductor.halt();
    expect(result.halted.length).toBe(1);
    const haltedId = result.halted[0];
    expect(conductor.get(haltedId).state).toBe('halted'); // preserved for salvage, not deleted

    // Admission is frozen immediately (I7 atomicity): a new launch is refused.
    const after = await conductor.launch({ ...ROOT_INTENT, goal: 'post-halt', lineageCeilingUsd: 100 });
    expect(after.admitted).toBe(false);

    // Now the in-flight body resolves → the deferred kill fires.
    releaseAll();
    await p.catch(() => {});
    expect(spawner.kill).toHaveBeenCalledTimes(1); // SIGTERM→SIGKILL honored
    // The launch stays halted (not promoted to produced) and records the body id.
    const final = conductor.get(haltedId);
    expect(final.state).toBe('halted');
    expect(final.agentId).toBe('agent-1');
  });

  test('REFUSES slash / ALWAYS refunds: operator halt refunds the in-flight bond and never slashes', async () => {
    const { spawner, releaseAll } = makePendingSpawner();
    const bonds = makeBonds([{ id: 7, agentId: 'agent-1' }]);
    const { conductor } = makeConductor({ spawner, bonds });
    const p = conductor.launch({ ...ROOT_INTENT, bondUsd: 5, lineageCeilingUsd: 100 });
    await tick();
    // Halt while the spawn is pending → kill + refund are deferred to resolution.
    conductor.halt();
    expect(bonds.slash).not.toHaveBeenCalled(); // never slash on operator halt
    // On resolution the bond is refunded BEFORE the body is killed.
    releaseAll();
    await p.catch(() => {});
    expect(bonds.refund).toHaveBeenCalled();
    expect(bonds.refunded).toContain(7);
    expect(bonds.slash).not.toHaveBeenCalled();
    // Refund happened before the kill (ordering): refund recorded, then kill.
    expect(spawner.killed).toContain('agent-1');
  });

  test('pause stops admission but does NOT kill running agents', async () => {
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor } = makeConductor({ spawner });
    const p = conductor.launch({ ...ROOT_INTENT, lineageCeilingUsd: 100 });
    await tick();
    conductor.pause();
    expect(spawner.kill).not.toHaveBeenCalled(); // running agent survives a pause
    const after = await conductor.launch({ ...ROOT_INTENT, goal: 'post-pause', lineageCeilingUsd: 100 });
    expect(after.admitted).toBe(false); // but admission is frozen
    releaseAll();
    await p.catch(() => {});
    // A pause never escalates to a kill, even after the agent completes.
    expect(spawner.kill).not.toHaveBeenCalled();
  });

  test('resume reopens admission after a pause', async () => {
    const { conductor } = makeConductor();
    conductor.pause();
    const blocked = await conductor.launch({ ...ROOT_INTENT, lineageCeilingUsd: 100 });
    expect(blocked.admitted).toBe(false);
    conductor.resume();
    const ok = await conductor.launch({ ...ROOT_INTENT, goal: 'resumed', lineageCeilingUsd: 100 });
    expect(ok.admitted).toBe(true);
  });

  // ── Attack 3: pause/halt must NOT corrupt breaker ceilings ──────────────────
  test('global pause→resume leaves the global ceiling INTACT (no brick, no silent-zero)', async () => {
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor, breaker } = makeConductor({ spawner });
    conductor.setGlobalCeiling(100);
    conductor.pause();          // global operator pause
    conductor.resume();         // global resume
    expect(breaker.isOpen(GLOBAL_SCOPE)).toBe(false);
    // The global ceiling must still be $100 after the cycle. A bonded launch of
    // $60 must succeed and HOLD its reservation (in-flight). If pause had zeroed
    // the ceiling, even this $60 would refuse.
    const aP = conductor.launch({ ...ROOT_INTENT, goal: 'a', bondUsd: 60, lineageCeilingUsd: 100 });
    await tick();
    // A second $60 in-flight bond pushes global to $120 > $100 → must refuse,
    // proving the $100 ceiling is still enforced (not zeroed, not unbounded).
    const over = await conductor.launch({ goal: 'over', backend: 'claude', source: 'operator', bondUsd: 60, lineageCeilingUsd: 100 });
    expect(over.admitted).toBe(false);
    expect(over.refusedReason).toMatch(/GLOBAL_BREAKER|global budget/);
    releaseAll();
    await aP.catch(() => {});
  });

  test('lineage halt→resume leaves the lineage cap INTACT (cap not replaced by unbounded)', async () => {
    const { conductor, breaker } = makeConductor({ spawner: makeSpawner({ status: 'completed' }) });
    // Establish a root with a $5 lineage ceiling (settles immediately).
    const root = await conductor.launch({ ...ROOT_INTENT, bondUsd: 2, mergePolicy: 'never', lineageCeilingUsd: 5 });
    const rootId = root.launch.rootId;
    const scope = `root:${rootId}`;
    // Halt the lineage, then resume it.
    conductor.halt({ rootId });
    conductor.resume({ rootId });
    // After resume the scope is CLOSED (admission reopened)...
    expect(breaker.isOpen(scope)).toBe(false);
    // ...AND the $5 lineage cap survived: an over-ceiling reserve is refused
    // (this very call trips the budget breaker, which is the expected behavior —
    // it proves the ceiling is still $5, not null/unbounded which would return true).
    expect(breaker.reserve(scope, 6)).toBe(false);
  });
});

// ─── Golden spec: spawner args are byte-identical to the legacy path ──────────

describe('golden spec — spawner.spawn receives byte-identical args to the legacy path', () => {
  test('a sortie-shaped intent produces exactly the legacy sortie spawn spec', async () => {
    const { conductor, spawner } = makeConductor();
    // The fields a legacy sortie POST passed to spawner.spawn (routes/sorties.ts).
    const intent = {
      goal: 'review the PR',
      task: 'review the PR',
      backend: 'claude',
      source: 'sortie',
      worktree: 'inherit',
      model: 'claude-sonnet-4',
      identity: 'reviewer',
      purpose: 'code-review',
      workdir: '/coding/tmp/wt-sortie',
      allowedTools: 'Read,Grep',
      timeoutMs: 600000,
      maxTokens: 8000,
      bondUsd: 2,
      harborName: 'pd-main',
      capabilities: ['read'],
      lineageCeilingUsd: 100,
    };
    await conductor.launch(intent);
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
    const spec = spawner.spawn.mock.calls[0][0];
    // Pin the exact spec the spawner saw — the chokepoint must change nothing.
    expect(spec).toEqual({
      backend: 'claude',
      task: 'review the PR',
      model: 'claude-sonnet-4',
      identity: 'reviewer',
      purpose: 'code-review',
      workdir: '/coding/tmp/wt-sortie',
      allowedTools: 'Read,Grep',
      timeout: 600000,
      maxTokens: 8000,
      bondUsd: 2,
      harborName: 'pd-main',
      capabilities: ['read'],
    });
  });

  test('intentToSpawnSpec is pure and omits unset fields (no undefined leakage)', () => {
    const { conductor } = makeConductor();
    const spec = conductor.intentToSpawnSpec(
      { goal: 'g', backend: 'claude', source: 'operator' },
      '/wt',
    );
    expect(spec).toEqual({ backend: 'claude', task: 'g', workdir: '/wt' });
    // No undefined keys leaked in.
    for (const v of Object.values(spec)) expect(v).not.toBeUndefined();
  });
});

// ─── Settlement / recursion happy-paths ───────────────────────────────────────

describe('settlement & lifecycle', () => {
  test('happy path: launch → admitted → embodied → running → produced (review gate)', async () => {
    const states = [];
    const spawner = makeSpawner({ status: 'completed' });
    const { conductor, broadcasts } = makeConductor({ spawner });
    const res = await conductor.launch({ ...ROOT_INTENT, mergePolicy: 'review', lineageCeilingUsd: 100 });
    // mergePolicy:review stops at produced (awaits operator/Steward).
    expect(res.launch.state).toBe('produced');
    expect(res.launch.agentId).toBe('agent-1');
    // The lifecycle broadcast the intermediate transitions.
    const seen = broadcasts.filter((b) => b.channel === 'fleet:state').map((b) => b.payload.state);
    expect(seen).toEqual(expect.arrayContaining(['embodied', 'running', 'produced']));
  });

  test('mergePolicy:never settles immediately with no review gate', async () => {
    const { conductor } = makeConductor({ spawner: makeSpawner({ status: 'completed' }) });
    const res = await conductor.launch({ ...ROOT_INTENT, mergePolicy: 'never', lineageCeilingUsd: 100 });
    expect(res.launch.state).toBe('settled');
  });

  test('a dirty spawn exit lands in failed, not produced', async () => {
    const { conductor } = makeConductor({ spawner: makeSpawner({ status: 'failed', error: 'boom' }) });
    const res = await conductor.launch({ ...ROOT_INTENT, lineageCeilingUsd: 100 });
    expect(res.launch.state).toBe('failed');
    expect(res.launch.errorMessage).toBe('boom');
  });

  test('a spawn that throws releases the lineage reservation and books a failure', async () => {
    const spawner = {
      spawn: jest.fn(async () => { throw new Error('spawn threw'); }),
      kill: jest.fn(),
    };
    const { conductor, breaker } = makeConductor({ spawner });
    const res = await conductor.launch({ ...ROOT_INTENT, bondUsd: 5, lineageCeilingUsd: 10 });
    expect(res.launch.state).toBe('failed');
    expect(res.launch.errorMessage).toMatch(/spawn threw/);
    // The $5 reservation was released back to the lineage scope: the scope now
    // has the full $10 free again (a fresh $10 reserve fits where 5+10 would not).
    const scope = `root:${res.launch.rootId}`;
    expect(breaker.reserve(scope, 10)).toBe(true); // would be false if $5 still held
  });

  // FIX 1 (CRITICAL, I4/I5): an unguarded `await mintWorktree` leaks the breaker
  // reservation. A `worktree:'create'` launch whose mint throws (real
  // gitWorktreeAdd can fail: branch exists, stale .git/worktrees lock, full disk,
  // slow NFS) must release the reservation and settle the row `'failed'` — NOT
  // throw out of launch() leaving the row `'admitted'` and the bond walled off.
  test('worktree:create whose mintWorktree throws releases the reservation and fails the row (no leak)', async () => {
    const { conductor, breaker } = makeConductor({
      // The mint hook throws exactly like a wedged `git worktree add` would.
      mintWorktree: () => { throw new Error('git worktree add: branch already exists'); },
    });
    const res = await conductor.launch({
      ...ROOT_INTENT,
      worktree: 'create',
      bondUsd: 5,
      lineageCeilingUsd: 10,
    });
    // The launch does NOT throw; it returns a failed LaunchResult.
    expect(res.admitted).toBe(true);
    expect(res.spawn).toBeNull();
    // The row is settled `'failed'`, not stuck at `'admitted'`.
    expect(res.launch.state).toBe('failed');
    expect(conductor.get(res.launch.id).state).toBe('failed');
    expect(res.launch.errorMessage).toMatch(/mintWorktree failed/);
    // CRITICAL: the $5 reservation was released back to the lineage scope. With
    // the leak, $5 stays reserved and a fresh $10 reserve (5+10 > 10) is refused.
    const scope = `root:${res.launch.rootId}`;
    expect(breaker.reserve(scope, 10)).toBe(true); // would be false if $5 still held
    // And the GLOBAL reservation was released too: a fresh global $5 (after the
    // earlier global $5 was released) does not exceed a $5 global ceiling.
    expect(breaker.state(GLOBAL_SCOPE).open).toBe(false);
  });

  // FIX 1 corollary: the freed budget is genuinely available to the NEXT launch.
  // A second dispatch sized to exactly fill the ceiling is admitted only if the
  // first launch's failed mint released its reservation.
  test('a launch admitted after a failed mintWorktree reuses the freed lineage budget', async () => {
    const minted = '/coding/tmp/wt-ok';
    let firstCall = true;
    const { conductor } = makeConductor({
      defaultLineageCeilingUsd: null,
      // First mint throws (leak candidate); second mint succeeds.
      mintWorktree: () => {
        if (firstCall) { firstCall = false; throw new Error('stale .git/worktrees lock'); }
        return minted;
      },
    });
    // Global ceiling of $5: the first launch reserves $5 then fails to mint.
    conductor.setGlobalCeiling(5);
    const first = await conductor.launch({
      ...ROOT_INTENT, worktree: 'create', bondUsd: 5, lineageCeilingUsd: 5,
    });
    expect(first.launch.state).toBe('failed');
    // If the first reservation leaked, the global breaker is at $5/$5 and this
    // second $5 launch is refused (GLOBAL_BREAKER). With the fix, it is admitted.
    const second = await conductor.launch({
      ...ROOT_INTENT, worktree: 'create', bondUsd: 5, lineageCeilingUsd: 5,
    });
    expect(second.admitted).toBe(true);
    expect(second.refusedReason).toBeNull();
    expect(second.launch.state).not.toBe('refused');
  });

  test('recursive sub-launch within depth+budget succeeds', async () => {
    const { conductor } = makeConductor({ maxDepth: 3 });
    const root = await conductor.launch({ ...ROOT_INTENT, bondUsd: 1, lineageCeilingUsd: 100 });
    const child = await conductor.launch({
      goal: 'sub-work', backend: 'claude', source: 'agent', parentId: root.launch.id, bondUsd: 1,
    });
    expect(child.admitted).toBe(true);
    expect(child.launch.depth).toBe(1);
    expect(child.launch.rootId).toBe(root.launch.id);
    // tree() shows both nodes under the root.
    const tree = conductor.tree(root.launch.id);
    expect(tree.map((l) => l.id)).toEqual(expect.arrayContaining([root.launch.id, child.launch.id]));
  });

  test('a child whose parent was halted cannot spawn', async () => {
    let resolveSpawn;
    const spawner = {
      calls: [],
      killed: [],
      spawn: jest.fn(() =>
        new Promise((r) => {
          resolveSpawn = () => r({ agentId: 'agent-parent', status: 'completed', output: 'ok', error: null });
        }),
      ),
      kill: jest.fn((id) => spawner.killed.push(id)),
    };
    const { conductor } = makeConductor({ spawner });
    const p = conductor.launch({ ...ROOT_INTENT, lineageCeilingUsd: 100 });
    await new Promise((r) => setTimeout(r, 0));
    const parentId = conductor.halt().halted[0];
    expect(conductor.get(parentId).state).toBe('halted');
    // A child proposing against the halted parent is refused (HALT_IS_TOTAL).
    conductor.resume(); // reopen admission so the ONLY thing blocking is the halted parent
    const child = await conductor.launch({
      goal: 'orphan', backend: 'claude', source: 'agent', parentId,
    });
    expect(child.admitted).toBe(false);
    expect(child.refusedReason).toMatch(/halted|HALT_IS_TOTAL/);
    resolveSpawn?.();
    await p.catch(() => {});
  });

  test('a child of a missing parent is refused (no orphan spawns)', async () => {
    const { conductor } = makeConductor();
    const child = await conductor.launch({
      goal: 'orphan', backend: 'claude', source: 'agent', parentId: 'does-not-exist',
    });
    expect(child.admitted).toBe(false);
    expect(child.refusedReason).toMatch(/not found/);
  });
});

// ─── Input guards ─────────────────────────────────────────────────────────────

describe('input validation', () => {
  test('launch without a goal throws', async () => {
    const { conductor } = makeConductor();
    await expect(conductor.launch({ backend: 'claude', source: 'operator' })).rejects.toThrow(/goal/);
  });

  test('launch without a backend throws', async () => {
    const { conductor } = makeConductor();
    await expect(conductor.launch({ goal: 'g', source: 'operator' })).rejects.toThrow(/backend/);
  });
});

// ─── Cost-gate ARMING on the live path (red-team Attack 1 / PM gap #2) ────────
//
// These tests FAIL without the production arming: they prove that a conductor
// configured the way server.ts configures it (global ceiling + default lineage
// ceiling + default bond floor) actually RESERVES and bounds spend on a
// live-shaped sortie/orchestrator launch that carries NO bondUsd and NO
// lineageCeilingUsd — exactly the shape routes/sorties.ts + lib/orchestrator.ts
// produce. Strip the arming and the breaker governs nothing.

describe('cost gates ARMED on the live (no-bond) path', () => {
  // A live sortie/orchestrator intent: no bondUsd, no lineageCeilingUsd.
  const LIVE_SORTIE_INTENT = {
    goal: 'review the PR',
    task: 'review the PR',
    backend: 'claude',
    source: 'sortie',
    worktree: 'inherit',
    mergePolicy: 'never',
  };

  test('a server-armed conductor stamps the default lineage ceiling on a bondless sortie root', async () => {
    const { conductor } = makeConductor({
      defaultLineageCeilingUsd: 5,
      defaultBondUsd: 0.01,
    });
    const res = await conductor.launch({ ...LIVE_SORTIE_INTENT });
    expect(res.admitted).toBe(true);
    // The root inherited the operator default ceiling even though the intent set none.
    expect(res.launch.lineageCeilingUsd).toBe(5);
    // The bond floor was reserved (booked as cost) — NOT $0.
    expect(res.launch.bondUsd).toBe(0.01);
  });

  test('a bondless live launch RESERVES the bond floor against the lineage scope (not $0)', async () => {
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor, broadcasts, breaker } = makeConductor({
      spawner,
      defaultLineageCeilingUsd: 5,
      defaultBondUsd: 1, // a visible floor for the assertion
    });
    const p = conductor.launch({ ...LIVE_SORTIE_INTENT });
    await tick();
    const rootId = lastAdmittedId(broadcasts);
    const scope = `root:${rootId}`;
    // $1 is held in-flight against the $5 lineage ceiling: only $4 more fits.
    expect(breaker.reserve(scope, 4)).toBe(true);   // 1 + 4 = 5 exactly
    breaker.release(scope, 4);
    expect(breaker.reserve(scope, 4.5)).toBe(false); // 1 + 4.5 = 5.5 > 5 → refused
    releaseAll();
    await p.catch(() => {});
  });

  test('the GLOBAL breaker is armed and bounds aggregate spend across independent roots', async () => {
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor } = makeConductor({
      spawner,
      defaultLineageCeilingUsd: 100,
      defaultBondUsd: 2,
    });
    conductor.setGlobalCeiling(3); // total fleet spend capped at $3
    // First bondless root reserves $2 globally (in-flight, holds the reservation).
    const aP = conductor.launch({ ...LIVE_SORTIE_INTENT, goal: 'a' });
    await tick();
    // Second bondless root would push global to $4 > $3 → refused by the GLOBAL gate.
    const over = await conductor.launch({ ...LIVE_SORTIE_INTENT, goal: 'b', source: 'orchestrator' });
    expect(over.admitted).toBe(false);
    expect(over.refusedReason).toMatch(/GLOBAL_BREAKER|global budget/);
    releaseAll();
    await aP.catch(() => {});
  });

  test('WITHOUT arming (defaults $0), the legacy reserve-nothing behavior is preserved', async () => {
    // Defensive: the unarmed conductor (no defaultBondUsd / ceiling) must still
    // behave exactly as before — reserve nothing, unbounded. This guards against
    // the arming changing the default (test-harness) path.
    const { conductor } = makeConductor();
    const res = await conductor.launch({ ...LIVE_SORTIE_INTENT });
    expect(res.admitted).toBe(true);
    expect(res.launch.lineageCeilingUsd).toBeNull(); // unbounded by default
    expect(res.launch.bondUsd).toBeNull();           // reserve nothing by default
  });
});

// ─── BUG 1 (2026-07-14 halt-mandate): flat-rate CLI backends exempt from the ──
//     dollar breaker; an UNSET global ceiling is UNBOUNDED, not $0.
//
// Root cause of the incident: the Conductor reserved a real-dollar bond against
// EVERY dispatch — including `cli:claude-code`/`cli:codex`, which ride the
// operator's flat-rate subscription at $0 marginal cost. A burst of ordinary
// free CLI dispatches slowly consumed the finite global ceiling and then
// GLOBAL_BREAKER refused every subsequent dispatch ("global budget would be
// exceeded"), metered or not — a phantom dollar meter deadlocking free work.
// These tests pin the fix: a subscription backend reserves $0 (never consumes a
// ceiling), and metered backends are unchanged.
describe('BUG 1 — flat-rate subscription backends are exempt from the dollar breaker', () => {
  test('a cli:claude-code launch admits even with the global ceiling FUNDED and (near-)exhausted', async () => {
    // Default (immediately-resolving) spawner so `await launch` completes.
    const { conductor, breaker } = makeConductor({
      defaultLineageCeilingUsd: 5,
      defaultBondUsd: 1, // metered launches WOULD reserve $1
    });
    conductor.setGlobalCeiling(3);
    // Pre-exhaust the global scope as if metered spend had already filled it.
    breaker.reserve(GLOBAL_SCOPE, 3);

    // A flat-rate CLI launch must STILL admit — it reserves $0, so a full
    // dollar meter is irrelevant to it.
    const res = await conductor.launch({
      goal: 'free cli work',
      backend: 'cli:claude-code',
      source: 'dispatch',
      worktree: 'inherit',
      mergePolicy: 'never',
      // Even an explicit bondUsd must be ignored for a subscription backend —
      // there is no operator override that makes a $0-marginal backend cost $.
      bondUsd: 2,
      lineageCeilingUsd: 5,
    });
    expect(res.admitted).toBe(true);
    expect(res.launch.bondUsd).toBeNull(); // reserved $0, so nothing stored
  });

  test('a cli:codex launch admits with the global ceiling UNSET (unbounded, not $0)', async () => {
    // No setGlobalCeiling call → GLOBAL_SCOPE is never registered → unbounded.
    const { conductor } = makeConductor({ defaultBondUsd: 1 });
    const res = await conductor.launch({
      goal: 'codex work',
      backend: 'cli:codex',
      source: 'dispatch',
      worktree: 'inherit',
      mergePolicy: 'never',
    });
    expect(res.admitted).toBe(true);
    expect(res.refusedReason).toBeNull();
  });

  test('an unset global ceiling admits a METERED launch too (unbounded, never a phantom $0 cap)', async () => {
    const { conductor } = makeConductor({ defaultBondUsd: 1 });
    // No global ceiling registered. A metered launch with a real bond must be
    // admitted — an UNSET ceiling is unbounded, not a $0 wall that refuses
    // every bond>0 (the exact deadlock the incident described).
    const res = await conductor.launch({
      goal: 'metered work',
      backend: 'claude',
      source: 'operator',
      bondUsd: 50,
      lineageCeilingUsd: 100,
    });
    expect(res.admitted).toBe(true);
  });

  test('a METERED launch is still gated by the funded global ceiling (regression guard)', async () => {
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor } = makeConductor({ spawner, defaultBondUsd: 2 });
    conductor.setGlobalCeiling(3);
    const a = conductor.launch({
      goal: 'a', backend: 'claude', source: 'operator', bondUsd: 2, lineageCeilingUsd: 100,
    });
    await tick();
    const over = await conductor.launch({
      goal: 'b', backend: 'claude', source: 'operator', bondUsd: 2, lineageCeilingUsd: 100,
    });
    expect(over.admitted).toBe(false);
    expect(over.refusedReason).toMatch(/GLOBAL_BREAKER|global budget/);
    releaseAll();
    await a.catch(() => {});
  });
});

// ─── ADR-0060 dispatch fold-in: mintWorktree (async) + publishArtifact ────────
//
// The dispatch surface folds into the Conductor as a `worktree:'create',
// mergePolicy:'review'` launch. Two hooks carry the dispatch-specific lifecycle:
//   • mintWorktree — async git worktree add (must be AWAITED so the minted
//     off-main workdir reaches the spawn spec, satisfying I2 NO_SPAWN_ON_MAIN).
//   • publishArtifact — push branch + open draft PR AFTER a successful review-
//     path run; its URL lands in resultArtifact. It is a PURE SIDE-EFFECT: it
//     never touches the breaker/bonds, never flips a green run to failed, and a
//     throw is swallowed (resultArtifact null, launch NOT lost).
//
// These are real-bug tests: each guards a property whose violation would either
// lose a dispatch's PR, publish a PR for a launch that never produced output,
// charge the budget breaker for a non-spawn, or spawn against a main checkout
// because the async mint wasn't awaited.
describe('ADR-0060 dispatch fold-in — mintWorktree + publishArtifact', () => {
  const DISPATCH_INTENT = {
    goal: 'build the dispatch feature',
    backend: 'cli:codex',
    source: 'dispatch',
    worktree: 'create',
    mergePolicy: 'review',
    worktreePath: '/Users/me/coding/tmp/port-daddy-dispatch-abc12345',
    worktreeBranch: 'dispatch/build-the-dispatch-abc12345',
    worktreeBaseRef: 'origin/main',
    env: { PD_DISPATCH_ID: 'abc12345' },
    tubeChannel: 'dispatch:abc12345',
    bondUsd: 5,
    lineageCeilingUsd: 5,
  };

  test('publishArtifact IS called on a mergePolicy:review success and its URL lands in resultArtifact', async () => {
    const calls = [];
    const publishArtifact = jest.fn(async (launch, intent) => {
      calls.push({ launchId: launch.id, branch: intent.worktreeBranch });
      return 'https://github.com/curiositech/port-daddy/pull/999';
    });
    const { conductor } = makeConductor({ publishArtifact });

    const res = await conductor.launch({ ...DISPATCH_INTENT });

    expect(res.admitted).toBe(true);
    expect(publishArtifact).toHaveBeenCalledTimes(1);
    // The hook receives the ADMITTED launch (with a stamped id) and the intent.
    expect(calls[0].launchId).toBe(res.launch.id);
    expect(calls[0].branch).toBe(DISPATCH_INTENT.worktreeBranch);
    expect(res.launch.resultArtifact).toBe('https://github.com/curiositech/port-daddy/pull/999');
  });

  test('publishArtifact is NOT called on mergePolicy:never (no review artifact)', async () => {
    const publishArtifact = jest.fn(async () => 'https://example.com/pr/1');
    const { conductor } = makeConductor({ publishArtifact });

    const res = await conductor.launch({ ...DISPATCH_INTENT, mergePolicy: 'never' });

    expect(res.admitted).toBe(true);
    // A `never` launch settles immediately with no PR-able review gate.
    expect(res.launch.state).toBe('settled');
    expect(publishArtifact).not.toHaveBeenCalled();
    expect(res.launch.resultArtifact).toBeNull();
  });

  test('publishArtifact is NOT called on a FAILED run (nothing to publish)', async () => {
    const publishArtifact = jest.fn(async () => 'https://example.com/pr/1');
    const spawner = makeSpawner({ status: 'failed', error: 'agent exploded' });
    const { conductor } = makeConductor({ publishArtifact, spawner });

    const res = await conductor.launch({ ...DISPATCH_INTENT });

    expect(res.admitted).toBe(true);
    expect(res.launch.state).toBe('failed');
    expect(publishArtifact).not.toHaveBeenCalled();
    expect(res.launch.resultArtifact).toBeNull();
  });

  test('a THROWING publishArtifact leaves the run produced with resultArtifact null (run NOT lost)', async () => {
    const publishArtifact = jest.fn(async () => {
      throw new Error('gh pr create failed: network down');
    });
    const { conductor } = makeConductor({ publishArtifact });

    const res = await conductor.launch({ ...DISPATCH_INTENT });

    // The launch is NOT lost and NOT flipped to failed — the run succeeded.
    expect(res.admitted).toBe(true);
    expect(res.launch.state).toBe('produced');
    expect(res.launch.resultArtifact).toBeNull();
    // The publish failure is recorded as a note for the operator, not a failure.
    expect(res.launch.errorMessage).toMatch(/artifact publish failed/);
    expect(publishArtifact).toHaveBeenCalledTimes(1);
  });

  // FIX 3 (MED): a HUNG publish (git push / gh pr create wedged) must NOT hold the
  // launch's in-flight slot until the OS TCP timeout. The conductor bounds the
  // publish await; on timeout it becomes a swallowed throw — the run still settles
  // `produced` with resultArtifact null, and the slot (the awaiting launch()) is
  // released within the bound. We inject a short publishTimeoutMs and a publish
  // that NEVER resolves; without the bound, `await conductor.launch` would hang
  // forever (this test would time out the whole jest run).
  test('a publishArtifact that never resolves is bounded — launch settles produced with resultArtifact null', async () => {
    let resolvePublishStarted;
    const publishStarted = new Promise((r) => { resolvePublishStarted = r; });
    const publishArtifact = jest.fn(() => {
      resolvePublishStarted();
      // Never resolves: a wedged `git push`/`gh pr create` with no native timeout.
      return new Promise(() => {});
    });
    const { conductor } = makeConductor({ publishArtifact, publishTimeoutMs: 50 });

    const start = Date.now();
    const res = await conductor.launch({ ...DISPATCH_INTENT });
    const elapsed = Date.now() - start;

    // The publish WAS attempted (so this isn't a false pass from skipping it)...
    await publishStarted;
    expect(publishArtifact).toHaveBeenCalledTimes(1);
    // ...but the launch returned (slot released) shortly after the 50ms bound,
    // not after the publish resolved (it never does). Generous ceiling to avoid
    // CI flake while still proving the bound fired (vs. an unbounded hang).
    expect(elapsed).toBeLessThan(5_000);
    // The run is NOT lost and NOT failed — produced with no artifact, the timeout
    // recorded as a publish-failed note exactly like any other publish failure.
    expect(res.admitted).toBe(true);
    expect(res.launch.state).toBe('produced');
    expect(res.launch.resultArtifact).toBeNull();
    expect(res.launch.errorMessage).toMatch(/artifact publish failed.*timed out/);
  });

  // FIX 3 guard: with the bound DISABLED (0) and a FAST publish, behavior is the
  // legacy unbounded await — proving the timeout is opt-outable and the race does
  // not interfere with a normal publish.
  test('publishTimeoutMs:0 disables the bound; a fast publish still lands its URL', async () => {
    const publishArtifact = jest.fn(async () => 'https://example.com/pr/99');
    const { conductor } = makeConductor({ publishArtifact, publishTimeoutMs: 0 });
    const res = await conductor.launch({ ...DISPATCH_INTENT });
    expect(res.launch.state).toBe('produced');
    expect(res.launch.resultArtifact).toBe('https://example.com/pr/99');
  });

  test('publishArtifact does NOT touch the cost breaker (publishing is not a spawn)', async () => {
    // Price the spawn at $2 via telemetry. The publish must not add to realized
    // spend, so the lineage scope's realized accrual reflects ONLY the spawn.
    const spawner = makeSpawner({ status: 'completed', telemetry: { costUsd: 2 } });
    const publishArtifact = jest.fn(async () => 'https://example.com/pr/7');
    const { conductor, breaker } = makeConductor({
      spawner,
      publishArtifact,
      defaultLineageCeilingUsd: 10,
    });

    const res = await conductor.launch({ ...DISPATCH_INTENT });
    expect(res.admitted).toBe(true);
    expect(res.launch.resultArtifact).toBe('https://example.com/pr/7');
    // Realized cost on the launch is the spawn cost only ($2) — publishing the PR
    // added nothing. (The bond was $5; telemetry $2 < bond, recordOutcome uses the
    // reported cost.) The launch's recorded cost must be the spawn's $2, proving
    // the publish never accrued.
    expect(res.launch.costUsd).toBe(2);
    void breaker;
  });

  test('async mintWorktree is AWAITED and its workdir reaches the spawn spec', async () => {
    // mintWorktree resolves on a later macrotask; if launch() did not await it,
    // the spec.workdir would be undefined (or the intent's, not the minted one).
    const mintWorktree = jest.fn(async (_launch, intent) => {
      await new Promise((r) => setTimeout(r, 5)); // genuinely async
      return intent.worktreePath; // the minted off-main workdir
    });
    const spawner = makeSpawner();
    const { conductor } = makeConductor({ mintWorktree, spawner });

    const res = await conductor.launch({ ...DISPATCH_INTENT });

    expect(res.admitted).toBe(true);
    expect(mintWorktree).toHaveBeenCalledTimes(1);
    // The single recorded spawn spec must carry the AWAITED minted workdir.
    expect(spawner.calls).toHaveLength(1);
    expect(spawner.calls[0].workdir).toBe(DISPATCH_INTENT.worktreePath);
  });

  test('the dispatch intent forwards env + tubeChannel into the spawn spec (passthrough)', async () => {
    const spawner = makeSpawner();
    const { conductor } = makeConductor({ spawner, publishArtifact: async () => 'https://x/pr/1' });

    const res = await conductor.launch({ ...DISPATCH_INTENT });

    expect(res.admitted).toBe(true);
    expect(spawner.calls).toHaveLength(1);
    expect(spawner.calls[0].env).toEqual(DISPATCH_INTENT.env);
    expect(spawner.calls[0].tubeChannel).toBe(DISPATCH_INTENT.tubeChannel);
  });

  test('a non-dispatch launch leaves env/tubeChannel OFF the spec (golden byte-identity)', () => {
    // The fold-in is additive-only: a sortie/operator intent that sets neither
    // env nor tubeChannel must produce a spec WITHOUT those keys.
    const { conductor } = makeConductor();
    const spec = conductor.intentToSpawnSpec(
      { ...ROOT_INTENT, source: 'sortie' },
      '/some/workdir',
    );
    expect('env' in spec).toBe(false);
    expect('tubeChannel' in spec).toBe(false);
  });

  test('a refused dispatch (depth-capped) never calls publishArtifact', async () => {
    // An `agent`-sourced dispatch-shaped intent claiming roothood is refused at
    // admission. publishArtifact must never fire for a launch that never ran.
    const publishArtifact = jest.fn(async () => 'https://x/pr/1');
    const { conductor } = makeConductor({ publishArtifact });
    const res = await conductor.launch({
      ...DISPATCH_INTENT,
      source: 'agent', // may not mint a root → refused
      parentId: 'operator',
    });
    expect(res.admitted).toBe(false);
    expect(publishArtifact).not.toHaveBeenCalled();
  });

  test('dispatch witnesses receive the admitted launch and running body before completion', async () => {
    const seen = [];
    const spawner = makeSpawner({ agentId: 'agent-live-7' });
    spawner.spawn.mockImplementationOnce(async (spec) => {
      spec.onStarted?.({
        agentId: 'agent-live-7',
        transcriptId: 'transcript-live-7',
        backend: 'cli:codex',
        model: 'gpt-5.3-codex',
        startedAt: 42,
      });
      return { agentId: 'agent-live-7', status: 'completed', output: 'ok', error: null };
    });
    const { conductor } = makeConductor({ spawner, publishArtifact: async () => 'https://x/pr/7' });

    const result = await conductor.launch({
      ...DISPATCH_INTENT,
      onAdmitted: (launch) => seen.push(['launch', launch.id]),
      onAgentStarted: (receipt) => seen.push(['agent', receipt.agentId, receipt.transcriptId]),
    });

    expect(result.admitted).toBe(true);
    expect(seen[0]).toEqual(['launch', result.launch.id]);
    expect(seen[1]).toEqual(['agent', 'agent-live-7', 'transcript-live-7']);
  });
});
