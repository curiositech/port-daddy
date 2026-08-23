/**
 * Agent Inbox System
 *
 * Per-agent message inbox for direct messaging between agents.
 * Registration is the cost of being addressable.
 *
 * - Any caller can send to any registered agent's inbox, but every send over
 *   HTTP must present a daemon-minted credential and may only be attributed
 *   to a name that credential is entitled to (lib/inbox-identity.ts). This
 *   module is the storage layer and enforces NOTHING itself — the gate lives
 *   in the routes, because in-process senders (parley, visual-task intake,
 *   suggestion-broker, surface-scan, the claim watcher) legitimately call
 *   send() without crossing an HTTP boundary.
 * - Unregistered agents can broadcast via pub/sub but cannot receive DMs
 *
 * NOT TRUE (and previously claimed here): "only the owning agent can
 * read/clear its own inbox". The read, mark-read and clear verbs are still
 * unauthenticated at the route layer. See the "Deferred" row for the inbox
 * plane in docs/security/identity-write-boundary-audit.md.
 */

import type Database from 'better-sqlite3';

export interface InboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  /**
   * The daemon-verified minted actorId behind `from` (#8877 / ADR-0122).
   * Written ONLY by the credentialed route gate (lib/inbox-identity.ts) —
   * never from a request body. null means "daemon-internal sender": one of
   * the in-process writers (parley, visual-task intake, suggestion-broker,
   * surface-scan, the claim watcher) that never crossed the HTTP boundary.
   * It does NOT mean "system", and consumers must not render it as one.
   */
  fromActorId: string | null;
  /** The verified sender's soul class ('newcomer' | 'graduated' | 'operator'). */
  fromSoulClass: string | null;
  content: unknown;
  contentType: string;
  type: string;
  read: boolean;
  readAt: number | null;
  createdAt: number;
}

interface InboxRow {
  id: number;
  agent_id: string;
  from_agent: string | null;
  from_actor_id: string | null;
  from_soul_class: string | null;
  content: string;
  content_type: string;
  type: string;
  read: number;
  read_at: number | null;
  created_at: number;
}

interface SendOptions {
  from?: string;
  /**
   * The daemon's verified verdict for this send. Reserved for the route gate
   * (lib/inbox-identity.ts): a caller cannot reach it, because every HTTP
   * door overwrites it with the gate's verdict before calling send().
   */
  fromActorId?: string | null;
  fromSoulClass?: string | null;
  type?: string;
  contentType?: 'text' | 'json' | 'binary';
  signal?: string;
}

interface ListOptions {
  unreadOnly?: boolean;
  limit?: number;
  since?: number;
}

const MAX_INBOX_MESSAGES = 1000;

