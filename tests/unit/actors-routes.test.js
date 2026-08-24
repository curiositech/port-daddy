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
  test('GET /actors returns canonical fleet actors with projected evidence', async () => {
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
    expect(payload.count).toBe(10);
    const coxswain = payload.actors.find((actor) => actor.id === 'coxswain');
    expect(coxswain).toEqual(expect.objectContaining({
      label: 'Coxswain',
      leaseState: 'dormant',
      compatibilityFleetAgent: null,
      inboxTarget: 'actor:coxswain',
      mailboxStats: { total: 0, unread: 0, max: 1000 },
    }));
    const quartermaster = payload.actors.find((actor) => actor.id === 'quartermaster');
    expect(quartermaster).toEqual(expect.objectContaining({
      label: 'Quartermaster',
      leaseState: 'dormant',
      compatibilityFleetAgent: null,
      inboxTarget: 'actor:quartermaster',
      mailboxStats: { total: 0, unread: 0, max: 1000 },
    }));
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

    const coxswainRes = await app.inject({
      method: 'GET',
      url: '/actors/coxswain',
    });
    expect(coxswainRes.statusCode).toBe(200);
    expect(coxswainRes.json()).toEqual(expect.objectContaining({
      success: true,
      resolvedId: 'coxswain',
      actor: expect.objectContaining({
        id: 'coxswain',
        inboxTarget: 'actor:coxswain',
      }),
    }));

    const quartermasterRes = await app.inject({
      method: 'GET',
      url: '/actors/quartermaster',
    });
    expect(quartermasterRes.statusCode).toBe(200);
    expect(quartermasterRes.json()).toEqual(expect.objectContaining({
      success: true,
      resolvedId: 'quartermaster',
      actor: expect.objectContaining({
        id: 'quartermaster',
        inboxTarget: 'actor:quartermaster',
      }),
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

  test('static actor inbox content and stats fail closed without an exact canonical owner', async () => {
    const listInbox = jest.fn(() => ({
      success: true,
      messages: [{
        id: 7,
        agentId: 'actor:cartographer',
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
    const actorSouls = {
      constants: { defaultHarbor: 'local' },
      verifyCredential: (credential) => credential === 'CANONICAL.secret' ? 'CANONICAL' : null,
      resolveActor: (actorId) => ({ actorId, soulClass: actorId === 'CANONICAL' ? 'newcomer' : 'unknown' }),
    };
    const { app, register } = buildApp({
      agents: {
        list: () => ({ agents: [] }),
        resolveLiveActorInbox: jest.fn(),
      },
      sessions: { list: () => ({ sessions: [] }) },
      resurrection: { list: () => ({ agents: [] }) },
      actorSouls,
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
    expect(inboxRes.statusCode).toBe(401);
    expect(inboxRes.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(listInbox).not.toHaveBeenCalled();

    const statsRes = await app.inject({
      method: 'GET',
      url: '/actors/cartographer/inbox/stats',
    });
    expect(statsRes.statusCode).toBe(401);
    expect(statsRes.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const crossActor = await app.inject({
      method: 'GET',
      url: '/actors/cartographer/inbox',
      headers: { 'x-actor-credential': 'CANONICAL.secret' },
    });
    expect(crossActor.statusCode).toBe(403);
    expect(crossActor.json().code).toBe('INBOX_OWNER_MISMATCH');
    expect(inboxStats).not.toHaveBeenCalled();

    await app.close();
  });

  test('PUT /actors/:id/inbox/read-all cannot acknowledge a roster alias mailbox', async () => {
    const markAllRead = jest.fn(() => ({ success: true, marked: 5 }));
    const { app, register } = buildApp({
      agents: {
        list: () => ({ agents: [] }),
        resolveLiveActorInbox: jest.fn(),
      },
      sessions: { list: () => ({ sessions: [] }) },
      resurrection: { list: () => ({ agents: [] }) },
      actorSouls: {
        constants: { defaultHarbor: 'local' },
        verifyCredential: (credential) => credential === 'OTHER.secret' ? 'OTHER' : null,
        resolveActor: (actorId) => ({ actorId, soulClass: actorId === 'OTHER' ? 'newcomer' : 'unknown' }),
      },
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

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const crossActor = await app.inject({
      method: 'PUT',
      url: '/actors/cartographer/inbox/read-all',
      headers: { 'x-actor-credential': 'OTHER.secret' },
    });
    expect(crossActor.statusCode).toBe(403);
    expect(crossActor.json().code).toBe('INBOX_OWNER_MISMATCH');
    expect(markAllRead).not.toHaveBeenCalled();

    await app.close();
  });

  test('POST /actors/:id/message rejects caller sender and wake authority without writing', async () => {
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

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INBOX_AUTHORITY_OVERRIDE_FORBIDDEN');
    expect(inboxSend).not.toHaveBeenCalled();
    expect(hailAgent).not.toHaveBeenCalled();

    await app.close();
  });

  test('POST /actors/:id/message queues anonymous external provenance without wake', async () => {
    const inboxSend = jest.fn(() => ({ success: true, messageId: 43, agentId: 'TARGET01' }));
    const hailAgent = jest.fn(async () => ({ success: true }));
    const { app, register } = buildApp({
      agents: {
        list: () => ({ agents: [] }),
        resolveLiveActorInbox: (actorId, harbor) => ({
          success: true,
          binding: { actorId, harbor, inboxTarget: actorId, boundAt: 1, lastHeartbeat: Date.now() },
        }),
      },
      sessions: { list: () => ({ sessions: [] }) },
      resurrection: { list: () => ({ agents: [] }) },
      actorSouls: {
        constants: { defaultHarbor: 'local' },
        verifyCredential: () => null,
        resolveActor: (actorId) => ({ actorId, soulClass: 'unknown' }),
      },
      agentInbox: { send: inboxSend },
      fleetDaemon: { hailAgent },
    });
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/actors/TARGET01/message',
      payload: {
        content: 'claims check needed',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      actorId: 'TARGET01',
      inboxTarget: 'TARGET01',
      messageId: 43,
      delivered: true,
      woke: false,
      provenance: { kind: 'anonymous-external', actorId: null, harbor: 'local' },
    }));
    expect(inboxSend).toHaveBeenCalledWith('TARGET01', 'claims check needed', {
      from: 'external:anonymous',
      type: 'external.anonymous',
      contentType: 'text',
    });
    expect(hailAgent).not.toHaveBeenCalled();

    await app.close();
  });

  test('POST /actors/:id/message persists canonical authenticated-external sender identity', async () => {
    const inboxSend = jest.fn(() => ({ success: true, messageId: 44, agentId: 'actor:cartographer' }));
    const actorSouls = {
      constants: { defaultHarbor: 'local' },
      verifyCredential: (credential, harbor) => credential === 'ACTOR01.secret' && harbor === 'local' ? 'ACTOR01' : null,
      resolveActor: (actorId) => ({ actorId, soulClass: actorId === 'ACTOR01' ? 'newcomer' : 'unknown' }),
    };
    const agents = {
      list: () => ({ agents: [] }),
      resolveLiveActorInbox: (actorId, harbor) => ({
        success: true,
        binding: { actorId, harbor, inboxTarget: actorId, boundAt: 1, lastHeartbeat: Date.now() },
      }),
    };
    const { app, register } = buildApp({
      agents,
      sessions: { list: () => ({ sessions: [] }) },
      resurrection: { list: () => ({ agents: [] }) },
      actorSouls,
      agentInbox: { send: inboxSend },
    });
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/actors/TARGET01/message',
      headers: { 'x-actor-credential': 'ACTOR01.secret' },
      payload: { content: { request: 'map this' }, contentType: 'json' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().provenance).toEqual({
      kind: 'authenticated-external',
      actorId: 'ACTOR01',
      harbor: 'local',
    });
    expect(inboxSend).toHaveBeenCalledWith('TARGET01', { request: 'map this' }, {
      from: 'ACTOR01',
      type: 'external.authenticated',
      contentType: 'json',
    });

    await app.close();
  });

  test('actor mailbox aliases cannot select or receive for a canonical live actor', async () => {
    const inboxSend = jest.fn(() => ({ success: true, messageId: 45, agentId: 'TARGET01' }));
    const resolveLiveActorInbox = jest.fn((actorId, harbor) => ({
      success: true,
      binding: {
        actorId: actorId === 'victim-alias' ? 'TARGET01' : actorId,
        harbor,
        inboxTarget: 'TARGET01',
        boundAt: 1,
        lastHeartbeat: Date.now(),
      },
    }));
    const { app, register } = buildApp({
      agents: { list: () => ({ agents: [] }), resolveLiveActorInbox },
      sessions: { list: () => ({ sessions: [] }) },
      resurrection: { list: () => ({ agents: [] }) },
      actorSouls: {
        constants: { defaultHarbor: 'local' },
        verifyCredential: () => null,
        resolveActor: (actorId) => ({ actorId, soulClass: 'unknown' }),
      },
      agentInbox: { send: inboxSend },
    });
    await register();

    const res = await app.inject({
      method: 'POST',
      url: '/actors/victim-alias/message',
      payload: { content: 'substitute victim' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('ACTOR_INBOX_BINDING_INVALID');
    expect(inboxSend).not.toHaveBeenCalled();

    await app.close();
  });
});
