import type { SquidConformance, SquidConformanceLevel } from './squid/conformance.js';
import { unprotectedSquidConformance } from './squid/conformance.js';

export interface ActiveAgentRosterAgent {
  id: string;
  name?: string | null;
  type?: string | null;
  identity?: string | null;
  identityProject?: string | null;
  identityStack?: string | null;
  identityContext?: string | null;
  purpose?: string | null;
  status?: string | null;
  lastHeartbeat?: number | null;
  metadata?: Record<string, unknown> | null;
  worktreeId?: string | null;
  healthAssessment?: {
    liveness?: 'alive' | 'stale' | 'dead' | string;
    graceRemaining?: number;
  } | null;
}

export interface ActiveAgentRosterSession {
  id: string;
  purpose?: string | null;
  status?: string | null;
  phase?: string | null;
  agentId?: string | null;
  worktreeId?: string | null;
  identityProject?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  metadata?: Record<string, unknown> | null;
  notes?: Array<Record<string, unknown>>;
}

export interface ActiveAgentRosterClaim {
  filePath?: string | null;
  sessionId?: string | null;
  purpose?: string | null;
  agentId?: string | null;
  phase?: string | null;
  claimedAt?: number | null;
  startLine?: number | null;
  endLine?: number | null;
  symbol?: string | null;
  symbolPath?: string | null;
}

export interface ActiveAgentRosterInput {
  agents?: ActiveAgentRosterAgent[];
  sessions?: ActiveAgentRosterSession[];
  claims?: ActiveAgentRosterClaim[];
  now?: number;
  project?: string | null;
  squidForWorktree?: (worktreeRoot: string | null) => SquidConformance;
}

export interface ActiveAgentHarness {
  id: string;
  label: string;
  backend: string | null;
  model: string | null;
  confidence: 'explicit' | 'inferred';
}

export interface ActiveAgentWorktree {
  id: string | null;
  root: string | null;
  branch: string | null;
  name: string | null;
  isMain: boolean | null;
}

export interface ActiveAgentRosterItem {
  id: string;
  label: string;
  purpose: string | null;
  identity: string | null;
  project: string | null;
  status: string | null;
  liveness: string;
  lastHeartbeat: number | null;
  harness: ActiveAgentHarness;
  squid: SquidConformance;
  worktree: ActiveAgentWorktree;
  activeSession: ActiveAgentRosterSession | null;
  sessions: ActiveAgentRosterSession[];
  touchedFiles: ActiveAgentRosterClaim[];
  control: {
    steeringChannel: string;
    streamUrl: string;
    interruptUrl: string;
    takeoverUrl: string | null;
    controlCenterUrl: string;
  };
}

