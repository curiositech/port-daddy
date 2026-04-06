/**
 * Counters — ODS-style bump counter with SQLite time-bucketed storage.
 *
 * Usage:
 *   counters.bump('spawn.started', { backend: 'claude-cli', model: 'claude-cli' })
 *   counters.bump('session.started')
 *   counters.summary()   // all keys, last 24h
 *   counters.query({ key: 'spawn.started', since: Date.now() - 3600_000, groupBy: 'minute' })
 *
 * Design:
 * - Batches increments in memory, flushes to SQLite every 10s.
 *   This means no per-event DB write — dozens of fleet spawns/sec are fine.
 * - Time buckets: minute (primary key) + hour (index for fast rollups).
 * - Dimensions stored as sorted-key JSON for consistent grouping.
 * - Cleanup: rows older than 30 days are pruned automatically on flush.
 */

import type { Database } from 'better-sqlite3';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CounterQueryOpts {
  key: string;
  dims?: Record<string, string>;
  since?: number;   // timestamp ms
  until?: number;
  groupBy?: 'minute' | 'hour';
}

export interface CounterResult {
  key: string;
  dims: Record<string, string>;
  bucket: number;   // epoch ms of the bucket start
  value: number;
}

export interface CounterSummaryRow {
  key: string;
  total: number;
  perHour: number;  // rate over the query window
}

interface CounterRow {
  key: string;
  dims_json: string;
  bucket_minute: number;
  bucket_hour: number;
  value: number;
}

// ─── Module factory ───────────────────────────────────────────────────────────

