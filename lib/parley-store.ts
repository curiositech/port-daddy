/**
 * Indexed transactional authority for Parley lifecycle state.
 *
 * Every authoritative key is tenant + harbor scoped. Automatic admission is a
 * single SQLite transaction: canonical signal reservation, lineage ownership,
 * global/surface capacity, the Parley record, participants, summons outbox,
 * and the first terminal evaluation receipt either all commit or all roll back.
 * Inbox delivery is deliberately outside that transaction and can only happen
 * after a durable outbox lease (claim-before-hail).
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseInstance } from './sqlite-runtime.js';
import {
  PARLEY_CHECKPOINTS,
  PARLEY_SHAPES,
  CONFLICT_SIGNAL_LIMITS,
  CONFLICT_SIGNAL_PRODUCERS,
  conflictSignalId,
  shouldConvene,
  type ConflictSignal,
  type ParleyDecision,
} from './parley-trigger.js';
import type {
  AutomaticParleyLifecycle,
  ParleyOutcome,
  ParleyParticipant,
  ParleyPerformative,
  ParleyRecord,
  ParleyStatus,
  ParleyTurn,
} from './parley.js';

export const PARLEY_STORE_LIMITS = Object.freeze({
  maxTenantChars: 128,
  maxHarborChars: 128,
  maxParleyIdChars: 192,
  maxChannelChars: 256,
  maxActorChars: CONFLICT_SIGNAL_LIMITS.maxPartyChars,
  maxParticipants: CONFLICT_SIGNAL_LIMITS.maxParties,
  maxTurnContentChars: 16_384,
  maxDecisionChars: 16_384,
  maxProposalIdChars: 256,
  maxRoundLimit: 64,
  maxTurnsPerParley: 4_096,
  maxListPage: 100,
  maxPendingOutboxPerHarbor: 2_048,
  maxOutboxPayloadBytes: 131_072,
  maxOutboxAttempts: 8,
  maxOutboxClaim: 100,
  maxDueHarborsPerSweep: 64,
  maxHarborsPerTenant: 64,
  maxRetainedRecordsPerHarbor: 1_024,
  maxRetainedSignalsPerHarbor: 8_192,
  maxRetainedTurnsPerHarbor: 16_384,
  maxRetainedOutboxPerHarbor: 8_192,
  maxRetainedRecordsPerTenant: 1_024,
  maxRetainedSignalsPerTenant: 8_192,
  maxRetainedTurnsPerTenant: 16_384,
  maxRetainedOutboxPerTenant: 8_192,
  maxRetainedRowsPerTenant: 33_792,
  maxRetainedBytesPerTenant: 64 * 1_024 * 1_024,
  maxOverflowIntentsPerParley: 128,
  maxTtlMs: 90 * 24 * 60 * 60 * 1000,
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  reapBatch: 500,
} as const);

/**
 * Server-owned freshness and replay policy for trusted producer events.
 *
 * A producer cannot select any of these values. A new observation must arrive
 * promptly, exact retries remain replayable for the whole producer retry
 * horizon, and the tombstone survives through that horizon. Once reaped, the
 * original producedAt is old enough that the event can never be admitted anew.
 */
export const PARLEY_SIGNAL_FRESHNESS = Object.freeze({
  maxSignalAgeMs: 24 * 60 * 60 * 1000,
  maxFutureClockSkewMs: 5 * 60 * 1000,
  maxProducerRetryHorizonMs: 30 * 24 * 60 * 60 * 1000,
  dedupeTombstoneMs: 30 * 24 * 60 * 60 * 1000,
} as const);

/** Immutable lifecycle policy stamped by STORE0 for automatic Parleys. */
export const PARLEY_STORE_POLICY = Object.freeze({
  automaticResponseTtlMs: 60 * 60 * 1000,
  automaticRoundLimit: 3,
} as const);

/**
 * Immutable receipt version for the one-way v3.30.2 tuple authority import.
 *
 * The version is deliberately part of durable state instead of a startup flag:
 * a recovered daemon must be able to prove whether it imported the old
 * authority, what it observed, and that a later restart did not replay it.
 */
export const LEGACY_PARLEY_TUPLE_MIGRATION_VERSION = 'v3.30.2-tuples-to-store0-v1';
const LEGACY_PARLEY_TUPLE_TENANT = 'local-daemon';
const LEGACY_PARLEY_TUPLE_QUERY_BATCH = 200;

/** Durable evidence left by the legacy tuple importer after its single commit. */
export interface LegacyParleyTupleMigrationReceipt {
  migrationVersion: typeof LEGACY_PARLEY_TUPLE_MIGRATION_VERSION;
  sourceDigest: string;
  /** Total tuple rows at migration commit; the importer never mutates this source table. */
  sourceTupleRows: number;
  sourceOpenedRows: number;
  sourceTurnRows: number;
  sourceSeenRows: number;
  sourceSeenFrontiers: number;
  sourceOutcomeRows: number;
  importedRecords: number;
  importedTurns: number;
  importedSeenReceipts: number;
  /** Includes zero frontiers that have no normalized receipt row. */
  importedSeenProvenance: number;
  importedOutcomes: number;
  completedAt: number;
  replayed: boolean;
}

if (PARLEY_SIGNAL_FRESHNESS.dedupeTombstoneMs
  < PARLEY_SIGNAL_FRESHNESS.maxProducerRetryHorizonMs) {
  throw new Error('Parley dedupe tombstone must cover the maximum producer retry horizon');
}

export const PARLEY_STORE_FAULT_BOUNDARIES = Object.freeze([
  'manual.record',
  'manual.participants',
  'manual.outbox',
  'automatic.signal',
  'automatic.lineage',
  'automatic.record',
  'automatic.participants',
  'automatic.surface-admission',
  'automatic.global-admission',
  'automatic.outbox',
  'automatic.receipt',
  'turn.record',
  'turn.outbox',
  'terminal.outcome',
  'terminal.release',
] as const);

export type ParleyStoreFaultBoundary = (typeof PARLEY_STORE_FAULT_BOUNDARIES)[number];
export type AutomaticTerminalState = 'evaluated' | 'fired' | 'suppressed' | 'failed';

export interface StoredParleyParticipant {
  actorId: string;
  inboxTarget: string | null;
  sessionId: string | null;
  lineageRootSessionId: string | null;
  summoned: boolean;
  caller: boolean;
}

export interface StoredParleyTurn extends ParleyTurn {
  /** Monotonic durable frontier; timestamps are presentation, not receipt authority. */
  turnSequence: number;
}

export interface StoredSeenReceipt {
  /** Timestamp of the durable turn at the frontier, or null before any turn exists. */
  lastSeenAt: number | null;
  /** Highest existing turn sequence acknowledged by this participant. */
  turnSequence: number;
}

export interface StoredDeliveryOverflowReceipt {
  droppedIntents: number;
  batchCount: number;
  sawTurn: boolean;
  sawEscalation: boolean;
  evidenceHash: string;
  firstAt: number;
  lastAt: number;
  lastError: string;
}

export interface ParleyQuotaSnapshot {
  retainedRecords: number;
  retainedSignals: number;
  retainedTurns: number;
  retainedOutbox: number;
}

/** Tenant-wide hard ceiling shared by every caller-selected harbor shard. */
export interface ParleyTenantQuotaSnapshot extends ParleyQuotaSnapshot {
  harborCount: number;
  retainedRows: number;
  retainedBytes: number;
}

export interface ParleyStoreSnapshot {
  parley: ParleyRecord;
  participants: StoredParleyParticipant[];
  turns: StoredParleyTurn[];
  outcome: ParleyOutcome | null;
  seen: Map<string, StoredSeenReceipt>;
  deliveryOverflow: StoredDeliveryOverflowReceipt | null;
  /** One captured clock value used for both TTL settlement and this projection. */
  observedAt: number;
}

export interface ParleyNotificationIntent {
  deliveryKey: string;
  recipientActorId: string;
  inboxTarget: string;
  fromActorId: string;
  eventType: 'parley_summons' | 'parley_turn' | 'parley_escalation';
  payload: Record<string, unknown>;
}

export interface ClaimedParleyNotification extends ParleyNotificationIntent {
  id: number;
  attempts: number;
  leaseToken: string;
}

export interface AutomaticAdmissionInput {
  harbor: string;
  signal: ConflictSignal;
  signalFingerprint: string;
  lineageKey: string;
  decision: ParleyDecision;
  terminalState: Exclude<AutomaticTerminalState, 'failed'>;
  reason: string;
  parley: ParleyRecord | null;
  participants: ParleyParticipant[];
  notifications: ((record: ParleyRecord) => ParleyNotificationIntent[]) | null;
  maxPendingGlobal: number;
  maxPendingPerSurface: number;
  cooldownMs: number;
}

export interface AutomaticAdmissionResult {
  terminalState: AutomaticTerminalState;
  replayed: boolean;
  parley: ParleyRecord | null;
  reason: string;
  summonsInserted: number;
  receiptInserted: boolean;
}

export interface AddTurnInput {
  harbor: string;
  parleyId: string;
  party: string;
  performative: ParleyPerformative;
  content: string;
  proposalId: string | null;
  evidenceRefs: string[];
  idempotencyKey: string;
  intentFingerprint: string;
  notifications: (turnSequence: number, at: number) => ParleyNotificationIntent[];
  /**
   * Narrow terminal authority used only by the typed Sugar settlement facade.
   * The store verifies both the automatic checkpoint/kind and unanimous latest
   * agreement before it can collapse a Parley. Generic `agree` turns remain
   * ordinary conversation and never obtain this capability.
   */
  automaticConsensus?: {
    proposalId: string;
    decision: string;
    reason: string;
    /**
     * Executes while the authoritative turn/outcome transaction is open. A
     * throw rolls back the agreeing turn, outcome, cooldown and outbox, so a
     * terminal Sugar receipt can never outrun its durable effects.
     */
    finalize: (record: ParleyRecord, outcome: ParleyOutcome) => unknown;
    notifications: (
      record: ParleyRecord,
      outcome: ParleyOutcome,
      finalization: unknown,
    ) => ParleyNotificationIntent[];
  };
}

export interface AddTurnResult {
  turn: ParleyTurn | null;
  turnSequence: number | null;
  deliveryKeys: string[];
  escalatedReason: string | null;
  replayed: boolean;
}

export interface ParleyStoreDeps {
  db: DatabaseInstance;
  tenantId: string;
  now?: () => number;
  faultInjector?: (boundary: ParleyStoreFaultBoundary) => void;
}

export interface ManualAdmissionInput {
  parley: Omit<ParleyRecord, 'createdAt' | 'responseDueAt'>;
  /** Bounded duration; null means no response deadline. */
  responseTtlMs: number | null;
  participants: StoredParleyParticipant[];
  notifications: (record: ParleyRecord) => ParleyNotificationIntent[];
}

interface RecordRow {
  tenant_id: string;
  harbor: string;
  parley_id: string;
  surface: string;
  reason: string;
  called_by: string;
  trigger: string;
  channel: string;
  status: string;
  response_due_at: number | null;
  round_limit: number;
  created_at: number;
  updated_at: number;
  retention_until: number;
  automatic_signal_id: string | null;
  automatic_call_fingerprint: string | null;
  automatic_lineage_key: string | null;
  automatic_checkpoint: string | null;
  automatic_kind: string | null;
  automatic_shape: string | null;
  automatic_evidence_json: string | null;
  automatic_confidence: number | null;
  automatic_magnitude: number | null;
  automatic_origin: string | null;
}

interface ParticipantRow {
  ordinal: number;
  actor_id: string;
  inbox_target: string | null;
  session_id: string | null;
  lineage_root_session_id: string | null;
  summoned: number;
  caller: number;
}

interface TurnRow {
  turn_sequence: number;
  party: string;
  idempotency_key: string;
  intent_fingerprint: string;
  performative: string;
  content: string;
  proposal_id: string | null;
  evidence_json: string;
  delivery_keys_json: string;
  at: number;
}

interface OutcomeRow {
  status: string;
  decision: string | null;
  reason: string | null;
  resolved_by: string;
  dissenters_json: string;
  at: number;
}

interface SignalRow {
  signal_fingerprint: string;
  canonical_signal_json: string;
  lineage_key: string;
  producer_id: string;
  checkpoint: string;
  producer_event_key: string;
  produced_at: number;
  created_at: number;
  expires_at: number;
}

interface ReceiptRow {
  terminal_state: string;
  parley_id: string | null;
  decision_json: string;
  reason: string;
  created_at: number;
}

interface LineageRow {
  owner_signal_id: string;
  owner_parley_id: string | null;
  state: string;
  reserved_at: number;
  cooldown_ms: number;
  cooldown_until: number;
}

interface OutboxRow {
  id: number;
  delivery_key: string;
  recipient_actor_id: string;
  inbox_target: string;
  from_actor_id: string;
  event_type: string;
  payload_json: string;
  payload_hash: string;
  attempts: number;
  lease_token: string | null;
}

/** Raw v3.30.2 tuple row. It is intentionally read directly, never through TupleSpace. */
interface LegacyTupleRow {
  id: number;
  harbor: string;
  fields: string;
  written_by: string | null;
  created_at: number;
  expires_at: number | null;
}

interface LegacyOpenedParley {
  tuple: LegacyTupleRow;
  record: ParleyRecord;
  participants: StoredParleyParticipant[];
}

interface LegacyParleyTurn {
  tuple: LegacyTupleRow;
  turn: ParleyTurn;
}

interface LegacySeenFrontier {
  tuple: LegacyTupleRow;
  party: string;
  throughAt: number;
  at: number;
}

interface LegacyParleyOutcome {
  tuple: LegacyTupleRow;
  outcome: ParleyOutcome;
}

interface LegacyParleyImportSource extends LegacyOpenedParley {
  turns: LegacyParleyTurn[];
  seenFrontiers: LegacySeenFrontier[];
  outcome: LegacyParleyOutcome | null;
}

interface LegacyMigrationReceiptRow {
  migration_version: string;
  source_digest: string;
  source_tuple_rows: number;
  source_opened_rows: number;
  source_turn_rows: number;
  source_seen_rows: number;
  source_seen_frontiers: number;
  source_outcome_rows: number;
  imported_records: number;
  imported_turns: number;
  imported_seen_receipts: number;
  imported_seen_provenance: number;
  imported_outcomes: number;
  completed_at: number;
}

const TERMINAL_STATUSES: ReadonlySet<ParleyStatus> = new Set(['COLLAPSED', 'ESCALATED', 'VOIDED']);
const PERFORMATIVES: ReadonlySet<ParleyPerformative> = new Set([
  'propose', 'critique', 'revise', 'agree', 'refuse', 'inform',
]);
const BUDGETED_PERFORMATIVES: ReadonlySet<ParleyPerformative> = new Set([
  'propose', 'critique', 'revise', 'inform',
]);

type QuotaCounter = 'retained_records' | 'retained_signals' | 'retained_turns' | 'retained_outbox';
const OUTBOX_QUOTA_RESERVE_BYTES = 128 + 4_096;

/**
 * Build the SQLite expression used to charge immutable payload bytes.
 *
 * The purpose is a deterministic, restart-reconcilable upper ledger rather
 * than a page-count estimate: UTF-8 text bytes plus a fixed row/storage reserve.
 * Outbox rows additionally reserve the maximum mutable delivery error so retry
 * bookkeeping cannot grow outside the charged amount.
 */
function accountedBytesSql(
  alias: 'NEW' | 'OLD' | 'q',
  columns: readonly string[],
  reserveBytes = 128,
): string {
  return `(${reserveBytes} + ${columns.map((column) => (
    `length(CAST(COALESCE(${alias}.${column}, '') AS BLOB))`
  )).join(' + ')})`;
}

const QUOTA_TABLES = Object.freeze([
  {
    table: 'parley_records',
    trigger: 'records',
    counter: 'retained_records' as const,
    perHarborMaximum: PARLEY_STORE_LIMITS.maxRetainedRecordsPerHarbor,
    tenantMaximum: PARLEY_STORE_LIMITS.maxRetainedRecordsPerTenant,
    columns: [
      'tenant_id', 'harbor', 'parley_id', 'surface', 'reason', 'called_by',
      'trigger', 'channel', 'automatic_signal_id', 'automatic_call_fingerprint',
      'automatic_lineage_key', 'automatic_checkpoint', 'automatic_kind',
      'automatic_shape', 'automatic_evidence_json', 'automatic_origin',
    ],
    reserveBytes: 128,
  },
  {
    table: 'parley_auto_signals',
    trigger: 'signals',
    counter: 'retained_signals' as const,
    perHarborMaximum: PARLEY_STORE_LIMITS.maxRetainedSignalsPerHarbor,
    tenantMaximum: PARLEY_STORE_LIMITS.maxRetainedSignalsPerTenant,
    columns: [
      'tenant_id', 'harbor', 'signal_id', 'signal_fingerprint',
      'canonical_signal_json', 'lineage_key', 'producer_id', 'checkpoint',
      'producer_event_key',
    ],
    reserveBytes: 128,
  },
  {
    table: 'parley_turns',
    trigger: 'turns',
    counter: 'retained_turns' as const,
    perHarborMaximum: PARLEY_STORE_LIMITS.maxRetainedTurnsPerHarbor,
    tenantMaximum: PARLEY_STORE_LIMITS.maxRetainedTurnsPerTenant,
    columns: [
      'tenant_id', 'harbor', 'parley_id', 'party', 'idempotency_key',
      'intent_fingerprint', 'performative', 'content', 'proposal_id',
      'evidence_json', 'delivery_keys_json',
    ],
    reserveBytes: 128,
  },
  {
    table: 'parley_notification_outbox',
    trigger: 'outbox',
    counter: 'retained_outbox' as const,
    perHarborMaximum: PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor,
    tenantMaximum: PARLEY_STORE_LIMITS.maxRetainedOutboxPerTenant,
    columns: [
      'tenant_id', 'harbor', 'parley_id', 'delivery_key',
      'recipient_actor_id', 'inbox_target', 'from_actor_id', 'event_type',
      'payload_json', 'payload_hash',
    ],
    reserveBytes: OUTBOX_QUOTA_RESERVE_BYTES,
  },
] as const);

function quotaTriggerSql(spec: (typeof QUOTA_TABLES)[number]): string {
  const newBytes = accountedBytesSql('NEW', spec.columns, spec.reserveBytes);
  const oldBytes = accountedBytesSql('OLD', spec.columns, spec.reserveBytes);
  const label = spec.counter.replaceAll('_', '-');
  const harborEmpty = `(
    retained_records = 0 AND retained_signals = 0
    AND retained_turns = 0 AND retained_outbox = 0
  )`;
  return `
  CREATE TRIGGER trg_parley_${spec.trigger}_quota_insert
  AFTER INSERT ON ${spec.table}
  BEGIN
    INSERT INTO parley_tenant_quota_ledger (tenant_id)
    VALUES (NEW.tenant_id)
    ON CONFLICT(tenant_id) DO NOTHING;
    INSERT INTO parley_quota_ledger (tenant_id, harbor)
    VALUES (NEW.tenant_id, NEW.harbor)
    ON CONFLICT(tenant_id, harbor) DO NOTHING;
    SELECT CASE WHEN (
      SELECT ${spec.counter} FROM parley_quota_ledger
      WHERE tenant_id = NEW.tenant_id AND harbor = NEW.harbor
    ) >= ${spec.perHarborMaximum}
      THEN RAISE(ABORT, 'parley ${label} per-harbor quota reached') END;
    SELECT CASE WHEN (
      SELECT ${spec.counter} FROM parley_tenant_quota_ledger
      WHERE tenant_id = NEW.tenant_id
    ) >= ${spec.tenantMaximum}
      THEN RAISE(ABORT, 'parley ${label} tenant quota reached') END;
    SELECT CASE WHEN (
      SELECT retained_rows FROM parley_tenant_quota_ledger
      WHERE tenant_id = NEW.tenant_id
    ) >= ${PARLEY_STORE_LIMITS.maxRetainedRowsPerTenant}
      THEN RAISE(ABORT, 'parley retained-row tenant quota reached') END;
    SELECT CASE WHEN (
      SELECT retained_bytes FROM parley_tenant_quota_ledger
      WHERE tenant_id = NEW.tenant_id
    ) + ${newBytes} > ${PARLEY_STORE_LIMITS.maxRetainedBytesPerTenant}
      THEN RAISE(ABORT, 'parley retained-byte tenant quota reached') END;
    SELECT CASE WHEN (
      SELECT ${harborEmpty} FROM parley_quota_ledger
      WHERE tenant_id = NEW.tenant_id AND harbor = NEW.harbor
    ) AND (
      SELECT harbor_count FROM parley_tenant_quota_ledger
      WHERE tenant_id = NEW.tenant_id
    ) >= ${PARLEY_STORE_LIMITS.maxHarborsPerTenant}
      THEN RAISE(ABORT, 'parley active-harbor tenant quota reached') END;
    UPDATE parley_tenant_quota_ledger
    SET harbor_count = harbor_count + CASE WHEN (
          SELECT ${harborEmpty} FROM parley_quota_ledger
          WHERE tenant_id = NEW.tenant_id AND harbor = NEW.harbor
        ) THEN 1 ELSE 0 END,
        ${spec.counter} = ${spec.counter} + 1,
        retained_rows = retained_rows + 1,
        retained_bytes = retained_bytes + ${newBytes}
    WHERE tenant_id = NEW.tenant_id;
    UPDATE parley_quota_ledger
    SET ${spec.counter} = ${spec.counter} + 1
    WHERE tenant_id = NEW.tenant_id AND harbor = NEW.harbor;
  END;

  CREATE TRIGGER trg_parley_${spec.trigger}_quota_delete
  BEFORE DELETE ON ${spec.table}
  BEGIN
    SELECT CASE WHEN COALESCE((
      SELECT ${spec.counter} FROM parley_quota_ledger
      WHERE tenant_id = OLD.tenant_id AND harbor = OLD.harbor
    ), 0) < 1 THEN RAISE(ABORT, 'parley ${label} quota ledger underflow') END;
    SELECT CASE WHEN COALESCE((
      SELECT ${spec.counter} FROM parley_tenant_quota_ledger
      WHERE tenant_id = OLD.tenant_id
    ), 0) < 1 THEN RAISE(ABORT, 'parley ${label} tenant ledger underflow') END;
    SELECT CASE WHEN COALESCE((
      SELECT retained_rows FROM parley_tenant_quota_ledger
      WHERE tenant_id = OLD.tenant_id
    ), 0) < 1 THEN RAISE(ABORT, 'parley retained-row tenant ledger underflow') END;
    SELECT CASE WHEN COALESCE((
      SELECT retained_bytes FROM parley_tenant_quota_ledger
      WHERE tenant_id = OLD.tenant_id
    ), 0) < ${oldBytes}
      THEN RAISE(ABORT, 'parley retained-byte tenant ledger underflow') END;
    UPDATE parley_quota_ledger
    SET ${spec.counter} = ${spec.counter} - 1
    WHERE tenant_id = OLD.tenant_id AND harbor = OLD.harbor;
    UPDATE parley_tenant_quota_ledger
    SET harbor_count = harbor_count - CASE WHEN (
          SELECT ${harborEmpty} FROM parley_quota_ledger
          WHERE tenant_id = OLD.tenant_id AND harbor = OLD.harbor
        ) THEN 1 ELSE 0 END,
        ${spec.counter} = ${spec.counter} - 1,
        retained_rows = retained_rows - 1,
        retained_bytes = retained_bytes - ${oldBytes}
    WHERE tenant_id = OLD.tenant_id;
    DELETE FROM parley_quota_ledger
    WHERE tenant_id = OLD.tenant_id AND harbor = OLD.harbor
      AND ${harborEmpty};
  END;
  `;
}

