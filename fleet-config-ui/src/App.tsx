import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, Sun, Moon, Square, Play } from 'lucide-react';
import { AllProjectsList } from './components/ProjectPicker';
import ProjectPicker from './components/ProjectPicker';
import AgentCard from './components/AgentCard';
import AgentConfigPanel from './components/AgentConfigPanel';
import FlowGraph from './components/FlowGraph';
import ChannelLog from './components/ChannelLog';
import ActivityRail from './components/ActivityRail';
import DMPanel from './components/DMPanel';
import SortiePanel from './components/SortiePanel';
import YAMLEditor from './components/YAMLEditor';
import ActivityPanel from './components/ActivityPanel';
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
import type { FleetConfig, TopologyValidation } from './types';

type MainTab = 'Fleet' | 'Activity' | 'Sorties' | 'YAML';
type RightRailTab = 'Activity' | 'Channels' | 'Inbox';
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
    case 'activity':
      return 'Activity';
    case 'sorties':
      return 'Sorties';
    case 'yaml':
      return 'YAML';
    default:
      return 'Fleet';
  }
}

function surfaceToRightRail(surface: ControlSurface): RightRailTab {
  switch (surface) {
    case 'channels':
      return 'Channels';
    case 'inbox':
      return 'Inbox';
    default:
      return 'Activity';
  }
}

function deriveSurface(activeTab: MainTab, rightRailTab: RightRailTab): ControlSurface {
  if (activeTab === 'Activity') return 'activity';
  if (activeTab === 'Sorties') return 'sorties';
  if (activeTab === 'YAML') return 'yaml';
  if (rightRailTab === 'Channels') return 'channels';
  if (rightRailTab === 'Inbox') return 'inbox';
  return 'flow';
}

