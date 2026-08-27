/**
 * Agent Harbor Event Ledger (binder ch18 Work Order C1; ADR-0095).
 *
 * The append-only event store for Agent Harbor truth. Every durable fact —
 * TranscriptEvent, CostAccrualEvent, ComplianceProbeResult, WorkReceipt, and
 * AgentNode / AgentRun state facts — is appended here exactly once and never
 * mutated. Projections (lib/agent-harbor/projections.ts) are disposable read
 * models rebuilt from this log; the log is sacred (ch18 data-model
 * shibboleths).
 *
 * Contract authority: schemas/agent-harbor/v0/*.schema.json (F0 freeze,
 * ADR-0095). Field names used here are the frozen canonical ones —
 * agentNodeId, bodyId, payloadJson, payloadBlobRefs, redactionState,
 * retentionPolicyId (fork resolution 1). Where this file and the schema
 * disagree, the schema wins.
 *
 * Skill grafts honored (cited in the C1 PR):
 *   - sqlite-durable-agent-state: single canonical DB via lib/db.ts
 *     (PORT_DADDY_DB → port-registry.db), WAL + busy_timeout set by
 *     initDatabase, idempotent CREATE IF NOT EXISTS schema with a post-apply
 *     verification probe that inspects the real table, single-writer daemon
 *     topology.
 *   - cqrs-event-sourcing-architect: append-only store, optimistic per-session
 *     sequence, projections disposable and rebuilt by replay.
 *   - event-driven-architecture-expert / outbox-pattern-implementation:
 *     at-least-once ingestion tolerated via DB-unique-constraint idempotency
 *     (event_id and (stream_type, idempotency_key)); duplicates are no-ops
 *     returning the prior result — never Redis, never in-memory dedup.
 *   - agent-interchange-formats: tolerant reader — unknown payload fields and
 *     unknown transcript kinds are stored byte-for-byte and never rejected;
 *     every payload self-identifies via `schema` const or `schemaVersion`.
 *
 * Replay rules (normative for all consumers):
 *   1. `ledger_seq` (AUTOINCREMENT) is the global replay order — daemon
 *      receive order, monotonic, never reused.
 *   2. A duplicate `event_id` is a no-op that returns the original row.
 *   3. A duplicate (stream_type, idempotency_key) is a no-op that returns the
 *      original row (importers, reconnecting streams, remote mirrors).
 *   4. A transcript (sessionId, sequence) collision with a DIFFERENT eventId
 *      is a hard SequenceConflictError — sequences are unique per session.
 *   5. Transcript events hash-chain per session: prevHash is assigned by the
 *      ledger from the previously persisted transcript event of the same
 *      session (null for the first). contentHash is the sha256 of the
 *      canonical JSON body excluding contentHash and prevHash (prevHash is
 *      ledger-assigned, so a sender cannot include it in the hash). The
 *      ledger always computes contentHash itself; a sender-supplied
 *      contentHash is verified against the computed one and a mismatch is
 *      rejected fail-closed.
 *   6. Unknown fields ride along inside payload_json; replay re-emits them.
 */

import { createHash } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';

// ─────────────────────────────────────────────────────────────────────────────
// Stream types and their F0 contract bindings
// ─────────────────────────────────────────────────────────────────────────────

export const STREAM_TYPES = [
  'work-intent',
  'work-plan',
  'control-command',
  'transcript-event',
  'cost-accrual-event',
  'compliance-probe-result',
  'work-receipt',
  'agent-node',
  'agent-run',
  'doctrine-evidence',
] as const;

export type StreamType = (typeof STREAM_TYPES)[number];

/** `schema` const discriminator each non-transcript stream must carry (ADR-0095 §6). */
const SCHEMA_CONST: Record<Exclude<StreamType, 'transcript-event'>, string> = {
  'work-intent': 'pd.agent-harbor.work-intent.v0',
  'work-plan': 'pd.agent-harbor.work-plan.v0',
  'control-command': 'pd.agent-harbor.control-command.v0',
  'cost-accrual-event': 'pd.agent-harbor.cost-accrual-event.v0',
  'compliance-probe-result': 'pd.agent-harbor.compliance-probe-result.v0',
  'work-receipt': 'pd.agent-harbor.work-receipt.v0',
  'agent-node': 'pd.agent-harbor.agent-node.v0',
  'agent-run': 'pd.agent-harbor.agent-run.v0',
  'doctrine-evidence': 'pd.agent-harbor.doctrine-evidence.v0',
};

