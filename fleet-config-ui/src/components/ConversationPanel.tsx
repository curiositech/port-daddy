import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GitBranch, Inbox, MessageSquareText, RadioTower, RefreshCw, Route, Send, Waypoints } from 'lucide-react';
import type { ActivityEntry, InboxMessage, StoryNote } from '../types';
import { agentColor } from '../types';
import { summarizeActivityEntry } from '../activityFeed';
import { fetchAgentInbox, fetchOperatorActors } from '../api';
import type { ChannelEvent } from './ChannelLog';

interface AgentSummary {
  name: string;
  purpose?: string | null;
}

interface ConversationInboxMessage {
  message: InboxMessage;
  targetLabel: string;
  targetId: string;
}

interface ConversationItem {
  id: string;
  kind: 'channel' | 'inbox' | 'note' | 'activity';
  timestamp: number;
  from: string;
  to: string[];
  via: string;
  title: string;
  content: string;
  priority: 'normal' | 'direct' | 'callout' | 'handoff';
  participants: string[];
}

interface ConversationEdge {
  id: string;
  from: string;
  to: string;
  via: string;
  count: number;
  latestAt: number;
  priority: ConversationItem['priority'];
}

interface Props {
  daemonKey: string;
  projectDir?: string;
  projectName?: string | null;
  agents: AgentSummary[];
  channelEvents: ChannelEvent[];
  activity: ActivityEntry[];
  stories: StoryNote[];
  selectedAgent?: string | null;
  onSelectAgent?: (agentName: string | null) => void;
  onOpenChannel?: (channelName: string) => void;
}

