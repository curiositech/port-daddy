// Regression controls derived from the independent root reader audit; all
// storage and route data below are synthetic fixtures, never operator state.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.ts';
import { sessionsPlugin } from '../../routes/sessions.ts';
import { activityPlugin } from '../../routes/activity.ts';
import { createCorrelationEngine } from '../../lib/correlation.ts';

let db, sessions, app, id, clock;
const fetcher = jest.fn();
jest.unstable_mockModule('../../cli/utils/fetch.ts', () => ({
  pdFetch: fetcher, PORT_DADDY_URL: 'http://synthetic.invalid',
}));
const { handleMemoryTiers } = await import('../../cli/commands/memory.ts');

beforeEach(async () => {
  db = createTestDb();
  sessions = createSessions(db);
  clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000);
  id = sessions.start('Synthetic reader audit', { durable: true }).id;
  const activityLog = { getRecent: () => ({ entries: [{ id: 1, timestamp: Date.now(), type: 'synthetic' }] }) };
  const logger = { info() {}, error() {} };
  app = Fastify();
  await app.register(sessionsPlugin, { deps: { sessions, metrics: { errors: 0 }, logger, activityLog } });
  await app.register(activityPlugin, { deps: { sessions, metrics: { errors: 0 }, logger, activityLog,
    correlationEngine: createCorrelationEngine(activityLog, sessions) } });
  fetcher.mockReset();
  fetcher.mockImplementation(async url => {
    if (url.startsWith('/notes?')) {
      const response = await app.inject({ method: 'GET', url });
      return { ok: response.statusCode === 200, status: response.statusCode, json: async () => response.json() };
    }
    return { ok: true, status: 200, json: async () => ({ sessions: [], claims: [], agents: [], count: 0, total: 0 }) };
  });
});
afterEach(async () => { clock.mockRestore(); await app.close(); if (db.open) db.close(); });

test.each([undefined, null, 0, -1, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1])('timeline refuses untraceable persisted ID %s in either source', async invalidId => {
  for (const source of ['activity', 'note']) {
    const activity = { getRecent: () => ({ entries: source === 'activity' ? [{ id: invalidId, timestamp: 1000, type: 'fixture' }] : [] }) };
    const store = { getNotes: () => ({ success: true, notes: source === 'note' ? [{ id: invalidId, sessionId: 'exact', createdAt: 1000, content: 'fixture', type: 'note' }] : [] }) };
    await expect(createCorrelationEngine(activity, store).getTimeline()).rejects.toMatchObject({ code: 'TIMELINE_SOURCE_UNAVAILABLE' });
  }
});

test.each([undefined, null, '', ' ', 'sibling'])('timeline refuses missing or wrong selected session provenance %s', async returnedSession => {
  const activity = { getRecent: () => ({ entries: [] }) };
  const store = { getNotes: () => ({ success: true, notes: [{ id: 1, sessionId: returnedSession, createdAt: 1000, content: 'fixture', type: 'note' }] }) };
  await expect(createCorrelationEngine(activity, store).getTimeline({ sessionId: 'exact' })).rejects.toMatchObject({ code: 'TIMELINE_SOURCE_UNAVAILABLE' });
});

test('OpenAPI describes bounded count snapshots and explicit timeline failures', () => {
  const spec = yaml.load(readFileSync(new URL('../../docs/openapi.yaml', import.meta.url), 'utf8'));
  const counts = spec.paths['/notes'].get.responses['200'].content['application/json'].schema.properties;
  for (const key of ['count', 'total', 'beforeSinceTotal']) expect(counts[key]).toMatchObject({ type: 'integer', minimum: 0 });
  const timeline = spec.paths['/activity/timeline'].get;
  expect(timeline.parameters.find(p => p.name === 'limit').schema).toMatchObject({ minimum: 1, maximum: 1000 });
  expect(timeline.responses['400']).toBeDefined();
  expect(timeline.responses['503'].description).toContain('TIMELINE_SOURCE_UNAVAILABLE');
});

test('memory tiers counts retained old and recent notes through the actual notes route', async () => {
  expect(sessions.addNote(id, 'Synthetic old note').success).toBe(true);
  clock.mockReturnValue(1_000_000_000 + 31 * 86400000);
  expect(sessions.addNote(id, 'Synthetic recent note').success).toBe(true);
  const output = jest.spyOn(console, 'log').mockImplementation(() => {});
  let rows;
  try {
    await handleMemoryTiers({ json: true });
    rows = JSON.parse(output.mock.calls.at(-1)[0]).rows;
  } finally { output.mockRestore(); }
  const notes = rows.filter(row => ['active-notes', 'archived-notes'].includes(row.construct));
  expect(notes.map(row => row.count)).toEqual([1, 1]);
  expect(notes.every(row => row.countError === undefined)).toBe(true);
});

