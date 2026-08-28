import { createHash } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import type { EpisodicMemory } from '../episodic-memory.js';
import { supportsInteractiveCompactionPacketProvider } from '../squid/hook-shape.js';
import {
  sanitizeHandoffCapsule,
  type GitleaksRunner,
  type HandoffCapsuleV0,
} from '../handoff-capsule.js';
import {
  assessContextEnvelope,
  buildContextEnvelope,
  type ContextEnvelope,
  type EnvelopeAssessment,
} from './context-pressure.js';
import {
  buildCompactionPacket,
  interactiveCitedPlanCheckpointForPacket,
  interactivePacketAuthorityVerificationError,
  MAX_COMPACTION_PACKET_BYTES,
  resumeFromPacket,
  validateCompactionPacket,
  type CompactionPacket,
  type SuccessorBootstrap,
} from './compaction.js';
import { appendEvent, type HarborPayload, type LedgerRow } from './event-ledger.js';
import { assertAgainstSchema } from './schema-validate.js';

export const CONTEXT_CONTINUITY_SCHEMA = 'pd.agent-harbor.context-continuity.v0' as const;

export interface ContextContinuitySample {
  agentNodeId: string;
  sessionId: string;
  runId?: string | null;
  transcriptId: string;
  sourceAdapter: string;
  model: string;
  windowTokens: number;
  daemonUsedTokensEstimate: number;
  adapterUsedTokensEstimate?: number | null;
  estimateMode: 'exact' | 'estimated';
  project?: string | null;
  projectDir?: string | null;
  workdir?: string | null;
  worktreeId?: string | null;
  branch?: string | null;
  measuredAt?: string;
  /**
   * A stable, caller-owned observation key. Spawner runs preserve the legacy
   * session/run idempotency when this is omitted; interactive hooks use the
   * hook delivery key so a later threshold crossing is a new observation,
   * while a retry stays a replay.
   */
  observationId?: string | null;
  /**
   * A bounded, durable snapshot of `pd plan`. A real interactive ingress
   * should provide `sessionId` and let the daemon read `session_notes`; the
   * content fallback exists for isolated fixtures where that table is absent.
   */
  planCheckpoint?: {
    sessionId?: string | null;
    content?: string | null;
    capturedAt?: string | null;
  } | null;
  /**
   * Interactive transcript adapters use explicit toolCallId pairs. Refuse a
   * packet rather than letting a compaction boundary retain one half of a tool
   * exchange. Legacy spawner transcript rows do not opt in until they carry
   * that identifier shape.
   */
  requireCompleteToolPairs?: boolean;
  /**
   * Daemon-owned coverage over the provider tool stream.  A lifecycle hook
   * cannot prove that it observed both halves of every tool exchange, so an
   * interactive packet is withheld unless an adapter-side witness says the
   * stream is complete. The W8/W12 overflow boundary stays deliberately
   * narrow: this coordinator receives only the opaque citation below, never a
   * `BufferedOutputRef`, its blob id, caveats, preview, or any output bytes.
   */
  toolPairCoverage?: ToolPairCoverage | null;
  /**
   * PreCompact runs on a provider deadline.  It may persist the packet but
   * defers expensive successor verification and episode projection to the
   * governed continuation/takeover path.
   */
  deferHandoffProjection?: boolean;
}

export interface ContextPlanCheckpoint {
  eventId: string;
  sessionId: string | null;
  content: string;
  capturedAt: string;
}

export interface ToolPairIntegrity {
  valid: boolean;
  violations: Array<{
    code: 'missing-tool-call-id' | 'duplicate-tool-call' | 'orphan-tool-result' | 'duplicate-tool-result' | 'unresolved-tool-call' | 'result-precedes-call';
    eventId: string;
    toolCallId: string | null;
  }>;
}

/**
 * The only W8/W12 overflow interop this slice owns. A future BufferedOutputRef
 * implementation may make `coverageRef` resolvable through its own bounded
 * `buffered_output_page` / `buffered_output_search` authority, but this
 * coordinator must neither inspect nor persist a copy of that object's shape.
 */
export interface BufferedOutputRefCitation {
  /** Adapter-owned opaque evidence locator, not a blob id or serialized ref. */
  coverageRef: string;
}

/** Narrow adapter witness; it never carries raw tool input, output, or blobs. */
export interface ToolPairCoverage extends BufferedOutputRefCitation {
  witness: 'daemon-adapter';
  status: 'complete' | 'incomplete' | 'unavailable';
  /** Provider identity from the daemon adapter, never a hook JSON claim. */
  provider: string;
  /** Exact durable session whose tool stream this receipt covers. */
  sessionId: string;
  /** Exact server-derived observation key this receipt covers. */
  observationId: string;
  /** Last durable ledger row the adapter had observed when it formed the receipt. */
  coveredThroughLedgerSeq: number;
  /** Adapter-owned opaque checkpoint for audit and W8/W12 evidence joins. */
  coverageRef: string;
}

export interface ToolPairCoverageReceipt {
  eventId: string;
  coverage: ToolPairCoverage;
}

export interface ContextPressureGovernance {
  planCheckpointRequired: boolean;
  planCheckpointPresent: boolean;
  riskyWorkRestricted: boolean;
  continuation: 'normal' | 'prepare' | 'packet-ready' | 'risky-work-restricted' | 'governed-successor';
}

export class ToolPairIntegrityError extends Error {
  readonly integrity: ToolPairIntegrity;

  constructor(integrity: ToolPairIntegrity) {
    super(`refusing compaction: ${integrity.violations.length} tool invocation/result integrity violation(s)`);
    this.name = 'ToolPairIntegrityError';
    this.integrity = integrity;
  }
}

export class ToolPairCoverageError extends Error {
  readonly coverage: ToolPairCoverage | null;

  constructor(coverage: ToolPairCoverage | null) {
    super(
      coverage === null
        ? 'refusing interactive compaction: daemon-owned tool-pair coverage is unavailable'
        : `refusing interactive compaction: daemon-owned tool-pair coverage is ${coverage.status}`,
    );
    this.name = 'ToolPairCoverageError';
    this.coverage = coverage;
  }
}

export interface ContextContinuityResult {
  schema: typeof CONTEXT_CONTINUITY_SCHEMA;
  envelope: ContextEnvelope;
  assessment: EnvelopeAssessment;
  packet: CompactionPacket | null;
  bootstrap: SuccessorBootstrap | null;
  handoffEpisodeId: number | null;
  replayed: boolean;
  planCheckpoint: ContextPlanCheckpoint | null;
  toolPairIntegrity: ToolPairIntegrity | null;
  toolPairCoverage: ToolPairCoverage | null;
  toolPairCoverageReceipt: ToolPairCoverageReceipt | null;
  governance: ContextPressureGovernance;
}

/**
 * Read-only continuation lookup for an exact, already-authorized predecessor
 * session. It intentionally never fuzzy-matches by agent, task, or workspace:
 * fresh work has no inherited packet unless its caller supplies lineage.
 */
export type VerifiedContextBootstrapLookup =
  | {
      status: 'none';
      sourceSessionId: string;
    }
  | {
      status: 'ready';
      sourceSessionId: string;
      packet: CompactionPacket;
      bootstrap: SuccessorBootstrap;
      envelope: ContextEnvelope;
    }
  | {
      status: 'withheld';
      sourceSessionId: string;
      packetId: string | null;
      reason: string;
    };

/** Durable reference embedded in an episodic packet projection. */
export interface ContextPacketProjectionRef {
  stream: 'harbor_events';
  packetId: string;
  /** The immutable compaction-packet ledger event, not a transcript tail row. */
  transcriptEventId: string | null;
  sourceHeadEventId: string;
  sourceHeadHash: string;
}

export interface ContextContinuityCoordinatorDeps {
  episodicMemory?: Pick<EpisodicMemory, 'remember'>;
  gitleaksRunner?: GitleaksRunner;
  logger?: {
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface ContextContinuityProjection {
  schemaVersion: 1;
  capturedAt: string;
  counts: {
    observed: number;
    packetReady: number;
    successorRequired: number;
    continuing: number;
    completed: number;
    verificationFailed: number;
  };
  items: ContextContinuityItem[];
  failures: ContextContinuityFailure[];
}

export interface ContextContinuityFailure {
  eventId: string;
  sessionId: string;
  agentNodeId: string;
  reason: string;
}

export interface ContextContinuityItem {
  agentNodeId: string;
  sessionId: string;
  runId: string | null;
  transcriptId: string | null;
  model: string | null;
  sourceAdapter: string | null;
  project: string | null;
  projectDir: string | null;
  envelopeId: string;
  measuredAt: string;
  pressure: {
    band: EnvelopeAssessment['band'];
    ratio: number;
    action: EnvelopeAssessment['action'];
    windowTokens: number;
    usedTokensEstimate: number;
    estimateMode: string;
    strategy: string;
    selfReportDrift: string[];
  };
  packet: null | {
    packetId: string;
    createdAt: string;
    validatorPassed: boolean;
    sourceHeadEventId: string;
    sourceHeadHash: string;
    transcriptEventId: string | null;
  };
  handoffEpisodeId: number | null;
  continuation: null | {
    id: string;
    status: string;
    targetAdapter: string;
    successorRunId: string | null;
    successorSessionId: string | null;
    updatedAt: number;
  };
  readiness: 'observed' | 'packet-ready' | 'successor-required' | 'continuing' | 'completed' | 'failed';
}

function stableSuffix(...parts: Array<string | null | undefined>): string {
  return createHash('sha256').update(parts.map((part) => part ?? '').join('\0')).digest('hex').slice(0, 24);
}

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nonEmptyBoundedText(value: unknown, maximumBytes = 16 * 1024): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || Buffer.byteLength(text, 'utf8') > maximumBytes) return null;
  return text;
}

const MAX_CONTEXT_TRANSCRIPT_TAIL_ROWS = 512;
const MAX_CONTEXT_EVENT_PAYLOAD_BYTES = 16 * 1024;
const MAX_CONTEXT_PROJECTION_SCAN_ROWS = 1_000;
/** The event wrapper adds a small fixed envelope around an already bounded packet. */
const MAX_CONTEXT_PACKET_EVENT_BYTES = MAX_COMPACTION_PACKET_BYTES + 4 * 1024;
/** Opaque W8/W12 references remain compact metadata, never an output export. */

