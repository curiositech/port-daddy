/**
 * Real-gate integration test for the ADR-0060 dispatch fold-in (FIX 5).
 *
 * The conductor-adapter unit tests use a FAKE conductor, so the REAL admission
 * gates (lineage reservation, global ceiling, capability scoping, depth, the
 * publish hook) are never exercised on a dispatch-SHAPED intent — the exact
 * shape `planToLaunchIntent` produces: `source:'dispatch'`, `worktree:'create'`,
 * `bondUsd === lineageCeilingUsd === budget`. This file closes that gap: it
 * builds a dispatch-shaped LaunchIntent via the real `planToLaunchIntent` from a
 * real `planRunFor` plan, then runs it through a REAL `createConductor` (real
 * breaker, fake spawner, injected mintWorktree/isMainCheckout so no git is
 * needed) and asserts the gates actually fire:
 *
 *   (a) the budget bond IS reserved against BOTH global + lineage BEFORE the
 *       spawn — proven behaviorally: a second dispatch admitted while the first
 *       is still in-flight (reservation outstanding) is REFUSED when its budget
 *       would push the global past its ceiling.
 *   (b) a dispatch whose budget exceeds the global ceiling is REFUSED with the
 *       breaker reason (GLOBAL / global-budget), never spawned.
 *   (c) a successful dispatch on the review policy CALLS publishArtifact and the
 *       returned URL lands in resultArtifact (the dispatch's PR artifact).
 */

import { jest } from '@jest/globals';
import Database from 'better-sqlite3';

import { createTestDb } from '../setup-unit.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { planRunFor } from '../../lib/dispatch/runner.js';
import { planToLaunchIntent } from '../../lib/dispatch/conductor-adapter.js';
import { createConductor } from '../../lib/fleet/conductor.js';

// ─── Fakes ─────────────────────────────────────────────────────────────────────

/** A spawner whose spawn never resolves until released — keeps a launch RUNNING
 *  so its lineage/global reservation stays outstanding (lets us prove (a)). */
function makePendingSpawner() {
  const calls = [];
  const resolvers = [];
  let counter = 0;
  const spawner = {
    calls,
    spawn: jest.fn((spec) => {
      calls.push(spec);
      const agentId = `agent-${++counter}`;
      return new Promise((resolve) => {
        resolvers.push(() => resolve({ agentId, status: 'completed', output: 'ok', error: null }));
      });
    }),
    kill: jest.fn(),
  };
  return { spawner, releaseAll: () => resolvers.forEach((fn) => fn()) };
}

/** A spawner that completes immediately (for the success/publish path). */
function makeImmediateSpawner() {
  let counter = 0;
  return {
    calls: [],
    spawn: jest.fn(async (spec) => {
      void spec;
      return { agentId: `agent-${++counter}`, status: 'completed', output: 'ok', error: null };
    }),
    kill: jest.fn(),
  };
}

/** Build a REAL dispatch-shaped LaunchIntent the way the production adapter does:
 *  propose → plan → planToLaunchIntent. budgetUsd flows to cap, bond, AND ceiling. */
function dispatchIntent({ goal = 'ship the feature', budgetUsd = 5, baseBranch = 'main' } = {}) {
  const db = createTestDb();
  const queue = createDispatchQueue({ db });
  const dispatch = queue.propose({
    goal,
    backend: 'cli:codex',
    budgetUsd,
    timeoutMs: 60 * 60 * 1000,
    baseBranch,
    mergePolicy: 'review',
  });
  const plan = planRunFor(dispatch, { backend: 'cli:codex' });
  return planToLaunchIntent(plan);
}