export function createAgentInbox(db: Database.Database, onMessage?: (agentId: string, message: InboxMessage) => void) {
  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      from_agent TEXT,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      type TEXT NOT NULL DEFAULT 'message',
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  
  try {
    db.exec('ALTER TABLE agent_inbox ADD COLUMN content_type TEXT NOT NULL DEFAULT "text"');
  } catch { /* already exists */ }

  // read_at: epoch-ms when the recipient first read the message (null = unread).
  // Powers sender-visible read receipts via listSent() / `pd sent`. Stamped on
  // markRead/markAllRead and never overwritten (COALESCE keeps the first read).
  try {
    db.exec('ALTER TABLE agent_inbox ADD COLUMN read_at INTEGER');
  } catch { /* already exists */ }

  // from_actor_id / from_soul_class: the daemon's verified verdict for the
  // sender (#8877 / ADR-0122). `from_agent` is a display string the sender
  // chose; these two are what the daemon PROVED, and only the credentialed
  // route gate writes them. A null pair means a daemon-internal in-process
  // send, which must never be rendered as though a principal wrote it.
  try {
    db.exec('ALTER TABLE agent_inbox ADD COLUMN from_actor_id TEXT');
  } catch { /* already exists */ }
  try {
    db.exec('ALTER TABLE agent_inbox ADD COLUMN from_soul_class TEXT');
  } catch { /* already exists */ }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_inbox_agent ON agent_inbox(agent_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_inbox_unread ON agent_inbox(agent_id) WHERE read = 0`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_inbox_from ON agent_inbox(from_agent, created_at)`);

  const stmts = {
    send: db.prepare(`
      INSERT INTO agent_inbox (agent_id, from_agent, from_actor_id, from_soul_class, content, content_type, type, read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
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
    listSent: db.prepare(`
      SELECT * FROM agent_inbox WHERE from_agent = ? ORDER BY created_at DESC LIMIT ?
    `),
    markRead: db.prepare(`UPDATE agent_inbox SET read = 1, read_at = COALESCE(read_at, ?) WHERE agent_id = ? AND id = ?`),
    markAllRead: db.prepare(`UPDATE agent_inbox SET read = 1, read_at = COALESCE(read_at, ?) WHERE agent_id = ? AND read = 0`),
    clear: db.prepare(`DELETE FROM agent_inbox WHERE agent_id = ?`),
    count: db.prepare(`SELECT COUNT(*) as count FROM agent_inbox WHERE agent_id = ?`),
    countUnread: db.prepare(`SELECT COUNT(*) as count FROM agent_inbox WHERE agent_id = ? AND read = 0`),
    deleteOld: db.prepare(`DELETE FROM agent_inbox WHERE created_at < ?`),
    deleteOldestForAgent: db.prepare(`
      DELETE FROM agent_inbox WHERE id IN (
        SELECT id FROM agent_inbox WHERE agent_id = ? ORDER BY created_at ASC LIMIT ?
      )
    `),
  };

  function formatMessage(row: InboxRow): InboxMessage {
    return {
      id: row.id,
      agentId: row.agent_id,
      from: row.from_agent,
      fromActorId: row.from_actor_id ?? null,
      fromSoulClass: row.from_soul_class ?? null,
      content: row.content_type === 'json' ? safeJsonParse(row.content) : row.content,
      contentType: row.content_type,
      type: row.type,
      read: row.read === 1,
      readAt: row.read_at ?? null,
      createdAt: row.created_at,
    };
  }

  function safeJsonParse(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return {
    /**
     * Send a message to an agent's inbox.
     * Anyone can send (you don't need to be registered).
     * If the inbox exceeds MAX_INBOX_MESSAGES (1000), the oldest messages are evicted.
     */
    send(agentId: string, content: unknown, options: SendOptions = {}) {
      if (!agentId || content === undefined || content === null || content === '') {
        return { success: false, error: 'agentId and content required' };
      }

      // Enforce inbox size limit
      const currentCount = (stmts.count.get(agentId) as { count: number }).count;
      if (currentCount >= MAX_INBOX_MESSAGES) {
        return {
          success: false,
          error: `Inbox full for agent ${agentId} (max ${MAX_INBOX_MESSAGES} messages)`,
          code: 'RESOURCE_LIMIT'
        };
      }

      const { from = null, type = 'message' } = options;
      const fromActorId = typeof options.fromActorId === 'string' && options.fromActorId
        ? options.fromActorId
        : null;
      const fromSoulClass = typeof options.fromSoulClass === 'string' && options.fromSoulClass
        ? options.fromSoulClass
        : null;
      let { contentType } = options;
      const now = Date.now();

      // Determine content type if not provided
      if (!contentType) {
        if (typeof content === 'string') contentType = 'text';
        else if (Buffer.isBuffer(content)) contentType = 'binary';
        else contentType = 'json';
      }

      let contentStr: string;
      if (contentType === 'json') {
        contentStr = typeof content === 'string' ? content : JSON.stringify(content);
      } else if (contentType === 'binary') {
        contentStr = Buffer.isBuffer(content) ? content.toString('base64') : String(content);
      } else {
        contentStr = String(content);
      }

      try {
        const result = stmts.send.run(agentId, from, fromActorId, fromSoulClass, contentStr, contentType, type, now);
        const messageId = Number(result.lastInsertRowid);

        const msg: InboxMessage = {
          id: messageId,
          agentId,
          from,
          fromActorId,
          fromSoulClass,
          content: contentType === 'json' ? safeJsonParse(contentStr) : contentStr,
          contentType: contentType,
          type,
          read: false,
          readAt: null,
          createdAt: now,
        };

        if (onMessage) {
          onMessage(agentId, msg);
        }

        return {
          success: true,
          messageId,
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
     * List messages this agent SENT, each with its read receipt (read + readAt).
     * Powers `pd sent` — the sender side of the inbox. `agentId` on each message
     * is the RECIPIENT; `from` is this sender.
     */
    listSent(fromAgent: string, options: { limit?: number; unreadOnly?: boolean } = {}) {
      const { limit = 50, unreadOnly = false } = options;
      let rows = stmts.listSent.all(fromAgent, limit) as InboxRow[];
      if (unreadOnly) rows = rows.filter((r) => r.read === 0);
      return {
        success: true,
        messages: rows.map(formatMessage),
        count: rows.length,
      };
    },

    /**
     * Mark a message as read. Stamps read_at on first read (COALESCE keeps the
     * original timestamp if already read), so the sender sees WHEN it was read.
     */
    markRead(agentId: string, messageId: number) {
      stmts.markRead.run(Date.now(), agentId, messageId);
      return { success: true };
    },

    /**
     * Mark all messages as read (stamps read_at on the newly-read ones)
     */
    markAllRead(agentId: string) {
      const result = stmts.markAllRead.run(Date.now(), agentId);
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
