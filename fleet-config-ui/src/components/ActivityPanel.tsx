import { useMemo } from 'react';
import type { ActivityEntry, FleetEvent, StoryNote } from '../types';
import { agentColor } from '../types';

interface Props {
  fleetEvents: FleetEvent[];
  activity: ActivityEntry[];
  stories: StoryNote[];
}

type FeedItem =
  | {
      id: string;
      kind: 'fleet';
      timestamp: number;
      title: string;
      subtitle: string;
      accent: string;
      agent?: string | null;
    }
  | {
      id: string;
      kind: 'activity';
      timestamp: number;
      title: string;
      subtitle: string;
      accent: string;
      agent?: string | null;
    };

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

export default function ActivityPanel({ fleetEvents, activity, stories }: Props) {
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

    const activityItems: FeedItem[] = activity.map((entry) => ({
      id: `activity-${entry.id}`,
      kind: 'activity',
      timestamp: entry.timestamp,
      title: entry.type,
      subtitle: entry.details || entry.targetId || entry.agentId || 'daemon activity',
      accent: activityAccent(entry.type),
      agent: entry.agentId,
    }));

    return [...fleetItems, ...activityItems]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 150);
  }, [activity, fleetEvents]);

  return (
    <div className="grid gap-4 p-4" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(320px, 1fr)' }}>
      <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <div>
            <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>ACTIVITY LOG</div>
            <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>Fleet + daemon timeline</div>
          </div>
          <div className="text-[10px] font-mono" style={{ color: 'var(--pd-muted)' }}>{feed.length} events</div>
        </div>

        <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
          {feed.length === 0 ? (
            <div className="px-4 py-10 text-sm text-center" style={{ color: 'var(--pd-muted)' }}>
              Waiting for activity...
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

      <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>STORIES</div>
          <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>Recent notes and handoffs</div>
        </div>

        <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
          {stories.length === 0 ? (
            <div className="px-4 py-10 text-sm text-center" style={{ color: 'var(--pd-muted)' }}>
              No stories yet.
            </div>
          ) : (
            stories.map((story) => (
              <div
                key={story.id}
                className="px-4 py-3"
                style={{ borderBottom: '1px solid color-mix(in srgb, var(--pd-border) 72%, transparent)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--pd-accent)' }}>
                    {story.type}
                  </div>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                    {relativeTime(story.createdAt)}
                  </div>
                </div>
                <div className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--pd-text)' }}>
                  {story.content}
                </div>
                <div className="mt-2 text-[10px] font-mono" style={{ color: 'var(--pd-muted)' }}>
                  {story.sessionPurpose || story.sessionId}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
