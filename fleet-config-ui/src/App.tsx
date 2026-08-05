import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, CheckCircle2, FileCog, Gauge, ShieldCheck, ShipWheel, Sun, Moon, Play, RefreshCw, Square, Users, WalletCards, Wifi } from 'lucide-react';
import { AllProjectsList } from './components/ProjectPicker';
import ProjectPicker from './components/ProjectPicker';
import AgentCard from './components/AgentCard';
import AgentConfigPanel from './components/AgentConfigPanel';
// Lazy: FlowGraph is the sole @xyflow/react importer — splitting it keeps
// the graph engine out of the initial webview chunk (measured: 1056 kB → see PR).
const FlowGraph = lazy(() => import('./components/FlowGraph'));
import ChannelLog, { type ChannelEvent } from './components/ChannelLog';
import DMPanel from './components/DMPanel';
import SortiePanel from './components/SortiePanel';
import YAMLEditor from './components/YAMLEditor';
import ActivityPanel from './components/ActivityPanel';
import ActivityRail from './components/ActivityRail';
import MemoryPanel from './components/MemoryPanel';
import AgentsPanel from './components/AgentsPanel';
import RoadmapPanel from './components/RoadmapPanel';
import CockpitMissionsPanel from './components/CockpitMissionsPanel';
import ResourceGovernancePanel from './components/ResourceGovernancePanel';
import TubeConsolePanel from './components/TubeConsolePanel';
import TubeMessagePanel from './components/TubeMessagePanel';
import DispatchPanel from './components/DispatchPanel';
import CoastGuardPanel from './components/CoastGuardPanel';
import CockpitControlPanel from './components/CockpitControlPanel';
import VisualTaskPanel from './components/VisualTaskPanel';
import EventsRegistryPanel from './components/EventsRegistryPanel';
import { MetricsPanel } from './components/MetricsPanel';
import SessionGalaxyPanel from './components/SessionGalaxyPanel';
import ShipwrightPanel from './shipwright/ShipwrightPanel';
import OperatorStatePanel from './components/OperatorStatePanel';
import ApprovalsPanel from './components/ApprovalsPanel';
import { useOperatorState } from './hooks/useOperatorState';
import { extractMentionedPaths } from './fileMentions';
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
  pauseFleetAgent,
  resumeFleetAgent,
  runFleetAgent,
  fetchCoordinationGuard,
  runCoordinationGuardAction,
  setFleetConfigBudget,
  startFleet,
  stopFleet,
  formatDaemonLabel,
  CUSTOM_DAEMON_SENTINEL,
  getDaemonChoices,
  getDaemonUrl,
  setDaemonUrl,
} from './api';
import type {
  ActivityEntry,
  CoordinationGuardAction,
  CoordinationGuardCheck,
  CoordinationGuardStatus,
  FleetConfig,
  FleetEvent,
  FleetLimits,
  ResolvedChannelTarget,
  StoryNote,
  TopologyValidation,
} from './types';

type MainTab = 'Operator' | 'Flow' | 'Roadmap' | 'Agents' | 'Visual' | 'Resources' | 'Activity' | 'Channels' | 'Tube' | 'TubeBrowser' | 'Events' | 'Inbox' | 'Sorties' | 'Memory' | 'Metrics' | 'Galaxy' | 'Dispatch' | 'CoastGuard' | 'Cockpit' | 'Shipwright' | 'YAML';
type ControlSurface = 'operator' | 'flow' | 'roadmap' | 'agents' | 'visual' | 'resources' | 'activity' | 'channels' | 'tube' | 'tubebrowser' | 'events' | 'inbox' | 'sorties' | 'memory' | 'metrics' | 'galaxy' | 'dispatch' | 'coastguard' | 'cockpit' | 'shipwright' | 'yaml';

function canUseWindow(): boolean {
  return typeof window !== 'undefined';
}

function normalizeSurface(value: string | null): ControlSurface {
  switch (value) {
    case 'operator':
    case 'activity':
    case 'channels':
    case 'tube':
    case 'tubebrowser':
    case 'events':
    case 'inbox':
    case 'sorties':
    case 'memory':
    case 'metrics':
    case 'galaxy':
    case 'dispatch':
    case 'coastguard':
    case 'cockpit':
    case 'roadmap':
    case 'shipwright':
    case 'yaml':
    case 'agents':
    case 'visual':
    case 'resources':
    case 'flow':
      return value;
    default:
      return 'operator';
  }
}

function surfaceToMainTab(surface: ControlSurface): MainTab {
  switch (surface) {
    case 'operator':
      return 'Operator';
    case 'flow':
      return 'Flow';
    case 'roadmap':
      return 'Roadmap';
    case 'agents':
      return 'Agents';
    case 'visual':
      return 'Visual';
    case 'resources':
      return 'Resources';
    case 'activity':
      return 'Activity';
    case 'channels':
      return 'Channels';
    case 'tube':
      return 'Tube';
    case 'tubebrowser':
      return 'TubeBrowser';
    case 'events':
      return 'Events';
    case 'inbox':
      return 'Inbox';
    case 'sorties':
      return 'Sorties';
    case 'memory':
      return 'Memory';
    case 'metrics':
      return 'Metrics';
    case 'galaxy':
      return 'Galaxy';
    case 'dispatch':
      return 'Dispatch';
    case 'coastguard':
      return 'CoastGuard';
    case 'cockpit':
      return 'Cockpit';
    case 'shipwright':
      return 'Shipwright';
    case 'yaml':
      return 'YAML';
    default:
      return 'Flow';
  }
}

function mainTabToSurface(activeTab: MainTab): ControlSurface {
  if (activeTab === 'Operator') return 'operator';
  if (activeTab === 'Agents') return 'agents';
  if (activeTab === 'Visual') return 'visual';
  if (activeTab === 'Resources') return 'resources';
  if (activeTab === 'Roadmap') return 'roadmap';
  if (activeTab === 'Activity') return 'activity';
  if (activeTab === 'Channels') return 'channels';
  if (activeTab === 'Tube') return 'tube';
  if (activeTab === 'TubeBrowser') return 'tubebrowser';
  if (activeTab === 'Events') return 'events';
  if (activeTab === 'Inbox') return 'inbox';
  if (activeTab === 'Sorties') return 'sorties';
  if (activeTab === 'Memory') return 'memory';
  if (activeTab === 'Metrics') return 'metrics';
  if (activeTab === 'Galaxy') return 'galaxy';
  if (activeTab === 'Dispatch') return 'dispatch';
  if (activeTab === 'CoastGuard') return 'coastguard';
  if (activeTab === 'Cockpit') return 'cockpit';
  if (activeTab === 'Shipwright') return 'shipwright';
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
      files: extractMentionedPaths(story.content, 6),
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
      files: extractMentionedPaths(summary, 6),
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
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <Wifi className="shrink-0" size={14} color="var(--pd-accent)" />
        <button onClick={onBack} className="shrink-0 font-bold tracking-wide text-sm hover:opacity-80 font-mono" style={{ color: 'var(--pd-text)' }}>
          PortDaddy
        </button>
        <span className="hidden opacity-20 sm:inline" style={{ color: 'var(--pd-text)' }}>:</span>
        <span className="hidden text-xs tracking-widest sm:inline" style={{ color: 'var(--pd-muted)' }}>AGENTIC CONTROL PLANE</span>
        {project && <>
          <span className="hidden opacity-20 sm:inline" style={{ color: 'var(--pd-text)' }}>·</span>
          <span className="min-w-0 truncate text-sm font-mono" style={{ color: 'var(--pd-accent)' }}>{project}</span>
        </>}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-2 sm:justify-end">
        <div className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
          <span className="hidden text-[10px] font-semibold tracking-wider opacity-35 sm:inline" style={{ color: 'var(--pd-text)' }}>
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
          <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <div className="hidden items-center gap-1.5 lg:flex">
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
    <div className="flex gap-0.5 overflow-x-auto px-4 pt-2" style={{ borderBottom: '1px solid var(--pd-border)' }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)}
          className="shrink-0 whitespace-nowrap px-3 py-1.5 text-[11px] font-semibold tracking-wide rounded-t"
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

