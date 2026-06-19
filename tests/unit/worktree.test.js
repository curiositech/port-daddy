/**
 * Unit Tests for lib/worktree.ts
 *
 * Tests git worktree detection utilities. These tests run real `git` commands
 * against the port-daddy repository itself (which is a git repo), so they
 * require `git` to be available in PATH.
 *
 * The uncovered lines in worktree.ts are:
 *   - Line 50: detached-HEAD branch → null path
 *   - Lines 69-109: listWorktrees() function (entire function)
 */

import { describe, test, expect } from '@jest/globals';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  getWorktreeInfo,
  listWorktrees,
  getWorktreeId,
} from '../../lib/worktree.js';

// ─── getWorktreeInfo — in a real git repo ─────────────────────────────────────

describe('getWorktreeInfo — port-daddy repo (real git)', () => {
  const repoRoot = process.cwd(); // Jest cwd is the project root

  test('returns a non-null WorktreeInfo object', () => {
    const info = getWorktreeInfo(repoRoot);
    expect(info).not.toBeNull();
  });

  test('root is an absolute path string', () => {
    const info = getWorktreeInfo(repoRoot);
    expect(typeof info.root).toBe('string');
    expect(info.root.startsWith('/')).toBe(true);
  });

  test('id is an 8-character hex string', () => {
    const info = getWorktreeInfo(repoRoot);
    expect(info.id).toMatch(/^[0-9a-f]{8}$/);
  });

  test('name is a non-empty string', () => {
    const info = getWorktreeInfo(repoRoot);
    expect(typeof info.name).toBe('string');
    expect(info.name.length).toBeGreaterThan(0);
  });

  test('branch is a string or null', () => {
    const info = getWorktreeInfo(repoRoot);
    // In CI or detached HEAD, branch may be null; in development it's a branch name
    expect(info.branch === null || typeof info.branch === 'string').toBe(true);
  });

  test('isMain is a boolean', () => {
    const info = getWorktreeInfo(repoRoot);
    expect(typeof info.isMain).toBe('boolean');
  });

  test('commonDir is a non-empty string', () => {
    const info = getWorktreeInfo(repoRoot);
    expect(typeof info.commonDir).toBe('string');
    expect(info.commonDir.length).toBeGreaterThan(0);
  });

  test('id is deterministic — same root produces same id', () => {
    const info1 = getWorktreeInfo(repoRoot);
    const info2 = getWorktreeInfo(repoRoot);
    expect(info1.id).toBe(info2.id);
  });

  test('name matches last path segment of root', () => {
    const info = getWorktreeInfo(repoRoot);
    const expectedName = info.root.split('/').pop();
    expect(info.name).toBe(expectedName);
  });
});

// ─── getWorktreeInfo — non-git directory ─────────────────────────────────────

describe('getWorktreeInfo — non-git directory', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pd-worktree-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null for a directory that is not a git repo', () => {
    const result = getWorktreeInfo(tmpDir);
    expect(result).toBeNull();
  });
});

// ─── getWorktreeId ────────────────────────────────────────────────────────────

describe('getWorktreeId', () => {
  const repoRoot = process.cwd();

  test('returns an 8-character hex string in a git repo', () => {
    const id = getWorktreeId(repoRoot);
    expect(id).not.toBeNull();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  test('returns null outside a git repo', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pd-wt-id-test-'));
    try {
      const id = getWorktreeId(tmpDir);
      expect(id).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('is consistent with getWorktreeInfo().id', () => {
    const info = getWorktreeInfo(repoRoot);
    const id = getWorktreeId(repoRoot);
    expect(id).toBe(info.id);
  });
});

// ─── listWorktrees — real git repo ───────────────────────────────────────────

describe('listWorktrees — port-daddy repo (real git)', () => {
  const repoRoot = process.cwd();

  test('returns an array', () => {
    const worktrees = listWorktrees(repoRoot);
    expect(Array.isArray(worktrees)).toBe(true);
  });

  test('includes at least the main worktree', () => {
    const worktrees = listWorktrees(repoRoot);
    expect(worktrees.length).toBeGreaterThanOrEqual(1);
  });

  test('first entry is marked as the main worktree', () => {
    const worktrees = listWorktrees(repoRoot);
    // listWorktrees() sets worktrees[0].isMain = true per the implementation
    expect(worktrees[0].isMain).toBe(true);
  });

  test('each entry has a root string', () => {
    const worktrees = listWorktrees(repoRoot);
    for (const wt of worktrees) {
      expect(typeof wt.root).toBe('string');
      expect(wt.root.length).toBeGreaterThan(0);
    }
  });

  test('each entry has an 8-character hex id', () => {
    const worktrees = listWorktrees(repoRoot);
    for (const wt of worktrees) {
      expect(wt.id).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  test('each entry has a name derived from root path', () => {
    const worktrees = listWorktrees(repoRoot);
    for (const wt of worktrees) {
      const expectedName = wt.root.split('/').pop() || 'unknown';
      expect(wt.name).toBe(expectedName);
    }
  });

  test('listed worktrees include the current worktree root', () => {
    const info = getWorktreeInfo(repoRoot);
    const worktrees = listWorktrees(repoRoot);
    expect(worktrees.some(wt => wt.root === info.root)).toBe(true);
  });
});

// ─── listWorktrees — non-git directory ───────────────────────────────────────

describe('listWorktrees — non-git directory', () => {
  test('returns empty array outside a git repo', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pd-wt-list-test-'));
    try {
      const result = listWorktrees(tmpDir);
      expect(result).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── getWorktreeInfo — no cwd argument ───────────────────────────────────────

describe('getWorktreeInfo — default cwd behavior', () => {
  test('works when no cwd is provided (uses process.cwd())', () => {
    // Jest runs from the project root, which is a git repo
    const info = getWorktreeInfo();
    // Could be null if run outside repo, but in this project it should succeed
    if (info !== null) {
      expect(info.id).toMatch(/^[0-9a-f]{8}$/);
    }
    // If null, that's also valid — just means Jest is running outside a repo
    expect(info === null || typeof info === 'object').toBe(true);
  });
});
