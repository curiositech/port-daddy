/**
 * Spawn Gather Policies tests — fan-out coordination semantics.
 *
 * Each test uses fake ChildHandles whose run() promises resolve on a
 * controllable timer. That lets us assert "first success wins, others
 * killed" without launching real subprocesses or hitting the daemon.
 */

import {
  parseGatherPolicy,
  gatherAll,
  gatherFirst,
  gatherMajority,
  gatherQuorum,
  gatherRace,
  gatherByPolicy,
  GatherPolicyError,
} from '../../lib/spawn-gather.js';

// Tiny helper: an arming-knob mock child. The run() promise resolves with
// the configured result after `delayMs`. If kill() fires first, it resolves
// immediately with status 'killed' (mirroring what the real launcher does).
function makeChild({ id, delayMs, result, killedResult }) {
  let killTimer = null;
  let resolved = false;
  let resolveFn;
  const runPromise = new Promise((resolve) => {
    resolveFn = resolve;
    killTimer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    }, delayMs);
  });
  return {
    agentId: id,
    run: () => runPromise,
    kill: () => {
      if (resolved) return;
      resolved = true;
      if (killTimer) clearTimeout(killTimer);
      resolveFn(killedResult || {
        agentId: id,
        status: 'killed',
        output: null,
        error: 'Killed by gather policy',
      });
    },
  };
}

function ok(id, output = `out-${id}`) {
  return { agentId: id, status: 'completed', output, error: null };
}
function fail(id, error = `boom-${id}`) {
  return { agentId: id, status: 'failed', output: null, error };
}

describe('parseGatherPolicy', () => {
  test('parses each policy name', () => {
    expect(parseGatherPolicy('all')).toEqual({ policy: 'all' });
    expect(parseGatherPolicy('first')).toEqual({ policy: 'first' });
    expect(parseGatherPolicy('majority')).toEqual({ policy: 'majority' });
    expect(parseGatherPolicy('race')).toEqual({ policy: 'race' });
    expect(parseGatherPolicy('quorum=3')).toEqual({ policy: 'quorum', k: 3 });
  });

  test('case-insensitive + trimmed', () => {
    expect(parseGatherPolicy('  FIRST  ')).toEqual({ policy: 'first' });
    expect(parseGatherPolicy('Quorum=2')).toEqual({ policy: 'quorum', k: 2 });
  });

  test('throws on unknown policy', () => {
    expect(() => parseGatherPolicy('whatever')).toThrow(GatherPolicyError);
    expect(() => parseGatherPolicy('quorum=')).toThrow(GatherPolicyError);
    expect(() => parseGatherPolicy('quorum=0')).toThrow(GatherPolicyError);
    expect(() => parseGatherPolicy('')).toThrow(GatherPolicyError);
  });
});

describe('gatherAll', () => {
  test('waits for every child to settle', async () => {
    const children = [
      makeChild({ id: 'a', delayMs: 5, result: ok('a') }),
      makeChild({ id: 'b', delayMs: 10, result: ok('b') }),
      makeChild({ id: 'c', delayMs: 15, result: ok('c') }),
    ];
    const result = await gatherAll(children);
    expect(result.all).toHaveLength(3);
    expect(result.killed).toHaveLength(0);
    expect(result.policy.policy).toBe('all');
    // First to settle is the winner under 'all'.
    expect(result.winner.agentId).toBe('a');
  });

  test('refuses empty children', async () => {
    await expect(gatherAll([])).rejects.toThrow(GatherPolicyError);
  });
});

describe('gatherFirst', () => {
  test('returns first success and kills the rest', async () => {
    const children = [
      makeChild({ id: 'slow', delayMs: 100, result: ok('slow') }),
      makeChild({ id: 'fast', delayMs: 5, result: ok('fast') }),
      makeChild({ id: 'medium', delayMs: 50, result: ok('medium') }),
    ];
    const result = await gatherFirst(children);
    expect(result.winner.agentId).toBe('fast');
    expect(result.winner.status).toBe('completed');
    // The other two should be marked killed (in their kill-result shapes).
    expect(result.killed).toHaveLength(2);
    const killedIds = new Set(result.killed.map((k) => k.agentId));
    expect(killedIds.has('slow')).toBe(true);
    expect(killedIds.has('medium')).toBe(true);
    for (const k of result.killed) expect(k.status).toBe('killed');
    expect(result.policy.policy).toBe('first');
  });

  test('skips failed children, picks first SUCCESS even if a failure settled earlier', async () => {
    const children = [
      makeChild({ id: 'early-fail', delayMs: 5, result: fail('early-fail') }),
      makeChild({ id: 'late-ok', delayMs: 30, result: ok('late-ok') }),
      makeChild({ id: 'never-ok', delayMs: 200, result: ok('never-ok') }),
    ];
    const result = await gatherFirst(children);
    expect(result.winner.agentId).toBe('late-ok');
    expect(result.winner.status).toBe('completed');
    expect(result.killed.find((k) => k.agentId === 'never-ok')).toBeDefined();
  });

  test('all-fail → last failure surfaces as winner so caller sees the error', async () => {
    const children = [
      makeChild({ id: 'a', delayMs: 5, result: fail('a') }),
      makeChild({ id: 'b', delayMs: 10, result: fail('b') }),
    ];
    const result = await gatherFirst(children);
    expect(result.winner.status).toBe('failed');
    expect(result.killed).toHaveLength(0);
  });
});

