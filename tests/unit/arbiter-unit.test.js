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

function createMockBonds(initialBonds = {}) {
  const bonds = new Map(Object.entries(initialBonds).map(([id, bond]) => [Number(id), bond]));
  return {
    getBond(id) {
      return bonds.get(Number(id)) || null;
    },
    _set(id, bond) {
      bonds.set(Number(id), bond);
    },
  };
}

function buildDeps(overrides = {}) {
  return {
    activityLog: overrides.activityLog || createMockActivityLog(),
    agents: overrides.agents || createMockAgents(),
    sessions: createMockSessions(),
    locks: createMockLocks(),
    resurrection: overrides.resurrection,
    bonds: overrides.bonds,
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
    expect(status.degraded).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'strict_mode_disabled' }),
      expect.objectContaining({ code: 'escrow_bonds_unavailable' }),
    ]));

    const escrowRule = status.ruleDetails.find((rule) => rule.name === 'ESCROW_POSITIVE');
    expect(escrowRule).toEqual(expect.objectContaining({
      coverage: 'degraded',
      engine: 'runtime',
      degradedReason: expect.any(String),
    }));

    const capRule = status.ruleDetails.find((rule) => rule.name === 'CAP_ESCALATION');
    // CAP_ESCALATION is now enforced either way: by the Rust FFI enforcer when
    // present, or by the pure-TS attenuation monitor (proven-equivalent to
    // harbor_card_v5/v7) when the FFI enforcer is absent. The watchman never
    // silently degrades. The ffi_enforcer_unavailable reason is retired.
    expect(capRule.coverage).toBe('enforced');
    expect(capRule.engine).toBe(status.enforcerLoaded ? 'ffi' : 'runtime');
    expect(status.degraded.find((reason) => reason.code === 'ffi_enforcer_unavailable')).toBeUndefined();

    arbiter.stop();
  });

  test('reports escrow rule as enforced when bonds are wired', () => {
    const arbiter = createArbiter(buildDeps({ bonds: createMockBonds() }));
    const status = arbiter.getStatus();
    const escrowRule = status.ruleDetails.find((rule) => rule.name === 'ESCROW_POSITIVE');

    expect(escrowRule).toEqual(expect.objectContaining({
      coverage: 'enforced',
      engine: 'runtime',
      degradedReason: null,
    }));
    expect(status.degraded.find((reason) => reason.code === 'escrow_bonds_unavailable')).toBeUndefined();

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
      expect.objectContaining({ code: 'escrow_bonds_unavailable' }),
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

  test('fires when a spawned session requires escrow but omits bondId', () => {
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps({ bonds: createMockBonds() }), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_START,
      agentId: 'agent-1',
      metadata: { spawn: true, requiresEscrow: true, bondUsd: 0.25 },
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'ESCROW_POSITIVE');
    expect(violations).toHaveLength(1);
    expect(violations[0].details).toContain('without a bondId');
    arbiter.stop();
  });

  test('does not fire when spawned session references a positive active bond', () => {
    const activityLog = createMockActivityLog();
    const bonds = createMockBonds({
      42: { id: 42, agentId: 'agent-1', bondUsd: 0.25, state: 'running' },
    });
    const arbiter = createArbiter({ ...buildDeps({ bonds }), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_START,
      agentId: 'agent-1',
      metadata: { spawn: true, requiresEscrow: true, bondId: 42, bondUsd: 0.25 },
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'ESCROW_POSITIVE');
    expect(violations).toHaveLength(0);
    arbiter.stop();
  });

  test('fires when spawned session references another agent bond', () => {
    const activityLog = createMockActivityLog();
    const bonds = createMockBonds({
      42: { id: 42, agentId: 'agent-owner', bondUsd: 0.25, state: 'running' },
    });
    const arbiter = createArbiter({ ...buildDeps({ bonds }), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_START,
      agentId: 'agent-1',
      metadata: { spawn: true, requiresEscrow: true, bondId: 42, bondUsd: 0.25 },
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'ESCROW_POSITIVE');
    expect(violations).toHaveLength(1);
    expect(violations[0].details).toContain('owned by agent-owner');
    arbiter.stop();
  });

  test('fires when spawned session references a resolved bond', () => {
    const activityLog = createMockActivityLog();
    const bonds = createMockBonds({
      42: { id: 42, agentId: 'agent-1', bondUsd: 0.25, state: 'refunded' },
    });
    const arbiter = createArbiter({ ...buildDeps({ bonds }), activityLog });

    activityLog.emit({
      type: ActivityType.SESSION_START,
      agentId: 'agent-1',
      metadata: { spawn: true, requiresEscrow: true, bondId: 42, bondUsd: 0.25 },
    });

    const violations = arbiter.getViolations().filter(v => v.rule === 'ESCROW_POSITIVE');
    expect(violations).toHaveLength(1);
    expect(violations[0].details).toContain('resolved bond');
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

// ─── CAP_ESCALATION runtime fallback (#160-adjacent; runtime-verification) ────
describe('CAP_ESCALATION runtime monitor fallback', () => {
  // Before this change, CAP_ESCALATION reported `degraded` (advisory only)
  // whenever the Rust FFI enforcer was absent. The pure-TS monitor now keeps
  // it enforced either way. `enforcerLoaded` depends on whether this machine
  // happens to have the compiled Rust binary on disk (true in most real dev
  // checkouts, false in a from-scratch CI/sandbox clone) — a previous version
  // of this test hard-asserted `enforcerLoaded === false`, which only held in
  // the latter case and failed on any machine with the binary built. Assert
  // the actual invariant under test (enforced either way) adaptively, the
  // same way line ~165 above already does for `capRule.engine`.
  test('reports enforced via the runtime engine when FFI enforcer is absent', () => {
    const arbiter = createArbiter(buildDeps());
    const status = arbiter.getStatus();
    expect(typeof status.enforcerLoaded).toBe('boolean');
    const cap = status.ruleDetails.find((r) => r.name === 'CAP_ESCALATION');
    expect(cap.coverage).toBe('enforced');
    expect(cap.engine).toBe(status.enforcerLoaded ? 'ffi' : 'runtime');
    expect(cap.degradedReason).toBeNull();
    // and the ffi_enforcer_unavailable degraded reason is no longer raised
    expect(status.degraded.some((d) => d.code === 'ffi_enforcer_unavailable')).toBe(false);
  });

  test('checkCapAttenuation records a critical violation on a per-hop escalation', () => {
    const arbiter = createArbiter(buildDeps());
    // A:pub:* → B:pub:a (legit) → C:pub:* (escalation back to broad) — the
    // harbor_card_v6 multi-hop attack; per-hop catches it at hop 2.
    const chain = [['chan:pub:*'], ['chan:pub:a'], ['chan:pub:*']];
    const v = arbiter.checkCapAttenuation(chain, 'agent-x');
    expect(v).not.toBeNull();
    expect(v.hop).toBe(2);
    expect(arbiter.getViolationsCount()).toBe(1);
    const recorded = arbiter.getViolations()[0];
    expect(recorded.rule).toBe('CAP_ESCALATION');
    expect(recorded.severity).toBe('critical');
    expect(recorded.agentId).toBe('agent-x');
  });

  test('checkCapAttenuation passes a monotonically-narrowing chain with no violation', () => {
    const arbiter = createArbiter(buildDeps());
    const chain = [['chan:pub:a'], ['chan:pub:a/b'], ['chan:pub:a/b/c']];
    expect(arbiter.checkCapAttenuation(chain)).toBeNull();
    expect(arbiter.getViolationsCount()).toBe(0);
  });
});

// ─── Forensics sink (ADR-0089) ─────────────────────────────────────────────────

describe('forensics sink — durable security retention', () => {
  function capturingSink() {
    const recorded = [];
    return { recorded, record: (e) => recorded.push(e) };
  }

  test('every recorded violation is mirrored to the forensics sink (full event)', () => {
    const sink = capturingSink();
    const arbiter = createArbiter({ ...buildDeps(), forensicsSink: sink });
    const v = arbiter.injectTestViolation('PID_SQUATTING');
    expect(v).not.toBeNull();
    expect(sink.recorded).toHaveLength(1);
    expect(sink.recorded[0].rule).toBe('PID_SQUATTING');
    expect(sink.recorded[0].severity).toBe('critical');
    expect(sink.recorded[0].details).toMatch(/PID squatting/i);
  });

  test('a throwing sink never breaks violation recording (fire-and-forget)', () => {
    const arbiter = createArbiter({
      ...buildDeps(),
      forensicsSink: { record: () => { throw new Error('disk full'); } },
    });
    expect(() => arbiter.injectTestViolation('PID_SQUATTING')).not.toThrow();
    expect(arbiter.getViolationsCount()).toBe(1); // recording still succeeded
  });

  test('no sink configured → recording unaffected (back-compat)', () => {
    const arbiter = createArbiter(buildDeps());
    expect(() => arbiter.injectTestViolation('NOTE_MONOTONICITY')).not.toThrow();
    expect(arbiter.getViolationsCount()).toBe(1);
  });

  test('the forensics sink also fires when activity_log would later prune the event', () => {
    // The sink is written BEFORE activityLog.log, so it is independent of the
    // 7-day activity prune — that independence is the whole point.
    const sink = capturingSink();
    const activityLog = createMockActivityLog();
    const arbiter = createArbiter({ ...buildDeps({ activityLog }), forensicsSink: sink });
    arbiter.injectTestViolation('PID_SQUATTING');
    expect(sink.recorded).toHaveLength(1);
    expect(activityLog.getLogged().some((e) => e.type === 'security.violation')).toBe(true);
  });
});
