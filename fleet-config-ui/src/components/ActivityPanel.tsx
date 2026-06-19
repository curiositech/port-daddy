import { useMemo } from 'react';
import type { ActivityEntry, FleetEvent, StoryNote } from '../types';
import { agentColor } from '../types';
import {
  activityTouchedFiles,
  isMeaningfulActivityEntry,
  isMeaningfulStory,
  summarizeActivityEntry,
} from '../activityFeed';
import { extractMentionedPaths } from '../fileMentions';
import FileActionLinks from './FileActionLinks';

interface Props {
  fleetEvents: FleetEvent[];
  activity: ActivityEntry[];
  stories: StoryNote[];
  selectedAgent?: string | null;
  allAgents: string[];
  agentSignals: Array<{
    name: string;
    summary: string;
    label: string | null;
    timestamp: number;
    files: string[];
  }>;
  projectDir?: string;
  onSelectAgent?: (agentName: string) => void;
}

interface FeedItem {
  id: string;
  kind: 'fleet' | 'activity' | 'story';
  timestamp: number;
  title: string;
  subtitle: string;
  accent: string;
  agent?: string | null;
  files: string[];
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fleetAccent(type: FleetEvent['type']): string {
  if (type === 'agent_failed') return 'var(--pd-accent)';
  if (type === 'agent_paused') return 'var(--pd-warning)';
  if (type === 'agent_resumed') return 'var(--pd-info, var(--pd-success))';
  if (type === 'agent_started') return 'var(--pd-warning)';
  return 'var(--pd-success)';
}

function activityAccent(type: string): string {
  if (type.includes('cleanup') || type.includes('stop') || type.includes('failed') || type.includes('error')) return 'var(--pd-accent)';
  if (type.includes('claim') || type.includes('start') || type.includes('register')) return 'var(--pd-success)';
  if (type.includes('publish') || type.includes('heartbeat')) return 'var(--pd-warning)';
  return 'var(--pd-muted)';
}

function storyAccent(type: string): string {
  if (type.toLowerCase().includes('handoff')) return 'var(--pd-accent)';
  return 'var(--pd-warning)';
}

function detectStoryAgent(story: StoryNote, agentNames: string[]): string | null {
  if (story.agentId && agentNames.includes(story.agentId)) {
    return story.agentId;
  }
  const haystack = `${story.sessionId} ${story.sessionPurpose ?? ''} ${story.content}`.toLowerCase();
  return agentNames.find((agent) => haystack.includes(agent.toLowerCase())) ?? null;
}

function summarizeFleetEvent(event: FleetEvent): string {
  if (typeof event.details?.error === 'string' && event.details.error.trim()) return event.details.error.trim();
  if (typeof event.details?.info === 'string' && event.details.info.trim()) return event.details.info.trim();
  if (typeof event.details?.status === 'string' && event.details.status.trim()) return `status: ${event.details.status.trim()}`;
  if (typeof event.details?.message === 'string' && event.details.message.trim()) return event.details.message.trim();
  if (event.type === 'agent_failed') return 'Agent failed without a surfaced summary.';
  return '';
}

function itemMatchesAgent(item: FeedItem, agentName: string): boolean {
  const needle = agentName.toLowerCase();
  return item.agent === agentName
    || item.title.toLowerCase().includes(needle)
    || item.subtitle.toLowerCase().includes(needle);
}

function dedupeFiles(files: string[]): string[] {
  return [...new Set(files.filter((filePath) => filePath.trim().length > 0))];
}

export default function ActivityPanel({ fleetEvents, activity, stories, selectedAgent, allAgents, agentSignals, projectDir, onSelectAgent }: Props) {
  const feed = useMemo<FeedItem[]>(() => {
    const fleetItems = fleetEvents
      .map((event, index) => {
        const summary = summarizeFleetEvent(event);
        if (!summary) return null;
        return {
          id: `fleet-${event.timestamp}-${event.agent ?? 'system'}-${index}`,
          kind: 'fleet' as const,
          timestamp: event.timestamp,
          title: event.type.replace(/_/g, ' '),
          subtitle: summary,
          accent: fleetAccent(event.type),
          agent: event.agent ?? null,
          files: extractMentionedPaths(summary),
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item);

    const activityItems: FeedItem[] = activity
      .filter(isMeaningfulActivityEntry)
      .map((entry) => {
        const agent = entry.agentId || (typeof entry.metadata?.agentId === 'string' ? entry.metadata.agentId : null);
        const summary = summarizeActivityEntry(entry);
        return {
          id: `activity-${entry.id}`,
          kind: 'activity' as const,
          timestamp: entry.timestamp,
          title: entry.type,
          subtitle: summary,
          accent: activityAccent(entry.type),
          agent,
          files: dedupeFiles([...activityTouchedFiles(entry), ...extractMentionedPaths(summary)]),
        };
      });

    const storyItems: FeedItem[] = stories
      .filter(isMeaningfulStory)
      .map((story) => {
        const storyAgent = detectStoryAgent(story, agentSignals.map((signal) => signal.name));
        const content = story.content.trim();
        return {
          id: `story-${story.id}`,
          kind: 'story' as const,
          timestamp: story.createdAt,
          title: story.type,
          subtitle: content,
          accent: storyAccent(story.type),
          agent: storyAgent,
          files: extractMentionedPaths(content),
        };
      });

    return [...storyItems, ...activityItems, ...fleetItems]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 180);
  }, [activity, agentSignals, fleetEvents, stories]);

  const orderedSignals = useMemo(
    () => [...agentSignals].sort((a, b) => b.timestamp - a.timestamp),
    [agentSignals],
  );

  const agentEntries = useMemo(() => {
    const signalMap = new Map(orderedSignals.map((signal) => [signal.name, signal]));
    return allAgents.map((name) => {
      const signal = signalMap.get(name) ?? null;
      const feedItem = feed.find((item) => itemMatchesAgent(item, name)) ?? null;
      const summary = signal?.summary ?? feedItem?.subtitle ?? 'No non-empty recent work is attributed yet.';
      const label = signal?.label ?? feedItem?.title ?? 'waiting';
      const timestamp = signal?.timestamp ?? feedItem?.timestamp ?? 0;
      const files = dedupeFiles([
        ...(signal?.files ?? []),
        ...(feedItem?.files ?? []),
      ]);
      return { name, summary, label, timestamp, files, hasSignal: !!signal || !!feedItem };
    });
  }, [allAgents, feed, orderedSignals]);

  const focusedAgent = useMemo(
    () => selectedAgent ?? agentEntries[0]?.name ?? orderedSignals[0]?.name ?? null,
    [agentEntries, orderedSignals, selectedAgent],
  );

  const focusedSignal = useMemo(
    () => agentEntries.find((signal) => signal.name === focusedAgent) ?? null,
    [agentEntries, focusedAgent],
  );

  const focusedFeed = useMemo(
    () => focusedAgent ? feed.filter((item) => itemMatchesAgent(item, focusedAgent)).slice(0, 80) : [],
    [feed, focusedAgent],
  );

  const focusedFiles = useMemo(
    () => dedupeFiles([
      ...(focusedSignal?.files ?? []),
      ...focusedFeed.flatMap((item) => item.files),
    ]).slice(0, 10),
    [focusedFeed, focusedSignal],
  );

  return (
    <div
      className="grid h-full min-h-0 gap-4 p-4"
      style={{ gridTemplateColumns: '280px minmax(0, 1.4fr) minmax(340px, 1fr)' }}
    >
      <section className="rounded-xl overflow-hidden min-h-0 flex flex-col" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>AGENTS</div>
          <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>
            Pick an agent to inspect real recent work
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {agentEntries.length === 0 ? (
            <div className="px-4 py-10 text-sm text-center" style={{ color: 'var(--pd-muted)' }}>
              No agents are configured for this fleet yet.
            </div>
          ) : (
            agentEntries.map((signal) => {
              const selected = signal.name === focusedAgent;
              return (
                <button
                  key={signal.name}
                  onClick={() => onSelectAgent?.(signal.name)}
                  className="w-full px-4 py-3 text-left transition-colors"
                  style={{
                    borderBottom: '1px solid color-mix(in srgb, var(--pd-border) 72%, transparent)',
                    backgroundColor: selected ? 'var(--pd-bg)' : 'transparent',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: agentColor(signal.name) }}>
                        {signal.name}
                      </div>
                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--pd-accent)' }}>
                        {signal.label ?? 'recent work'}
                      </div>
                    </div>
                    <div className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--pd-dim)' }}>
                      {signal.timestamp ? relativeTime(signal.timestamp) : 'no signal'}
                    </div>
                  </div>
                  <div
                    className="mt-2 text-[12px] leading-relaxed"
                    style={{
                      color: selected ? 'var(--pd-text)' : 'var(--pd-muted)',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {signal.summary}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-xl overflow-hidden min-h-0 flex flex-col" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>AGENT FOCUS</div>
          <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>
            {focusedAgent ? `What ${focusedAgent} has actually been doing` : 'Pick an agent to inspect'}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!focusedAgent || !focusedSignal ? (
            <div className="rounded-xl border px-4 py-8 text-sm text-center" style={{ color: 'var(--pd-muted)', borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
              No agent detail is available yet.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border px-4 py-4" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-semibold tracking-[0.14em]" style={{ color: agentColor(focusedAgent) }}>
                      {focusedAgent}
                    </div>
                    <div className="mt-2 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                      {focusedSignal.label ?? 'recent work'}
                    </div>
                  </div>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                    {focusedSignal.timestamp ? relativeTime(focusedSignal.timestamp) : 'awaiting signal'}
                  </div>
                </div>
                <div className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--pd-text)' }}>
                  {focusedSignal.summary}
                </div>
                {focusedFiles.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {focusedFiles.map((filePath) => (
                      <FileActionLinks
                        key={filePath}
                        filePath={filePath}
                        projectDir={projectDir}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
                  <div className="text-[10px] font-semibold tracking-[0.14em]" style={{ color: 'var(--pd-dim)' }}>
                    AGENT TIMELINE
                  </div>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                    {focusedFeed.length} items
                  </div>
                </div>
                <div className="max-h-[52vh] overflow-y-auto">
                  {focusedFeed.length === 0 ? (
                    <div className="px-4 py-8 text-sm text-center" style={{ color: 'var(--pd-muted)' }}>
                      No high-signal activity is attributed to {focusedAgent} yet.
                    </div>
                  ) : (
                    focusedFeed.map((item) => (
                      <div
                        key={item.id}
                        className="px-4 py-3"
                        style={{ borderBottom: '1px solid color-mix(in srgb, var(--pd-border) 72%, transparent)' }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: item.kind === 'story' ? 'var(--pd-accent)' : 'var(--pd-text)' }}>
                            {item.kind} · {item.title}
                          </div>
                          <div className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                            {relativeTime(item.timestamp)}
                          </div>
                        </div>
                        <div className="mt-2 text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--pd-muted)' }}>
                          {item.subtitle}
                        </div>
                        {item.files.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {item.files.slice(0, 4).map((filePath) => (
                              <FileActionLinks
                                key={filePath}
                                filePath={filePath}
                                projectDir={projectDir}
                                compact
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl overflow-hidden min-h-0 flex flex-col" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>PROJECT LOG</div>
          <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>
            Recent handoffs, findings, and non-empty work
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {feed.length === 0 ? (
            <div className="px-4 py-10 text-sm text-center" style={{ color: 'var(--pd-muted)' }}>
              No meaningful project activity yet.
            </div>
          ) : (
            feed.map((item) => {
              const emphasized = focusedAgent ? itemMatchesAgent(item, focusedAgent) : false;
              return (
                <div
                  key={item.id}
                  className="px-4 py-3"
                  style={{
                    borderBottom: '1px solid color-mix(in srgb, var(--pd-border) 72%, transparent)',
                    backgroundColor: emphasized ? 'color-mix(in srgb, var(--pd-accent-surface) 24%, transparent)' : 'transparent',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: item.agent ? agentColor(item.agent) : item.accent }}>
                      {item.agent ? `${item.agent} · ${item.title}` : item.title}
                    </div>
                    <div className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--pd-dim)' }}>
                      {relativeTime(item.timestamp)}
                    </div>
                  </div>
                  <div className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                    {item.subtitle}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
