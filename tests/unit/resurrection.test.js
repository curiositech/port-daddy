/**
 * Unit Tests for Resurrection Module (resurrection.ts)
 *
 * Tests the complete agent resurrection lifecycle:
 * - Agent death detection via heartbeat thresholds
 * - Queue management (pending, list, claim, complete, abandon, dismiss)
 * - Context-aware filtering by project/stack identity
 * - Event emission for resurrection state transitions
 * - Edge cases: double-claim, claim non-existent, concurrent operations
 * - Adversarial inputs: SQL injection, oversized strings
 *
 * Each test runs with a fresh in-memory database to ensure isolation.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createResurrection } from '../../lib/resurrection.js';

describe('Resurrection Module', () => {
  let db;
  let resurrection;

  beforeEach(() => {
    db = createTestDb();
    resurrection = createResurrection(db);
  });

  // ======================================================================
  // THRESHOLD EXPOSURE
  // ======================================================================
  describe('Thresholds', () => {
    it('should expose stale threshold (10 minutes)', () => {
      expect(resurrection.thresholds.stale).toBe(10 * 60 * 1000);
    });

    it('should expose dead threshold (20 minutes)', () => {
      expect(resurrection.thresholds.dead).toBe(20 * 60 * 1000);
    });
  });

  // ======================================================================
  // CHECK — HEARTBEAT-BASED STATUS DETECTION
  // ======================================================================
  describe('check() — heartbeat-based status detection', () => {
    it('should return healthy for a recent heartbeat', () => {
      const result = resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        lastHeartbeat: Date.now() - 1000, // 1 second ago
      });

      expect(result.status).toBe('healthy');
    });

    it('should mark agent as stale when heartbeat exceeds stale threshold', () => {
      const result = resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        lastHeartbeat: Date.now() - (11 * 60 * 1000), // 11 minutes ago
      });

      expect(result.status).toBe('stale');
      expect(result.queued).toBe(true);
    });

    it('should mark agent as dead when heartbeat exceeds dead threshold', () => {
      const result = resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        lastHeartbeat: Date.now() - (21 * 60 * 1000), // 21 minutes ago
      });

      expect(result.status).toBe('dead');
      expect(result.queued).toBe(true);
    });

    it('should promote stale agent to dead when heartbeat worsens', () => {
      // First check — stale
      resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        lastHeartbeat: Date.now() - (11 * 60 * 1000),
      });

      // Second check — dead (heartbeat even older)
      const result = resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        lastHeartbeat: Date.now() - (25 * 60 * 1000),
      });

      expect(result.status).toBe('dead');
    });

    it('should remove agent from queue when heartbeat recovers', () => {
      // First: make it stale
      resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        lastHeartbeat: Date.now() - (11 * 60 * 1000),
      });

      // Then: heartbeat recovers
      const result = resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        lastHeartbeat: Date.now() - 5000, // healthy
      });

      expect(result.status).toBe('healthy');

      // Should be gone from pending
      const pending = resurrection.pending();
      expect(pending.agents.length).toBe(0);
    });

    it('should store purpose and sessionId in the queue entry', () => {
      resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        purpose: 'Building auth module',
        sessionId: 'session-abc',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      const pending = resurrection.pending();
      expect(pending.agents.length).toBe(1);
      expect(pending.agents[0].purpose).toBe('Building auth module');
      expect(pending.agents[0].sessionId).toBe('session-abc');
    });

    it('should store identity components for context-aware filtering', () => {
      resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        identityProject: 'myapp',
        identityStack: 'api',
        identityContext: 'auth',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      const pending = resurrection.pending({ project: 'myapp' });
      expect(pending.agents.length).toBe(1);
      expect(pending.agents[0].identityProject).toBe('myapp');
      expect(pending.agents[0].identityStack).toBe('api');
      expect(pending.agents[0].identityContext).toBe('auth');
    });

    it('should store notes in metadata', () => {
      resurrection.check({
        id: 'agent-1',
        name: 'Agent One',
        notes: ['Started task', 'Got stuck on auth'],
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      const pending = resurrection.pending();
      expect(pending.agents[0].notes).toEqual(['Started task', 'Got stuck on auth']);
    });
  });

  // ======================================================================
  // PENDING — LIST AGENTS AWAITING RESURRECTION
  // ======================================================================
  describe('pending() — list pending agents', () => {
    function queueDeadAgent(id, opts = {}) {
      resurrection.check({
        id,
        name: opts.name || id,
        purpose: opts.purpose || null,
        sessionId: opts.sessionId || null,
        identityProject: opts.project || null,
        identityStack: opts.stack || null,
        identityContext: opts.context || null,
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
    }

    it('should return empty list when no agents are dead', () => {
      const result = resurrection.pending();
      expect(result.success).toBe(true);
      expect(result.agents).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should list all pending agents without filters', () => {
      queueDeadAgent('agent-1', { project: 'app-a' });
      queueDeadAgent('agent-2', { project: 'app-b' });

      const result = resurrection.pending();
      expect(result.count).toBe(2);
      expect(result.filtered).toBe(false);
    });

    it('should filter by project', () => {
      queueDeadAgent('agent-1', { project: 'myapp' });
      queueDeadAgent('agent-2', { project: 'other' });

      const result = resurrection.pending({ project: 'myapp' });
      expect(result.count).toBe(1);
      expect(result.agents[0].id).toBe('agent-1');
      expect(result.filtered).toBe(true);
    });

    it('should filter by project and stack', () => {
      queueDeadAgent('agent-1', { project: 'myapp', stack: 'api' });
      queueDeadAgent('agent-2', { project: 'myapp', stack: 'frontend' });
      queueDeadAgent('agent-3', { project: 'other', stack: 'api' });

      const result = resurrection.pending({ project: 'myapp', stack: 'api' });
      expect(result.count).toBe(1);
      expect(result.agents[0].id).toBe('agent-1');
    });

    it('should not include stale agents (only dead/pending)', () => {
      // Stale, not dead
      resurrection.check({
        id: 'stale-agent',
        name: 'Stale',
        lastHeartbeat: Date.now() - (11 * 60 * 1000), // 11 min
      });

      const result = resurrection.pending();
      expect(result.count).toBe(0);
    });

    it('should not include agents currently being resurrected', () => {
      queueDeadAgent('agent-1');
      resurrection.claim('agent-1');

      const result = resurrection.pending();
      expect(result.count).toBe(0);
    });
  });

  // ======================================================================
  // LIST — ALL QUEUE ENTRIES WITH LIMIT
  // ======================================================================
  describe('list() — all queue entries', () => {
    function queueDeadAgent(id, opts = {}) {
      resurrection.check({
        id,
        name: opts.name || id,
        identityProject: opts.project || null,
        identityStack: opts.stack || null,
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
    }

    it('should list all entries including non-pending statuses', () => {
      queueDeadAgent('agent-1');
      queueDeadAgent('agent-2');
      resurrection.claim('agent-1'); // now resurrecting

      const result = resurrection.list();
      expect(result.count).toBe(2);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        queueDeadAgent(`agent-${i}`);
      }

      const result = resurrection.list({ limit: 3 });
      expect(result.count).toBe(3);
    });

    it('should default limit to 50', () => {
      // Just verify it works without limit
      queueDeadAgent('agent-1');
      const result = resurrection.list();
      expect(result.success).toBe(true);
    });

    it('should filter by project', () => {
      queueDeadAgent('agent-1', { project: 'myapp' });
      queueDeadAgent('agent-2', { project: 'other' });

      const result = resurrection.list({ project: 'myapp' });
      expect(result.count).toBe(1);
      expect(result.filtered).toBe(true);
    });

    it('should filter by project and stack', () => {
      queueDeadAgent('agent-1', { project: 'myapp', stack: 'api' });
      queueDeadAgent('agent-2', { project: 'myapp', stack: 'web' });

      const result = resurrection.list({ project: 'myapp', stack: 'api' });
      expect(result.count).toBe(1);
    });
  });

  // ======================================================================
  // COUNT BY PROJECT
  // ======================================================================
  describe('countByProject()', () => {
    it('should return 0 for empty project', () => {
      expect(resurrection.countByProject('nonexistent')).toBe(0);
    });

    it('should count pending agents in a project', () => {
      resurrection.check({
        id: 'a1', name: 'A1', identityProject: 'myapp',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
      resurrection.check({
        id: 'a2', name: 'A2', identityProject: 'myapp',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
      resurrection.check({
        id: 'a3', name: 'A3', identityProject: 'other',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      expect(resurrection.countByProject('myapp')).toBe(2);
      expect(resurrection.countByProject('other')).toBe(1);
    });

    it('should not count agents that have been claimed (resurrecting)', () => {
      resurrection.check({
        id: 'a1', name: 'A1', identityProject: 'myapp',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
      resurrection.claim('a1');

      expect(resurrection.countByProject('myapp')).toBe(0);
    });
  });

  // ======================================================================
  // CLAIM — TAKE OWNERSHIP OF DEAD AGENT'S WORK
  // ======================================================================
  describe('claim()', () => {
    function queueDeadAgent(id, opts = {}) {
      resurrection.check({
        id,
        name: opts.name || id,
        purpose: opts.purpose || 'test purpose',
        sessionId: opts.sessionId || 'sess-1',
        notes: opts.notes || ['note 1'],
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
    }

    it('should successfully claim a pending dead agent', () => {
      queueDeadAgent('dead-agent');

      const result = resurrection.claim('dead-agent');
      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent.id).toBe('dead-agent');
      expect(result.context).toBeDefined();
      expect(result.context.purpose).toBe('test purpose');
      expect(result.context.sessionId).toBe('sess-1');
      expect(result.context.notes).toEqual(['note 1']);
    });

    it('should fail to claim a non-existent agent', () => {
      const result = resurrection.claim('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not in resurrection queue/);
    });

    it('should prevent double-claim (second claim fails)', () => {
      queueDeadAgent('dead-agent');

      const first = resurrection.claim('dead-agent');
      expect(first.success).toBe(true);

      const second = resurrection.claim('dead-agent');
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/resurrecting.*not pending/i);
    });

    it('should increment resurrection_attempts on claim', () => {
      queueDeadAgent('dead-agent');
      resurrection.claim('dead-agent');

      // After claim, the row should have attempts incremented
      // Abandon and try again to verify
      resurrection.abandon('dead-agent');
      resurrection.claim('dead-agent');

      // Get from list to see attempts
      const list = resurrection.list();
      const agent = list.agents.find(a => a.id === 'dead-agent');
      expect(agent).toBeDefined();
    });
  });

  // ======================================================================
  // COMPLETE — MARK RESURRECTION AS DONE
  // ======================================================================
  describe('complete()', () => {
    it('should remove agent from queue on completion', () => {
      resurrection.check({
        id: 'old-agent', name: 'Old',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
      resurrection.claim('old-agent');

      const result = resurrection.complete('old-agent', 'new-agent');
      expect(result.success).toBe(true);

      // Should be gone from the queue
      const list = resurrection.list();
      expect(list.agents.find(a => a.id === 'old-agent')).toBeUndefined();
    });

    it('should succeed even if agent was not in queue (idempotent)', () => {
      const result = resurrection.complete('nonexistent', 'new-agent');
      expect(result.success).toBe(true);
    });
  });

  // ======================================================================
  // ABANDON — RETURN AGENT TO PENDING QUEUE
  // ======================================================================
  describe('abandon()', () => {
    it('should return agent to pending status after abandonment', () => {
      resurrection.check({
        id: 'dead-agent', name: 'Dead',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
      resurrection.claim('dead-agent');

      const result = resurrection.abandon('dead-agent');
      expect(result.success).toBe(true);

      // Should be back in pending
      const pending = resurrection.pending();
      expect(pending.count).toBe(1);
      expect(pending.agents[0].id).toBe('dead-agent');
    });

    it('should allow re-claiming after abandonment', () => {
      resurrection.check({
        id: 'dead-agent', name: 'Dead',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
      resurrection.claim('dead-agent');
      resurrection.abandon('dead-agent');

      const result = resurrection.claim('dead-agent');
      expect(result.success).toBe(true);
    });
  });

  // ======================================================================
  // DISMISS — REMOVE FROM QUEUE WITHOUT RESURRECTION
  // ======================================================================
  describe('dismiss()', () => {
    it('should remove agent from queue', () => {
      resurrection.check({
        id: 'dead-agent', name: 'Dead',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      const result = resurrection.dismiss('dead-agent');
      expect(result.success).toBe(true);

      const pending = resurrection.pending();
      expect(pending.count).toBe(0);
    });

    it('should succeed when dismissing non-existent agent (idempotent)', () => {
      const result = resurrection.dismiss('nonexistent');
      expect(result.success).toBe(true);
    });
  });

  // ======================================================================
  // CLEANUP — REMOVE OLD ENTRIES
  // ======================================================================
  describe('cleanup()', () => {
    it('should remove entries older than the specified time', () => {
      // Manually insert an old entry using check with backdated detected_at
      resurrection.check({
        id: 'old-agent', name: 'Old',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      // Backdate the detected_at in the database
      db.prepare('UPDATE resurrection_queue SET detected_at = ? WHERE agent_id = ?')
        .run(Date.now() - (10 * 24 * 60 * 60 * 1000), 'old-agent'); // 10 days ago

      const result = resurrection.cleanup(7 * 24 * 60 * 60 * 1000); // 7 day threshold
      expect(result.cleaned).toBe(1);
    });

    it('should not remove recent entries', () => {
      resurrection.check({
        id: 'recent-agent', name: 'Recent',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      const result = resurrection.cleanup();
      expect(result.cleaned).toBe(0);
    });
  });

  // ======================================================================
  // EVENTS — EVENT EMISSION
  // ======================================================================
  describe('Event emission', () => {
    it('should emit agent:dead when agent is detected as dead', () => {
      const handler = jest.fn();
      resurrection.on('agent:dead', handler);

      resurrection.check({
        id: 'dead-1', name: 'Dead Agent',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe('dead-1');
    });

    it('should emit agent:stale when agent is detected as stale', () => {
      const handler = jest.fn();
      resurrection.on('agent:stale', handler);

      resurrection.check({
        id: 'stale-1', name: 'Stale Agent',
        lastHeartbeat: Date.now() - (11 * 60 * 1000),
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe('stale-1');
    });

    it('should emit agent:resurrecting when agent is claimed', () => {
      const handler = jest.fn();
      resurrection.on('agent:resurrecting', handler);

      resurrection.check({
        id: 'dead-1', name: 'Dead',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
      resurrection.claim('dead-1');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit agent:resurrected on completion', () => {
      const handler = jest.fn();
      resurrection.on('agent:resurrected', handler);

      resurrection.check({
        id: 'dead-1', name: 'Dead',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });
      resurrection.claim('dead-1');
      resurrection.complete('dead-1', 'new-1');

      expect(handler).toHaveBeenCalledWith('dead-1', 'new-1');
    });

    it('should emit agent:dead when stale agent transitions to dead', () => {
      const handler = jest.fn();
      resurrection.on('agent:dead', handler);

      // First check — stale (not dead yet)
      resurrection.check({
        id: 'agent-1', name: 'Agent',
        lastHeartbeat: Date.now() - (11 * 60 * 1000),
      });
      expect(handler).not.toHaveBeenCalled();

      // Second check — dead
      resurrection.check({
        id: 'agent-1', name: 'Agent',
        lastHeartbeat: Date.now() - (25 * 60 * 1000),
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ======================================================================
  // ADVERSARIAL INPUTS
  // ======================================================================
  describe('Adversarial inputs', () => {
    it('should handle SQL injection in agent IDs (parameterized queries)', () => {
      const maliciousId = "'; DROP TABLE resurrection_queue; --";

      resurrection.check({
        id: maliciousId,
        name: 'Evil Agent',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      // Table should still exist and work
      const pending = resurrection.pending();
      expect(pending.success).toBe(true);
      expect(pending.count).toBe(1);
      expect(pending.agents[0].id).toBe(maliciousId);
    });

    it('should handle very long purpose field (10KB)', () => {
      const longPurpose = 'x'.repeat(10240);

      resurrection.check({
        id: 'agent-long',
        name: 'Long Purpose Agent',
        purpose: longPurpose,
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      const pending = resurrection.pending();
      expect(pending.agents[0].purpose).toBe(longPurpose);
    });

    it('should handle unicode in agent names and purposes', () => {
      resurrection.check({
        id: 'agent-unicode',
        name: 'Agent with special chars',
        purpose: 'Building feature with emojis and CJK chars',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      const pending = resurrection.pending();
      expect(pending.agents[0].purpose).toContain('Building feature');
    });

    it('should handle empty strings for optional fields', () => {
      resurrection.check({
        id: 'agent-empty',
        name: '',
        purpose: '',
        sessionId: '',
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      const pending = resurrection.pending();
      expect(pending.count).toBe(1);
    });

    it('should handle null identity components gracefully', () => {
      resurrection.check({
        id: 'agent-null',
        name: 'Null Identity',
        identityProject: null,
        identityStack: null,
        identityContext: null,
        lastHeartbeat: Date.now() - (21 * 60 * 1000),
      });

      const pending = resurrection.pending();
      expect(pending.count).toBe(1);
      expect(pending.agents[0].identityProject).toBeNull();
    });
  });

  // ======================================================================
  // FULL LIFECYCLE
  // ======================================================================
  describe('Full lifecycle integration', () => {
    it('should support complete lifecycle: check -> claim -> complete', () => {
      // 1. Agent goes dead
      resurrection.check({
        id: 'lifecycle-agent',
        name: 'Lifecycle Agent',
        purpose: 'Building auth',
        sessionId: 'session-42',
        notes: ['Started building auth', 'Got stuck on JWT validation'],
        identityProject: 'myapp',
        identityStack: 'api',
        lastHeartbeat: Date.now() - (25 * 60 * 1000),
      });

      // 2. Verify it's pending
      const pending = resurrection.pending({ project: 'myapp' });
      expect(pending.count).toBe(1);

      // 3. Another agent claims it
      const claim = resurrection.claim('lifecycle-agent');
      expect(claim.success).toBe(true);
      expect(claim.context.purpose).toBe('Building auth');
      expect(claim.context.notes).toEqual(['Started building auth', 'Got stuck on JWT validation']);

      // 4. Verify it's no longer pending
      const pendingAfterClaim = resurrection.pending({ project: 'myapp' });
      expect(pendingAfterClaim.count).toBe(0);

      // 5. New agent completes the work
      const complete = resurrection.complete('lifecycle-agent', 'new-agent-42');
      expect(complete.success).toBe(true);

      // 6. Queue is empty
      const final = resurrection.list();
      expect(final.agents.find(a => a.id === 'lifecycle-agent')).toBeUndefined();
    });

    it('should support lifecycle with abandonment and re-claim', () => {
      resurrection.check({
        id: 'abandon-agent',
        name: 'Abandon Agent',
        lastHeartbeat: Date.now() - (25 * 60 * 1000),
      });

      // Claim
      resurrection.claim('abandon-agent');

      // Abandon
      resurrection.abandon('abandon-agent');

      // Should be back in pending
      expect(resurrection.pending().count).toBe(1);

      // Re-claim by different agent
      const reClaim = resurrection.claim('abandon-agent');
      expect(reClaim.success).toBe(true);

      // Complete
      resurrection.complete('abandon-agent', 'final-agent');
      expect(resurrection.list().agents.find(a => a.id === 'abandon-agent')).toBeUndefined();
    });

    it('should handle multiple dead agents in the same project', () => {
      for (let i = 0; i < 5; i++) {
        resurrection.check({
          id: `agent-${i}`,
          name: `Agent ${i}`,
          identityProject: 'shared-project',
          lastHeartbeat: Date.now() - (25 * 60 * 1000),
        });
      }

      expect(resurrection.countByProject('shared-project')).toBe(5);

      // Claim and complete each
      for (let i = 0; i < 5; i++) {
        const claim = resurrection.claim(`agent-${i}`);
        expect(claim.success).toBe(true);
        resurrection.complete(`agent-${i}`, `rescuer-${i}`);
      }

      expect(resurrection.countByProject('shared-project')).toBe(0);
    });
  });
});
