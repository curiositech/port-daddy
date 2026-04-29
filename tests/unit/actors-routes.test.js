import { describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import { actorsPlugin } from '../../routes/actors.js';

function buildApp(deps = {}) {
  const app = Fastify();
  return {
    app,
    register: () => app.register(actorsPlugin, { deps }),
  };
}

describe('actor routes', () => {
  test('GET /actors returns canonical maritime actors with projected evidence', async () => {
    const { app, register } = buildApp({
      agents: {
        list: () => ({
          agents: [{
            id: 'agent-cartographer',
            identity: 'port-daddy:fleet:cartographer',
            purpose: 'mapping recovery state',
            lastHeartbeat: 100,
            healthAssessment: { liveness: 'alive' },
          }],
        }),
      },
      sessions: {
        list: () => ({
          sessions: [{
            id: 'session-cartographer',
            status: 'active',
            purpose: 'Cartographer pass',
            agentId: 'agent-cartographer',
            updatedAt: 200,
          }],
        }),
      },
      resurrection: {
        list: () => ({ agents: [] }),
      },
      agentInbox: {
        stats: (agentId) => ({
          success: true,
          total: agentId === 'actor:cartographer' ? 2 : 0,
          unread: agentId === 'actor:cartographer' ? 1 : 0,
        }),
        MAX_INBOX_MESSAGES: 1000,
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/actors?project=port-daddy',
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.success).toBe(true);
    expect(payload.count).toBe(8);
    const cartographer = payload.actors.find((actor) => actor.id === 'cartographer');
    expect(cartographer).toEqual(expect.objectContaining({
      label: 'Cartographer',
      leaseState: 'attached',
      compatibilityFleetAgent: 'cartographer',
      mailboxStats: { total: 2, unread: 1, max: 1000 },
    }));
    expect(cartographer.liveBodies).toHaveLength(1);

    await app.close();
  });

  test('GET /actors/:id resolves aliases and rejects unknown actors', async () => {
    const { app, register } = buildApp({
      agents: { list: () => ({ agents: [] }) },
      sessions: { list: () => ({ sessions: [] }) },
      resurrection: { list: () => ({ agents: [] }) },
    });
    await register();

    const aliasRes = await app.inject({
      method: 'GET',
      url: '/actors/cartographer',
    });
    expect(aliasRes.statusCode).toBe(200);
    expect(aliasRes.json()).toEqual(expect.objectContaining({
      success: true,
      resolvedId: 'cartographer',
      actor: expect.objectContaining({ id: 'cartographer' }),
    }));

    const missingRes = await app.inject({
      method: 'GET',
      url: '/actors/pirate-king',
    });
    expect(missingRes.statusCode).toBe(404);
    expect(missingRes.json()).toEqual(expect.objectContaining({
      success: false,
      code: 'ACTOR_NOT_FOUND',
    }));

    await app.close();
  });

  test('GET /actors/:id/inbox exposes durable actor mailbox messages and stats', async () => {
    const listInbox = jest.fn(() => ({
      success: true,
      messages: [{
        id: 7,
        agentId: 'actor:navigator',
        from: 'agent-test',
        content: 'map this',
        contentType: 'text',
        type: 'actor.message',
        read: false,
        createdAt: 123,
      }],
      count: 1,
    }));
    const inboxStats = jest.fn(() => ({ success: true, total: 3, unread: 1 }));
    const { app, register } = buildApp({
      agents: { list: () => ({ agents: [] }) },
      sessions: { list: () => ({ sessions: [] }) },
      resurrection: { list: () => ({ agents: [] }) },
      agentInbox: {
        list: listInbox,
        stats: inboxStats,
        MAX_INBOX_MESSAGES: 1000,
      },
    });
    await register();

    const inboxRes = await app.inject({
      method: 'GET',
      url: '/actors/cartographer/inbox?unread=true&limit=5&since=100',
    });
    expect(inboxRes.statusCode).toBe(200);
    expect(inboxRes.json()).toEqual(expect.objectContaining({
      success: true,
      actorId: 'cartographer',
      inboxTarget: 'actor:cartographer',
      count: 1,
    }));
    expect(listInbox).toHaveBeenCalledWith('actor:cartographer', {
      unreadOnly: true,
      limit: 5,
      since: 100,
    });

    const statsRes = await app.inject({
      method: 'GET',
      url: '/actors/navigator/inbox/stats',
    });
    expect(statsRes.statusCode).toBe(200);
    expect(statsRes.json()).toEqual({
      success: true,
      actorId: 'cartographer',
      inboxTarget: 'actor:cartographer',
      total: 3,
      unread: 1,
      max: 1000,
    });
    expect(inboxStats).toHaveBeenCalledWith('actor:cartographer');

    await app.close();
  });

  test('PUT /actors/:id/inbox/read-all marks durable actor mailbox messages read', async () => {
    const markAllRead = jest.fn(() => ({ success: true, marked: 5 }));
    const { app, register } = buildApp({
      agents: { list: () => ({ agents: [] }) },
      sessions: { list: () => ({ sessions: [] }) },
      resurrection: { list: () => ({ agents: [] }) },
      agentInbox: {
        stats: () => ({ success: true, total: 5, unread: 5 }),
        markAllRead,
      },
    });
    await register();

    const res = await app.inject({
      method: 'PUT',
      url: '/actors/cartographer/inbox/read-all',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      actorId: 'cartographer',
      inboxTarget: 'actor:cartographer',
      marked: 5,
    });
    expect(markAllRead).toHaveBeenCalledWith('actor:cartographer');

    await app.close();
  });

  test('POST /actors/:id/message queues to durable actor mailbox and can wake compatibility body', async () => {
    const inboxSend = jest.fn(() => ({ success: true, messageId: 42, agentId: 'actor:cartographer' }));
    const hailAgent = jest.fn(async () => ({ success: true, project: 'port-daddy', agent: 'cartographer' }));
    const { app, register } = buildApp({
      agents: { list: () => ({ agents: [] }) },
      sessions: { list: () => ({ sessions: [] }) },
      resurrection: { list: () => ({ agents: [] }) },
      agentInbox: { send: inboxSend },
      fleetDaemon: { hailAgent },
    });
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/actors/cartographer/message',
      payload: {
        content: 'roadmap item needs evidence',
        from: 'agent-test',
        wake: true,
        project: 'port-daddy',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      actorId: 'cartographer',
      inboxTarget: 'actor:cartographer',
      messageId: 42,
      delivered: true,
      woke: true,
    }));
    expect(inboxSend).toHaveBeenCalledWith('actor:cartographer', 'roadmap item needs evidence', {
      from: 'agent-test',
      type: 'actor.message',
    });
    expect(hailAgent).toHaveBeenCalledWith('cartographer', expect.objectContaining({
      project: 'port-daddy',
      source: 'inbox',
      from: 'agent-test',
      messageContent: 'roadmap item needs evidence',
    }));

    await app.close();
  });
});
