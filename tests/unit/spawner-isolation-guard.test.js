/**
 * Spawner Isolation Guard — layer-2 worktree enforcement.
 *
 * WHY: On 2026-06-03 parallel agents dispatched into the SAME main checkout
 * steamrolled each other — 403 files were deleted in the port-daddy working
 * tree. The harness PreToolUse hook (~/.claude/hooks/enforce-agent-isolation.sh)
 * stops harness Agent dispatches; this guard is the spawner-side twin: the
 * daemon refuses to launch a file-writing agent whose workdir is a repo's
 * MAIN checkout (where `.git` is a directory) unless it explicitly opts in
 * (working-tree observers like the gardener) or the operator bypasses.
 *
 * A git WORKTREE has `.git` as a FILE (a gitdir pointer); a main checkout has
 * `.git` as a DIRECTORY. That is the deterministic signal — no shelling to git.
 */

import { jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import * as actualFs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';

// These are deliberately synthetic filesystem fixtures, not real Git clones.
// An unrelated parent repo (for example ~/coding/.git) must not change their
// semantics. Keep the production ancestor walk intact; bound only this mock.
let root, mainCheckout, worktree, nonRepo, mainSubdir;
jest.unstable_mockModule('node:fs', () => ({
  ...actualFs,
  existsSync: (path) => root && basename(String(path)) === '.git' && relative(root, String(path)).startsWith('..')
    ? false : actualFs.existsSync(path),
}));

// Mock child_process so a spawn that gets PAST the guard never launches a real
// process (and we can assert the guard short-circuits before any launch).
const mockChildProcess = {
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on: jest.fn(),
  kill: jest.fn(),
  pid: 12345,
};
jest.unstable_mockModule('node:child_process', () => ({
  spawn: jest.fn(() => mockChildProcess),
  execSync: jest.fn(),
  execFileSync: jest.fn(),
}));

const { spawn: cpSpawn } = await import('node:child_process');
const { createSpawner: createSpawnerBase, assessSpawnIsolation } = await import('../../lib/spawner.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'Isolation guard unit coverage',
};
function createSpawner(deps = {}) {
  return createSpawnerBase({
    ...deps,
    enforceTelemetryPolicy: false,
    enforceTranscriptPolicy: deps.enforceTranscriptPolicy ?? false,
    telemetryBypassApproval: deps.telemetryBypassApproval ?? TEST_TELEMETRY_BYPASS,
  });
}

// This file tests the isolation guard itself, so it must run with the guard
// LIVE — undo the suite-wide PD_SPAWN_ISOLATION_OFF bypass set in tests/jest.env.js.
let __isoOffPrior;
beforeAll(() => {
  __isoOffPrior = process.env.PD_SPAWN_ISOLATION_OFF;
  delete process.env.PD_SPAWN_ISOLATION_OFF;
});
afterAll(() => {
  if (__isoOffPrior !== undefined) process.env.PD_SPAWN_ISOLATION_OFF = __isoOffPrior;
});

// --- fixtures: a main checkout, a worktree, a non-repo dir ------------------
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pd-iso-'));
  mainCheckout = join(root, 'main');
  mainSubdir = join(mainCheckout, 'lib', 'deep');
  worktree = join(root, 'wt');
  nonRepo = join(root, 'plain');
  mkdirSync(mainSubdir, { recursive: true });
  mkdirSync(join(mainCheckout, '.git'), { recursive: true }); // .git DIRECTORY → main checkout
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n'); // .git FILE → worktree
  mkdirSync(nonRepo, { recursive: true });

  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ success: true }), text: async () => 'OK',
  });
  cpSpawn.mockClear();
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('assessSpawnIsolation (pure policy)', () => {
  test('main checkout → blocked', () => {
    const r = assessSpawnIsolation({ workdir: mainCheckout }, {});
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/worktree/i);
  });

  test('subdirectory of a main checkout → blocked (walks up to find .git)', () => {
    expect(assessSpawnIsolation({ workdir: mainSubdir }, {}).blocked).toBe(true);
  });

  test('worktree (.git is a file) → not blocked', () => {
    expect(assessSpawnIsolation({ workdir: worktree }, {}).blocked).toBe(false);
  });

  test('non-repo directory → not blocked', () => {
    expect(assessSpawnIsolation({ workdir: nonRepo }, {}).blocked).toBe(false);
  });

  test('main checkout + allowSharedCheckout opt-in → not blocked', () => {
    expect(assessSpawnIsolation({ workdir: mainCheckout, allowSharedCheckout: true }, {}).blocked).toBe(false);
  });

  test('main checkout + PD_SPAWN_ISOLATION_OFF=1 → not blocked', () => {
    expect(assessSpawnIsolation({ workdir: mainCheckout }, { PD_SPAWN_ISOLATION_OFF: '1' }).blocked).toBe(false);
  });

  test('reason names the fix (worktree) but NOT the bypass env var', () => {
    const r = assessSpawnIsolation({ workdir: mainCheckout }, {});
    expect(r.reason).toMatch(/worktree/i);
    expect(r.reason).not.toMatch(/PD_SPAWN_ISOLATION_OFF/);
  });
});

describe('spawn() wiring', () => {
  test('refuses a file-writing spawn into a main checkout, before any launch', async () => {
    const spawner = createSpawner();
    const res = await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: mainCheckout });
    expect(res.status).toBe('failed');
    expect(res.agentId).toBe('blocked');
    expect(res.error).toMatch(/worktree/i);
    expect(cpSpawn).not.toHaveBeenCalled(); // short-circuited before launch
  });
});
