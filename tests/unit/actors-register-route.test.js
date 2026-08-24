/**
 * Route tests for POST /actors/register — the ADR-0040 mint endpoint.
 */
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { actorsPlugin } from '../../routes/actors.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import { createAgents } from '../../lib/agents.js';

function buildApp(actorSouls, agents) {
  const app = Fastify();
  app.register(actorsPlugin, { deps: { actorSouls, agents } });
  return app;
}

describe('POST /actors/register', () => {
  let db, app, agents, souls;
  beforeEach(async () => {
    db = createTestDb();
    souls = createActorSouls(db, { operatorSecret: 'op-secret' });
    agents = createAgents(db);
    app = buildApp(souls, agents);
    await app.ready();
  });
  afterEach(async () => { await app.close(); db.close(); });

  test('mints a fresh newcomer (201) and returns a credential once', async () => {
    const res = await app.inject({
      method: 'POST', url: '/actors/register',
      payload: { alias: 'proj:stack:ctx' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('minted');
    expect(body.soulClass).toBe('newcomer');
    expect(typeof body.credential).toBe('string');
    expect(body.credential.startsWith(`${body.actorId}.`)).toBe(true);
    expect(body.inboxTarget).toBe(body.actorId);
    expect(agents.resolveLiveActorInbox(body.actorId, 'local')).toEqual({
      success: true,
      binding: expect.objectContaining({
        actorId: body.actorId,
        harbor: 'local',
        inboxTarget: body.actorId,
      }),
    });
  });

  test('re-presenting a valid credential resolves to the same id (200, no new credential)', async () => {
    const first = (await app.inject({
      method: 'POST', url: '/actors/register', payload: { alias: 'a:b:c' },
    })).json();
    const res = await app.inject({
      method: 'POST', url: '/actors/register', payload: { credential: first.credential },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('resolved');
    expect(body.actorId).toBe(first.actorId);
    expect(body.inboxTarget).toBe(first.actorId);
    expect(body.credential).toBeUndefined();
  });

  test('a forged / mismatched credential is rejected 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/actors/register', payload: { credential: 'forged-id.bad-secret' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('CREDENTIAL_INVALID');
  });

  test('operatorToken mints an operator-trusted soul', async () => {
    const res = await app.inject({
      method: 'POST', url: '/actors/register', payload: { operatorToken: 'op-secret', alias: 'op:one' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().soulClass).toBe('operator');
  });

  test('returns 501 when the souls store is not wired', async () => {
    const bare = Fastify();
    bare.register(actorsPlugin, { deps: {} });
    await bare.ready();
    const res = await bare.inject({ method: 'POST', url: '/actors/register', payload: {} });
    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe('ACTOR_SOULS_UNAVAILABLE');
    await bare.close();
  });

  test('fails closed before minting when the server-owned inbox registry is unavailable', async () => {
    const isolatedDb = createTestDb();
    const souls = createActorSouls(isolatedDb);
    const bare = buildApp(souls, undefined);
    await bare.ready();
    const before = isolatedDb.prepare('SELECT COUNT(*) AS count FROM actor_souls').get().count;
    const res = await bare.inject({ method: 'POST', url: '/actors/register', payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('ACTOR_INBOX_REGISTRY_UNAVAILABLE');
    expect(isolatedDb.prepare('SELECT COUNT(*) AS count FROM actor_souls').get().count).toBe(before);
    await bare.close();
    isolatedDb.close();
  });

  test.each([
    ['harbor', { harbor: 'victim-harbor' }],
    ['project', { project: 'victim-project' }],
  ])('rejects caller-selected %s scope before minting or binding', async (_field, scope) => {
    const res = await app.inject({
      method: 'POST',
      url: '/actors/register',
      payload: { alias: 'scope-attacker', ...scope },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ACTOR_REGISTRATION_SCOPE_UNVERIFIED');
    expect(db.prepare('SELECT COUNT(*) AS count FROM actor_souls').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM actor_alias').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM newcomer_pool').get().count).toBe(0);
  });

  test('a credential from another harbor cannot steer the local registration scope', async () => {
    const foreign = souls.mint({ harbor: 'tenant-a', alias: 'shared-display-name' });

    const selectedScope = await app.inject({
      method: 'POST',
      url: '/actors/register',
      payload: {
        harbor: 'tenant-a',
        alias: 'shared-display-name',
        credential: foreign.credential,
      },
    });
    expect(selectedScope.statusCode).toBe(400);
    expect(selectedScope.json().code).toBe('ACTOR_REGISTRATION_SCOPE_UNVERIFIED');

    const defaultScope = await app.inject({
      method: 'POST',
      url: '/actors/register',
      payload: {
        alias: 'shared-display-name',
        credential: foreign.credential,
      },
    });
    expect(defaultScope.statusCode).toBe(401);
    expect(defaultScope.json().code).toBe('CREDENTIAL_INVALID');
    expect(agents.resolveLiveActorInbox(foreign.actorId, 'tenant-a')).toEqual(expect.objectContaining({
      success: false,
      code: 'ACTOR_INBOX_UNBOUND',
    }));
    expect(agents.resolveLiveActorInbox(foreign.actorId, 'local')).toEqual(expect.objectContaining({
      success: false,
      code: 'ACTOR_INBOX_UNBOUND',
    }));
  });

  test('alias and body agentId remain display-only and cannot select the party endpoint', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/actors/register',
      payload: {
        alias: 'shared-display-name',
        agentId: 'fresh-victim-agent',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.actorId).not.toBe('shared-display-name');
    expect(body.actorId).not.toBe('fresh-victim-agent');
    expect(body.inboxTarget).toBe(body.actorId);
    expect(souls.resolveAlias('shared-display-name', 'local')).toBe(body.actorId);
    expect(agents.resolveLiveActorInbox(body.actorId, 'local')).toEqual({
      success: true,
      binding: expect.objectContaining({ inboxTarget: body.actorId }),
    });
  });

  test('a fresh registry failure rolls back soul, alias, pool, and agent rows', async () => {
    const failing = buildApp(souls, {
      register: () => ({ success: false, code: 'INJECTED_REGISTRY_FAILURE' }),
    });
    await failing.ready();
    const res = await failing.inject({
      method: 'POST',
      url: '/actors/register',
      payload: { alias: 'must-not-orphan' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('INJECTED_REGISTRY_FAILURE');
    expect(res.json().credential).toBeUndefined();
    expect(res.json().actorId).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM actor_souls').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM actor_alias').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM newcomer_pool').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM agents').get().count).toBe(0);
    await failing.close();
  });

  test('a failed existing-credential bind preserves the soul and retries idempotently', async () => {
    const first = (await app.inject({
      method: 'POST',
      url: '/actors/register',
      payload: { alias: 'existing-display' },
    })).json();
    db.prepare('DELETE FROM agents WHERE id = ?').run(first.actorId);

    let failNext = true;
    const flakyAgents = {
      register: (...args) => {
        if (failNext) {
          failNext = false;
          return { success: false, code: 'INJECTED_REGISTRY_FAILURE' };
        }
        return agents.register(...args);
      },
    };
    const retryApp = buildApp(souls, flakyAgents);
    await retryApp.ready();

    const failed = await retryApp.inject({
      method: 'POST',
      url: '/actors/register',
      payload: { alias: 'retry-display', credential: first.credential },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().code).toBe('INJECTED_REGISTRY_FAILURE');
    expect(souls.verifyCredential(first.credential, 'local')).toBe(first.actorId);
    expect(souls.resolveAlias('retry-display', 'local')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM actor_souls').get().count).toBe(1);

    const recovered = await retryApp.inject({
      method: 'POST',
      url: '/actors/register',
      payload: { alias: 'retry-display', credential: first.credential },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toEqual(expect.objectContaining({
      status: 'resolved',
      actorId: first.actorId,
      inboxTarget: first.actorId,
    }));
    expect(agents.resolveLiveActorInbox(first.actorId, 'local')).toEqual({
      success: true,
      binding: expect.objectContaining({ inboxTarget: first.actorId }),
    });
    await retryApp.close();
  });
});
