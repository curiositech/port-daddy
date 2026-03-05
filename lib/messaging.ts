/**
 * Messaging Module - Pub/Sub for agent coordination
 *
 * Simple local message broker for multi-agent communication
 */

import type Database from 'better-sqlite3';
import { parseExpires, tryParseJson } from './utils.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_CHANNELS = 1000;               // Maximum unique channels with subscribers
const MAX_SUBSCRIBERS_PER_CHANNEL = 100; // Maximum subscribers per channel

interface MessageRow {
  id: number;
  channel: string;
  payload: string;
  sender: string | null;
  created_at: number;
  expires_at: number | null;
}

interface ChannelRow {
  channel: string;
  count: number;
  last_message: number;
}

interface PublishOptions {
  sender?: string | null;
  expires?: string | number | null;
}

interface GetMessagesOptions {
  limit?: number;
  after?: number | null;
}

interface MessagePayload {
  id: number | bigint;
  channel?: string;
  payload: string;
  sender: string | null;
  createdAt: number;
}

type SubscriberCallback = (msg: MessagePayload) => void;

/**
 * Initialize the messaging module with a database connection
 */
export function createMessaging(db: Database.Database) {
  // Prepared statements
  const stmts = {
    insert: db.prepare(`
      INSERT INTO messages (channel, payload, sender, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    getLatest: db.prepare<[string, number]>(`
      SELECT * FROM messages
      WHERE channel = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
    getAfter: db.prepare<[string, number]>(`
      SELECT * FROM messages
      WHERE channel = ? AND id > ?
      ORDER BY created_at ASC
      LIMIT 200
    `),
    getOne: db.prepare<[string]>(`
      SELECT * FROM messages
      WHERE channel = ?
      ORDER BY created_at ASC
      LIMIT 1
    `),
    deleteById: db.prepare('DELETE FROM messages WHERE id = ?'),
    deleteByChannel: db.prepare('DELETE FROM messages WHERE channel = ?'),
    deleteExpired: db.prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?'),
    getChannels: db.prepare(`
      SELECT channel, COUNT(*) as count, MAX(created_at) as last_message
      FROM messages
      GROUP BY channel
      ORDER BY last_message DESC
    `),
  };

  // In-memory subscribers (for SSE)
  const subscribers = new Map<string, Set<SubscriberCallback>>();

  /**
   * Publish a message to a channel
   */
  function publish(channel: string, payload: unknown, options: PublishOptions = {}) {
    if (!channel || typeof channel !== 'string') {
      return { success: false, error: 'channel must be a non-empty string', code: 'VALIDATION_ERROR' };
    }
    const trimmedChannel = channel.trim();
    if (!trimmedChannel) {
      return { success: false, error: 'channel must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    // Validate payload
    if (payload === null || payload === undefined) {
      return { success: false, error: 'payload is required', code: 'VALIDATION_ERROR' };
    }
    if (typeof payload === 'string') {
      if (!payload.trim()) {
        return { success: false, error: 'payload must be a non-empty string', code: 'VALIDATION_ERROR' };
      }
    }

    const now = Date.now();
    const { sender = null, expires = null } = options;

    let expiresAt: number | null = null;
    if (expires) {
      const parsed = parseExpires(expires);
      expiresAt = parsed !== null ? now + parsed : null;
    }

    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    try {
      const result = stmts.insert.run(trimmedChannel, payloadStr, sender, now, expiresAt);

      const message: MessagePayload = {
        id: result.lastInsertRowid,
        channel: trimmedChannel,
        payload: payloadStr,
        sender,
        createdAt: now
      };

      // Notify subscribers
      notifySubscribers(trimmedChannel, message);

      return {
        success: true,
        id: result.lastInsertRowid,
        message: `published to ${trimmedChannel}`
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Get recent messages from a channel
   */
  function getMessages(channel: string, options: GetMessagesOptions = {}) {
    if (!channel || typeof channel !== 'string') {
      return { success: false, error: 'channel must be a non-empty string', code: 'VALIDATION_ERROR' };
    }
    const trimmedChannel = channel.trim();
    if (!trimmedChannel) {
      return { success: false, error: 'channel must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const { limit = 50, after = null } = options;

    let messages: MessageRow[];
    if (after !== null) {
      messages = stmts.getAfter.all(trimmedChannel, after) as MessageRow[];
    } else {
      messages = stmts.getLatest.all(trimmedChannel, limit) as MessageRow[];
      messages.reverse(); // Return in chronological order
    }

    return {
      success: true,
      channel: trimmedChannel,
      messages: messages.map(m => ({
        id: m.id,
        payload: tryParseJson(m.payload),
        sender: m.sender,
        createdAt: m.created_at
      })),
      count: messages.length
    };
  }

  /**
   * Poll for the next message (blocking-style, but returns immediately)
   * Use with long-polling HTTP or SSE
   */
  function poll(channel: string, afterId: number = 0) {
    if (!channel || typeof channel !== 'string') {
      return { success: false, error: 'channel must be a non-empty string', code: 'VALIDATION_ERROR' };
    }
    const trimmedChannel = channel.trim();
    if (!trimmedChannel) {
      return { success: false, error: 'channel must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const messages = stmts.getAfter.all(trimmedChannel, afterId) as MessageRow[];

    if (messages.length === 0) {
      return { success: true, channel: trimmedChannel, message: null, lastId: afterId };
    }

    const first = messages[0];
    return {
      success: true,
      channel: trimmedChannel,
      message: {
        id: first.id,
        payload: tryParseJson(first.payload),
        sender: first.sender,
        createdAt: first.created_at
      },
      lastId: first.id
    };
  }

  /**
   * Subscribe to a channel (in-memory, for SSE)
   * Returns an unsubscribe function, or null if limits exceeded
   */
  function subscribe(channel: string, callback: SubscriberCallback): (() => void) | null {
    // Enforce channel limit to prevent memory exhaustion
    if (!subscribers.has(channel) && subscribers.size >= MAX_CHANNELS) {
      // Return null to indicate subscription failed
      return null;
    }

    if (!subscribers.has(channel)) {
      subscribers.set(channel, new Set());
    }

    const subs = subscribers.get(channel)!;

    // Enforce per-channel subscriber limit
    if (subs.size >= MAX_SUBSCRIBERS_PER_CHANNEL) {
      // Clean up empty channel set if we just created it
      if (subs.size === 0) {
        subscribers.delete(channel);
      }
      return null;
    }

    subs.add(callback);

    // Return unsubscribe function
    return () => {
      const channelSubs = subscribers.get(channel);
      if (channelSubs) {
        channelSubs.delete(callback);
        if (channelSubs.size === 0) {
          subscribers.delete(channel);
        }
      }
    };
  }

  /**
   * Notify all subscribers of a channel
   */
  function notifySubscribers(channel: string, message: MessagePayload): void {
    const subs = subscribers.get(channel);
    if (subs) {
      for (const callback of subs) {
        try {
          callback(message);
        } catch (err) {
          console.error(`Error notifying subscriber on ${channel}:`, err);
        }
      }
    }

    // Also notify wildcard subscribers
    const wildcardSubs = subscribers.get('*');
    if (wildcardSubs) {
      for (const callback of wildcardSubs) {
        try {
          callback({ ...message, channel });
        } catch (err) {
          console.error('Error notifying wildcard subscriber:', err);
        }
      }
    }
  }

  /**
   * Clear all messages from a channel
   */
  function clear(channel: string) {
    if (!channel || typeof channel !== 'string') {
      return { success: false, error: 'channel must be a non-empty string', code: 'VALIDATION_ERROR' };
    }
    const trimmedChannel = channel.trim();
    if (!trimmedChannel) {
      return { success: false, error: 'channel must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const result = stmts.deleteByChannel.run(trimmedChannel);
    return {
      success: true,
      deleted: result.changes,
      message: `cleared ${result.changes} message(s) from ${trimmedChannel}`
    };
  }

  /**
   * List all channels with message counts
   */
  function listChannels() {
    const channels = stmts.getChannels.all() as ChannelRow[];
    return {
      success: true,
      channels: channels.map(c => ({
        channel: c.channel,
        count: c.count,
        lastMessage: c.last_message
      }))
    };
  }

  /**
   * Cleanup expired messages
   */
  function cleanup() {
    const result = stmts.deleteExpired.run(Date.now());
    return { cleaned: result.changes };
  }

  /**
   * Get subscriber count for a channel (for monitoring)
   */
  /**
   * Destroy all in-memory state (subscribers). Call on teardown.
   */
  function destroy() {
    subscribers.clear();
  }

  function subscriberCount(channel: string): number {
    const subs = subscribers.get(channel);
    return subs ? subs.size : 0;
  }

  return {
    publish,
    getMessages,
    poll,
    subscribe,
    clear,
    listChannels,
    cleanup,
    subscriberCount,
    destroy
  };
}
