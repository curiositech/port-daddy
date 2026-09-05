import { test, expect, jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { planRunFor } from '../../lib/dispatch/runner.js';
import { createDispatchWorker } from '../../lib/dispatch/worker.js';
import { createConductorSpawnAdapter } from '../../lib/dispatch/conductor-adapter.js';
import { reapWorktree } from '../../lib/dispatch/worktree-cleanup.js';
import { gitWorktreeAdd, requireGitHubAppPublisher } from '../../lib/dispatch/conductor-lifecycle.js';
import { deriveWorktreePath } from '../../lib/dispatch/runner.js';

test.each(['cli:claude-code', 'cli:codex', 'cli:agy'])('%s plans contain semantic intent, no executable command/argv or fabricated wrapper', async backend => {
  const db = createTestDb();
  try {
    const queue = createDispatchQueue({ db });
    const proposed = queue.propose({ goal: 'bounded task', backend, projectDir: '/source/project' });
    const dispatch = queue.claim({ id: proposed.id, worktreePath: deriveWorktreePath(proposed.id), branch: 'dispatch/test', sessionId: 'fixture-session' });
    const plan = planRunFor(dispatch, { backend });
    expect(plan).toMatchObject({ executionIntent: 'autonomous', confinementRequired: true });
    expect(plan).not.toHaveProperty('command');
    expect(plan).not.toHaveProperty('args');
    expect(plan).not.toHaveProperty('coastGuard');
    expect(JSON.stringify(plan)).not.toContain('--dangerously');
    const launch = jest.fn(async () => ({ admitted: false, refusedReason: 'no actual confinement' }));
    const adapter = createConductorSpawnAdapter({ launch });
    const result = await adapter({ plan, queue });
    expect(result.state).toBe('failed');
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ executionIntent: 'autonomous', backend }));
  } finally { db.close(); }
});

test('worker has no default raw execution or publication transport', () => {
  const db = createTestDb();
  try { expect(() => createDispatchWorker({ queue: createDispatchQueue({ db }) })).toThrow(/Conductor-backed/); }
  finally { db.close(); }
});

test('cleanup refuses paths outside exact dispatch worktrees', async () => {
  await expect(reapWorktree('/Users/erichowens/coding', '/source/project', { expectedBranch: 'dispatch/test' })).rejects.toThrow(/Refusing cleanup/);
});

test('local worktree creation and cleanup are bound to source project, not daemon cwd', async () => {
  const target = deriveWorktreePath('local-lifecycle-test');
  const execFileFn = identityGit(target);
  await gitWorktreeAdd(target, 'dispatch/test', 'origin/main', { repoWorkdir: '/durable/project', existsFn: () => false, execFileFn });
  await reapWorktree(target, '/durable/project', { expectedBranch: 'dispatch/test', existsFn: () => true, execFileFn });
  for (const [cmd, args, opts] of execFileFn.mock.calls) {
    expect(cmd).toBe('git');
    expect(['/durable/project', target]).toContain(opts.cwd);
    expect(args).not.toContain('push');
    expect(args).not.toContain('--force');
  }
  expect(execFileFn).toHaveBeenLastCalledWith('git', ['worktree', 'remove', target], expect.objectContaining({ cwd: '/durable/project' }));
  await expect(reapWorktree(target)).rejects.toThrow(/source project binding/);
});

function identityGit(target, overrides = {}) {
  return jest.fn(async (_cmd, args, opts) => {
    const key = args.join(' ');
    if (opts.cwd === target && overrides[key] instanceof Error) throw overrides[key];
    const defaults = {
      'rev-parse --show-toplevel': opts.cwd,
      'rev-parse --path-format=absolute --git-common-dir': '/durable/project/.git',
      'rev-parse --absolute-git-dir': '/durable/project/.git/worktrees/test',
      'symbolic-ref --short HEAD': 'dispatch/test',
    };
    return { stdout: opts.cwd === target ? (overrides[key] ?? defaults[key] ?? '') : (defaults[key] ?? ''), stderr: '' };
  });
}

