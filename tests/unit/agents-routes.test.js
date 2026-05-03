import { jest } from '@jest/globals';
import Fastify from 'fastify';

const { agentsPlugin } = await import('../../routes/agents.js');

function buildApp() {
  const app = Fastify();
  const agents = {
    register: jest.fn(() => ({ success: true, registered: true })),
    heartbeat: jest.fn(() => ({ success: true, message: 'heartbeat recorded' })),
    unregister: jest.fn(() => ({ success: true, unregistered: true })),
    get: jest.fn(() => ({ success: true, agent: { id: 'agent-1' } })),
    list: jest.fn(() => ({ success: true, agents: [] })),
  };

  return {
    app,
    agents,
    register: () => app.register(agentsPlugin, {
      deps: {
        agents,
        agentInbox: {
          send: jest.fn(),
          list: jest.fn(() => ({ success: true, messages: [], count: 0 })),
          markRead: jest.fn(() => ({ success: true })),
          markAllRead: jest.fn(() => ({ success: true, marked: 0 })),
          clear: jest.fn(() => ({ success: true, deleted: 0 })),
          stats: jest.fn(() => ({ success: true, total: 0, unread: 0 })),
        },
        activityLog: {
          logAgent: {
            register: jest.fn(),
            heartbeat: jest.fn(),
            unregister: jest.fn(),
          },
        },
        webhooks: {
          trigger: jest.fn(),
        },
        messaging: {
          publish: jest.fn(() => ({ success: true })),
        },
        metrics: { errors: 0 },
        logger: {
          info: jest.fn(),
          error: jest.fn(),
        },
      },
    }),
  };
}

describe('agents routes', () => {
  test('POST /agents preserves explicit pid 0 instead of falling back to daemon pid', async () => {
    const { app, agents, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        id: 'spawned-test',
        type: 'spawned',
        pid: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(agents.register).toHaveBeenCalledWith('spawned-test', expect.objectContaining({
      pid: 0,
      type: 'spawned',
    }));

    await app.close();
  });

  test('POST /agents/:id/heartbeat forwards body pid and liveness fields', async () => {
    const { app, agents, register } = buildApp();
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/agents/spawned-test/heartbeat',
      payload: {
        pid: 12345,
        status: 'busy',
        progress: 'running child process',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(agents.heartbeat).toHaveBeenCalledWith('spawned-test', expect.objectContaining({
      pid: 12345,
      status: 'busy',
      progress: 'running child process',
    }));

    await app.close();
  });
});
