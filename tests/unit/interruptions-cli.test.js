/**
 * `pd interruptions` — CLI surface of HITL operator interruptions
 * (docs/hitl-interruptions.md §4, surface 3).
 *
 * Covers the gate for the grand-plan `hitl-cli` node:
 *   - listing renders (golden-file snapshots in
 *     tests/fixtures/interruptions-cli.golden.json)
 *   - exit codes: 0 none open · 1 open asks · 2 unknown
 *   - critical-blocks-dispatch decision core
 *   - failed poll renders "unknown", NEVER "all clear" — exercised against a
 *     real stubbed relay (node:http on a loopback port)
 */

import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// lib/maritime.ts computes COLOR_ENABLED at import time and jest runs without
// a TTY; force color on BEFORE the module graph loads so the red-ANSI
// contract assertion (§4.2 "visually loud") is exercised for real.
process.env.FORCE_COLOR = '1';

const {
  formatInterruptionAge,
  renderInterruptionsReport,
  describeDispatchGate,
  pollOpenInterruptions,
} = await import('../../cli/commands/interruptions.js');

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'interruptions-cli.golden.json'), 'utf8'),
);

// Fixed clock so ages are deterministic.
const NOW_MS = 1_754_700_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

function ask(overrides = {}) {
  return {
    id: 'int_1',
    title: 'Sandbox missing for fail-closed run',
    urgency: 'critical',
    state: 'open',
    sourceAgent: 'purser-qa',
    createdAt: NOW_S - 720, // 12m ago
    ...overrides,
  };
}

const OPEN_POLL = {
  status: 'ok',
  accountUrl: 'https://relay.example/account/interruptions',
  interruptions: [
    ask(),
    ask({
      id: 'int_2',
      title: 'GitHub App lacks contents: write',
      urgency: 'high',
      sourceAgent: 'shipwright',
      createdAt: NOW_S - 3840, // 1h 04m ago
    }),
    ask({
      id: 'int_3',
      title: 'Choose a card design',
      urgency: 'normal',
      sourceAgent: 'designer',
      createdAt: NOW_S - 90_000, // 1d 1h ago
    }),
  ],
};

describe('formatInterruptionAge', () => {
  test('renders minute, hour, and day granularity', () => {
    expect(formatInterruptionAge(NOW_S - 30, NOW_MS)).toBe('<1m');
    expect(formatInterruptionAge(NOW_S - 720, NOW_MS)).toBe('12m');
    expect(formatInterruptionAge(NOW_S - 3840, NOW_MS)).toBe('1h 04m');
    expect(formatInterruptionAge(NOW_S - 90_000, NOW_MS)).toBe('1d 1h');
  });

  test('month-old asks keep the day granularity (no overflow past 24d)', () => {
    // 30 days + 5 hours
    expect(formatInterruptionAge(NOW_S - (30 * 86_400 + 5 * 3_600), NOW_MS)).toBe('30d 5h');
  });

  test('a clock-skewed future timestamp clamps to <1m, never negative', () => {
    expect(formatInterruptionAge(NOW_S + 500, NOW_MS)).toBe('<1m');
  });
});

describe('renderInterruptionsReport (golden)', () => {
  test('open listing matches the golden file and exits 1', () => {
    const report = renderInterruptionsReport(OPEN_POLL, { nowMs: NOW_MS, color: false });
    expect(report.lines).toEqual(GOLDEN.openListing);
    expect(report.exitCode).toBe(1);
  });

  test('zero open asks is an honest empty state with exit 0', () => {
    const report = renderInterruptionsReport(
      { status: 'ok', accountUrl: 'https://relay.example/account/interruptions', interruptions: [] },
      { nowMs: NOW_MS, color: false },
    );
    expect(report.lines).toEqual(GOLDEN.emptyListing);
    expect(report.exitCode).toBe(0);
  });

  test('a failed poll renders UNKNOWN (never all-clear) with exit 2', () => {
    const report = renderInterruptionsReport(
      {
        status: 'unknown',
        reason: 'relay returned HTTP 503',
        accountUrl: 'https://relay.example/account/interruptions',
      },
      { nowMs: NOW_MS, color: false },
    );
    expect(report.lines).toEqual(GOLDEN.unknownListing);
    expect(report.exitCode).toBe(2);
    expect(report.lines.join('\n')).not.toMatch(/no open/i);
  });

  test('critical and high urgencies are red ANSI when color is on', () => {
    const report = renderInterruptionsReport(OPEN_POLL, { nowMs: NOW_MS, color: true });
    const text = report.lines.join('\n');
    // \x1b[31m = red foreground; both loud urgencies must carry it.
    expect(text).toContain('\x1b[31m\x1b[1mCRITICAL');
    expect(text).toContain('\x1b[31m\x1b[1mHIGH');
    // The normal ask must NOT be red.
    expect(text).not.toContain('\x1b[31m\x1b[1mNORMAL');
  });

  test('answered/acked rows are not listed — only open ones', () => {
    const report = renderInterruptionsReport(
      {
        status: 'ok',
        accountUrl: 'https://relay.example/account/interruptions',
        interruptions: [ask({ state: 'answered' }), ask({ id: 'int_9', state: 'expired' })],
      },
      { nowMs: NOW_MS, color: false },
    );
    expect(report.exitCode).toBe(0);
  });
});

