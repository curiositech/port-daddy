import { createHash, randomUUID } from 'node:crypto';
import {
  CONFLICT_SIGNAL_LIMITS,
  type ConflictSignalKind,
  type ParleyCheckpoint,
  type ParleyShape,
} from './parley-trigger.js';
import {
  MAX_TUPLE_IDEMPOTENCY_KEY_CHARS,
} from './tuples.js';
import type { ActorId } from './actor-souls.js';

interface TupleSpaceMin {
  out(
    fields: unknown[],
    options?: { harbor?: string; writtenBy?: string; ttlMs?: number },
  ): { id: number };
  outOnce(
    fields: unknown[],
    options: { harbor?: string; writtenBy?: string; ttlMs?: number; idempotencyKey: string },
  ): {
    tuple: { id: number; fields: unknown[]; writtenBy: string | null; createdAt: number; expiresAt: number | null };
    inserted: boolean;
  };
  getByIdempotencyKey(
    idempotencyKey: string,
    options?: { harbor?: string },
  ): { id: number; fields: unknown[]; writtenBy: string | null; createdAt: number; expiresAt: number | null } | null;
  rd(
    pattern: unknown[],
    options?: { harbor?: string; limit?: number },
  ): Array<{ id: number; fields: unknown[]; writtenBy: string | null; createdAt: number; expiresAt: number | null }>;
}

export type ParleyStatus = 'SUMMONED' | 'CONVENED' | 'COLLAPSED' | 'ESCALATED' | 'VOIDED';
export type ParleyPerformative = 'propose' | 'critique' | 'revise' | 'agree' | 'refuse' | 'inform';
export type ParleyTrigger = 'operator' | 'claim_overlap' | 'detector' | 'swarm_fit';

export interface ParleyRecord {
  parleyId: string;
  surface: string;
  reason: string;
  parties: string[];
  calledBy: string;
  trigger: ParleyTrigger;
  channel: string;
  status: ParleyStatus;
  harbor: string;
  responseDueAt: number | null;
  roundLimit: number;
  createdAt: number;
  automatic: AutomaticParleyMetadata | null;
}

export interface AutomaticParleyMetadata {
  idempotencyKey: string;
  callFingerprint: string;
  signalId: string;
  lineageKey: string;
  checkpoint: ParleyCheckpoint;
  kind: ConflictSignalKind;
  shape: ParleyShape;
  evidenceRefs: string[];
  confidence: number;
  magnitude: number;
  participants: ParleyParticipant[];
}

/**
 * Automatic membership is a daemon-minted actor identity. Inbox delivery is a
 * separate live-session address and never grants membership by itself.
 */
export interface ParleyParticipant {
  actorId: ActorId;
  inboxTarget: string;
  sessionId: string;
  lineageRootSessionId: string;
}

export interface ParleyTurn {
  parleyId: string;
  party: string;
  performative: ParleyPerformative;
  content: string;
  proposalId: string | null;
  evidenceRefs: string[];
  at: number;
}

export interface ParleyOutcome {
  parleyId: string;
  status: Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'>;
  decision: string | null;
  reason: string | null;
  resolvedBy: string;
  dissenters: string[];
  at: number;
}

export interface ParleyReceipt {
  party: string;
  lastSeenAt: number | null;
  unseenTurns: number;
}

export interface ParleySummary {
  parley: ParleyRecord;
  status: ParleyStatus;
  turns: ParleyTurn[];
  outcome: ParleyOutcome | null;
  respondedParties: string[];
  missingParties: string[];
  receipts: ParleyReceipt[];
  expired: boolean;
  risks: string[];
}

export interface AutomaticParleyLifecycle {
  parley: ParleyRecord;
  status: ParleyStatus;
}

export interface CallParleyInput {
  surface: string;
  reason: string;
  parties: string[];
  calledBy: string;
  trigger?: ParleyTrigger;
  harbor?: string;
  ttlMs?: number;
  roundLimit?: number;
}