function readInitialRoute(): { project: string | null; surface: ControlSurface } {
  if (!canUseWindow()) {
    return { project: null, surface: 'flow' };
  }

  const params = new URLSearchParams(window.location.search);
  const project = params.get('project');
  const surface = normalizeSurface(params.get('surface'));
  return {
    project: project && project.trim() ? project.trim() : null,
    surface,
  };
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({
  project,
  daemonRunning,
  daemonUrl,
  daemonChoices,
  onDaemonChange,
  theme,
  onToggleTheme,
  onBack,
}: {
  project?: string;
  daemonRunning: boolean;
  daemonUrl: string;
  daemonChoices: string[];
  onDaemonChange: (value: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onBack?: () => void;
}) {
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
        <button onClick={onToggleTheme} className="opacity-40 hover:opacity-80" style={{ color: 'var(--pd-text)' }}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
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

function noteMatchesProject(note: { sessionId: string; sessionPurpose?: string; content: string }, project: string | null, agentNames: string[]): boolean {
  if (!project) return true;
  const haystack = [note.sessionId, note.sessionPurpose || '', note.content].join(' ').toLowerCase();
  return haystack.includes(project.toLowerCase()) || agentNames.some((agent) => haystack.includes(agent.toLowerCase()));
}

function activityMatchesProject(entry: { agentId: string | null; targetId: string | null; details: string | null }, project: string | null, agentNames: string[]): boolean {
  if (!project) return true;
  const haystack = [entry.agentId || '', entry.targetId || '', entry.details || ''].join(' ').toLowerCase();
  return haystack.includes(project.toLowerCase()) || agentNames.some((agent) => haystack.includes(agent.toLowerCase()));
}

function summarizeChannelPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return String(payload ?? '');

  const candidate = payload as Record<string, unknown>;
  const preferredKeys = ['message', 'summary', 'content', 'text', 'details', 'error', 'status'];
  for (const key of preferredKeys) {
    if (typeof candidate[key] === 'string' && candidate[key]!.trim()) {
      return candidate[key] as string;
    }
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return '[message payload]';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function App() {
  const initialRoute = useMemo(() => readInitialRoute(), []);
  const [theme, toggleTheme] = useTheme();
  const [daemonUrl, setDaemonUrlState] = useState(() => getDaemonUrl());
  const [daemonChoices, setDaemonChoices] = useState(() => getDaemonChoices());
  const fleet = useFleet(daemonUrl);
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(initialRoute.project);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [configAgent, setConfigAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>(surfaceToMainTab(initialRoute.surface));
  const [rightRailTab, setRightRailTab] = useState<RightRailTab>(surfaceToRightRail(initialRoute.surface));

  const projects = useMemo(() => {
    if (!fleet.status) return [];
    return fleet.status.fleets.map(f => ({
      id: f.project, name: f.project, fleetPath: f.projectDir,
      agents: f.agents.map(a => ({ agentName: a.name, status: a.status as 'idle' | 'active' })),
    }));
  }, [fleet.status]);

  const selectedProject = fleet.status?.fleets.find(f => f.project === selectedProjectName) ?? null;

  useEffect(() => {
    if (fleet.loading || !selectedProjectName) return;
    if (projects.some((project) => project.id === selectedProjectName)) return;
    setSelectedProjectName(null);
  }, [fleet.loading, projects, selectedProjectName]);

  useEffect(() => {
    if (selectedProjectName && !fleet.configs.has(selectedProjectName)) {
      fleet.loadConfig(selectedProjectName);
    }
  }, [selectedProjectName, fleet]);

  useEffect(() => {
    if (!canUseWindow()) return;
    const next = new URL(window.location.href);
    const surface = deriveSurface(activeTab, rightRailTab);
    next.searchParams.set('surface', surface);
    if (selectedProjectName) {
      next.searchParams.set('project', selectedProjectName);
    } else {
      next.searchParams.delete('project');
    }
    window.history.replaceState({}, '', next);
  }, [activeTab, rightRailTab, selectedProjectName]);

  const projectConfig = selectedProjectName ? fleet.configs.get(selectedProjectName) : undefined;
  const fleetConfig: FleetConfig | null = projectConfig?.parsed ?? null;
  const topology: TopologyValidation | null = projectConfig?.topology ?? null;
  const selectedAgentNames = useMemo(() => selectedProject?.agents.map(agent => agent.name) ?? [], [selectedProject]);

  const channelNames = useMemo(() => {
    if (!fleetConfig) return [];
    const set = new Set<string>(Object.keys(fleetConfig.channels));
    fleetConfig.agents.forEach(a => {
      if (a.trigger) set.add(a.trigger);
      if (a.onSuccess) { const ch = a.onSuccess.split(' ')[1]; if (ch) set.add(ch); }
      if (a.onFailure) { const ch = a.onFailure.split(' ')[1]; if (ch) set.add(ch); }
    });
    return Array.from(set).sort();
  }, [fleetConfig]);

  const channelLog = useChannelLog(daemonUrl, channelNames);

  const filteredFleetEvents = useMemo(
    () => fleet.events.filter(event => !selectedProjectName || event.project === selectedProjectName),
    [fleet.events, selectedProjectName]
  );

  const filteredStories = useMemo(
    () => fleet.stories.filter((note) => noteMatchesProject(note, selectedProjectName, selectedAgentNames)),
    [fleet.stories, selectedProjectName, selectedAgentNames]
  );

  const filteredActivity = useMemo(
    () => fleet.activity.filter((entry) => activityMatchesProject(entry, selectedProjectName, selectedAgentNames)),
    [fleet.activity, selectedProjectName, selectedAgentNames]
  );

  const channelLogEvents = useMemo(() => {
    const realMessages = channelLog.messages.map((message) => ({
      id: `msg-${message.channel}-${message.id}`,
      ts: new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      channel: message.channel,
      publisher: message.sender ?? 'system',
      outcome: ((message.channel.includes('findings') || message.channel.includes('alert') || summarizeChannelPayload(message.payload).toLowerCase().includes('error'))
        ? 'findings'
        : 'clean') as 'clean' | 'findings',
      message: summarizeChannelPayload(message.payload),
      triggered: fleetConfig?.agents.filter((agent) => agent.trigger === message.channel).map((agent) => agent.name) ?? [],
    }));

    if (realMessages.length > 0) return realMessages;

    return filteredFleetEvents.map((event, index) => ({
      id: `ev-${index}`,
      ts: new Date(event.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      channel: event.type,
      publisher: event.agent ?? 'system',
      outcome: (event.type === 'agent_failed' ? 'findings' : 'clean') as 'clean' | 'findings',
      message: `${event.agent ?? 'system'} ${event.type.replace(/_/g, ' ')}`,
      triggered: [],
    }));
  }, [channelLog.messages, filteredFleetEvents, fleetConfig]);

  const selectProject = (name: string) => {
    setSelectedProjectName(name);
    setSelectedAgent(null);
    setSelectedChannel(null);
    setConfigAgent(null);
    setActiveTab('Fleet');
    setRightRailTab('Activity');
  };
  const goHome = () => {
    setSelectedProjectName(null);
    setSelectedAgent(null);
    setSelectedChannel(null);
    setConfigAgent(null);
    setActiveTab('Fleet');
    setRightRailTab('Activity');
  };

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
      setSelectedProjectName(null);
      setSelectedAgent(null);
      setSelectedChannel(null);
      setConfigAgent(null);
      setActiveTab('Fleet');
      setRightRailTab('Activity');
    } catch (err) {
      window.alert((err as Error).message);
    }
  }, [daemonUrl]);

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

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--pd-bg)', fontFamily: 'var(--pd-font-ui)' }}>
      <Header
        project={selectedProjectName ?? undefined}
        daemonRunning={daemonRunning}
        daemonUrl={daemonUrl}
        daemonChoices={daemonChoices}
        onDaemonChange={handleDaemonChange}
        theme={theme}
        onToggleTheme={toggleTheme}
        onBack={selectedProjectName ? goHome : undefined}
      />

      <AnimatePresence mode="wait">
        {!selectedProjectName ? (
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
          <motion.div key={`proj-${selectedProjectName}`} className="flex-1 overflow-hidden grid"
            style={{ gridTemplateColumns: '220px 1fr 300px', gridTemplateRows: '320px 1fr' }}
            initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>

            {/* Col 1, Row 1: Projects + stop/start */}
            <div className="overflow-hidden p-4 flex flex-col"
              style={{ gridColumn: 1, gridRow: 1, borderRight: '1px solid var(--pd-border)', borderBottom: '1px solid var(--pd-border)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-semibold tracking-wider opacity-30" style={{ color: 'var(--pd-text)' }}>PROJECTS</div>
                <button onClick={handleFleetToggle} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded"
                  style={{
                    backgroundColor: selectedProject?.agents.length ? 'var(--pd-accent-surface)' : 'var(--pd-success-surface)',
                    color: selectedProject?.agents.length ? 'var(--pd-accent)' : 'var(--pd-success)',
                    border: `1px solid ${selectedProject?.agents.length ? 'var(--pd-accent-border)' : 'var(--pd-success-border)'}`,
                  }}>
                  {selectedProject?.agents.length ? <><Square size={8} /> Stop Fleet</> : <><Play size={8} /> Start Fleet</>}
                </button>
              </div>
              <ProjectPicker projects={projects} selected={selectedProjectName} onSelect={selectProject} />
            </div>

            {/* Col 2-3, Row 1: Flow Graph */}
                <div className="overflow-hidden" style={{ gridColumn: '2 / 4', gridRow: 1, borderBottom: '1px solid var(--pd-border)' }}>
              {fleetConfig ? (
                <FlowGraph config={fleetConfig} topology={topology}
                  theme={theme}
                  selectedAgent={selectedAgent} selectedChannel={selectedChannel}
                  onAgentSelect={n => { setSelectedAgent(n); if (n) { setSelectedChannel(null); setRightRailTab('Channels'); } }}
                  onChannelSelect={c => { setSelectedChannel(c); if (c) { setSelectedAgent(null); setRightRailTab('Channels'); } }} />
              ) : (
                <div className="flex items-center justify-center h-full opacity-20" style={{ color: 'var(--pd-text)' }}>Loading config...</div>
              )}
            </div>

            {/* Col 1-2, Row 2: Tabs */}
            <div className="overflow-hidden flex flex-col" style={{ gridColumn: '1 / 3', gridRow: 2, borderRight: '1px solid var(--pd-border)' }}>
              <TabBar tabs={['Fleet', 'Activity', 'Sorties', 'YAML']} active={activeTab} onChange={(tab) => setActiveTab(tab as MainTab)} />
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'Fleet' && fleetConfig && (
                  <div className="p-4">
                    <div className="text-[10px] font-semibold tracking-wider opacity-25 mb-3" style={{ color: 'var(--pd-text)' }}>
                      {selectedProject?.agents.filter(a => a.status === 'running').length ?? 0} active · {fleetConfig.agents.length} agents
                    </div>
                    <motion.div layout className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                      {fleetConfig.agents.map(agent => {
                        const runtime = selectedProject?.agents.find(a => a.name === agent.name);
                        const isRelated = selectedAgent === agent.name
                          || (selectedChannel != null && (agent.trigger === selectedChannel || agent.onSuccess?.includes(selectedChannel) || agent.onFailure?.includes(selectedChannel)));
                        const dimmed = (selectedAgent != null && selectedAgent !== agent.name) || (selectedChannel != null && !isRelated);
                        return (
                          <AgentCard key={agent.name} agent={agent} runtimeStatus={runtime?.status} limits={fleetConfig.limits}
                            highlighted={!!isRelated} dimmed={dimmed}
                            onSelect={n => {
                              setSelectedAgent(prev => prev === n ? null : n);
                              setSelectedChannel(null);
                              setRightRailTab('Channels');
                            }}
                            onConfigure={setConfigAgent} />
                        );
                      })}
                    </motion.div>
                  </div>
                )}
                {activeTab === 'Activity' && (
                  <ActivityPanel
                    fleetEvents={filteredFleetEvents}
                    activity={filteredActivity}
                    stories={filteredStories}
                  />
                )}
                {activeTab === 'Sorties' && <SortiePanel key={`${daemonUrl}:${selectedProjectName ?? 'all'}`} project={selectedProjectName} />}
                {activeTab === 'YAML' && selectedProjectName && (
                  <YAMLEditor
                    key={`${daemonUrl}:${selectedProjectName}`}
                    project={selectedProjectName}
                    onSaved={() => { fleet.refresh(); fleet.loadConfig(selectedProjectName); }}
                  />
                )}
              </div>
            </div>

            {/* Col 3, Row 2: Channel Log + DM */}
            <div className="overflow-hidden flex flex-col" style={{ gridColumn: 3, gridRow: 2 }}>
              <TabBar tabs={['Activity', 'Channels', 'Inbox']} active={rightRailTab} onChange={(tab) => setRightRailTab(tab as 'Activity' | 'Channels' | 'Inbox')} />
              <div className="flex-1 overflow-hidden">
                {rightRailTab === 'Activity' && (
                  <ActivityRail
                    fleetEvents={filteredFleetEvents}
                    activity={filteredActivity}
                    stories={filteredStories}
                  />
                )}
                {rightRailTab === 'Channels' && (
                  <ChannelLog
                    events={channelLogEvents}
                    selectedAgent={selectedAgent}
                    selectedChannel={selectedChannel}
                    onChannelClick={ch => {
                      setSelectedChannel(prev => prev === ch ? null : ch);
                      setSelectedAgent(null);
                    }}
                  />
                )}
                {rightRailTab === 'Inbox' && (
                  <DMPanel key={daemonUrl} channels={channelNames} agents={fleetConfig?.agents.map(agent => agent.name) ?? []} project={selectedProjectName} />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {configAgentData && selectedProjectName && (
        <AgentConfigPanel
          key={`${daemonUrl}:${selectedProjectName}:${configAgentData.name}`}
          agent={configAgentData}
          project={selectedProjectName}
          open={!!configAgent}
          onClose={() => setConfigAgent(null)}
          onSaved={() => { fleet.refresh(); fleet.loadConfig(selectedProjectName); }}
        />
      )}
    </div>
  );
}
