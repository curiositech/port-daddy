/**
 * Distributed Locks Module
 *
 * Simple mutex locks for multi-agent coordination
 * No shell commands - pure SQLite-backed locking
 */

import type Database from 'better-sqlite3';

interface LockRow {
  name: string;
  owner: string;
  pid: number | null;
  acquired_at: number;
  expires_at: number | null;
  metadata: string | null;
}

interface AcquireOptions {
  owner?: string;
  pid?: number;
  ttl?: number;
  metadata?: Record<string, unknown> | null;
}

interface ReleaseOptions {
  owner?: string | null;
  force?: boolean;
}

interface ListOptions {
  owner?: string | null;
}

interface ExtendOptions {
  owner?: string | null;
  ttl?: number;
}

interface SqliteError extends Error {
  code?: string;
}

/**
 * Initialize the locks module with a database connection
 */
export function createLocks(db: Database.Database) {
  // Ensure locks table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS locks (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      pid INTEGER,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at);
  `);

  const stmts = {
    get: db.prepare('SELECT * FROM locks WHERE name = ?'),
    acquire: db.prepare(`
      INSERT INTO locks (name, owner, pid, acquired_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    release: db.prepare('DELETE FROM locks WHERE name = ?'),
    releaseIfOwner: db.prepare('DELETE FROM locks WHERE name = ? AND owner = ?'),
    releaseExpired: db.prepare('DELETE FROM locks WHERE expires_at IS NOT NULL AND expires_at < ?'),
    list: db.prepare('SELECT * FROM locks ORDER BY acquired_at DESC'),
    listByOwner: db.prepare('SELECT * FROM locks WHERE owner = ?')
  };

  function safeJsonParse(value: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  /**
   * Try to acquire a lock
   * Returns immediately with success/failure
   */
  function acquire(name: string, options: AcquireOptions = {}) {
    if (!name || typeof name !== 'string') {
      return { success: false, error: 'lock name must be a non-empty string' };
    }

    // Validate name format (alphanumeric, dashes, colons)
    if (!/^[a-zA-Z0-9:_-]+$/.test(name)) {
      return { success: false, error: 'lock name must be alphanumeric with dashes, underscores, or colons' };
    }

    const now = Date.now();
    const {
      owner = `agent-${process.pid}`,
      pid = process.pid,
      ttl = 300000, // 5 minutes default
      metadata = null
    } = options;

    // Clean up expired locks first
    stmts.releaseExpired.run(now);

    // Check if lock exists
    const existing = stmts.get.get(name) as LockRow | undefined;

    if (existing) {
      // Lock is held by someone else
      return {
        success: false,
        error: 'lock is held',
        holder: existing.owner,
        heldSince: existing.acquired_at,
        expiresAt: existing.expires_at
      };
    }

    // Try to acquire
    const expiresAt = ttl ? now + ttl : null;

    try {
      stmts.acquire.run(
        name,
        owner,
        pid,
        now,
        expiresAt,
        metadata ? JSON.stringify(metadata) : null
      );

      return {
        success: true,
        name,
        owner,
        acquiredAt: now,
        expiresAt,
        message: `acquired lock: ${name}`
      };
    } catch (err) {
      if ((err as SqliteError)?.code === 'SQLITE_CONSTRAINT') {
        // Race condition - someone else got it
        const holder = stmts.get.get(name) as LockRow | undefined;
        return {
          success: false,
          error: 'lock is held',
          holder: holder?.owner,
          heldSince: holder?.acquired_at
        };
      }
      throw err;
    }
  }

  /**
   * Release a lock
   */
  function release(name: string, options: ReleaseOptions = {}) {
    if (!name || typeof name !== 'string') {
      return { success: false, error: 'lock name must be a non-empty string' };
    }

    const { owner = null, force = false } = options;

    const existing = stmts.get.get(name) as LockRow | undefined;
    if (!existing) {
      return { success: true, released: false, message: 'lock not held' };
    }

    // If owner specified, only release if we own it
    if (owner && !force) {
      const result = stmts.releaseIfOwner.run(name, owner);
      if (result.changes === 0) {
        return {
          success: false,
          error: 'lock held by another owner',
          holder: existing.owner
        };
      }
    } else {
      stmts.release.run(name);
    }

    return {
      success: true,
      released: true,
      name,
      message: `released lock: ${name}`
    };
  }

  /**
   * Check if a lock is held
   */
  function check(name: string) {
    if (!name || typeof name !== 'string') {
      return { success: false, error: 'lock name must be a non-empty string' };
    }

    // Clean expired first
    stmts.releaseExpired.run(Date.now());

    const lock = stmts.get.get(name) as LockRow | undefined;

    if (!lock) {
      return { success: true, held: false, name };
    }

    return {
      success: true,
      held: true,
      name,
      owner: lock.owner,
      pid: lock.pid,
      acquiredAt: lock.acquired_at,
      expiresAt: lock.expires_at,
      metadata: safeJsonParse(lock.metadata)
    };
  }

  /**
   * List all active locks
   */
  function list(options: ListOptions = {}) {
    const { owner = null } = options;

    // Clean expired first
    stmts.releaseExpired.run(Date.now());

    const locks = (owner
      ? stmts.listByOwner.all(owner)
      : stmts.list.all()) as LockRow[];

    return {
      success: true,
      locks: locks.map(l => ({
        name: l.name,
        owner: l.owner,
        pid: l.pid,
        acquiredAt: l.acquired_at,
        expiresAt: l.expires_at,
        metadata: safeJsonParse(l.metadata)
      })),
      count: locks.length
    };
  }

  /**
   * Extend a lock's TTL
   */
  function extend(name: string, options: ExtendOptions = {}) {
    if (!name || typeof name !== 'string') {
      return { success: false, error: 'lock name must be a non-empty string' };
    }

    const { owner = null, ttl = 300000 } = options;
    const now = Date.now();

    const existing = stmts.get.get(name) as LockRow | undefined;
    if (!existing) {
      return { success: false, error: 'lock not held' };
    }

    if (owner && existing.owner !== owner) {
      return { success: false, error: 'lock held by another owner' };
    }

    const newExpiry = now + ttl;
    db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(newExpiry, name);

    return {
      success: true,
      name,
      expiresAt: newExpiry,
      message: `extended lock: ${name}`
    };
  }

  /**
   * Cleanup expired locks
   */
  function cleanup() {
    const result = stmts.releaseExpired.run(Date.now());
    return { cleaned: result.changes };
  }

  return {
    acquire,
    release,
    check,
    list,
    extend,
    cleanup
  };
}
