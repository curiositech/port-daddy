import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, Sun, Moon, Square, Play } from 'lucide-react';
import { AllProjectsList } from './components/ProjectPicker';
import ProjectPicker from './components/ProjectPicker';
import AgentCard from './components/AgentCard';
import AgentConfigPanel from './components/AgentConfigPanel';
import FlowGraph from './components/FlowGraph';
import ChannelLog from './components/ChannelLog';
import DMPanel from './components/DMPanel';
import SortiePanel from './components/SortiePanel';
import YAMLEditor from './components/YAMLEditor';
import ActivityPanel from './components/ActivityPanel';
import {
  activityTouchedFiles,
  isMeaningfulActivityEntry,
  isMeaningfulStory,
  summarizeActivityEntry,
} from './activityFeed';
import { useFleet } from './hooks/useFleet';
import { useChannelLog } from './hooks/useChannelLog';
import { useTheme } from './hooks/useTheme';
import {
  startFleet,
  stopFleet,
  formatDaemonLabel,
  CUSTOM_DAEMON_SENTINEL,
  getDaemonChoices,
  getDaemonUrl,
  setDaemonUrl,
} from './api';
import type { ActivityEntry, FleetConfig, FleetEvent, ResolvedChannelTarget, StoryNote, TopologyValidation } from './types';

type MainTab = 'Flow' | 'Activity' | 'Channels' | 'Inbox' | 'Sorties' | 'YAML';
type ControlSurface = 'flow' | 'activity' | 'channels' | 'inbox' | 'sorties' | 'yaml';

function canUseWindow(): boolean {
  return typeof window !== 'undefined';
}

function normalizeSurface(value: string | null): ControlSurface {
  switch (value) {
    case 'activity':
    case 'channels':
    case 'inbox':
    case 'sorties':
    case 'yaml':
    case 'flow':
      return value;
    default:
      return 'flow';
  }
}

function surfaceToMainTab(surface: ControlSurface): MainTab {
  switch (surface) {
    case 'flow':
      return 'Flow';
    case 'activity':
      return 'Activity';
    case 'channels':
      return 'Channels';
    case 'inbox':
      return 'Inbox';
    case 'sorties':
      return 'Sorties';
    case 'yaml':
      return 'YAML';
    default:
      return 'Flow';
  }
}

function mainTabToSurface(activeTab: MainTab): ControlSurface {
  if (activeTab === 'Activity') return 'activity';
  if (activeTab === 'Channels') return 'channels';
  if (activeTab === 'Inbox') return 'inbox';
  if (activeTab === 'Sorties') return 'sorties';
  if (activeTab === 'YAML') return 'yaml';
  return 'flow';
}

function readInitialRoute(): { project: string | null; surface: ControlSurface; embedded: boolean; agent: string | null } {
  if (!canUseWindow()) {
    return { project: null, surface: 'flow', embedded: false, agent: null };
  }

  const params = new URLSearchParams(window.location.search);
  const project = params.get('project');
  const surface = normalizeSurface(params.get('surface'));
  const embedded = params.get('embed') === 'fleetbar'
    || window.navigator.userAgent.includes('PortDaddyFleetBar');
  // FleetBar also injects an explicit marker at document start so embed mode survives
  // query-string drops and custom user-agent inconsistencies.
  const explicitEmbed = (window as Window & { __PORT_DADDY_EMBED?: string }).__PORT_DADDY_EMBED === 'fleetbar';
  const agent = params.get('agent');
  return {
    project: project && project.trim() ? project.trim() : null,
    surface,
    embedded: embedded || explicitEmbed,
    agent: agent && agent.trim() ? agent.trim() : null,
  };
}

interface AgentSignal {
  summary: string;
  label: string;
  timestamp: number;
  files: string[];
}

const PROJECT_SCOPE_HASH_LENGTH = 12;
const PROJECT_SCOPE_SLUG_MAX = 24;

