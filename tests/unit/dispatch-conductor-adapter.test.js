/**
 * Tests for lib/dispatch/conductor-adapter.ts — the Conductor-backed SpawnAdapter
 * (ADR-0060 dispatch fold-in).
 *
 * This is the seam that folds the FOURTH spawn surface (dispatch) into the ONE
 * Conductor primitive. It maps a RunnerPlan → LaunchIntent, calls
 * `conductor.launch(intent)`, and maps the LaunchResult → SpawnAdapterResult.
 *
 * Two things must hold and these tests pin BOTH:
 *   1. The LaunchIntent built from a RunnerPlan carries the dispatch's worktree
 *      (create + path/branch/baseRef), env, tube channel, budget-as-bond,
 *      budget-as-ceiling (a dispatch is its own root), and source:'dispatch'.
 *      Getting any of these wrong silently un-gates a dispatch (e.g. a missing
 *      bond means no lineage reservation) or spawns it on main.
 *   2. Every LaunchResult shape maps to the correct SpawnAdapterResult — refused,
 *      produced+artifact, settled, failed (with cost), halted→salvage, and an
 *      unexpected state → failed (not silently swallowed). A wrong mapping would
 *      e.g. report a refused (never-spawned) dispatch as settled, or discard a
 *      halted dispatch's salvageable worktree as a plain failure.
 *
 * These are real-bug tests: the fake conductor returns each exact LaunchResult
 * shape and we assert the precise SpawnAdapterResult, plus we inspect the intent
 * the adapter actually built.
 */

import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { planRunFor } from '../../lib/dispatch/runner.js';
import {
  createConductorSpawnAdapter,
  planToLaunchIntent,
} from '../../lib/dispatch/conductor-adapter.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Build a realistic RunnerPlan for a proposed dispatch via the real planner. */
function makePlan(over = {}) {
  const db = createTestDb();
  const queue = createDispatchQueue({ db });
  const dispatch = queue.propose({
    goal: over.goal ?? 'build the dispatch feature',
    backend: over.backend ?? 'cli:codex',
    budgetUsd: over.budgetUsd ?? 7,
    timeoutMs: over.timeoutMs ?? 90 * 60 * 1000,
    baseBranch: over.baseBranch ?? 'main',
    mergePolicy: over.mergePolicy ?? 'review',
  });
  // Claim the row so it is in `claimed` exactly as the runner leaves it before
  // invoking the adapter (the production path claims via `nextProposed` first).
  // The adapter's first act is `queue.start()`, which requires `claimed`.
  const claimed = (over.claim ?? true)
    ? queue.claim({
        id: dispatch.id,
        worktreePath: dispatch.worktreePath ?? '/coding/tmp/wt-test',
        branch: dispatch.branch ?? 'dispatch/test',
        sessionId: 'sess-test',
      })
    : dispatch;
  const plan = planRunFor(claimed, { backend: over.backend ?? 'cli:codex', model: over.model });
  return { plan, dispatch: claimed, queue, db };
}

/**
 * A fake conductor whose `launch` returns a scripted LaunchResult and records
 * the intent it was called with.
 */
function makeFakeConductor(result) {
  const intents = [];
  return {
    intents,
    launch: jest.fn(async (intent) => {
      intents.push(intent);
      return result;
    }),
  };
}

/** A minimal Launch row shape the adapter reads fields off of. */
function launch(fields = {}) {
  return {
    id: 'launch-1',
    rootId: 'launch-1',
    parentId: 'operator',
    depth: 0,
    goal: 'g',
    source: 'dispatch',
    backend: 'cli:codex',
    state: 'produced',
    capabilities: [],
    bondUsd: 7,
    lineageCeilingUsd: 7,
    worktree: 'create',
    mergePolicy: 'review',
    agentId: 'agent-1',
    resultArtifact: null,
    costUsd: null,
    errorMessage: null,
    refusedReason: null,
    createdAt: 1,
    settledAt: null,
    ...fields,
  };
}

// ─── planToLaunchIntent — the RunnerPlan → LaunchIntent mapping ─────────────────

