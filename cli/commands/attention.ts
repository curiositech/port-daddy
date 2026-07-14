/**
 * pd attention — single-call aggregator of inbox + subscribed channels
 *
 * Convention: run this as the first command of every session (or wire it into
 * the harness's SessionStart hook). One call returns everything other agents
 * have queued for you and marks it seen.
 *
 * Subcommands / flags:
 *   pd attention                       fetch + mark-read (default pretty output)
 *   pd attention --json                machine-readable, stable schema
 *   pd attention --peek                fetch without marking read
 *   pd attention --limit N             cap items (default 50, max 500)
 *   pd attention --subscribe <ch>      register a channel to watch
 *   pd attention --unsubscribe <ch>    remove a subscription
 *   pd attention --subscriptions       list current subscriptions
 *
 * Identity resolution: --agent <id> > $PD_AGENT_ID > .portdaddy/current.json
 * If no identity is resolvable, the command errors instead of silently
 * fetching nothing.
 */

import { pdFetch } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { readCurrentContext } from '../utils/current-context.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface AttentionItem {
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

interface AttentionSummary {
  success: boolean;
  agentId?: string;
  items?: AttentionItem[];
  counts?: {
    total: number;
    inbox: number;
    channels: number;
    inboxUnreadRemaining: number;
  };
  subscriptions?: string[];
  peek?: boolean;
  generatedAt?: number;
  error?: string;
  code?: string;
}

function resolveAgentId(options: CLIOptions): string | null {
  const explicit = typeof options.agent === 'string' ? options.agent.trim() : '';
  if (explicit) return explicit;
  const env = (process.env.PD_AGENT_ID || '').trim();
  if (env) return env;
  const ctx = readCurrentContext();
  if (ctx && typeof ctx.agentId === 'string' && ctx.agentId.trim()) return ctx.agentId.trim();
  return null;
}

function formatRelative(ms: number, now: number): string {
  const delta = Math.max(0, now - ms);
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

function renderContent(content: unknown, contentType: string): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (contentType === 'json' || typeof content === 'object') {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function attentionState(item: AttentionItem): ui.LineworkState {
  const type = (item.type || '').toLowerCase();
  if (type.includes('parley') || type.includes('conflict')) return 'conflict';
  if (type.includes('hold') || type.includes('approval')) return 'awaiting-human';
  if (type.includes('block') || type.includes('guard')) return 'guard-blocked';
  if (item.source === 'inbox') return 'pending';
  return 'request';
}

export function renderAttentionLinework(summary: AttentionSummary): string {
  const items = summary.items || [];
  const counts = summary.counts || { total: 0, inbox: 0, channels: 0, inboxUnreadRemaining: 0 };
  const subs = summary.subscriptions || [];
  const now = Date.now();

  if (items.length === 0) {
    return ui.renderLineworkPanel({
      title: 'Attention',
      subtitle: summary.agentId || 'agent',
      tone: 'confirmed',
      zone: 'clear',
      rows: [
        {
          state: 'confirmed',
          label: 'inbox',
          text: counts.inboxUnreadRemaining > 0
            ? `${counts.inboxUnreadRemaining} remaining beyond fetch limit`
            : 'no unread direct messages',
        },
        {
          state: subs.length > 0 ? 'active' : 'idle',
          label: 'channels',
          text: subs.length > 0 ? subs.join(', ') : 'no subscriptions',
        },
      ],
      footer: summary.peek ? 'peek only · nothing marked read' : 'attention clear',
    });
  }

  const rows = items.map((item): ui.LineworkRow => {
    const age = formatRelative(item.receivedAt, now);
    const origin = item.source === 'inbox'
      ? `inbox from ${item.from || 'unknown'}`
      : `${item.channel || 'channel'}${item.from ? ` from ${item.from}` : ''}`;
    const body = renderContent(item.content, item.contentType).replace(/\s+/g, ' ').trim();
    return {
      state: attentionState(item),
      label: age,
      text: `${origin}${item.type ? ` [${item.type}]` : ''}${body ? ` · ${body}` : ''}`,
    };
  });

  return ui.renderLineworkPanel({
    title: 'Attention',
    subtitle: summary.agentId || 'agent',
    tone: summary.peek ? 'unknown' : 'pending',
    zone: summary.peek ? `${counts.total} waiting · peek` : `${counts.total} item(s) marked read`,
    rows,
    footer: `inbox ${counts.inbox} · channels ${counts.channels}${counts.inboxUnreadRemaining > 0 ? ` · inbox remaining ${counts.inboxUnreadRemaining}` : ''}`,
  });
}

function printPretty(summary: AttentionSummary, options: CLIOptions): void {
  if (!summary.success) {
    ui.error(summary.error || 'attention fetch failed');
    process.exit(1);
  }
  if (ui.lineworkEnabled({ json: isJson(options), quiet: isQuiet(options) })) {
    console.log(renderAttentionLinework(summary));
    return;
  }
  const items = summary.items || [];
  const counts = summary.counts || { total: 0, inbox: 0, channels: 0, inboxUnreadRemaining: 0 };
  const subs = summary.subscriptions || [];
  const now = Date.now();

  if (items.length === 0) {
    console.log('Nothing new.');
    if (subs.length > 0) {
      console.log(`  Subscribed: ${subs.join(', ')}`);
    } else {
      console.log('  (no channel subscriptions — try `pd attention --subscribe <channel>`)');
    }
    if (counts.inboxUnreadRemaining > 0) {
      console.log(`  ${counts.inboxUnreadRemaining} inbox message(s) remaining beyond fetch limit`);
    }
    return;
  }

  const banner = summary.peek
    ? `${counts.total} item(s) waiting (peek — NOT marked read)`
    : `${counts.total} item(s) (now marked read)`;
  console.log(banner);
  console.log('');

  for (const item of items) {
    const age = formatRelative(item.receivedAt, now);
    const origin = item.source === 'inbox'
      ? `inbox ← ${item.from || 'unknown'}`
      : `channel ${item.channel}${item.from ? ` ← ${item.from}` : ''}`;
    const meta = item.type ? `[${item.type}] ` : '';
    const body = renderContent(item.content, item.contentType);
    console.log(`  • ${age.padStart(4)}  ${origin}`);
    console.log(`         ${meta}${body}`);
  }

  console.log('');
  console.log(`Counts: inbox=${counts.inbox}  channels=${counts.channels}` + (counts.inboxUnreadRemaining > 0 ? `  inbox-remaining=${counts.inboxUnreadRemaining}` : ''));
  if (subs.length > 0) {
    console.log(`Subscribed: ${subs.join(', ')}`);
  }
}

async function handleSubscribe(agentId: string, channel: string, options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch('/attention/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, channel }),
    transport: 'tcp',
  });
  const data = (await res.json()) as { success: boolean; subscribed?: boolean; error?: string };
  if (!res.ok || !data.success) {
    ui.error(data.error || 'subscribe failed');
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!isQuiet(options)) {
    if (data.subscribed) {
      ui.success(`Subscribed ${agentId} to ${channel}`);
    } else {
      console.log(`Already subscribed: ${agentId} -> ${channel}`);
    }
  }
}

async function handleUnsubscribe(agentId: string, channel: string, options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch('/attention/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, channel }),
    transport: 'tcp',
  });
  const data = (await res.json()) as { success: boolean; removed?: boolean; error?: string };
  if (!res.ok || !data.success) {
    ui.error(data.error || 'unsubscribe failed');
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!isQuiet(options)) {
    if (data.removed) {
      ui.success(`Unsubscribed ${agentId} from ${channel}`);
    } else {
      console.log(`Not subscribed: ${agentId} -> ${channel}`);
    }
  }
}

