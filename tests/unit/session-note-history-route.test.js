import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { sessionsPlugin } from '../../routes/sessions.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';

let db, sessions, app, owner, stranger, id, clock;
beforeEach(async () => {
  db = createTestDb();
  sessions = createSessions(db);
  const souls = createTestActorSouls(db);
  owner = mintTestActor(souls, 'history-owner');
  stranger = mintTestActor(souls, 'history-stranger');
  app = Fastify({ bodyLimit: 64 * 1024 }); // Independently exercise the library byte gate.
  await app.register(sessionsPlugin, { deps: { sessions, actorSouls: souls,
    metrics: { errors: 0 }, logger: { info() {}, error() {} }, activityLog: { log() {} } } });
  const started = await app.inject({ method: 'POST', url: '/sessions', headers: owner.headers,
    payload: { purpose: 'Synthetic durable history', agentId: 'history-owner', lifecycle: 'durable' } });
  expect(started.statusCode).toBe(200);
  id = started.json().id;
  clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
});
afterEach(async () => { clock.mockRestore(); await app.close(); db.close(); });
const write = (content, headers = owner.headers) => app.inject({ method: 'POST', url: `/sessions/${id}/notes`, headers, payload: { content } });

describe('exact-session bounded history and authenticated admission', () => {
  it('returns HTTP429 with precise Retry-After and recovers on the same identity', async () => {
    for (let i = 0; i < 60; i++) expect((await write(`N ${i}`)).statusCode).toBe(200);
    const refused = await write('too fast');
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBe('60');
    expect(refused.json()).toMatchObject({ code: 'NOTE_RATE_LIMITED', retryAt: 1_060_000, retryAfterMs: 60_000 });
    clock.mockReturnValue(1_060_000);
    expect((await write('same owner, recovered')).statusCode).toBe(200);
    expect(sessions.get(id).notes).toHaveLength(61);
  });

  it('rejects wrong/missing caller before consuming admission or mutating history', async () => {
    for (let i = 0; i < 65; i++) {
      expect((await write('foreign', stranger.headers)).statusCode).toBe(403);
      expect((await write('uncredentialed', {})).statusCode).toBe(401);
    }
    expect(sessions.get(id).notes).toEqual([]);
    expect((await write('still admitted')).statusCode).toBe(200);
  });

  it('uses metadata-only authorization once, without a full-history or claim read', async () => {
    const get = jest.spyOn(sessions, 'get');
    expect((await write('metadata path')).statusCode).toBe(200);
    expect(get.mock.calls).toEqual([[id, { metadataOnly: true }]]);
    expect(sessions.get(id, { metadataOnly: true })).toEqual({ success: true, session: expect.not.objectContaining({ noteCount: expect.anything() }) });
    const detail = await app.inject({ method: 'GET', url: `/sessions/${id}` });
    expect(detail.json().notes).toHaveLength(1);
    expect(detail.json().files).toEqual([]);
  });

  it('maps the independent UTF-8 bound and actual storage refusal truthfully', async () => {
    expect((await write('é'.repeat(5121))).statusCode).toBe(413);
    expect(sessions.get(id).notes).toEqual([]);
    db.exec("CREATE TRIGGER fail_note BEFORE INSERT ON session_notes BEGIN SELECT RAISE(ABORT, 'private'); END");
    const failed = await write('not persisted');
    expect(failed.statusCode).toBe(503);
    expect(failed.json().code).toBe('NOTE_STORAGE_FAILED');
    expect(failed.body).not.toContain('private');
    expect(sessions.get(id).notes).toEqual([]);
  });

  it('returns deterministic typed/since tails after600 notes and preserves full-detail defaults', async () => {
    for (let i = 0; i < 600; i++) {
      clock.mockReturnValue(1_000_000 + Math.floor(i / 50) * 60_000);
      sessions.addNote(id, `N ${i}`, { type: i % 3 === 0 ? 'todo_list' : 'note' });
    }
    const response = await app.inject({ method: 'GET', url: `/sessions/${id}/notes?type=todo_list&since=1660000&limit=2` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 16, count: 2, notes: [{ content: 'N 594' }, { content: 'N 597' }] });
    const all = await app.inject({ method: 'GET', url: `/sessions/${id}` });
    expect(all.json().notes).toHaveLength(600);
    expect(sessions.getNotes(id, { type: 'todo_list', agentId: 'other', limit: 1 })).toMatchObject({ count: 0, total: 0 });
    expect(sessions.getNotes(id, { type: 'todo_list', project: 'other', limit: 1 })).toMatchObject({ count: 0, total: 0 });
  });

  it.each(['0', '-1', '1001', '2junk', '1.5', 'NaN', 'Infinity', '9007199254740992', ''])('rejects invalid read limit %s on both routes', async (limit) => {
    for (const path of [`/sessions/${id}/notes`, '/notes']) {
      const response = await app.inject({ method: 'GET', url: `${path}?limit=${encodeURIComponent(limit)}` });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    }
  });
  it.each(['-1', '2junk', '1.5', '9007199254740992', ''])('rejects invalid since %s instead of silently widening the read', async (since) => {
    for (const path of [`/sessions/${id}/notes`, '/notes']) {
      const response = await app.inject({ method: 'GET', url: `${path}?since=${encodeURIComponent(since)}` });
      expect(response.statusCode).toBe(400);
    }
  });
  it('validates direct library limits and distinguishes missing session from invalid query', async () => {
    for (const limit of [0, -1, 1001, NaN, Infinity, 1.2, '2']) expect(sessions.getNotes(id, { limit }).code).toBe('VALIDATION_ERROR');
    expect((await app.inject({ method: 'GET', url: '/sessions/missing/notes?limit=1' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/notes?since=0&limit=1000' })).statusCode).toBe(200);
  });
});
