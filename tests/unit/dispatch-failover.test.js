/**
 * Cross-backend failover policy (lib/dispatch/failover.ts + the runner seam).
 *
 * These are spend tests as much as correctness tests. Every decision this module
 * makes either costs money (mint another body) or costs the work (give up), and
 * the failure mode that motivated the module — a dispatch dying because one
 * backend was unavailable, with an operator re-proposing by hand and paying
 * twice — is exactly the failure a naive "just retry" would make worse.
 *
 * So the beliefs are written down as assertions:
 *
 *   1. A retry happens ONLY for a genuinely transient cause, and only once.
 *   2. A missing binary skips the retry entirely — it will still be missing.
 *   3. A goal the backend rejected outright is not tried on another body.
 *   4. A successor never gets more budget than the original had left.
 *   5. A dispatch that fails over settles to `salvage`, never `failed`, because
 *      `failed` is reaped and the worktree is the handoff's only source.
 */

import { describe, test, expect, jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';

const {
  decideFailover,
  classifyForFailover,
  remainingBudget,
  DEFAULT_FAILOVER_CHAIN,
  MAX_FAILOVER_ATTEMPTS,
} = await import('../../lib/dispatch/failover.js');
const { createDispatchQueue } = await import('../../lib/dispatch/queue.js');
const { runClaimedDispatch } = await import('../../lib/dispatch/runner.js');

/** A dispatch-shaped object with only the fields the policy reads. */
function dispatchLike(over = {}) {
  return {
    id: 'd1',
    goal: 'do the thing',
    tags: [],
    baseBranch: 'main',
    mergePolicy: 'review',
    requestedBy: 'operator',
    backend: 'cli:codex',
    budgetUsd: 1.0,
    costUsd: null,
    timeoutMs: null,
    failoverAttempt: 0,
    failoverChain: null,
    ...over,
  };
}

describe('classifyForFailover', () => {
  test('a missing binary is BACKEND_ABSENT, not a transient error', () => {
    // The distinction is load-bearing: ENOENT also reads as a connection-ish
    // failure to a regex written for sockets, and calling it transient buys a
    // guaranteed-useless same-backend retry.
    const shape = classifyForFailover('spawn codex ENOENT', 'cli:codex');
    expect(shape.backendAbsent).toBe(true);
    expect(shape.transient).toBe(false);
  });

  test('rate limits and timeouts are transient', () => {
    expect(classifyForFailover('429 rate limit exceeded').transient).toBe(true);
    expect(classifyForFailover('request timed out after 600s').transient).toBe(true);
    expect(classifyForFailover('503 service unavailable').transient).toBe(true);
  });

  test('an unrecognised failure is NOT transient (fail closed)', () => {
    expect(classifyForFailover('the model produced nonsense').transient).toBe(false);
  });
});

describe('decideFailover', () => {
  test('a transient failure retries the SAME backend once', () => {
    const d = decideFailover(dispatchLike(), {
      backend: 'cli:codex',
      errorMessage: '429 rate limit exceeded',
    });
    expect(d.action).toBe('retry-same-backend');
  });

  test('a transient failure that already had its retry moves to the next backend', () => {
    const d = decideFailover(dispatchLike(), {
      backend: 'cli:codex',
      errorMessage: '429 rate limit exceeded',
      alreadyRetriedSameBackend: true,
    });
    expect(d.action).toBe('failover');
    expect(d.nextBackend).not.toBe('cli:codex');
  });

  test('a missing binary fails over IMMEDIATELY, with no same-backend retry', () => {
    const d = decideFailover(dispatchLike(), {
      backend: 'cli:codex',
      errorMessage: 'spawn codex ENOENT',
    });
    expect(d.action).toBe('failover');
    expect(d.nextBackend).toBe('cli:claude-code'); // first in the default chain
    expect(d.reason).toMatch(/not available on this machine/);
  });

  test('a goal the backend rejected is not retried on another body', () => {
    // Another backend would fail the same way; spending to learn that again is
    // the loop this guard exists to prevent.
    const d = decideFailover(dispatchLike(), {
      backend: 'cli:codex',
      errorMessage: '400 invalid api key',
    });
    expect(d.action).toBe('none');
  });

  test('the succession is capped', () => {
    const d = decideFailover(dispatchLike({ failoverAttempt: MAX_FAILOVER_ATTEMPTS }), {
      backend: 'cli:codex',
      errorMessage: 'spawn codex ENOENT',
    });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/cap reached/);
  });

  test("a dispatch's OWN frozen chain wins over the live preference order", () => {
    // A chain read fresh at each hop would let a profile edit mid-flight
    // redirect a succession already underway, so the chain a lane renders would
    // not be the chain that ran.
    const d = decideFailover(
      dispatchLike({ failoverAttempt: 1, failoverChain: ['cli:gemini', 'cli:agy'] }),
      {
        backend: 'cli:codex',
        errorMessage: 'spawn codex ENOENT',
        preferredChain: ['cli:claude-code'],
      },
    );
    expect(d.nextBackend).toBe('cli:gemini');
    expect(d.remainingChain).toEqual(['cli:agy']);
  });

  test('an API backend is never a failover target', () => {
    // An API backend is a provider call, not an agent harness: no worktree, no
    // tools, no transcript. A dispatch cannot continue on one however available.
    const d = decideFailover(dispatchLike(), {
      backend: 'cli:codex',
      errorMessage: 'spawn codex ENOENT',
      preferredChain: ['openai', 'cloudflare', 'cli:gemini'],
    });
    expect(d.nextBackend).toBe('cli:gemini');
  });

  test('a backend the caller reports unavailable is skipped', () => {
    const d = decideFailover(dispatchLike(), {
      backend: 'cli:codex',
      errorMessage: 'spawn codex ENOENT',
      isUnavailable: (b) => b === 'cli:claude-code',
    });
    expect(d.nextBackend).toBe('cli:gemini');
  });

  test('the successor gets the REMAINING budget, never a fresh one', () => {
    const d = decideFailover(dispatchLike({ budgetUsd: 1.0, costUsd: 0.3 }), {
      backend: 'cli:codex',
      errorMessage: 'spawn codex ENOENT',
      costUsd: 0.2,
    });
    expect(d.action).toBe('failover');
    expect(d.remainingBudgetUsd).toBeCloseTo(0.5, 4);
  });

  test('an exhausted budget stops the succession rather than double-spending', () => {
    const d = decideFailover(dispatchLike({ budgetUsd: 0.5, costUsd: 0.5 }), {
      backend: 'cli:codex',
      errorMessage: 'spawn codex ENOENT',
    });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/budget exhausted/);
  });

  test('an unbudgeted dispatch is not treated as broke', () => {
    // null budget and zero budget are different facts; collapsing them turns
    // "unbudgeted" into "out of money" and stops a succession that had no cap.
    expect(remainingBudget(dispatchLike({ budgetUsd: null }))).toBeNull();
    const d = decideFailover(dispatchLike({ budgetUsd: null }), {
      backend: 'cli:codex',
      errorMessage: 'spawn codex ENOENT',
    });
    expect(d.action).toBe('failover');
  });

  test('the default chain leads with the only backend that has a verified harness', () => {
    // Instrumentation honesty, not preference alone: a successor landing on
    // claude-code keeps the controls ADR-0124 can actually render as enabled.
    expect(DEFAULT_FAILOVER_CHAIN[0]).toBe('cli:claude-code');
  });
});

