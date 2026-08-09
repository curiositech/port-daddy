/**
 * Agent Resurrection System
 *
 * Self-healing for agents:
 * - Detects stale/failed agents (missed heartbeats, errors)
 * - Queues them for resurrection
 * - Publishes to the radio for other agents to pick up work
 * - Auto-publishes changelogs of unfinished work
 *
 * "What's dead may never die, but rises again harder and stronger."
 */

import type Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import { patternToSql } from './identity.js';
import { getDeadThresholdForStatus, getStaleThresholdForStatus } from './agents.js';

export type SalvageQueueStatus = 'pending' | 'stale' | 'dead' | 'resurrecting';

export interface StaleAgent {
  id: string;
  name: string;
  purpose: string | null;
  sessionId: string | null;
  lastHeartbeat: number;
  staleSince: number;
  status: SalvageQueueStatus;
  notes?: string[];
  // Semantic identity components for prefix filtering
  identityProject: string | null;
  identityStack: string | null;
  identityContext: string | null;
}

interface ResurrectionQueueRow {
  id: number;
  agent_id: string;
  agent_name: string;
  session_id: string | null;
  purpose: string | null;
  detected_at: number;
  status: string;
  resurrection_attempts: number;
  last_attempt_at: number | null;
  metadata: string | null;
  // Semantic identity components for prefix filtering
  identity_project: string | null;
  identity_stack: string | null;
  identity_context: string | null;
}

export interface ResurrectionEvents {
  'agent:stale': (agent: StaleAgent) => void;
  'agent:dead': (agent: StaleAgent) => void;
  'agent:resurrecting': (agent: StaleAgent) => void;
  'agent:resurrected': (agentId: string, newAgentId: string) => void;
}

interface ResurrectionSessions {
  getNotes(sessionId?: string | null, options?: { limit?: number }): {
    success: boolean;
    notes?: Array<{ content?: unknown }>;
  };
}

interface ResurrectionDeps {
  sessions?: ResurrectionSessions;
  noteLimit?: number;
}

interface QueueMetadata {
  lastHeartbeat?: number;
  notes?: unknown;
  /**
   * Self-salvage capsule persisted by the dying agent (`pd done --self-salvage`).
   * ATTACKER-CONTROLLABLE: written by the agent itself, so it is respawn CONTEXT only
   * and must NEVER be read as an authorization scope. See server.ts agent:dead handler.
   */
  salvageCapsule?: Record<string, unknown>;
}

