import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

// All transports and saved-context reads are replaced before import. These
// fixtures prove rendering, not daemon storage isolation or live capture.
const pdFetch = jest.fn();
const readCurrentContext = jest.fn();
let logSpy;
const sessionId = 'session-tmpl-1';
const agentId = 'agent-tmpl-1';
const sessionPath = `/sessions/${sessionId}`;
const notesPath = `${sessionPath}/notes?type=todo_list`;
const claimsPath = '/cartographer/roadmap-claims';
jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({ pdFetch }));
jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({ readCurrentContext }));
const { handleSitrep } = await import('../../cli/commands/sitrep.js');

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => body };
}
function sitrepBody() {
  return { success: true, summary: 'quiet harbor', since_minutes: 60, since_ms: 0,
    activity: [], notes: [], salvage_queue: [], spawned_agents: [], approvals: [] };
}
function sessionResponse(overrides = {}) {
  return jsonResponse({ success: true, session: { id: sessionId, agentId, purpose: 'Repair template truth', ...overrides } });
}
function claim(overrides = {}) {
  return { slug: 'existing-item', summary: 'Existing scoped work', sessionId, agentId, claimedBy: agentId, releasedAt: null, ...overrides };
}
function plan(content, overrides = {}) {
  return { sessionId, type: 'todo_list', content, ...overrides };
}
function routeFetch(overrides = {}) {
  const routes = { '/sitrep': jsonResponse(sitrepBody()), [sessionPath]: sessionResponse(),
    [notesPath]: jsonResponse({ success: true, notes: [] }),
    [claimsPath]: jsonResponse({ success: true, claims: [] }), ...overrides };
  pdFetch.mockImplementation(async (url) => {
    const response = routes[String(url)];
    if (!response) throw new Error('UNEXPECTED_TEST_TRANSPORT');
    return typeof response === 'function' ? response() : response;
  });
}
function output() { return logSpy.mock.calls.map((args) => args.join(' ')).join('\n'); }
beforeEach(() => {
  pdFetch.mockReset(); readCurrentContext.mockReset();
  readCurrentContext.mockReturnValue({ sessionId, agentId }); routeFetch();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => logSpy.mockRestore());

describe('exact-session SITREP metadata', () => {
  test.each(['codex', 'claude', 'gemini', 'agy', 'generic'])('does not invent %s backend or transcript from context hints', async (hint) => {
    readCurrentContext.mockReturnValue({ sessionId, agentId, contextSlot: hint, backend: hint, transcriptPath: '/private/fixture/not-a-recorded-locator' });
    await handleSitrep({ template: true });
    expect(output()).toContain('**Backend:** unavailable (not recorded by this session API)');
    expect(output()).toContain('**Transcript:** unavailable (no recorded locator from this session API)');
    expect(output()).toContain('**Compliance Level:** unavailable (not recorded)');
    expect(output()).not.toMatch(/file:\/\/|antigravity-cli|C6|not-a-recorded-locator/);
    expect(pdFetch.mock.calls.map(([url]) => url)).toEqual(['/sitrep', sessionPath, notesPath, claimsPath]);
  });
  test('displays recorded compliance without an authority attestation', async () => {
    routeFetch({ [sessionPath]: sessionResponse({ purpose: 'Scoped purpose', telos: 'Scoped goal', metadata: { compliance: 'C2' } }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('**Telos:** Scoped goal');
    expect(output()).toContain('**Purpose:** Scoped purpose');
    expect(output()).toContain('**Compliance Level:** C2 (recorded; not an authority proof)');
    expect(output()).not.toContain('C6');
  });
  test.each([null, {}, [], 6, '', '  '])('malformed compliance %j remains unavailable', async (compliance) => {
    routeFetch({ [sessionPath]: sessionResponse({ metadata: { compliance } }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('**Compliance Level:** unavailable (not recorded)');
    expect(output()).not.toContain('[object Object]');
  });
  test.each([{ id: 'session-other' }, { agentId: 'agent-other' }, { agentId: null }, { id: null }])('mismatched returned session %j prevents dependent reads', async (mismatch) => {
    routeFetch({ [sessionPath]: sessionResponse({ ...mismatch, purpose: 'FOREIGN_PRIVATE_PURPOSE', metadata: { compliance: 'C6' } }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('returned session or agent does not match context');
    expect(output()).not.toMatch(/FOREIGN_PRIVATE_PURPOSE|C6/);
    expect(output()).toContain('Roadmap preview unavailable');
    expect(pdFetch.mock.calls.map(([url]) => url)).toEqual(['/sitrep', sessionPath]);
  });
  test.each([null, {}, { sessionId }, { agentId }, { sessionId: ['bad'], agentId }, { sessionId: 'bad\nrow', agentId }])('unbound context %j never reads global claims', async (context) => {
    readCurrentContext.mockReturnValue(context);
    await handleSitrep({ template: true });
    expect(output()).toContain('no exact session and agent context');
    expect(output()).toContain('Roadmap preview unavailable');
    expect(output()).not.toContain('0 of 0');
    expect(pdFetch.mock.calls.map(([url]) => url)).toEqual(['/sitrep']);
  });
  test('path-shaped identifiers are encoded, not interpreted as endpoints', async () => {
    const selected = 'session/a?b#c';
    readCurrentContext.mockReturnValue({ sessionId: selected, agentId });
    const encoded = `/sessions/${encodeURIComponent(selected)}`;
    routeFetch({ [encoded]: sessionResponse({ id: selected }),
      [`${encoded}/notes?type=todo_list`]: jsonResponse({ success: true, notes: [] }) });
    await handleSitrep({ template: true });
    expect(pdFetch.mock.calls.map(([url]) => url)).toEqual(['/sitrep', encoded, `${encoded}/notes?type=todo_list`, claimsPath]);
  });
  test('bounded text fields neither coerce objects nor create metadata lines', async () => {
    routeFetch({ [sessionPath]: sessionResponse({ purpose: {}, telos: 'a\n'.repeat(400), metadata: { compliance: 'C2\r\nrecorded' } }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('**Purpose:** unknown');
    expect(output().split('\n').find(line => line.startsWith('- **Telos:**')).length).toBeLessThanOrEqual(213);
    expect(output()).toContain('**Compliance Level:** C2 recorded (recorded; not an authority proof)');
  });
});

describe('SITREP roadmap returned preview', () => {
  test('renders only exact-session active rows and preserves existing-item guidance', async () => {
    const claims = Object.freeze([Object.freeze(claim()),
      Object.freeze(claim({ slug: 'foreign', sessionId: 'session-other', claimedBy: 'PRIVATE_FOREIGN_OWNER' })),
      Object.freeze(claim({ slug: 'released', releasedAt: 123 }))]);
    routeFetch({ [claimsPath]: jsonResponse({ success: true, claims }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('| Existing scoped work | agent-tmpl-1 | claimed (recorded) | | existing-item |');
    expect(output()).toContain('1 of 1 matching active rows shown from the returned preview');
    expect(output()).not.toMatch(/foreign|PRIVATE_FOREIGN_OWNER|released/);
    expect(output()).not.toContain('| | | | | |');
    expect(output()).toContain('Reuse the existing linked roadmap item and its ownership');
    expect(output()).toContain('carry unresolved rows');
    expect(output()).not.toMatch(/mint one first|pd roadmap upsert/);
  });
  test('an empty own projection never borrows another repo/session or same-agent session', async () => {
    routeFetch({ [claimsPath]: jsonResponse({ success: true, claims: [
      claim({ slug: 'same-agent-other-session', sessionId: 'session-other', payload: { repo: 'other-repo' } }),
      claim({ slug: 'agent-only-row', sessionId: null }),
      claim({ slug: 'claimant-only-row', sessionId: undefined, agentId: undefined }),
      claim({ slug: 'contradictory-agent', agentId: 'agent-other' })] }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('0 of 0 matching active rows shown from the returned preview');
    expect(output()).toContain('not a complete roadmap or ownership proof');
    expect(output()).toContain('| | | | | |');
    expect(output()).not.toMatch(/same-agent-other-session|agent-only-row|claimant-only-row|contradictory-agent|other-repo/);
  });
  test('legacy null agent is permitted only with exact session binding', async () => {
    routeFetch({ [claimsPath]: jsonResponse({ success: true, claims: [claim({ agentId: null, claimedBy: 'operator' })] }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('| operator | claimed (recorded) |');
  });
  test('eight-row cap distinguishes shown count from returned matching count', async () => {
    routeFetch({ [claimsPath]: jsonResponse({ success: true, claims: Array.from({ length: 12 }, (_, n) => claim({ slug: `item-${n}` })) }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('8 of 12 matching active rows shown from the returned preview');
    expect(output()).toContain('| item-7 |');
    expect(output()).not.toContain('| item-8 |');
  });
  test('malformed rows cannot become links or inject table rows', async () => {
    routeFetch({ [claimsPath]: jsonResponse({ success: true, claims: [null, 42, [], {},
      claim({ slug: 123 }), claim({ slug: 'bad|slug' }), claim({ slug: 'bad\nslug' }), claim({ slug: ' ' }),
      claim({ releasedAt: undefined }), claim({ releasedAt: false }),
      claim({ summary: 'Safe|label\ncontinued', claimedBy: 'safe|owner\ncontinued' })] }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('1 of 1 matching active rows');
    expect(output()).toContain('| Safe/label continued | safe/owner continued | claimed (recorded) | | existing-item |');
    expect(output()).not.toMatch(/undefined|bad\|slug|bad\nslug/);
  });
});

describe('SITREP plan history', () => {
  test('keeps full latest exact-session plan without modifying history or rendering foreign notes', async () => {
    const full = '# Latest plan\n- [x] Commit\n- [ ] Review\n\n```text\n- [ ] Example\n```\n' + 'detail '.repeat(500);
    const notes = Object.freeze([Object.freeze(plan('- [x] Old version')), Object.freeze(plan(full)),
      Object.freeze(plan('FOREIGN_PRIVATE_PLAN', { sessionId: 'session-other' })),
      Object.freeze(plan('NOT_A_PLAN', { type: 'progress' }))]);
    routeFetch({ [notesPath]: jsonResponse({ success: true, notes }) });
    await handleSitrep({ template: true });
    expect(output()).toContain(full);
    expect(output()).not.toMatch(/Old version|FOREIGN_PRIVATE_PLAN|NOT_A_PLAN/);
    expect(notes).toHaveLength(4);
  });
  test('empty returned plan list suggests inspecting history instead of asserting no stored plan', async () => {
    await handleSitrep({ template: true });
    expect(output()).toContain('No matching plan in returned session notes; inspect existing history with "pd plan"');
    expect(output()).not.toContain('No plan set yet');
  });
  test('malformed latest plan never falls back to an obsolete checklist', async () => {
    routeFetch({ [notesPath]: jsonResponse({ success: true, notes: [plan('OBSOLETE_PLAN'), plan({ not: 'text' })] }) });
    await handleSitrep({ template: true });
    expect(output()).toContain('Plan unavailable (latest returned plan has no readable content)');
    expect(output()).not.toContain('OBSOLETE_PLAN');
  });
});

describe('SITREP unavailable is not empty or verified', () => {
  const failures = [
    ['HTTP failure', () => jsonResponse({ error: 'PRIVATE_RESPONSE_DATA' }, false)],
    ['failed envelope', () => jsonResponse({ success: false, claims: [], notes: [] })],
    ['malformed envelope', () => jsonResponse({ success: true, claims: 'PRIVATE_RESPONSE_DATA', notes: {} })],
    ['null envelope', () => jsonResponse(null)],
    ['JSON failure', () => ({ ok: true, json: async () => { throw new Error('PRIVATE_JSON_DATA'); } })],
    ['transport failure', () => () => { throw new Error('PRIVATE_TRANSPORT_DATA'); }],
  ];
  test.each(failures)('%s stays unavailable on each dependent surface', async (_label, makeFailure) => {
    for (const path of [sessionPath, notesPath, claimsPath]) {
      logSpy.mockClear(); pdFetch.mockClear(); routeFetch({ [path]: makeFailure() });
      await handleSitrep({ template: true });
      expect(output()).not.toMatch(/PRIVATE_|No plan set yet/);
      if (path === claimsPath || path === sessionPath) {
        expect(output()).toContain('Roadmap preview unavailable');
        expect(output()).toContain('| | | | | |');
        expect(output()).not.toContain('0 of 0');
      }
      if (path === notesPath || path === sessionPath) expect(output()).toContain('Plan unavailable');
    }
  });
  test.each([{ json: true }, { quiet: true }, {}])('non-template mode %j never reads session evidence', async (options) => {
    routeFetch({ '/sitrep?summary_only=1': jsonResponse(sitrepBody()) });
    await handleSitrep(options);
    expect(readCurrentContext).not.toHaveBeenCalled();
    expect(pdFetch).toHaveBeenCalledTimes(1);
    expect(output()).toContain('quiet harbor');
  });
});