test.each([
  ['wrong repository', { 'rev-parse --path-format=absolute --git-common-dir': '/other/project/.git' }],
  ['wrong branch', { 'symbolic-ref --short HEAD': 'main' }],
  ['not a worktree', { 'rev-parse --show-toplevel': new Error('not a git repository') }],
  ['nested directory', { 'rev-parse --show-toplevel': '/durable/project' }],
  ['main checkout', { 'rev-parse --absolute-git-dir': '/durable/project/.git' }],
])('refuses %s on preexisting and partial-created targets', async (_name, overrides) => {
  const target = deriveWorktreePath('identity-proof');
  for (const partialCreate of [false, true]) {
    const execFileFn = identityGit(target, overrides);
    let exists = !partialCreate;
    if (partialCreate) {
      const git = execFileFn.getMockImplementation();
      execFileFn.mockImplementation(async (cmd, args, opts) => {
        if (args[0] === 'worktree') { exists = true; throw new Error('.git/config.lock File exists'); }
        return git(cmd, args, opts);
      });
    }
    await expect(gitWorktreeAdd(target, 'dispatch/test', 'origin/main', {
      repoWorkdir: '/durable/project', existsFn: () => exists, execFileFn,
    })).rejects.toThrow(/identity mismatch|not a git repository/);
  }
});

test('reuses only proven linked worktree identity and retries transient branch creation', async () => {
  const target = deriveWorktreePath('identity-good');
  const execFileFn = identityGit(target);
  await gitWorktreeAdd(target, 'dispatch/test', 'origin/main', { repoWorkdir: '/durable/project', existsFn: () => true, execFileFn });
  expect(execFileFn.mock.calls.some(([, args]) => args[0] === 'worktree')).toBe(false);
  const git = execFileFn.getMockImplementation();
  let attempts = 0;
  execFileFn.mockImplementation(async (cmd, args, opts) => {
    if (args[0] === 'worktree' && ++attempts === 1) throw new Error('.git/config.lock File exists');
    return git(cmd, args, opts);
  });
  const sleepFn = jest.fn(async () => {});
  await gitWorktreeAdd(target, 'dispatch/test', 'origin/main', {
    repoWorkdir: '/durable/project', existsFn: () => false, execFileFn, sleepFn,
  });
  expect(attempts).toBe(2);
  expect(sleepFn).toHaveBeenCalledTimes(1);
  expect(execFileFn).toHaveBeenCalledWith('git', ['worktree', 'add', target, 'dispatch/test'], { cwd: '/durable/project' });
});

test('missing App publisher is a typed attention failure, not an ambient GitHub attempt', async () => {
  await expect(requireGitHubAppPublisher()).rejects.toMatchObject({ code: 'GITHUB_APP_PUBLISHER_REQUIRED', needsAttention: true });
});

test('cleanup preserves wrong ownership and dirty work without force or raw removal', async () => {
  const target = deriveWorktreePath('cleanup-preserve');
  for (const wrongBranch of [true, false]) {
    const execFileFn = identityGit(target, wrongBranch ? { 'symbolic-ref --short HEAD': 'someone-elses-work' } : {});
    const git = execFileFn.getMockImplementation();
    execFileFn.mockImplementation(async (cmd, args, opts) => {
      if (args[0] === 'worktree') throw new Error('worktree contains modified or untracked files');
      return git(cmd, args, opts);
    });
    await expect(reapWorktree(target, '/durable/project', {
      expectedBranch: 'dispatch/test', existsFn: () => true, execFileFn,
    })).rejects.toThrow(wrongBranch ? /identity mismatch/ : /modified or untracked/);
    for (const [cmd, args] of execFileFn.mock.calls) {
      expect(cmd).toBe('git');
      expect(args).not.toContain('--force');
      expect(args).not.toContain('prune');
    }
    if (wrongBranch) expect(execFileFn.mock.calls.some(([, args]) => args[0] === 'worktree')).toBe(false);
  }
});