describe('gatherMajority', () => {
  test('returns after ceil(N/2)+1 successes (N=3 → 2 successes)', async () => {
    const children = [
      makeChild({ id: 'a', delayMs: 5, result: ok('a') }),
      makeChild({ id: 'b', delayMs: 10, result: ok('b') }),
      makeChild({ id: 'slow-c', delayMs: 200, result: ok('slow-c') }),
    ];
    const result = await gatherMajority(children);
    expect(result.policy.policy).toBe('majority');
    // The third (slow-c) should be killed since majority (2/3) is reached.
    expect(result.killed.find((k) => k.agentId === 'slow-c')).toBeDefined();
    expect(result.killed.find((k) => k.agentId === 'slow-c').status).toBe('killed');
    // Winner is the last success that completed the quorum.
    expect(result.winner.status).toBe('completed');
    expect(['a', 'b']).toContain(result.winner.agentId);
  });

  test('N=5 → 3 successes', async () => {
    const children = [
      makeChild({ id: 'a', delayMs: 5, result: ok('a') }),
      makeChild({ id: 'b', delayMs: 10, result: ok('b') }),
      makeChild({ id: 'c', delayMs: 15, result: ok('c') }),
      makeChild({ id: 'd', delayMs: 200, result: ok('d') }),
      makeChild({ id: 'e', delayMs: 200, result: ok('e') }),
    ];
    const result = await gatherMajority(children);
    // d and e should be killed (3/5 majority hit by c)
    const killedIds = new Set(result.killed.map((k) => k.agentId));
    expect(killedIds.has('d')).toBe(true);
    expect(killedIds.has('e')).toBe(true);
  });
});

describe('gatherQuorum', () => {
  test('returns after exactly K successes', async () => {
    const children = [
      makeChild({ id: 'a', delayMs: 5, result: ok('a') }),
      makeChild({ id: 'b', delayMs: 10, result: ok('b') }),
      makeChild({ id: 'c', delayMs: 200, result: ok('c') }),
      makeChild({ id: 'd', delayMs: 200, result: ok('d') }),
    ];
    const result = await gatherQuorum(children, 2);
    expect(result.policy).toEqual({ policy: 'quorum', k: 2 });
    // After 2 succeed (a, b), the other two should be killed
    const killedIds = new Set(result.killed.map((k) => k.agentId));
    expect(killedIds.has('c')).toBe(true);
    expect(killedIds.has('d')).toBe(true);
  });

  test('K > N → error', async () => {
    const children = [
      makeChild({ id: 'a', delayMs: 5, result: ok('a') }),
    ];
    await expect(gatherQuorum(children, 5)).rejects.toThrow(GatherPolicyError);
  });
});

describe('gatherRace', () => {
  test('returns on FIRST settle, success or failure', async () => {
    const children = [
      makeChild({ id: 'fast-fail', delayMs: 5, result: fail('fast-fail') }),
      makeChild({ id: 'slow-ok', delayMs: 100, result: ok('slow-ok') }),
    ];
    const result = await gatherRace(children);
    expect(result.winner.agentId).toBe('fast-fail');
    expect(result.winner.status).toBe('failed');
    expect(result.killed.find((k) => k.agentId === 'slow-ok')).toBeDefined();
  });

  test('first success also wins race', async () => {
    const children = [
      makeChild({ id: 'a', delayMs: 5, result: ok('a') }),
      makeChild({ id: 'b', delayMs: 100, result: ok('b') }),
    ];
    const result = await gatherRace(children);
    expect(result.winner.agentId).toBe('a');
    expect(result.killed.find((k) => k.agentId === 'b')).toBeDefined();
  });
});

describe('gatherByPolicy dispatch', () => {
  test('routes to the right policy implementation', async () => {
    const mk = () => [
      makeChild({ id: 'a', delayMs: 5, result: ok('a') }),
      makeChild({ id: 'b', delayMs: 50, result: ok('b') }),
    ];
    const allRes = await gatherByPolicy(mk(), { policy: 'all' });
    expect(allRes.policy.policy).toBe('all');

    const firstRes = await gatherByPolicy(mk(), { policy: 'first' });
    expect(firstRes.policy.policy).toBe('first');

    const majRes = await gatherByPolicy(mk(), { policy: 'majority' });
    expect(majRes.policy.policy).toBe('majority');

    const qRes = await gatherByPolicy(mk(), { policy: 'quorum', k: 1 });
    expect(qRes.policy).toEqual({ policy: 'quorum', k: 1 });
  });
});
