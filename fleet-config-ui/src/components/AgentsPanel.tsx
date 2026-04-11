import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, Ghost, Mail, PauseCircle, PlayCircle, Radio, RefreshCw, Square, StickyNote } from 'lucide-react';
import {
  clearAgentInbox,
  dismissSalvageAgent,
  fetchAgentInbox,
  fetchAgentInboxStats,
  fetchChannelMessages,
  fetchFileClaims,
  fetchRegistryAgents,
  fetchSalvageAgents,
  fetchSessions,
  fetchSorties,
  killSortie,
  markAllAgentInboxRead,
} from '../api';
import {
  buildAgentDirectoryEntries,
  extractFleetAgentName,
  listKnownAgentChannels,
  type AgentDirectoryEntry,
} from '../agent-directory';
import type {
  ChannelMessage,
  FleetConfig,
  FileClaim,
  InboxMessage,
  InboxStats,
  RegistryAgent,
  SessionSummary,
  SpawnedAgent,
} from '../types';
import { agentColor } from '../types';
import FileActionLinks from './FileActionLinks';

interface Props {
  daemonKey: string;
  projectName?: string | null;
  projectDir?: string | null;
  fleetConfig?: FleetConfig | null;
  resolvedChannels?: Record<string, string>;
  runtimeAgents?: Array<{ agentName: string; status: string }>;
  onFocusFleetAgent?: (agentName: string) => void;
  onRunFleetAgent?: (agentName: string) => Promise<void> | void;
  onPauseFleetAgent?: (agentName: string, paused: boolean) => Promise<void> | void;
}

interface ChannelFeed {
  logical: string;
  physical: string;
  messages: ChannelMessage[];
}

function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'never';
  const diff = Math.max(0, Date.now() - timestamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function summarizeChannelPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  if (!payload || typeof payload !== 'object') return String(payload ?? '').trim();

  const candidate = payload as Record<string, unknown>;
  for (const key of ['message', 'summary', 'content', 'text', 'details', 'error', 'status']) {
    if (typeof candidate[key] === 'string' && candidate[key]?.trim()) {
      return candidate[key].trim();
    }
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return '';
  }
}

function matchesProjectSpawn(agent: SpawnedAgent, projectName: string | null | undefined): boolean {
  if (!projectName) return true;
  const identity = agent.identity?.toLowerCase() ?? '';
  const purpose = agent.purpose?.toLowerCase() ?? '';
  const projectNeedle = projectName.toLowerCase();
  return identity === projectNeedle
    || identity.startsWith(`${projectNeedle}:`)
    || purpose.includes(projectNeedle);
}

function matchesProjectRegistry(agent: RegistryAgent, projectName: string | null | undefined): boolean {
  if (!agent || !projectName) return true;
  const projectNeedle = projectName.toLowerCase();
  const identity = agent.identity?.toLowerCase() ?? '';
  const purpose = agent.purpose?.toLowerCase() ?? '';
  return agent.identityProject === projectName
    || identity === projectNeedle
    || identity.startsWith(`${projectNeedle}:`)
    || purpose.includes(projectNeedle);
}

