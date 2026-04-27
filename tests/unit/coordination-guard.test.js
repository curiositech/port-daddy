import { describe, expect, test } from '@jest/globals';
import {
  DEFAULT_GUARD_CONFIG,
  evaluateGuardFacts,
  mergePreCommitHook,
  normalizeGuardConfig,
  ownerQueryPaths,
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

  test('queries relative staged paths and absolute claim paths for the same repo file', () => {
    expect(ownerQueryPaths('docs/recovery/CURRENT-WORK.md', '/repo')).toEqual([
      'docs/recovery/CURRENT-WORK.md',
      '/repo/docs/recovery/CURRENT-WORK.md',
    ]);

    expect(ownerQueryPaths('/repo/.cartographer/status.md', '/repo')).toEqual([
      '/repo/.cartographer/status.md',
      '.cartographer/status.md',
    ]);
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

  test('managed pre-commit block exits before later hook success paths when guard fails', () => {
    const existing = [
      '#!/usr/bin/env zsh',
      'echo old guard',
      'exit 0',
      '',
    ].join('\n');

    const merged = mergePreCommitHook(existing);

    expect(merged).toContain('pd guard check --staged --hook || exit $?');
    expect(merged).toContain('port-daddy guard check --staged --hook || exit $?');
    expect(merged.indexOf('pd guard check --staged --hook || exit $?')).toBeLessThan(
      merged.lastIndexOf('exit 0'),
    );
  });

  test('upgrades legacy guard block missing || exit $? in place', () => {
    // The pre-fix hook format propagated nothing — `pd guard check` would
    // print ENFORCE errors but the surrounding `if/elif/else` discarded
    // the exit code, then the script's trailing `exit 0` ran anyway.
    // mergePreCommitHook MUST replace the legacy block (matched by markers)
    // with the new block, restoring exit-code propagation in both branches.
    const legacyBlock = [
      '#!/usr/bin/env zsh',
      '',
      '# >>> Port Daddy Coordination Guard',
      'if command -v pd >/dev/null 2>&1; then',
      '  pd guard check --staged --hook',
      'elif command -v port-daddy >/dev/null 2>&1; then',
      '  port-daddy guard check --staged --hook',
      'else',
      '  echo "Coordination Guard: pd command not found." >&2',
      '  exit 1',
      'fi',
      '# <<< Port Daddy Coordination Guard',
      'exit 0',
      '',
    ].join('\n');

    const merged = mergePreCommitHook(legacyBlock);

    expect(merged).toContain('pd guard check --staged --hook || exit $?');
    expect(merged).toContain('port-daddy guard check --staged --hook || exit $?');
    // No bare lines remain — every guard call propagates.
    expect(merged).not.toMatch(/^\s*pd guard check --staged --hook$/m);
    expect(merged).not.toMatch(/^\s*port-daddy guard check --staged --hook$/m);
    // Only one managed block — replacement, not duplication.
    const startMarkers = merged.match(/# >>> Port Daddy Coordination Guard/g) ?? [];
    expect(startMarkers).toHaveLength(1);
  });
});
