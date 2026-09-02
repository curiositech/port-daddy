import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import * as actualChildProcess from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createTestDb } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createSugar } from '../../lib/sugar.js';
import { createActivityLog } from '../../lib/activity.js';
import type { ManagedSessionLifecycle, SpawnSpec } from '../../lib/spawner.js';
import type { ManagedSpawnWorktree } from '../../lib/managed-spawn-worktree.js';

let fixture: string;
let main: string;
let a: string;
let b: string;
let plain: string;
// ~/coding is itself a Git repo on the development machine. Model a separate
// filesystem boundary for this test fixture using Git's ceiling option. Every
// probe still runs real Git; production neither receives nor trusts this seam.
jest.unstable_mockModule('node:child_process', () => ({
  ...actualChildProcess,
  execFile: (file: string, args: string[], options: Record<string, any>, callback: any) => actualChildProcess.execFile(
    file, args, { ...options, env: { ...options.env, GIT_CEILING_DIRECTORIES: fixture } }, callback,
  ),
}));
const { captureManagedSpawnWorktree, managedSpawnWorktreeReceipt, verifyManagedSpawnWorktree } = await import('../../lib/managed-spawn-worktree.js');
const { createSpawner } = await import('../../lib/spawner.js');
const signal = () => new AbortController().signal;
const originalFetch = global.fetch;
const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'pd-spawn-world-'));
  main = join(fixture, 'repo'); a = join(fixture, 'a'); b = join(fixture, 'b'); plain = join(fixture, 'plain');
  mkdirSync(main); mkdirSync(plain);
  git(main, 'init', '-b', 'main');
  git(main, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
  git(main, 'worktree', 'add', '-b', 'a', a);
  git(main, 'worktree', 'add', '-b', 'b', b);
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }), text: async () => 'OK' })) as unknown as typeof fetch;
});
afterAll(() => { global.fetch = originalFetch; rmSync(fixture, { recursive: true, force: true }); });

function storedSession(target: ManagedSpawnWorktree) {
  return { worktreeId: target.worktree?.id ?? null, metadata: { worktree: target.worktree, spawnWorkdir: target.directory } };
}

