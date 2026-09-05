import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import {
  asPostCommitAudit,
  DEFAULT_GUARD_CONFIG,
  describeGuardBlock,
  evaluateGuardFacts,
  extractClaimPaths,
  filterClaimsToRepo,
  fileNeedsRoadmapReceipt,
  localGuardConfigPath,
  mergePostCommitHook,
  mergePreCommitHook,
  normalizeGuardConfig,
  ownerQueryPaths,
  readGuardConfig,
  sharedGuardConfigPath,
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

  test('inherits guard policy from the shared git common dir', () => {
    const repo = mkdtempSync(join(tmpdir(), 'pd-guard-shared-'));
    try {
      const init = spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' });
      expect(init.status).toBe(0);

      const sharedPath = sharedGuardConfigPath(repo);
      expect(sharedPath).toBeTruthy();
      mkdirSync(dirname(sharedPath), { recursive: true });
      writeFileSync(sharedPath, JSON.stringify({
        ...DEFAULT_GUARD_CONFIG,
        enabled: true,
        mode: 'enforce',
      }));

      expect(readGuardConfig(repo)).toEqual(expect.objectContaining({
        enabled: true,
        mode: 'enforce',
      }));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('shared guard policy wins over stale local worktree defaults', () => {
    const repo = mkdtempSync(join(tmpdir(), 'pd-guard-shared-wins-'));
    try {
      const init = spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' });
      expect(init.status).toBe(0);

      const sharedPath = sharedGuardConfigPath(repo);
      expect(sharedPath).toBeTruthy();
      mkdirSync(dirname(sharedPath), { recursive: true });
      writeFileSync(sharedPath, JSON.stringify({
        ...DEFAULT_GUARD_CONFIG,
        enabled: true,
        mode: 'enforce',
      }));

      const localPath = localGuardConfigPath(repo);
      mkdirSync(dirname(localPath), { recursive: true });
      writeFileSync(localPath, JSON.stringify({
        ...DEFAULT_GUARD_CONFIG,
        enabled: false,
        mode: 'warn',
      }));

      expect(readGuardConfig(repo)).toEqual(expect.objectContaining({
        enabled: true,
        mode: 'enforce',
      }));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
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

  test('extracts active claim paths from daemon claim shapes', () => {
    expect(extractClaimPaths({
      claims: [
        { filePath: 'src/a.ts' },
        { file_path: 'src/b.ts' },
        { path: 'src/c.ts' },
        { path: '   ' },
      ],
    })).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);

    expect(extractClaimPaths({
      files: [{ path: 'src/fallback.ts' }],
    })).toEqual(['src/fallback.ts']);
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

  describe('the compulsion — no note, no commit (ADR-0050)', () => {
    const owned = {
      config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce' },
      active: true,
      agentId: 'agent-self',
      sessionId: 'session-self',
      files: ['src/a.ts'],
      ownersByFile: { 'src/a.ts': [{ agentId: 'agent-self', sessionId: 'session-self' }] },
    };

    test('an un-noted commit blocks the next commit', () => {
      const result = evaluateGuardFacts({ ...owned, commitsSinceLastNote: 1 });
      expect(result.shouldBlock).toBe(true);
      expect(result.violations.map(v => v.code)).toContain('rent-due');
    });

    test('a noted lease (0 un-noted commits) is not charged rent', () => {
      const result = evaluateGuardFacts({ ...owned, commitsSinceLastNote: 0 });
      expect(result.violations.map(v => v.code)).not.toContain('rent-due');
      expect(result.passed).toBe(true);
    });

    test('rent is not assessed when commitsSinceLastNote is absent (non-commit checks)', () => {
      const result = evaluateGuardFacts(owned); // no commitsSinceLastNote field
      expect(result.violations.map(v => v.code)).not.toContain('rent-due');
    });

    test('requireNotePerCommit:false opts the rent out entirely', () => {
      const result = evaluateGuardFacts({
        ...owned,
        config: { ...owned.config, requireNotePerCommit: false },
        commitsSinceLastNote: 5,
      });
      expect(result.violations.map(v => v.code)).not.toContain('rent-due');
    });

    test('warn mode surfaces rent-due without blocking', () => {
      const result = evaluateGuardFacts({
        ...owned,
        config: { ...owned.config, mode: 'warn' },
        commitsSinceLastNote: 2,
      });
      expect(result.shouldBlock).toBe(false);
      expect(result.violations.map(v => v.code)).toContain('rent-due');
    });

    test('rent is not charged without an active session (no-session wins)', () => {
      const result = evaluateGuardFacts({
        config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce' },
        active: false,
        commitsSinceLastNote: 3,
      });
      expect(result.violations.map(v => v.code)).not.toContain('rent-due');
      expect(result.violations.map(v => v.code)).toContain('no-active-session');
    });

    test('normalizeGuardConfig defaults requireNotePerCommit to true', () => {
      expect(normalizeGuardConfig({}).requireNotePerCommit).toBe(true);
      expect(normalizeGuardConfig({ requireNotePerCommit: false }).requireNotePerCommit).toBe(false);
    });
  });

  describe('the roadmap compulsion — coordination changes must touch roadmap_items', () => {
    const owned = {
      config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce' },
      active: true,
      agentId: 'agent-self',
      sessionId: 'session-self',
      ownersByFile: {},
      atCommitTime: true,
      nowMs: 10_000,
    };

    test('classifies coordination architecture surfaces as roadmap-bound', () => {
      expect(fileNeedsRoadmapReceipt('lib/swarm-coordination.ts')).toBe(true);
      expect(fileNeedsRoadmapReceipt('routes/parley.ts')).toBe(true);
      expect(fileNeedsRoadmapReceipt('docs/adr/0055-parley-wave-collapse.md')).toBe(true);
      expect(fileNeedsRoadmapReceipt('src/plain-widget.ts')).toBe(false);
    });

    test('blocks coordination changes without a recent roadmap receipt', () => {
      const result = evaluateGuardFacts({
        ...owned,
        files: ['lib/swarm-coordination.ts'],
        ownersByFile: {
          'lib/swarm-coordination.ts': [{ agentId: 'agent-self', sessionId: 'session-self' }],
        },
        roadmapReceipts: [],
      });

      expect(result.shouldBlock).toBe(true);
      expect(result.violations.map(v => v.code)).toContain('roadmap-receipt-missing');
    });

    test('does not credit a promoter from a shared roadmap touch timestamp', () => {
      const result = evaluateGuardFacts({
        ...owned,
        files: ['lib/swarm-coordination.ts'],
        ownersByFile: {
          'lib/swarm-coordination.ts': [{ agentId: 'agent-self', sessionId: 'session-self' }],
        },
        roadmapReceipts: [{
          slug: 'swarm-coordination',
          lastTouchedAt: 9_500,
          promotedByAgentId: 'agent-self',
          notes: [],
        }],
      });

      expect(result.violations.map(v => v.code)).toContain('roadmap-receipt-missing');
      expect(result.passed).toBe(false);
    });

    test('passes when this agent left a recent roadmap note receipt', () => {
      const result = evaluateGuardFacts({
        ...owned,
        files: ['routes/parley.ts'],
        ownersByFile: {
          'routes/parley.ts': [{ agentId: 'agent-self', sessionId: 'session-self' }],
        },
        roadmapReceipts: [{
          slug: 'parley',
          lastTouchedAt: 1,
          promotedByAgentId: 'agent-other',
          notes: [{ at: 9_900, by: 'agent-self', text: 'phase 0 parley' }],
        }],
      });

      expect(result.violations.map(v => v.code)).not.toContain('roadmap-receipt-missing');
      expect(result.passed).toBe(true);
    });

    test('does not require roadmap receipts for non-commit advisory checks', () => {
      const result = evaluateGuardFacts({
        ...owned,
        atCommitTime: false,
        files: ['lib/swarm-coordination.ts'],
        ownersByFile: {
          'lib/swarm-coordination.ts': [{ agentId: 'agent-self', sessionId: 'session-self' }],
        },
      });

      expect(result.violations.map(v => v.code)).not.toContain('roadmap-receipt-missing');
      expect(result.passed).toBe(true);
    });

    test('requireRoadmapForCoordinationChanges:false opts out', () => {
      const result = evaluateGuardFacts({
        ...owned,
        config: { ...owned.config, requireRoadmapForCoordinationChanges: false },
        files: ['docs/adr/0055-parley-wave-collapse.md'],
        ownersByFile: {
          'docs/adr/0055-parley-wave-collapse.md': [{ agentId: 'agent-self', sessionId: 'session-self' }],
        },
        roadmapReceipts: [],
      });

      expect(result.violations.map(v => v.code)).not.toContain('roadmap-receipt-missing');
      expect(result.passed).toBe(true);
    });
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

  test('merges post-commit hook as a non-blocking audit path', () => {
    const existing = [
      '#!/usr/bin/env zsh',
      'echo post commit work',
      '',
    ].join('\n');

    const merged = mergePostCommitHook(existing);

    expect(merged).toContain('Port Daddy Coordination Guard');
    expect(merged).toContain('pd guard check --post-commit --hook || true');
    expect(merged).toContain('port-daddy guard check --post-commit --hook || true');
    expect(merged).not.toContain('pd guard check --post-commit --hook || exit $?');
  });

  test('post-commit hook never blocks (cherry-pick / rebase / revert audit path)', () => {
    // git's post-commit hook fires on `commit`, `cherry-pick`, `rebase`,
    // `revert`, and `merge --no-ff` — the only enforcement path for the
    // commit-creation operations that bypass pre-commit. Per git docs,
    // post-commit's exit code is ignored ("cannot affect the outcome").
    // So the block must trail with `|| true` so any non-zero from
    // `pd guard check` does not surface as a hook script failure.
    const merged = mergePostCommitHook('');
    expect(merged).toMatch(/pd guard check --post-commit --hook \|\| true/);
    expect(merged).not.toMatch(/pd guard check --post-commit --hook(?!\s*\|\|)/);
    // No `exit 1` after the call — informational only.
    const guardSection = merged.split('# >>> Port Daddy Coordination Guard')[1] || '';
    expect(guardSection).not.toMatch(/^\s*exit 1\s*$/m);
  });

  test('mergePostCommitHook replaces an existing managed post-commit block in place', () => {
    // Same idempotency contract pre-commit has: re-running `pd guard
    // install` must not duplicate the post-commit block.
    const initial = mergePostCommitHook('');
    const reapplied = mergePostCommitHook(initial);
    const startMarkers = reapplied.match(/# >>> Port Daddy Coordination Guard/g) ?? [];
    expect(startMarkers).toHaveLength(1);
  });

  describe('filterClaimsToRepo', () => {
    // Regression coverage for the host-global claim-DB leak that blocked
    // a port-daddy rebase because a marketing agent in some unrelated
    // repo had claimed `apps/marketing/src/app/page.tsx`. The destructive-
    // verb path of runCheck() now filters claims through this helper so
    // only claims that actually belong to the caller's repo get evaluated.

    test('drops a claim path whose absolute form is outside the repo root', () => {
      const repo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-outside-'));
      try {
        // A path that resolves outside the repo via .. escaping
        const result = filterClaimsToRepo(['../elsewhere/file.ts'], repo);
        expect(result).toEqual([]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    test('drops a relative claim path for a file that does not exist in this repo', () => {
      // This is the exact production bug: a marketing agent in some
      // other repo claimed `apps/marketing/src/app/page.tsx`. That path
      // does NOT exist under our port-daddy worktree, so the filter
      // must drop it before it can refuse our rebase.
      const repo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-ghost-'));
      try {
        const result = filterClaimsToRepo(['apps/marketing/src/app/page.tsx'], repo);
        expect(result).toEqual([]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    test('keeps a relative claim that resolves to a real file inside the repo', () => {
      const repo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-inside-'));
      try {
        mkdirSync(join(repo, 'src'), { recursive: true });
        writeFileSync(join(repo, 'src', 'real.ts'), '// real\n');
        const result = filterClaimsToRepo(['src/real.ts'], repo);
        expect(result).toEqual(['src/real.ts']);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    test('keeps an absolute claim that lives inside the repo', () => {
      const repo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-abs-'));
      try {
        const filePath = join(repo, 'kept.ts');
        writeFileSync(filePath, '// kept\n');
        const result = filterClaimsToRepo([filePath], repo);
        expect(result).toEqual([filePath]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    test('drops an absolute claim that lives outside the repo even if the file exists', () => {
      const repo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-other-repo-'));
      const otherRepo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-other-'));
      try {
        const filePath = join(otherRepo, 'foreign.ts');
        writeFileSync(filePath, '// foreign\n');
        const result = filterClaimsToRepo([filePath], repo);
        expect(result).toEqual([]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
        rmSync(otherRepo, { recursive: true, force: true });
      }
    });

    test('mixed input keeps only the in-repo extant claims', () => {
      const repo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-mixed-'));
      try {
        writeFileSync(join(repo, 'a.ts'), '// a\n');
        writeFileSync(join(repo, 'b.ts'), '// b\n');
        const result = filterClaimsToRepo([
          'a.ts',                            // in-repo, exists → keep
          'apps/marketing/page.tsx',         // in-repo path but ghost → drop
          'b.ts',                            // in-repo, exists → keep
          '../escape.ts',                    // outside via .. → drop
          '',                                // empty → drop
          '   ',                             // whitespace → drop
        ], repo);
        expect(result.sort()).toEqual(['a.ts', 'b.ts']);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    // Regression coverage for the symlink-escape vector flagged in
    // skeptical review of PR #74: `path.resolve()` collapses `..` but
    // does NOT follow symlinks. Without `realpathSync` canonicalization,
    // a symlink claim that LIVES inside the repo but POINTS outside
    // would pass `relativePathInside(root, abs)` (because `abs` itself
    // is inside) and re-enable the cross-project leak the PR fixes.

    test('drops a symlink-claim that points outside the repo', () => {
      const repo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-symlink-out-'));
      const elsewhere = mkdtempSync(join(tmpdir(), 'pd-guard-filter-elsewhere-'));
      try {
        const realTarget = join(elsewhere, 'foreign.ts');
        writeFileSync(realTarget, '// foreign\n');
        const linkPath = join(repo, 'looks-local.ts');
        symlinkSync(realTarget, linkPath);
        // The link path is inside `repo`, the target is not.
        // `realpathSync` must canonicalize the link before containment.
        const result = filterClaimsToRepo(['looks-local.ts'], repo);
        expect(result).toEqual([]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
        rmSync(elsewhere, { recursive: true, force: true });
      }
    });

    test('keeps a real file in a repo whose root path contains a symlink component', () => {
      // On macOS, `os.tmpdir()` returns `/var/folders/...`, but `/var`
      // is a symlink to `/private/var`. Without canonicalizing the
      // repo root itself, paths under the resolved real root would
      // appear "outside" the un-resolved root prefix and be dropped.
      const repo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-tmpdir-symlink-'));
      try {
        writeFileSync(join(repo, 'kept.ts'), '// kept\n');
        const result = filterClaimsToRepo(['kept.ts'], repo);
        expect(result).toEqual(['kept.ts']);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    test('drops a broken symlink (target does not exist)', () => {
      const repo = mkdtempSync(join(tmpdir(), 'pd-guard-filter-broken-link-'));
      try {
        const linkPath = join(repo, 'dangling.ts');
        symlinkSync(join(repo, 'never-existed.ts'), linkPath);
        const result = filterClaimsToRepo(['dangling.ts'], repo);
        expect(result).toEqual([]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    test('returns [] when repoRoot itself does not exist', () => {
      // Catches the realpathSync-on-root throw path. Without the
      // try/catch the entire filter would error instead of degrading
      // to "no claims belong here".
      const result = filterClaimsToRepo(['anything.ts'], '/nonexistent-repo-root-pd-guard-test');
      expect(result).toEqual([]);
    });
  });
});

describe('describeGuardBlock — HITL escalation policy', () => {
  const enforce = { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce' };

  test('returns null when the result is not a block', () => {
    const result = evaluateGuardFacts({ config: enforce, active: true, agentId: 'a', sessionId: 's', files: [] });
    expect(result.shouldBlock).toBe(false);
    expect(describeGuardBlock(result)).toBeNull();
  });

  test.each(['rent-due', 'rent-unverifiable', 'daemon-unreachable', 'claimed-by-other-session'])(
    'post-commit %s findings never issue a false commit-failure notification', (code) => {
      const result = {
        shouldBlock: true,
        violations: [{ code, severity: 'critical', message: 'Outstanding finding' }],
      };
      expect(describeGuardBlock(result, { hook: true, postCommit: true })).toBeNull();
      expect(describeGuardBlock(asPostCommitAudit(result, 'a'.repeat(40)), { hook: true })).toBeNull();
    },
  );

  test('no active session → structural; notifies the operator even outside the git hook', () => {
    const result = evaluateGuardFacts({ config: enforce, active: false, files: ['src/a.ts'] });
    const notice = describeGuardBlock(result, { hook: false });
    expect(notice).not.toBeNull();
    expect(notice.severity).toBe('structural');
    expect(notice.notifyOperator).toBe(true); // structural always escalates
    expect(notice.title).toMatch(/COORDINATION LAYER DOWN/);
  });

  test('daemon unreachable → structural and always notifies', () => {
    const result = evaluateGuardFacts({ config: enforce, active: false, daemonReachable: false, files: ['src/a.ts'] });
    const notice = describeGuardBlock(result, { hook: false });
    expect(notice.severity).toBe('structural');
    expect(notice.notifyOperator).toBe(true);
  });

  test('file owned by another session → conflict; notifies only at real commit time (hook)', () => {
    const result = evaluateGuardFacts({
      config: enforce, active: true, agentId: 'agent-self', sessionId: 'session-self',
      files: ['src/shared.ts'],
      ownersByFile: { 'src/shared.ts': [{ agentId: 'agent-other', sessionId: 'session-other' }] },
    });
    expect(describeGuardBlock(result, { hook: false }).notifyOperator).toBe(false);
    const hooked = describeGuardBlock(result, { hook: true });
    expect(hooked.severity).toBe('conflict');
    expect(hooked.notifyOperator).toBe(true);
  });

  test('unclaimed file → requirement; notifies only at commit time, not on manual checks', () => {
    const result = evaluateGuardFacts({
      config: enforce, active: true, agentId: 'agent-self', sessionId: 'session-self',
      files: ['src/a.ts'], ownersByFile: { 'src/a.ts': [] },
    });
    const manual = describeGuardBlock(result, { hook: false });
    expect(manual.severity).toBe('requirement');
    expect(manual.notifyOperator).toBe(false);
    expect(describeGuardBlock(result, { hook: true }).notifyOperator).toBe(true);
  });
});

describe('post-commit audit — real Git commits and executable CLI handler', () => {
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve('tsx/esm');
  const handlerUrl = new URL('../../cli/commands/guard.ts', import.meta.url).href;
  let repo;
  let server;
  let daemonUrl;
  let latestNoteAt = 0;
  let notesStatus = 200;
  const requests = [];

  function git(args, extraEnv = {}) {
    const result = spawnSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    });
    expect(result.status).toBe(0);
    return result.stdout.trim();
  }

  async function check(options = {}, positional = ['check']) {
    // Invoke the actual handler in a separate process: output and process.exit
    // are part of the contract, not just the pure evaluator's return values.
    const env = {
      PATH: `${join(repo, 'fixture-bin')}:${process.env.PATH}`,
      TMPDIR: tmpdir(),
      PORT_DADDY_URL: daemonUrl,
      PORT_DADDY_FORCE_TCP: '1',
      PORT_DADDY_PREFIX: join(repo, 'state'),
      PORT_DADDY_CONTEXT_DIR: join(repo, 'context'),
      PORT_DADDY_CONTEXT_SLOT: 'guard-test',
      PD_AGENT_ID: 'agent-guard-test',
      PD_SESSION_ID: 'session-guard-test',
      PORT_DADDY_DISABLE_KEYCHAIN: '1',
      PORT_DADDY_NO_RETRY: '1',
      PD_TEST: '1',
      GUARD_TEST_NOTICE: join(repo, 'notification'),
      NO_COLOR: '1',
    };
    const child = spawn(process.execPath, [
      '--import', tsxLoader, '--input-type=module', '-e',
      `import { handleGuard } from ${JSON.stringify(handlerUrl)}; await handleGuard(${JSON.stringify(positional)}, ${JSON.stringify(options)});`,
    ], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
    try {
      const [code, signal] = await once(child, 'close');
      expect(signal).toBeNull();
      return { code, stdout, stderr };
    } finally {
      clearTimeout(timeout);
    }
  }

  beforeEach(async () => {
    requests.length = 0;
    latestNoteAt = 0;
    notesStatus = 200;
    repo = mkdtempSync(join(tmpdir(), 'pd-guard-audit-'));
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Guard Fixture']);
    git(['config', 'user.email', 'guard-fixture@example.invalid']);
    git(['config', 'commit.gpgsign', 'false']);
    // The fixture never loads the operator's hooks or global credential store.
    const hooks = join(repo, 'empty-hooks');
    mkdirSync(hooks);
    git(['config', 'core.hooksPath', hooks]);
    const fixtureBin = join(repo, 'fixture-bin');
    mkdirSync(fixtureBin);
    writeFileSync(join(fixtureBin, 'osascript'), '#!/bin/sh\nprintf "notified\\n" > "$GUARD_TEST_NOTICE"\n', { mode: 0o755 });
    writeFileSync(join(repo, 'fixture.txt'), 'base\n');
    git(['add', 'fixture.txt']);
    git(['commit', '-m', 'fixture base'], {
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    });
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(['switch', '-c', 'fixture-work']);
    const guardPath = localGuardConfigPath(repo);
    mkdirSync(dirname(guardPath), { recursive: true });
    writeFileSync(guardPath, JSON.stringify({ ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce' }));
    server = createServer((request, response) => {
      requests.push({ method: request.method, path: request.url });
      const path = new URL(request.url, 'http://fixture.invalid').pathname;
      response.setHeader('Content-Type', 'application/json');
      if (path === '/sugar/whoami') {
        response.end(JSON.stringify({ active: true, agentId: 'agent-guard-test', sessionId: 'session-guard-test' }));
      } else if (path === '/files/who-owns') {
        response.end(JSON.stringify({ owners: [{ agentId: 'agent-guard-test', sessionId: 'session-guard-test' }] }));
      } else if (path === '/sessions/session-guard-test/notes') {
        response.statusCode = notesStatus;
        response.end(JSON.stringify({ notes: [{ createdAt: latestNoteAt }] }));
      } else if (path === '/sessions/session-guard-test') {
        response.end(JSON.stringify({ files: ['fixture.txt'] }));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: 'Unexpected fixture request' }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    daemonUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  test('a just-created commit remains successful; debt blocks only the next pre-commit until a note', async () => {
    latestNoteAt = Date.parse('2020-01-01T00:00:00Z');
    writeFileSync(join(repo, 'fixture.txt'), 'first change\n');
    git(['add', 'fixture.txt']);
    expect((await check({ staged: true })).code).toBe(0);
    git(['commit', '-m', 'first fixture change'], {
      GIT_AUTHOR_DATE: '2020-01-02T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-02T00:00:00Z',
    });
    const commit = git(['rev-parse', 'HEAD']);
    const report = await check({ 'post-commit': true, hook: true });
    expect(report.code).toBe(0);
    expect(report.stdout).toContain(`Commit ${commit} exists`);
    expect(report.stdout).toContain('post-commit audit needs attention');
    expect(report.stdout).toContain('Persistence: not attempted');
    expect(report.stderr).toMatch(/1 commit\(s\) on this sandbox have no coordination note/);
    expect(report.stderr).toContain('before the next commit');
    expect(report.stdout + report.stderr).not.toMatch(/commit blocked|ERROR:|Escalating to the operator/);
    expect(git(['rev-parse', 'HEAD'])).toBe(commit);

    const json = JSON.parse((await check({ 'post-commit': true, json: true })).stdout);
    expect(json).toMatchObject({ success: true, passed: false, shouldBlock: false, postCommitAudit: {
      commit, status: 'issues', preCommitWouldBlock: true, persistence: 'not-attempted',
    } });
    expect(json.violations.map(v => v.code)).toContain('rent-due');
    expect((await check({ staged: true })).code).toBe(1);

    latestNoteAt = Date.parse('2020-01-03T00:00:00Z');
    expect((await check({ staged: true })).code).toBe(0);
    expect(JSON.parse((await check({ 'post-commit': true, json: true })).stdout).postCommitAudit.status).toBe('passed');
  });

  test('multiple rewritten commits retain their full debt rather than subtracting the newest commit', async () => {
    latestNoteAt = Date.parse('2020-01-01T00:00:00Z');
    writeFileSync(join(repo, 'fixture.txt'), 'first change\n');
    git(['add', 'fixture.txt']);
    git(['commit', '-m', 'first fixture change'], {
      GIT_AUTHOR_DATE: '2020-01-02T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-02T00:00:00Z',
    });
    git(['commit', '--amend', '--no-edit'], {
      GIT_AUTHOR_DATE: '2020-01-02T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-04T00:00:00Z',
    });
    writeFileSync(join(repo, 'fixture.txt'), 'second change\n');
    git(['add', 'fixture.txt']);
    git(['commit', '-m', 'second fixture change'], {
      GIT_AUTHOR_DATE: '2020-01-05T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-05T00:00:00Z',
    });
    git(['commit', '--amend', '--no-edit'], {
      GIT_AUTHOR_DATE: '2020-01-05T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-06T00:00:00Z',
    });
    const audit = await check({ 'post-commit': true, json: true });
    expect(audit.code).toBe(0);
    const report = JSON.parse(audit.stdout);
    expect(report.violations.find(v => v.code === 'rent-due').message).toMatch(/2 commit\(s\)/);
    expect((await check({ staged: true })).code).toBe(1);
  });

  test('failed note reads report unverifiable audit without claiming the commit failed or was persisted', async () => {
    notesStatus = 503;
    try {
      const audit = await check({ 'post-commit': true, hook: true, json: true });
      expect(audit.code).toBe(0);
      expect(audit.stderr).not.toMatch(/commit blocked|ERROR:|Escalating/);
      expect(JSON.parse(audit.stdout)).toMatchObject({ passed: false, shouldBlock: false,
        postCommitAudit: { status: 'unverifiable', persistence: 'not-attempted', preCommitWouldBlock: true },
      });
      expect(existsSync(join(repo, 'notification'))).toBe(false);
    } finally {
      notesStatus = 200;
    }
  });

  test('unresolved commit fails the audit command without asserting an outcome or escalating a commit block', async () => {
    const audit = await check({ 'post-commit': true, commit: 'does-not-exist', hook: true, json: true });
    expect(audit.code).toBe(1);
    expect(audit.stderr).not.toMatch(/commit blocked|ERROR:|Escalating/);
    expect(JSON.parse(audit.stdout)).toMatchObject({ success: false, passed: false, shouldBlock: false,
      postCommitAudit: { commit: null, status: 'unverifiable', persistence: 'not-attempted' },
    });
  });

  test.each([{ staged: true }, { 'git-verb': 'rebase' }])('post-commit cannot suppress a different enforcement check: %j', async (options) => {
    const audit = await check({ 'post-commit': true, ...options });
    expect(audit.code).toBe(1);
    expect(audit.stderr).toContain('cannot be combined');
  });

  test.each([['fixture.txt'], ['check', 'fixture.txt']])('post-commit rejects positional file checks: %j', async (...positional) => {
    const audit = await check({ 'post-commit': true }, positional);
    expect(audit.code).toBe(1);
    expect(audit.stderr).toContain('cannot be combined');
  });

  test('the audit never writes a fake coordination note or receipt', async () => {
    expect((await check({ 'post-commit': true })).code).toBe(0);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
    expect(existsSync(join(repo, 'notification'))).toBe(false);
  });
});