function ProjectControlStrip({
  project,
  running,
  configuredAgents,
  runtimeAgents,
  onToggleFleet,
  onRefresh,
  onShowAgents,
  onEditYaml,
  onOpenShipwright,
}: {
  project: string;
  running: boolean;
  configuredAgents: number;
  runtimeAgents: number;
  onToggleFleet: () => void;
  onRefresh: () => void;
  onShowAgents: () => void;
  onEditYaml: () => void;
  onOpenShipwright: () => void;
}) {
  return (
    <div
      className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
      style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>PROJECT CONTROL</div>
          <div className="text-sm font-semibold mt-1" style={{ color: 'var(--pd-text)' }}>{project}</div>
        </div>
        <div className="flex items-center gap-2 text-[11px] flex-wrap">
          <span className="rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
            {configuredAgents} configured
          </span>
          <span className="rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
            {runtimeAgents} fleet runtime
          </span>
          <span className="rounded-full px-2 py-0.5 font-semibold" style={{
            backgroundColor: running ? 'var(--pd-success-surface)' : 'var(--pd-accent-surface)',
            color: running ? 'var(--pd-success)' : 'var(--pd-accent)',
            border: `1px solid ${running ? 'var(--pd-success-border)' : 'var(--pd-accent-border)'}`,
          }}>
            {running ? 'fleet running' : 'fleet stopped'}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onToggleFleet}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{
            backgroundColor: running ? 'var(--pd-accent-surface)' : 'var(--pd-success-surface)',
            color: running ? 'var(--pd-accent)' : 'var(--pd-success)',
            border: `1px solid ${running ? 'var(--pd-accent-border)' : 'var(--pd-success-border)'}`,
          }}
        >
          {running ? <Square size={13} /> : <Play size={13} />}
          <span>{running ? 'Stop fleet' : 'Start fleet'}</span>
        </button>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
        >
          <RefreshCw size={13} />
          <span>Refresh</span>
        </button>
        <button
          onClick={onShowAgents}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
        >
          <Users size={13} />
          <span>All agents</span>
        </button>
        <button
          onClick={onOpenShipwright}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
        >
          <ShipWheel size={13} />
          <span>Shipwright</span>
        </button>
        <button
          onClick={onEditYaml}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
        >
          <span>YAML</span>
        </button>
      </div>
    </div>
  );
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `$${value.toFixed(2)}`;
}

function guardModeCopy(status: CoordinationGuardStatus | null): string {
  if (!status) return 'unknown';
  if (!status.enabled || status.mode === 'off') return 'off';
  return status.mode;
}

function guardCheckCopy(check: CoordinationGuardCheck | null): string | null {
  if (!check) return null;
  if (check.passed) {
    return check.files.length > 0
      ? `passed on ${check.files.length} staged file${check.files.length === 1 ? '' : 's'}`
      : 'passed: no staged files';
  }
  return `${check.violations.length} blocker${check.violations.length === 1 ? '' : 's'} found`;
}

