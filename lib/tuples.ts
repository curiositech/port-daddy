/**
 * Tuple Space — Shared coordination data structure for agent swarms
 *
 * Based on Linda (Gelernter, 1985) and blackboard systems (Erman, 1980).
 * Agents write typed tuples, other agents query by pattern matching.
 *
 * Operations:
 *   out(tuple)              — Write a tuple to the space
 *   rd(pattern)             — Read matching tuples (non-destructive)
 *   in(pattern)             — Take matching tuples (removes from space)
 *   scan(harbor?)           — List all tuples, optionally scoped to a harbor
 *
 * Tuples are JSON arrays with typed fields. Pattern matching uses:
 *   '*'     — matches any value
 *   value   — exact match
 *   '>N'    — numeric greater-than
 *   '<N'    — numeric less-than
 *
 * Scoped to harbors for fleet isolation. TTL for automatic cleanup.
 */

import type Database from 'better-sqlite3';

export interface Tuple {
  id: number;
  harbor: string | null;
  idempotencyKey: string | null;
  fields: unknown[];
  writtenBy: string | null;
  createdAt: number;
  expiresAt: number | null;
}

export interface TuplePollResult {
  tuple: Tuple | null;
  lastId: number;
}

type TupleSubscriberCallback = (tuple: Tuple) => void;

export const MAX_TUPLE_IDEMPOTENCY_KEY_CHARS = 256;

interface TupleWriteOptions {
  harbor?: string;
  writtenBy?: string;
  ttlMs?: number;
}

interface TupleOutOnceOptions extends TupleWriteOptions {
  idempotencyKey: string;
  /**
   * Server-owned authority rows are addressable only through the indexed key
   * primitives. Generic tuple routes, MCP tools, scans, takes, and subscribers
   * must never observe or remove them.
   */
  internalOnly?: boolean;
}

interface TupleKeyOptions {
  harbor?: string;
  /** Compare-and-delete guard for callers releasing an observed reservation. */
  expectedTupleId?: number;
}

function canonicalHarbor(harbor: string | null | undefined): string | null {
  const normalized = harbor?.trim();
  return normalized ? normalized : null;
}

