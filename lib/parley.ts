import { createHash, randomUUID } from 'node:crypto';
import {
  CONFLICT_SIGNAL_LIMITS,
  type ConflictSignalKind,
  type ConflictSignal,
  type ParleyDecision,
  type ParleyCheckpoint,
  type ParleyShape,
} from './parley-trigger.js';
import type { ActorId } from './actor-souls.js';
import type { DatabaseInstance } from './sqlite-runtime.js';
import {
  createParleyStore,
  PARLEY_STORE_POLICY,
  type AutomaticTerminalState,
  type AddTurnInput,
  type ParleyNotificationIntent,
  type ParleyStore,
  type StoredDeliveryOverflowReceipt,
  type StoredParleyParticipant,
} from './parley-store.js';

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
  deliveryOverflow: StoredDeliveryOverflowReceipt | null;
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
  /** Credential-derived actor ID. A route must never copy this from request data. */
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
  parley: ParleyRecord | null;
  replayed: boolean;
  summonsInserted: number;
  notificationFailures: string[];
}

export interface RespondParleyInput {
  parleyId: string;
  harbor?: string;
  /** Credential-derived summoned actor ID; request-body self-assertion is not authority. */
  party: string;
  performative: ParleyPerformative;
  content: string;
  proposalId?: string | null;
  evidenceRefs?: string[];
  /** Transport retry identity; defaults to a stable canonical turn-intent ID. */
  idempotencyKey?: string;
}

export interface RespondParleyResult {
  turn: ParleyTurn;
  turnSequence: number;
  replayed: boolean;
  notified: string[];
  notifyFailures: string[];
}

/**
 * A server-owned settlement capability for normal Sugar coordination. It is
 * deliberately separate from the generic `resolve` escape hatch: only a
 * unanimous, typed agreement inside an automatic session-begin convergence
 * can collapse the Parley.
 */
export interface SettleAutomaticConsensusInput {
  parleyId: string;
  harbor?: string;
  party: string;
  proposalId: string;
  content: string;
  decision: string;
  reason: string;
  evidenceRefs?: string[];
  idempotencyKey?: string;
}

export interface SettleAutomaticConsensusResult extends RespondParleyResult {
  outcome: ParleyOutcome | null;
  settled: boolean;
}

export interface MarkSeenInput {
  parleyId: string;
  harbor?: string;
  /** Credential-derived participant ID; request-body self-assertion is not authority. */
  party: string;
  /**
   * Exact durable turn frontier to acknowledge. Defaults to the current
   * durable frontier. Actor binding remains the responsibility of W6/U0.
   */
  throughTurnSequence?: number;
}

export interface ResolveParleyInput {
  parleyId: string;
  harbor?: string;
  status: Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'>;
  /** Credential-derived actor ID; CAP0 must authorize and redeem before use. */
  resolvedBy: string;
  decision?: string | null;
  reason?: string | null;
  dissenters?: string[];
}

interface AgentInboxMin {
  internal?: {
    sendOnce(
      agentId: string,
      content: unknown,
      options: { from?: string; type?: string; contentType?: 'text' | 'json' | 'binary'; deliveryKey: string },
    ): { success: boolean; messageId?: number; error?: string };
  };
}

export interface ParleyDeps {
  db?: DatabaseInstance;
  store?: ParleyStore;
  tenantId?: string;
  defaultHarbor?: string;
  agentInbox?: AgentInboxMin;
  now?: () => number;
  /** Optional scheduler override for deterministic recovery tests. */
  notificationRecovery?: {
    intervalMs?: number;
    setInterval?: (callback: () => void, delayMs: number) => unknown;
    clearInterval?: (handle: unknown) => void;
  };
}

export interface AdmitAutomaticParleyInput {
  harbor: string;
  signal: ConflictSignal;
  lineageKey: string;
  decision: ParleyDecision;
  terminalState: Exclude<AutomaticTerminalState, 'failed'>;
  reason: string;
  call: CallAutomaticParleyInput | null;
  policy: {
    maxPendingGlobal: number;
    maxPendingPerSurface: number;
    cooldownMs: number;
  };
}

