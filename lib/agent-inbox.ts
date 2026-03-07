/**
 * Agent Inbox System
 *
 * Per-agent message inbox for direct messaging between agents.
 * Registration is the cost of being addressable.
 *
 * - Any caller can send to any registered agent's inbox
 * - Only the owning agent can read/clear its own inbox
 * - Unregistered agents can broadcast via pub/sub but cannot receive DMs
 */

import type Database from 'better-sqlite3';

export interface InboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  content: string;
  type: string;
  read: boolean;
  createdAt: number;
}

interface InboxRow {
  id: number;
  agent_id: string;
  from_agent: string | null;
  content: string;
  type: string;
  read: number;
  created_at: number;
}

interface SendOptions {
  from?: string;
  type?: string;
}

interface ListOptions {
  unreadOnly?: boolean;
  limit?: number;
  since?: number;
}

const MAX_INBOX_MESSAGES = 1000;

export function createAgentInbox(db: Database.Database) {
  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      from_agent TEXT,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'message',
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_inbox_agent ON agent_inbox(agent_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_inbox_unread ON agent_inbox(agent_id) WHERE read = 0`);

  const stmts = {
    send: db.prepare(`
      INSERT INTO agent_inbox (agent_id, from_agent, content, type, read, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `),
    list: db.prepare(`
      SELECT * FROM agent_inbox WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
    `),
    listUnread: db.prepare(`
      SELECT * FROM agent_inbox WHERE agent_id = ? AND read = 0 ORDER BY created_at DESC LIMIT ?
    `),
    listSince: db.prepare(`
      SELECT * FROM agent_inbox WHERE agent_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?
    `),
    markRead: db.prepare(`UPDATE agent_inbox SET read = 1 WHERE agent_id = ? AND id = ?`),
    markAllRead: db.prepare(`UPDATE agent_inbox SET read = 1 WHERE agent_id = ?`),
    clear: db.prepare(`DELETE FROM agent_inbox WHERE agent_id = ?`),
    count: db.prepare(`SELECT COUNT(*) as count FROM agent_inbox WHERE agent_id = ?`),
    countUnread: db.prepare(`SELECT COUNT(*) as count FROM agent_inbox WHERE agent_id = ? AND read = 0`),
    deleteOld: db.prepare(`DELETE FROM agent_inbox WHERE created_at < ?`),
  };

  function formatMessage(row: InboxRow): InboxMessage {
    return {
      id: row.id,
      agentId: row.agent_id,
      from: row.from_agent,
      content: row.content,
      type: row.type,
      read: row.read === 1,
      createdAt: row.created_at,
    };
  }

  return {
    /**
     * Send a message to an agent's inbox
     * Anyone can send (you don't need to be registered)
     */
    send(agentId: string, content: string, options: SendOptions = {}) {
      if (!agentId || !content) {
        return { success: false, error: 'agentId and content required' };
      }

      // Enforce inbox size limit
      const currentCount = (stmts.count.get(agentId) as { count: number }).count;
      if (currentCount >= MAX_INBOX_MESSAGES) {
        return {
          success: false,
          error: `Inbox full (${MAX_INBOX_MESSAGES} messages). Clear old messages first.`,
          code: 'RESOURCE_LIMIT',
        };
      }

      const { from = null, type = 'message' } = options;
      const now = Date.now();

      try {
        const result = stmts.send.run(agentId, from, content, type, now);
        return {
          success: true,
          messageId: Number(result.lastInsertRowid),
          agentId,
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },

    /**
     * Read messages from an agent's inbox
     * Only the owning agent should call this
     */
    list(agentId: string, options: ListOptions = {}) {
      const { unreadOnly = false, limit = 50, since } = options;

      let rows: InboxRow[];
      if (since) {
        rows = stmts.listSince.all(agentId, since, limit) as InboxRow[];
      } else if (unreadOnly) {
        rows = stmts.listUnread.all(agentId, limit) as InboxRow[];
      } else {
        rows = stmts.list.all(agentId, limit) as InboxRow[];
      }

      return {
        success: true,
        messages: rows.map(formatMessage),
        count: rows.length,
      };
    },

    /**
     * Mark a message as read
     */
    markRead(agentId: string, messageId: number) {
      stmts.markRead.run(agentId, messageId);
      return { success: true };
    },

    /**
     * Mark all messages as read
     */
    markAllRead(agentId: string) {
      const result = stmts.markAllRead.run(agentId);
      return { success: true, marked: result.changes };
    },

    /**
     * Clear inbox
     */
    clear(agentId: string) {
      const result = stmts.clear.run(agentId);
      return { success: true, deleted: result.changes };
    },

    /**
     * Get inbox stats
     */
    stats(agentId: string) {
      const total = (stmts.count.get(agentId) as { count: number }).count;
      const unread = (stmts.countUnread.get(agentId) as { count: number }).count;
      return { success: true, total, unread };
    },

    /**
     * Cleanup old messages (older than given ms)
     */
    cleanup(olderThan: number = 7 * 24 * 60 * 60 * 1000) {
      const cutoff = Date.now() - olderThan;
      const result = stmts.deleteOld.run(cutoff);
      return { cleaned: result.changes };
    },

    MAX_INBOX_MESSAGES,
  };
}