export interface CallAutomaticParleyInput {
  surface: string;
  reason: string;
  participants: ParleyParticipant[];
  trigger: Exclude<ParleyTrigger, 'operator'>;
  harbor: string;
  automatic: Omit<AutomaticParleyMetadata, 'callFingerprint' | 'participants'>;
}

export interface CallAutomaticParleyResult {
  parley: ParleyRecord;
  replayed: boolean;
  summonsInserted: number;
  notificationFailures: string[];
}

export interface RespondParleyInput {
  parleyId: string;
  party: string;
  performative: ParleyPerformative;
  content: string;
  proposalId?: string | null;
  evidenceRefs?: string[];
}

export interface RespondParleyResult {
  turn: ParleyTurn;
  notified: string[];
  notifyFailures: string[];
}

export interface MarkSeenInput {
  parleyId: string;
  party: string;
  /** Watermark: turns at or before this timestamp count as seen. Defaults to now. */
  throughAt?: number;
}

export interface ResolveParleyInput {
  parleyId: string;
  status: Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'>;
  resolvedBy: string;
  decision?: string | null;
  reason?: string | null;
  dissenters?: string[];
}

interface AgentInboxMin {
  send(
    agentId: string,
    content: unknown,
    options?: { from?: string; type?: string; contentType?: 'text' | 'json' | 'binary' },
  ): { success: boolean; messageId?: number; error?: string };
  internal?: {
    sendOnce(
      agentId: string,
      content: unknown,
      options: { from?: string; type?: string; contentType?: 'text' | 'json' | 'binary'; deliveryKey: string },
    ): { success: boolean; messageId?: number; error?: string };
  };
}

export interface ParleyDeps {
  tuples: TupleSpaceMin;
  agentInbox?: AgentInboxMin;
  now?: () => number;
}

const MANUAL_DEFAULT_HARBOR = 'fleet';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_ROUND_LIMIT = 3;
export const AUTOMATIC_PARLEY_DEFAULTS = Object.freeze({
  ttlMs: DEFAULT_TTL_MS,
  roundLimit: DEFAULT_ROUND_LIMIT,
});
const OUTCOME_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTOMATIC_OPENED_KEY_PREFIX = 'parley:opened:';
const AUTOMATIC_SUMMONS_KEY_PREFIX = 'parley:summons:';
const AUTOMATIC_PARLEY_ID_PREFIX = 'parley-auto:';
const AUTOMATIC_PARLEY_HASH_CHARS = 32;
export const MAX_AUTOMATIC_PARLEY_IDEMPOTENCY_KEY_CHARS =
  MAX_TUPLE_IDEMPOTENCY_KEY_CHARS - AUTOMATIC_OPENED_KEY_PREFIX.length;
const MAX_AUTOMATIC_SUMMONS_KEY_CHARS = AUTOMATIC_SUMMONS_KEY_PREFIX.length
  + AUTOMATIC_PARLEY_ID_PREFIX.length
  + AUTOMATIC_PARLEY_HASH_CHARS
  + 1
  + CONFLICT_SIGNAL_LIMITS.maxPartyChars;
const AUTOMATIC_CALLER = 'port-daddy:parley-auto-trigger';

if (MAX_AUTOMATIC_SUMMONS_KEY_CHARS > MAX_TUPLE_IDEMPOTENCY_KEY_CHARS) {
  throw new Error('automatic Parley summons key bounds exceed tuple.outOnce capacity');
}

