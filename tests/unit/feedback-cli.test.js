import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const pdFetch = jest.fn();
const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});
const readCurrentContext = jest.fn();
const loadFleetConfig = jest.fn();

let logSpy;
let errorSpy;

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({
  readCurrentContext,
}));

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  loadFleetConfig,
}));

const { handleFeedback, parseFleetbotRef } = await import('../../cli/commands/feedback.js');

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

beforeEach(() => {
  pdFetch.mockReset();
  readCurrentContext.mockReset();
  loadFleetConfig.mockReset();
  loadFleetConfig.mockReturnValue(null);
  readCurrentContext.mockReturnValue(null);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy?.mockRestore();
  errorSpy?.mockRestore();
});

afterAll(() => {
  exit.mockRestore();
});

function lastPostBody() {
  const call = pdFetch.mock.calls.find((args) => args[1]?.method === 'POST');
  if (!call) throw new Error('expected a POST call to /feedback');
  return JSON.parse(call[1].body);
}

describe('pd feedback bare form', () => {
  test('derives slug from kebab-cased summary words', async () => {
    pdFetch.mockResolvedValue(jsonResponse({ entry: { feedbackId: 'fb-1', severity: 'medium', surface: null, slug: 'tests-dropped-from-1638-to', droppedBy: 'cli:tester' } }, true));
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-1', severity: 'medium', surface: null, slug: 'tests-dropped-from-1638-to', droppedBy: 'cli:tester' } }, true));

    await handleFeedback(['tests dropped from 1638 to 1620 — investigate'], {});

    const body = lastPostBody();
    expect(body.summary).toBe('tests dropped from 1638 to 1620 — investigate');
    expect(body.slug).toBe('tests-dropped-from-1638-to-1620');
    expect(body.source).toBe('cli');
  });

  test('infers droppedBy from active session context', async () => {
    readCurrentContext.mockReturnValue({ agentId: 'agent-7c', sessionId: 'session-9d' });
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-2', severity: 'medium', surface: null, slug: 'auth-flow-broken-on-safari', droppedBy: 'agent-7c' } }, true));

    await handleFeedback(['auth flow broken on Safari'], {});

    expect(lastPostBody().droppedBy).toBe('agent-7c');
  });

  test('falls back to cli:$USER when no context', async () => {
    const originalUser = process.env.USER;
    process.env.USER = 'tester';
    try {
      pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-3', severity: 'medium', surface: null, slug: 'fallback', droppedBy: 'cli:tester' } }, true));

      await handleFeedback(['fallback'], {});

      expect(lastPostBody().droppedBy).toBe('cli:tester');
    } finally {
      if (originalUser === undefined) delete process.env.USER;
      else process.env.USER = originalUser;
    }
  });

  test('honors --as override over context', async () => {
    readCurrentContext.mockReturnValue({ agentId: 'agent-from-ctx', sessionId: 'session-x' });
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-4', severity: 'medium', surface: null, slug: 'override-test', droppedBy: 'override-agent' } }, true));

    await handleFeedback(['override test'], { as: 'override-agent' });

    expect(lastPostBody().droppedBy).toBe('override-agent');
  });

  test('passes through --severity, --surface, --hook, --suggest', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-5', severity: 'high', surface: 'CLI', slug: 'something-broke', droppedBy: 'cli:t' } }, true));

    await handleFeedback(
      ['something broke'],
      { severity: 'high', surface: 'CLI', hook: 'while running pd status', suggest: 'check daemon health' },
    );

    const body = lastPostBody();
    expect(body.severity).toBe('high');
    expect(body.surface).toBe('CLI');
    expect(body.hook).toBe('while running pd status');
    expect(body.suggested).toBe('check daemon health');
  });

  test('passes through --source override (does not silently default to cli)', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-6', severity: 'medium', surface: null, slug: 'agent-dropped-this', droppedBy: 'cli:t' } }, true));

    await handleFeedback(['agent dropped this'], { source: 'agent' });

    expect(lastPostBody().source).toBe('agent');
  });

  test('honors explicit --slug over auto-derivation', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-7', severity: 'medium', surface: null, slug: 'explicit-slug', droppedBy: 'cli:t' } }, true));

    await handleFeedback(['some long summary that would auto-slug'], { slug: 'explicit-slug' });

    expect(lastPostBody().slug).toBe('explicit-slug');
  });

  test('does NOT trigger bare form for known subcommand `list`', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entries: [] }, true));

    await handleFeedback(['list'], {});

    // list path uses GET, not POST — no POST body to inspect
    expect(pdFetch).toHaveBeenCalledTimes(1);
    expect(pdFetch.mock.calls[0][1]).toBeUndefined();
  });

  test('still supports explicit `drop` subcommand', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-8', severity: 'medium', surface: null, slug: 'manual-slug', droppedBy: 'manual-agent' } }, true));

    await handleFeedback(
      ['drop'],
      { slug: 'manual-slug', summary: 'manual summary', as: 'manual-agent' },
    );

    const body = lastPostBody();
    expect(body.slug).toBe('manual-slug');
    expect(body.summary).toBe('manual summary');
    expect(body.droppedBy).toBe('manual-agent');
  });

  test('explicit help arg shows usage', async () => {
    await handleFeedback(['help'], {});
    expect(pdFetch).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  test('no-args + interactive TTY defaults to summary view', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      pdFetch.mockResolvedValueOnce(jsonResponse({
        summary: { total: 0, open: 0, harvested: 0, bySeverity: { low: 0, medium: 0, high: 0, critical: 0 }, bySurface: {} },
      }, true));
      await handleFeedback([], {});
      expect(pdFetch).toHaveBeenCalled();
      expect(pdFetch.mock.calls[0][0]).toContain('/feedback/summary');
    } finally {
      if (originalIsTTY === undefined) {
        delete process.stdin.isTTY;
      } else {
        Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    }
  });

  test('exits non-zero when bare form summary is empty whitespace', async () => {
    await expect(handleFeedback(['   '], {})).rejects.toThrow('process.exit(1)');
    expect(pdFetch).not.toHaveBeenCalled();
  });

  test('exits non-zero when daemon rejects the drop', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid slug' }, false));

    await expect(handleFeedback(['something'], {})).rejects.toThrow('process.exit(1)');
    // ui.error routes through p.log.error (prompts lib) in TTY environments,
    // not console.error — assert the process exited rather than the log sink.
  });

  test('severity shortcut --high maps to severity:high', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-9', severity: 'high', surface: null, slug: 's', droppedBy: 'cli:t' } }, true));
    await handleFeedback(['something'], { high: true });
    expect(lastPostBody().severity).toBe('high');
  });

  test('severity shortcut --critical wins over implied medium', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-10', severity: 'critical', surface: null, slug: 's', droppedBy: 'cli:t' } }, true));
    await handleFeedback(['major outage'], { critical: true });
    expect(lastPostBody().severity).toBe('critical');
  });

  test('explicit --severity wins over shortcut flags', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-11', severity: 'low', surface: null, slug: 's', droppedBy: 'cli:t' } }, true));
    await handleFeedback(['something'], { severity: 'low', high: true });
    expect(lastPostBody().severity).toBe('low');
  });

  test('--no-auto-surface suppresses CWD inference', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-12', severity: 'medium', surface: null, slug: 's', droppedBy: 'cli:t' } }, true));
    await handleFeedback(['something'], { 'no-auto-surface': true });
    const body = lastPostBody();
    expect(body.surface).toBeUndefined();
  });

  test('explicit --surface wins over CWD inference', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-13', severity: 'medium', surface: 'CustomSurface', slug: 's', droppedBy: 'cli:t' } }, true));
    await handleFeedback(['something'], { surface: 'CustomSurface' });
    expect(lastPostBody().surface).toBe('CustomSurface');
  });

  test('recent subcommand defaults to status=open and limit=10', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entries: [] }, true));
    await handleFeedback(['recent'], {});
    const url = pdFetch.mock.calls[0][0];
    expect(url).toContain('status=open');
    expect(url).toContain('limit=10');
  });

  test('open subcommand defaults to status=open without forcing limit', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entries: [] }, true));
    await handleFeedback(['open'], {});
    const url = pdFetch.mock.calls[0][0];
    expect(url).toContain('status=open');
    expect(url).not.toContain('limit=10');
  });

  test('mine subcommand filters entries to current droppedBy', async () => {
    readCurrentContext.mockReturnValue({ agentId: 'me-agent', sessionId: 'sess' });
    pdFetch.mockResolvedValueOnce(jsonResponse({
      entries: [
        { feedbackId: 'a', droppedBy: 'me-agent', severity: 'medium', surface: null, slug: 'mine-1', summary: 's', source: 'cli' },
        { feedbackId: 'b', droppedBy: 'someone-else', severity: 'medium', surface: null, slug: 'theirs', summary: 's', source: 'cli' },
      ],
    }, true));

    await handleFeedback(['mine'], { quiet: true });
    expect(logSpy).toHaveBeenCalledWith('a');
    expect(logSpy).not.toHaveBeenCalledWith('b');
  });

  test('ack alias auto-derives harvestedBy from context (no --as needed)', async () => {
    readCurrentContext.mockReturnValue({ agentId: 'reviewer-agent', sessionId: 'sess' });
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-x', status: 'harvested' } }, true));

    await handleFeedback(['ack', 'fb-x'], { into: 'roadmap-now' });

    const call = pdFetch.mock.calls[0];
    expect(call[0]).toContain('/feedback/fb-x/harvest');
    expect(JSON.parse(call[1].body)).toEqual({ harvestedBy: 'reviewer-agent', intoSlug: 'roadmap-now' });
  });

  test('explicit drop subcommand also picks up severity shortcut + auto-surface', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-14', severity: 'high', surface: 'CLI', slug: 'manual', droppedBy: 'a' } }, true));
    await handleFeedback(['drop'], { slug: 'manual', summary: 'm', as: 'a', high: true, 'no-auto-surface': true });
    expect(lastPostBody().severity).toBe('high');
    expect(lastPostBody().surface).toBeUndefined();
  });
});

