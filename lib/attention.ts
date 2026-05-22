/**
 * Attention — composer for "what does this agent need to see right now?"
 *
 * Aggregates the two places where other agents leave things addressed at you:
 *   1. Personal inbox (lib/agent-inbox.ts)
 *   2. Subscribed channels (lib/messaging.ts)
 *
 * Marks items as seen on fetch (inbox: markAllRead; channels: advance per-channel
 * cursor). `--peek` keeps the cursor where it was so a script can dry-run.
 *
 * The contract: one call returns "everything new for this agent" with stable JSON
 * shape so harness SessionStart hooks can pin the result into prompt context. See
 * docs/api.html for the schema.
 */
import type { DatabaseInstance } from './sqlite-runtime.js';

interface InboxAPI {
  list(agentId: string, options?: { unreadOnly?: boolean; limit?: number; since?: number }): {
    success: boolean;
    messages: Array<{
      id: number;
      agentId: string;
      from: string | null;
      content: unknown;
      contentType: string;
      type: string;
      read: boolean;
      createdAt: number;
    }>;
    count: number;
  };
  markRead(agentId: string, messageId: number): { success: boolean };
  stats(agentId: string): { success: boolean; total: number; unread: number };
}

interface MessagingAPI {
  getMessages(channel: string, options?: { limit?: number; after?: number | null }): {
    success: boolean;
    channel?: string;
    messages?: Array<{
      id: number;
      payload: unknown;
      contentType: string;
      sender: string;
      createdAt: number;
    }>;
    count?: number;
    error?: string;
  };
}

export interface AttentionItem {
  source: 'inbox' | 'channel';
  id: string;
  agentId: string;
  from: string | null;
  channel: string | null;
  type: string | null;
  content: unknown;
  contentType: string;
  receivedAt: number;
}

export interface AttentionSummary {
  success: true;
  agentId: string;
  items: AttentionItem[];
  counts: {
    total: number;
    inbox: number;
    channels: number;
    inboxUnreadRemaining: number;
  };
  subscriptions: string[];
  peek: boolean;
  generatedAt: number;
}

export interface CreateAttentionDeps {
  db: DatabaseInstance;
  inbox: InboxAPI;
  messaging: MessagingAPI;
}

interface SubscriptionRow {
  agent_id: string;
  channel: string;
  cursor: number;
  created_at: number;
}

const ITEM_DEFAULT_LIMIT = 50;
const CHANNEL_FETCH_LIMIT = 100;