describe('planToLaunchIntent', () => {
  test('maps a dispatch plan to a worktree:create, source:dispatch LaunchIntent', () => {
    const { plan, dispatch } = makePlan({ budgetUsd: 7, goal: 'do a thing' });
    const intent = planToLaunchIntent(plan);

    expect(intent.source).toBe('dispatch');
    expect(intent.goal).toBe(dispatch.goal);
    expect(intent.backend).toBe('cli:codex');

    // Worktree mint request — the off-main branch the Conductor must carve.
    expect(intent.worktree).toBe('create');
    expect(intent.worktreePath).toBe(plan.worktreePath);
    expect(intent.worktreeBranch).toBe(plan.branch);
    expect(intent.worktreeBaseRef).toBe(plan.baseRef);
    expect(intent.worktreeBaseRef).toBe('origin/main');

    // env + tube channel passthrough.
    expect(intent.env).toEqual(plan.env);
    expect(intent.tubeChannel).toBe(`dispatch:${dispatch.id}`);

    // A dispatch always wants a reviewable PR → review.
    expect(intent.mergePolicy).toBe('review');
  });

  test('bond AND lineage ceiling both equal the dispatch budget (a dispatch is its own root)', () => {
    const { plan } = makePlan({ budgetUsd: 12 });
    const intent = planToLaunchIntent(plan);
    // budgetUsd clamps to <= 25; 12 passes through.
    expect(plan.budgetUsd).toBe(12);
    expect(intent.bondUsd).toBe(12);
    expect(intent.lineageCeilingUsd).toBe(12);
    // The ceiling MUST equal the bond/budget: a dispatch heads its own lineage,
    // so its whole subtree is bounded by exactly the budget the operator set.
    expect(intent.lineageCeilingUsd).toBe(intent.bondUsd);
  });

  test('forwards the timeout and model from the plan', () => {
    const { plan } = makePlan({ model: 'claude-haiku-4-5', timeoutMs: 45 * 60 * 1000 });
    const intent = planToLaunchIntent(plan);
    expect(intent.timeoutMs).toBe(plan.timeoutMs);
    expect(intent.model).toBe('claude-haiku-4-5');
  });

  test('any dispatch mergePolicy maps to review (never suppress the PR)', () => {
    // `queue.propose` currently rejects 'auto' (harbormaster not wired), so we
    // build the plan from a hand-made dispatch row to prove the mapping is
    // policy-agnostic: whatever a dispatch's stored mergePolicy is, the spawn
    // always opens a reviewable PR — we map to 'review', never 'never'.
    const { plan } = makePlan({ mergePolicy: 'never' });
    const planAuto = { ...plan, dispatch: { ...plan.dispatch, mergePolicy: 'auto' } };
    expect(planToLaunchIntent(planAuto).mergePolicy).toBe('review');
    const planNever = { ...plan, dispatch: { ...plan.dispatch, mergePolicy: 'never' } };
    expect(planToLaunchIntent(planNever).mergePolicy).toBe('review');
  });
});

// ─── createConductorSpawnAdapter — the LaunchResult → SpawnAdapterResult mapping ─