const SCHEMA = `
  DROP TRIGGER IF EXISTS trg_parley_records_quota_insert;
  DROP TRIGGER IF EXISTS trg_parley_records_quota_delete;
  DROP TRIGGER IF EXISTS trg_parley_signals_quota_insert;
  DROP TRIGGER IF EXISTS trg_parley_signals_quota_delete;
  DROP TRIGGER IF EXISTS trg_parley_turns_quota_insert;
  DROP TRIGGER IF EXISTS trg_parley_turns_quota_delete;
  DROP TRIGGER IF EXISTS trg_parley_outbox_quota_insert;
  DROP TRIGGER IF EXISTS trg_parley_outbox_quota_delete;

  CREATE TABLE IF NOT EXISTS parley_tenant_quota_ledger (
    tenant_id TEXT PRIMARY KEY CHECK(length(tenant_id) BETWEEN 1 AND 128),
    harbor_count INTEGER NOT NULL DEFAULT 0
      CHECK(harbor_count BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxHarborsPerTenant}),
    retained_records INTEGER NOT NULL DEFAULT 0
      CHECK(retained_records BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedRecordsPerTenant}),
    retained_signals INTEGER NOT NULL DEFAULT 0
      CHECK(retained_signals BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedSignalsPerTenant}),
    retained_turns INTEGER NOT NULL DEFAULT 0
      CHECK(retained_turns BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedTurnsPerTenant}),
    retained_outbox INTEGER NOT NULL DEFAULT 0
      CHECK(retained_outbox BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedOutboxPerTenant}),
    retained_rows INTEGER NOT NULL DEFAULT 0
      CHECK(retained_rows BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedRowsPerTenant}),
    retained_bytes INTEGER NOT NULL DEFAULT 0
      CHECK(retained_bytes BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedBytesPerTenant})
  );

  CREATE TABLE IF NOT EXISTS parley_quota_ledger (
    tenant_id TEXT NOT NULL CHECK(length(tenant_id) BETWEEN 1 AND 128),
    harbor TEXT NOT NULL CHECK(length(harbor) BETWEEN 1 AND 128),
    retained_records INTEGER NOT NULL DEFAULT 0
      CHECK(retained_records BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedRecordsPerHarbor}),
    retained_signals INTEGER NOT NULL DEFAULT 0
      CHECK(retained_signals BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedSignalsPerHarbor}),
    retained_turns INTEGER NOT NULL DEFAULT 0
      CHECK(retained_turns BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedTurnsPerHarbor}),
    retained_outbox INTEGER NOT NULL DEFAULT 0
      CHECK(retained_outbox BETWEEN 0 AND ${PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor}),
    PRIMARY KEY (tenant_id, harbor)
  );

  CREATE TABLE IF NOT EXISTS parley_auto_signals (
    tenant_id TEXT NOT NULL CHECK(length(tenant_id) BETWEEN 1 AND 128),
    harbor TEXT NOT NULL CHECK(length(harbor) BETWEEN 1 AND 128),
    signal_id TEXT NOT NULL CHECK(length(signal_id) BETWEEN 1 AND 128),
    signal_fingerprint TEXT NOT NULL CHECK(length(signal_fingerprint) = 64),
    canonical_signal_json TEXT NOT NULL,
    lineage_key TEXT NOT NULL CHECK(length(lineage_key) BETWEEN 1 AND 192),
    producer_id TEXT NOT NULL CHECK(length(producer_id) BETWEEN 1 AND 128),
    checkpoint TEXT NOT NULL CHECK(checkpoint IN ('conversation','claim','session_begin','session_takeover','continuation_accept','quorum_vote','guard_receipt')),
    producer_event_key TEXT NOT NULL CHECK(length(producer_event_key) = 64),
    produced_at INTEGER NOT NULL CHECK(produced_at > 0),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL CHECK(expires_at >= created_at),
    PRIMARY KEY (tenant_id, harbor, signal_id),
    UNIQUE (tenant_id, harbor, producer_event_key)
  );

  CREATE INDEX IF NOT EXISTS idx_parley_signals_retention
    ON parley_auto_signals(tenant_id, harbor, expires_at, signal_id);

  CREATE TABLE IF NOT EXISTS parley_records (
    tenant_id TEXT NOT NULL CHECK(length(tenant_id) BETWEEN 1 AND 128),
    harbor TEXT NOT NULL CHECK(length(harbor) BETWEEN 1 AND 128),
    parley_id TEXT NOT NULL CHECK(length(parley_id) BETWEEN 1 AND 192),
    surface TEXT NOT NULL CHECK(length(surface) BETWEEN 1 AND 1024),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2048),
    called_by TEXT NOT NULL CHECK(length(called_by) BETWEEN 1 AND 128),
    trigger TEXT NOT NULL CHECK(trigger IN ('operator','claim_overlap','detector','swarm_fit')),
    channel TEXT NOT NULL CHECK(length(channel) BETWEEN 1 AND 256),
    status TEXT NOT NULL CHECK(status IN ('SUMMONED','CONVENED','COLLAPSED','ESCALATED','VOIDED')),
    response_due_at INTEGER,
    round_limit INTEGER NOT NULL CHECK(round_limit BETWEEN 1 AND 64),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    retention_until INTEGER NOT NULL CHECK(retention_until >= created_at),
    automatic_signal_id TEXT,
    automatic_call_fingerprint TEXT,
    automatic_lineage_key TEXT,
    automatic_checkpoint TEXT,
    automatic_kind TEXT,
    automatic_shape TEXT,
    automatic_evidence_json TEXT,
    automatic_confidence REAL,
    automatic_magnitude REAL,
    automatic_origin TEXT CHECK(automatic_origin IS NULL OR automatic_origin IN ('sugar-parley')),
    PRIMARY KEY (tenant_id, harbor, parley_id),
    UNIQUE (tenant_id, harbor, automatic_signal_id),
    FOREIGN KEY (tenant_id, harbor, automatic_signal_id)
      REFERENCES parley_auto_signals(tenant_id, harbor, signal_id)
      ON DELETE RESTRICT,
    CHECK (
      (automatic_signal_id IS NULL
        AND automatic_call_fingerprint IS NULL
        AND automatic_lineage_key IS NULL
        AND automatic_checkpoint IS NULL
        AND automatic_kind IS NULL
        AND automatic_shape IS NULL
        AND automatic_evidence_json IS NULL
        AND automatic_confidence IS NULL
        AND automatic_magnitude IS NULL
        AND automatic_origin IS NULL)
      OR
      (automatic_signal_id IS NOT NULL
        AND length(automatic_call_fingerprint) = 64
        AND automatic_lineage_key IS NOT NULL
        AND automatic_checkpoint IS NOT NULL
        AND automatic_kind IS NOT NULL
        AND automatic_shape IS NOT NULL
        AND automatic_evidence_json IS NOT NULL
        AND automatic_confidence BETWEEN 0 AND 1
        AND automatic_magnitude >= 0)
    )
  );

  CREATE INDEX IF NOT EXISTS idx_parley_records_status
    ON parley_records(tenant_id, harbor, status, created_at DESC, parley_id DESC);
  CREATE INDEX IF NOT EXISTS idx_parley_records_surface
    ON parley_records(tenant_id, harbor, surface, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_parley_records_retention
    ON parley_records(tenant_id, harbor, retention_until, parley_id);

  CREATE TABLE IF NOT EXISTS parley_participants (
    tenant_id TEXT NOT NULL,
    harbor TEXT NOT NULL,
    parley_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 32),
    actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 128),
    inbox_target TEXT CHECK(inbox_target IS NULL OR length(inbox_target) BETWEEN 1 AND 128),
    session_id TEXT CHECK(session_id IS NULL OR length(session_id) BETWEEN 1 AND 128),
    lineage_root_session_id TEXT CHECK(lineage_root_session_id IS NULL OR length(lineage_root_session_id) BETWEEN 1 AND 128),
    summoned INTEGER NOT NULL CHECK(summoned IN (0,1)),
    caller INTEGER NOT NULL CHECK(caller IN (0,1)),
    PRIMARY KEY (tenant_id, harbor, parley_id, actor_id),
    UNIQUE (tenant_id, harbor, parley_id, ordinal),
    FOREIGN KEY (tenant_id, harbor, parley_id)
      REFERENCES parley_records(tenant_id, harbor, parley_id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS parley_turns (
    tenant_id TEXT NOT NULL,
    harbor TEXT NOT NULL,
    parley_id TEXT NOT NULL,
    turn_sequence INTEGER NOT NULL CHECK(turn_sequence > 0),
    party TEXT NOT NULL CHECK(length(party) BETWEEN 1 AND 128),
    idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 256),
    intent_fingerprint TEXT NOT NULL CHECK(length(intent_fingerprint) = 64),
    performative TEXT NOT NULL CHECK(performative IN ('propose','critique','revise','agree','refuse','inform')),
    content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 16384),
    proposal_id TEXT CHECK(proposal_id IS NULL OR length(proposal_id) <= 256),
    evidence_json TEXT NOT NULL,
    delivery_keys_json TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, harbor, parley_id, turn_sequence),
    UNIQUE (tenant_id, harbor, parley_id, party, idempotency_key),
    FOREIGN KEY (tenant_id, harbor, parley_id)
      REFERENCES parley_records(tenant_id, harbor, parley_id)
      ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, harbor, parley_id, party)
      REFERENCES parley_participants(tenant_id, harbor, parley_id, actor_id)
      ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_parley_turns_party
    ON parley_turns(tenant_id, harbor, parley_id, party, turn_sequence);
  CREATE INDEX IF NOT EXISTS idx_parley_turns_frontier
    ON parley_turns(tenant_id, harbor, parley_id, at, turn_sequence);

  CREATE TABLE IF NOT EXISTS parley_seen_receipts (
    tenant_id TEXT NOT NULL,
    harbor TEXT NOT NULL,
    parley_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    last_seen_turn_sequence INTEGER NOT NULL CHECK(last_seen_turn_sequence > 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, harbor, parley_id, actor_id),
    FOREIGN KEY (tenant_id, harbor, parley_id, actor_id)
      REFERENCES parley_participants(tenant_id, harbor, parley_id, actor_id)
      ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, harbor, parley_id, last_seen_turn_sequence)
      REFERENCES parley_turns(tenant_id, harbor, parley_id, turn_sequence)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS parley_outcomes (
    tenant_id TEXT NOT NULL,
    harbor TEXT NOT NULL,
    parley_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('COLLAPSED','ESCALATED','VOIDED')),
    decision TEXT,
    reason TEXT,
    resolved_by TEXT NOT NULL CHECK(length(resolved_by) BETWEEN 1 AND 128),
    dissenters_json TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, harbor, parley_id),
    FOREIGN KEY (tenant_id, harbor, parley_id)
      REFERENCES parley_records(tenant_id, harbor, parley_id)
      ON DELETE CASCADE
  );

  /*
   * This is deliberately separate from the per-harbor authority tables: it is
   * an immutable, tenant-scoped audit receipt for the one-way v3.30.2 import.
   * It neither owns nor cascades into the legacy tuple source.
   */
  CREATE TABLE IF NOT EXISTS parley_legacy_tuple_migration_receipts (
    tenant_id TEXT NOT NULL CHECK(length(tenant_id) BETWEEN 1 AND 128),
    migration_version TEXT NOT NULL CHECK(length(migration_version) BETWEEN 1 AND 128),
    source_digest TEXT NOT NULL CHECK(length(source_digest) = 64),
    source_tuple_rows INTEGER NOT NULL CHECK(source_tuple_rows >= 0),
    source_opened_rows INTEGER NOT NULL CHECK(source_opened_rows >= 0),
    source_turn_rows INTEGER NOT NULL CHECK(source_turn_rows >= 0),
    source_seen_rows INTEGER NOT NULL CHECK(source_seen_rows >= 0),
    source_seen_frontiers INTEGER NOT NULL CHECK(source_seen_frontiers >= 0),
    source_outcome_rows INTEGER NOT NULL CHECK(source_outcome_rows >= 0),
    imported_records INTEGER NOT NULL CHECK(imported_records >= 0),
    imported_turns INTEGER NOT NULL CHECK(imported_turns >= 0),
    imported_seen_receipts INTEGER NOT NULL CHECK(imported_seen_receipts >= 0),
    imported_seen_provenance INTEGER NOT NULL CHECK(imported_seen_provenance >= 0),
    imported_outcomes INTEGER NOT NULL CHECK(imported_outcomes >= 0),
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, migration_version)
  );

  /*
   * Store0 remains sequence-authoritative. This additive evidence table keeps
   * the original timestamp watermark verbatim when it falls between turns (or
   * before the first one), where a sequence alone cannot reproduce its exact
   * old API value. It is not a legacy read fallback.
   */
  CREATE TABLE IF NOT EXISTS parley_legacy_tuple_seen_provenance (
    tenant_id TEXT NOT NULL,
    harbor TEXT NOT NULL,
    parley_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    source_tuple_id INTEGER NOT NULL CHECK(source_tuple_id > 0),
    source_through_at INTEGER NOT NULL,
    source_written_at INTEGER NOT NULL,
    source_created_at INTEGER NOT NULL,
    source_written_by TEXT NOT NULL CHECK(length(source_written_by) BETWEEN 1 AND 128),
    normalized_turn_sequence INTEGER NOT NULL CHECK(normalized_turn_sequence >= 0),
    PRIMARY KEY (tenant_id, harbor, parley_id, actor_id),
    UNIQUE (tenant_id, source_tuple_id),
    FOREIGN KEY (tenant_id, harbor, parley_id, actor_id)
      REFERENCES parley_participants(tenant_id, harbor, parley_id, actor_id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS parley_auto_terminal_receipts (
    tenant_id TEXT NOT NULL,
    harbor TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    terminal_state TEXT NOT NULL CHECK(terminal_state IN ('evaluated','fired','suppressed','failed')),
    parley_id TEXT,
    decision_json TEXT NOT NULL,
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 4096),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, harbor, signal_id),
    FOREIGN KEY (tenant_id, harbor, signal_id)
      REFERENCES parley_auto_signals(tenant_id, harbor, signal_id)
      ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, harbor, parley_id)
      REFERENCES parley_records(tenant_id, harbor, parley_id)
      ON DELETE CASCADE,
    CHECK (
      (terminal_state = 'fired' AND parley_id IS NOT NULL)
      OR (terminal_state <> 'fired' AND parley_id IS NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS parley_lineage_cooldowns (
    tenant_id TEXT NOT NULL,
    harbor TEXT NOT NULL,
    lineage_key TEXT NOT NULL CHECK(length(lineage_key) BETWEEN 1 AND 192),
    owner_signal_id TEXT NOT NULL,
    owner_parley_id TEXT,
    state TEXT NOT NULL CHECK(state IN ('active','cooldown')),
    reserved_at INTEGER NOT NULL,
    cooldown_ms INTEGER NOT NULL CHECK(cooldown_ms BETWEEN 1 AND ${PARLEY_STORE_LIMITS.maxTtlMs}),
    cooldown_until INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, harbor, lineage_key),
    FOREIGN KEY (tenant_id, harbor, owner_signal_id)
      REFERENCES parley_auto_signals(tenant_id, harbor, signal_id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_parley_lineage_owner
    ON parley_lineage_cooldowns(tenant_id, harbor, owner_signal_id);

  CREATE TABLE IF NOT EXISTS parley_admissions (
    tenant_id TEXT NOT NULL,
    harbor TEXT NOT NULL,
    dimension TEXT NOT NULL CHECK(length(dimension) BETWEEN 1 AND 96),
    slot INTEGER NOT NULL CHECK(slot >= 0),
    signal_id TEXT NOT NULL,
    parley_id TEXT NOT NULL,
    reserved_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, harbor, dimension, slot),
    UNIQUE (tenant_id, harbor, dimension, signal_id),
    FOREIGN KEY (tenant_id, harbor, signal_id)
      REFERENCES parley_auto_signals(tenant_id, harbor, signal_id)
      ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, harbor, parley_id)
      REFERENCES parley_records(tenant_id, harbor, parley_id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_parley_admissions_signal
    ON parley_admissions(tenant_id, harbor, signal_id);

  CREATE TABLE IF NOT EXISTS parley_notification_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL CHECK(length(tenant_id) BETWEEN 1 AND 128),
    harbor TEXT NOT NULL CHECK(length(harbor) BETWEEN 1 AND 128),
    parley_id TEXT NOT NULL,
    delivery_key TEXT NOT NULL CHECK(length(delivery_key) BETWEEN 1 AND 512),
    recipient_actor_id TEXT NOT NULL CHECK(length(recipient_actor_id) BETWEEN 1 AND 128),
    inbox_target TEXT NOT NULL CHECK(length(inbox_target) BETWEEN 1 AND 128),
    from_actor_id TEXT NOT NULL CHECK(length(from_actor_id) BETWEEN 1 AND 128),
    event_type TEXT NOT NULL CHECK(event_type IN ('parley_summons','parley_turn','parley_escalation')),
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
    state TEXT NOT NULL CHECK(state IN ('pending','leased','delivered','dead')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
    available_at INTEGER NOT NULL,
    lease_until INTEGER,
    lease_token TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER,
    UNIQUE (tenant_id, harbor, delivery_key),
    FOREIGN KEY (tenant_id, harbor, parley_id)
      REFERENCES parley_records(tenant_id, harbor, parley_id)
      ON DELETE CASCADE,
    CHECK (
      (state = 'leased' AND lease_until IS NOT NULL AND lease_token IS NOT NULL)
      OR (state <> 'leased' AND lease_until IS NULL AND lease_token IS NULL)
    )
  );

  CREATE INDEX IF NOT EXISTS idx_parley_outbox_ready
    ON parley_notification_outbox(tenant_id, harbor, state, available_at, id);
  CREATE INDEX IF NOT EXISTS idx_parley_outbox_tenant_due
    ON parley_notification_outbox(tenant_id, state, available_at, lease_until, harbor, id);
  CREATE INDEX IF NOT EXISTS idx_parley_outbox_retention
    ON parley_notification_outbox(tenant_id, harbor, delivered_at, id);

  CREATE TABLE IF NOT EXISTS parley_notification_overflow_receipts (
    tenant_id TEXT NOT NULL,
    harbor TEXT NOT NULL,
    parley_id TEXT NOT NULL,
    dropped_intents INTEGER NOT NULL
      CHECK(dropped_intents BETWEEN 1 AND ${PARLEY_STORE_LIMITS.maxOverflowIntentsPerParley}),
    batch_count INTEGER NOT NULL CHECK(batch_count BETWEEN 1 AND 4),
    saw_turn INTEGER NOT NULL CHECK(saw_turn IN (0,1)),
    saw_escalation INTEGER NOT NULL CHECK(saw_escalation IN (0,1)),
    evidence_hash TEXT NOT NULL CHECK(length(evidence_hash) = 64),
    first_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL CHECK(last_at >= first_at),
    last_error TEXT NOT NULL CHECK(length(last_error) BETWEEN 1 AND 4096),
    PRIMARY KEY (tenant_id, harbor, parley_id),
    FOREIGN KEY (tenant_id, harbor, parley_id)
      REFERENCES parley_records(tenant_id, harbor, parley_id)
      ON DELETE CASCADE
  );

  ${QUOTA_TABLES.map(quotaTriggerSql).join('\n')}
`;

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function json(value: unknown): string {
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
  const encoded = JSON.stringify(normalize(value));
  if (typeof encoded !== 'string') throw new Error('value is not JSON-serializable');
  return encoded;
}

/** Stable cooldown lineage deliberately excludes evidence references. */
export function parleySignalLineageKey(signal: Pick<
  ConflictSignal,
  'checkpoint' | 'kind' | 'surface' | 'parties'
>): string {
  const parties = [...new Set(signal.parties.map((party) => party.trim()))].sort();
  return `parley-lineage:v1:${hash(json([
    signal.checkpoint,
    signal.kind,
    signal.surface.trim(),
    parties,
  ]))}`;
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`parley store poisoned row: invalid ${label}`);
  }
}

function decodeParleyDecision(raw: string, expectedSignalId: string): ParleyDecision {
  const value = parseJson<unknown>(raw, 'automatic terminal decision JSON');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('parley store poisoned row: automatic terminal decision must be an object');
  }
  const decision = value as Record<string, unknown>;
  const checkpoint = decision.checkpoint;
  const shape = decision.shape;
  if (typeof decision.convene !== 'boolean'
    || (checkpoint !== null && !(PARLEY_CHECKPOINTS as readonly unknown[]).includes(checkpoint))
    || decision.signalId !== expectedSignalId
    || typeof decision.policyCleared !== 'boolean'
    || !Number.isSafeInteger(decision.unresolved)
    || (decision.unresolved as number) < 0
    || typeof decision.expectedWaste !== 'number'
    || !Number.isFinite(decision.expectedWaste)
    || (decision.expectedWaste as number) < 0
    || typeof decision.margin !== 'number'
    || !Number.isFinite(decision.margin)
    || (decision.terminated !== null
      && decision.terminated !== 'max-rounds'
      && decision.terminated !== 'delegation-depth')
    || typeof decision.reason !== 'string'
    || !decision.reason
    || decision.reason !== decision.reason.trim()
    || decision.reason.length > 4_096
    || (shape !== undefined && !(PARLEY_SHAPES as readonly unknown[]).includes(shape))) {
    throw new Error('parley store poisoned row: automatic terminal decision is invalid');
  }
  return decision as unknown as ParleyDecision;
}

function assertCanonicalString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty canonical string`);
  }
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return value;
}

function assertFiniteTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer timestamp`);
  return value;
}

function canonicalStrings(values: readonly string[], label: string, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(values) || values.length > maxItems) {
    throw new Error(`${label} exceeds ${maxItems} items`);
  }
  const result = [...new Set(values.map((value) => assertCanonicalString(value, label, maxChars)))].sort();
  return result;
}

function isTerminalStatus(value: string): value is Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'> {
  return value === 'COLLAPSED' || value === 'ESCALATED' || value === 'VOIDED';
}

/* LEGACY_PARLEY_TUPLE_IMPORTER_BEGIN */
/**
 * The only Store0 code allowed to name legacy tuple vocabulary. This bounded,
 * one-way importer reads source rows once; the returned Store0 APIs never
 * consult tuples as a fallback.
 */
/** Parse and validate a raw tuple row before it can influence Store0 authority. */
function assertLegacyTupleRow(row: LegacyTupleRow, label: string): void {
  if (!Number.isSafeInteger(row.id) || row.id < 1) {
    throw new Error(`${label}: tuple id is invalid`);
  }
  assertCanonicalString(row.harbor, `${label}: tuple harbor`, PARLEY_STORE_LIMITS.maxHarborChars);
  assertFiniteTimestamp(row.created_at, `${label}: tuple created_at`);
  if (row.expires_at !== null) assertFiniteTimestamp(row.expires_at, `${label}: tuple expires_at`);
  if (row.written_by !== null) {
    assertCanonicalString(row.written_by, `${label}: tuple written_by`, PARLEY_STORE_LIMITS.maxActorChars);
  }
  if (typeof row.fields !== 'string' || !row.fields) {
    throw new Error(`${label}: tuple fields are invalid`);
  }
}

