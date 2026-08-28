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
 *   pd attention --subscribe-recommended
 *                                      arm ranked project/fleet watches
 *   pd attention --unsubscribe <ch>    remove a subscription
 *   pd attention --subscriptions       list current subscriptions
 *
 * Identity resolution: --agent <id> > $PD_AGENT_ID > .portdaddy/current.json.
 * Before a session exists, the default read is a successful unbound empty
 * result; identity-requiring subscription mutations still fail explicitly.
 */

import { pdFetch } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { readCurrentContext } from '../utils/current-context.js';
import type { FetchOptions, PdFetchResponse } from '../utils/fetch.js';
import { resolveTargetDir } from '../utils/channel-resolution.js';
import { validateChannel } from '../../shared/validators.js';
import * as ui from '../utils/ui.js';
import { showSugarParleyExperience } from './sugar.js';

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

export interface AttentionSuggestion {
  channel: string;
  physicalChannel: string;
  reason: string;
  scope: 'branch' | 'worktree' | 'repo' | 'global';
  activeCount: number;
  command: string;
}

interface DiscoveredChannel {
  logicalName: string;
  physicalName: string;
  description: string | null;
  scope: 'branch' | 'worktree' | 'repo' | 'global';
  activeCount: number;
  lastMessage: number | null;
  active: boolean;
  source: 'declared' | 'observed';
}

interface AttentionSummary {
  success: boolean;
  bound: boolean;
  agentId?: string;
  items?: AttentionItem[];
  counts?: {
    total: number;
    inbox: number;
    channels: number;
    inboxUnreadRemaining: number;
  };
  subscriptions?: string[];
  suggestions?: AttentionSuggestion[];
  peek?: boolean;
  generatedAt?: number;
  error?: string;
  code?: string;
}

type SugarParleyOffer = (
  agentId: string | undefined,
  sessionId: string | undefined,
  options: CLIOptions,
) => Promise<void>;

interface AttentionHandlerDeps {
  fetch?: (path: string, options?: FetchOptions) => Promise<PdFetchResponse>;
  /** Injectable only for focused CLI coverage; production uses Sugar's card. */
  sugarParleyOffer?: SugarParleyOffer;
}

export const ATTENTION_HELP: string = [
  'Usage: pd attention [--peek] [--limit N] [--agent ID] [--json]',
  '       pd attention --subscribe <channel>',
  '       pd attention --subscribe-recommended',
  '       pd attention --unsubscribe <channel>',
  '       pd attention --subscriptions',
  '',
  'Read direct inbox messages plus watched coordination channels in one call.',
  'Before pd begin, the default read succeeds as an unbound empty result.',
].join('\n');

export function unboundAttentionSummary(peek = false, now = Date.now()): AttentionSummary {
  return {
    success: true,
    bound: false,
    items: [],
    counts: { total: 0, inbox: 0, channels: 0, inboxUnreadRemaining: 0 },
    subscriptions: [],
    suggestions: [],
    peek,
    generatedAt: now,
  };
}

const ATTENTION_PROTOCOL_CHANNELS = [
  {
    channel: 'coordination:inconsistency',
    scope: 'worktree' as const,
    reason: 'Ownership, runtime, security, or product-truth conflicts that can change this agent\'s plan.',
    alwaysSuggest: true,
  },
  {
    channel: 'fleet:events',
    scope: 'global' as const,
    reason: 'Agent launches, completions, and failures across the active fleet.',
    alwaysSuggest: false,
  },
  {
    channel: 'agents',
    scope: 'global' as const,
    reason: 'Agent lifecycle changes, including arrivals, exits, and stale workers.',
    alwaysSuggest: false,
  },
] as const;

/**
 * Keep attention on the shared transport resolver. It tries the local Unix
 * socket and TCP endpoint as appropriate, and preserves an explicit remote
 * PORT_DADDY_URL. Forcing TCP here made sandboxed interactive agents less able
 * to receive their first-turn context than every other pd command.
 */
function attentionFetch(path: string, options: FetchOptions = {}): Promise<PdFetchResponse> {
  return pdFetch(path, options);
}

function suggestionFor(
  channel: string,
  physicalChannel: string,
  reason: string,
  scope: AttentionSuggestion['scope'],
  activeCount: number,
): AttentionSuggestion {
  return {
    channel,
    physicalChannel,
    reason,
    scope,
    activeCount,
    command: `pd attention --subscribe ${channel}`,
  };
}

