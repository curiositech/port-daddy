import { useMemo } from 'react';
import type { ActivityEntry, FleetEvent, StoryNote } from '../types';
import { agentColor } from '../types';
import { isMeaningfulActivityEntry, isMeaningfulStory, summarizeActivityEntry } from '../activityFeed';

interface Props {
  fleetEvents: FleetEvent[];
  activity: ActivityEntry[];
  stories: StoryNote[];
}

interface RailItem {
  id: string;
  timestamp: number;
  label: string;
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
  if (type === 'agent_paused') return 'var(--pd-warning)';
  if (type === 'agent_resumed') return 'var(--pd-info, var(--pd-success))';
  if (type === 'agent_started') return 'var(--pd-warning)';
  return 'var(--pd-success)';
}

function activityAccent(type: string): string {
  if (type.includes('cleanup') || type.includes('stop') || type.includes('error')) return 'var(--pd-accent)';
  if (type.includes('claim') || type.includes('start') || type.includes('register')) return 'var(--pd-success)';
  if (type.includes('publish') || type.includes('heartbeat')) return 'var(--pd-warning)';
  return 'var(--pd-muted)';
}

export default function ActivityRail({ fleetEvents, activity, stories }: Props) {
  const feed = useMemo<RailItem[]>(() => {
    const fleetItems: RailItem[] = fleetEvents.map((event, index) => ({
      id: `fleet-${event.timestamp}-${event.agent ?? 'system'}-${index}`,
      timestamp: event.timestamp,
      label: event.agent ? `${event.agent} ${event.type.replace(/_/g, ' ')}` : event.type.replace(/_/g, ' '),
      subtitle: typeof event.details?.error === 'string'
        ? event.details.error
        : typeof event.details?.info === 'string'
          ? event.details.info
        : typeof event.details?.status === 'string'
          ? `status: ${event.details.status}`
          : event.project ?? 'fleet lifecycle',
      accent: fleetAccent(event.type),
      agent: event.agent ?? null,
    }));

    const activityItems: RailItem[] = activity
      .filter(isMeaningfulActivityEntry)
      .map((entry) => {
        const agent = entry.agentId || (typeof entry.metadata?.agentId === 'string' ? entry.metadata.agentId : null);
        return {
          id: `activity-${entry.id}`,
          timestamp: entry.timestamp,
          label: agent ? `${agent} ${entry.type}` : entry.type,
          subtitle: summarizeActivityEntry(entry),
          accent: activityAccent(entry.type),
          agent,
        };
      });

    const storyItems: RailItem[] = stories
      .filter(isMeaningfulStory)
      .map((story) => ({
        id: `story-${story.id}`,
        timestamp: story.createdAt,
        label: story.type,
        subtitle: story.content,
        accent: 'var(--pd-info, var(--pd-accent))',
        agent: story.agentId ?? null,
      }));

    return [...fleetItems, ...activityItems, ...storyItems]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 80);
  }, [activity, fleetEvents, stories]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--pd-surface-3)' }}>
      <div className="px-4 py-2.5 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <span className="text-[11px] font-semibold tracking-wider" style={{ color: 'var(--pd-muted)' }}>ACTIVITY LOG</span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>{feed.length} items</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {feed.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--pd-muted)' }}>
            Waiting for activity...
          </div>
        ) : (
          feed.map((item) => (
            <div key={item.id} className="rounded-lg px-3 py-2" style={{ backgroundColor: 'color-mix(in srgb, var(--pd-surface) 78%, transparent)', border: '1px solid color-mix(in srgb, var(--pd-border) 70%, transparent)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.accent }} />
                    <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--pd-text)' }}>
                      {item.agent ? <span style={{ color: agentColor(item.agent) }}>{item.agent}</span> : null}
                      {item.agent ? <span style={{ color: 'var(--pd-text)' }}> {item.label.replace(`${item.agent} `, '')}</span> : item.label}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                    {item.subtitle}
                  </div>
                </div>
                <div className="text-[9px] font-mono flex-shrink-0" style={{ color: 'var(--pd-dim)' }}>
                  {relativeTime(item.timestamp)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
