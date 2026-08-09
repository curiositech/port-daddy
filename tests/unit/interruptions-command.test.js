/**
 * `pd interruptions` end-to-end through handleInterruptions: the JSON script
 * surface and process.exitCode against a stubbed relay, with PD_HOME pinned
 * to a temp dir BEFORE the module graph loads (shared/paths.js reads it at
 * import time).
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
  let openAsks;
  let logSpy;
  const originalExitCode = process.exitCode;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/v1/interruptions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'OK', error: null, openCount: openAsks.length, interruptions: openAsks }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    relayUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  beforeEach(() => {
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

  test('not signed in → status unknown, exit 2, never all-clear', async () => {
    rmSync(join(FAKE_HOME, 'account.json'), { force: true });
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('unknown');
    expect(out.reason).toContain('pd account login');
    expect(process.exitCode).toBe(2);
  });

  test('open critical ask → status open, exit 1', async () => {
    signIn();
    openAsks = [{
      id: 'int_1',
      title: 'Sandbox missing for fail-closed run',
      urgency: 'critical',
      state: 'open',
      sourceAgent: 'purser-qa',
      createdAt: Math.floor(Date.now() / 1000) - 120,
    }];
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('open');
    expect(out.openCount).toBe(1);
    expect(out.interruptions[0].title).toBe('Sandbox missing for fail-closed run');
    expect(out.accountUrl).toBe(`${relayUrl}/account/interruptions`);
    expect(process.exitCode).toBe(1);
  });

  test('zero open asks → status none, exit 0', async () => {
    signIn();
    openAsks = [];
    await handleInterruptions([], { json: true });
    const out = lastJson();
    expect(out.status).toBe('none');
    expect(out.openCount).toBe(0);
    expect(process.exitCode).toBe(0);
  });
});