const TERMINAL: ReadonlySet<ParleyStatus> = new Set(['COLLAPSED', 'ESCALATED', 'VOIDED']);
const BUDGETED_PERFORMATIVES: ReadonlySet<ParleyPerformative> = new Set(['propose', 'critique', 'revise', 'inform']);

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function canonicalSet(values: string[]): string[] {
  return uniqueNonEmpty(values).sort();
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function automaticParleyId(harbor: string, idempotencyKey: string): string {
  const canonicalHarbor = harbor?.trim();
  if (!canonicalHarbor) throw new Error('automaticParleyId: harbor is required');
  return `${AUTOMATIC_PARLEY_ID_PREFIX}${hash([canonicalHarbor, idempotencyKey.trim()]).slice(0, AUTOMATIC_PARLEY_HASH_CHARS)}`;
}

function canonicalAutomaticParticipants(
  values: ParleyParticipant[],
): ParleyParticipant[] {
  if (!Array.isArray(values)) {
    throw new Error('parley.callAutomatic: participants are required');
  }
  const actorIds = new Set<string>();
  const inboxTargets = new Set<string>();
  const sessionIds = new Set<string>();
  const participants = values.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error('parley.callAutomatic: participant must be an object');
    }
    const actorId = typeof raw.actorId === 'string' ? raw.actorId.trim() : '';
    const inboxTarget = typeof raw.inboxTarget === 'string' ? raw.inboxTarget.trim() : '';
    const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId.trim() : '';
    const lineageRootSessionId = typeof raw.lineageRootSessionId === 'string'
      ? raw.lineageRootSessionId.trim()
      : '';
    if (!actorId || !inboxTarget || !sessionId || !lineageRootSessionId) {
      throw new Error(
        'parley.callAutomatic: participant actorId, inboxTarget, sessionId, and lineageRootSessionId are required',
      );
    }
    if (actorId !== raw.actorId
      || inboxTarget !== raw.inboxTarget
      || sessionId !== raw.sessionId
      || lineageRootSessionId !== raw.lineageRootSessionId) {
      throw new Error('parley.callAutomatic: participant identities must be canonical');
    }
    if (actorId.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars
      || inboxTarget.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars
      || sessionId.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars
      || lineageRootSessionId.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars) {
      throw new Error(
        `parley.callAutomatic: participant identity exceeds ${CONFLICT_SIGNAL_LIMITS.maxPartyChars} characters`,
      );
    }
    if (actorIds.has(actorId)) {
      throw new Error('parley.callAutomatic: participant actorIds must be distinct');
    }
    if (inboxTargets.has(inboxTarget)) {
      throw new Error('parley.callAutomatic: participant inboxTargets must be distinct');
    }
    if (sessionIds.has(sessionId)) {
      throw new Error('parley.callAutomatic: participant sessionIds must be distinct');
    }
    actorIds.add(actorId);
    inboxTargets.add(inboxTarget);
    sessionIds.add(sessionId);
    return { actorId: actorId as ActorId, inboxTarget, sessionId, lineageRootSessionId };
  });
  return participants.sort((a, b) => a.actorId.localeCompare(b.actorId));
}

function isPerformative(value: string): value is ParleyPerformative {
  return value === 'propose'
    || value === 'critique'
    || value === 'revise'
    || value === 'agree'
    || value === 'refuse'
    || value === 'inform';
}

function isTerminal(status: ParleyStatus): boolean {
  return TERMINAL.has(status);
}

