/**
 * DNS Module
 *
 * Local DNS records for services. Maps semantic identities to
 * friendly .local hostnames via SQLite-backed records.
 * Bonjour/mDNS advertisement is optional and not required.
 *
 * Pure SQLite-backed -- no shell commands.
 */

import type Database from 'better-sqlite3';
import { ActivityType } from './activity.js';

// Optional activity logger interface -- injected after creation via setActivityLog()
interface ActivityLogger {
  log(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
}

// Optional resolver interface -- injected after creation via setResolver()
interface Resolver {
  addEntry(hostname: string, ip?: string): { success: boolean; alreadyExists?: boolean; updated?: boolean };
  removeEntry(hostname: string): { success: boolean; notFound?: boolean };
  sync(): { success: boolean; entries: number };
  isSetUp(): boolean;
}

// =============================================================================
// Types
// =============================================================================

interface DnsRecordRow {
  identity: string;
  hostname: string;
  port: number;
  created_at: number;
  updated_at: number;
}

interface RegisterOptions {
  hostname?: string;
  port: number;
}

interface ListOptions {
  pattern?: string;
  limit?: number;
}

// =============================================================================
// Hostname generation
// =============================================================================

/**
 * Generate a .local hostname from a semantic identity.
 * "myapp:api" -> "myapp-api.local"
 * "myapp:api:main" -> "myapp-api-main.local"
 */
function identityToHostname(identity: string): string {
  // Replace colons with dashes, strip anything not alphanumeric or dash/dot
  const sanitized = identity
    .replace(/:/g, '-')
    .replace(/[^a-zA-Z0-9.-]/g, '-')
    .replace(/-+/g, '-')          // collapse multiple dashes
    .replace(/^-+|-+$/g, '')      // trim leading/trailing dashes
    .toLowerCase();

  if (!sanitized) {
    return 'unknown.local';
  }

  return `${sanitized}.local`;
}

/**
 * Validate a custom hostname.
 * Must end in .local, contain only valid chars, and be reasonable length.
 */
function validateHostname(hostname: string): { valid: boolean; error?: string } {
  if (!hostname || typeof hostname !== 'string') {
    return { valid: false, error: 'hostname must be a non-empty string' };
  }

  if (hostname.length > 253) {
    return { valid: false, error: 'hostname must be 253 characters or fewer' };
  }

  if (!hostname.endsWith('.local')) {
    return { valid: false, error: 'hostname must end with .local' };
  }

  // Must be valid hostname chars (alphanumeric, hyphens, dots)
  const nameWithoutLocal = hostname.slice(0, -6); // remove .local
  if (!nameWithoutLocal || nameWithoutLocal.length === 0) {
    return { valid: false, error: 'hostname must have a name before .local' };
  }

  if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(nameWithoutLocal)) {
    return { valid: false, error: 'hostname contains invalid characters' };
  }

  return { valid: true };
}

// =============================================================================
// Module factory
// =============================================================================

/**
 * Initialize the DNS module with a database connection
 */
