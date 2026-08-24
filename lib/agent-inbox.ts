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
import { createHash } from 'node:crypto';
import { canonicalJson } from './agent-harbor/guidance-envelope.js';

export interface InboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  content: unknown;
  contentType: string;
  type: string;
  read: boolean;
  readAt: number | null;
  createdAt: number;
}

interface StoredInboxMessage extends InboxMessage {
  /** Durable delivery identity is storage-internal and never enters public DTOs. */
  deliveryKey: string | null;
}

interface InboxRow {
  id: number;
  agent_id: string;
  from_agent: string | null;
  content: string;
  content_type: string;
  type: string;
  read: number;
  read_at: number | null;
  created_at: number;
  delivery_key: string | null;
}

interface DeliveryReservationRow {
  agent_id: string;
  delivery_key: string;
  fingerprint: string;
  message_id: number;
  created_at: number;
  expires_at: number;
}

export interface SendOptions {
  from?: string;
  type?: string;
  contentType?: 'text' | 'json' | 'binary';
}

export type InboxSendResult =
  | { success: true; messageId: number; agentId: string; replayed: boolean }
  | { success: false; error: string; code?: string };

interface InternalSendOptions extends SendOptions {
  deliveryKey: string;
}

interface ListOptions {
  unreadOnly?: boolean;
  limit?: number;
  since?: number;
}

const MAX_INBOX_MESSAGES = 1000;
export const MAX_INBOX_DELIVERY_KEY_CHARS = 256;
export const INBOX_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const INBOX_DELIVERY_CLEANUP_BATCH = 100;