function OperatorCockpitDeck({
  running,
  configuredAgents,
  runtimeAgents,
  activeRuntimeAgents,
  limits,
  noteCount,
  mutationFileCount,
  eventCount,
  selectedAgent,
  selectedChannel,
  coordinationGuard,
  coordinationGuardCheck,
  coordinationGuardBusy,
  coordinationGuardError,
  onClearFocus,
  onToggleFleet,
  onRefresh,
  onShowAgents,
  onEditYaml,
  onOpenShipwright,
  onSetBudget,
  onCoordinationGuardAction,
}: {
  running: boolean;
  configuredAgents: number;
  runtimeAgents: number;
  activeRuntimeAgents: number;
  limits?: FleetLimits;
  noteCount: number;
  mutationFileCount: number;
  eventCount: number;
  selectedAgent: string | null;
  selectedChannel: string | null;
  coordinationGuard: CoordinationGuardStatus | null;
  coordinationGuardCheck: CoordinationGuardCheck | null;
  coordinationGuardBusy: CoordinationGuardAction | null;
  coordinationGuardError: string | null;
  onClearFocus: () => void;
  onToggleFleet: () => void;
  onRefresh: () => void;
  onShowAgents: () => void;
  onEditYaml: () => void;
  onOpenShipwright: () => void;
  onSetBudget: (usdPerDay: number) => Promise<void>;
  onCoordinationGuardAction: (action: CoordinationGuardAction) => void;
}) {
  const budget = limits?.budgetUsdPerDay;
  const hasBudget = typeof budget === 'number' && Number.isFinite(budget) && budget > 0;
  const [budgetDraft, setBudgetDraft] = useState(hasBudget ? budget.toFixed(2) : '5.00');
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const focusLabel = selectedAgent ? `agent:${selectedAgent}` : selectedChannel ? `channel:${selectedChannel}` : 'whole fleet';
  const guardMode = guardModeCopy(coordinationGuard);
  const guardActive = guardMode === 'enforce';
  const guardCheck = guardCheckCopy(coordinationGuardCheck);
  const guardStatusText = coordinationGuardError
    ? coordinationGuardError
    : guardCheck ?? (guardActive ? 'enforce mode: session + file claims required' : 'install enforce mode for this project');
  const parsedBudgetDraft = Number(budgetDraft);
  const budgetDraftValid = Number.isFinite(parsedBudgetDraft) && parsedBudgetDraft > 0;
  const budgetChanged = !hasBudget || Math.abs(parsedBudgetDraft - budget) > 0.0001;

  useEffect(() => {
    if (hasBudget) {
      setBudgetDraft(budget.toFixed(2));
    } else {
      setBudgetDraft('5.00');
    }
    setBudgetError(null);
  }, [budget, hasBudget]);

  const applyBudget = async (usdPerDay: number) => {
    if (!Number.isFinite(usdPerDay) || usdPerDay <= 0) {
      setBudgetError('Enter a positive daily cap.');
      return;
    }
    setBudgetBusy(true);
    setBudgetError(null);
    try {
      await onSetBudget(usdPerDay);
      setBudgetDraft(usdPerDay.toFixed(2));
    } catch (err) {
      setBudgetError((err as Error).message);
    } finally {
      setBudgetBusy(false);
    }
  };

  return (
    <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>OPERATOR COCKPIT</div>
          <div className="mt-1 text-sm font-semibold truncate" style={{ color: 'var(--pd-text)' }}>
            Actions, budget, and signal priority
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span
            className="rounded-full px-2 py-1 text-[10px] font-semibold"
            style={{
              backgroundColor: running ? 'var(--pd-success-surface)' : 'var(--pd-warning-surface)',
              color: running ? 'var(--pd-success)' : 'var(--pd-warning)',
              border: `1px solid ${running ? 'var(--pd-success-border)' : 'var(--pd-warning-border)'}`,
            }}
          >
            {running ? 'run controls active' : 'start fleet to run agents'}
          </span>
          <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
            focus: {focusLabel}
          </span>
          {(selectedAgent || selectedChannel) && (
            <button
              onClick={onClearFocus}
              className="text-[10px] px-2 py-1 rounded"
              style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}
            >
              Clear focus
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 2xl:grid-cols-[minmax(260px,0.9fr)_minmax(260px,0.85fr)_minmax(300px,1fr)]">
        <div className="rounded-lg border px-3 py-3" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
            <Gauge size={12} />
            <span>ACTIONS</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={onToggleFleet}
              className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-semibold"
              style={{
                backgroundColor: running ? 'var(--pd-accent-surface)' : 'var(--pd-success-surface)',
                color: running ? 'var(--pd-accent)' : 'var(--pd-success)',
                border: `1px solid ${running ? 'var(--pd-accent-border)' : 'var(--pd-success-border)'}`,
              }}
            >
              {running ? <Square size={13} /> : <Play size={13} />}
              <span>{running ? 'Stop fleet' : 'Start fleet'}</span>
            </button>
            <button
              onClick={onRefresh}
              className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-semibold"
              style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
            >
              <RefreshCw size={13} />
              <span>Refresh</span>
            </button>
            <button
              onClick={onShowAgents}
              className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-semibold"
              style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
            >
              <Users size={13} />
              <span>Agents</span>
            </button>
            <button
              onClick={onOpenShipwright}
              className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-semibold"
              style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
            >
              <ShipWheel size={13} />
              <span>Shipwright</span>
            </button>
            <button
              onClick={onEditYaml}
              className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-semibold"
              style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
            >
              <FileCog size={13} />
              <span>YAML</span>
            </button>
          </div>
          <div
            className="mt-3 rounded-lg border px-2.5 py-2"
            style={{
              backgroundColor: guardActive ? 'var(--pd-success-surface)' : 'var(--pd-warning-surface)',
              borderColor: guardActive ? 'var(--pd-success-border)' : 'var(--pd-warning-border)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider" style={{ color: guardActive ? 'var(--pd-success)' : 'var(--pd-warning)' }}>
                <ShieldCheck size={12} />
                <span>COORDINATION GUARD</span>
              </div>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: guardActive ? 'var(--pd-success)' : 'var(--pd-warning)' }}>
                {guardMode}
              </span>
            </div>
            <div className="mt-1 text-[10px] font-semibold leading-snug" style={{ color: coordinationGuardError ? 'var(--pd-accent)' : 'var(--pd-muted)' }}>
              {guardStatusText}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(['check', 'enable', 'install'] as CoordinationGuardAction[]).map((action) => (
                <button
                  key={action}
                  disabled={coordinationGuardBusy !== null}
                  onClick={() => onCoordinationGuardAction(action)}
                  className="rounded-md px-2 py-1.5 text-[10px] font-semibold capitalize disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'var(--pd-surface)',
                    color: 'var(--pd-text)',
                    border: '1px solid var(--pd-border)',
                    opacity: coordinationGuardBusy && coordinationGuardBusy !== action ? 0.55 : 1,
                  }}
                >
                  {coordinationGuardBusy === action ? 'Running' : action === 'install' ? 'Install hook' : action}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border px-3 py-3" style={{ backgroundColor: 'var(--pd-bg)', borderColor: hasBudget ? 'var(--pd-success-border)' : 'var(--pd-warning-border)' }}>
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
            <WalletCards size={12} />
            <span>BUDGET</span>
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <div className="text-lg font-mono font-semibold" style={{ color: hasBudget ? 'var(--pd-success)' : 'var(--pd-warning)' }}>
                {hasBudget ? `${formatUsd(budget)}/day` : 'no cap'}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold" style={{ color: 'var(--pd-muted)' }}>
                {hasBudget ? 'configured daily ceiling' : 'launches will fail closed'}
              </div>
            </div>
            <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: hasBudget ? 'var(--pd-success-surface)' : 'var(--pd-warning-surface)', color: hasBudget ? 'var(--pd-success)' : 'var(--pd-warning)' }}>
              {hasBudget ? 'non-zero' : 'missing'}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="min-w-0">
              <span className="block text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>DAILY CAP USD</span>
              <input
                type="number"
                min="0.01"
                step="0.25"
                inputMode="decimal"
                value={budgetDraft}
                onChange={(event) => {
                  setBudgetDraft(event.target.value);
                  if (budgetError) setBudgetError(null);
                }}
                className="mt-1 w-full rounded-md px-2 py-2 text-sm font-mono"
                style={{
                  backgroundColor: 'var(--pd-surface)',
                  color: 'var(--pd-text)',
                  border: `1px solid ${budgetDraftValid ? 'var(--pd-border)' : 'var(--pd-warning-border)'}`,
                }}
                aria-label="Daily budget cap in USD"
              />
            </label>
            <div className="flex items-end gap-2">
              {!hasBudget && (
                <button
                  type="button"
                  disabled={budgetBusy}
                  onClick={() => void applyBudget(5)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-semibold disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'var(--pd-success-surface)',
                    color: 'var(--pd-success)',
                    border: '1px solid var(--pd-success-border)',
                    opacity: budgetBusy ? 0.6 : 1,
                  }}
                >
                  <WalletCards size={13} />
                  <span>Set $5/day</span>
                </button>
              )}
              <button
                type="button"
                disabled={budgetBusy || !budgetDraftValid || !budgetChanged}
                onClick={() => void applyBudget(parsedBudgetDraft)}
                className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-semibold disabled:cursor-not-allowed"
                style={{
                  backgroundColor: budgetChanged ? 'var(--pd-success-surface)' : 'var(--pd-surface)',
                  color: budgetChanged ? 'var(--pd-success)' : 'var(--pd-muted)',
                  border: `1px solid ${budgetChanged ? 'var(--pd-success-border)' : 'var(--pd-border)'}`,
                  opacity: budgetBusy || !budgetDraftValid || !budgetChanged ? 0.65 : 1,
                }}
              >
                <CheckCircle2 size={13} />
                <span>{budgetBusy ? 'Saving' : 'Apply cap'}</span>
              </button>
            </div>
          </div>
          {budgetError ? (
            <div className="mt-2 text-[10px] font-semibold" style={{ color: 'var(--pd-accent)' }}>
              {budgetError}
            </div>
          ) : (
            <div className="mt-2 text-[10px]" style={{ color: 'var(--pd-muted)' }}>
              Writes <span className="font-mono">limits.budget_usd_per_day</span> and refreshes this fleet.
            </div>
          )}
        </div>

        <div className="rounded-lg border px-3 py-3" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
            <ShieldCheck size={12} />
            <span>SIGNAL VALUE</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
            <span className="rounded-md px-2 py-1.5 font-semibold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)' }}>
              {activeRuntimeAgents}/{runtimeAgents} live
            </span>
            <span className="rounded-md px-2 py-1.5 font-semibold" style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
              {configuredAgents} configured
            </span>
            <span className="rounded-md px-2 py-1.5 font-semibold" style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
              {noteCount} notes
            </span>
            <span className="rounded-md px-2 py-1.5 font-semibold" style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
              {mutationFileCount} files
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--pd-muted)' }}>
            <CheckCircle2 size={11} />
            <span>{eventCount} meaningful live signals after filtering</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoordinationCallouts({
  events,
  onOpenChannel,
}: {
  events: ChannelEvent[];
  onOpenChannel: (channel: string) => void;
}) {
  if (events.length === 0) return null;

  const latest = events.slice(0, 3);

  return (
    <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-accent-surface)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-accent)' }}>COORDINATION INCONSISTENCY</div>
          <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {events.length} operator-worthy cross-agent signal{events.length === 1 ? '' : 's'} need review.
          </div>
          <div className="mt-1 text-xs" style={{ color: 'var(--pd-muted)' }}>
            These are not routine status updates. They indicate overlapping claims, planning/UX drift, trust-boundary/API-shape drift, stale active/dead signals, or budget activation risks.
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenChannel('coordination:inconsistency')}
          className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)', backgroundColor: 'var(--pd-bg)' }}
        >
          Open channel
        </button>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {latest.map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => onOpenChannel(event.channel)}
            className="rounded-lg border px-3 py-2 text-left"
            style={{ borderColor: 'var(--pd-accent-border)', backgroundColor: 'var(--pd-bg)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px]" style={{ color: 'var(--pd-dim)' }}>{event.ts}</span>
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ color: 'var(--pd-accent)', backgroundColor: 'var(--pd-accent-surface)' }}>
                REVIEW
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--pd-text)' }}>{event.message}</div>
          </button>
        ))}
      </div>
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
    const value = candidate[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
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

function isCoordinationInconsistencyChannel(channel: string): boolean {
  return channel === 'coordination:inconsistency' || channel.endsWith(':coordination:inconsistency');
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
  const [browserResolvedChannels, setBrowserResolvedChannels] = useState<Record<string, string>>({});
  const [coordinationGuard, setCoordinationGuard] = useState<CoordinationGuardStatus | null>(null);
  const [coordinationGuardCheck, setCoordinationGuardCheck] = useState<CoordinationGuardCheck | null>(null);
  const [coordinationGuardBusy, setCoordinationGuardBusy] = useState<CoordinationGuardAction | null>(null);
  const [coordinationGuardError, setCoordinationGuardError] = useState<string | null>(null);

  const projects = useMemo(() => {
    const runtimeByDir = new Map((fleet.status?.fleets ?? []).map((fleetProject) => [fleetProject.projectDir, fleetProject]));
    const known = new Map<string, {
      id: string;
      name: string;
      logicalId: string;
      fleetPath: string;
      projectDir: string;
      running: boolean;
      agents: Array<{ agentName: string; status: string }>;
      configuredAgentCount: number;
      configuredWatcherCount: number;
      signals: string[];
      sources: string[];
      worktree: {
        id: string;
        name: string;
        branch: string | null;
        isMain: boolean;
        repoKey: string;
        repoRoot: string | null;
        siblingCount: number;
      } | null;
      operatorState?: 'running' | 'ready' | 'blocked' | 'service_only' | 'context_only' | 'missing';
      operatorSummary?: string;
      operatorNextAction?: string;
      fleetConfigStatus?: 'ready' | 'missing_budget' | 'invalid' | 'missing';
      budgetUsdPerDay?: number | null;
      configError?: string | null;
      configWarnings?: string[];
      remediation?: {
        action: 'start_fleet' | 'set_budget' | 'fix_yaml' | 'create_fleet' | 'run_scan';
        title: string;
        detail: string;
        command?: string;
        suggestedBudgetUsdPerDay?: number;
      } | null;
    }>();

    for (const project of fleet.projects) {
      const runtime = runtimeByDir.get(project.root);
      known.set(project.root, {
        id: project.root,
        name: project.displayName ?? project.id,
        logicalId: project.id,
        fleetPath: project.root,
        projectDir: project.root,
        running: runtime?.running ?? project.running ?? false,
        agents: runtime?.agents.map(agent => ({ agentName: agent.name, status: agent.status })) ?? [],
        configuredAgentCount: project.configuredAgentCount ?? 0,
        configuredWatcherCount: project.configuredWatcherCount ?? 0,
        signals: project.signals ?? [],
        sources: project.sources ?? [],
        worktree: project.worktree ?? null,
        operatorState: project.operatorState,
        operatorSummary: project.operatorSummary,
        operatorNextAction: project.operatorNextAction,
        fleetConfigStatus: project.fleetConfigStatus,
        budgetUsdPerDay: project.budgetUsdPerDay,
        configError: project.configError,
        configWarnings: project.configWarnings ?? [],
        remediation: project.remediation,
      });
    }

    for (const runtime of fleet.status?.fleets ?? []) {
      const existing = known.get(runtime.projectDir);
      known.set(runtime.projectDir, {
        id: runtime.projectDir,
        name: existing?.name ?? runtime.project,
        logicalId: existing?.logicalId ?? runtime.project,
        fleetPath: runtime.projectDir,
        projectDir: runtime.projectDir,
        running: runtime.running,
        agents: runtime.agents.map(agent => ({ agentName: agent.name, status: agent.status })),
        configuredAgentCount: existing?.configuredAgentCount ?? runtime.agents.length,
        configuredWatcherCount: existing?.configuredWatcherCount ?? 0,
        signals: existing?.signals ?? [],
        sources: [...new Set([...(existing?.sources ?? []), 'runtime'])],
        worktree: existing?.worktree ?? null,
        operatorState: existing?.operatorState ?? 'running',
        operatorSummary: existing?.operatorSummary,
        operatorNextAction: existing?.operatorNextAction,
        fleetConfigStatus: existing?.fleetConfigStatus,
        budgetUsdPerDay: existing?.budgetUsdPerDay,
        configError: existing?.configError,
        configWarnings: existing?.configWarnings ?? [],
        remediation: existing?.remediation,
      });
    }

    return Array.from(known.values());
  }, [fleet.projects, fleet.status]);

  const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null;
  const selectedProjectName = selectedProject?.name ?? null;

  useEffect(() => {
    if (fleet.loading || fleet.error || !selectedProjectId) return;
    if (projects.some((project) => project.id === selectedProjectId)) return;
    const timeout = window.setTimeout(() => {
      setSelectedProjectId((current) => current === selectedProjectId ? null : current);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [fleet.error, fleet.loading, projects, selectedProjectId]);

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
    const timeout = window.setTimeout(() => {
      setInspectorTab('details');
      setConfigAgent((current) => current === configAgent ? selectedAgent : current);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [configAgent, selectedAgent]);

  useEffect(() => {
    if (activeTab === 'Flow') return;
    const timeout = window.setTimeout(() => {
      setConfigAgent(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activeTab]);

  const projectConfig = selectedProjectId ? fleet.configs.get(selectedProjectId) : undefined;
  const fleetConfig: FleetConfig | null = projectConfig?.parsed ?? null;
  const topology: TopologyValidation | null = projectConfig?.topology ?? null;
  const selectedAgentNames = useMemo(() => selectedProject?.agents.map(agent => agent.agentName) ?? [], [selectedProject]);
  const selectedProjectDir = selectedProject?.projectDir ?? null;

  const refreshCoordinationGuard = useCallback(async () => {
    if (!selectedProjectDir) {
      setCoordinationGuard(null);
      setCoordinationGuardCheck(null);
      setCoordinationGuardError(null);
      return;
    }
    try {
      const result = await fetchCoordinationGuard(selectedProjectDir);
      setCoordinationGuard(result.status);
      setCoordinationGuardError(null);
    } catch (err) {
      setCoordinationGuard(null);
      setCoordinationGuardError((err as Error).message);
    }
  }, [selectedProjectDir]);

  useEffect(() => {
    void refreshCoordinationGuard();
  }, [refreshCoordinationGuard]);

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

  const flowBackendRoster = useMemo(() => {
    if (!fleetConfig) return [];
    const counts = new Map<string, number>();
    for (const agent of fleetConfig.agents) {
      const label = [agent.backend, agent.model].filter(Boolean).join(' · ');
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
  }, [fleetConfig]);

  const flowMutationFileCount = useMemo(
    () => new Set(agentActivitySignals.flatMap((signal) => signal.files)).size,
    [agentActivitySignals],
  );

  const flowNoteCount = useMemo(
    () => filteredStories.filter(isMeaningfulStory).length,
    [filteredStories],
  );

  const flowEventCount = useMemo(
    () => filteredFleetEvents.length + filteredActivity.filter(isMeaningfulActivityEntry).length,
    [filteredActivity, filteredFleetEvents],
  );

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
          outcome: ((message.channel.includes('findings') || message.channel.includes('alert') || isCoordinationInconsistencyChannel(message.channel) || summary.toLowerCase().includes('error'))
            ? 'findings'
            : 'clean') as 'clean' | 'findings',
          message: summary,
          triggered: fleetConfig?.agents.filter((agent) => agent.trigger === message.channel).map((agent) => agent.name) ?? [],
        };
      })
      .filter((message): message is NonNullable<typeof message> => !!message);

    return realMessages;
  }, [channelLog.messages, fleetConfig]);

  const coordinationCallouts = useMemo(
    () => channelLogEvents.filter((event) => isCoordinationInconsistencyChannel(event.channel)),
    [channelLogEvents],
  );

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

  const handleFleetToggle = useCallback(async () => {
    if (!selectedProject) return;
    try {
      if (selectedProject.running) await stopFleet(selectedProject.projectDir);
      else await startFleet(selectedProject.projectDir);
      fleet.refresh();
    } catch (err) { alert((err as Error).message); }
  }, [selectedProject, fleet]);

  const handleStartProject = useCallback(async (projectDir: string) => {
    try {
      await startFleet(projectDir);
      fleet.refresh();
      fleet.refreshFeeds();
    } catch (err) {
      alert((err as Error).message);
    }
  }, [fleet]);

  const handleSetProjectBudget = useCallback(async (projectDir: string, usdPerDay: number, options: { showAlert?: boolean } = {}) => {
    try {
      await setFleetConfigBudget(projectDir, usdPerDay);
      fleet.refresh();
      fleet.loadConfig(projectDir);
    } catch (err) {
      if (options.showAlert !== false) {
        alert((err as Error).message);
      }
      throw err;
    }
  }, [fleet]);

  const handleOpenProjectYaml = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedAgent(null);
    setSelectedChannel(null);
    setConfigAgent(null);
    setActiveTab('YAML');
  }, []);

  const handleAgentRunNow = useCallback(async (agentName: string) => {
    if (!selectedProjectId) return;
    try {
      await runFleetAgent(selectedProjectId, agentName);
      fleet.refresh();
      fleet.refreshFeeds();
    } catch (err) {
      alert((err as Error).message);
    }
  }, [fleet, selectedProjectId]);

  const handleAgentPauseToggle = useCallback(async (agentName: string, paused: boolean) => {
    if (!selectedProjectId) return;
    try {
      if (paused) {
        await resumeFleetAgent(selectedProjectId, agentName);
      } else {
        await pauseFleetAgent(selectedProjectId, agentName);
      }
      fleet.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }, [fleet, selectedProjectId]);

  const configAgentData = fleetConfig?.agents.find(a => a.name === configAgent);
  // Operator state — single /operator/state fetch driving the Operator tab
  const operatorStateHook = useOperatorState({
    project: selectedProjectName ?? undefined,
    projectDir: selectedProjectDir ?? undefined,
    enabled: activeTab === 'Operator' || !selectedProjectId,
  });

  // Online = the daemon is REACHABLE, not whether the fleet engine is "running".
  // Either successful read proves reachability: the fleet-status fetch (useFleet,
  // which may resolve a different daemon URL than the Operator surface) OR the
  // /operator/state fetch the control center actually renders from. Tolerating
  // either avoids a false "offline" when one resolver path is unavailable but the
  // daemon is plainly up (the bug: badge read "offline" while serving live data).
  const daemonRunning =
    (!!fleet.status && !fleet.error) ||
    (!!operatorStateHook.state && !operatorStateHook.error);

  const surfaceTabs: MainTab[] = ['Operator', 'Flow', 'Roadmap', 'Agents', 'Visual', 'Resources', 'Activity', 'Channels', 'Tube', 'TubeBrowser', 'Events', 'Inbox', 'Sorties', 'Memory', 'Metrics', 'Galaxy', 'Dispatch', 'Cockpit', 'CoastGuard', 'Shipwright', 'YAML'];
  // Agent accounting and visual task intake both work before the operator picks a repo.
  // Project selection narrows them when FleetBar opens either surface in context.
  const allProjectSurfaceTabs: MainTab[] = ['Operator', 'Flow', 'Agents', 'Visual', 'Metrics', 'Galaxy', 'TubeBrowser', 'Dispatch', 'Cockpit', 'CoastGuard', 'Shipwright'];
  const showProjectSidebar = activeTab === 'Flow' && !embedded;
  const visibleSurfaceTabs = selectedProjectId ? surfaceTabs : allProjectSurfaceTabs;
  const handleProjectRefresh = useCallback(() => {
    fleet.refresh();
    fleet.refreshFeeds();
    if (selectedProjectId) {
      fleet.loadConfig(selectedProjectId);
    }
    void refreshCoordinationGuard();
  }, [fleet, selectedProjectId, refreshCoordinationGuard]);

  const handleCoordinationGuardAction = useCallback(async (action: CoordinationGuardAction) => {
    if (!selectedProjectDir) return;
    setCoordinationGuardBusy(action);
    setCoordinationGuardError(null);
    try {
      const result = await runCoordinationGuardAction({
        projectDir: selectedProjectDir,
        action,
        mode: 'enforce',
      });
      setCoordinationGuard(result.status);
      if (result.check) setCoordinationGuardCheck(result.check);
      else setCoordinationGuardCheck(null);
    } catch (err) {
      setCoordinationGuardError((err as Error).message);
    } finally {
      setCoordinationGuardBusy(null);
    }
  }, [selectedProjectDir]);

  const projectSidebar = selectedProject ? (
    <div className="h-full overflow-hidden p-4 flex flex-col"
      style={{ borderRight: '1px solid var(--pd-border)', backgroundColor: 'color-mix(in srgb, var(--pd-surface) 74%, var(--pd-bg))' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-semibold tracking-wider opacity-30" style={{ color: 'var(--pd-text)' }}>PROJECTS</div>
        <button onClick={handleFleetToggle} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded"
          style={{
            backgroundColor: selectedProject.running ? 'var(--pd-accent-surface)' : 'var(--pd-success-surface)',
            color: selectedProject.running ? 'var(--pd-accent)' : 'var(--pd-success)',
            border: `1px solid ${selectedProject.running ? 'var(--pd-accent-border)' : 'var(--pd-success-border)'}`,
          }}>
          {selectedProject.running ? <><Square size={8} /> Stop Fleet</> : <><Play size={8} /> Start Fleet</>}
        </button>
      </div>
      <ProjectPicker
        projects={projects}
        selected={selectedProjectId}
        onSelect={selectProject}
        onStartProject={(project) => void handleStartProject(project.projectDir)}
        onSetBudget={(project, usdPerDay) => void handleSetProjectBudget(project.projectDir, usdPerDay).catch(() => undefined)}
      />
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

      {!embedded && (
        // Always show the TabBar in non-embedded mode. `visibleSurfaceTabs`
        // narrows to daemon-level tabs (Flow / Metrics / Shipwright) when no
        // project is selected, so the bar stays useful as the entry point for
        // daemon-level surfaces (previously you had no way to reach Metrics
        // from the default Flow tab without picking a project first).
        <TabBar tabs={visibleSurfaceTabs} active={activeTab} onChange={(tab) => setActiveTab(tab as MainTab)} />
      )}

      {selectedProject && !embedded && (
        <ProjectControlStrip
          project={selectedProject.name}
          running={selectedProject.running}
          configuredAgents={fleetConfig?.agents.length ?? 0}
          runtimeAgents={selectedProject.agents.length}
          onToggleFleet={() => void handleFleetToggle()}
          onRefresh={handleProjectRefresh}
          onShowAgents={() => setActiveTab('Agents')}
          onEditYaml={() => setActiveTab('YAML')}
          onOpenShipwright={() => setActiveTab('Shipwright')}
        />
      )}

      {selectedProject && !embedded && (
        <CoordinationCallouts
          events={coordinationCallouts}
          onOpenChannel={(channelName) => {
            setActiveTab('Channels');
            focusChannel(channelName);
          }}
        />
      )}

      <AnimatePresence mode="wait">
        {!selectedProjectId ? (
          activeTab === 'Agents' ? (
            <motion.div key="agents-all-wrap" className="flex-1 overflow-hidden flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <AgentsPanel
                daemonKey={`${daemonUrl}:all`}
                initialAgentId={selectedAgent}
              />
            </motion.div>
          ) : activeTab === 'Visual' ? (
            <motion.div key="visual-all-wrap" className="flex-1 overflow-hidden flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <VisualTaskPanel
                key={`${daemonUrl}:all:visual`}
                channels={channelTargets}
                project={undefined}
                projectDir={undefined}
                projectRunning={false}
                configuredAgentCount={0}
              />
            </motion.div>
          ) : activeTab === 'Metrics' ? (
            <motion.div key="metrics-all-wrap" className="flex-1 overflow-hidden flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <MetricsPanel key="metrics-all" theme={theme} embedded={embedded} daemonUrl={daemonUrl} />
            </motion.div>
          ) : activeTab === 'Operator' ? (
            <motion.div key="operator-global" className="flex-1 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <ApprovalsPanel />
              {operatorStateHook.state ? (
                <OperatorStatePanel
                  operatorState={operatorStateHook.state}
                  loading={operatorStateHook.loading}
                  error={operatorStateHook.error}
                  lastFetchedAt={operatorStateHook.lastFetchedAt}
                  onRefresh={() => { void operatorStateHook.refresh(); }}
                />
              ) : operatorStateHook.error ? (
                <div className="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
                  <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--pd-accent-surface)', borderColor: 'var(--pd-accent-border)', color: 'var(--pd-accent)' }}>
                    Could not load /operator/state: {operatorStateHook.error}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 opacity-40" style={{ color: 'var(--pd-muted)' }}>
                  Loading operator state…
                </div>
              )}
            </motion.div>
          ) : activeTab === 'Galaxy' ? (
            <motion.div key="galaxy-all-wrap" className="flex-1 overflow-hidden flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <SessionGalaxyPanel key={`${daemonUrl}:all:galaxy`} project={null} theme={theme} />
            </motion.div>
          ) : activeTab === 'TubeBrowser' ? (
            <motion.div key="tubebrowser-all-wrap" className="flex-1 overflow-hidden flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <TubeMessagePanel />
            </motion.div>
          ) : activeTab === 'Dispatch' ? (
            <motion.div key="dispatch-all-wrap" className="flex-1 overflow-hidden flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <DispatchPanel />
            </motion.div>
          ) : activeTab === 'CoastGuard' ? (
            <motion.div key="coastguard-all-wrap" className="flex-1 overflow-hidden flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <CoastGuardPanel />
            </motion.div>
          ) : activeTab === 'Cockpit' ? (
            <motion.div key="cockpit-all-wrap" className="flex-1 overflow-hidden flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <CockpitControlPanel />
            </motion.div>
          ) : (
          <motion.div key="all" className="flex-1 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
            {activeTab === 'Shipwright' ? (
              <ShipwrightPanel
                key="shipwright-all"
                onOpenFlow={() => setActiveTab('Flow')}
                onOpenAgents={() => setActiveTab('Agents')}
                onOpenYaml={() => setActiveTab('YAML')}
              />
            ) : fleet.loading ? (
              <>
                <div className="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
                  <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--pd-warning-surface)', borderColor: 'var(--pd-warning-border)', color: 'var(--pd-warning)' }}>
                    Fleet discovery is still loading. The first-run guide stays available while Port Daddy checks the daemon.
                  </div>
                </div>
                <AllProjectsList
                  projects={projects}
                  selected={selectedProjectId}
                  onSelect={selectProject}
                  onStartProject={(project) => void handleStartProject(project.projectDir)}
                  onSetBudget={(project, usdPerDay) => void handleSetProjectBudget(project.projectDir, usdPerDay).catch(() => undefined)}
                  onOpenYaml={(project) => handleOpenProjectYaml(project.id)}
                  onOpenShipwright={() => setActiveTab('Shipwright')}
                />
              </>
            ) : fleet.error ? (
              <>
                <div className="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
                  <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--pd-accent-surface)', borderColor: 'var(--pd-accent-border)', color: 'var(--pd-accent)' }}>
                    Daemon offline at {formatDaemonLabel(daemonUrl)}: {fleet.error}
                  </div>
                </div>
                <AllProjectsList
                  projects={projects}
                  selected={selectedProjectId}
                  onSelect={selectProject}
                  onStartProject={(project) => void handleStartProject(project.projectDir)}
                  onSetBudget={(project, usdPerDay) => void handleSetProjectBudget(project.projectDir, usdPerDay).catch(() => undefined)}
                  onOpenYaml={(project) => handleOpenProjectYaml(project.id)}
                  onOpenShipwright={() => setActiveTab('Shipwright')}
                />
              </>
            ) : (
              <AllProjectsList
                projects={projects}
                selected={selectedProjectId}
                onSelect={selectProject}
                onStartProject={(project) => void handleStartProject(project.projectDir)}
                onSetBudget={(project, usdPerDay) => void handleSetProjectBudget(project.projectDir, usdPerDay).catch(() => undefined)}
                onOpenYaml={(project) => handleOpenProjectYaml(project.id)}
                onOpenShipwright={() => setActiveTab('Shipwright')}
              />
            )}
          </motion.div>
          )
        ) : (
          <motion.div key={`proj-${selectedProjectId}-${activeTab}`} className="flex-1 overflow-hidden"
            initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <div className="h-full grid" style={{ gridTemplateColumns: showProjectSidebar ? '220px 1fr' : '1fr' }}>
              {showProjectSidebar ? <div>{projectSidebar}</div> : null}
              <div className="overflow-hidden flex flex-col">
                {activeTab === 'Flow' ? (
                  <div className="flex-1 min-h-0 overflow-hidden grid xl:grid-cols-[minmax(430px,0.9fr)_minmax(540px,1.1fr)]">
                    <div className="min-h-0 overflow-hidden flex flex-col" style={{ borderRight: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
                            <Activity size={12} />
                            <span>FLOW MAP</span>
                          </div>
                          <div className="mt-1 text-sm font-semibold truncate" style={{ color: 'var(--pd-text)' }}>
                            Triggers, publishes, and agent relationships
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
                            {channelTargets.length} channels
                          </span>
                          {topology?.valid === false ? (
                            <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' }}>
                              topology warnings
                            </span>
                          ) : (
                            <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' }}>
                              topology clean
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        {fleetConfig ? (
                          <Suspense fallback={<div className="flex items-center justify-center h-full opacity-20" style={{ color: 'var(--pd-text)' }}>Loading graph...</div>}>
                            <FlowGraph
                              config={fleetConfig}
                              topology={topology}
                              theme={theme}
                              selectedAgent={selectedAgent}
                              selectedChannel={selectedChannel}
                              onAgentSelect={focusAgent}
                              onChannelSelect={focusChannel}
                            />
                          </Suspense>
                        ) : (
                          <div className="flex items-center justify-center h-full opacity-20" style={{ color: 'var(--pd-text)' }}>Loading config...</div>
                        )}
                      </div>
                    </div>

                    <div className="min-h-0 overflow-hidden flex flex-col">
                      <OperatorCockpitDeck
                        running={selectedProject?.running ?? false}
                        configuredAgents={fleetConfig?.agents.length ?? 0}
                        runtimeAgents={selectedProject?.agents.length ?? 0}
                        activeRuntimeAgents={selectedProject?.agents.filter((agent) => agent.status !== 'paused').length ?? 0}
                        limits={fleetConfig?.limits}
                        noteCount={flowNoteCount}
                        mutationFileCount={flowMutationFileCount}
                        eventCount={flowEventCount}
                        selectedAgent={selectedAgent}
                        selectedChannel={selectedChannel}
                        coordinationGuard={coordinationGuard}
                        coordinationGuardCheck={coordinationGuardCheck}
                        coordinationGuardBusy={coordinationGuardBusy}
                        coordinationGuardError={coordinationGuardError}
                        onClearFocus={() => {
                          setSelectedAgent(null);
                          setSelectedChannel(null);
                        }}
                        onToggleFleet={() => void handleFleetToggle()}
                        onRefresh={handleProjectRefresh}
                        onShowAgents={() => setActiveTab('Agents')}
                        onEditYaml={() => setActiveTab('YAML')}
                        onOpenShipwright={() => setActiveTab('Shipwright')}
                        onSetBudget={(usdPerDay) => (
                          selectedProject
                            ? handleSetProjectBudget(selectedProject.projectDir, usdPerDay, { showAlert: false })
                            : Promise.resolve()
                        )}
                        onCoordinationGuardAction={(action) => void handleCoordinationGuardAction(action)}
                      />

                      <div className="px-4 pt-2">
                        <CockpitMissionsPanel projectDir={selectedProject?.projectDir} />
                      </div>

                      <div className="flex-1 min-h-0 overflow-hidden grid gap-4 p-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
                        <div className="min-h-0 overflow-y-auto pr-1">
                          {flowBackendRoster.length > 0 ? (
                            <div className="mb-4 rounded-lg border px-3 py-3" style={{ backgroundColor: 'var(--pd-surface-3)', borderColor: 'var(--pd-border)' }}>
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>BACKENDS</div>
                                  <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                                    Launch roster
                                  </div>
                                </div>
                                <div className="flex flex-wrap justify-end gap-1.5">
                                  {flowBackendRoster.map((entry) => (
                                    <span
                                      key={entry.label}
                                      className="rounded-full px-2 py-1 text-[10px] font-semibold"
                                      style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}
                                    >
                                      {entry.count}× {entry.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {fleetConfig && (
                            <motion.div layout className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))' }}>
                              {fleetConfig.agents.map(agent => {
                                const runtime = selectedProject?.agents.find(a => a.agentName === agent.name);
                                const isRelated = selectedAgent === agent.name
                                  || (selectedChannel != null && (agent.trigger === selectedChannel || agent.onSuccess?.includes(selectedChannel) || agent.onFailure?.includes(selectedChannel)));
                                const dimmed = (selectedAgent != null && selectedAgent !== agent.name) || (selectedChannel != null && !isRelated);
                                const signal = agentSignals.get(agent.name) ?? null;
                                return (
                                  <AgentCard
                                    key={agent.name}
                                    agent={agent}
                                    runtimeStatus={runtime?.status}
                                    projectRunning={selectedProject?.running ?? false}
                                    limits={fleetConfig.limits}
                                    highlighted={!!isRelated}
                                    dimmed={dimmed}
                                    latestWork={signal?.summary ?? null}
                                    latestWorkLabel={signal?.label ?? null}
                                    touchedFiles={signal?.files ?? []}
                                    projectDir={selectedProjectId ?? undefined}
                                    onSelect={inspectAgent}
                                    onConfigure={configureAgent}
                                    onRunNow={handleAgentRunNow}
                                    onPauseToggle={handleAgentPauseToggle}
                                  />
                                );
                              })}
                            </motion.div>
                          )}
                        </div>

                        <div className="min-h-0 overflow-hidden">
                          <ActivityRail
                            fleetEvents={filteredFleetEvents}
                            activity={filteredActivity}
                            stories={filteredStories}
                            selectedAgent={selectedAgent}
                            allAgents={fleetConfig?.agents.map((agent) => agent.name) ?? []}
                            projectDir={selectedProjectId ?? undefined}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {activeTab === 'Operator' && (
                      <div className="h-full overflow-y-auto">
                        <ApprovalsPanel />
                        {operatorStateHook.state ? (
                          <OperatorStatePanel
                            operatorState={operatorStateHook.state}
                            loading={operatorStateHook.loading}
                            error={operatorStateHook.error}
                            lastFetchedAt={operatorStateHook.lastFetchedAt}
                            onRefresh={() => { void operatorStateHook.refresh(); }}
                          />
                        ) : operatorStateHook.error ? (
                          <div className="px-6 py-6">
                            <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--pd-accent-surface)', border: '1px solid var(--pd-accent-border)', color: 'var(--pd-accent)' }}>
                              <strong>Could not load /operator/state:</strong> {operatorStateHook.error}
                              <div className="mt-2 text-[12px]" style={{ color: 'var(--pd-muted)' }}>
                                Confirm the daemon is running and the route is available on this version.
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full opacity-40" style={{ color: 'var(--pd-muted)' }}>
                            Loading operator state…
                          </div>
                        )}
                      </div>
                    )}
                    {activeTab === 'Activity' && (
                      <ActivityPanel
                        fleetEvents={filteredFleetEvents}
                        activity={filteredActivity}
                        stories={filteredStories}
                        selectedAgent={selectedAgent}
                        allAgents={fleetConfig?.agents.map((agent) => agent.name) ?? []}
                        agentSignals={agentActivitySignals}
                        projectDir={selectedProjectId ?? undefined}
                        onSelectAgent={focusAgent}
                      />
                    )}
                    {activeTab === 'Agents' && (
                      <AgentsPanel
                        daemonKey={`${daemonUrl}:${selectedProjectId ?? 'all'}`}
                        initialAgentId={selectedAgent}
                        projectName={selectedProjectName ?? undefined}
                        projectDir={selectedProjectId ?? undefined}
                        fleetConfig={fleetConfig}
                        resolvedChannels={Object.fromEntries(channelTargets.map((target) => [target.logical, target.physical]))}
                        runtimeAgents={selectedProject?.agents}
                        onFocusFleetAgent={(name) => {
                          setActiveTab('Flow');
                          focusAgent(name);
                        }}
                        onRunFleetAgent={(name) => handleAgentRunNow(name)}
                        onPauseFleetAgent={(name, paused) => handleAgentPauseToggle(name, paused)}
                      />
                    )}
                    {activeTab === 'Visual' && (
                      <VisualTaskPanel
                        key={`${daemonUrl}:${selectedProjectId ?? 'all'}:visual`}
                        channels={channelTargets}
                        project={selectedProjectName ?? undefined}
                        projectDir={selectedProjectId ?? undefined}
                        projectRunning={selectedProject?.running ?? false}
                        configuredAgentCount={fleetConfig?.agents.length ?? 0}
                      />
                    )}
                    {activeTab === 'Roadmap' && (
                      <RoadmapPanel
                        projectDir={selectedProjectId ?? undefined}
                        projectName={selectedProjectName ?? undefined}
                      />
                    )}
                    {activeTab === 'Resources' && (
                      <ResourceGovernancePanel
                        projectDir={selectedProjectId ?? undefined}
                        limits={fleetConfig?.limits}
                        onOpenYaml={() => setActiveTab('YAML')}
                        onRuntimeChanged={() => {
                          fleet.refresh();
                          if (selectedProjectId) fleet.loadConfig(selectedProjectId);
                        }}
                      />
                    )}
                    {activeTab === 'Channels' && (
                      <ChannelLog
                        events={channelLogEvents}
                        selectedAgent={selectedAgent}
                        selectedChannel={selectedChannel}
                        projectDir={selectedProjectId ?? undefined}
                        onChannelClick={(channelName) => focusChannel(selectedChannel === channelName ? null : channelName)}
                        layout="page"
                      />
                    )}
                    {activeTab === 'Tube' && (
                      <TubeConsolePanel
                        channels={channelTargets}
                        selectedChannel={selectedChannel}
                        projectDir={selectedProjectId ?? undefined}
                        onChannelFocus={(channelName) => focusChannel(channelName)}
                      />
                    )}
                    {activeTab === 'Events' && (
                      <EventsRegistryPanel
                        channels={channelTargets}
                        fleetConfig={fleetConfig}
                        projectDir={selectedProjectId ?? undefined}
                        projectName={selectedProjectName ?? undefined}
                        onOpenTube={(channelName) => {
                          focusChannel(channelName);
                          setActiveTab('Tube');
                        }}
                      />
                    )}
                    {activeTab === 'Inbox' && (
                      <DMPanel
                        key={`${daemonUrl}:${selectedProjectId ?? 'all'}:inbox`}
                        channels={channelTargets}
                        project={selectedProjectName ?? undefined}
                        projectDir={selectedProjectId ?? undefined}
                        projectRunning={selectedProject?.running ?? false}
                        configuredAgentCount={fleetConfig?.agents.length ?? 0}
                        layout="full"
                      />
                    )}
                    {activeTab === 'Sorties' && (
                      <SortiePanel key={`${daemonUrl}:${selectedProjectId ?? 'all'}`} project={selectedProjectName ?? undefined} />
                    )}
                    {activeTab === 'Memory' && (
                      <MemoryPanel
                        projectDir={selectedProjectId ?? undefined}
                        projectName={selectedProjectName ?? undefined}
                        harbor={fleetConfig?.harbor}
                      />
                    )}
                    {activeTab === 'Metrics' && (
                      <MetricsPanel theme={theme} embedded={embedded} daemonUrl={daemonUrl} />
                    )}
                    {activeTab === 'Galaxy' && (
                      <SessionGalaxyPanel
                        key={`${daemonUrl}:${selectedProjectId}:galaxy`}
                        project={selectedProjectName ?? null}
                        theme={theme}
                      />
                    )}
                    {activeTab === 'TubeBrowser' && (
                      <TubeMessagePanel />
                    )}
                    {activeTab === 'Dispatch' && (
                      <DispatchPanel />
                    )}
                    {activeTab === 'CoastGuard' && (
                      <CoastGuardPanel />
                    )}
                    {activeTab === 'Cockpit' && (
                      <CockpitControlPanel projectDir={selectedProjectId ?? undefined} />
                    )}
                    {activeTab === 'Shipwright' && (
                      <ShipwrightPanel
                        key={selectedProjectId ?? 'shipwright-all'}
                        projectDir={selectedProjectId ?? undefined}
                        projectName={selectedProjectName ?? undefined}
                        onOpenFlow={() => setActiveTab('Flow')}
                        onOpenAgents={() => setActiveTab('Agents')}
                        onOpenYaml={() => setActiveTab('YAML')}
                      />
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
