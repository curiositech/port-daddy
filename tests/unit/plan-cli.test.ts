import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createSugar } from '../../lib/sugar.js';
import { createAgents } from '../../lib/agents.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { writeCurrentContext } from '../../cli/utils/current-context.js';
import { sessionsPlugin } from '../../routes/sessions.js';

const fetchMock = jest.fn<any>();
const error = jest.fn();
jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({ pdFetch: fetchMock, PORT_DADDY_URL: '' }));
jest.unstable_mockModule('../../cli/utils/ui.js', () => ({ error }));
const { handlePlan } = await import('../../cli/commands/plan.js');

const envKeys = ['PD_ACTOR_CREDENTIAL', 'PORT_DADDY_ACTOR_CREDENTIAL', 'PD_AGENT_ID', 'PD_SESSION_ID',
  'PORT_DADDY_CONTEXT_SLOT', 'PORT_DADDY_CONTEXT_DIR', 'CODEX_THREAD_ID', 'CLAUDE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ID', 'CURSOR_SESSION_ID', 'AIDER_SESSION_ID', 'COPILOT_SESSION_ID', 'TERM_SESSION_ID'];
let savedEnv: Record<string, string | undefined>;
let directory: string;
let db: any, sessions: any, app: any;
let a: any, b: any;
let exit: any, log: any;
let transport: (url: string, options?: any) => Promise<any>;

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, headers: {}, json: async () => body };
}
const posts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST');
const plans = (sessionId = a.sessionId) => sessions.getNotes(sessionId, { type: 'todo_list', limit: 1000 }).notes;
const seed = (content: string, sessionId = a.sessionId) => sessions.addNote(sessionId, content, { type: 'todo_list' });
async function refuses(args: string[], text: string, options = {}) {
  await expect(handlePlan(args, options)).rejects.toThrow('exit:1');
  expect(error).toHaveBeenLastCalledWith(expect.stringContaining(text));
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  const scratch = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratch, { recursive: true });
  directory = mkdtempSync(join(scratch, 'pd-plan-cli-test-'));
  process.env.PORT_DADDY_CONTEXT_DIR = directory;
  db = createTestDb();
  sessions = createSessions(db);
  const souls = createTestActorSouls(db);
  app = Fastify();
  await app.register(sessionsPlugin, { deps: { sessions, metrics: { errors: 0 },
    logger: { info() {}, error() {} }, activityLog: { log() {} }, actorSouls: souls } });
  async function caller(slot: string) {
    const minted = mintTestActor(souls, `plan-${slot}`);
    const started = await app.inject({ method: 'POST', url: '/sessions',
      headers: { 'x-actor-credential': minted.credential }, payload: { purpose: `Synthetic ${slot}`, agentId: `plan-${slot}` } });
    expect(started.statusCode).toBe(200);
    const caller = { sessionId: started.json().id, agentId: `plan-${slot}`, credential: minted.credential, contextSlot: slot };
    writeCurrentContext(caller);
    return caller;
  }
  a = await caller('a');
  b = await caller('b');
  process.env.PORT_DADDY_CONTEXT_SLOT = 'a';
  transport = async (url, options = {}) => {
    const result = await app.inject({ method: options.method ?? 'GET', url,
      headers: options.headers, ...(options.body ? { payload: options.body } : {}) });
    return { ok: result.statusCode >= 200 && result.statusCode < 300, status: result.statusCode,
      headers: result.headers, json: async () => result.json() };
  };
  fetchMock.mockReset().mockImplementation(transport);
  error.mockClear();
  exit = jest.spyOn(process, 'exit').mockImplementation((code) => { throw Error(`exit:${code}`); });
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  exit?.mockRestore();
  log?.mockRestore();
  await app?.close();
  db?.close();
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(directory, { recursive: true, force: true });
});