function badgeStyle(kind: 'live' | 'spawn' | 'ghost' | 'fleet' | 'adhoc') {
  if (kind === 'live') return { backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' };
  if (kind === 'spawn') return { backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' };
  if (kind === 'ghost') return { backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' };
  if (kind === 'fleet') return { backgroundColor: 'var(--pd-surface-3)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' };
  return { backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' };
}

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
      <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <div>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>{title}</div>
          <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>{subtitle}</div>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function AgentsPanel({
  daemonKey,
  projectName,
  projectDir,
  fleetConfig,
  resolvedChannels = {},
  runtimeAgents = [],
  onFocusFleetAgent,
  onRunFleetAgent,
  onPauseFleetAgent,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entities, setEntities] = useState<AgentDirectoryEntry[]>([]);
  const [projectSessions, setProjectSessions] = useState<SessionSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [inboxStats, setInboxStats] = useState<InboxStats>({ total: 0, unread: 0 });
  const [fileClaims, setFileClaims] = useState<FileClaim[]>([]);
  const [channelFeeds, setChannelFeeds] = useState<ChannelFeed[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [registryAgents, spawnedAgents, salvageAgents, sessions] = await Promise.all([
        fetchRegistryAgents(),
        fetchSorties(),
        fetchSalvageAgents({ project: projectName ?? undefined, includeResolved: true, limit: 40 }),
        fetchSessions({ project: projectName ?? undefined, includeNotes: true, allWorktrees: true, limit: 40 }),
      ]);

      const scopedRegistryAgents = registryAgents.filter((agent) => matchesProjectRegistry(agent, projectName));
      const scopedSpawnedAgents = spawnedAgents.filter((agent) => matchesProjectSpawn(agent, projectName));
      const nextEntities = buildAgentDirectoryEntries({
        registryAgents: scopedRegistryAgents,
        spawnedAgents: scopedSpawnedAgents,
        salvageAgents,
        configuredFleetAgents: fleetConfig?.agents.map((agent) => agent.name) ?? [],
      });

      setEntities(nextEntities);
      setProjectSessions(sessions);
      setSelectedAgentId((current) => {
        if (current && nextEntities.some((entity) => entity.id === current)) return current;
        return nextEntities[0]?.id ?? null;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fleetConfig?.agents, projectName]);

  const selected = useMemo(
    () => entities.find((entity) => entity.id === selectedAgentId) ?? null,
    [entities, selectedAgentId],
  );

  const selectedFleetAgent = useMemo(() => {
    const explicit = selected?.fleetAgentName ?? null;
    if (explicit) return explicit;
    return extractFleetAgentName({
      identity: selected?.identity,
      purpose: selected?.purpose,
    });
  }, [selected]);

  const selectedRuntime = useMemo(
    () => selectedFleetAgent ? runtimeAgents.find((agent) => agent.agentName === selectedFleetAgent) ?? null : null,
    [runtimeAgents, selectedFleetAgent],
  );

  const selectedSessions = useMemo(
    () => selected ? projectSessions.filter((session) => session.agentId === selected.id).slice(0, 8) : [],
    [projectSessions, selected],
  );

  const knownChannels = useMemo(() => (
    listKnownAgentChannels(fleetConfig, selectedFleetAgent).map((binding) => ({
      ...binding,
      physical: resolvedChannels[binding.logical] ?? binding.logical,
    }))
  ), [fleetConfig, resolvedChannels, selectedFleetAgent]);

  const loadDetails = useCallback(async () => {
    if (!selected) {
      setInboxMessages([]);
      setInboxStats({ total: 0, unread: 0 });
      setFileClaims([]);
      setChannelFeeds([]);
      return;
    }

    setDetailLoading(true);
    setActionError(null);
    try {
      const [messages, stats, claims, feeds] = await Promise.all([
        fetchAgentInbox(selected.id, { limit: 20 }),
        fetchAgentInboxStats(selected.id),
        fetchFileClaims({ agent: selected.id }),
        Promise.all(
          knownChannels.map(async (channel) => ({
            logical: channel.logical,
            physical: channel.physical,
            messages: await fetchChannelMessages(channel.physical, 6),
          })),
        ),
      ]);

      setInboxMessages(messages);
      setInboxStats(stats);
      setFileClaims(claims);
      setChannelFeeds(feeds);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, [knownChannels, selected]);

  useEffect(() => {
    void loadDirectory();
  }, [daemonKey, loadDirectory]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const summary = useMemo(() => ({
    live: entities.filter((entity) => entity.registry).length,
    spawned: entities.filter((entity) => entity.spawned).length,
    ghosts: entities.filter((entity) => entity.salvage).length,
    sessions: projectSessions.length,
  }), [entities, projectSessions.length]);

  const runBusy = actionBusy === 'run';
  const pauseBusy = actionBusy === 'pause';
  const stopBusy = actionBusy === 'stop';
  const dismissBusy = actionBusy === 'dismiss';
  const inboxBusy = actionBusy === 'inbox';

  const handleRefresh = useCallback(async () => {
    await loadDirectory();
    await loadDetails();
  }, [loadDetails, loadDirectory]);

  const handleStopRun = useCallback(async () => {
    if (!selected?.spawned) return;
    setActionBusy('stop');
    setActionError(null);
    try {
      await killSortie(selected.spawned.agentId);
      await loadDirectory();
      await loadDetails();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  }, [loadDetails, loadDirectory, selected]);

  const handleDismissGhost = useCallback(async () => {
    if (!selected?.salvage) return;
    setActionBusy('dismiss');
    setActionError(null);
    try {
      await dismissSalvageAgent(selected.salvage.id);
      await loadDirectory();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  }, [loadDirectory, selected]);

  const handleMarkInboxRead = useCallback(async () => {
    if (!selected) return;
    setActionBusy('inbox');
    setActionError(null);
    try {
      await markAllAgentInboxRead(selected.id);
      await loadDetails();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  }, [loadDetails, selected]);

  const handleClearInbox = useCallback(async () => {
    if (!selected) return;
    setActionBusy('inbox');
    setActionError(null);
    try {
      await clearAgentInbox(selected.id);
      await loadDetails();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  }, [loadDetails, selected]);

  const handleRunFleet = useCallback(async () => {
    if (!selectedFleetAgent || !onRunFleetAgent) return;
    setActionBusy('run');
    setActionError(null);
    try {
      await onRunFleetAgent(selectedFleetAgent);
      await loadDirectory();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  }, [loadDirectory, onRunFleetAgent, selectedFleetAgent]);

  const handlePauseResumeFleet = useCallback(async () => {
    if (!selectedFleetAgent || !selectedRuntime || !onPauseFleetAgent) return;
    setActionBusy('pause');
    setActionError(null);
    try {
      await onPauseFleetAgent(selectedFleetAgent, selectedRuntime.status === 'paused');
      await loadDirectory();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  }, [loadDirectory, onPauseFleetAgent, selectedFleetAgent, selectedRuntime]);

  return (
    <div className="h-full min-h-0 grid gap-4 p-4" style={{ gridTemplateColumns: '320px minmax(0, 1fr)' }}>
      <section className="rounded-xl overflow-hidden min-h-0 flex flex-col" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
        <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <div>
            <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>ALL AGENTS</div>
            <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>
              Live agents, spawned runs, and salvage ghosts
            </div>
          </div>
          <button
            onClick={() => void handleRefresh()}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
          >
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="px-4 py-3 grid grid-cols-2 gap-2 text-[11px]" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <div className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--pd-bg)' }}>
            <div style={{ color: 'var(--pd-dim)' }}>Live registry</div>
            <div className="font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>{summary.live}</div>
          </div>
          <div className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--pd-bg)' }}>
            <div style={{ color: 'var(--pd-dim)' }}>Spawned runs</div>
            <div className="font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>{summary.spawned}</div>
          </div>
          <div className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--pd-bg)' }}>
            <div style={{ color: 'var(--pd-dim)' }}>Ghosts</div>
            <div className="font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>{summary.ghosts}</div>
          </div>
          <div className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--pd-bg)' }}>
            <div style={{ color: 'var(--pd-dim)' }}>Recent sessions</div>
            <div className="font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>{summary.sessions}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-10 text-sm text-center" style={{ color: 'var(--pd-muted)' }}>Loading agents...</div>
          ) : error ? (
            <div className="px-4 py-10 text-sm text-center" style={{ color: 'var(--pd-accent)' }}>{error}</div>
          ) : entities.length === 0 ? (
            <div className="px-4 py-10 text-sm text-center" style={{ color: 'var(--pd-muted)' }}>
              No agents surfaced for {projectName ?? 'this daemon'} yet.
            </div>
          ) : (
            entities.map((entity) => {
              const selectedRow = entity.id === selected?.id;
              const liveness = entity.registry?.healthAssessment.liveness ?? null;
              return (
                <button
                  key={entity.id}
                  onClick={() => setSelectedAgentId(entity.id)}
                  className="w-full px-4 py-3 text-left transition-colors"
                  style={{
                    borderBottom: '1px solid color-mix(in srgb, var(--pd-border) 72%, transparent)',
                    backgroundColor: selectedRow ? 'var(--pd-bg)' : 'transparent',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: entity.fleetAgentName ? agentColor(entity.fleetAgentName) : 'var(--pd-text)' }}>
                        {entity.label}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {entity.registry && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle('live')}>live</span>}
                        {entity.spawned && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle('spawn')}>{entity.spawned.status}</span>}
                        {entity.salvage && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle('ghost')}>{entity.salvage.status}</span>}
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle(entity.isConfiguredFleetAgent ? 'fleet' : 'adhoc')}>
                          {entity.isConfiguredFleetAgent ? 'fleet' : 'ad hoc'}
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-right" style={{ color: 'var(--pd-dim)' }}>
                      {relativeTime(entity.registry?.lastHeartbeat ?? entity.spawned?.completedAt ?? entity.spawned?.startedAt ?? entity.salvage?.staleSince)}
                      {liveness && <div className="mt-1 uppercase">{liveness}</div>}
                    </div>
                  </div>
                  <div
                    className="mt-2 text-[12px] leading-relaxed"
                    style={{
                      color: selectedRow ? 'var(--pd-text)' : 'var(--pd-muted)',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {entity.purpose || entity.identity || entity.id}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      <div className="min-h-0 overflow-y-auto flex flex-col gap-4">
        {!selected ? (
          <Section title="AGENT DETAIL" subtitle="Pick an agent from the directory to inspect it.">
            <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>
              This surface is meant to be the missing bridge between fleet config, live runtime, salvage, notes, and file claims.
            </div>
          </Section>
        ) : (
          <>
            <Section
              title="AGENT DETAIL"
              subtitle={selected.label}
              action={detailLoading ? <span className="text-[11px]" style={{ color: 'var(--pd-muted)' }}>Refreshing…</span> : undefined}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {selected.registry && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle('live')}>registry</span>}
                    {selected.spawned && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle('spawn')}>spawn {selected.spawned.status}</span>}
                    {selected.salvage && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle('ghost')}>ghost {selected.salvage.status}</span>}
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle(selected.isConfiguredFleetAgent ? 'fleet' : 'adhoc')}>
                      {selected.isConfiguredFleetAgent ? 'fleet agent' : 'ad hoc'}
                    </span>
                  </div>
                  <div className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--pd-text)' }}>
                    {selected.purpose || 'No operator purpose surfaced yet.'}
                  </div>
                  <div className="mt-3 grid gap-2 text-[12px]" style={{ color: 'var(--pd-muted)' }}>
                    <div><span style={{ color: 'var(--pd-dim)' }}>ID:</span> <span className="font-mono">{selected.id}</span></div>
                    {selected.identity && <div><span style={{ color: 'var(--pd-dim)' }}>Identity:</span> <span className="font-mono">{selected.identity}</span></div>}
                    {selected.registry && <div><span style={{ color: 'var(--pd-dim)' }}>Heartbeat:</span> {relativeTime(selected.registry.lastHeartbeat)} · status {selected.registry.status}</div>}
                    {selected.spawned && <div><span style={{ color: 'var(--pd-dim)' }}>Spawned:</span> {relativeTime(selected.spawned.startedAt)} · backend {selected.spawned.backend} · model {selected.spawned.model}</div>}
                    {selected.salvage?.sessionId && <div><span style={{ color: 'var(--pd-dim)' }}>Ghost session:</span> <span className="font-mono">{selected.salvage.sessionId}</span></div>}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedFleetAgent && onFocusFleetAgent && (
                    <button
                      onClick={() => onFocusFleetAgent(selectedFleetAgent)}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
                      style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
                    >
                      <Bot size={13} />
                      <span>Focus fleet agent</span>
                    </button>
                  )}
                  {selectedFleetAgent && onRunFleetAgent && (
                    <button
                      onClick={() => void handleRunFleet()}
                      disabled={runBusy}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                      style={{ color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)', backgroundColor: 'var(--pd-success-surface)' }}
                    >
                      <PlayCircle size={13} />
                      <span>{runBusy ? 'Running…' : 'Run now'}</span>
                    </button>
                  )}
                  {selectedFleetAgent && selectedRuntime && onPauseFleetAgent && (
                    <button
                      onClick={() => void handlePauseResumeFleet()}
                      disabled={pauseBusy}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                      style={{ color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)', backgroundColor: 'var(--pd-warning-surface)' }}
                    >
                      <PauseCircle size={13} />
                      <span>{pauseBusy ? 'Updating…' : selectedRuntime.status === 'paused' ? 'Resume' : 'Pause'}</span>
                    </button>
                  )}
                  {selected.spawned?.status === 'running' && (
                    <button
                      onClick={() => void handleStopRun()}
                      disabled={stopBusy}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                      style={{ color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)', backgroundColor: 'var(--pd-accent-surface)' }}
                    >
                      <Square size={13} />
                      <span>{stopBusy ? 'Stopping…' : 'Stop run'}</span>
                    </button>
                  )}
                  {selected.salvage && (
                    <button
                      onClick={() => void handleDismissGhost()}
                      disabled={dismissBusy}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                      style={{ color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)', backgroundColor: 'var(--pd-accent-surface)' }}
                    >
                      <Ghost size={13} />
                      <span>{dismissBusy ? 'Dismissing…' : 'Dismiss ghost'}</span>
                    </button>
                  )}
                </div>
              </div>
              {actionError && (
                <div className="mt-4 rounded-md px-3 py-2 text-sm" style={{ color: 'var(--pd-accent)', backgroundColor: 'var(--pd-accent-surface)', border: '1px solid var(--pd-accent-border)' }}>
                  {actionError}
                </div>
              )}
            </Section>

            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
              <Section
                title="INBOX"
                subtitle="Recent direct messages and queue state"
                action={
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleMarkInboxRead()}
                      disabled={inboxBusy || inboxStats.total === 0}
                      className="rounded-md px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
                      style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
                    >
                      Mark read
                    </button>
                    <button
                      onClick={() => void handleClearInbox()}
                      disabled={inboxBusy || inboxStats.total === 0}
                      className="rounded-md px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
                      style={{ color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)', backgroundColor: 'var(--pd-accent-surface)' }}
                    >
                      Clear
                    </button>
                  </div>
                }
              >
                <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--pd-muted)' }}>
                  <span className="inline-flex items-center gap-1"><Mail size={13} /> {inboxStats.total} total</span>
                  <span>{inboxStats.unread} unread</span>
                </div>
                <div className="mt-3 grid gap-2">
                  {inboxMessages.length === 0 ? (
                    <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>No inbox traffic for this agent.</div>
                  ) : (
                    inboxMessages.map((message) => (
                      <div key={message.id} className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--pd-text)' }}>
                            {message.type}
                          </div>
                          <div className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                            {relativeTime(message.createdAt)}
                          </div>
                        </div>
                        <div className="mt-1 text-[11px]" style={{ color: 'var(--pd-dim)' }}>
                          from {message.from ?? 'system'} {message.read ? '· read' : '· unread'}
                        </div>
                        <div className="mt-2 text-sm whitespace-pre-wrap" style={{ color: 'var(--pd-text)' }}>
                          {message.content}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Section>

              <Section title="CHANNELS" subtitle="Known pub/sub bindings and recent traffic">
                {knownChannels.length === 0 ? (
                  <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>
                    No channel bindings are recorded for this agent yet. Today the registry is observational: fleet-trigger channels are derivable from config, but ad hoc agent pub/sub subscriptions are not persisted as first-class registry metadata.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {knownChannels.map((binding) => {
                      const feed = channelFeeds.find((channel) => channel.logical === binding.logical);
                      return (
                        <div key={`${binding.kind}-${binding.logical}`} className="rounded-md px-3 py-3" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--pd-dim)' }}>{binding.kind}</div>
                              <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{binding.logical}</div>
                            </div>
                            <div className="text-[10px] font-mono text-right" style={{ color: 'var(--pd-dim)' }}>
                              <div>{binding.physical}</div>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2">
                            {feed?.messages.length ? (
                              feed.messages.map((message) => (
                                <div key={`${binding.logical}-${message.id}`} className="rounded-md px-2.5 py-2" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
                                  <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--pd-dim)' }}>
                                    <span className="inline-flex items-center gap-1"><Radio size={11} /> {message.sender ?? 'system'}</span>
                                    <span>{relativeTime(message.createdAt)}</span>
                                  </div>
                                  <div className="mt-1 text-sm" style={{ color: 'var(--pd-text)' }}>
                                    {summarizeChannelPayload(message.payload) || '[empty payload]'}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>No recent traffic captured for this channel.</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            </div>

            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
              <Section title="SESSIONS & NOTES" subtitle="Recent sessions and notes attributed to this agent">
                {selectedSessions.length === 0 ? (
                  <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>
                    No sessions are attributed to this agent in the current project slice.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {selectedSessions.map((session) => (
                      <div key={session.id} className="rounded-md px-3 py-3" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{session.purpose}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle(session.status === 'active' ? 'live' : session.status === 'completed' ? 'fleet' : 'ghost')}>
                                {session.status}
                              </span>
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={badgeStyle('adhoc')}>
                                phase {session.phase}
                              </span>
                            </div>
                          </div>
                          <div className="text-[10px] font-mono text-right" style={{ color: 'var(--pd-dim)' }}>
                            <div>{relativeTime(session.updatedAt)}</div>
                            <div>{session.id}</div>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {(session.notes ?? []).slice(0, 3).map((note) => (
                            <div key={note.id} className="rounded-md px-2.5 py-2" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
                              <div className="flex items-center justify-between gap-3 text-[10px]" style={{ color: 'var(--pd-dim)' }}>
                                <span className="inline-flex items-center gap-1"><StickyNote size={11} /> {note.type}</span>
                                <span>{relativeTime(note.createdAt)}</span>
                              </div>
                              <div className="mt-1 text-sm whitespace-pre-wrap" style={{ color: 'var(--pd-text)' }}>
                                {note.content}
                              </div>
                            </div>
                          ))}
                          {(session.notes ?? []).length === 0 && (
                            <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>No notes recorded for this session.</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="ACTIVE FILE CLAIMS" subtitle="Current claimed files and mutation surface">
                {fileClaims.length === 0 ? (
                  <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>
                    No active file claims surfaced for this agent.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {fileClaims.map((claim) => (
                      <div key={`${claim.sessionId}:${claim.filePath}:${claim.startLine ?? 'all'}:${claim.endLine ?? 'all'}`} className="rounded-md px-3 py-3" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold break-all" style={{ color: 'var(--pd-text)' }}>{claim.filePath}</div>
                            <div className="mt-1 text-[11px]" style={{ color: 'var(--pd-dim)' }}>
                              {claim.symbol ? `${claim.symbol} · ` : ''}{claim.startLine != null && claim.endLine != null ? `lines ${claim.startLine}-${claim.endLine}` : 'whole file'}
                            </div>
                          </div>
                          <div className="text-[10px] font-mono text-right" style={{ color: 'var(--pd-dim)' }}>
                            <div>{relativeTime(claim.claimedAt)}</div>
                            <div>{claim.phase}</div>
                          </div>
                        </div>
                        <div className="mt-2 text-[11px]" style={{ color: 'var(--pd-muted)' }}>
                          Session {claim.sessionId} · {claim.purpose}
                        </div>
                        <div className="mt-3">
                          <FileActionLinks filePath={claim.filePath} projectDir={projectDir ?? undefined} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>

            {(selected.registry?.metadata || selected.registry?.agentCard) && (
              <Section title="REGISTRY METADATA" subtitle="Current Port Daddy view of this agent">
                <div className="grid gap-3">
                  {selected.registry?.metadata && (
                    <div>
                      <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>metadata</div>
                      <pre className="mt-2 rounded-md px-3 py-3 overflow-x-auto text-[11px]" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
                        {JSON.stringify(selected.registry.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                  {selected.registry?.agentCard && (
                    <div>
                      <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>agent card</div>
                      <pre className="mt-2 rounded-md px-3 py-3 overflow-x-auto text-[11px]" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
                        {JSON.stringify(selected.registry.agentCard, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
