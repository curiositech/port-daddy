/**
 * Unit tests for the pd add wrapper's path-filter logic.
 *
 * The wrapper's job is to call `git add` only on paths that aren't claimed by
 * other sessions. The actual git invocation runs against a temp repo; the
 * daemon is mocked at the pdFetch boundary via jest.unstable_mockModule.
 */
import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CONTEXT_ENV_KEYS = [
  'PORT_DADDY_CONTEXT_DIR',
  'PORT_DADDY_CONTEXT_SLOT',
  'CODEX_THREAD_ID',
  'TERM_SESSION_ID',
];

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-add-test-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'a');
  spawnSync('git', ['add', 'a.txt'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'a-modified');
  writeFileSync(join(dir, 'b.txt'), 'b');
  return dir;
}

async function loadAddWithMock(ownersByPath) {
  jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
    PORT_DADDY_URL: 'http://localhost:9999',
    // guard.js (imported transitively via cli/commands/add.js) imports
    // isDaemonRunning from fetch.js; the mock must export it or the ESM link
    // fails ("does not provide an export named 'isDaemonRunning'"). Reads in
    // these tests go through pdFetch, so a reachable-daemon stub is inert here.
    isDaemonRunning: jest.fn(async () => true),
    pdFetch: jest.fn(async (url) => {
      const u = String(url);
      const match = u.match(/path=([^&]+)/);
      const path = match ? decodeURIComponent(match[1]) : '';
      let owners = [];
      for (const [key, val] of Object.entries(ownersByPath)) {
        if (path === key || path.endsWith('/' + key)) {
          owners = val;
          break;
        }
      }
      return { ok: true, status: 200, headers: {}, json: async () => ({ owners }), text: async () => '{}' };
    }),
  }));
  // eslint-disable-next-line no-shadow
  const { handleAdd } = await import('../../cli/commands/add.js');
  return handleAdd;
}

function captureStdout(fn) {
  return async () => {
    let out = '';
    const orig = console.log;
    console.log = (msg) => { out += String(msg) + '\n'; };
    try {
      await fn();
    } finally {
      console.log = orig;
    }
    return out.trim();
  };
}

describe('pd add wrapper', () => {
  let dir;
  let savedContextEnv;

  beforeEach(() => {
    jest.resetModules();
    savedContextEnv = Object.fromEntries(CONTEXT_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of CONTEXT_ENV_KEYS) delete process.env[key];
    dir = makeRepo();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const key of CONTEXT_ENV_KEYS) {
      if (savedContextEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedContextEnv[key];
    }
  });

  test('expands -A into the universe of modified + untracked paths and stages all when nothing is claimed', async () => {
    const handleAdd = await loadAddWithMock({});
    const out = await captureStdout(() => handleAdd([], { A: true, 'dry-run': true, dir, json: true }))();
    const payload = JSON.parse(out);
    expect(payload.success).toBe(true);
    expect(payload.staged).toEqual(expect.arrayContaining(['a.txt', 'b.txt']));
    expect(payload.blocked).toEqual([]);
  });

  test('blocks paths owned by another session', async () => {
    const handleAdd = await loadAddWithMock({
      'a.txt': [{
        sessionId: 'session-other',
        agentId: 'agent-other',
        purpose: 'fixing a.txt',
      }],
    });
    const out = await captureStdout(() => handleAdd(['a.txt', 'b.txt'], { 'dry-run': true, dir, json: true }))();
    const payload = JSON.parse(out);
    expect(payload.staged).toEqual(['b.txt']);
    expect(payload.blocked).toEqual([
      expect.objectContaining({
        path: 'a.txt',
        owners: [expect.objectContaining({ sessionId: 'session-other' })],
      }),
    ]);
  });

  test('lets the caller stage their own claimed files', async () => {
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    writeFileSync(join(dir, '.portdaddy', 'current.json'), JSON.stringify({
      sessionId: 'session-self',
      agentId: 'agent-self',
    }));
    const handleAdd = await loadAddWithMock({
      'a.txt': [{ sessionId: 'session-self', agentId: 'agent-self' }],
    });
    const out = await captureStdout(() => handleAdd(['a.txt'], { 'dry-run': true, dir, json: true }))();
    const payload = JSON.parse(out);
    expect(payload.staged).toEqual(['a.txt']);
    expect(payload.blocked).toEqual([]);
  });

  test('--force still records what was overridden in the JSON audit trail', async () => {
    const handleAdd = await loadAddWithMock({
      'a.txt': [{ sessionId: 'session-other', agentId: 'agent-other' }],
    });
    const out = await captureStdout(() => handleAdd(['a.txt'], { 'dry-run': true, force: true, dir, json: true }))();
    const payload = JSON.parse(out);
    expect(payload.force).toBe(true);
    expect(payload.blocked).toHaveLength(1);
  });
});
