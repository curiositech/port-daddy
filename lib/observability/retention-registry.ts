/**
 * Retention Registry — one place where every SQLite table's retention policy is declared and
 * swept, replacing the current "each module hand-rolls its own DELETE (or forgets to)" pattern.
 *
 * Why this exists:
 *   The retention audit found the same fragmentation as logging: `metric_counters` and
 *   `activity_log` are properly bounded, but `harbor_issued_tokens` (101K rows — a reaper INDEX
 *   was built but the DELETE was never written) and `semantic_resolution_events` (no prune at
 *   all) grow forever, and `tuples`/`messages` leak their no-TTL rows. There was no single list
 *   of "what gets cleaned and how," so a new table with no retention is invisible until the DB
 *   is 231 MB. And because nothing ever `VACUUM`s, even the tables that DO prune never return
 *   their freed pages to the OS — the file only grows.
 *
 * What it does:
 *   - A registry of named policies; `sweepAll()` runs them all, isolates failures per-policy
 *     (one broken sweep can't starve the others), and returns per-table deleted counts.
 *   - Two batteries-included policy builders — `ttlPolicy` (delete rows past an expiry column)
 *     and `capPolicy` (keep only the newest N rows) — so a new table is one line, not a new
 *     bespoke cleanup function.
 *   - `reclaim()` runs incremental vacuum when the freelist grows past a threshold, so pruning
 *     actually shrinks the file. (Requires `auto_vacuum=INCREMENTAL`, set in lib/db.ts.)
 *
 * A missing retention policy should be a LOUD, greppable omission — see `assertRegistered()`.
 */

import type Database from 'better-sqlite3';
import type { LogGovernor } from './log-governor.js';

export interface RetentionPolicy {
  /** Table (or logical) name — used in logs and dedup keys. */
  name: string;
  /** Delete stale rows as of `now`. Returns the number of rows deleted. Must not throw for empty. */
  sweep: (now: number) => number;
}

export interface SweepResult {
  name: string;
  deleted: number;
  ok: boolean;
  error?: string;
}

/**
 * Build a TTL policy: `DELETE FROM <table> WHERE <expiresColumn> IS NOT NULL AND <expiresColumn> < now`.
 * Rows with a NULL expiry are intentionally kept (opt-in permanence) — pair with `capPolicy`
 * if "permanent" rows still need an absolute ceiling.
 */
export function ttlPolicy(db: Database.Database, table: string, expiresColumn: string): RetentionPolicy {
  const stmt = db.prepare(
    `DELETE FROM ${table} WHERE ${expiresColumn} IS NOT NULL AND ${expiresColumn} < ?`,
  );
  return { name: table, sweep: (now) => stmt.run(now).changes };
}

/**
 * Build an absolute-age policy keyed on a creation-time column:
 * `DELETE FROM <table> WHERE <createdColumn> < now - maxAgeMs`.
 * Use for tables (like issued auth tokens) whose rows have no useful life past a fixed horizon.
 */
export function maxAgePolicy(
  db: Database.Database,
  table: string,
  createdColumn: string,
  maxAgeMs: number,
): RetentionPolicy {
  const stmt = db.prepare(`DELETE FROM ${table} WHERE ${createdColumn} < ?`);
  return { name: `${table}:maxage`, sweep: (now) => stmt.run(now - maxAgeMs).changes };
}

/**
 * Build a row-count cap: keep only the newest `maxRows` by `orderColumn`, delete the rest.
 * Bounds a table that would otherwise grow without a time horizon.
 */
export function capPolicy(
  db: Database.Database,
  table: string,
  orderColumn: string,
  maxRows: number,
): RetentionPolicy {
  const stmt = db.prepare(
    `DELETE FROM ${table} WHERE ${orderColumn} < (
       SELECT MIN(${orderColumn}) FROM (
         SELECT ${orderColumn} FROM ${table} ORDER BY ${orderColumn} DESC LIMIT ?
       )
     )`,
  );
  return { name: `${table}:cap`, sweep: () => stmt.run(maxRows).changes };
}

export class RetentionRegistry {
  private readonly policies = new Map<string, RetentionPolicy>();

  constructor(
    private readonly db: Database.Database,
    private readonly log?: LogGovernor,
  ) {}

  register(policy: RetentionPolicy): this {
    this.policies.set(policy.name, policy);
    return this;
  }

  registerAll(policies: RetentionPolicy[]): this {
    for (const p of policies) this.register(p);
    return this;
  }

  /** Names currently registered — for tests and for the self-monitor's coverage check. */
  registered(): string[] {
    return [...this.policies.keys()];
  }

  /**
   * Fail-loud coverage guard: assert that every table in `expected` has SOME policy registered.
   * Wire this to the watched-table list so adding an unbounded table trips a test, not prod.
   */
  assertRegistered(expected: string[]): void {
    const have = new Set([...this.policies.keys()].map((n) => n.split(':')[0]));
    const missing = expected.filter((t) => !have.has(t));
    if (missing.length > 0) {
      throw new Error(`retention: no policy registered for table(s): ${missing.join(', ')}`);
    }
  }

  /** Run every policy. Isolates per-policy failures. Emits one governed summary line. */
  sweepAll(now: number): SweepResult[] {
    const results: SweepResult[] = [];
    let totalDeleted = 0;
    for (const policy of this.policies.values()) {
      try {
        const deleted = policy.sweep(now);
        totalDeleted += deleted;
        results.push({ name: policy.name, deleted, ok: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ name: policy.name, deleted: 0, ok: false, error });
        // Governed: a persistently-failing sweep must not itself become log spam.
        this.log?.governed({
          key: `retention_sweep_failed:${policy.name}`,
          level: 'error',
          message: 'retention_sweep_failed',
          meta: { table: policy.name, error },
        });
      }
    }
    if (totalDeleted > 0) {
      this.log?.governed({
        key: 'retention_swept',
        level: 'info',
        message: 'retention_swept',
        meta: { total_deleted: totalDeleted, tables: results.filter((r) => r.deleted > 0).length },
        windowMs: 300_000,
      });
    }
    return results;
  }

  /**
   * Return freed pages to the OS when the freelist grows large. Requires the DB to have been
   * created (or one-time VACUUMed) with `auto_vacuum=INCREMENTAL`. Cheap and incremental —
   * safe to call each maintenance cycle. Returns pages reclaimed.
   */
  reclaim(freePageThreshold = 2_000): number {
    try {
      const freelist = this.db.pragma('freelist_count', { simple: true }) as number;
      if (freelist < freePageThreshold) return 0;
      this.db.pragma(`incremental_vacuum(${freelist})`);
      const after = this.db.pragma('freelist_count', { simple: true }) as number;
      const reclaimed = Math.max(0, freelist - after);
      if (reclaimed > 0) {
        this.log?.governed({
          key: 'retention_reclaimed',
          level: 'info',
          message: 'retention_reclaimed',
          meta: { pages_reclaimed: reclaimed },
          windowMs: 300_000,
        });
      }
      return reclaimed;
    } catch (err) {
      this.log?.governed({
        key: 'retention_reclaim_failed',
        level: 'warn',
        message: 'retention_reclaim_failed',
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
      return 0;
    }
  }
}
