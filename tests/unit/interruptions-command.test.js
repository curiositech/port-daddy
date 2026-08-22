/**
 * `pd interruptions` end-to-end through handleInterruptions: the JSON script
 * surface and process.exitCode against a stubbed relay, with PD_HOME pinned
 * to a temp dir BEFORE the module graph loads (shared/paths.js reads it at
 * import time).
 *
 * The stub sits ONLY at the true boundary (the relay's HTTP socket); every
 * assertion is about behavior the command COMPUTES, not data echoed back:
 *  - the wire request itself (path, query, bearer token) is captured and
 *    asserted — the command must really poll `GET /v1/interruptions?state=open`
 *    with the stored token;
 *  - `status`/`openCount`/exit code are DERIVED by the command (the relay
 *    payload carries no `status` field), including re-filtering to open-state
 *    asks so a mixed payload proves the output is not an input echo;
 *  - every failure mode (HTTP 500, revoked token 401, malformed body) must
 *    surface as the three-valued 'unknown' with exit 2 — never as all-clear.
 */

import { jest } from '@jest/globals';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Pin the Port Daddy home BEFORE anything imports shared/paths.js.
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'pd-interruptions-home-'));
process.env.PD_HOME = FAKE_HOME;

const { handleInterruptions } = await import('../../cli/commands/interruptions.js');

describe('pd interruptions --json (script surface)', () => {
  let server;
  let relayUrl;
  /** Per-test relay behavior: { status, body }. */
  let relayResponse;
  /** Every request the command actually put on the wire. */
  let received;
  let logSpy;
  const originalExitCode = process.exitCode;

  beforeAll(async () => {
    server = createServer((req, res) => {
      received.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization ?? null,
      });
      const { status, body } = relayResponse;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    relayUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  beforeEach(() => {
    received = [];
    relayResponse = { status: 200, body: { code: 'OK', error: null, interruptions: [] } };
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  function signIn() {
    mkdirSync(FAKE_HOME, { recursive: true });
    writeFileSync(
      join(FAKE_HOME, 'account.json'),
      JSON.stringify({ token: 'pdu_test_token', login: 'erich', relayUrl }),
    );
  }

  function lastJson() {
    const call = logSpy.mock.calls.at(-1);
    return JSON.parse(call[0]);
  }

  const ask = (over = {}) => ({
    id: 'int_1',
    title: 'Sandbox missing for fail-closed run',
    urgency: 'critical',
    state: 'open',
    sourceAgent: 'purser-qa',
    createdAt: Math.floor(Date.now() / 1000) - 120,
    ...over,
  });

  test('not signed in → status unknown, exit 2, and the relay is never contacted', async () => {
    rmSync(join(FAKE_HOME, 'account.json'), { force: true });
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('unknown');
    expect(out.reason).toContain('pd account login');
    expect(process.exitCode).toBe(2);
    // Without a stored token there is nothing to poll WITH — no wire traffic.
    expect(received).toEqual([]);
  });

  test('polls GET /v1/interruptions?state=open with the STORED bearer token', async () => {
    signIn();
    await handleInterruptions([], { json: true });
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('GET');
    const url = new URL(received[0].url, relayUrl);
    expect(url.pathname).toBe('/v1/interruptions');
    expect(url.searchParams.get('state')).toBe('open');
    expect(received[0].authorization).toBe('Bearer pdu_test_token');
  });

  test('derives status open / openCount / exit 1, re-filtering to open-state asks', async () => {
    signIn();
    // The relay payload carries NO `status` field and includes an already-
    // answered ask — everything asserted below is computed by the command.
    relayResponse = {
      status: 200,
      body: {
        code: 'OK',
        error: null,
        interruptions: [
          ask(),
          ask({ id: 'int_2', title: 'Approve prod deploy', urgency: 'normal' }),
          ask({ id: 'int_3', title: 'Already handled', state: 'answered' }),
        ],
      },
    };
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('open');
    expect(out.openCount).toBe(2);
    expect(out.interruptions.map((i) => i.id)).toEqual(['int_1', 'int_2']); // answered ask filtered OUT
    expect(out.accountUrl).toBe(`${relayUrl}/account/interruptions`); // derived from stored relayUrl
    expect(process.exitCode).toBe(1);
  });

  test('zero open asks → status none, exit 0', async () => {
    signIn();
    relayResponse = { status: 200, body: { code: 'OK', error: null, interruptions: [] } };
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('none');
    expect(out.openCount).toBe(0);
    expect(process.exitCode).toBe(0);
  });

  test('an ask whose state is not open counts as none — filtering, not echoing', async () => {
    signIn();
    relayResponse = {
      status: 200,
      body: { code: 'OK', error: null, interruptions: [ask({ state: 'acked' })] },
    };
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('none');
    expect(out.openCount).toBe(0);
    expect(out.interruptions).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  test('relay HTTP 500 → status unknown with the code in the reason, exit 2 — never all-clear', async () => {
    signIn();
    relayResponse = { status: 500, body: { code: 'INTERNAL_ERROR', error: 'boom' } };
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('unknown');
    expect(out.status).not.toBe('none');
    expect(out.reason).toContain('500');
    expect(process.exitCode).toBe(2);
  });

  test('revoked token (401) → status unknown telling the operator to re-login, exit 2', async () => {
    signIn();
    relayResponse = { status: 401, body: { code: 'UNAUTHORIZED', error: 'revoked' } };
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('unknown');
    expect(out.reason).toContain('pd account login');
    expect(process.exitCode).toBe(2);
  });

  test('a 200 with no interruptions array is a FAILED poll (unknown, exit 2), not an empty one', async () => {
    signIn();
    relayResponse = { status: 200, body: { code: 'OK', error: null } };
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('unknown');
    expect(out.reason).toContain('no interruptions array');
    expect(process.exitCode).toBe(2);
  });

  test('unknown subcommand → error path, exit 2, no poll issued', async () => {
    signIn();
    await handleInterruptions(['ack'], { json: true });
    expect(process.exitCode).toBe(2);
    expect(received).toEqual([]); // refused before any wire traffic
  });
});