export function createTupleSpace(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tuples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      harbor TEXT,
      fields TEXT NOT NULL,
      written_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      expires_at INTEGER,
      idempotency_key TEXT,
      internal_only INTEGER NOT NULL DEFAULT 0
    )
  `);

  const tupleColumns = db.prepare('PRAGMA table_info(tuples)').all() as Array<{ name: string }>;
  if (!tupleColumns.some((column) => column.name === 'idempotency_key')) {
    db.exec('ALTER TABLE tuples ADD COLUMN idempotency_key TEXT');
  }
  if (!tupleColumns.some((column) => column.name === 'internal_only')) {
    db.exec('ALTER TABLE tuples ADD COLUMN internal_only INTEGER NOT NULL DEFAULT 0');
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_tuples_harbor ON tuples(harbor)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tuples_expires ON tuples(expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tuples_public_harbor_created
    ON tuples(internal_only, harbor, created_at)`);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tuples_harbor_idempotency
    ON tuples(COALESCE(harbor, ''), idempotency_key)
    WHERE idempotency_key IS NOT NULL
  `);

  const insertStmt = db.prepare(
    'INSERT INTO tuples (harbor, fields, written_by, created_at, expires_at, idempotency_key, internal_only) VALUES (?, ?, ?, ?, ?, NULL, 0)'
  );
  const insertOnceStmt = db.prepare(`
    INSERT OR IGNORE INTO tuples
      (harbor, fields, written_by, created_at, expires_at, idempotency_key, internal_only)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const findOnceStmt = db.prepare(`
    SELECT * FROM tuples
    WHERE COALESCE(harbor, '') = ?
      AND idempotency_key = ?
      AND (expires_at IS NULL OR expires_at > ?)
    LIMIT 1
  `);
  const deleteExpiredOnceStmt = db.prepare(`
    DELETE FROM tuples
    WHERE COALESCE(harbor, '') = ?
      AND idempotency_key = ?
      AND expires_at IS NOT NULL
      AND expires_at <= ?
  `);
  const deleteOnceByIdStmt = db.prepare(`
    DELETE FROM tuples
    WHERE COALESCE(harbor, '') = ?
      AND idempotency_key = ?
      AND id = ?
  `);
  const deleteStmt = db.prepare('DELETE FROM tuples WHERE id = ?');
  const cleanupStmt = db.prepare('DELETE FROM tuples WHERE expires_at IS NOT NULL AND expires_at <= ?');
  const subscribers = new Map<number, {
    pattern: unknown[];
    harbor?: string | null;
    callback: TupleSubscriberCallback;
  }>();
  let nextSubscriberId = 1;

  function notifySubscribers(tuple: Tuple): void {
    for (const sub of subscribers.values()) {
      if (sub.harbor !== undefined && sub.harbor !== tuple.harbor) continue;
      if (!matchesPattern(tuple.fields, sub.pattern)) continue;
      try {
        sub.callback(tuple);
      } catch (error) {
        console.error('tuple subscriber callback failed:', error);
      }
    }
  }

  /** Write a tuple to the space. */
  function out(
    fields: unknown[],
    options?: TupleWriteOptions,
  ): Tuple {
    const now = Date.now();
    const expiresAt = options?.ttlMs ? now + options.ttlMs : null;
    const harbor = canonicalHarbor(options?.harbor);

    const result = insertStmt.run(
      harbor,
      JSON.stringify(fields),
      options?.writtenBy ?? null,
      now,
      expiresAt
    );

    const tuple = {
      id: result.lastInsertRowid as number,
      harbor,
      idempotencyKey: null,
      fields,
      writtenBy: options?.writtenBy ?? null,
      createdAt: now,
      expiresAt,
    };
    notifySubscribers(tuple);
    return tuple;
  }

  /**
   * Atomically reserve one durable tuple per canonical harbor + key.
   * Expired rows are removed in the same SQLite write transaction before the
   * reservation. Replays return the original tuple without replacing payload.
   */
  function outOnce(
    fields: unknown[],
    options: TupleOutOnceOptions,
  ): { tuple: Tuple; inserted: boolean } {
    const idempotencyKey = validatedIdempotencyKey(options?.idempotencyKey, 'outOnce');

    const reserve = db.transaction(() => {
      const now = Date.now();
      const harbor = canonicalHarbor(options.harbor);
      const harborKey = harbor ?? '';
      deleteExpiredOnceStmt.run(harborKey, idempotencyKey, now);
      const expiresAt = options.ttlMs ? now + options.ttlMs : null;
      const internalOnly = options.internalOnly === true;
      const insert = insertOnceStmt.run(
        harbor,
        JSON.stringify(fields),
        options.writtenBy ?? null,
        now,
        expiresAt,
        idempotencyKey,
        internalOnly ? 1 : 0,
      );
      const row = findOnceStmt.get(harborKey, idempotencyKey, now) as TupleRow | undefined;
      if (!row) throw new Error('tuple.outOnce: reservation could not be read back');
      return { tuple: rowToTuple(row), inserted: insert.changes === 1 };
    });

    const result = reserve.immediate();
    if (result.inserted && options.internalOnly !== true) notifySubscribers(result.tuple);
    return result;
  }

  function validatedIdempotencyKey(value: unknown, operation: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`tuple.${operation}: idempotencyKey is required`);
    }
    const key = value.trim();
    if (key.length > MAX_TUPLE_IDEMPOTENCY_KEY_CHARS) {
      throw new Error(
        `tuple.${operation}: idempotencyKey exceeds ${MAX_TUPLE_IDEMPOTENCY_KEY_CHARS} characters`,
      );
    }
    return key;
  }

  /** Indexed O(1) lookup by the same canonical harbor + key used by outOnce. */
  function getByIdempotencyKey(
    value: string,
    options: Pick<TupleKeyOptions, 'harbor'> = {},
  ): Tuple | null {
    const idempotencyKey = validatedIdempotencyKey(value, 'getByIdempotencyKey');
    const harborKey = canonicalHarbor(options.harbor) ?? '';
    const read = db.transaction(() => {
      const now = Date.now();
      deleteExpiredOnceStmt.run(harborKey, idempotencyKey, now);
      const row = findOnceStmt.get(harborKey, idempotencyKey, now) as TupleRow | undefined;
      return row ? rowToTuple(row) : null;
    });
    return read.immediate();
  }

  /** Indexed compare-and-delete used to release an observed durable owner. */
  function takeByIdempotencyKey(
    value: string,
    options: TupleKeyOptions = {},
  ): Tuple | null {
    const idempotencyKey = validatedIdempotencyKey(value, 'takeByIdempotencyKey');
    if (options.expectedTupleId !== undefined
      && (!Number.isSafeInteger(options.expectedTupleId) || options.expectedTupleId < 1)) {
      throw new Error('tuple.takeByIdempotencyKey: expectedTupleId must be a positive integer');
    }
    const harborKey = canonicalHarbor(options.harbor) ?? '';
    const takeOnce = db.transaction(() => {
      const now = Date.now();
      deleteExpiredOnceStmt.run(harborKey, idempotencyKey, now);
      const row = findOnceStmt.get(harborKey, idempotencyKey, now) as TupleRow | undefined;
      if (!row || (options.expectedTupleId !== undefined && row.id !== options.expectedTupleId)) {
        return null;
      }
      const deleted = deleteOnceByIdStmt.run(harborKey, idempotencyKey, row.id);
      return deleted.changes === 1 ? rowToTuple(row) : null;
    });
    return takeOnce.immediate();
  }

  /**
   * Match fields against a pattern.
   *   '*'         — matches any value
   *   '>N' / '<N' — numeric comparison
   *   'foo:*'     — semantic identity prefix match (Port Daddy native)
   *   value       — exact match
   */
  function matchesPattern(tupleFields: unknown[], pattern: unknown[]): boolean {
    if (pattern.length > tupleFields.length) return false;

    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i];
      const v = tupleFields[i];

      if (p === '*' || p === null) continue;

      if (typeof p === 'string') {
        // Numeric comparisons
        if (p.startsWith('>') && typeof v === 'number') {
          const t = parseFloat(p.slice(1));
          if (isNaN(t) || v <= t) return false;
          continue;
        }
        if (p.startsWith('<') && typeof v === 'number') {
          const t = parseFloat(p.slice(1));
          if (isNaN(t) || v >= t) return false;
          continue;
        }
        // Semantic identity prefix: 'myapp:*' matches 'myapp:api:main'
        if (p.endsWith(':*') && typeof v === 'string') {
          const prefix = p.slice(0, -1); // 'myapp:'
          if (!v.startsWith(prefix)) return false;
          continue;
        }
        // Semantic identity wildcard: 'myapp:*:main' matches 'myapp:api:main'
        if (p.includes(':*:') && typeof v === 'string') {
          const parts = p.split(':');
          const valueParts = v.split(':');
          if (parts.length !== valueParts.length) { if (p !== v) return false; continue; }
          let segMatch = true;
          for (let j = 0; j < parts.length; j++) {
            if (parts[j] === '*') continue;
            if (parts[j] !== valueParts[j]) { segMatch = false; break; }
          }
          if (!segMatch) return false;
          continue;
        }
      }

      if (p !== v) return false;
    }
    return true;
  }

  interface TupleRow {
    id: number;
    harbor: string | null;
    fields: string;
    written_by: string | null;
    created_at: number;
    expires_at: number | null;
    idempotency_key: string | null;
    internal_only: number;
  }

  function rowToTuple(row: TupleRow): Tuple {
    return {
      id: row.id,
      harbor: row.harbor,
      idempotencyKey: row.idempotency_key ?? null,
      fields: JSON.parse(row.fields),
      writtenBy: row.written_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  /** Public tuple-space projections never reveal durable reservation keys. */
  function rowToPublicTuple(row: TupleRow): Tuple {
    return {
      ...rowToTuple(row),
      idempotencyKey: null,
    };
  }

  /** Read matching tuples (non-destructive). */
  function rd(pattern: unknown[], options?: { harbor?: string; limit?: number }): Tuple[] {
    cleanupStmt.run(Date.now());

    const now = Date.now();
    const scoped = options?.harbor !== undefined;
    const harbor = canonicalHarbor(options?.harbor);
    const rows = scoped
      ? db.prepare(`
        SELECT * FROM tuples
        WHERE COALESCE(harbor, '') = COALESCE(?, '')
          AND internal_only = 0
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC
      `).all(harbor, now) as TupleRow[]
      : db.prepare('SELECT * FROM tuples WHERE internal_only = 0 AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC').all(now) as TupleRow[];

    const matches: Tuple[] = [];
    const limit = options?.limit ?? 100;

    for (const row of rows) {
      if (matches.length >= limit) break;
      const tuple = rowToPublicTuple(row);
      if (matchesPattern(tuple.fields, pattern)) {
        matches.push(tuple);
      }
    }
    return matches;
  }

  /** Take matching tuples (removes from space). */
  function take(pattern: unknown[], options?: { harbor?: string; limit?: number }): Tuple[] {
    const matches = rd(pattern, options);
    for (const tuple of matches) {
      deleteStmt.run(tuple.id);
    }
    return matches;
  }

  /**
   * Poll for the next tuple after a cursor.
   * Returns the first matching tuple in ascending ID order, or advances the cursor
   * past inspected non-matching rows so callers do not rescan forever.
   */
  function poll(
    pattern: unknown[],
    options?: { harbor?: string; afterId?: number; limit?: number }
  ): TuplePollResult {
    cleanupStmt.run(Date.now());

    const afterId = Math.max(0, options?.afterId ?? 0);
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
    const now = Date.now();
    const scoped = options?.harbor !== undefined;
    const harbor = canonicalHarbor(options?.harbor);
    const rows = scoped
      ? db.prepare(
        `SELECT * FROM tuples
         WHERE COALESCE(harbor, '') = COALESCE(?, '')
           AND internal_only = 0
           AND id > ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY id ASC LIMIT ?`
      ).all(harbor, afterId, now, limit) as TupleRow[]
      : db.prepare(
        'SELECT * FROM tuples WHERE internal_only = 0 AND id > ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY id ASC LIMIT ?'
      ).all(afterId, now, limit) as TupleRow[];

    let lastId = afterId;
    for (const row of rows) {
      const tuple = rowToPublicTuple(row);
      lastId = tuple.id;
      if (matchesPattern(tuple.fields, pattern)) {
        return { tuple, lastId };
      }
    }

    return { tuple: null, lastId };
  }

  /** List all tuples, optionally filtered by harbor. */
  function scan(harbor?: string): Tuple[] {
    cleanupStmt.run(Date.now());
    const now = Date.now();
    const scoped = harbor !== undefined;
    const canonical = canonicalHarbor(harbor);
    const rows = scoped
      ? db.prepare(`
        SELECT * FROM tuples
        WHERE COALESCE(harbor, '') = COALESCE(?, '')
          AND internal_only = 0
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC
      `).all(canonical, now) as TupleRow[]
      : db.prepare('SELECT * FROM tuples WHERE internal_only = 0 AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC').all(now) as TupleRow[];
    return rows.map(rowToPublicTuple);
  }

  /** Count tuples, optionally matching a pattern. */
  function count(pattern?: unknown[], harbor?: string): number {
    if (!pattern) {
      const scoped = harbor !== undefined;
      const canonical = canonicalHarbor(harbor);
      const row = scoped
        ? db.prepare(`
          SELECT COUNT(*) as c FROM tuples
          WHERE COALESCE(harbor, '') = COALESCE(?, '')
            AND internal_only = 0
            AND (expires_at IS NULL OR expires_at > ?)
        `).get(canonical, Date.now()) as { c: number }
        : db.prepare('SELECT COUNT(*) as c FROM tuples WHERE internal_only = 0 AND (expires_at IS NULL OR expires_at > ?)').get(Date.now()) as { c: number };
      return row.c;
    }
    return rd(pattern, { harbor }).length;
  }

  /** Remove expired tuples. Called automatically on reads. */
  function cleanup(): number {
    return cleanupStmt.run(Date.now()).changes;
  }

  /**
   * Subscribe to matching tuple writes. This is in-process delivery, mirroring
   * the messaging module's live fanout while keeping tuple storage authoritative.
   */
  function subscribe(
    pattern: unknown[],
    options: { harbor?: string } | undefined,
    callback: TupleSubscriberCallback
  ): (() => void) | null {
    if (!Array.isArray(pattern) || pattern.length === 0) return null;
    const id = nextSubscriberId++;
    subscribers.set(id, {
      pattern,
      harbor: options?.harbor === undefined ? undefined : canonicalHarbor(options.harbor),
      callback,
    });
    return () => {
      subscribers.delete(id);
    };
  }

  function destroy(): void {
    subscribers.clear();
  }

  return {
    out,
    outOnce,
    getByIdempotencyKey,
    takeByIdempotencyKey,
    rd,
    take,
    poll,
    scan,
    count,
    cleanup,
    subscribe,
    destroy,
  };
}

export type TupleSpace = ReturnType<typeof createTupleSpace>;
