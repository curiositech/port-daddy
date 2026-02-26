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

export interface StaleAgent {
  id: string;
  name: string;
  purpose: string | null;
  sessionId: string | null;
  lastHeartbeat: number;
  staleSince: number;
  status: 'stale' | 'dead' | 'resurrecting';
  notes?: string[];
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
}

export interface ResurrectionEvents {
  'agent:stale': (agent: StaleAgent) => void;
  'agent:dead': (agent: StaleAgent) => void;
  'agent:resurrecting': (agent: StaleAgent) => void;
  'agent:resurrected': (agentId: string, newAgentId: string) => void;
}

export function createResurrection(db: Database.Database) {
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
      metadata TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_resurrection_status ON resurrection_queue(status)`);

  const stmts = {
    queue: db.prepare(`
      INSERT OR REPLACE INTO resurrection_queue
      (agent_id, agent_name, session_id, purpose, detected_at, status, resurrection_attempts, last_attempt_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    get: db.prepare(`SELECT * FROM resurrection_queue WHERE agent_id = ?`),
    listPending: db.prepare(`
      SELECT * FROM resurrection_queue WHERE status = 'pending' ORDER BY detected_at ASC
    `),
    listAll: db.prepare(`SELECT * FROM resurrection_queue ORDER BY detected_at DESC LIMIT ?`),
    updateStatus: db.prepare(`
      UPDATE resurrection_queue SET status = ?, last_attempt_at = ?, resurrection_attempts = resurrection_attempts + 1
      WHERE agent_id = ?
    `),
    remove: db.prepare(`DELETE FROM resurrection_queue WHERE agent_id = ?`),
    cleanup: db.prepare(`DELETE FROM resurrection_queue WHERE detected_at < ?`),
  };

  const emitter = new EventEmitter();

  // Heartbeat thresholds — tuned for typical agentic task distribution
  // Stale: Agent hasn't checked in, might be deep in thought or stuck
  // Dead: Agent is definitely gone, work should be salvaged
  const STALE_THRESHOLD = 10 * 60 * 1000;  // 10 minutes
  const DEAD_THRESHOLD = 20 * 60 * 1000;   // 20 minutes

  function formatQueueEntry(row: ResurrectionQueueRow): StaleAgent {
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      id: row.agent_id,
      name: row.agent_name,
      purpose: row.purpose,
      sessionId: row.session_id,
      lastHeartbeat: metadata.lastHeartbeat || 0,
      staleSince: row.detected_at,
      status: row.status as 'stale' | 'dead' | 'resurrecting',
      notes: metadata.notes,
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
    }) {
      const now = Date.now();
      const sinceHeartbeat = now - agent.lastHeartbeat;

      if (sinceHeartbeat < STALE_THRESHOLD) {
        // Agent is healthy, remove from queue if present
        stmts.remove.run(agent.id);
        return { status: 'healthy' };
      }

      const existing = stmts.get.get(agent.id) as ResurrectionQueueRow | undefined;
      const status = sinceHeartbeat >= DEAD_THRESHOLD ? 'dead' : 'stale';

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
          metadata
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
     */
    pending() {
      const rows = stmts.listPending.all() as ResurrectionQueueRow[];
      return {
        success: true,
        agents: rows.map(formatQueueEntry),
        count: rows.length,
      };
    },

    /**
     * List all queue entries
     */
    list(limit: number = 50) {
      const rows = stmts.listAll.all(limit) as ResurrectionQueueRow[];
      return {
        success: true,
        agents: rows.map(formatQueueEntry),
        count: rows.length,
      };
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

      return {
        success: true,
        agent: formatQueueEntry(row),
        context: {
          sessionId: row.session_id,
          purpose: row.purpose,
          notes: row.metadata ? JSON.parse(row.metadata).notes : [],
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
  };
}
