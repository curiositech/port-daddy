/**
 * Unit Tests for lib/merge-queue.ts
 *
 * Tests the merge queue: submission, ordering, execution, recovery,
 * conflict prediction, cleanup, and orchestrator delegation.
 * Uses in-memory SQLite and mock MergeExecutor -- no daemon required.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createOrchestratorRegistry } from '../../lib/orchestrator-plugins.js';
import { createMergeQueue } from '../../lib/merge-queue.js';

// ── Mock Factories ────────────────────────────────────────────────────────

function createMockActivityLog() {
  const logged = [];
  return {
    log(type, options = {}) {
      logged.push({ type, ...options });
      return { success: true };
    },
    getLogged() { return logged; },
  };
}

function createMockExecutor(overrides = {}) {
  const calls = { merge: [], revert: [], inspect: [], predictConflicts: [] };

  return {
    calls,
    async merge(opts) {
      calls.merge.push(opts);
      if (overrides.mergeResult) return overrides.mergeResult;
      return { success: true, mergeCommit: 'abc123' };
    },
    async revert(opts) {
      calls.revert.push(opts);
      if (overrides.revertResult) return overrides.revertResult;
      return { success: true };
    },
    async inspect(opts) {
      calls.inspect.push(opts);
      if (overrides.inspectResult) return overrides.inspectResult;
      return { passed: true };
    },
    async predictConflicts(opts) {
      calls.predictConflicts.push(opts);
      if (overrides.predictResult) return overrides.predictResult;
      return { hasConflicts: false, conflictFiles: [], conflictSurface: 0 };
    },
  };
}

function createDeps(db, overrides = {}) {
  const activityLog = overrides.activityLog || createMockActivityLog();
  const orchestratorRegistry = overrides.orchestratorRegistry || createOrchestratorRegistry(db, { activityLog });
  const executor = overrides.noExecutor ? undefined : (overrides.executor || createMockExecutor());

  return { orchestratorRegistry, executor, activityLog };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('MergeQueue', () => {
  let db;
  let mergeQueue;
  let deps;

  beforeEach(() => {
    db = createTestDb();
    deps = createDeps(db);
    mergeQueue = createMergeQueue(db, deps);
  });

  describe('submit', () => {
    test('accepts a valid submission', async () => {
      const result = await mergeQueue.submit({
        agentId: 'agent-1',
        branch: 'feature-auth',
        repository: '/tmp/myapp',
        claims: [{ path: 'src/auth.ts' }],
      });

      expect(result.success).toBe(true);
      expect(result.entryId).toBeDefined();
      expect(result.decision.approved).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry.branch).toBe('feature-auth');
      expect(result.entry.status).toBe('approved');
    });

    test('uses default baseBranch of main', async () => {
      const result = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'fix-bug', repository: '/tmp/repo', claims: [],
      });
      expect(result.entry.baseBranch).toBe('main');
    });

    test('uses provided baseBranch', async () => {
      const result = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'fix-bug', repository: '/tmp/repo',
        baseBranch: 'develop', claims: [],
      });
      expect(result.entry.baseBranch).toBe('develop');
    });

    test('rejects duplicate branch in same repository', async () => {
      await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const result = await mergeQueue.submit({
        agentId: 'agent-2', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      expect(result.success).toBe(false);
      expect(result.decision.reason).toContain('already in the merge queue');
    });

    test('allows same branch in different repositories', async () => {
      await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo-a', claims: [],
      });

      const result = await mergeQueue.submit({
        agentId: 'agent-2', branch: 'feature-x', repository: '/tmp/repo-b', claims: [],
      });

      expect(result.success).toBe(true);
    });

    test('stores metadata', async () => {
      const result = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo',
        claims: [], metadata: { urgency: 'high', reason: 'deadline' },
      });

      const entry = mergeQueue.get(result.entryId);
      expect(entry.metadata.urgency).toBe('high');
    });

    test('stores sessionId', async () => {
      const result = await mergeQueue.submit({
        agentId: 'agent-1', sessionId: 'session-abc',
        branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      expect(result.entry.sessionId).toBe('session-abc');
    });

    test('computes conflict surface against pending entries', async () => {
      await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-a', repository: '/tmp/repo',
        claims: [{ path: 'src/shared.ts' }, { path: 'src/auth.ts' }],
      });

      const result = await mergeQueue.submit({
        agentId: 'agent-2', branch: 'feature-b', repository: '/tmp/repo',
        claims: [{ path: 'src/shared.ts' }, { path: 'src/db.ts' }],
      });

      // 1 overlapping file out of 3 unique = 0.333...
      expect(result.entry.conflictSurface).toBeGreaterThan(0);
      expect(result.entry.conflictSurface).toBeLessThanOrEqual(1);
    });

    test('logs submission to activity log', async () => {
      await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const logs = deps.activityLog.getLogged();
      const submitLog = logs.find(l => l.type === 'merge.submitted');
      expect(submitLog).toBeDefined();
    });
  });

  describe('get', () => {
    test('retrieves an entry by ID', async () => {
      const result = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const entry = mergeQueue.get(result.entryId);
      expect(entry).not.toBeNull();
      expect(entry.agentId).toBe('agent-1');
      expect(entry.branch).toBe('feature-x');
    });

    test('returns null for nonexistent ID', () => {
      expect(mergeQueue.get(999)).toBeNull();
    });
  });

  describe('list', () => {
    test('lists all entries', async () => {
      await mergeQueue.submit({ agentId: 'a', branch: 'b1', repository: '/tmp', claims: [] });
      await mergeQueue.submit({ agentId: 'b', branch: 'b2', repository: '/tmp', claims: [] });

      const entries = mergeQueue.list();
      expect(entries.length).toBe(2);
    });

    test('filters by status', async () => {
      await mergeQueue.submit({ agentId: 'a', branch: 'b1', repository: '/tmp', claims: [] });
      await mergeQueue.submit({ agentId: 'b', branch: 'b2', repository: '/tmp', claims: [] });

      const approved = mergeQueue.list({ status: 'approved' });
      expect(approved.length).toBe(2);

      const merged = mergeQueue.list({ status: 'merged' });
      expect(merged.length).toBe(0);
    });

    test('filters by repository', async () => {
      await mergeQueue.submit({ agentId: 'a', branch: 'b1', repository: '/tmp/repo-a', claims: [] });
      await mergeQueue.submit({ agentId: 'b', branch: 'b2', repository: '/tmp/repo-b', claims: [] });

      const repoA = mergeQueue.list({ repository: '/tmp/repo-a' });
      expect(repoA.length).toBe(1);
      expect(repoA[0].repository).toBe('/tmp/repo-a');
    });

    test('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await mergeQueue.submit({ agentId: `a${i}`, branch: `b${i}`, repository: '/tmp', claims: [] });
      }

      const limited = mergeQueue.list({ limit: 3 });
      expect(limited.length).toBe(3);
    });
  });

  describe('listPending', () => {
    test('returns only pending/approved entries', async () => {
      await mergeQueue.submit({ agentId: 'a', branch: 'b1', repository: '/tmp', claims: [] });
      await mergeQueue.submit({ agentId: 'b', branch: 'b2', repository: '/tmp', claims: [] });

      const pending = mergeQueue.listPending();
      expect(pending.length).toBe(2);
      expect(pending.every(e => e.status === 'pending' || e.status === 'approved')).toBe(true);
    });
  });

  describe('ordering', () => {
    test('getOrder delegates to orchestrator', async () => {
      await mergeQueue.submit({ agentId: 'a', branch: 'b1', repository: '/tmp', claims: [] });
      await mergeQueue.submit({ agentId: 'b', branch: 'b2', repository: '/tmp', claims: [] });

      const sequence = await mergeQueue.getOrder();
      expect(sequence.order.length).toBe(2);
      expect(sequence.reasoning).toContain('FIFO');
    });

    test('reorder updates priorities', async () => {
      const r1 = await mergeQueue.submit({ agentId: 'a', branch: 'b1', repository: '/tmp', claims: [] });
      const r2 = await mergeQueue.submit({ agentId: 'b', branch: 'b2', repository: '/tmp', claims: [] });

      const sequence = await mergeQueue.reorder();
      expect(sequence.order.length).toBe(2);

      // After reorder, priorities should be set
      const entry1 = mergeQueue.get(r1.entryId);
      const entry2 = mergeQueue.get(r2.entryId);
      expect(entry1.priority).toBeGreaterThan(0);
      expect(entry2.priority).toBeGreaterThan(0);
    });
  });

  describe('execute', () => {
    test('executes a merge successfully', async () => {
      const { entryId } = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const result = await mergeQueue.execute(entryId);
      expect(result.success).toBe(true);
      expect(result.mergeCommit).toBe('abc123');

      const entry = mergeQueue.get(entryId);
      expect(entry.status).toBe('merged');
      expect(entry.mergeCommit).toBe('abc123');
      expect(entry.mergedAt).toBeDefined();
    });

    test('fails for nonexistent entry', async () => {
      const result = await mergeQueue.execute(999);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('fails for already merged entry', async () => {
      const executor = createMockExecutor();
      const localDeps = createDeps(db, { executor });
      const mq = createMergeQueue(db, localDeps);

      const { entryId } = await mq.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      await mq.execute(entryId);
      const result = await mq.execute(entryId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not pending/approved');
    });

    test('fails when no executor is configured', async () => {
      const localDeps = createDeps(db, { noExecutor: true });
      const mq = createMergeQueue(db, localDeps);

      const { entryId } = await mq.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const result = await mq.execute(entryId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No MergeExecutor configured');
    });

    test('calls executor.merge with correct params', async () => {
      const executor = createMockExecutor();
      const localDeps = createDeps(db, { executor });
      const mq = createMergeQueue(db, localDeps);

      const { entryId } = await mq.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo',
        baseBranch: 'develop', claims: [],
      });

      await mq.execute(entryId);
      expect(executor.calls.merge.length).toBe(1);
      expect(executor.calls.merge[0]).toMatchObject({
        repository: '/tmp/repo',
        branch: 'feature-x',
        baseBranch: 'develop',
      });
    });

    test('calls executor.inspect after successful merge', async () => {
      const executor = createMockExecutor();
      const localDeps = createDeps(db, { executor });
      const mq = createMergeQueue(db, localDeps);

      const { entryId } = await mq.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      await mq.execute(entryId);
      expect(executor.calls.inspect.length).toBe(1);
      expect(executor.calls.inspect[0].mergeCommit).toBe('abc123');
    });
  });

  describe('failure recovery', () => {
    test('handles merge conflict with revert', async () => {
      const executor = createMockExecutor({
        mergeResult: { success: false, error: 'CONFLICT in src/auth.ts', conflictFiles: ['src/auth.ts'] },
      });
      const localDeps = createDeps(db, { executor });
      const mq = createMergeQueue(db, localDeps);

      const { entryId } = await mq.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const result = await mq.execute(entryId);
      expect(result.success).toBe(false);
      expect(result.recoveryAction.action).toBe('revert'); // FIFO default

      const entry = mq.get(entryId);
      // No mergeCommit to revert (merge failed), so status should be 'reverted'
      expect(entry.status).toBe('reverted');
    });

    test('handles inspection failure', async () => {
      const executor = createMockExecutor({
        inspectResult: {
          passed: false,
          failureType: 'test_failure',
          details: '3 tests failed',
        },
      });
      const localDeps = createDeps(db, { executor });
      const mq = createMergeQueue(db, localDeps);

      const { entryId } = await mq.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const result = await mq.execute(entryId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('3 tests failed');

      // Should call revert on the merge commit
      expect(executor.calls.revert.length).toBe(1);
    });

    test('custom orchestrator can choose retry instead of revert', async () => {
      const executor = createMockExecutor({
        mergeResult: { success: false, error: 'conflict' },
      });
      const localDeps = createDeps(db, { executor });
      const mq = createMergeQueue(db, localDeps);

      // Register and activate a custom plugin that always retries
      localDeps.orchestratorRegistry.register({
        name: 'retry-always',
        version: '1.0.0',
        async onMergeSubmitted() { return { approved: true }; },
        async computeMergeOrder(q) { return { order: q.map(e => e.id) }; },
        async onMergeFailure() { return { action: 'retry', reason: 'try again', retryAfterMs: 1000 }; },
      });
      localDeps.orchestratorRegistry.activate('retry-always');

      const { entryId } = await mq.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const result = await mq.execute(entryId);
      expect(result.success).toBe(false);
      expect(result.recoveryAction.action).toBe('retry');

      // Entry should be back to pending (ready for retry)
      const entry = mq.get(entryId);
      expect(entry.status).toBe('pending');
    });
  });

  describe('inspect (standalone)', () => {
    test('inspects a merged entry', async () => {
      const executor = createMockExecutor();
      const localDeps = createDeps(db, { executor });
      const mq = createMergeQueue(db, localDeps);

      const { entryId } = await mq.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });
      await mq.execute(entryId);

      const result = await mq.inspect(entryId);
      expect(result.passed).toBe(true);
    });

    test('fails for entry without merge commit', async () => {
      const { entryId } = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const result = await mergeQueue.inspect(entryId);
      expect(result.passed).toBe(false);
      expect(result.details).toContain('no merge commit');
    });

    test('fails for nonexistent entry', async () => {
      const result = await mergeQueue.inspect(999);
      expect(result.passed).toBe(false);
      expect(result.details).toContain('not found');
    });
  });

  describe('predictConflicts', () => {
    test('returns empty predictions when queue is empty', async () => {
      const predictions = await mergeQueue.predictConflicts('feature-x', '/tmp/repo');
      expect(predictions).toEqual([]);
    });

    test('predicts against pending entries', async () => {
      const executor = createMockExecutor({
        predictResult: { hasConflicts: true, conflictFiles: ['src/shared.ts'], conflictSurface: 0.5 },
      });
      const localDeps = createDeps(db, { executor });
      const mq = createMergeQueue(db, localDeps);

      await mq.submit({
        agentId: 'agent-1', branch: 'feature-a', repository: '/tmp/repo', claims: [],
      });

      const predictions = await mq.predictConflicts('feature-b', '/tmp/repo');
      expect(predictions.length).toBe(1);
      expect(predictions[0].hasConflicts).toBe(true);
      expect(predictions[0].conflictFiles).toContain('src/shared.ts');
    });

    test('filters by repository', async () => {
      await mergeQueue.submit({ agentId: 'a', branch: 'b1', repository: '/tmp/repo-a', claims: [] });
      await mergeQueue.submit({ agentId: 'b', branch: 'b2', repository: '/tmp/repo-b', claims: [] });

      const predictions = await mergeQueue.predictConflicts('b3', '/tmp/repo-a');
      // Should only predict against the entry in repo-a
      expect(predictions.length).toBe(1);
    });
  });

  describe('remove', () => {
    test('removes a pending entry', async () => {
      const { entryId } = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const result = mergeQueue.remove(entryId);
      expect(result.success).toBe(true);
      expect(result.removed).toBe(true);
      expect(mergeQueue.get(entryId)).toBeNull();
    });

    test('returns false for nonexistent entry', () => {
      const result = mergeQueue.remove(999);
      expect(result.success).toBe(false);
    });

    test('refuses to remove a merging entry', async () => {
      // Manually set an entry to merging status
      const { entryId } = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });
      db.prepare('UPDATE merge_queue SET status = ? WHERE id = ?').run('merging', entryId);

      const result = mergeQueue.remove(entryId);
      expect(result.success).toBe(false);
    });
  });

  describe('cleanup', () => {
    test('removes old terminal-state entries', async () => {
      const { entryId } = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      // Mark as merged with old timestamp
      db.prepare('UPDATE merge_queue SET status = ?, submitted_at = ? WHERE id = ?')
        .run('merged', Date.now() - 30 * 24 * 60 * 60 * 1000, entryId);

      const result = mergeQueue.cleanup();
      expect(result.cleaned).toBe(1);
    });

    test('does not clean recent entries', async () => {
      const { entryId } = await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });
      db.prepare('UPDATE merge_queue SET status = ? WHERE id = ?').run('merged', entryId);

      const result = mergeQueue.cleanup();
      expect(result.cleaned).toBe(0);
    });

    test('does not clean pending entries', async () => {
      await mergeQueue.submit({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp/repo', claims: [],
      });

      const result = mergeQueue.cleanup();
      expect(result.cleaned).toBe(0);
    });
  });

  describe('stats', () => {
    test('returns status counts', async () => {
      await mergeQueue.submit({ agentId: 'a', branch: 'b1', repository: '/tmp', claims: [] });
      await mergeQueue.submit({ agentId: 'b', branch: 'b2', repository: '/tmp', claims: [] });

      const s = mergeQueue.stats();
      expect(s.total).toBe(2);
      expect(s.approved).toBe(2);
    });

    test('returns empty stats when queue is empty', () => {
      const s = mergeQueue.stats();
      expect(s.total).toBe(0);
    });
  });

  describe('schema idempotency', () => {
    test('creating merge queue twice on same db does not throw', () => {
      const mq2 = createMergeQueue(db, deps);
      expect(() => mq2.stats()).not.toThrow();
    });
  });
});