/**
 * Rank structured channel facts for an agent's first watches. This deliberately
 * does not search channel names or descriptions with keyword lists. Declared
 * channels already carry explicit scope/description metadata; protocol-known
 * channels are exact identifiers with stable product meaning.
 */
export function rankAttentionSuggestions(
  channels: DiscoveredChannel[],
  subscriptions: string[] = [],
  limit = 3,
): AttentionSuggestion[] {
  const subscribed = new Set(subscriptions);
  const suggestions = new Map<string, { value: AttentionSuggestion; score: number }>();

  for (const entry of channels) {
    if (entry.source !== 'declared') continue;
    if (!entry.active || entry.activeCount <= 0) continue;
    if (subscribed.has(entry.logicalName) || subscribed.has(entry.physicalName)) continue;
    const scopeScore = entry.scope === 'worktree' ? 80 : entry.scope === 'branch' ? 70 : entry.scope === 'repo' ? 60 : 20;
    const score = 400 + scopeScore + (entry.active ? 40 : 0) + Math.min(entry.activeCount, 25);
    suggestions.set(entry.logicalName, {
      value: suggestionFor(
        entry.logicalName,
        entry.physicalName,
        entry.description || `Declared ${entry.scope}-scoped coordination channel for this project.`,
        entry.scope,
        entry.activeCount,
      ),
      score,
    });
  }

  ATTENTION_PROTOCOL_CHANNELS.forEach((protocol, index) => {
    const observed = channels.find((entry) =>
      entry.logicalName === protocol.channel || entry.physicalName === protocol.channel
    );
    if (!protocol.alwaysSuggest && !observed?.active) return;
    const alreadySubscribed = [...subscribed].some((channel) =>
      channel === protocol.channel ||
      channel === observed?.physicalName ||
      channel.endsWith(`:${protocol.channel}`)
    );
    if (alreadySubscribed) return;
    suggestions.set(protocol.channel, {
      value: suggestionFor(
        protocol.channel,
        protocol.scope === 'worktree' ? protocol.channel : (observed?.physicalName || protocol.channel),
        protocol.reason,
        protocol.scope,
        observed?.activeCount || 0,
      ),
      score: 1000 - (index * 100) + Math.min(observed?.activeCount || 0, 50),
    });
  });

  return [...suggestions.values()]
    .sort((a, b) => b.score - a.score || a.value.channel.localeCompare(b.value.channel))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.value);
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
  const suggestions = summary.suggestions || [];
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
        ...suggestions.map((suggestion): ui.LineworkRow => ({
          state: 'request',
          label: `watch ${suggestion.channel}`,
          text: `${suggestion.reason} Run: ${suggestion.command}`,
        })),
      ],
      footer: suggestions.length > 0
        ? 'arm the recommended watches: pd attention --subscribe-recommended'
        : (summary.peek ? 'peek only · nothing marked read' : 'attention clear'),
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
  const suggestions = summary.suggestions || [];
  const now = Date.now();

  if (items.length === 0) {
    console.log('Nothing new.');
    if (subs.length > 0) {
      console.log(`  Subscribed: ${subs.join(', ')}`);
    } else {
      console.log('  This agent receives direct inbox messages, but is not watching any coordination channels.');
    }
    if (suggestions.length > 0) {
      console.log('');
      console.log('Suggested watches:');
      suggestions.forEach((suggestion, index) => {
        const activity = suggestion.activeCount > 0 ? ` · ${suggestion.activeCount} observed event(s)` : '';
        console.log(`  ${index + 1}. ${suggestion.channel} (${suggestion.scope}${activity})`);
        console.log(`     ${suggestion.reason}`);
        console.log(`     ${suggestion.command}`);
      });
      console.log('');
      console.log('Arm the recommended set: pd attention --subscribe-recommended');
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

async function discoverAttentionSuggestions(subscriptions: string[], options: CLIOptions): Promise<AttentionSuggestion[]> {
  const params = new URLSearchParams({
    projectDir: resolveTargetDir(options),
    observed: 'true',
  });
  try {
    const res: PdFetchResponse = await attentionFetch(`/channels/discover?${params}`);
    const data = await res.json() as { channels?: DiscoveredChannel[] };
    return rankAttentionSuggestions(Array.isArray(data.channels) ? data.channels : [], subscriptions);
  } catch {
    // Attention is a session-start primitive. Discovery enrichment must never
    // make the inbox read fail; the exact protocol channel is still safe to
    // recommend when the registry is temporarily unavailable.
    return rankAttentionSuggestions([], subscriptions);
  }
}

async function resolveSubscriptionTarget(channel: string, options: CLIOptions): Promise<string> {
  const protocol = ATTENTION_PROTOCOL_CHANNELS.find((entry) => entry.channel === channel);
  if (protocol?.scope === 'worktree') {
    const res: PdFetchResponse = await attentionFetch('/channels/ensure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: protocol.channel,
        scope: protocol.scope,
        description: protocol.reason,
        projectDir: resolveTargetDir(options),
      }),
    });
    const data = await res.json() as { error?: string; channel?: { physicalName?: string } };
    if (!res.ok || typeof data.channel?.physicalName !== 'string') {
      throw new Error(data.error || `failed to declare ${channel}`);
    }
    return data.channel.physicalName;
  }

  if (protocol?.scope === 'global') return protocol.channel;

  if (options['raw-channel']) return channel;

  const params = new URLSearchParams({ projectDir: resolveTargetDir(options) });
  const res: PdFetchResponse = await attentionFetch(
    `/channels/resolve/${encodeURIComponent(channel)}?${params}`
  );
  const data = await res.json() as { error?: string; channel?: { physicalName?: string } };
  if (res.ok && typeof data.channel?.physicalName === 'string' && data.channel.physicalName.trim()) {
    return data.channel.physicalName;
  }
  if (res.status === 404) return channel;
  throw new Error(data.error || `Failed to resolve channel ${channel}`);
}