export interface ActiveAgentRoster {
  success: true;
  generatedAt: number;
  project: string | null;
  count: number;
  squidSummary: Record<SquidConformanceLevel, number>;
  agents: ActiveAgentRosterItem[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringFrom(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function boolFrom(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function worktreeFrom(agent: ActiveAgentRosterAgent, sessions: ActiveAgentRosterSession[]): ActiveAgentWorktree {
  const agentMeta = asRecord(agent.metadata);
  const metaWorktree = asRecord(agentMeta?.worktree);
  const sessionMeta = asRecord(sessions[0]?.metadata);
  const sessionWorktree = asRecord(sessionMeta?.worktree);

  return {
    id: stringFrom(agent.worktreeId, sessions[0]?.worktreeId, metaWorktree?.id, sessionWorktree?.id),
    root: stringFrom(metaWorktree?.root, sessionWorktree?.root, agentMeta?.worktree),
    branch: stringFrom(metaWorktree?.branch, sessionWorktree?.branch),
    name: stringFrom(metaWorktree?.name, sessionWorktree?.name),
    isMain: boolFrom(metaWorktree?.isMain) ?? boolFrom(sessionWorktree?.isMain),
  };
}

function inferHarness(agent: ActiveAgentRosterAgent): ActiveAgentHarness {
  const metadata = asRecord(agent.metadata);
  const explicitHarness = stringFrom(metadata?.harness, metadata?.runtimeHarness, metadata?.surface);
  const explicitBackend = stringFrom(metadata?.backend, metadata?.llmBackend, metadata?.latestBackend, metadata?.provider);
  const explicitModel = stringFrom(metadata?.model, metadata?.modelId, metadata?.latestModel);
  const haystack = [
    explicitHarness,
    explicitBackend,
    explicitModel,
    agent.type,
    agent.name,
    agent.id,
    agent.identity,
    agent.purpose,
  ].filter(Boolean).join(' ').toLowerCase();

  let id = 'local-cli';
  let label = 'Local CLI agent';
  let backend: string | null = explicitBackend;

  if (haystack.includes('cloudflare') || haystack.includes('workers ai')) {
    id = 'cloudflare-ai';
    label = 'Cloudflare AI fleet agent';
    backend = backend ?? 'cloudflare';
  } else if (haystack.includes('ollama') || haystack.includes('olamma')) {
    id = 'ollama';
    label = 'Claude Code with Ollama backend';
    backend = backend ?? 'ollama';
  } else if (haystack.includes('codex')) {
    id = 'claude-code-codex';
    label = 'Claude Code with Codex backend';
    backend = backend ?? 'codex';
  } else if (haystack.includes('claude') && haystack.includes('hook')) {
    id = 'claude-code-hooks';
    label = 'Claude Code with hooks';
    backend = backend ?? 'claude-cli';
  } else if (haystack.includes('claude-cli') || haystack.includes('claude code')) {
    id = 'claude-code';
    label = 'Claude Code harness';
    backend = backend ?? 'claude-cli';
  }

  if (explicitHarness) {
    label = explicitHarness;
  }

  return {
    id,
    label,
    backend,
    model: explicitModel,
    confidence: explicitHarness || explicitBackend ? 'explicit' : 'inferred',
  };
}

function latestFirst<T extends { updatedAt?: number | null; createdAt?: number | null }>(values: T[]): T[] {
  return [...values].sort((left, right) => {
    const l = left.updatedAt ?? left.createdAt ?? 0;
    const r = right.updatedAt ?? right.createdAt ?? 0;
    return r - l;
  });
}

function itemLabel(agent: ActiveAgentRosterAgent): string {
  return stringFrom(agent.name, agent.identityContext, agent.identity, agent.id) ?? agent.id;
}

export function buildActiveAgentRoster(input: ActiveAgentRosterInput): ActiveAgentRoster {
  const now = input.now ?? Date.now();
  const sessions = input.sessions ?? [];
  const claims = input.claims ?? [];
  const agents = input.agents ?? [];
  const project = input.project ?? null;

  const sessionsByAgent = new Map<string, ActiveAgentRosterSession[]>();
  for (const session of sessions) {
    if (!session.agentId) continue;
    const list = sessionsByAgent.get(session.agentId) ?? [];
    list.push(session);
    sessionsByAgent.set(session.agentId, list);
  }

  const claimsByAgent = new Map<string, ActiveAgentRosterClaim[]>();
  const claimsBySession = new Map<string, ActiveAgentRosterClaim[]>();
  for (const claim of claims) {
    if (claim.agentId) {
      const list = claimsByAgent.get(claim.agentId) ?? [];
      list.push(claim);
      claimsByAgent.set(claim.agentId, list);
    }
    if (claim.sessionId) {
      const list = claimsBySession.get(claim.sessionId) ?? [];
      list.push(claim);
      claimsBySession.set(claim.sessionId, list);
    }
  }

  const byId = new Map<string, ActiveAgentRosterAgent>();
  for (const agent of agents) {
    if (agent.id) byId.set(agent.id, agent);
  }
  for (const session of sessions) {
    if (!session.agentId || byId.has(session.agentId)) continue;
    byId.set(session.agentId, {
      id: session.agentId,
      type: 'session',
      identityProject: session.identityProject ?? null,
      purpose: session.purpose ?? null,
      worktreeId: session.worktreeId ?? null,
      metadata: session.metadata ?? null,
      status: session.status ?? null,
      lastHeartbeat: null,
      healthAssessment: { liveness: session.status === 'active' ? 'alive' : 'stale' },
    });
  }

  const roster = [...byId.values()]
    .filter((agent) => !project || agent.identityProject === project || (agent.identity ?? '').startsWith(`${project}:`))
    .map((agent): ActiveAgentRosterItem => {
      const agentSessions = latestFirst(sessionsByAgent.get(agent.id) ?? []);
      const activeSession = agentSessions.find((session) => session.status === 'active') ?? agentSessions[0] ?? null;
      const sessionClaims = agentSessions.flatMap((session) => claimsBySession.get(session.id) ?? []);
      const agentClaims = claimsByAgent.get(agent.id) ?? [];
      const touchedFiles = [...agentClaims, ...sessionClaims]
        .filter((claim, index, all) => {
          const key = `${claim.filePath ?? ''}:${claim.sessionId ?? ''}:${claim.symbolPath ?? ''}:${claim.startLine ?? ''}`;
          return all.findIndex((candidate) => `${candidate.filePath ?? ''}:${candidate.sessionId ?? ''}:${candidate.symbolPath ?? ''}:${candidate.startLine ?? ''}` === key) === index;
        })
        .sort((left, right) => (right.claimedAt ?? 0) - (left.claimedAt ?? 0));
      const computedIdentity = [agent.identityProject, agent.identityStack, agent.identityContext].filter(Boolean).join(':') || null;
      const identity = agent.identity ?? computedIdentity;

      const worktree = worktreeFrom(agent, agentSessions);
      const squid = input.squidForWorktree
        ? input.squidForWorktree(worktree.root)
        : unprotectedSquidConformance(worktree.root
          ? 'Squid conformance was not inspected for this worktree.'
          : 'Agent has no local worktree root.');

      return {
        id: agent.id,
        label: itemLabel(agent),
        purpose: agent.purpose ?? activeSession?.purpose ?? null,
        identity,
        project: agent.identityProject ?? activeSession?.identityProject ?? null,
        status: agent.status ?? activeSession?.status ?? null,
        liveness: agent.healthAssessment?.liveness ?? (activeSession?.status === 'active' ? 'alive' : 'unknown'),
        lastHeartbeat: agent.lastHeartbeat ?? null,
        harness: inferHarness(agent),
        squid,
        worktree,
        activeSession,
        sessions: agentSessions,
        touchedFiles,
        control: {
          steeringChannel: `agent:${agent.id}`,
          streamUrl: `/agents/${encodeURIComponent(agent.id)}/stream`,
          interruptUrl: `/agents/${encodeURIComponent(agent.id)}/interrupt`,
          takeoverUrl: activeSession ? `/sessions/${encodeURIComponent(activeSession.id)}/takeover` : null,
          controlCenterUrl: `/fleet-ui/?surface=agents&agent=${encodeURIComponent(agent.id)}`,
        },
      };
    })
    .filter((item) => item.liveness === 'alive' || item.activeSession?.status === 'active')
    .sort((left, right) => (right.lastHeartbeat ?? right.activeSession?.updatedAt ?? 0) - (left.lastHeartbeat ?? left.activeSession?.updatedAt ?? 0));

  const squidSummary: Record<SquidConformanceLevel, number> = {
    LIVE: 0,
    READY: 0,
    PARTIAL: 0,
    UNPROTECTED: 0,
  };
  for (const agent of roster) squidSummary[agent.squid.level] += 1;

  return {
    success: true,
    generatedAt: now,
    project,
    count: roster.length,
    squidSummary,
    agents: roster,
  };
}
