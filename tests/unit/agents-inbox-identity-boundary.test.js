import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import {
  createAgents,
  VERIFIED_ACTOR_INBOX_REGISTRATION,
} from '../../lib/agents.js';
import { createAgentInbox } from '../../lib/agent-inbox.js';
import { createExternalInboxRateLimiter } from '../../lib/inbox-http-boundary.js';
import { agentsPlugin } from '../../routes/agents.js';

describe('agent inbox identity boundary', () => {
  let db;
  let app;
  let souls;
  let agents;
  let inbox;
  let send;

  function mintLive(alias, harbor = 'local') {
    const minted = souls.mint({ alias, harbor });
    const registered = agents.register(minted.actorId, {
      name: alias,
      pid: process.pid,
      metadata: { actorIdentity: { verified: true, actorId: minted.actorId, harbor } },
      [VERIFIED_ACTOR_INBOX_REGISTRATION]: { actorId: minted.actorId, harbor },
    });
    expect(registered.success).toBe(true);
    return {
      actorId: minted.actorId,
      credential: minted.credential,
      headers: { 'x-actor-credential': minted.credential },
    };
  }

  beforeEach(async () => {
    db = createTestDb();
    souls = createActorSouls(db);
    agents = createAgents(db);
    inbox = createAgentInbox(db);
    send = jest.spyOn(inbox, 'send');
    app = Fastify();
    app.register(agentsPlugin, {
      deps: {
        agents,
        actorSouls: souls,
        agentInbox: inbox,
        activityLog: {
          logAgent: {
            register: jest.fn(),
            heartbeat: jest.fn(),
            unregister: jest.fn(),
          },
        },
        webhooks: { trigger: jest.fn() },
        messaging: { publish: jest.fn(() => ({ success: true })) },
        metrics: { errors: 0 },
        logger: { info: jest.fn(), error: jest.fn() },
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('owner credential reads inbox, sent receipts, and stats without exposing delivery keys', async () => {
    const owner = mintLive('owner-alias');
    const delivered = inbox.internal.sendOnce(owner.actorId, 'summons', {
      from: owner.actorId,
      type: 'parley_summons',
      deliveryKey: `parley:${owner.actorId}`,
    });

    const inboxRes = await app.inject({
      method: 'GET',
      url: `/agents/${owner.actorId}/inbox`,
      headers: owner.headers,
    });
    const sentRes = await app.inject({
      method: 'GET',
      url: `/agents/${owner.actorId}/sent`,
      headers: owner.headers,
    });
    const statsRes = await app.inject({
      method: 'GET',
      url: `/agents/${owner.actorId}/inbox/stats`,
      headers: owner.headers,
    });

    expect(inboxRes.statusCode).toBe(200);
    expect(sentRes.statusCode).toBe(200);
    expect(statsRes.statusCode).toBe(200);
    expect(inboxRes.json().messages[0]).not.toHaveProperty('deliveryKey');
    expect(sentRes.json().messages[0]).not.toHaveProperty('deliveryKey');
    expect(statsRes.json()).toMatchObject({ total: 1, unread: 1 });
    expect(db.prepare('SELECT delivery_key FROM agent_inbox WHERE id = ?').get(delivered.messageId))
      .toEqual({ delivery_key: `parley:${owner.actorId}` });
  });

  test.each([
    ['GET', 'inbox'],
    ['GET', 'sent'],
    ['GET', 'inbox/stats'],
    ['PUT', 'inbox/1/read'],
    ['PUT', 'inbox/read-all'],
  ])('anonymous %s /agents/:id/%s fails closed', async (method, suffix) => {
    const owner = mintLive('owner');
    inbox.internal.sendOnce(owner.actorId, 'do not hide', {
      from: 'system',
      type: 'parley_summons',
      deliveryKey: `summons:${method}:${suffix}`,
    });

    const res = await app.inject({ method, url: `/agents/${owner.actorId}/${suffix}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(inbox.stats(owner.actorId)).toMatchObject({ total: 1, unread: 1 });
  });

  test('cross-actor credential and same-soul alias cannot read or acknowledge the owner inbox', async () => {
    const owner = mintLive('owner-alias');
    const attacker = mintLive('attacker-alias');
    const delivered = inbox.internal.sendOnce(owner.actorId, 'summons', {
      from: 'system',
      type: 'parley_summons',
      deliveryKey: 'summons:cross-actor',
    });

    const crossRead = await app.inject({
      method: 'GET',
      url: `/agents/${owner.actorId}/inbox`,
      headers: attacker.headers,
    });
    const crossAck = await app.inject({
      method: 'PUT',
      url: `/agents/${owner.actorId}/inbox/${delivered.messageId}/read`,
      headers: attacker.headers,
    });
    const aliasRead = await app.inject({
      method: 'GET',
      url: '/agents/owner-alias/inbox',
      headers: owner.headers,
    });

    expect(crossRead.statusCode).toBe(403);
    expect(crossAck.statusCode).toBe(403);
    expect(aliasRead.statusCode).toBe(403);
    expect(crossRead.json().code).toBe('INBOX_OWNER_MISMATCH');
    expect(aliasRead.json().code).toBe('INBOX_OWNER_MISMATCH');
    expect(inbox.stats(owner.actorId)).toMatchObject({ unread: 1 });
  });

  test('anonymous, cross-actor, and alias heartbeats cannot extend a canonical inbox lease', async () => {
    const owner = mintLive('owner-alias');
    const attacker = mintLive('attacker-alias');
    const before = agents.get(owner.actorId).agent.lastHeartbeat;

    const anonymous = await app.inject({
      method: 'POST',
      url: `/agents/${owner.actorId}/heartbeat`,
      payload: { progress: 'keep victim alive' },
    });
    const crossActor = await app.inject({
      method: 'POST',
      url: `/agents/${owner.actorId}/heartbeat`,
      headers: attacker.headers,
      payload: { progress: 'keep victim alive' },
    });
    const alias = await app.inject({
      method: 'POST',
      url: '/agents/owner-alias/heartbeat',
      headers: owner.headers,
      payload: { progress: 'alias laundering' },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(crossActor.statusCode).toBe(403);
    expect(alias.statusCode).toBe(200);
    expect(agents.get('owner-alias').agent.actorInboxBinding).toBeNull();
    expect(agents.get(owner.actorId).agent.lastHeartbeat).toBe(before);
    expect(agents.get(owner.actorId).agent.progress).toBeNull();

    const exactOwner = await app.inject({
      method: 'POST',
      url: `/agents/${owner.actorId}/heartbeat`,
      headers: owner.headers,
      payload: { progress: 'still working' },
    });
    expect(exactOwner.statusCode).toBe(200);
    expect(agents.get(owner.actorId).agent.progress).toBe('still working');
  });

  test('the exact owner can acknowledge one message and then the remaining inbox', async () => {
    const owner = mintLive('owner');
    const first = inbox.send(owner.actorId, 'first', { from: 'system' });
    inbox.send(owner.actorId, 'second', { from: 'system' });

    const one = await app.inject({
      method: 'PUT',
      url: `/agents/${owner.actorId}/inbox/${first.messageId}/read`,
      headers: owner.headers,
    });
    const all = await app.inject({
      method: 'PUT',
      url: `/agents/${owner.actorId}/inbox/read-all`,
      headers: owner.headers,
    });

    expect(one.statusCode).toBe(200);
    expect(all.statusCode).toBe(200);
    expect(all.json().marked).toBe(1);
    expect(inbox.stats(owner.actorId)).toMatchObject({ total: 2, unread: 0 });
  });

  test('destructive inbox clear is not an HTTP route even for the owner', async () => {
    const owner = mintLive('owner');
    inbox.send(owner.actorId, 'durable evidence', { from: 'system' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/agents/${owner.actorId}/inbox`,
      headers: owner.headers,
    });

    expect(res.statusCode).toBe(404);
    expect(inbox.stats(owner.actorId)).toMatchObject({ total: 1, unread: 1 });
  });

  test('anonymous external send persists fixed provenance and never wakes', async () => {
    const target = mintLive('target');
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${target.actorId}/inbox`,
      payload: { content: 'external question' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      actorId: target.actorId,
      inboxTarget: target.actorId,
      delivered: true,
      woke: false,
      provenance: { kind: 'anonymous-external', actorId: null, harbor: 'local' },
    });
    expect(send).toHaveBeenCalledWith(target.actorId, 'external question', {
      from: 'external:anonymous',
      type: 'external.anonymous',
      contentType: 'text',
    });
  });

  test('authenticated external send persists only the canonical actor as sender', async () => {
    const target = mintLive('target');
    const sender = mintLive('sender-display');
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${target.actorId}/inbox`,
      headers: sender.headers,
      payload: { content: { request: 'review' }, contentType: 'json' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().provenance).toEqual({
      kind: 'authenticated-external',
      actorId: sender.actorId,
      harbor: 'local',
    });
    expect(send).toHaveBeenCalledWith(target.actorId, { request: 'review' }, {
      from: sender.actorId,
      type: 'external.authenticated',
      contentType: 'json',
    });
  });

  test.each(['from', 'type', 'wake', 'project', 'messageContent', 'identity', 'actorId', 'credential', 'sender', 'deliveryKey'])
  ('caller-supplied %s authority is rejected without writing or waking', async (field) => {
    const target = mintLive(`target-${field}`);
    const before = inbox.stats(target.actorId).total;
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${target.actorId}/inbox`,
      payload: { content: 'forged', [field]: field === 'wake' ? true : 'victim' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INBOX_AUTHORITY_OVERRIDE_FORBIDDEN');
    expect(inbox.stats(target.actorId).total).toBe(before);
  });

  test('unknown external ingress fields are rejected instead of becoming future authority', async () => {
    const target = mintLive('target-unknown-field');
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${target.actorId}/inbox`,
      payload: { content: 'forged', futureOverride: 'victim' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INBOX_FIELD_UNSUPPORTED');
    expect(inbox.stats(target.actorId).total).toBe(0);
  });

  test('forged, wrong-harbor, stale, and unbound identities fail without a tuple write', async () => {
    const target = mintLive('target');
    const foreign = souls.mint({ alias: 'foreign', harbor: 'tenant-b' });
    const forged = await app.inject({
      method: 'POST',
      url: `/agents/${target.actorId}/inbox`,
      headers: { 'x-actor-credential': 'FORGED.bad' },
      payload: { content: 'forged' },
    });
    const wrongHarbor = await app.inject({
      method: 'POST',
      url: `/agents/${target.actorId}/inbox`,
      headers: { 'x-actor-credential': foreign.credential },
      payload: { content: 'cross tenant' },
    });
    const unbound = await app.inject({
      method: 'POST',
      url: `/agents/${foreign.actorId}/inbox`,
      payload: { content: 'unbound target' },
    });

    expect(forged.statusCode).toBe(401);
    expect(wrongHarbor.statusCode).toBe(401);
    expect(unbound.statusCode).toBe(409);
    expect(inbox.stats(target.actorId).total).toBe(0);
    expect(inbox.stats(foreign.actorId).total).toBe(0);
  });

  test('public delivery is size bounded and rate limited independently of Host/XFF/loopback', async () => {
    const target = mintLive('target');
    const limitedApp = Fastify();
    limitedApp.register(agentsPlugin, {
      deps: {
        agents,
        actorSouls: souls,
        agentInbox: inbox,
        activityLog: { logAgent: { register: jest.fn(), heartbeat: jest.fn(), unregister: jest.fn() } },
        webhooks: { trigger: jest.fn() },
        messaging: { publish: jest.fn(() => ({ success: true })) },
        metrics: { errors: 0 },
        logger: { info: jest.fn(), error: jest.fn() },
        externalInboxLimiter: createExternalInboxRateLimiter({ anonymousLimit: 1 }),
      },
    });
    await limitedApp.ready();

    const oversized = await limitedApp.inject({
      method: 'POST',
      url: `/agents/${target.actorId}/inbox`,
      payload: { content: 'x'.repeat(64 * 1024 + 1) },
    });
    const first = await limitedApp.inject({
      method: 'POST',
      url: `/agents/${target.actorId}/inbox`,
      headers: { host: 'victim.example', 'x-forwarded-for': '1.2.3.4' },
      payload: { content: 'one' },
    });
    const second = await limitedApp.inject({
      method: 'POST',
      url: `/agents/${target.actorId}/inbox`,
      headers: { host: 'other.example', 'x-forwarded-for': '5.6.7.8' },
      payload: { content: 'two' },
    });

    expect(oversized.statusCode).toBe(413);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ code: 'INBOX_RATE_LIMITED', scope: 'anonymous' });
    await limitedApp.close();
  });
});
