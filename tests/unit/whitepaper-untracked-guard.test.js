/**
 * The whitepaper-build workflow decides whether to commit rebuilt PDFs, and
 * whether main is serving stale ones, by asking git what changed. It used
 * `git diff --quiet -- 'website-v2/public/whitepaper/*.pdf'`, which cannot see a
 * file git is not yet tracking.
 *
 * That was invisible until the collected volume: every other paper's PDF was
 * already committed, so `git diff` saw its rewrites. The volume's PDF is
 * UNTRACKED on its first build, so the commit gate reported "PDFs already match
 * source — nothing to commit" and the verify gate reported "All in-scope
 * published PDFs match a fresh render. ✔" — and the volume would have been
 * published to the website while never being committed to the repository.
 *
 * These tests pin the distinction itself against real git, in a repository built
 * for the purpose, so they do not depend on this repository's state or checkout
 * depth. Raised by pd-purser on #7278 as `untracked-file-detection`.
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PDF_GLOB = 'website-v2/public/whitepaper/*.pdf';

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'whitepaper-untracked-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'whitepaper test');
  mkdirSync(join(dir, 'website-v2/public/whitepaper'), { recursive: true });
  // A committed paper, so the repo has a HEAD and the glob has a tracked member.
  writeFileSync(join(dir, 'website-v2/public/whitepaper/existing.pdf'), 'committed');
  git('add', '-A');
  git('commit', '-qm', 'an already-published paper');
  return { dir, git };
}

function addUntrackedVolume(dir) {
  writeFileSync(join(dir, 'website-v2/public/whitepaper/collected-volume.pdf'), 'brand new');
}

describe('whitepaper PDF staleness detection sees untracked artifacts', () => {
  test('git diff is blind to a never-committed PDF — the original bug', () => {
    const { dir } = fixtureRepo();
    try {
      addUntrackedVolume(dir);
      // --quiet exits 0 ("no differences") even though a new PDF is sitting there.
      const diff = execFileSync('/bin/sh', ['-c',
        `git diff --quiet -- '${PDF_GLOB}'; echo $?`],
        { cwd: dir, encoding: 'utf8' }).trim();

      expect(diff).toBe('0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('git status --untracked-files=all reports it', () => {
    const { dir } = fixtureRepo();
    try {
      addUntrackedVolume(dir);
      const status = execFileSync('git',
        ['status', '--porcelain', '--untracked-files=all', '--', PDF_GLOB],
        { cwd: dir, encoding: 'utf8' });

      expect(status.trim()).not.toBe('');
      expect(status).toContain('collected-volume.pdf');
      expect(status).toMatch(/^\?\?/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('it also still reports a MODIFIED tracked PDF, and stays quiet when nothing moved', () => {
    const { dir } = fixtureRepo();
    try {
      // Quiet when clean — otherwise the gate would fire on every run and the
      // loop-breaker would be doing all the work.
      expect(execFileSync('git',
        ['status', '--porcelain', '--untracked-files=all', '--', PDF_GLOB],
        { cwd: dir, encoding: 'utf8' }).trim()).toBe('');

      // Rewriting a tracked paper is the case that already worked; it must not
      // regress in exchange for seeing untracked ones.
      writeFileSync(join(dir, 'website-v2/public/whitepaper/existing.pdf'), 'rebuilt');
      const status = execFileSync('git',
        ['status', '--porcelain', '--untracked-files=all', '--', PDF_GLOB],
        { cwd: dir, encoding: 'utf8' });

      expect(status).toContain('existing.pdf');
      expect(status).toMatch(/^ ?M/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('both workflow gates actually use the untracked-aware form', () => {
    // Without this the tests above would pass against a workflow that still
    // shipped the blind `git diff --quiet`.
    const workflow = readFileSync(
      join(repoRoot, '.github/workflows/whitepaper-build.yml'), 'utf8');

    // The glob is deliberately unquoted, so the shell expands it against the
    // working tree and the untracked PDF arrives as an explicit path.
    const untrackedAware = workflow.match(
      /git status --porcelain --untracked-files=all -- website-v2\/public\/whitepaper\/\*\.pdf/g);
    expect(untrackedAware).toHaveLength(2); // the commit gate and the verify gate

    // The blind form must not come back for the published-PDF set. (The restore
    // step's `git diff --quiet -- "$pdf"` is a different check, on one tracked
    // path at a time, and is intentionally left alone.)
    expect(workflow).not.toMatch(
      /git diff --quiet -- ['"]?website-v2\/public\/whitepaper\/\*\.pdf/);
  });
});
