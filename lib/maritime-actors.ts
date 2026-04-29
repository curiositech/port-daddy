export type MaritimeActorId =
  | 'navigator'
  | 'coxswain'
  | 'signalman'
  | 'harbormaster'
  | 'sounder'
  | 'lookout'
  | 'breaker'
  | 'caulker'
  | 'quartermaster';

export type MaritimeActorBodyState = 'attached' | 'detached' | 'stale' | 'dead';

export interface MaritimeActorDefinition {
  id: MaritimeActorId;
  name: string;
  identity: string;
  mission: string;
  responsibilities: string[];
  eventSources: string[];
  outputs: string[];
  compatibility: {
    fleetAgent?: string;
    legacyNames?: string[];
  };
}

export interface MaritimeActorProjection extends MaritimeActorDefinition {
  body: {
    state: MaritimeActorBodyState;
    liveAgentId: string | null;
    liveness: 'alive' | 'stale' | 'dead' | null;
    lastHeartbeat: number | null;
  };
  fleet: {
    configured: boolean;
    project: string | null;
    projectDir: string | null;
    agent: string | null;
    status: string | null;
    running: boolean | null;
    paused: boolean | null;
  };
}

interface AgentLike {
  id?: string;
  identity?: string | null;
  name?: string | null;
  isActive?: boolean;
  lastHeartbeat?: number;
  healthAssessment?: {
    liveness?: 'alive' | 'stale' | 'dead';
  } | null;
}

interface FleetAgentLike {
  name?: string;
  status?: string;
  running?: boolean;
  paused?: boolean;
}

interface FleetLike {
  project?: string;
  projectDir?: string;
  agents?: FleetAgentLike[];
}

export interface MaritimeActorProjectionDeps {
  agents?: {
    list(options?: Record<string, unknown>): { agents?: AgentLike[] } | AgentLike[];
  };
  fleetDaemon?: {
    getStatus(): { fleets?: FleetLike[] };
  };
}