/** Required fields per stream type — mirrors the frozen schemas' `required` arrays. */
const REQUIRED_FIELDS: Record<StreamType, string[]> = {
  'work-intent': ['schema', 'intentId', 'idempotencyKey', 'source', 'goal', 'createdAt'],
  'work-plan': ['schema', 'planId', 'intentId', 'shape', 'state', 'createdAt'],
  'control-command': ['schema', 'commandId', 'agentNodeId', 'kind', 'requestedBy', 'status', 'createdAt'],
  'transcript-event': ['eventId', 'sessionId', 'agentNodeId', 'sequence', 'occurredAt', 'schemaVersion', 'kind'],
  'cost-accrual-event': ['schema', 'costEventId', 'agentNodeId', 'meter', 'phase', 'quantity', 'occurredAt'],
  'compliance-probe-result': ['schema', 'probeId', 'agentNodeId', 'probedAt', 'complianceLevel', 'witnessedLevel', 'transcriptFidelity', 'checks', 'negativeProbes'],
  'work-receipt': ['schema', 'receiptId', 'agentNodeId', 'sessionId', 'identity', 'intent', 'risks', 'validation', 'actions', 'contextUsed', 'rollback', 'spend', 'provenance', 'createdAt'],
  'agent-node': ['schema', 'agentNodeId', 'identity', 'class', 'authority', 'complianceLevel', 'status', 'createdAt'],
  'agent-run': ['schema', 'runId', 'agentNodeId', 'sessionId', 'body', 'status', 'startedAt'],
  'doctrine-evidence': ['schema', 'eventId', 'idempotencyKey', 'kind', 'entityId', 'occurredAt', 'projectDir', 'actorId', 'citations', 'payload'],
};

export type HarborPayload = Record<string, unknown>;

export interface AppendInput {
  streamType: StreamType;
  payload: HarborPayload;
}

export interface AppendResult {
  duplicate: boolean;
  ledgerSeq: number;
  eventId: string;
  contentHash: string | null;
  prevHash: string | null;
}

export interface LedgerRow {
  ledger_seq: number;
  event_id: string;
  stream_type: StreamType;
  agent_node_id: string | null;
  session_id: string | null;
  run_id: string | null;
  sequence: number | null;
  kind: string | null;
  occurred_at: string | null;
  ingested_at: string;
  idempotency_key: string | null;
  schema_id: string | null;
  payload_json: string;
  content_hash: string | null;
  prev_hash: string | null;
}

export class LedgerValidationError extends Error {
  code = 'LEDGER_VALIDATION' as const;
}

export class SequenceConflictError extends Error {
  code = 'SEQUENCE_CONFLICT' as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema (idempotent) + post-apply verification (sqlite-durable-agent-state)
// ─────────────────────────────────────────────────────────────────────────────

const LEDGER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS harbor_events (
    ledger_seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id         TEXT NOT NULL UNIQUE,
    stream_type      TEXT NOT NULL,
    agent_node_id    TEXT,
    session_id       TEXT,
    run_id           TEXT,
    sequence         REAL,
    kind             TEXT,
    occurred_at      TEXT,
    ingested_at      TEXT NOT NULL,
    idempotency_key  TEXT,
    schema_id        TEXT,
    payload_json     TEXT NOT NULL,
    content_hash     TEXT,
    prev_hash        TEXT
  );

