// REPAIRED IN PLACE — 2026-08-22 — harness spawned POSIX shell script via Node interpreter;
// now spawned via shell. Contract assertions preserved.
// This file's specific defect was worse than the spawn bug: the committed artifact contained
// no executable test code at all — it was the authoring model's leaked planning prose, which
// the transform rejected at line 1 ("Expected ';', '}' or <eof>"), failing the whole suite.
// Rebuilt as the real jest suite that prose was planning. The 2026-09-03 contract
// removes the later invented homedir pointer; no recorded locator means unavailable:
//   1. `pd sitrep --template` never fabricates a transcript path from any homedir.
//   2. The Ideas/Suggestions/Remediations table pre-fills from ACTIVE roadmap-pop claims
//      (released claims and foreign sessions' claims excluded; blank placeholder replaced).
//   3. A non-ok cartographer response or thrown claims fetch yields an explicitly
//      unavailable preview and blank scaffold, never a crash or a false empty-store claim.
//   4. REFUTED (prose steps 15/44-46, "no-session placeholder"): the prose guessed a
//      placeholder ROW appears only when no session is bound. The actual contract: the
//      Session evidence is unavailable when no exact context is bound, and
//      the blank table row `| | | | | |` appears whenever no claim rows pre-fill —
//      independent of session binding. Asserted as such below.
// The command is exercised in-process via jest.unstable_mockModule over pdFetch /
// readCurrentContext (spawning `node bin/pd` — the prose's other candidate — cannot mock
// the daemon and was the same class of harness mistake as the sibling file's node-spawn).

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { homedir } from 'node:os';

const pdFetch = jest.fn<(...args: any[]) => any>();
const readCurrentContext = jest.fn<(...args: any[]) => any>();
let logSpy: ReturnType<typeof jest.spyOn>;

jest.unstable_mockModule('../../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

jest.unstable_mockModule('../../../cli/utils/current-context.js', () => ({
  readCurrentContext,
}));

const { handleSitrep } = await import('../../../cli/commands/sitrep.js');

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => body };
}

function sitrepBody() {
  return {
    success: true,
    summary: 'quiet harbor',
    since_minutes: 60,
    since_ms: 0,
    activity: [],
    notes: [],
    salvage_queue: [],
    spawned_agents: [],
    approvals: [],
  };
}

/** Route the mocked pdFetch by path prefix so each surface answers independently. */
function routeFetch(overrides: Record<string, unknown> = {}) {
  pdFetch.mockImplementation(async (url: unknown) => {
    const path = String(url);
    for (const [prefix, response] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) return response;
    }
    if (path.startsWith('/sitrep')) return jsonResponse(sitrepBody());
    if (path === '/sessions/session-purser-1') return jsonResponse({
      success: true,
      session: { id: 'session-purser-1', agentId: 'agent-purser-1' },
    });
    return jsonResponse({ success: false, error: 'not wired' }, false);
  });
}

function templateOutput(): string {
  return logSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n');
}

beforeEach(() => {
  pdFetch.mockReset();
  readCurrentContext.mockReset();
  readCurrentContext.mockReturnValue(null);
  routeFetch();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined) as ReturnType<typeof jest.spyOn>;
});

afterEach(() => logSpy.mockRestore());

describe('pd sitrep --template recorded provenance', () => {
  test('reports unavailable instead of inventing a transcript pointer from any homedir', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-purser-1', agentId: 'agent-purser-1' });
    await handleSitrep({ template: true });

    const out = templateOutput();
    expect(out).toContain('**Session evidence:** matched returned session ID and agent ID');
    expect(out).toContain('**Transcript:** unavailable (no recorded locator from this session API)');
    expect(out).toContain('**Backend:** unavailable (not recorded by this session API)');
    expect(out).toContain('**Compliance Level:** unavailable (not recorded)');
    expect(out).not.toContain(
      `file://${homedir()}/.gemini/antigravity-cli/brain/session-purser-1/.system_generated/logs/transcript.jsonl`,
    );
    expect(out).not.toContain('file://');
    expect(out).not.toContain('.gemini/antigravity-cli/brain');
    expect(out).not.toContain('C6');
    expect(out).not.toContain('/Users/erichowens/');
  });

  test('no bound context: evidence is unavailable, the scaffold stays blank and no scoped lookup runs', async () => {
    // readCurrentContext returns null (the beforeEach default).
    await handleSitrep({ template: true });

    const out = templateOutput();
    expect(out).toContain('**Session evidence:** unavailable (no exact session and agent context)');
    expect(out).toContain('**Transcript:** unavailable (no recorded locator from this session API)');
    expect(out).toContain('| | | | | |');
    // No session ⇒ no session-derived transcript pointer to fabricate.
    expect(out).not.toContain('.gemini/antigravity-cli/brain');
    expect(pdFetch.mock.calls.map(([path]) => path)).toEqual(['/sitrep']);
  });

  test.each([
    { id: 'foreign-session', agentId: 'agent-purser-1' },
    { id: 'session-purser-1', agentId: 'foreign-agent' },
  ])('mismatched returned session or agent never enables claim lookup: %j', async (session) => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-purser-1', agentId: 'agent-purser-1' });
    routeFetch({ '/sessions/session-purser-1': jsonResponse({ success: true, session }) });
    await handleSitrep({ template: true });
    const out = templateOutput();
    expect(out).toContain('unavailable (returned session or agent does not match context)');
    expect(out).toContain('Roadmap preview unavailable (session evidence has not been matched)');
    expect(out).toContain('| | | | | |');
    expect(out).not.toContain('foreign-session');
    expect(out).not.toContain('foreign-agent');
    expect(pdFetch.mock.calls.map(([path]) => path)).toEqual(['/sitrep', '/sessions/session-purser-1']);
  });
});

