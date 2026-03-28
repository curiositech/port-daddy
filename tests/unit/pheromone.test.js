/**
 * Unit Tests for lib/pheromone.ts
 *
 * Tests the stigmergic pheromone evaporation system.
 * Uses in-memory SQLite so we can set up rows and verify updates.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createPheromoneManager } from '../../lib/pheromone.js';
import { createTestDb } from '../setup-unit.js';

let db;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

// ─── createPheromoneManager ──────────────────────────────────────────────────

describe('createPheromoneManager', () => {
  test('returns start, stop, evaporateNow methods', () => {
    const mgr = createPheromoneManager(db);
    expect(typeof mgr.start).toBe('function');
    expect(typeof mgr.stop).toBe('function');
    expect(typeof mgr.evaporateNow).toBe('function');
  });

  test('uses default config when none provided', () => {
    const mgr = createPheromoneManager(db);
    expect(mgr).toBeDefined(); // No error thrown
  });

  test('accepts custom config', () => {
    const mgr = createPheromoneManager(db, { decayRate: 0.5, intervalMs: 30000 });
    expect(mgr).toBeDefined();
  });
});

// ─── start / stop ────────────────────────────────────────────────────────────

describe('start / stop', () => {
  test('start does not throw', () => {
    const mgr = createPheromoneManager(db, { decayRate: 0.95, intervalMs: 60000 });
    expect(() => mgr.start()).not.toThrow();
    mgr.stop();
  });

  test('stop does not throw even when not started', () => {
    const mgr = createPheromoneManager(db);
    expect(() => mgr.stop()).not.toThrow();
  });

  test('calling start twice does not create duplicate timers', () => {
    const mgr = createPheromoneManager(db, { decayRate: 0.95, intervalMs: 60000 });
    expect(() => {
      mgr.start();
      mgr.start(); // Second call should be a no-op
    }).not.toThrow();
    mgr.stop();
  });

  test('stop clears the timer (subsequent evaporate is manual)', () => {
    const mgr = createPheromoneManager(db, { decayRate: 0.95, intervalMs: 60000 });
    mgr.start();
    mgr.stop();
    // Should be able to call stop again without error
    expect(() => mgr.stop()).not.toThrow();
  });
});

// ─── evaporateNow — no pheromones ────────────────────────────────────────────

describe('evaporateNow — rows without pheromones', () => {
  test('runs without error on empty tables', () => {
    const mgr = createPheromoneManager(db);
    expect(() => mgr.evaporateNow()).not.toThrow();
  });

  test('does not modify rows with null metadata', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen)
      VALUES ('svc-1', 3000, 'assigned', ?, ?)
    `).run(now, now);

    const mgr = createPheromoneManager(db);
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    expect(row.metadata).toBeNull();
  });

  test('does not modify rows with metadata lacking pheromones key', () => {
    const now = Date.now();
    const meta = JSON.stringify({ tags: ['web', 'api'] });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('svc-1', 3000, 'assigned', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db);
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    expect(JSON.parse(row.metadata).tags).toEqual(['web', 'api']);
  });
});

// ─── evaporateNow — pheromone decay ─────────────────────────────────────────

describe('evaporateNow — pheromone decay on services', () => {
  function insertServiceWithPheromones(id, port, pheromones) {
    const now = Date.now();
    const meta = JSON.stringify({ pheromones });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES (?, ?, 'assigned', ?, ?, ?)
    `).run(id, port, now, now, meta);
  }

  test('decays pheromone values by decay rate', () => {
    insertServiceWithPheromones('svc-1', 3000, { urgency: 1.0 });

    const mgr = createPheromoneManager(db, { decayRate: 0.5, intervalMs: 60000 });
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    const meta = JSON.parse(row.metadata);
    expect(meta.pheromones.urgency).toBeCloseTo(0.5, 5);
  });

  test('applies 0.95 default decay rate correctly', () => {
    insertServiceWithPheromones('svc-1', 3000, { priority: 1.0 });

    const mgr = createPheromoneManager(db, { decayRate: 0.95, intervalMs: 60000 });
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    const meta = JSON.parse(row.metadata);
    expect(meta.pheromones.priority).toBeCloseTo(0.95, 5);
  });

  test('removes pheromone key when value falls below 0.01', () => {
    insertServiceWithPheromones('svc-1', 3000, { fading: 0.005 });

    const mgr = createPheromoneManager(db, { decayRate: 0.95, intervalMs: 60000 });
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    const meta = JSON.parse(row.metadata);
    expect(meta.pheromones.fading).toBeUndefined();
  });

  test('removes pheromone exactly at threshold after decay', () => {
    // 0.0105 * 0.95 = ~0.00997 < 0.01
    insertServiceWithPheromones('svc-1', 3000, { borderline: 0.0105 });

    const mgr = createPheromoneManager(db, { decayRate: 0.95, intervalMs: 60000 });
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    const meta = JSON.parse(row.metadata);
    expect(meta.pheromones.borderline).toBeUndefined();
  });

  test('keeps pheromone above threshold', () => {
    insertServiceWithPheromones('svc-1', 3000, { strong: 0.5 });

    const mgr = createPheromoneManager(db, { decayRate: 0.95, intervalMs: 60000 });
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    const meta = JSON.parse(row.metadata);
    expect(meta.pheromones.strong).toBeGreaterThan(0.01);
  });

  test('decays multiple pheromone keys independently', () => {
    insertServiceWithPheromones('svc-1', 3000, {
      high: 1.0,
      medium: 0.5,
      low: 0.1,
    });

    const mgr = createPheromoneManager(db, { decayRate: 0.8, intervalMs: 60000 });
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    const meta = JSON.parse(row.metadata);
    expect(meta.pheromones.high).toBeCloseTo(0.8, 5);
    expect(meta.pheromones.medium).toBeCloseTo(0.4, 5);
    expect(meta.pheromones.low).toBeCloseTo(0.08, 5);
  });

  test('does not decay non-numeric pheromone values', () => {
    const now = Date.now();
    const meta = JSON.stringify({
      pheromones: { tag: 'important', score: 0.9 }
    });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('svc-1', 3000, 'assigned', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db, { decayRate: 0.5, intervalMs: 60000 });
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    const resultMeta = JSON.parse(row.metadata);
    // String values should be unchanged
    expect(resultMeta.pheromones.tag).toBe('important');
    // Numeric value should decay
    expect(resultMeta.pheromones.score).toBeCloseTo(0.45, 5);
  });

  test('preserves non-pheromone metadata fields', () => {
    const now = Date.now();
    const meta = JSON.stringify({
      version: 'v2',
      pheromones: { urgency: 0.9 },
      tags: ['api']
    });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('svc-1', 3000, 'assigned', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db, { decayRate: 0.9, intervalMs: 60000 });
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    const resultMeta = JSON.parse(row.metadata);
    expect(resultMeta.version).toBe('v2');
    expect(resultMeta.tags).toEqual(['api']);
    expect(resultMeta.pheromones.urgency).toBeCloseTo(0.81, 5);
  });

  test('processes multiple services', () => {
    insertServiceWithPheromones('svc-1', 3000, { a: 1.0 });
    insertServiceWithPheromones('svc-2', 3001, { b: 0.8 });

    const mgr = createPheromoneManager(db, { decayRate: 0.5, intervalMs: 60000 });
    mgr.evaporateNow();

    const row1 = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-1');
    const row2 = db.prepare('SELECT metadata FROM services WHERE id = ?').get('svc-2');

    expect(JSON.parse(row1.metadata).pheromones.a).toBeCloseTo(0.5, 5);
    expect(JSON.parse(row2.metadata).pheromones.b).toBeCloseTo(0.4, 5);
  });
});

// ─── evaporateNow — sessions table ──────────────────────────────────────────

describe('evaporateNow — pheromone decay on sessions table', () => {
  test('decays pheromones in sessions table', () => {
    const now = Date.now();
    const meta = JSON.stringify({ pheromones: { interest: 0.6 } });
    db.prepare(`
      INSERT INTO sessions (id, purpose, status, created_at, updated_at, metadata)
      VALUES ('sess-1', 'Test session', 'active', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db, { decayRate: 0.5, intervalMs: 60000 });
    mgr.evaporateNow();

    const row = db.prepare('SELECT metadata FROM sessions WHERE id = ?').get('sess-1');
    const result = JSON.parse(row.metadata);
    expect(result.pheromones.interest).toBeCloseTo(0.3, 5);
  });
});

// ─── evaporateNow — invalid JSON ─────────────────────────────────────────────

describe('evaporateNow — handles bad data gracefully', () => {
  test('does not throw when metadata contains invalid JSON', () => {
    const now = Date.now();
    // Directly insert invalid JSON (bypassing the module's JSON.stringify)
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('svc-bad', 9999, 'assigned', ?, ?, ?)
    `).run(now, now, 'NOT VALID JSON {{{');

    const mgr = createPheromoneManager(db);
    expect(() => mgr.evaporateNow()).not.toThrow();
  });
});
