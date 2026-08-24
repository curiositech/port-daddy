import { describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import { messagingPlugin } from '../../routes/messaging.js';

function buildApp() {
  const messaging = {
    listChannels: jest.fn(() => ({ success: true, channels: [] })),
    publish: jest.fn(() => ({ success: true, id: 1 })),
    getMessages: jest.fn(() => ({ success: true, messages: [], count: 0 })),
    poll: jest.fn(() => ({ success: true, message: { id: 1 } })),
    subscribe: jest.fn(() => jest.fn()),
    clear: jest.fn(() => ({ success: true, deleted: 1 })),
    discoverChannels: jest.fn(() => ({ success: true, channels: [] })),
    ensureChannel: jest.fn(() => ({ success: true })),
    resolveChannel: jest.fn(() => ({ success: false, error: 'missing' })),
  };
  const actorSouls = {
    constants: { defaultHarbor: 'local' },
    verifyCredential: (credential) => credential === 'OWNER.secret'
      ? 'OWNER'
      : credential === 'ATTACKER.secret'
        ? 'ATTACKER'
        : null,
    resolveActor: (actorId) => ({
      actorId: actorId === 'owner-alias' ? 'OWNER' : actorId,
      soulClass: ['OWNER', 'ATTACKER', 'owner-alias'].includes(actorId) ? 'newcomer' : 'unknown',
    }),
  };
  const agents = {
    resolveLiveActorInbox: (actorId, harbor) => ({
      success: true,
      binding: { actorId, harbor, inboxTarget: actorId, boundAt: 1, lastHeartbeat: Date.now() },
    }),
  };
  const app = Fastify();
  app.register(messagingPlugin, {
    deps: {
      messaging,
      actorSouls,
      agents,
      metrics: { errors: 0, messages_published: 0 },
      logger: { info: jest.fn(), error: jest.fn() },
    },
  });
  return { app, messaging };
}

describe('derived inbox channel boundary', () => {
  test('anonymous, cross-actor, and same-soul alias channel reads fail before content lookup', async () => {
    const { app, messaging } = buildApp();
    await app.ready();

    const anonymous = await app.inject({ method: 'GET', url: '/msg/inbox%3AOWNER' });
    const crossActor = await app.inject({
      method: 'GET',
      url: '/msg/inbox%3AOWNER',
      headers: { 'x-actor-credential': 'ATTACKER.secret' },
    });
    const alias = await app.inject({
      method: 'GET',
      url: '/msg/inbox%3Aowner-alias',
      headers: { 'x-actor-credential': 'OWNER.secret' },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(crossActor.statusCode).toBe(403);
    expect(alias.statusCode).toBe(403);
    expect(anonymous.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(crossActor.json().code).toBe('INBOX_OWNER_MISMATCH');
    expect(alias.json().code).toBe('INBOX_OWNER_MISMATCH');
    expect(messaging.getMessages).not.toHaveBeenCalled();
    await app.close();
  });

  test('the exact live owner can read the derived channel', async () => {
    const { app, messaging } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/msg/inbox%3AOWNER?limit=5',
      headers: { 'x-actor-credential': 'OWNER.secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(messaging.getMessages).toHaveBeenCalledWith('inbox:OWNER', { limit: 5, after: null });
    await app.close();
  });

  test.each(['POST', 'DELETE'])('generic %s inbox-channel mutation is retired even with owner credentials', async (method) => {
    const { app, messaging } = buildApp();
    await app.ready();
    const res = await app.inject({
      method,
      url: '/msg/inbox%3AOWNER',
      headers: { 'x-actor-credential': 'OWNER.secret' },
      ...(method === 'POST' ? { payload: { payload: 'forged summons', sender: 'operator' } } : {}),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('INBOX_CHANNEL_MUTATION_RETIRED');
    expect(messaging.publish).not.toHaveBeenCalled();
    expect(messaging.clear).not.toHaveBeenCalled();
    await app.close();
  });

  test('ordinary coordination channels keep their existing public semantics', async () => {
    const { app, messaging } = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/msg/coordination%3Asecurity' });
    expect(res.statusCode).toBe(200);
    expect(messaging.getMessages).toHaveBeenCalled();
    await app.close();
  });
});