describe('pd sitrep --template roadmap-claim pre-fill', () => {
  test('pre-fills rows from this session’s active claims; foreign and released claims never leak', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-purser-1', agentId: 'agent-purser-1' });
    routeFetch({
      '/cartographer/roadmap-claims': jsonResponse({
        success: true,
        claims: [
          {
            // Same agent, different session must not be adopted either.
            slug: 'same-agent-other-session',
            summary: 'Another run by this agent',
            agentId: 'agent-purser-1',
            claimedBy: 'agent-purser-1',
            sessionId: 'session-other',
            releasedAt: null,
          },
          {
            slug: 'sitrep-end-of-turn',
            summary: 'Re-land the end-of-turn SITREP compulsion',
            claimedBy: 'agent-purser-1',
            sessionId: 'session-purser-1',
            releasedAt: null,
          },
          {
            // Mine, but already released — must not resurface as an active row.
            slug: 'my-released-claim',
            summary: 'Finished last week',
            claimedBy: 'agent-purser-1',
            sessionId: 'session-purser-1',
            releasedAt: '2026-08-15T00:00:00Z',
          },
          {
            // Foreign session's active claim — the mine-filter drops it whole.
            slug: 'foreign-claim',
            summary: 'Someone else entirely',
            claimedBy: 'agent-other',
            sessionId: 'session-other',
            releasedAt: null,
          },
        ],
      }),
    });

    await handleSitrep({ template: true });
    const out = templateOutput();
    // My active claim is recorded evidence, not a current ownership attestation.
    expect(out).toContain(
      '| Re-land the end-of-turn SITREP compulsion | agent-purser-1 | claimed (recorded) | | sitrep-end-of-turn |',
    );
    // Released and foreign claims may not leak any identifying string.
    expect(out).not.toContain('my-released-claim');
    expect(out).not.toContain('foreign-claim');
    expect(out).not.toContain('Someone else entirely');
    expect(out).not.toContain('agent-other');
    expect(out).not.toContain('same-agent-other-session');
    expect(out).not.toContain('Another run by this agent');
    expect(out).toContain('1 of 1 matching active rows shown from the returned preview');
    // The blank placeholder row is replaced, not appended alongside real rows.
    expect(out).not.toContain('| | | | | |');
    // Reuse existing ownership; the scaffold must not demand duplicate minting.
    expect(out).toContain('Reuse the existing linked roadmap item and its ownership');
    expect(out).not.toContain('pd roadmap upsert');
    expect(pdFetch).toHaveBeenCalledWith('/cartographer/roadmap-claims');
  });

  test('a missing cartographer route explicitly reports unavailable and keeps the blank scaffold', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-purser-1', agentId: 'agent-purser-1' });
    routeFetch({
      '/cartographer/roadmap-claims': jsonResponse({ success: false, error: 'no cartographer' }, false),
    });

    await handleSitrep({ template: true });
    const out = templateOutput();
    expect(out).toContain('## Ideas, Suggestions & Remediations');
    expect(out).toContain('| | | | | |');
    expect(out).toContain('Roadmap preview unavailable (claims lookup failed or malformed)');
    expect(pdFetch).toHaveBeenCalledWith('/cartographer/roadmap-claims');
  });

  test('a thrown claims fetch never breaks the template or leaks the transport error', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-purser-1', agentId: 'agent-purser-1' });
    pdFetch.mockImplementation(async (url: unknown) => {
      const path = String(url);
      if (path.startsWith('/sitrep')) return jsonResponse(sitrepBody());
      if (path === '/sessions/session-purser-1') return jsonResponse({
        success: true, session: { id: 'session-purser-1', agentId: 'agent-purser-1' },
      });
      if (path.includes('/notes?')) return jsonResponse({ success: true, notes: [] });
      throw new Error('daemon vanished mid-call');
    });

    await handleSitrep({ template: true });
    const out = templateOutput();
    expect(out).toContain('# Session Sit-Rep: session-purser-1');
    expect(out).toContain('| | | | | |');
    expect(out).toContain('Roadmap preview unavailable (claims lookup failed or malformed)');
    expect(out).not.toContain('daemon vanished mid-call');
    expect(pdFetch).toHaveBeenCalledWith('/cartographer/roadmap-claims');
  });
});