async function subscribeAgent(agentId: string, channel: string): Promise<{ subscribed: boolean; channel: string }> {
  const res: PdFetchResponse = await attentionFetch('/attention/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, channel }),
  });
  const data = (await res.json()) as { success: boolean; subscribed?: boolean; error?: string };
  if (!res.ok || !data.success) throw new Error(data.error || 'subscribe failed');
  return { subscribed: data.subscribed === true, channel };
}

async function handleSubscribe(agentId: string, channel: string, options: CLIOptions): Promise<void> {
  let physicalChannel: string;
  let data: { subscribed: boolean; channel: string };
  try {
    physicalChannel = await resolveSubscriptionTarget(channel, options);
    data = await subscribeAgent(agentId, physicalChannel);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : 'subscribe failed');
    process.exit(1);
    return;
  }
  if (isJson(options)) {
    console.log(JSON.stringify({
      success: true,
      agentId,
      channel,
      physicalChannel,
      subscribed: data.subscribed,
    }, null, 2));
    return;
  }
  if (!isQuiet(options)) {
    if (data.subscribed) {
      ui.success(`Subscribed ${agentId} to ${channel}`);
      if (physicalChannel !== channel) console.log(`  resolved: ${physicalChannel}`);
    } else {
      console.log(`Already subscribed: ${agentId} -> ${channel}`);
    }
  }
}