export interface AdmitAutomaticParleyResult extends CallAutomaticParleyResult {
  terminalState: AutomaticTerminalState;
  reason: string;
  receiptInserted: boolean;
}

const MANUAL_DEFAULT_HARBOR = 'fleet';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_ROUND_LIMIT = 3;
export const AUTOMATIC_PARLEY_DEFAULTS = Object.freeze({
  ttlMs: PARLEY_STORE_POLICY.automaticResponseTtlMs,
  roundLimit: PARLEY_STORE_POLICY.automaticRoundLimit,
});
const AUTOMATIC_PARLEY_ID_PREFIX = 'parley-auto:';
const AUTOMATIC_PARLEY_HASH_CHARS = 32;
export const MAX_AUTOMATIC_PARLEY_IDEMPOTENCY_KEY_CHARS = CONFLICT_SIGNAL_LIMITS.maxSignalIdChars;
const AUTOMATIC_CALLER = 'port-daddy:parley-auto-trigger';

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

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * Keep the Sugar card handle independently derivable by the normal Parley
 * outbox. Sugar owns admission while this module owns delivery; this tiny
 * pure derivation avoids a dependency cycle and gives both recipients the
 * exact card that the initiating peer saw.
 */
function sugarParleyCardId(signalId: string): string {
  return `sugar-parley-card:v1:${createHash('sha256').update(signalId, 'utf8').digest('hex')}`;
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
  if (values.length > CONFLICT_SIGNAL_LIMITS.maxParties) {
    throw new Error(
      `parley.callAutomatic: participants exceed ${CONFLICT_SIGNAL_LIMITS.maxParties}`,
    );
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
  const now = deps.now ?? (() => Date.now());
  const defaultHarbor = deps.defaultHarbor?.trim() || MANUAL_DEFAULT_HARBOR;
  if (!defaultHarbor || defaultHarbor !== defaultHarbor.trim()) {
    throw new Error('createParley: defaultHarbor must be canonical');
  }
  if (Boolean(deps.store) === Boolean(deps.db)) {
    throw new Error('createParley: provide exactly one of store or db');
  }
  const store = deps.store ?? createParleyStore({
    db: deps.db!,
    tenantId: deps.tenantId?.trim() || (() => {
      throw new Error('createParley: tenantId is required with db');
    })(),
    now,
  });
  const agentInbox = deps.agentInbox;
  const recoveryIntervalMs = deps.notificationRecovery?.intervalMs ?? 1_000;
  if (!Number.isSafeInteger(recoveryIntervalMs)
    || recoveryIntervalMs < 250
    || recoveryIntervalMs > 60_000) {
    throw new Error('createParley: notification recovery interval must be between 250 and 60000');
  }

  function harbor(value?: string): string {
    const canonical = value?.trim() || defaultHarbor;
    if (!canonical || canonical !== canonical.trim()) throw new Error('parley harbor must be canonical');
    return canonical;
  }

  function notificationDelivery(harborName: string): {
    delivered: Array<{ deliveryKey: string; actorId: string }>;
    failures: Array<{ deliveryKey: string; actorId: string; error: string }>;
  } {
    const delivered: Array<{ deliveryKey: string; actorId: string }> = [];
    const failures: Array<{ deliveryKey: string; actorId: string; error: string }> = [];
    for (const message of store.claimNotifications(harborName, { limit: 100 })) {
      const sendOnce = agentInbox?.internal?.sendOnce;
      if (!sendOnce) {
        const error = 'internal idempotent inbox delivery unavailable';
        store.retryNotification(harborName, message.id, message.leaseToken, error);
        failures.push({ deliveryKey: message.deliveryKey, actorId: message.recipientActorId, error });
        continue;
      }
      try {
        const result = sendOnce(message.inboxTarget, message.payload, {
          from: message.fromActorId,
          type: message.eventType,
          contentType: 'json',
          deliveryKey: message.deliveryKey,
        });
        if (!result.success) {
          const error = result.error ?? 'send failed';
          store.retryNotification(harborName, message.id, message.leaseToken, error);
          failures.push({ deliveryKey: message.deliveryKey, actorId: message.recipientActorId, error });
          continue;
        }
        store.acknowledgeNotification(harborName, message.id, message.leaseToken);
        delivered.push({ deliveryKey: message.deliveryKey, actorId: message.recipientActorId });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'send failed';
        store.retryNotification(harborName, message.id, message.leaseToken, reason);
        failures.push({ deliveryKey: message.deliveryKey, actorId: message.recipientActorId, error: reason });
      }
    }
    return { delivered, failures };
  }

  function manualParticipants(parties: string[], calledBy: string): StoredParleyParticipant[] {
    const participants: StoredParleyParticipant[] = parties.map((party) => ({
      actorId: party,
      inboxTarget: party,
      sessionId: null,
      lineageRootSessionId: null,
      summoned: true,
      caller: party === calledBy,
    }));
    if (!participants.some((participant) => participant.caller)) {
      participants.push({
        actorId: calledBy,
        inboxTarget: calledBy,
        sessionId: null,
        lineageRootSessionId: null,
        summoned: false,
        caller: true,
      });
    }
    return participants;
  }

  function summonsNotifications(record: ParleyRecord, recipients: Array<{ actorId: string; inboxTarget: string }>): ParleyNotificationIntent[] {
    const sugarHookContext = record.automatic?.checkpoint === 'session_begin'
      && record.automatic.kind === 'task_convergence'
      ? {
        kind: 'sugar_parley_hook_context',
        schemaVersion: 1,
        parleyId: record.parleyId,
        cardId: sugarParleyCardId(record.automatic.signalId),
        surface: record.surface,
        evidenceRefs: [...record.automatic.evidenceRefs],
        message: 'A bounded Sugar Parley is active. Reply in natural language, keep the shared surface in view, and settle with the typed receipt.',
      }
      : null;
    return recipients.map((recipient) => ({
      deliveryKey: `parley_summons:${record.parleyId}:${recipient.actorId}`,
      recipientActorId: recipient.actorId,
      inboxTarget: recipient.inboxTarget,
      fromActorId: record.calledBy,
      eventType: 'parley_summons',
      payload: {
        kind: 'parley_summons',
        harbor: record.harbor,
        parleyId: record.parleyId,
        surface: record.surface,
        reason: record.reason,
        channel: record.channel,
        calledBy: record.calledBy,
        responseDueAt: record.responseDueAt,
        roundLimit: record.roundLimit,
        at: record.createdAt,
        // Hook consumers can render this as a distinct coordination frame
        // without reverse-engineering automatic metadata or showing raw
        // Parley protocol verbs in the normal agent experience.
        sugarHookContext,
      },
    }));
  }

  function call(input: CallParleyInput): ParleyRecord {
    const surface = input.surface?.trim();
    if (!surface) throw new Error('parley.call: surface is required');
    if (surface.length > CONFLICT_SIGNAL_LIMITS.maxSurfaceChars) {
      throw new Error(`parley.call: surface exceeds ${CONFLICT_SIGNAL_LIMITS.maxSurfaceChars} characters`);
    }
    const reason = input.reason?.trim();
    if (!reason) throw new Error('parley.call: reason is required');
    if (reason.length > CONFLICT_SIGNAL_LIMITS.maxReasonChars) {
      throw new Error(`parley.call: reason exceeds ${CONFLICT_SIGNAL_LIMITS.maxReasonChars} characters`);
    }
    const calledBy = input.calledBy?.trim();
    if (!calledBy) throw new Error('parley.call: calledBy is required');
    if (calledBy.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars) {
      throw new Error(`parley.call: calledBy exceeds ${CONFLICT_SIGNAL_LIMITS.maxPartyChars} characters`);
    }
    const parties = canonicalSet(input.parties ?? []);
    if (parties.length < 2) throw new Error('parley.call: at least two parties are required');
    if (parties.length > CONFLICT_SIGNAL_LIMITS.maxParties) {
      throw new Error(`parley.call: parties exceed ${CONFLICT_SIGNAL_LIMITS.maxParties}`);
    }
    if (parties.some((party) => party.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars)) {
      throw new Error(`parley.call: party exceeds ${CONFLICT_SIGNAL_LIMITS.maxPartyChars} characters`);
    }
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0 || ttlMs > 90 * 24 * 60 * 60 * 1000) {
      throw new Error('parley.call: ttlMs must be a bounded non-negative integer');
    }
    const roundLimit = input.roundLimit ?? DEFAULT_ROUND_LIMIT;
    if (!Number.isInteger(roundLimit) || roundLimit < 1 || roundLimit > 64) {
      throw new Error('parley.call: roundLimit must be between 1 and 64');
    }
    const harborName = harbor(input.harbor);
    const parleyId = randomUUID();
    const record = {
      parleyId,
      surface,
      reason,
      parties,
      calledBy,
      trigger: input.trigger ?? 'operator',
      channel: `parley:${parleyId}`,
      status: 'SUMMONED' as const,
      harbor: harborName,
      roundLimit,
      automatic: null,
    };
    const created = store.createManual({
      parley: record,
      responseTtlMs: ttlMs > 0 ? ttlMs : null,
      participants: manualParticipants(parties, calledBy),
      notifications: (createdRecord) => summonsNotifications(
        createdRecord,
        parties.map((party) => ({ actorId: party, inboxTarget: party })),
      ),
    });
    notificationDelivery(harborName);
    return created;
  }

  function buildAutomaticRecord(input: CallAutomaticParleyInput): {
    record: ParleyRecord;
    participants: ParleyParticipant[];
  } {
    if (Object.prototype.hasOwnProperty.call(input, 'ttlMs')
      || Object.prototype.hasOwnProperty.call(input, 'roundLimit')) {
      throw new Error('parley automatic admission: lifecycle overrides are not accepted');
    }
    const surface = input.surface?.trim();
    if (!surface) throw new Error('parley automatic admission: surface is required');
    if (surface.length > CONFLICT_SIGNAL_LIMITS.maxSurfaceChars) {
      throw new Error(`parley automatic admission: surface exceeds ${CONFLICT_SIGNAL_LIMITS.maxSurfaceChars} characters`);
    }
    const reason = input.reason?.trim();
    if (!reason) throw new Error('parley automatic admission: reason is required');
    if (reason.length > CONFLICT_SIGNAL_LIMITS.maxReasonChars) {
      throw new Error(`parley automatic admission: reason exceeds ${CONFLICT_SIGNAL_LIMITS.maxReasonChars} characters`);
    }
    const participants = canonicalAutomaticParticipants(input.participants);
    if (participants.length < 2) throw new Error('parley automatic admission: at least two participants are required');
    const idempotencyKey = input.automatic?.idempotencyKey;
    const signalId = input.automatic?.signalId;
    if (typeof idempotencyKey !== 'string' || idempotencyKey !== idempotencyKey.trim() || !idempotencyKey) {
      throw new Error('parley automatic admission: canonical idempotencyKey is required');
    }
    if (signalId !== idempotencyKey) {
      throw new Error('parley automatic admission: idempotencyKey must equal signalId');
    }
    if (idempotencyKey.length > MAX_AUTOMATIC_PARLEY_IDEMPOTENCY_KEY_CHARS) {
      throw new Error(`parley automatic admission: idempotencyKey exceeds ${MAX_AUTOMATIC_PARLEY_IDEMPOTENCY_KEY_CHARS} characters`);
    }
    const harborName = harbor(input.harbor);
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
      store.tenantId,
      harborName,
      surface,
      reason,
      input.trigger,
      AUTOMATIC_PARLEY_DEFAULTS,
      metadataWithoutFingerprint,
    ]);
    const parleyId = automaticParleyId(harborName, idempotencyKey);
    const at = now();
    const record: ParleyRecord = {
      parleyId,
      surface,
      reason,
      parties: participants.map((participant) => participant.actorId),
      calledBy: AUTOMATIC_CALLER,
      trigger: input.trigger,
      channel: `parley:${parleyId}`,
      status: 'SUMMONED',
      harbor: harborName,
      responseDueAt: at + AUTOMATIC_PARLEY_DEFAULTS.ttlMs,
      roundLimit: AUTOMATIC_PARLEY_DEFAULTS.roundLimit,
      createdAt: at,
      automatic: { ...metadataWithoutFingerprint, callFingerprint },
    };
    return {
      record,
      participants,
    };
  }

  function admitAutomaticWithMode(
    input: AdmitAutomaticParleyInput,
    mode: 'managed' | 'owning-transaction',
  ): AdmitAutomaticParleyResult {
    const built = input.terminalState === 'fired'
      ? buildAutomaticRecord(input.call ?? (() => { throw new Error('fired automatic admission requires call data'); })())
      : null;
    if (input.terminalState !== 'fired' && input.call !== null) {
      throw new Error('non-fired automatic admission cannot carry call data');
    }
    const harborName = harbor(input.harbor);
    if (input.call && harbor(input.call.harbor) !== harborName) {
      throw new Error('automatic admission call harbor does not match evaluation scope');
    }
    const storeInput = {
      harbor: harborName,
      signal: input.signal,
      signalFingerprint: hash(input.signal),
      lineageKey: input.lineageKey,
      decision: input.decision,
      terminalState: input.terminalState,
      reason: input.reason,
      parley: built?.record ?? null,
      participants: built?.participants ?? [],
      notifications: built
        ? (record: ParleyRecord) => summonsNotifications(
          record,
          built.participants.map((participant) => ({
            actorId: participant.actorId,
            inboxTarget: participant.inboxTarget,
          })),
        )
        : null,
      ...input.policy,
    };
    const admitted = mode === 'owning-transaction'
      ? store.admitAutomaticInTransaction(storeInput)
      : store.admitAutomatic(storeInput);
    const delivery = mode === 'managed' && admitted.parley
      ? notificationDelivery(harborName)
      : { delivered: [], failures: [] };
    return {
      parley: admitted.parley,
      replayed: admitted.replayed,
      summonsInserted: admitted.summonsInserted,
      notificationFailures: delivery.failures.map((failure) => (
        `${failure.actorId}: ${failure.error}`
      )),
      terminalState: admitted.terminalState,
      reason: admitted.reason,
      receiptInserted: admitted.receiptInserted,
    };
  }

  function admitAutomatic(input: AdmitAutomaticParleyInput): AdmitAutomaticParleyResult {
    return admitAutomaticWithMode(input, 'managed');
  }

  /**
   * Same-database integration seam for claim-before-hail producers.
   *
   * The caller must already own an open transaction on the Database used to
   * construct this Parley authority. This writes reservations, admission,
   * canonical records, receipts, and outbox rows without publishing anything.
   * The caller must commit its outer transaction before invoking
   * `internal.drainNotifications(harbor)`. Post-claim best-effort admission is
   * forbidden because it can expose a claim without its governance receipt.
   */
  function admitAutomaticInTransaction(
    input: AdmitAutomaticParleyInput,
  ): AdmitAutomaticParleyResult {
    return admitAutomaticWithMode(input, 'owning-transaction');
  }

  function summarize(snapshot: ReturnType<ParleyStore['getSnapshot']> extends infer T ? Exclude<T, null> : never): ParleySummary {
    const responded = new Set(snapshot.turns.map((turn) => turn.party));
    const respondedParties = snapshot.parley.parties.filter((party) => responded.has(party));
    const missingParties = snapshot.parley.parties.filter((party) => !responded.has(party));
    const receipts = snapshot.participants.map((participant) => {
      const seen = snapshot.seen.get(participant.actorId);
      return {
        party: participant.actorId,
        lastSeenAt: seen?.lastSeenAt ?? null,
        unseenTurns: snapshot.turns.filter((turn) => (
          turn.party !== participant.actorId
          && turn.turnSequence > (seen?.turnSequence ?? 0)
        )).length,
      };
    });
    const turns: ParleyTurn[] = snapshot.turns.map(({ turnSequence: _turnSequence, ...turn }) => turn);
    const expired = snapshot.parley.responseDueAt !== null
      && snapshot.observedAt > snapshot.parley.responseDueAt;
    const status = snapshot.outcome?.status ?? snapshot.parley.status;
    const risks: string[] = [];
    if (expired && !snapshot.outcome) risks.push('response TTL expired without terminal outcome');
    if (missingParties.length > 0 && !snapshot.outcome) risks.push('not all parties have responded');
    if (snapshot.deliveryOverflow) {
      risks.push(
        `${snapshot.deliveryOverflow.droppedIntents} terminal notification intents require operator recovery`,
      );
    }
    return {
      parley: snapshot.parley,
      status,
      turns,
      outcome: snapshot.outcome,
      deliveryOverflow: snapshot.deliveryOverflow,
      respondedParties,
      missingParties,
      receipts,
      expired,
      risks,
    };
  }

  function get(parleyId: string, harborName: string = defaultHarbor): ParleySummary | null {
    const snapshot = store.getSnapshot(harbor(harborName), parleyId?.trim());
    notificationDelivery(harbor(harborName));
    return snapshot ? summarize(snapshot) : null;
  }

  function getAutomatic(idempotencyKey: string, harborName: string): AutomaticParleyLifecycle | null {
    const lifecycle = store.getAutomatic(idempotencyKey, harbor(harborName));
    notificationDelivery(harbor(harborName));
    return lifecycle;
  }

  function list(options: { harbor?: string; status?: ParleyStatus; limit?: number } = {}): ParleySummary[] {
    const harborName = harbor(options.harbor);
    const snapshots = store.list({
      harbor: harborName,
      status: options.status,
      limit: options.limit ?? 50,
    });
    notificationDelivery(harborName);
    return snapshots.map(summarize);
  }

  function respondInternal(
    input: RespondParleyInput,
    automaticConsensus: NonNullable<AddTurnInput['automaticConsensus']> | null = null,
  ): RespondParleyResult {
    const parleyId = input.parleyId?.trim();
    if (!parleyId) throw new Error('parley.respond: parleyId is required');
    const harborName = harbor(input.harbor);
    const snapshot = store.getSnapshot(harborName, parleyId);
    if (!snapshot) throw new Error(`parley.respond: parley '${parleyId}' not found in harbor '${harborName}'`);
    const party = input.party?.trim();
    if (!party) throw new Error('parley.respond: party is required');
    if (!snapshot.parley.parties.includes(party)) throw new Error(`parley.respond: party '${party}' was not summoned`);
    if (!isPerformative(input.performative)) {
      throw new Error('parley.respond: performative must be propose/critique/revise/agree/refuse/inform');
    }
    const content = input.content?.trim();
    if (!content) throw new Error('parley.respond: content is required');
    const evidenceRefs = canonicalSet((input.evidenceRefs ?? []).filter((value): value is string => typeof value === 'string'));
    const proposalId = input.proposalId?.trim() || null;
    const intentFingerprint = hash({
      parleyId,
      party,
      performative: input.performative,
      content,
      proposalId,
      evidenceRefs,
    });
    const idempotencyKey = input.idempotencyKey === undefined
      ? `turn-intent:v1:${intentFingerprint}`
      : input.idempotencyKey;
    if (!idempotencyKey
      || idempotencyKey !== idempotencyKey.trim()
      || idempotencyKey.length > 256) {
      throw new Error('parley.respond: idempotencyKey must be a canonical string of at most 256 characters');
    }
    const recipients = snapshot.participants.filter((participant) => (
      participant.actorId !== party && participant.inboxTarget !== null
    ));
    const result = store.addTurn({
      harbor: harborName,
      parleyId,
      party,
      performative: input.performative,
      content,
      proposalId,
      evidenceRefs,
      idempotencyKey,
      intentFingerprint,
      notifications: (sequence, committedAt) => recipients.map((recipient) => ({
        deliveryKey: `parley_turn:${parleyId}:${sequence}:${recipient.actorId}`,
        recipientActorId: recipient.actorId,
        inboxTarget: recipient.inboxTarget!,
        fromActorId: party,
        eventType: 'parley_turn',
        payload: {
          kind: 'parley_turn',
          harbor: harborName,
          parleyId,
          surface: snapshot.parley.surface,
          channel: snapshot.parley.channel,
          party,
          performative: input.performative,
          content,
          proposalId,
          evidenceRefs,
          at: committedAt,
        },
      })),
      ...(automaticConsensus ? { automaticConsensus } : {}),
    });
    const delivery = notificationDelivery(harborName);
    if (!result.turn) {
      throw new Error(`parley.respond: ${result.escalatedReason ?? 'turn was not accepted'}`);
    }
    if (result.turnSequence === null) {
      throw new Error('parley.respond: committed turn is missing its durable sequence');
    }
    const { turnSequence: _storedSequence, ...turn } = result.turn as ParleyTurn & {
      turnSequence?: number;
    };
    const deliveryKeys = new Set(result.deliveryKeys);
    return {
      turn,
      turnSequence: result.turnSequence,
      replayed: result.replayed,
      notified: delivery.delivered.filter((item) => deliveryKeys.has(item.deliveryKey)).map((item) => item.actorId),
      notifyFailures: delivery.failures
        .filter((item) => deliveryKeys.has(item.deliveryKey))
        .map((item) => `${item.actorId}: ${item.error}`),
    };
  }

  function respond(input: RespondParleyInput): RespondParleyResult {
    return respondInternal(input);
  }

  function settleAutomaticConsensus(
    input: SettleAutomaticConsensusInput,
  ): SettleAutomaticConsensusResult {
    const parleyId = input.parleyId?.trim();
    if (!parleyId) throw new Error('parley.settleAutomaticConsensus: parleyId is required');
    const harborName = harbor(input.harbor);
    const party = input.party?.trim();
    if (!party) throw new Error('parley.settleAutomaticConsensus: party is required');
    const proposalId = input.proposalId?.trim();
    if (!proposalId || proposalId.length > 256) {
      throw new Error('parley.settleAutomaticConsensus: proposalId must be a canonical string of at most 256 characters');
    }
    const content = input.content?.trim();
    const decision = input.decision?.trim();
    const reason = input.reason?.trim();
    if (!content || !decision || !reason) {
      throw new Error('parley.settleAutomaticConsensus: content, decision, and reason are required');
    }
    const snapshot = store.getSnapshot(harborName, parleyId);
    if (!snapshot) throw new Error(`parley.settleAutomaticConsensus: parley '${parleyId}' not found in harbor '${harborName}'`);
    if (snapshot.parley.automatic?.checkpoint !== 'session_begin'
      || snapshot.parley.automatic.kind !== 'task_convergence') {
      throw new Error('parley.settleAutomaticConsensus: only automatic session-begin task convergence Parleys may settle here');
    }
    if (!snapshot.parley.parties.includes(party)) {
      throw new Error(`parley.settleAutomaticConsensus: party '${party}' was not summoned`);
    }
    const evidenceRefs = canonicalSet(
      (input.evidenceRefs ?? snapshot.parley.automatic.evidenceRefs)
        .filter((value): value is string => typeof value === 'string'),
    );
    const response = respondInternal({
      parleyId,
      harbor: harborName,
      party,
      performative: 'agree',
      content,
      proposalId,
      evidenceRefs,
      idempotencyKey: input.idempotencyKey,
    }, {
      proposalId,
      decision,
      reason,
      notifications: (record, outcome) => record.automatic!.participants.map((participant) => ({
        deliveryKey: `parley-settlement:${record.parleyId}:${participant.actorId}`,
        recipientActorId: participant.actorId,
        inboxTarget: participant.inboxTarget,
        fromActorId: 'port-daddy:sugar-parley-consensus',
        // The outbox event stays within its durable v1 enum; the payload's
        // discriminant is the forward-compatible settlement contract. This
        // avoids requiring every historical registry to rebuild its outbox
        // table merely to transport a typed terminal receipt.
        eventType: 'parley_turn' as const,
        payload: {
          kind: 'sugar_parley_settlement_receipt',
          schemaVersion: 1,
          harbor: record.harbor,
          parleyId: record.parleyId,
          surface: record.surface,
          proposalId,
          decision: outcome.decision,
          reason: outcome.reason,
          status: outcome.status,
          resolvedBy: outcome.resolvedBy,
          evidenceRefs: [...record.automatic!.evidenceRefs],
          at: outcome.at,
        },
      })),
    });
    const settled = get(parleyId, harborName);
    const outcome = settled?.outcome ?? null;
    return {
      ...response,
      outcome,
      settled: settled?.status === 'COLLAPSED'
        && outcome?.resolvedBy === 'port-daddy:sugar-parley-consensus',
    };
  }

  function markSeen(input: MarkSeenInput): ParleyReceipt {
    if (Object.prototype.hasOwnProperty.call(input, 'throughAt')) {
      throw new Error('parley.markSeen: timestamp watermarks are not accepted; use throughTurnSequence');
    }
    const parleyId = input.parleyId?.trim();
    if (!parleyId) throw new Error('parley.markSeen: parleyId is required');
    const party = input.party?.trim();
    if (!party) throw new Error('parley.markSeen: party is required');
    const harborName = harbor(input.harbor);
    const effective = store.markSeen({
      harbor: harborName,
      parleyId,
      actorId: party,
      throughTurnSequence: input.throughTurnSequence,
    });
    const snapshot = store.getSnapshot(harborName, parleyId)!;
    notificationDelivery(harborName);
    return {
      party,
      lastSeenAt: effective.lastSeenAt,
      unseenTurns: snapshot.turns.filter((turn) => (
        turn.party !== party && turn.turnSequence > effective.turnSequence
      )).length,
    };
  }

  function resolve(input: ResolveParleyInput): ParleyOutcome {
    void input;
    throw new Error('parley.resolve: unavailable until CAP0 authorizes and redeems this mutation');
  }

  function reap(harborName: string = defaultHarbor) {
    if (arguments.length > 1) {
      throw new Error('parley.reap: caller-owned timestamps are not accepted');
    }
    const canonicalHarbor = harbor(harborName);
    try {
      return store.reap(canonicalHarbor);
    } finally {
      notificationDelivery(canonicalHarbor);
    }
  }

  function recoverDueNotifications(): {
    harbors: string[];
    delivered: number;
    failures: number;
  } {
    const harbors = store.dueNotificationHarbors();
    let delivered = 0;
    let failures = 0;
    for (const harborName of harbors) {
      const result = notificationDelivery(harborName);
      delivered += result.delivered.length;
      failures += result.failures.length;
    }
    return { harbors, delivered, failures };
  }

  // Recover every committed-but-unpublished tenant harbor after daemon restart.
  recoverDueNotifications();

  // The owner explicitly opts into a timer and therefore owns stopping it.
  // Startup recovery above is unconditional and remains deterministic for
  // store-injected library/test instances.
  const recoveryScheduler = deps.notificationRecovery ? {
    setInterval: deps.notificationRecovery.setInterval
      ?? ((callback: () => void, delayMs: number): unknown => globalThis.setInterval(callback, delayMs)),
    clearInterval: deps.notificationRecovery.clearInterval
      ?? ((handle: unknown): void => {
        globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
      }),
  } : null;
  const recoveryHandle = recoveryScheduler?.setInterval(() => {
    recoverDueNotifications();
  }, recoveryIntervalMs) ?? null;
  if (recoveryHandle && typeof recoveryHandle === 'object'
    && 'unref' in recoveryHandle
    && typeof recoveryHandle.unref === 'function') {
    recoveryHandle.unref();
  }

  function stopNotificationRecovery(): void {
    if (recoveryHandle === null) return;
    recoveryScheduler?.clearInterval(recoveryHandle);
  }

  return {
    call,
    admitAutomatic,
    respond,
    settleAutomaticConsensus,
    resolve,
    markSeen,
    get,
    getAutomatic,
    list,
    reap,
    internal: {
      admitAutomaticInTransaction,
      drainNotifications: notificationDelivery,
      recoverDueNotifications,
      stopNotificationRecovery,
    },
  };
}
export type Parley = ReturnType<typeof createParley>;
