import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { actorsPlugin } from '../../routes/actors.js';

function buildApp(overrides = {}) {
  const app = Fastify();
  const deps = {
    metrics: { errors: 0 },
    logger: { error: jest.fn() },
    agents: {
      list: jest.fn(() => ({ agents: [] })),
    },
    fleetDaemon: {
      getStatus: jest.fn(() => ({ fleets: [] })),
    },
    ...overrides,
  };
  return {
    app,
    deps,
    register: () => app.register(actorsPlugin, { deps }),
  };
}

describe('actors routes', () => {
  test('GET /actors lists the canonical maritime actor roster', async () => {
    const { app, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/actors',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.success).toBe(true);
    expect(payload.actors.map((actor) => actor.id)).toEqual([
      'navigator',
      'coxswain',
      'signalman',
      'harbormaster',
      'sounder',
      'lookout',
      'breaker',
      'caulker',
      'quartermaster',
    ]);
    expect(payload.actors[0]).toEqual(expect.objectContaining({
      id: 'navigator',
      name: 'Navigator',
      identity: 'port-daddy:actor:navigator',
      body: expect.objectContaining({ state: 'detached' }),
    }));

    await app.close();
  });

  test('GET /actors/:id projects live body and compatibility fleet status', async () => {
    const now = Date.now();
    const { app, register } = buildApp({
      agents: {
        list: jest.fn(() => ({
          agents: [{
            id: 'agent-cartographer-live',
            identity: 'port-daddy-dev:fleet:cartographer',
            name: 'cartographer',
            isActive: true,
            lastHeartbeat: now,
            healthAssessment: { liveness: 'alive' },
          }],
        })),
      },
      fleetDaemon: {
        getStatus: jest.fn(() => ({
          fleets: [{
            project: 'port-daddy-dev',
            projectDir: '/repo',
            agents: [{
              name: 'cartographer',
              status: 'armed',
              running: false,
              paused: false,
            }],
          }],
        })),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/actors/navigator',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      actor: expect.objectContaining({
        id: 'navigator',
        compatibility: expect.objectContaining({ fleetAgent: 'cartographer' }),
        body: expect.objectContaining({
          state: 'attached',
          liveAgentId: 'agent-cartographer-live',
          liveness: 'alive',
          lastHeartbeat: now,
        }),
        fleet: expect.objectContaining({
          configured: true,
          project: 'port-daddy-dev',
          agent: 'cartographer',
          status: 'armed',
        }),
      }),
    });

    await app.close();
  });

  test('GET /actors/:id resolves legacy names and rejects unknown actors', async () => {
    const { app, register } = buildApp();
    await register();

    const legacy = await app.inject({
      method: 'GET',
      url: '/actors/cartographer',
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().actor.id).toBe('navigator');

    const missing = await app.inject({
      method: 'GET',
      url: '/actors/not-a-role',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      success: false,
      error: 'actor not found',
    });

    await app.close();
  });
});
