import { describe, test, expect, afterEach } from '@jest/globals';
import Fastify from 'fastify';
import { createArbiter } from '../../lib/arbiter.js';
import { arbiterPlugin } from '../../routes/arbiter.js';

function createMockActivityLog() {
  const subscribers = new Set();
  return {
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    log() {
      return { success: true };
    },
  };
}

function createMockAgents() {
  return {
    get() {
      return { success: false };
    },
  };
}

function createMockSessions() {
  return {};
}

function createMockLocks() {
  return {};
}

function buildArbiter() {
  return createArbiter({
    activityLog: createMockActivityLog(),
    agents: createMockAgents(),
    sessions: createMockSessions(),
    locks: createMockLocks(),
  });
}

const activeArbiters = [];

async function buildApp() {
  const app = Fastify();
  const arbiter = buildArbiter();
  activeArbiters.push(arbiter);
  await app.register(arbiterPlugin, { arbiter });
  return app;
}

afterEach(() => {
  while (activeArbiters.length > 0) {
    activeArbiters.pop()?.stop();
  }
});

describe('arbiter routes', () => {
  test('GET /arbiter/status returns deterministic rule coverage', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/arbiter/status' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.active).toBe(true);
    expect(body.rulesCount).toBe(6);
    expect(body.rules).toEqual(expect.arrayContaining([
      'PID_SQUATTING',
      'CAP_ESCALATION',
      'NOTE_MONOTONICITY',
      'ESCROW_POSITIVE',
      'LOCK_OWNER_VALID',
      'HEARTBEAT_FRESHNESS',
    ]));
    expect(body.summary).toEqual(expect.objectContaining({
      mode: 'observe_only',
      criticalAction: 'log_only',
    }));

    await app.close();
  });

  test('POST /arbiter/test-invariant/:name records a violation visible via /arbiter/violations', async () => {
    const app = await buildApp();

    const inject = await app.inject({
      method: 'POST',
      url: '/arbiter/test-invariant/NOTE_MONOTONICITY',
    });
    const injectBody = inject.json();

    expect(inject.statusCode).toBe(200);
    expect(injectBody).toEqual(expect.objectContaining({
      success: true,
      violation: expect.objectContaining({
        rule: 'NOTE_MONOTONICITY',
        severity: 'critical',
      }),
    }));

    const violations = await app.inject({ method: 'GET', url: '/arbiter/violations?limit=10' });
    const violationsBody = violations.json();

    expect(violations.statusCode).toBe(200);
    expect(violationsBody.success).toBe(true);
    expect(violationsBody.total).toBeGreaterThanOrEqual(1);
    expect(violationsBody.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: 'NOTE_MONOTONICITY',
      }),
    ]));

    await app.close();
  });

  test('POST /arbiter/test-invariant/INVALID returns 400 with valid rule names', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/arbiter/test-invariant/INVALID',
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.success).toBe(false);
    expect(body.validNames).toEqual(expect.arrayContaining([
      'PID_SQUATTING',
      'CAP_ESCALATION',
      'NOTE_MONOTONICITY',
    ]));

    await app.close();
  });
});