/** A real conductor with injected git-free worktree hooks + a real breaker. */
function makeRealConductor(over = {}) {
  const db = new Database(':memory:');
  const broadcasts = [];
  let clock = 1_700_000_000_000;
  const conductor = createConductor({
    db,
    spawner: over.spawner,
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    now: () => clock,
    maxDepth: 3,
    // No real git: a create-worktree mints a deterministic off-main path.
    isMainCheckout: over.isMainCheckout ?? ((w) => w === '/repo-main'),
    mintWorktree: over.mintWorktree ?? ((_l, intent) => intent.worktreePath ?? '/coding/tmp/wt-int'),
    publishArtifact: over.publishArtifact,
    publishTimeoutMs: over.publishTimeoutMs,
  });
  return { conductor, broadcasts, advance: (ms) => (clock += ms) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ─── (a) + (b): the bond reserves against global+lineage and the ceiling gates ──

describe('dispatch-shaped intent through the REAL conductor — admission gates', () => {
  test('planToLaunchIntent yields the exact dispatch shape the gates expect', () => {
    const intent = dispatchIntent({ budgetUsd: 6 });
    expect(intent.source).toBe('dispatch');
    expect(intent.worktree).toBe('create');
    // Admission uses bond+ceiling; finalization uses budgetUsd as the hard cap.
    expect(intent.budgetUsd).toBe(6);
    expect(intent.bondUsd).toBe(6);
    expect(intent.lineageCeilingUsd).toBe(6);
    expect(intent.mergePolicy).toBe('review');
  });

  test('(a) the budget bond is RESERVED against global+lineage before spawn (held while running)', async () => {
    // Global ceiling of $5. The first dispatch ($5) is admitted and stays in
    // flight (pending spawner), holding its $5 reservation against the global
    // scope. A second $1 dispatch then has NO room (5+1 > 5) → refused. If the
    // bond were NOT reserved before spawn, the second would wrongly be admitted.
    const { spawner, releaseAll } = makePendingSpawner();
    const { conductor } = makeRealConductor({ spawner });
    conductor.setGlobalCeiling(5);

    const firstP = conductor.launch(dispatchIntent({ budgetUsd: 5, goal: 'first' }));
    await tick(); // let the first reach `running` (reservation outstanding)
    expect(spawner.spawn).toHaveBeenCalledTimes(1); // it DID spawn → bond cleared admission

    // Second dispatch: its $1 bond cannot fit under the already-$5-reserved $5
    // global ceiling. It must be refused at admission and never spawn.
    const second = await conductor.launch(dispatchIntent({ budgetUsd: 1, goal: 'second' }));
    expect(second.admitted).toBe(false);
    expect(second.refusedReason).toMatch(/global|GLOBAL/i);
    expect(spawner.spawn).toHaveBeenCalledTimes(1); // still only the first spawned

    releaseAll();
    await firstP;
  });

  test('(b) a dispatch whose budget exceeds the global ceiling is REFUSED with the breaker reason', async () => {
    const spawner = makeImmediateSpawner();
    const { conductor } = makeRealConductor({ spawner });
    conductor.setGlobalCeiling(3); // tight global ceiling

    // A single $10 dispatch overshoots the $3 global ceiling outright.
    const res = await conductor.launch(dispatchIntent({ budgetUsd: 10, goal: 'too big' }));
    expect(res.admitted).toBe(false);
    expect(res.refusedReason).toMatch(/global|GLOBAL/i);
    expect(res.launch.state).toBe('refused');
    // The gate fired BEFORE any spawn — no body for a refused dispatch.
    expect(spawner.spawn).not.toHaveBeenCalled();
  });
});

// ─── (c): the review path publishes the PR artifact ──────────────────────────────

describe('dispatch-shaped intent through the REAL conductor — review publish', () => {
  test('(c) a successful review dispatch CALLS publishArtifact and lands the URL in resultArtifact', async () => {
    const spawner = makeImmediateSpawner();
    const publishArtifact = jest.fn(async (launch, intent) => {
      // Prove the hook receives the dispatch's worktree branch to push.
      expect(intent.source).toBe('dispatch');
      expect(intent.worktreeBranch).toBeTruthy();
      return `https://github.com/org/repo/pull/77?for=${launch.id.slice(0, 4)}`;
    });
    const { conductor } = makeRealConductor({ spawner, publishArtifact });
    conductor.setGlobalCeiling(100);

    const res = await conductor.launch(dispatchIntent({ budgetUsd: 4, goal: 'publish me' }));

    expect(res.admitted).toBe(true);
    expect(res.launch.state).toBe('produced');
    // The review path invoked publish exactly once and stored its URL.
    expect(publishArtifact).toHaveBeenCalledTimes(1);
    expect(res.launch.resultArtifact).toMatch(/^https:\/\/github\.com\/org\/repo\/pull\/77/);
    // The spawn ran on the minted OFF-MAIN worktree, not a main checkout.
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
    expect(spawner.spawn.mock.calls[0][0].workdir).not.toBe('/repo-main');
    expect(spawner.spawn.mock.calls[0][0].budgetUsd).toBe(4);
  });

  test('a dispatch never spawns on a main checkout (I2 holds for the dispatch shape)', async () => {
    const spawner = makeImmediateSpawner();
    // mintWorktree returns a MAIN checkout → the NO_SPAWN_ON_MAIN gate must catch it.
    const { conductor } = makeRealConductor({
      spawner,
      mintWorktree: () => '/repo-main',
      isMainCheckout: (w) => w === '/repo-main',
    });
    conductor.setGlobalCeiling(100);

    const res = await conductor.launch(dispatchIntent({ budgetUsd: 2 }));
    expect(res.launch.state).toBe('failed');
    expect(res.launch.errorMessage).toMatch(/NO_SPAWN_ON_MAIN/);
    expect(spawner.spawn).not.toHaveBeenCalled();
  });
});