test('global note total remains the matching total when the page is bounded', async () => {
  for (let i = 0; i < 3; i++) expect(sessions.addNote(id, `Synthetic ${i}`).success).toBe(true);
  const response = await app.inject('/notes?limit=1');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ count: 1, total: 3 });
});

test('oversized timeline limit is rejected instead of silently omitting the notes source', async () => {
  expect(sessions.addNote(id, 'Synthetic timeline note').success).toBe(true);
  const response = await app.inject(`/activity/timeline?limit=1001&session=${id}`);
  expect(response.statusCode).toBe(400);
});

test('an allowed timeline limit includes actual note and activity sources', async () => {
  expect(sessions.addNote(id, 'Synthetic timeline note').success).toBe(true);
  const response = await app.inject(`/activity/timeline?limit=1000&session=${id}`);
  expect(response.statusCode).toBe(200);
  expect(response.json().map(row => row.source).sort()).toEqual(['activity', 'note']);
});

test('memory counts 1101 retained notes with one bounded request and one cutoff', async () => {
  const cutoff = 5_000_000_000;
  for (let index = 0; index < 550; index++) {
    clock.mockReturnValue(cutoff - 2_000_000 + Math.floor(index / 50) * 60_001);
    expect(sessions.addNote(id, `old ${index}`).success).toBe(true);
  }
  for (let index = 0; index < 551; index++) {
    clock.mockReturnValue(cutoff + Math.floor(index / 50) * 60_001);
    expect(sessions.addNote(id, `recent ${index}`).success).toBe(true);
  }
  clock.mockReturnValue(cutoff + 30 * 86400000);
  const output = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await handleMemoryTiers({ json: true });
    const rows = JSON.parse(output.mock.calls.at(-1)[0]).rows;
    expect(rows.find(row => row.construct === 'active-notes').count).toBe(551);
    expect(rows.find(row => row.construct === 'archived-notes').count).toBe(550);
  } finally { output.mockRestore(); }
  expect(fetcher.mock.calls.filter(([url]) => url.startsWith('/notes?')).map(([url]) => url)).toEqual([
    `/notes?since=${cutoff}&limit=1`,
  ]);
  expect(sessions.get(id).notes).toHaveLength(1101);
  expect(sessions.getNotes(null, { since: cutoff, limit: 1 })).toMatchObject({ count: 1, total: 551, beforeSinceTotal: 550 });
});

test.each([
  [{}, 6, 3],
  [{ type: '' }, 6, 3],
  [{ type: 'progress' }, 3, 3],
  [{ project: 'first-project' }, 4, 2],
  [{ agentId: 'owner-a' }, 4, 2],
  [{ project: 'first-project', agentId: 'owner-a', type: 'progress' }, 1, 1],
  [{ project: 'missing-project', type: 'progress' }, 0, 0],
])('partition and page share exact base filters %j', (options, recent, archived) => {
  for (const [project, agentId] of [['first-project', 'owner-a'], ['first-project', 'owner-b'], ['second-project', 'owner-a']]) {
    const target = sessions.start('filter fixture', { durable: true, project, agentId }).id;
    for (const [at, type] of [[999, 'progress'], [1000, 'progress'], [1001, 'note']]) {
      clock.mockReturnValue(at);
      expect(sessions.addNote(target, `${project}:${agentId}:${at}`, { type }).success).toBe(true);
    }
  }
  const result = sessions.getNotes(null, { ...options, since: 1000, limit: 1 });
  expect(result).toMatchObject({ success: true, count: Math.min(1, recent), total: recent, beforeSinceTotal: archived });
  expect(sessions.getNotes(null, { ...options, limit: 1 }).total).toBe(recent + archived);
  expect(result.notes.every(note => note.createdAt >= 1000)).toBe(true);
});

test('empty partition is explicit zeros, not missing count metadata', async () => {
  const response = await app.inject('/notes?since=0&limit=1');
  expect(response.json()).toMatchObject({ success: true, count: 0, total: 0, beforeSinceTotal: 0, notes: [] });
});

