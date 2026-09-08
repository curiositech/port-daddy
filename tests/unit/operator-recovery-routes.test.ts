import { afterEach, describe, expect, it, jest } from '@jest/globals';
import Fastify from 'fastify';
import { operatorRecoveryPlugin } from '../../routes/operator-recovery.js';
import { OperatorRecoveryError } from '../../lib/operator-recovery.js';

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function appWith(operatorRecovery: Record<string, unknown> | null) {
  const app = Fastify();
  apps.push(app);
  app.register(operatorRecoveryPlugin, {
    deps: {
      operatorRecovery: operatorRecovery as any,
      logger: { info() {}, error() {} },
    },
  });
  return app;
}

function recoveryState(overrides: Record<string, unknown> = {}) {
  return {
    recoveryId: 'recovery-route-test',
    status: 'pending',
    scope: { actionHash: `sha256:${'1'.repeat(64)}` },
    signing: null,
    successorSessionId: null,
    receipt: { ledgerSequences: [1], eventIds: ['event-1'] },
    events: [],
    ...overrides,
  };
}

describe('operator recovery HTTP projection', () => {
  it('awaits the native-helper-backed challenge before returning 201', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const createChallenge = jest.fn(async () => {
      await gate;
      return recoveryState();
    });
    const app = appWith({
      createChallenge,
      decide: jest.fn(),
      decideAndConsume: jest.fn(),
      consume: jest.fn(),
      get: jest.fn(),
      list: jest.fn(),
    });
    await app.ready();
    const pending = app.inject({
      method: 'POST',
      url: '/operator-recovery/challenges',
      payload: {
        intendedAgentId: 'port-daddy:test',
        project: 'port-daddy',
        worktree: '/canonical/worktree',
        branch: 'codex/test',
        predecessorSessionId: 'session-old',
        sessionIntent: 'resume',
        actorId: 'actor-1',
        contextSlot: 'codex-thread',
        claims: [],
      },
    }).then((response) => response);
    release();
    const response = await pending;
    expect(createChallenge).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ success: true, recoveryId: 'recovery-route-test' });
  });

  it('maps typed validation and unavailable failures without losing their code', async () => {
    const app = appWith({
      createChallenge: jest.fn(async () => {
        throw new OperatorRecoveryError(
          'OPERATOR_RECOVERY_CONTEXT_SLOT_REQUIRED',
          'contextSlot is required',
          400,
        );
      }),
      decide: jest.fn(),
      decideAndConsume: jest.fn(),
      consume: jest.fn(),
      get: jest.fn(),
      list: jest.fn(),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/operator-recovery/challenges',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      code: 'OPERATOR_RECOVERY_CONTEXT_SLOT_REQUIRED',
      error: 'contextSlot is required',
    });
  });

  it('passes only the daemon-selected decision fields to the service', async () => {
    const decideAndConsume = jest.fn(async (input: Record<string, unknown>) => recoveryState({
      status: 'consumed',
      successorSessionId: 'session-new',
      input,
      custody: { installed: true, contextSlot: 'codex-thread' },
    }));
    const app = appWith({
      createChallenge: jest.fn(),
      decide: jest.fn(),
      decideAndConsume,
      consume: jest.fn(),
      get: jest.fn(),
      list: jest.fn(),
    });
    const payload = {
      decision: 'approve',
      deviceKeyId: 'se-p256:key',
      publicKeyX963Base64: 'BA==',
      signatureDerBase64: 'MAA=',
      challengeDigest: `sha256:${'2'.repeat(64)}`,
    };
    const response = await app.inject({
      method: 'POST',
      url: '/operator-recovery/recovery-route-test/decision',
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(decideAndConsume).toHaveBeenCalledWith({ recoveryId: 'recovery-route-test', ...payload });
    expect(response.json()).toMatchObject({
      success: true,
      status: 'consumed',
      custody: { installed: true, contextSlot: 'codex-thread' },
    });
    expect(response.json()).not.toHaveProperty('grant');
  });

  it('has no public bearer-consume route', async () => {
    const app = appWith({
      createChallenge: jest.fn(),
      decide: jest.fn(),
      decideAndConsume: jest.fn(),
      consume: jest.fn(),
      get: jest.fn(),
      list: jest.fn(),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/operator-recovery/recovery-route-test/consume',
      payload: { grant: { identifier: 'id', signature: 'sig', caveats: [] } },
    });
    expect(response.statusCode).toBe(404);
  });

  it('fails every route closed when the service is not installed', async () => {
    const app = appWith(null);
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/operator-recovery' }),
      app.inject({ method: 'GET', url: '/operator-recovery/missing' }),
      app.inject({ method: 'POST', url: '/operator-recovery/challenges', payload: {} }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([503, 503, 503]);
    expect(responses.map((response) => response.json().code))
      .toEqual(Array(3).fill('OPERATOR_RECOVERY_UNAVAILABLE'));
  });
});
