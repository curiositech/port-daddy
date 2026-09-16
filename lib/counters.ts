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
 * - Time buckets: minute detail for the recent window, then total-preserving
 *   hourly rollups. Historical query boundaries must use whole hours because
 *   minute placement inside a compacted hour is intentionally unavailable.
 * - Maintenance scans a fixed rowid window per transaction and persists its
 *   cursor, so an upgrade cannot scan or mutate the inherited table at once.
 * - Dimensions stored as sorted-key JSON for consistent grouping.
 * - Cleanup: hourly history older than 30 days is pruned in the same bounded,
 *   crash-resumable maintenance loop.
 */

import type { Database } from 'better-sqlite3';

export const COUNTER_HISTORICAL_RESOLUTION_MS = 3_600_000;

export class CounterHistoryResolutionError extends RangeError {
  readonly code = 'COUNTER_HISTORY_RESOLUTION_UNSUPPORTED';
  readonly historicalResolution = 'hour';
  readonly resolutionMs = COUNTER_HISTORICAL_RESOLUTION_MS;
  readonly supportedBoundaries = {
    since: 'hour-start',
    until: 'hour-final-minute-inclusive',
  } as const;

  constructor(message: string) {
    super(message);
    this.name = 'CounterHistoryResolutionError';
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CounterQueryOpts {
  key: string;
  dims?: Record<string, string>;
  /** Timestamp ms; older-than-detail boundaries must start on an hour. */
  since?: number;
  /** Inclusive timestamp ms; historical bounds must end at HH:59. */
  until?: number;
  /** Required as `hour` whenever the requested range may include rollups. */
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

export interface CounterMaintenanceStatus {
  active: boolean;
  scanAfterRowid: number;
  scanThroughRowid: number;
  passCount: number;
  lastPassAt: number | null;
  lastPassScannedRows: number;
  lastPassCompactedRows: number;
  lastPassPrunedRows: number;
}

interface CounterRow {
  key: string;
  dims_json: string;
  bucket_minute: number;
  bucket_hour: number;
  value: number;
}

export interface CounterOptions {
  /** Injectable clock for deterministic maintenance tests. */
  now?: () => number;
  /** How long to retain minute-level detail before hourly compaction. */
  minuteDetailMs?: number;
  /** Total retention for compacted counter history. */
  retainMs?: number;
  /** Minimum delay between maintenance passes when there is no backlog. */
  maintenanceIntervalMs?: number;
  /** Maximum source rows inspected by one maintenance transaction. */
  maintenanceBatchRows?: number;
}

/** Exact production SQL exported so tests can detect a full-source scan. */
export const COUNTER_MAINTENANCE_SQL = Object.freeze({
  selectScanBatch: `
    INSERT INTO temp.metric_counter_maintenance_batch (source_rowid, action)
    SELECT
      rowid,
      CASE
        WHEN bucket_hour < ? THEN 1
        WHEN bucket_hour < ? AND bucket_minute != bucket_hour THEN 2
        ELSE 0
      END
    FROM metric_counters
    WHERE rowid > ? AND rowid <= ?
    ORDER BY rowid ASC
    LIMIT ?
  `,
  aggregateBatch: `
    INSERT INTO metric_counters
      (key, dims_json, bucket_minute, bucket_hour, value, updated_at)
    SELECT
      source.key,
      source.dims_json,
      source.bucket_hour,
      source.bucket_hour,
      SUM(source.value),
      MAX(source.updated_at)
    FROM temp.metric_counter_maintenance_batch AS batch
    CROSS JOIN metric_counters AS source
    WHERE batch.action = 2
      AND source.rowid = batch.source_rowid
    GROUP BY source.key, source.dims_json, source.bucket_hour
    ON CONFLICT (key, dims_json, bucket_minute)
    DO UPDATE SET
      value = value + excluded.value,
      updated_at = MAX(updated_at, excluded.updated_at)
  `,
  deleteBatch: `
    DELETE FROM metric_counters
    WHERE rowid IN (
      SELECT source_rowid
      FROM temp.metric_counter_maintenance_batch
      WHERE action IN (1, 2)
    )
  `,
});

// ─── Module factory ───────────────────────────────────────────────────────────

export function createCounters(db: Database, options: CounterOptions = {}) {
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
    CREATE TABLE IF NOT EXISTS metric_counter_maintenance_state (
      singleton                INTEGER PRIMARY KEY CHECK (singleton = 1),
      scan_after_rowid         INTEGER NOT NULL DEFAULT 0,
      scan_through_rowid       INTEGER NOT NULL DEFAULT 0,
      pass_count               INTEGER NOT NULL DEFAULT 0,
      last_pass_at             INTEGER,
      last_pass_scanned_rows   INTEGER NOT NULL DEFAULT 0,
      last_pass_compacted_rows INTEGER NOT NULL DEFAULT 0,
      last_pass_pruned_rows    INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO metric_counter_maintenance_state (singleton) VALUES (1);
  `);

  // A connection-local row-id set lets the aggregate and delete statements
  // consume exactly the same batch. Because its writes live inside the same
  // transaction as the rollup, interruption rolls the whole batch back.
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS metric_counter_maintenance_batch (
      source_rowid INTEGER PRIMARY KEY,
      action       INTEGER NOT NULL CHECK (action IN (0, 1, 2))
    );
  `);

  // In-memory batch accumulator: composite key → delta
  const pending = new Map<string, number>();
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let lastMaintenance: number | null = null;
  let maintenanceBacklog = false;
  const HOUR_MS = COUNTER_HISTORICAL_RESOLUTION_MS;
  const MAINTENANCE_INTERVAL_MS = options.maintenanceIntervalMs ?? 6 * HOUR_MS;
  const MINUTE_DETAIL_MS = options.minuteDetailMs ?? 24 * HOUR_MS;
  const RETAIN_MS = options.retainMs ?? 30 * 86_400_000;
  const MAINTENANCE_BATCH_ROWS = options.maintenanceBatchRows ?? 5_000;
  const now = options.now ?? Date.now;

  if (!Number.isFinite(MAINTENANCE_INTERVAL_MS) || MAINTENANCE_INTERVAL_MS < 0) {
    throw new Error('maintenanceIntervalMs must be a non-negative finite number');
  }
  if (!Number.isFinite(MINUTE_DETAIL_MS) || MINUTE_DETAIL_MS < 0) {
    throw new Error('minuteDetailMs must be a non-negative finite number');
  }
  if (!Number.isFinite(RETAIN_MS) || RETAIN_MS <= 0 || RETAIN_MS < MINUTE_DETAIL_MS) {
    throw new Error('retainMs must be finite, positive, and at least minuteDetailMs');
  }
  if (!Number.isSafeInteger(MAINTENANCE_BATCH_ROWS)
      || MAINTENANCE_BATCH_ROWS < 1
      || MAINTENANCE_BATCH_ROWS > 50_000) {
    throw new Error('maintenanceBatchRows must be an integer between 1 and 50000');
  }

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

  const flushMany = db.transaction((entries: Array<[string, number]>, flushedAt: number) => {
    for (const [compositeKey, delta] of entries) {
      const parts = compositeKey.split('\x00');
      upsertStmt.run(parts[0], parts[1], parseInt(parts[2], 10), parseInt(parts[3], 10), delta, flushedAt);
    }
  });

  const clearMaintenanceBatchStmt = db.prepare(
    'DELETE FROM temp.metric_counter_maintenance_batch',
  );
  const selectMaintenanceScanBatchStmt = db.prepare(COUNTER_MAINTENANCE_SQL.selectScanBatch);
  const aggregateMaintenanceBatchStmt = db.prepare(COUNTER_MAINTENANCE_SQL.aggregateBatch);
  const deleteMaintenanceBatchStmt = db.prepare(COUNTER_MAINTENANCE_SQL.deleteBatch);
  const maxSourceRowidStmt = db.prepare(
    'SELECT COALESCE(MAX(rowid), 0) AS max_rowid FROM metric_counters',
  );
  const maintenanceBatchStatsStmt = db.prepare(`
    SELECT
      COUNT(*) AS scanned_rows,
      COALESCE(MAX(source_rowid), 0) AS last_scanned_rowid,
      COALESCE(SUM(action = 2), 0) AS compacted_rows,
      COALESCE(SUM(action = 1), 0) AS pruned_rows
    FROM temp.metric_counter_maintenance_batch
  `);
  const readMaintenanceStateStmt = db.prepare(`
    SELECT
      scan_after_rowid,
      scan_through_rowid,
      pass_count,
      last_pass_at,
      last_pass_scanned_rows,
      last_pass_compacted_rows,
      last_pass_pruned_rows
    FROM metric_counter_maintenance_state
    WHERE singleton = 1
  `);
  const writeMaintenanceStateStmt = db.prepare(`
    UPDATE metric_counter_maintenance_state
    SET
      scan_after_rowid = ?,
      scan_through_rowid = ?,
      pass_count = pass_count + 1,
      last_pass_at = ?,
      last_pass_scanned_rows = ?,
      last_pass_compacted_rows = ?,
      last_pass_pruned_rows = ?
    WHERE singleton = 1
  `);

  interface MaintenanceStateRow {
    scan_after_rowid: number;
    scan_through_rowid: number;
    pass_count: number;
    last_pass_at: number | null;
    last_pass_scanned_rows: number;
    last_pass_compacted_rows: number;
    last_pass_pruned_rows: number;
  }

  interface MaintenanceBatchStatsRow {
    scanned_rows: number;
    last_scanned_rowid: number;
    compacted_rows: number;
    pruned_rows: number;
  }

  const initialMaintenanceState = readMaintenanceStateStmt.get() as MaintenanceStateRow;
  maintenanceBacklog = initialMaintenanceState.scan_through_rowid
    > initialMaintenanceState.scan_after_rowid;

  /**
   * Inspect at most MAINTENANCE_BATCH_ROWS source rows in one atomic step.
   * The persisted rowid window is both a restart cursor and a bound on actual
   * source-table reads. New rows beyond the captured high-water mark are
   * chained as a tail window; a later scheduled sweep revisits rows that age
   * into the compaction or retention cutoffs.
   */
  const maintenanceStep = db.transaction((at: number): boolean => {
    const minuteCutoffHour = Math.floor((at - MINUTE_DETAIL_MS) / HOUR_MS) * HOUR_MS;
    const retentionCutoffHour = Math.floor((at - RETAIN_MS) / HOUR_MS) * HOUR_MS;
    const previous = readMaintenanceStateStmt.get() as MaintenanceStateRow;
    let scanAfterRowid = previous.scan_after_rowid;
    let scanThroughRowid = previous.scan_through_rowid;

    if (scanThroughRowid <= scanAfterRowid) {
      scanAfterRowid = 0;
      scanThroughRowid = Number(
        (maxSourceRowidStmt.get() as { max_rowid: number }).max_rowid,
      );
    }

    clearMaintenanceBatchStmt.run();
    selectMaintenanceScanBatchStmt.run(
      retentionCutoffHour,
      minuteCutoffHour,
      scanAfterRowid,
      scanThroughRowid,
      MAINTENANCE_BATCH_ROWS,
    );
    const batch = maintenanceBatchStatsStmt.get() as MaintenanceBatchStatsRow;

    if (batch.compacted_rows > 0) aggregateMaintenanceBatchStmt.run();
    if (batch.compacted_rows > 0 || batch.pruned_rows > 0) {
      deleteMaintenanceBatchStmt.run();
    }

    const reachedHighWater = batch.scanned_rows === 0
      || batch.last_scanned_rowid >= scanThroughRowid
      || batch.scanned_rows < MAINTENANCE_BATCH_ROWS;
    let nextScanAfterRowid = batch.last_scanned_rowid || scanAfterRowid;
    let nextScanThroughRowid = scanThroughRowid;

    if (reachedHighWater) {
      const currentMaxRowid = Number(
        (maxSourceRowidStmt.get() as { max_rowid: number }).max_rowid,
      );
      if (currentMaxRowid > scanThroughRowid) {
        // Rows written while this sweep was in flight, including newly created
        // canonical hour rows, form a bounded tail instead of forcing a rescan.
        nextScanAfterRowid = scanThroughRowid;
        nextScanThroughRowid = currentMaxRowid;
      } else {
        nextScanAfterRowid = 0;
        nextScanThroughRowid = 0;
      }
    }

    writeMaintenanceStateStmt.run(
      nextScanAfterRowid,
      nextScanThroughRowid,
      at,
      batch.scanned_rows,
      batch.compacted_rows,
      batch.pruned_rows,
    );
    clearMaintenanceBatchStmt.run();
    return nextScanThroughRowid > nextScanAfterRowid;
  });

  function maintenanceStatus(): CounterMaintenanceStatus {
    const state = readMaintenanceStateStmt.get() as MaintenanceStateRow;
    return {
      active: state.scan_through_rowid > state.scan_after_rowid,
      scanAfterRowid: state.scan_after_rowid,
      scanThroughRowid: state.scan_through_rowid,
      passCount: state.pass_count,
      lastPassAt: state.last_pass_at,
      lastPassScannedRows: state.last_pass_scanned_rows,
      lastPassCompactedRows: state.last_pass_compacted_rows,
      lastPassPrunedRows: state.last_pass_pruned_rows,
    };
  }

  function minuteDetailCutoffHour(at = now()): number {
    return Math.floor((at - MINUTE_DETAIL_MS) / HOUR_MS) * HOUR_MS;
  }

  function assertHistoricalSinceIsExact(since: number, operation: string): void {
    const sinceMinute = Math.floor(since / 60_000) * 60_000;
    if (sinceMinute < minuteDetailCutoffHour() && sinceMinute % HOUR_MS !== 0) {
      throw new CounterHistoryResolutionError(
        `${operation} cannot use a partial-hour since boundary in compacted counter history; use an hour-aligned timestamp`,
      );
    }
  }

  function maintain(at: number): void {
    const due = lastMaintenance === null
      || at < lastMaintenance
      || at - lastMaintenance >= MAINTENANCE_INTERVAL_MS;
    if (!maintenanceBacklog && !due) return;

    try {
      maintenanceBacklog = maintenanceStep(at);
      lastMaintenance = at;
    } catch {
      // The transaction rolled back, so retry on the next flush instead of
      // sleeping for the ordinary six-hour maintenance interval.
      maintenanceBacklog = true;
    }
  }

  function flush(): void {
    const flushedAt = now();
    let pendingWriteFailed = false;
    if (pending.size > 0) {
      const entries = [...pending.entries()];
      pending.clear();
      try {
        flushMany(entries, flushedAt);
      } catch (err) {
        // On failure, re-queue (best-effort; don't crash the daemon)
        for (const [k, v] of entries) {
          pending.set(k, (pending.get(k) ?? 0) + v);
        }
        pendingWriteFailed = true;
      }
    }

    // Do not let a failed counter write race ahead into maintenance. Otherwise
    // every timer/manual flush makes one bounded, resumable maintenance step,
    // even when no new counters arrived during this interval.
    if (!pendingWriteFailed) maintain(flushedAt);
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
    const bumpedAt = now();
    const bucketMinute = Math.floor(bumpedAt / 60_000) * 60_000;
    const bucketHour   = Math.floor(bumpedAt / HOUR_MS) * HOUR_MS;
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
   * Minute grouping and partial-hour boundaries are exact only inside the
   * configured minute-detail window; older requests fail rather than estimate.
   */
  function query(opts: CounterQueryOpts): CounterResult[] {
    if (pending.size > 0) flush();
    const historical = opts.since === undefined
      || Math.floor(opts.since / 60_000) * 60_000 < minuteDetailCutoffHour();
    if (historical && opts.groupBy !== 'hour') {
      throw new CounterHistoryResolutionError(
        'query requires groupBy="hour" when its range can include compacted counter history',
      );
    }
    if (opts.since !== undefined) assertHistoricalSinceIsExact(opts.since, 'query');
    if (opts.until !== undefined) {
      const untilMinute = Math.floor(opts.until / 60_000) * 60_000;
      if (untilMinute < minuteDetailCutoffHour()
          && untilMinute % HOUR_MS !== HOUR_MS - 60_000) {
        throw new CounterHistoryResolutionError(
          'query cannot use a partial-hour until boundary in compacted counter history; use the final minute of an hour',
        );
      }
    }
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
    if (opts.since !== undefined) assertHistoricalSinceIsExact(opts.since, 'queryTotals');

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
      : Math.floor((now() - 86_400_000) / 60_000) * 60_000;
    assertHistoricalSinceIsExact(sinceMinute, 'topN');

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
    const currentTime = now();
    const sinceMs = since ?? currentTime - 86_400_000;
    assertHistoricalSinceIsExact(sinceMs, 'summary');
    const sinceMinute = Math.floor(sinceMs / 60_000) * 60_000;
    const ageHours = (currentTime - sinceMinute) / HOUR_MS;

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

  return { bump, query, queryTotals, topN, summary, maintenanceStatus, flush, shutdown };
}

export type Counters = ReturnType<typeof createCounters>;
