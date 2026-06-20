/**
 * Unit Tests for lib/pheromone.ts
 *
 * Tests the stigmergic pheromone evaporation system.
 * Uses in-memory SQLite so we can set up rows and verify updates.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createPheromoneManager,
  dampedStrength,
  applyResolutionDamping,
  coverageOf,
  pickUnseenTarget,
} from '../../lib/pheromone.js';
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

// ─── spray ───────────────────────────────────────────────────────────────────

describe('spray', () => {
  function insertService(id, port = 3000) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen)
      VALUES (?, ?, 'assigned', ?, ?)
    `).run(id, port, now, now);
  }

  test('sets a pheromone on a valid service entity', () => {
    insertService('spray-svc', 3000);
    const mgr = createPheromoneManager(db);

    const result = mgr.spray('services', 'spray-svc', 'urgency', 0.8);
    expect(result.success).toBe(true);
    expect(result.pheromones.urgency).toBe(0.8);
  });

  test('rejects an invalid table name', () => {
    const mgr = createPheromoneManager(db);
    const result = mgr.spray('DROP TABLE services;--', 'svc', 'urgency', 0.8);
    expect(result.success).toBe(false);
    expect(result.pheromones).toEqual({});
  });

  test('rejects strength < 0', () => {
    insertService('spray-neg', 3001);
    const mgr = createPheromoneManager(db);
    const result = mgr.spray('services', 'spray-neg', 'urgency', -0.1);
    expect(result.success).toBe(false);
  });

  test('rejects strength > 1', () => {
    insertService('spray-over', 3002);
    const mgr = createPheromoneManager(db);
    const result = mgr.spray('services', 'spray-over', 'urgency', 1.1);
    expect(result.success).toBe(false);
  });

  test('returns false for non-existent entity', () => {
    const mgr = createPheromoneManager(db);
    const result = mgr.spray('services', 'ghost-entity', 'urgency', 0.5);
    expect(result.success).toBe(false);
    expect(result.pheromones).toEqual({});
  });

  test('accepts strength = 0 (boundary)', () => {
    insertService('spray-zero', 3003);
    const mgr = createPheromoneManager(db);
    const result = mgr.spray('services', 'spray-zero', 'heat', 0);
    expect(result.success).toBe(true);
    expect(result.pheromones.heat).toBe(0);
  });

  test('accepts strength = 1 (boundary)', () => {
    insertService('spray-one', 3004);
    const mgr = createPheromoneManager(db);
    const result = mgr.spray('services', 'spray-one', 'heat', 1);
    expect(result.success).toBe(true);
    expect(result.pheromones.heat).toBe(1);
  });

  test('overwrites an existing pheromone value', () => {
    const now = Date.now();
    const meta = JSON.stringify({ pheromones: { urgency: 0.3 } });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('spray-overwrite', 3005, 'assigned', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db);
    const result = mgr.spray('services', 'spray-overwrite', 'urgency', 0.9);
    expect(result.success).toBe(true);
    expect(result.pheromones.urgency).toBe(0.9);
  });

  test('adds a new key without disturbing existing pheromones', () => {
    const now = Date.now();
    const meta = JSON.stringify({ pheromones: { existing: 0.5 } });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('spray-add', 3006, 'assigned', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db);
    const result = mgr.spray('services', 'spray-add', 'new_key', 0.7);
    expect(result.success).toBe(true);
    expect(result.pheromones.existing).toBe(0.5);
    expect(result.pheromones.new_key).toBe(0.7);
  });

  test('works on sessions table', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, purpose, status, created_at, updated_at)
      VALUES ('spray-sess', 'Test', 'active', ?, ?)
    `).run(now, now);

    const mgr = createPheromoneManager(db);
    const result = mgr.spray('sessions', 'spray-sess', 'interest', 0.6);
    expect(result.success).toBe(true);
    expect(result.pheromones.interest).toBe(0.6);
  });
});

// ─── sniff ────────────────────────────────────────────────────────────────────

describe('sniff', () => {
  test('returns pheromones for entity with metadata', () => {
    const now = Date.now();
    const meta = JSON.stringify({ pheromones: { urgency: 0.8, priority: 0.5 } });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('sniff-svc', 3100, 'assigned', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db);
    const result = mgr.sniff('services', 'sniff-svc');
    expect(result.success).toBe(true);
    expect(result.pheromones.urgency).toBeCloseTo(0.8, 3);
    expect(result.pheromones.priority).toBeCloseTo(0.5, 3);
  });

  test('returns false for an invalid table name', () => {
    const mgr = createPheromoneManager(db);
    const result = mgr.sniff('bad_table', 'any-id');
    expect(result.success).toBe(false);
    expect(result.pheromones).toEqual({});
  });

  test('returns false for a non-existent entity', () => {
    const mgr = createPheromoneManager(db);
    const result = mgr.sniff('services', 'does-not-exist');
    expect(result.success).toBe(false);
    expect(result.pheromones).toEqual({});
  });

  test('returns empty pheromones for entity with null metadata', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen)
      VALUES ('sniff-null', 3101, 'assigned', ?, ?)
    `).run(now, now);

    const mgr = createPheromoneManager(db);
    const result = mgr.sniff('services', 'sniff-null');
    expect(result.success).toBe(true);
    expect(result.pheromones).toEqual({});
  });

  test('returns empty pheromones for entity with metadata but no pheromones key', () => {
    const now = Date.now();
    const meta = JSON.stringify({ tags: ['api'], version: 2 });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('sniff-no-ph', 3102, 'assigned', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db);
    const result = mgr.sniff('services', 'sniff-no-ph');
    expect(result.success).toBe(true);
    expect(result.pheromones).toEqual({});
  });

  test('works on sessions table', () => {
    const now = Date.now();
    const meta = JSON.stringify({ pheromones: { interest: 0.7 } });
    db.prepare(`
      INSERT INTO sessions (id, purpose, status, created_at, updated_at, metadata)
      VALUES ('sniff-sess', 'Test', 'active', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db);
    const result = mgr.sniff('sessions', 'sniff-sess');
    expect(result.success).toBe(true);
    expect(result.pheromones.interest).toBeCloseTo(0.7, 3);
  });
});

// ─── spray + sniff roundtrip ──────────────────────────────────────────────────

describe('spray + sniff roundtrip', () => {
  test('sprayed value is readable via sniff immediately', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen)
      VALUES ('rt-svc', 3200, 'assigned', ?, ?)
    `).run(now, now);

    const mgr = createPheromoneManager(db);
    mgr.spray('services', 'rt-svc', 'heat', 0.75);

    const result = mgr.sniff('services', 'rt-svc');
    expect(result.success).toBe(true);
    // May have minor read-time decay but < 1s elapsed so value should be unchanged
    expect(result.pheromones.heat).toBeCloseTo(0.75, 3);
  });

  test('multiple separate spray calls accumulate correctly', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen)
      VALUES ('rt-multi', 3201, 'assigned', ?, ?)
    `).run(now, now);

    const mgr = createPheromoneManager(db);
    mgr.spray('services', 'rt-multi', 'alpha', 0.5);
    mgr.spray('services', 'rt-multi', 'beta', 0.9);

    const result = mgr.sniff('services', 'rt-multi');
    expect(result.pheromones.alpha).toBeCloseTo(0.5, 3);
    expect(result.pheromones.beta).toBeCloseTo(0.9, 3);
  });

  test('spray then evaporate reduces sniffed value', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen)
      VALUES ('rt-evap', 3202, 'assigned', ?, ?)
    `).run(now, now);

    const mgr = createPheromoneManager(db, { decayRate: 0.5, intervalMs: 60000 });
    mgr.spray('services', 'rt-evap', 'signal', 1.0);
    mgr.evaporateNow();

    const result = mgr.sniff('services', 'rt-evap');
    // After evaporation with 0.5 rate: 1.0 * 0.5 = 0.5
    expect(result.pheromones.signal).toBeCloseTo(0.5, 3);
  });
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe('list', () => {
  test('returns empty array when no entities have pheromones', () => {
    const mgr = createPheromoneManager(db);
    expect(mgr.list()).toEqual([]);
  });

  test('returns entries for services with pheromones', () => {
    const now = Date.now();
    const meta = JSON.stringify({ pheromones: { urgency: 0.8 } });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('list-svc', 3300, 'assigned', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db);
    const results = mgr.list();
    expect(results.length).toBeGreaterThan(0);
    const entry = results.find(r => r.id === 'list-svc');
    expect(entry).toBeDefined();
    expect(entry.table).toBe('services');
    expect(entry.pheromones.urgency).toBe(0.8);
  });

  test('excludes entities with an empty pheromones object', () => {
    const now = Date.now();
    const meta = JSON.stringify({ pheromones: {} });
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('list-empty', 3301, 'assigned', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db);
    const results = mgr.list();
    const entry = results.find(r => r.id === 'list-empty');
    expect(entry).toBeUndefined();
  });

  test('includes sessions table entries', () => {
    const now = Date.now();
    const meta = JSON.stringify({ pheromones: { interest: 0.6 } });
    db.prepare(`
      INSERT INTO sessions (id, purpose, status, created_at, updated_at, metadata)
      VALUES ('list-sess', 'Test', 'active', ?, ?, ?)
    `).run(now, now, meta);

    const mgr = createPheromoneManager(db);
    const results = mgr.list();
    const entry = results.find(r => r.id === 'list-sess');
    expect(entry).toBeDefined();
    expect(entry.table).toBe('sessions');
  });

  test('returns entries from multiple tables in a single call', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, metadata)
      VALUES ('list-both-svc', 3302, 'assigned', ?, ?, ?)
    `).run(now, now, JSON.stringify({ pheromones: { a: 0.5 } }));
    db.prepare(`
      INSERT INTO sessions (id, purpose, status, created_at, updated_at, metadata)
      VALUES ('list-both-sess', 'Test', 'active', ?, ?, ?)
    `).run(now, now, JSON.stringify({ pheromones: { b: 0.7 } }));

    const mgr = createPheromoneManager(db);
    const results = mgr.list();

    const svcEntry = results.find(r => r.id === 'list-both-svc');
    const sessEntry = results.find(r => r.id === 'list-both-sess');
    expect(svcEntry).toBeDefined();
    expect(sessEntry).toBeDefined();
  });

  test('reflects a sprayed pheromone immediately', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen)
      VALUES ('list-spray', 3303, 'assigned', ?, ?)
    `).run(now, now);

    const mgr = createPheromoneManager(db);
    mgr.spray('services', 'list-spray', 'heat', 0.9);

    const results = mgr.list();
    const entry = results.find(r => r.id === 'list-spray');
    expect(entry).toBeDefined();
    expect(entry.pheromones.heat).toBe(0.9);
  });
});

// ─── RCP-7a / RCP-12 pure helpers (no DB) ────────────────────────────────────

describe('dampedStrength (RCP-7a)', () => {
  test('full resolution damps to zero', () => {
    expect(dampedStrength(0.8, 1)).toBeCloseTo(0);
  });
  test('partial resolution scales down proportionally', () => {
    expect(dampedStrength(0.8, 0.5)).toBeCloseTo(0.4);
  });
  test('no resolution leaves the raw value untouched', () => {
    expect(dampedStrength(0.8, 0)).toBe(0.8);
  });
  test('damping factor amplifies suppression and clamps at 1', () => {
    expect(dampedStrength(0.8, 0.5, 2)).toBeCloseTo(0); // 2*0.5 = 1 → full
  });
});

describe('applyResolutionDamping (RCP-7a)', () => {
  test('damps only the keys that carry a resolution', () => {
    const out = applyResolutionDamping({ a: 0.8, b: 0.6 }, { a: 1 });
    expect(out.a).toBeUndefined();      // fully damped → dropped (< 0.01)
    expect(out.b).toBeCloseTo(0.6);     // untouched
  });
});

describe('coverageOf (RCP-12)', () => {
  test('computes coverage and the unseen set', () => {
    const c = coverageOf(['a', 'b', 'c', 'd'], ['a', 'b']);
    expect(c.total).toBe(4);
    expect(c.seen).toBe(2);
    expect(c.coverage).toBe(0.5);
    expect(c.unseen.sort()).toEqual(['c', 'd']);
  });
  test('empty universe is fully covered (no divide-by-zero)', () => {
    expect(coverageOf([], []).coverage).toBe(1);
  });
  test('seen ids outside the universe do not inflate coverage', () => {
    expect(coverageOf(['a'], ['a', 'ghost']).coverage).toBe(1);
  });
});

describe('pickUnseenTarget (RCP-12)', () => {
  test('is deterministic given rngValue and picks within the unseen set', () => {
    expect(pickUnseenTarget(['x', 'y', 'z'], 0)).toBe('x');
    expect(pickUnseenTarget(['x', 'y', 'z'], 0.5)).toBe('y');
    expect(pickUnseenTarget(['x', 'y', 'z'], 0.99)).toBe('z');
  });
  test('returns null when everything is seen', () => {
    expect(pickUnseenTarget([], 0.5)).toBeNull();
  });
});

// ─── resolution traces + coverage on the manager (DB-backed) ─────────────────

describe('sprayResolution + sniffEffective (RCP-7a)', () => {
  function insertService(id, port = 4000) {
    const now = Date.now();
    db.prepare(`INSERT INTO services (id, port, status, created_at, last_seen) VALUES (?, ?, 'assigned', ?, ?)`).run(id, port, now, now);
  }

  test('a resolution trace damps the effective pheromone but not the raw sniff', () => {
    insertService('res-svc');
    const mgr = createPheromoneManager(db);
    mgr.spray('services', 'res-svc', 'heat', 0.9);

    expect(mgr.sniff('services', 'res-svc').pheromones.heat).toBeCloseTo(0.9); // raw unaffected
    const r = mgr.sprayResolution('services', 'res-svc', 'heat', 1);
    expect(r.success).toBe(true);
    expect(mgr.sniffEffective('services', 'res-svc').pheromones.heat).toBeUndefined(); // damped away
  });

  test('rejects an out-of-range resolution strength', () => {
    insertService('res-bad');
    const mgr = createPheromoneManager(db);
    expect(mgr.sprayResolution('services', 'res-bad', 'heat', 5).success).toBe(false);
  });

  test('resolution traces fade faster than pheromones under evaporation', () => {
    insertService('res-fade');
    const mgr = createPheromoneManager(db, { decayRate: 0.5, intervalMs: 60000 });
    mgr.spray('services', 'res-fade', 'heat', 0.8);
    mgr.sprayResolution('services', 'res-fade', 'heat', 0.8);
    mgr.evaporateNow();
    const md = JSON.parse(db.prepare(`SELECT metadata FROM services WHERE id = 'res-fade'`).get().metadata);
    // pheromone *0.5 = 0.4 ; resolution *0.25 = 0.2  → resolution decayed more
    expect(md.pheromones.heat).toBeCloseTo(0.4);
    expect(md.resolutions.heat).toBeCloseTo(0.2);
  });
});

describe('coverage (RCP-12)', () => {
  function insertService(id, port) {
    const now = Date.now();
    db.prepare(`INSERT INTO services (id, port, status, created_at, last_seen) VALUES (?, ?, 'assigned', ?, ?)`).run(id, port, now, now);
  }

  test('reports the fraction of entities that carry pheromone', () => {
    insertService('cov-a', 5001);
    insertService('cov-b', 5002);
    insertService('cov-c', 5003);
    const mgr = createPheromoneManager(db);
    mgr.spray('services', 'cov-a', 'heat', 0.5);

    const c = mgr.coverage('services');
    expect(c.success).toBe(true);
    expect(c.total).toBe(3);
    expect(c.seen).toBe(1);
    expect(c.coverage).toBeCloseTo(1 / 3);
    expect(c.unseen.sort()).toEqual(['cov-b', 'cov-c']);
  });

  test('rejects an invalid table', () => {
    const mgr = createPheromoneManager(db);
    expect(mgr.coverage('DROP TABLE services;--').success).toBe(false);
  });
});
