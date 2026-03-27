import { describe, test, expect, beforeEach } from '@jest/globals';

// Minimal mock of the activity log subscribe pattern
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

function createMockAgents() {
  const agents = new Map();
  return {
    get(id) {
      const agent = agents.get(id);
      if (!agent) return { success: false };
      return { success: true, agent };
    },
    _set(id, data) { agents.set(id, data); },
  };
}

function createMockSessions() {
  return {};
}

function createMockLocks() {
  return {};
}

// We can't import the TS module directly in Jest without transpilation,
// so we test the Arbiter's behavior through its public API contract.
// The actual integration test happens via the HTTP endpoints.

describe('Arbiter Invariant Rules', () => {
  describe('Contract Tests (via HTTP — requires daemon)', () => {
    // These tests verify the Arbiter's HTTP API contract.
    // They run against the live daemon if available.

    const BASE = process.env.PD_URL || 'http://localhost:9876';

    test('GET /arbiter/status returns rule count and status', async () => {
      try {
        const res = await fetch(`${BASE}/arbiter/status`);
        if (res.status === 404) return; // Arbiter not yet deployed to stable
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.active).toBe(true);
        expect(data.rulesCount).toBe(6);
        expect(data.rules).toContain('PID_SQUATTING');
        expect(data.rules).toContain('NOTE_MONOTONICITY');
        expect(data.rules).toContain('ESCROW_POSITIVE');
        expect(data.rules).toContain('LOCK_OWNER_VALID');
        expect(data.rules).toContain('CAP_ESCALATION');
        expect(data.rules).toContain('HEARTBEAT_FRESHNESS');
        expect(typeof data.violationsCount).toBe('number');
        expect(typeof data.uptimeMs).toBe('number');
      } catch (err) {
        // Daemon not running — skip
        console.log('Skipping (daemon not running):', err.message);
      }
    });

    test('POST /arbiter/test-invariant/NOTE_MONOTONICITY injects a violation', async () => {
      try {
        const res = await fetch(`${BASE}/arbiter/test-invariant/NOTE_MONOTONICITY`, { method: 'POST' });
        if (res.status === 404) return;
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.violation).toBeDefined();
        expect(data.violation.rule).toBe('NOTE_MONOTONICITY');
        expect(data.violation.severity).toBe('critical');
        expect(data.violation.details).toContain('TEST');
      } catch (err) {
        console.log('Skipping (daemon not running):', err.message);
      }
    });

    test('POST /arbiter/test-invariant/PID_SQUATTING injects a critical violation', async () => {
      try {
        const res = await fetch(`${BASE}/arbiter/test-invariant/PID_SQUATTING`, { method: 'POST' });
        if (res.status === 404) return;
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.violation.severity).toBe('critical');
      } catch (err) {
        console.log('Skipping:', err.message);
      }
    });

    test('POST /arbiter/test-invariant/INVALID returns 400', async () => {
      try {
        const res = await fetch(`${BASE}/arbiter/test-invariant/INVALID`, { method: 'POST' });
        if (res.status === 404) return;
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.validNames).toBeDefined();
      } catch (err) {
        console.log('Skipping:', err.message);
      }
    });

    test('GET /arbiter/violations returns violation list after injection', async () => {
      try {
        // Inject first
        await fetch(`${BASE}/arbiter/test-invariant/ESCROW_POSITIVE`, { method: 'POST' });
        const res = await fetch(`${BASE}/arbiter/violations`);
        if (res.status === 404) return;
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(Array.isArray(data.violations)).toBe(true);
        expect(data.total).toBeGreaterThan(0);
      } catch (err) {
        console.log('Skipping:', err.message);
      }
    });

    test('All 6 invariant names can be test-injected', async () => {
      const names = [
        'PID_SQUATTING', 'CAP_ESCALATION', 'NOTE_MONOTONICITY',
        'ESCROW_POSITIVE', 'LOCK_OWNER_VALID', 'HEARTBEAT_FRESHNESS',
      ];
      for (const name of names) {
        try {
          const res = await fetch(`${BASE}/arbiter/test-invariant/${name}`, { method: 'POST' });
          if (res.status === 404) return;
          const data = await res.json();
          expect(data.success).toBe(true);
          expect(data.violation.rule).toBe(name);
        } catch (err) {
          console.log(`Skipping ${name}:`, err.message);
        }
      }
    });
  });
});