function normalizeProjectSlug(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned || 'project').slice(0, PROJECT_SCOPE_SLUG_MAX);
}

function projectLabelFromDir(projectDir: string): string {
  return projectDir.split(/[\\/]/).filter(Boolean).pop() ?? 'project';
}

async function hashProjectScope(projectDir: string): Promise<string | null> {
  if (!window.crypto?.subtle) return null;
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(projectDir.replace(/\\/g, '/')),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, PROJECT_SCOPE_HASH_LENGTH);
}

async function resolveBrowserScopedChannels(
  logicalChannels: string[],
  projectDir: string,
  projectName?: string | null,
): Promise<Record<string, string>> {
  const hash = await hashProjectScope(projectDir);
  if (!hash) return {};

  const scope = `project:${normalizeProjectSlug(projectName || projectLabelFromDir(projectDir))}:${hash}`;
  const resolved = new Map<string, string>();

  for (const channel of logicalChannels) {
    const trimmed = channel.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('project:')) {
      resolved.set(trimmed, trimmed);
    } else if (trimmed.startsWith('global:')) {
      resolved.set(trimmed, trimmed.slice('global:'.length));
    } else {
      resolved.set(trimmed, `${scope}:${trimmed}`);
    }
  }

  return Object.fromEntries(resolved);
}

function extractTouchedPaths(text: string): string[] {
  const matches = text.match(/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9_-]+)?/g) ?? [];
  return [...new Set(matches.filter((match) => match.includes('/')).slice(0, 6))];
}

function summarizeFleetEvent(event: FleetEvent): string {
  if (typeof event.details?.error === 'string' && event.details.error.trim()) return event.details.error.trim();
  if (typeof event.details?.status === 'string' && event.details.status.trim()) return `status: ${event.details.status.trim()}`;
  if (typeof event.details?.message === 'string' && event.details.message.trim()) return event.details.message.trim();
  if (event.type === 'agent_failed') return 'Agent failed without a surfaced summary.';
  if (event.type === 'agent_completed') return 'Agent completed.';
  return '';
}

function buildAgentSignal(
  agentName: string,
  activity: ActivityEntry[],
  stories: StoryNote[],
  fleetEvents: FleetEvent[],
): AgentSignal | null {
  const candidates: AgentSignal[] = [];

  for (const entry of activity) {
    const metadataAgentId = typeof entry.metadata?.agentId === 'string' ? entry.metadata.agentId : null;
    const matches = entry.agentId === agentName
      || metadataAgentId === agentName
      || [entry.targetId, entry.details, entry.metadata]
        .filter(Boolean)
        .some((value) => stringifySearchField(value).toLowerCase().includes(agentName.toLowerCase()));
    if (!matches || !isMeaningfulActivityEntry(entry)) continue;
    candidates.push({
      summary: summarizeActivityEntry(entry),
      label: entry.type,
      timestamp: entry.timestamp,
      files: activityTouchedFiles(entry),
    });
  }

  for (const story of stories) {
    const storyText = `${story.sessionId} ${story.sessionPurpose ?? ''} ${story.content}`.toLowerCase();
    const matchesStory = story.agentId === agentName || storyText.includes(agentName.toLowerCase());
    if (!matchesStory || !isMeaningfulStory(story)) continue;
    candidates.push({
      summary: story.content.trim(),
      label: story.type,
      timestamp: story.createdAt,
      files: extractTouchedPaths(story.content),
    });
  }

  for (const event of fleetEvents) {
    if (event.agent !== agentName) continue;
    const summary = summarizeFleetEvent(event);
    if (!summary) continue;
    candidates.push({
      summary,
      label: event.type.replace(/_/g, ' '),
      timestamp: event.timestamp,
      files: extractTouchedPaths(summary),
    });
  }

  candidates.sort((a, b) => b.timestamp - a.timestamp);
  return candidates[0] ?? null;
}