describe('physical spawn world witness', () => {
  test('derives distinct real linked A/B worlds while the daemon is outside both', async () => {
    const [left, right] = await Promise.all([captureManagedSpawnWorktree(a, signal()), captureManagedSpawnWorktree(b, signal())]);
    expect(process.cwd()).not.toBe(a); expect(process.cwd()).not.toBe(b);
    expect(left.worktree).toMatchObject({ id: createHash('sha256').update(a).digest('hex').slice(0, 8), root: a, branch: 'a', isMain: false });
    expect(right.worktree?.id).not.toBe(left.worktree?.id);
    expect(left.commonDir).toEqual(right.commonDir);
    expect(left.gitDir).not.toEqual(right.gitDir);
    await expect(verifyManagedSpawnWorktree(left, () => storedSession(left), signal())).resolves.toBeUndefined();
    await expect(verifyManagedSpawnWorktree(left, () => storedSession(right), signal())).rejects.toThrow('worktree');
  });

  test('uses the containing Git root for a subdirectory, and canonicalizes a symlink', async () => {
    const subdir = join(a, 'src'); mkdirSync(subdir);
    const alias = join(fixture, 'alias'); symlinkSync(subdir, alias);
    const target = await captureManagedSpawnWorktree(alias, signal());
    expect(target.directory?.canonicalPath).toBe(subdir);
    expect(target.worktree?.root).toBe(a);
  });

  test('ignores inherited Git selectors rather than adopting an unrelated repository', async () => {
    const old = process.env.GIT_DIR;
    process.env.GIT_DIR = join(main, '.git');
    try { expect((await captureManagedSpawnWorktree(a, signal())).worktree?.root).toBe(a); }
    finally { if (old === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = old; }
  });

  test('preserves explicit non-Git and remote projectless targets without a Git identity', async () => {
    const nonGit = await captureManagedSpawnWorktree(plain, signal());
    expect(nonGit.directory?.canonicalPath).toBe(plain);
    expect(nonGit.worktree).toBeNull();
    const remote = await captureManagedSpawnWorktree(undefined, signal());
    expect(managedSpawnWorktreeReceipt(remote)).toEqual({ cwd: null, root: null, worktreeId: null });
    await expect(verifyManagedSpawnWorktree(remote, () => storedSession(remote), signal())).resolves.toBeUndefined();
  });

  test.each(['relative/path', '', '/not-a-real-pd-spawn-directory'])('refuses invalid explicit path %s', async (path) => {
    await expect(captureManagedSpawnWorktree(path, signal())).rejects.toThrow('absolute directory');
  });

  test('does not interpret a malformed Git worktree as a projectless directory', async () => {
    const broken = join(fixture, 'broken'); mkdirSync(broken);
    writeFileSync(join(broken, '.git'), 'gitdir: /not-a-real-pd-gitdir\n');
    await expect(captureManagedSpawnWorktree(broken, signal())).rejects.toThrow('Git identity');
  });

  test('detects same-path directory replacement', async () => {
    const path = join(fixture, 'replace'); mkdirSync(path);
    const target = await captureManagedSpawnWorktree(path, signal());
    renameSync(path, path + '-old'); mkdirSync(path);
    await expect(verifyManagedSpawnWorktree(target, () => storedSession(target), signal())).rejects.toThrow('changed');
  });

  test('detects Git identity changes without replacing the physical directory', async () => {
    const path = join(fixture, 'becomes-git'); mkdirSync(path);
    const target = await captureManagedSpawnWorktree(path, signal());
    git(path, 'init', '-b', 'new-world');
    git(path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'new');
    await expect(verifyManagedSpawnWorktree(target, () => storedSession(target), signal())).rejects.toThrow('changed');
  });

  test('checks current stored state after asynchronous physical validation and honors cancellation', async () => {
    const target = await captureManagedSpawnWorktree(a, signal());
    const getter = jest.fn(() => ({ ...storedSession(target), worktreeId: 'wrong-world' }));
    await expect(verifyManagedSpawnWorktree(target, getter, signal())).rejects.toThrow('worktree');
    expect(getter).toHaveBeenCalledTimes(1);
    const abort = new AbortController(); abort.abort();
    await expect(captureManagedSpawnWorktree(a, abort.signal)).rejects.toThrow();
  });
});

// Exercise the actual Sugar/SQLite session store alongside the shared private
// physical verifier. Provider runners are stubs: no real model spend or tools.
function managedHarness() {
  const db = createTestDb(); const agents = createAgents(db); const sessions = createSessions(db);
  const sugar = createSugar({ agents, sessions, activityLog: createActivityLog(db) });
  const targets = new Map<string, ManagedSpawnWorktree>();
  const admitted: string[] = [];
  const lifecycle: ManagedSessionLifecycle = {
    admit: async (input, { signal }) => {
      const target = await captureManagedSpawnWorktree(input.workdir, signal);
      const result = sugar.begin({ ...input, identity: input.identity ?? undefined, worktree: target.worktree,
        metadata: { identity: { verified: true, actorId: input.agentId }, worktree: target.worktree, spawnWorkdir: target.directory } });
      if (!result.success) return result;
      const id = result.sessionId as string; admitted.push(id); targets.set(id, target);
      return { ...result, credential: 'fixture-credential', worktreeBinding: managedSpawnWorktreeReceipt(target) };
    },
    bind: async (input, { signal }) => {
      const target = targets.get(input.sessionId)!;
      await verifyManagedSpawnWorktree(target, () => sessions.get(input.sessionId).session as Record<string, unknown>, signal);
      return { ...sugar.bindManagedSession({ ...input, actorId: input.agentId }), worktreeBinding: managedSpawnWorktreeReceipt(target) };
    },
    complete: async (input) => sugar.completeManagedSession({ ...input, actorId: input.agentId }),
    abort: async (input) => sugar.abortManagedSession({ ...input, actorId: input.agentId }),
  };
  return { db, sessions, sugar, targets, admitted, lifecycle };
}
function spawner(harness: ReturnType<typeof managedHarness>, backend: SpawnSpec['backend'], runner: (spec: SpawnSpec) => Promise<{ output: string; error: string | null }>) {
  return createSpawner({ managedSessionLifecycle: harness.lifecycle, enforceTranscriptPolicy: false,
    enforceTelemetryPolicy: false, telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'fixture', reason: 'No real backend is executed by these unit tests' },
    runnerOverrides: { [backend]: runner } });
}

