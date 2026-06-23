/**
 * Begin Flakiness Log Module
 *
 * Agents report that `pd begin` is occasionally flaky: a crowded main worktree,
 * a registration/session rollback, a SELECT-then-INSERT race, or a transport
 * hiccup. Every one of those outcomes ends up surfaced to a human as an error
 * string plus an optional `hint` — the "human suggestion layer". Until now that
 * moment was returned to the caller and immediately forgotten: the route logged
 * a successful begin but said nothing when begin failed with a hint.
 *
 * This module is the durable record of that moment. Each time `pd begin` hands a
 * problem to a human, we append a structured row here so the flakiness can be
 * queried, summarised, and visualised (see core/pd-console begin-flakiness pane
 * and GET /sugar/begin/flakiness).
 *
 * Pure SQLite — no shell commands. Mirrors lib/activity.ts conventions.
 */

import type Database from 'better-sqlite3';

const MAX_LOG_ENTRIES = 5000; // Keep last 5k flakiness events
const LOG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * Coarse failure classes. The raw `code` from sugar.begin() is preserved too,
 * but operators (and the rust pane) reason about the small set of buckets here.
 */
export const BeginFlakinessClass = {
  /** Main worktree already has an active session — the crowded gate fired. */
  CROWDED: 'crowded',
  /** Worktree policy rejected the call (required/forbidden worktree). */
  WORKTREE_POLICY: 'worktree-policy',
  /** Agent registration failed (and the session was rolled back). */
  REGISTRATION: 'registration',
  /** Session start failed (and the agent registration was rolled back). */
  SESSION_START: 'session-start',
  /** Caller sent a bad request (missing purpose / lifecycle). */
  VALIDATION: 'validation',
  /** The handler threw — a 500, the most worrying / race-shaped bucket. */
  INTERNAL: 'internal',
  /** Anything we have not explicitly mapped yet. */
  OTHER: 'other',
} as const;

export type BeginFlakinessClassName =
  (typeof BeginFlakinessClass)[keyof typeof BeginFlakinessClass];

/**
 * Map a sugar.begin() failure `code` (or a thrown handler) to a coarse class.
 */
export function classifyBeginFailure(code: string | null | undefined): BeginFlakinessClassName {
  switch (code) {
    case 'MAIN_WORKTREE_CROWDED':
      return BeginFlakinessClass.CROWDED;
    case 'WORKTREE_REQUIRED':
    case 'MAIN_WORKTREE_SESSION_FORBIDDEN':
      return BeginFlakinessClass.WORKTREE_POLICY;
    case 'AGENT_REGISTRATION_FAILED':
      return BeginFlakinessClass.REGISTRATION;
    case 'SESSION_START_FAILED':
      return BeginFlakinessClass.SESSION_START;
    case 'VALIDATION_ERROR':
    case 'SESSION_LIFECYCLE_REQUIRED':
      return BeginFlakinessClass.VALIDATION;
    case 'INTERNAL_ERROR':
      return BeginFlakinessClass.INTERNAL;
    default:
      return BeginFlakinessClass.OTHER;
  }
}

export interface RecordBeginFlakinessOptions {
  /** Raw sugar.begin() failure code, or 'INTERNAL_ERROR' for a thrown handler. */
  code?: string | null;
  /** Operator-visible error string. */
  error?: string | null;
  /** Operator-visible suggestion — the "human suggestion layer" payload. */
  hint?: string | null;
  identity?: string | null;
  agentId?: string | null;
  worktree?: string | null;
  lifecycle?: string | null;
  purpose?: string | null;
  /** HTTP status the daemon is about to return (400 vs 500). */
  httpStatus?: number | null;
}

interface BeginFlakinessRow {
  id: number;
  timestamp: number;
  class: string;
  code: string | null;
  error: string | null;
  hint: string | null;
  identity: string | null;
  agent_id: string | null;
  worktree: string | null;
  lifecycle: string | null;
  purpose: string | null;
  http_status: number | null;
}