async function handleListSubscriptions(agentId: string, options: CLIOptions): Promise<void> {
  const params = new URLSearchParams({ agentId });
  const res: PdFetchResponse = await pdFetch(`/attention/subscriptions?${params}`, { transport: 'tcp' });
  const data = (await res.json()) as { success: boolean; agentId?: string; channels?: string[]; error?: string };
  if (!res.ok || !data.success) {
    ui.error(data.error || 'failed to list subscriptions');
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const channels = data.channels || [];
  if (channels.length === 0) {
    console.log(`No subscriptions for ${agentId}`);
  } else {
    console.log(`Subscriptions for ${agentId}:`);
    for (const ch of channels) console.log(`  - ${ch}`);
  }
}

export async function handleAttention(options: CLIOptions): Promise<void> {
  const agentId = resolveAgentId(options);
  if (!agentId) {
    ui.error('No agent identity resolved. Pass --agent <id>, set $PD_AGENT_ID, or run `pd begin` first.');
    process.exit(2);
  }

  // Subscribe / unsubscribe / list subscriptions
  if (typeof options.subscribe === 'string' && options.subscribe.trim()) {
    return handleSubscribe(agentId, options.subscribe.trim(), options);
  }
  if (typeof options.unsubscribe === 'string' && options.unsubscribe.trim()) {
    return handleUnsubscribe(agentId, options.unsubscribe.trim(), options);
  }
  if (options.subscriptions === true) {
    return handleListSubscriptions(agentId, options);
  }

  // Default: compose attention
  const params = new URLSearchParams({ agentId });
  if (options.peek === true) params.set('peek', 'true');
  if (options.limit !== undefined) params.set('limit', String(options.limit));

  const res: PdFetchResponse = await pdFetch(`/attention?${params}`, { transport: 'tcp' });
  const data = (await res.json()) as unknown as AttentionSummary;
  if (!res.ok || !data.success) {
    ui.error(data.error || 'attention fetch failed');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printPretty(data, options);
}
