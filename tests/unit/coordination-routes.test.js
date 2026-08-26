/**
 * tests/unit/coordination-routes.test.js — Route-level enforcement
 * of the adversarial-fleet envelope contract.
 *
 * Properties under test (per route):
 *
 *  /tuples
 *   - Plaintext write to a `smell:vuln:*` tuple is REFUSED (403).
 *   - Plaintext write to a `fix:*` tuple is REFUSED (403).
 *   - Envelope-bearing write to a `smell:vuln:*` tuple is ACCEPTED.
 *   - Plaintext write to an ordinary tuple key is ACCEPTED (back-compat).
 *
 *  /msg/:channel
 *   - Plaintext POST to `redteam:crypto` is REFUSED (403).
 *   - Plaintext POST to `defense:proofs` is REFUSED (403).
 *   - Envelope-bearing POST to `redteam:crypto` is ACCEPTED.
 *   - Plaintext POST to a non-adversarial channel is ACCEPTED.
 */

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createMessaging } from '../../lib/messaging.js';
import { messagingPlugin } from '../../routes/messaging.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { tuplesPlugin } from '../../routes/tuples.js';

// A shape that passes daemonAcceptsEnvelopeFor for the named project.
function fakeEnvelope(project) {
  const keyPrefix = project === 'redteam-review'
    ? 'redteam-review-fleet-key.v2.1'
    : 'whitehat-defense-fleet-key.v2.1';
  // 12-byte iv, 16-byte tag (base64); ct/ad/sig non-empty.
  return {
    v: 1,
    key_id: keyPrefix,
    iv: Buffer.alloc(12, 7).toString('base64'),
    ct: Buffer.from('opaque-ct').toString('base64'),
    tag: Buffer.alloc(16, 9).toString('base64'),
    ad: Buffer.from('ad').toString('base64'),
    ts: '2026-05-01T00:00:00Z',
    signed_by: 'redteam:crypto',
    sig: Buffer.from('sig').toString('base64'),
  };
}

describe('tuples route — adversarial guard', () => {
  let app;
  let db;
  let tuples;

  beforeEach(async () => {
    db = createTestDb();
    tuples = createTupleSpace(db);
    app = Fastify();
    await app.register(tuplesPlugin, { tuples });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
  });

  test('refuses plaintext smell:vuln:* tuple', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tuples',
      payload: { fields: ['smell:vuln:crypto:bonded:7.4:0001', 'leaky'] },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('ADVERSARIAL_PROJECT_GUARD');
  });

  test('refuses plaintext fix:* tuple', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tuples',
      payload: { fields: ['fix:crypto:bonded:7.4:0001', 'leaky'] },
    });
    expect(res.statusCode).toBe(403);
  });

  test('accepts envelope-bearing smell:vuln:* tuple', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tuples',
      payload: {
        fields: ['smell:vuln:crypto:bonded:7.4:0001', 'sealed'],
        envelope: fakeEnvelope('redteam-review'),
      },
    });
    expect(res.statusCode).toBe(200);
  });

  test('refuses envelope + plaintext field[1] smuggle on adversarial tuple', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tuples',
      payload: {
        fields: ['smell:vuln:crypto:bonded:7.4:0001', 'leaky plaintext payload'],
        envelope: fakeEnvelope('redteam-review'),
      },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('ADVERSARIAL_PROJECT_GUARD');
    expect(body.error).toMatch(/plaintext-tuple-field-with-envelope/);
  });

  test('accepts plaintext non-adversarial tuple (back-compat)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tuples',
      payload: { fields: ['ordinary:key', 'value'] },
    });
    expect(res.statusCode).toBe(200);
  });

  test('public tuple routes cannot observe, count, poll, or take internal authority rows', async () => {
    const key = 'coordination:internal:lineage:route-isolation';
    const authority = tuples.outOnce(
      ['coordination:internal:lineage', 'route-isolation', 'signal-1', Date.now()],
      { harbor: 'fleet', idempotencyKey: key, internalOnly: true },
    );
    tuples.outOnce(['visible', 'payload'], {
      harbor: 'fleet',
      idempotencyKey: 'visible-route-key',
    });

    const read = await app.inject({
      method: 'GET',
      url: `/tuples?harbor=fleet&pattern=${encodeURIComponent(JSON.stringify(['*']))}`,
    });
    const poll = await app.inject({
      method: 'GET',
      url: `/tuples/poll?harbor=fleet&pattern=${encodeURIComponent(JSON.stringify(['coordination:internal:lineage']))}`,
    });
    const scan = await app.inject({ method: 'GET', url: '/tuples/scan?harbor=fleet' });
    const count = await app.inject({ method: 'GET', url: '/tuples/count?harbor=fleet' });
    const take = await app.inject({
      method: 'DELETE',
      url: '/tuples',
      payload: { harbor: 'fleet', pattern: ['coordination:internal:lineage'] },
    });

    expect(read.json().tuples).toEqual([
      expect.objectContaining({ fields: ['visible', 'payload'], idempotencyKey: null }),
    ]);
    expect(poll.json().tuple).toBeNull();
    expect(scan.json().tuples).toEqual([
      expect.objectContaining({ fields: ['visible', 'payload'], idempotencyKey: null }),
    ]);
    expect(count.json().count).toBe(1);
    expect(take.json()).toMatchObject({ count: 0, taken: [] });
    expect(tuples.getByIdempotencyKey(key, { harbor: 'fleet' })).toEqual(authority.tuple);
  });
});

