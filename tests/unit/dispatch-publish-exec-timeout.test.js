/**
 * Regression: the dispatch publish subprocesses (`git push`, `gh pr create`)
 * MUST run with an exec-level timeout + SIGKILL so a hung child is killed at the
 * source — not merely abandoned when the Conductor's `publishTimeoutMs` belt
 * frees the in-flight slot. Without these options a stalled `git push` (DNS/ssh
 * hang) or `gh pr create` (API retry storm) orphans a process that lingers
 * overnight. See PUBLISH_EXEC_TIMEOUT_MS in lib/dispatch/spawn-adapter.ts.
 *
 * We mock node:child_process (spreading the real module) so `execFile` records
 * the options object each helper passes, and assert the bound is present.
 */
import { jest } from '@jest/globals';

const execFileCalls = [];

jest.unstable_mockModule('node:child_process', () => {
  const actual = jest.requireActual('node:child_process');
  return {
    ...actual,
    // promisify(execFile) uses the (cmd, args, opts, cb) callback form. Record
    // the call, then succeed: git push → empty stdout; gh pr create → a PR URL.
    execFile: (cmd, args, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      const options = typeof opts === 'function' ? {} : opts;
      execFileCalls.push({ cmd, args, options });
      const stdout = cmd === 'gh' ? 'https://github.com/acme/repo/pull/1\n' : '';
      callback(null, { stdout, stderr: '' });
      return { on: () => {}, kill: () => {} };
    },
  };
});

const { gitPushBranch, openDraftPr, PUBLISH_EXEC_TIMEOUT_MS } = await import(
  '../../lib/dispatch/spawn-adapter.js'
);

beforeEach(() => {
  execFileCalls.length = 0;
});

describe('dispatch publish exec-level timeout (orphan-kill hardening)', () => {
  test('gitPushBranch avoids repository-wide upstream writes and bounds execFile', async () => {
    await gitPushBranch('/tmp/wt', 'dispatch/foo-abc123');
    const push = execFileCalls.find((c) => c.cmd === 'git');
    expect(push).toBeDefined();
    expect(push.args).toEqual(['-C', '/tmp/wt', 'push', 'origin', 'dispatch/foo-abc123']);
    expect(push.args).not.toContain('-u');
    expect(push.options.timeout).toBe(PUBLISH_EXEC_TIMEOUT_MS);
    expect(Number.isFinite(push.options.timeout)).toBe(true);
    expect(push.options.timeout).toBeGreaterThan(0);
    expect(push.options.killSignal).toBe('SIGKILL');
  });

  test('gitPushBranch honors an explicit timeout override', async () => {
    await gitPushBranch('/tmp/wt', 'b', 5000);
    const push = execFileCalls.find((c) => c.cmd === 'git');
    expect(push.options.timeout).toBe(5000);
    expect(push.options.killSignal).toBe('SIGKILL');
  });

  test('openDraftPr passes a finite timeout + SIGKILL to the gh exec', async () => {
    const url = await openDraftPr({
      branch: 'dispatch/foo-abc123',
      baseBranch: 'main',
      goal: 'do the thing',
      dispatchId: 'abc123',
      worktreePath: '/tmp/wt',
    });
    expect(url).toBe('https://github.com/acme/repo/pull/1');
    const gh = execFileCalls.find((c) => c.cmd === 'gh');
    expect(gh).toBeDefined();
    expect(gh.options.timeout).toBe(PUBLISH_EXEC_TIMEOUT_MS);
    expect(gh.options.killSignal).toBe('SIGKILL');
    // cwd must still be the worktree (we ADD the bound, not replace the options).
    expect(gh.options.cwd).toBe('/tmp/wt');
  });

  test('openDraftPr honors an explicit timeoutMs override', async () => {
    await openDraftPr({
      branch: 'b',
      baseBranch: 'main',
      goal: 'g',
      dispatchId: 'id',
      worktreePath: '/tmp/wt',
      timeoutMs: 7000,
    });
    const gh = execFileCalls.find((c) => c.cmd === 'gh');
    expect(gh.options.timeout).toBe(7000);
    expect(gh.options.killSignal).toBe('SIGKILL');
  });

  test('the default bound sits UNDER the Conductor publish belt (120s) so the child dies first', () => {
    // The Conductor wraps the whole publish in a 120s belt; the per-exec kill
    // must fire before that, or the belt just abandons a still-running child.
    expect(PUBLISH_EXEC_TIMEOUT_MS).toBeLessThan(120_000);
  });
});
