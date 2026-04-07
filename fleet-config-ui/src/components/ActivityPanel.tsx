import { useMemo } from 'react';
import type { ActivityEntry, FleetEvent, StoryNote } from '../types';
import { agentColor } from '../types';
import { isMeaningfulActivityEntry, isMeaningfulStory, summarizeActivityEntry } from '../activityFeed';

interface Props {
  fleetEvents: FleetEvent[];
  activity: ActivityEntry[];
  stories: StoryNote[];
  selectedAgent?: string | null;
  agentSignals: Array<{
    name: string;
    summary: string;
    label: string | null;
    timestamp: number;
    files: string[];
  }>;
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
  if (type === 'agent_started') return 'var(--pd-warning)';
  return 'var(--pd-success)';
}

function activityAccent(type: string): string {
  if (type.includes('cleanup') || type.includes('stop')) return 'var(--pd-accent)';
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

export default function ActivityPanel({ fleetEvents, activity, stories, selectedAgent, agentSignals, onSelectAgent }: Props) {
  const feed = useMemo<FeedItem[]>(() => {
    const fleetItems: FeedItem[] = fleetEvents.map((event, index) => ({
      id: `fleet-${event.timestamp}-${event.agent ?? 'system'}-${index}`,
      kind: 'fleet',
      timestamp: event.timestamp,
      title: `${event.agent ?? 'system'} ${event.type.replace(/_/g, ' ')}`,
      subtitle: typeof event.details?.error === 'string'
        ? event.details.error
        : typeof event.details?.status === 'string'
          ? `status: ${event.details.status}`
          : event.project ?? 'fleet lifecycle',
      accent: fleetAccent(event.type),
      agent: event.agent ?? null,
    }));

    const activityItems: FeedItem[] = activity
      .filter(isMeaningfulActivityEntry)
      .map((entry) => ({
        id: `activity-${entry.id}`,
        kind: 'activity' as const,
        timestamp: entry.timestamp,
        title: entry.type,
        subtitle: summarizeActivityEntry(entry),
        accent: activityAccent(entry.type),
        agent: entry.agentId,
      }));

    const storyItems: FeedItem[] = stories
      .filter(isMeaningfulStory)
      .map((story) => {
        const storyAgent = detectStoryAgent(story, agentSignals.map((signal) => signal.name));
        return {
          id: `story-${story.id}`,
          kind: 'story' as const,
          timestamp: story.createdAt,
          title: `${story.type}${storyAgent ? ` · ${storyAgent}` : ''}`,
          subtitle: story.content.trim(),
          accent: storyAccent(story.type),
          agent: storyAgent,
        };
      });

    return [...storyItems, ...fleetItems, ...activityItems]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter((item) => !selectedAgent || item.agent === selectedAgent || item.subtitle.toLowerCase().includes(selectedAgent.toLowerCase()))
      .slice(0, 150);
  }, [activity, agentSignals, fleetEvents, selectedAgent, stories]);

  const visibleSignals = useMemo(
    () => agentSignals.filter((signal) => !selectedAgent || signal.name === selectedAgent),
    [agentSignals, selectedAgent],
  );

  return (
    <div className="grid h-full min-h-0 gap-4 p-4" style={{ gridTemplateColumns: 'minmax(0, 1.85fr) minmax(320px, 0.95fr)' }}>
      <section className="rounded-xl overflow-hidden min-h-0 flex flex-col" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <div>
            <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>ACTIVITY LOG</div>
            <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>
              {selectedAgent ? `Recent work for ${selectedAgent}` : 'Fleet + daemon timeline'}
            </div>
          </div>
          <div className="text-[10px] font-mono" style={{ color: 'var(--pd-muted)' }}>{feed.length} events</div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {feed.length === 0 ? (
            <div className="px-4 py-10 text-sm text-center" style={{ color: 'var(--pd-muted)' }}>
              {selectedAgent ? `No meaningful work is attributed to ${selectedAgent} yet.` : 'No meaningful fleet activity yet.'}
            </div>
          ) : (
            feed.map((item) => (
              <div
                key={item.id}
                className="px-4 py-3 flex gap-3"
                style={{ borderBottom: '1px solid color-mix(in srgb, var(--pd-border) 72%, transparent)' }}
              >
                <div className="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.accent }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--pd-text)' }}>
                      {item.agent ? <span style={{ color: agentColor(item.agent) }}>{item.agent}</span> : item.title}
                      {item.agent ? <span style={{ color: 'var(--pd-text)' }}> {item.title.replace(`${item.agent} `, '')}</span> : null}
                    </div>
                    <div className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--pd-dim)' }}>
                      {relativeTime(item.timestamp)}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                    {item.subtitle}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl overflow-hidden min-h-0 flex flex-col" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>AGENTS</div>
          <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>
            {selectedAgent ? `Recent work for ${selectedAgent}` : 'Per-agent recent work and mutations'}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {visibleSignals.length === 0 ? (
            <div className="px-4 py-10 text-sm text-center" style={{ color: 'var(--pd-muted)' }}>
              No non-empty agent signals yet.
            </div>
          ) : (
            visibleSignals.map((signal) => (
              <div
                key={signal.name}
                className="px-4 py-3"
                style={{ borderBottom: '1px solid color-mix(in srgb, var(--pd-border) 72%, transparent)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => onSelectAgent?.(signal.name)}
                    className="text-left"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: agentColor(signal.name) }}>
                      {signal.name}
                    </div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--pd-accent)' }}>
                      {signal.label ?? 'recent work'}
                    </div>
                  </button>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                    {relativeTime(signal.timestamp)}
                  </div>
                </div>
                <div className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--pd-text)' }}>
                  {signal.summary}
                </div>
                {signal.files.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {signal.files.slice(0, 4).map((filePath) => (
                      <span
                        key={filePath}
                        className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                        style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
                      >
                        {filePath}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
