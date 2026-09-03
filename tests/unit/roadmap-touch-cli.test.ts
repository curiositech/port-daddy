import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { writeCurrentContext } from '../../cli/utils/current-context.js';
import { sessionsPlugin } from '../../routes/sessions.js';
import { roadmapPlugin } from '../../routes/roadmap.js';
import * as actualUi from '../../cli/utils/ui.js';

const fetchMock = jest.fn<any>();
const error = jest.fn();
const success = jest.fn();
jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({ pdFetch: fetchMock, PORT_DADDY_URL: '' }));
jest.unstable_mockModule('../../cli/utils/ui.js', () => ({ ...actualUi, error, success }));
const { handleRoadmap } = await import('../../cli/commands/roadmap.js');
const envKeys = ['PD_ACTOR_CREDENTIAL', 'PORT_DADDY_ACTOR_CREDENTIAL', 'PD_AGENT_ID', 'PD_SESSION_ID', 'PD_HARBOR',
  'PORT_DADDY_CONTEXT_SLOT', 'PORT_DADDY_CONTEXT_DIR', 'CODEX_THREAD_ID', 'CLAUDE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ID', 'CURSOR_SESSION_ID', 'AIDER_SESSION_ID', 'COPILOT_SESSION_ID', 'TERM_SESSION_ID'];
let savedEnv: Record<string, string | undefined>, directory: string;
let db: any, sessions: any, roadmap: any, deps: any, app: any, a: any, b: any, exit: any, log: any;
let transport: (url: string, init?: any) => Promise<any>;
let serverClock: number | undefined;
const item = (harbor = 'project-a') => roadmap.get('shared', harbor);
const options = { harbor: 'project-a', note: 'Synthetic current receipt', json: true };
const call = (extra = {}) => handleRoadmap(['touch', 'shared'], { ...options, ...extra });
const requestBody = () => ({ sessionId: a.sessionId, note: { at: Date.now() - 100, text: 'Direct synthetic receipt' } });
const post = (body: any, headers = a.headers, harbor = 'project-a') => app.inject({
  method: 'POST', url: `/roadmap/items/shared/touch?harbor=${encodeURIComponent(harbor)}`, headers, payload: body,
});
async function refuses(hint: string, extra = {}) {
  await expect(call(extra)).rejects.toThrow('exit:1');
  expect(error).toHaveBeenLastCalledWith(expect.stringContaining(hint));
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  directory = mkdtempSync(join(homedir(), 'coding', 'tmp', 'pd-touch-cli-'));
  process.env.PORT_DADDY_CONTEXT_DIR = directory;
  db = createTestDb();
  sessions = createSessions(db);
  const souls = createTestActorSouls(db);
  serverClock = undefined;
  roadmap = createRoadmapItems({ db, tuples: createTupleSpace(db), now: () => serverClock ?? Date.now() });
  deps = { roadmapItems: roadmap, roadmapPromote: {}, sessions, actorSouls: souls };
  app = Fastify({ bodyLimit: 10_240 });
  await app.register(sessionsPlugin, { deps: { sessions, metrics: { errors: 0 },
    logger: { info() {}, error() {} }, activityLog: { log() {} }, actorSouls: souls } });
  await app.register(roadmapPlugin, { deps });
  async function caller(slot: string) {
    const minted = mintTestActor(souls, `touch-${slot}`);
    const started = await app.inject({ method: 'POST', url: '/sessions', headers: minted.headers,
      payload: { purpose: `Synthetic touch ${slot}`, agentId: `touch-${slot}` } });
    expect(started.statusCode).toBe(200);
    const result = { ...minted, sessionId: started.json().id, agentId: `touch-${slot}`, contextSlot: slot };
    writeCurrentContext(result);
    return result;
  }
  a = await caller('a'); b = await caller('b');
  process.env.PORT_DADDY_CONTEXT_SLOT = 'a';
  for (const harbor of ['project-a', 'project-b']) {
    roadmap.upsert({ slug: 'shared', harbor, summaryMd: `Original ${harbor}`, assigneeId: 'durable-owner',
      status: 'backlog', promotedByAgentId: 'original-promoter', dependencies: ['dep'],
      sourceRefs: [{ type: 'doc', path: 'docs/plan.md' }], notes: [{ at: 1, by: 'old', text: 'Historical' }] });
  }
  transport = async (url, init = {}) => {
    const result = await app.inject({ method: init.method ?? 'GET', url, headers: init.headers,
      ...(init.body ? { payload: init.body } : {}) });
    return { ok: result.statusCode >= 200 && result.statusCode < 300, status: result.statusCode, json: async () => result.json() };
  };
  fetchMock.mockReset().mockImplementation(transport);
  error.mockClear(); success.mockClear();
  exit = jest.spyOn(process, 'exit').mockImplementation((code) => { throw Error(`exit:${code}`); });
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  exit?.mockRestore(); log?.mockRestore();
  await app?.close(); db?.close();
  for (const key of envKeys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  rmSync(directory, { recursive: true });
});

