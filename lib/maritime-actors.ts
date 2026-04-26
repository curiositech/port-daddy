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

export type MaritimeActorLeaseState = 'attached' | 'recoverable' | 'detached' | 'dormant';

export interface MaritimeActorDefinition {
  id: MaritimeActorId;
  label: string;
  title: string;
  mission: string;
  owns: string[];
  aliases: string[];
  compatibilityFleetAgent: string | null;
  mailbox: string;
}

export interface ActorAgentSignal {
  id: string;
  identity: string | null;
  purpose: string | null;
  lastHeartbeat: number | null;
  liveness: string | null;
}

export interface ActorSessionSignal {
  id: string;
  status: string | null;
  purpose: string | null;
  agentId: string | null;
  updatedAt: number | null;
}

export interface ActorSalvageSignal {
  id: string;
  status: string | null;
  purpose: string | null;
  sessionId: string | null;
  updatedAt: number | null;
}

export interface ActorMailboxStats {
  total: number;
  unread: number;
  max: number | null;
}

export interface MaritimeActorRecord extends MaritimeActorDefinition {
  address: string;
  inboxTarget: string;
  mailboxStats: ActorMailboxStats | null;
  leaseState: MaritimeActorLeaseState;
  liveBodies: ActorAgentSignal[];
  recentSessions: ActorSessionSignal[];
  salvage: ActorSalvageSignal[];
  lastActivityAt: number | null;
  evidence: string[];
}

export interface MaritimeActorsProjectionInput {
  agents?: unknown[];
  sessions?: unknown[];
  salvage?: unknown[];
}

export const MARITIME_ACTORS: readonly MaritimeActorDefinition[] = [
  {
    id: 'navigator',
    label: 'Navigator',
    title: 'Roadmap and recovery-map actor',
    mission: 'Maintains roadmap state, recovery ledgers, work-slice evidence, supersession edges, and cartographer projections.',
    owns: ['roadmap', 'recovery-ledger', 'work-slices', 'cartographer-status'],
    aliases: ['cartographer', 'roadmap', 'mapmaker'],
    compatibilityFleetAgent: 'cartographer',
    mailbox: 'actor:navigator',
  },
  {
    id: 'coxswain',
    label: 'Coxswain',
    title: 'Claims, locks, and stale-asset coordination actor',
    mission: 'Coordinates file/symbol claims, lock ownership, stale assets, mutation evidence, and reclaim affordances.',
    owns: ['claims', 'locks', 'stale-assets', 'symbol-coordination'],
    aliases: ['claims', 'locks', 'coordination'],
    compatibilityFleetAgent: null,
    mailbox: 'actor:coxswain',
  },
  {
    id: 'signalman',
    label: 'Signalman',
    title: 'Validation and evidence actor',
    mission: 'Tracks test runs, validation evidence, signal quality, teardown warnings, and promotion proof.',
    owns: ['tests', 'validation', 'evidence', 'signals'],
    aliases: ['qa', 'validation', 'evidence'],
    compatibilityFleetAgent: 'qa',
    mailbox: 'actor:signalman',
  },
  {
    id: 'harbormaster',
    label: 'Harbormaster',
    title: 'Promotion, daemon freshness, and runtime-truth actor',
    mission: 'Owns promotion readiness, daemon freshness, stable checkout cleanliness, launchd truth, and runtime provenance.',
    owns: ['promotion', 'daemon-freshness', 'stable-checkout', 'runtime-truth'],
    aliases: ['promotion', 'release', 'daemon'],
    compatibilityFleetAgent: null,
    mailbox: 'actor:harbormaster',
  },
  {
    id: 'sounder',
    label: 'Sounder',
    title: 'Tuple, graph, memory, and semantic-depth actor',
    mission: 'Maintains tuple-first coordination, graph edges, episodic memory, semantic term joins, and synonym review queues.',
    owns: ['tuples', 'graph', 'memory', 'semantic-collapse'],
    aliases: ['graph', 'memory', 'semantic', 'synonymy'],
    compatibilityFleetAgent: null,
    mailbox: 'actor:sounder',
  },
  {
    id: 'lookout',
    label: 'Lookout',
    title: 'Docs, API, skill, and product-truth actor',
    mission: 'Watches route, manifest, OpenAPI, CLI, MCP, website, and skill drift before product truth splits.',
    owns: ['docs', 'openapi', 'skills', 'manifest', 'website-truth'],
    aliases: ['documentarian', 'docs', 'drift'],
    compatibilityFleetAgent: 'documentarian',
    mailbox: 'actor:lookout',
  },
  {
    id: 'breaker',
    label: 'Breaker',
    title: 'Failure propagation and circuit-breaker actor',
    mission: 'Models cascading failure, retry storms, circuit states, failure-propagation maps, and forensic windows.',
    owns: ['failure-propagation', 'circuit-breakers', 'retry-storms', 'forensics'],
    aliases: ['resilience', 'circuit-breaker', 'failure'],
    compatibilityFleetAgent: null,
    mailbox: 'actor:breaker',
  },
  {
    id: 'caulker',
    label: 'Caulker',
    title: 'Robustness repair and leak-sealing actor',
    mission: 'Repairs robustness leaks: teardown debt, orphan cleanup, timeout hygiene, IPC leaks, and brittle fallbacks.',
    owns: ['robustness', 'teardown', 'timeouts', 'cleanup'],
    aliases: ['repair', 'hardening', 'leaks'],
    compatibilityFleetAgent: null,
    mailbox: 'actor:caulker',
  },
  {
    id: 'quartermaster',
    label: 'Quartermaster',
    title: 'Cost, spawn discipline, backend, and resource-policy actor',
    mission: 'Governs budgets, spawn ceilings, backend/model policy, fleet activation pressure, and resource accounting.',
    owns: ['costs', 'budgets', 'spawn-discipline', 'backend-policy'],
    aliases: ['cost', 'budget', 'resources', 'spawn-discipline'],
    compatibilityFleetAgent: null,
    mailbox: 'actor:quartermaster',
  },
] as const;

