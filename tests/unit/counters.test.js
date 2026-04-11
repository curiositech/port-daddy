/**
 * Unit tests for lib/counters.ts
 *
 * Uses in-memory SQLite (createTestDb from setup-unit.js).
 */

import { createTestDb } from '../setup-unit.js';
import { createCounters } from '../../lib/counters.js';

describe('Counters', () => {
  let db;
  let counters;

  beforeEach(() => {
    db = createTestDb();
    counters = createCounters(db);
  });

  afterEach(() => {
    counters.shutdown();
    db.close();
  });

  test('bump + summary returns the key', () => {
    counters.bump('spawn.started');
    counters.flush();
    const rows = counters.summary();
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find(r => r.key === 'spawn.started');
    expect(row).toBeDefined();
    expect(row.total).toBe(1);
  });

  test('bump increments by N', () => {
    counters.bump('spawn.started', {}, 5);
    counters.flush();
    const rows = counters.summary();
    const row = rows.find(r => r.key === 'spawn.started');
    expect(row.total).toBe(5);
  });

  test('bump accumulates multiple calls', () => {
    counters.bump('spawn.started');
    counters.bump('spawn.started');
    counters.bump('spawn.started');
    counters.flush();
    const rows = counters.summary();
    const row = rows.find(r => r.key === 'spawn.started');
    expect(row.total).toBe(3);
  });

  test('dimensions are kept separate', () => {
    counters.bump('spawn.started', { backend: 'claude-cli' });
    counters.bump('spawn.started', { backend: 'ollama' });
    counters.bump('spawn.started', { backend: 'claude-cli' });
    counters.flush();

    const topResult = counters.topN('spawn.started', 'backend');
    const claudeRow = topResult.find(r => r.value === 'claude-cli');
    const ollamaRow = topResult.find(r => r.value === 'ollama');
    expect(claudeRow.count).toBe(2);
    expect(ollamaRow.count).toBe(1);
  });

  test('topN returns ordered results', () => {
    counters.bump('spawn.started', { backend: 'a' }, 1);
    counters.bump('spawn.started', { backend: 'b' }, 5);
    counters.bump('spawn.started', { backend: 'c' }, 3);
    counters.flush();

    const top = counters.topN('spawn.started', 'backend');
    expect(top[0].value).toBe('b');
    expect(top[0].count).toBe(5);
    expect(top[1].value).toBe('c');
  });

  test('query with groupBy minute returns buckets', () => {
    counters.bump('fleet.spawn.started');
    counters.flush();

    const results = counters.query({ key: 'fleet.spawn.started', groupBy: 'minute' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].key).toBe('fleet.spawn.started');
    expect(results[0].value).toBe(1);
  });

  test('multiple keys tracked independently', () => {
    counters.bump('spawn.started');
    counters.bump('spawn.completed');
    counters.bump('spawn.failed');
    counters.flush();

    const rows = counters.summary();
    const keys = rows.map(r => r.key);
    expect(keys).toContain('spawn.started');
    expect(keys).toContain('spawn.completed');
    expect(keys).toContain('spawn.failed');
  });

  test('summary perHour is non-negative', () => {
    counters.bump('x.event', {}, 10);
    counters.flush();
    const rows = counters.summary();
    rows.forEach(r => expect(r.perHour).toBeGreaterThanOrEqual(0));
  });

  // queryTotals — batch key fetch (used by /metrics/golden)
  test('queryTotals returns totals for multiple keys in one call', () => {
    counters.bump('spawn.started', {}, 5);
    counters.bump('spawn.failed', {}, 2);
    counters.bump('spawn.completed', {}, 3);
    counters.flush();

    const totals = counters.queryTotals(['spawn.started', 'spawn.failed', 'spawn.completed']);
    expect(totals.get('spawn.started')).toBe(5);
    expect(totals.get('spawn.failed')).toBe(2);
    expect(totals.get('spawn.completed')).toBe(3);
  });

  test('queryTotals returns 0 for missing keys (not in map)', () => {
    counters.bump('spawn.started', {}, 3);
    counters.flush();

    const totals = counters.queryTotals(['spawn.started', 'spawn.nonexistent']);
    expect(totals.get('spawn.started')).toBe(3);
    expect(totals.has('spawn.nonexistent')).toBe(false);
    // Callers should use ?? 0 for missing keys
  });

  test('queryTotals with empty keys array returns empty map', () => {
    const totals = counters.queryTotals([]);
    expect(totals.size).toBe(0);
  });

  test('queryTotals since filter works', () => {
    counters.bump('spawn.started', {}, 10);
    counters.flush();

    // since=now should return nothing (bucket is in the past minute, before "now")
    const empty = counters.queryTotals(['spawn.started'], { since: Date.now() + 60_000 });
    expect(empty.has('spawn.started')).toBe(false);

    // since=1h ago should include the bump
    const full = counters.queryTotals(['spawn.started'], { since: Date.now() - 3_600_000 });
    expect(full.get('spawn.started')).toBe(10);
  });

  test('statement cache: repeated query() calls use cached statement', () => {
    // Verify by calling query() multiple times with the same opts — if prepare() were
    // called each time, the count of SQLite prepare operations would grow. We can't
    // directly observe the cache, but we verify correctness across multiple calls.
    counters.bump('cache.test', {}, 1);
    counters.flush();

    const r1 = counters.query({ key: 'cache.test', groupBy: 'minute' });
    const r2 = counters.query({ key: 'cache.test', groupBy: 'minute' });
    const r3 = counters.query({ key: 'cache.test', groupBy: 'minute' });
    expect(r1[0].value).toBe(r2[0].value);
    expect(r2[0].value).toBe(r3[0].value);
  });
});
