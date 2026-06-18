/**
 * Unit Tests for Agent Liveness & Readiness
 *
 * Tests the enriched heartbeat, adaptive reaper thresholds,
 * readiness checks, and status-based agent lifecycle.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createResurrection } from '../../lib/resurrection.js';

describe('Agent Liveness & Readiness', () => {

  // ==========================================================================
  // Agent Status Field
  // ==========================================================================
  describe('Agent Status', () => {
    let db;
    let agents;

    beforeEach(() => {
      db = createTestDb();
      agents = createAgents(db);
    });

    it('should default to "ready" status on registration', () => {
      agents.register('agent-1', { purpose: 'test' });
      const result = agents.get('agent-1');
      expect(result.success).toBe(true);
      expect(result.agent.status).toBe('ready');
    });

    it('should accept status on registration', () => {
      agents.register('agent-1', { purpose: 'test', status: 'starting' });
      const result = agents.get('agent-1');
      expect(result.agent.status).toBe('starting');
    });

    it('should validate status values', () => {
      const result = agents.register('agent-1', { status: 'invalid' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid status/i);
    });

    it('should accept all valid status values', () => {
      for (const status of ['starting', 'ready', 'busy', 'draining']) {
        const id = `agent-${status}`;
        const result = agents.register(id, { status });
        expect(result.success).toBe(true);
        const get = agents.get(id);
        expect(get.agent.status).toBe(status);
      }
    });

    it('should show status in list response', () => {
      agents.register('agent-1', { status: 'busy' });
      const result = agents.list();
      expect(result.agents[0].status).toBe('busy');
    });
  });

  // ==========================================================================
  // Enriched Heartbeat
  // ==========================================================================
  describe('Enriched Heartbeat', () => {
    let db;
    let agents;

    beforeEach(() => {
      db = createTestDb();
      agents = createAgents(db);
      agents.register('agent-1', { purpose: 'test' });
    });

    it('should accept status in heartbeat', () => {
      const result = agents.heartbeat('agent-1', { status: 'busy' });
      expect(result.success).toBe(true);

      const get = agents.get('agent-1');
      expect(get.agent.status).toBe('busy');
    });

    it('should accept readiness checks in heartbeat', () => {
      const readiness = [
        { name: 'port', ok: true },
        { name: 'session', ok: true },
        { name: 'mcp', ok: false, reason: 'reconnecting' }
      ];
      const result = agents.heartbeat('agent-1', { readiness });
      expect(result.success).toBe(true);

      const get = agents.get('agent-1');
      expect(get.agent.readiness).toEqual(readiness);
    });

    it('should accept progress in heartbeat', () => {
      agents.heartbeat('agent-1', { progress: 'Refactoring auth module' });
      const get = agents.get('agent-1');
      expect(get.agent.progress).toBe('Refactoring auth module');
    });

    it('should return health assessment in heartbeat response', () => {
      const result = agents.heartbeat('agent-1', {
        status: 'busy',
        readiness: [
          { name: 'port', ok: true },
          { name: 'mcp', ok: false, reason: 'reconnecting' }
        ]
      });

      expect(result.success).toBe(true);
      expect(result.health).toBeDefined();
      expect(result.health.liveness).toBe('alive');
      expect(result.health.readiness).toBe('not_ready');
      expect(result.health.failingChecks).toEqual(['mcp']);
    });

    it('should report readiness as "ready" when all checks pass', () => {
      const result = agents.heartbeat('agent-1', {
        readiness: [
          { name: 'port', ok: true },
          { name: 'session', ok: true }
        ]
      });
      expect(result.health.readiness).toBe('ready');
      expect(result.health.failingChecks).toEqual([]);
    });

    it('should report readiness as "ready" when no checks reported', () => {
      const result = agents.heartbeat('agent-1', {});
      expect(result.health.readiness).toBe('ready');
    });

    it('should preserve existing status when heartbeat omits it', () => {
      agents.heartbeat('agent-1', { status: 'busy' });
      agents.heartbeat('agent-1', { progress: 'still working' });

      const get = agents.get('agent-1');
      expect(get.agent.status).toBe('busy');
    });

    it('bare heartbeat should work (backward compatible)', () => {
      const result = agents.heartbeat('agent-1');
      expect(result.success).toBe(true);
      const get = agents.get('agent-1');
      expect(get.agent.status).toBe('ready');
    });

    it('should validate readiness check format', () => {
      const result = agents.heartbeat('agent-1', {
        readiness: [{ invalid: true }]
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/readiness/i);
    });
  });

  // ==========================================================================
  // isReady Computation
  // ==========================================================================
  describe('isReady', () => {
    let db;
    let agents;

    beforeEach(() => {
      db = createTestDb();
      agents = createAgents(db);
    });

    it('should be true for "ready" status with all checks passing', () => {
      agents.register('agent-1', { status: 'ready' });
      agents.heartbeat('agent-1', {
        readiness: [{ name: 'port', ok: true }]
      });
      const get = agents.get('agent-1');
      expect(get.agent.isReady).toBe(true);
    });

    it('should be true for "busy" status with all checks passing', () => {
      agents.register('agent-1', { status: 'busy' });
      agents.heartbeat('agent-1', {
        readiness: [{ name: 'port', ok: true }]
      });
      const get = agents.get('agent-1');
      expect(get.agent.isReady).toBe(true);
    });

    it('should be false for "starting" status even with all checks passing', () => {
      agents.register('agent-1', { status: 'starting' });
      agents.heartbeat('agent-1', {
        readiness: [{ name: 'port', ok: true }]
      });
      const get = agents.get('agent-1');
      expect(get.agent.isReady).toBe(false);
    });

    it('should be false for "draining" status', () => {
      agents.register('agent-1', { status: 'draining' });
      const get = agents.get('agent-1');
      expect(get.agent.isReady).toBe(false);
    });

    it('should be false when any readiness check fails', () => {
      agents.register('agent-1', { status: 'ready' });
      agents.heartbeat('agent-1', {
        readiness: [
          { name: 'port', ok: true },
          { name: 'mcp', ok: false, reason: 'disconnected' }
        ]
      });
      const get = agents.get('agent-1');
      expect(get.agent.isReady).toBe(false);
    });

    it('should be true with no readiness checks (backward compatible)', () => {
      agents.register('agent-1');
      const get = agents.get('agent-1');
      expect(get.agent.isReady).toBe(true);
    });
  });

  // ==========================================================================
  // Adaptive Reaper Thresholds
  // ==========================================================================
  describe('Adaptive Reaper Thresholds', () => {
    let db;
    let resurrection;

    beforeEach(() => {
      db = createTestDb();
      // Ensure agents table exists for resurrection to work
      createAgents(db);
      resurrection = createResurrection(db);
    });

    it('should use 15 min dead threshold for "starting" agents', () => {
      expect(resurrection.getDeadThreshold('starting')).toBe(15 * 60 * 1000);
    });

    // Reconciled with lib/agents.ts (single source of truth): ready/busy/default
    // use a 4h dead threshold so background agents survive long jobs.
    it('should use 4h dead threshold for "ready" agents', () => {
      expect(resurrection.getDeadThreshold('ready')).toBe(4 * 60 * 60 * 1000);
    });

    it('should use 4h dead threshold for "busy" agents', () => {
      expect(resurrection.getDeadThreshold('busy')).toBe(4 * 60 * 60 * 1000);
    });

    it('should use 5 min dead threshold for "draining" agents', () => {
      expect(resurrection.getDeadThreshold('draining')).toBe(5 * 60 * 1000);
    });

    it('should use 4h dead threshold for unknown status', () => {
      expect(resurrection.getDeadThreshold(undefined)).toBe(4 * 60 * 60 * 1000);
    });

    it('stale threshold should be 60% of dead threshold', () => {
      for (const status of ['starting', 'ready', 'busy', 'draining']) {
        const dead = resurrection.getDeadThreshold(status);
        const stale = resurrection.getStaleThreshold(status);
        expect(stale).toBe(Math.round(dead * 0.6));
      }
    });

    it('should use adaptive threshold when checking agent status', () => {
      const now = Date.now();

      // A draining agent with heartbeat 6 min ago should be dead
      // because draining dead threshold is 5 min.
      const result = resurrection.check({
        id: 'draining-agent',
        name: 'Draining Agent',
        lastHeartbeat: now - 6 * 60 * 1000,
        status: 'draining',
      });
      expect(result.status).toBe('dead');

      // Same timing (6 min) for a ready agent should be healthy
      // because ready dead threshold is 4h (and stale threshold is 2.4h).
      const result2 = resurrection.check({
        id: 'ready-agent',
        name: 'Ready Agent',
        lastHeartbeat: now - 6 * 60 * 1000,
        status: 'ready',
      });
      expect(result2.status).toBe('healthy');
    });

    it('should treat draining agents as dead quickly', () => {
      const now = Date.now();

      // Draining agent with heartbeat 6 min ago should be dead
      const result = resurrection.check({
        id: 'draining-agent',
        name: 'Draining Agent',
        lastHeartbeat: now - 6 * 60 * 1000,
        status: 'draining',
      });
      expect(result.status).toBe('dead');
    });
  });

  // ==========================================================================
  // Health Assessment
  // ==========================================================================
  describe('Health Assessment', () => {
    let db;
    let agents;

    beforeEach(() => {
      db = createTestDb();
      agents = createAgents(db);
    });

    it('should include healthAssessment in agent response', () => {
      agents.register('agent-1', { status: 'busy' });
      const result = agents.get('agent-1');
      expect(result.agent.healthAssessment).toBeDefined();
      expect(result.agent.healthAssessment.liveness).toBe('alive');
    });

    it('should show stale liveness for old heartbeat', () => {
      agents.register('agent-1', { status: 'ready' });

      // Stale threshold = dead threshold * 0.6. ready dead = 4h → stale at 2.4h = 144 min.
      // Backdate past the stale threshold (150 min > 144 min).
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?')
        .run(Date.now() - 150 * 60 * 1000, 'agent-1');

      const result = agents.get('agent-1');
      expect(result.agent.healthAssessment.liveness).toBe('stale');
    });

    it('should show dead liveness for very old heartbeat', () => {
      agents.register('agent-1', { status: 'ready' });

      // ready dead threshold = 4h. Backdate past 4h (250 min > 240 min).
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?')
        .run(Date.now() - 250 * 60 * 1000, 'agent-1');

      const result = agents.get('agent-1');
      expect(result.agent.healthAssessment.liveness).toBe('dead');
    });

    it('should compute graceRemaining', () => {
      agents.register('agent-1', { status: 'busy' });
      const result = agents.get('agent-1');

      // busy dead threshold = 4h (14 400 000 ms). Just registered → graceRemaining ≈ 4h.
      expect(result.agent.healthAssessment.graceRemaining).toBeGreaterThan(239 * 60 * 1000);
      expect(result.agent.healthAssessment.graceRemaining).toBeLessThanOrEqual(240 * 60 * 1000);
    });
  });

  // ==========================================================================
  // DEFAULT_AGENT_TTL → DEFAULT_DISPLAY_TTL rename
  // ==========================================================================
  describe('TTL Naming', () => {
    let db;
    let agents;

    beforeEach(() => {
      db = createTestDb();
      agents = createAgents(db);
    });

    it('should expose DEFAULT_DISPLAY_TTL (was DEFAULT_AGENT_TTL)', () => {
      expect(agents.DEFAULT_DISPLAY_TTL).toBe(120000);
    });

    it('should still expose DEFAULT_AGENT_TTL for backward compatibility', () => {
      expect(agents.DEFAULT_AGENT_TTL).toBe(120000);
    });
  });

  // ==========================================================================
  // Progress Field
  // ==========================================================================
  describe('Progress', () => {
    let db;
    let agents;

    beforeEach(() => {
      db = createTestDb();
      agents = createAgents(db);
    });

    it('should store and retrieve progress', () => {
      agents.register('agent-1');
      agents.heartbeat('agent-1', { progress: 'Building auth module' });
      const result = agents.get('agent-1');
      expect(result.agent.progress).toBe('Building auth module');
    });

    it('should default progress to null', () => {
      agents.register('agent-1');
      const result = agents.get('agent-1');
      expect(result.agent.progress).toBeNull();
    });

    it('should update progress on subsequent heartbeats', () => {
      agents.register('agent-1');
      agents.heartbeat('agent-1', { progress: 'Step 1' });
      agents.heartbeat('agent-1', { progress: 'Step 2' });
      const result = agents.get('agent-1');
      expect(result.agent.progress).toBe('Step 2');
    });
  });

  // ==========================================================================
  // VALID_STATUSES export
  // ==========================================================================
  describe('VALID_STATUSES', () => {
    let db;
    let agents;

    beforeEach(() => {
      db = createTestDb();
      agents = createAgents(db);
    });

    it('should expose VALID_STATUSES array', () => {
      expect(agents.VALID_STATUSES).toEqual(['starting', 'ready', 'busy', 'draining']);
    });
  });
});
