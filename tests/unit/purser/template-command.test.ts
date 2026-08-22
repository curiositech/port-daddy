// REPAIRED IN PLACE — 2026-08-22 — harness spawned POSIX shell script via Node interpreter;
// now spawned via shell. Contract assertions preserved.
// This file's specific defect was worse than the spawn bug: the committed artifact contained
// no executable test code at all — it was the authoring model's leaked planning prose, which
// the transform rejected at line 1 ("Expected ';', '}' or <eof>"), failing the whole suite.
// Rebuilt as the real jest suite that prose was planning, keeping every obligation it named:
//   1. `pd sitrep --template` derives the transcript pointer from the REAL homedir — never
//      the shipped hardcoded /Users/erichowens operator path.
//   2. The Ideas/Suggestions/Remediations table pre-fills from ACTIVE roadmap-pop claims
//      (released claims and foreign sessions' claims excluded; blank placeholder replaced).
//   3. Error handling is fail-silent: a non-ok cartographer response or a thrown claims
//      fetch degrades to the blank scaffold, never a crash.
//   4. REFUTED (prose steps 15/44-46, "no-session placeholder"): the prose guessed a
//      placeholder ROW appears only when no session is bound. The actual contract: the
//      Transcript metadata line reads "(No active session)" when no context is bound, and
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

describe('pd sitrep --template homedir derivation', () => {
  test('derives the transcript pointer from the real homedir, never a hardcoded operator path', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-purser-1', agentId: 'agent-purser-1' });
    await handleSitrep({ template: true });

    const out = templateOutput();
    expect(out).toContain(
      `file://${homedir()}/.gemini/antigravity-cli/brain/session-purser-1/.system_generated/logs/transcript.jsonl`,
    );
    expect(out).not.toContain('/Users/erichowens/');
  });

  test('no bound context: transcript line reads "(No active session)" and the scaffold stays blank', async () => {
    // readCurrentContext returns null (the beforeEach default).
    await handleSitrep({ template: true });

    const out = templateOutput();
    expect(out).toContain('(No active session)');
    expect(out).toContain('| | | | | |');
    // No session ⇒ no session-derived transcript pointer to fabricate.
    expect(out).not.toContain('.gemini/antigravity-cli/brain');
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
    // My active claim becomes a pre-linked row: status claimed, roadmap slug linked.
    expect(out).toContain(
      '| Re-land the end-of-turn SITREP compulsion | agent-purser-1 | claimed | | sitrep-end-of-turn |',
    );
    // Released and foreign claims may not leak any identifying string.
    expect(out).not.toContain('my-released-claim');
    expect(out).not.toContain('foreign-claim');
    expect(out).not.toContain('Someone else entirely');
    expect(out).not.toContain('agent-other');
    // The blank placeholder row is replaced, not appended alongside real rows.
    expect(out).not.toContain('| | | | | |');
    // The roadmap-link-at-creation rule ships with the scaffold.
    expect(out).toContain('pd roadmap upsert');
  });

  test('fail-silent: a daemon without cartographer routes still yields the blank scaffold', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-purser-1', agentId: 'agent-purser-1' });
    routeFetch({
      '/cartographer/roadmap-claims': jsonResponse({ success: false, error: 'no cartographer' }, false),
    });

    await handleSitrep({ template: true });
    const out = templateOutput();
    expect(out).toContain('## Ideas, Suggestions & Remediations');
    expect(out).toContain('| | | | | |');
  });

  test('fail-silent: a thrown claims fetch never breaks the template', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-purser-1', agentId: 'agent-purser-1' });
    pdFetch.mockImplementation(async (url: unknown) => {
      const path = String(url);
      if (path.startsWith('/sitrep')) return jsonResponse(sitrepBody());
      throw new Error('daemon vanished mid-call');
    });

    await handleSitrep({ template: true });
    const out = templateOutput();
    expect(out).toContain('# Session Sit-Rep: session-purser-1');
    expect(out).toContain('| | | | | |');
  });
});