describe('managed provider admission', () => {
  test.each(['cli:codex', 'cli:claude-code', 'cli:agy', 'cli:gemini', 'claude', 'openai', 'cloudflare'] as const)(
    '%s receives exact physical cwd and matching SQLite session world', async (backend) => {
      const h = managedHarness(); const runner = jest.fn(async (spec: SpawnSpec) => ({ output: spec.workdir!, error: null }));
      try {
        const result = await spawner(h, backend, runner).spawn({ backend, task: 'fixture', workdir: a });
        expect(result.status).toBe('completed');
        expect(runner).toHaveBeenCalledTimes(1);
        expect(runner.mock.calls[0][0].workdir).toBe(a);
        const session = h.sessions.get(h.admitted[0]).session!;
        expect(session.worktreeId).toBe(createHash('sha256').update(a).digest('hex').slice(0, 8));
        expect(session.status).toBe('completed');
      } finally { h.db.close(); }
    });

  test('concurrent A/B admission does not share worlds, exact terminal IDs, or caller mutations', async () => {
    const h = managedHarness();
    const runner = jest.fn(async (spec: SpawnSpec) => ({ output: spec.workdir!, error: null }));
    const s = spawner(h, 'ollama', runner);
    const mutable: SpawnSpec = { backend: 'ollama', task: 'A', workdir: a };
    try {
      const pendingA = s.spawn(mutable); mutable.workdir = b;
      const [left, right] = await Promise.all([pendingA, s.spawn({ backend: 'ollama', task: 'B', workdir: b })]);
      expect([left.output, right.output]).toEqual([a, b]);
      expect(h.admitted).toHaveLength(2);
      const rows = h.admitted.map(id => h.sessions.get(id).session!);
      expect(new Set(rows.map(row => row.worktreeId)).size).toBe(2);
      expect(rows.every(row => row.status === 'completed')).toBe(true);
    } finally { h.db.close(); }
  });

  test('explicit null never inherits daemon world, and does not acquire unrelated claims', async () => {
    const h = managedHarness();
    try {
      const ordinary = h.sessions.start('ordinary omitted world');
      const plainSession = h.sessions.start('explicit null world', { worktreeId: null });
      expect(h.sessions.get(ordinary.id!).session?.worktreeId).not.toBeNull();
      expect(h.sessions.get(plainSession.id!).session?.worktreeId).toBeNull();
      const held = h.sessions.start('held elsewhere', { project: 'elsewhere', worktreeId: 'other', files: ['private.ts'] });
      const result = await spawner(h, 'ollama', async () => ({ output: 'projectless', error: null })).spawn({ backend: 'ollama', task: 'no filesystem' });
      expect(result.status).toBe('completed');
      const own = h.sessions.get(h.admitted[0]);
      expect(own.session?.worktreeId).toBeNull(); expect(own.files).toEqual([]);
      expect(h.sessions.get(held.id!).files).toHaveLength(1);
    } finally { h.db.close(); }
  });

  test.each(['cli:codex', 'cli:claude-code', 'cli:agy', 'cli:gemini', 'custom'] as const)('%s cannot inherit daemon cwd', async (backend) => {
    const h = managedHarness(); const runner = jest.fn(async () => ({ output: 'must not run', error: null }));
    try {
      const result = await spawner(h, backend, runner).spawn({ backend, task: 'missing target' });
      expect(result.status).toBe('failed'); expect(result.error).toContain('explicit workdir');
      expect(h.admitted).toEqual([]); expect(runner).not.toHaveBeenCalled();
    } finally { h.db.close(); }
  });

  test('stored wrong world refuses backend and abandons only the exact admitted session', async () => {
    const h = managedHarness(); const original = h.lifecycle.admit;
    h.lifecycle.admit = async (input, options) => {
      const result = await original(input, options);
      h.db.prepare('UPDATE sessions SET worktree_id = ? WHERE id = ?').run('wrong-world', result.sessionId);
      return result;
    };
    const runner = jest.fn(async () => ({ output: 'must not run', error: null }));
    try {
      const unrelated = h.sessions.start('unrelated', { worktreeId: 'untouched' });
      const result = await spawner(h, 'ollama', runner).spawn({ backend: 'ollama', task: 'mismatch', workdir: a });
      expect(result.status).toBe('failed'); expect(result.error).toContain('worktree'); expect(runner).not.toHaveBeenCalled();
      expect(h.sessions.get(h.admitted[0]).session?.status).toBe('abandoned');
      expect(h.sessions.get(unrelated.id!).session?.status).toBe('active');
    } finally { h.db.close(); }
  });

  test('production private lifecycle derives and verifies the target, not supplied world IDs', () => {
    const source = readFileSync(resolve('server.ts'), 'utf8');
    expect(source).toContain('captureManagedSpawnWorktree(input.workdir, signal)');
    expect(source).toContain('worktree: target.worktree');
    expect(source).toContain('verifyManagedSpawnWorktree(target, () =>');
    expect(source).toContain('const currentAuthority = authorizeManagedSpawnerSession(input)');
  });
});
