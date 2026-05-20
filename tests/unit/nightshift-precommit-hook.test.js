/**
 * Pre-commit hook tests.
 *
 * We initialize a real bare git repo in a scratch dir, stage the kinds of
 * commits the hook should refuse, and call the hook script directly. The
 * hook reads from `git diff --cached` so a real repo is the cheapest way to
 * exercise it accurately.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const HOOK_PATH = resolve(process.cwd(), 'lib', 'nightshift', 'precommit-hook.sh');

function withRepo({ branch = 'night-shift/foo-abc12345' } = {}, fn) {
  const scratch = join(homedir(), 'coding', 'tmp', `pd-night-hook-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(scratch, { recursive: true });
  try {
    sh(scratch, 'git init -q');
    sh(scratch, 'git config user.email "test@example.com"');
    sh(scratch, 'git config user.name "test"');
    sh(scratch, 'git config commit.gpgsign false');
    // Create an initial commit so HEAD exists.
    writeFileSync(join(scratch, 'seed.txt'), 'seed\n');
    sh(scratch, 'git add seed.txt');
    sh(scratch, 'git commit -q -m "seed"');
    sh(scratch, `git checkout -q -b "${branch}"`);
    return fn(scratch);
  } finally {
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function sh(cwd, cmdline) {
  const res = spawnSync('bash', ['-lc', cmdline], { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`sh failed (${cmdline}): ${res.stderr || res.stdout}`);
  }
  return res;
}

function runHook(cwd, env = {}) {
  return spawnSync(HOOK_PATH, [], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('precommit-hook -- branch shape', () => {
  test('allows commits on a night-shift/* branch with reasonable diff', () => {
    withRepo({}, (scratch) => {
      writeFileSync(join(scratch, 'a.txt'), 'hello\n');
      sh(scratch, 'git add a.txt');
      const res = runHook(scratch);
      expect(res.status).toBe(0);
    });
  });

  test('refuses commits on main', () => {
    withRepo({}, (scratch) => {
      // Switch off the night-shift branch back to whatever the initial branch is.
      // `git init` on modern git creates `main` (or `master` on older); detect
      // and switch with `-B` to force it.
      writeFileSync(join(scratch, 'a.txt'), 'hello\n');
      // Force-create or switch to a non-night-shift branch named 'main'.
      sh(scratch, 'git checkout -q -B main HEAD');
      sh(scratch, 'git add a.txt');
      const res = runHook(scratch);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/not night-shift/);
    });
  });

  test('refuses commits on detached HEAD', () => {
    withRepo({}, (scratch) => {
      sh(scratch, 'git checkout -q --detach HEAD');
      writeFileSync(join(scratch, 'a.txt'), 'hello\n');
      sh(scratch, 'git add a.txt');
      const res = runHook(scratch);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/detached HEAD/);
    });
  });
});

describe('precommit-hook -- size limits', () => {
  test('refuses commits touching more than MAX_FILES files', () => {
    withRepo({}, (scratch) => {
      // Create 6 files; cap at 5 for this test.
      for (let i = 0; i < 6; i++) {
        writeFileSync(join(scratch, `f${i}.txt`), 'x\n');
      }
      sh(scratch, 'git add .');
      const res = runHook(scratch, { PD_NIGHTSHIFT_MAX_FILES: '5' });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/touches 6 files/);
    });
  });

  test('refuses commits adding more than MAX_ADDED lines', () => {
    withRepo({}, (scratch) => {
      // 100 lines added with a cap of 50.
      const body = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n';
      writeFileSync(join(scratch, 'big.txt'), body);
      sh(scratch, 'git add big.txt');
      const res = runHook(scratch, { PD_NIGHTSHIFT_MAX_ADDED: '50' });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/adds 100 LOC/);
    });
  });

  test('refuses per-file deletions over MAX_DELETED_PER_FILE without marker', () => {
    withRepo({}, (scratch) => {
      // First commit a big file on the branch.
      const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n';
      writeFileSync(join(scratch, 'big.txt'), big);
      sh(scratch, 'git add big.txt');
      sh(scratch, 'git commit -q -m "add big"');
      // Now delete 150 lines.
      const small = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n';
      writeFileSync(join(scratch, 'big.txt'), small);
      sh(scratch, 'git add big.txt');
      const res = runHook(scratch, { PD_NIGHTSHIFT_MAX_DELETED_PER_FILE: '100' });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/deletes 150 lines/);
    });
  });

  test('allows big deletions when ALLOW BIG DELETE marker is in the staged file', () => {
    withRepo({}, (scratch) => {
      const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n';
      writeFileSync(join(scratch, 'big.txt'), big);
      sh(scratch, 'git add big.txt');
      sh(scratch, 'git commit -q -m "add big"');
      const small = '// ALLOW BIG DELETE\n' + Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n';
      writeFileSync(join(scratch, 'big.txt'), small);
      sh(scratch, 'git add big.txt');
      const res = runHook(scratch, { PD_NIGHTSHIFT_MAX_DELETED_PER_FILE: '100' });
      expect(res.status).toBe(0);
    });
  });

  test('allows big deletions when ALLOW-BIG-DELETE: trailer is in COMMIT_EDITMSG', () => {
    withRepo({}, (scratch) => {
      const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n';
      writeFileSync(join(scratch, 'big.txt'), big);
      sh(scratch, 'git add big.txt');
      sh(scratch, 'git commit -q -m "add big"');
      const small = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n';
      writeFileSync(join(scratch, 'big.txt'), small);
      sh(scratch, 'git add big.txt');
      // Stage a COMMIT_EDITMSG with the marker.
      const gitDirRes = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: scratch, encoding: 'utf8' });
      const gitDir = gitDirRes.stdout.trim();
      writeFileSync(join(scratch, gitDir, 'COMMIT_EDITMSG'), 'chore: trim\n\nALLOW-BIG-DELETE: removing legacy module\n');
      const res = runHook(scratch, { PD_NIGHTSHIFT_MAX_DELETED_PER_FILE: '100' });
      expect(res.status).toBe(0);
    });
  });
});

describe('precommit-hook -- trailer enforcement', () => {
  test('refuses commit without Spawned-by trailer when PD_NIGHTSHIFT_ID is set', () => {
    withRepo({}, (scratch) => {
      writeFileSync(join(scratch, 'a.txt'), 'x\n');
      sh(scratch, 'git add a.txt');
      const gitDirRes = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: scratch, encoding: 'utf8' });
      const gitDir = gitDirRes.stdout.trim();
      writeFileSync(join(scratch, gitDir, 'COMMIT_EDITMSG'), 'feat: do thing\n');
      const res = runHook(scratch, { PD_NIGHTSHIFT_ID: 'run-12345' });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/Spawned-by/);
    });
  });

  test('allows commit with Spawned-by trailer matching the run id', () => {
    withRepo({}, (scratch) => {
      writeFileSync(join(scratch, 'a.txt'), 'x\n');
      sh(scratch, 'git add a.txt');
      const gitDirRes = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: scratch, encoding: 'utf8' });
      const gitDir = gitDirRes.stdout.trim();
      writeFileSync(join(scratch, gitDir, 'COMMIT_EDITMSG'), 'feat: do thing\n\nSpawned-by: nightshift-runner run-12345\n');
      const res = runHook(scratch, { PD_NIGHTSHIFT_ID: 'run-12345' });
      expect(res.status).toBe(0);
    });
  });

  test('skips trailer check when PD_NIGHTSHIFT_ID is not set (operator workflow)', () => {
    withRepo({}, (scratch) => {
      writeFileSync(join(scratch, 'a.txt'), 'x\n');
      sh(scratch, 'git add a.txt');
      const res = runHook(scratch); // no env override
      expect(res.status).toBe(0);
    });
  });
});
