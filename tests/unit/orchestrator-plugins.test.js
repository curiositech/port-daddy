/**
 * Unit Tests for lib/orchestrator-plugins.ts
 *
 * Tests the plugin registry, default FIFO orchestrator,
 * hot-swapping, delegation, and lifecycle hooks.
 * Uses in-memory SQLite -- no daemon required.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import {
  createOrchestratorRegistry,
  defaultOrchestrator,
} from '../../lib/orchestrator-plugins.js';

// ── Helpers ───────────────────────────────────────────────────────────────

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

function createCustomPlugin(overrides = {}) {
  return {
    name: overrides.name || 'custom-priority',
    version: overrides.version || '2.0.0',
    async onMergeSubmitted(submission) {
      // Priority based on claim count
      const priority = submission.claims.length * 10;
      return { approved: true, priority, reason: 'Custom: priority by claim count' };
    },
    async computeMergeOrder(queue) {
      // Reverse FIFO (LIFO) for testing
      const sorted = [...queue]
        .filter(e => e.status === 'pending' || e.status === 'approved')
        .sort((a, b) => b.submittedAt - a.submittedAt);
      return { order: sorted.map(e => e.id), reasoning: 'Custom: LIFO order' };
    },
    async onMergeFailure(failure) {
      return { action: 'retry', reason: 'Custom: always retry', retryAfterMs: 5000 };
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('OrchestratorRegistry', () => {
  let db;
  let registry;
  let activityLog;

  beforeEach(() => {
    db = createTestDb();
    activityLog = createMockActivityLog();
    registry = createOrchestratorRegistry(db, { activityLog });
  });

  describe('initialization', () => {
    test('starts with default FIFO plugin active', () => {
      const active = registry.getActive();
      expect(active.name).toBe('fifo');
      expect(active.version).toBe('1.0.0');
    });

    test('default plugin is listed', () => {
      const plugins = registry.listPlugins();
      expect(plugins.length).toBe(1);
      expect(plugins[0].name).toBe('fifo');
      expect(plugins[0].isActive).toBe(true);
    });

    test('table is created idempotently', () => {
      // Creating a second registry on the same db should not throw
      const registry2 = createOrchestratorRegistry(db);
      expect(registry2.getActive().name).toBe('fifo');
    });
  });

  describe('register', () => {
    test('registers a custom plugin', () => {
      const plugin = createCustomPlugin();
      const result = registry.register(plugin);
      expect(result.success).toBe(true);
      expect(result.name).toBe('custom-priority');
    });

    test('registered plugin appears in list', () => {
      registry.register(createCustomPlugin());
      const plugins = registry.listPlugins();
      expect(plugins.length).toBe(2);
      expect(plugins.some(p => p.name === 'custom-priority')).toBe(true);
    });

    test('re-registering same name updates version', () => {
      registry.register(createCustomPlugin({ version: '1.0.0' }));
      registry.register(createCustomPlugin({ version: '2.0.0' }));
      const plugins = registry.listPlugins();
      const custom = plugins.find(p => p.name === 'custom-priority');
      expect(custom.version).toBe('2.0.0');
    });

    test('rejects plugin without name', () => {
      expect(() => registry.register({ name: '', version: '1.0.0', onMergeSubmitted: async () => ({}), computeMergeOrder: async () => ({}), onMergeFailure: async () => ({}) }))
        .toThrow('Plugin must have name and version');
    });

    test('rejects plugin without required methods', () => {
      expect(() => registry.register({ name: 'bad', version: '1.0.0' }))
        .toThrow('Plugin must implement onMergeSubmitted, computeMergeOrder, and onMergeFailure');
    });

    test('logs registration to activity log', () => {
      registry.register(createCustomPlugin());
      const logs = activityLog.getLogged();
      const regLog = logs.find(l => l.type === 'orchestrator.plugin_registered');
      expect(regLog).toBeDefined();
      expect(regLog.metadata.name).toBe('custom-priority');
    });
  });

  describe('unregister', () => {
    test('removes a registered plugin', () => {
      registry.register(createCustomPlugin());
      const result = registry.unregister('custom-priority');
      expect(result.success).toBe(true);
      expect(result.removed).toBe(true);
      const plugins = registry.listPlugins();
      expect(plugins.length).toBe(1);
    });

    test('cannot unregister the default fifo plugin', () => {
      const result = registry.unregister('fifo');
      expect(result.success).toBe(false);
      expect(result.removed).toBe(false);
    });

    test('unregistering active plugin falls back to fifo', () => {
      const plugin = createCustomPlugin();
      registry.register(plugin);
      registry.activate('custom-priority');
      expect(registry.getActive().name).toBe('custom-priority');

      registry.unregister('custom-priority');
      expect(registry.getActive().name).toBe('fifo');
    });

    test('unregistering non-existent plugin returns removed=false', () => {
      const result = registry.unregister('nonexistent');
      expect(result.success).toBe(true);
      expect(result.removed).toBe(false);
    });
  });

  describe('activate (hot-swap)', () => {
    test('activates a registered plugin', () => {
      registry.register(createCustomPlugin());
      const result = registry.activate('custom-priority');
      expect(result.success).toBe(true);
      expect(result.active).toBe('custom-priority');
      expect(registry.getActive().name).toBe('custom-priority');
    });

    test('throws when activating unregistered plugin', () => {
      expect(() => registry.activate('nonexistent'))
        .toThrow('Plugin "nonexistent" not found');
    });

    test('marks only the active plugin in the database', () => {
      registry.register(createCustomPlugin());
      registry.activate('custom-priority');
      const plugins = registry.listPlugins();
      const active = plugins.filter(p => p.isActive);
      expect(active.length).toBe(1);
      expect(active[0].name).toBe('custom-priority');
    });

    test('can switch back to fifo', () => {
      registry.register(createCustomPlugin());
      registry.activate('custom-priority');
      registry.activate('fifo');
      expect(registry.getActive().name).toBe('fifo');
    });

    test('logs activation to activity log', () => {
      registry.register(createCustomPlugin());
      registry.activate('custom-priority');
      const logs = activityLog.getLogged();
      const activationLog = logs.find(l => l.type === 'orchestrator.plugin_activated');
      expect(activationLog).toBeDefined();
      expect(activationLog.metadata.previous).toBe('fifo');
      expect(activationLog.metadata.active).toBe('custom-priority');
    });
  });

  describe('delegation', () => {
    test('delegates onMergeSubmitted to active plugin', async () => {
      registry.register(createCustomPlugin());
      registry.activate('custom-priority');

      const decision = await registry.onMergeSubmitted({
        agentId: 'agent-1',
        branch: 'feature-x',
        repository: '/tmp/repo',
        claims: [{ path: 'a.ts' }, { path: 'b.ts' }],
      });

      expect(decision.approved).toBe(true);
      expect(decision.priority).toBe(20); // 2 claims * 10
      expect(decision.reason).toContain('Custom');
    });

    test('delegates computeMergeOrder to active plugin', async () => {
      registry.register(createCustomPlugin());
      registry.activate('custom-priority');

      const queue = [
        { id: 1, status: 'approved', submittedAt: 1000, agentId: 'a', branch: 'b1', repository: '/tmp', baseBranch: 'main', claims: [], conflictSurface: 0, priority: 0, mergedAt: null, mergeCommit: null, failureReason: null, metadata: {} },
        { id: 2, status: 'approved', submittedAt: 2000, agentId: 'b', branch: 'b2', repository: '/tmp', baseBranch: 'main', claims: [], conflictSurface: 0, priority: 0, mergedAt: null, mergeCommit: null, failureReason: null, metadata: {} },
      ];

      const sequence = await registry.computeMergeOrder(queue);
      // Custom plugin does LIFO
      expect(sequence.order).toEqual([2, 1]);
      expect(sequence.reasoning).toContain('LIFO');
    });

    test('delegates onMergeFailure to active plugin', async () => {
      registry.register(createCustomPlugin());
      registry.activate('custom-priority');

      const recovery = await registry.onMergeFailure({
        entryId: 1, agentId: 'agent-1', branch: 'feature-x',
        repository: '/tmp/repo', failureType: 'test_failure', details: 'tests failed',
      });

      expect(recovery.action).toBe('retry'); // Custom always retries
      expect(recovery.retryAfterMs).toBe(5000);
    });

    test('fifo delegates correctly', async () => {
      const decision = await registry.onMergeSubmitted({
        agentId: 'agent-1', branch: 'feature-x', repository: '/tmp', claims: [],
      });
      expect(decision.approved).toBe(true);
      expect(decision.reason).toContain('FIFO');
    });
  });

  describe('optional hooks', () => {
    test('onTick returns empty array when hook is not defined', async () => {
      const actions = await registry.onTick({
        activeAgents: 3, queueDepth: 1, pendingMerges: [], recentFailures: [], timestamp: Date.now(),
      });
      expect(actions).toEqual([]);
    });

    test('onTick delegates when hook is defined', async () => {
      const plugin = createCustomPlugin({
        async onTick(state) {
          return [{ type: 'notify', payload: { message: `Queue depth: ${state.queueDepth}` } }];
        },
      });
      registry.register(plugin);
      registry.activate(plugin.name);

      const actions = await registry.onTick({
        activeAgents: 3, queueDepth: 5, pendingMerges: [], recentFailures: [], timestamp: Date.now(),
      });
      expect(actions.length).toBe(1);
      expect(actions[0].type).toBe('notify');
    });

    test('onAgentRegistered does nothing when hook is not defined', async () => {
      // Should not throw
      await registry.onAgentRegistered({
        id: 'agent-1', registeredAt: Date.now(), lastHeartbeat: Date.now(),
      });
    });

    test('onAgentDied returns queue strategy when hook is not defined', async () => {
      const strategy = await registry.onAgentDied(
        { id: 'agent-1', registeredAt: Date.now(), lastHeartbeat: Date.now() },
        { id: 'session-1', purpose: 'test', status: 'active', notes: [], fileClaims: [] }
      );
      expect(strategy.action).toBe('queue');
    });

    test('onAgentDied delegates when hook is defined', async () => {
      const plugin = createCustomPlugin({
        async onAgentDied(agent, session) {
          return { action: 'auto_reassign', reason: `Reassigning ${agent.id}`, priority: 10 };
        },
      });
      registry.register(plugin);
      registry.activate(plugin.name);

      const strategy = await registry.onAgentDied(
        { id: 'agent-1', registeredAt: Date.now(), lastHeartbeat: Date.now() },
        { id: 'session-1', purpose: 'test', status: 'active', notes: [], fileClaims: [] }
      );
      expect(strategy.action).toBe('auto_reassign');
    });
  });

  describe('getPlugin', () => {
    test('returns registered plugin instance', () => {
      const plugin = createCustomPlugin();
      registry.register(plugin);
      const retrieved = registry.getPlugin('custom-priority');
      expect(retrieved).toBe(plugin);
    });

    test('returns undefined for unknown plugin', () => {
      expect(registry.getPlugin('nonexistent')).toBeUndefined();
    });
  });
});

describe('defaultOrchestrator', () => {
  test('has correct name and version', () => {
    expect(defaultOrchestrator.name).toBe('fifo');
    expect(defaultOrchestrator.version).toBe('1.0.0');
  });

  test('onMergeSubmitted always approves', async () => {
    const decision = await defaultOrchestrator.onMergeSubmitted({
      agentId: 'a', branch: 'b', repository: '/tmp', claims: [],
    });
    expect(decision.approved).toBe(true);
  });

  test('computeMergeOrder sorts by submittedAt ascending (FIFO)', async () => {
    const queue = [
      { id: 3, status: 'approved', submittedAt: 3000, agentId: 'c', branch: 'b3', repository: '/tmp', baseBranch: 'main', claims: [], conflictSurface: 0, priority: 0, mergedAt: null, mergeCommit: null, failureReason: null, metadata: {} },
      { id: 1, status: 'pending', submittedAt: 1000, agentId: 'a', branch: 'b1', repository: '/tmp', baseBranch: 'main', claims: [], conflictSurface: 0, priority: 0, mergedAt: null, mergeCommit: null, failureReason: null, metadata: {} },
      { id: 2, status: 'approved', submittedAt: 2000, agentId: 'b', branch: 'b2', repository: '/tmp', baseBranch: 'main', claims: [], conflictSurface: 0, priority: 0, mergedAt: null, mergeCommit: null, failureReason: null, metadata: {} },
    ];

    const sequence = await defaultOrchestrator.computeMergeOrder(queue);
    expect(sequence.order).toEqual([1, 2, 3]);
  });

  test('computeMergeOrder filters out non-pending/approved entries', async () => {
    const queue = [
      { id: 1, status: 'pending', submittedAt: 1000, agentId: 'a', branch: 'b1', repository: '/tmp', baseBranch: 'main', claims: [], conflictSurface: 0, priority: 0, mergedAt: null, mergeCommit: null, failureReason: null, metadata: {} },
      { id: 2, status: 'merged', submittedAt: 2000, agentId: 'b', branch: 'b2', repository: '/tmp', baseBranch: 'main', claims: [], conflictSurface: 0, priority: 0, mergedAt: 3000, mergeCommit: 'abc', failureReason: null, metadata: {} },
      { id: 3, status: 'failed', submittedAt: 3000, agentId: 'c', branch: 'b3', repository: '/tmp', baseBranch: 'main', claims: [], conflictSurface: 0, priority: 0, mergedAt: null, mergeCommit: null, failureReason: 'oops', metadata: {} },
    ];

    const sequence = await defaultOrchestrator.computeMergeOrder(queue);
    expect(sequence.order).toEqual([1]);
  });

  test('onMergeFailure returns revert action', async () => {
    const recovery = await defaultOrchestrator.onMergeFailure({
      entryId: 1, agentId: 'a', branch: 'b', repository: '/tmp',
      failureType: 'conflict', details: 'merge conflict in foo.ts',
    });
    expect(recovery.action).toBe('revert');
    expect(recovery.reason).toContain('reverting');
  });

  test('onAgentDied returns queue strategy', async () => {
    const strategy = await defaultOrchestrator.onAgentDied(
      { id: 'a', registeredAt: 0, lastHeartbeat: 0 },
      { id: 's', purpose: 'test', status: 'active', notes: [], fileClaims: [] }
    );
    expect(strategy.action).toBe('queue');
  });
});