function stringifySearchField(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({
  project,
  embedded,
  daemonRunning,
  daemonUrl,
  daemonChoices,
  onDaemonChange,
  theme,
  onToggleTheme,
  onBack,
}: {
  project?: string;
  embedded: boolean;
  daemonRunning: boolean;
  daemonUrl: string;
  daemonChoices: string[];
  onDaemonChange: (value: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onBack?: () => void;
}) {
  if (embedded) {
    return null;
  }

  return (
    <div className="flex items-center justify-between px-6 py-3 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
      <div className="flex items-center gap-3">
        <Wifi size={14} color="var(--pd-accent)" />
        <button onClick={onBack} className="font-bold tracking-wide text-sm hover:opacity-80 font-mono" style={{ color: 'var(--pd-text)' }}>
          PortDaddy
        </button>
        <span className="opacity-20" style={{ color: 'var(--pd-text)' }}>:</span>
        <span className="text-xs tracking-widest" style={{ color: 'var(--pd-muted)' }}>AGENTIC CONTROL PLANE</span>
        {project && <>
          <span className="opacity-20" style={{ color: 'var(--pd-text)' }}>·</span>
          <span className="text-sm font-mono" style={{ color: 'var(--pd-accent)' }}>{project}</span>
        </>}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-md px-2 py-1" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
          <span className="text-[10px] font-semibold tracking-wider opacity-35" style={{ color: 'var(--pd-text)' }}>
            DAEMON
          </span>
          <select
            className="pd-daemon-select"
            value={daemonUrl}
            onChange={(event) => onDaemonChange(event.target.value)}
            title={daemonUrl}
          >
            {daemonChoices.map((choice) => (
              <option key={choice} value={choice}>
                {formatDaemonLabel(choice)}
              </option>
            ))}
            <option value={CUSTOM_DAEMON_SENTINEL}>Custom…</option>
          </select>
        </div>
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: daemonRunning ? 'var(--pd-success)' : 'var(--pd-accent)' }} />
          <span className="text-xs font-mono" style={{ color: 'var(--pd-muted)' }}>
            {formatDaemonLabel(daemonUrl)} {daemonRunning ? 'online' : 'offline'}
          </span>
        </div>
      </div>
    </div>
  );
}

function TabBar({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-0.5 px-4 pt-2" style={{ borderBottom: '1px solid var(--pd-border)' }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)}
          className="px-3 py-1.5 text-[11px] font-semibold tracking-wide rounded-t"
          style={{
            backgroundColor: active === t ? 'var(--pd-surface)' : 'transparent',
            color: active === t ? 'var(--pd-text)' : 'var(--pd-muted)',
            borderBottom: active === t ? '2px solid var(--pd-accent)' : '2px solid transparent',
          }}>
          {t}
        </button>
      ))}
    </div>
  );
}

function matchesProject(fields: unknown[], project: string | null, agentNames: string[]): boolean {
  if (!project) return true;
  const haystack = fields.map(stringifySearchField).join(' ').toLowerCase();
  return haystack.includes(project.toLowerCase()) || agentNames.some((agent) => haystack.includes(agent.toLowerCase()));
}

function summarizeChannelPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  if (!payload || typeof payload !== 'object') return String(payload ?? '').trim();

  const candidate = payload as Record<string, unknown>;
  const preferredKeys = ['message', 'summary', 'content', 'text', 'details', 'error', 'status'];
  for (const key of preferredKeys) {
    if (typeof candidate[key] === 'string' && candidate[key]!.trim()) {
      return candidate[key]!.trim() as string;
    }
  }

  try {
    const serialized = JSON.stringify(payload);
    return serialized === '{}' ? '' : serialized;
  } catch {
    return '';
  }
}

function extractPublishedChannel(command?: string): string | null {
  if (!command) return null;
  const trimmed = command.trim();
  if (!trimmed.startsWith('publish ')) return null;
  const channel = trimmed.slice('publish '.length).trim();
  return channel || null;
}

