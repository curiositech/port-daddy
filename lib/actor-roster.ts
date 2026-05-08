// The canonical roster of Port Daddy actors. IDs mostly follow fleet agent
// names; standalone durable actors (coxswain, quartermaster) name an owner
// that may not have a live body.
export type ActorId =
  | 'gardener'
  | 'qa'
  | 'test-hunter'
  | 'documentarian'
  | 'simplifier'
  | 'coxswain'
  | 'quartermaster'
  | 'cartographer'
  | 'spark'
  | 'spider';

export type ActorLeaseState = 'attached' | 'recoverable' | 'detached' | 'dormant';

export interface ActorDefinition {
  id: ActorId;
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

export interface ActorRecord extends ActorDefinition {
  address: string;
  inboxTarget: string;
  mailboxStats: ActorMailboxStats | null;
  leaseState: ActorLeaseState;
  liveBodies: ActorAgentSignal[];
  recentSessions: ActorSessionSignal[];
  salvage: ActorSalvageSignal[];
  lastActivityAt: number | null;
  evidence: string[];
}

export interface ActorsProjectionInput {
  agents?: unknown[];
  sessions?: unknown[];
  salvage?: unknown[];
}

export const ACTOR_ROSTER: readonly ActorDefinition[] = [
  {
    id: 'gardener',
    label: 'Gardener',
    title: 'Working-tree hygiene actor',
    mission: 'Reports on uncommitted changes and surfaces drift between working tree and committed state.',
    owns: ['working-tree', 'uncommitted', 'git-status'],
    aliases: ['tree', 'wip'],
    compatibilityFleetAgent: 'gardener',
    mailbox: 'actor:gardener',
  },
  {
    id: 'qa',
    label: 'QA',
    title: 'Validation and evidence actor',
    mission: 'Tracks test runs, validation evidence, signal quality, teardown warnings, and promotion proof.',
    owns: ['tests', 'validation', 'evidence', 'signals'],
    aliases: ['validation', 'evidence'],
    compatibilityFleetAgent: 'qa',
    mailbox: 'actor:qa',
  },
  {
    id: 'test-hunter',
    label: 'Test Hunter',
    title: 'Coverage gap and test-quality actor',
    mission: 'Hunts modules below coverage thresholds, writes meaningful tests against the actual contract, and flags tautologies / mock echoes.',
    owns: ['coverage', 'test-quality', 'test-debt'],
    aliases: ['hunter', 'coverage'],
    compatibilityFleetAgent: 'test-hunter',
    mailbox: 'actor:test-hunter',
  },
  {
    id: 'documentarian',
    label: 'Documentarian',
    title: 'Docs, API, skill, and product-truth actor',
    mission: 'Watches route, manifest, OpenAPI, CLI, MCP, website, and skill drift before product truth splits.',
    owns: ['docs', 'openapi', 'skills', 'manifest', 'website-truth'],
    aliases: ['docs', 'drift'],
    compatibilityFleetAgent: 'documentarian',
    mailbox: 'actor:documentarian',
  },
  {
    id: 'simplifier',
    label: 'Simplifier',
    title: 'Complexity-reduction actor',
    mission: 'Removes unnecessary code, prefers deletion over addition, verifies behavior is preserved by the test suite.',
    owns: ['complexity', 'deletion', 'refactor'],
    aliases: ['shrink', 'reduce'],
    compatibilityFleetAgent: 'simplifier',
    mailbox: 'actor:simplifier',
  },
  {
    id: 'coxswain',
    label: 'Coxswain',
    title: 'Claims, locks, and communications ownership actor',
    mission: 'Owns claims, locks, stale assets, symbolic coordination, file/session contention, AND the live communications fabric — channels, tuples, naming hygiene, subscription coverage, silent-agent detection, and comm-pipeline debug — so coordination conflicts and communication breakdowns have a single durable mailbox.',
    owns: [
      'claims',
      'locks',
      'file-ownership',
      'stale-assets',
      'symbolic-coordination',
      'session-contention',
      'coordination-conflicts',
      // Comms-officer surface — actively recommends, consolidates, and debugs
      // pub/sub + tuple traffic. Not just passive ownership; coxswain runs a
      // periodic audit (lib/coordination-pipeline-audit.ts) that fires
      // templated DMs to offending agents when subscriptions are missing,
      // channel names drift, or tuples shape inconsistently.
      'channels',
      'tuples',
      'channel-naming-hygiene',
      'tuple-nomenclature',
      'subscription-coverage',
      'silent-agents',
      'comm-pipeline-debug',
    ],
    aliases: ['claim-owner', 'lock-owner', 'ownership', 'contention', 'comms-officer', 'signaler'],
    compatibilityFleetAgent: null,
    mailbox: 'actor:coxswain',
  },
  {
    id: 'quartermaster',
    label: 'Quartermaster',
    title: 'Backend, spend, and launch-readiness actor',
    mission: 'Owns spawn discipline, backend readiness, model ladders, telemetry policy, budget ceilings, and spend-related launch blockers.',
    owns: ['backends', 'models', 'spawn-policy', 'telemetry-policy', 'budget', 'spend', 'launch-readiness'],
    aliases: ['spend', 'budget', 'backend-owner', 'model-owner', 'launch-readiness'],
    compatibilityFleetAgent: null,
    mailbox: 'actor:quartermaster',
  },
  {
    id: 'cartographer',
    label: 'Cartographer',
    title: 'Roadmap, recovery, and feedback-harvest actor',
    mission: 'Maintains roadmap state, recovery ledgers, work-slice evidence, supersession edges, and harvests dogfood feedback.',
    owns: ['roadmap', 'recovery-ledger', 'work-slices', 'cartographer-status', 'feedback-harvest'],
    aliases: ['roadmap', 'mapmaker'],
    compatibilityFleetAgent: 'cartographer',
    mailbox: 'actor:cartographer',
  },
  {
    id: 'spark',
    label: 'Spark',
    title: 'Idea-generation actor',
    mission: 'Proposes concrete improvements after deduping against the canonical idea trove.',
    owns: ['ideas', 'proposals', 'novelty-gate'],
    aliases: ['ideator', 'proposer'],
    compatibilityFleetAgent: 'spark',
    mailbox: 'actor:spark',
  },
  {
    id: 'spider',
    label: 'Spider',
    title: 'Combinatorial-connection actor',
    mission: 'Finds new capabilities implied by combinations of existing features, in syllogism form.',
    owns: ['connections', 'syllogisms', 'feature-combinations'],
    aliases: ['weaver', 'connector'],
    compatibilityFleetAgent: 'spider',
    mailbox: 'actor:spider',
  },
] as const;

const ACTOR_BY_ID = new Map<string, ActorId>();

for (const actor of ACTOR_ROSTER) {
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

function matchesActorEvidence(record: unknown, actor: ActorDefinition): boolean {
  const haystack = lowerHaystack(record);
  if (!haystack) return false;
  const needles = [
    actor.id,
    actor.compatibilityFleetAgent,
    ...actor.aliases,
  ].filter((value): value is string => !!value);
  return needles.some(needle => haystack.includes(needle.toLowerCase()));
}

function matchesFleetBody(record: unknown, actor: ActorDefinition): boolean {
  const fleetAgent = actor.compatibilityFleetAgent?.toLowerCase();
  if (!fleetAgent) return false;

  const stack = stringValue(field(record, 'identityStack'))?.toLowerCase();
  const context = stringValue(field(record, 'identityContext'))?.toLowerCase();
  if (stack === 'fleet' && context === fleetAgent) return true;

  const identity = agentIdentity(record)?.toLowerCase();
  if (!identity) return false;

  const parts = identity.split(':').filter(Boolean);
  return parts.length >= 3
    && parts[parts.length - 2] === 'fleet'
    && parts[parts.length - 1] === fleetAgent;
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
): ActorLeaseState {
  if (liveBodies.some(body => body.liveness !== 'dead')) return 'attached';
  if (salvage.length > 0) return 'recoverable';
  if (recentSessions.length > 0) return 'detached';
  return 'dormant';
}

export function resolveActorId(value: string): ActorId | null {
  return ACTOR_BY_ID.get(value.trim().toLowerCase()) ?? null;
}

export function getActorDefinition(value: string): ActorDefinition | null {
  const id = resolveActorId(value);
  return id ? ACTOR_ROSTER.find(actor => actor.id === id) ?? null : null;
}

export function listActors(input: ActorsProjectionInput = {}): ActorRecord[] {
  const agents = input.agents ?? [];
  const sessions = input.sessions ?? [];
  const salvage = input.salvage ?? [];

  return ACTOR_ROSTER.map(actor => {
    const liveBodies = agents.filter(agent => matchesFleetBody(agent, actor)).map(toAgentSignal);
    const recentSessions = sessions.filter(session => matchesActorEvidence(session, actor)).map(toSessionSignal);
    const salvageSignals = salvage.filter(entry => matchesActorEvidence(entry, actor)).map(toSalvageSignal);
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

export function getActor(value: string, input: ActorsProjectionInput = {}): ActorRecord | null {
  const id = resolveActorId(value);
  if (!id) return null;
  return listActors(input).find(actor => actor.id === id) ?? null;
}
