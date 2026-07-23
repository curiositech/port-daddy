/**
 * Route tests for POST /actors/register — the ADR-0040 mint endpoint.
 */
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { actorsPlugin } from '../../routes/actors.js';
import { createActorSouls } from '../../lib/actor-souls.js';

function buildApp(actorSouls) {
  const app = Fastify();
  app.register(actorsPlugin, { deps: { actorSouls } });
  return app;
}

describe('POST /actors/register', () => {
  let db, app;
  beforeEach(async () => {
    db = createTestDb();
    const souls = createActorSouls(db, { operatorSecret: 'op-secret' });
    app = buildApp(souls);
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
});
