import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createMessaging } from '../../lib/messaging.js';
import { messagingPlugin } from '../../routes/messaging.js';

describe('messaging routes', () => {
  let app;
  let db;
  let messaging;

  const contexts = {
    '/repo/feature-a': {
      projectDir: '/repo/feature-a',
      repoAnchor: '/repo/.git',
      repoKey: 'repo1234',
      worktreeId: 'worka111',
      branch: 'feature-a',
      inGit: true,
    },
    '/repo/feature-b': {
      projectDir: '/repo/feature-b',
      repoAnchor: '/repo/.git',
      repoKey: 'repo1234',
      worktreeId: 'workb222',
      branch: 'feature-b',
      inGit: true,
    },
  };

  beforeEach(async () => {
    db = createTestDb();
    messaging = createMessaging(db, {
      resolveChannelContext(projectDir) {
        return contexts[projectDir] || contexts['/repo/feature-a'];
      }
    });
    app = Fastify();
    await app.register(messagingPlugin, {
      deps: {
        logger: {
          info: () => {},
          error: () => {},
        },
        metrics: { errors: 0, messages_published: 0 },
        messaging,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (messaging) messaging.destroy();
    if (db) db.close();
  });

  test('POST /channels/ensure declares a git-sensitive channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/channels/ensure',
      payload: {
        name: 'tauri:desktop',
        aliases: ['desktop:probe'],
        scope: 'branch',
        projectDir: '/repo/feature-a',
        description: 'Desktop coordination channel',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.created).toBe(true);
    expect(body.channel.logicalName).toBe('tauri:desktop');
    expect(body.channel.scope).toBe('branch');
    expect(body.channel.physicalName).not.toBe('tauri:desktop');
  });

  test('GET /channels/discover filters to the current worktree context', async () => {
    const featureA = messaging.ensureChannel('tauri:desktop', { projectDir: '/repo/feature-a' });
    const featureB = messaging.ensureChannel('tauri:desktop', { projectDir: '/repo/feature-b' });

    const res = await app.inject({
      method: 'GET',
      url: '/channels/discover?projectDir=%2Frepo%2Ffeature-a',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const physicalNames = body.channels.map((entry) => entry.physicalName);
    expect(physicalNames).toContain(featureA.channel.physicalName);
    expect(physicalNames).not.toContain(featureB.channel.physicalName);
  });

  test('GET /channels/resolve/:name resolves aliases within the current worktree', async () => {
    const featureA = messaging.ensureChannel('tauri:desktop', {
      projectDir: '/repo/feature-a',
      aliases: ['desktop:probe'],
    });
    messaging.ensureChannel('tauri:desktop', {
      projectDir: '/repo/feature-b',
      aliases: ['desktop:probe'],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/channels/resolve/desktop%3Aprobe?projectDir=%2Frepo%2Ffeature-a',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.channel.physicalName).toBe(featureA.channel.physicalName);
  });
});

describe('POST /msg/:channel — webhook forward token auth', () => {
  let app;
  let db;
  let messaging;
  let originalEnv;

  beforeEach(async () => {
    originalEnv = process.env.PD_WEBHOOK_FORWARD_TOKEN;
    db = createTestDb();
    messaging = createMessaging(db, { resolveChannelContext: () => null });
    app = Fastify();
    await app.register(messagingPlugin, {
      deps: {
        logger: { info: () => {}, error: () => {} },
        metrics: { errors: 0, messages_published: 0 },
        messaging,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.PD_WEBHOOK_FORWARD_TOKEN;
    } else {
      process.env.PD_WEBHOOK_FORWARD_TOKEN = originalEnv;
    }
    if (app) await app.close();
    if (messaging) messaging.destroy();
    if (db) db.close();
  });

  test('allows publish when PD_WEBHOOK_FORWARD_TOKEN is unset (opt-in)', async () => {
    delete process.env.PD_WEBHOOK_FORWARD_TOKEN;
    const res = await app.inject({
      method: 'POST',
      url: '/msg/test:channel',
      payload: { payload: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('401s when token is configured but no Authorization header is sent', async () => {
    process.env.PD_WEBHOOK_FORWARD_TOKEN = 'secret-token';
    const res = await app.inject({
      method: 'POST',
      url: '/msg/test:channel',
      payload: { payload: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('401s when Authorization header has wrong token', async () => {
    process.env.PD_WEBHOOK_FORWARD_TOKEN = 'secret-token';
    const res = await app.inject({
      method: 'POST',
      url: '/msg/test:channel',
      headers: { authorization: 'Bearer wrong-token' },
      payload: { payload: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('401s when Authorization scheme is not Bearer', async () => {
    process.env.PD_WEBHOOK_FORWARD_TOKEN = 'secret-token';
    const res = await app.inject({
      method: 'POST',
      url: '/msg/test:channel',
      headers: { authorization: 'Basic secret-token' },
      payload: { payload: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('allows publish when correct Bearer token is provided', async () => {
    process.env.PD_WEBHOOK_FORWARD_TOKEN = 'secret-token';
    const res = await app.inject({
      method: 'POST',
      url: '/msg/test:channel',
      headers: { authorization: 'Bearer secret-token' },
      payload: { payload: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('allows publish when Bearer scheme is case-insensitive (bearer)', async () => {
    process.env.PD_WEBHOOK_FORWARD_TOKEN = 'secret-token';
    const res = await app.inject({
      method: 'POST',
      url: '/msg/test:channel',
      headers: { authorization: 'bearer secret-token' },
      payload: { payload: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('empty-string PD_WEBHOOK_FORWARD_TOKEN is treated as unset (not silent bypass)', async () => {
    process.env.PD_WEBHOOK_FORWARD_TOKEN = '';
    const res = await app.inject({
      method: 'POST',
      url: '/msg/test:channel',
      payload: { payload: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });
});

// GET /msg/:channel/lineage — RCP-14 argument graph. Uses a stub messaging dep
// (no DB) so the route's decode → buildLineage logic is unit-tested directly.
describe('GET /msg/:channel/lineage', () => {
  let app;

  function stubMessaging(messages) {
    const noop = () => ({});
    return {
      listChannels: () => [],
      publish: noop,
      getMessages: () => ({ success: true, channel: 'c', messages, count: messages.length }),
      poll: noop,
      subscribe: () => null,
      clear: noop,
      discoverChannels: noop,
      ensureChannel: noop,
      resolveChannel: noop,
    };
  }

  async function buildApp(messages) {
    const a = Fastify();
    await a.register(messagingPlugin, {
      deps: {
        logger: { info: () => {}, error: () => {} },
        metrics: { errors: 0, messages_published: 0 },
        messaging: stubMessaging(messages),
      },
    });
    await a.ready();
    return a;
  }

  afterEach(async () => { if (app) await app.close(); });

  const env = (body, extra = {}) => ({ v: 1, kind: 'tube.msg', body, ...extra });

  test('builds the typed argument graph + digest from the backlog', async () => {
    app = await buildApp([
      { id: 1, sender: 'alice', createdAt: 1, payload: env('do X', { performative: 'propose', conversationId: 'cv' }) },
      { id: 2, sender: 'bob', createdAt: 2, payload: env('no Y', { inReplyTo: 1, relationship: 'contradicts', conversationId: 'cv' }) },
    ]);
    const res = await app.inject({ method: 'GET', url: '/msg/chan/lineage' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.conversationId).toBe('cv');
    expect(body.digest.total).toBe(2);
    expect(body.digest.byRelationship.contradicts).toBe(1);
    expect(body.digest.unresolvedContradictions).toHaveLength(1);
    expect(body.tree).toContain('#1 alice [act=propose]: do X');
    // RCP-2a parley decision: 1 unresolved × default waste 2 > default cost 1 → convene.
    expect(body.parley.convene).toBe(true);
    expect(body.parley.shape).toBe('debate-with-judge');
    expect(body.parley.unresolved).toBe(1);
  });

  test('parley holds when waste does not beat the cost (?parleyCost high)', async () => {
    app = await buildApp([
      { id: 1, sender: 'a', createdAt: 1, payload: env('claim') },
      { id: 2, sender: 'b', createdAt: 2, payload: env('wrong', { inReplyTo: 1, relationship: 'contradicts' }) },
    ]);
    const res = await app.inject({ method: 'GET', url: '/msg/chan/lineage?parleyCost=100' });
    expect(res.json().parley.convene).toBe(false);
  });

  test('scopes to a single conversationId when provided', async () => {
    app = await buildApp([
      { id: 1, sender: 'a', createdAt: 1, payload: env('one', { conversationId: 'keep' }) },
      { id: 2, sender: 'a', createdAt: 2, payload: env('two', { conversationId: 'drop' }) },
    ]);
    const res = await app.inject({ method: 'GET', url: '/msg/chan/lineage?conversationId=keep' });
    expect(res.json().digest.total).toBe(1);
  });

  test('returns an empty graph when the channel has no messages', async () => {
    app = await buildApp([]);
    const res = await app.inject({ method: 'GET', url: '/msg/chan/lineage' });
    expect(res.statusCode).toBe(200);
    expect(res.json().digest.total).toBe(0);
  });
});