export function createParley(deps: ParleyDeps) {
  const { tuples, agentInbox } = deps;
  const now = deps.now ?? (() => Date.now());

  function call(input: CallParleyInput): ParleyRecord {
    const surface = input.surface?.trim();
    if (!surface) throw new Error('parley.call: surface is required');
    const reason = input.reason?.trim();
    if (!reason) throw new Error('parley.call: reason is required');
    const calledBy = input.calledBy?.trim();
    if (!calledBy) throw new Error('parley.call: calledBy is required');
    const parties = uniqueNonEmpty(input.parties ?? []);
    if (parties.length < 2) throw new Error('parley.call: at least two parties are required');
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new Error('parley.call: ttlMs must be >= 0');
    const roundLimit = input.roundLimit ?? DEFAULT_ROUND_LIMIT;
    if (!Number.isInteger(roundLimit) || roundLimit < 1) throw new Error('parley.call: roundLimit must be >= 1');

    const parleyId = randomUUID();
    const t = now();
    const harbor = input.harbor ?? MANUAL_DEFAULT_HARBOR;
    const parley: ParleyRecord = {
      parleyId,
      surface,
      reason,
      parties,
      calledBy,
      trigger: input.trigger ?? 'operator',
      channel: `parley:${parleyId}`,
      status: 'SUMMONED',
      harbor,
      responseDueAt: ttlMs > 0 ? t + ttlMs : null,
      roundLimit,
      createdAt: t,
      automatic: null,
    };

    tuples.out(['parley:opened', parleyId, parley], { harbor, writtenBy: calledBy });
    const notificationFailures: string[] = [];
    for (const party of parties) {
      const summons = {
        surface,
        reason,
        channel: parley.channel,
        calledBy,
        responseDueAt: parley.responseDueAt,
        roundLimit: parley.roundLimit,
        at: t,
      };
      tuples.out(['parley:summons', parleyId, party, summons], { harbor, writtenBy: calledBy, ttlMs: ttlMs > 0 ? ttlMs : undefined });
      if (agentInbox) {
        const result = agentInbox.send(party, {
          kind: 'parley_summons',
          parleyId,
          ...summons,
        }, {
          from: calledBy,
          type: 'parley_summons',
          contentType: 'json',
        });
        if (!result.success) notificationFailures.push(`${party}: ${result.error ?? 'send failed'}`);
      }
    }
    if (notificationFailures.length > 0) {
      throw new Error(`parley.call: failed to notify parties: ${notificationFailures.join('; ')}`);
    }
    return parley;
  }

  /**
   * INTERNAL automatic path. It is intentionally separate from call(), so the
   * manual HTTP route cannot populate idempotency or automatic metadata.
   */
  function callAutomatic(input: CallAutomaticParleyInput): CallAutomaticParleyResult {
    if (Object.prototype.hasOwnProperty.call(input, 'ttlMs')
      || Object.prototype.hasOwnProperty.call(input, 'roundLimit')) {
      throw new Error('parley.callAutomatic: automatic lifecycle overrides are not accepted');
    }
    const surface = input.surface?.trim();
    if (!surface) throw new Error('parley.callAutomatic: surface is required');
    const reason = input.reason?.trim();
    if (!reason) throw new Error('parley.callAutomatic: reason is required');
    const participants = canonicalAutomaticParticipants(input.participants);
    if (participants.length < 2) {
      throw new Error('parley.callAutomatic: at least two distinct participants are required');
    }
    const parties = participants.map((participant) => participant.actorId);
    const idempotencyKey = input.automatic?.idempotencyKey;
    const signalId = input.automatic?.signalId;
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new Error('parley.callAutomatic: idempotencyKey is required');
    }
    if (idempotencyKey !== idempotencyKey.trim()) {
      throw new Error('parley.callAutomatic: idempotencyKey must be canonical');
    }
    if (typeof signalId !== 'string' || !signalId.trim()) {
      throw new Error('parley.callAutomatic: signalId is required');
    }
    if (idempotencyKey !== signalId) {
      throw new Error('parley.callAutomatic: idempotencyKey must equal signalId');
    }
    if (idempotencyKey.length > MAX_AUTOMATIC_PARLEY_IDEMPOTENCY_KEY_CHARS) {
      throw new Error(
        `parley.callAutomatic: idempotencyKey exceeds ${MAX_AUTOMATIC_PARLEY_IDEMPOTENCY_KEY_CHARS} characters`,
      );
    }
    const { ttlMs, roundLimit } = AUTOMATIC_PARLEY_DEFAULTS;
    const harbor = input.harbor?.trim();
    if (!harbor) throw new Error('parley.callAutomatic: harbor is required');
    const evidenceRefs = canonicalSet(input.automatic.evidenceRefs ?? []);
    const metadataWithoutFingerprint = {
      idempotencyKey,
      signalId,
      lineageKey: input.automatic.lineageKey,
      checkpoint: input.automatic.checkpoint,
      kind: input.automatic.kind,
      shape: input.automatic.shape,
      evidenceRefs,
      confidence: input.automatic.confidence,
      magnitude: input.automatic.magnitude,
      participants,
    };
    const callFingerprint = hash([
      harbor,
      surface,
      reason,
      parties,
      input.trigger,
      ttlMs,
      roundLimit,
      metadataWithoutFingerprint,
    ]);
    const parleyId = automaticParleyId(harbor, idempotencyKey);
    const t = now();
    const candidate: ParleyRecord = {
      parleyId,
      surface,
      reason,
      parties,
      calledBy: AUTOMATIC_CALLER,
      trigger: input.trigger,
      channel: `parley:${parleyId}`,
      status: 'SUMMONED',
      harbor,
      responseDueAt: ttlMs > 0 ? t + ttlMs : null,
      roundLimit,
      createdAt: t,
      automatic: {
        ...metadataWithoutFingerprint,
        callFingerprint,
      },
    };

    const opened = tuples.outOnce(['parley:opened', parleyId, candidate], {
      harbor,
      writtenBy: AUTOMATIC_CALLER,
      idempotencyKey: `${AUTOMATIC_OPENED_KEY_PREFIX}${idempotencyKey}`,
    });
    const stored = opened.tuple.fields[2];
    if (!stored || typeof stored !== 'object') {
      throw new Error('parley.callAutomatic: opened reservation is malformed');
    }
    const parley = stored as ParleyRecord;
    if (!parley.automatic
      || parley.automatic.idempotencyKey !== idempotencyKey
      || parley.automatic.callFingerprint !== callFingerprint) {
      throw new Error('parley.callAutomatic: idempotency key was already used for a different canonical call');
    }

    let summonsInserted = 0;
    const notificationFailures: string[] = [];
    const storedParticipants = canonicalAutomaticParticipants(parley.automatic.participants);
    if (JSON.stringify(storedParticipants.map((participant) => participant.actorId))
      !== JSON.stringify(parley.parties)) {
      throw new Error('parley.callAutomatic: stored participant membership is malformed');
    }
    for (const participant of storedParticipants) {
      const party = participant.actorId;
      const summons = {
        surface: parley.surface,
        reason: parley.reason,
        channel: parley.channel,
        calledBy: parley.calledBy,
        responseDueAt: parley.responseDueAt,
        roundLimit: parley.roundLimit,
        at: parley.createdAt,
      };
      const remainingTtl = parley.responseDueAt === null
        ? undefined
        : Math.max(1, parley.responseDueAt - now());
      const summonsResult = tuples.outOnce(
        ['parley:summons', parley.parleyId, party, summons],
        {
          harbor: parley.harbor,
          writtenBy: parley.calledBy,
          ttlMs: remainingTtl,
          idempotencyKey: `parley:summons:${parley.parleyId}:${party}`,
        },
      );
      if (summonsResult.inserted) summonsInserted++;

      if (agentInbox) {
        const result = agentInbox.internal?.sendOnce(participant.inboxTarget, {
          kind: 'parley_summons',
          parleyId: parley.parleyId,
          ...summons,
        }, {
          from: parley.calledBy,
          type: 'parley_summons',
          contentType: 'json',
          deliveryKey: `parley_summons:${parley.parleyId}:${party}`,
        }) ?? { success: false, error: 'internal idempotent inbox delivery unavailable' };
        if (!result.success) {
          notificationFailures.push(`${party} via ${participant.inboxTarget}: ${result.error ?? 'send failed'}`);
        }
      }
    }

    return {
      parley,
      replayed: !opened.inserted,
      summonsInserted,
      notificationFailures,
    };
  }

  function findOpened(parleyId: string): ParleyRecord | null {
    const rows = tuples.rd(['parley:opened', parleyId, '*'], { limit: 1 });
    const data = rows[0]?.fields[2];
    return data && typeof data === 'object' ? data as ParleyRecord : null;
  }

  function getTurns(parleyId: string, harbor?: string): ParleyTurn[] {
    const rows = tuples.rd(['parley:turn', parleyId, '*', '*'], { harbor, limit: 1000 });
    return rows
      .map((row) => row.fields[3])
      .filter((data): data is ParleyTurn => Boolean(data && typeof data === 'object'))
      .sort((a, b) => a.at - b.at);
  }

  function participants(parley: ParleyRecord): string[] {
    return uniqueNonEmpty([...parley.parties, parley.calledBy]);
  }

  function getSeenMap(parleyId: string, harbor?: string): Map<string, number> {
    const rows = tuples.rd(['parley:seen', parleyId, '*', '*'], { harbor, limit: 1000 });
    const seen = new Map<string, number>();
    for (const row of rows) {
      const party = row.fields[2];
      const data = row.fields[3] as { throughAt?: number } | null;
      if (typeof party !== 'string' || !data || typeof data.throughAt !== 'number') continue;
      const prior = seen.get(party);
      if (prior === undefined || data.throughAt > prior) seen.set(party, data.throughAt);
    }
    return seen;
  }

  function getOutcome(parleyId: string, harbor?: string): ParleyOutcome | null {
    const rows = tuples.rd(['parley:outcome', parleyId, '*'], { harbor, limit: 1 });
    const data = rows[0]?.fields[2];
    return data && typeof data === 'object' ? data as ParleyOutcome : null;
  }

  function writeOutcome(parley: ParleyRecord, input: {
    status: Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'>;
    resolvedBy: string;
    decision?: string | null;
    reason?: string | null;
    dissenters?: string[];
  }): ParleyOutcome {
    const outcome: ParleyOutcome = {
      parleyId: parley.parleyId,
      status: input.status,
      decision: input.decision?.trim() || null,
      reason: input.reason?.trim() || null,
      resolvedBy: input.resolvedBy,
      dissenters: uniqueNonEmpty(input.dissenters ?? []),
      at: now(),
    };
    const stored = tuples.outOnce(['parley:outcome', parley.parleyId, outcome], {
      harbor: parley.harbor,
      writtenBy: input.resolvedBy,
      ttlMs: OUTCOME_TTL_MS,
      idempotencyKey: `parley:outcome:${parley.parleyId}`,
    });
    const storedOutcome = stored.tuple.fields[2];
    return storedOutcome && typeof storedOutcome === 'object'
      ? storedOutcome as ParleyOutcome
      : outcome;
  }

  function summarize(parley: ParleyRecord): ParleySummary {
    const turns = getTurns(parley.parleyId, parley.harbor);
    const outcome = getOutcome(parley.parleyId, parley.harbor);
    const seenMap = getSeenMap(parley.parleyId, parley.harbor);
    const receipts: ParleyReceipt[] = participants(parley).map((party) => {
      const lastSeenAt = seenMap.get(party) ?? null;
      const unseenTurns = turns.filter((turn) => (
        turn.party !== party && (lastSeenAt === null || turn.at > lastSeenAt)
      )).length;
      return { party, lastSeenAt, unseenTurns };
    });
    const responded = new Set<string>();
    for (const turn of turns) responded.add(turn.party);
    const respondedParties = parley.parties.filter((party) => responded.has(party));
    const missingParties = parley.parties.filter((party) => !responded.has(party));
    const expired = parley.responseDueAt !== null && now() > parley.responseDueAt;
    const refused = turns.some((turn) => turn.performative === 'refuse');
    const allResponded = missingParties.length === 0;
    const risks: string[] = [];
    if (expired && !outcome) risks.push('response TTL expired without terminal outcome');
    if (refused && !outcome) risks.push('party refused; operator escalation required');
    if (!allResponded && !outcome) risks.push('not all parties have responded');

    let status: ParleyStatus = parley.status;
    if (outcome) {
      status = outcome.status;
    } else if (refused || expired) {
      status = 'ESCALATED';
    } else if (allResponded) {
      status = 'CONVENED';
    }

    return {
      parley,
      status,
      turns,
      outcome,
      respondedParties,
      missingParties,
      receipts,
      expired,
      risks,
    };
  }

  function get(parleyId: string): ParleySummary | null {
    const parley = findOpened(parleyId);
    return parley ? summarize(parley) : null;
  }

  /** Indexed automatic lifecycle read; unrelated tuple history is never parsed. */
  function getAutomatic(
    idempotencyKey: string,
    harbor: string,
  ): AutomaticParleyLifecycle | null {
    const opened = tuples.getByIdempotencyKey(
      `${AUTOMATIC_OPENED_KEY_PREFIX}${idempotencyKey.trim()}`,
      { harbor },
    );
    const data = opened?.fields[2];
    if (!data || typeof data !== 'object') return null;
    const parley = data as ParleyRecord;
    const outcomeRow = tuples.getByIdempotencyKey(
      `parley:outcome:${parley.parleyId}`,
      { harbor: parley.harbor },
    );
    const outcomeData = outcomeRow?.fields[2];
    const outcome = outcomeData && typeof outcomeData === 'object'
      ? outcomeData as ParleyOutcome
      : null;
    const expired = parley.responseDueAt !== null && now() > parley.responseDueAt;
    return {
      parley,
      status: outcome?.status ?? (expired ? 'ESCALATED' : parley.status),
    };
  }

  function list(options: { harbor?: string; status?: ParleyStatus; limit?: number } = {}): ParleySummary[] {
    const rows = tuples.rd(['parley:opened', '*', '*'], { harbor: options.harbor, limit: options.limit ?? 50 });
    const summaries: ParleySummary[] = [];
    for (const row of rows) {
      const data = row.fields[2];
      if (!data || typeof data !== 'object') continue;
      const summary = summarize(data as ParleyRecord);
      if (options.status && summary.status !== options.status) continue;
      summaries.push(summary);
    }
    return summaries;
  }

  function respond(input: RespondParleyInput): RespondParleyResult {
    const parleyId = input.parleyId?.trim();
    if (!parleyId) throw new Error('parley.respond: parleyId is required');
    const summary = get(parleyId);
    if (!summary) throw new Error(`parley.respond: parley '${parleyId}' not found`);
    if (isTerminal(summary.status)) throw new Error(`parley.respond: parley '${parleyId}' is already ${summary.status}`);
    const party = input.party?.trim();
    if (!party) throw new Error('parley.respond: party is required');
    if (!summary.parley.parties.includes(party)) {
      throw new Error(`parley.respond: party '${party}' was not summoned`);
    }
    if (!isPerformative(input.performative)) {
      throw new Error('parley.respond: performative must be propose/critique/revise/agree/refuse/inform');
    }
    if (BUDGETED_PERFORMATIVES.has(input.performative)) {
      const usedTurns = summary.turns.filter((turn) => (
        turn.party === party && BUDGETED_PERFORMATIVES.has(turn.performative)
      )).length;
      if (usedTurns >= summary.parley.roundLimit) {
        writeOutcome(summary.parley, {
          status: 'ESCALATED',
          resolvedBy: 'port-daddy:parley',
          reason: `round limit exhausted for ${party}`,
          dissenters: [party],
        });
        throw new Error(`parley.respond: round limit exhausted for ${party}; parley escalated`);
      }
    }
    const content = input.content?.trim();
    if (!content) throw new Error('parley.respond: content is required');
    const evidenceRefs = Array.isArray(input.evidenceRefs)
      ? input.evidenceRefs.filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
      : [];
    const turn: ParleyTurn = {
      parleyId,
      party,
      performative: input.performative,
      content,
      proposalId: input.proposalId?.trim() || null,
      evidenceRefs,
      at: now(),
    };
    tuples.out(['parley:turn', parleyId, party, turn], {
      harbor: summary.parley.harbor,
      writtenBy: party,
    });
    if (turn.performative === 'refuse' && summary.parley.automatic && !summary.outcome) {
      writeOutcome(summary.parley, {
        status: 'ESCALATED',
        resolvedBy: 'port-daddy:parley',
        reason: `${party} refused the automatic Parley`,
        dissenters: [party],
      });
    }

    // Fan the turn out to every other participant (parties + the summoner) so
    // nobody has to poll `show` to learn a new turn exists. Unlike call(),
    // delivery failure is non-fatal here: the turn is already durable in the
    // tuple space, so failures are reported to the responder instead of thrown.
    const notified: string[] = [];
    const notifyFailures: string[] = [];
    if (agentInbox) {
      for (const recipient of participants(summary.parley)) {
        if (recipient === party) continue;
        const result = agentInbox.send(recipient, {
          kind: 'parley_turn',
          parleyId,
          surface: summary.parley.surface,
          channel: summary.parley.channel,
          party,
          performative: turn.performative,
          content: turn.content,
          proposalId: turn.proposalId,
          evidenceRefs: turn.evidenceRefs,
          at: turn.at,
        }, {
          from: party,
          type: 'parley_turn',
          contentType: 'json',
        });
        if (result.success) notified.push(recipient);
        else notifyFailures.push(`${recipient}: ${result.error ?? 'send failed'}`);
      }
    }
    return { turn, notified, notifyFailures };
  }

  function markSeen(input: MarkSeenInput): ParleyReceipt {
    const parleyId = input.parleyId?.trim();
    if (!parleyId) throw new Error('parley.markSeen: parleyId is required');
    const parley = findOpened(parleyId);
    if (!parley) throw new Error(`parley.markSeen: parley '${parleyId}' not found`);
    const party = input.party?.trim();
    if (!party) throw new Error('parley.markSeen: party is required');
    if (!participants(parley).includes(party)) {
      throw new Error(`parley.markSeen: '${party}' is not part of parley '${parleyId}'`);
    }
    const throughAt = input.throughAt ?? now();
    if (!Number.isFinite(throughAt)) throw new Error('parley.markSeen: throughAt must be a timestamp');
    // Only write when the watermark actually advances: repeated `show` polling
    // must not grow the tuple space, and a bounded row count keeps every
    // receipt inside getSeenMap's scan window. Retention matches outcomes.
    const current = getSeenMap(parleyId, parley.harbor).get(party);
    if (current === undefined || throughAt > current) {
      tuples.out(['parley:seen', parleyId, party, { throughAt, at: now() }], {
        harbor: parley.harbor,
        writtenBy: party,
        ttlMs: OUTCOME_TTL_MS,
      });
    }
    const effective = current !== undefined && current > throughAt ? current : throughAt;
    const unseenTurns = getTurns(parleyId, parley.harbor).filter((turn) => (
      turn.party !== party && turn.at > effective
    )).length;
    return { party, lastSeenAt: effective, unseenTurns };
  }

  function resolve(input: ResolveParleyInput): ParleyOutcome {
    const parleyId = input.parleyId?.trim();
    if (!parleyId) throw new Error('parley.resolve: parleyId is required');
    const summary = get(parleyId);
    if (!summary) throw new Error(`parley.resolve: parley '${parleyId}' not found`);
    if (summary.outcome) throw new Error(`parley.resolve: parley '${parleyId}' already has outcome ${summary.outcome.status}`);
    const resolvedBy = input.resolvedBy?.trim();
    if (!resolvedBy) throw new Error('parley.resolve: resolvedBy is required');
    if (input.status !== 'COLLAPSED' && input.status !== 'ESCALATED' && input.status !== 'VOIDED') {
      throw new Error('parley.resolve: status must be COLLAPSED, ESCALATED, or VOIDED');
    }
    const decision = input.decision?.trim() || null;
    if (input.status === 'COLLAPSED' && !decision) {
      throw new Error('parley.resolve: decision is required when status is COLLAPSED');
    }
    const dissenters = uniqueNonEmpty(input.dissenters ?? []);
    const unknownDissenters = dissenters.filter((party) => !summary.parley.parties.includes(party));
    if (unknownDissenters.length > 0) {
      throw new Error(`parley.resolve: unknown dissenters: ${unknownDissenters.join(', ')}`);
    }
    const outcome = writeOutcome(summary.parley, {
      status: input.status,
      decision,
      resolvedBy,
      reason: input.reason?.trim() || null,
      dissenters,
    });
    return outcome;
  }

  return {
    call,
    callAutomatic,
    respond,
    resolve,
    markSeen,
    get,
    getAutomatic,
    list,
  };
}

export type Parley = ReturnType<typeof createParley>;
