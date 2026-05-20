/**
 * git-nightshift wrapper tests.
 *
 * We test the bash script by invoking it with a fake real-git stub and
 * inspecting exit codes + stderr. The wrapper's contract is:
 *   - destructive commands exit non-zero with a clear refusal message
 *   - allowed commands exec the fake real-git and propagate its exit code
 *
 * Tests run on a temporary working directory under ~/coding/tmp/, never /tmp.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const WRAPPER_PATH = resolve(process.cwd(), 'bin', 'git-nightshift');

function withScratch(fn) {
  // Per-test scratch dir under ~/coding/tmp -- never /tmp.
  const scratch = join(homedir(), 'coding', 'tmp', `pd-night-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(scratch, { recursive: true });
  try {
    return fn(scratch);
  } finally {
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function makeFakeGit(scratch, { branch = 'night-shift/foo-abc12345', exitCode = 0 } = {}) {
  // Write a fake git that:
  //   - responds to `rev-parse --abbrev-ref HEAD` with the configured branch
  //   - logs argv to scratch/fake-git.log and exits `exitCode` otherwise
  const fake = join(scratch, 'fake-git.sh');
  const log = join(scratch, 'fake-git.log');
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
if [[ "$1" == "rev-parse" ]] && [[ "$2" == "--abbrev-ref" ]] && [[ "$3" == "HEAD" ]]; then
  echo "${branch}"
  exit 0
fi
echo "$@" >> "${log}"
exit ${exitCode}
`,
    { mode: 0o755 },
  );
  return { fake, log };
}

function runWrapper(scratch, fakeGit, argv, extraEnv = {}) {
  // Important: spawn with PD_NIGHTSHIFT_REAL_GIT pointing at the fake.
  // PATH is irrelevant because the wrapper resolves through the env var.
  const res = spawnSync(WRAPPER_PATH, argv, {
    env: {
      ...process.env,
      PD_NIGHTSHIFT_REAL_GIT: fakeGit.fake,
      PD_NIGHTSHIFT_TRANSCRIPT: join(scratch, 'audit.log'),
      ...extraEnv,
    },
    encoding: 'utf8',
    cwd: scratch,
  });
  return res;
}

describe('git-nightshift wrapper -- refusals', () => {
  test('refuses push -f', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['push', '-f', 'origin', 'night-shift/foo']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/REFUSED.*force/);
    });
  });

  test('refuses push --force', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['push', '--force', 'origin', 'night-shift/foo']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/REFUSED.*force/);
    });
  });

  test('refuses push --force-with-lease', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['push', '--force-with-lease', 'origin', 'night-shift/foo']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/REFUSED.*force/);
    });
  });

  test('refuses push origin main', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['push', 'origin', 'main']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/REFUSED.*main/);
    });
  });

  test('refuses push origin master', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['push', 'origin', 'master']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/REFUSED.*main\/master/);
    });
  });

  test('refuses push --mirror', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['push', '--mirror', 'origin']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/mirror/);
    });
  });

  test('refuses push --all and --prune and --delete', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      for (const flag of ['--all', '--prune', '--delete']) {
        const res = runWrapper(scratch, fg, ['push', flag, 'origin']);
        expect(res.status).not.toBe(0);
      }
    });
  });

  test('refuses push when current branch is main even if the target looks safe', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch, { branch: 'main' });
      const res = runWrapper(scratch, fg, ['push', 'origin', 'night-shift/something']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/current branch.*not night-shift/);
    });
  });

  test('refuses reset --hard origin/main', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['reset', '--hard', 'origin/main']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/REFUSED.*main\/master/);
    });
  });

  test('refuses filter-branch and filter-repo', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      expect(runWrapper(scratch, fg, ['filter-branch']).status).not.toBe(0);
      expect(runWrapper(scratch, fg, ['filter-repo']).status).not.toBe(0);
    });
  });

  test('refuses update-ref on refs/heads/main and refs/heads/master', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      expect(runWrapper(scratch, fg, ['update-ref', 'refs/heads/main', 'abc']).status).not.toBe(0);
      expect(runWrapper(scratch, fg, ['update-ref', 'refs/heads/master', 'abc']).status).not.toBe(0);
    });
  });

  test('refuses update-ref on remote-tracking refs and tags', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      expect(runWrapper(scratch, fg, ['update-ref', 'refs/remotes/origin/main', 'abc']).status).not.toBe(0);
      expect(runWrapper(scratch, fg, ['update-ref', 'refs/tags/v1', 'abc']).status).not.toBe(0);
    });
  });

  test('refuses config --global and config --system', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      expect(runWrapper(scratch, fg, ['config', '--global', 'user.name', 'evil']).status).not.toBe(0);
      expect(runWrapper(scratch, fg, ['config', '--system', 'user.name', 'evil']).status).not.toBe(0);
    });
  });

  test('refuses config receive.denyDeletes false (disabling push safety)', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['config', 'receive.denyDeletes', 'false']);
      expect(res.status).not.toBe(0);
    });
  });

  test('refuses worktree add outside ~/coding/tmp/', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['worktree', 'add', '/etc/badworktree', '-b', 'foo']);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/worktree.*coding\/tmp/);
    });
  });

  test('refuses clean with absolute path', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['clean', '-fdx', '/']);
      expect(res.status).not.toBe(0);
    });
  });

  test('refuses checkout -b main and switch -b master', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      expect(runWrapper(scratch, fg, ['checkout', '-b', 'main']).status).not.toBe(0);
      expect(runWrapper(scratch, fg, ['switch', '-b', 'master']).status).not.toBe(0);
    });
  });

  test('refuses remote add for an arbitrary URL', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['remote', 'add', 'evil', 'https://evil.example.com/repo.git']);
      expect(res.status).not.toBe(0);
    });
  });

  test('refuses remote set-url, rename, remove', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      expect(runWrapper(scratch, fg, ['remote', 'set-url', 'origin', 'https://evil/']).status).not.toBe(0);
      expect(runWrapper(scratch, fg, ['remote', 'rename', 'origin', 'evil']).status).not.toBe(0);
      expect(runWrapper(scratch, fg, ['remote', 'remove', 'origin']).status).not.toBe(0);
    });
  });
});

describe('git-nightshift wrapper -- allowed pass-through', () => {
  test('passes through status / diff / log / add / commit', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      for (const cmd of ['status', 'diff', 'log', ['add', '.'], ['commit', '-m', 'wip']]) {
        const argv = Array.isArray(cmd) ? cmd : [cmd];
        const res = runWrapper(scratch, fg, argv);
        expect(res.status).toBe(0);
      }
    });
  });

  test('passes through push origin night-shift/<branch>', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch, { branch: 'night-shift/foo-abc12345' });
      const res = runWrapper(scratch, fg, ['push', 'origin', 'night-shift/foo-abc12345']);
      expect(res.status).toBe(0);
    });
  });

  test('passes through remote add for curiositech URL', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      const res = runWrapper(scratch, fg, ['remote', 'add', 'extra', 'https://github.com/curiositech/something.git']);
      expect(res.status).toBe(0);
    });
  });
});

describe('git-nightshift wrapper -- forensic logging', () => {
  test('logs refused commands to the audit log', () => {
    withScratch((scratch) => {
      const fg = makeFakeGit(scratch);
      runWrapper(scratch, fg, ['push', '--force', 'origin', 'main']);
      const auditPath = join(scratch, 'audit.log');
      expect(existsSync(auditPath)).toBe(true);
      const body = readFileSync(auditPath, 'utf8');
      expect(body).toMatch(/REFUSED/);
      expect(body).toMatch(/push/);
    });
  });
});
