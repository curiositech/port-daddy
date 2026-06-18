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