const ACTOR_BY_ID = new Map<string, MaritimeActorId>();

for (const actor of MARITIME_ACTORS) {
  ACTOR_BY_ID.set(actor.id, actor.id);
  for (const alias of actor.aliases) {
    ACTOR_BY_ID.set(alias, actor.id);
  }
  if (actor.compatibilityFleetAgent) {
    ACTOR_BY_ID.set(actor.compatibilityFleetAgent, actor.id);
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function field(record: unknown, key: string): unknown {
  if (!record || typeof record !== 'object') return undefined;
  return (record as Record<string, unknown>)[key];
}

function agentIdentity(agent: unknown): string | null {
  const identity = stringValue(field(agent, 'identity'));
  if (identity) return identity;

  const parts = [
    stringValue(field(agent, 'identityProject')),
    stringValue(field(agent, 'identityStack')),
    stringValue(field(agent, 'identityContext')),
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(':') : null;
}

function lowerHaystack(record: unknown): string {
  const values = [
    field(record, 'id'),
    field(record, 'agentId'),
    field(record, 'name'),
    field(record, 'label'),
    field(record, 'identity'),
    field(record, 'identityProject'),
    field(record, 'identityStack'),
    field(record, 'identityContext'),
    field(record, 'purpose'),
    field(record, 'status'),
  ];
  return values
    .map(value => typeof value === 'string' ? value.toLowerCase() : '')
    .filter(Boolean)
    .join(' ');
}

function matchesActor(record: unknown, actor: MaritimeActorDefinition): boolean {
  const haystack = lowerHaystack(record);
  if (!haystack) return false;
  const needles = [
    actor.id,
    actor.compatibilityFleetAgent,
    ...actor.aliases,
  ].filter((value): value is string => !!value);
  return needles.some(needle => haystack.includes(needle.toLowerCase()));
}

function toAgentSignal(agent: unknown): ActorAgentSignal {
  const health = field(agent, 'healthAssessment');
  const liveness = health && typeof health === 'object'
    ? stringValue((health as Record<string, unknown>).liveness)
    : null;

  return {
    id: stringValue(field(agent, 'id')) ?? 'unknown-agent',
    identity: agentIdentity(agent),
    purpose: stringValue(field(agent, 'purpose')),
    lastHeartbeat: numberValue(field(agent, 'lastHeartbeat')),
    liveness,
  };
}

function toSessionSignal(session: unknown): ActorSessionSignal {
  return {
    id: stringValue(field(session, 'id')) ?? 'unknown-session',
    status: stringValue(field(session, 'status')),
    purpose: stringValue(field(session, 'purpose')),
    agentId: stringValue(field(session, 'agentId')),
    updatedAt: numberValue(field(session, 'updatedAt')),
  };
}

function toSalvageSignal(entry: unknown): ActorSalvageSignal {
  return {
    id: stringValue(field(entry, 'id')) ?? stringValue(field(entry, 'agentId')) ?? 'unknown-salvage',
    status: stringValue(field(entry, 'status')),
    purpose: stringValue(field(entry, 'purpose')),
    sessionId: stringValue(field(entry, 'sessionId')),
    updatedAt: numberValue(field(entry, 'updatedAt')) ?? numberValue(field(entry, 'lastSeenAt')),
  };
}

function maxTimestamp(signals: Array<{ lastHeartbeat?: number | null; updatedAt?: number | null }>): number | null {
  const timestamps = signals
    .flatMap(signal => [signal.lastHeartbeat ?? null, signal.updatedAt ?? null])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function leaseState(
  liveBodies: ActorAgentSignal[],
  recentSessions: ActorSessionSignal[],
  salvage: ActorSalvageSignal[],
): MaritimeActorLeaseState {
  if (liveBodies.some(body => body.liveness !== 'dead')) return 'attached';
  if (salvage.length > 0) return 'recoverable';
  if (recentSessions.length > 0) return 'detached';
  return 'dormant';
}

export function resolveMaritimeActorId(value: string): MaritimeActorId | null {
  return ACTOR_BY_ID.get(value.trim().toLowerCase()) ?? null;
}

export function getMaritimeActorDefinition(value: string): MaritimeActorDefinition | null {
  const id = resolveMaritimeActorId(value);
  return id ? MARITIME_ACTORS.find(actor => actor.id === id) ?? null : null;
}

export function listMaritimeActors(input: MaritimeActorsProjectionInput = {}): MaritimeActorRecord[] {
  const agents = input.agents ?? [];
  const sessions = input.sessions ?? [];
  const salvage = input.salvage ?? [];

  return MARITIME_ACTORS.map(actor => {
    const liveBodies = agents.filter(agent => matchesActor(agent, actor)).map(toAgentSignal);
    const recentSessions = sessions.filter(session => matchesActor(session, actor)).map(toSessionSignal);
    const salvageSignals = salvage.filter(entry => matchesActor(entry, actor)).map(toSalvageSignal);
    const state = leaseState(liveBodies, recentSessions, salvageSignals);
    const lastActivityAt = maxTimestamp([...liveBodies, ...recentSessions, ...salvageSignals]);

    const evidence: string[] = [];
    if (actor.compatibilityFleetAgent) {
      evidence.push(`compatibility fleet agent: ${actor.compatibilityFleetAgent}`);
    }
    if (liveBodies.length > 0) evidence.push(`${liveBodies.length} live body signal(s)`);
    if (recentSessions.length > 0) evidence.push(`${recentSessions.length} recent session signal(s)`);
    if (salvageSignals.length > 0) evidence.push(`${salvageSignals.length} salvage signal(s)`);
    if (evidence.length === 0) evidence.push('canonical durable actor definition');

    return {
      ...actor,
      address: actor.mailbox,
      inboxTarget: actor.mailbox,
      mailboxStats: null,
      leaseState: state,
      liveBodies,
      recentSessions,
      salvage: salvageSignals,
      lastActivityAt,
      evidence,
    };
  });
}

export function getMaritimeActor(value: string, input: MaritimeActorsProjectionInput = {}): MaritimeActorRecord | null {
  const id = resolveMaritimeActorId(value);
  if (!id) return null;
  return listMaritimeActors(input).find(actor => actor.id === id) ?? null;
}
