/**
 * Services Module - Core logic for Port Daddy v2
 *
 * Handles: claim, release, find operations with semantic identities
 */

import type Database from 'better-sqlite3';
import { parseIdentity, patternToSql } from './identity.js';
import { parseExpires } from './utils.js';
import type { SemanticIndex } from './semantic-index.js';
import { DEFAULT_DAEMON_PORT } from '../shared/daemon-discovery.js';

const DEFAULT_RANGE: [number, number] = [3100, 9999];
const RESERVED_PORTS = new Set([8080, 8000, DEFAULT_DAEMON_PORT]);
const MAX_SERVICES_PER_IDENTITY_PREFIX = 20;

interface ServiceRow {
  id: string;
  port: number;
  pid: number | null;
  cmd: string | null;
  cwd: string | null;
  status: string;
  created_at: number;
  last_seen: number;
  expires_at: number | null;
  restart_policy: string | null;
  health_url: string | null;
  tunnel_provider: string | null;
  tunnel_url: string | null;
  paired_with: string | null;
  metadata: string | null;
}

interface EndpointRow {
  service_id: string;
  env: string;
  url: string;
  created_at: number;
  updated_at: number;
}

interface PortRow {
  port: number;
}

interface ClaimOptions {
  port?: number;
  range?: [number, number];
  pid?: number | null;
  cmd?: string | null;
  cwd?: string | null;
  expires?: string | number | null;
  restart?: string;
  health?: string | null;
  pair?: string | null;
  metadata?: Record<string, unknown> | null;
  systemPorts?: Set<number>;
}

interface ReleaseOptions {
  expired?: boolean;
}

interface FindOptions {
  status?: string;
  port?: number;
  expired?: boolean;
  limit?: number;
}

interface ServicesOptions {
  semanticIndex?: SemanticIndex;
}

/**
 * Initialize the services module with a database connection
 */
