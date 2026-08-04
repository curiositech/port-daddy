/**
 * Observability Maintenance — the port-daddy-specific assembly that turns the generic primitives
 * (RetentionRegistry, SelfMonitor) into the concrete "sweep the leaking tables + watch our own
 * footprint" job the daemon runs on its periodic cleanup tick.
 *
 * Why a separate module: the registry/monitor are generic and unit-tested in isolation. This is
 * where the REAL port-daddy table names, columns, and thresholds live, so server.ts wiring is a
 * single `tick()` call and the policy choices are testable without booting the daemon.
 *
 * What it registers (the audit's unbounded-growth leaks):
 *   - harbor_issued_tokens → delete rows past `expires_at` (the 101K-row leak: a reaper index existed
 *     but the DELETE was never written; every expired 1-hour token was a permanent row).
 *   - semantic_resolution_events → cap to the newest N by `id` (no prune existed at all).
 *   metric_counters / activity_log / messages / tuples already self-prune in their own modules; we do
 *   NOT double-manage them — we only watch their row counts.
 *
 * Policies are registered only for tables that actually exist, so an older/partial schema can't crash
 * the maintenance tick.
 */

import type Database from 'better-sqlite3';
import { RetentionRegistry, ttlPolicy, capPolicy, maxAgePolicy } from './retention-registry.js';
import { ensureInkPheromonesTable } from '../squid/reconcile.js';
import { SelfMonitor, createSqliteSources, type Alarm, type Sample } from './self-monitor.js';
import type { LogGovernor } from './log-governor.js';

const MB = 1024 * 1024;

export interface ObservabilityMaintenanceOptions {
  db: Database.Database;
  /** Absolute path to the main DB file (to stat the WAL). */
  dbPath: string;
  governor: LogGovernor;
  /** Durable sink for crit alarms (e.g. activity_log). */
  onCritAlarm?: (alarm: Alarm, sample: Sample) => void;
  /** Keep-newest cap for the append-only semantic_resolution_events table. */
  eventsCap?: number;
  now?: () => number;
}

export interface ObservabilityMaintenance {
  /** Run one maintenance pass: sweep retention, reclaim freed pages, sample the footprint. */
  tick(now?: number): Sample;
  registry: RetentionRegistry;
  monitor: SelfMonitor;
}

export function createObservabilityMaintenance(opts: ObservabilityMaintenanceOptions): ObservabilityMaintenance {
  const { db, dbPath, governor } = opts;
  const now = opts.now ?? Date.now;

  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name),
  );

  const registry = new RetentionRegistry(db, governor);
  if (existing.has('harbor_issued_tokens')) {
    registry.register(ttlPolicy(db, 'harbor_issued_tokens', 'expires_at'));
  }
  if (existing.has('semantic_resolution_events')) {
    registry.register(capPolicy(db, 'semantic_resolution_events', 'id', opts.eventsCap ?? 20_000));
  }
  // ink_pheromones (the reconcile loop's durable pheromone drain target,
  // lib/squid/reconcile.ts) is declared bounded from day one per the
  // db-retention doctrine: 7-day max age on updated_at + a 500-row cap, on top
  // of the read-path prune (effective intensity < 0.01 deleted on query). The
  // table is ensured here because maintenance is constructed before the
  // reconcile loop in server.ts — one shared DDL, no ordering hazard.
  ensureInkPheromonesTable(db);
  registry.register(maxAgePolicy(db, 'ink_pheromones', 'updated_at', 7 * 24 * 60 * 60 * 1000));
  registry.register(capPolicy(db, 'ink_pheromones', 'updated_at', 500));

  // Watch row counts on the tables most likely to run away (whether or not WE prune them).
  const watchTables = ['harbor_issued_tokens', 'semantic_resolution_events', 'messages', 'tuples', 'metric_counters']
    .filter((t) => existing.has(t));
  const tableRows = Object.fromEntries(watchTables.map((t) => [t, { warn: 200_000, crit: 1_000_000 }]));

  const monitor = new SelfMonitor(
    createSqliteSources(db, dbPath),
    {
      // The daemon's OWN footprint — not whole-disk %. A registry DB should never approach these.
      dbBytes: { warn: 512 * MB, crit: 2 * 1024 * MB },
      walBytes: { warn: 64 * MB, crit: 256 * MB },
      tableRows,
      now,
    },
    governor,
    opts.onCritAlarm,
  );

  return {
    registry,
    monitor,
    tick(at = now()) {
      registry.sweepAll(at);
      registry.reclaim();
      return monitor.sample();
    },
  };
}