function latestTranscriptState(
  db: DatabaseInstance,
  sessionId: string,
): { ledgerSeq: number; sequence: number | null } | null {
  const row = db.prepare(`
    SELECT ledger_seq, sequence
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND session_id = ?
    ORDER BY ledger_seq DESC
    LIMIT 1
  `).get(sessionId) as { ledger_seq: number; sequence: number | null } | undefined;
  return row ? { ledgerSeq: row.ledger_seq, sequence: row.sequence } : null;
}

function nextTranscriptSequence(db: DatabaseInstance, sessionId: string): number {
  return Math.max(-1, latestTranscriptState(db, sessionId)?.sequence ?? -1) + 1;
}

/**
 * Packet conveniences examine a fixed tail only. Oversize payloads remain
 * addressable by immutable event id but never enter the precompact process.
 */
function transcriptTail(db: DatabaseInstance, sessionId: string): LedgerRow[] {
  const rows = db.prepare(`
    SELECT ledger_seq, event_id, stream_type, agent_node_id, session_id, run_id,
           sequence, kind, occurred_at, ingested_at, idempotency_key, schema_id,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{"payloadJson":{}}' END AS payload_json,
           content_hash, prev_hash
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND session_id = ?
    ORDER BY ledger_seq DESC
    LIMIT ?
  `).all(MAX_CONTEXT_EVENT_PAYLOAD_BYTES, sessionId, MAX_CONTEXT_TRANSCRIPT_TAIL_ROWS) as LedgerRow[];
  return rows.reverse();
}

function payloadJson(row: LedgerRow): Record<string, unknown> {
  try {
    const outer = JSON.parse(row.payload_json) as { payloadJson?: unknown };
    if (outer.payloadJson && typeof outer.payloadJson === 'object' && !Array.isArray(outer.payloadJson)) {
      return outer.payloadJson as Record<string, unknown>;
    }
  } catch {
    // Foreign/malformed evidence does not become trusted structured input.
  }
  return {};
}

function eventToolCallId(row: LedgerRow): string | null {
  const payload = payloadJson(row);
  const nested = payload.toolCall;
  const candidates = [
    payload.toolCallId,
    payload.tool_call_id,
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as Record<string, unknown>).id
      : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * A packet may cite a tool exchange only as a complete call/result pair. This
 * is deliberately opt-in while legacy transcript sources lack stable ids; the
 * interactive adapter supplies those ids and fails rather than guessing.
 */
export function validateToolPairIntegrity(rows: LedgerRow[]): ToolPairIntegrity {
  const calls = new Map<string, LedgerRow>();
  const results = new Set<string>();
  const violations: ToolPairIntegrity['violations'] = [];

  for (const row of rows) {
    if (row.kind !== 'tool_call' && row.kind !== 'tool_result') continue;
    const toolCallId = eventToolCallId(row);
    if (!toolCallId) {
      violations.push({ code: 'missing-tool-call-id', eventId: row.event_id, toolCallId: null });
      continue;
    }
    if (row.kind === 'tool_call') {
      if (calls.has(toolCallId)) {
        violations.push({ code: 'duplicate-tool-call', eventId: row.event_id, toolCallId });
        continue;
      }
      calls.set(toolCallId, row);
      continue;
    }

    const call = calls.get(toolCallId);
    if (!call) {
      violations.push({ code: 'orphan-tool-result', eventId: row.event_id, toolCallId });
      continue;
    }
    if (results.has(toolCallId)) {
      violations.push({ code: 'duplicate-tool-result', eventId: row.event_id, toolCallId });
      continue;
    }
    if (
      typeof call.sequence === 'number'
      && typeof row.sequence === 'number'
      && row.sequence <= call.sequence
    ) {
      violations.push({ code: 'result-precedes-call', eventId: row.event_id, toolCallId });
      continue;
    }
    results.add(toolCallId);
  }

  for (const [toolCallId, call] of calls) {
    if (!results.has(toolCallId)) {
      violations.push({ code: 'unresolved-tool-call', eventId: call.event_id, toolCallId });
    }
  }
  return { valid: violations.length === 0, violations };
}

/**
 * The local ledger is a second defense behind adapter coverage.  We inspect a
 * fixed tail so hook work stays bounded; when the tail starts mid-exchange an
 * older call can legitimately precede it, so only that boundary orphan is
 * delegated to the durable adapter receipt. All complete-session fixtures and
 * ordinary short sessions receive the strict validator above.
 */
function boundedDurableToolPairIntegrity(db: DatabaseInstance, sessionId: string): ToolPairIntegrity {
  const rows = transcriptTail(db, sessionId);
  const first = rows[0];
  const older = first
    ? db.prepare(`
      SELECT 1 AS present
      FROM harbor_events
      WHERE stream_type = 'transcript-event' AND session_id = ? AND ledger_seq < ?
      LIMIT 1
    `).get(sessionId, first.ledger_seq) as { present: number } | undefined
    : undefined;
  const integrity = validateToolPairIntegrity(rows);
  if (older?.present !== 1) return integrity;
  // A bounded tail can start immediately after a call which is still present
  // in older durable evidence.  Only that first-tail-row result is ambiguous;
  // every other orphan remains an integrity failure, even when older rows exist.
  const violations = integrity.violations.filter(
    (violation) => violation.code !== 'orphan-tool-result' || violation.eventId !== first.event_id,
  );
  return { valid: violations.length === 0, violations };
}

function contextGovernance(
  assessment: EnvelopeAssessment,
  planCheckpoint: ContextPlanCheckpoint | null,
): ContextPressureGovernance {
  const planCheckpointRequired = assessment.action !== 'none';
  const riskyWorkRestricted = assessment.action === 'warn_before_broad_work'
    || assessment.action === 'require_compaction_or_successor';
  return {
    planCheckpointRequired,
    planCheckpointPresent: planCheckpoint !== null,
    riskyWorkRestricted,
    continuation: assessment.successorRequired
      ? 'governed-successor'
      : riskyWorkRestricted
        ? 'risky-work-restricted'
        : assessment.compactionNeeded
          ? 'packet-ready'
          : assessment.action === 'prepare_compaction'
            ? 'prepare'
            : 'normal',
  };
}

function estimatePersistedTranscriptTokens(db: DatabaseInstance, transcriptId: string): number {
  const hasTable = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'fleet_transcript_messages'",
  ).get() as { present: number } | undefined;
  if (!hasTable) return 0;
  const row = db.prepare(`
    SELECT COALESCE(SUM(
      LENGTH(CAST(COALESCE(content, '') AS BLOB)) + LENGTH(CAST(COALESCE(tool_calls_json, '') AS BLOB))
    ), 0) AS bytes
    FROM fleet_transcript_messages
    WHERE transcript_id = ?
  `).get(transcriptId) as { bytes: number };
  return Math.ceil(row.bytes / 4);
}

/**
 * Conservative daemon-side measurement for a session whose identifier was
 * selected by the daemon, not by an interactive hook body.  The two durable
 * projections can contain the same underlying conversation, so take their
 * maximum rather than summing and accidentally double-counting it.
 *
 * This function deliberately returns an evidence count as well as an estimate:
 * an empty daemon projection is not evidence that an interactive provider has
 * zero context.  Callers must report measurement-unavailable until at least
 * one durable transcript row exists.
 */
export function measureDaemonSessionTranscriptTokens(
  db: DatabaseInstance,
  sessionId: string,
): { usedTokensEstimate: number; evidenceRows: number; truncated: boolean } {
  // This fallback is deliberately bounded. A live adapter should install the
  // cached in-process usage witness; scanning a 100k-event transcript inside a
  // provider's PreCompact deadline would be neither timely nor trustworthy.
  const maximumRows = MAX_CONTEXT_TRANSCRIPT_TAIL_ROWS;
  const ledger = db.prepare(`
    SELECT COUNT(*) AS rows, COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) AS bytes,
           MIN(ledger_seq) AS first_ledger_seq
    FROM (
      SELECT ledger_seq, payload_json
      FROM harbor_events
      WHERE stream_type = 'transcript-event'
        AND session_id = ?
        AND kind IN ('operator_message', 'assistant_message', 'tool_call', 'tool_result')
      ORDER BY ledger_seq DESC
      LIMIT ?
    )
  `).get(sessionId, maximumRows) as { rows: number; bytes: number; first_ledger_seq: number | null };
  const ledgerEstimate = Math.ceil(Number(ledger.bytes ?? 0) / 4);
  const older = ledger.first_ledger_seq === null
    ? undefined
    : db.prepare(`
      SELECT 1 AS present
      FROM harbor_events
      WHERE stream_type = 'transcript-event'
        AND session_id = ?
        AND kind IN ('operator_message', 'assistant_message', 'tool_call', 'tool_result')
        AND ledger_seq < ?
      LIMIT 1
    `).get(sessionId, ledger.first_ledger_seq) as { present: number } | undefined;
  return {
    usedTokensEstimate: ledgerEstimate,
    evidenceRows: Number(ledger.rows ?? 0),
    truncated: older?.present === 1,
  };
}

function firstOperatorTask(db: DatabaseInstance, sessionId: string): string {
  const row = db.prepare(`
    SELECT CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{"payloadJson":{}}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND session_id = ? AND kind = 'operator_message'
    ORDER BY ledger_seq ASC
    LIMIT 1
  `).get(MAX_CONTEXT_EVENT_PAYLOAD_BYTES, sessionId) as { payload_json: string } | undefined;
  try {
    const outer = JSON.parse(row?.payload_json ?? '{}') as { payloadJson?: Record<string, unknown> };
    const content = outer.payloadJson?.content;
    if (typeof content === 'string' && content.trim()) return nonEmptyBoundedText(content) ?? `Continue witnessed session ${sessionId}`;
  } catch {
    // A malformed foreign event remains cited evidence, but cannot become telos.
  }
  return `Continue witnessed session ${sessionId}`;
}

function eventPayload(db: DatabaseInstance, eventId: string): HarborPayload | null {
  const row = db.prepare(`
    SELECT CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = ? AND event_id = ?
    LIMIT 1
  `).get(MAX_CONTEXT_EVENT_PAYLOAD_BYTES, 'transcript-event', eventId) as { payload_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as HarborPayload;
  } catch {
    return null;
  }
}

function isoTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return fallback;
}

function latestPlanContent(
  db: DatabaseInstance,
  sample: ContextContinuitySample,
): { sessionId: string | null; content: string; capturedAt: string } | null {
  const requested = sample.planCheckpoint;
  const now = sample.measuredAt ?? new Date().toISOString();
  // An adapter may carry a bounded plan snapshot, but it never gets to select
  // another session's plan for the current ContextEnvelope. The outer event
  // and the nested typed receipt must name the same durable session.
  const requestedSessionId = requested?.sessionId;
  if (
    requestedSessionId !== undefined
    && requestedSessionId !== null
    && (typeof requestedSessionId !== 'string' || requestedSessionId !== sample.sessionId)
  ) return null;
  const sessionId = sample.sessionId;
  const hasNotes = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'session_notes'",
  ).get() as { present: number } | undefined;
  if (sessionId && hasNotes) {
    const row = db.prepare(`
      SELECT content, created_at
      FROM session_notes
      WHERE session_id = ? AND type = 'todo_list'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(sessionId) as { content: unknown; created_at: unknown } | undefined;
    const content = nonEmptyBoundedText(row?.content);
    if (content) {
      return { sessionId, content, capturedAt: isoTimestamp(row?.created_at, now) };
    }
  }

  // Fixtures may carry a bounded snapshot, but a production caller with a
  // session id never overrides an available durable `pd plan` row.
  const content = nonEmptyBoundedText(requested?.content);
  if (!content) return null;
  return {
    sessionId,
    content,
    capturedAt: isoTimestamp(requested?.capturedAt, now),
  };
}

function appendPlanCheckpoint(
  db: DatabaseInstance,
  sample: ContextContinuitySample,
  suffix: string,
): ContextPlanCheckpoint | null {
  const source = latestPlanContent(db, sample);
  if (!source) return null;
  const eventId = `evt_plan_${suffix}`;
  const existing = eventPayload(db, eventId)?.payloadJson as Record<string, unknown> | undefined;
  const existingPlan = existing?.planCheckpoint;
  if (existing) {
    if (!existingPlan || typeof existingPlan !== 'object' || Array.isArray(existingPlan)) return null;
    const row = existingPlan as Record<string, unknown>;
    const content = nonEmptyBoundedText(row.content);
    if (!content || !planCheckpointSessionMatches(row.sessionId, sample.sessionId)) return null;
    return {
      eventId,
      sessionId: typeof row.sessionId === 'string' ? row.sessionId : null,
      content,
      capturedAt: isoTimestamp(row.capturedAt, source.capturedAt),
    };
  }

  appendEvent(db, {
    streamType: 'transcript-event',
    payload: {
      eventId,
      sessionId: sample.sessionId,
      agentNodeId: sample.agentNodeId,
      sequence: nextTranscriptSequence(db, sample.sessionId),
      occurredAt: source.capturedAt,
      schemaVersion: 1,
      kind: 'plan_checkpoint',
      visibility: 'operator',
      source: {
        adapter: 'pd-plan',
        idempotencyKey: `context-plan-checkpoint:${suffix}`,
      },
      payloadJson: {
        planCheckpoint: {
          schema: 'pd.plan-checkpoint.v0',
          sessionId: source.sessionId,
          content: source.content,
          capturedAt: source.capturedAt,
        },
      },
    },
  });
  return { eventId, ...source };
}

function sourceProvider(sourceAdapter: string): string | null {
  const match = /^interactive:([a-z0-9-]+)$/i.exec(sourceAdapter);
  return match?.[1]?.toLowerCase() ?? null;
}

function normalizedInteractiveSourceAdapter(sourceAdapter: unknown): string | null {
  if (typeof sourceAdapter !== 'string') return null;
  const provider = sourceProvider(sourceAdapter);
  return provider ? `interactive:${provider}` : null;
}

function planCheckpointSessionMatches(value: unknown, sessionId: string): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value === sessionId);
}

function coverageReceiptFromEvent(
  db: DatabaseInstance,
  eventId: string,
): ToolPairCoverageReceipt | null {
  const raw = eventPayload(db, eventId)?.payloadJson as Record<string, unknown> | undefined;
  const coverage = raw?.toolPairCoverage;
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) return null;
  const value = coverage as Record<string, unknown>;
  if (
    value.witness !== 'daemon-adapter'
    || !['complete', 'incomplete', 'unavailable'].includes(String(value.status))
    || typeof value.provider !== 'string'
    || typeof value.sessionId !== 'string'
    || typeof value.observationId !== 'string'
    || !Number.isInteger(value.coveredThroughLedgerSeq)
    || (value.coveredThroughLedgerSeq as number) < 0
    || !nonEmptyBoundedText(value.coverageRef, 512)
  ) return null;
  return {
    eventId,
    coverage: {
      witness: 'daemon-adapter',
      status: value.status as ToolPairCoverage['status'],
      provider: value.provider,
      sessionId: value.sessionId,
      observationId: value.observationId,
      coveredThroughLedgerSeq: value.coveredThroughLedgerSeq as number,
      coverageRef: value.coverageRef as string,
    },
  };
}

/**
 * Persist an opaque adapter coverage receipt before its packet cites it.  The
 * payload binds provider, PD session, server-derived observation key, and the
 * last ledger row seen by the adapter.  No tool payload or output blob is
 * duplicated here; overflow remains W8/W12's concern.
 */
function appendToolPairCoverageReceipt(
  db: DatabaseInstance,
  sample: ContextContinuitySample,
  suffix: string,
): ToolPairCoverageReceipt | null {
  const coverage = sample.toolPairCoverage;
  const observationId = sample.observationId ?? null;
  const provider = sourceProvider(sample.sourceAdapter);
  if (
    !coverage
    || coverage.witness !== 'daemon-adapter'
    || coverage.status !== 'complete'
    || !observationId
    || !provider
    || coverage.provider !== provider
    || coverage.sessionId !== sample.sessionId
    || coverage.observationId !== observationId
    || !Number.isInteger(coverage.coveredThroughLedgerSeq)
    || coverage.coveredThroughLedgerSeq < 0
    || !nonEmptyBoundedText(coverage.coverageRef, 512)
  ) return null;

  const state = latestTranscriptState(db, sample.sessionId);
  const currentLedgerSeq = state?.ledgerSeq ?? 0;
  if (coverage.coveredThroughLedgerSeq > currentLedgerSeq) return null;
  const unseenTool = db.prepare(`
    SELECT 1 AS present
    FROM harbor_events
    WHERE stream_type = 'transcript-event'
      AND session_id = ?
      AND ledger_seq > ?
      AND ledger_seq <= ?
      AND kind IN ('tool_call', 'tool_result')
    LIMIT 1
  `).get(sample.sessionId, coverage.coveredThroughLedgerSeq, currentLedgerSeq) as { present: number } | undefined;
  if (unseenTool?.present === 1) return null;

  const eventId = `evt_tool_coverage_${suffix}`;
  const existing = coverageReceiptFromEvent(db, eventId);
  if (existing) return existing;
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: {
      eventId,
      sessionId: sample.sessionId,
      agentNodeId: sample.agentNodeId,
      sequence: nextTranscriptSequence(db, sample.sessionId),
      occurredAt: sample.measuredAt ?? new Date().toISOString(),
      schemaVersion: 1,
      kind: 'tool_pair_coverage',
      visibility: 'operator',
      source: {
        adapter: sample.sourceAdapter,
        idempotencyKey: `interactive-tool-pair-coverage:${suffix}`,
      },
      payloadJson: {
        toolPairCoverage: {
          witness: 'daemon-adapter',
          status: coverage.status,
          provider: coverage.provider,
          sessionId: coverage.sessionId,
          observationId: coverage.observationId,
          coveredThroughLedgerSeq: coverage.coveredThroughLedgerSeq,
          coverageRef: coverage.coverageRef,
        },
      },
    },
  });
  return coverageReceiptFromEvent(db, eventId);
}

interface ExpectedVerifiedInteractiveBoundary {
  suffix: string;
  eventId: string;
  envelope: ContextEnvelope;
}

/** Build the one deterministic post-evidence boundary an interactive packet may cite. */
function expectedVerifiedInteractiveBoundary(
  existingEnvelope: ContextEnvelope,
  baseSuffix: string,
  planCheckpoint: ContextPlanCheckpoint,
  toolPairCoverageReceipt: ToolPairCoverageReceipt,
): ExpectedVerifiedInteractiveBoundary {
  const suffix = stableSuffix(baseSuffix, planCheckpoint.eventId, toolPairCoverageReceipt.eventId);
  const eventId = `evt_ctx_verified_${suffix}`;
  const envelopeId = `ctx_verified_${suffix}`;
  const contextRefs = [...(existingEnvelope.contextRefs ?? [])];
  const addRef = (ref: NonNullable<ContextEnvelope['contextRefs']>[number]) => {
    if (!contextRefs.some((candidate) => candidate.kind === ref.kind && candidate.ref === ref.ref)) {
      contextRefs.push(ref);
    }
  };
  addRef({ kind: 'attachment', ref: `pd-plan:${planCheckpoint.eventId}`, droppable: false });
  addRef({ kind: 'attachment', ref: `tool-pair-coverage:${toolPairCoverageReceipt.eventId}`, droppable: false });

  const envelope: ContextEnvelope = {
    ...existingEnvelope,
    envelopeId,
    sourceEventId: eventId,
    contextRefs,
  };
  return { suffix, eventId, envelope };
}

/**
 * Read a deterministic post-evidence boundary only when it is the exact
 * derived clone. Identity fields alone are not authority: a substituted
 * pressure/estimator or missing evidence ref would otherwise be replayable.
 */
function readVerifiedInteractiveBoundary(
  db: DatabaseInstance,
  sample: ContextContinuitySample,
  expected: ExpectedVerifiedInteractiveBoundary,
): ContextEnvelope | null {
  // A deterministic verified boundary is an exact, derived receipt rather
  // than merely a row with the right identity fields. Build the expected
  // clone before querying so a same-ID collision cannot substitute pressure,
  // estimator, or evidence refs that a later packet would treat as authority.
  const existing = db.prepare(`
    SELECT stream_type, session_id, agent_node_id, kind,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE event_id = ?
    LIMIT 1
  `).get(MAX_CONTEXT_EVENT_PAYLOAD_BYTES, expected.eventId) as {
    stream_type: string;
    session_id: string | null;
    agent_node_id: string | null;
    kind: string | null;
    payload_json: string;
  } | undefined;
  if (!existing) return null;
  if (
    existing.stream_type !== 'transcript-event'
    || existing.session_id !== sample.sessionId
    || existing.agent_node_id !== sample.agentNodeId
    || existing.kind !== 'context_pressure'
  ) {
    throw new Error(`verified interactive context boundary ${expected.eventId} collides with different durable evidence`);
  }
  let persisted: unknown;
  try {
    persisted = (JSON.parse(existing.payload_json) as { payloadJson?: { contextEnvelope?: unknown } })
      .payloadJson?.contextEnvelope;
  } catch {
    throw new Error(`verified interactive context boundary ${expected.eventId} has no readable ContextEnvelope`);
  }
  if (
    !persisted
    || typeof persisted !== 'object'
    || Array.isArray(persisted)
    || canonicalContextJson(persisted) !== canonicalContextJson(expected.envelope)
  ) {
    throw new Error(`verified interactive context boundary ${expected.eventId} collides with different durable evidence`);
  }
  return persisted as ContextEnvelope;
}

/** Read the exact deterministic plan receipt without consulting mutable current plan state. */
function persistedPlanCheckpointForInteractiveBoundary(
  db: DatabaseInstance,
  sample: ContextContinuitySample,
  eventId: string,
): ContextPlanCheckpoint | null {
  const row = db.prepare(`
    SELECT stream_type, session_id, agent_node_id, kind, occurred_at,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE event_id = ?
    LIMIT 1
  `).get(MAX_CONTEXT_EVENT_PAYLOAD_BYTES, eventId) as {
    stream_type: string;
    session_id: string | null;
    agent_node_id: string | null;
    kind: string | null;
    occurred_at: string | null;
    payload_json: string;
  } | undefined;
  if (
    !row
    || row.stream_type !== 'transcript-event'
    || row.session_id !== sample.sessionId
    || row.agent_node_id !== sample.agentNodeId
    || row.kind !== 'plan_checkpoint'
  ) return null;
  try {
    const checkpoint = (JSON.parse(row.payload_json) as { payloadJson?: { planCheckpoint?: unknown } })
      .payloadJson?.planCheckpoint;
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return null;
    const value = checkpoint as Record<string, unknown>;
    const content = nonEmptyBoundedText(value.content);
    if (!content || !planCheckpointSessionMatches(value.sessionId, sample.sessionId)) return null;
    return {
      eventId,
      sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
      content,
      capturedAt: isoTimestamp(value.capturedAt, row.occurred_at ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

/** Read the exact deterministic daemon coverage receipt and bind it to this observation. */
function persistedToolPairCoverageForInteractiveBoundary(
  db: DatabaseInstance,
  sample: ContextContinuitySample,
  eventId: string,
): ToolPairCoverageReceipt | null {
  const row = db.prepare(`
    SELECT stream_type, session_id, agent_node_id, kind
    FROM harbor_events
    WHERE event_id = ?
    LIMIT 1
  `).get(eventId) as {
    stream_type: string;
    session_id: string | null;
    agent_node_id: string | null;
    kind: string | null;
  } | undefined;
  if (
    !row
    || row.stream_type !== 'transcript-event'
    || row.session_id !== sample.sessionId
    || row.agent_node_id !== sample.agentNodeId
    || row.kind !== 'tool_pair_coverage'
  ) return null;
  const receipt = coverageReceiptFromEvent(db, eventId);
  const provider = sourceProvider(sample.sourceAdapter);
  if (
    !receipt
    || !provider
    || receipt.coverage.status !== 'complete'
    || receipt.coverage.provider !== provider
    || receipt.coverage.sessionId !== sample.sessionId
    || receipt.coverage.observationId !== sample.observationId
  ) return null;
  return receipt;
}

/**
 * Re-anchor a packet-withheld interactive observation after its missing
 * evidence arrives. The base ContextEnvelope remains an honest record of the
 * earlier withheld decision; this second, deterministic boundary is the one a
 * packet may cite because both the current pd-plan and complete coverage
 * receipt precede it. Its suffix deliberately depends only on stable receipt
 * IDs, never the mutable ledger tail, so an exact retry replays it.
 */
function verifiedInteractiveBoundary(
  db: DatabaseInstance,
  sample: ContextContinuitySample,
  existingEnvelope: ContextEnvelope,
  baseSuffix: string,
  planCheckpoint: ContextPlanCheckpoint,
  toolPairCoverageReceipt: ToolPairCoverageReceipt,
): { envelope: ContextEnvelope; suffix: string } {
  const expected = expectedVerifiedInteractiveBoundary(
    existingEnvelope,
    baseSuffix,
    planCheckpoint,
    toolPairCoverageReceipt,
  );
  const persisted = readVerifiedInteractiveBoundary(db, sample, expected);
  if (persisted) return { envelope: persisted, suffix: expected.suffix };
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: {
      eventId: expected.eventId,
      sessionId: sample.sessionId,
      agentNodeId: sample.agentNodeId,
      sequence: nextTranscriptSequence(db, sample.sessionId),
      occurredAt: expected.envelope.measuredAt,
      schemaVersion: 1,
      kind: 'context_pressure',
      visibility: 'operator',
      source: {
        adapter: sample.sourceAdapter,
        idempotencyKey: `context-continuity-verified-boundary:${expected.suffix}`,
      },
      payloadJson: { contextEnvelope: expected.envelope },
    },
  });
  return { envelope: expected.envelope, suffix: expected.suffix };
}

/** Stable comparison for deterministic derived envelope receipts. */
function canonicalContextJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate)
          .filter(([, nested]) => nested !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function planObligations(checkpoint: ContextPlanCheckpoint | null): NonNullable<CompactionPacket['obligations']> {
  if (!checkpoint) return [];
  const items = checkpoint.content.split('\n')
    .map((line) => /^\s*[-*]\s+\[([ xX-])\]\s+(.+?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .slice(0, 256);
  return items.map((match, index) => ({
    obligationId: `plan:${stableSuffix(checkpoint.eventId, String(index))}`,
    text: match[2],
    status: /x/i.test(match[1]) ? 'done' : 'open',
    citations: [{ kind: 'transcript-event', transcriptEventId: checkpoint.eventId }],
  }));
}

function packetTask(
  db: DatabaseInstance,
  sessionId: string,
  planCheckpoint: ContextPlanCheckpoint | null,
): string {
  const next = planObligations(planCheckpoint).find((obligation) => obligation.status !== 'done');
  return next?.text ?? firstOperatorTask(db, sessionId);
}

function packetForEnvelope(
  db: DatabaseInstance,
  sessionId: string,
  envelopeId: string,
  expectedEventId?: string,
  expectedSourceHeadEventId?: string,
  expectedAgentNodeId?: string,
): CompactionPacket | null {
  const rows = expectedEventId
    ? db.prepare(`
      SELECT event_id, agent_node_id,
             CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json
      FROM harbor_events
      WHERE stream_type = 'transcript-event' AND session_id = ? AND event_id = ? AND kind = 'compaction_packet'
      LIMIT 1
    `).all(MAX_CONTEXT_PACKET_EVENT_BYTES, sessionId, expectedEventId) as Array<{ event_id: string; agent_node_id: string | null; payload_json: string }>
    : db.prepare(`
      SELECT event_id, agent_node_id,
             CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json
      FROM harbor_events
      WHERE stream_type = 'transcript-event' AND session_id = ? AND kind = 'compaction_packet'
      ORDER BY ledger_seq DESC
      LIMIT 32
    `).all(MAX_CONTEXT_PACKET_EVENT_BYTES, sessionId) as Array<{ event_id: string; agent_node_id: string | null; payload_json: string }>;
  for (const row of rows) {
    try {
      const outer = JSON.parse(row.payload_json) as { payloadJson?: CompactionPacket };
      const packet = outer.payloadJson;
      if (
        packet?.trigger?.contextEnvelopeRef === envelopeId
        && packet.transcriptEventId === row.event_id
        && (!expectedSourceHeadEventId || packet.sourceTranscript?.headEventId === expectedSourceHeadEventId)
        && (!expectedAgentNodeId || (row.agent_node_id === expectedAgentNodeId && packet.agentNodeId === expectedAgentNodeId))
      ) return packet;
    } catch {
      // Tolerant read: ignore foreign or malformed packet events.
    }
  }
  return null;
}

function contextEnvelopeForPacket(
  db: DatabaseInstance,
  packet: CompactionPacket,
): ContextEnvelope | null {
  const envelopeId = packet.trigger?.contextEnvelopeRef;
  if (typeof envelopeId !== 'string' || !envelopeId.trim()) return null;
  const row = db.prepare(`
    SELECT CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event'
      AND session_id = ?
      AND event_id = ?
      AND kind = 'context_pressure'
    LIMIT 1
  `).get(
    MAX_CONTEXT_EVENT_PAYLOAD_BYTES,
    packet.sessionId,
    packet.sourceTranscript.headEventId,
  ) as { payload_json: string } | undefined;
  if (!row) return null;
  try {
    const outer = JSON.parse(row.payload_json) as { payloadJson?: { contextEnvelope?: unknown } };
    const envelope = outer.payloadJson?.contextEnvelope;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
    const value = envelope as ContextEnvelope;
    if (value.schema !== 'pd.agent-harbor.context-envelope.v0' || value.envelopeId !== envelopeId) return null;
    assessContextEnvelope(value);
    return value;
  } catch {
    return null;
  }
}

/**
 * A cached packet is only replayable with the exact ContextEnvelope in its
 * source head. Envelope ids are references, not globally unique authority:
 * callers must never substitute a same-id row from a different observation.
 */
function exactPacketEnvelopeForReplay(
  db: DatabaseInstance,
  packet: CompactionPacket,
  suppliedEnvelope: ContextEnvelope,
  requested: Pick<ContextContinuitySample, 'sessionId' | 'agentNodeId' | 'sourceAdapter'>,
): ContextEnvelope {
  if (packet.sessionId !== requested.sessionId || packet.agentNodeId !== requested.agentNodeId) {
    throw new Error(`refusing packet ${packet.packetId}: packet is not bound to the requesting session and agent`);
  }
  if (suppliedEnvelope.sessionId !== requested.sessionId || suppliedEnvelope.agentNodeId !== requested.agentNodeId) {
    throw new Error(`refusing packet ${packet.packetId}: supplied ContextEnvelope is not bound to the requesting session and agent`);
  }
  try {
    // Deferred PreCompact does not run the whole successor bootstrap, but it
    // must never return a raw historical object whose frozen packet contract
    // or self-reporting validator already says it is unsafe.
    assertAgainstSchema('compaction-packet', packet);
  } catch (error) {
    throw new Error(`refusing packet ${packet.packetId}: packet fails the frozen compaction-packet schema (${error instanceof Error ? error.message : String(error)})`);
  }
  const revalidation = validateCompactionPacket(packet, {
    db,
    validatedBy: 'lib/agent-harbor/context-continuity.ts#exactPacketEnvelopeForReplay',
  });
  if (packet.validator?.passed !== true || !revalidation.passed) {
    throw new Error(`refusing packet ${packet.packetId}: packet validator is not durably reusable (${(revalidation.errors ?? []).join('; ')})`);
  }
  const authorityError = interactivePacketAuthorityVerificationError(db, packet);
  if (authorityError) throw new Error(`refusing packet ${packet.packetId}: ${authorityError}`);
  const durableEnvelope = contextEnvelopeForPacket(db, packet);
  if (!durableEnvelope) {
    throw new Error(`refusing packet ${packet.packetId}: packet has no schema-valid ContextEnvelope at its cited source head`);
  }
  const requestedInteractiveAdapter = normalizedInteractiveSourceAdapter(requested.sourceAdapter);
  const durableInteractiveAdapter = normalizedInteractiveSourceAdapter(durableEnvelope.sourceAdapter);
  // Match in both directions. A generic historical packet is not a safe
  // substitute for an interactive retry, and an interactive packet must not
  // be handed to or relabelled by a generic/different adapter caller.
  if (requestedInteractiveAdapter || durableInteractiveAdapter) {
    const authorityAdapter = durableInteractiveAdapter ?? requestedInteractiveAdapter;
    const authorityProvider = authorityAdapter ? sourceProvider(authorityAdapter) : null;
    if (!authorityAdapter || !authorityProvider || !supportsInteractiveCompactionPacketProvider(authorityProvider)) {
      throw new Error(`refusing packet ${packet.packetId}: ${authorityAdapter ?? 'interactive adapter'} has no verified compaction-packet issuance contract in this slice`);
    }
    if (requestedInteractiveAdapter !== durableInteractiveAdapter) {
      throw new Error(`refusing packet ${packet.packetId}: requesting adapter does not match the cited interactive ContextEnvelope adapter`);
    }
  }
  if (canonicalContextJson(durableEnvelope) !== canonicalContextJson(suppliedEnvelope)) {
    throw new Error(`refusing packet ${packet.packetId}: supplied ContextEnvelope does not exactly match its durable source head`);
  }
  return durableEnvelope;
}

function verifiedBootstrap(
  db: DatabaseInstance,
  sourceSessionId: string,
  packet: CompactionPacket,
): VerifiedContextBootstrapLookup {
  if (packet.sessionId !== sourceSessionId) {
    return {
      status: 'withheld',
      sourceSessionId,
      packetId: packet.packetId ?? null,
      reason: 'packet session does not match the requested predecessor session',
    };
  }
  const envelope = contextEnvelopeForPacket(db, packet);
  if (!envelope) {
    return {
      status: 'withheld',
      sourceSessionId,
      packetId: packet.packetId ?? null,
      reason: 'packet has no durable ContextEnvelope at its cited source head',
    };
  }
  try {
    const bootstrap = resumeFromPacket(db, packet);
    // Interactive continuations are plan-first. A legacy spawner packet can
    // still be verified and projected by its established caller, but an
    // interactive entry path never turns a missing plan into a handoff prompt.
    const envelopeAdapter = (envelope as { sourceAdapter?: unknown }).sourceAdapter;
    if (typeof envelopeAdapter === 'string' && sourceProvider(envelopeAdapter) && !bootstrap.planCheckpoint) {
      return {
        status: 'withheld',
        sourceSessionId,
        packetId: packet.packetId,
        reason: 'interactive packet has no durable pd plan checkpoint',
      };
    }
    return { status: 'ready', sourceSessionId, packet, bootstrap, envelope };
  } catch (error) {
    return {
      status: 'withheld',
      sourceSessionId,
      packetId: packet.packetId ?? null,
      reason: (error instanceof Error ? error.message : String(error)).slice(0, 512),
    };
  }
}

/**
 * Read a single predecessor's newest verifiable compaction packet. This is a
 * deliberately narrow, read-only entry-path primitive: it does not infer
 * ancestry, write an episode, resurrect a process, or hand callers a raw
 * transcript. `none` therefore means "start fresh", while `withheld` means
 * durable evidence existed but failed its packet/plan gate.
 */
export function loadLatestVerifiedContextBootstrap(
  db: DatabaseInstance,
  sourceSessionId: string,
): VerifiedContextBootstrapLookup {
  const sessionId = nonEmptyBoundedText(sourceSessionId, 1_024);
  if (!sessionId) {
    return {
      status: 'withheld',
      sourceSessionId: typeof sourceSessionId === 'string' ? sourceSessionId : '',
      packetId: null,
      reason: 'source session id is not a bounded durable identifier',
    };
  }
  const rows = db.prepare(`
    SELECT event_id, agent_node_id,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) > ? THEN 1 ELSE 0 END AS payload_oversize
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND session_id = ? AND kind = 'context_pressure'
    ORDER BY ledger_seq DESC
    LIMIT 32
  `).all(MAX_CONTEXT_EVENT_PAYLOAD_BYTES, MAX_CONTEXT_EVENT_PAYLOAD_BYTES, sessionId) as Array<{
    event_id: string;
    agent_node_id: string | null;
    payload_json: string;
    payload_oversize: number;
  }>;
  for (const row of rows) {
    if (row.payload_oversize === 1) {
      return { status: 'withheld', sourceSessionId: sessionId, packetId: null, reason: 'latest context envelope exceeds bounded read budget' };
    }
    try {
      const outer = JSON.parse(row.payload_json) as { payloadJson?: { contextEnvelope?: unknown } };
      const envelope = outer.payloadJson?.contextEnvelope;
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        return { status: 'withheld', sourceSessionId: sessionId, packetId: null, reason: 'latest context envelope is malformed' };
      }
      const context = envelope as ContextEnvelope;
      if (context.schema !== 'pd.agent-harbor.context-envelope.v0') {
        return { status: 'withheld', sourceSessionId: sessionId, packetId: null, reason: 'latest context envelope uses an unsupported schema' };
      }
      const packet = packetForEnvelope(db, sessionId, context.envelopeId, undefined, row.event_id, row.agent_node_id ?? undefined);
      if (!packet) {
        const adapter = (context as { sourceAdapter?: unknown }).sourceAdapter;
        const interactive = typeof adapter === 'string' && sourceProvider(adapter) !== null;
        // The newest interactive high-pressure observation is the current
        // boundary. If it deliberately withheld a packet (missing plan,
        // coverage, or a malformed packet), an older packet must not silently
        // become successor authority for that newer state.
        if (interactive && assessContextEnvelope(context).compactionNeeded) {
          return {
            status: 'withheld',
            sourceSessionId: sessionId,
            packetId: null,
            reason: 'latest interactive compaction boundary has no verified packet',
          };
        }
        continue;
      }
      return verifiedBootstrap(db, sessionId, packet);
    } catch {
      return { status: 'withheld', sourceSessionId: sessionId, packetId: null, reason: 'latest context envelope cannot be parsed' };
    }
  }
  return { status: 'none', sourceSessionId: sessionId };
}

/**
 * Rehydrate the exact packet projection stored beside an episodic capsule.
 * This is stricter than the session lookup: it refuses any metadata mismatch
 * rather than falling back to a newer or merely similar packet.
 */
export function loadVerifiedContextBootstrapFromProjection(
  db: DatabaseInstance,
  projection: unknown,
): VerifiedContextBootstrapLookup {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return { status: 'withheld', sourceSessionId: '', packetId: null, reason: 'packet projection metadata is malformed' };
  }
  const ref = projection as Partial<ContextPacketProjectionRef>;
  const packetId = nonEmptyBoundedText(ref.packetId, 512);
  const transcriptEventId = nonEmptyBoundedText(ref.transcriptEventId, 512);
  const sourceHeadEventId = nonEmptyBoundedText(ref.sourceHeadEventId, 512);
  const sourceHeadHash = nonEmptyBoundedText(ref.sourceHeadHash, 512);
  if (
    ref.stream !== 'harbor_events'
    || !packetId
    || !transcriptEventId
    || !sourceHeadEventId
    || !sourceHeadHash
  ) {
    return { status: 'withheld', sourceSessionId: '', packetId: typeof ref.packetId === 'string' ? ref.packetId : null, reason: 'packet projection reference is incomplete' };
  }
  const row = db.prepare(`
    SELECT session_id,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) > ? THEN 1 ELSE 0 END AS payload_oversize
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ? AND kind = 'compaction_packet'
    LIMIT 1
  `).get(MAX_CONTEXT_PACKET_EVENT_BYTES, MAX_CONTEXT_PACKET_EVENT_BYTES, transcriptEventId) as {
    session_id: string | null;
    payload_json: string;
    payload_oversize: number;
  } | undefined;
  if (!row || !row.session_id || row.payload_oversize === 1) {
    return { status: 'withheld', sourceSessionId: row?.session_id ?? '', packetId, reason: 'projected compaction packet is absent or exceeds bounded read budget' };
  }
  try {
    const outer = JSON.parse(row.payload_json) as { payloadJson?: CompactionPacket };
    const packet = outer.payloadJson;
    if (
      !packet
      || packet.packetId !== packetId
      || packet.transcriptEventId !== transcriptEventId
      || packet.sourceTranscript?.headEventId !== sourceHeadEventId
      || packet.sourceTranscript?.headHash !== sourceHeadHash
    ) {
      return { status: 'withheld', sourceSessionId: row.session_id, packetId, reason: 'projected packet metadata does not match durable evidence' };
    }
    return verifiedBootstrap(db, row.session_id, packet);
  } catch {
    return { status: 'withheld', sourceSessionId: row.session_id, packetId, reason: 'projected compaction packet cannot be parsed' };
  }
}

function checkpointForPacket(db: DatabaseInstance, packet: CompactionPacket): ContextPlanCheckpoint | null {
  const citedInteractivePlan = interactiveCitedPlanCheckpointForPacket(db, packet);
  if (citedInteractivePlan.interactive) {
    if (citedInteractivePlan.error || !citedInteractivePlan.checkpoint) return null;
    return {
      eventId: citedInteractivePlan.checkpoint.transcriptEventId,
      sessionId: packet.sessionId,
      content: citedInteractivePlan.checkpoint.content,
      capturedAt: citedInteractivePlan.checkpoint.capturedAt,
    };
  }
  const head = db.prepare(`
    SELECT ledger_seq
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ? AND session_id = ?
    LIMIT 1
  `).get(packet.sourceTranscript.headEventId, packet.sessionId) as { ledger_seq: number } | undefined;
  if (!head) return null;
  const row = db.prepare(`
    SELECT event_id, occurred_at,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{"payloadJson":{}}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event'
      AND session_id = ?
      AND kind = 'plan_checkpoint'
      AND ledger_seq <= ?
    ORDER BY ledger_seq DESC
    LIMIT 1
  `).get(MAX_CONTEXT_EVENT_PAYLOAD_BYTES, packet.sessionId, head.ledger_seq) as {
    event_id: string;
    occurred_at: string | null;
    payload_json: string;
  } | undefined;
  if (!row) return null;
  try {
    const outer = JSON.parse(row.payload_json) as { payloadJson?: { planCheckpoint?: unknown } };
    const checkpoint = outer.payloadJson?.planCheckpoint;
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return null;
    const raw = checkpoint as Record<string, unknown>;
    const content = nonEmptyBoundedText(raw.content);
    if (!content) return null;
    return {
      eventId: row.event_id,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
      content,
      capturedAt: isoTimestamp(raw.capturedAt, row.occurred_at ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

function handoffEpisodeId(db: DatabaseInstance, packetId: string): number | null {
  const hasTable = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'episodic_memory'",
  ).get() as { present: number } | undefined;
  if (!hasTable) return null;
  const row = db.prepare(`
    SELECT id FROM episodic_memory
    WHERE source_type = 'handoff-capsule'
      AND source_id = ?
      AND episode_type = 'handoff'
    LIMIT 1
  `).get(`context-continuity:${packetId}`) as { id: number } | undefined;
  return row?.id ?? null;
}

function capsuleFromPacket(
  db: DatabaseInstance,
  packet: CompactionPacket,
  sample: ContextContinuitySample,
  gitleaksRunner?: GitleaksRunner,
): HandoffCapsuleV0 {
  const planCheckpoint = checkpointForPacket(db, packet);
  const citationHandles = Array.from(new Set([
    packet.transcriptEventId,
    packet.sourceTranscript.headEventId,
    planCheckpoint?.eventId,
    ...(packet.transcriptExcerpts ?? []).map((excerpt) => excerpt.citation?.transcriptEventId),
    ...(packet.obligations ?? []).flatMap((obligation) =>
      (obligation.citations ?? []).map((citation) => citation.transcriptEventId),
    ),
    ...(packet.decisions ?? []).flatMap((decision) =>
      (decision.citations ?? []).map((citation) => citation.transcriptEventId),
    ),
  ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim())))).slice(0, 32);
  // A continuation consumes the last durable `pd plan` plus its verified
  // packet. It never receives a raw operator transcript dump: the packet's
  // own cited excerpts remain available by ledger handle when a human needs to
  // zoom in, but they are not copied into the cross-backend handoff capsule.
  const operatorTurns = planCheckpoint ? [{
    id: planCheckpoint.eventId,
    at: planCheckpoint.capturedAt,
    text: planCheckpoint.content,
  }] : [];
  const raw = {
    capsuleId: packet.packetId,
    capturedAt: packet.createdAt,
    source: {
      adapter: sample.sourceAdapter,
      sessionId: packet.sessionId,
      agentId: packet.agentNodeId,
      workflowId: packet.runId ?? null,
      transcriptRef: `agent-harbor:${packet.packetId}`,
    },
    target: null,
    identity: {
      project: sample.project ?? null,
      projectDir: sample.projectDir ?? null,
      harbor: null,
    },
    workspace: {
      cwd: sample.workdir ?? null,
      repoRoot: sample.projectDir ?? sample.workdir ?? null,
      branch: sample.branch ?? null,
      worktreeId: sample.worktreeId ?? null,
      gitHead: null,
      dirtyFiles: packet.workspace?.files ?? [],
    },
    telos: packet.identity.task,
    operatorTurns,
    decisions: (packet.decisions ?? []).map((decision, index) => ({
      id: `packet-decision-${index + 1}`,
      at: packet.createdAt,
      text: decision.rationale ? `${decision.text}\nRationale: ${decision.rationale}` : decision.text,
      source: 'agent',
    })),
    coordination: [
      ...packet.obligations.map((obligation, index) => ({
        id: obligation.obligationId ?? `packet-obligation-${index + 1}`,
        at: packet.createdAt,
        text: `${obligation.status}: ${obligation.text}`,
        kind: obligation.status === 'blocked' ? 'blocker' : 'scope',
      })),
      ...(packet.blockers ?? []).map((blocker, index) => ({
        id: `packet-blocker-${index + 1}`,
        at: packet.createdAt,
        text: blocker,
        kind: 'blocker',
      })),
      {
        id: `packet-next-action-${packet.packetId}`,
        at: packet.createdAt,
        text: [
          `Next action: ${packet.nextAction.recommendation}`,
          ...(packet.nextAction.safetyConstraints ?? []).map((constraint) => `Constraint: ${constraint}`),
        ].join('\n'),
        kind: 'scope',
      },
      {
        id: `packet-citations-${packet.packetId}`,
        at: packet.createdAt,
        text: `Verified cited ledger handles: ${citationHandles.join(', ') || '(none)'}.`,
        kind: 'result',
      },
      {
        id: `packet-proof-${packet.packetId}`,
        at: packet.createdAt,
        text: `Verified compaction packet ${packet.packetId}; source head ${packet.sourceTranscript.headEventId}.`,
        kind: 'result',
      },
    ],
    artifacts: (packet.workspace?.files ?? []).map((path) => ({
      path,
      kind: 'workspace-file',
      summary: null,
      sourceBlockId: null,
    })),
    tail: [],
  };
  return sanitizeHandoffCapsule(raw, { gitleaksRunner });
}

function rememberHandoff(
  memory: Pick<EpisodicMemory, 'remember'>,
  packet: CompactionPacket,
  sample: ContextContinuitySample,
  capsule: HandoffCapsuleV0,
): number {
  return memory.remember({
    projectDir: sample.projectDir ?? sample.workdir ?? null,
    project: sample.project ?? null,
    harbor: null,
    agentId: packet.agentNodeId,
    episodeType: 'handoff',
    title: `Context continuation: ${packet.identity.task}`.slice(0, 200),
    summary: [
      packet.identity.task,
      `Verified packet ${packet.packetId}`,
      `Pressure ${Math.round((packet.trigger.pressure ?? 0) * 100)}%`,
      packet.nextAction.recommendation,
    ].join('\n'),
    sourceType: 'handoff-capsule',
    sourceId: `context-continuity:${packet.packetId}`,
    worktreeId: sample.worktreeId ?? null,
    branchName: sample.branch ?? null,
    metadata: {
      capsule,
      projectionOf: {
        stream: 'harbor_events',
        packetId: packet.packetId,
        transcriptEventId: packet.transcriptEventId ?? null,
        sourceHeadEventId: packet.sourceTranscript.headEventId,
        sourceHeadHash: packet.sourceTranscript.headHash,
      },
    },
  }).id;
}

/**
 * Replay a committed packet without inspecting later provider/tool work. A
 * retry is about the packet's original cited boundary, not a new observation;
 * re-running current-tail coverage here would turn an unrelated later tool
 * call into a false rejection after a crash or provider retry.
 */
function replayCommittedContextPacket(
  db: DatabaseInstance,
  deps: ContextContinuityCoordinatorDeps,
  sample: ContextContinuitySample,
  envelope: ContextEnvelope,
  packet: CompactionPacket,
): ContextContinuityResult {
  // Deferred PreCompact replays intentionally avoid a full successor bootstrap
  // on the provider's deadline, but they must still enforce the same derived
  // context-boundary authority used by resume/takeover/fresh-begin paths.
  const durableEnvelope = exactPacketEnvelopeForReplay(db, packet, envelope, sample);
  const assessment = assessContextEnvelope(durableEnvelope);
  const planCheckpoint = checkpointForPacket(db, packet);
  const toolPairCoverageReceipt = packet.interactiveToolPairCoverage
    ? coverageReceiptFromEvent(db, packet.interactiveToolPairCoverage.receiptEventId)
    : null;
  // A provider PreCompact deadline may not page an entire append-only
  // session merely to replay an already-written receipt. Packet/schema
  // validation happened before the write; full chain revalidation is
  // reserved for the governed loader/continuation path below.
  const verifiedBootstrap = sample.deferHandoffProjection
    ? null
    : resumeFromPacket(db, packet);
  let bootstrap: SuccessorBootstrap | null = verifiedBootstrap;
  let episodeId = handoffEpisodeId(db, packet.packetId);
  if (!sample.deferHandoffProjection && deps.episodicMemory && episodeId === null) {
    try {
      const capsule = capsuleFromPacket(db, packet, sample, deps.gitleaksRunner);
      episodeId = rememberHandoff(deps.episodicMemory, packet, sample, capsule);
    } catch (error) {
      deps.logger?.error('context_continuity_handoff_projection_failed', {
        agentNodeId: sample.agentNodeId,
        sessionId: sample.sessionId,
        packetId: packet.packetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    schema: CONTEXT_CONTINUITY_SCHEMA,
    envelope: durableEnvelope,
    assessment,
    packet,
    bootstrap,
    handoffEpisodeId: episodeId,
    replayed: true,
    planCheckpoint,
    // The verifier above proves the packet's original bounded coverage
    // boundary. Do not reinterpret later provider events as evidence
    // against this already committed observation.
    toolPairIntegrity: packet.interactiveToolPairCoverage ? { valid: true, violations: [] } : null,
    toolPairCoverage: toolPairCoverageReceipt?.coverage ?? null,
    toolPairCoverageReceipt,
    governance: contextGovernance(assessment, planCheckpoint),
  };
}

export function createContextContinuityCoordinator(
  db: DatabaseInstance,
  deps: ContextContinuityCoordinatorDeps = {},
) {
  function record(sample: ContextContinuitySample): ContextContinuityResult {
    const requestedInteractiveProvider = sourceProvider(sample.sourceAdapter);
    if (
      requestedInteractiveProvider
      && !supportsInteractiveCompactionPacketProvider(requestedInteractiveProvider)
    ) {
      throw new Error(`interactive:${requestedInteractiveProvider} has no verified compaction-packet issuance contract in this slice`);
    }
    // Interactive observation IDs are durable delivery keys.  Do not mix a
    // caller's mutable run/transcript metadata into that key: a retry must
    // replay the same packet even when a provider rotates an opaque reference.
    // Legacy spawner receipts retain their existing session/run identity.
    const suffix = sample.requireCompleteToolPairs && sample.observationId
      ? stableSuffix(sample.sessionId, sample.observationId)
      : stableSuffix(sample.sessionId, sample.runId ?? sample.transcriptId, sample.observationId ?? null);
    const eventId = `evt_ctx_${suffix}`;
    const envelopeId = `ctx_${suffix}`;
    const existing = eventPayload(db, eventId);
    const existingPayload = existing?.payloadJson as Record<string, unknown> | undefined;

    // A deterministic delivery retry must replay the already committed
    // evidence boundary before it observes the current provider stream.  In
    // particular, a tool call/result may legitimately arrive *after* the
    // original packet while a crashed hook is retried. Re-evaluating that new
    // row against the old coverage cursor would reject a valid committed packet
    // and tempt callers to mint a second one. `resumeFromPacket` revalidates
    // the original cited head and durable receipt without treating later work
    // as part of that earlier boundary.
    const existingEnvelope = existingPayload?.contextEnvelope as ContextEnvelope | undefined;
    if (
      existingEnvelope
      && (existingEnvelope.sessionId !== sample.sessionId || existingEnvelope.agentNodeId !== sample.agentNodeId)
    ) {
      throw new Error(`interactive context observation ${eventId} is already bound to a different session or agent`);
    }
    const existingPacket = existingEnvelope
      ? packetForEnvelope(db, sample.sessionId, existingEnvelope.envelopeId, `evt_cpk_${suffix}`, eventId, sample.agentNodeId)
      : null;
    if (existingEnvelope && existingPacket) {
      return replayCommittedContextPacket(db, deps, sample, existingEnvelope, existingPacket);
    }
    if (existingEnvelope) {
      // A previously withheld base observation can later gain its plan and
      // coverage receipts. Look up the deterministic verified descendant
      // before examining the current tail, exactly as we do for a base packet:
      // later tool work belongs to a later provider turn, never the old packet.
      const verifiedSuffix = stableSuffix(
        suffix,
        `evt_plan_${suffix}`,
        `evt_tool_coverage_${suffix}`,
      );
      const verifiedEnvelopeId = `ctx_verified_${verifiedSuffix}`;
      const verifiedPacket = packetForEnvelope(
        db,
        sample.sessionId,
        verifiedEnvelopeId,
        `evt_cpk_${verifiedSuffix}`,
        `evt_ctx_verified_${verifiedSuffix}`,
        sample.agentNodeId,
      );
      if (verifiedPacket) {
        const verifiedEnvelope = contextEnvelopeForPacket(db, verifiedPacket);
        if (!verifiedEnvelope) {
          throw new Error(`verified interactive packet ${verifiedPacket.packetId} has no readable context boundary`);
        }
        return replayCommittedContextPacket(db, deps, sample, verifiedEnvelope, verifiedPacket);
      }
    }

    const planCheckpoint = appendPlanCheckpoint(db, sample, suffix);
    const toolPairCoverageReceipt = appendToolPairCoverageReceipt(db, sample, suffix);
    let replayed = existing !== null;
    let packetSuffix = suffix;
    let envelope: ContextEnvelope;

    if (existingEnvelope) {
      const existingAssessment = assessContextEnvelope(existingEnvelope);
      if (
        sample.requireCompleteToolPairs
        && !existingPacket
        && existingAssessment.compactionNeeded
        && planCheckpoint
        && toolPairCoverageReceipt
      ) {
        const verified = verifiedInteractiveBoundary(
          db,
          sample,
          existingEnvelope,
          suffix,
          planCheckpoint,
          toolPairCoverageReceipt,
        );
        envelope = verified.envelope;
        packetSuffix = verified.suffix;
      } else {
        envelope = existingEnvelope;
      }
    } else {
      const daemonEstimate = Math.max(
        finiteNonNegative(sample.daemonUsedTokensEstimate),
        // Interactive PreCompact already supplied a bounded daemon-owned
        // measurement. Do not turn that hook into an unbounded second scan of
        // the provider transcript projection; legacy spawner ingestion keeps
        // its established persisted-transcript fallback.
        sample.requireCompleteToolPairs ? 0 : estimatePersistedTranscriptTokens(db, sample.transcriptId),
      );
      const adapterEstimate = finiteNonNegative(sample.adapterUsedTokensEstimate);
      const usedTokensEstimate = Math.max(daemonEstimate, adapterEstimate);
      envelope = buildContextEnvelope({
        envelopeId,
        agentNodeId: sample.agentNodeId,
        sessionId: sample.sessionId,
        runId: sample.runId ?? sample.transcriptId,
        windowTokens: sample.windowTokens,
        usedTokensEstimate,
        sourceEventId: eventId,
        measuredAt: sample.measuredAt,
        contextRefs: [
          { kind: 'attachment', ref: `fleet-transcript:${sample.transcriptId}`, droppable: false },
          // Keep the frozen ContextEnvelope enum intact; the typed checkpoint
          // event remains the cited source while this durable attachment is its
          // envelope handle.
          ...(planCheckpoint ? [{ kind: 'attachment', ref: `pd-plan:${planCheckpoint.eventId}`, droppable: false }] : []),
          ...(toolPairCoverageReceipt
            ? [{ kind: 'attachment', ref: `tool-pair-coverage:${toolPairCoverageReceipt.eventId}`, droppable: false }]
            : []),
        ],
      });
      envelope.transcriptId = sample.transcriptId;
      envelope.model = sample.model;
      envelope.sourceAdapter = sample.sourceAdapter;
      envelope.project = sample.project ?? null;
      envelope.projectDir = sample.projectDir ?? sample.workdir ?? null;
      envelope.estimator = {
        strategy: 'max-daemon-and-adapter',
        daemonUsedTokensEstimate: daemonEstimate,
        adapterUsedTokensEstimate: adapterEstimate,
        estimateMode: sample.estimateMode,
        confidence: sample.estimateMode === 'exact' ? 'backend-reported' : 'conservative-estimate',
      };
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: {
          eventId,
          sessionId: sample.sessionId,
          agentNodeId: sample.agentNodeId,
          sequence: nextTranscriptSequence(db, sample.sessionId),
          occurredAt: envelope.measuredAt,
          schemaVersion: 1,
          kind: 'context_pressure',
          visibility: 'operator',
          source: {
            adapter: sample.sourceAdapter,
            idempotencyKey: `context-continuity:${suffix}`,
          },
          payloadJson: { contextEnvelope: envelope },
        },
      });
    }

    const assessment = assessContextEnvelope(envelope);
    const governance = contextGovernance(assessment, planCheckpoint);
    let packet = packetForEnvelope(
      db,
      sample.sessionId,
      envelope.envelopeId,
      `evt_cpk_${packetSuffix}`,
      envelope.sourceEventId ?? undefined,
      sample.agentNodeId,
    );
    let bootstrap: SuccessorBootstrap | null = null;
    let episodeId = packet ? handoffEpisodeId(db, packet.packetId) : null;
    let toolPairIntegrity: ToolPairIntegrity | null = null;
    const toolPairCoverage = sample.toolPairCoverage ?? null;

    if (sample.requireCompleteToolPairs && assessment.compactionNeeded) {
      // `PreCompact` runs after a provider decided to compact; it does not
      // itself enumerate tool calls/results.  Treat an empty local ledger as
      // UNKNOWN, never as proof that no exchange can be split.  The narrow
      // daemon-adapter witness is the only authority for complete coverage.
      if (toolPairCoverage?.witness !== 'daemon-adapter' || toolPairCoverage.status === 'unavailable') {
        throw new ToolPairCoverageError(toolPairCoverage);
      }
      if (toolPairCoverage.status !== 'complete') {
        toolPairIntegrity = {
          valid: false,
          violations: [{
            code: 'unresolved-tool-call',
            eventId: `coverage:${toolPairCoverage.coverageRef}`,
            toolCallId: null,
          }],
        };
        throw new ToolPairIntegrityError(toolPairIntegrity);
      }
      if (!toolPairCoverageReceipt) throw new ToolPairCoverageError(toolPairCoverage);
      toolPairIntegrity = boundedDurableToolPairIntegrity(db, sample.sessionId);
      if (!toolPairIntegrity.valid) throw new ToolPairIntegrityError(toolPairIntegrity);
    }

    // A packet is plan-first evidence, not a substitute for the missing plan.
    // Keep the pressure envelope so the caller can explain the restriction,
    // but never manufacture a packet at or above 0.75 until the current
    // durable checkpoint has been read. This applies to automatic hooks too:
    // auto compaction may progress fail-open, while the continuation packet is
    // explicitly withheld until its authority exists.
    if (
      assessment.compactionNeeded
      && !packet
      // Existing spawner receipts predate the interactive plan hook and keep
      // their established packet behavior. The strict plan-first gate applies
      // exactly to interactive adapters that opt into complete tool pairs.
      && (!sample.requireCompleteToolPairs || planCheckpoint)
    ) {
      const built = buildCompactionPacket(db, {
        agentNodeId: sample.agentNodeId,
        sessionId: sample.sessionId,
        runId: sample.runId ?? sample.transcriptId,
        createdBy: { kind: 'daemon' },
        contextEnvelope: envelope,
        identity: {
          task: packetTask(db, sample.sessionId, planCheckpoint),
          ...(planCheckpoint ? { operatorInstructions: [planCheckpoint.content] } : {}),
        },
        obligations: planObligations(planCheckpoint),
        factualClaims: [],
        ...(toolPairCoverageReceipt ? {
          decisions: [{
            text: 'Daemon-owned tool-pair coverage is complete for this cited compaction boundary.',
            citations: [{ kind: 'transcript-event' as const, transcriptEventId: toolPairCoverageReceipt.eventId }],
          }],
          interactiveToolPairCoverage: {
            receiptEventId: toolPairCoverageReceipt.eventId,
            provider: toolPairCoverageReceipt.coverage.provider,
            sessionId: toolPairCoverageReceipt.coverage.sessionId,
            observationId: toolPairCoverageReceipt.coverage.observationId,
            coveredThroughLedgerSeq: toolPairCoverageReceipt.coverage.coveredThroughLedgerSeq,
            coverageRef: toolPairCoverageReceipt.coverage.coverageRef,
          },
        } : {}),
        nextAction: {
          recommendation: assessment.successorRequired
            ? 'Compact in place or start exactly one governed successor from this verified packet before broad new work.'
            : assessment.action === 'warn_before_broad_work'
              ? 'Checkpoint `pd plan`, preserve this verified packet, and do not begin broad or risky work.'
              : 'Checkpoint `pd plan` and prepare an operator-approved continuation from this verified packet if the run continues.',
          safetyConstraints: [
            ...(planCheckpoint
              ? ['Use the cited `pd plan` checkpoint as the continuation checklist; do not reconstruct it from raw transcript text.']
              : ['Run and checkpoint `pd plan` before continuing; no raw transcript dump substitutes for the missing plan.']),
            'Revalidate the packet against the append-only transcript before spawning.',
            'Use the existing idempotent continuation receipt; never spawn a second successor for the same key.',
          ],
        },
        packetId: `cpk_ctx_${packetSuffix}`,
        eventId: `evt_cpk_${packetSuffix}`,
      });
      packet = built.packet;
      replayed = false;
    }

    if (packet) {
      // A concurrent or historical append can make this post-evidence lookup
      // find a packet that was absent before we wrote the receipts. Verify its
      // exact source envelope even on deferred PreCompact paths; otherwise a
      // same-id alias could be returned without ever reaching resume.
      envelope = exactPacketEnvelopeForReplay(db, packet, envelope, sample);
      // PreCompact keeps its hook deadline bounded: build-time packet checks
      // inspect only the capped tail and cited rows. The governed successor
      // path calls `resumeFromPacket`, whose whole-session hash-chain audit is
      // intentionally deferred rather than hidden in a provider lifecycle
      // callback.
      if (!sample.deferHandoffProjection) {
        bootstrap = resumeFromPacket(db, packet);
      }
      if (!sample.deferHandoffProjection && deps.episodicMemory && episodeId === null) {
        try {
          const capsule = capsuleFromPacket(db, packet, sample, deps.gitleaksRunner);
          episodeId = rememberHandoff(deps.episodicMemory, packet, sample, capsule);
        } catch (error) {
          deps.logger?.error('context_continuity_handoff_projection_failed', {
            agentNodeId: sample.agentNodeId,
            sessionId: sample.sessionId,
            packetId: packet.packetId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      schema: CONTEXT_CONTINUITY_SCHEMA,
      envelope,
      assessment,
      packet,
      bootstrap,
      handoffEpisodeId: episodeId,
      replayed,
      planCheckpoint,
      toolPairIntegrity,
      toolPairCoverage,
      toolPairCoverageReceipt,
      governance,
    };
  }

  return { record };
}

function continuationForPacket(db: DatabaseInstance, packetId: string): ContextContinuityItem['continuation'] {
  const hasTable = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'agent_continuations'",
  ).get() as { present: number } | undefined;
  if (!hasTable) return null;
  const row = db.prepare(`
    SELECT id, status, target_adapter, successor_run_id, successor_session_id, updated_at
    FROM agent_continuations
    WHERE source_capsule_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(packetId) as {
    id: string;
    status: string;
    target_adapter: string;
    successor_run_id: string | null;
    successor_session_id: string | null;
    updated_at: number;
  } | undefined;
  return row ? {
    id: row.id,
    status: row.status,
    targetAdapter: row.target_adapter,
    successorRunId: row.successor_run_id,
    successorSessionId: row.successor_session_id,
    updatedAt: row.updated_at,
  } : null;
}