export function createServices(db: Database.Database, options?: ServicesOptions) {
  const semanticIndex = options?.semanticIndex;
  // Prepared statements
  const stmts = {
    getById: db.prepare('SELECT * FROM services WHERE id = ?'),
    getByPort: db.prepare('SELECT * FROM services WHERE port = ?'),
    getByPattern: db.prepare('SELECT * FROM services WHERE id LIKE ?'),
    getAllActive: db.prepare(`
      SELECT * FROM services
      WHERE status IN ('assigned', 'running')
      ORDER BY id
    `),
    countActive: db.prepare(`
      SELECT COUNT(*) as count FROM services WHERE status IN ('assigned', 'running')
    `),
    getAllPorts: db.prepare('SELECT port FROM services WHERE port IS NOT NULL'),
    insert: db.prepare(`
      INSERT INTO services (id, port, pid, cmd, cwd, status, created_at, last_seen, expires_at, restart_policy, health_url, paired_with, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    update: db.prepare(`
      UPDATE services SET
        port = COALESCE(?, port),
        pid = COALESCE(?, pid),
        cmd = COALESCE(?, cmd),
        status = COALESCE(?, status),
        last_seen = ?,
        expires_at = COALESCE(?, expires_at),
        tunnel_url = COALESCE(?, tunnel_url),
        metadata = COALESCE(?, metadata)
      WHERE id = ?
    `),
    updateLastSeen: db.prepare('UPDATE services SET last_seen = ? WHERE id = ?'),
    updateStatus: db.prepare('UPDATE services SET status = ?, last_seen = ? WHERE id = ?'),
    deleteById: db.prepare('DELETE FROM services WHERE id = ?'),
    deleteByPattern: db.prepare('DELETE FROM services WHERE id LIKE ?'),
    deleteExpired: db.prepare('DELETE FROM services WHERE expires_at IS NOT NULL AND expires_at < ?'),

    countByPrefix: db.prepare("SELECT COUNT(*) as count FROM services WHERE id LIKE ? ESCAPE '\\'"),

    // Endpoints
    getEndpoints: db.prepare('SELECT * FROM endpoints WHERE service_id = ?'),
    setEndpoint: db.prepare(`
      INSERT OR REPLACE INTO endpoints (service_id, env, url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    deleteEndpoint: db.prepare('DELETE FROM endpoints WHERE service_id = ? AND env = ?'),
    deleteAllEndpoints: db.prepare('DELETE FROM endpoints WHERE service_id = ?'),
    getRunningWithPid: db.prepare(
      "SELECT * FROM services WHERE pid IS NOT NULL AND status = 'running'"
    ),
    // NOTE: getEndpointsBatch is constructed dynamically per call (variable IN list).
    // See batchGetEndpoints() helper below.
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
   * Fetch endpoints for multiple service IDs in a single batched query.
   * Returns a Map from service_id → Record<env, url>.
   * Falls back gracefully to an empty map when ids is empty.
   */
  function batchGetEndpoints(ids: string[]): Map<string, Record<string, string>> {
    if (ids.length === 0) return new Map();

    // Build "WHERE service_id IN (?,?,…)" dynamically — parameter count varies
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT service_id, env, url FROM endpoints WHERE service_id IN (${placeholders})`
    ).all(...ids) as EndpointRow[];

    const result = new Map<string, Record<string, string>>();
    for (const row of rows) {
      if (!result.has(row.service_id)) {
        result.set(row.service_id, {});
      }
      result.get(row.service_id)![row.env] = row.url;
    }
    return result;
  }

  /**
   * Batch-fetch full service rows by ID (for trie-accelerated lookups).
   */
  function batchFetchServices(ids: string[]): ServiceRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return db.prepare(
      `SELECT * FROM services WHERE id IN (${placeholders})`
    ).all(...ids) as ServiceRow[];
  }

  /**
   * Find an available port in the given range
   */
  function findAvailablePort(range: [number, number] = DEFAULT_RANGE, systemPorts: Set<number> = new Set()): number {
    const [min, max] = range;

    // Validate range bounds
    if (min < 1 || max > 65535 || min > max) {
      throw new Error(`Invalid port range ${min}-${max} (must be within 1-65535)`);
    }

    const usedPorts = new Set((stmts.getAllPorts.all() as PortRow[]).map(r => r.port));

    for (let port = min; port <= max; port++) {
      if (!usedPorts.has(port) && !RESERVED_PORTS.has(port) && !systemPorts.has(port)) {
        return port;
      }
    }

    throw new Error(`No available ports in range ${min}-${max}`);
  }

  /**
   * Turn a claim's `expires` option into the absolute deadline stored in
   * `services.expires_at`.
   *
   * Why this exists: `expires_at` is compared against `Date.now()` by
   * `cleanup()` and `release({ expired: true })`, so it must always hold epoch
   * milliseconds. Writing the raw option instead (a `'1m'` string, or a bare
   * duration like `60000`) stores a value that either never expires, because
   * SQLite orders TEXT above every INTEGER, or expired decades ago. Both the
   * new-claim and the re-claim paths go through this one function so they
   * cannot disagree.
   *
   * @param expires - The caller's option: a duration string such as `'30m'` or
   *   `'2h30m'`, a duration in milliseconds, or null/undefined for no expiry.
   * @param now - The claim's timestamp, so the deadline is relative to the
   *   same instant recorded as `last_seen`.
   * @returns `now` plus the parsed duration, or null when there is no option or
   *   it does not parse.
   */
  function computeExpiresAt(expires: string | number | null | undefined, now: number): number | null {
    if (!expires) return null;
    const ttl = parseExpires(expires);
    return ttl !== null ? now + ttl : null;
  }

  /**
   * Delete one service row, its endpoints and its semantic-index entry.
   *
   * Design intent: a service is gone only when all three are gone. `cleanup()`
   * uses this for dead-PID rows and `claim()` uses it for an expired row it is
   * about to replace, so a reclaimed identity never inherits a stale tunnel or
   * custom endpoint from the claim that lapsed.
   *
   * @param id - The normalized service identity.
   * @returns Nothing; a missing row is a no-op.
   */
  function dropService(id: string): void {
    stmts.deleteAllEndpoints.run(id);
    stmts.deleteById.run(id);
    semanticIndex?.unindex(id);
  }

  /**
   * Claim a port for a service.
   *
   * Design: claim is idempotent while a claim is live (the Book's I3). A
   * re-claim of a row whose `expires_at` is still in the future, or exactly
   * now, returns the same port and refreshes `last_seen`, plus any of `pid`,
   * `cmd`, `expires` or `metadata` the caller passed. A row whose deadline has
   * passed is treated as free (I4, TTL reclamation): it is deleted as
   * `cleanup()` would delete it, and the call proceeds as a fresh claim. The
   * motivation is the window between a deadline and the next cleanup tick,
   * where reusing the dead row would keep its past deadline and let that tick
   * delete a service that had just been claimed again.
   *
   * @param id - Semantic identity (`project:stack:context`); wildcards are refused.
   * @param options - Preferred port, range, process details, `expires` duration,
   *   restart policy, health URL, pairing, metadata, and ports the OS already holds.
   * @returns `{ success, id, port, status, existing, message }`, where `existing`
   *   is true only when a live row was reused; or `{ success: false, error }`.
   */
  function claim(id: string, options: ClaimOptions = {}) {
    const parsed = parseIdentity(id);
    if (!parsed.valid) {
      return { success: false, error: parsed.error };
    }

    if (parsed.hasWildcard) {
      return { success: false, error: 'cannot claim with wildcard identity' };
    }

    const now = Date.now();
    const {
      port: preferredPort,
      range = DEFAULT_RANGE,
      pid = null,
      cmd = null,
      cwd = null,
      expires = null,
      restart = 'never',
      health = null,
      pair = null,
      metadata = null,
      systemPorts = new Set<number>()
    } = options;

    const expiresAt = computeExpiresAt(expires, now);

    // Check for existing service
    let existing = stmts.getById.get(parsed.normalized) as ServiceRow | undefined;

    // An expired row is free, swept or not. Same predicate as deleteExpired.
    if (existing && existing.expires_at !== null && existing.expires_at < now) {
      dropService(parsed.normalized);
      existing = undefined;
    }

    if (existing) {
      // Update last_seen and return existing port
      stmts.updateLastSeen.run(now, parsed.normalized);

      // Update optional fields if provided
      if (cmd || pid || expiresAt !== null || metadata) {
        stmts.update.run(
          null, pid, cmd, null, now, expiresAt, null, metadata ? JSON.stringify(metadata) : null,
          parsed.normalized
        );
      }

      return {
        success: true,
        id: parsed.normalized,
        port: existing.port,
        status: existing.status,
        existing: true,
        message: 'reusing existing service'
      };
    }

    // Enforce max services per identity prefix (first segment before ':')
    const identityPrefix = parsed.normalized.split(':')[0];
    if (identityPrefix) {
      const prefixPattern = identityPrefix.replace(/[%_]/g, '\\$&') + ':%';
      const prefixCount = (stmts.countByPrefix.get(prefixPattern) as { count: number }).count;
      if (prefixCount >= MAX_SERVICES_PER_IDENTITY_PREFIX) {
        return {
          success: false,
          error: `identity prefix "${identityPrefix}" has reached the maximum of ${MAX_SERVICES_PER_IDENTITY_PREFIX} services`,
          code: 'SERVICES_LIMIT_EXCEEDED',
        };
      }
    }

    // Find a port
    let port: number | undefined;
    if (preferredPort && preferredPort >= 1 && preferredPort <= 65535 && !RESERVED_PORTS.has(preferredPort) && !systemPorts.has(preferredPort)) {
      const conflict = stmts.getByPort.get(preferredPort) as ServiceRow | undefined;
      if (!conflict) {
        port = preferredPort;
      } else {
        if (process.env.DEBUG_TESTS) console.error(`[DEBUG] Port conflict for ${preferredPort}: ${conflict.id}`);
      }
    } else if (preferredPort) {
      if (process.env.DEBUG_TESTS) console.error(`[DEBUG] Port ${preferredPort} rejected: reserved=${RESERVED_PORTS.has(preferredPort)}, system=${systemPorts.has(preferredPort)}`);
    }

    if (!port) {
      try {
        port = findAvailablePort(range, systemPorts);
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    // Insert new service
    try {
      stmts.insert.run(
        parsed.normalized,
        port,
        pid,
        cmd,
        cwd,
        'assigned',
        now,
        now,
        expiresAt,
        restart,
        health,
        pair,
        metadata ? JSON.stringify(metadata) : null
      );

      // Create local endpoint
      stmts.setEndpoint.run(
        parsed.normalized,
        'local',
        `http://localhost:${port}`,
        now,
        now
      );

      // Keep trie in sync
      semanticIndex?.index(parsed.normalized, {
        type: 'service', id: parsed.normalized, identity: parsed.normalized,
      });

      return {
        success: true,
        id: parsed.normalized,
        port,
        status: 'assigned',
        existing: false,
        message: preferredPort === port ? 'assigned preferred port' : 'assigned new port'
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT') {
        return { success: false, error: 'port already in use' };
      }
      throw err;
    }
  }

  /**
   * Release service(s) by ID or pattern
   */
  function release(idOrPattern: string, options: ReleaseOptions = {}) {
    const parsed = parseIdentity(idOrPattern);
    if (!parsed.valid) {
      return { success: false, error: parsed.error };
    }

    const { expired = false } = options;

    if (expired) {
      // Pre-query expired IDs for trie cleanup
      if (semanticIndex) {
        const expiredRows = db.prepare(
          'SELECT id FROM services WHERE expires_at IS NOT NULL AND expires_at < ?'
        ).all(Date.now()) as { id: string }[];
        for (const s of expiredRows) semanticIndex.unindex(s.id);
      }
      const result = stmts.deleteExpired.run(Date.now());
      return {
        success: true,
        released: result.changes,
        message: `released ${result.changes} expired service(s)`
      };
    }

    if (parsed.hasWildcard) {
      // Pattern-based release — trie-accelerated when available
      let services: ServiceRow[];
      if (semanticIndex) {
        const entries = semanticIndex.find(idOrPattern).filter(e => e.type === 'service');
        services = entries.map(e => stmts.getById.get(e.id)).filter(Boolean) as ServiceRow[];
      } else {
        const sqlPattern = patternToSql(idOrPattern);
        services = stmts.getByPattern.all(sqlPattern) as ServiceRow[];
      }

      for (const svc of services) {
        stmts.deleteAllEndpoints.run(svc.id);
        stmts.deleteById.run(svc.id);
        semanticIndex?.unindex(svc.id);
      }

      return {
        success: true,
        released: services.length,
        message: `released ${services.length} service(s) matching ${idOrPattern}`
      };
    }

    // Single service release
    const existing = stmts.getById.get(parsed.normalized) as ServiceRow | undefined;
    if (!existing) {
      return { success: true, released: 0, message: 'service not found' };
    }

    stmts.deleteAllEndpoints.run(parsed.normalized);
    stmts.deleteById.run(parsed.normalized);
    semanticIndex?.unindex(parsed.normalized);

    return {
      success: true,
      released: 1,
      port: existing.port,
      message: `released ${parsed.normalized} (port ${existing.port})`
    };
  }

  /**
   * Find services matching criteria
   */
  function find(idOrPattern: string = '*', options: FindOptions = {}) {
    const { status, port, expired, limit = 100 } = options;

    let services: ServiceRow[];

    if (idOrPattern === '*' || idOrPattern === '*:*:*') {
      // Full wildcard — SQL scan is optimal (trie would return all types, not just services)
      services = stmts.getByPattern.all('%') as ServiceRow[];
    } else {
      const parsed = parseIdentity(idOrPattern);
      if (!parsed.valid) {
        return { success: false, error: parsed.error };
      }

      if (parsed.hasWildcard && semanticIndex) {
        // Trie-accelerated wildcard lookup: O(k+m) vs SQL LIKE O(n)
        const entries = semanticIndex.find(idOrPattern).filter(e => e.type === 'service');
        services = batchFetchServices(entries.map(e => e.id));
      } else {
        const sqlPattern = patternToSql(idOrPattern);
        services = stmts.getByPattern.all(sqlPattern) as ServiceRow[];
      }
    }

    // Apply filters
    const now = Date.now();

    services = services.filter(svc => {
      if (status && svc.status !== status) return false;
      if (port && svc.port !== port) return false;
      if (expired === true && (!svc.expires_at || svc.expires_at > now)) return false;
      if (expired === false && svc.expires_at && svc.expires_at <= now) return false;
      return true;
    });

    // Limit results
    if (services.length > limit) {
      services = services.slice(0, limit);
    }

    // Enrich with endpoints — single batched query instead of N per-service queries
    const endpointMap = batchGetEndpoints(services.map(s => s.id));

    const enriched = services.map(svc => ({
      id: svc.id,
      port: svc.port,
      pid: svc.pid,
      status: svc.status,
      cmd: svc.cmd,
      createdAt: svc.created_at,
      lastSeen: svc.last_seen,
      expiresAt: svc.expires_at,
      tunnelUrl: svc.tunnel_url,
      pairedWith: svc.paired_with,
      urls: endpointMap.get(svc.id) ?? {},
      metadata: safeJsonParse(svc.metadata)
    }));

    return {
      success: true,
      services: enriched,
      count: enriched.length
    };
  }

  /**
   * Get a single service by ID
   */
  function get(id: string) {
    const parsed = parseIdentity(id);
    if (!parsed.valid) {
      return { success: false, error: parsed.error };
    }

    const svc = stmts.getById.get(parsed.normalized) as ServiceRow | undefined;
    if (!svc) {
      return { success: false, error: 'service not found' };
    }

    const endpoints = stmts.getEndpoints.all(svc.id) as EndpointRow[];
    const urls: Record<string, string> = {};
    for (const ep of endpoints) {
      urls[ep.env] = ep.url;
    }

    return {
      success: true,
      service: {
        id: svc.id,
        port: svc.port,
        pid: svc.pid,
        status: svc.status,
        cmd: svc.cmd,
        cwd: svc.cwd,
        createdAt: svc.created_at,
        lastSeen: svc.last_seen,
        expiresAt: svc.expires_at,
        restartPolicy: svc.restart_policy,
        healthUrl: svc.health_url,
        tunnelProvider: svc.tunnel_provider,
        tunnelUrl: svc.tunnel_url,
        pairedWith: svc.paired_with,
        urls,
        metadata: safeJsonParse(svc.metadata)
      }
    };
  }

  /**
   * Set an endpoint URL for a service
   */
  function setEndpoint(id: string, env: string, url: string) {
    const parsed = parseIdentity(id);
    if (!parsed.valid) {
      return { success: false, error: parsed.error };
    }

    const svc = stmts.getById.get(parsed.normalized) as ServiceRow | undefined;
    if (!svc) {
      return { success: false, error: 'service not found' };
    }

    const now = Date.now();
    stmts.setEndpoint.run(parsed.normalized, env, url, now, now);

    return { success: true, message: `set ${env} URL for ${parsed.normalized}` };
  }

  /**
   * Update service status
   */
  function setStatus(id: string, status: string) {
    const parsed = parseIdentity(id);
    if (!parsed.valid) {
      return { success: false, error: parsed.error };
    }

    const now = Date.now();
    const result = stmts.updateStatus.run(status, now, parsed.normalized);

    if (result.changes === 0) {
      return { success: false, error: 'service not found' };
    }

    return { success: true, message: `${parsed.normalized} status set to ${status}` };
  }

  /**
   * Count active services without fetching all rows (O(1) with the index).
   * Used by health/metrics endpoints that only need a count, not full data.
   */
  function count(): number {
    const row = stmts.countActive.get() as { count: number };
    return row.count;
  }

  /**
   * Check if a PID is still alive
   */
  function isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0); // signal 0 = liveness probe, no actual signal sent
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup expired services and services with dead PIDs
   */
  function cleanup() {
    const now = Date.now();

    // 1. Remove expired services (pre-query for trie cleanup)
    if (semanticIndex) {
      const expiredRows = db.prepare(
        'SELECT id FROM services WHERE expires_at IS NOT NULL AND expires_at < ?'
      ).all(now) as { id: string }[];
      for (const s of expiredRows) semanticIndex.unindex(s.id);
    }
    const expiredResult = stmts.deleteExpired.run(now);
    let cleaned = expiredResult.changes;

    // 2. Remove services whose PID is no longer alive (zombie cleanup).
    // Only check services that have a PID and are in 'running' status
    // — 'assigned' services haven't started yet so no PID to check.
    const running = stmts.getRunningWithPid.all() as ServiceRow[];

    for (const svc of running) {
      if (svc.pid && !isPidAlive(svc.pid)) {
        dropService(svc.id);
        cleaned++;
      }
    }

    return { cleaned };
  }

  return {
    claim,
    release,
    find,
    get,
    count,
    setEndpoint,
    setStatus,
    cleanup,
    findAvailablePort
  };
}
