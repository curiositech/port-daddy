import { describe, expect, test } from '@jest/globals';
import {
  DEFAULT_GUARD_CONFIG,
  evaluateGuardFacts,
  mergePreCommitHook,
  normalizeGuardConfig,
} from '../../cli/commands/guard.js';

describe('Coordination Guard', () => {
  test('normalizes malformed config to safe defaults', () => {
    const config = normalizeGuardConfig({
      name: 'wrong',
      enabled: 'yes',
      mode: 'strict',
      requireSession: false,
      requireClaims: 'yes',
    });

    expect(config).toEqual(expect.objectContaining({
      name: 'Coordination Guard',
      enabled: DEFAULT_GUARD_CONFIG.enabled,
      mode: DEFAULT_GUARD_CONFIG.mode,
      requireSession: false,
      requireClaims: DEFAULT_GUARD_CONFIG.requireClaims,
    }));
  });

  test('passes when active session owns every checked file', () => {
    const result = evaluateGuardFacts({
      config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce' },
      active: true,
      agentId: 'agent-self',
      sessionId: 'session-self',
      files: ['src/a.ts'],
      ownersByFile: {
        'src/a.ts': [{ agentId: 'agent-self', sessionId: 'session-self' }],
      },
    });

    expect(result.passed).toBe(true);
    expect(result.shouldBlock).toBe(false);
    expect(result.violations).toEqual([]);
  });

  test('blocks in enforce mode without active Port Daddy context', () => {
    const result = evaluateGuardFacts({
      config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce' },
      active: false,
      files: ['src/a.ts'],
    });

    expect(result.passed).toBe(false);
    expect(result.shouldBlock).toBe(true);
    expect(result.violations.map(item => item.code)).toContain('no-active-session');
  });

  test('warn mode reports violations without blocking', () => {
    const result = evaluateGuardFacts({
      config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'warn' },
      active: true,
      agentId: 'agent-self',
      sessionId: 'session-self',
      files: ['src/a.ts'],
      ownersByFile: {
        'src/a.ts': [],
      },
    });

    expect(result.passed).toBe(false);
    expect(result.shouldBlock).toBe(false);
    expect(result.success).toBe(true);
    expect(result.violations.map(item => item.code)).toContain('unclaimed-file');
  });

  test('detects files claimed by another active session', () => {
    const result = evaluateGuardFacts({
      config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce' },
      active: true,
      agentId: 'agent-self',
      sessionId: 'session-self',
      files: ['src/shared.ts'],
      ownersByFile: {
        'src/shared.ts': [{ agentId: 'agent-other', sessionId: 'session-other' }],
      },
    });

    expect(result.shouldBlock).toBe(true);
    expect(result.violations[0]).toEqual(expect.objectContaining({
      code: 'claimed-by-other-session',
      file: 'src/shared.ts',
    }));
  });

  test('merges pre-commit hook before final exit 0', () => {
    const existing = [
      '#!/usr/bin/env zsh',
      'echo old guard',
      'exit 0',
      '',
    ].join('\n');

    const merged = mergePreCommitHook(existing);

    expect(merged).toContain('Port Daddy Coordination Guard');
    expect(merged.indexOf('pd guard check --staged --hook')).toBeLessThan(merged.lastIndexOf('exit 0'));
  });
});