export interface BeginFlakinessEntry {
  id: number;
  timestamp: number;
  class: BeginFlakinessClassName;
  code: string | null;
  error: string | null;
  hint: string | null;
  identity: string | null;
  agentId: string | null;
  worktree: string | null;
  lifecycle: string | null;
  purpose: string | null;
  httpStatus: number | null;
}

export interface BeginFlakinessSummary {
  success: true;
  /** Total events in the window. */
  total: number;
  /** Counts keyed by class. */
  byClass: Record<string, number>;
  /** Counts keyed by raw code. */
  byCode: Record<string, number>;
  /** Most recent event timestamp, or null. */
  lastSeen: number | null;
  /** Inclusive lower bound of the window. */
  since: number;
  /**
   * Coarse rate sparkline: event counts bucketed over the window, oldest-first.
   * Lets the rust pane draw a Block::Spark without re-bucketing.
   */
  sparkline: number[];
}

function formatEntry(row: BeginFlakinessRow): BeginFlakinessEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    class: (row.class as BeginFlakinessClassName) ?? BeginFlakinessClass.OTHER,
    code: row.code,
    error: row.error,
    hint: row.hint,
    identity: row.identity,
    agentId: row.agent_id,
    worktree: row.worktree,
    lifecycle: row.lifecycle,
    purpose: row.purpose,
    httpStatus: row.http_status,
  };
}