function relativeTime(timestamp: number): string {
  if (!timestamp) return 'unknown';
  const diff = Date.now() - timestamp;
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortTime(timestamp: number): string {
  if (!timestamp) return 'n/a';
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function cleanContent(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function participantLabel(value: string): string {
  if (value.startsWith('#')) return value;
  if (value === 'shared-notes') return 'shared notes';
  if (value === 'operator') return 'operator';
  if (value === 'system') return 'system';
  return value;
}

function priorityColor(priority: ConversationItem['priority']): string {
  if (priority === 'callout') return 'var(--pd-accent)';
  if (priority === 'direct') return 'var(--pd-success)';
  if (priority === 'handoff') return 'var(--pd-warning)';
  return 'var(--pd-muted)';
}

function channelPriority(event: ChannelEvent): ConversationItem['priority'] {
  if (event.channel.includes('coordination:inconsistency')) return 'callout';
  if (event.outcome === 'findings') return 'callout';
  return 'normal';
}

function storyPriority(story: StoryNote): ConversationItem['priority'] {
  const normalized = `${story.type} ${story.content}`.toLowerCase();
  if (normalized.includes('handoff')) return 'handoff';
  if (normalized.includes('overlap') || normalized.includes('inconsistency') || normalized.includes('conflict')) return 'callout';
  return 'normal';
}

function detectMentionedAgents(text: string, agents: AgentSummary[]): string[] {
  const normalized = text.toLowerCase();
  return agents
    .map((agent) => agent.name)
    .filter((name) => normalized.includes(name.toLowerCase()));
}

function storySpeaker(story: StoryNote, agents: AgentSummary[]): string {
  if (story.agentId) return story.agentId;
  const haystack = `${story.sessionPurpose ?? ''} ${story.content}`;
  return detectMentionedAgents(haystack, agents)[0] ?? 'session';
}

function participantColor(name: string, agentNames: Set<string>): string {
  if (agentNames.has(name)) return agentColor(name);
  if (name.startsWith('#')) return 'var(--pd-accent)';
  if (name === 'shared-notes') return 'var(--pd-warning)';
  return 'var(--pd-muted)';
}

function buildEdges(items: ConversationItem[]): ConversationEdge[] {
  const edgeMap = new Map<string, ConversationEdge>();
  for (const item of items) {
    const targets = item.to.length > 0 ? item.to : ['shared-notes'];
    for (const target of targets) {
      const id = `${item.from}->${target}:${item.via}`;
      const existing = edgeMap.get(id);
      if (existing) {
        existing.count += 1;
        existing.latestAt = Math.max(existing.latestAt, item.timestamp);
        if (item.priority === 'callout' || (item.priority === 'direct' && existing.priority === 'normal')) {
          existing.priority = item.priority;
        }
      } else {
        edgeMap.set(id, {
          id,
          from: item.from,
          to: target,
          via: item.via,
          count: 1,
          latestAt: item.timestamp,
          priority: item.priority,
        });
      }
    }
  }
  return Array.from(edgeMap.values())
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return right.latestAt - left.latestAt;
    })
    .slice(0, 12);
}

function itemMatchesAgent(item: ConversationItem, agentName: string): boolean {
  return item.participants.includes(agentName)
    || item.from === agentName
    || item.to.includes(agentName)
    || item.content.toLowerCase().includes(agentName.toLowerCase());
}

export default function ConversationPanel({
  daemonKey,
  projectDir,
  projectName,
  agents,
  channelEvents,
  activity,
  stories,
  selectedAgent,
  onSelectAgent,
  onOpenChannel,
}: Props) {
  const [inboxMessages, setInboxMessages] = useState<ConversationInboxMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [lastInboxLoadAt, setLastInboxLoadAt] = useState<number | null>(null);
  const [focusedKind, setFocusedKind] = useState<ConversationItem['kind'] | 'all'>('all');

  const agentNames = useMemo(() => new Set(agents.map((agent) => agent.name)), [agents]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function loadInboxMessages() {
      if (!projectDir) {
        setInboxMessages([]);
        setInboxError(null);
        return;
      }
      setInboxLoading(true);
      setInboxError(null);
      try {
        const actors = await fetchOperatorActors({ projectDir, project: projectName ?? undefined, limit: 16 });
        const targets = actors
          .filter((actor) => actor.inboxTarget)
          .sort((left, right) => (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0))
          .slice(0, 12);
        const messageGroups = await Promise.all(targets.map(async (actor) => {
          const messages = await fetchAgentInbox(actor.inboxTarget, { limit: 5 });
          return messages.map((message) => ({
            message,
            targetLabel: actor.label || actor.fleetAgentName || actor.id,
            targetId: actor.inboxTarget,
          }));
        }));
        if (!cancelled) {
          setInboxMessages(messageGroups.flat());
          setLastInboxLoadAt(Date.now());
        }
      } catch (error) {
        if (!cancelled) setInboxError((error as Error).message);
      } finally {
        if (!cancelled) setInboxLoading(false);
      }
    }

    void loadInboxMessages();
    timer = window.setInterval(() => void loadInboxMessages(), 10000);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [daemonKey, projectDir, projectName]);

  const conversations = useMemo<ConversationItem[]>(() => {
    const channelItems: ConversationItem[] = channelEvents.map((event) => {
      const targets = event.triggered.length > 0 ? event.triggered : [`#${event.channel}`];
      const participants = [event.publisher, ...event.triggered].filter((value) => value && value !== 'system');
      return {
        id: `channel-${event.id}`,
        kind: 'channel',
        timestamp: event.timestamp ?? Date.now(),
        from: event.publisher || 'system',
        to: targets,
        via: `#${event.channel}`,
        title: event.outcome === 'findings' ? 'Channel finding' : 'Channel broadcast',
        content: event.message,
        priority: channelPriority(event),
        participants,
      };
    });

    const noteItems: ConversationItem[] = stories.map((story) => {
      const from = storySpeaker(story, agents);
      const mentioned = detectMentionedAgents(story.content, agents).filter((name) => name !== from);
      const participants = [...new Set([from, ...mentioned].filter((value) => value !== 'session'))];
      return {
        id: `note-${story.id}`,
        kind: 'note',
        timestamp: story.createdAt,
        from,
        to: mentioned.length > 0 ? mentioned : ['shared-notes'],
        via: story.type,
        title: story.type,
        content: story.content,
        priority: storyPriority(story),
        participants,
      };
    });

    const inboxItems: ConversationItem[] = inboxMessages.map(({ message, targetLabel, targetId }) => {
      const from = message.from?.trim() || 'operator';
      const target = targetLabel || targetId || message.agentId;
      return {
        id: `inbox-${message.id}`,
        kind: 'inbox',
        timestamp: message.createdAt,
        from,
        to: [target],
        via: 'inbox',
        title: message.read ? 'Inbox message' : 'Unread inbox message',
        content: message.content,
        priority: 'direct',
        participants: [from, target, message.agentId].filter((value) => agentNames.has(value)),
      };
    });

    const activityItems: ConversationItem[] = activity
      .filter((entry) => entry.type === 'message.publish')
      .map((entry) => {
        const summary = summarizeActivityEntry(entry);
        return {
          id: `activity-${entry.id}`,
          kind: 'activity' as const,
          timestamp: entry.timestamp,
          from: entry.agentId ?? 'system',
          to: entry.targetId ? [entry.targetId] : ['#message.publish'],
          via: entry.type,
          title: entry.type,
          content: summary,
          priority: (summary.toLowerCase().includes('inconsistency') ? 'callout' : 'normal') as ConversationItem['priority'],
          participants: [entry.agentId, entry.targetId].filter((value): value is string => !!value && agentNames.has(value)),
        };
      })
      .filter((item) => item.content.trim().length > 0);

    return [...channelItems, ...inboxItems, ...noteItems, ...activityItems]
      .filter((item) => item.content.trim().length > 0)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 220);
  }, [activity, agentNames, agents, channelEvents, inboxMessages, stories]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((item) => {
      if (focusedKind !== 'all' && item.kind !== focusedKind) return false;
      if (selectedAgent && !itemMatchesAgent(item, selectedAgent)) return false;
      return true;
    });
  }, [conversations, focusedKind, selectedAgent]);

  const edges = useMemo(() => buildEdges(filteredConversations), [filteredConversations]);
  const calloutCount = conversations.filter((item) => item.priority === 'callout').length;
  const directCount = conversations.filter((item) => item.kind === 'inbox').length;
  const channelCount = conversations.filter((item) => item.kind === 'channel').length;
  const noteCount = conversations.filter((item) => item.kind === 'note').length;

  const agentHeat = useMemo(() => {
    return agents.map((agent) => {
      const count = conversations.filter((item) => itemMatchesAgent(item, agent.name)).length;
      const latest = conversations.find((item) => itemMatchesAgent(item, agent.name));
      return { ...agent, count, latestAt: latest?.timestamp ?? 0 };
    }).sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return right.latestAt - left.latestAt;
    });
  }, [agents, conversations]);

  const maxEdgeCount = Math.max(1, ...edges.map((edge) => edge.count));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
            <MessageSquareText size={13} />
            <span>LIVE AGENT CONVERSATIONS</span>
          </div>
          <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>
            Notes, inboxes, and channel broadcasts in one operator view
          </div>
          <div className="mt-1 max-w-4xl text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
            This is the visual layer for the coordination story: who spoke, where it was published, which agents were addressed, and which conflicts became operator-worthy callouts.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
            {filteredConversations.length}/{conversations.length} visible
          </span>
          <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' }}>
            {directCount} inbox
          </span>
          <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: calloutCount > 0 ? 'var(--pd-accent-surface)' : 'var(--pd-bg)', color: calloutCount > 0 ? 'var(--pd-accent)' : 'var(--pd-muted)', border: `1px solid ${calloutCount > 0 ? 'var(--pd-accent-border)' : 'var(--pd-border)'}` }}>
            {calloutCount} callouts
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 xl:grid-cols-[minmax(270px,0.8fr)_minmax(0,1.25fr)_minmax(360px,0.95fr)]">
        <section className="pd-card flex min-h-0 flex-col overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="pd-kicker">Conversation heat</div>
                <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>Agent lanes</div>
              </div>
              {selectedAgent ? (
                <button
                  type="button"
                  onClick={() => onSelectAgent?.(null)}
                  className="rounded-md px-2 py-1 text-[10px] font-semibold"
                  style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {agentHeat.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--pd-muted)' }}>
                No configured agents are visible yet.
              </div>
            ) : (
              agentHeat.map((agent) => {
                const selected = selectedAgent === agent.name;
                const color = agentColor(agent.name);
                return (
                  <button
                    key={agent.name}
                    type="button"
                    onClick={() => onSelectAgent?.(selected ? null : agent.name)}
                    className="w-full px-4 py-3 text-left transition-colors"
                    style={{
                      borderBottom: '1px solid color-mix(in srgb, var(--pd-border) 72%, transparent)',
                      backgroundColor: selected ? 'var(--pd-bg)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
                        {agent.name}
                      </span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-mono" style={{ backgroundColor: 'var(--pd-surface-3)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
                        {agent.count}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--pd-surface-3)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, Math.max(6, agent.count * 18))}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                    <div className="mt-2 line-clamp-2 text-[11px]" style={{ color: 'var(--pd-muted)' }}>
                      {agent.purpose || (agent.latestAt ? `Latest ${relativeTime(agent.latestAt)}` : 'No attributed messages yet.')}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="pd-card flex min-h-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
            <div>
              <div className="pd-kicker">Conversation graph</div>
              <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>Who is talking through which primitive</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'channel', 'inbox', 'note'] as Array<typeof focusedKind>).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setFocusedKind(kind)}
                  className="rounded-md px-2 py-1 text-[10px] font-semibold capitalize"
                  style={{
                    backgroundColor: focusedKind === kind ? 'var(--pd-accent-surface)' : 'var(--pd-bg)',
                    color: focusedKind === kind ? 'var(--pd-accent)' : 'var(--pd-muted)',
                    border: `1px solid ${focusedKind === kind ? 'var(--pd-accent-border)' : 'var(--pd-border)'}`,
                  }}
                >
                  {kind}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
            <Metric label="channels" value={channelCount} icon={<RadioTower size={13} />} />
            <Metric label="notes" value={noteCount} icon={<Waypoints size={13} />} />
            <Metric label="direct" value={directCount} icon={<Inbox size={13} />} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {edges.length === 0 ? (
              <div className="rounded-xl border px-4 py-10 text-center text-sm" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)' }}>
                No conversations match the current filters yet.
              </div>
            ) : (
              <div className="grid gap-3">
                {edges.map((edge) => {
                  const fromColor = participantColor(edge.from, agentNames);
                  const toColor = participantColor(edge.to, agentNames);
                  const strength = Math.max(8, Math.round((edge.count / maxEdgeCount) * 100));
                  return (
                    <div key={edge.id} className="rounded-xl border px-3 py-3" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(100px,0.45fr)_minmax(0,0.8fr)]">
                        <ParticipantPill label={participantLabel(edge.from)} color={fromColor} align="left" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="h-px flex-1" style={{ backgroundColor: priorityColor(edge.priority), opacity: 0.65 }} />
                            <Route size={14} color={priorityColor(edge.priority)} />
                            <div className="h-px flex-1" style={{ backgroundColor: priorityColor(edge.priority), opacity: 0.65 }} />
                          </div>
                          <div className="mt-1 truncate text-center font-mono text-[10px]" style={{ color: priorityColor(edge.priority) }}>
                            {edge.via}
                          </div>
                        </div>
                        <ParticipantPill label={participantLabel(edge.to)} color={toColor} align="right" />
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--pd-surface-3)' }}>
                          <div className="h-full rounded-full" style={{ width: `${strength}%`, backgroundColor: priorityColor(edge.priority) }} />
                        </div>
                        <span className="font-mono text-[10px]" style={{ color: 'var(--pd-dim)' }}>
                          {edge.count} item{edge.count === 1 ? '' : 's'} · {relativeTime(edge.latestAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="pd-card flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
            <div>
              <div className="pd-kicker">Transcript</div>
              <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                Latest meaningful exchanges
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: inboxError ? 'var(--pd-accent)' : 'var(--pd-dim)' }}>
              <RefreshCw size={12} className={inboxLoading ? 'animate-spin' : ''} />
              <span>{inboxError ?? (lastInboxLoadAt ? `inbox ${shortTime(lastInboxLoadAt)}` : 'loading inbox')}</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredConversations.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--pd-muted)' }}>
                No transcript entries match this view yet.
              </div>
            ) : (
              filteredConversations.slice(0, 100).map((item) => (
                <article
                  key={item.id}
                  className="px-4 py-3"
                  style={{
                    borderBottom: '1px solid color-mix(in srgb, var(--pd-border) 72%, transparent)',
                    backgroundColor: item.priority === 'callout' ? 'color-mix(in srgb, var(--pd-accent-surface) 32%, transparent)' : 'transparent',
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <ConversationKindIcon kind={item.kind} />
                      <button
                        type="button"
                        onClick={() => agentNames.has(item.from) ? onSelectAgent?.(item.from) : undefined}
                        className="font-mono text-[10px] font-semibold"
                        style={{ color: participantColor(item.from, agentNames) }}
                      >
                        {participantLabel(item.from)}
                      </button>
                      <span className="text-[10px]" style={{ color: 'var(--pd-muted)' }}>via</span>
                      {item.via.startsWith('#') ? (
                        <button
                          type="button"
                          onClick={() => onOpenChannel?.(item.via.slice(1))}
                          className="font-mono text-[10px] font-semibold"
                          style={{ color: 'var(--pd-accent)' }}
                        >
                          {item.via}
                        </button>
                      ) : (
                        <span className="font-mono text-[10px] font-semibold" style={{ color: priorityColor(item.priority) }}>{item.via}</span>
                      )}
                    </div>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--pd-dim)' }}>
                      {relativeTime(item.timestamp)}
                    </span>
                  </div>
                  <div className="mt-2 text-[12px] font-semibold" style={{ color: 'var(--pd-text)' }}>
                    {item.title}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                    {cleanContent(item.content)}
                  </div>
                  {item.to.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {item.to.slice(0, 6).map((target) => (
                        <span
                          key={`${item.id}-${target}`}
                          className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
                          style={{
                            backgroundColor: 'var(--pd-bg)',
                            color: participantColor(target, agentNames),
                            border: '1px solid var(--pd-border)',
                          }}
                        >
                          to {participantLabel(target)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--pd-dim)' }}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 font-mono text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>
        {value}
      </div>
    </div>
  );
}

function ParticipantPill({ label, color, align }: { label: string; color: string; align: 'left' | 'right' }) {
  return (
    <div
      className={`min-w-0 rounded-lg border px-2.5 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ borderColor: color, backgroundColor: 'color-mix(in srgb, var(--pd-surface) 72%, var(--pd-bg))' }}
    >
      <div className="truncate font-mono text-[11px] font-semibold" style={{ color }}>{label}</div>
    </div>
  );
}

function ConversationKindIcon({ kind }: { kind: ConversationItem['kind'] }) {
  if (kind === 'inbox') return <Send size={12} color="var(--pd-success)" />;
  if (kind === 'note') return <Waypoints size={12} color="var(--pd-warning)" />;
  if (kind === 'activity') return <GitBranch size={12} color="var(--pd-muted)" />;
  return <RadioTower size={12} color="var(--pd-accent)" />;
}
