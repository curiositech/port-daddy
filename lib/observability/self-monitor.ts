/**
 * Self-Monitor — the alarm that was missing when dev-latest-daemon wrote 313 GB in silence.
 *
 * Why this exists:
 *   The absence audit found `resource-governance.ts` is PULL-ONLY (it computes a status only
 *   when a human opens the panel) and it measures WHOLE-DISK percent, not port-daddy's own
 *   footprint. So a runaway that bloats port-daddy's OWN SQLite DB / WAL / a single table never
 *   trips anything until the entire volume is nearly full. Nobody was watching the thing that
 *   was actually growing.
 *
 * What it does:
 *   On each `sample()` it reads the daemon's own footprint — DB file bytes (`page_count *
 *   page_size`), WAL bytes, and per-table row counts — compares them to configured ceilings,
 *   and raises a GOVERNED alarm (`resource_threshold_crossed`) plus an optional durable audit
 *   event when a threshold is crossed. Growth-rate between samples is included so a fast climb
 *   alarms before it hits the ceiling. Because alarms go through the LogGovernor, a sustained
 *   breach reports once per window with a rollup — it can't itself become the spam it's meant
 *   to catch.
 *
 * Testability:
 *   All measurement is behind an injected `MetricSources`, so tests drive exact byte/row values
 *   with no filesystem. `createSqliteSources()` is the production implementation.
 */

import fs from 'node:fs';
import type Database from 'better-sqlite3';
import type { LogGovernor } from './log-governor.js';

export interface MetricSources {
  /** Main DB file size in bytes. */
  dbBytes(): number;
  /** WAL file size in bytes (0 if absent). */
  walBytes(): number;
  /** Row count for a watched table. */
  rowCount(table: string): number;
}

export interface Threshold {
  warn: number;
  crit: number;
}

export interface SelfMonitorConfig {
  /** DB file-size thresholds in bytes. */
  dbBytes: Threshold;
  /** WAL file-size thresholds in bytes. */
  walBytes: Threshold;
  /** Per-table row-count ceilings. Table → thresholds. */
  tableRows: Record<string, Threshold>;
  /** Injected clock; defaults to Date.now. */
  now?: () => number;
}

export type AlarmSeverity = 'warn' | 'crit';

export interface Alarm {
  metric: string;
  severity: AlarmSeverity;
  value: number;
  threshold: number;
  /** Bytes/rows per second since the previous sample, if known. */
  ratePerSec?: number;
}

export interface Sample {
  at: number;
  dbBytes: number;
  walBytes: number;
  rows: Record<string, number>;
  alarms: Alarm[];
}

/** Production sources: DB size via pragma, WAL size via fs.stat, row counts via COUNT(*). */
export function createSqliteSources(db: Database.Database, dbPath: string): MetricSources {
  const countStmts = new Map<string, Database.Statement>();
  return {
    dbBytes() {
      const pageCount = db.pragma('page_count', { simple: true }) as number;
      const pageSize = db.pragma('page_size', { simple: true }) as number;
      return pageCount * pageSize;
    },
    walBytes() {
      try {
        return fs.statSync(`${dbPath}-wal`).size;
      } catch {
        return 0; // WAL checkpointed away / not present
      }
    },
    rowCount(table: string) {
      let stmt = countStmts.get(table);
      if (!stmt) {
        stmt = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`);
        countStmts.set(table, stmt);
      }
      return (stmt.get() as { n: number }).n;
    },
  };
}

export class SelfMonitor {
  private readonly now: () => number;
  private prev: { at: number; dbBytes: number; walBytes: number } | null = null;

  constructor(
    private readonly sources: MetricSources,
    private readonly cfg: SelfMonitorConfig,
    private readonly log?: LogGovernor,
    /** Optional durable sink (e.g. activity_log) for crit alarms — kept separate from logging. */
    private readonly onAlarm?: (a: Alarm, sample: Sample) => void,
  ) {
    this.now = cfg.now ?? Date.now;
  }

  /** Take one measurement, evaluate thresholds, raise governed + durable alarms. Returns the sample. */
  sample(): Sample {
    const at = this.now();
    const dbBytes = safe(() => this.sources.dbBytes(), 0);
    const walBytes = safe(() => this.sources.walBytes(), 0);
    const rows: Record<string, number> = {};
    for (const table of Object.keys(this.cfg.tableRows)) {
      rows[table] = safe(() => this.sources.rowCount(table), 0);
    }

    const dtSec = this.prev ? Math.max(1e-3, (at - this.prev.at) / 1000) : undefined;
    const dbRate = this.prev && dtSec ? (dbBytes - this.prev.dbBytes) / dtSec : undefined;
    const walRate = this.prev && dtSec ? (walBytes - this.prev.walBytes) / dtSec : undefined;

    const alarms: Alarm[] = [];
    pushAlarm(alarms, 'db_bytes', dbBytes, this.cfg.dbBytes, dbRate);
    pushAlarm(alarms, 'wal_bytes', walBytes, this.cfg.walBytes, walRate);
    for (const [table, th] of Object.entries(this.cfg.tableRows)) {
      pushAlarm(alarms, `rows:${table}`, rows[table], th);
    }

    const sample: Sample = { at, dbBytes, walBytes, rows, alarms };
    this.prev = { at, dbBytes, walBytes };

    for (const alarm of alarms) {
      // Governed so a sustained breach reports once/window, not every sample.
      this.log?.governed({
        key: `resource_threshold_crossed:${alarm.metric}:${alarm.severity}`,
        level: alarm.severity === 'crit' ? 'error' : 'warn',
        message: 'resource_threshold_crossed',
        meta: {
          metric: alarm.metric,
          severity: alarm.severity,
          value: alarm.value,
          threshold: alarm.threshold,
          ...(alarm.ratePerSec !== undefined ? { rate_per_sec: Math.round(alarm.ratePerSec) } : {}),
        },
        windowMs: 300_000,
      });
      if (alarm.severity === 'crit') safe(() => this.onAlarm?.(alarm, sample), undefined);
    }
    return sample;
  }
}

function pushAlarm(out: Alarm[], metric: string, value: number, th: Threshold, ratePerSec?: number): void {
  if (value >= th.crit) {
    out.push({ metric, severity: 'crit', value, threshold: th.crit, ...(ratePerSec !== undefined ? { ratePerSec } : {}) });
  } else if (value >= th.warn) {
    out.push({ metric, severity: 'warn', value, threshold: th.warn, ...(ratePerSec !== undefined ? { ratePerSec } : {}) });
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
