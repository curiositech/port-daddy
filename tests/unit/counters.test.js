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

  test('maintenance preserves totals while bounded batches compact and prune incrementally', () => {
    counters.shutdown();
    let currentTime = Date.parse('2026-09-05T12:30:00.000Z');
    counters = createCounters(db, {
      now: () => currentTime,
      minuteDetailMs: 24 * 3_600_000,
      retainMs: 30 * 86_400_000,
      maintenanceIntervalMs: 0,
      maintenanceBatchRows: 2,
    });

    const hourMs = 3_600_000;
    const oldHour = Math.floor((currentTime - 48 * hourMs) / hourMs) * hourMs;
    const recentMinute = Math.floor((currentTime - hourMs) / 60_000) * 60_000;
    const expiredHour = Math.floor((currentTime - 31 * 86_400_000) / hourMs) * hourMs;
    const dims = JSON.stringify({ route: '/fleet' });
    const insert = db.prepare(`
      INSERT INTO metric_counters
        (key, dims_json, bucket_minute, bucket_hour, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insert.run('http.requests', dims, oldHour, oldHour, 2, oldHour);
    insert.run('http.requests', dims, oldHour + 60_000, oldHour, 3, oldHour + 60_000);
    insert.run('http.requests', dims, oldHour + 120_000, oldHour, 4, oldHour + 120_000);
    insert.run('http.requests', dims, recentMinute, Math.floor(recentMinute / hourMs) * hourMs, 5, recentMinute);
    insert.run('http.requests', dims, expiredHour, expiredHour, 7, expiredHour);

    // One expired row consumes half the two-row budget; only one old minute
    // can compact in this transaction. The other remains as the resume cursor.
    counters.flush();
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM metric_counters
      WHERE key = 'http.requests' AND bucket_hour = ? AND bucket_minute != bucket_hour
    `).get(oldHour).count).toBe(1);
    expect(db.prepare(`
      SELECT SUM(value) AS total FROM metric_counters WHERE key = 'http.requests'
    `).get().total).toBe(14);

    // Recreate the counter service between passes. Progress lives in the
    // committed source rows, not an in-memory cursor, so startup can resume.
    counters = createCounters(db, {
      now: () => currentTime,
      minuteDetailMs: 24 * 3_600_000,
      retainMs: 30 * 86_400_000,
      maintenanceIntervalMs: 0,
      maintenanceBatchRows: 2,
    });
    counters.flush();
    expect(db.prepare(`
      SELECT bucket_minute, bucket_hour, value
      FROM metric_counters
      WHERE key = 'http.requests'
      ORDER BY bucket_minute
    `).all()).toEqual([
      { bucket_minute: oldHour, bucket_hour: oldHour, value: 9 },
      {
        bucket_minute: recentMinute,
        bucket_hour: Math.floor(recentMinute / hourMs) * hourMs,
        value: 5,
      },
    ]);

    // A later pass is idempotent; the canonical hour row cannot feed itself.
    currentTime += 1;
    counters.flush();
    expect(db.prepare(`
      SELECT value FROM metric_counters
      WHERE key = 'http.requests' AND bucket_minute = ?
    `).get(oldHour).value).toBe(9);
  });

  test('an interrupted aggregate-and-delete batch rolls back and resumes exactly once', () => {
    counters.shutdown();
    const currentTime = Date.parse('2026-09-05T12:30:00.000Z');
    counters = createCounters(db, {
      now: () => currentTime,
      maintenanceIntervalMs: 6 * 3_600_000,
      maintenanceBatchRows: 10,
    });

    const hourMs = 3_600_000;
    const oldHour = Math.floor((currentTime - 48 * hourMs) / hourMs) * hourMs;
    const dims = JSON.stringify({ backend: 'codex' });
    const insert = db.prepare(`
      INSERT INTO metric_counters
        (key, dims_json, bucket_minute, bucket_hour, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run('interrupt', dims, oldHour + 60_000, oldHour, 3, oldHour + 60_000);
    insert.run('interrupt', dims, oldHour + 120_000, oldHour, 4, oldHour + 120_000);
    db.exec(`
      CREATE TRIGGER interrupt_counter_maintenance
      BEFORE DELETE ON metric_counters
      WHEN OLD.key = 'interrupt'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic maintenance interruption');
      END;
    `);

    // flush() deliberately swallows maintenance failure, but SQLite must have
    // rolled back both the inserted rollup and the source-row deletion.
    counters.flush();
    expect(db.prepare(`
      SELECT bucket_minute, value FROM metric_counters
      WHERE key = 'interrupt' ORDER BY bucket_minute
    `).all()).toEqual([
      { bucket_minute: oldHour + 60_000, value: 3 },
      { bucket_minute: oldHour + 120_000, value: 4 },
    ]);

    db.exec('DROP TRIGGER interrupt_counter_maintenance');
    // The failed step marks a backlog, so the identical clock retries without
    // waiting for the ordinary six-hour interval.
    counters.flush();
    expect(db.prepare(`
      SELECT bucket_minute, value FROM metric_counters WHERE key = 'interrupt'
    `).all()).toEqual([{ bucket_minute: oldHour, value: 7 }]);
    counters.flush();
    expect(db.prepare(`
      SELECT value FROM metric_counters WHERE key = 'interrupt'
    `).get().value).toBe(7);
  });

  test('late old rows and current pending writes preserve dimensions and totals across passes', () => {
    counters.shutdown();
    const currentTime = Date.parse('2026-09-05T12:30:00.000Z');
    counters = createCounters(db, {
      now: () => currentTime,
      maintenanceIntervalMs: 0,
      maintenanceBatchRows: 1,
    });

    const hourMs = 3_600_000;
    const oldHour = Math.floor((currentTime - 48 * hourMs) / hourMs) * hourMs;
    const currentMinute = Math.floor(currentTime / 60_000) * 60_000;
    const dims = JSON.stringify({ backend: 'codex', harbor: 'local' });
    const insert = db.prepare(`
      INSERT INTO metric_counters
        (key, dims_json, bucket_minute, bucket_hour, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run('concurrent', dims, oldHour + 60_000, oldHour, 2, oldHour + 60_000);
    insert.run('concurrent', dims, oldHour + 120_000, oldHour, 3, oldHour + 120_000);

    counters.flush();
    // Simulate a late write from another connection after the first atomic
    // batch, while an ordinary current-minute bump waits in memory.
    insert.run('concurrent', dims, oldHour + 180_000, oldHour, 5, oldHour + 180_000);
    counters.bump('concurrent', { harbor: 'local', backend: 'codex' }, 7);
    counters.flush();
    counters.flush();

    expect(db.prepare(`
      SELECT dims_json, bucket_minute, value
      FROM metric_counters WHERE key = 'concurrent'
      ORDER BY bucket_minute
    `).all()).toEqual([
      { dims_json: dims, bucket_minute: oldHour, value: 10 },
      { dims_json: dims, bucket_minute: currentMinute, value: 7 },
    ]);
  });

  test('production-shaped first flush consumes only the default 5000-row budget', () => {
    counters.shutdown();
    const currentTime = Date.parse('2026-09-05T12:30:00.000Z');
    counters = createCounters(db, { now: () => currentTime });

    const totalRows = 1_549_896;
    const oldRows = 1_494_630;
    const alignedRows = 25_596;
    const combos = 17 * 471;
    const hourMs = 3_600_000;
    const minuteMs = 60_000;
    const oldAnchor = Math.floor((currentTime - 48 * hourMs) / hourMs) * hourMs;
    const recentAnchor = Math.floor((currentTime - 2 * hourMs) / hourMs) * hourMs;

    db.prepare(`
      WITH RECURSIVE sequence(i) AS (
        VALUES (0)
        UNION ALL
        SELECT i + 1 FROM sequence WHERE i + 1 < ?
      ), shaped AS (
        SELECT
          i,
          i % ? AS combination,
          CAST(i / ? AS INTEGER) AS sequence_no
        FROM sequence
      ), stamped AS (
        SELECT
          i,
          combination,
          CASE
            WHEN i < ? THEN ? - sequence_no * ?
            WHEN i < ? THEN
              ? - (10 + CAST(sequence_no / 59 AS INTEGER)) * ?
                + ((sequence_no % 59) + 1) * ?
            ELSE ? + (sequence_no - 185) * ?
          END AS bucket_minute
        FROM shaped
      )
      INSERT INTO metric_counters
        (key, dims_json, bucket_minute, bucket_hour, value, updated_at)
      SELECT
        'metric.' || (combination % 17),
        '{"dimension":"' || CAST(CAST(combination / 17 AS INTEGER) AS TEXT) || '"}',
        bucket_minute,
        CAST(bucket_minute / ? AS INTEGER) * ?,
        1,
        ?
      FROM stamped
    `).run(
      totalRows,
      combos,
      combos,
      alignedRows,
      oldAnchor,
      hourMs,
      oldRows,
      oldAnchor,
      hourMs,
      minuteMs,
      recentAnchor,
      minuteMs,
      hourMs,
      hourMs,
      currentTime,
    );

    const shape = db.prepare(`
      SELECT
        COUNT(*) AS total_rows,
        SUM(bucket_minute < ?) AS older_than_day,
        SUM(bucket_minute = bucket_hour) AS hour_aligned,
        COUNT(DISTINCT key) AS keys,
        COUNT(DISTINCT dims_json) AS dimensions
      FROM metric_counters
    `).get(currentTime - 24 * hourMs);
    expect(shape).toEqual({
      total_rows: totalRows,
      older_than_day: oldRows,
      hour_aligned: alignedRows,
      keys: 17,
      dimensions: 471,
    });

    const eligible = () => db.prepare(`
      SELECT COUNT(*) AS count
      FROM metric_counters
      WHERE bucket_hour < ? AND bucket_minute != bucket_hour
    `).get(Math.floor((currentTime - 24 * hourMs) / hourMs) * hourMs).count;
    const total = () => db.prepare('SELECT SUM(value) AS total FROM metric_counters').get().total;
    const beforeEligible = eligible();

    counters.flush();
    expect(beforeEligible - eligible()).toBe(5_000);
    expect(total()).toBe(totalRows);

    counters.flush();
    expect(beforeEligible - eligible()).toBe(10_000);
    expect(total()).toBe(totalRows);
  }, 60_000);
});