export function createBeginFlakinessLog(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS begin_flakiness (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      class TEXT NOT NULL,
      code TEXT,
      error TEXT,
      hint TEXT,
      identity TEXT,
      agent_id TEXT,
      worktree TEXT,
      lifecycle TEXT,
      purpose TEXT,
      http_status INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_begin_flakiness_timestamp ON begin_flakiness(timestamp);
    CREATE INDEX IF NOT EXISTS idx_begin_flakiness_class ON begin_flakiness(class);
    CREATE INDEX IF NOT EXISTS idx_begin_flakiness_identity ON begin_flakiness(identity);
  `);

  const stmts = {
    insert: db.prepare(`
      INSERT INTO begin_flakiness
        (timestamp, class, code, error, hint, identity, agent_id, worktree, lifecycle, purpose, http_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getRecent: db.prepare(`
      SELECT * FROM begin_flakiness
      ORDER BY timestamp DESC
      LIMIT ?
    `),
    getRecentByClass: db.prepare(`
      SELECT * FROM begin_flakiness
      WHERE class = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `),
    sinceRows: db.prepare(`
      SELECT timestamp, class, code FROM begin_flakiness
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
    `),
    clear: db.prepare('DELETE FROM begin_flakiness'),
    count: db.prepare('SELECT COUNT(*) as count FROM begin_flakiness'),
    oldest: db.prepare('SELECT MIN(timestamp) as v FROM begin_flakiness'),
    newest: db.prepare('SELECT MAX(timestamp) as v FROM begin_flakiness'),
    deleteOld: db.prepare('DELETE FROM begin_flakiness WHERE timestamp < ?'),
    getNthTimestamp: db.prepare(
      'SELECT timestamp FROM begin_flakiness ORDER BY timestamp DESC LIMIT 1 OFFSET ?'
    ),
    deleteExcessByTimestamp: db.prepare('DELETE FROM begin_flakiness WHERE timestamp < ?'),
  };

  const subscribers = new Set<(entry: BeginFlakinessEntry) => void>();

  function record(options: RecordBeginFlakinessOptions): BeginFlakinessEntry | null {
    const now = Date.now();
    const cls = classifyBeginFailure(options.code);
    try {
      const res = stmts.insert.run(
        now,
        cls,
        options.code ?? null,
        options.error ?? null,
        options.hint ?? null,
        options.identity ?? null,
        options.agentId ?? null,
        options.worktree ?? null,
        options.lifecycle ?? null,
        options.purpose ?? null,
        options.httpStatus ?? null
      );

      const entry: BeginFlakinessEntry = {
        id: Number(res.lastInsertRowid),
        timestamp: now,
        class: cls,
        code: options.code ?? null,
        error: options.error ?? null,
        hint: options.hint ?? null,
        identity: options.identity ?? null,
        agentId: options.agentId ?? null,
        worktree: options.worktree ?? null,
        lifecycle: options.lifecycle ?? null,
        purpose: options.purpose ?? null,
        httpStatus: options.httpStatus ?? null,
      };

      for (const cb of subscribers) {
        try {
          cb(entry);
        } catch (err) {
          console.error('Begin-flakiness subscriber error:', err);
        }
      }

      return entry;
    } catch (err) {
      // Telemetry must never break the request path.
      console.error('Begin-flakiness record failed:', (err as Error).message);
      return null;
    }
  }

  function subscribe(callback: (entry: BeginFlakinessEntry) => void): () => void {
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }

  function getRecent(
    options: { limit?: number; class?: string | null } = {}
  ): { success: true; entries: BeginFlakinessEntry[]; count: number } {
    const { limit = 100, class: cls = null } = options;
    const safeLimit = Math.min(Math.max(1, limit), 1000);
    const rows = (
      cls
        ? stmts.getRecentByClass.all(cls, safeLimit)
        : stmts.getRecent.all(safeLimit)
    ) as BeginFlakinessRow[];
    return { success: true, entries: rows.map(formatEntry), count: rows.length };
  }

  /**
   * Summarise the window [since, now]. `buckets` controls the sparkline width.
   */
  function getSummary(sinceMs = 0, buckets = 24): BeginFlakinessSummary {
    const now = Date.now();
    const since = sinceMs > 0 ? sinceMs : now - 24 * 60 * 60 * 1000; // default 24h
    const rows = stmts.sinceRows.all(since) as Array<{
      timestamp: number;
      class: string;
      code: string | null;
    }>;

    const byClass: Record<string, number> = {};
    const byCode: Record<string, number> = {};
    const safeBuckets = Math.min(Math.max(1, buckets), 240);
    const spark = new Array<number>(safeBuckets).fill(0);
    const span = Math.max(1, now - since);
    let lastSeen: number | null = null;

    for (const r of rows) {
      byClass[r.class] = (byClass[r.class] ?? 0) + 1;
      if (r.code) byCode[r.code] = (byCode[r.code] ?? 0) + 1;
      lastSeen = lastSeen === null ? r.timestamp : Math.max(lastSeen, r.timestamp);
      const idx = Math.min(
        safeBuckets - 1,
        Math.floor(((r.timestamp - since) / span) * safeBuckets)
      );
      if (idx >= 0) spark[idx] += 1;
    }

    return {
      success: true,
      total: rows.length,
      byClass,
      byCode,
      lastSeen,
      since,
      sparkline: spark,
    };
  }

  function getStats() {
    const count = (stmts.count.get() as { count: number }).count;
    const oldest = (stmts.oldest.get() as { v: number | null }).v;
    const newest = (stmts.newest.get() as { v: number | null }).v;
    return {
      success: true as const,
      stats: {
        totalEntries: count,
        oldestEntry: oldest,
        newestEntry: newest,
        retentionMs: LOG_RETENTION_MS,
        maxEntries: MAX_LOG_ENTRIES,
      },
    };
  }

  function cleanup() {
    const cutoff = Date.now() - LOG_RETENTION_MS;
    const old = stmts.deleteOld.run(cutoff);
    let deletedExcess = 0;
    const pivot = stmts.getNthTimestamp.get(MAX_LOG_ENTRIES) as
      | { timestamp: number }
      | undefined;
    if (pivot) {
      deletedExcess = stmts.deleteExcessByTimestamp.run(pivot.timestamp).changes;
    }
    return {
      deletedOld: old.changes,
      deletedExcess,
      total: old.changes + deletedExcess,
    };
  }

  return {
    record,
    getRecent,
    getSummary,
    getStats,
    cleanup,
    subscribe,
    clear: () => stmts.clear.run(),
    classify: classifyBeginFailure,
    BeginFlakinessClass,
  };
}

export type BeginFlakinessLog = ReturnType<typeof createBeginFlakinessLog>;
