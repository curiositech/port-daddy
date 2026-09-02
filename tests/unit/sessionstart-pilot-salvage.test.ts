import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const fixtureParent = join(homedir(), 'coding', 'tmp');
const script = join(process.cwd(), 'hooks', 'sessionstart-pilot.mjs');
const preload = pathToFileURL(join(process.cwd(), 'tests', 'helpers', 'sessionstart-salvage-fixture.mjs')).href;
const endpoint = 'http://salvage-fixture.invalid';
let root: string;
let project: string;

type Mode = 'two' | 'full-page' | 'reject' | 'http-error' | 'invalid-json' | 'empty' | 'abort';
type Diagnostics = {
  requests: string[];
  deadlines: number[];
  clears: number;
  aborts: number;
  violations: string[];
  envKeys: string[];
};

// Do not inherit PD_URL (which wins over PORT_DADDY_URL), identity, relay
// credentials, or NODE_OPTIONS/NODE_PATH that can run code before the preloader.
// Keep only platform necessities; never modify the parent's environment.
function childEnvironment(inherited: NodeJS.ProcessEnv, mode: Mode): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  return { ...env, PORT_DADDY_URL: endpoint, SALVAGE_FIXTURE_MODE: mode };
}

function runHook(mode: Mode, inherited = process.env, probe = false): Promise<{
  status: number | null; stdout: string; stderr: string; diagnostics: Diagnostics;
}> {
  return new Promise((resolveRun, rejectRun) => {
    const env = childEnvironment(inherited, mode);
    if (probe) env.SALVAGE_FIXTURE_PROBE = '1';
    const child = spawn(process.execPath, ['--import', preload, script], {
      cwd: project, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let diagnostics = '';
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error('Isolated salvage hook child exceeded its 8 second test bound'));
    }, 8000);
    child.stdout!.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr!.on('data', (chunk) => { stderr += String(chunk); });
    (child.stdio[3] as Readable).on('data', (chunk) => { diagnostics += String(chunk); });
    child.once('error', (error) => { clearTimeout(watchdog); rejectRun(error); });
    child.once('close', (status) => {
      clearTimeout(watchdog);
      try { resolveRun({ status, stdout, stderr, diagnostics: JSON.parse(diagnostics) }); }
      catch (error) { rejectRun(error); }
    });
    child.stdin!.end(JSON.stringify({ cwd: project }));
  });
}

beforeEach(() => {
  mkdirSync(fixtureParent, { recursive: true });
  root = mkdtempSync(join(fixtureParent, 'pilot-salvage-'));
  project = join(root, 'salvage-fixture');
  mkdirSync(join(project, '.portdaddy'), { recursive: true });
});
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function verifyTransport(result: Awaited<ReturnType<typeof runHook>>): string {
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.diagnostics.requests).toEqual([`${endpoint}/salvage?project=salvage-fixture&limit=20`]);
  expect(result.diagnostics.violations).toEqual([]);
  // Assert the production budget without racing a real HTTP round trip against it.
  expect(result.diagnostics.deadlines).toEqual([500]);
  expect(result.diagnostics.clears).toBe(1);
  const ctx = JSON.parse(result.stdout).hookSpecificOutput.additionalContext as string;
  expect(ctx).toContain('Port Daddy Pilot');
  return ctx;
}

describe('SessionStart Pilot salvage nudge', () => {
  test('appends a project-scoped salvage count while preserving base steering', async () => {
    const ctx = verifyTransport(await runHook('two'));
    expect(ctx).toContain('SALVAGE: 2 interrupted agent run(s)');
    expect(ctx).toContain('pd salvage --project salvage-fixture');
  });

  test('daemon failure degrades to base steering instead of failing SessionStart', async () => {
    expect(verifyTransport(await runHook('reject'))).not.toContain('SALVAGE:');
  });

  test('caps a full salvage page at 20+', async () => {
    expect(verifyTransport(await runHook('full-page'))).toContain('SALVAGE: 20+');
  });

  test.each<Mode>(['http-error', 'invalid-json', 'empty'])('%s preserves base steering', async (mode) => {
    expect(verifyTransport(await runHook(mode))).not.toContain('SALVAGE:');
  });

  test('the existing 500ms deadline aborts a pending request and keeps base steering', async () => {
    const result = await runHook('abort');
    expect(verifyTransport(result)).not.toContain('SALVAGE:');
    expect(result.diagnostics.aborts).toBe(1);
  });

  test('hostile inherited authority, transport, and preload settings cannot reach the child', async () => {
    const inherited = {
      ...process.env,
      PD_URL: 'http://127.0.0.1:9876',
      PORT_DADDY_URL: 'https://relay.invalid',
      PORT_DADDY_SOCKET: join(root, 'must-not-connect.sock'),
      PD_SESSION_ID: 'host-session-must-not-leak',
      PD_AGENT_ID: 'host-agent-must-not-leak',
      PD_ACTOR_CREDENTIAL: 'synthetic-secret-must-not-leak',
      PORT_DADDY_CONTEXT_SLOT: 'host-context-must-not-leak',
      PD_RELAY_URL: 'https://relay.invalid',
      GITHUB_TOKEN: 'synthetic-token-must-not-leak',
      PD_PILOT_DISABLE: '1',
      NODE_OPTIONS: '--require /preload-must-not-execute.cjs',
      NODE_PATH: '/module-path-must-not-be-inherited',
    };
    const result = await runHook('two', inherited);
    expect(verifyTransport(result)).toContain('SALVAGE: 2 interrupted agent run(s)');
    for (const key of Object.keys(inherited).filter((key) => /^(PD_|PORT_DADDY_|NODE_|GITHUB_TOKEN$)/.test(key))) {
      if (key !== 'PORT_DADDY_URL') expect(result.diagnostics.envKeys).not.toContain(key);
    }
    expect(inherited.PD_URL).toBe('http://127.0.0.1:9876');
  });

  test('the preimport fixture refuses TCP, Unix socket, and unexpected fetch without forwarding', async () => {
    const result = await runHook('two', process.env, true);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.diagnostics.violations).toEqual(['net.connect', 'Socket.connect', 'fetch.url']);
    expect(result.diagnostics.requests).toEqual([`${endpoint}/salvage?project=salvage-fixture&limit=20`]);
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain('SALVAGE: 2');
  });
});