export function createDns(db: Database.Database) {
  // Ensure tables exist
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS dns_records (
      identity TEXT PRIMARY KEY,
      hostname TEXT NOT NULL UNIQUE,
      port INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_dns_hostname ON dns_records(hostname)`,
    `CREATE INDEX IF NOT EXISTS idx_dns_port ON dns_records(port)`,
  ];

  for (const sql of schemaStatements) {
    db.prepare(sql).run();
  }

  // Prepared statements
  const stmts = {
    getByIdentity: db.prepare('SELECT * FROM dns_records WHERE identity = ?'),
    getByHostname: db.prepare('SELECT * FROM dns_records WHERE hostname = ?'),
    insert: db.prepare(`
      INSERT INTO dns_records (identity, hostname, port, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    update: db.prepare(`
      UPDATE dns_records SET hostname = ?, port = ?, updated_at = ? WHERE identity = ?
    `),
    deleteByIdentity: db.prepare('DELETE FROM dns_records WHERE identity = ?'),
    listAll: db.prepare('SELECT * FROM dns_records ORDER BY created_at DESC LIMIT ?'),
    listByPattern: db.prepare('SELECT * FROM dns_records WHERE identity LIKE ? ORDER BY created_at DESC LIMIT ?'),
    countAll: db.prepare('SELECT COUNT(*) as count FROM dns_records'),
    deleteStale: db.prepare(`
      DELETE FROM dns_records WHERE identity NOT IN (SELECT id FROM services)
    `),
  };

  function formatRecord(row: DnsRecordRow) {
    return {
      identity: row.identity,
      hostname: row.hostname,
      port: row.port,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Activity logging (optional -- injected via setActivityLog)
  // ---------------------------------------------------------------------------

  let activityLog: ActivityLogger | null = null;
  let resolver: Resolver | null = null;

  function setActivityLog(logger: ActivityLogger): void {
    activityLog = logger;
  }

  function setResolver(r: Resolver): void {
    resolver = r;
  }

  /**
   * Safely call resolver — if it fails, log warning but don't break DNS operation.
   */
  function resolverAdd(hostname: string): void {
    if (!resolver || !resolver.isSetUp()) return;
    try {
      resolver.addEntry(hostname);
    } catch (err) {
      // Resolver failure should never break DNS operations
      if (activityLog) {
        activityLog.log(ActivityType.DNS_REGISTER, {
          details: `Resolver addEntry failed for ${hostname}: ${(err as Error).message}`,
          metadata: { hostname, error: (err as Error).message },
        });
      }
    }
  }

  function resolverRemove(hostname: string): void {
    if (!resolver || !resolver.isSetUp()) return;
    try {
      resolver.removeEntry(hostname);
    } catch (err) {
      if (activityLog) {
        activityLog.log(ActivityType.DNS_UNREGISTER, {
          details: `Resolver removeEntry failed for ${hostname}: ${(err as Error).message}`,
          metadata: { hostname, error: (err as Error).message },
        });
      }
    }
  }

  function resolverSync(): void {
    if (!resolver || !resolver.isSetUp()) return;
    try {
      resolver.sync();
    } catch (err) {
      if (activityLog) {
        activityLog.log(ActivityType.DNS_CLEANUP, {
          details: `Resolver sync failed: ${(err as Error).message}`,
          metadata: { error: (err as Error).message },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Bonjour status (mocked -- bonjour-service is not installed)
  // ---------------------------------------------------------------------------

  const bonjourAvailable = false;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Register a DNS record for a service identity.
   */
  function register(identity: string, options: RegisterOptions) {
    if (!identity || typeof identity !== 'string') {
      return { success: false, error: 'identity must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const trimmedIdentity = identity.trim();
    if (!trimmedIdentity) {
      return { success: false, error: 'identity must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    if (typeof options.port !== 'number' || options.port < 1 || options.port > 65535) {
      return { success: false, error: 'port must be a number between 1 and 65535', code: 'VALIDATION_ERROR' };
    }

    // Determine hostname
    let hostname: string;
    if (options.hostname) {
      const validation = validateHostname(options.hostname);
      if (!validation.valid) {
        return { success: false, error: validation.error, code: 'VALIDATION_ERROR' };
      }
      hostname = options.hostname.toLowerCase();
    } else {
      hostname = identityToHostname(trimmedIdentity);
    }

    const now = Date.now();

    // Check if identity already has a record
    const existing = stmts.getByIdentity.get(trimmedIdentity) as DnsRecordRow | undefined;
    if (existing) {
      // Update existing record
      stmts.update.run(hostname, options.port, now, trimmedIdentity);

      if (activityLog) {
        activityLog.log(ActivityType.DNS_REGISTER, {
          details: `DNS updated: ${hostname} -> port ${options.port}`,
          metadata: { identity: trimmedIdentity, hostname, port: options.port, updated: true },
        });
      }

      resolverAdd(hostname);

      return {
        success: true,
        identity: trimmedIdentity,
        hostname,
        port: options.port,
        updated: true,
        bonjourAdvertised: bonjourAvailable,
      };
    }

    // Check hostname uniqueness
    const hostnameConflict = stmts.getByHostname.get(hostname) as DnsRecordRow | undefined;
    if (hostnameConflict) {
      return {
        success: false,
        error: `hostname "${hostname}" is already in use by "${hostnameConflict.identity}"`,
        code: 'HOSTNAME_CONFLICT',
      };
    }

    // Insert new record
    try {
      stmts.insert.run(trimmedIdentity, hostname, options.port, now, now);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    resolverAdd(hostname);

    if (activityLog) {
      activityLog.log(ActivityType.DNS_REGISTER, {
        details: `DNS registered: ${hostname} -> port ${options.port}`,
        metadata: { identity: trimmedIdentity, hostname, port: options.port },
      });
    }

    return {
      success: true,
      identity: trimmedIdentity,
      hostname,
      port: options.port,
      updated: false,
      bonjourAdvertised: bonjourAvailable,
    };
  }

  /**
   * Unregister a DNS record for an identity.
   */
  function unregister(identity: string) {
    if (!identity || typeof identity !== 'string') {
      return { success: false, error: 'identity must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const trimmedIdentity = identity.trim();
    if (!trimmedIdentity) {
      return { success: false, error: 'identity must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const existing = stmts.getByIdentity.get(trimmedIdentity) as DnsRecordRow | undefined;
    if (!existing) {
      return { success: false, error: 'DNS record not found', code: 'NOT_FOUND' };
    }

    stmts.deleteByIdentity.run(trimmedIdentity);

    resolverRemove(existing.hostname);

    if (activityLog) {
      activityLog.log(ActivityType.DNS_UNREGISTER, {
        details: `DNS unregistered: ${existing.hostname}`,
        metadata: { identity: trimmedIdentity, hostname: existing.hostname },
      });
    }

    return {
      success: true,
      identity: trimmedIdentity,
      hostname: existing.hostname,
    };
  }

  /**
   * List all DNS records, optionally filtered by pattern.
   */
  function list(options: ListOptions = {}) {
    const { pattern, limit = 100 } = options;

    let records: DnsRecordRow[];
    if (pattern) {
      // Convert glob pattern to SQL LIKE: * -> %
      const likePattern = pattern.replace(/\*/g, '%');
      records = stmts.listByPattern.all(likePattern, limit) as DnsRecordRow[];
    } else {
      records = stmts.listAll.all(limit) as DnsRecordRow[];
    }

    return {
      success: true,
      records: records.map(formatRecord),
      count: records.length,
    };
  }

  /**
   * Lookup a DNS record by hostname.
   */
  function lookup(hostname: string) {
    if (!hostname || typeof hostname !== 'string') {
      return { success: false, error: 'hostname must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const record = stmts.getByHostname.get(hostname.toLowerCase()) as DnsRecordRow | undefined;
    if (!record) {
      return { success: false, error: 'DNS record not found', code: 'NOT_FOUND' };
    }

    return {
      success: true,
      record: formatRecord(record),
    };
  }

  /**
   * Get a DNS record by identity.
   */
  function get(identity: string) {
    if (!identity || typeof identity !== 'string') {
      return { success: false, error: 'identity must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const record = stmts.getByIdentity.get(identity) as DnsRecordRow | undefined;
    if (!record) {
      return { success: false, error: 'DNS record not found', code: 'NOT_FOUND' };
    }

    return {
      success: true,
      record: formatRecord(record),
    };
  }

  /**
   * Remove stale DNS records (for identities with no active service).
   */
  function cleanup() {
    // Check if services table exists before trying to clean up
    let result;
    try {
      result = stmts.deleteStale.run();
    } catch {
      // services table might not exist in test env
      result = { changes: 0 };
    }
    const cleaned = result.changes;

    if (cleaned > 0) {
      resolverSync();
    }

    if (activityLog && cleaned > 0) {
      activityLog.log(ActivityType.DNS_CLEANUP, {
        details: `DNS cleanup: removed ${cleaned} stale record(s)`,
        metadata: { cleaned },
      });
    }

    return { success: true, cleaned };
  }

  /**
   * Get DNS system status.
   */
  function status() {
    const countResult = stmts.countAll.get() as { count: number };

    return {
      success: true,
      bonjourAvailable,
      recordCount: countResult.count,
    };
  }

  return {
    register,
    unregister,
    list,
    lookup,
    get,
    cleanup,
    status,
    setActivityLog,
    setResolver,
    // Exported for testing
    identityToHostname,
    validateHostname,
  };
}