describe('real CLI through verified existing touch route', () => {
  test('one bounded POST keeps large history and concurrent fields; two caller slots keep their own attribution', async () => {
    roadmap.upsert({ slug: 'shared', harbor: 'project-a', summaryMd: 'Large', notes: Array.from({ length: 300 }, (_, i) => ({ at: i + 2, by: 'old', text: 'x'.repeat(100) })) });
    const other = item('project-b');
    let current: any;
    fetchMock.mockImplementation(async (url, init) => {
      roadmap.upsert({ slug: 'shared', harbor: 'project-a', summaryMd: 'Concurrent current summary', status: 'now', assigneeId: 'new-owner' });
      current = item();
      return transport(url, init);
    });
    await call();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/roadmap/items/shared/touch?harbor=project-a');
    expect(init).toMatchObject({ method: 'POST', retry: false, socketFallback: false });
    expect(init.headers['x-actor-credential']).toBe(a.credential);
    expect(Buffer.byteLength(init.body)).toBeLessThan(1024);
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['note', 'sessionId']);
    expect(item()).toEqual({ ...current, lastTouchedAt: item().lastTouchedAt, notes: [...current.notes, { at: JSON.parse(init.body).note.at, by: a.agentId, text: options.note }] });
    expect(item('project-b')).toEqual(other);
    process.env.PORT_DADDY_CONTEXT_SLOT = 'b';
    await call({ note: 'B current receipt' });
    expect(item().notes.at(-1).by).toBe(b.agentId);
    expect(fetchMock.mock.calls[1][1].headers['x-actor-credential']).toBe(b.credential);
  });
  test('context conflict and a missing bound credential make zero requests', async () => {
    process.env.PD_AGENT_ID = b.agentId; process.env.PD_SESSION_ID = b.sessionId;
    await refuses('CONTEXT_CONFLICT');
    delete process.env.PD_AGENT_ID; delete process.env.PD_SESSION_ID;
    writeCurrentContext({ ...a, credential: undefined });
    await refuses('IDENTITY_CREDENTIAL_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('same actor with changed display alias is stored as the canonical session owner', async () => {
    writeCurrentContext({ ...a, agentId: 'new-display-only' });
    await call();
    expect(item().notes.at(-1).by).toBe(a.agentId);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('agentId');
  });
  test('--as cannot borrow another author, and receipt size is measured in UTF-8 bytes', async () => {
    await refuses('CALLER_OVERRIDE_REJECTED', { as: b.agentId });
    await refuses('4096 UTF-8 bytes', { note: '🛟'.repeat(1025) });
    await refuses('8192 bytes', { note: '\u0001'.repeat(1500) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('explicit harbor and environment resolver select exactly the requested board', async () => {
    process.env.PD_HARBOR = 'project-b';
    await call({ harbor: undefined });
    expect(item('project-b').notes.at(-1).by).toBe(a.agentId);
    expect(item().notes).toHaveLength(1);
    await refuses('ROADMAP_ITEM_NOT_FOUND', { harbor: 'missing' });
    expect(item().notes).toHaveLength(1);
  });
  test('default text is generated once when --note is omitted', async () => {
    await call({ note: undefined });
    expect(item().notes.at(-1).text).toBe('roadmap touched for active work slice');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('strict route authorization and exact accepted replay', () => {
  test.each([
    ['no credential', 401, 'IDENTITY_CREDENTIAL_REQUIRED', () => ({ headers: {} })],
    ['wrong credential', 401, 'IDENTITY_CREDENTIAL_INVALID', () => ({ headers: { 'x-actor-credential': 'invalid.secret' } })],
    ['wrong actor', 403, 'SESSION_OWNERSHIP_MISMATCH', () => ({ headers: b.headers })],
    ['missing session', 404, 'SESSION_NOT_FOUND', () => ({ body: { ...requestBody(), sessionId: 'absent' } })],
  ])('%s cannot mutate the item', async (_label, status, code, setup) => {
    const before = item(); const change = setup();
    const res = await post(change.body ?? requestBody(), change.headers ?? a.headers);
    expect(res.statusCode).toBe(status); expect(res.json().code).toBe(code); expect(item()).toEqual(before);
  });
  test.each(['completed', 'abandoned'])('an %s session is not revived', async (status) => {
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, a.sessionId);
    const before = item();
    const res = await post(requestBody());
    expect(res.statusCode).toBe(409); expect(res.json().code).toBe('SESSION_NOT_ACTIVE');
    expect(sessions.get(a.sessionId).session.status).toBe(status); expect(item()).toEqual(before);
  });
  test('unstamped owner, absent verifier and absent session dependency fail without a write', async () => {
    const before = item();
    db.prepare('UPDATE sessions SET metadata = ? WHERE id = ?').run('{}', a.sessionId);
    expect((await post(requestBody())).json().code).toBe('SESSION_OWNER_UNVERIFIABLE');
    deps.actorSouls = undefined;
    expect((await post(requestBody())).json().code).toBe('IDENTITY_VERIFIER_UNAVAILABLE');
    deps.actorSouls = createTestActorSouls(db);
    deps.sessions = undefined;
    expect((await post(requestBody())).json().code).toBe('SESSION_VERIFIER_UNAVAILABLE');
    expect(item()).toEqual(before);
  });
  test.each([
    (body: any) => ({ ...body, summaryMd: 'Stale overwrite' }),
    (body: any) => ({ ...body, status: 'done' }),
    (body: any) => ({ ...body, note: { ...body.note, by: 'forged-author' } }),
    (body: any) => ({ ...body, note: { ...body.note, at: 0 } }),
    (body: any) => ({ ...body, note: { ...body.note, at: 1.5 } }),
    (body: any) => ({ ...body, note: { ...body.note, text: '🛟'.repeat(1025) } }),
    () => ({}),
  ])('rejects unsupported shape %# before append', async (change) => {
    const before = item(); const res = await post(change(requestBody()));
    expect(res.statusCode).toBe(400); expect(res.json().code).toBe('VALIDATION_ERROR'); expect(item()).toEqual(before);
  });
  test('fresh authorization precedes duplicate detection, including after server clock rollback', async () => {
    const payload = requestBody();
    const first = await post(payload);
    expect(first.statusCode).toBe(200);
    const before = item();
    const tuples = db.prepare('SELECT * FROM tuples ORDER BY id').all();
    serverClock = payload.note.at - 100;
    expect((await post(payload)).statusCode).toBe(200);
    expect(item()).toEqual(before); expect(db.prepare('SELECT * FROM tuples ORDER BY id').all()).toEqual(tuples);
    expect((await post(payload, b.headers)).statusCode).toBe(403);
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('abandoned', a.sessionId);
    expect((await post(payload)).statusCode).toBe(409);
    expect(item()).toEqual(before);
  });
  test('future clock, malformed stored history and deleted targets have truthful errors', async () => {
    const payload = requestBody(); serverClock = payload.note.at - 1;
    expect((await post(payload)).json().code).toBe('ROADMAP_NOTE_CLOCK_INVALID');
    serverClock = undefined;
    db.prepare('UPDATE roadmap_items SET notes_json = ? WHERE id = ?').run('broken', item().id);
    expect((await post(payload)).json().code).toBe('ROADMAP_HISTORY_INVALID');
    expect(db.prepare('SELECT notes_json FROM roadmap_items WHERE id = ?').get(item().id).notes_json).toBe('broken');
    roadmap.remove('shared', 'project-a');
    expect((await post(payload)).json().code).toBe('ROADMAP_ITEM_NOT_FOUND');
  });
});

describe('CLI outcome honesty', () => {
  test.each([401, 404, 413, 500])('HTTP %i is never success or retried', async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ error: 'secret provider query?token=NEVER_PRINT' }) });
    await refuses(`HTTP ${status}`);
    expect(error.mock.calls.flat().join(' ')).not.toContain('NEVER_PRINT');
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(success).not.toHaveBeenCalled();
  });
  test('lost response after acceptance leaves exactly one appended note and an unknown outcome', async () => {
    fetchMock.mockImplementation(async (url, init) => { await transport(url, init); throw new Error('private socket detail'); });
    await refuses('outcome is unknown');
    expect(item().notes).toHaveLength(2); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.flat().join(' ')).not.toContain('private socket');
  });
  test.each(['malformed', 'old-server', 'wrong-session', 'wrong-actor', 'wrong-harbor'])('%s reply cannot be reported as a verified append', async (kind) => {
    fetchMock.mockImplementation(async (url, init) => {
      const res = await transport(url, init); const data = await res.json();
      if (kind === 'old-server') delete data.receipt;
      if (kind === 'wrong-session') data.receipt.sessionId = b.sessionId;
      if (kind === 'wrong-actor') data.receipt.actorId = b.actorId;
      if (kind === 'wrong-harbor') data.item.harbor = 'project-b';
      return { ok: true, status: 200, json: async () => { if (kind === 'malformed') throw Error('private'); return data; } };
    });
    await refuses('receipt is missing, malformed');
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(item().notes).toHaveLength(2);
  });
});