export const MARITIME_ACTORS: MaritimeActorDefinition[] = [
  {
    id: 'navigator',
    name: 'Navigator',
    identity: 'port-daddy:actor:navigator',
    mission: 'Maintain the roadmap and recovery map across plans, work slices, evidence, and future dependencies.',
    responsibilities: ['roadmap-state', 'work-slice-state', 'document-authority', 'future-dependencies'],
    eventSources: ['git:committed', 'session.*', 'file.claim', 'evidence:*', 'promotion.*'],
    outputs: ['roadmap:item', 'work:slice', 'doc:authority', 'depends_on', 'supersedes'],
    compatibility: {
      fleetAgent: 'cartographer',
      legacyNames: ['cartographer', 'port-daddy:cartographer'],
    },
  },
  {
    id: 'coxswain',
    name: 'Coxswain',
    identity: 'port-daddy:actor:coxswain',
    mission: 'Arbitrate claims, locks, stale work, and overlapping ownership before they block useful work.',
    responsibilities: ['claims', 'locks', 'stale-work', 'ownership-conflicts'],
    eventSources: ['file.claim', 'file.release', 'lock.acquire', 'lock.release', 'session.end'],
    outputs: ['blocker', 'claim:stale', 'claim:conflict', 'work:unblocked'],
    compatibility: {
      legacyNames: ['claim-arbiter'],
    },
  },
  {
    id: 'signalman',
    name: 'Signalman',
    identity: 'port-daddy:actor:signalman',
    mission: 'Record validation, test, build, and typecheck evidence as structured project truth.',
    responsibilities: ['test-evidence', 'build-evidence', 'typecheck-evidence', 'validation-history'],
    eventSources: ['test.completed', 'build.completed', 'typecheck.completed', 'ci.*'],
    outputs: ['evidence:test', 'evidence:build', 'evidence:typecheck'],
    compatibility: {
      legacyNames: ['validation-scribe'],
    },
  },
  {
    id: 'harbormaster',
    name: 'Harbormaster',
    identity: 'port-daddy:actor:harbormaster',
    mission: 'Gate promotion and release readiness with exact blockers, owners, and evidence.',
    responsibilities: ['promotion-readiness', 'release-blockers', 'daemon-freshness', 'stable-checkout'],
    eventSources: ['promotion.attempted', 'promotion.blocked', 'promotion.completed', 'git:committed'],
    outputs: ['promotion:ready', 'promotion:blocked', 'blocker'],
    compatibility: {
      legacyNames: ['promotion-harbormaster'],
    },
  },
  {
    id: 'sounder',
    name: 'Sounder',
    identity: 'port-daddy:actor:sounder',
    mission: 'Curate semantic graph depth, terminology, synonymy, and review-boundary decisions.',
    responsibilities: ['semantic-graph', 'synonymy', 'alias-review', 'concept-boundaries'],
    eventSources: ['semantic:alias', 'semantic:resolution', 'memory:episode', 'graph_edges.*'],
    outputs: ['semantic:resolution', 'semantic:review', 'graph:edge'],
    compatibility: {
      legacyNames: ['semantic-graph-curator'],
    },
  },
  {
    id: 'lookout',
    name: 'Lookout',
    identity: 'port-daddy:actor:lookout',
    mission: 'Detect drift across docs, skills, APIs, website surfaces, and actual runtime behavior.',
    responsibilities: ['docs-drift', 'skill-drift', 'api-drift', 'website-drift'],
    eventSources: ['git:committed', 'route.changed', 'manifest.changed', 'skill.changed'],
    outputs: ['doc:stale', 'release-surface:drift', 'blocker'],
    compatibility: {
      fleetAgent: 'documentarian',
      legacyNames: ['docs-skill-drift-watcher'],
    },
  },
  {
    id: 'breaker',
    name: 'Breaker',
    identity: 'port-daddy:actor:breaker',
    mission: 'Watch failure propagation, cascading faults, and circuit-breaker state.',
    responsibilities: ['failure-propagation', 'circuit-breakers', 'incident-causality', 'risk-signals'],
    eventSources: ['agent_failed', 'test.failed', 'daemon.error', 'spawn.failed', 'tunnel.failed'],
    outputs: ['failure:chain', 'circuit:open', 'risk:escalated'],
    compatibility: {
      legacyNames: ['failure-propagation-watcher'],
    },
  },
  {
    id: 'caulker',
    name: 'Caulker',
    identity: 'port-daddy:actor:caulker',
    mission: 'Close robustness leaks, teardown debt, flaky cleanup paths, and durability gaps.',
    responsibilities: ['robustness-repair', 'teardown-debt', 'leak-closure', 'cleanup-correctness'],
    eventSources: ['test.open_handles', 'cleanup.failed', 'resource.leak', 'failure:chain'],
    outputs: ['repair:item', 'debt:closed', 'regression:test'],
    compatibility: {
      legacyNames: ['robustness-repair'],
    },
  },
  {
    id: 'quartermaster',
    name: 'Quartermaster',
    identity: 'port-daddy:actor:quartermaster',
    mission: 'Govern cost, budgets, backends, quotas, and scarce runtime resources.',
    responsibilities: ['cost-governance', 'budget-gates', 'backend-policy', 'resource-quotas'],
    eventSources: ['spawn.requested', 'spawn.completed', 'cost.recorded', 'budget.threshold'],
    outputs: ['budget:blocked', 'cost:recorded', 'resource:quota'],
    compatibility: {
      legacyNames: ['cost-governor'],
    },
  },
];

export function getMaritimeActor(idOrName: string): MaritimeActorDefinition | null {
  const normalized = idOrName.trim().toLowerCase();
  if (!normalized) return null;
  return MARITIME_ACTORS.find((actor) => (
    actor.id === normalized ||
    actor.name.toLowerCase() === normalized ||
    actor.identity === idOrName ||
    actor.compatibility.legacyNames?.some((name) => name.toLowerCase() === normalized)
  )) ?? null;
}

