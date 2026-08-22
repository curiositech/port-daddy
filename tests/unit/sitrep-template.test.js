import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { homedir } from 'node:os';

// `pd sitrep --template` regression suite (re-landed with the end-of-turn
// SITREP compulsion, operator doctrine 2026-08-22):
//   1. The transcript pointer must be derived from the real homedir — the
//      shipped defect hardcoded the operator's /Users/erichowens path.
//   2. The Ideas/Suggestions/Remediations table must arrive pre-filled from
//      the session's ACTIVE roadmap-pop claims instead of a blank row, and
//      must fail-silent back to the blank scaffold when the cartographer
//      routes are absent.

const pdFetch = jest.fn();
const readCurrentContext = jest.fn();
let logSpy;

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({
  readCurrentContext,
}));

const { handleSitrep } = await import('../../cli/commands/sitrep.js');

function jsonResponse(body, ok = true) {
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

/** Route the mocked pdFetch by path so each surface answers independently. */
function routeFetch(overrides = {}) {
  pdFetch.mockImplementation(async (url) => {
    const path = String(url);
    for (const [prefix, response] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) return response;
    }
    if (path.startsWith('/sitrep')) return jsonResponse(sitrepBody());
    return jsonResponse({ success: false, error: 'not wired' }, false);
  });
}

function templateOutput() {
  return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
}

beforeEach(() => {
  pdFetch.mockReset();
  readCurrentContext.mockReset();
  readCurrentContext.mockReturnValue(null);
  routeFetch();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => logSpy.mockRestore());

describe('pd sitrep --template transcript path', () => {
  test('derives the transcript pointer from the real homedir, never a hardcoded operator path', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-tmpl-1', agentId: 'agent-tmpl-1' });
    await handleSitrep({ template: true });

    const out = templateOutput();
    expect(out).toContain(
      `file://${homedir()}/.gemini/antigravity-cli/brain/session-tmpl-1/.system_generated/logs/transcript.jsonl`,
    );
    expect(out).not.toContain('/Users/erichowens/');
  });

  test('shows the no-active-session placeholder when no context is bound', async () => {
    await handleSitrep({ template: true });
    expect(templateOutput()).toContain('(No active session)');
  });
});

describe('pd sitrep --template ideas table pre-fill', () => {
  test('pre-fills rows from this session’s active roadmap-pop claims', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-tmpl-1', agentId: 'agent-tmpl-1' });
    routeFetch({
      '/cartographer/roadmap-claims': jsonResponse({
        success: true,
        claims: [
          {
            slug: 'sitrep-end-of-turn',
            summary: 'Re-land the end-of-turn SITREP compulsion',
            claimedBy: 'agent-tmpl-1',
            sessionId: 'session-tmpl-1',
            releasedAt: null,
          },
          {
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
    // My claim becomes a pre-linked row (status claimed, roadmap slug linked)…
    expect(out).toContain(
      '| Re-land the end-of-turn SITREP compulsion | agent-tmpl-1 | claimed | | sitrep-end-of-turn |',
    );
    // …and the mine-filter drops the foreign session's claim.
    expect(out).not.toContain('foreign-claim');
    // The blank placeholder row is replaced, not appended.
    expect(out).not.toContain('| | | | | |');
    // The contract rules ship with the scaffold.
    expect(out).toContain('pd roadmap upsert');
    expect(out).toContain('carry unresolved rows');
  });

  test('falls back to all active claims when none belong to this session', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-tmpl-1', agentId: 'agent-tmpl-1' });
    routeFetch({
      '/cartographer/roadmap-claims': jsonResponse({
        success: true,
        claims: [
          {
            slug: 'harbor-wide-item',
            summary: 'Active but unowned by me',
            claimedBy: 'agent-other',
            sessionId: 'session-other',
            releasedAt: null,
          },
          {
            slug: 'released-item',
            summary: 'Already released',
            claimedBy: 'agent-other',
            sessionId: 'session-other',
            releasedAt: '2026-08-21T00:00:00Z',
          },
        ],
      }),
    });

    await handleSitrep({ template: true });
    const out = templateOutput();
    expect(out).toContain('| Active but unowned by me | agent-other | claimed | | harbor-wide-item |');
    expect(out).not.toContain('released-item');
  });

  test('fail-silent: a daemon without cartographer routes still yields the blank scaffold', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-tmpl-1', agentId: 'agent-tmpl-1' });
    routeFetch({
      '/cartographer/roadmap-claims': jsonResponse({ success: false, error: 'no cartographer' }, false),
    });

    await handleSitrep({ template: true });
    const out = templateOutput();
    expect(out).toContain('| | | | | |');
    expect(out).toContain('## Ideas, Suggestions & Remediations');
  });

  test('fail-silent: a thrown claims fetch never breaks the template', async () => {
    readCurrentContext.mockReturnValue({ sessionId: 'session-tmpl-1', agentId: 'agent-tmpl-1' });
    pdFetch.mockImplementation(async (url) => {
      const path = String(url);
      if (path.startsWith('/sitrep')) return jsonResponse(sitrepBody());
      throw new Error('daemon vanished mid-call');
    });

    await handleSitrep({ template: true });
    const out = templateOutput();
    expect(out).toContain('# Session Sit-Rep: session-tmpl-1');
    expect(out).toContain('| | | | | |');
  });
});