  -- Idempotency primitive #2: importers / reconnecting streams / remote
  -- mirrors carry an idempotency key (TranscriptEvent.source.idempotencyKey,
  -- CostAccrualEvent.idempotencyKey). The DB unique constraint IS the dedup.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_harbor_events_idem
    ON harbor_events(stream_type, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

  -- (sessionId, sequence) is unique and monotonic per session for transcript
  -- events (transcript-event.schema.json).
  CREATE UNIQUE INDEX IF NOT EXISTS idx_harbor_events_session_seq
    ON harbor_events(session_id, sequence)
    WHERE stream_type = 'transcript-event';

  CREATE INDEX IF NOT EXISTS idx_harbor_events_node
    ON harbor_events(agent_node_id, ledger_seq);
  CREATE INDEX IF NOT EXISTS idx_harbor_events_session
    ON harbor_events(session_id, ledger_seq);
  CREATE INDEX IF NOT EXISTS idx_harbor_events_stream
    ON harbor_events(stream_type, ledger_seq);

  -- Append-only is ENFORCED, not asserted: transcript, control, cost, claim,
  -- and receipt events are append-only (ch18 F0 acceptance gate).
  CREATE TRIGGER IF NOT EXISTS harbor_events_no_update
    BEFORE UPDATE ON harbor_events
    BEGIN SELECT RAISE(ABORT, 'harbor_events is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS harbor_events_no_delete
    BEFORE DELETE ON harbor_events
    BEGIN SELECT RAISE(ABORT, 'harbor_events is append-only'); END;
`;

const REQUIRED_COLUMNS = [
  'ledger_seq', 'event_id', 'stream_type', 'agent_node_id', 'session_id',
  'run_id', 'sequence', 'kind', 'occurred_at', 'ingested_at',
  'idempotency_key', 'schema_id', 'payload_json', 'content_hash', 'prev_hash',
];

/**
 * Idempotent schema apply + post-apply verification probe.
 *
 * Per sqlite-durable-agent-state ("Migration History Is Not Migration"): we
 * never trust that the DDL ran — we query the actual target table and throw
 * if the live schema disagrees.
 */
export function ensureEventLedgerSchema(db: DatabaseInstance): void {
  db.exec(LEDGER_SCHEMA_SQL);

  // Post-apply verification: inspect the real table, not bookkeeping.
  const cols = db.prepare('PRAGMA table_info(harbor_events)').all() as Array<{ name: string }>;
  const present = new Set(cols.map((c) => c.name));
  const missing = REQUIRED_COLUMNS.filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(
      `harbor_events migration verification failed: missing columns ${missing.join(', ')}. ` +
      'The event ledger cannot run against a partial schema.',
    );
  }
  const triggers = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'harbor_events'")
    .all() as Array<{ name: string }>;
  const triggerNames = new Set(triggers.map((t) => t.name));
  for (const required of ['harbor_events_no_update', 'harbor_events_no_delete']) {
    if (!triggerNames.has(required)) {
      throw new Error(
        `harbor_events migration verification failed: append-only trigger ${required} missing.`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical hashing (per-session tamper-evident chain)
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic JSON: object keys sorted recursively; arrays keep order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * sha256 of the canonical event body excluding contentHash and prevHash
 * (prevHash is assigned by the ledger at persist time, so the sender cannot
 * have hashed over it).
 */
export function computeContentHash(payload: HarborPayload): string {
  const { contentHash: _c, prevHash: _p, ...body } = payload;
  return 'sha256:' + createHash('sha256').update(canonicalJson(body)).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Field extraction per stream type (canonical F0 names only)
// ─────────────────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

interface ExtractedFields {
  eventId: string;
  agentNodeId: string | null;
  sessionId: string | null;
  runId: string | null;
  sequence: number | null;
  kind: string | null;
  occurredAt: string | null;
  idempotencyKey: string | null;
  schemaId: string | null;
}

function validateRequired(streamType: StreamType, payload: HarborPayload): void {
  const missing = REQUIRED_FIELDS[streamType].filter((f) => payload[f] === undefined || payload[f] === null);
  if (missing.length > 0) {
    throw new LedgerValidationError(
      `${streamType} payload missing required field(s): ${missing.join(', ')} ` +
      `(contract: schemas/agent-harbor/v0/${streamType === 'agent-node' ? 'agent-node' : streamType === 'agent-run' ? 'agent-run' : streamType}.schema.json)`,
    );
  }
  if (streamType === 'transcript-event') {
    if (payload.schemaVersion !== 1) {
      throw new LedgerValidationError(
        `transcript-event schemaVersion must be 1, got ${JSON.stringify(payload.schemaVersion)}`,
      );
    }
    if (typeof payload.sequence !== 'number' || payload.sequence < 0) {
      throw new LedgerValidationError('transcript-event sequence must be a number >= 0');
    }
  } else {
    const expected = SCHEMA_CONST[streamType];
    if (payload.schema !== expected) {
      // Tolerant reader for FUTURE versions: an unknown `.v1` suffix is "not
      // mine", not a crash — but appending it to the v0 ledger is a caller
      // error, reported honestly.
      throw new LedgerValidationError(
        `${streamType} payload schema discriminator must be "${expected}", got ${JSON.stringify(payload.schema)}`,
      );
    }
  }
}

function extractFields(streamType: StreamType, payload: HarborPayload): ExtractedFields {
  switch (streamType) {
    case 'work-intent':
      return {
        eventId: payload.intentId as string,
        agentNodeId: null,
        sessionId: null,
        runId: null,
        sequence: null,
        kind: str(payload.startPolicy) ?? 'work-intent',
        occurredAt: str(payload.createdAt),
        idempotencyKey: str(payload.idempotencyKey),
        schemaId: payload.schema as string,
      };
    case 'work-plan':
      return {
        eventId: payload.planId as string,
        agentNodeId: null,
        sessionId: null,
        runId: null,
        sequence: null,
        kind: str(payload.state) ?? str(payload.shape) ?? 'work-plan',
        occurredAt: str(payload.createdAt),
        idempotencyKey: str(payload.idempotencyKey),
        schemaId: payload.schema as string,
      };
    case 'control-command':
      return {
        eventId: payload.commandId as string,
        agentNodeId: str(payload.agentNodeId),
        sessionId: str(payload.sessionId),
        runId: str(payload.runId),
        sequence: null,
        kind: str(payload.kind),
        occurredAt: str(payload.createdAt),
        idempotencyKey: str(payload.idempotencyKey),
        schemaId: payload.schema as string,
      };
    case 'transcript-event': {
      const source = (payload.source ?? {}) as Record<string, unknown>;
      return {
        eventId: payload.eventId as string,
        agentNodeId: str(payload.agentNodeId),
        sessionId: str(payload.sessionId),
        runId: null,
        sequence: payload.sequence as number,
        kind: str(payload.kind),
        occurredAt: str(payload.occurredAt),
        idempotencyKey: str(source.idempotencyKey),
        schemaId: 'transcript-event.v1',
      };
    }
    case 'cost-accrual-event':
      return {
        eventId: payload.costEventId as string,
        agentNodeId: str(payload.agentNodeId),
        sessionId: str(payload.sessionId),
        runId: str(payload.runId),
        sequence: null,
        kind: str(payload.phase),
        occurredAt: str(payload.occurredAt),
        idempotencyKey: str(payload.idempotencyKey),
        schemaId: payload.schema as string,
      };
    case 'compliance-probe-result':
      return {
        eventId: payload.probeId as string,
        agentNodeId: str(payload.agentNodeId),
        sessionId: null,
        runId: null,
        sequence: null,
        kind: 'compliance-probe',
        occurredAt: str(payload.probedAt),
        idempotencyKey: null,
        schemaId: payload.schema as string,
      };
    case 'work-receipt':
      return {
        eventId: payload.receiptId as string,
        agentNodeId: str(payload.agentNodeId),
        sessionId: str(payload.sessionId),
        runId: str(payload.runId),
        sequence: null,
        kind: 'work-receipt',
        occurredAt: str(payload.createdAt),
        idempotencyKey: null,
        schemaId: payload.schema as string,
      };
    case 'agent-node': {
      // State fact (event-carried state). The event id is derived from the
      // content hash, so re-declaring an UNCHANGED node is a natural no-op
      // and any state change is a new fact. The FULL sha256 hex is embedded —
      // a truncated slice would make an event_id collision (silent dedup of a
      // distinct fact) materially more likely than the hash itself allows.
      const hash = computeContentHash(payload);
      return {
        eventId: `agent-node:${payload.agentNodeId as string}:${hash.slice(7)}`,
        agentNodeId: str(payload.agentNodeId),
        sessionId: str(payload.currentSessionId),
        runId: str(payload.currentRunId),
        sequence: null,
        kind: 'agent-node-fact',
        occurredAt: str(payload.createdAt),
        idempotencyKey: null,
        schemaId: payload.schema as string,
      };
    }
    case 'agent-run': {
      // Full-hash event id for the same reason as agent-node facts above.
      const hash = computeContentHash(payload);
      return {
        eventId: `agent-run:${payload.runId as string}:${hash.slice(7)}`,
        agentNodeId: str(payload.agentNodeId),
        sessionId: str(payload.sessionId),
        runId: str(payload.runId),
        sequence: null,
        kind: 'agent-run-fact',
        occurredAt: str(payload.startedAt),
        idempotencyKey: null,
        schemaId: payload.schema as string,
      };
    }
    case 'doctrine-evidence':
      return {
        eventId: payload.eventId as string,
        agentNodeId: str(payload.actorId),
        sessionId: str(payload.sessionId),
        runId: str(payload.runId),
        sequence: null,
        kind: str(payload.kind),
        occurredAt: str(payload.occurredAt),
        idempotencyKey: str(payload.idempotencyKey),
        schemaId: payload.schema as string,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Append (the only write path)
// ─────────────────────────────────────────────────────────────────────────────

function toAppendResult(row: LedgerRow, duplicate: boolean): AppendResult {
  return {
    duplicate,
    ledgerSeq: row.ledger_seq,
    eventId: row.event_id,
    contentHash: row.content_hash,
    prevHash: row.prev_hash,
  };
}

/**
 * Append one event. Idempotent: a duplicate eventId or duplicate
 * (streamType, idempotencyKey) returns the ORIGINAL row with
 * `duplicate: true` and writes nothing. Unknown payload fields are preserved
 * byte-for-byte (tolerant reader); unknown transcript `kind` values are
 * accepted (open string per the frozen schema).
 */
export function appendEvent(db: DatabaseInstance, input: AppendInput): AppendResult {
  ensureEventLedgerSchema(db);
  const { streamType, payload } = input;
  if (!STREAM_TYPES.includes(streamType)) {
    throw new LedgerValidationError(
      `unknown streamType "${streamType}". Known: ${STREAM_TYPES.join(', ')}`,
    );
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LedgerValidationError('payload must be a JSON object');
  }
  validateRequired(streamType, payload);
  const fields = extractFields(streamType, payload);

  const txn = db.transaction((): AppendResult => {
    // Idempotency primitive #1: event_id.
    const byId = db
      .prepare('SELECT * FROM harbor_events WHERE event_id = ?')
      .get(fields.eventId) as LedgerRow | undefined;
    if (byId) return toAppendResult(byId, true);

    // Idempotency primitive #2: (stream_type, idempotency_key).
    if (fields.idempotencyKey) {
      const byKey = db
        .prepare('SELECT * FROM harbor_events WHERE stream_type = ? AND idempotency_key = ?')
        .get(streamType, fields.idempotencyKey) as LedgerRow | undefined;
      if (byKey) return toAppendResult(byKey, true);
    }

    let contentHash: string | null = null;
    let prevHash: string | null = null;
    if (streamType === 'transcript-event') {
      // Replay rule 4: same (session, sequence), different eventId → conflict.
      const clash = db
        .prepare(
          "SELECT event_id FROM harbor_events WHERE stream_type = 'transcript-event' AND session_id = ? AND sequence = ?",
        )
        .get(fields.sessionId, fields.sequence) as { event_id: string } | undefined;
      if (clash) {
        throw new SequenceConflictError(
          `transcript sequence conflict: session ${fields.sessionId} sequence ${fields.sequence} ` +
          `already persisted as ${clash.event_id}, refusing ${fields.eventId}`,
        );
      }

      // Replay rule 5: per-session hash chain, prevHash assigned by ledger.
      // The ledger ALWAYS computes the hash from the canonical body — a
      // caller-supplied contentHash is verified, never trusted, so a writer
      // cannot persist an arbitrary hash that still chains cleanly (tamper
      // evidence would be defeated otherwise).
      const computedHash = computeContentHash(payload);
      const claimedHash = str(payload.contentHash);
      if (claimedHash !== null && claimedHash !== computedHash) {
        throw new LedgerValidationError(
          `transcript contentHash mismatch for ${fields.eventId}: payload claims ` +
          `${claimedHash} but the canonical body hashes to ${computedHash} — ` +
          'refusing to persist a hash the ledger cannot verify',
        );
      }
      contentHash = computedHash;
      const prev = db
        .prepare(
          "SELECT content_hash FROM harbor_events WHERE stream_type = 'transcript-event' AND session_id = ? ORDER BY ledger_seq DESC LIMIT 1",
        )
        .get(fields.sessionId) as { content_hash: string | null } | undefined;
      const ledgerPrev = prev ? prev.content_hash : null;
      const claimedPrev = payload.prevHash === undefined ? undefined : (payload.prevHash as string | null);
      if (claimedPrev !== undefined && claimedPrev !== ledgerPrev) {
        throw new SequenceConflictError(
          `transcript hash-chain conflict for session ${fields.sessionId}: ` +
          `event claims prevHash ${JSON.stringify(claimedPrev)} but ledger head is ${JSON.stringify(ledgerPrev)}`,
        );
      }
      prevHash = ledgerPrev;
    } else {
      contentHash = computeContentHash(payload);
    }

    const stored: HarborPayload = { ...payload };
    if (streamType === 'transcript-event') {
      stored.contentHash = contentHash;
      stored.prevHash = prevHash;
    }

    const info = db
      .prepare(
        `INSERT INTO harbor_events (
           event_id, stream_type, agent_node_id, session_id, run_id, sequence,
           kind, occurred_at, ingested_at, idempotency_key, schema_id,
           payload_json, content_hash, prev_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fields.eventId,
        streamType,
        fields.agentNodeId,
        fields.sessionId,
        fields.runId,
        fields.sequence,
        fields.kind,
        fields.occurredAt,
        str(payload.ingestedAt) ?? new Date().toISOString(),
        fields.idempotencyKey,
        fields.schemaId,
        JSON.stringify(stored),
        contentHash,
        prevHash,
      );

    return {
      duplicate: false,
      ledgerSeq: Number(info.lastInsertRowid),
      eventId: fields.eventId,
      contentHash,
      prevHash,
    };
  });

