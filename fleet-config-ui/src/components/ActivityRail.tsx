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
  allAgents?: string[];
  projectDir?: string;
}

interface RailItem {
  id: string;
  kind: 'fleet' | 'activity' | 'story';
  timestamp: number;
  label: string;
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
  if (type.includes('cleanup') || type.includes('stop') || type.includes('error')) return 'var(--pd-accent)';
  if (type.includes('claim') || type.includes('start') || type.includes('register')) return 'var(--pd-success)';
  if (type.includes('publish') || type.includes('heartbeat')) return 'var(--pd-warning)';
  return 'var(--pd-muted)';
}

function summarizeFleetEvent(event: FleetEvent): string {
  if (typeof event.details?.error === 'string' && event.details.error.trim()) return event.details.error.trim();
  if (typeof event.details?.info === 'string' && event.details.info.trim()) return event.details.info.trim();
  if (typeof event.details?.status === 'string' && event.details.status.trim()) return `status: ${event.details.status.trim()}`;
  if (typeof event.details?.message === 'string' && event.details.message.trim()) return event.details.message.trim();
  if (event.type === 'agent_failed') return 'Agent failed without a surfaced summary.';
  if (event.type === 'agent_completed') return 'Agent completed.';
  if (event.type === 'agent_started') return 'Agent launched.';
  return event.project ?? 'fleet lifecycle';
}

function detectStoryAgent(story: StoryNote, agentNames: string[]): string | null {
  if (story.agentId && agentNames.includes(story.agentId)) {
    return story.agentId;
  }

  const haystack = `${story.sessionId} ${story.sessionPurpose ?? ''} ${story.content}`.toLowerCase();
  return agentNames.find((agent) => haystack.includes(agent.toLowerCase())) ?? null;
}

function itemMatchesAgent(item: RailItem, agentName: string): boolean {
  const needle = agentName.toLowerCase();
  return item.agent === agentName
    || item.label.toLowerCase().includes(needle)
    || item.subtitle.toLowerCase().includes(needle);
}

function dedupeFiles(files: string[]): string[] {
  return [...new Set(files.filter((filePath) => filePath.trim().length > 0))];
}

export default function ActivityRail({
  fleetEvents,
  activity,
  stories,
  selectedAgent = null,
  allAgents = [],
  projectDir,
}: Props) {
  const feed = useMemo<RailItem[]>(() => {
    const fleetItems: RailItem[] = fleetEvents.map((event, index) => ({
      id: `fleet-${event.timestamp}-${event.agent ?? 'system'}-${index}`,
      kind: 'fleet',
      timestamp: event.timestamp,
      label: event.agent ? `${event.agent} ${event.type.replace(/_/g, ' ')}` : event.type.replace(/_/g, ' '),
      subtitle: summarizeFleetEvent(event),
      accent: fleetAccent(event.type),
      agent: event.agent ?? null,
      files: dedupeFiles(extractMentionedPaths(summarizeFleetEvent(event))),
    }));

    const activityItems: RailItem[] = activity
      .filter(isMeaningfulActivityEntry)
      .map((entry) => {
        const agent = entry.agentId || (typeof entry.metadata?.agentId === 'string' ? entry.metadata.agentId : null);
        return {
          id: `activity-${entry.id}`,
          kind: 'activity',
          timestamp: entry.timestamp,
          label: agent ? `${agent} ${entry.type}` : entry.type,
          subtitle: summarizeActivityEntry(entry),
          accent: activityAccent(entry.type),
          agent,
          files: dedupeFiles([...activityTouchedFiles(entry), ...extractMentionedPaths(summarizeActivityEntry(entry))]),
        };
      });

    const storyItems: RailItem[] = stories
      .filter(isMeaningfulStory)
      .map((story) => ({
        id: `story-${story.id}`,
        kind: 'story',
        timestamp: story.createdAt,
        label: story.type,
        subtitle: story.content,
        accent: 'var(--pd-info, var(--pd-accent))',
        agent: detectStoryAgent(story, allAgents),
        files: extractMentionedPaths(story.content),
      }));

    const combined = [...fleetItems, ...activityItems, ...storyItems]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 120);

    if (!selectedAgent) return combined;
    return combined.filter((item) => itemMatchesAgent(item, selectedAgent)).slice(0, 80);
  }, [activity, allAgents, fleetEvents, selectedAgent, stories]);

  const noteCount = feed.filter((item) => item.kind === 'story').length;
  const mutationCount = new Set(feed.flatMap((item) => item.files)).size;
  const eventCount = feed.filter((item) => item.kind !== 'story').length;

  return (
    <div className="flex flex-col h-full overflow-hidden rounded-2xl border" style={{ backgroundColor: 'var(--pd-surface-3)', borderColor: 'var(--pd-border)' }}>
      <div className="px-4 py-3 flex items-start justify-between gap-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <div>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>LIVE CHRONOLOGY</div>
          <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {selectedAgent ? `${selectedAgent} narrative` : 'Sessions, notes, events, and file movement'}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {selectedAgent ? (
            <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}>
              focus: {selectedAgent}
            </span>
          ) : null}
          <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
            {noteCount} notes
          </span>
          <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
            {eventCount} events
          </span>
          <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
            {mutationCount} files
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {feed.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--pd-muted)' }}>
            Waiting for activity...
          </div>
        ) : (
          feed.map((item, index) => (
            <div key={item.id} className="relative pl-6">
              {index < feed.length - 1 ? (
                <div className="absolute left-[6px] top-4 bottom-[-14px] w-px" style={{ backgroundColor: 'color-mix(in srgb, var(--pd-border) 86%, transparent)' }} />
              ) : null}
              <div className="absolute left-0 top-3 w-3 h-3 rounded-full border-2" style={{ backgroundColor: item.accent, borderColor: 'var(--pd-surface-3)' }} />
              <div className="rounded-xl px-3 py-3" style={{ backgroundColor: 'color-mix(in srgb, var(--pd-surface) 80%, transparent)', border: '1px solid color-mix(in srgb, var(--pd-border) 76%, transparent)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      {item.agent ? (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: agentColor(item.agent) }}>
                          {item.agent}
                        </span>
                      ) : null}
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
                        {item.kind}
                      </span>
                      <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--pd-text)' }}>
                        {item.agent ? item.label.replace(`${item.agent} `, '') : item.label}
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                      {item.subtitle}
                    </div>
                    {item.files.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.files.slice(0, 2).map((filePath) => (
                          <FileActionLinks
                            key={`${item.id}-${filePath}`}
                            filePath={filePath}
                            projectDir={projectDir}
                            compact
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-[9px] font-mono flex-shrink-0" style={{ color: 'var(--pd-dim)' }}>
                    {relativeTime(item.timestamp)}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
