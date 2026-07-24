/**
 * The coordination guard's pre-commit file-touch detection must not
 * misattribute a merge's pass-through files to the merging session.
 *
 * `stagedFiles()` used a plain `git diff --cached` against HEAD, which is
 * correct for an ordinary commit but wrong during an in-progress merge: HEAD
 * is the pre-merge tip, so every file the OTHER branch touched shows up as
 * "staged by this commit" even when its content arrived unchanged. On a
 * rebase-forward of a stale PR branch onto origin/main, that swept in
 * hundreds of main's files — many under some other live session's active
 * claim — and the guard refused the commit as a false collision.
 *
 * Fix: during a merge, diff the staged tree against MERGE_HEAD (the tip
 * being merged in) instead of HEAD. A file whose resolved content equals
 * MERGE_HEAD's arrived untouched and is exempt; a file that differs (a real
 * conflict resolution) still counts.
 *
 * Hermetic: builds real temp git repos and drives real `git merge` /
 * `git merge --continue`-style conflict resolution — no mocking, since the
 * defect is in how git itself is queried.
 */
import { describe, test, expect, afterEach } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stagedFiles } from '../../cli/commands/guard.js';

const scratchDirs = [];
afterEach(() => {
  while (scratchDirs.length) {
    try { rmSync(scratchDirs.pop(), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function freshRepo(name) {
  const dir = mkdtempSync(join(tmpdir(), `pd-guard-merge-${name}-`));
  scratchDirs.push(dir);
  git(['init', '-q', '-b', 'trunk'], dir);
  git(['config', 'user.email', 't@t.com'], dir);
  git(['config', 'user.name', 't'], dir);
  return dir;
}

describe('stagedFiles — merge blast-radius attribution', () => {
  test('a clean merge (no conflicts) reports ZERO staged files — nothing was actually authored here', () => {
    const dir = freshRepo('clean');
    writeFileSync(join(dir, 'a.txt'), 'base\n');
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'base'], dir);
    git(['checkout', '-qb', 'feature'], dir);
    writeFileSync(join(dir, 'a.txt'), 'feature edit\n');
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'feature edits a'], dir);
    git(['checkout', '-q', 'trunk'], dir);
    // trunk grows many unrelated files, simulating other live sessions' work
    for (const name of ['env.ts', 'execute.ts', 'spend.ts', 'wrangler.toml']) {
      writeFileSync(join(dir, name), `trunk content for ${name}\n`);
    }
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'trunk adds unrelated files (other sessions)'], dir);
    git(['checkout', '-q', 'feature'], dir);
    git(['merge', '-q', '--no-ff', '-m', 'merge trunk', 'trunk'], dir); // auto-merges cleanly, already staged

    const files = stagedFiles(dir);
    // The pre-fix behavior (diff --cached vs stale HEAD) would report all 4
    // trunk-only files as "staged by this commit" even though this session
    // never touched them. The fix reports none — they arrived unchanged.
    expect(files).toEqual([]);
  });

  test('a conflicted merge reports ONLY the file this session actually resolved — trunk pass-through files are exempt', () => {
    const dir = freshRepo('conflict');
    writeFileSync(join(dir, 'shared.txt'), 'base\n');
    writeFileSync(join(dir, 'c.txt'), 'base\n');
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'base'], dir);
    git(['checkout', '-qb', 'feature'], dir);
    writeFileSync(join(dir, 'shared.txt'), 'feature version\n');
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'feature edits shared'], dir);
    git(['checkout', '-q', 'trunk'], dir);
    writeFileSync(join(dir, 'shared.txt'), 'trunk version\n');
    // simulate other live sessions' unrelated work landing on trunk
    for (const name of ['env.ts', 'execute.ts', 'spend-gateway.test.ts']) {
      writeFileSync(join(dir, name), `trunk content for ${name}\n`);
    }
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'trunk edits shared + adds unrelated files'], dir);
    git(['checkout', '-q', 'feature'], dir);
    const merge = spawnSync('git', ['merge', '-q', '--no-ff', '-m', 'merge trunk', 'trunk'], { cwd: dir, encoding: 'utf8' });
    expect(merge.status).not.toBe(0); // real conflict on shared.txt, as intended
    // Resolve the ONE real conflict, as a human/agent would:
    writeFileSync(join(dir, 'shared.txt'), 'resolved content\n');
    git(['add', 'shared.txt'], dir);

    const files = stagedFiles(dir);
    expect(files).toEqual(['shared.txt']);
    // Specifically NOT the trunk-only files other sessions authored:
    expect(files).not.toContain('env.ts');
    expect(files).not.toContain('execute.ts');
    expect(files).not.toContain('spend-gateway.test.ts');
  });

  test('an ordinary (non-merge) commit is unaffected — plain HEAD diff still applies', () => {
    const dir = freshRepo('plain');
    writeFileSync(join(dir, 'a.txt'), 'base\n');
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'base'], dir);
    writeFileSync(join(dir, 'a.txt'), 'edited\n');
    writeFileSync(join(dir, 'b.txt'), 'new\n');
    git(['add', '-A'], dir);

    expect(stagedFiles(dir).sort()).toEqual(['a.txt', 'b.txt']);
  });
});
