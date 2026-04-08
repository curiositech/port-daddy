// ─── Types mirroring fleet-engine.ts ──────────────────────────────────────────

export interface FleetLimits {
  maxConcurrentSpawns?: number;
  maxSpawnsPerHour?: number;
  budgetUsdPerDay?: number;
}

export interface FleetAgent {
  name: string;
  schedule?: string;
  trigger?: string;
  backend: string;
  model?: string;
  prompt: string;
  worktree?: boolean;
  singleton?: boolean;
  respawn?: boolean;
  maxRespawns?: number;
  onSuccess?: string;
  onFailure?: string;
  identity?: string;
  timeout?: number;
  allowedTools?: string;
}

export interface FleetWatcher {
  name: string;
  trigger: string;
  exec: string;
  condition?: string;
  confirm?: boolean;
}

export interface FleetConfig {
  name: string;
  harbor?: string;
  limits?: FleetLimits;
  agents: FleetAgent[];
  watchers: FleetWatcher[];
  channels: Record<string, { description: string; consumers?: string[] }>;
}

export interface TopologyValidation {
  valid: boolean;
  cycles: string[][];
  warnings: string[];
}

export interface FleetEvent {
  type: 'agent_started' | 'agent_completed' | 'agent_failed' | 'agent_paused' | 'agent_resumed' | 'watcher_started' | 'watcher_triggered' | 'fleet_started' | 'fleet_stopped';
  agent?: string;
  identity?: string;
  project?: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface ActivityEntry {
  id: number;
  timestamp: number;
  type: string;
  agentId: string | null;
  targetId: string | null;
  details: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ChannelMessage {
  id: number;
  channel: string;
  physicalChannel?: string;
  payload: unknown;
  sender: string | null;
  createdAt: number;
}

export interface ResolvedChannelTarget {
  logical: string;
  physical: string;
}

export interface StoryNote {
  id: number;
  sessionId: string;
  content: string;
  type: string;
  createdAt: number;
  sessionPurpose?: string;
  agentId?: string | null;
  identityProject?: string | null;
}

export interface FleetProjectStatus {
  project: string;
  projectDir: string;
  running: boolean;
  agents: Array<{ name: string; status: string; type: string; running: boolean; paused: boolean; uptime: number }>;
  watchers: number;
  channels: number;
  startedAt: number;
}

export interface FleetDaemonStatus {
  running: boolean;
  startedAt: number | null;
  fleets: FleetProjectStatus[];
  totalAgents: number;
  totalWatchers: number;
}

export interface BackendInfo {
  id: string;
  name: string;
  models: string[];
  modelTiers?: Partial<Record<'low' | 'mid' | 'high', string>>;
  supported?: boolean;
  readinessStatus?: 'ready' | 'needs_setup' | 'manual_check' | 'unknown';
  readinessSummary?: string;
  readinessNextStep?: string;
}

export interface SpawnedAgent {
  agentId: string;
  backend: string;
  model: string;
  identity?: string | null;
  purpose?: string | null;
  startedAt: number;
  completedAt?: number | null;
  pid?: number;
  status: string;
  output?: string | null;
  error?: string | null;
}

export interface SpawnPreflight {
  launchReady: boolean;
  blockedReasons: string[];
  warnings: string[];
  attempts: Array<{
    attempt: number;
    backend: string | null;
    model: string | null;
    modelTier: string | null;
    readinessStatus: 'ready' | 'needs_setup' | 'manual_check' | 'unknown';
    readinessSummary: string;
    readinessNextStep?: string;
  }>;
  projectName: string | null;
  budget: {
    project: string;
    budgetUsdPerDay: number;
    spentUsd: number;
    remainingUsd: number;
    percentUsed: number;
    overBudget: boolean;
  } | null;
  localExecutionLikely: boolean;
  localExecutionNote?: string;
}

// ─── Agent color palette ──────────────────────────────────────────────────────

export const AGENT_COLORS: Record<string, string> = {
  gardener:      '#4CAF50',
  qa:            '#2196F3',
  'test-hunter': '#FF9800',
  documentarian: '#00BCD4',
  simplifier:    '#9C27B0',
  cartographer:  '#FF5722',
  spark:         '#FFC107',
  spider:        '#E91E63',
};

export function agentColor(name: string): string {
  return AGENT_COLORS[name] ?? '#D4C5A9';
}