describe('parseFleetbotRef', () => {
  test('passes a bare run id through unchanged', () => {
    expect(parseFleetbotRef('run:delivery-abc123')).toBe('run:delivery-abc123');
  });

  test('trims whitespace on a bare ref', () => {
    expect(parseFleetbotRef('  run:delivery-abc123  ')).toBe('run:delivery-abc123');
  });

  test('extracts + decodes the run id from a run-page capability URL', () => {
    const url = 'https://relay.port-daddy.dev/fleet/runs/run%3Adelivery-abc123?t=v1.deadbeef';
    expect(parseFleetbotRef(url)).toBe('run:delivery-abc123');
  });

  test('falls back to the raw URL when it does not match the /fleet/runs/ shape', () => {
    const url = 'https://example.com/not-a-run-page';
    expect(parseFleetbotRef(url)).toBe(url);
  });
});

describe('pd feedback --fleetbot-review', () => {
  test('bare form sets fleetbotRunId, surface=Fleetbot, severity=high by default', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({
      entry: { feedbackId: 'fb-15', severity: 'high', surface: 'Fleetbot', slug: 's', droppedBy: 'cli:t', fleetbotRunId: 'run:delivery-abc123' },
    }, true));

    await handleFeedback(['qa-bot flagged a non-bug'], { 'fleetbot-review': 'run:delivery-abc123' });

    const body = lastPostBody();
    expect(body.fleetbotRunId).toBe('run:delivery-abc123');
    expect(body.surface).toBe('Fleetbot');
    expect(body.severity).toBe('high');
  });

  test('resolves a pasted run-page URL to its bare run id', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-16', severity: 'high', surface: 'Fleetbot', slug: 's', droppedBy: 'cli:t' } }, true));

    await handleFeedback(
      ['this verdict is wrong'],
      { 'fleetbot-review': 'https://relay.port-daddy.dev/fleet/runs/run%3Adelivery-xyz?t=v1.deadbeef' },
    );

    expect(lastPostBody().fleetbotRunId).toBe('run:delivery-xyz');
  });

  test('explicit --surface / --severity win over the fleetbot-review defaults', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-17', severity: 'low', surface: 'Fleet', slug: 's', droppedBy: 'cli:t' } }, true));

    await handleFeedback(
      ['minor nit only'],
      { 'fleetbot-review': 'run:delivery-abc123', surface: 'Fleet', severity: 'low' },
    );

    const body = lastPostBody();
    expect(body.surface).toBe('Fleet');
    expect(body.severity).toBe('low');
    expect(body.fleetbotRunId).toBe('run:delivery-abc123');
  });

  test('works through the explicit drop subcommand too', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-18', severity: 'high', surface: 'Fleetbot', slug: 'manual', droppedBy: 'a' } }, true));

    await handleFeedback(
      ['drop'],
      { slug: 'manual', summary: 'wrong verdict', as: 'a', 'fleetbot-review': 'run:delivery-abc123' },
    );

    const body = lastPostBody();
    expect(body.fleetbotRunId).toBe('run:delivery-abc123');
    expect(body.surface).toBe('Fleetbot');
    expect(body.severity).toBe('high');
  });

  test('no --fleetbot-review means no fleetbotRunId on the body', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entry: { feedbackId: 'fb-19', severity: 'medium', surface: null, slug: 's', droppedBy: 'cli:t' } }, true));
    await handleFeedback(['ordinary feedback'], {});
    expect(lastPostBody().fleetbotRunId).toBeUndefined();
  });

  test('fleetbot subcommand lists with surface=Fleetbot and status=open by default', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entries: [] }, true));
    await handleFeedback(['fleetbot'], {});
    const url = pdFetch.mock.calls[0][0];
    expect(url).toContain('surface=Fleetbot');
    expect(url).toContain('status=open');
  });

  test('fleetbot subcommand honors an explicit --status override', async () => {
    pdFetch.mockResolvedValueOnce(jsonResponse({ entries: [] }, true));
    await handleFeedback(['fleetbot'], { status: 'all' });
    const url = pdFetch.mock.calls[0][0];
    expect(url).toContain('surface=Fleetbot');
    expect(url).toContain('status=all');
  });
});
