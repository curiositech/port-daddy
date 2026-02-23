/**
 * Activity Log Module
 *
 * Audit trail of all Port Daddy operations
 * Pure SQLite - no shell commands
 */

import type Database from 'better-sqlite3';

const MAX_LOG_ENTRIES = 10000;  // Keep last 10k entries
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

/**
 * Activity types
 */
export const ActivityType = {
  // Service operations
  SERVICE_CLAIM: 'service.claim',
  SERVICE_RELEASE: 'service.release',
  SERVICE_STATUS_CHANGE: 'service.status',

  // Lock operations
  LOCK_ACQUIRE: 'lock.acquire',
  LOCK_RELEASE: 'lock.release',
  LOCK_EXPIRE: 'lock.expire',

  // Agent operations
  AGENT_REGISTER: 'agent.register',
  AGENT_HEARTBEAT: 'agent.heartbeat',
  AGENT_UNREGISTER: 'agent.unregister',
  AGENT_CLEANUP: 'agent.cleanup',

  // Messaging
  MESSAGE_PUBLISH: 'message.publish',

  // System
  DAEMON_START: 'daemon.start',
  DAEMON_STOP: 'daemon.stop',
  CLEANUP: 'cleanup'
} as const;

interface LogOptions {
  agentId?: string | null;
  targetId?: string | null;
  details?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface LogResult {
  success: boolean;
  timestamp?: number;
  error?: string;
}

interface ActivityRow {
  id: number;
  timestamp: number;
  type: string;
  agent_id: string | null;
  target_id: string | null;
  details: string | null;
  metadata: string | null;
}

interface ActivityEntryFormatted {
  id: number;
  timestamp: number;
  type: string;
  agentId: string | null;
  targetId: string | null;
  details: string | null;
  metadata: Record<string, unknown> | null;
}

interface GetRecentOptions {
  limit?: number;
  type?: string | null;
  agentId?: string | null;
  targetPattern?: string | null;
}

interface GetRecentResult {
  success: true;
  entries: ActivityEntryFormatted[];
  count: number;
}

interface GetByTimeRangeOptions {
  limit?: number;
}

interface GetByTimeRangeResult {
  success: true;
  entries: ActivityEntryFormatted[];
  count: number;
  timeRange: { start: number; end: number };
}

interface SummaryResult {
  success: true;
  summary: Record<string, number>;
  total: number;
  since: number;
}

interface CleanupResult {
  deletedOld: number;
  deletedExcess: number;
  total: number;
}

interface StatsResult {
  success: true;
  stats: {
    totalEntries: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    retentionMs: number;
    maxEntries: number;
  };
}

/**
 * Initialize activity log with database connection
 */
function safeJsonParse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createActivityLog(db: Database.Database) {
  // Ensure activity table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      agent_id TEXT,
      target_id TEXT,
      details TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(type);
    CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_log(agent_id);
    CREATE INDEX IF NOT EXISTS idx_activity_target ON activity_log(target_id);
  `);

  const stmts = {
    insert: db.prepare(`
      INSERT INTO activity_log (timestamp, type, agent_id, target_id, details, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    getRecent: db.prepare(`
      SELECT * FROM activity_log
      ORDER BY timestamp DESC
      LIMIT ?
    `),
    getByType: db.prepare(`
      SELECT * FROM activity_log
      WHERE type = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `),
    getByAgent: db.prepare(`
      SELECT * FROM activity_log
      WHERE agent_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `),
    getByTarget: db.prepare(`
      SELECT * FROM activity_log
      WHERE target_id LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `),
    getByTimeRange: db.prepare(`
      SELECT * FROM activity_log
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
      LIMIT ?
    `),
    count: db.prepare('SELECT COUNT(*) as count FROM activity_log'),
    deleteOld: db.prepare('DELETE FROM activity_log WHERE timestamp < ?'),
    deleteExcess: db.prepare(`
      DELETE FROM activity_log
      WHERE id NOT IN (
        SELECT id FROM activity_log ORDER BY timestamp DESC LIMIT ?
      )
    `)
  };

  /**
   * Log an activity
   */
  function log(type: string, options: LogOptions = {}): LogResult {
    const {
      agentId = null,
      targetId = null,
      details = null,
      metadata = null
    } = options;

    const now = Date.now();

    try {
      stmts.insert.run(
        now,
        type,
        agentId,
        targetId,
        details,
        metadata ? JSON.stringify(metadata) : null
      );

      return { success: true, timestamp: now };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  function formatEntry(e: ActivityRow): ActivityEntryFormatted {
    return {
      id: e.id,
      timestamp: e.timestamp,
      type: e.type,
      agentId: e.agent_id,
      targetId: e.target_id,
      details: e.details,
      metadata: safeJsonParse(e.metadata)
    };
  }

  /**
   * Get recent activity
   */
  function getRecent(options: GetRecentOptions = {}): GetRecentResult {
    const { limit = 100, type = null, agentId = null, targetPattern = null } = options;
    const safeLimit = Math.min(Math.max(1, limit), 1000);

    let entries: ActivityRow[];

    if (type) {
      entries = stmts.getByType.all(type, safeLimit) as ActivityRow[];
    } else if (agentId) {
      entries = stmts.getByAgent.all(agentId, safeLimit) as ActivityRow[];
    } else if (targetPattern) {
      entries = stmts.getByTarget.all(targetPattern.replace(/\*/g, '%'), safeLimit) as ActivityRow[];
    } else {
      entries = stmts.getRecent.all(safeLimit) as ActivityRow[];
    }

    return {
      success: true,
      entries: entries.map(formatEntry),
      count: entries.length
    };
  }

  /**
   * Get activity by time range
   */
  function getByTimeRange(startTime: number, endTime: number, options: GetByTimeRangeOptions = {}): GetByTimeRangeResult {
    const { limit = 1000 } = options;
    const safeLimit = Math.min(Math.max(1, limit), 10000);

    const entries = stmts.getByTimeRange.all(startTime, endTime, safeLimit) as ActivityRow[];

    return {
      success: true,
      entries: entries.map(formatEntry),
      count: entries.length,
      timeRange: { start: startTime, end: endTime }
    };
  }

  /**
   * Get activity summary (counts by type)
   */
  function getSummary(sinceTimestamp = 0): SummaryResult {
    const entries = db.prepare(`
      SELECT type, COUNT(*) as count
      FROM activity_log
      WHERE timestamp >= ?
      GROUP BY type
      ORDER BY count DESC
    `).all(sinceTimestamp) as Array<{ type: string; count: number }>;

    const total = entries.reduce((sum, e) => sum + e.count, 0);

    return {
      success: true,
      summary: entries.reduce((acc: Record<string, number>, e) => {
        acc[e.type] = e.count;
        return acc;
      }, {}),
      total,
      since: sinceTimestamp
    };
  }

  /**
   * Cleanup old entries
   */
  function cleanup(): CleanupResult {
    const now = Date.now();
    const cutoff = now - LOG_RETENTION_MS;

    // Delete old entries
    const oldResult = stmts.deleteOld.run(cutoff);

    // Delete excess entries (keep only MAX_LOG_ENTRIES)
    const excessResult = stmts.deleteExcess.run(MAX_LOG_ENTRIES);

    return {
      deletedOld: oldResult.changes,
      deletedExcess: excessResult.changes,
      total: oldResult.changes + excessResult.changes
    };
  }

  /**
   * Get log stats
   */
  function getStats(): StatsResult {
    const countResult = stmts.count.get() as { count: number };
    const oldest = db.prepare('SELECT MIN(timestamp) as oldest FROM activity_log').get() as { oldest: number | null };
    const newest = db.prepare('SELECT MAX(timestamp) as newest FROM activity_log').get() as { newest: number | null };

    return {
      success: true,
      stats: {
        totalEntries: countResult.count,
        oldestEntry: oldest.oldest,
        newestEntry: newest.newest,
        retentionMs: LOG_RETENTION_MS,
        maxEntries: MAX_LOG_ENTRIES
      }
    };
  }

  // Convenience methods for common operations
  const logService = {
    claim: (serviceId: string, agentId: string, port: number) => log(ActivityType.SERVICE_CLAIM, {
      targetId: serviceId,
      agentId,
      details: `claimed port ${port}`,
      metadata: { port }
    }),
    release: (serviceId: string, agentId: string, port: number) => log(ActivityType.SERVICE_RELEASE, {
      targetId: serviceId,
      agentId,
      details: `released port ${port}`,
      metadata: { port }
    })
  };

  const logLock = {
    acquire: (lockName: string, agentId: string) => log(ActivityType.LOCK_ACQUIRE, {
      targetId: lockName,
      agentId,
      details: `acquired lock`
    }),
    release: (lockName: string, agentId: string) => log(ActivityType.LOCK_RELEASE, {
      targetId: lockName,
      agentId,
      details: `released lock`
    })
  };

  const logAgent = {
    register: (agentId: string) => log(ActivityType.AGENT_REGISTER, {
      agentId,
      details: `agent registered`
    }),
    heartbeat: (agentId: string) => log(ActivityType.AGENT_HEARTBEAT, {
      agentId,
      details: `heartbeat`
    }),
    unregister: (agentId: string) => log(ActivityType.AGENT_UNREGISTER, {
      agentId,
      details: `agent unregistered`
    })
  };

  return {
    log,
    getRecent,
    getByTimeRange,
    getSummary,
    cleanup,
    getStats,
    logService,
    logLock,
    logAgent,
    ActivityType
  };
}