describe('messaging route — adversarial guard', () => {
  let app;
  let db;
  let messaging;

  beforeEach(async () => {
    db = createTestDb();
    messaging = createMessaging(db, {
      resolveChannelContext: () => ({
        projectDir: '/repo/x', repoAnchor: '/repo/.git', repoKey: 'r1',
        worktreeId: 'w1', branch: 'main', inGit: true,
      }),
    });
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
    if (app) await app.close();
    if (messaging) messaging.destroy();
    if (db) db.close();
  });

  test('refuses plaintext POST to redteam:* channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/msg/redteam:crypto',
      payload: { content: 'leaky red plaintext' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('ADVERSARIAL_PROJECT_GUARD');
  });

  test('refuses plaintext POST to defense:* channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/msg/defense:proofs',
      payload: { content: 'leaky defense plaintext' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('accepts envelope-only POST to redteam:crypto', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/msg/redteam:crypto',
      payload: {
        envelope: fakeEnvelope('redteam-review'),
      },
    });
    expect(res.statusCode).toBe(200);
  });

  test('refuses envelope + plaintext content smuggle on redteam channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/msg/redteam:crypto',
      payload: {
        content: 'leaky plaintext smuggled past envelope',
        envelope: fakeEnvelope('redteam-review'),
      },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('ADVERSARIAL_PROJECT_GUARD');
    expect(body.error).toMatch(/plaintext-field-with-envelope/);
  });

  test('persists envelope JSON, not plaintext, on adversarial channel', async () => {
    const envelope = fakeEnvelope('redteam-review');
    const post = await app.inject({
      method: 'POST',
      url: '/msg/redteam:crypto',
      payload: { envelope },
    });
    expect(post.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/msg/redteam:crypto' });
    expect(get.statusCode).toBe(200);
    const { messages } = JSON.parse(get.body);
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    const stored = messages[0].payload ?? messages[0].content ?? messages[0].message;
    expect(typeof stored).toBe('string');
    const parsed = JSON.parse(stored);
    expect(parsed.key_id).toBe(envelope.key_id);
  });

  test('accepts plaintext POST to ordinary channel (back-compat)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/msg/ordinary-channel',
      payload: { content: 'hello' },
    });
    expect(res.statusCode).toBe(200);
  });
});