export function createAttention(deps: CreateAttentionDeps) {
  const { db, inbox, messaging } = deps;

  db.exec(`
    CREATE TABLE IF NOT EXISTS attention_subscriptions (
      agent_id   TEXT NOT NULL,
      channel    TEXT NOT NULL,
      cursor     INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, channel)
    );
    CREATE INDEX IF NOT EXISTS idx_attention_subs_agent
      ON attention_subscriptions(agent_id);
  `);

  const stmts = {
    listSubs: db.prepare<[string], SubscriptionRow>(
      'SELECT agent_id, channel, cursor, created_at FROM attention_subscriptions WHERE agent_id = ? ORDER BY created_at',
    ),
    upsertSub: db.prepare(
      `INSERT INTO attention_subscriptions (agent_id, channel, cursor, created_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(agent_id, channel) DO NOTHING`,
    ),
    deleteSub: db.prepare(
      'DELETE FROM attention_subscriptions WHERE agent_id = ? AND channel = ?',
    ),
    advanceCursor: db.prepare(
      'UPDATE attention_subscriptions SET cursor = ? WHERE agent_id = ? AND channel = ? AND cursor < ?',
    ),
  };

  function listSubscriptions(agentId: string): string[] {
    if (!agentId) return [];
    const rows = stmts.listSubs.all(agentId);
    return rows.map((r) => r.channel);
  }

  function listSubscriptionsWithCursors(agentId: string): SubscriptionRow[] {
    if (!agentId) return [];
    return stmts.listSubs.all(agentId);
  }

  function subscribe(agentId: string, channel: string): { success: boolean; subscribed?: boolean; error?: string } {
    if (!agentId || typeof agentId !== 'string') return { success: false, error: 'agentId required' };
    if (!channel || typeof channel !== 'string') return { success: false, error: 'channel required' };
    const trimmed = channel.trim();
    if (!trimmed) return { success: false, error: 'channel required' };
    const result = stmts.upsertSub.run(agentId, trimmed, Date.now());
    return { success: true, subscribed: result.changes > 0 };
  }

  function unsubscribe(agentId: string, channel: string): { success: boolean; removed?: boolean; error?: string } {
    if (!agentId || typeof agentId !== 'string') return { success: false, error: 'agentId required' };
    if (!channel || typeof channel !== 'string') return { success: false, error: 'channel required' };
    const result = stmts.deleteSub.run(agentId, channel.trim());
    return { success: true, removed: result.changes > 0 };
  }

  function compose(
    agentId: string,
    options: { peek?: boolean; limit?: number } = {},
  ): AttentionSummary {
    const peek = options.peek === true;
    const limit = Math.max(1, Math.min(options.limit ?? ITEM_DEFAULT_LIMIT, 500));
    const now = Date.now();

    const items: AttentionItem[] = [];

    // 1. Inbox — unread messages addressed directly to this agent
    const inboxResult = inbox.list(agentId, { unreadOnly: true, limit });
    const inboxItems: AttentionItem[] = (inboxResult.messages || []).map((m) => ({
      source: 'inbox' as const,
      id: `inbox:${m.id}`,
      agentId,
      from: m.from,
      channel: null,
      type: m.type,
      content: m.content,
      contentType: m.contentType,
      receivedAt: m.createdAt,
    }));
    items.push(...inboxItems);

    // 2. Subscribed channels — messages newer than this agent's cursor
    const subs = listSubscriptionsWithCursors(agentId);
    let channelTotal = 0;
    for (const sub of subs) {
      const msgRes = messaging.getMessages(sub.channel, {
        after: sub.cursor || null,
        limit: CHANNEL_FETCH_LIMIT,
      });
      const msgs = msgRes.success && msgRes.messages ? msgRes.messages : [];
      if (msgs.length === 0) continue;

      for (const m of msgs) {
        items.push({
          source: 'channel',
          id: `channel:${sub.channel}:${m.id}`,
          agentId,
          from: m.sender,
          channel: sub.channel,
          type: null,
          content: m.payload,
          contentType: m.contentType,
          receivedAt: m.createdAt,
        });
      }
      channelTotal += msgs.length;

      if (!peek) {
        const maxId = msgs.reduce((acc, m) => (m.id > acc ? m.id : acc), sub.cursor);
        if (maxId > sub.cursor) {
          stmts.advanceCursor.run(maxId, agentId, sub.channel, maxId);
        }
      }
    }

    // 3. Mark only the surfaced inbox items as read (NOT markAllRead — would
    //    silently consume unread messages beyond the limit).
    if (!peek) {
      for (const m of inboxResult.messages || []) {
        inbox.markRead(agentId, m.id);
      }
    }

    // Sort newest-first so the SessionStart hook pins the freshest things first
    items.sort((a, b) => b.receivedAt - a.receivedAt);

    // Re-stat after the partial mark; remaining = inbox messages we did NOT surface
    const stats = inbox.stats(agentId);
    const inboxUnreadRemaining = stats.unread;

    return {
      success: true,
      agentId,
      items,
      counts: {
        total: items.length,
        inbox: inboxItems.length,
        channels: channelTotal,
        inboxUnreadRemaining,
      },
      subscriptions: subs.map((s) => s.channel),
      peek,
      generatedAt: now,
    };
  }

  return {
    compose,
    subscribe,
    unsubscribe,
    listSubscriptions,
  };
}

export type Attention = ReturnType<typeof createAttention>;