export function createResurrection(db: Database.Database, deps: ResurrectionDeps = {}) {
  // Schema for resurrection queue
  db.exec(`
    CREATE TABLE IF NOT EXISTS resurrection_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL UNIQUE,
      agent_name TEXT NOT NULL,
      session_id TEXT,
      purpose TEXT,
      detected_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resurrection_attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,
      metadata TEXT,
      identity_project TEXT,
      identity_stack TEXT,
      identity_context TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_resurrection_status ON resurrection_queue(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_resurrection_project ON resurrection_queue(identity_project)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_resurrection_project_stack ON resurrection_queue(identity_project, identity_stack)`);

  // Migrations for existing tables
  const migrations = [
    'ALTER TABLE resurrection_queue ADD COLUMN identity_project TEXT',
    'ALTER TABLE resurrection_queue ADD COLUMN identity_stack TEXT',
    'ALTER TABLE resurrection_queue ADD COLUMN identity_context TEXT',
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists
    }
  }

  const stmts = {
    queue: db.prepare(`
      INSERT OR REPLACE INTO resurrection_queue
      (agent_id, agent_name, session_id, purpose, detected_at, status, resurrection_attempts, last_attempt_at, metadata, identity_project, identity_stack, identity_context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    get: db.prepare(`SELECT * FROM resurrection_queue WHERE agent_id = ?`),
    listPending: db.prepare(`
      SELECT * FROM resurrection_queue WHERE status = 'pending' ORDER BY detected_at ASC
    `),
    listPendingByProject: db.prepare(`
      SELECT * FROM resurrection_queue WHERE status = 'pending' AND identity_project = ? ORDER BY detected_at ASC
    `),
    listPendingByProjectStack: db.prepare(`
      SELECT * FROM resurrection_queue WHERE status = 'pending' AND identity_project = ? AND identity_stack = ? ORDER BY detected_at ASC
    `),
    listAll: db.prepare(`SELECT * FROM resurrection_queue ORDER BY detected_at DESC LIMIT ?`),
    listAllByProject: db.prepare(`
      SELECT * FROM resurrection_queue WHERE identity_project = ? ORDER BY detected_at DESC LIMIT ?
    `),
    listAllByProjectStack: db.prepare(`
      SELECT * FROM resurrection_queue WHERE identity_project = ? AND identity_stack = ? ORDER BY detected_at DESC LIMIT ?
    `),
    listPendingByPattern: db.prepare(`
      SELECT * FROM resurrection_queue 
      WHERE status = 'pending' AND (
        identity_project || 
        CASE WHEN identity_stack IS NOT NULL THEN ':' || identity_stack ELSE '' END || 
        CASE WHEN identity_context IS NOT NULL THEN ':' || identity_context ELSE '' END
      ) LIKE ? ESCAPE '\\'
      ORDER BY detected_at ASC
    `),
    listAllByPattern: db.prepare(`
      SELECT * FROM resurrection_queue 
      WHERE (
        identity_project || 
        CASE WHEN identity_stack IS NOT NULL THEN ':' || identity_stack ELSE '' END || 
        CASE WHEN identity_context IS NOT NULL THEN ':' || identity_context ELSE '' END
      ) LIKE ? ESCAPE '\\'
      ORDER BY detected_at DESC LIMIT ?
    `),
    updateStatus: db.prepare(`
      UPDATE resurrection_queue SET status = ?, last_attempt_at = ?, resurrection_attempts = resurrection_attempts + 1
      WHERE agent_id = ?
    `),
    remove: db.prepare(`DELETE FROM resurrection_queue WHERE agent_id = ?`),
    setMetadata: db.prepare(`UPDATE resurrection_queue SET metadata = ? WHERE agent_id = ?`),
    cleanup: db.prepare(`DELETE FROM resurrection_queue WHERE detected_at < ?`),
    countByProject: db.prepare(`SELECT COUNT(*) as count FROM resurrection_queue WHERE status = 'pending' AND identity_project = ?`),
  };

  const emitter = new EventEmitter();

  // Adaptive thresholds by agent status — imported from lib/agents.ts, the single
  // source of truth for the dead/stale ladder. Previously resurrection defined its
  // own legacy 20m/30m ladder, which disagreed with the live reaper's ~4h ladder in
  // agents.cleanup(). Aliased locally to preserve this module's call sites.
  const getDeadThreshold = getDeadThresholdForStatus;
  const getStaleThreshold = getStaleThresholdForStatus;

  // Fixed thresholds for the default/ready status (exposed for testing/config)
  const STALE_THRESHOLD = getStaleThreshold('ready');
  const DEAD_THRESHOLD = getDeadThreshold('ready');
  const noteLimit = deps.noteLimit ?? 200;

  function parseMetadata(metadata: string | null): QueueMetadata {
    if (!metadata) return {};

    try {
      const parsed: unknown = JSON.parse(metadata);
      if (parsed && typeof parsed === 'object') {
        return parsed as QueueMetadata;
      }
    } catch {
      // Corrupt metadata should not make salvage unusable.
    }

    return {};
  }

  function normalizeNotes(notes: unknown): string[] {
    if (!Array.isArray(notes)) return [];
    return notes
      .filter((note) => note !== null && note !== undefined)
      .map((note) => typeof note === 'string' ? note : String(note));
  }

  function notesForRow(row: ResurrectionQueueRow, metadata: QueueMetadata): string[] {
    const fallback = normalizeNotes(metadata.notes);
    if (!row.session_id || !deps.sessions) return fallback;

    try {
      const result = deps.sessions.getNotes(row.session_id, { limit: noteLimit });
      if (!result.success || !Array.isArray(result.notes)) return fallback;

      const liveNotes = result.notes
        .map((note) => note.content)
        .filter((content) => content !== null && content !== undefined)
        .map((content) => typeof content === 'string' ? content : String(content));

      return liveNotes.length > 0 ? liveNotes : fallback;
    } catch {
      return fallback;
    }
  }

  function applyLimit<T>(rows: T[], limit?: number): T[] {
    if (!Number.isFinite(limit) || !limit || limit <= 0) return rows;
    return rows.slice(0, Math.floor(limit));
  }

  function formatQueueEntry(row: ResurrectionQueueRow): StaleAgent {
    const metadata = parseMetadata(row.metadata);
    return {
      id: row.agent_id,
      name: row.agent_name,
      purpose: row.purpose,
      sessionId: row.session_id,
      lastHeartbeat: metadata.lastHeartbeat || 0,
      staleSince: row.detected_at,
      status: row.status as SalvageQueueStatus,
      notes: notesForRow(row, metadata),
      identityProject: row.identity_project,
      identityStack: row.identity_stack,
      identityContext: row.identity_context,
    };
  }

  return {
    /**
     * Check an agent and queue it for resurrection if stale/dead
     */
    check(agent: {
      id: string;
      name: string;
      purpose?: string;
      sessionId?: string;
      lastHeartbeat: number;
      notes?: string[];
      status?: string;
      // Semantic identity components for context-aware filtering
      identityProject?: string;
      identityStack?: string;
      identityContext?: string;
    }) {
      const now = Date.now();
      const sinceHeartbeat = now - agent.lastHeartbeat;

      // Use adaptive thresholds based on agent status
      const agentStaleThreshold = getStaleThreshold(agent.status);
      const agentDeadThreshold = getDeadThreshold(agent.status);

      if (sinceHeartbeat < agentStaleThreshold) {
        // Agent is healthy, remove from queue if present
        stmts.remove.run(agent.id);
        return { status: 'healthy' };
      }

      const existing = stmts.get.get(agent.id) as ResurrectionQueueRow | undefined;
      const status = sinceHeartbeat >= agentDeadThreshold ? 'dead' : 'stale';

      const metadata = JSON.stringify({
        lastHeartbeat: agent.lastHeartbeat,
        notes: agent.notes,
      });

      if (!existing) {
        // New entry
        stmts.queue.run(
          agent.id,
          agent.name,
          agent.sessionId || null,
          agent.purpose || null,
          now,
          status === 'dead' ? 'pending' : 'stale',
          0,
          null,
          metadata,
          agent.identityProject || null,
          agent.identityStack || null,
          agent.identityContext || null
        );

        const staleAgent = formatQueueEntry(stmts.get.get(agent.id) as ResurrectionQueueRow);

        if (status === 'dead') {
          emitter.emit('agent:dead', staleAgent);
        } else {
          emitter.emit('agent:stale', staleAgent);
        }

        return { status, queued: true };
      }

      // Update existing entry if status changed
      if (existing.status === 'stale' && status === 'dead') {
        stmts.updateStatus.run('pending', now, agent.id);
        emitter.emit('agent:dead', formatQueueEntry(stmts.get.get(agent.id) as ResurrectionQueueRow));
      }

      return { status, queued: existing.status === 'pending' };
    },

    /**
     * Get pending resurrections
     * Filters by identity prefix if provided (project or project:stack)
     */
    pending(options: { project?: string; stack?: string; limit?: number } = {}) {
      let rows: ResurrectionQueueRow[];

      if (options.project?.includes('*') || options.stack?.includes('*')) {
        const pattern = options.project + (options.stack ? ':' + options.stack : '');
        const sqlPattern = patternToSql(pattern);
        rows = stmts.listPendingByPattern.all(sqlPattern) as ResurrectionQueueRow[];
      } else if (options.project && options.stack) {
        rows = stmts.listPendingByProjectStack.all(options.project, options.stack) as ResurrectionQueueRow[];
      } else if (options.project) {
        rows = stmts.listPendingByProject.all(options.project) as ResurrectionQueueRow[];
      } else {
        rows = stmts.listPending.all() as ResurrectionQueueRow[];
      }
      const limitedRows = applyLimit(rows, options.limit);

      return {
        success: true,
        agents: limitedRows.map(formatQueueEntry),
        count: limitedRows.length,
        filtered: !!options.project,
      };
    },

    /**
     * List all queue entries
     * Filters by identity prefix if provided (project or project:stack)
     */
    list(options: { limit?: number; project?: string; stack?: string } = {}) {
      const limit = options.limit ?? 50;
      let rows: ResurrectionQueueRow[];

      if (options.project?.includes('*') || options.stack?.includes('*')) {
        const pattern = options.project + (options.stack ? ':' + options.stack : '');
        const sqlPattern = patternToSql(pattern);
        rows = stmts.listAllByPattern.all(sqlPattern, limit) as ResurrectionQueueRow[];
      } else if (options.project && options.stack) {
        rows = stmts.listAllByProjectStack.all(options.project, options.stack, limit) as ResurrectionQueueRow[];
      } else if (options.project) {
        rows = stmts.listAllByProject.all(options.project, limit) as ResurrectionQueueRow[];
      } else {
        rows = stmts.listAll.all(limit) as ResurrectionQueueRow[];
      }

      return {
        success: true,
        agents: rows.map(formatQueueEntry),
        count: rows.length,
        filtered: !!options.project,
      };
    },

    /**
     * Count pending resurrections in a project
     * Used for salvage hints during agent registration
     */
    countByProject(project: string) {
      const row = stmts.countByProject.get(project) as { count: number };
      return row.count;
    },

    /**
     * Claim an agent for resurrection
     * Returns the agent's context so a new agent can continue their work
     */
    claim(agentId: string) {
      const row = stmts.get.get(agentId) as ResurrectionQueueRow | undefined;
      if (!row) {
        return { success: false, error: 'Agent not in resurrection queue' };
      }

      if (row.status !== 'pending') {
        return { success: false, error: `Agent status is ${row.status}, not pending` };
      }

      stmts.updateStatus.run('resurrecting', Date.now(), agentId);
      emitter.emit('agent:resurrecting', formatQueueEntry(stmts.get.get(agentId) as ResurrectionQueueRow));

      const metadata = parseMetadata(row.metadata);
      return {
        success: true,
        agent: formatQueueEntry(row),
        context: {
          sessionId: row.session_id,
          purpose: row.purpose,
          notes: notesForRow(row, metadata),
        },
      };
    },

    /**
     * Mark resurrection as complete
     */
    complete(oldAgentId: string, newAgentId: string) {
      stmts.remove.run(oldAgentId);
      emitter.emit('agent:resurrected', oldAgentId, newAgentId);
      return { success: true };
    },

    /**
     * Abandon a resurrection attempt
     */
    abandon(agentId: string) {
      stmts.updateStatus.run('pending', Date.now(), agentId);
      return { success: true };
    },

    /**
     * Dismiss an agent from the queue (user reviewed, not resurrecting)
     */
    dismiss(agentId: string) {
      stmts.remove.run(agentId);
      return { success: true };
    },

    /**
     * Persist a self-salvage capsule for a queued agent by merging it into the row's
     * metadata JSON. Additive: no existing metadata field is touched. The capsule is
     * the dying agent's own payload (untrusted) — it is stored as respawn context and
     * must never be treated as identity by the reader. Returns `false` when the agent
     * is not in the queue (nothing to attach to).
     */
    attachSalvageCapsule(agentId: string, capsule: Record<string, unknown>): { success: boolean; error?: string } {
      const row = stmts.get.get(agentId) as ResurrectionQueueRow | undefined;
      if (!row) return { success: false, error: 'Agent not in resurrection queue' };
      const metadata = parseMetadata(row.metadata);
      const merged: QueueMetadata = { ...metadata, salvageCapsule: capsule };
      stmts.setMetadata.run(JSON.stringify(merged), agentId);
      return { success: true };
    },

    /**
     * Read back a previously attached self-salvage capsule, or `undefined` if none.
     * Corrupt metadata degrades to `undefined` (parseMetadata never throws).
     */
    getSalvageCapsule(agentId: string): Record<string, unknown> | undefined {
      const row = stmts.get.get(agentId) as ResurrectionQueueRow | undefined;
      if (!row) return undefined;
      const capsule = parseMetadata(row.metadata).salvageCapsule;
      return capsule && typeof capsule === 'object' ? capsule : undefined;
    },

    /**
     * Cleanup old entries
     */
    cleanup(olderThan: number = 7 * 24 * 60 * 60 * 1000) {
      const cutoff = Date.now() - olderThan;
      const result = stmts.cleanup.run(cutoff);
      return { cleaned: result.changes };
    },

    /**
     * Event emitter for resurrection events
     */
    on<K extends keyof ResurrectionEvents>(event: K, listener: ResurrectionEvents[K]) {
      emitter.on(event, listener as (...args: unknown[]) => void);
    },

    /**
     * Thresholds (exposed for testing/config)
     */
    thresholds: {
      stale: STALE_THRESHOLD,
      dead: DEAD_THRESHOLD,
    },

    getDeadThreshold,
    getStaleThreshold,
  };
}