function readiness(
  assessment: EnvelopeAssessment,
  packet: CompactionPacket | null,
  continuation: ContextContinuityItem['continuation'],
): ContextContinuityItem['readiness'] {
  if (continuation?.status === 'completed') return 'completed';
  if (continuation && ['failed', 'unsupported', 'orphaned'].includes(continuation.status)) return 'failed';
  if (continuation) return 'continuing';
  if (packet && assessment.successorRequired) return 'successor-required';
  if (packet) return 'packet-ready';
  return 'observed';
}

export function listContextContinuity(
  db: DatabaseInstance,
  options: { limit?: number; projectDir?: string | null } = {},
): ContextContinuityProjection {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = db.prepare(`
    SELECT event_id, session_id, agent_node_id,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) > ? THEN 1 ELSE 0 END AS payload_oversize
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND kind = 'context_pressure'
    ORDER BY ledger_seq DESC
    LIMIT ?
  `).all(
    MAX_CONTEXT_EVENT_PAYLOAD_BYTES,
    MAX_CONTEXT_EVENT_PAYLOAD_BYTES,
    options.projectDir ? MAX_CONTEXT_PROJECTION_SCAN_ROWS : limit,
  ) as Array<{
    event_id: string;
    session_id: string;
    agent_node_id: string;
    payload_json: string;
    payload_oversize: number;
  }>;

  const items: ContextContinuityItem[] = [];
  const failures: ContextContinuityFailure[] = [];
  for (const row of rows) {
    let rowProjectDir: string | null = null;
    try {
      if (row.payload_oversize === 1) {
        throw new Error(`context envelope payload exceeds the ${MAX_CONTEXT_EVENT_PAYLOAD_BYTES}-byte projection budget`);
      }
      const outer = JSON.parse(row.payload_json) as HarborPayload;
      const payloadJson = outer.payloadJson as Record<string, unknown> | undefined;
      const envelope = payloadJson?.contextEnvelope as ContextEnvelope | undefined;
      if (!envelope || envelope.schema !== 'pd.agent-harbor.context-envelope.v0') {
        throw new Error('context envelope is missing or uses an unsupported schema');
      }
      rowProjectDir = typeof envelope.projectDir === 'string' ? envelope.projectDir : null;
      if (options.projectDir && rowProjectDir !== options.projectDir) continue;
      const assessment = assessContextEnvelope(envelope);
      const packet = packetForEnvelope(db, row.session_id, envelope.envelopeId, undefined, row.event_id, row.agent_node_id);
      if (packet) resumeFromPacket(db, packet);
      const continuation = packet ? continuationForPacket(db, packet.packetId) : null;
      const estimator = (envelope.estimator ?? {}) as Record<string, unknown>;
      items.push({
        agentNodeId: row.agent_node_id,
        sessionId: row.session_id,
        runId: envelope.runId ?? null,
        transcriptId: typeof envelope.transcriptId === 'string' ? envelope.transcriptId : null,
        model: typeof envelope.model === 'string' ? envelope.model : null,
        sourceAdapter: typeof envelope.sourceAdapter === 'string' ? envelope.sourceAdapter : null,
        project: typeof envelope.project === 'string' ? envelope.project : null,
        projectDir: rowProjectDir,
        envelopeId: envelope.envelopeId,
        measuredAt: envelope.measuredAt,
        pressure: {
          band: assessment.band,
          ratio: assessment.ratio,
          action: assessment.action,
          windowTokens: envelope.windowTokens,
          usedTokensEstimate: envelope.usedTokensEstimate,
          estimateMode: typeof estimator.estimateMode === 'string' ? estimator.estimateMode : 'unknown',
          strategy: typeof estimator.strategy === 'string' ? estimator.strategy : 'unknown',
          selfReportDrift: assessment.selfReportDrift,
        },
        packet: packet ? {
          packetId: packet.packetId,
          createdAt: packet.createdAt,
          validatorPassed: packet.validator.passed,
          sourceHeadEventId: packet.sourceTranscript.headEventId,
          sourceHeadHash: packet.sourceTranscript.headHash,
          transcriptEventId: packet.transcriptEventId ?? null,
        } : null,
        handoffEpisodeId: packet ? handoffEpisodeId(db, packet.packetId) : null,
        continuation,
        readiness: readiness(assessment, packet, continuation),
      });
      if (items.length >= limit) break;
    } catch (error) {
      // Do not show a false green receipt, but do preserve the existence of a
      // failed proof. Project-scoped reads omit failures that cannot safely be
      // attributed to the requested project.
      if (!options.projectDir || rowProjectDir === options.projectDir) {
        failures.push({
          eventId: row.event_id,
          sessionId: row.session_id,
          agentNodeId: row.agent_node_id,
          reason: (error instanceof Error ? error.message : String(error)).slice(0, 240),
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    counts: {
      observed: items.length,
      packetReady: items.filter((item) => item.packet !== null).length,
      successorRequired: items.filter((item) => item.readiness === 'successor-required').length,
      continuing: items.filter((item) => item.readiness === 'continuing').length,
      completed: items.filter((item) => item.readiness === 'completed').length,
      verificationFailed: failures.length,
    },
    items,
    failures,
  };
}
