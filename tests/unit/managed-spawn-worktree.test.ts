import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import * as actualChildProcess from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createTestDb } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createSugar } from '../../lib/sugar.js';
import { createActivityLog } from '../../lib/activity.js';
import type { ManagedSessionLifecycle, SpawnSpec } from '../../lib/spawner.js';
import type { ManagedSpawnWorktree } from '../../lib/managed-spawn-worktree.js';
import * as actualCliBinDirs from '../../lib/cli-bin-dirs.js';

let fixture: string;
let main: string;
let a: string;
let b: string;
let plain: string;
let duringSandboxPreparation: () => void = () => {};
const childSpawn = jest.fn(() => { throw new Error('Refused managed launch reached child_process.spawn'); });
const sandboxDispose = jest.fn();
// ~/coding is itself a Git repo on the development machine. Model a separate
// filesystem boundary for this test fixture using Git's ceiling option. Every
// probe still runs real Git; production neither receives nor trusts this seam.
jest.unstable_mockModule('node:child_process', () => ({
  ...actualChildProcess,
  spawn: childSpawn,
  execFile: (file: string, args: string[], options: Record<string, any>, callback: any) => actualChildProcess.execFile(
    file, args, { ...options, env: { ...options.env, GIT_CEILING_DIRECTORIES: fixture } }, callback,
  ),
}));
jest.unstable_mockModule('../../lib/cli-bin-dirs.js', () => ({
  ...actualCliBinDirs,
  resolveCliBinary: () => ({ found: true, command: '/synthetic-cli-never-launched' }),
}));
jest.unstable_mockModule('../../lib/spawner/coast-guard-runner.js', () => ({
  withCoastGuard: async (input: any) => {
    await Promise.resolve();
    duringSandboxPreparation();
    return { cmd: input.cmd, args: input.args, env: input.env, receipt: () => ({ confined: false }), dispose: sandboxDispose };
  },
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
  const scratchParent = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratchParent, { recursive: true });
  fixture = mkdtempSync(join(scratchParent, 'pd-spawn-world-'));
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
  return { status: 'active', worktreeId: target.worktree?.id ?? null, metadata: { worktree: target.worktree, spawnWorkdir: target.directory } };
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

  test('supports an unborn repository and a detached linked worktree', async () => {
    const unborn = join(fixture, 'unborn'); mkdirSync(unborn); git(unborn, 'init', '-b', 'starting');
    expect((await captureManagedSpawnWorktree(unborn, signal())).worktree).toMatchObject({ branch: 'starting', isMain: true });
    const detached = join(fixture, 'detached'); git(main, 'worktree', 'add', '--detach', detached);
    expect((await captureManagedSpawnWorktree(detached, signal())).worktree).toMatchObject({ branch: null, isMain: false });
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
    const duringProbe = new AbortController();
    const pending = captureManagedSpawnWorktree(a, duringProbe.signal);
    duringProbe.abort();
    await expect(pending).rejects.toThrow();
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
      return {
        ...sugar.bindManagedSession({ ...input, actorId: input.agentId }),
        worktreeBinding: managedSpawnWorktreeReceipt(target),
        validateBeforeLaunch: async ({ signal: launchSignal }: { signal: AbortSignal }) => {
          await verifyManagedSpawnWorktree(target, () => sessions.get(input.sessionId).session as Record<string, unknown>, launchSignal);
          return { success: true };
        },
      };
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
    const runner = jest.fn(async (spec: SpawnSpec) => ({
      output: execFileSync(process.execPath, ['-p', 'process.cwd()'], { cwd: spec.workdir, encoding: 'utf8' }).trim(),
      error: null,
    }));
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

  test('a projectless API call stays projectless when the daemon cwd is a main checkout', async () => {
    const originalCwd = process.cwd(); const priorIsolation = process.env.PD_SPAWN_ISOLATION_OFF;
    const h = managedHarness();
    try {
      process.chdir(main); delete process.env.PD_SPAWN_ISOLATION_OFF;
      const result = await spawner(h, 'ollama', async () => ({ output: 'no filesystem target', error: null })).spawn({ backend: 'ollama', task: 'remote only' });
      expect(result.status).toBe('completed');
      expect(h.sessions.get(h.admitted[0]).session?.worktreeId).toBeNull();
    } finally {
      process.chdir(originalCwd);
      if (priorIsolation === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF; else process.env.PD_SPAWN_ISOLATION_OFF = priorIsolation;
      h.db.close();
    }
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

  test('same-path replacement after admission prevents every backend and exact admission is abandoned', async () => {
    const h = managedHarness(); const original = h.lifecycle.admit;
    const path = join(fixture, 'replace-after-admit'); mkdirSync(path);
    h.lifecycle.admit = async (input, options) => {
      const result = await original(input, options);
      renameSync(path, path + '-old'); mkdirSync(path);
      return result;
    };
    const runner = jest.fn(async () => ({ output: 'must not run', error: null }));
    try {
      const result = await spawner(h, 'ollama', runner).spawn({ backend: 'ollama', task: 'replacement', workdir: path });
      expect(result.status).toBe('failed'); expect(result.error).toContain('changed'); expect(runner).not.toHaveBeenCalled();
      expect(h.sessions.get(h.admitted[0]).session?.status).toBe('abandoned');
    } finally { h.db.close(); }
  });

  test('kill during real Git verification cannot mint a late session or start a backend', async () => {
    const h = managedHarness(); const original = h.lifecycle.admit;
    let entered!: () => void; const admissionStarted = new Promise<void>(accept => { entered = accept; });
    h.lifecycle.admit = (input, options) => { entered(); return original(input, options); };
    const runner = jest.fn(async () => ({ output: 'must not run', error: null }));
    const s = spawner(h, 'ollama', runner);
    try {
      const pending = s.spawn({ backend: 'ollama', task: 'cancel during physical proof', workdir: a });
      await admissionStarted;
      s.kill(s.list()[0].agentId);
      const result = await pending;
      expect(result.status).toBe('killed'); expect(h.admitted).toEqual([]); expect(runner).not.toHaveBeenCalled();
    } finally { h.db.close(); }
  });

  test('malformed admission or binding receipts fail before backend execution', async () => {
    for (const boundary of ['admit', 'bind'] as const) {
      const h = managedHarness(); const original = h.lifecycle[boundary];
      h.lifecycle[boundary] = async (input: any, options: any) => {
        const result = await (original as any)(input, options);
        return { ...result, worktreeBinding: { cwd: '/wrong-target', root: null, worktreeId: null } };
      };
      const runner = jest.fn(async () => ({ output: 'must not run', error: null }));
      try {
        const result = await spawner(h, 'ollama', runner).spawn({ backend: 'ollama', task: 'bad receipt', workdir: a });
        expect(result.status).toBe('failed'); expect(result.error).toContain('receipt'); expect(runner).not.toHaveBeenCalled();
        expect(h.sessions.get(h.admitted[0]).session?.status).toBe('abandoned');
      } finally { h.db.close(); }
    }
  });

  test.each(['custom', 'cli:codex', 'cli:agy'] as const)('%s refuses Git-world replacement after sandbox setup without forking', async backend => {
    for (const change of ['git-pointer', 'non-git-becomes-git'] as const) {
      const h = managedHarness();
      const target = join(fixture, `${backend.replace(':', '-')}-${change}`);
      if (change === 'git-pointer') git(main, 'worktree', 'add', '-b', `race-${backend.replace(':', '-')}`, target);
      else mkdirSync(target);
      const s = createSpawner({ managedSessionLifecycle: h.lifecycle, enforceTranscriptPolicy: false,
        enforceTelemetryPolicy: false, telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'fixture', reason: 'No actual child is launched in a refused-workspace test' } });
      childSpawn.mockClear(); sandboxDispose.mockClear();
      duringSandboxPreparation = () => {
        if (change === 'git-pointer') writeFileSync(join(target, '.git'), readFileSync(join(b, '.git')));
        else git(target, 'init', '-b', 'new-world');
      };
      try {
        const result = await s.spawn({ backend, task: 'must not run', workdir: target });
        expect(result.status).toBe('failed');
        expect(result.error).toMatch(/target changed|outside its reported Git worktree/);
        expect(childSpawn).not.toHaveBeenCalled();
        expect(sandboxDispose).toHaveBeenCalledTimes(1);
        expect(h.sessions.get(h.admitted[0]).session?.status).toBe('abandoned');
      } finally { duringSandboxPreparation = () => {}; h.db.close(); }
    }
  });

  test('a completed exact session cannot pass the private launch validator', async () => {
    const target = await captureManagedSpawnWorktree(a, signal());
    await expect(verifyManagedSpawnWorktree(target, () => ({ ...storedSession(target), status: 'completed' }), signal()))
      .rejects.toThrow('no longer active');
  });

  test('production private lifecycle derives and verifies the target, not supplied world IDs', () => {
    const source = readFileSync(resolve('server.ts'), 'utf8');
    expect(source).toContain('captureManagedSpawnWorktree(input.workdir, signal)');
    expect(source).toContain('worktree: target.worktree');
    expect(source).toContain('verifyManagedSpawnWorktree(target, () =>');
    expect(source).toContain('const currentAuthority = authorizeManagedSpawnerSession(input)');
  });
});
