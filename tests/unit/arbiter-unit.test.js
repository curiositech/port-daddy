/**
 * Unit Tests for lib/arbiter.ts — direct module testing
 *
 * Tests the Arbiter's six invariant rules, violation recording,
 * test injection, and status reporting.
 * Uses mocks for all dependencies — no daemon required.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { createArbiter } from '../../lib/arbiter.js';
import { ActivityType } from '../../lib/activity.js';

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockActivityLog() {
  const subscribers = new Set();
  const logged = [];

  return {
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    log(type, options = {}) {
      const entry = { type, ...options, timestamp: Date.now() };
      logged.push(entry);
      return { success: true };
    },
    emit(entry) {
      for (const cb of subscribers) cb(entry);
    },
    getLogged() { return logged; },
  };
}

function createMockAgents(initialAgents = {}) {
  const agents = new Map(Object.entries(initialAgents));
  return {
    get(id) {
      const agent = agents.get(id);
      if (!agent) return { success: false };
      return { success: true, agent };
    },
    _set(id, data) { agents.set(id, data); },
    _delete(id) { agents.delete(id); },
  };
}

function createMockSessions() {
  return {};
}

function createMockLocks() {
  return {};
}

function buildDeps(overrides = {}) {
  return {
    activityLog: overrides.activityLog || createMockActivityLog(),
    agents: overrides.agents || createMockAgents(),
    sessions: createMockSessions(),
    locks: createMockLocks(),
    resurrection: overrides.resurrection,
  };
}

// ─── createArbiter ───────────────────────────────────────────────────────────

describe('createArbiter', () => {
  test('returns public API with expected methods', () => {
    const arbiter = createArbiter(buildDeps());
    expect(typeof arbiter.getViolationsCount).toBe('function');
    expect(typeof arbiter.getViolations).toBe('function');
    expect(typeof arbiter.getStatus).toBe('function');
    expect(typeof arbiter.injectTestViolation).toBe('function');
    expect(typeof arbiter.stop).toBe('function');
  });

  test('starts with zero violations', () => {
    const arbiter = createArbiter(buildDeps());
    expect(arbiter.getViolationsCount()).toBe(0);
    arbiter.stop();
  });

  test('subscribes to the activity log', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });
    // Verify subscription is active by checking it receives events
    activityLog.emit({ type: ActivityType.AGENT_HEARTBEAT, agentId: null });
    // No throw = subscription works
    arbiter.stop();
  });
});

// ─── getStatus() ─────────────────────────────────────────────────────────────

describe('getStatus()', () => {
  test('returns expected shape', () => {
    const arbiter = createArbiter(buildDeps());
    const status = arbiter.getStatus();

    expect(status.active).toBe(true);
    expect(status.strictMode).toBe(false);
    expect(status.rulesCount).toBe(6);
    expect(Array.isArray(status.rules)).toBe(true);
    expect(Array.isArray(status.ruleDetails)).toBe(true);
    expect(status.summary).toBeDefined();
    expect(Array.isArray(status.degraded)).toBe(true);
    expect(typeof status.violationsCount).toBe('number');
    expect(typeof status.uptimeMs).toBe('number');
    expect(typeof status.startedAt).toBe('number');
    expect(typeof status.enforcerLoaded).toBe('boolean');
    arbiter.stop();
  });

  test('includes all 6 rule names', () => {
    const arbiter = createArbiter(buildDeps());
    const { rules } = arbiter.getStatus();
    expect(rules).toContain('PID_SQUATTING');
    expect(rules).toContain('CAP_ESCALATION');
    expect(rules).toContain('NOTE_MONOTONICITY');
    expect(rules).toContain('ESCROW_POSITIVE');
    expect(rules).toContain('LOCK_OWNER_VALID');
    expect(rules).toContain('HEARTBEAT_FRESHNESS');
    arbiter.stop();
  });

  test('reports machine-readable rule coverage and degraded reasons', () => {
    const arbiter = createArbiter(buildDeps());
    const status = arbiter.getStatus();

    expect(status.summary.mode).toBe('observe_only');
    expect(status.summary.criticalAction).toBe('log_only');
    expect(status.summary.stubbedRules).toBeGreaterThanOrEqual(1);
    expect(status.degraded).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'strict_mode_disabled' }),
      expect.objectContaining({ code: 'escrow_rule_stubbed' }),
    ]));

    const escrowRule = status.ruleDetails.find((rule) => rule.name === 'ESCROW_POSITIVE');
    expect(escrowRule).toEqual(expect.objectContaining({
      coverage: 'stubbed',
      engine: 'stub',
      degradedReason: expect.any(String),
    }));

    const capRule = status.ruleDetails.find((rule) => rule.name === 'CAP_ESCALATION');
    if (status.enforcerLoaded) {
      expect(capRule.coverage).toBe('enforced');
      expect(status.degraded.find((reason) => reason.code === 'ffi_enforcer_unavailable')).toBeUndefined();
    } else {
      expect(capRule.coverage).toBe('degraded');
      expect(status.degraded).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'ffi_enforcer_unavailable' }),
      ]));
    }

    arbiter.stop();
  });

  test('strictMode reflects config', () => {
    const strict = createArbiter(buildDeps(), { strictMode: true });
    expect(strict.getStatus().strictMode).toBe(true);
    strict.stop();

    const lenient = createArbiter(buildDeps(), { strictMode: false });
    expect(lenient.getStatus().strictMode).toBe(false);
    lenient.stop();
  });

  test('strict mode flips enforcement mode without removing known stub coverage gaps', () => {
    const arbiter = createArbiter(buildDeps(), { strictMode: true });
    const status = arbiter.getStatus();

    expect(status.summary.mode).toBe('strict_enforcement');
    expect(status.summary.criticalAction).toBe('man_overboard');
    expect(status.degraded.find((reason) => reason.code === 'strict_mode_disabled')).toBeUndefined();
    expect(status.degraded).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'escrow_rule_stubbed' }),
    ]));

    arbiter.stop();
  });

  test('uptimeMs increases over time', async () => {
    const arbiter = createArbiter(buildDeps());
    const s1 = arbiter.getStatus();
    await new Promise(r => setTimeout(r, 10));
    const s2 = arbiter.getStatus();
    expect(s2.uptimeMs).toBeGreaterThanOrEqual(s1.uptimeMs);
    arbiter.stop();
  });
});

// ─── getViolations() ─────────────────────────────────────────────────────────

describe('getViolations()', () => {
  test('returns empty array initially', () => {
    const arbiter = createArbiter(buildDeps());
    expect(arbiter.getViolations()).toEqual([]);
    arbiter.stop();
  });

  test('returns violations after injection', () => {
    const arbiter = createArbiter(buildDeps());
    arbiter.injectTestViolation('NOTE_MONOTONICITY');
    const violations = arbiter.getViolations();
    expect(violations).toHaveLength(1);
    arbiter.stop();
  });

  test('paginates with limit and offset', () => {
    const arbiter = createArbiter(buildDeps());
    for (let i = 0; i < 5; i++) {
      arbiter.injectTestViolation('NOTE_MONOTONICITY');
    }
    const page1 = arbiter.getViolations(2, 0);
    const page2 = arbiter.getViolations(2, 2);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0].id).not.toBe(page2[0].id);
    arbiter.stop();
  });

  test('default limit is 50', () => {
    const arbiter = createArbiter(buildDeps());
    for (let i = 0; i < 60; i++) {
      arbiter.injectTestViolation('HEARTBEAT_FRESHNESS');
    }
    expect(arbiter.getViolations()).toHaveLength(50);
    arbiter.stop();
  });
});

// ─── injectTestViolation() ───────────────────────────────────────────────────

describe('injectTestViolation()', () => {
  const rules = [
    'PID_SQUATTING',
    'CAP_ESCALATION',
    'NOTE_MONOTONICITY',
    'ESCROW_POSITIVE',
    'LOCK_OWNER_VALID',
    'HEARTBEAT_FRESHNESS',
  ];

  for (const rule of rules) {
    test(`injects ${rule} violation`, () => {
      const arbiter = createArbiter(buildDeps());
      const violation = arbiter.injectTestViolation(rule);

      expect(violation).not.toBeNull();
      expect(violation.rule).toBe(rule);
      expect(violation.details).toContain('TEST');
      expect(typeof violation.id).toBe('number');
      expect(typeof violation.timestamp).toBe('number');
      arbiter.stop();
    });
  }

  test('returns null for unknown rule name', () => {
    const arbiter = createArbiter(buildDeps());
    const result = arbiter.injectTestViolation('DOES_NOT_EXIST');
    expect(result).toBeNull();
    arbiter.stop();
  });

  test('increments violation count on each injection', () => {
    const arbiter = createArbiter(buildDeps());
    arbiter.injectTestViolation('PID_SQUATTING');
    arbiter.injectTestViolation('NOTE_MONOTONICITY');
    expect(arbiter.getViolationsCount()).toBe(2);
    arbiter.stop();
  });

  test('violation has correct severity for PID_SQUATTING (critical)', () => {
    const arbiter = createArbiter(buildDeps());
    const v = arbiter.injectTestViolation('PID_SQUATTING');
    expect(v.severity).toBe('critical');
    arbiter.stop();
  });

  test('violation has correct severity for HEARTBEAT_FRESHNESS (warning)', () => {
    const arbiter = createArbiter(buildDeps());
    const v = arbiter.injectTestViolation('HEARTBEAT_FRESHNESS');
    expect(v.severity).toBe('warning');
    arbiter.stop();
  });

  test('violation IDs are sequential', () => {
    const arbiter = createArbiter(buildDeps());
    const v1 = arbiter.injectTestViolation('ESCROW_POSITIVE');
    const v2 = arbiter.injectTestViolation('LOCK_OWNER_VALID');
    expect(v2.id).toBe(v1.id + 1);
    arbiter.stop();
  });

  test('violations are logged to activityLog', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });
    arbiter.injectTestViolation('NOTE_MONOTONICITY');
    const logged = activityLog.getLogged();
    expect(logged.length).toBeGreaterThan(0);
    const secLog = logged.find(e => e.type === 'security.violation');
    expect(secLog).toBeDefined();
    arbiter.stop();
  });
});

// ─── Rule: HEARTBEAT_FRESHNESS ───────────────────────────────────────────────

describe('Rule: HEARTBEAT_FRESHNESS', () => {
  test('fires when heartbeat is stale', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.AGENT_HEARTBEAT,
      agentId: 'agent-xyz',
      metadata: {
        health: { liveness: 'stale', graceRemaining: 30000 }
      }
    });

    expect(arbiter.getViolationsCount()).toBe(1);
    const v = arbiter.getViolations()[0];
    expect(v.rule).toBe('HEARTBEAT_FRESHNESS');
    expect(v.severity).toBe('warning');
    expect(v.agentId).toBe('agent-xyz');
    arbiter.stop();
  });

  test('does not fire when heartbeat is healthy', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.AGENT_HEARTBEAT,
      agentId: 'agent-xyz',
      metadata: { health: { liveness: 'healthy' } }
    });

    expect(arbiter.getViolationsCount()).toBe(0);
    arbiter.stop();
  });

  test('does not fire when no health metadata', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.AGENT_HEARTBEAT,
      agentId: 'agent-xyz',
      metadata: {}
    });

    expect(arbiter.getViolationsCount()).toBe(0);
    arbiter.stop();
  });

  test('does not fire when agentId is missing', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.AGENT_HEARTBEAT,
      agentId: null,
      metadata: { health: { liveness: 'stale' } }
    });

    expect(arbiter.getViolationsCount()).toBe(0);
    arbiter.stop();
  });
});

// ─── Rule: NOTE_MONOTONICITY ─────────────────────────────────────────────────

describe('Rule: NOTE_MONOTONICITY', () => {
  test('does not fire on increasing note counts', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    // Add 3 notes to same session — count goes 1, 2, 3
    for (let i = 0; i < 3; i++) {
      activityLog.emit({
        type: ActivityType.SESSION_NOTE,
        agentId: 'agent-1',
        targetId: 'session-abc',
      });
    }

    // No NOTE_MONOTONICITY violations (count only increases)
    const violations = arbiter.getViolations().filter(v => v.rule === 'NOTE_MONOTONICITY');
    expect(violations).toHaveLength(0);
    arbiter.stop();
  });

  test('tracks note counts per session independently', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_NOTE,
      agentId: 'agent-1',
      targetId: 'sess-A',
    });
    activityLog.emit({
      type: ActivityType.SESSION_NOTE,
      agentId: 'agent-1',
      targetId: 'sess-B',
    });

    expect(arbiter.getViolationsCount()).toBe(0);
    arbiter.stop();
  });

  test('uses metadata.sessionId as fallback for session ID', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_NOTE,
      agentId: 'agent-1',
      targetId: null,
      metadata: { sessionId: 'sess-via-metadata' }
    });

    // Should not throw — uses metadata.sessionId
    expect(arbiter.getViolationsCount()).toBe(0);
    arbiter.stop();
  });
});

// ─── Rule: LOCK_OWNER_VALID ──────────────────────────────────────────────────

describe('Rule: LOCK_OWNER_VALID', () => {
  test('fires when unregistered agent acquires a lock', () => {
    const activityLog = createMockActivityLog();
    const agents = createMockAgents({}); // No agents registered
    const arbiter = createArbiter({ ...buildDeps(), activityLog, agents });

    activityLog.emit({
      type: ActivityType.LOCK_ACQUIRE,
      agentId: 'unregistered-agent',
      targetId: 'my-lock',
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'LOCK_OWNER_VALID');
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('violation');
    arbiter.stop();
  });

  test('does not fire when registered agent acquires a lock', () => {
    const activityLog = createMockActivityLog();
    const agents = createMockAgents({
      'registered-agent': { id: 'registered-agent', name: 'Worker' }
    });
    const arbiter = createArbiter({ ...buildDeps(), activityLog, agents });

    activityLog.emit({
      type: ActivityType.LOCK_ACQUIRE,
      agentId: 'registered-agent',
      targetId: 'my-lock',
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'LOCK_OWNER_VALID');
    expect(violations).toHaveLength(0);
    arbiter.stop();
  });

  test('does not fire when agentId is missing', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.LOCK_ACQUIRE,
      agentId: null,
      targetId: 'my-lock',
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'LOCK_OWNER_VALID');
    expect(violations).toHaveLength(0);
    arbiter.stop();
  });
});

// ─── Rule: PID_SQUATTING ─────────────────────────────────────────────────────

describe('Rule: PID_SQUATTING', () => {
  test('fires when claimed PID differs from agent registered PID', () => {
    const activityLog = createMockActivityLog();
    const agents = createMockAgents({
      'agent-1': { id: 'agent-1', pid: 1234 }
    });
    const arbiter = createArbiter({ ...buildDeps(), activityLog, agents });

    activityLog.emit({
      type: ActivityType.SERVICE_CLAIM,
      agentId: 'agent-1',
      metadata: { pid: 9999 }, // Different from registered PID 1234
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'PID_SQUATTING');
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('critical');
    arbiter.stop();
  });

  test('does not fire when PIDs match', () => {
    const activityLog = createMockActivityLog();
    const agents = createMockAgents({
      'agent-1': { id: 'agent-1', pid: 1234 }
    });
    const arbiter = createArbiter({ ...buildDeps(), activityLog, agents });

    activityLog.emit({
      type: ActivityType.SERVICE_CLAIM,
      agentId: 'agent-1',
      metadata: { pid: 1234 }, // Matches registered PID
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'PID_SQUATTING');
    expect(violations).toHaveLength(0);
    arbiter.stop();
  });

  test('does not fire when no PID in metadata', () => {
    const activityLog = createMockActivityLog();
    const agents = createMockAgents({ 'agent-1': { pid: 1234 } });
    const arbiter = createArbiter({ ...buildDeps(), activityLog, agents });

    activityLog.emit({
      type: ActivityType.SERVICE_CLAIM,
      agentId: 'agent-1',
      metadata: {}, // No pid
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'PID_SQUATTING');
    expect(violations).toHaveLength(0);
    arbiter.stop();
  });

  test('does not fire when agent not registered', () => {
    const activityLog = createMockActivityLog();
    const agents = createMockAgents({}); // No agents
    const arbiter = createArbiter({ ...buildDeps(), activityLog, agents });

    activityLog.emit({
      type: ActivityType.SERVICE_CLAIM,
      agentId: 'ghost-agent',
      metadata: { pid: 9999 },
    });

    // LOCK_OWNER_VALID might fire but not PID_SQUATTING (agent not found)
    const violations = arbiter.getViolations().filter(v => v.rule === 'PID_SQUATTING');
    expect(violations).toHaveLength(0);
    arbiter.stop();
  });
});

// ─── Rule: ESCROW_POSITIVE ───────────────────────────────────────────────────

describe('Rule: ESCROW_POSITIVE', () => {
  test('fires when session starts with zero escrow', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_START,
      agentId: 'agent-1',
      metadata: { escrow: 0 },
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'ESCROW_POSITIVE');
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('violation');
    arbiter.stop();
  });

  test('fires when session starts with negative escrow', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_START,
      agentId: 'agent-1',
      metadata: { escrow: -5 },
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'ESCROW_POSITIVE');
    expect(violations).toHaveLength(1);
    arbiter.stop();
  });

  test('does not fire when escrow field is absent (Float Plans not active)', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_START,
      agentId: 'agent-1',
      metadata: {},
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'ESCROW_POSITIVE');
    expect(violations).toHaveLength(0);
    arbiter.stop();
  });

  test('does not fire when escrow is positive', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_START,
      agentId: 'agent-1',
      metadata: { escrow: 100 },
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'ESCROW_POSITIVE');
    expect(violations).toHaveLength(0);
    arbiter.stop();
  });
});

// ─── strictMode ──────────────────────────────────────────────────────────────

describe('strictMode', () => {
  test('logs man_overboard for critical violations in strict mode', () => {
    const activityLog = createMockActivityLog();
    const agents = createMockAgents({
      'agent-1': { id: 'agent-1', pid: 1234 }
    });
    const arbiter = createArbiter(
      { ...buildDeps(), activityLog, agents },
      { strictMode: true }
    );

    // Trigger a critical violation (PID_SQUATTING)
    activityLog.emit({
      type: ActivityType.SERVICE_CLAIM,
      agentId: 'agent-1',
      metadata: { pid: 9999 },
    });

    const logged = activityLog.getLogged();
    const manOverboard = logged.find(e => e.type === 'system.man_overboard');
    expect(manOverboard).toBeDefined();
    arbiter.stop();
  });

  test('does not log man_overboard in non-strict mode', () => {
    const activityLog = createMockActivityLog();
    const agents = createMockAgents({
      'agent-1': { id: 'agent-1', pid: 1234 }
    });
    const arbiter = createArbiter(
      { ...buildDeps(), activityLog, agents },
      { strictMode: false }
    );

    activityLog.emit({
      type: ActivityType.SERVICE_CLAIM,
      agentId: 'agent-1',
      metadata: { pid: 9999 },
    });

    const logged = activityLog.getLogged();
    const manOverboard = logged.find(e => e.type === 'system.man_overboard');
    expect(manOverboard).toBeUndefined();
    arbiter.stop();
  });
});

// ─── stop() ──────────────────────────────────────────────────────────────────

describe('stop()', () => {
  test('unsubscribes from activity log', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps(), activityLog });
    arbiter.stop();

    // After stop, emitting events should not create violations
    activityLog.emit({
      type: ActivityType.HEARTBEAT_FRESHNESS,
      agentId: 'agent-1',
      metadata: { health: { liveness: 'stale' } }
    });

    expect(arbiter.getViolationsCount()).toBe(0);
  });
});

// ─── resurrection integration ────────────────────────────────────────────────

describe('resurrection event handling', () => {
  test('records HEARTBEAT_FRESHNESS warning when agent dies (if resurrection supports .on)', () => {
    const activityLog = createMockActivityLog();
    const listeners = new Map();
    const resurrection = {
      on(event, cb) { listeners.set(event, cb); }
    };

    const arbiter = createArbiter({ ...buildDeps(), activityLog, resurrection });

    // Simulate a dead agent event
    const deadAgentListener = listeners.get('agent:dead');
    if (deadAgentListener) {
      deadAgentListener({ id: 'dead-agent-123' });
      const violations = arbiter.getViolations().filter(v => v.rule === 'HEARTBEAT_FRESHNESS');
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].agentId).toBe('dead-agent-123');
    }
    // If resurrection doesn't support .on, no throw expected

    arbiter.stop();
  });

  test('does not throw if resurrection lacks .on method', () => {
    const resurrection = {}; // No .on method
    expect(() => {
      const arbiter = createArbiter({ ...buildDeps(), resurrection });
      arbiter.stop();
    }).not.toThrow();
  });
});