/** Decode one exact v3.30.2 tuple shape; unrelated tuple kinds are never parsed. */
function legacyFields(row: LegacyTupleRow, kind: string, length: number): unknown[] {
  assertLegacyTupleRow(row, `legacy ${kind}`);
  const fields = parseJson<unknown>(row.fields, `legacy ${kind} tuple fields`);
  if (!Array.isArray(fields) || fields.length !== length || fields[0] !== kind) {
    throw new Error(`legacy ${kind}: tuple shape is invalid`);
  }
  return fields;
}

function legacyObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function legacyNullableString(value: unknown, label: string, max: number): string | null {
  return value === null ? null : assertCanonicalString(value, label, max);
}

function legacyStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return canonicalStrings(value as string[], label, maxItems, maxChars);
}

/** Decode a manual v3.30.2 `parley:opened` tuple without admitting automatic authority. */
function decodeLegacyOpenedTuple(row: LegacyTupleRow): LegacyOpenedParley {
  const fields = legacyFields(row, 'parley:opened', 3);
  const parleyId = assertCanonicalString(fields[1], 'legacy opened parley id', PARLEY_STORE_LIMITS.maxParleyIdChars);
  const source = legacyObject(fields[2], 'legacy opened record');
  if (source.parleyId !== parleyId) {
    throw new Error(`legacy opened ${parleyId}: record id disagrees with tuple`);
  }
  if (source.harbor !== row.harbor) {
    throw new Error(`legacy opened ${parleyId}: record harbor disagrees with tuple`);
  }
  if (source.status !== 'SUMMONED') {
    throw new Error(`legacy opened ${parleyId}: stored status must be SUMMONED`);
  }
  // v3.30.2 predated Store0's automatic metadata, so an absent field is the
  // authoritative manual legacy shape. Anything other than absent/null would
  // be an automatic authority that must remain governed by Store0 signals.
  if (source.automatic !== undefined && source.automatic !== null) {
    throw new Error(
      `legacy opened ${parleyId}: automatic Parleys require their Store0 signal authority and cannot be imported`,
    );
  }
  if (source.trigger !== 'operator'
    && source.trigger !== 'claim_overlap'
    && source.trigger !== 'detector'
    && source.trigger !== 'swarm_fit') {
    throw new Error(`legacy opened ${parleyId}: trigger is invalid`);
  }
  if (!Array.isArray(source.parties)) {
    throw new Error(`legacy opened ${parleyId}: parties are invalid`);
  }
  const parties = source.parties.map((party) => assertCanonicalString(
    party,
    `legacy opened ${parleyId}: party`,
    PARLEY_STORE_LIMITS.maxActorChars,
  ));
  if (parties.length < 2 || parties.length > PARLEY_STORE_LIMITS.maxParticipants) {
    throw new Error(`legacy opened ${parleyId}: parties exceed Store0 bounds`);
  }
  if (new Set(parties).size !== parties.length) {
    throw new Error(`legacy opened ${parleyId}: parties must be unique`);
  }
  const responseDueAt = source.responseDueAt === null
    ? null
    : assertFiniteTimestamp(source.responseDueAt as number, `legacy opened ${parleyId}: responseDueAt`);
  const record: ParleyRecord = {
    parleyId,
    surface: assertCanonicalString(source.surface, `legacy opened ${parleyId}: surface`, CONFLICT_SIGNAL_LIMITS.maxSurfaceChars),
    reason: assertCanonicalString(source.reason, `legacy opened ${parleyId}: reason`, CONFLICT_SIGNAL_LIMITS.maxReasonChars),
    parties,
    calledBy: assertCanonicalString(source.calledBy, `legacy opened ${parleyId}: calledBy`, PARLEY_STORE_LIMITS.maxActorChars),
    trigger: source.trigger,
    channel: assertCanonicalString(source.channel, `legacy opened ${parleyId}: channel`, PARLEY_STORE_LIMITS.maxChannelChars),
    status: 'SUMMONED',
    harbor: row.harbor,
    responseDueAt,
    roundLimit: source.roundLimit as number,
    createdAt: assertFiniteTimestamp(source.createdAt as number, `legacy opened ${parleyId}: createdAt`),
    automatic: null,
  };
  if (!Number.isInteger(record.roundLimit)) {
    throw new Error(`legacy opened ${parleyId}: roundLimit is invalid`);
  }
  if (row.written_by !== record.calledBy) {
    throw new Error(`legacy opened ${parleyId}: tuple writer is not the caller`);
  }
  const participants: StoredParleyParticipant[] = parties.map((party) => ({
    actorId: party,
    inboxTarget: party,
    sessionId: null,
    lineageRootSessionId: null,
    summoned: true,
    caller: party === record.calledBy,
  }));
  if (!participants.some((participant) => participant.caller)) {
    participants.push({
      actorId: record.calledBy,
      inboxTarget: record.calledBy,
      sessionId: null,
      lineageRootSessionId: null,
      summoned: false,
      caller: true,
    });
  }
  return { tuple: row, record, participants };
}

/** Decode one exact v3.30.2 turn and bind it to the opened manual authority. */
function decodeLegacyTurnTuple(row: LegacyTupleRow, opened: LegacyOpenedParley): LegacyParleyTurn {
  const fields = legacyFields(row, 'parley:turn', 4);
  const parleyId = assertCanonicalString(fields[1], 'legacy turn parley id', PARLEY_STORE_LIMITS.maxParleyIdChars);
  const party = assertCanonicalString(fields[2], 'legacy turn party', PARLEY_STORE_LIMITS.maxActorChars);
  if (parleyId !== opened.record.parleyId || row.harbor !== opened.record.harbor) {
    throw new Error(`legacy turn ${row.id}: scope does not match opened Parley`);
  }
  if (!opened.record.parties.includes(party)) {
    throw new Error(`legacy turn ${row.id}: writer was not a summoned party`);
  }
  if (row.written_by !== party) {
    throw new Error(`legacy turn ${row.id}: tuple writer is not its party`);
  }
  const source = legacyObject(fields[3], `legacy turn ${row.id}`);
  if (source.parleyId !== parleyId || source.party !== party) {
    throw new Error(`legacy turn ${row.id}: payload identity disagrees with tuple`);
  }
  if (typeof source.performative !== 'string' || !PERFORMATIVES.has(source.performative as ParleyPerformative)) {
    throw new Error(`legacy turn ${row.id}: performative is invalid`);
  }
  const turn: ParleyTurn = {
    parleyId,
    party,
    performative: source.performative as ParleyPerformative,
    content: assertCanonicalString(source.content, `legacy turn ${row.id}: content`, PARLEY_STORE_LIMITS.maxTurnContentChars),
    proposalId: legacyNullableString(source.proposalId, `legacy turn ${row.id}: proposalId`, PARLEY_STORE_LIMITS.maxProposalIdChars),
    evidenceRefs: legacyStringArray(
      source.evidenceRefs,
      `legacy turn ${row.id}: evidenceRefs`,
      CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs,
      CONFLICT_SIGNAL_LIMITS.maxEvidenceRefChars,
    ),
    at: assertFiniteTimestamp(source.at as number, `legacy turn ${row.id}: at`),
  };
  return { tuple: row, turn };
}

/** Decode one exact v3.30.2 seen tuple; timestamp frontiers normalize to Store0 sequences later. */
function decodeLegacySeenTuple(row: LegacyTupleRow, opened: LegacyOpenedParley): LegacySeenFrontier {
  const fields = legacyFields(row, 'parley:seen', 4);
  const parleyId = assertCanonicalString(fields[1], 'legacy seen parley id', PARLEY_STORE_LIMITS.maxParleyIdChars);
  const party = assertCanonicalString(fields[2], 'legacy seen party', PARLEY_STORE_LIMITS.maxActorChars);
  if (parleyId !== opened.record.parleyId || row.harbor !== opened.record.harbor) {
    throw new Error(`legacy seen ${row.id}: scope does not match opened Parley`);
  }
  if (!opened.participants.some((participant) => participant.actorId === party)) {
    throw new Error(`legacy seen ${row.id}: party is not a participant`);
  }
  if (row.written_by !== party) {
    throw new Error(`legacy seen ${row.id}: tuple writer is not its party`);
  }
  const source = legacyObject(fields[3], `legacy seen ${row.id}`);
  return {
    tuple: row,
    party,
    throughAt: assertFiniteTimestamp(source.throughAt as number, `legacy seen ${row.id}: throughAt`),
    at: assertFiniteTimestamp(source.at as number, `legacy seen ${row.id}: at`),
  };
}

/** Decode one exact v3.30.2 terminal outcome and preserve its original terminal authority. */
function decodeLegacyOutcomeTuple(row: LegacyTupleRow, opened: LegacyOpenedParley): LegacyParleyOutcome {
  const fields = legacyFields(row, 'parley:outcome', 3);
  const parleyId = assertCanonicalString(fields[1], 'legacy outcome parley id', PARLEY_STORE_LIMITS.maxParleyIdChars);
  if (parleyId !== opened.record.parleyId || row.harbor !== opened.record.harbor) {
    throw new Error(`legacy outcome ${row.id}: scope does not match opened Parley`);
  }
  const source = legacyObject(fields[2], `legacy outcome ${row.id}`);
  if (source.parleyId !== parleyId || !isTerminalStatus(source.status as string)) {
    throw new Error(`legacy outcome ${row.id}: payload is invalid`);
  }
  const outcome: ParleyOutcome = {
    parleyId,
    status: source.status as Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'>,
    decision: legacyNullableString(source.decision, `legacy outcome ${row.id}: decision`, PARLEY_STORE_LIMITS.maxDecisionChars),
    reason: legacyNullableString(source.reason, `legacy outcome ${row.id}: reason`, PARLEY_STORE_LIMITS.maxDecisionChars),
    resolvedBy: assertCanonicalString(source.resolvedBy, `legacy outcome ${row.id}: resolvedBy`, PARLEY_STORE_LIMITS.maxActorChars),
    dissenters: legacyStringArray(
      source.dissenters,
      `legacy outcome ${row.id}: dissenters`,
      PARLEY_STORE_LIMITS.maxParticipants,
      PARLEY_STORE_LIMITS.maxActorChars,
    ),
    at: assertFiniteTimestamp(source.at as number, `legacy outcome ${row.id}: at`),
  };
  if (outcome.at < opened.record.createdAt) {
    throw new Error(`legacy outcome ${row.id}: precedes Parley creation`);
  }
  if (row.written_by !== outcome.resolvedBy) {
    throw new Error(`legacy outcome ${row.id}: tuple writer is not resolver`);
  }
  return { tuple: row, outcome };
}

/** Decode the immutable receipt gate before deciding whether a restart may scan legacy tuples. */
function decodeLegacyMigrationReceipt(
  row: LegacyMigrationReceiptRow,
  replayed: boolean,
): LegacyParleyTupleMigrationReceipt {
  if (row.migration_version !== LEGACY_PARLEY_TUPLE_MIGRATION_VERSION) {
    throw new Error('legacy Parley migration receipt has an unsupported version');
  }
  if (!/^[a-f0-9]{64}$/.test(row.source_digest)) {
    throw new Error('legacy Parley migration receipt has an invalid source digest');
  }
  const counts = [
    ['sourceTupleRows', row.source_tuple_rows],
    ['sourceOpenedRows', row.source_opened_rows],
    ['sourceTurnRows', row.source_turn_rows],
    ['sourceSeenRows', row.source_seen_rows],
    ['sourceSeenFrontiers', row.source_seen_frontiers],
    ['sourceOutcomeRows', row.source_outcome_rows],
    ['importedRecords', row.imported_records],
    ['importedTurns', row.imported_turns],
    ['importedSeenReceipts', row.imported_seen_receipts],
    ['importedSeenProvenance', row.imported_seen_provenance],
    ['importedOutcomes', row.imported_outcomes],
  ] as const;
  for (const [label, count] of counts) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`legacy Parley migration receipt has an invalid ${label}`);
    }
  }
  if (row.source_seen_frontiers > row.source_seen_rows
    || row.imported_records > row.source_opened_rows
    || row.imported_turns > row.source_turn_rows
    || row.imported_seen_receipts > row.source_seen_frontiers
    || row.imported_seen_provenance !== row.source_seen_frontiers
    || row.imported_outcomes > row.source_outcome_rows
    || row.source_tuple_rows < row.source_opened_rows + row.source_turn_rows
      + row.source_seen_rows + row.source_outcome_rows) {
    throw new Error('legacy Parley migration receipt has inconsistent counters');
  }
  assertFiniteTimestamp(row.completed_at, 'legacy Parley migration receipt completedAt');
  return {
    migrationVersion: LEGACY_PARLEY_TUPLE_MIGRATION_VERSION,
    sourceDigest: row.source_digest,
    sourceTupleRows: row.source_tuple_rows,
    sourceOpenedRows: row.source_opened_rows,
    sourceTurnRows: row.source_turn_rows,
    sourceSeenRows: row.source_seen_rows,
    sourceSeenFrontiers: row.source_seen_frontiers,
    sourceOutcomeRows: row.source_outcome_rows,
    importedRecords: row.imported_records,
    importedTurns: row.imported_turns,
    importedSeenReceipts: row.imported_seen_receipts,
    importedSeenProvenance: row.imported_seen_provenance,
    importedOutcomes: row.imported_outcomes,
    completedAt: row.completed_at,
    replayed,
  };
}
/* LEGACY_PARLEY_TUPLE_IMPORTER_END */

function isAutomaticTerminalState(value: string): value is AutomaticTerminalState {
  return value === 'evaluated' || value === 'fired' || value === 'suppressed' || value === 'failed';
}

function changes(result: unknown): number {
  return Number((result as { changes?: unknown })?.changes ?? 0);
}

function assertRecord(record: ParleyRecord, tenantId: string): void {
  assertCanonicalString(tenantId, 'parley tenantId', PARLEY_STORE_LIMITS.maxTenantChars);
  assertCanonicalString(record.harbor, 'parley harbor', PARLEY_STORE_LIMITS.maxHarborChars);
  assertCanonicalString(record.parleyId, 'parley id', PARLEY_STORE_LIMITS.maxParleyIdChars);
  assertCanonicalString(record.surface, 'parley surface', CONFLICT_SIGNAL_LIMITS.maxSurfaceChars);
  assertCanonicalString(record.reason, 'parley reason', CONFLICT_SIGNAL_LIMITS.maxReasonChars);
  assertCanonicalString(record.calledBy, 'parley calledBy', PARLEY_STORE_LIMITS.maxActorChars);
  assertCanonicalString(record.channel, 'parley channel', PARLEY_STORE_LIMITS.maxChannelChars);
  if (!Number.isInteger(record.roundLimit)
    || record.roundLimit < 1
    || record.roundLimit > PARLEY_STORE_LIMITS.maxRoundLimit) {
    throw new Error(`parley roundLimit must be between 1 and ${PARLEY_STORE_LIMITS.maxRoundLimit}`);
  }
  assertFiniteTimestamp(record.createdAt, 'parley createdAt');
  if (record.responseDueAt !== null) {
    assertFiniteTimestamp(record.responseDueAt, 'parley responseDueAt');
    if (record.responseDueAt < record.createdAt) {
      throw new Error('parley responseDueAt must not precede createdAt');
    }
    if (record.responseDueAt - record.createdAt > PARLEY_STORE_LIMITS.maxTtlMs) {
      throw new Error(`parley TTL exceeds ${PARLEY_STORE_LIMITS.maxTtlMs}ms`);
    }
  }
  if (record.status !== 'SUMMONED') {
    throw new Error('new Parley records must start SUMMONED');
  }
}

function assertParticipant(value: StoredParleyParticipant, label: string): StoredParleyParticipant {
  const actorId = assertCanonicalString(value.actorId, `${label}.actorId`, PARLEY_STORE_LIMITS.maxActorChars);
  const inboxTarget = value.inboxTarget === null
    ? null
    : assertCanonicalString(value.inboxTarget, `${label}.inboxTarget`, PARLEY_STORE_LIMITS.maxActorChars);
  const sessionId = value.sessionId === null
    ? null
    : assertCanonicalString(value.sessionId, `${label}.sessionId`, PARLEY_STORE_LIMITS.maxActorChars);
  const lineageRootSessionId = value.lineageRootSessionId === null
    ? null
    : assertCanonicalString(
      value.lineageRootSessionId,
      `${label}.lineageRootSessionId`,
      PARLEY_STORE_LIMITS.maxActorChars,
    );
  if (!value.summoned && !value.caller) throw new Error(`${label} must be summoned or caller`);
  if (value.summoned && inboxTarget === null) throw new Error(`${label} summoned participant needs inboxTarget`);
  return { actorId, inboxTarget, sessionId, lineageRootSessionId, summoned: value.summoned, caller: value.caller };
}

function assertParticipants(values: StoredParleyParticipant[]): StoredParleyParticipant[] {
  if (!Array.isArray(values) || values.length < 2 || values.length > PARLEY_STORE_LIMITS.maxParticipants + 1) {
    throw new Error(`parley participants must contain 2-${PARLEY_STORE_LIMITS.maxParticipants + 1} rows`);
  }
  const actors = new Set<string>();
  const inboxes = new Set<string>();
  let summoned = 0;
  let callers = 0;
  const result = values.map((value, index) => {
    const participant = assertParticipant(value, `parley participant ${index}`);
    if (actors.has(participant.actorId)) throw new Error('parley participant actorIds must be unique');
    actors.add(participant.actorId);
    if (participant.inboxTarget !== null) {
      if (inboxes.has(participant.inboxTarget)) throw new Error('parley participant inboxTargets must be unique');
      inboxes.add(participant.inboxTarget);
    }
    if (participant.summoned) summoned++;
    if (participant.caller) callers++;
    return participant;
  });
  if (summoned < 2) throw new Error('parley needs at least two summoned participants');
  if (callers !== 1) throw new Error('parley needs exactly one caller participant');
  return result.sort((a, b) => {
    if (a.summoned !== b.summoned) return a.summoned ? -1 : 1;
    return a.actorId.localeCompare(b.actorId);
  });
}

function assertNotification(intent: ParleyNotificationIntent): ParleyNotificationIntent {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    throw new Error('outbox notification intent must be an object');
  }
  if (!intent.payload || typeof intent.payload !== 'object' || Array.isArray(intent.payload)) {
    throw new Error('outbox payload must be an object');
  }
  const canonical: ParleyNotificationIntent = {
    deliveryKey: assertCanonicalString(intent.deliveryKey, 'outbox deliveryKey', 512),
    recipientActorId: assertCanonicalString(intent.recipientActorId, 'outbox recipientActorId', 128),
    inboxTarget: assertCanonicalString(intent.inboxTarget, 'outbox inboxTarget', 128),
    fromActorId: assertCanonicalString(intent.fromActorId, 'outbox fromActorId', 128),
    eventType: intent.eventType,
    payload: intent.payload,
  };
  if (intent.eventType !== 'parley_summons'
    && intent.eventType !== 'parley_turn'
    && intent.eventType !== 'parley_escalation') {
    throw new Error('outbox eventType is invalid');
  }
  const payloadJson = json(intent.payload);
  if (Buffer.byteLength(payloadJson, 'utf8') > PARLEY_STORE_LIMITS.maxOutboxPayloadBytes) {
    throw new Error(`outbox payload exceeds ${PARLEY_STORE_LIMITS.maxOutboxPayloadBytes} bytes`);
  }
  return canonical;
}

function canonicalNotifications(intents: ParleyNotificationIntent[]): ParleyNotificationIntent[] {
  if (!Array.isArray(intents) || intents.length > PARLEY_STORE_LIMITS.maxParticipants + 1) {
    throw new Error(
      `parley notification batch exceeds ${PARLEY_STORE_LIMITS.maxParticipants + 1} intents`,
    );
  }
  const canonical = intents.map(assertNotification);
  const deliveryKeys = canonical.map((intent) => intent.deliveryKey);
  if (new Set(deliveryKeys).size !== deliveryKeys.length) {
    throw new Error('parley notification delivery keys must be unique within a batch');
  }
  return canonical;
}

function decodeRecord(row: RecordRow): ParleyRecord {
  if (row.status !== 'SUMMONED'
    && row.status !== 'CONVENED'
    && row.status !== 'COLLAPSED'
    && row.status !== 'ESCALATED'
    && row.status !== 'VOIDED') {
    throw new Error('parley store poisoned row: invalid record status');
  }
  if (row.trigger !== 'operator'
    && row.trigger !== 'claim_overlap'
    && row.trigger !== 'detector'
    && row.trigger !== 'swarm_fit') {
    throw new Error('parley store poisoned row: invalid trigger');
  }
  const automatic = row.automatic_signal_id === null
    ? null
    : {
      idempotencyKey: row.automatic_signal_id,
      signalId: row.automatic_signal_id,
      callFingerprint: assertCanonicalString(
        row.automatic_call_fingerprint,
        'stored automatic callFingerprint',
        64,
      ),
      lineageKey: assertCanonicalString(row.automatic_lineage_key, 'stored automatic lineageKey', 192),
      checkpoint: assertCanonicalString(row.automatic_checkpoint, 'stored automatic checkpoint', 64),
      kind: assertCanonicalString(row.automatic_kind, 'stored automatic kind', 64),
      shape: assertCanonicalString(row.automatic_shape, 'stored automatic shape', 64),
      evidenceRefs: canonicalStrings(
        parseJson<string[]>(row.automatic_evidence_json ?? '', 'automatic evidence JSON'),
        'stored evidence reference',
        CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs,
        CONFLICT_SIGNAL_LIMITS.maxEvidenceRefChars,
      ),
      confidence: Number(row.automatic_confidence),
      magnitude: Number(row.automatic_magnitude),
      origin: row.automatic_origin === 'sugar-parley' ? 'sugar-parley' : null,
      participants: [],
    } as ParleyRecord['automatic'];
  return {
    parleyId: row.parley_id,
    surface: row.surface,
    reason: row.reason,
    parties: [],
    calledBy: row.called_by,
    trigger: row.trigger,
    channel: row.channel,
    status: row.status,
    harbor: row.harbor,
    responseDueAt: row.response_due_at,
    roundLimit: row.round_limit,
    createdAt: row.created_at,
    automatic,
  };
}

function decodeParticipant(row: ParticipantRow): StoredParleyParticipant {
  if ((row.summoned !== 0 && row.summoned !== 1) || (row.caller !== 0 && row.caller !== 1)) {
    throw new Error('parley store poisoned row: invalid participant role');
  }
  return assertParticipant({
    actorId: row.actor_id,
    inboxTarget: row.inbox_target,
    sessionId: row.session_id,
    lineageRootSessionId: row.lineage_root_session_id,
    summoned: row.summoned === 1,
    caller: row.caller === 1,
  }, 'stored participant');
}