test.each([
  { success: true, notes: [{}] },
  { success: true, total: 1, beforeSinceTotal: -1 },
  { success: true, total: '1', beforeSinceTotal: 0 },
  { success: true, total: 1.5, beforeSinceTotal: 0 },
  { success: false, total: 1, beforeSinceTotal: 0 },
])('memory refuses malformed count metadata without page-length fallback: %j', async data => {
  fetcher.mockImplementation(async url => ({ ok: true, status: 200,
    json: async () => url.startsWith('/notes?') ? data : { total: 0, count: 0, sessions: [], claims: [], agents: [] } }));
  const output = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await handleMemoryTiers({ json: true });
    const rows = JSON.parse(output.mock.calls.at(-1)[0]).rows.filter(row => ['active-notes', 'archived-notes'].includes(row.construct));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ countError: 'note count metadata is unavailable' });
    expect(rows.every(row => row.count === undefined)).toBe(true);
  } finally { output.mockRestore(); }
  expect(fetcher.mock.calls.filter(([url]) => url.startsWith('/notes?'))).toHaveLength(1);
});

test('storage read failure is explicit for both memory rows and never reported as zero', async () => {
  db.close();
  const output = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await handleMemoryTiers({ json: true });
    const rows = JSON.parse(output.mock.calls.at(-1)[0]).rows.filter(row => ['active-notes', 'archived-notes'].includes(row.construct));
    for (const row of rows) expect(row).toMatchObject({ countError: 'note counts unavailable (HTTP 500)' });
    expect(rows.every(row => row.count === undefined)).toBe(true);
  } finally { output.mockRestore(); }
});

test.each(['0', '-1', '1.5', '2junk', '', '1001', '9007199254740993', '1&limit=2'])(
  'timeline rejects invalid requested limit %s before source reads', async limit => {
    const response = await app.inject(`/activity/timeline?limit=${limit}`);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
  },
);

test.each([0, -1, 1.5, 1001, Infinity, NaN])('direct timeline caller also validates limit %s', async limit => {
  const getRecent = jest.fn();
  const getNotes = jest.fn();
  await expect(createCorrelationEngine({ getRecent }, { getNotes }).getTimeline({ limit }))
    .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(getRecent).not.toHaveBeenCalled();
  expect(getNotes).not.toHaveBeenCalled();
});

test.each([
  ['notes', () => ({ success: false, error: 'synthetic private detail', notes: [] })],
  ['notes', () => ({ success: true })],
  ['notes', () => ({ success: true, notes: [null] })],
  ['notes', () => { throw Error('synthetic private detail'); }],
  ['activity', () => ({ success: false, entries: [] })],
  ['activity', () => ({ entries: [null] })],
  ['activity', () => { throw Error('synthetic private detail'); }],
])('timeline reports unavailable %s without partial success or raw errors', async (source, fail) => {
  const activityLog = { getRecent: source === 'activity' ? fail : () => ({ entries: [] }) };
  const store = source === 'notes' ? { ...sessions, getNotes: fail } : sessions;
  const isolated = Fastify();
  await isolated.register(activityPlugin, { deps: { sessions: store, activityLog,
    metrics: { errors: 0 }, logger: { info() {}, error() {} }, correlationEngine: createCorrelationEngine(activityLog, store) } });
  try {
    const response = await isolated.inject('/activity/timeline?limit=100');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ success: false, code: 'TIMELINE_SOURCE_UNAVAILABLE', error: 'one or more timeline sources are unavailable' });
    expect(response.body).not.toContain('synthetic private detail');
  } finally { await isolated.close(); }
});

test('global page and aggregate share a WAL snapshot across a concurrent writer', () => {
  const scratch = join(process.cwd(), '.scratch');
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, 'reader-snapshot-'));
  const path = join(directory, 'history.sqlite');
  for (let index = 0; index < 3; index++) expect(sessions.addNote(id, `original ${index}`).success).toBe(true);
  writeFileSync(path, db.serialize());
  const first = new Database(path), second = new Database(path);
  first.pragma('journal_mode = WAL');
  second.pragma('journal_mode = WAL');
  const writer = createSessions(second);
  const prepare = first.prepare.bind(first);
  let injected = false;
  first.prepare = sql => {
    const statement = prepare(sql);
    if (sql.includes('ORDER BY sn.created_at DESC, sn.id DESC LIMIT ?') && !sql.includes('WHERE')) {
      const all = statement.all.bind(statement);
      statement.all = (...args) => {
        const rows = all(...args);
        if (!injected) {
          expect(first.inTransaction).toBe(true);
          injected = true;
          expect(writer.addNote(id, 'concurrent original').success).toBe(true);
        }
        return rows;
      };
    }
    return statement;
  };
  try {
    const reader = createSessions(first);
    expect(reader.getNotes(null, { limit: 1 })).toMatchObject({ success: true, count: 1, total: 3 });
    expect(injected).toBe(true);
    expect(reader.getNotes(null, { limit: 1 })).toMatchObject({ success: true, count: 1, total: 4 });
    expect(writer.get(id).notes).toHaveLength(4);
  } finally { first.close(); second.close(); rmSync(directory, { recursive: true }); }
});