describe('describeDispatchGate (critical-blocks-dispatch decision core)', () => {
  test('an open critical ask BLOCKS, names the ask, and deep-links the answer page', () => {
    const gate = describeDispatchGate(OPEN_POLL, 'pd fleet up', { nowMs: NOW_MS, color: false });
    expect(gate.block).toBe(true);
    expect(gate.lines).toEqual(GOLDEN.criticalGate);
    const text = gate.lines.join('\n');
    expect(text).toContain('Sandbox missing for fail-closed run');
    expect(text).toContain('/account/interruptions');
  });

  test('non-critical open asks warn but do NOT block', () => {
    const gate = describeDispatchGate(
      {
        status: 'ok',
        accountUrl: 'https://relay.example/account/interruptions',
        interruptions: [ask({ urgency: 'high' }), ask({ id: 'int_2', urgency: 'normal' })],
      },
      'pd fleet up',
      { nowMs: NOW_MS, color: false },
    );
    expect(gate.block).toBe(false);
    expect(gate.lines.join('\n')).toContain('2 non-critical operator asks are open');
  });

  test('an unknown poll warns honestly but does not brick local fleet ops', () => {
    const gate = describeDispatchGate(
      { status: 'unknown', reason: 'poll failed: fetch failed' },
      'pd fleet up',
      { nowMs: NOW_MS, color: false },
    );
    expect(gate.block).toBe(false);
    expect(gate.lines.join('\n')).toContain('UNKNOWN');
    expect(gate.lines.join('\n')).not.toMatch(/all.clear\b.*yes/i);
  });

  test('not signed in (no operator scope) is silent and does not block', () => {
    const gate = describeDispatchGate(
      { status: 'unknown', unauthenticated: true, reason: 'not signed in — run: pd account login' },
      'pd fleet up',
    );
    expect(gate).toEqual({ block: false, lines: [] });
  });

  test('a critical ask that is already answered does not block', () => {
    const gate = describeDispatchGate(
      {
        status: 'ok',
        accountUrl: 'https://relay.example/account/interruptions',
        interruptions: [ask({ state: 'answered' })],
      },
      'pd fleet up',
    );
    expect(gate.block).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pollOpenInterruptions + handleInterruptions against a STUBBED RELAY —
// a real node:http server on a loopback port, pointed at via a temp
// account.json (accountPath override).
// ---------------------------------------------------------------------------

describe('pollOpenInterruptions against a stubbed relay', () => {
  let server;
  let relayUrl;
  let tmp;
  let accountPath;
  let nextResponse; // { status, body } the stub returns for the poll route

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'pd-interruptions-test-'));
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/v1/interruptions') {
        if (req.headers.authorization !== 'Bearer pdu_test_token') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'UNAUTHENTICATED', error: 'bad token' }));
          return;
        }
        res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nextResponse.body));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    relayUrl = `http://127.0.0.1:${server.address().port}`;
    accountPath = join(tmp, 'account.json');
    writeFileSync(
      accountPath,
      JSON.stringify({ token: 'pdu_test_token', login: 'erich', relayUrl }),
    );
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  });

  test('a clean 200 returns ok with the interruptions array', async () => {
    nextResponse = {
      status: 200,
      body: { code: 'OK', error: null, openCount: 1, interruptions: [ask()] },
    };
    const poll = await pollOpenInterruptions({ accountPath });
    expect(poll.status).toBe('ok');
    expect(poll.interruptions).toHaveLength(1);
    expect(poll.accountUrl).toBe(`${relayUrl}/account/interruptions`);
  });

  test('a 500 from the relay is UNKNOWN, not all-clear', async () => {
    nextResponse = { status: 500, body: { code: 'ERR', error: 'boom' } };
    const poll = await pollOpenInterruptions({ accountPath });
    expect(poll.status).toBe('unknown');
    expect(poll.reason).toContain('500');
  });

  test('a revoked token (401) is UNKNOWN and asks for re-login', async () => {
    const badPath = join(tmp, 'account-bad.json');
    writeFileSync(badPath, JSON.stringify({ token: 'pdu_revoked', login: 'erich', relayUrl }));
    const poll = await pollOpenInterruptions({ accountPath: badPath });
    expect(poll.status).toBe('unknown');
    expect(poll.unauthenticated).toBe(true);
    expect(poll.reason).toContain('pd account login');
  });

  test('a malformed body (no interruptions array) is UNKNOWN', async () => {
    nextResponse = { status: 200, body: { code: 'OK' } };
    const poll = await pollOpenInterruptions({ accountPath });
    expect(poll.status).toBe('unknown');
    expect(poll.reason).toContain('no interruptions array');
  });

  test('an unreachable relay is UNKNOWN with the failure reason', async () => {
    const deadPath = join(tmp, 'account-dead.json');
    // Grab a port that is definitely closed: bind, read, close, reuse.
    const probe = createServer(() => {});
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const deadPort = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    writeFileSync(
      deadPath,
      JSON.stringify({ token: 'pdu_test_token', login: 'erich', relayUrl: `http://127.0.0.1:${deadPort}` }),
    );
    const poll = await pollOpenInterruptions({ accountPath: deadPath, timeoutMs: 2000 });
    expect(poll.status).toBe('unknown');
    expect(poll.reason).toContain('poll failed');
  });

  test('no stored account is UNKNOWN + unauthenticated', async () => {
    const poll = await pollOpenInterruptions({ accountPath: join(tmp, 'nope.json') });
    expect(poll.status).toBe('unknown');
    expect(poll.unauthenticated).toBe(true);
  });
});