describe('createConductorSpawnAdapter — result mapping', () => {
  test('refused (!admitted) → failed with the refusal reason', async () => {
    const conductor = makeFakeConductor({
      admitted: false,
      refusedReason: 'lineage budget would be exceeded by $7.0000 (LINEAGE_BUDGET_CONSERVED)',
      launch: launch({ state: 'refused' }),
      spawn: null,
    });
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan, queue } = makePlan();

    const res = await adapter({ plan, queue });

    expect(res.state).toBe('failed');
    expect(res.errorMessage).toMatch(/LINEAGE_BUDGET_CONSERVED/);
    // A refused launch never spawned → no cost, no artifact.
    expect(res.costUsd).toBeUndefined();
    expect(res.resultArtifact).toBeUndefined();
  });

  test('refused with no reason → failed with a default "refused" message', async () => {
    const conductor = makeFakeConductor({
      admitted: false,
      refusedReason: null,
      launch: launch({ state: 'refused' }),
      spawn: null,
    });
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan, queue } = makePlan();
    const res = await adapter({ plan, queue });
    expect(res.state).toBe('failed');
    expect(res.errorMessage).toBe('refused');
  });

  test('produced + artifact → settled with the artifact URL and cost', async () => {
    const conductor = makeFakeConductor({
      admitted: true,
      refusedReason: null,
      launch: launch({
        state: 'produced',
        costUsd: 2.5,
        resultArtifact: 'https://github.com/org/repo/pull/42',
      }),
      spawn: { agentId: 'agent-1', status: 'completed', output: 'ok', error: null },
    });
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan, queue } = makePlan();

    const res = await adapter({ plan, queue });

    expect(res.state).toBe('settled');
    expect(res.resultArtifact).toBe('https://github.com/org/repo/pull/42');
    expect(res.costUsd).toBe(2.5);
  });

  test('settled → settled (carries artifact + cost)', async () => {
    const conductor = makeFakeConductor({
      admitted: true,
      refusedReason: null,
      launch: launch({ state: 'settled', costUsd: 1.0, resultArtifact: 'https://x/pr/9' }),
      spawn: { agentId: 'agent-1', status: 'completed', output: 'ok', error: null },
    });
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan, queue } = makePlan();
    const res = await adapter({ plan, queue });
    expect(res.state).toBe('settled');
    expect(res.resultArtifact).toBe('https://x/pr/9');
    expect(res.costUsd).toBe(1.0);
  });

  test.each(['produced', 'settled'])(
    '%s without an artifact → salvage so dirty work cannot be reaped',
    async (state) => {
      const conductor = makeFakeConductor({
        admitted: true,
        refusedReason: null,
        launch: launch({ state, costUsd: 0.6, resultArtifact: null }),
        spawn: { agentId: 'agent-1', status: 'completed', output: 'ok', error: null },
      });
      const adapter = createConductorSpawnAdapter(conductor);
      const { plan, queue } = makePlan();

      const res = await adapter({ plan, queue });

      expect(res.state).toBe('salvage');
      expect(res.costUsd).toBe(0.6);
      expect(res.resultArtifact).toBeUndefined();
      expect(res.errorMessage).toMatch(/without a reviewable artifact.*preserved/i);
    },
  );

  test('failed → failed (carries cost + error, no artifact)', async () => {
    const conductor = makeFakeConductor({
      admitted: true,
      refusedReason: null,
      launch: launch({ state: 'failed', costUsd: 0.8, errorMessage: 'agent exited 1', resultArtifact: null }),
      spawn: { agentId: 'agent-1', status: 'failed', output: '', error: 'agent exited 1' },
    });
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan, queue } = makePlan();

    const res = await adapter({ plan, queue });

    expect(res.state).toBe('failed');
    expect(res.errorMessage).toBe('agent exited 1');
    expect(res.costUsd).toBe(0.8);
    expect(res.resultArtifact).toBeUndefined();
  });

  test('halted → salvage (preserve the worktree/transcript, do NOT discard as failure)', async () => {
    const conductor = makeFakeConductor({
      admitted: true,
      refusedReason: null,
      launch: launch({ state: 'halted', errorMessage: null }),
      spawn: { agentId: 'agent-1', status: 'completed', output: 'ok', error: null },
    });
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan, queue } = makePlan();

    const res = await adapter({ plan, queue });

    expect(res.state).toBe('salvage');
    expect(res.errorMessage).toBe('halted');
  });

  test('an unexpected/unmapped launch state → failed (not silently swallowed)', async () => {
    const conductor = makeFakeConductor({
      admitted: true,
      refusedReason: null,
      launch: launch({ state: 'embodied' }), // a non-terminal state launch() never returns
      spawn: null,
    });
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan, queue } = makePlan();

    const res = await adapter({ plan, queue });

    expect(res.state).toBe('failed');
    expect(res.errorMessage).toMatch(/unexpected launch state: embodied/);
  });

  test('the adapter calls conductor.launch with the intent built from the plan', async () => {
    const conductor = makeFakeConductor({
      admitted: true,
      refusedReason: null,
      launch: launch({ state: 'produced', resultArtifact: 'https://x/pr/1' }),
      spawn: { agentId: 'agent-1', status: 'completed', output: 'ok', error: null },
    });
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan, queue, dispatch } = makePlan({ budgetUsd: 9 });

    await adapter({ plan, queue });

    expect(conductor.launch).toHaveBeenCalledTimes(1);
    const intent = conductor.intents[0];
    expect(intent.source).toBe('dispatch');
    expect(intent.worktree).toBe('create');
    expect(intent.bondUsd).toBe(9);
    expect(intent.lineageCeilingUsd).toBe(9);
    expect(intent.tubeChannel).toBe(`dispatch:${dispatch.id}`);
  });
});