function decodeTurn(parleyId: string, row: TurnRow): StoredParleyTurn {
  if (!Number.isSafeInteger(row.turn_sequence) || row.turn_sequence < 1) {
    throw new Error('parley store poisoned row: invalid turn sequence');
  }
  assertFiniteTimestamp(row.at, 'stored turn time');
  if (!PERFORMATIVES.has(row.performative as ParleyPerformative)) {
    throw new Error('parley store poisoned row: invalid performative');
  }
  return {
    parleyId,
    turnSequence: row.turn_sequence,
    party: row.party,
    performative: row.performative as ParleyPerformative,
    content: row.content,
    proposalId: row.proposal_id,
    evidenceRefs: canonicalStrings(
      parseJson<string[]>(row.evidence_json, 'turn evidence JSON'),
      'stored turn evidence',
      CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs,
      CONFLICT_SIGNAL_LIMITS.maxEvidenceRefChars,
    ),
    at: row.at,
  };
}

function decodeOutcome(parleyId: string, row: OutcomeRow | undefined): ParleyOutcome | null {
  if (!row) return null;
  if (!isTerminalStatus(row.status)) throw new Error('parley store poisoned row: invalid outcome status');
  return {
    parleyId,
    status: row.status,
    decision: row.decision,
    reason: row.reason,
    resolvedBy: row.resolved_by,
    dissenters: canonicalStrings(
      parseJson<string[]>(row.dissenters_json, 'outcome dissenters JSON'),
      'stored dissenter',
      PARLEY_STORE_LIMITS.maxParticipants,
      PARLEY_STORE_LIMITS.maxActorChars,
    ),
    at: row.at,
  };
}

function decodeDeliveryOverflow(row: {
  dropped_intents: number;
  batch_count: number;
  saw_turn: number;
  saw_escalation: number;
  evidence_hash: string;
  first_at: number;
  last_at: number;
  last_error: string;
} | undefined): StoredDeliveryOverflowReceipt | null {
  if (!row) return null;
  if (!Number.isSafeInteger(row.dropped_intents)
    || row.dropped_intents < 1
    || row.dropped_intents > PARLEY_STORE_LIMITS.maxOverflowIntentsPerParley
    || !Number.isSafeInteger(row.batch_count)
    || row.batch_count < 1
    || row.batch_count > 4
    || (row.saw_turn !== 0 && row.saw_turn !== 1)
    || (row.saw_escalation !== 0 && row.saw_escalation !== 1)
    || !/^[a-f0-9]{64}$/.test(row.evidence_hash)
    || !Number.isSafeInteger(row.first_at)
    || !Number.isSafeInteger(row.last_at)
    || row.last_at < row.first_at
    || typeof row.last_error !== 'string'
    || !row.last_error
    || row.last_error !== row.last_error.trim()
    || row.last_error.length > 4_096) {
    throw new Error('parley store poisoned row: invalid notification overflow receipt');
  }
  return {
    droppedIntents: row.dropped_intents,
    batchCount: row.batch_count,
    sawTurn: row.saw_turn === 1,
    sawEscalation: row.saw_escalation === 1,
    evidenceHash: row.evidence_hash,
    firstAt: row.first_at,
    lastAt: row.last_at,
    lastError: row.last_error,
  };
}

