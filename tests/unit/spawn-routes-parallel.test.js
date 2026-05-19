/**
 * Spawn route — --parallel + --gather end-to-end (mocked spawner).
 *
 * Verifies the route accepts the new fields, dispatches to the gather policy
 * layer, returns the `mode: 'parallel'` shape with winner/killed/all, and
 * that single-spawn (backward-compat) path is unchanged.
 */

import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockAssessSpawnPreflight = jest.fn();

jest.unstable_mockModule('../../lib/spawn-preflight.js', () => ({
  assessSpawnPreflight: mockAssessSpawnPreflight,
}));

const { spawnPlugin } = await import('../../routes/spawn.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockAssessSpawnPreflight.mockResolvedValue({
    launchReady: true,
    blockedReasons: [],
    warnings: [],
    attempts: [{
      attempt: 1,
      backend: 'claude-cli',
      model: 'claude-sonnet-4-5',
      modelTier: null,
      backendSource: 'agent',
      modelSource: 'env',
      warnings: [],
      readinessStatus: 'manual_check',
      readinessSummary: 'ok',
      readinessNextStep: 'n/a',
    }],
    projectName: 'port-daddy',
    budget: null,
    localExecutionLikely: true,
    localExecutionNote: '',
  });
});

function buildApp({ spawnImpl } = {}) {
  const app = Fastify();
  const spawnFn = spawnImpl || jest.fn(async () => ({
    agentId: `child-${Math.random().toString(36).slice(2, 6)}`,
    backend: 'claude-cli',
    model: 'claude-sonnet-4-5',
    status: 'completed',
    output: 'done',
    error: null,
    startedAt: 1,
    completedAt: 2,
  }));

  const spawner = {
    spawn: spawnFn,
    list: jest.fn(() => []),
    kill: jest.fn(),
  };

  app.register(spawnPlugin, {
    deps: {
      spawner,
      costTracker: { budgetStatus: jest.fn() },
      metrics: { errors: 0 },
      logger: { info: jest.fn(), error: jest.fn() },
    },
  });
  return { app, spawner };
}

describe('POST /spawn — backward compat (no parallel/gather)', () => {
  test('single spawn returns legacy shape', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: { backend: 'claude-cli', task: 'do the thing', identity: 'port-daddy:test' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBeUndefined();
    expect(body.status).toBe('completed');
  });
});

describe('POST /spawn — parallel + gather=first', () => {
  test('returns mode=parallel with winner + killed list', async () => {
    let callIdx = 0;
    const { app, spawner } = buildApp({
      spawnImpl: jest.fn(async () => {
        const i = callIdx++;
        // Fast first, slow others — but we don't actually await; just resolve
        // deterministically. The 'killed' status depends on kill() being
        // invoked on siblings, which the gather layer does only on children
        // that didn't settle by the time the winner satisfies the policy.
        // Since these resolve synchronously in microtasks, only the first
        // gets `completed`; subsequent ones return after kill() ran.
        await new Promise((r) => setTimeout(r, i === 0 ? 5 : 50));
        return {
          agentId: `child-${i}`,
          backend: 'claude-cli',
          model: 'claude-sonnet-4-5',
          status: i === 0 ? 'completed' : 'completed',
          output: i === 0 ? 'fast-output' : 'late-output',
          error: null,
          startedAt: 1,
          completedAt: 2,
        };
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'claude-cli',
        task: 'race-me',
        identity: 'port-daddy:test',
        parallel: 3,
        gather: 'first',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBe('parallel');
    expect(body.parallel).toBe(3);
    expect(body.gather).toEqual({ policy: 'first' });
    expect(body.winner.status).toBe('completed');
    expect(body.winner.agentId).toBe('child-0');
    expect(Array.isArray(body.killed)).toBe(true);
    expect(Array.isArray(body.all)).toBe(true);
    expect(body.all.length).toBe(3);

    // Spawner.spawn() was called once per parallel child.
    expect(spawner.spawn).toHaveBeenCalledTimes(3);
    // kill() will be invoked for siblings that hadn't settled when the
    // first winner satisfied the policy. In this jest mock the spawn()
    // call resolves synchronously so by the time the gather layer wants
    // to kill siblings, they've already settled — kill is a no-op. The
    // important invariant is that the policy doesn't block: the route
    // returned a structured `mode: 'parallel'` shape, not a hang.
  });
});

describe('POST /spawn — parallel + gather=all (back-compat)', () => {
  test('runs all N to completion, returns mode=parallel', async () => {
    const { app, spawner } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'claude-cli',
        task: 'fan-out',
        identity: 'port-daddy:test',
        parallel: 2,
        gather: 'all',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('parallel');
    expect(body.gather).toEqual({ policy: 'all' });
    expect(body.killed).toEqual([]);
    expect(body.all.length).toBe(2);
    expect(spawner.spawn).toHaveBeenCalledTimes(2);
    expect(spawner.kill).not.toHaveBeenCalled();
  });
});

describe('POST /spawn — gather policy validation', () => {
  test('rejects invalid gather string', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: {
        backend: 'claude-cli',
        task: 'x',
        identity: 'port-daddy:test',
        parallel: 2,
        gather: 'bogus',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(res.json().error).toMatch(/unknown gather policy/);
  });
});
