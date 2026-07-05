import { jest } from '@jest/globals';
import Fastify from 'fastify';

const { agentsPlugin } = await import('../../routes/agents.js');

function buildApp(extraDeps = {}) {
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
        ...extraDeps,
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

  test('GET /agents merges Cloudflare telemetry agents into local agent reporting', async () => {
    const remoteAgent = {
      id: 'cloudflare:curiositech.port-daddy:code-reviewer:abc12345',
      type: 'cloudflare',
      pid: 0,
      isActive: true,
      lastHeartbeat: 200,
      metadata: { origin: 'remote' },
    };
    const cloudAppTelemetry = {
      agents: jest.fn(() => [remoteAgent]),
      getAgent: jest.fn(),
    };
    const { app, agents, register } = buildApp({ cloudAppTelemetry });
    agents.list.mockReturnValue({
      success: true,
      agents: [{ id: 'local-agent', type: 'cli', pid: 123, isActive: true, lastHeartbeat: 100 }],
      count: 1,
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/agents?active=true&identity=port-daddy&purpose=review',
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(agents.list).toHaveBeenCalledWith({
      activeOnly: true,
      identityPrefix: 'port-daddy',
      purpose: 'review',
    });
    expect(cloudAppTelemetry.agents).toHaveBeenCalledWith({
      activeOnly: true,
      identityPrefix: 'port-daddy',
      purpose: 'review',
    });
    expect(body.count).toBe(2);
    expect(body.localCount).toBe(1);
    expect(body.remoteCount).toBe(1);
    expect(body.agents.map((agent) => agent.id)).toEqual([
      'cloudflare:curiositech.port-daddy:code-reviewer:abc12345',
      'local-agent',
    ]);

    await app.close();
  });

  test('GET /agents/:id falls back to Cloudflare telemetry agent details', async () => {
    const remoteAgent = {
      id: 'cloudflare:curiositech.port-daddy:qa:def67890',
      name: 'pd-qa',
      type: 'cloudflare',
      pid: 0,
      isActive: true,
      lastHeartbeat: Date.now() - 1000,
    };
    const cloudAppTelemetry = {
      agents: jest.fn(),
      getAgent: jest.fn(() => remoteAgent),
    };
    const { app, agents, register } = buildApp({ cloudAppTelemetry });
    agents.get.mockReturnValue({ success: false, error: 'agent not found' });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/agents/cloudflare:curiositech.port-daddy:qa:def67890',
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.agent).toEqual(expect.objectContaining({
      id: remoteAgent.id,
      name: 'pd-qa',
      type: 'cloudflare',
      timeSinceHeartbeat: expect.any(Number),
    }));
    expect(cloudAppTelemetry.getAgent).toHaveBeenCalledWith(remoteAgent.id);

    await app.close();
  });
});
