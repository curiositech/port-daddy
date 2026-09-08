import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGitOriginChecker } from '../../lib/git-origin-check.js';

const ROOT = join(process.cwd(), '.scratch', `git-origin-check-${process.pid}`);

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  git('init', '-b', 'main');
  git('config', 'user.email', 'tests@portdaddy.local');
  git('config', 'user.name', 'Port Daddy Tests');
  writeFileSync(join(ROOT, 'README.md'), 'baseline\n');
  git('add', 'README.md');
  git('commit', '-m', 'baseline');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});

afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe('ledger-only origin verification', () => {
  test('accepts a clean no-upstream branch with zero commits absent from remote refs', () => {
    git('switch', '-c', 'ledger-only');
    const result = createGitOriginChecker().checkLedgerOnly(ROOT);
    expect(result).toEqual({ ok: true, dirtyEntries: 0, unpublishedCommits: 0 });
  });

  test('rejects untracked or modified files', () => {
    writeFileSync(join(ROOT, 'local.txt'), 'not published\n');
    const result = createGitOriginChecker().checkLedgerOnly(ROOT);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('DIRTY_WORKTREE');
    expect(result.dirtyEntries).toBe(1);
  });

  test('rejects clean commits absent from every remote ref', () => {
    writeFileSync(join(ROOT, 'local.txt'), 'committed but not published\n');
    git('add', 'local.txt');
    git('commit', '-m', 'unpublished work');
    const result = createGitOriginChecker().checkLedgerOnly(ROOT);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNPUBLISHED_COMMITS');
    expect(result.unpublishedCommits).toBe(1);
  });
});