describe('plan CLI caller binding through the real session authorization route', () => {
  test('two owned slots set/check only their exact sessions, using explicit bound headers', async () => {
    await handlePlan(['set', '- [ ] A one\n- [ ] A two'], {});
    process.env.PORT_DADDY_CONTEXT_SLOT = 'b';
    await handlePlan(['set', '- [ ] B one'], {});
    process.env.PORT_DADDY_CONTEXT_SLOT = 'a';
    await handlePlan(['check', '2'], {});
    expect(plans(a.sessionId).map((p: any) => p.content)).toEqual(['- [ ] A one\n- [ ] A two', '- [ ] A one\n- [x] A two']);
    expect(plans(b.sessionId).map((p: any) => p.content)).toEqual(['- [ ] B one']);
    expect(posts().map(([, init]) => init.headers['x-actor-credential'])).toEqual([a.credential, b.credential, a.credential]);
    for (const [, init] of posts()) {
      expect(init.retry).toBe(false);
      expect(init.socketFallback).toBe(false);
      expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['content', 'type']);
    }
  });
  test('complete context conflicts stop before GET/POST, even with explicit --session', async () => {
    process.env.PD_AGENT_ID = b.agentId;
    process.env.PD_SESSION_ID = b.sessionId;
    await refuses(['check', '1'], 'CONTEXT_CONFLICT', { session: a.sessionId });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('a missing selected credential cannot fall back to another owned slot', async () => {
    writeCurrentContext({ ...a, credential: undefined });
    await refuses(['set', '- [ ] Mine'], 'IDENTITY_CREDENTIAL_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plans(b.sessionId)).toEqual([]);
  });
  test('explicit target never borrows the target owner credential', async () => {
    await refuses(['set', '- [ ] Not mine'], 'SESSION_OWNERSHIP_MISMATCH', { session: b.sessionId });
    expect(posts()[0][1].headers['x-actor-credential']).toBe(a.credential);
    expect(plans(b.sessionId)).toEqual([]);
  });
  test('same actor with a changed display alias succeeds without a redundant body assertion', async () => {
    writeCurrentContext({ ...a, agentId: 'renamed-display-only' });
    await handlePlan(['set', '- [ ] Still my actor'], {});
    expect(plans()[0].content).toBe('- [ ] Still my actor');
    expect(JSON.parse(posts()[0][1].body)).not.toHaveProperty('agentId');
  });
  test('forged credential remains rejected by the real server', async () => {
    writeCurrentContext({ ...a, credential: 'FORGED.not-a-valid-credential' });
    await refuses(['set', '- [ ] Rejected'], 'IDENTITY_CREDENTIAL_INVALID');
    expect(plans()).toEqual([]);
  });
  test('unstamped stored owner remains unverifiable', async () => {
    const legacy = sessions.start('Unstamped fixture', { agentId: a.agentId, durable: true });
    expect(legacy.success).toBe(true);
    await refuses(['set', '- [ ] Rejected'], 'SESSION_OWNER_UNVERIFIABLE', { session: legacy.id });
    expect(plans(legacy.id)).toEqual([]);
  });
  test('inactive exact session is not resumed and no replacement identity is created', async () => {
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('completed', a.sessionId);
    await refuses(['set', '- [ ] Rejected'], 'SESSION_NOT_ACTIVE');
    expect(plans()).toEqual([]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`/sessions/${a.sessionId}/notes`]);
  });
  test('no caller cannot write using only an explicit target', async () => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'absent';
    await refuses(['set', '- [ ] Rejected'], 'CALLER_CONTEXT_REQUIRED', { session: b.sessionId });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each(['', '  ', true])('invalid explicit target %# cannot silently fall back', async (session) => {
    await refuses(['set', '- [ ] Rejected'], 'Invalid --session target', { session });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('complete canonical plan projection and exact task selectors', () => {
  test('ordinal counts tasks, preserves headings/blanks/fences and all previous plan rows', async () => {
    const content = '# Plan\n\n- [ ] First\n```md\n- [ ] Example, not a task\n```\n\n1. [-] Second\n  * [X] Already done\n\nClosing paragraph.';
    seed(content);
    await handlePlan(['check', '2'], {});
    expect(plans().map((p: any) => p.content)).toEqual([content, content.replace('1. [-] Second', '1. [x] Second')]);
  });
  test('retains CRLF within canonical stored content and matches exact labels', async () => {
    const content = '# Tasks\r\n\r\n- [ ] Update docs\r\n- [ ] Tests';
    seed(content);
    await handlePlan(['check', 'Update docs'], {});
    expect(plans().at(-1).content).toBe(content.replace('[ ] Update docs', '[x] Update docs'));
  });
  test('backtick/tilde fence lengths and open fences do not create executable tasks', async () => {
    const content = '~~~~md\n- [ ] fake one\n~~~\n- [ ] fake two\n~~~~\n- [ ] Real\n```\n- [ ] fake three';
    seed(content);
    await handlePlan(['check', '1'], {});
    expect(plans().at(-1).content).toBe(content.replace('- [ ] Real', '- [x] Real'));
  });
  test.each([
    '<!--\n- [ ] Hidden\n-->\n- [ ] Visible',
    '<!--\r\n- [ ] Hidden\r\n-->\r\n- [ ] Visible',
    '<!-- hidden --> - [ ] Visible',
  ])('HTML-comment markers are not tasks and original positions survive %#', async (content) => {
    seed(content);
    await handlePlan(['check', '1'], {});
    expect(plans().at(-1).content).toBe(content.replace('[ ] Visible', '[x] Visible'));
  });
  test('comment opened after a visible task hides later tasks until its close', async () => {
    const content = '- [ ] First <!--\n- [ ] Hidden\n-->\n- [ ] Second';
    seed(content);
    await handlePlan(['check', '2'], {});
    expect(plans().at(-1).content).toBe(content.replace('[ ] Second', '[x] Second'));
  });
  test('comments inside fenced examples never hide subsequent real tasks', async () => {
    const content = '```html\n<!--\n- [ ] Hidden\n```\n- [ ] Visible';
    seed(content);
    await handlePlan(['check', '1'], {});
    expect(plans().at(-1).content).toBe(content.replace('[ ] Visible', '[x] Visible'));
  });
  test.each(['\n', '\r\n'])('HTML-like opening fence info stays literal with separator %#', async (newline) => {
    const content = ['```md <!-- literal info string', '- [ ] Example', '```', '- [ ] Visible'].join(newline);
    seed(content);
    await handlePlan(['check', '1'], {});
    expect(plans().at(-1).content).toBe(content.replace('[ ] Visible', '[x] Visible'));
  });
  test('a hidden exact label cannot append', async () => {
    seed('<!--\n- [ ] Hidden\n-->\n- [ ] Visible');
    await refuses(['check', 'Hidden'], 'No exact task label');
    expect(posts()).toHaveLength(0);
  });
  test.each(['0', '3', '999999999999999999999'])('out-of-range ordinal %s cannot append', async (selector) => {
    seed('- [ ] One\n- [ ] Two');
    await refuses(['check', selector], 'out of range');
    expect(posts()).toHaveLength(0);
  });
  test.each(['2junk', 'docs'])('selector %s is not parseInt or substring matching', async (selector) => {
    seed('- [ ] One\n- [ ] Update docs');
    await refuses(['check', selector], 'No exact task label');
    expect(posts()).toHaveLength(0);
  });
  test('duplicate labels are explicit ambiguity instead of first-match mutation', async () => {
    seed('- [ ] Same\n- [ ] Same');
    await refuses(['check', 'Same'], 'Ambiguous task label');
    expect(posts()).toHaveLength(0);
  });
  test('already checked target creates no duplicate version', async () => {
    seed('- [x] Done');
    await refuses(['check', '1'], 'already checked');
    expect(plans()).toHaveLength(1);
  });
  test('more than 100 historical notes still selects newest complete plan and retains history', async () => {
    for (let i = 0; i < 125; i++) seed(`- [ ] Historical ${i}`);
    const latest = '# Current\n\n- [ ] Last\n- [ ] Protected tail';
    seed(latest);
    const before = plans();
    await handlePlan(['show'], {});
    expect(log).toHaveBeenLastCalledWith(latest);
    await handlePlan(['check', '1'], {});
    const after = plans();
    expect(after.slice(0, -1)).toEqual(before);
    expect(after.at(-1).content).toBe(latest.replace('[ ] Last', '[x] Last'));
    expect(fetchMock.mock.calls[0][0].endsWith('?type=todo_list&limit=1')).toBe(true);
  });
  test('timestamp then numeric id deterministically orders an unordered returned tail', async () => {
    const note = (id: number, createdAt: number, content: string) => ({ id, createdAt, content, sessionId: a.sessionId, type: 'todo_list' });
    fetchMock.mockResolvedValueOnce(response(200, { notes: [note(10, 8, '- [ ] Newest'), note(11, 7, '- [ ] Older time'), note(9, 8, '- [ ] Older id')] }));
    await handlePlan(['check', '1'], {});
    expect(plans()[0].content).toBe('- [x] Newest');
  });
});

describe('truthful bounded failures and ambiguous append outcomes', () => {
  test('durable history beyond600 notes supports normal plan set/check/done and truthful complete count', async () => {
    const started = await app.inject({ method: 'POST', url: '/sessions', headers: { 'x-actor-credential': a.credential },
      payload: { purpose: 'Long-running plan lifecycle', agentId: a.agentId, lifecycle: 'durable' } });
    expect(started.statusCode).toBe(200);
    const sessionId = started.json().id;
    writeCurrentContext({ ...a, sessionId });
    const clock = jest.spyOn(Date, 'now');
    try {
      for (let i = 0; i < 600; i++) {
        clock.mockReturnValue(1_000_000 + Math.floor(i / 50) * 60_000);
        expect(sessions.addNote(sessionId, `Original ${i}`).success).toBe(true);
      }
      const original = sessions.get(sessionId).notes;
      await handlePlan(['set', '# Current\n- [ ] One\n- [ ] Two'], {});
      const checker = { checkBranchOnOrigin: jest.fn(() => ({ ok: true, branch: 'synthetic', upstream: 'origin/main', ahead: 0 })) };
      const sugar = createSugar({ sessions, agents: createAgents(db), activityLog: { log() {} } as any, gitOriginChecker: checker });
      const opts = { sessionId, agentId: a.agentId, note: 'Synthetic reviewed delivery https://github.com/example/repo/pull/1' };
      expect(sugar.done(opts).code).toBe('PLAN_UNCHECKED_ITEMS');
      await handlePlan(['check', '1'], {});
      await handlePlan(['check', '2'], {});
      for (let i = 0; i < 7; i++) expect(sessions.addNote(sessionId, `Burst remainder ${i}`).success).toBe(true);
      expect(sessions.addNote(sessionId, 'ordinary write refused').code).toBe('NOTE_RATE_LIMITED');
      const result = sugar.done(opts);
      expect(result).toMatchObject({ success: true, sessionStatus: 'completed', notesCount: 611, finalNote: true });
      expect(checker.checkBranchOnOrigin).toHaveBeenCalledTimes(2);
      const final = sessions.get(sessionId);
      expect(final.notes.slice(0, 600)).toEqual(original);
      expect(final.notes).toHaveLength(611);
      expect(sessions.getNotes(sessionId, { type: 'todo_list', limit: 1 }).notes[0].content).toBe('# Current\n- [x] One\n- [x] Two');
      expect(final.session.status).toBe('completed');
    } finally { clock.mockRestore(); }
  });
  test.each([['NOTE_RATE_LIMITED', 429], ['NOTE_TOO_LARGE', 413], ['NOTE_STORAGE_FAILED', 503]])('keeps %s diagnostic bounded and does not retry', async (code, status) => {
    fetchMock.mockResolvedValueOnce(response(status as number, { code, error: 'PRIVATE'.repeat(10000) }));
    await refuses(['set', '- [ ] Test'], String(code));
    expect(posts()).toHaveLength(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE');
  });
  test.each([401, 404, 500])('GET HTTP %s cannot be mistaken for an empty/writable plan', async (status) => {
    fetchMock.mockResolvedValueOnce(response(status, { notes: [{ content: '- [ ] Do not write' }], error: 'private secret must not print' }));
    await refuses(['check', '1'], `HTTP ${status}`);
    expect(posts()).toHaveLength(0);
    expect(JSON.stringify(error.mock.calls)).not.toContain('private secret');
  });
  test.each([null, {}, { notes: 'wrong' }, { notes: [{ id: 1, createdAt: 1, content: '- [ ] Wrong', type: 'todo_list', sessionId: 'other' }] }])('malformed read envelope %# cannot append', async (body) => {
    fetchMock.mockResolvedValueOnce(response(200, body));
    await expect(handlePlan(['check', '1'], {})).rejects.toThrow('exit:1');
    expect(posts()).toHaveLength(0);
  });
  test('malformed JSON read is explicit and cannot append', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw Error('secret syntax body'); } });
    await refuses(['check', '1'], 'malformed JSON');
    expect(posts()).toHaveLength(0);
  });
  test('read transport errors are bounded and do not become writes', async () => {
    fetchMock.mockRejectedValueOnce(Error('credential-bearing URL must not print'));
    await refuses(['check', '1'], 'read transport failed');
    expect(posts()).toHaveLength(0);
    expect(JSON.stringify(error.mock.calls)).not.toContain('credential-bearing');
  });
  test('write error preserves status/code without echoing attacker-controlled body', async () => {
    fetchMock.mockResolvedValueOnce(response(403, { code: 'SESSION_OWNERSHIP_MISMATCH', error: 'credential=PRIVATE'.repeat(10000) }));
    await refuses(['set', '- [ ] Test'], 'HTTP 403, SESSION_OWNERSHIP_MISMATCH');
    expect(String(error.mock.calls[0][0]).length).toBeLessThan(250);
    expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE');
  });
  test('lost append response reports unknown outcome and never replays the mutation', async () => {
    fetchMock.mockImplementationOnce(async (...args: any[]) => { await transport(args[0], args[1]); throw Error('private network details'); });
    await refuses(['set', '- [ ] Persisted once'], 'append outcome is unknown');
    expect(posts()).toHaveLength(1);
    expect(plans()).toHaveLength(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('private');
  });
  test('successful HTTP with missing or wrong-session receipt is not announced as success', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { success: true, noteId: 42, sessionId: b.sessionId }));
    await refuses(['set', '- [ ] Test'], 'receipt is incomplete');
    expect(log).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(1);
  });
});
