import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { skillGraftPlugin } from '../../routes/skill-graft.js';

const status = {
  state: 'cold',
  configured: false,
  backend: null,
  generatorModel: null,
  embedderModel: 'mock',
  catalogHash: 'sha256:test',
  total: 3,
  current: 0,
  missing: 3,
  stale: 0,
  coveragePct: 0,
  leaseOwner: null,
  leaseExpiresAt: null,
  lastTrigger: null,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastErrorKind: null,
  lastError: null,
} as const;

function buildApp() {
  const reconcile = jest.fn(async ({ trigger, maxSkills }) => ({
    ...status,
    trigger,
    acquired: true,
    embedded: maxSkills,
    reused: 0,
    removed: 0,
    stoppedEarly: true,
  }));
  const app = Fastify({ trustProxy: true });
  return {
    app,
    reconcile,
    register: () => app.register(skillGraftPlugin, {
      deps: {
        tool2VecReconciler: { status: () => status, reconcile },
        logger: { warn: jest.fn() },
      },
    }),
  };
}

describe('skill-graft reconciler routes', () => {
  test('GET exposes the exact current/cold/dependency-down status projection', async () => {
    const { app, register } = buildApp();
    await register();
    const response = await app.inject({ method: 'GET', url: '/jury-rig/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(status);
    await app.close();
  });

  test('POST is loopback-only and bounds the requested batch', async () => {
    const { app, reconcile, register } = buildApp();
    await register();

    const blocked = await app.inject({
      method: 'POST',
      url: '/jury-rig/reconcile',
      payload: { maxSkills: 10 },
      remoteAddress: '203.0.113.8',
    });
    expect(blocked.statusCode).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();

    const accepted = await app.inject({
      method: 'POST',
      url: '/jury-rig/reconcile',
      payload: { maxSkills: 5_000 },
    });
    expect(accepted.statusCode).toBe(200);
    expect(reconcile).toHaveBeenCalledWith({ trigger: 'operator-route', maxSkills: 64 });
    await app.close();
  });
});