  return txn();
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads (replay surface)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadOptions {
  afterSeq?: number;
  limit?: number;
  streamType?: StreamType;
  sessionId?: string;
  agentNodeId?: string;
}

/** Read events in global replay order (ledger_seq ascending). */
export function readEvents(db: DatabaseInstance, opts: ReadOptions = {}): LedgerRow[] {
  ensureEventLedgerSchema(db);
  const where: string[] = ['ledger_seq > ?'];
  const params: unknown[] = [opts.afterSeq ?? 0];
  if (opts.streamType) {
    where.push('stream_type = ?');
    params.push(opts.streamType);
  }
  if (opts.sessionId) {
    where.push('session_id = ?');
    params.push(opts.sessionId);
  }
  if (opts.agentNodeId) {
    where.push('agent_node_id = ?');
    params.push(opts.agentNodeId);
  }
  const limit = Math.max(1, Math.min(opts.limit ?? 10_000, 100_000));
  params.push(limit);
  return db
    .prepare(
      `SELECT * FROM harbor_events WHERE ${where.join(' AND ')} ORDER BY ledger_seq ASC LIMIT ?`,
    )
    .all(...params) as LedgerRow[];
}

/** Highest ledger_seq persisted (0 when the ledger is empty). */
export function ledgerHeadSeq(db: DatabaseInstance): number {
  ensureEventLedgerSchema(db);
  const row = db.prepare('SELECT MAX(ledger_seq) AS head FROM harbor_events').get() as {
    head: number | null;
  };
  return row.head ?? 0;
}

/**
 * Verify the per-session transcript hash chain. Returns the broken link if
 * any (tamper evidence), else null.
 *
 * Pages through the WHOLE session via the `afterSeq` cursor — a fixed read
 * limit would silently skip the tail of a long session and report "intact"
 * for a chain it never inspected.
 */
export function verifySessionChain(
  db: DatabaseInstance,
  sessionId: string,
): { brokenAtEventId: string; expectedPrev: string | null; actualPrev: string | null } | null {
  const PAGE = 10_000;
  let afterSeq = 0;
  let expectedPrev: string | null = null;
  for (;;) {
    const rows = readEvents(db, { streamType: 'transcript-event', sessionId, afterSeq, limit: PAGE });
    for (const row of rows) {
      if (row.prev_hash !== expectedPrev) {
        return { brokenAtEventId: row.event_id, expectedPrev, actualPrev: row.prev_hash };
      }
      expectedPrev = row.content_hash;
    }
    if (rows.length < PAGE) return null;
    afterSeq = rows[rows.length - 1].ledger_seq;
  }
}

/**
 * Content hash of the LAST transcript event in a session's chain (the chain
 * head), or null when the session has no transcript events. Single indexed
 * row read — never loads the whole session.
 */
export function sessionChainHeadHash(db: DatabaseInstance, sessionId: string): string | null {
  ensureEventLedgerSchema(db);
  const row = db
    .prepare(
      `SELECT content_hash FROM harbor_events
       WHERE stream_type = 'transcript-event' AND session_id = ?
       ORDER BY ledger_seq DESC LIMIT 1`,
    )
    .get(sessionId) as { content_hash: string | null } | undefined;
  return row?.content_hash ?? null;
}