describe('runClaimedDispatch — the failover seam', () => {
  let db;
  let queue;

  beforeEach(() => {
    db = createTestDb();
    queue = createDispatchQueue({ db });
  });

  afterEach(() => {
    db.close();
  });

  /** Claim a dispatch so the runner will accept it. */
  function claimed(goal, over = {}) {
    const d = queue.propose({ goal, backend: 'cli:codex', budgetUsd: 1, ...over });
    return queue.claimProposed({
      id: d.id,
      worktreePath: '/tmp/wt',
      branch: 'dispatch/x',
      sessionId: 's1',
      workerActorId: 'test',
    });
  }

  test('a failed dispatch that fails over settles to SALVAGE, so its worktree survives', async () => {
    // The whole point: `failed` is reaped by the worker, and the worktree holds
    // the transcript the successor's handoff capsule is built from. Reaping it
    // first leaves a restart wearing a successor's name.
    const d = claimed('write a design note');
    const mintSuccessor = jest.fn(async () => queue.propose({ goal: 'successor' }));

    const { result } = await runClaimedDispatch(queue, d, {
      spawnAdapter: async () => ({ state: 'failed', errorMessage: 'spawn codex ENOENT' }),
      failover: { enabled: true, mintSuccessor },
    });

    expect(mintSuccessor).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('salvage');
    expect(queue.get(d.id).state).toBe('salvage');
    expect(result.errorMessage).toMatch(/continued as/);
    expect(result.errorMessage).toMatch(/worktree preserved/);
  });

  test('with failover OFF a failure settles exactly as it always did', async () => {
    const d = claimed('write a design note');
    const { result } = await runClaimedDispatch(queue, d, {
      spawnAdapter: async () => ({ state: 'failed', errorMessage: 'spawn codex ENOENT' }),
    });
    expect(result.state).toBe('failed');
    expect(queue.get(d.id).state).toBe('failed');
  });

  test('the successor carries the predecessor edge, the next backend, and the remaining budget', async () => {
    const d = claimed('write a design note');
    let request = null;
    await runClaimedDispatch(queue, d, {
      spawnAdapter: async () => ({
        state: 'failed',
        errorMessage: 'spawn codex ENOENT',
        costUsd: 0.25,
      }),
      failover: {
        enabled: true,
        mintSuccessor: async (req) => {
          request = req;
          return queue.propose({ goal: req.goal, backend: req.backend });
        },
      },
    });

    expect(request.predecessor.id).toBe(d.id);
    expect(request.backend).toBe('cli:claude-code');
    expect(request.failoverFromBackend).toBe('cli:codex');
    expect(request.failoverAttempt).toBe(1);
    expect(request.budgetUsd).toBeCloseTo(0.75, 4);
  });

  test('a handoff builder warms the successor; its failure degrades to a cold one', async () => {
    const d = claimed('write a design note');
    let warm = null;
    await runClaimedDispatch(queue, d, {
      spawnAdapter: async () => ({ state: 'failed', errorMessage: 'spawn codex ENOENT' }),
      failover: {
        enabled: true,
        buildHandoff: async () => ({ goal: 'CONTINUE: here is what the last body learned', episodeId: 'ep-1' }),
        mintSuccessor: async (req) => {
          warm = req;
          return queue.propose({ goal: req.goal });
        },
      },
    });
    expect(warm.goal).toMatch(/^CONTINUE:/);
    expect(warm.handoffEpisodeId).toBe('ep-1');

    const d2 = claimed('another note');
    let cold = null;
    await runClaimedDispatch(queue, d2, {
      spawnAdapter: async () => ({ state: 'failed', errorMessage: 'spawn codex ENOENT' }),
      failover: {
        enabled: true,
        buildHandoff: async () => {
          throw new Error('no transcript for this dispatch');
        },
        mintSuccessor: async (req) => {
          cold = req;
          return queue.propose({ goal: req.goal });
        },
      },
    });
    // A cold continue still beats a dead dispatch.
    expect(cold.goal).toBe('another note');
    expect(cold.handoffEpisodeId).toBeNull();
  });

  test('a minter that fails leaves the ORIGINAL failure intact', async () => {
    // Failover must never worsen the failure it is handling.
    const d = claimed('write a design note');
    const { result } = await runClaimedDispatch(queue, d, {
      spawnAdapter: async () => ({ state: 'failed', errorMessage: 'spawn codex ENOENT' }),
      failover: { enabled: true, mintSuccessor: async () => null },
    });
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('spawn codex ENOENT');
  });

  test('a settled dispatch is never routed through failover', async () => {
    const d = claimed('write a design note');
    const mintSuccessor = jest.fn(async () => null);
    const { result } = await runClaimedDispatch(queue, d, {
      spawnAdapter: async () => ({ state: 'settled', resultArtifact: 'https://pr/1' }),
      failover: { enabled: true, mintSuccessor },
    });
    expect(result.state).toBe('settled');
    expect(mintSuccessor).not.toHaveBeenCalled();
  });

  test('a receipt is written even when NO successor is minted', async () => {
    // "We considered a successor and here is why there is none" is the answer an
    // operator staring at a dead dispatch actually needs.
    const d = claimed('write a design note');
    const receipts = [];
    await runClaimedDispatch(queue, d, {
      spawnAdapter: async () => ({ state: 'failed', errorMessage: '400 malformed request' }),
      failover: {
        enabled: true,
        mintSuccessor: async () => null,
        onReceipt: (r) => receipts.push(r),
      },
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].successorId).toBeNull();
    expect(receipts[0].toBackend).toBeNull();
    expect(receipts[0].reason).toMatch(/VALIDATION_ERROR/);
  });
});

