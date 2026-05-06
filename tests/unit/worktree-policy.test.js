/**
 * Unit Tests for session worktree policy.
 */

import { describe, test, expect } from '@jest/globals';

import {
  evaluateSessionWorktreePolicy,
  mergeSessionWorktreeMetadata,
  normalizeSessionWorktreeContext,
} from '../../lib/worktree-policy.js';

const linkedWorktree = {
  id: 'wt123456',
  root: '/tmp/port-daddy-feature',
  name: 'port-daddy-feature',
  branch: 'codex/worktree-policy',
  isMain: false,
};

describe('evaluateSessionWorktreePolicy', () => {
  test('allows callers that do not require a linked worktree', () => {
    const result = evaluateSessionWorktreePolicy({});

    expect(result.success).toBe(true);
    expect(result.worktree).toBeNull();
  });

  test('requires valid worktree context when enforcement is enabled', () => {
    const result = evaluateSessionWorktreePolicy({ requireLinkedWorktree: true });

    expect(result.success).toBe(false);
    expect(result.code).toBe('WORKTREE_REQUIRED');
    expect(result.hint).toContain('git worktree add');
  });

  test('rejects the main worktree unless explicitly allowed', () => {
    const result = evaluateSessionWorktreePolicy({
      requireLinkedWorktree: true,
      worktree: { ...linkedWorktree, isMain: true },
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('MAIN_WORKTREE_SESSION_FORBIDDEN');
  });

  test('accepts an explicitly allowed main-worktree integration session', () => {
    const result = evaluateSessionWorktreePolicy({
      requireLinkedWorktree: true,
      allowMainWorktree: true,
      worktree: { ...linkedWorktree, isMain: true },
    });

    expect(result.success).toBe(true);
    expect(result.worktree?.isMain).toBe(true);
  });

  test('accepts linked worktrees', () => {
    const result = evaluateSessionWorktreePolicy({
      requireLinkedWorktree: true,
      worktree: linkedWorktree,
    });

    expect(result.success).toBe(true);
    expect(result.worktree).toEqual(linkedWorktree);
  });
});

describe('normalizeSessionWorktreeContext', () => {
  test('rejects incomplete context', () => {
    expect(normalizeSessionWorktreeContext({ id: 'abc', root: '/tmp/repo' })).toBeNull();
  });

  test('normalizes optional display fields', () => {
    const result = normalizeSessionWorktreeContext({
      id: 'abc12345',
      root: '/tmp/repo',
      isMain: false,
    });

    expect(result).toEqual({
      id: 'abc12345',
      root: '/tmp/repo',
      name: 'repo',
      branch: null,
      isMain: false,
    });
  });
});

describe('mergeSessionWorktreeMetadata', () => {
  test('records policy and worktree context in metadata', () => {
    const result = mergeSessionWorktreeMetadata(
      { source: 'test' },
      linkedWorktree,
      { requireLinkedWorktree: true },
    );

    expect(result).toEqual({
      source: 'test',
      sessionWorktreePolicy: {
        requireLinkedWorktree: true,
        allowMainWorktree: false,
      },
      worktree: linkedWorktree,
    });
  });
});