export function createCounters(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metric_counters (
      key          TEXT    NOT NULL,
      dims_json    TEXT    NOT NULL DEFAULT '{}',
      bucket_minute INTEGER NOT NULL,
      bucket_hour   INTEGER NOT NULL,
      value         INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (key, dims_json, bucket_minute)
    );
    CREATE INDEX IF NOT EXISTS idx_mc_key_hour ON metric_counters(key, bucket_hour);
    CREATE INDEX IF NOT EXISTS idx_mc_hour     ON metric_counters(bucket_hour);
  `);

  // In-memory batch accumulator: composite key → delta
  const pending = new Map<string, number>();
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let lastCleanup = 0;
  const CLEANUP_INTERVAL = 6 * 3600_000;  // prune old rows every 6h
  const RETAIN_MS = 30 * 86_400_000;       // keep 30 days

  // Prepared statement cache — avoids re-compiling identical SQL on every query() call.
  // Keyed by the full SQL string (unique per condition combination).
  // better-sqlite3 does NOT auto-cache; each db.prepare() is a full compile.
  const stmtCache = new Map<string, ReturnType<typeof db.prepare>>();

  function prepareOrCached(sql: string): ReturnType<typeof db.prepare> {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  const upsertStmt = db.prepare(`
    INSERT INTO metric_counters (key, dims_json, bucket_minute, bucket_hour, value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (key, dims_json, bucket_minute)
    DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at
  `);

  const flushMany = db.transaction((entries: Array<[string, number]>) => {
    const now = Date.now();
    for (const [compositeKey, delta] of entries) {
      const parts = compositeKey.split('\x00');
      upsertStmt.run(parts[0], parts[1], parseInt(parts[2], 10), parseInt(parts[3], 10), delta, now);
    }
  });

  function flush(): void {
    if (pending.size === 0) return;
    const entries = [...pending.entries()];
    pending.clear();
    try {
      flushMany(entries);
    } catch (err) {
      // On failure, re-queue (best-effort; don't crash the daemon)
      for (const [k, v] of entries) {
        pending.set(k, (pending.get(k) ?? 0) + v);
      }
    }

    // Periodic cleanup of stale rows
    const now = Date.now();
    if (now - lastCleanup > CLEANUP_INTERVAL) {
      lastCleanup = now;
      try {
        db.prepare('DELETE FROM metric_counters WHERE bucket_minute < ?')
          .run(now - RETAIN_MS);
      } catch { /* non-critical */ }
    }
  }

  function ensureFlushTimer(): void {
    if (flushTimer !== null) return;
    flushTimer = setInterval(flush, 10_000);
    flushTimer.unref(); // Don't block process exit
  }

  /**
   * Increment a counter. Cheap — just updates in-memory accumulator.
   * @param key   dot-separated metric name, e.g. 'spawn.started'
   * @param dims  optional dimension labels, e.g. { backend: 'claude-cli', project: 'myapp' }
   * @param n     increment amount (default 1)
   */
  function bump(key: string, dims?: Record<string, string>, n = 1): void {
    ensureFlushTimer();
    const now = Date.now();
    const bucketMinute = Math.floor(now / 60_000) * 60_000;
    const bucketHour   = Math.floor(now / 3_600_000) * 3_600_000;
    const dimsJson = dims && Object.keys(dims).length > 0
      ? JSON.stringify(Object.fromEntries(Object.entries(dims).sort()))
      : '{}';
    const ck = `${key}\x00${dimsJson}\x00${bucketMinute}\x00${bucketHour}`;
    pending.set(ck, (pending.get(ck) ?? 0) + n);
  }

  /**
   * Query counter values over a time range.
   * Flushes pending batch first only if there is something pending, keeping
   * the event loop impact proportional to actual work. Multiple sequential
   * query() calls (e.g. inside /metrics/golden) only pay the flush cost once.
   */
  function query(opts: CounterQueryOpts): CounterResult[] {
    if (pending.size > 0) flush();
    const conditions: string[] = ['key = ?'];
    const params: unknown[] = [opts.key];

    if (opts.since) {
      conditions.push('bucket_minute >= ?');
      params.push(Math.floor(opts.since / 60_000) * 60_000);
    }
    if (opts.until) {
      conditions.push('bucket_minute <= ?');
      params.push(Math.floor(opts.until / 60_000) * 60_000);
    }
    if (opts.dims) {
      conditions.push('dims_json = ?');
      params.push(JSON.stringify(Object.fromEntries(Object.entries(opts.dims).sort())));
    }

    const groupField = opts.groupBy === 'hour' ? 'bucket_hour' : 'bucket_minute';

    const sql = `
      SELECT key, dims_json, ${groupField} as bucket_field, SUM(value) as value
      FROM metric_counters
      WHERE ${conditions.join(' AND ')}
      GROUP BY key, dims_json, ${groupField}
      ORDER BY bucket_field DESC
      LIMIT 1000
    `;
    const rows = prepareOrCached(sql).all(params) as (CounterRow & { bucket_field: number })[];

    return rows.map(r => ({
      key: r.key,
      dims: JSON.parse(r.dims_json) as Record<string, string>,
      bucket: r.bucket_field,
      value: r.value,
    }));
  }

  /**
   * Fetch aggregated totals for multiple counter keys in a single SQL round-trip.
   *
   * Use this instead of calling `query()` N times when you only need the sum for each key
   * (not time-bucketed data). Cuts SQLite prepare+execute cycles from N to 1.
   *
   * Used by /metrics/golden to batch all 5 one-hour key queries.
   *
   * @returns Map from key → total value over the window.
   */
  function queryTotals(keys: string[], opts: { since?: number; groupBy?: 'minute' | 'hour' } = {}): Map<string, number> {
    if (pending.size > 0) flush();
    if (keys.length === 0) return new Map();

    const groupField = opts.groupBy === 'hour' ? 'bucket_hour' : 'bucket_minute';
    const placeholders = keys.map(() => '?').join(', ');
    const params: unknown[] = [...keys];

    let sinceClause = '';
    if (opts.since) {
      const bucketSize = opts.groupBy === 'hour' ? 3_600_000 : 60_000;
      sinceClause = `AND ${groupField} >= ?`;
      params.push(Math.floor(opts.since / bucketSize) * bucketSize);
    }

    const sql = `
      SELECT key, SUM(value) as total
      FROM metric_counters
      WHERE key IN (${placeholders}) ${sinceClause}
      GROUP BY key
    `;

    const rows = prepareOrCached(sql).all(params) as { key: string; total: number }[];
    const result = new Map<string, number>();
    for (const row of rows) result.set(row.key, row.total);
    return result;
  }

  /**
   * Top N dimension values for a given counter+dimension name.
   * Useful for "top 10 backends by spawn count".
   *
   * Uses SQLite's json_extract() to group by a single dimension field directly,
   * avoiding fetching all rows and parsing JSON in JS.
   * dimName is validated to [a-z0-9_] to prevent path injection.
   */
  function topN(
    key: string,
    dimName: string,
    n = 10,
    since?: number,
  ): Array<{ value: string; count: number }> {
    if (pending.size > 0) flush();
    const sinceMinute = since
      ? Math.floor(since / 60_000) * 60_000
      : Math.floor((Date.now() - 86_400_000) / 60_000) * 60_000;

    // Validate dimName to prevent json_extract path injection
    if (!/^[a-zA-Z0-9_]+$/.test(dimName)) {
      return [];
    }

    const sql = `
      SELECT
        COALESCE(json_extract(dims_json, '$."${dimName}"'), '(none)') as dim_value,
        SUM(value) as total
      FROM metric_counters
      WHERE key = ? AND bucket_minute >= ?
      GROUP BY dim_value
      ORDER BY total DESC
      LIMIT ?
    `;
    const rows = (prepareOrCached(sql) as any).all(key, sinceMinute, n) as { dim_value: string; total: number }[];

    return rows.map(r => ({ value: r.dim_value, count: r.total }));
  }

  /**
   * Summary of all counter keys, sorted by total descending.
   * @param since  timestamp ms (default: last 24h)
   */
  function summary(since?: number): CounterSummaryRow[] {
    if (pending.size > 0) flush();
    const sinceMs = since ?? Date.now() - 86_400_000;
    const sinceMinute = Math.floor(sinceMs / 60_000) * 60_000;
    const ageHours = (Date.now() - sinceMinute) / 3_600_000;

    const rows = db.prepare(`
      SELECT key, SUM(value) as total
      FROM metric_counters
      WHERE bucket_minute >= ?
      GROUP BY key
      ORDER BY total DESC
    `).all(sinceMinute) as { key: string; total: number }[];

    return rows.map(r => ({
      key: r.key,
      total: r.total,
      perHour: ageHours > 0 ? +(r.total / ageHours).toFixed(2) : 0,
    }));
  }

  /** Force flush + stop timer. Call on daemon shutdown. */
  function shutdown(): void {
    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    flush();
  }

  return { bump, query, queryTotals, topN, summary, flush, shutdown };
}

export type Counters = ReturnType<typeof createCounters>;
