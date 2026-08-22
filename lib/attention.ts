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
import { validateChannel } from '../shared/validators.js';

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

interface MessagingMessage {
  id: number;
  payload: unknown;
  contentType: string;
  sender: string | null;
  createdAt: number;
}

// Loose type — the real lib/messaging.ts module returns a union (validation error
// OR success-with-messages); narrowing here would force us to import every code
// branch. We only care about `.success` and `.messages` so this is what we need.
interface MessagingAPI {
  getMessages(
    channel: string,
    options?: { limit?: number; after?: number | null },
  ): {
    success: boolean;
    messages?: MessagingMessage[];
    [key: string]: unknown;
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
       VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id, channel) DO NOTHING`,
    ),
    channelMaxId: db.prepare<[string]>(
      'SELECT COALESCE(MAX(id), 0) AS max_id FROM messages WHERE channel = ?',
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

  function subscribe(agentId: string, channel: string): { success: boolean; subscribed?: boolean; cursor?: number; error?: string } {
    if (!agentId || typeof agentId !== 'string') return { success: false, error: 'agentId required' };
    if (!channel || typeof channel !== 'string') return { success: false, error: 'channel required' };
    const trimmed = channel.trim();
    if (!trimmed) return { success: false, error: 'channel required' };
    const validation = validateChannel(trimmed);
    if (!validation.valid) return { success: false, error: validation.error || 'invalid channel' };
    // Snapshot-isolate: start the cursor at the channel's current max so a new
    // subscriber sees future messages only, not the channel's entire history
    // (which would otherwise be drained one CHANNEL_FETCH_LIMIT at a time, and
    // orphaned beyond that). Subscribers who want backfill should call
    // `pd attention` repeatedly or fetch the channel via the messaging API.
    const maxRow = stmts.channelMaxId.get(trimmed) as { max_id: number } | undefined;
    const cursor = maxRow?.max_id ?? 0;
    const result = stmts.upsertSub.run(agentId, trimmed, cursor, Date.now());
    return { success: true, subscribed: result.changes > 0, cursor };
  }

  function unsubscribe(agentId: string, channel: string): { success: boolean; removed?: boolean; error?: string } {
    if (!agentId || typeof agentId !== 'string') return { success: false, error: 'agentId required' };
    if (!channel || typeof channel !== 'string') return { success: false, error: 'channel required' };
    const trimmed = channel.trim();
    const validation = validateChannel(trimmed);
    if (!validation.valid) return { success: false, error: validation.error || 'invalid channel' };
    const result = stmts.deleteSub.run(agentId, trimmed);
    return { success: true, removed: result.changes > 0 };
  }

  function compose(
    agentId: string,
    options: { peek?: boolean; limit?: number } = {},
  ): AttentionSummary {
    const peek = options.peek === true;
    // Defensive clamp for direct lib callers; the HTTP route rejects ≤0 with
    // a 400 before reaching here, so this path is exercised only by tests and
    // any future in-process callers (e.g. an MCP wrapper, despite the current
    // MCP-exempt decision in tests/unit/mcp-parity.test.js).
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

    // 2. Subscribed channels — messages newer than this agent's cursor.
    //    Each channel's read-then-advance must be atomic; otherwise two
    //    concurrent compose() calls for the same agent both see cursor=N,
    //    both fetch the same messages, and both think they marked them seen.
    const subs = listSubscriptionsWithCursors(agentId);
    let channelTotal = 0;
    const composeChannel = db.transaction((sub: SubscriptionRow): Array<{ msg: any; cursor: number }> => {
      // Re-read cursor inside the txn to defeat the read-then-update race.
      const fresh = stmts.listSubs.all(sub.agent_id).find((s) => s.channel === sub.channel);
      const cursor = fresh?.cursor ?? sub.cursor;
      const msgRes = messaging.getMessages(sub.channel, {
        after: cursor || null,
        limit: CHANNEL_FETCH_LIMIT,
      });
      const msgs = msgRes.success && msgRes.messages ? msgRes.messages : [];
      if (msgs.length === 0) return [];
      if (!peek) {
        const maxId = msgs.reduce((acc, m) => (m.id > acc ? m.id : acc), cursor);
        if (maxId > cursor) {
          stmts.advanceCursor.run(maxId, sub.agent_id, sub.channel, maxId);
        }
      }
      return msgs.map((m) => ({ msg: m, cursor }));
    });

    for (const sub of subs) {
      const chMsgs = composeChannel(sub);
      for (const { msg: m } of chMsgs) {
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
      channelTotal += chMsgs.length;
    }

    // 3. Mark only the surfaced inbox items as read in a single transaction
    //    so an N-message fetch is one fsync, not N. Per-message markRead is
    //    deliberate (NOT markAllRead) so messages beyond the limit stay unread.
    if (!peek && inboxItems.length > 0) {
      const markBatch = db.transaction((messages: Array<{ id: number }>) => {
        for (const m of messages) {
          inbox.markRead(agentId, m.id);
        }
      });
      markBatch(inboxResult.messages || []);
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