async function handleSubscribeRecommended(agentId: string, options: CLIOptions): Promise<void> {
  let current: string[];
  try {
    current = await listAgentSubscriptions(agentId);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : 'failed to inspect current subscriptions');
    process.exit(1);
    return;
  }
  const suggestions = await discoverAttentionSuggestions(current, options);
  const results: Array<{ channel: string; physicalChannel: string; subscribed: boolean }> = [];

  for (const suggestion of suggestions) {
    try {
      const physicalChannel = await resolveSubscriptionTarget(suggestion.channel, options);
      const result = await subscribeAgent(agentId, physicalChannel);
      results.push({ channel: suggestion.channel, physicalChannel, subscribed: result.subscribed });
    } catch (error) {
      ui.error(`Could not subscribe to ${suggestion.channel}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
      return;
    }
  }

  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, agentId, subscriptions: results }, null, 2));
    return;
  }
  if (isQuiet(options)) return;
  if (results.length === 0) {
    console.log('No additional recommended channels are available for this project.');
    return;
  }
  ui.success(`Armed ${results.length} recommended attention watch${results.length === 1 ? '' : 'es'}`);
  for (const result of results) {
    const state = result.subscribed ? 'subscribed' : 'already subscribed';
    console.log(`  ${result.channel} · ${state}${result.physicalChannel !== result.channel ? ` · ${result.physicalChannel}` : ''}`);
  }
  console.log('  Next: pd attention --peek');
}

async function handleUnsubscribe(agentId: string, channel: string, options: CLIOptions): Promise<void> {
  let physicalChannel = channel;
  try {
    physicalChannel = await resolveSubscriptionTarget(channel, options);
  } catch {
    // Preserve idempotent unsubscribe behavior for channels that no longer
    // resolve in the registry; the literal stored value may still exist.
  }
  const res: PdFetchResponse = await attentionFetch('/attention/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, channel: physicalChannel }),
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
      if (physicalChannel !== channel) console.log(`  resolved: ${physicalChannel}`);
    } else {
      console.log(`Not subscribed: ${agentId} -> ${channel}`);
    }
  }
}

async function listAgentSubscriptions(agentId: string): Promise<string[]> {
  const params = new URLSearchParams({ agentId });
  const res: PdFetchResponse = await attentionFetch(`/attention/subscriptions?${params}`);
  const data = (await res.json()) as { success: boolean; agentId?: string; channels?: string[]; error?: string };
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'failed to list subscriptions');
  }
  return data.channels || [];
}

async function handleListSubscriptions(agentId: string, options: CLIOptions): Promise<void> {
  let channels: string[];
  try {
    channels = await listAgentSubscriptions(agentId);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : 'failed to list subscriptions');
    process.exit(1);
    return;
  }
  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, agentId, channels }, null, 2));
    return;
  }
  if (channels.length === 0) {
    console.log(`No subscriptions for ${agentId}`);
  } else {
    console.log(`Subscriptions for ${agentId}:`);
    for (const ch of channels) console.log(`  - ${ch}`);
  }
}

export async function handleAttention(options: CLIOptions, deps: AttentionHandlerDeps = {}): Promise<void> {
  const agentId = resolveAgentId(options);
  if (!agentId) {
    const identityRequired =
      (typeof options.subscribe === 'string' && options.subscribe.trim().length > 0) ||
      options['subscribe-recommended'] === true ||
      (typeof options.unsubscribe === 'string' && options.unsubscribe.trim().length > 0) ||
      options.subscriptions === true;
    if (identityRequired) {
      ui.error('This attention operation needs an agent identity. Start a session or pass --agent <id>.');
      process.exit(2);
      return;
    }

    const empty = unboundAttentionSummary(options.peek === true);
    if (isJson(options)) console.log(JSON.stringify(empty, null, 2));
    else if (!isQuiet(options)) console.log('Attention clear (no active agent session).');
    return;
  }

  // Subscribe / unsubscribe / list subscriptions
  if (typeof options.subscribe === 'string' && options.subscribe.trim()) {
    const channel = options.subscribe.trim();
    const validation = validateChannel(channel);
    if (!validation.valid) {
      ui.error(validation.error || 'invalid channel');
      process.exit(2);
      return;
    }
    return handleSubscribe(agentId, channel, options);
  }
  if (options['subscribe-recommended'] === true) {
    return handleSubscribeRecommended(agentId, options);
  }
  if (typeof options.unsubscribe === 'string' && options.unsubscribe.trim()) {
    const channel = options.unsubscribe.trim();
    const validation = validateChannel(channel);
    if (!validation.valid) {
      ui.error(validation.error || 'invalid channel');
      process.exit(2);
      return;
    }
    return handleUnsubscribe(agentId, channel, options);
  }
  if (options.subscriptions === true) {
    return handleListSubscriptions(agentId, options);
  }

  // Default: compose attention
  const params = new URLSearchParams({ agentId });
  if (options.peek === true) params.set('peek', 'true');
  if (options.limit !== undefined) params.set('limit', String(options.limit));

  const fetchAttention = deps.fetch ?? attentionFetch;
  const res: PdFetchResponse = await fetchAttention(`/attention?${params}`);
  const data = (await res.json()) as unknown as AttentionSummary;
  if (!res.ok || !data.success) {
    ui.error(data.error || 'attention fetch failed');
    process.exit(1);
  }

  if ((data.items || []).length === 0) {
    // SessionStart must remain a strict one-request fast path. The old empty
    // state synchronously called /channels/discover?observed=true, turning a
    // completed inbox read into a whole-history channel scan that was observed
    // taking almost a minute under daemon contention. Stable protocol channels
    // can be ranked locally; richer discovery remains available explicitly via
    // `pd attention --subscribe-recommended`.
    data.suggestions = rankAttentionSuggestions([], data.subscriptions || []);
  }

  data.bound = true;

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printPretty(data, options);

  // A normal interactive attention pass is also an ordinary work entry
  // point. It may offer the same bounded server-derived card as `pd begin`,
  // but only after the attention receipt is already complete. The card helper
  // itself preserves capability checks, a 150 ms deadline, no-color rendering,
  // and the exact JSON/quiet/noninteractive contracts above.
  const context = readCurrentContext();
  const offerSugarParley = deps.sugarParleyOffer ?? showSugarParleyExperience;
  await offerSugarParley(context?.agentId, context?.sessionId, options);
}