describe('dispatch rows carry the succession edge', () => {
  let db;
  let queue;

  beforeEach(() => {
    db = createTestDb();
    queue = createDispatchQueue({ db });
  });

  afterEach(() => {
    db.close();
  });

  test('an ordinary dispatch reads exactly as before (all succession fields empty)', () => {
    const d = queue.propose({ goal: 'ordinary' });
    expect(d.predecessorDispatchId).toBeNull();
    expect(d.failoverAttempt).toBe(0);
    expect(d.failoverFromBackend).toBeNull();
    expect(d.handoffEpisodeId).toBeNull();
    expect(d.spawnedAgentId).toBeNull();
    expect(d.failoverChain).toBeNull();
  });

  test('a successor round-trips its edge, chain, and episode', () => {
    const first = queue.propose({ goal: 'first' });
    const second = queue.propose({
      goal: 'second',
      predecessorDispatchId: first.id,
      failoverAttempt: 1,
      failoverFromBackend: 'cli:codex',
      handoffEpisodeId: 'ep-7',
      failoverChain: ['cli:gemini', 'cli:agy'],
    });
    const reloaded = queue.get(second.id);
    expect(reloaded.predecessorDispatchId).toBe(first.id);
    expect(reloaded.failoverAttempt).toBe(1);
    expect(reloaded.failoverFromBackend).toBe('cli:codex');
    expect(reloaded.handoffEpisodeId).toBe('ep-7');
    expect(reloaded.failoverChain).toEqual(['cli:gemini', 'cli:agy']);
  });

  test('recordSpawnedAgent stamps the transcript join key', () => {
    // Without this a dispatch cannot be joined to its fleet_transcripts row —
    // the gap that made both the capsule builder and the live lane impossible.
    const d = queue.propose({ goal: 'needs a transcript link' });
    expect(queue.get(d.id).spawnedAgentId).toBeNull();
    queue.recordSpawnedAgent(d.id, 'agent-abc123');
    expect(queue.get(d.id).spawnedAgentId).toBe('agent-abc123');
  });

  test('a corrupt failover chain reads as absent rather than throwing', () => {
    // A succession that cannot read its chain should settle honestly, not throw
    // while unwinding a failure.
    const d = queue.propose({ goal: 'corrupt chain' });
    db.prepare('UPDATE dispatches SET failover_chain_json = ? WHERE id = ?').run('{not json', d.id);
    expect(queue.get(d.id).failoverChain).toBeNull();
  });
});
