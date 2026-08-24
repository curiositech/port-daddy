import { describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import { attentionPlugin } from '../../routes/attention.js';

function buildApp() {
  const attention = {
    compose: jest.fn((agentId, options) => ({
      success: true,
      agentId,
      items: [],
      subscriptions: [],
      suggestions: [],
      counts: { total: 0, inbox: 0, channels: 0, inboxUnreadRemaining: 0 },
      peek: options.peek,
    })),
    subscribe: jest.fn((_agentId, channel) => ({ success: true, subscribed: true, channel })),
    unsubscribe: jest.fn((_agentId, channel) => ({ success: true, removed: true, channel })),
    listSubscriptions: jest.fn(() => ['coordination:security']),
  };
  const actorSouls = {
    constants: { defaultHarbor: 'local' },
    verifyCredential: (credential, harbor) => {
      if (harbor !== 'local') return null;
      if (credential === 'OWNER.secret') return 'OWNER';
      if (credential === 'ATTACKER.secret') return 'ATTACKER';
      return null;
    },
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
  app.register(attentionPlugin, {
    deps: {
      attention,
      actorSouls,
      agents,
      metrics: { errors: 0 },
      logger: { info: jest.fn(), error: jest.fn() },
    },
  });
  return { app, attention };
}

describe('attention owner identity boundary', () => {
  test('anonymous and cross-actor compose cannot read or mark victim summons', async () => {
    const { app, attention } = buildApp();
    await app.ready();

    const anonymous = await app.inject({ method: 'GET', url: '/attention?agentId=OWNER' });
    const crossActor = await app.inject({
      method: 'GET',
      url: '/attention?agentId=OWNER',
      headers: { 'x-actor-credential': 'ATTACKER.secret' },
    });
    const alias = await app.inject({
      method: 'GET',
      url: '/attention?agentId=owner-alias',
      headers: { 'x-actor-credential': 'OWNER.secret' },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(crossActor.statusCode).toBe(403);
    expect(crossActor.json().code).toBe('INBOX_OWNER_MISMATCH');
    expect(alias.statusCode).toBe(403);
    expect(alias.json().code).toBe('INBOX_OWNER_MISMATCH');
    expect(attention.compose).not.toHaveBeenCalled();
    await app.close();
  });

  test('the exact canonical owner can peek or consume attention', async () => {
    const { app, attention } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/attention?agentId=OWNER&peek=true&limit=5',
      headers: { 'x-actor-credential': 'OWNER.secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(attention.compose).toHaveBeenCalledWith('OWNER', { peek: true, limit: 5 });
    await app.close();
  });

  test.each([
    ['POST', '/attention/subscribe', { agentId: 'OWNER', channel: 'coordination:security' }, 'subscribe'],
    ['POST', '/attention/unsubscribe', { agentId: 'OWNER', channel: 'coordination:security' }, 'unsubscribe'],
    ['GET', '/attention/subscriptions?agentId=OWNER', undefined, 'listSubscriptions'],
  ])('anonymous %s %s cannot alter or inspect owner subscriptions', async (method, url, payload, methodName) => {
    const { app, attention } = buildApp();
    await app.ready();

    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(attention[methodName]).not.toHaveBeenCalled();
    await app.close();
  });

  test('owner credential controls subscribe, unsubscribe, and subscription reads', async () => {
    const { app, attention } = buildApp();
    await app.ready();
    const headers = { 'x-actor-credential': 'OWNER.secret' };

    const subscribed = await app.inject({
      method: 'POST',
      url: '/attention/subscribe',
      headers,
      payload: { agentId: 'OWNER', channel: 'coordination:security' },
    });
    const unsubscribed = await app.inject({
      method: 'POST',
      url: '/attention/unsubscribe',
      headers,
      payload: { agentId: 'OWNER', channel: 'coordination:security' },
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/attention/subscriptions?agentId=OWNER',
      headers,
    });

    expect(subscribed.statusCode).toBe(200);
    expect(unsubscribed.statusCode).toBe(200);
    expect(listed.statusCode).toBe(200);
    expect(attention.subscribe).toHaveBeenCalledWith('OWNER', 'coordination:security');
    expect(attention.unsubscribe).toHaveBeenCalledWith('OWNER', 'coordination:security');
    expect(attention.listSubscriptions).toHaveBeenCalledWith('OWNER');
    await app.close();
  });
});