function listAgents(deps?: MaritimeActorProjectionDeps): AgentLike[] {
  try {
    const result = deps?.agents?.list({ activeOnly: false });
    if (Array.isArray(result)) return result;
    return result?.agents ?? [];
  } catch {
    return [];
  }
}

function listFleets(deps?: MaritimeActorProjectionDeps): FleetLike[] {
  try {
    return deps?.fleetDaemon?.getStatus()?.fleets ?? [];
  } catch {
    return [];
  }
}

function matchesActorBody(actor: MaritimeActorDefinition, agent: AgentLike): boolean {
  const identityMatches = agent.identity === actor.identity;
  const legacyMatches = actor.compatibility.legacyNames?.some((legacy) => (
    agent.identity === legacy ||
    agent.name?.toLowerCase() === legacy.toLowerCase() ||
    agent.id?.toLowerCase() === legacy.toLowerCase()
  )) ?? false;
  const fleetMatches = actor.compatibility.fleetAgent
    ? agent.identity?.endsWith(`:fleet:${actor.compatibility.fleetAgent}`) ||
      agent.id?.toLowerCase().includes(actor.compatibility.fleetAgent)
    : false;
  return Boolean(identityMatches || legacyMatches || fleetMatches);
}

function projectBody(actor: MaritimeActorDefinition, agents: AgentLike[]): MaritimeActorProjection['body'] {
  const candidate = agents.find((agent) => matchesActorBody(actor, agent));
  if (!candidate) {
    return {
      state: 'detached',
      liveAgentId: null,
      liveness: null,
      lastHeartbeat: null,
    };
  }

  const liveness = candidate.healthAssessment?.liveness ?? (candidate.isActive ? 'alive' : 'stale');
  const state: MaritimeActorBodyState = liveness === 'alive' ? 'attached' : liveness;
  return {
    state,
    liveAgentId: candidate.id ?? null,
    liveness,
    lastHeartbeat: candidate.lastHeartbeat ?? null,
  };
}

function projectFleet(actor: MaritimeActorDefinition, fleets: FleetLike[]): MaritimeActorProjection['fleet'] {
  if (!actor.compatibility.fleetAgent) {
    return {
      configured: false,
      project: null,
      projectDir: null,
      agent: null,
      status: null,
      running: null,
      paused: null,
    };
  }

  for (const fleet of fleets) {
    const agent = fleet.agents?.find((entry) => entry.name === actor.compatibility.fleetAgent);
    if (!agent) continue;
    return {
      configured: true,
      project: fleet.project ?? null,
      projectDir: fleet.projectDir ?? null,
      agent: agent.name ?? actor.compatibility.fleetAgent,
      status: agent.status ?? null,
      running: agent.running ?? null,
      paused: agent.paused ?? null,
    };
  }

  return {
    configured: false,
    project: null,
    projectDir: null,
    agent: actor.compatibility.fleetAgent,
    status: null,
    running: null,
    paused: null,
  };
}

export function projectMaritimeActor(
  actor: MaritimeActorDefinition,
  deps?: MaritimeActorProjectionDeps,
): MaritimeActorProjection {
  const agents = listAgents(deps);
  const fleets = listFleets(deps);
  return {
    ...actor,
    body: projectBody(actor, agents),
    fleet: projectFleet(actor, fleets),
  };
}

export function listMaritimeActors(deps?: MaritimeActorProjectionDeps): MaritimeActorProjection[] {
  const agents = listAgents(deps);
  const fleets = listFleets(deps);
  return MARITIME_ACTORS.map((actor) => ({
    ...actor,
    body: projectBody(actor, agents),
    fleet: projectFleet(actor, fleets),
  }));
}