function isLowSignalChannelMessage(summary: string, publisher: string | null): boolean {
  const trimmed = summary.trim();
  if (!trimmed) return true;
  const normalized = trimmed.toLowerCase();
  if (['ok', 'done', 'success', 'connected', 'streaming', 'heartbeat'].includes(normalized)) return true;
  if (publisher === 'system' && trimmed.length < 24) return true;
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function App() {
  const initialRoute = useMemo(() => readInitialRoute(), []);
  const embedded = initialRoute.embedded;
  const [theme, toggleTheme] = useTheme();
  const [daemonUrl, setDaemonUrlState] = useState(() => getDaemonUrl());
  const [daemonChoices, setDaemonChoices] = useState(() => getDaemonChoices());
  const fleet = useFleet(daemonUrl);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialRoute.project);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(initialRoute.agent);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [configAgent, setConfigAgent] = useState<string | null>(initialRoute.agent);
  const [inspectorTab, setInspectorTab] = useState<'details' | 'settings'>('details');
  const [activeTab, setActiveTab] = useState<MainTab>(surfaceToMainTab(initialRoute.surface));
  const [flowGraphHeight, setFlowGraphHeight] = useState(336);
  const [browserResolvedChannels, setBrowserResolvedChannels] = useState<Record<string, string>>({});

  const projects = useMemo(() => {
    if (!fleet.status) return [];
    return fleet.status.fleets.map(f => ({
      id: f.projectDir, name: f.project, fleetPath: f.projectDir,
      agents: f.agents.map(a => ({ agentName: a.name, status: a.status as 'idle' | 'active' })),
    }));
  }, [fleet.status]);

  const selectedProject = fleet.status?.fleets.find(f => f.projectDir === selectedProjectId) ?? null;
  const selectedProjectName = selectedProject?.project ?? null;

  useEffect(() => {
    if (fleet.loading || !selectedProjectId) return;
    if (projects.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId(null);
  }, [fleet.loading, projects, selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId && !fleet.configs.has(selectedProjectId)) {
      fleet.loadConfig(selectedProjectId);
    }
  }, [selectedProjectId, fleet]);

  useEffect(() => {
    if (!canUseWindow()) return;
    const next = new URL(window.location.href);
    next.searchParams.set('surface', mainTabToSurface(activeTab));
    if (selectedProjectId) {
      next.searchParams.set('project', selectedProjectId);
    } else {
      next.searchParams.delete('project');
    }
    if (selectedAgent) {
      next.searchParams.set('agent', selectedAgent);
    } else {
      next.searchParams.delete('agent');
    }
    if (embedded) {
      next.searchParams.set('embed', 'fleetbar');
    } else {
      next.searchParams.delete('embed');
    }
    window.history.replaceState({}, '', next);
  }, [activeTab, embedded, selectedAgent, selectedProjectId]);

  useEffect(() => {
    if (!configAgent || !selectedAgent || configAgent === selectedAgent) return;
    setInspectorTab('details');
    setConfigAgent(selectedAgent);
  }, [configAgent, selectedAgent]);

  useEffect(() => {
    if (activeTab === 'Flow') return;
    setConfigAgent(null);
  }, [activeTab]);

  useEffect(() => {
    if (!embedded || selectedProjectId || fleet.loading || projects.length === 0) return;
    setSelectedProjectId(projects[0].id);
  }, [embedded, fleet.loading, projects, selectedProjectId]);

  const projectConfig = selectedProjectId ? fleet.configs.get(selectedProjectId) : undefined;
  const fleetConfig: FleetConfig | null = projectConfig?.parsed ?? null;
  const topology: TopologyValidation | null = projectConfig?.topology ?? null;
  const selectedAgentNames = useMemo(() => selectedProject?.agents.map(agent => agent.name) ?? [], [selectedProject]);

  const logicalChannelNames = useMemo(() => {
    if (!fleetConfig) return [];
    const set = new Set<string>();
    const add = (logical?: string | null) => {
      const trimmed = logical?.trim();
      if (trimmed) set.add(trimmed);
    };
    Object.keys(fleetConfig.channels).forEach(add);
    fleetConfig.agents.forEach((agent) => {
      add(agent.trigger);
      add(extractPublishedChannel(agent.onSuccess));
      add(extractPublishedChannel(agent.onFailure));
    });
    fleetConfig.watchers.forEach((watcher) => add(watcher.trigger));
    return Array.from(set).sort();
  }, [fleetConfig]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateBrowserResolvedChannels() {
      if (!projectConfig?.projectDir || !fleetConfig || logicalChannelNames.length === 0) {
        setBrowserResolvedChannels({});
        return;
      }

      const resolved = await resolveBrowserScopedChannels(
        logicalChannelNames,
        projectConfig.projectDir,
        fleetConfig.name,
      );
      if (!cancelled) {
        setBrowserResolvedChannels(resolved);
      }
    }

    hydrateBrowserResolvedChannels();
    return () => { cancelled = true; };
  }, [fleetConfig, logicalChannelNames, projectConfig?.projectDir]);

  const channelTargets = useMemo<ResolvedChannelTarget[]>(() => {
    if (!fleetConfig) return [];
    const routeResolvedChannels = projectConfig?.resolvedChannels ?? {};
    const hasRouteResolvedChannels = Object.keys(routeResolvedChannels).length > 0;
    const resolvedChannels = hasRouteResolvedChannels ? routeResolvedChannels : browserResolvedChannels;
    if (!hasRouteResolvedChannels && Object.keys(resolvedChannels).length === 0) {
      return [];
    }
    return logicalChannelNames.map((logical) => ({
      logical,
      physical: resolvedChannels[logical] ?? logical,
    }));
  }, [browserResolvedChannels, fleetConfig, logicalChannelNames, projectConfig?.resolvedChannels]);

  const channelLog = useChannelLog(daemonUrl, channelTargets);

  const filteredFleetEvents = useMemo(
    () => fleet.events.filter(event => !selectedProjectName || event.project === selectedProjectName),
    [fleet.events, selectedProjectName]
  );

  const filteredStories = useMemo(
    () => fleet.stories.filter((note) => matchesProject(
      [note.sessionId, note.sessionPurpose, note.agentId, note.identityProject, note.content],
      selectedProjectName,
      selectedAgentNames,
    )),
    [fleet.stories, selectedProjectName, selectedAgentNames]
  );

  const filteredActivity = useMemo(
    () => fleet.activity.filter((entry) => matchesProject([entry.agentId, entry.targetId, entry.details, entry.metadata], selectedProjectName, selectedAgentNames)),
    [fleet.activity, selectedProjectName, selectedAgentNames]
  );

  const agentSignals = useMemo(() => {
    if (!fleetConfig) return new Map<string, AgentSignal | null>();
    return new Map(
      fleetConfig.agents.map((agent) => [
        agent.name,
        buildAgentSignal(agent.name, filteredActivity, filteredStories, filteredFleetEvents),
      ]),
    );
  }, [fleetConfig, filteredActivity, filteredFleetEvents, filteredStories]);

  const agentActivitySignals = useMemo(() => {
    if (!fleetConfig) return [];
    return fleetConfig.agents
      .map((agent) => {
        const signal = agentSignals.get(agent.name);
        if (!signal) return null;
        return {
          name: agent.name,
          summary: signal.summary,
          label: signal.label,
          timestamp: signal.timestamp,
          files: signal.files,
        };
      })
      .filter((signal): signal is { name: string; summary: string; label: string; timestamp: number; files: string[] } => !!signal)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [agentSignals, fleetConfig]);

  const channelLogEvents = useMemo(() => {
    const realMessages = channelLog.messages
      .map((message) => {
        const summary = summarizeChannelPayload(message.payload);
        if (!summary || isLowSignalChannelMessage(summary, message.sender)) return null;
        return {
          id: `msg-${message.channel}-${message.id}`,
          ts: new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          channel: message.channel,
          publisher: message.sender ?? 'system',
          outcome: ((message.channel.includes('findings') || message.channel.includes('alert') || summary.toLowerCase().includes('error'))
            ? 'findings'
            : 'clean') as 'clean' | 'findings',
          message: summary,
          triggered: fleetConfig?.agents.filter((agent) => agent.trigger === message.channel).map((agent) => agent.name) ?? [],
        };
      })
      .filter((message): message is NonNullable<typeof message> => !!message);

    return realMessages;
  }, [channelLog.messages, fleetConfig]);

  const resetSelection = (projectId: string | null = null) => {
    setSelectedProjectId(projectId);
    setSelectedAgent(null);
    setSelectedChannel(null);
    setConfigAgent(null);
  };
  const selectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedAgent(null);
    setSelectedChannel(null);
    setConfigAgent(null);
  };
  const goHome = () => resetSelection();

  const handleDaemonChange = useCallback((value: string) => {
    let nextValue = value;
    if (value === CUSTOM_DAEMON_SENTINEL) {
      const prompted = window.prompt('Port Daddy daemon URL', daemonUrl);
      if (!prompted) return;
      nextValue = prompted;
    }

    try {
      const nextDaemonUrl = setDaemonUrl(nextValue);
      setDaemonUrlState(nextDaemonUrl);
      setDaemonChoices(getDaemonChoices());
      resetSelection();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }, [daemonUrl]);

  const focusAgent = useCallback((name: string | null) => {
    setSelectedAgent(name);
    if (name) {
      setSelectedChannel(null);
      if (configAgent) {
        setInspectorTab('details');
        setConfigAgent(name);
      }
    }
  }, [configAgent]);

  const inspectAgent = useCallback((name: string) => {
    setSelectedAgent(name);
    setSelectedChannel(null);
    setInspectorTab('details');
    setConfigAgent(name);
  }, []);

  const configureAgent = useCallback((name: string) => {
    setSelectedAgent(name);
    setSelectedChannel(null);
    setInspectorTab('settings');
    setConfigAgent(name);
  }, []);

  const focusChannel = useCallback((channelName: string | null) => {
    setSelectedChannel(channelName);
    if (channelName) setSelectedAgent(null);
  }, []);

  const startFlowResize = useCallback((startY: number) => {
    if (!canUseWindow()) return;
    const initialHeight = flowGraphHeight;

    const handleMove = (event: MouseEvent) => {
      const delta = event.clientY - startY;
      setFlowGraphHeight(Math.max(240, Math.min(520, initialHeight + delta)));
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [flowGraphHeight]);

  const handleFleetToggle = useCallback(async () => {
    if (!selectedProject) return;
    try {
      if (selectedProject.agents.length > 0) await stopFleet(selectedProject.projectDir);
      else await startFleet(selectedProject.projectDir);
      fleet.refresh();
    } catch (err) { alert((err as Error).message); }
  }, [selectedProject, fleet]);

  const configAgentData = fleetConfig?.agents.find(a => a.name === configAgent);
  const daemonRunning = fleet.status?.running ?? false;
  const surfaceTabs: MainTab[] = ['Flow', 'Activity', 'Channels', 'Inbox', 'Sorties', 'YAML'];
  const showProjectSidebar = activeTab === 'Flow' && !embedded;
  const projectSidebar = selectedProject ? (
    <div className="h-full overflow-hidden p-4 flex flex-col"
      style={{ borderRight: '1px solid var(--pd-border)', backgroundColor: 'color-mix(in srgb, var(--pd-surface) 74%, var(--pd-bg))' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-semibold tracking-wider opacity-30" style={{ color: 'var(--pd-text)' }}>PROJECTS</div>
        <button onClick={handleFleetToggle} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded"
          style={{
            backgroundColor: selectedProject.agents.length ? 'var(--pd-accent-surface)' : 'var(--pd-success-surface)',
            color: selectedProject.agents.length ? 'var(--pd-accent)' : 'var(--pd-success)',
            border: `1px solid ${selectedProject.agents.length ? 'var(--pd-accent-border)' : 'var(--pd-success-border)'}`,
          }}>
          {selectedProject.agents.length ? <><Square size={8} /> Stop Fleet</> : <><Play size={8} /> Start Fleet</>}
        </button>
      </div>
      <ProjectPicker projects={projects} selected={selectedProjectId} onSelect={selectProject} />
    </div>
  ) : null;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--pd-bg)', fontFamily: 'var(--pd-font-ui)' }}>
      <Header
        project={selectedProjectName ?? undefined}
        embedded={embedded}
        daemonRunning={daemonRunning}
        daemonUrl={daemonUrl}
        daemonChoices={daemonChoices}
        onDaemonChange={handleDaemonChange}
        theme={theme}
        onToggleTheme={toggleTheme}
        onBack={selectedProjectId ? goHome : undefined}
      />

      {selectedProjectId && !embedded && (
        <TabBar tabs={surfaceTabs} active={activeTab} onChange={(tab) => setActiveTab(tab as MainTab)} />
      )}

      <AnimatePresence mode="wait">
        {!selectedProjectId ? (
          <motion.div key="all" className="flex-1 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
            {fleet.loading ? (
              <div className="flex items-center justify-center h-full opacity-30" style={{ color: 'var(--pd-text)' }}>Loading...</div>
            ) : fleet.error ? (
              <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--pd-text)' }}>
                <span style={{ color: 'var(--pd-accent)' }}>Daemon offline</span>&nbsp;at {formatDaemonLabel(daemonUrl)}: {fleet.error}
              </div>
            ) : (
              <AllProjectsList projects={projects} onSelect={selectProject} />
            )}
          </motion.div>
        ) : (
          <motion.div key={`proj-${selectedProjectId}-${activeTab}`} className="flex-1 overflow-hidden"
            initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <div className="h-full grid" style={{ gridTemplateColumns: showProjectSidebar ? '220px 1fr' : '1fr' }}>
              {showProjectSidebar ? <div>{projectSidebar}</div> : null}
              <div className="overflow-hidden flex flex-col">
                {activeTab === 'Flow' ? (
                  <div className="flex-1 overflow-hidden grid" style={{ gridTemplateRows: `${flowGraphHeight}px 14px minmax(0, 1fr)` }}>
                    <div className="overflow-hidden" style={{ borderBottom: '1px solid var(--pd-border)' }}>
                      {fleetConfig ? (
                        <FlowGraph
                          config={fleetConfig}
                          topology={topology}
                          theme={theme}
                          selectedAgent={selectedAgent}
                          selectedChannel={selectedChannel}
                          onAgentSelect={focusAgent}
                          onChannelSelect={focusChannel}
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full opacity-20" style={{ color: 'var(--pd-text)' }}>Loading config...</div>
                      )}
                    </div>

                    <button
                      type="button"
                      aria-label="Resize flow panels"
                      onMouseDown={(event) => startFlowResize(event.clientY)}
                      className="cursor-row-resize"
                      style={{ backgroundColor: 'var(--pd-surface-3)', borderBottom: '1px solid var(--pd-border)', borderTop: '1px solid var(--pd-border)' }}
                    >
                      <div className="mx-auto h-full flex items-center justify-center">
                        <div className="h-1 w-16 rounded-full" style={{ backgroundColor: 'var(--pd-border)' }} />
                      </div>
                    </button>

                    <div className="overflow-hidden flex flex-col">
                      <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
                        <div>
                          <div className="text-[10px] font-semibold tracking-wider opacity-30" style={{ color: 'var(--pd-text)' }}>AGENTS</div>
                          <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                            Recent work, mutations, and inspect entry points
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {(selectedAgent || selectedChannel) && (
                            <button
                              onClick={() => {
                                setSelectedAgent(null);
                                setSelectedChannel(null);
                              }}
                              className="text-[10px] px-2 py-1 rounded"
                              style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}
                            >
                              Clear focus
                            </button>
                          )}
                          <div className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                            {selectedProject?.agents.filter(a => a.status === 'running').length ?? 0} active · {fleetConfig?.agents.length ?? 0} agents
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto p-4">
                        {fleetConfig && (
                          <motion.div layout className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))' }}>
                            {fleetConfig.agents.map(agent => {
                              const runtime = selectedProject?.agents.find(a => a.name === agent.name);
                              const isRelated = selectedAgent === agent.name
                                || (selectedChannel != null && (agent.trigger === selectedChannel || agent.onSuccess?.includes(selectedChannel) || agent.onFailure?.includes(selectedChannel)));
                              const dimmed = (selectedAgent != null && selectedAgent !== agent.name) || (selectedChannel != null && !isRelated);
                              const signal = agentSignals.get(agent.name) ?? null;
                              return (
                                <AgentCard
                                  key={agent.name}
                                  agent={agent}
                                  runtimeStatus={runtime?.status}
                                  limits={fleetConfig.limits}
                                  highlighted={!!isRelated}
                                  dimmed={dimmed}
                                  latestWork={signal?.summary ?? null}
                                  latestWorkLabel={signal?.label ?? null}
                                  touchedFiles={signal?.files ?? []}
                                  onSelect={inspectAgent}
                                  onConfigure={configureAgent}
                                />
                              );
                            })}
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 overflow-hidden">
                    {activeTab === 'Activity' && (
                      <ActivityPanel
                        fleetEvents={filteredFleetEvents}
                        activity={filteredActivity}
                        stories={filteredStories}
                        selectedAgent={selectedAgent}
                        allAgents={fleetConfig?.agents.map((agent) => agent.name) ?? []}
                        agentSignals={agentActivitySignals}
                        onSelectAgent={focusAgent}
                      />
                    )}
                    {activeTab === 'Channels' && (
                      <ChannelLog
                        events={channelLogEvents}
                        selectedAgent={selectedAgent}
                        selectedChannel={selectedChannel}
                        onChannelClick={(channelName) => focusChannel(selectedChannel === channelName ? null : channelName)}
                        layout="page"
                      />
                    )}
                    {activeTab === 'Inbox' && (
                      <DMPanel
                        key={`${daemonUrl}:${selectedProjectId ?? 'all'}:inbox`}
                        channels={channelTargets}
                        agents={fleetConfig?.agents.map(agent => agent.name) ?? []}
                        project={selectedProjectName ?? undefined}
                        layout="full"
                      />
                    )}
                    {activeTab === 'Sorties' && (
                      <SortiePanel key={`${daemonUrl}:${selectedProjectId ?? 'all'}`} project={selectedProjectName ?? undefined} />
                    )}
                    {activeTab === 'YAML' && selectedProjectId && (
                      <YAMLEditor
                        key={`${daemonUrl}:${selectedProjectId}`}
                        project={selectedProjectId}
                        onSaved={() => { fleet.refresh(); fleet.loadConfig(selectedProjectId); }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {activeTab === 'Flow' && configAgentData && selectedProjectId && (
        <AgentConfigPanel
          key={`${daemonUrl}:${selectedProjectId}:${configAgentData.name}`}
          agent={configAgentData}
          project={selectedProjectId}
          defaultTab={inspectorTab}
          fleetEvents={filteredFleetEvents}
          activity={filteredActivity}
          stories={filteredStories}
          open={!!configAgent}
          onClose={() => setConfigAgent(null)}
          onSaved={() => { fleet.refresh(); fleet.loadConfig(selectedProjectId); }}
        />
      )}
    </div>
  );
}