/** Create one tenant-bound Parley authority. No returned method can omit harbor scope. */
export function createParleyStore(deps: ParleyStoreDeps) {
  const { db } = deps;
  const tenantId = assertCanonicalString(
    deps.tenantId,
    'parley store tenantId',
    PARLEY_STORE_LIMITS.maxTenantChars,
  );
  const now = deps.now ?? (() => Date.now());
  const fault = deps.faultInjector ?? (() => undefined);

  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  // Legacy automatic rows predate the explicit product-origin discriminator.
  // They remain originless rather than being retroactively guessed from text
  // or evidence shapes; only a Sugar card can durably write this marker.
  const recordColumns = db.prepare('PRAGMA table_info(parley_records)').all() as Array<{ name: string }>;
  if (!recordColumns.some((column) => column.name === 'automatic_origin')) {
    db.exec("ALTER TABLE parley_records ADD COLUMN automatic_origin TEXT");
  }

  function scope(harbor: string): string {
    return assertCanonicalString(harbor, 'parley harbor', PARLEY_STORE_LIMITS.maxHarborChars);
  }

  function checkedQuotaSnapshot(row: {
    retained_records: number;
    retained_signals: number;
    retained_turns: number;
    retained_outbox: number;
  }, label: string): ParleyQuotaSnapshot {
    const values = [
      ['retainedRecords', row.retained_records, PARLEY_STORE_LIMITS.maxRetainedRecordsPerHarbor],
      ['retainedSignals', row.retained_signals, PARLEY_STORE_LIMITS.maxRetainedSignalsPerHarbor],
      ['retainedTurns', row.retained_turns, PARLEY_STORE_LIMITS.maxRetainedTurnsPerHarbor],
      ['retainedOutbox', row.retained_outbox, PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor],
    ] as const;
    for (const [name, value, maximum] of values) {
      if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        throw new Error(`parley quota ledger poisoned row: ${label}.${name} is invalid`);
      }
    }
    return {
      retainedRecords: row.retained_records,
      retainedSignals: row.retained_signals,
      retainedTurns: row.retained_turns,
      retainedOutbox: row.retained_outbox,
    };
  }

  function quotaSnapshot(harbor: string): ParleyQuotaSnapshot {
    const row = db.prepare(`
      SELECT retained_records, retained_signals, retained_turns, retained_outbox
      FROM parley_quota_ledger
      WHERE tenant_id = ? AND harbor = ?
    `).get(tenantId, harbor) as {
      retained_records: number;
      retained_signals: number;
      retained_turns: number;
      retained_outbox: number;
    } | undefined;
    return row ? checkedQuotaSnapshot(row, `${tenantId}/${harbor}`) : {
      retainedRecords: 0,
      retainedSignals: 0,
      retainedTurns: 0,
      retainedOutbox: 0,
    };
  }

  function checkedTenantQuotaSnapshot(row: {
    harbor_count: number;
    retained_records: number;
    retained_signals: number;
    retained_turns: number;
    retained_outbox: number;
    retained_rows: number;
    retained_bytes: number;
  }, label: string): ParleyTenantQuotaSnapshot {
    const values = [
      ['harborCount', row.harbor_count, PARLEY_STORE_LIMITS.maxHarborsPerTenant],
      ['retainedRecords', row.retained_records, PARLEY_STORE_LIMITS.maxRetainedRecordsPerTenant],
      ['retainedSignals', row.retained_signals, PARLEY_STORE_LIMITS.maxRetainedSignalsPerTenant],
      ['retainedTurns', row.retained_turns, PARLEY_STORE_LIMITS.maxRetainedTurnsPerTenant],
      ['retainedOutbox', row.retained_outbox, PARLEY_STORE_LIMITS.maxRetainedOutboxPerTenant],
      ['retainedRows', row.retained_rows, PARLEY_STORE_LIMITS.maxRetainedRowsPerTenant],
      ['retainedBytes', row.retained_bytes, PARLEY_STORE_LIMITS.maxRetainedBytesPerTenant],
    ] as const;
    for (const [name, value, maximum] of values) {
      if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        throw new Error(`parley tenant quota ledger poisoned row: ${label}.${name} is invalid`);
      }
    }
    return {
      harborCount: row.harbor_count,
      retainedRecords: row.retained_records,
      retainedSignals: row.retained_signals,
      retainedTurns: row.retained_turns,
      retainedOutbox: row.retained_outbox,
      retainedRows: row.retained_rows,
      retainedBytes: row.retained_bytes,
    };
  }

  function tenantQuotaSnapshot(): ParleyTenantQuotaSnapshot {
    const row = db.prepare(`
      SELECT harbor_count, retained_records, retained_signals, retained_turns,
             retained_outbox, retained_rows, retained_bytes
      FROM parley_tenant_quota_ledger
      WHERE tenant_id = ?
    `).get(tenantId) as {
      harbor_count: number;
      retained_records: number;
      retained_signals: number;
      retained_turns: number;
      retained_outbox: number;
      retained_rows: number;
      retained_bytes: number;
    } | undefined;
    return row ? checkedTenantQuotaSnapshot(row, tenantId) : {
      harborCount: 0,
      retainedRecords: 0,
      retainedSignals: 0,
      retainedTurns: 0,
      retainedOutbox: 0,
      retainedRows: 0,
      retainedBytes: 0,
    };
  }

  function assertQuotaAvailable(
    harbor: string,
    deltas: Partial<ParleyQuotaSnapshot>,
  ): void {
    if (!db.inTransaction) {
      throw new Error('parley quota admission requires an active SQLite transaction');
    }
    db.prepare(`
      INSERT INTO parley_quota_ledger (tenant_id, harbor)
      VALUES (?, ?)
      ON CONFLICT(tenant_id, harbor) DO NOTHING
    `).run(tenantId, harbor);
    const current = quotaSnapshot(harbor);
    const checks = [
      [
        'retained record',
        current.retainedRecords,
        deltas.retainedRecords ?? 0,
        PARLEY_STORE_LIMITS.maxRetainedRecordsPerHarbor,
      ],
      [
        'retained automatic signal',
        current.retainedSignals,
        deltas.retainedSignals ?? 0,
        PARLEY_STORE_LIMITS.maxRetainedSignalsPerHarbor,
      ],
      [
        'retained turn',
        current.retainedTurns,
        deltas.retainedTurns ?? 0,
        PARLEY_STORE_LIMITS.maxRetainedTurnsPerHarbor,
      ],
      [
        'retained outbox',
        current.retainedOutbox,
        deltas.retainedOutbox ?? 0,
        PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor,
      ],
    ] as const;
    for (const [label, count, delta, maximum] of checks) {
      if (!Number.isSafeInteger(delta) || delta < 0 || count + delta > maximum) {
        throw new Error(`parley ${label} quota ${maximum} reached for ${tenantId}/${harbor}`);
      }
    }
  }

  function reconcileQuotaLedger(): void {
    // Migration/restart reconciliation owns the writer lock from its first
    // canonical count through ledger replacement. A concurrent admission can
    // therefore happen wholly before or wholly after rebuild, never in the
    // scan-to-reset gap.
    const transaction = db.transaction(() => {
      const scopes = db.prepare(`
        SELECT tenant_id, harbor FROM parley_records WHERE tenant_id = ?
        UNION SELECT tenant_id, harbor FROM parley_auto_signals WHERE tenant_id = ?
        UNION SELECT tenant_id, harbor FROM parley_turns WHERE tenant_id = ?
        UNION SELECT tenant_id, harbor FROM parley_notification_outbox WHERE tenant_id = ?
      `).all(tenantId, tenantId, tenantId, tenantId) as Array<{ tenant_id: string; harbor: string }>;
      const reconciled = scopes.map(({ harbor }) => {
        const count = (table: string): number => Number((db.prepare(`
          SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND harbor = ?
        `).get(tenantId, harbor) as { count: number }).count);
        const bytes = QUOTA_TABLES.reduce((total, spec) => {
          const row = db.prepare(`
            SELECT COALESCE(SUM(${accountedBytesSql('q', spec.columns, spec.reserveBytes)}), 0) AS bytes
            FROM ${spec.table} AS q
            WHERE tenant_id = ? AND harbor = ?
          `).get(tenantId, harbor) as { bytes: number };
          return total + Number(row.bytes);
        }, 0);
        return {
          harbor,
          retained_records: count('parley_records'),
          retained_signals: count('parley_auto_signals'),
          retained_turns: count('parley_turns'),
          retained_outbox: count('parley_notification_outbox'),
          retained_bytes: bytes,
        };
      });
      for (const row of reconciled) checkedQuotaSnapshot(row, `${tenantId}/${row.harbor}`);
      const tenantRow = {
        harbor_count: reconciled.length,
        retained_records: reconciled.reduce((total, row) => total + row.retained_records, 0),
        retained_signals: reconciled.reduce((total, row) => total + row.retained_signals, 0),
        retained_turns: reconciled.reduce((total, row) => total + row.retained_turns, 0),
        retained_outbox: reconciled.reduce((total, row) => total + row.retained_outbox, 0),
        retained_rows: reconciled.reduce((total, row) => (
          total + row.retained_records + row.retained_signals
          + row.retained_turns + row.retained_outbox
        ), 0),
        retained_bytes: reconciled.reduce((total, row) => total + row.retained_bytes, 0),
      };
      checkedTenantQuotaSnapshot(tenantRow, tenantId);
      db.prepare(`
        DELETE FROM parley_tenant_quota_ledger
        WHERE tenant_id = ?
      `).run(tenantId);
      db.prepare(`
        DELETE FROM parley_quota_ledger
        WHERE tenant_id = ?
      `).run(tenantId);
      db.prepare(`
        INSERT INTO parley_tenant_quota_ledger (
          tenant_id, harbor_count, retained_records, retained_signals,
          retained_turns, retained_outbox, retained_rows, retained_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        tenantRow.harbor_count,
        tenantRow.retained_records,
        tenantRow.retained_signals,
        tenantRow.retained_turns,
        tenantRow.retained_outbox,
        tenantRow.retained_rows,
        tenantRow.retained_bytes,
      );
      const insert = db.prepare(`
        INSERT INTO parley_quota_ledger (
          tenant_id, harbor, retained_records, retained_signals,
          retained_turns, retained_outbox
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const row of reconciled) {
        insert.run(
          tenantId,
          row.harbor,
          row.retained_records,
          row.retained_signals,
          row.retained_turns,
          row.retained_outbox,
        );
      }
    });
    transaction.immediate();
  }

  reconcileQuotaLedger();

  /* LEGACY_PARLEY_TUPLE_IMPORTER_BEGIN */
  /* The runtime's only bounded raw tuple read path; see the matching static guard. */
  /** Return true only when this database still carries the pre-Store0 tuple authority. */
  function hasLegacyTupleTable(): boolean {
    const row = db.prepare(`
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = 'tuples'
    `).get() as { present: number } | undefined;
    return row?.present === 1;
  }

  /** Read the receipt gate without touching source tuples or normalized Parley rows. */
  function legacyMigrationReceipt(): LegacyParleyTupleMigrationReceipt | null {
    const row = db.prepare(`
      SELECT migration_version, source_digest, source_tuple_rows,
             source_opened_rows, source_turn_rows, source_seen_rows,
             source_seen_frontiers, source_outcome_rows, imported_records,
             imported_turns, imported_seen_receipts, imported_seen_provenance,
             imported_outcomes,
             completed_at
      FROM parley_legacy_tuple_migration_receipts
      WHERE tenant_id = ? AND migration_version = ?
    `).get(tenantId, LEGACY_PARLEY_TUPLE_MIGRATION_VERSION) as LegacyMigrationReceiptRow | undefined;
    return row ? decodeLegacyMigrationReceipt(row, true) : null;
  }

  /** Read exact child tuple rows in bounded SQLite batches, never into a TupleSpace adapter. */
  function legacyChildRows(
    kind: 'parley:turn' | 'parley:outcome',
    harbor: string,
    parleyIds: string[],
    observedAt: number,
  ): LegacyTupleRow[] {
    const rows: LegacyTupleRow[] = [];
    for (let offset = 0; offset < parleyIds.length; offset += LEGACY_PARLEY_TUPLE_QUERY_BATCH) {
      const ids = parleyIds.slice(offset, offset + LEGACY_PARLEY_TUPLE_QUERY_BATCH);
      const placeholders = ids.map(() => '?').join(', ');
      rows.push(...db.prepare(`
        SELECT id, harbor, fields, written_by, created_at, expires_at
        FROM tuples
        WHERE harbor = ?
          AND internal_only = 0
          AND json_extract(fields, '$[0]') = ?
          AND json_extract(fields, '$[1]') IN (${placeholders})
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at ASC, id ASC
      `).all(harbor, kind, ...ids, observedAt) as LegacyTupleRow[]);
    }
    return rows;
  }

  /** Count all historical seen rows while letting SQLite retain the high-cardinality corpus. */
  function legacySeenCount(harbor: string, parleyIds: string[], observedAt: number): number {
    let count = 0;
    for (let offset = 0; offset < parleyIds.length; offset += LEGACY_PARLEY_TUPLE_QUERY_BATCH) {
      const ids = parleyIds.slice(offset, offset + LEGACY_PARLEY_TUPLE_QUERY_BATCH);
      const placeholders = ids.map(() => '?').join(', ');
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM tuples
        WHERE harbor = ?
          AND internal_only = 0
          AND json_extract(fields, '$[0]') = 'parley:seen'
          AND json_extract(fields, '$[1]') IN (${placeholders})
          AND (expires_at IS NULL OR expires_at > ?)
      `).get(harbor, ...ids, observedAt) as { count: number };
      count += Number(row.count);
    }
    return count;
  }

  /**
   * Collapse timestamp receipts at the database edge. This is the only seen
   * query that crosses the process boundary, so a 22k-row receipt corpus does
   * not become a 22k-object migration heap.
   */
  function legacySeenFrontiers(
    harbor: string,
    parleyIds: string[],
    observedAt: number,
  ): LegacyTupleRow[] {
    const rows: LegacyTupleRow[] = [];
    for (let offset = 0; offset < parleyIds.length; offset += LEGACY_PARLEY_TUPLE_QUERY_BATCH) {
      const ids = parleyIds.slice(offset, offset + LEGACY_PARLEY_TUPLE_QUERY_BATCH);
      const placeholders = ids.map(() => '?').join(', ');
      rows.push(...db.prepare(`
        WITH ranked_seen AS (
          SELECT id, harbor, fields, written_by, created_at, expires_at,
                 ROW_NUMBER() OVER (
                   PARTITION BY json_extract(fields, '$[1]'), json_extract(fields, '$[2]')
                   ORDER BY CAST(json_extract(fields, '$[3].throughAt') AS INTEGER) DESC,
                            created_at DESC,
                            id DESC
                 ) AS position
          FROM tuples
          WHERE harbor = ?
            AND internal_only = 0
            AND json_extract(fields, '$[0]') = 'parley:seen'
            AND json_extract(fields, '$[1]') IN (${placeholders})
            AND (expires_at IS NULL OR expires_at > ?)
        )
        SELECT id, harbor, fields, written_by, created_at, expires_at
        FROM ranked_seen
        WHERE position = 1
        ORDER BY harbor ASC, json_extract(fields, '$[1]') ASC,
                 json_extract(fields, '$[2]') ASC, id ASC
      `).all(harbor, ...ids, observedAt) as LegacyTupleRow[]);
    }
    return rows;
  }

  /** Find an opened source from a child row before decoding its payload. */
  function legacyOpenedForChild(
    row: LegacyTupleRow,
    kind: 'parley:turn' | 'parley:seen' | 'parley:outcome',
    opened: Map<string, LegacyParleyImportSource>,
  ): LegacyParleyImportSource {
    const fields = legacyFields(row, kind, kind === 'parley:outcome' ? 3 : 4);
    const parleyId = assertCanonicalString(
      fields[1],
      `legacy ${kind} parley id`,
      PARLEY_STORE_LIMITS.maxParleyIdChars,
    );
    const source = opened.get(`${row.harbor}\u0000${parleyId}`);
    if (!source) throw new Error(`legacy ${kind} ${row.id}: opened source is missing`);
    return source;
  }

  /** Load, validate, and normalize only the legacy data that Store0 can represent truthfully. */
  function readLegacyParleySources(observedAt: number): {
    sourceTupleRows: number;
    sourceOpenedRows: number;
    sourceTurnRows: number;
    sourceSeenRows: number;
    sourceSeenFrontiers: number;
    sourceOutcomeRows: number;
    sources: LegacyParleyImportSource[];
  } {
    const sourceTupleRows = Number((db.prepare('SELECT COUNT(*) AS count FROM tuples').get() as {
      count: number;
    }).count);
    const openedRows = db.prepare(`
      SELECT id, harbor, fields, written_by, created_at, expires_at
      FROM tuples
      WHERE internal_only = 0
        AND json_extract(fields, '$[0]') = 'parley:opened'
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY harbor ASC, created_at ASC, id ASC
    `).all(observedAt) as LegacyTupleRow[];
    const sources: LegacyParleyImportSource[] = openedRows.map((tuple): LegacyParleyImportSource => {
      const opened = decodeLegacyOpenedTuple(tuple);
      assertRecord(opened.record, tenantId);
      const participants = assertParticipants(opened.participants);
      return {
        ...opened,
        participants,
        turns: [],
        seenFrontiers: [],
        outcome: null,
      };
    });
    const byScope = new Map<string, LegacyParleyImportSource>();
    for (const source of sources) {
      const key = `${source.record.harbor}\u0000${source.record.parleyId}`;
      if (byScope.has(key)) throw new Error(`legacy opened ${key}: duplicate tuple authority`);
      byScope.set(key, source);
    }
    const idsByHarbor = new Map<string, string[]>();
    for (const source of sources) {
      const ids = idsByHarbor.get(source.record.harbor) ?? [];
      ids.push(source.record.parleyId);
      idsByHarbor.set(source.record.harbor, ids);
    }
    let sourceTurnRows = 0;
    let sourceSeenRows = 0;
    let sourceSeenFrontiers = 0;
    let sourceOutcomeRows = 0;
    for (const [harbor, parleyIds] of idsByHarbor) {
      for (const row of legacyChildRows('parley:turn', harbor, parleyIds, observedAt)) {
        const source = legacyOpenedForChild(row, 'parley:turn', byScope);
        source.turns.push(decodeLegacyTurnTuple(row, source));
        sourceTurnRows++;
      }
      sourceSeenRows += legacySeenCount(harbor, parleyIds, observedAt);
      for (const row of legacySeenFrontiers(harbor, parleyIds, observedAt)) {
        const source = legacyOpenedForChild(row, 'parley:seen', byScope);
        source.seenFrontiers.push(decodeLegacySeenTuple(row, source));
        sourceSeenFrontiers++;
      }
      for (const row of legacyChildRows('parley:outcome', harbor, parleyIds, observedAt)) {
        const source = legacyOpenedForChild(row, 'parley:outcome', byScope);
        if (source.outcome) {
          throw new Error(`legacy outcome ${row.id}: duplicate terminal authority`);
        }
        source.outcome = decodeLegacyOutcomeTuple(row, source);
        sourceOutcomeRows++;
      }
    }
    for (const source of sources) {
      source.turns.sort((left, right) => (
        left.tuple.created_at - right.tuple.created_at || left.tuple.id - right.tuple.id
      ));
      for (let index = 1; index < source.turns.length; index++) {
        if (source.turns[index]!.turn.at < source.turns[index - 1]!.turn.at) {
          throw new Error(
            `legacy Parley ${source.record.parleyId}: timestamp receipts cannot be normalized over non-monotonic tuple turn order`,
          );
        }
      }
    }
    return {
      sourceTupleRows,
      sourceOpenedRows: sources.length,
      sourceTurnRows,
      sourceSeenRows,
      sourceSeenFrontiers,
      sourceOutcomeRows,
      sources,
    };
  }

  /**
   * Hash exact imported source identities without retaining all historical seen
   * receipts in memory. The raw opened `fields` binds its original deadline,
   * even when Store0 deliberately omits that inactive historic deadline.
   */
  function legacySourceDigest(source: ReturnType<typeof readLegacyParleySources>): string {
    const tuple = (row: LegacyTupleRow) => ({
      id: row.id,
      harbor: row.harbor,
      fields: row.fields,
      writtenBy: row.written_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
    return hash(json({
      migrationVersion: LEGACY_PARLEY_TUPLE_MIGRATION_VERSION,
      sourceTupleRows: source.sourceTupleRows,
      sourceOpenedRows: source.sourceOpenedRows,
      sourceTurnRows: source.sourceTurnRows,
      sourceSeenRows: source.sourceSeenRows,
      sourceSeenFrontiers: source.sourceSeenFrontiers,
      sourceOutcomeRows: source.sourceOutcomeRows,
      opened: source.sources.map((entry) => tuple(entry.tuple)),
      turns: source.sources.flatMap((entry) => entry.turns.map(({ tuple: row }) => tuple(row))),
      seenFrontiers: source.sources.flatMap((entry) => entry.seenFrontiers.map(({ tuple: row }) => tuple(row))),
      outcomes: source.sources.flatMap((entry) => entry.outcome ? [tuple(entry.outcome.tuple)] : []),
    }));
  }

  /**
   * A successful direct row write is one or more safe integer mutations.
   * better-sqlite3 reports the direct row while bun:sqlite includes durable
   * quota-trigger ledger writes. Never coerce an adapter receipt: an absent,
   * malformed, or zero count must remain a fail-closed storage failure.
   */
  function hasSuccessfulStoreWrite(result: unknown): boolean {
    const count = (result as { changes?: unknown } | null | undefined)?.changes;
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 1;
  }

  /** Insert a source only after every source row was validated and collision-checked. */
  function importLegacyParleySource(source: LegacyParleyImportSource): {
    turns: number;
    seenReceipts: number;
    seenProvenance: number;
    outcomes: number;
  } {
    const { record } = source;
    assertQuotaAvailable(record.harbor, {
      retainedRecords: 1,
      retainedTurns: source.turns.length,
    });
    // A legacy deadline without a durable outcome was only a tuple-era
    // projection. Carrying it into Store0 would cause the first read to create
    // a new terminal outcome and outbox. The untouched opened tuple and its
    // receipt digest preserve the historic deadline; Store0 must not replay it.
    const storedRecord = source.outcome ? record : { ...record, responseDueAt: null };
    insertRecord(storedRecord);
    insertParticipants(record, source.participants);
    const insertTurn = db.prepare(`
      INSERT INTO parley_turns (
        tenant_id, harbor, parley_id, turn_sequence, party, idempotency_key,
        intent_fingerprint, performative, content, proposal_id, evidence_json,
        delivery_keys_json, at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
    `);
    for (const [index, entry] of source.turns.entries()) {
      const turn = entry.turn;
      const tupleIdentity = `${record.harbor}:${record.parleyId}:${entry.tuple.id}`;
      const idempotencyKey = `legacy-turn:v1:${hash(tupleIdentity)}`;
      const intentFingerprint = hash(json({
        migrationVersion: LEGACY_PARLEY_TUPLE_MIGRATION_VERSION,
        tupleId: entry.tuple.id,
        parleyId: turn.parleyId,
        party: turn.party,
        performative: turn.performative,
        content: turn.content,
        proposalId: turn.proposalId,
        evidenceRefs: turn.evidenceRefs,
        at: turn.at,
      }));
      const result = insertTurn.run(
        tenantId,
        record.harbor,
        record.parleyId,
        index + 1,
        turn.party,
        idempotencyKey,
        intentFingerprint,
        turn.performative,
        turn.content,
        turn.proposalId,
        json(turn.evidenceRefs),
        turn.at,
      );
      // bun:sqlite includes quota-trigger writes in Statement#run().changes,
      // whereas better-sqlite3 reports just this direct row. A positive count
      // is the portable success receipt for this single-row insert.
      if (!hasSuccessfulStoreWrite(result)) throw new Error(`legacy turn ${entry.tuple.id}: Store0 insert failed`);
    }
    let seenReceipts = 0;
    const insertSeen = db.prepare(`
      INSERT INTO parley_seen_receipts (
        tenant_id, harbor, parley_id, actor_id, last_seen_turn_sequence, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertSeenProvenance = db.prepare(`
      INSERT INTO parley_legacy_tuple_seen_provenance (
        tenant_id, harbor, parley_id, actor_id, source_tuple_id,
        source_through_at, source_written_at, source_created_at,
        source_written_by, normalized_turn_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const seen of source.seenFrontiers) {
      let sequence = 0;
      for (const [index, entry] of source.turns.entries()) {
        if (entry.turn.at > seen.throughAt) break;
        sequence = index + 1;
      }
      const provenance = insertSeenProvenance.run(
        tenantId,
        record.harbor,
        record.parleyId,
        seen.party,
        seen.tuple.id,
        seen.throughAt,
        seen.at,
        seen.tuple.created_at,
        seen.party,
        sequence,
      );
      if (!hasSuccessfulStoreWrite(provenance)) {
        throw new Error(`legacy seen ${seen.tuple.id}: Store0 provenance insert failed`);
      }
      // Store0's zero frontier is represented by no receipt. The provenance
      // row still retains the literal legacy timestamp that produced it.
      if (sequence > 0) {
        const result = insertSeen.run(
          tenantId,
          record.harbor,
          record.parleyId,
          seen.party,
          sequence,
          seen.at,
        );
        if (!hasSuccessfulStoreWrite(result)) throw new Error(`legacy seen ${seen.tuple.id}: Store0 insert failed`);
        seenReceipts++;
      }
    }
    let outcomes = 0;
    if (source.outcome) {
      const outcome = source.outcome.outcome;
      const result = db.prepare(`
        INSERT INTO parley_outcomes (
          tenant_id, harbor, parley_id, status, decision, reason,
          resolved_by, dissenters_json, at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        record.harbor,
        record.parleyId,
        outcome.status,
        outcome.decision,
        outcome.reason,
        outcome.resolvedBy,
        json(outcome.dissenters),
        outcome.at,
      );
      if (!hasSuccessfulStoreWrite(result)) throw new Error(`legacy outcome ${source.outcome.tuple.id}: Store0 insert failed`);
      outcomes = 1;
    }
    const allPartiesResponded = record.parties.every((party) => (
      source.turns.some((entry) => entry.turn.party === party)
    ));
    const legacyRefusal = source.turns.some((entry) => entry.turn.performative === 'refuse');
    // Store0 correctly requires every terminal record to have a durable
    // outcome. Legacy refusal/expiry projections had none, so keep their raw
    // transcript readable and nonterminal instead of manufacturing authority.
    const status = source.outcome?.outcome.status
      ?? (!legacyRefusal && allPartiesResponded ? 'CONVENED' : 'SUMMONED');
    const updatedAt = Math.max(
      record.createdAt,
      ...source.turns.map((entry) => entry.turn.at),
      source.outcome?.outcome.at ?? 0,
    );
    const retentionUntil = updatedAt + PARLEY_STORE_LIMITS.retentionMs;
    if (!Number.isSafeInteger(retentionUntil)) {
      throw new Error(`legacy Parley ${record.parleyId}: retention deadline exceeds timestamp capacity`);
    }
    const updated = db.prepare(`
      UPDATE parley_records
      SET status = ?, updated_at = ?, retention_until = ?
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
    `).run(
      status,
      updatedAt,
      retentionUntil,
      tenantId,
      record.harbor,
      record.parleyId,
    );
    if (!hasSuccessfulStoreWrite(updated)) throw new Error(`legacy Parley ${record.parleyId}: Store0 status update failed`);
    return {
      turns: source.turns.length,
      seenReceipts,
      seenProvenance: source.seenFrontiers.length,
      outcomes,
    };
  }

  /**
   * Perform the non-replayable tuple-to-Store0 conversion under SQLite's
   * writer lock. A committed versioned receipt is the only restart gate.
   */
  function importLegacyTupleParleys(): LegacyParleyTupleMigrationReceipt | null {
    if (tenantId !== LEGACY_PARLEY_TUPLE_TENANT || !hasLegacyTupleTable()) return null;
    if (db.inTransaction) {
      throw new Error('legacy Parley import requires its own SQLite writer transaction');
    }
    return db.transaction(() => {
      const prior = legacyMigrationReceipt();
      if (prior) return prior;
      const observedAt = assertFiniteTimestamp(now(), 'legacy Parley migration time');
      const source = readLegacyParleySources(observedAt);
      for (const entry of source.sources) {
        if (getRecordRow(entry.record.harbor, entry.record.parleyId)) {
          throw new Error(
            `legacy Parley ${entry.record.harbor}/${entry.record.parleyId} collides with Store0 before migration receipt`,
          );
        }
      }
      let importedTurns = 0;
      let importedSeenReceipts = 0;
      let importedSeenProvenance = 0;
      let importedOutcomes = 0;
      for (const entry of source.sources) {
        const imported = importLegacyParleySource(entry);
        importedTurns += imported.turns;
        importedSeenReceipts += imported.seenReceipts;
        importedSeenProvenance += imported.seenProvenance;
        importedOutcomes += imported.outcomes;
      }
      const sourceTupleRowsAfter = Number((db.prepare('SELECT COUNT(*) AS count FROM tuples').get() as {
        count: number;
      }).count);
      if (sourceTupleRowsAfter !== source.sourceTupleRows) {
        throw new Error('legacy Parley import detected a source tuple mutation');
      }
      const receipt: LegacyParleyTupleMigrationReceipt = {
        migrationVersion: LEGACY_PARLEY_TUPLE_MIGRATION_VERSION,
        sourceDigest: legacySourceDigest(source),
        sourceTupleRows: source.sourceTupleRows,
        sourceOpenedRows: source.sourceOpenedRows,
        sourceTurnRows: source.sourceTurnRows,
        sourceSeenRows: source.sourceSeenRows,
        sourceSeenFrontiers: source.sourceSeenFrontiers,
        sourceOutcomeRows: source.sourceOutcomeRows,
        importedRecords: source.sources.length,
        importedTurns,
        importedSeenReceipts,
        importedSeenProvenance,
        importedOutcomes,
        completedAt: observedAt,
        replayed: false,
      };
      const result = db.prepare(`
        INSERT INTO parley_legacy_tuple_migration_receipts (
          tenant_id, migration_version, source_digest, source_tuple_rows,
          source_opened_rows, source_turn_rows, source_seen_rows,
          source_seen_frontiers, source_outcome_rows, imported_records,
          imported_turns, imported_seen_receipts, imported_seen_provenance,
          imported_outcomes, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        receipt.migrationVersion,
        receipt.sourceDigest,
        receipt.sourceTupleRows,
        receipt.sourceOpenedRows,
        receipt.sourceTurnRows,
        receipt.sourceSeenRows,
        receipt.sourceSeenFrontiers,
        receipt.sourceOutcomeRows,
        receipt.importedRecords,
        receipt.importedTurns,
        receipt.importedSeenReceipts,
        receipt.importedSeenProvenance,
        receipt.importedOutcomes,
        receipt.completedAt,
      );
      if (!hasSuccessfulStoreWrite(result)) throw new Error('legacy Parley migration receipt insert failed');
      return receipt;
    }).immediate();
  }
  /* LEGACY_PARLEY_TUPLE_IMPORTER_END */

  function insertRecord(record: ParleyRecord): void {
    assertRecord(record, tenantId);
    const retentionUntil = record.createdAt + PARLEY_STORE_LIMITS.retentionMs;
    if (!Number.isSafeInteger(retentionUntil)) {
      throw new Error('parley record retention deadline exceeds timestamp capacity');
    }
    const automatic = record.automatic;
    const result = db.prepare(`
      INSERT INTO parley_records (
        tenant_id, harbor, parley_id, surface, reason, called_by, trigger,
        channel, status, response_due_at, round_limit, created_at, updated_at,
        retention_until, automatic_signal_id, automatic_call_fingerprint,
        automatic_lineage_key, automatic_checkpoint, automatic_kind,
        automatic_shape, automatic_evidence_json, automatic_confidence,
        automatic_magnitude, automatic_origin
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      tenantId,
      record.harbor,
      record.parleyId,
      record.surface,
      record.reason,
      record.calledBy,
      record.trigger,
      record.channel,
      record.status,
      record.responseDueAt,
      record.roundLimit,
      record.createdAt,
      record.createdAt,
      retentionUntil,
      automatic?.signalId ?? null,
      automatic?.callFingerprint ?? null,
      automatic?.lineageKey ?? null,
      automatic?.checkpoint ?? null,
      automatic?.kind ?? null,
      automatic?.shape ?? null,
      automatic ? json(automatic.evidenceRefs) : null,
      automatic?.confidence ?? null,
      automatic?.magnitude ?? null,
      automatic?.origin ?? null,
    );
    // The compiled daemon uses bun:sqlite, which includes the durable quota
    // trigger's ledger writes in `changes`. The direct record row is still
    // exactly one; accepting any positive mutation keeps this boundary
    // portable without weakening a no-op or conflict failure.
    if (!hasSuccessfulStoreWrite(result)) throw new Error('parley store failed to insert canonical record');
  }

  function insertParticipants(record: ParleyRecord, input: StoredParleyParticipant[]): StoredParleyParticipant[] {
    const participants = assertParticipants(input);
    const statement = db.prepare(`
      INSERT INTO parley_participants (
        tenant_id, harbor, parley_id, ordinal, actor_id, inbox_target,
        session_id, lineage_root_session_id, summoned, caller
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    participants.forEach((participant, ordinal) => {
      statement.run(
        tenantId,
        record.harbor,
        record.parleyId,
        ordinal,
        participant.actorId,
        participant.inboxTarget,
        participant.sessionId,
        participant.lineageRootSessionId,
        participant.summoned ? 1 : 0,
        participant.caller ? 1 : 0,
      );
    });
    return participants;
  }

  function pendingOutboxCount(harbor: string): number {
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM parley_notification_outbox
      WHERE tenant_id = ? AND harbor = ? AND state IN ('pending','leased')
    `).get(tenantId, harbor) as { count: number };
    return Number(row.count);
  }

  function insertNotificationRows(
    record: ParleyRecord,
    canonical: ParleyNotificationIntent[],
    createdAt: number,
    state: 'pending' | 'dead',
    lastError: string | null,
  ): number {
    const statement = db.prepare(`
      INSERT INTO parley_notification_outbox (
        tenant_id, harbor, parley_id, delivery_key, recipient_actor_id,
        inbox_target, from_actor_id, event_type, payload_json, payload_hash,
        state, attempts, available_at, lease_until, lease_token, last_error,
        created_at, delivered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?, NULL)
      ON CONFLICT(tenant_id, harbor, delivery_key) DO NOTHING
    `);
    let inserted = 0;
    for (const intent of canonical) {
      const payload = json(intent.payload);
      const result = statement.run(
        tenantId,
        record.harbor,
        record.parleyId,
        intent.deliveryKey,
        intent.recipientActorId,
        intent.inboxTarget,
        intent.fromActorId,
        intent.eventType,
        payload,
        hash(payload),
        state,
        createdAt,
        lastError,
        createdAt,
      );
      inserted += changes(result);
      if (changes(result) === 0) {
        const existing = db.prepare(`
          SELECT parley_id, payload_hash, recipient_actor_id, inbox_target, from_actor_id, event_type
          FROM parley_notification_outbox
          WHERE tenant_id = ? AND harbor = ? AND delivery_key = ?
        `).get(tenantId, record.harbor, intent.deliveryKey) as {
          parley_id: string;
          payload_hash: string;
          recipient_actor_id: string;
          inbox_target: string;
          from_actor_id: string;
          event_type: string;
        } | undefined;
        if (!existing
          || existing.parley_id !== record.parleyId
          || existing.payload_hash !== hash(payload)
          || existing.recipient_actor_id !== intent.recipientActorId
          || existing.inbox_target !== intent.inboxTarget
          || existing.from_actor_id !== intent.fromActorId
          || existing.event_type !== intent.eventType) {
          throw new Error(`parley outbox replay mismatch for ${intent.deliveryKey}`);
        }
      }
    }
    return inserted;
  }

  function insertNotifications(
    record: ParleyRecord,
    intents: ParleyNotificationIntent[],
    createdAt: number = record.createdAt,
  ): number {
    if (intents.length === 0) return 0;
    const canonical = canonicalNotifications(intents);
    assertQuotaAvailable(record.harbor, { retainedOutbox: canonical.length });
    if (pendingOutboxCount(record.harbor) + canonical.length > PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor) {
      throw new Error(`parley notification outbox capacity ${PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor} reached`);
    }
    return insertNotificationRows(record, canonical, createdAt, 'pending', null);
  }

  function insertOverflowReceipt(
    record: ParleyRecord,
    intents: ParleyNotificationIntent[],
    createdAt: number,
    lastError: string,
  ): void {
    const prior = db.prepare(`
      SELECT dropped_intents, batch_count, saw_turn, saw_escalation,
             evidence_hash, first_at
      FROM parley_notification_overflow_receipts
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
    `).get(tenantId, record.harbor, record.parleyId) as {
      dropped_intents: number;
      batch_count: number;
      saw_turn: number;
      saw_escalation: number;
      evidence_hash: string;
      first_at: number;
    } | undefined;
    const droppedIntents = (prior?.dropped_intents ?? 0) + intents.length;
    const batchCount = (prior?.batch_count ?? 0) + 1;
    if (droppedIntents > PARLEY_STORE_LIMITS.maxOverflowIntentsPerParley || batchCount > 4) {
      throw new Error('parley terminal delivery overflow exceeded its bounded evidence receipt');
    }
    const sawTurn = (prior?.saw_turn === 1)
      || intents.some((intent) => intent.eventType === 'parley_turn');
    const sawEscalation = (prior?.saw_escalation === 1)
      || intents.some((intent) => intent.eventType === 'parley_escalation');
    const batchHash = hash(json(intents.map((intent) => ({
      deliveryKey: intent.deliveryKey,
      recipientActorId: intent.recipientActorId,
      inboxTarget: intent.inboxTarget,
      fromActorId: intent.fromActorId,
      eventType: intent.eventType,
      payloadHash: hash(json(intent.payload)),
    }))));
    const evidenceHash = prior ? hash(json([prior.evidence_hash, batchHash])) : batchHash;
    db.prepare(`
      INSERT INTO parley_notification_overflow_receipts (
        tenant_id, harbor, parley_id, dropped_intents, batch_count,
        saw_turn, saw_escalation, evidence_hash, first_at, last_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, harbor, parley_id) DO UPDATE SET
        dropped_intents = excluded.dropped_intents,
        batch_count = excluded.batch_count,
        saw_turn = excluded.saw_turn,
        saw_escalation = excluded.saw_escalation,
        evidence_hash = excluded.evidence_hash,
        last_at = excluded.last_at,
        last_error = excluded.last_error
    `).run(
      tenantId,
      record.harbor,
      record.parleyId,
      droppedIntents,
      batchCount,
      sawTurn ? 1 : 0,
      sawEscalation ? 1 : 0,
      evidenceHash,
      prior?.first_at ?? createdAt,
      createdAt,
      lastError,
    );
  }

  function terminalOutboxBytes(
    record: ParleyRecord,
    intents: readonly ParleyNotificationIntent[],
  ): number {
    return intents.reduce((total, intent) => {
      const payload = json(intent.payload);
      // This mirrors the parley_notification_outbox QUOTA_TABLES entry.
      // SQLite's `length(CAST(value AS BLOB))` is the UTF-8 byte length of
      // these canonical text fields, so this preflight matches its trigger.
      const fields = [
        tenantId,
        record.harbor,
        record.parleyId,
        intent.deliveryKey,
        intent.recipientActorId,
        intent.inboxTarget,
        intent.fromActorId,
        intent.eventType,
        payload,
        hash(payload),
      ];
      return total + OUTBOX_QUOTA_RESERVE_BYTES
        + fields.reduce((bytes, field) => bytes + Buffer.byteLength(field, 'utf8'), 0);
    }, 0);
  }

  function terminalNotificationOverflowReason(
    record: ParleyRecord,
    canonical: readonly ParleyNotificationIntent[],
  ): string | null {
    const quota = quotaSnapshot(record.harbor);
    if (quota.retainedOutbox + canonical.length > PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor) {
      return `terminal notification overflow: retained outbox quota ${PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor} reached`;
    }
    const tenantQuota = tenantQuotaSnapshot();
    if (tenantQuota.retainedOutbox + canonical.length > PARLEY_STORE_LIMITS.maxRetainedOutboxPerTenant) {
      return `terminal notification overflow: retained outbox tenant quota ${PARLEY_STORE_LIMITS.maxRetainedOutboxPerTenant} reached`;
    }
    if (tenantQuota.retainedRows + canonical.length > PARLEY_STORE_LIMITS.maxRetainedRowsPerTenant) {
      return `terminal notification overflow: retained-row tenant quota ${PARLEY_STORE_LIMITS.maxRetainedRowsPerTenant} reached`;
    }
    if (tenantQuota.retainedBytes + terminalOutboxBytes(record, canonical)
      > PARLEY_STORE_LIMITS.maxRetainedBytesPerTenant) {
      return `terminal notification overflow: retained-byte tenant quota ${PARLEY_STORE_LIMITS.maxRetainedBytesPerTenant} reached`;
    }
    return null;
  }

  /**
   * Terminal state is higher priority than delivery admission. Active-capacity
   * saturation records terminal publications as dead rows while retained quota
   * remains. At the hard retained-row limit, one bounded overflow receipt is
   * inserted or updated instead. Neither condition may roll back the outcome,
   * admission release, or refusal turn.
   */
  function insertTerminalNotifications(
    record: ParleyRecord,
    intents: ParleyNotificationIntent[],
    createdAt: number,
  ): number {
    if (intents.length === 0) return 0;
    const canonical = canonicalNotifications(intents);
    const overflowReason = terminalNotificationOverflowReason(record, canonical);
    if (overflowReason) {
      insertOverflowReceipt(record, canonical, createdAt, overflowReason);
      return canonical.length;
    }
    const saturated = pendingOutboxCount(record.harbor) + canonical.length
      > PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor;
    insertNotificationRows(
      record,
      canonical,
      createdAt,
      saturated ? 'dead' : 'pending',
      saturated
        ? `terminal notification overflow: active outbox capacity ${PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor} reached`
        : null,
    );
    return canonical.length;
  }

  function getRecordRow(harbor: string, parleyId: string): RecordRow | undefined {
    return db.prepare(`
      SELECT * FROM parley_records
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
    `).get(tenantId, scope(harbor), assertCanonicalString(
      parleyId,
      'parley id',
      PARLEY_STORE_LIMITS.maxParleyIdChars,
    )) as RecordRow | undefined;
  }

  function participantRows(harbor: string, parleyId: string): ParticipantRow[] {
    return db.prepare(`
      SELECT ordinal, actor_id, inbox_target, session_id, lineage_root_session_id, summoned, caller
      FROM parley_participants
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
      ORDER BY ordinal ASC, actor_id ASC
    `).all(tenantId, harbor, parleyId) as ParticipantRow[];
  }

  function snapshotFromRow(row: RecordRow, observedAt: number): ParleyStoreSnapshot {
    assertFiniteTimestamp(observedAt, 'parley snapshot time');
    const participants = participantRows(row.harbor, row.parley_id).map(decodeParticipant);
    if (participants.length < 2) throw new Error('parley store poisoned row: participant set is incomplete');
    const parley = decodeRecord(row);
    parley.parties = participants.filter((participant) => participant.summoned).map((participant) => participant.actorId);
    if (parley.automatic) {
      parley.automatic.participants = participants
        .filter((participant) => participant.summoned)
        .map((participant) => {
          if (!participant.inboxTarget || !participant.sessionId || !participant.lineageRootSessionId) {
            throw new Error('parley store poisoned row: automatic participant transport identity is incomplete');
          }
          return {
            actorId: participant.actorId as ParleyParticipant['actorId'],
            inboxTarget: participant.inboxTarget,
            sessionId: participant.sessionId,
            lineageRootSessionId: participant.lineageRootSessionId,
          };
        });
    }
    const turns = (db.prepare(`
      SELECT turn_sequence, party, performative, content, proposal_id, evidence_json, at
      FROM parley_turns
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
      ORDER BY turn_sequence ASC
    `).all(tenantId, row.harbor, row.parley_id) as TurnRow[])
      .map((turn) => decodeTurn(row.parley_id, turn));
    const outcome = decodeOutcome(row.parley_id, db.prepare(`
      SELECT status, decision, reason, resolved_by, dissenters_json, at
      FROM parley_outcomes
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
    `).get(tenantId, row.harbor, row.parley_id) as OutcomeRow | undefined);
    if (outcome && row.status !== outcome.status) {
      throw new Error('parley store poisoned row: canonical status and outcome disagree');
    }
    if (!outcome && TERMINAL_STATUSES.has(row.status as ParleyStatus)) {
      throw new Error('parley store poisoned row: terminal record has no outcome');
    }
    const seenRows = db.prepare(`
      SELECT r.actor_id, r.last_seen_turn_sequence, t.at AS last_seen_at
      FROM parley_seen_receipts r
      JOIN parley_turns t
        ON t.tenant_id = r.tenant_id
       AND t.harbor = r.harbor
       AND t.parley_id = r.parley_id
       AND t.turn_sequence = r.last_seen_turn_sequence
      WHERE r.tenant_id = ? AND r.harbor = ? AND r.parley_id = ?
      ORDER BY r.actor_id ASC
    `).all(tenantId, row.harbor, row.parley_id) as Array<{
      actor_id: string;
      last_seen_turn_sequence: number;
      last_seen_at: number;
    }>;
    const seen = new Map<string, StoredSeenReceipt>();
    for (const receipt of seenRows) {
      if (!Number.isSafeInteger(receipt.last_seen_turn_sequence)
        || receipt.last_seen_turn_sequence < 1
        || !Number.isSafeInteger(receipt.last_seen_at)) {
        throw new Error('parley store poisoned row: invalid seen turn frontier');
      }
      seen.set(receipt.actor_id, {
        lastSeenAt: receipt.last_seen_at,
        turnSequence: receipt.last_seen_turn_sequence,
      });
    }
    const deliveryOverflow = decodeDeliveryOverflow(db.prepare(`
      SELECT dropped_intents, batch_count, saw_turn, saw_escalation,
             evidence_hash, first_at, last_at, last_error
      FROM parley_notification_overflow_receipts
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
    `).get(tenantId, row.harbor, row.parley_id) as {
      dropped_intents: number;
      batch_count: number;
      saw_turn: number;
      saw_escalation: number;
      evidence_hash: string;
      first_at: number;
      last_at: number;
      last_error: string;
    } | undefined);
    return { parley, participants, turns, outcome, seen, deliveryOverflow, observedAt };
  }

  function createManual(input: ManualAdmissionInput): ParleyRecord {
    const at = assertFiniteTimestamp(now(), 'manual Parley admission time');
    if (input.parley.automatic !== null) {
      throw new Error('manual Parley admission cannot carry automatic metadata');
    }
    const ttlMs = input.responseTtlMs;
    if (ttlMs !== null
      && (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > PARLEY_STORE_LIMITS.maxTtlMs)) {
      throw new Error(`manual Parley responseTtlMs must be null or between 1 and ${PARLEY_STORE_LIMITS.maxTtlMs}`);
    }
    const responseDueAt = ttlMs === null ? null : at + ttlMs;
    if (responseDueAt !== null && !Number.isSafeInteger(responseDueAt)) {
      throw new Error('manual Parley response deadline exceeds timestamp capacity');
    }
    const record: ParleyRecord = {
      ...input.parley,
      createdAt: at,
      responseDueAt,
    };
    scope(record.harbor);
    const notifications = canonicalNotifications(input.notifications(record));
    const transaction = db.transaction(() => {
      assertQuotaAvailable(record.harbor, {
        retainedRecords: 1,
        retainedOutbox: notifications.length,
      });
      if (pendingOutboxCount(record.harbor) + notifications.length
        > PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor) {
        throw new Error(
          `parley notification outbox capacity ${PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor} reached`,
        );
      }
      insertRecord(record);
      fault('manual.record');
      insertParticipants(record, input.participants);
      fault('manual.participants');
      insertNotifications(record, notifications);
      fault('manual.outbox');
      return snapshotFromRow(getRecordRow(record.harbor, record.parleyId)!, at).parley;
    });
    return transaction();
  }

  function insertTerminalReceipt(
    harbor: string,
    signalId: string,
    state: AutomaticTerminalState,
    parleyId: string | null,
    decision: ParleyDecision,
    reason: string,
    at: number,
  ): boolean {
    assertCanonicalString(reason, 'automatic terminal reason', 4096);
    if (decision.signalId !== signalId) {
      throw new Error('automatic terminal decision signalId does not match its receipt');
    }
    const result = db.prepare(`
      INSERT INTO parley_auto_terminal_receipts (
        tenant_id, harbor, signal_id, terminal_state, parley_id,
        decision_json, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, harbor, signal_id) DO NOTHING
    `).run(tenantId, harbor, signalId, state, parleyId, json(decision), reason, at);
    if (changes(result) === 0) {
      const prior = db.prepare(`
        SELECT terminal_state, parley_id, decision_json, reason, created_at
        FROM parley_auto_terminal_receipts
        WHERE tenant_id = ? AND harbor = ? AND signal_id = ?
      `).get(tenantId, harbor, signalId) as ReceiptRow | undefined;
      if (!prior
        || prior.terminal_state !== state
        || prior.parley_id !== parleyId
        || prior.decision_json !== json(decision)
        || prior.reason !== reason) {
        throw new Error(`parley terminal receipt replay mismatch for ${signalId}`);
      }
      return false;
    }
    return true;
  }

  function readTerminalReceipt(harbor: string, signalId: string): ReceiptRow | null {
    const row = db.prepare(`
      SELECT terminal_state, parley_id, decision_json, reason, created_at
      FROM parley_auto_terminal_receipts
      WHERE tenant_id = ? AND harbor = ? AND signal_id = ?
    `).get(tenantId, harbor, signalId) as ReceiptRow | undefined;
    if (!row) return null;
    if (!isAutomaticTerminalState(row.terminal_state)) {
      throw new Error('parley store poisoned row: invalid automatic terminal state');
    }
    if ((row.terminal_state === 'fired') !== (row.parley_id !== null)) {
      throw new Error('parley store poisoned row: automatic terminal Parley reference is inconsistent');
    }
    if (row.parley_id !== null) {
      assertCanonicalString(row.parley_id, 'automatic terminal parley id', PARLEY_STORE_LIMITS.maxParleyIdChars);
    }
    assertFiniteTimestamp(row.created_at, 'automatic terminal receipt time');
    decodeParleyDecision(row.decision_json, signalId);
    return row;
  }

  function resultFromReceipt(harbor: string, receipt: ReceiptRow): AutomaticAdmissionResult {
    const parley = receipt.parley_id
      ? snapshotFromRow(
        getRecordRow(harbor, receipt.parley_id)
          ?? (() => { throw new Error('parley store poisoned row: terminal receipt references missing Parley'); })(),
        receipt.created_at,
      ).parley
      : null;
    return {
      terminalState: receipt.terminal_state as AutomaticTerminalState,
      replayed: true,
      parley,
      reason: receipt.reason,
      summonsInserted: 0,
      receiptInserted: false,
    };
  }

  function writeOutcome(
    row: RecordRow,
    input: {
      status: Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'>;
      decision: string | null;
      reason: string | null;
      resolvedBy: string;
      dissenters: string[];
      at: number;
    },
  ): { outcome: ParleyOutcome; inserted: boolean } {
    const observedAt = assertFiniteTimestamp(input.at, 'outcome server time');
    const latestTurn = db.prepare(`
      SELECT MAX(at) AS at FROM parley_turns
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
    `).get(tenantId, row.harbor, row.parley_id) as { at: number | null };
    const at = Math.max(observedAt, row.created_at, row.updated_at, latestTurn.at ?? 0);
    const retentionUntil = at + PARLEY_STORE_LIMITS.retentionMs;
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(retentionUntil)) {
      throw new Error('parley terminal clock exceeds timestamp capacity');
    }
    const resolvedBy = assertCanonicalString(input.resolvedBy, 'outcome resolvedBy', 128);
    const decision = input.decision === null
      ? null
      : assertCanonicalString(input.decision, 'outcome decision', PARLEY_STORE_LIMITS.maxDecisionChars);
    const reason = input.reason === null
      ? null
      : assertCanonicalString(input.reason, 'outcome reason', PARLEY_STORE_LIMITS.maxDecisionChars);
    const dissenters = canonicalStrings(
      input.dissenters,
      'outcome dissenter',
      PARLEY_STORE_LIMITS.maxParticipants,
      PARLEY_STORE_LIMITS.maxActorChars,
    );
    const result = db.prepare(`
      INSERT INTO parley_outcomes (
        tenant_id, harbor, parley_id, status, decision, reason,
        resolved_by, dissenters_json, at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, harbor, parley_id) DO NOTHING
    `).run(
      tenantId,
      row.harbor,
      row.parley_id,
      input.status,
      decision,
      reason,
      resolvedBy,
      json(dissenters),
      at,
    );
    if (changes(result) === 1) {
      const updated = db.prepare(`
        UPDATE parley_records
        SET status = ?, updated_at = ?, retention_until = ?
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
          AND status NOT IN ('COLLAPSED','ESCALATED','VOIDED')
      `).run(
        input.status,
        at,
        retentionUntil,
        tenantId,
        row.harbor,
        row.parley_id,
      );
      if (changes(updated) !== 1) {
        throw new Error('parley store poisoned row: terminal outcome could not advance its canonical record');
      }
      return {
        inserted: true,
        outcome: {
          parleyId: row.parley_id,
          status: input.status,
          decision,
          reason,
          resolvedBy,
          dissenters,
          at,
        },
      };
    }
    const prior = decodeOutcome(row.parley_id, db.prepare(`
      SELECT status, decision, reason, resolved_by, dissenters_json, at
      FROM parley_outcomes
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
    `).get(tenantId, row.harbor, row.parley_id) as OutcomeRow | undefined);
    if (!prior) throw new Error('parley store poisoned row: outcome conflict without outcome');
    return { outcome: prior, inserted: false };
  }

  function releaseAutomatic(row: RecordRow, at: number): void {
    if (!row.automatic_signal_id || !row.automatic_lineage_key) return;
    const lineage = db.prepare(`
      SELECT cooldown_ms
      FROM parley_lineage_cooldowns
      WHERE tenant_id = ? AND harbor = ? AND lineage_key = ?
        AND owner_signal_id = ?
    `).get(
      tenantId,
      row.harbor,
      row.automatic_lineage_key,
      row.automatic_signal_id,
    ) as { cooldown_ms: number } | undefined;
    if (!lineage
      || !Number.isSafeInteger(lineage.cooldown_ms)
      || lineage.cooldown_ms < 1
      || lineage.cooldown_ms > PARLEY_STORE_LIMITS.maxTtlMs) {
      throw new Error('parley store poisoned row: automatic lineage cooldown policy is missing or invalid');
    }
    const cooldownUntil = at + lineage.cooldown_ms;
    if (!Number.isSafeInteger(cooldownUntil)) {
      throw new Error('parley automatic lineage cooldown exceeds timestamp capacity');
    }
    db.prepare(`
      DELETE FROM parley_admissions
      WHERE tenant_id = ? AND harbor = ? AND signal_id = ?
    `).run(tenantId, row.harbor, row.automatic_signal_id);
    const released = db.prepare(`
      UPDATE parley_lineage_cooldowns
      SET state = 'cooldown', cooldown_until = ?
      WHERE tenant_id = ? AND harbor = ? AND lineage_key = ?
        AND owner_signal_id = ?
    `).run(
      cooldownUntil,
      tenantId,
      row.harbor,
      row.automatic_lineage_key,
      row.automatic_signal_id,
    );
    if (changes(released) !== 1) {
      throw new Error('parley store poisoned row: automatic lineage release lost its owner');
    }
  }

  function escalationNotifications(row: RecordRow, reason: string, at: number): ParleyNotificationIntent[] {
    return participantRows(row.harbor, row.parley_id)
      .map(decodeParticipant)
      .filter((participant) => participant.inboxTarget !== null)
      .map((participant) => ({
        deliveryKey: `parley-escalation:${row.parley_id}:${participant.actorId}`,
        recipientActorId: participant.actorId,
        inboxTarget: participant.inboxTarget!,
        fromActorId: 'port-daddy:parley',
        eventType: 'parley_escalation' as const,
        payload: {
          kind: 'parley_escalation',
          harbor: row.harbor,
          parleyId: row.parley_id,
          surface: row.surface,
          channel: row.channel,
          reason,
          at,
        },
      }));
  }

  function settleExpired(harbor: string, at: number): number {
    const expired = db.prepare(`
      SELECT * FROM parley_records
      WHERE tenant_id = ? AND harbor = ?
        AND status NOT IN ('COLLAPSED','ESCALATED','VOIDED')
        AND response_due_at IS NOT NULL AND response_due_at < ?
      ORDER BY response_due_at ASC, parley_id ASC
      LIMIT ?
    `).all(tenantId, harbor, at, PARLEY_STORE_LIMITS.reapBatch) as RecordRow[];
    let settled = 0;
    for (const row of expired) {
      const reason = 'response TTL expired without terminal outcome';
      const terminal = writeOutcome(row, {
        status: 'ESCALATED',
        decision: null,
        reason,
        resolvedBy: 'port-daddy:parley',
        dissenters: [],
        at,
      });
      if (!terminal.inserted) continue;
      releaseAutomatic(row, terminal.outcome.at);
      insertTerminalNotifications(
        decodeRecord(row),
        escalationNotifications(row, reason, terminal.outcome.at),
        terminal.outcome.at,
      );
      settled++;
    }
    return settled;
  }

  function settleOneExpired(
    harbor: string,
    parleyId: string,
    at: number,
  ): boolean {
    const row = getRecordRow(harbor, parleyId);
    if (!row
      || TERMINAL_STATUSES.has(row.status as ParleyStatus)
      || row.response_due_at === null
      || row.response_due_at >= at) {
      return false;
    }
    const reason = 'response TTL expired without terminal outcome';
    const terminal = writeOutcome(row, {
      status: 'ESCALATED',
      decision: null,
      reason,
      resolvedBy: 'port-daddy:parley',
      dissenters: [],
      at,
    });
    if (!terminal.inserted) return false;
    releaseAutomatic(row, terminal.outcome.at);
    insertTerminalNotifications(
      decodeRecord(row),
      escalationNotifications(row, reason, terminal.outcome.at),
      terminal.outcome.at,
    );
    return true;
  }

  function validateSignal(input: AutomaticAdmissionInput): {
    harbor: string;
    signalId: string;
    canonicalSignal: string;
    lineageKey: string;
    producerId: string;
    checkpoint: string;
    producerEventKey: string;
    producedAt: number;
    at: number;
  } {
    const harbor = scope(input.harbor);
    const expectedDecision = shouldConvene(input.signal, { mode: 'automatic' });
    if (!expectedDecision.policyCleared && !expectedDecision.terminated) {
      throw new Error(expectedDecision.reason);
    }
    const signalId = assertCanonicalString(
      input.signal.signalId,
      'automatic signalId',
      CONFLICT_SIGNAL_LIMITS.maxSignalIdChars,
    );
    const lineageKey = assertCanonicalString(input.lineageKey, 'automatic lineageKey', 192);
    const expectedSignalId = conflictSignalId({
      checkpoint: input.signal.checkpoint,
      kind: input.signal.kind,
      surface: input.signal.surface,
      parties: input.signal.parties,
      evidenceRefs: input.signal.evidenceRefs,
    });
    if (signalId !== expectedSignalId) {
      throw new Error('automatic signalId does not match its canonical structural identity');
    }
    const expectedLineageKey = parleySignalLineageKey(input.signal);
    if (lineageKey !== expectedLineageKey) {
      throw new Error('automatic lineageKey does not match its canonical signal lineage');
    }
    if (json(input.decision) !== json(expectedDecision)) {
      throw new Error('automatic decision does not match immutable server evaluation');
    }
    if ((expectedDecision.terminated !== null && input.terminalState !== 'suppressed')
      || (expectedDecision.terminated === null
        && !expectedDecision.convene
        && input.terminalState !== 'evaluated')
      || (expectedDecision.convene && input.terminalState === 'evaluated')) {
      throw new Error('automatic terminal state does not match immutable server evaluation');
    }
    if (!/^[a-f0-9]{64}$/.test(input.signalFingerprint)) {
      throw new Error('automatic signalFingerprint must be a lowercase SHA-256 digest');
    }
    if (!Number.isInteger(input.maxPendingGlobal) || input.maxPendingGlobal < 1 || input.maxPendingGlobal > 256) {
      throw new Error('automatic maxPendingGlobal must be between 1 and 256');
    }
    if (!Number.isInteger(input.maxPendingPerSurface)
      || input.maxPendingPerSurface < 1
      || input.maxPendingPerSurface > input.maxPendingGlobal) {
      throw new Error('automatic maxPendingPerSurface is invalid');
    }
    if (!Number.isSafeInteger(input.cooldownMs) || input.cooldownMs < 1 || input.cooldownMs > PARLEY_STORE_LIMITS.maxTtlMs) {
      throw new Error('automatic cooldownMs is invalid');
    }
    if (!input.signal?.provenance || input.signal.provenance.trustTier !== 'INTERNAL') {
      throw new Error('automatic signal provenance must be INTERNAL');
    }
    const producerId = assertCanonicalString(
      input.signal.provenance.producer,
      'automatic signal producer',
      128,
    );
    if (!(Object.values(CONFLICT_SIGNAL_PRODUCERS) as string[]).includes(producerId)) {
      throw new Error(`automatic signal producer '${producerId}' is unknown`);
    }
    const checkpoint = assertCanonicalString(input.signal.checkpoint, 'automatic signal checkpoint', 64);
    if (!(PARLEY_CHECKPOINTS as readonly string[]).includes(checkpoint)) {
      throw new Error(`automatic signal checkpoint '${checkpoint}' is unknown`);
    }
    const producedAt = assertFiniteTimestamp(
      input.signal.provenance.producedAt,
      'automatic signal producedAt',
    );
    if (producedAt === 0) throw new Error('automatic signal producedAt must be positive');
    const canonicalParties = canonicalStrings(
      input.signal.parties as string[],
      'automatic signal party',
      CONFLICT_SIGNAL_LIMITS.maxParties,
      CONFLICT_SIGNAL_LIMITS.maxPartyChars,
    );
    const canonicalEvidenceRefs = canonicalStrings(
      input.signal.evidenceRefs as string[],
      'automatic signal evidence',
      CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs,
      CONFLICT_SIGNAL_LIMITS.maxEvidenceRefChars,
    );
    if (json(canonicalParties) !== json(input.signal.parties)
      || json(canonicalEvidenceRefs) !== json(input.signal.evidenceRefs)
      || input.signal.surface !== input.signal.surface.trim()
      || input.signal.reason !== input.signal.reason.trim()) {
      throw new Error('automatic signal must use canonical ordered strings');
    }
    const canonicalSignal = json(input.signal);
    if (Buffer.byteLength(canonicalSignal, 'utf8') > PARLEY_STORE_LIMITS.maxOutboxPayloadBytes) {
      throw new Error('automatic canonical signal exceeds storage capacity');
    }
    if (hash(canonicalSignal) !== input.signalFingerprint) {
      throw new Error('automatic signalFingerprint does not match canonical signal content');
    }
    if (input.terminalState === 'fired') {
      if (!input.parley) throw new Error('fired automatic admission requires a Parley');
      if (typeof input.notifications !== 'function') {
        throw new Error('fired automatic admission requires a notification factory');
      }
      if (input.parley.harbor !== harbor) throw new Error('automatic Parley harbor does not match admission scope');
      if (input.parley.automatic?.signalId !== signalId
        || input.parley.automatic.lineageKey !== lineageKey) {
        throw new Error('automatic Parley metadata does not match canonical signal reservation');
      }
    } else if (input.parley !== null || input.notifications !== null || input.participants.length !== 0) {
      throw new Error('non-fired automatic admission cannot create a Parley, participants, or notifications');
    }
    const at = assertFiniteTimestamp(now(), 'automatic admission time');
    return {
      harbor,
      signalId,
      canonicalSignal,
      lineageKey,
      producerId,
      checkpoint,
      producerEventKey: hash(json([producerId, checkpoint, signalId])),
      producedAt,
      at,
    };
  }

  function assertFreshSignal(input: ReturnType<typeof validateSignal>): void {
    const oldest = Math.max(0, input.at - PARLEY_SIGNAL_FRESHNESS.maxSignalAgeMs);
    const newest = input.at + PARLEY_SIGNAL_FRESHNESS.maxFutureClockSkewMs;
    if (!Number.isSafeInteger(newest)) {
      throw new Error('automatic admission clock exceeds timestamp capacity');
    }
    if (input.producedAt < oldest) {
      throw new Error(
        `automatic signal is older than the server freshness window ${PARLEY_SIGNAL_FRESHNESS.maxSignalAgeMs}ms`,
      );
    }
    if (input.producedAt > newest) {
      throw new Error(
        `automatic signal is future-dated beyond server clock skew ${PARLEY_SIGNAL_FRESHNESS.maxFutureClockSkewMs}ms`,
      );
    }
  }

  function terminalAutomaticResult(
    harbor: string,
    signalId: string,
    state: AutomaticTerminalState,
    decision: ParleyDecision,
    reason: string,
    at: number,
    parley: ParleyRecord | null = null,
    summonsInserted = 0,
  ): AutomaticAdmissionResult {
    const receiptInserted = insertTerminalReceipt(
      harbor,
      signalId,
      state,
      parley?.parleyId ?? null,
      decision,
      reason,
      at,
    );
    fault('automatic.receipt');
    return {
      terminalState: state,
      replayed: false,
      parley,
      reason,
      summonsInserted,
      receiptInserted,
    };
  }

  function findAvailableSlot(harbor: string, dimension: string, capacity: number): number | null {
    const rows = db.prepare(`
      SELECT slot, signal_id, parley_id
      FROM parley_admissions
      WHERE tenant_id = ? AND harbor = ? AND dimension = ?
      ORDER BY slot ASC
    `).all(tenantId, harbor, dimension) as Array<{ slot: number; signal_id: string; parley_id: string }>;
    const occupied = new Set<number>();
    for (const row of rows) {
      if (!Number.isInteger(row.slot) || row.slot < 0 || row.slot >= capacity) {
        throw new Error('parley store poisoned row: admission slot is outside policy capacity');
      }
      const owner = getRecordRow(harbor, row.parley_id);
      if (!owner || owner.automatic_signal_id !== row.signal_id) {
        throw new Error('parley store poisoned row: admission owner is inconsistent');
      }
      if (TERMINAL_STATUSES.has(owner.status as ParleyStatus)) {
        throw new Error('parley store poisoned row: terminal Parley still owns admission capacity');
      }
      occupied.add(row.slot);
    }
    for (let slot = 0; slot < capacity; slot++) {
      if (!occupied.has(slot)) return slot;
    }
    return null;
  }

  function lineageSuppression(
    harbor: string,
    lineageKey: string,
    signalId: string,
    at: number,
  ): string | null {
    const row = db.prepare(`
      SELECT owner_signal_id, owner_parley_id, state, reserved_at,
             cooldown_ms, cooldown_until
      FROM parley_lineage_cooldowns
      WHERE tenant_id = ? AND harbor = ? AND lineage_key = ?
    `).get(tenantId, harbor, lineageKey) as LineageRow | undefined;
    if (!row) return null;
    if (row.state !== 'active' && row.state !== 'cooldown') {
      throw new Error('parley store poisoned row: invalid lineage state');
    }
    if (!Number.isSafeInteger(row.reserved_at)
      || !Number.isSafeInteger(row.cooldown_ms)
      || row.cooldown_ms < 1
      || row.cooldown_ms > PARLEY_STORE_LIMITS.maxTtlMs
      || !Number.isSafeInteger(row.cooldown_until)) {
      throw new Error('parley store poisoned row: invalid lineage timing policy');
    }
    if (row.owner_signal_id === signalId) {
      throw new Error('parley store poisoned row: signal reservation exists without terminal receipt');
    }
    if (row.state === 'active') {
      const owner = row.owner_parley_id ? getRecordRow(harbor, row.owner_parley_id) : undefined;
      if (owner && !TERMINAL_STATUSES.has(owner.status as ParleyStatus)) {
        return `pending automatic Parley ${owner.parley_id} already owns this lineage`;
      }
      if (owner && TERMINAL_STATUSES.has(owner.status as ParleyStatus)) {
        const outcome = db.prepare(`
          SELECT at FROM parley_outcomes
          WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
        `).get(tenantId, harbor, owner.parley_id) as { at: number } | undefined;
        if (!outcome) throw new Error('parley store poisoned row: terminal lineage owner has no outcome');
        row.cooldown_until = outcome.at + row.cooldown_ms;
        if (!Number.isSafeInteger(row.cooldown_until)) {
          throw new Error('parley store poisoned row: lineage cooldown exceeds timestamp capacity');
        }
        db.prepare(`
          UPDATE parley_lineage_cooldowns
          SET state = 'cooldown', cooldown_until = ?
          WHERE tenant_id = ? AND harbor = ? AND lineage_key = ?
        `).run(row.cooldown_until, tenantId, harbor, lineageKey);
      } else if (at - row.reserved_at < row.cooldown_ms) {
        return `pending automatic signal ${row.owner_signal_id} already owns this lineage`;
      } else {
        db.prepare(`
          DELETE FROM parley_lineage_cooldowns
          WHERE tenant_id = ? AND harbor = ? AND lineage_key = ?
        `).run(tenantId, harbor, lineageKey);
        return null;
      }
    }
    if (at < row.cooldown_until) {
      return `automatic Parley lineage is within cooldown until ${row.cooldown_until}`;
    }
    db.prepare(`
      DELETE FROM parley_lineage_cooldowns
      WHERE tenant_id = ? AND harbor = ? AND lineage_key = ?
    `).run(tenantId, harbor, lineageKey);
    return null;
  }

  /**
   * Join automatic admission to an already-open transaction on this exact DB.
   * This method never publishes notifications. Calling the ordinary admission
   * method from an owning transaction is forbidden because its post-savepoint
   * return is not an outer commit boundary.
   */
  function admitAutomaticInTransaction(input: AutomaticAdmissionInput): AutomaticAdmissionResult {
    if (!db.inTransaction) {
      throw new Error('automatic admission transaction seam requires an active owning SQLite transaction');
    }
    const validated = validateSignal(input);
    const existing = db.prepare(`
      SELECT signal_fingerprint, canonical_signal_json, lineage_key,
             producer_id, checkpoint, producer_event_key, produced_at,
             created_at, expires_at
      FROM parley_auto_signals
      WHERE tenant_id = ? AND harbor = ? AND signal_id = ?
    `).get(tenantId, validated.harbor, validated.signalId) as SignalRow | undefined;
    if (existing) {
      if (existing.signal_fingerprint !== input.signalFingerprint
        || existing.canonical_signal_json !== validated.canonicalSignal
        || existing.lineage_key !== validated.lineageKey
        || existing.producer_id !== validated.producerId
        || existing.checkpoint !== validated.checkpoint
        || existing.producer_event_key !== validated.producerEventKey
        || existing.produced_at !== validated.producedAt) {
        throw new Error('automatic signal replay mismatch: signalId was used for different canonical input');
      }
      const receipt = readTerminalReceipt(validated.harbor, validated.signalId);
      if (!receipt) {
        throw new Error('parley store poisoned row: automatic signal has no terminal evaluation receipt');
      }
      return resultFromReceipt(validated.harbor, receipt);
    }

    assertFreshSignal(validated);
    assertQuotaAvailable(validated.harbor, { retainedSignals: 1 });
    const expiresAt = validated.at + PARLEY_SIGNAL_FRESHNESS.dedupeTombstoneMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new Error('automatic signal tombstone exceeds timestamp capacity');
    }
    const automaticResponseDueAt = validated.at + PARLEY_STORE_POLICY.automaticResponseTtlMs;
    if (!Number.isSafeInteger(automaticResponseDueAt)) {
      throw new Error('automatic Parley response deadline exceeds timestamp capacity');
    }
    const parleyRecord: ParleyRecord | null = input.parley === null ? null : {
      ...input.parley,
      status: 'SUMMONED',
      responseDueAt: automaticResponseDueAt,
      roundLimit: PARLEY_STORE_POLICY.automaticRoundLimit,
      createdAt: validated.at,
    };
    const admissionNotifications = parleyRecord && input.notifications
      ? canonicalNotifications(input.notifications(parleyRecord))
      : [];
    settleExpired(validated.harbor, validated.at);

      db.prepare(`
        INSERT INTO parley_auto_signals (
          tenant_id, harbor, signal_id, signal_fingerprint,
          canonical_signal_json, lineage_key, producer_id, checkpoint,
          producer_event_key, produced_at, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        validated.harbor,
        validated.signalId,
        input.signalFingerprint,
        validated.canonicalSignal,
        validated.lineageKey,
        validated.producerId,
        validated.checkpoint,
        validated.producerEventKey,
        validated.producedAt,
        validated.at,
        expiresAt,
      );
      fault('automatic.signal');

      if (input.terminalState !== 'fired') {
        return terminalAutomaticResult(
          validated.harbor,
          validated.signalId,
          input.terminalState,
          input.decision,
          input.reason,
          validated.at,
        );
      }

      const lineageReason = lineageSuppression(
        validated.harbor,
        validated.lineageKey,
        validated.signalId,
        validated.at,
      );
      if (lineageReason) {
        return terminalAutomaticResult(
          validated.harbor,
          validated.signalId,
          'suppressed',
          input.decision,
          lineageReason,
          validated.at,
        );
      }

      const surfaceDimension = `surface:${hash(parleyRecord!.surface)}`;
      const surfaceSlot = findAvailableSlot(
        validated.harbor,
        surfaceDimension,
        input.maxPendingPerSurface,
      );
      if (surfaceSlot === null) {
        return terminalAutomaticResult(
          validated.harbor,
          validated.signalId,
          'suppressed',
          input.decision,
          `automatic Parley surface cap ${input.maxPendingPerSurface} reached`,
          validated.at,
        );
      }
      const globalSlot = findAvailableSlot(
        validated.harbor,
        'global',
        input.maxPendingGlobal,
      );
      if (globalSlot === null) {
        return terminalAutomaticResult(
          validated.harbor,
          validated.signalId,
          'suppressed',
          input.decision,
          `automatic Parley global cap ${input.maxPendingGlobal} reached`,
          validated.at,
        );
      }

      assertQuotaAvailable(validated.harbor, {
        retainedRecords: 1,
        retainedOutbox: admissionNotifications.length,
      });
      if (pendingOutboxCount(validated.harbor) + admissionNotifications.length
        > PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor) {
        throw new Error(
          `parley notification outbox capacity ${PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor} reached`,
        );
      }
      const initialCooldownUntil = validated.at + input.cooldownMs;
      if (!Number.isSafeInteger(initialCooldownUntil)) {
        throw new Error('parley automatic lineage cooldown exceeds timestamp capacity');
      }

      db.prepare(`
        INSERT INTO parley_lineage_cooldowns (
          tenant_id, harbor, lineage_key, owner_signal_id, owner_parley_id,
          state, reserved_at, cooldown_ms, cooldown_until
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(
        tenantId,
        validated.harbor,
        validated.lineageKey,
        validated.signalId,
        parleyRecord!.parleyId,
        validated.at,
        input.cooldownMs,
        initialCooldownUntil,
      );
      fault('automatic.lineage');

      insertRecord(parleyRecord!);
      fault('automatic.record');
      const participants: StoredParleyParticipant[] = input.participants.map((participant) => ({
        actorId: participant.actorId,
        inboxTarget: participant.inboxTarget,
        sessionId: participant.sessionId,
        lineageRootSessionId: participant.lineageRootSessionId,
        summoned: true,
        caller: participant.actorId === parleyRecord!.calledBy,
      }));
      if (!participants.some((participant) => participant.caller)) {
        participants.push({
          actorId: parleyRecord!.calledBy,
          inboxTarget: null,
          sessionId: null,
          lineageRootSessionId: null,
          summoned: false,
          caller: true,
        });
      }
      insertParticipants(parleyRecord!, participants);
      fault('automatic.participants');

      db.prepare(`
        INSERT INTO parley_admissions (
          tenant_id, harbor, dimension, slot, signal_id, parley_id, reserved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        validated.harbor,
        surfaceDimension,
        surfaceSlot,
        validated.signalId,
        parleyRecord!.parleyId,
        validated.at,
      );
      fault('automatic.surface-admission');
      db.prepare(`
        INSERT INTO parley_admissions (
          tenant_id, harbor, dimension, slot, signal_id, parley_id, reserved_at
        ) VALUES (?, ?, 'global', ?, ?, ?, ?)
      `).run(
        tenantId,
        validated.harbor,
        globalSlot,
        validated.signalId,
        parleyRecord!.parleyId,
        validated.at,
      );
      fault('automatic.global-admission');

      const summonsInserted = insertNotifications(parleyRecord!, admissionNotifications);
      fault('automatic.outbox');
      return terminalAutomaticResult(
        validated.harbor,
        validated.signalId,
        'fired',
        input.decision,
        input.reason,
        validated.at,
        snapshotFromRow(getRecordRow(validated.harbor, parleyRecord!.parleyId)!, validated.at).parley,
        summonsInserted,
      );
  }

  function admitAutomatic(input: AutomaticAdmissionInput): AutomaticAdmissionResult {
    if (db.inTransaction) {
      throw new Error(
        'automatic admission inside an owning transaction must use admitAutomaticInTransaction',
      );
    }
    return db.transaction(() => admitAutomaticInTransaction(input)).immediate();
  }

  function getSnapshot(harborInput: string, parleyId: string): ParleyStoreSnapshot | null {
    const harbor = scope(harborInput);
    const at = assertFiniteTimestamp(now(), 'parley read time');
    const transaction = db.transaction(() => {
      settleOneExpired(harbor, parleyId, at);
      const row = getRecordRow(harbor, parleyId);
      return row ? snapshotFromRow(row, at) : null;
    });
    return transaction();
  }

  function getAutomatic(signalIdInput: string, harborInput: string): AutomaticParleyLifecycle | null {
    const harbor = scope(harborInput);
    const signalId = assertCanonicalString(
      signalIdInput,
      'automatic signalId',
      CONFLICT_SIGNAL_LIMITS.maxSignalIdChars,
    );
    const at = assertFiniteTimestamp(now(), 'automatic read time');
    const transaction = db.transaction(() => {
      const signal = db.prepare(`
        SELECT 1 AS present
        FROM parley_auto_signals
        WHERE tenant_id = ? AND harbor = ? AND signal_id = ?
      `).get(tenantId, harbor, signalId) as { present: number } | undefined;
      if (!signal) return null;
      const receipt = readTerminalReceipt(harbor, signalId);
      if (!receipt) throw new Error('parley store poisoned row: automatic signal has no terminal receipt');
      if (!receipt.parley_id) return null;
      settleOneExpired(harbor, receipt.parley_id, at);
      const row = getRecordRow(harbor, receipt.parley_id);
      if (!row) throw new Error('parley store poisoned row: automatic receipt references missing Parley');
      const snapshot = snapshotFromRow(row, at);
      return { parley: snapshot.parley, status: snapshot.outcome?.status ?? snapshot.parley.status };
    });
    return transaction();
  }

  function list(input: {
    harbor: string;
    status?: ParleyStatus;
    limit?: number;
    before?: { createdAt: number; parleyId: string };
  }): ParleyStoreSnapshot[] {
    const harbor = scope(input.harbor);
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > PARLEY_STORE_LIMITS.maxListPage) {
      throw new Error(`parley list limit must be between 1 and ${PARLEY_STORE_LIMITS.maxListPage}`);
    }
    if (input.status && input.status !== 'SUMMONED' && input.status !== 'CONVENED'
      && input.status !== 'COLLAPSED' && input.status !== 'ESCALATED' && input.status !== 'VOIDED') {
      throw new Error('parley list status is invalid');
    }
    const at = assertFiniteTimestamp(now(), 'parley list time');
    const transaction = db.transaction(() => {
      settleExpired(harbor, at);
      const clauses = ['tenant_id = ?', 'harbor = ?'];
      const params: unknown[] = [tenantId, harbor];
      if (input.status) {
        clauses.push('status = ?');
        params.push(input.status);
      }
      if (input.before) {
        const createdAt = assertFiniteTimestamp(input.before.createdAt, 'parley page cursor time');
        const parleyId = assertCanonicalString(
          input.before.parleyId,
          'parley page cursor id',
          PARLEY_STORE_LIMITS.maxParleyIdChars,
        );
        clauses.push('(created_at < ? OR (created_at = ? AND parley_id < ?))');
        params.push(createdAt, createdAt, parleyId);
      }
      params.push(limit);
      const rows = db.prepare(`
        SELECT * FROM parley_records
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, parley_id DESC
        LIMIT ?
      `).all(...params) as RecordRow[];
      return rows.map((row) => snapshotFromRow(row, at));
    });
    return transaction();
  }

  function addTurn(input: AddTurnInput): AddTurnResult {
    const harbor = scope(input.harbor);
    const parleyId = assertCanonicalString(input.parleyId, 'parley id', PARLEY_STORE_LIMITS.maxParleyIdChars);
    const party = assertCanonicalString(input.party, 'parley turn party', PARLEY_STORE_LIMITS.maxActorChars);
    if (!PERFORMATIVES.has(input.performative)) throw new Error('parley turn performative is invalid');
    const content = assertCanonicalString(
      input.content,
      'parley turn content',
      PARLEY_STORE_LIMITS.maxTurnContentChars,
    );
    const proposalId = input.proposalId === null
      ? null
      : assertCanonicalString(input.proposalId, 'parley proposalId', PARLEY_STORE_LIMITS.maxProposalIdChars);
    const evidenceRefs = canonicalStrings(
      input.evidenceRefs,
      'parley turn evidence',
      CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs,
      CONFLICT_SIGNAL_LIMITS.maxEvidenceRefChars,
    );
    if (Object.prototype.hasOwnProperty.call(input, 'at')) {
      throw new Error('parley turns do not accept caller-owned timestamps');
    }
    const idempotencyKey = assertCanonicalString(
      input.idempotencyKey,
      'parley turn idempotencyKey',
      256,
    );
    if (!/^[a-f0-9]{64}$/.test(input.intentFingerprint)) {
      throw new Error('parley turn intentFingerprint must be a lowercase SHA-256 digest');
    }
    const expectedFingerprint = hash(json({
      parleyId,
      party,
      performative: input.performative,
      content,
      proposalId,
      evidenceRefs,
    }));
    if (input.intentFingerprint !== expectedFingerprint) {
      throw new Error('parley turn intentFingerprint does not match canonical turn content');
    }
    const automaticConsensus = input.automaticConsensus
      ? {
        proposalId: assertCanonicalString(
          input.automaticConsensus.proposalId,
          'automatic consensus proposalId',
          PARLEY_STORE_LIMITS.maxProposalIdChars,
        ),
        decision: assertCanonicalString(
          input.automaticConsensus.decision,
          'automatic consensus decision',
          PARLEY_STORE_LIMITS.maxDecisionChars,
        ),
        reason: assertCanonicalString(
          input.automaticConsensus.reason,
          'automatic consensus reason',
          PARLEY_STORE_LIMITS.maxDecisionChars,
        ),
        finalize: input.automaticConsensus.finalize,
        notifications: input.automaticConsensus.notifications,
      }
      : null;
    if (automaticConsensus && (input.performative !== 'agree' || proposalId !== automaticConsensus.proposalId)) {
      throw new Error('automatic consensus requires an agree turn with its canonical proposalId');
    }
    const at = assertFiniteTimestamp(now(), 'parley turn time');
    const transaction = db.transaction((): AddTurnResult => {
      const existingTurn = db.prepare(`
        SELECT turn_sequence, party, idempotency_key, intent_fingerprint,
               performative, content, proposal_id, evidence_json,
               delivery_keys_json, at
        FROM parley_turns
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
          AND party = ? AND idempotency_key = ?
      `).get(tenantId, harbor, parleyId, party, idempotencyKey) as TurnRow | undefined;
      if (existingTurn) {
        const storedEvidence = canonicalStrings(
          parseJson<string[]>(existingTurn.evidence_json, 'turn evidence JSON'),
          'stored turn evidence',
          CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs,
          CONFLICT_SIGNAL_LIMITS.maxEvidenceRefChars,
        );
        const storedFingerprint = hash(json({
          parleyId,
          party: existingTurn.party,
          performative: existingTurn.performative,
          content: existingTurn.content,
          proposalId: existingTurn.proposal_id,
          evidenceRefs: storedEvidence,
        }));
        if (existingTurn.intent_fingerprint !== storedFingerprint
          || existingTurn.intent_fingerprint !== input.intentFingerprint) {
          throw new Error('parley turn idempotency replay mismatch');
        }
        const deliveryKeys = canonicalStrings(
          parseJson<string[]>(existingTurn.delivery_keys_json, 'turn delivery keys JSON'),
          'stored turn delivery key',
          PARLEY_STORE_LIMITS.maxParticipants + 1,
          512,
        );
        return {
          turn: decodeTurn(parleyId, existingTurn),
          turnSequence: existingTurn.turn_sequence,
          deliveryKeys,
          escalatedReason: null,
          replayed: true,
        };
      }
      let row = getRecordRow(harbor, parleyId);
      if (!row) throw new Error(`parley '${parleyId}' not found in harbor '${harbor}'`);
      const participant = db.prepare(`
        SELECT summoned FROM parley_participants
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND actor_id = ?
      `).get(tenantId, harbor, parleyId, party) as { summoned: number } | undefined;
      if (!participant || participant.summoned !== 1) {
        throw new Error(`party '${party}' was not summoned`);
      }
      settleOneExpired(harbor, parleyId, at);
      row = getRecordRow(harbor, parleyId)!;
      const existingOutcome = decodeOutcome(parleyId, db.prepare(`
        SELECT status, decision, reason, resolved_by, dissenters_json, at
        FROM parley_outcomes
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
      `).get(tenantId, harbor, parleyId) as OutcomeRow | undefined);
      if (existingOutcome) {
        return {
          turn: null,
          turnSequence: null,
          deliveryKeys: [],
          escalatedReason: `parley is already ${existingOutcome.status}`,
          replayed: false,
        };
      }
      if (BUDGETED_PERFORMATIVES.has(input.performative)) {
        const used = db.prepare(`
          SELECT COUNT(*) AS count FROM parley_turns
          WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND party = ?
            AND performative IN ('propose','critique','revise','inform')
        `).get(tenantId, harbor, parleyId, party) as { count: number };
        if (Number(used.count) >= row.round_limit) {
          const reason = `round limit exhausted for ${party}`;
          const terminal = writeOutcome(row, {
            status: 'ESCALATED',
            decision: null,
            reason,
            resolvedBy: 'port-daddy:parley',
            dissenters: [party],
            at,
          });
          fault('terminal.outcome');
          if (terminal.inserted) {
            releaseAutomatic(row, terminal.outcome.at);
            fault('terminal.release');
            insertTerminalNotifications(
              decodeRecord(row),
              escalationNotifications(row, reason, terminal.outcome.at),
              terminal.outcome.at,
            );
          }
          return {
            turn: null,
            turnSequence: null,
            deliveryKeys: [],
            escalatedReason: reason,
            replayed: false,
          };
        }
      }
      const count = db.prepare(`
        SELECT COUNT(*) AS count FROM parley_turns
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
      `).get(tenantId, harbor, parleyId) as { count: number };
      if (Number(count.count) >= PARLEY_STORE_LIMITS.maxTurnsPerParley) {
        throw new Error(`parley turn capacity ${PARLEY_STORE_LIMITS.maxTurnsPerParley} reached`);
      }
      const last = db.prepare(`
        SELECT turn_sequence, at
        FROM parley_turns
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
        ORDER BY turn_sequence DESC
        LIMIT 1
      `).get(tenantId, harbor, parleyId) as { turn_sequence: number; at: number } | undefined;
      if (last && at < last.at) {
        throw new Error('parley turn time cannot precede the durable turn frontier');
      }
      const nextSequence = (last?.turn_sequence ?? 0) + 1;
      if (!Number.isSafeInteger(nextSequence)) {
        throw new Error('parley turn sequence exceeds integer capacity');
      }
      const turn: ParleyTurn = {
        parleyId,
        party,
        performative: input.performative,
        content,
        proposalId,
        evidenceRefs,
        at,
      };
      const notifications = canonicalNotifications(input.notifications(nextSequence, at));
      const deliveryKeys = notifications.map((notification) => notification.deliveryKey).sort();
      assertQuotaAvailable(harbor, {
        retainedTurns: 1,
        retainedOutbox: input.performative === 'refuse' ? 0 : notifications.length,
      });
      if (input.performative !== 'refuse'
        && pendingOutboxCount(harbor) + notifications.length
          > PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor) {
        throw new Error(
          `parley notification outbox capacity ${PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor} reached`,
        );
      }
      db.prepare(`
        INSERT INTO parley_turns (
          tenant_id, harbor, parley_id, turn_sequence, party,
          idempotency_key, intent_fingerprint, performative,
          content, proposal_id, evidence_json, delivery_keys_json, at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        harbor,
        parleyId,
        nextSequence,
        party,
        idempotencyKey,
        input.intentFingerprint,
        input.performative,
        content,
        proposalId,
        json(evidenceRefs),
        json(deliveryKeys),
        at,
      );
      fault('turn.record');
      const insertedNotifications = input.performative === 'refuse'
        ? insertTerminalNotifications(decodeRecord(row), notifications, at)
        : insertNotifications(decodeRecord(row), notifications, at);
      if (insertedNotifications !== notifications.length) {
        throw new Error('parley turn notification keys collided with prior payloads');
      }
      fault('turn.outbox');

      if (input.performative === 'refuse') {
        const reason = `${party} refused the Parley`;
        const terminal = writeOutcome(row, {
          status: 'ESCALATED',
          decision: null,
          reason,
          resolvedBy: 'port-daddy:parley',
          dissenters: [party],
          at,
        });
        fault('terminal.outcome');
        if (terminal.inserted) {
          releaseAutomatic(row, terminal.outcome.at);
          fault('terminal.release');
          insertTerminalNotifications(
            decodeRecord(row),
            escalationNotifications(row, reason, terminal.outcome.at),
            terminal.outcome.at,
          );
        }
      } else {
        if (automaticConsensus) {
          if (row.automatic_origin !== 'sugar-parley'
            || row.automatic_checkpoint !== 'session_begin'
            || row.automatic_kind !== 'task_convergence') {
            throw new Error('automatic consensus is only available to card-derived Sugar session_begin task_convergence Parleys');
          }
          const agreements = db.prepare(`
            SELECT p.actor_id, t.performative, t.proposal_id, t.content
            FROM parley_participants p
            LEFT JOIN parley_turns t
              ON t.tenant_id = p.tenant_id
              AND t.harbor = p.harbor
              AND t.parley_id = p.parley_id
              AND t.party = p.actor_id
              AND t.turn_sequence = (
                SELECT MAX(latest.turn_sequence)
                FROM parley_turns latest
                WHERE latest.tenant_id = p.tenant_id
                  AND latest.harbor = p.harbor
                  AND latest.parley_id = p.parley_id
                  AND latest.party = p.actor_id
              )
            WHERE p.tenant_id = ? AND p.harbor = ? AND p.parley_id = ? AND p.summoned = 1
            ORDER BY p.actor_id ASC
          `).all(tenantId, harbor, parleyId) as Array<{
            actor_id: string;
            performative: string | null;
            proposal_id: string | null;
            content: string | null;
          }>;
          const unanimous = agreements.length >= 2
            && agreements.every((agreement) => (
              agreement.performative === 'agree'
              && agreement.proposal_id === automaticConsensus.proposalId
              && agreement.content === content
            ));
          if (unanimous) {
            const terminal = writeOutcome(row, {
              status: 'COLLAPSED',
              decision: automaticConsensus.decision,
              reason: automaticConsensus.reason,
              resolvedBy: 'port-daddy:sugar-parley-consensus',
              dissenters: [],
              at,
            });
            fault('terminal.outcome');
            if (terminal.inserted) {
              releaseAutomatic(row, terminal.outcome.at);
              fault('terminal.release');
              // `decodeRecord()` intentionally leaves automatic participants
              // empty because the durable participant rows are a separate
              // authority. The typed terminal receipt must include every
              // live party, so reload the canonical snapshot before asking
              // the callback to address its outbox messages.
              const terminalRecord = snapshotFromRow(
                getRecordRow(harbor, parleyId)
                  ?? (() => { throw new Error('parley store lost the settled record'); })(),
                terminal.outcome.at,
              ).parley;
              const finalization = automaticConsensus.finalize(terminalRecord, terminal.outcome);
              insertTerminalNotifications(
                terminalRecord,
                automaticConsensus.notifications(terminalRecord, terminal.outcome, finalization),
                terminal.outcome.at,
              );
            }
          }
        }
        const missing = db.prepare(`
          SELECT COUNT(*) AS count
          FROM parley_participants p
          WHERE p.tenant_id = ? AND p.harbor = ? AND p.parley_id = ? AND p.summoned = 1
            AND NOT EXISTS (
              SELECT 1 FROM parley_turns t
              WHERE t.tenant_id = p.tenant_id AND t.harbor = p.harbor
                AND t.parley_id = p.parley_id AND t.party = p.actor_id
            )
        `).get(tenantId, harbor, parleyId) as { count: number };
        if (Number(missing.count) === 0) {
          db.prepare(`
            UPDATE parley_records SET status = 'CONVENED', updated_at = ?
            WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND status = 'SUMMONED'
          `).run(at, tenantId, harbor, parleyId);
        }
      }
      return {
        turn,
        turnSequence: nextSequence,
        deliveryKeys,
        escalatedReason: null,
        replayed: false,
      };
    });
    return transaction();
  }

  function markSeen(input: {
    harbor: string;
    parleyId: string;
    actorId: string;
    throughTurnSequence?: number;
  }): StoredSeenReceipt {
    if (Object.prototype.hasOwnProperty.call(input, 'throughAt')) {
      throw new Error('parley receipt timestamp watermarks are not accepted; use throughTurnSequence');
    }
    const harbor = scope(input.harbor);
    const parleyId = assertCanonicalString(input.parleyId, 'parley id', PARLEY_STORE_LIMITS.maxParleyIdChars);
    const actorId = assertCanonicalString(input.actorId, 'parley receipt actor', PARLEY_STORE_LIMITS.maxActorChars);
    const requestedSequence = input.throughTurnSequence;
    if (requestedSequence !== undefined
      && (!Number.isSafeInteger(requestedSequence) || requestedSequence < 0)) {
      throw new Error('parley receipt throughTurnSequence must be a non-negative safe integer');
    }
    const updatedAt = assertFiniteTimestamp(now(), 'parley receipt update time');
    const transaction = db.transaction(() => {
      const participant = db.prepare(`
        SELECT 1 AS present FROM parley_participants
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND actor_id = ?
      `).get(tenantId, harbor, parleyId, actorId) as { present: number } | undefined;
      if (!participant) throw new Error(`'${actorId}' is not part of parley '${parleyId}' in harbor '${harbor}'`);
      const frontierRow = db.prepare(`
        SELECT COALESCE(MAX(turn_sequence), 0) AS turn_sequence
        FROM parley_turns
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
      `).get(tenantId, harbor, parleyId) as {
        turn_sequence: number;
      };
      if (!Number.isSafeInteger(frontierRow.turn_sequence) || frontierRow.turn_sequence < 0) {
        throw new Error('parley store poisoned row: invalid durable turn frontier');
      }
      const throughTurnSequence = requestedSequence ?? frontierRow.turn_sequence;
      if (throughTurnSequence > frontierRow.turn_sequence) {
        throw new Error(
          `parley receipt throughTurnSequence ${throughTurnSequence} exceeds durable turn frontier ${frontierRow.turn_sequence}`,
        );
      }
      if (throughTurnSequence > 0) {
        const exactTurn = db.prepare(`
          SELECT 1 AS present
          FROM parley_turns
          WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND turn_sequence = ?
        `).get(tenantId, harbor, parleyId, throughTurnSequence) as { present: number } | undefined;
        if (!exactTurn) {
          throw new Error('parley store poisoned row: requested durable turn sequence is missing');
        }
      }
      settleOneExpired(harbor, parleyId, updatedAt);
      if (throughTurnSequence > 0) {
        db.prepare(`
          INSERT INTO parley_seen_receipts (
            tenant_id, harbor, parley_id, actor_id,
            last_seen_turn_sequence, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant_id, harbor, parley_id, actor_id) DO UPDATE SET
            last_seen_turn_sequence = MAX(
              parley_seen_receipts.last_seen_turn_sequence,
              excluded.last_seen_turn_sequence
            ),
            updated_at = CASE
              WHEN excluded.last_seen_turn_sequence > parley_seen_receipts.last_seen_turn_sequence
                THEN excluded.updated_at
              ELSE parley_seen_receipts.updated_at
            END
        `).run(tenantId, harbor, parleyId, actorId, throughTurnSequence, updatedAt);
      }
      const row = db.prepare(`
        SELECT r.last_seen_turn_sequence, t.at AS last_seen_at
        FROM parley_seen_receipts r
        JOIN parley_turns t
          ON t.tenant_id = r.tenant_id
         AND t.harbor = r.harbor
         AND t.parley_id = r.parley_id
         AND t.turn_sequence = r.last_seen_turn_sequence
        WHERE r.tenant_id = ? AND r.harbor = ?
          AND r.parley_id = ? AND r.actor_id = ?
      `).get(tenantId, harbor, parleyId, actorId) as {
        last_seen_turn_sequence: number;
        last_seen_at: number;
      } | undefined;
      if (!row) return { lastSeenAt: null, turnSequence: 0 };
      if (!Number.isSafeInteger(row.last_seen_turn_sequence)
        || row.last_seen_turn_sequence < 1
        || !Number.isSafeInteger(row.last_seen_at)) {
        throw new Error('parley store poisoned row: invalid seen turn frontier');
      }
      return {
        lastSeenAt: row.last_seen_at,
        turnSequence: row.last_seen_turn_sequence,
      };
    });
    return transaction();
  }

  function claimNotifications(
    harborInput: string,
    options: { limit?: number; leaseMs?: number } = {},
  ): ClaimedParleyNotification[] {
    const harbor = scope(harborInput);
    const limit = options.limit ?? 25;
    const leaseMs = options.leaseMs ?? 30_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > PARLEY_STORE_LIMITS.maxOutboxClaim) {
      throw new Error(`outbox claim limit must be between 1 and ${PARLEY_STORE_LIMITS.maxOutboxClaim}`);
    }
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 10 * 60 * 1000) {
      throw new Error('outbox leaseMs must be between 1000 and 600000');
    }
    const at = assertFiniteTimestamp(now(), 'outbox claim time');
    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE parley_notification_outbox
        SET state = 'pending', available_at = ?, lease_until = NULL,
            lease_token = NULL, last_error = 'lease expired before acknowledgement'
        WHERE tenant_id = ? AND harbor = ? AND state = 'leased' AND lease_until <= ?
      `).run(at, tenantId, harbor, at);
      db.prepare(`
        UPDATE parley_notification_outbox
        SET state = 'dead', lease_until = NULL, lease_token = NULL,
            last_error = COALESCE(last_error, 'maximum attempts exhausted')
        WHERE tenant_id = ? AND harbor = ? AND state = 'pending'
          AND attempts >= ?
      `).run(tenantId, harbor, PARLEY_STORE_LIMITS.maxOutboxAttempts);
      const rows = db.prepare(`
        SELECT id, delivery_key, recipient_actor_id, inbox_target, from_actor_id,
               event_type, payload_json, payload_hash, attempts, lease_token
        FROM parley_notification_outbox
        WHERE tenant_id = ? AND harbor = ? AND state = 'pending'
          AND available_at <= ? AND attempts < ?
        -- A crashed delivery must resume before untouched fan-out can move
        -- ahead of it. Attempts are bounded, so this recovery class cannot
        -- starve never-attempted rows indefinitely.
        ORDER BY CASE WHEN attempts > 0 THEN 0 ELSE 1 END ASC,
                 available_at ASC,
                 id ASC
        LIMIT ?
      `).all(
        tenantId,
        harbor,
        at,
        PARLEY_STORE_LIMITS.maxOutboxAttempts,
        limit,
      ) as OutboxRow[];
      const claimed: ClaimedParleyNotification[] = [];
      for (const row of rows) {
        let payload: Record<string, unknown>;
        try {
          payload = parseJson<Record<string, unknown>>(row.payload_json, 'outbox payload JSON');
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('parley store poisoned row: outbox payload must be an object');
          }
          if (hash(row.payload_json) !== row.payload_hash) {
            throw new Error('parley store poisoned row: outbox payload hash mismatch');
          }
          assertNotification({
            deliveryKey: row.delivery_key,
            recipientActorId: row.recipient_actor_id,
            inboxTarget: row.inbox_target,
            fromActorId: row.from_actor_id,
            eventType: row.event_type as ParleyNotificationIntent['eventType'],
            payload,
          });
        } catch (error) {
          db.prepare(`
            UPDATE parley_notification_outbox
            SET state = 'dead', lease_until = NULL, lease_token = NULL, last_error = ?
            WHERE tenant_id = ? AND harbor = ? AND id = ? AND state = 'pending'
          `).run(
            error instanceof Error ? error.message : 'poisoned outbox row',
            tenantId,
            harbor,
            row.id,
          );
          continue;
        }
        const leaseToken = randomUUID();
        const result = db.prepare(`
          UPDATE parley_notification_outbox
          SET state = 'leased', attempts = attempts + 1,
              lease_until = ?, lease_token = ?, last_error = NULL
          WHERE tenant_id = ? AND harbor = ? AND id = ? AND state = 'pending'
            AND attempts = ?
        `).run(at + leaseMs, leaseToken, tenantId, harbor, row.id, row.attempts);
        if (changes(result) !== 1) throw new Error('outbox claim race changed the selected row');
        claimed.push({
          id: row.id,
          deliveryKey: row.delivery_key,
          recipientActorId: row.recipient_actor_id,
          inboxTarget: row.inbox_target,
          fromActorId: row.from_actor_id,
          eventType: row.event_type as ParleyNotificationIntent['eventType'],
          payload,
          attempts: row.attempts + 1,
          leaseToken,
        });
      }
      return claimed;
    });
    return transaction();
  }

  /**
   * Discover tenant-scoped harbors that have work eligible for recovery now.
   * The tenant-wide index and hard harbor ceiling keep restart sweeps bounded;
   * callers never need to remember which caller-selected harbor held the row.
   */
  function dueNotificationHarbors(options: { limit?: number } = {}): string[] {
    const limit = options.limit ?? PARLEY_STORE_LIMITS.maxDueHarborsPerSweep;
    if (!Number.isInteger(limit) || limit < 1 || limit > PARLEY_STORE_LIMITS.maxDueHarborsPerSweep) {
      throw new Error(
        `outbox due-harbor limit must be between 1 and ${PARLEY_STORE_LIMITS.maxDueHarborsPerSweep}`,
      );
    }
    const at = assertFiniteTimestamp(now(), 'outbox due-harbor scan time');
    const rows = db.prepare(`
      SELECT harbor,
             MIN(CASE WHEN state = 'leased' THEN lease_until ELSE available_at END) AS due_at
      FROM parley_notification_outbox
      WHERE tenant_id = ?
        AND (
          (state = 'pending' AND available_at <= ? AND attempts < ?)
          OR (state = 'leased' AND lease_until <= ?)
        )
      GROUP BY harbor
      ORDER BY due_at ASC, harbor ASC
      LIMIT ?
    `).all(
      tenantId,
      at,
      PARLEY_STORE_LIMITS.maxOutboxAttempts,
      at,
      limit,
    ) as Array<{ harbor: string }>;
    return rows.map((row) => scope(row.harbor));
  }

  function acknowledgeNotification(harborInput: string, id: number, leaseToken: string): void {
    const harbor = scope(harborInput);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('outbox id is invalid');
    assertCanonicalString(leaseToken, 'outbox leaseToken', 128);
    const at = assertFiniteTimestamp(now(), 'outbox acknowledgement time');
    const result = db.prepare(`
      UPDATE parley_notification_outbox
      SET state = 'delivered', delivered_at = ?, lease_until = NULL,
          lease_token = NULL, last_error = NULL
      WHERE tenant_id = ? AND harbor = ? AND id = ?
        AND state = 'leased' AND lease_token = ? AND lease_until > ?
    `).run(at, tenantId, harbor, id, leaseToken, at);
    if (changes(result) !== 1) throw new Error('outbox acknowledgement lost its lease');
  }

  function retryNotification(
    harborInput: string,
    id: number,
    leaseToken: string,
    error: string,
  ): 'pending' | 'dead' {
    const harbor = scope(harborInput);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('outbox id is invalid');
    assertCanonicalString(leaseToken, 'outbox leaseToken', 128);
    const message = assertCanonicalString(error, 'outbox delivery error', 4096);
    const at = assertFiniteTimestamp(now(), 'outbox retry time');
    const row = db.prepare(`
      SELECT attempts FROM parley_notification_outbox
      WHERE tenant_id = ? AND harbor = ? AND id = ?
        AND state = 'leased' AND lease_token = ? AND lease_until > ?
    `).get(tenantId, harbor, id, leaseToken, at) as { attempts: number } | undefined;
    if (!row) throw new Error('outbox retry lost its lease');
    if (row.attempts >= PARLEY_STORE_LIMITS.maxOutboxAttempts) {
      const result = db.prepare(`
        UPDATE parley_notification_outbox
        SET state = 'dead', lease_until = NULL, lease_token = NULL, last_error = ?
        WHERE tenant_id = ? AND harbor = ? AND id = ?
          AND state = 'leased' AND lease_token = ? AND lease_until > ?
      `).run(message, tenantId, harbor, id, leaseToken, at);
      if (changes(result) !== 1) throw new Error('outbox retry lost its lease');
      return 'dead';
    }
    const backoffMs = Math.min(60_000, 250 * (2 ** Math.max(0, row.attempts - 1)));
    const result = db.prepare(`
      UPDATE parley_notification_outbox
      SET state = 'pending', available_at = ?, lease_until = NULL,
          lease_token = NULL, last_error = ?
      WHERE tenant_id = ? AND harbor = ? AND id = ?
        AND state = 'leased' AND lease_token = ? AND lease_until > ?
    `).run(at + backoffMs, message, tenantId, harbor, id, leaseToken, at);
    if (changes(result) !== 1) throw new Error('outbox retry lost its lease');
    return 'pending';
  }

  function reap(harborInput: string): {
    escalated: number;
    records: number;
    signals: number;
    outbox: number;
  } {
    if (arguments.length > 1) {
      throw new Error('parley reap does not accept caller-owned timestamps');
    }
    const harbor = scope(harborInput);
    const at = assertFiniteTimestamp(now(), 'parley reap time');
    const escalated = db.transaction(() => settleExpired(harbor, at))();
    const transaction = db.transaction(() => {
      const records = db.prepare(`
        SELECT parley_id, automatic_signal_id FROM parley_records r
        WHERE r.tenant_id = ? AND r.harbor = ?
          AND r.status IN ('COLLAPSED','ESCALATED','VOIDED')
          AND r.retention_until <= ?
          AND (
            r.automatic_signal_id IS NULL
            OR EXISTS (
              SELECT 1 FROM parley_auto_signals s
              WHERE s.tenant_id = r.tenant_id AND s.harbor = r.harbor
                AND s.signal_id = r.automatic_signal_id AND s.expires_at < ?
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM parley_notification_outbox o
            WHERE o.tenant_id = r.tenant_id AND o.harbor = r.harbor
              AND o.parley_id = r.parley_id AND o.state IN ('pending','leased')
          )
          AND NOT EXISTS (
            SELECT 1 FROM parley_lineage_cooldowns l
            WHERE l.tenant_id = r.tenant_id AND l.harbor = r.harbor
              AND l.owner_signal_id = r.automatic_signal_id
              AND (l.state = 'active' OR l.cooldown_until > ?)
          )
        ORDER BY r.retention_until ASC, r.parley_id ASC
        LIMIT ?
      `).all(tenantId, harbor, at, at, at, PARLEY_STORE_LIMITS.reapBatch) as Array<{
        parley_id: string;
        automatic_signal_id: string | null;
      }>;
      let recordsDeleted = 0;
      let signalsDeleted = 0;
      for (const record of records) {
        recordsDeleted += changes(db.prepare(`
          DELETE FROM parley_records
          WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
        `).run(tenantId, harbor, record.parley_id));
        if (record.automatic_signal_id) {
          signalsDeleted += changes(db.prepare(`
            DELETE FROM parley_auto_signals
            WHERE tenant_id = ? AND harbor = ? AND signal_id = ? AND expires_at < ?
              AND NOT EXISTS (
                SELECT 1 FROM parley_records r
                WHERE r.tenant_id = parley_auto_signals.tenant_id
                  AND r.harbor = parley_auto_signals.harbor
                  AND r.automatic_signal_id = parley_auto_signals.signal_id
              )
          `).run(tenantId, harbor, record.automatic_signal_id, at));
        }
      }
      const signalRows = db.prepare(`
        SELECT signal_id FROM parley_auto_signals s
        WHERE s.tenant_id = ? AND s.harbor = ? AND s.expires_at < ?
          AND EXISTS (
            SELECT 1 FROM parley_auto_terminal_receipts t
            WHERE t.tenant_id = s.tenant_id AND t.harbor = s.harbor
              AND t.signal_id = s.signal_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM parley_records r
            WHERE r.tenant_id = s.tenant_id AND r.harbor = s.harbor
              AND r.automatic_signal_id = s.signal_id
          )
        ORDER BY s.expires_at ASC, s.signal_id ASC
        LIMIT ?
      `).all(tenantId, harbor, at, PARLEY_STORE_LIMITS.reapBatch) as Array<{ signal_id: string }>;
      for (const signal of signalRows) {
        signalsDeleted += changes(db.prepare(`
          DELETE FROM parley_auto_signals
          WHERE tenant_id = ? AND harbor = ? AND signal_id = ?
        `).run(tenantId, harbor, signal.signal_id));
      }
      const outboxDeleted = changes(db.prepare(`
        DELETE FROM parley_notification_outbox
        WHERE id IN (
          SELECT id FROM parley_notification_outbox
          WHERE tenant_id = ? AND harbor = ? AND state IN ('delivered','dead')
            AND COALESCE(delivered_at, created_at) <= ?
          ORDER BY COALESCE(delivered_at, created_at) ASC, id ASC
          LIMIT ?
        )
      `).run(tenantId, harbor, at - PARLEY_STORE_LIMITS.retentionMs, PARLEY_STORE_LIMITS.reapBatch));
      return { records: recordsDeleted, signals: signalsDeleted, outbox: outboxDeleted };
    });
    return { escalated, ...transaction() };
  }

  function inspectCounts(harborInput: string): Record<string, number> {
    const harbor = scope(harborInput);
    const tables = [
      'parley_records',
      'parley_participants',
      'parley_turns',
      'parley_seen_receipts',
      'parley_legacy_tuple_seen_provenance',
      'parley_outcomes',
      'parley_auto_signals',
      'parley_auto_terminal_receipts',
      'parley_lineage_cooldowns',
      'parley_admissions',
      'parley_notification_outbox',
      'parley_notification_overflow_receipts',
      'parley_quota_ledger',
    ] as const;
    const result: Record<string, number> = {};
    for (const table of tables) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND harbor = ?`)
        .get(tenantId, harbor) as { count: number };
      result[table] = Number(row.count);
    }
    return result;
  }

  function inspectQuota(harborInput: string): ParleyQuotaSnapshot {
    return quotaSnapshot(scope(harborInput));
  }

  function inspectTenantQuota(): ParleyTenantQuotaSnapshot {
    return tenantQuotaSnapshot();
  }

  // Run after all Store0 methods exist so the importer can share their
  // validation and quota primitives, then rebuild ledger evidence once after
  // its transaction commits. A receipt makes every subsequent restart a read.
  const legacyMigration = importLegacyTupleParleys();
  if (legacyMigration && !legacyMigration.replayed) reconcileQuotaLedger();

  return {
    tenantId,
    createManual,
    admitAutomatic,
    admitAutomaticInTransaction,
    getSnapshot,
    getAutomatic,
    list,
    addTurn,
    markSeen,
    dueNotificationHarbors,
    claimNotifications,
    acknowledgeNotification,
    retryNotification,
    reap,
    inspectCounts,
    inspectQuota,
    inspectTenantQuota,
    legacyMigration,
  };
}

export type ParleyStore = ReturnType<typeof createParleyStore>;
