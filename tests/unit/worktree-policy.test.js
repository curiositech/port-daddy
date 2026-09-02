/**
 * Unit Tests for session worktree policy.
 */

import { describe, test, expect, jest } from '@jest/globals';

import {
  evaluateSessionWorktreePolicy,
  mergeSessionWorktreeMetadata,
  normalizeSessionWorktreeContext,
  resolveSessionWorktreeAdmission,
} from '../../lib/worktree-policy.js';

const linkedWorktree = {
  id: 'wt123456',
  root: '/Users/example/coding/tmp/port-daddy-feature',
  name: 'port-daddy-feature',
  branch: 'codex/worktree-policy',
  isMain: false,
};

const probeLinkedWorktree = () => ({
  ...linkedWorktree,
  commonDir: '/Users/example/coding/port-daddy/.git',
});

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

  test('main-worktree refusal points to the fix without leaking the bypass flag', () => {
    const result = evaluateSessionWorktreePolicy({
      requireLinkedWorktree: true,
      worktree: { ...linkedWorktree, isMain: true },
    });

    expect(result.code).toBe('MAIN_WORKTREE_SESSION_FORBIDDEN');
    // The refusal must guide toward the correct action...
    expect(result.hint).toContain('git worktree add');
    // ...and must NOT advertise the escape hatch to the agent it just stopped.
    // An advertised bypass turns the guardrail into a suggestion.
    expect(result.hint).not.toMatch(/allow-main-worktree/i);
    expect(result.error).not.toMatch(/allow-main-worktree/i);
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

describe('resolveSessionWorktreeAdmission', () => {
  test('derives one exact column and metadata witness from the daemon probe', () => {
    const result = resolveSessionWorktreeAdmission({
      worktree: linkedWorktree,
      requireLinkedWorktree: true,
      metadata: {
        source: 'cli',
        worktree: linkedWorktree,
        sessionWorktreePolicy: {
          requireLinkedWorktree: true,
          allowMainWorktree: false,
        },
      },
    }, { probeWorktree: probeLinkedWorktree });

    expect(result).toMatchObject({
      success: true,
      worktreeId: linkedWorktree.id,
      worktree: linkedWorktree,
      metadata: {
        source: 'cli',
        worktree: linkedWorktree,
        sessionWorktreePolicy: {
          requireLinkedWorktree: true,
          allowMainWorktree: false,
        },
      },
    });
  });

  test('rejects a caller id that disagrees with the root re-probe', () => {
    const result = resolveSessionWorktreeAdmission({
      worktree: { ...linkedWorktree, id: 'forged99' },
      requireLinkedWorktree: true,
    }, { probeWorktree: probeLinkedWorktree });

    expect(result.success).toBe(false);
    expect(result.code).toBe('WORKTREE_CONTEXT_MISMATCH');
  });

  test('rejects split-world metadata even when the top-level witness is valid', () => {
    const result = resolveSessionWorktreeAdmission({
      worktree: linkedWorktree,
      requireLinkedWorktree: true,
      metadata: {
        worktree: { ...linkedWorktree, id: 'other999' },
        sessionWorktreePolicy: {
          requireLinkedWorktree: true,
          allowMainWorktree: false,
        },
      },
    }, { probeWorktree: probeLinkedWorktree });

    expect(result.success).toBe(false);
    expect(result.code).toBe('WORKTREE_CONTEXT_MISMATCH');
  });

  test('records explicit no-worktree instead of inventing the daemon cwd', () => {
    const probeWorktree = jest.fn();
    const result = resolveSessionWorktreeAdmission({}, { probeWorktree });

    expect(result).toEqual({
      success: true,
      worktree: null,
      worktreeId: null,
      metadata: null,
    });
    expect(probeWorktree).not.toHaveBeenCalled();
  });
});