/** Canonical server callback projection: delivery identity never becomes UI signal. */
export function inboxMessageForMessaging(message: InboxMessage) {
  // Defensively strip a storage-shaped object even though public callers are
  // typed to receive InboxMessage without the internal delivery identity.
  const { deliveryKey: _internalDeliveryKey, ...publishedMessage } = message as InboxMessage & {
    deliveryKey?: unknown;
  };
  return {
    ...publishedMessage,
    sender: message.from || 'SYSTEM',
    signal: 'report' as const,
  };
}

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
      created_at INTEGER NOT NULL,
      delivery_key TEXT
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

  try {
    db.exec('ALTER TABLE agent_inbox ADD COLUMN delivery_key TEXT');
  } catch { /* already exists */ }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_inbox_agent ON agent_inbox(agent_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_inbox_unread ON agent_inbox(agent_id) WHERE read = 0`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_inbox_from ON agent_inbox(from_agent, created_at)`);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_inbox_agent_delivery_key
    ON agent_inbox(agent_id, delivery_key)
    WHERE delivery_key IS NOT NULL
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_inbox_deliveries (
      agent_id TEXT NOT NULL,
      delivery_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, delivery_key)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_inbox_deliveries_expires
    ON agent_inbox_deliveries(expires_at)`);
  const stmts = {
    send: db.prepare(`
      INSERT INTO agent_inbox
        (agent_id, from_agent, content, content_type, type, read, created_at, delivery_key)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `),
    byId: db.prepare(`SELECT * FROM agent_inbox WHERE id = ? LIMIT 1`),
    deliveryByKey: db.prepare(`
      SELECT * FROM agent_inbox_deliveries WHERE agent_id = ? AND delivery_key = ? LIMIT 1
    `),
    reserveDelivery: db.prepare(`
      INSERT INTO agent_inbox_deliveries
        (agent_id, delivery_key, fingerprint, message_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    expiredDeliveries: db.prepare(`
      SELECT agent_id, delivery_key FROM agent_inbox_deliveries
      WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?
    `),
    clearExpiredMessageDeliveryKeys: db.prepare(`
      UPDATE agent_inbox SET delivery_key = NULL WHERE agent_id = ? AND delivery_key = ?
    `),
    deleteDelivery: db.prepare(`
      DELETE FROM agent_inbox_deliveries WHERE agent_id = ? AND delivery_key = ?
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

  function formatStoredMessage(row: InboxRow): StoredInboxMessage {
    return {
      id: row.id,
      agentId: row.agent_id,
      from: row.from_agent,
      content: row.content_type === 'json' ? safeJsonParse(row.content) : row.content,
      contentType: row.content_type,
      type: row.type,
      read: row.read === 1,
      readAt: row.read_at ?? null,
      createdAt: row.created_at,
      deliveryKey: row.delivery_key ?? null,
    };
  }

  function formatMessage(row: InboxRow): InboxMessage {
    const { deliveryKey: _internalDeliveryKey, ...message } = formatStoredMessage(row);
    return message;
  }

  function safeJsonParse(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  function deliveryFingerprint(
    from: string | null,
    content: string,
    contentType: string,
    type: string,
  ): string {
    return createHash('sha256')
      .update(JSON.stringify([from, content, contentType, type]), 'utf8')
      .digest('hex');
  }

  function clearExpiredDeliveryReservations(at: number): number {
    const expired = stmts.expiredDeliveries.all(
      at,
      INBOX_DELIVERY_CLEANUP_BATCH,
    ) as Array<{ agent_id: string; delivery_key: string }>;
    for (const row of expired) {
      stmts.clearExpiredMessageDeliveryKeys.run(row.agent_id, row.delivery_key);
      stmts.deleteDelivery.run(row.agent_id, row.delivery_key);
    }
    return expired.length;
  }

  function deliver(
    agentId: string,
    content: unknown,
    options: SendOptions,
    deliveryKey: string | null,
  ): InboxSendResult {
    if (!agentId || content === undefined || content === null || content === '') {
      return { success: false, error: 'agentId and content required' };
    }

    const { from = null, type = 'message' } = options;
    let { contentType } = options;
    const now = Date.now();
    if (!contentType) {
      if (typeof content === 'string') contentType = 'text';
      else if (Buffer.isBuffer(content)) contentType = 'binary';
      else contentType = 'json';
    }

    let contentStr: string;
    if (contentType === 'json') {
      const parsed = typeof content === 'string' ? safeJsonParse(content) : content;
      contentStr = deliveryKey
        ? canonicalJson(parsed)
        : typeof content === 'string' ? content : JSON.stringify(content);
    } else if (contentType === 'binary') {
      contentStr = Buffer.isBuffer(content) ? content.toString('base64') : String(content);
    } else {
      contentStr = String(content);
    }
    const fingerprint = deliveryKey
      ? deliveryFingerprint(from, contentStr, contentType, type)
      : null;

    try {
      const deliverTransaction = db.transaction(() => {
        clearExpiredDeliveryReservations(now);
        if (deliveryKey && fingerprint) {
          let existing = stmts.deliveryByKey.get(agentId, deliveryKey) as DeliveryReservationRow | undefined;
          if (existing && existing.expires_at <= now) {
            stmts.clearExpiredMessageDeliveryKeys.run(agentId, deliveryKey);
            stmts.deleteDelivery.run(agentId, deliveryKey);
            existing = undefined;
          }
          if (existing) {
            if (existing.fingerprint !== fingerprint) {
              return {
                success: false as const,
                error: `delivery key ${deliveryKey} was already used for a different message`,
                code: 'IDEMPOTENCY_CONFLICT',
              };
            }
            return {
              success: true as const,
              messageId: existing.message_id,
              inserted: false,
            };
          }
        }

        // Durable reservation replay is resolved before a full inbox can refuse it.
        const currentCount = (stmts.count.get(agentId) as { count: number }).count;
        if (currentCount >= MAX_INBOX_MESSAGES) {
          return {
            success: false as const,
            error: `Inbox full for agent ${agentId} (max ${MAX_INBOX_MESSAGES} messages)`,
            code: 'RESOURCE_LIMIT',
          };
        }

        const result = stmts.send.run(agentId, from, contentStr, contentType, type, now, deliveryKey);
        const messageId = Number(result.lastInsertRowid);
        if (deliveryKey && fingerprint) {
          stmts.reserveDelivery.run(
            agentId,
            deliveryKey,
            fingerprint,
            messageId,
            now,
            now + INBOX_DELIVERY_RETENTION_MS,
          );
        }
        return { success: true as const, messageId, inserted: true };
      });

      const delivered = deliverTransaction.immediate();
      if (!delivered.success) return delivered;
      if (delivered.inserted && onMessage) {
        const row = stmts.byId.get(delivered.messageId) as InboxRow;
        onMessage(agentId, formatMessage(row));
      }
      return {
        success: true,
        messageId: delivered.messageId,
        agentId,
        replayed: !delivered.inserted,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  return {
    /**
     * Send a message to an agent's inbox.
     * Anyone can send (you don't need to be registered).
     * If the inbox exceeds MAX_INBOX_MESSAGES (1000), the oldest messages are evicted.
     */
    send(agentId: string, content: unknown, options: SendOptions = {}): InboxSendResult {
      if (Object.prototype.hasOwnProperty.call(options, 'signal')
        || Object.prototype.hasOwnProperty.call(options, 'deliveryKey')
        || Object.prototype.hasOwnProperty.call(options, 'idempotencyKey')) {
        return {
          success: false,
          error: 'delivery identity is reserved for internal idempotent delivery',
          code: 'INTERNAL_DELIVERY_KEY_FORBIDDEN',
        };
      }
      return deliver(agentId, content, options, null);
    },

    internal: Object.freeze({
      sendOnce(agentId: string, content: unknown, options: InternalSendOptions): InboxSendResult {
        if (!options || typeof options.deliveryKey !== 'string' || !options.deliveryKey.trim()) {
          return { success: false, error: 'deliveryKey must be a non-empty string', code: 'VALIDATION_ERROR' };
        }
        const deliveryKey = options.deliveryKey.trim();
        if (deliveryKey.length > MAX_INBOX_DELIVERY_KEY_CHARS) {
          return {
            success: false,
            error: `deliveryKey exceeds ${MAX_INBOX_DELIVERY_KEY_CHARS} characters`,
            code: 'VALIDATION_ERROR',
          };
        }
        const { deliveryKey: _deliveryKey, ...deliveryOptions } = options;
        return deliver(agentId, content, deliveryOptions, deliveryKey);
      },
    }),

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
      const cleanupTransaction = db.transaction(() => {
        const result = stmts.deleteOld.run(cutoff);
        const reservationsCleaned = clearExpiredDeliveryReservations(Date.now());
        return { cleaned: result.changes, reservationsCleaned };
      });
      return cleanupTransaction.immediate();
    },

    MAX_INBOX_MESSAGES,
  };
}