// ─── FIX 2 (HIGH): the adapter visits in_progress via queue.start BEFORE launch ─
//
// The legacy spawn-adapter called queue.start(id) at the claimed→in_progress
// step. The Conductor adapter ignored the queue entirely, so a dispatch stayed
// `claimed` for the whole run: in_progress never visited, started_at/duration_ms
// never set, and recoverStranded re-queued claimed rows too aggressively
// (duplicate runs after a crash). These tests pin: (a) queue.start(id) is called
// BEFORE conductor.launch; (b) a start that throws → {state:'failed'} and
// conductor.launch is NOT called.
describe('createConductorSpawnAdapter — queue.start (in_progress) ordering', () => {
  /** A spy queue recording the call order of start vs the conductor.launch. */
  function makeSpyQueue(order, { startThrows = false } = {}) {
    return {
      start: jest.fn((id) => {
        order.push(`start:${id}`);
        if (startThrows) throw new Error('dispatch was cancelled');
        return { id, state: 'in_progress' };
      }),
    };
  }

  test('queue.start(id) is called BEFORE conductor.launch', async () => {
    const order = [];
    const conductor = {
      intents: [],
      launch: jest.fn(async (intent) => {
        order.push('launch');
        conductor.intents.push(intent);
        return {
          admitted: true,
          refusedReason: null,
          launch: launch({ state: 'produced', resultArtifact: 'https://x/pr/7' }),
          spawn: { agentId: 'agent-1', status: 'completed', output: 'ok', error: null },
        };
      }),
    };
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan } = makePlan();
    const spyQueue = makeSpyQueue(order);

    const res = await adapter({ plan, queue: spyQueue });

    // start happened, and it happened strictly before launch.
    expect(spyQueue.start).toHaveBeenCalledTimes(1);
    expect(spyQueue.start).toHaveBeenCalledWith(plan.dispatch.id);
    expect(order).toEqual([`start:${plan.dispatch.id}`, 'launch']);
    // The run still maps through normally.
    expect(res.state).toBe('settled');
    expect(res.resultArtifact).toBe('https://x/pr/7');
  });

  test('a queue.start that throws → {state:failed} and conductor.launch is NOT called', async () => {
    const order = [];
    const conductor = {
      launch: jest.fn(async () => {
        order.push('launch');
        return { admitted: true, refusedReason: null, launch: launch({ state: 'produced' }), spawn: null };
      }),
    };
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan } = makePlan();
    const spyQueue = makeSpyQueue(order, { startThrows: true });

    const res = await adapter({ plan, queue: spyQueue });

    expect(res.state).toBe('failed');
    expect(res.errorMessage).toMatch(/to in_progress: dispatch was cancelled/);
    // CRITICAL: we never spawn a body for a dispatch we couldn't start.
    expect(conductor.launch).not.toHaveBeenCalled();
    expect(order).toEqual([`start:${plan.dispatch.id}`]); // start tried, no launch
  });

  test('end-to-end with a REAL queue: the row actually visits in_progress (started_at set)', async () => {
    // Proves the integration, not just the spy: a real claimed row is moved to
    // in_progress by the adapter, so started_at is stamped and duration is
    // computable. Without queue.start the row would stay `claimed`.
    const conductor = makeFakeConductor({
      admitted: true,
      refusedReason: null,
      launch: launch({ state: 'produced', resultArtifact: 'https://x/pr/3', costUsd: 1.2 }),
      spawn: { agentId: 'agent-1', status: 'completed', output: 'ok', error: null },
    });
    const adapter = createConductorSpawnAdapter(conductor);
    const { plan, queue } = makePlan();

    // Before: claimed, no started_at.
    expect(queue.get(plan.dispatch.id).state).toBe('claimed');
    expect(queue.get(plan.dispatch.id).startedAt).toBeNull();

    await adapter({ plan, queue });

    // After: the adapter advanced the row to in_progress and stamped started_at.
    const row = queue.get(plan.dispatch.id);
    expect(row.state).toBe('in_progress');
    expect(row.startedAt).not.toBeNull();
  });
});
