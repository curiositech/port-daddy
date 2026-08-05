import { createHash, randomBytes } from 'node:crypto';
import type { SpawnTelemetry } from './spawner.js';

export const AGENT_RUN_RECEIPT_SCHEMA = 'pd.agent-run-receipt.v1' as const;

/** A 'live' claim is only trustworthy while the supervisor heartbeat backing it is this fresh. */
export const AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS = 65_000;

export const AGENT_RUN_LIST_DEFAULT_LIMIT = 50;
export const AGENT_RUN_LIST_MAX_LIMIT = 200;

export type AgentRunKind = 'spawn' | 'session-continuation';

export type AgentRunReceiptStatus =
  | 'accepted'
  | 'starting'
  | 'live'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'over_budget'
  | 'no_runtime'
  | 'unknown';

export const TERMINAL_AGENT_RUN_STATUSES: ReadonlySet<AgentRunReceiptStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'over_budget',
  'no_runtime',
]);

export interface AgentRunPredecessorSnapshot {
  sessionId: string;
  purpose: string | null;
  status: string | null;
}

export interface AgentRunLiveEvidence {
  pid: number;
  supervisorHeartbeatAt: number;
}

export interface AgentRunReceipt {
  schema: typeof AGENT_RUN_RECEIPT_SCHEMA;
  id: string;
  kind: AgentRunKind;
  requestHash: string;
  predecessorSessionId: string | null;
  predecessor: AgentRunPredecessorSnapshot | null;
  successorSessionId: string | null;
  successorAgentId: string | null;
  transcriptId: string | null;
  status: AgentRunReceiptStatus;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  budgetUsd: number | null;
  telemetry: SpawnTelemetry | null;
  error: string | null;
}

export interface AgentRunReceiptListFilter {
  status?: AgentRunReceiptStatus | AgentRunReceiptStatus[];
  kind?: AgentRunKind;
  predecessorSessionId?: string;
  limit?: number;
}

interface AgentRunReceiptRow {
  id: string;
  kind: AgentRunKind;
  idempotency_key_hash: string;
  request_hash: string;
  predecessor_session_id: string | null;
  predecessor_snapshot_json: string | null;
  successor_session_id: string | null;
  successor_agent_id: string | null;
  transcript_id: string | null;
  status: AgentRunReceiptStatus;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  budget_usd: number | null;
  telemetry_json: string | null;
  error: string | null;
}

/** A prepared-statement surface both better-sqlite3 and bun:sqlite satisfy. */
interface PortableStatement {
  run(...args: unknown[]): { changes: number };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

export interface PortableDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): PortableStatement;
}

export class AgentRunIdempotencyConflictError extends Error {
  constructor(readonly receiptId: string) {
    super('idempotency key was already used for a different agent run request');
    this.name = 'AgentRunIdempotencyConflictError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function required(value: string, field: string, maxBytes = 512): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes || /[\0\r\n]/.test(normalized)) {
    throw new Error(`${field} exceeds its safe identifier boundary`);
  }
  return normalized;
}

/**
 * Canonicalize one receipt payload with ordinary JSON semantics and sorted
 * object keys. The purpose is stable idempotency hashing without treating
 * benign optional `undefined` properties differently from omitted properties.
 *
 * @param value Payload to serialize before hashing or durable storage.
 * @returns Deterministic JSON text, or throws when the root is not serializable.
 */
function canonicalJson(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (_key, nestedValue) => {
      if (nestedValue === null || typeof nestedValue !== 'object' || Array.isArray(nestedValue)) {
        return nestedValue;
      }
      const record = nestedValue as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
    });
  } catch (error) {
    throw new Error(`agent run receipt payload must be JSON serializable: ${(error as Error).message}`);
  }
  if (serialized === undefined) {
    throw new Error('agent run receipt payload must be JSON serializable');
  }
  return serialized;
}

/**
 * A corrupt or malformed optional JSON payload must never be promoted into
 * evidence about the receipt. Fail closed: return null, never invent a shape.
 */
function parseJsonObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function toReceipt(row: AgentRunReceiptRow): AgentRunReceipt {
  return {
    schema: AGENT_RUN_RECEIPT_SCHEMA,
    id: row.id,
    kind: row.kind,
    requestHash: row.request_hash,
    predecessorSessionId: row.predecessor_session_id,
    predecessor: parseJsonObject<AgentRunPredecessorSnapshot>(row.predecessor_snapshot_json),
    successorSessionId: row.successor_session_id,
    successorAgentId: row.successor_agent_id,
    transcriptId: row.transcript_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    budgetUsd: row.budget_usd,
    telemetry: parseJsonObject<SpawnTelemetry>(row.telemetry_json),
    error: row.error,
  };
}

function clampListLimit(requested: number | undefined): number {
  const parsed = Number.isFinite(requested) ? Math.trunc(requested as number) : AGENT_RUN_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), AGENT_RUN_LIST_MAX_LIMIT);
}

/**
 * Durable, restart-safe ledger for agent run receipts.
 *
 * Idempotency is enforced by the database itself: `idempotency_key_hash` is
 * UNIQUE and the insert is a single atomic `INSERT ... ON CONFLICT DO
 * NOTHING`, so two concurrent callers racing on the same key can never create
 * two rows — one wins the insert, the other observes it via the same SELECT.
 *
 * A run that loses liveness (daemon restart while `accepted`/`starting`/
 * `live`) is marked `unknown` and can only ever be reconciled back to `live`
 * with fresh, direct evidence (a real PID plus a recent supervisor
 * heartbeat). `unknown` never transitions straight to a terminal status —
 * lost liveness is never silently treated as success.
 */
export function createAgentRunReceiptStore(
  db: PortableDatabase,
  options: { now?: () => number; recoverNonTerminal?: boolean } = {},
) {
  const now = options.now ?? Date.now;

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_run_receipts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      idempotency_key_hash TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      predecessor_session_id TEXT,
      predecessor_snapshot_json TEXT,
      successor_session_id TEXT,
      successor_agent_id TEXT,
      transcript_id TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      budget_usd REAL,
      telemetry_json TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_receipts_status
      ON agent_run_receipts(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_run_receipts_predecessor
      ON agent_run_receipts(predecessor_session_id, created_at DESC);
  `);

  if (options.recoverNonTerminal !== false) {
    const recoveredAt = now();
    db.prepare(`
      UPDATE agent_run_receipts
      SET status = 'unknown', updated_at = ?,
          error = COALESCE(error, 'Daemon restarted before a terminal event; task outcome is unknown.')
      WHERE status IN ('accepted', 'starting', 'live')
    `).run(recoveredAt);
  }

  const insert = db.prepare(`
    INSERT INTO agent_run_receipts (
      id, kind, idempotency_key_hash, request_hash, predecessor_session_id,
      predecessor_snapshot_json, successor_session_id, successor_agent_id,
      transcript_id, status, created_at, updated_at, started_at, completed_at,
      budget_usd, telemetry_json, error
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'accepted', ?, ?, NULL, NULL, ?, NULL, NULL)
    ON CONFLICT(idempotency_key_hash) DO NOTHING
  `);
  const byId = db.prepare('SELECT * FROM agent_run_receipts WHERE id = ? LIMIT 1');
  const byKey = db.prepare('SELECT * FROM agent_run_receipts WHERE idempotency_key_hash = ? LIMIT 1');
  const attach = db.prepare(`
    UPDATE agent_run_receipts
    SET successor_agent_id = ?, successor_session_id = COALESCE(?, successor_session_id),
        transcript_id = ?, status = 'starting', started_at = COALESCE(started_at, ?),
        updated_at = ?, error = NULL
    WHERE id = ? AND status = 'accepted'
  `);
  // Status lattice: 'unknown' can only advance to 'live', and only with fresh
  // direct evidence (checked below). Every other status is terminal-sticky or
  // moves forward only; there is no direct unknown -> terminal edge.
  const setStatus = db.prepare(`
    UPDATE agent_run_receipts
    SET status = ?, successor_session_id = COALESCE(?, successor_session_id),
        updated_at = ?, completed_at = ?, error = ?,
        telemetry_json = COALESCE(?, telemetry_json)
    WHERE id = ?
      AND (
        (status = 'accepted' AND ? IN ('starting', 'live', 'unknown', 'completed', 'failed', 'cancelled', 'over_budget', 'no_runtime'))
        OR (status = 'starting' AND ? IN ('live', 'unknown', 'completed', 'failed', 'cancelled', 'over_budget', 'no_runtime'))
        OR (status = 'live' AND ? IN ('unknown', 'completed', 'failed', 'cancelled', 'over_budget', 'no_runtime'))
        OR (status = 'unknown' AND ? = 'live')
      )
  `);

  function get(id: string): AgentRunReceipt | null {
    const row = byId.get(required(id, 'receiptId')) as AgentRunReceiptRow | undefined;
    return row ? toReceipt(row) : null;
  }

  function accept(input: {
    idempotencyKey: string;
    kind: AgentRunKind;
    request: unknown;
    predecessorSessionId?: string | null;
    predecessor?: AgentRunPredecessorSnapshot | null;
    budgetUsd?: number | null;
  }): { receipt: AgentRunReceipt; replayed: boolean } {
    const keyHash = sha256(required(input.idempotencyKey, 'idempotencyKey'));
    const requestHash = sha256(canonicalJson(input.request));
    const timestamp = now();
    const id = `run-${randomBytes(8).toString('hex')}`;
    const result = insert.run(
      id,
      required(input.kind, 'kind'),
      keyHash,
      requestHash,
      input.predecessorSessionId ?? null,
      input.predecessor ? canonicalJson(input.predecessor) : null,
      timestamp,
      timestamp,
      input.budgetUsd ?? null,
    );
    const row = byKey.get(keyHash) as AgentRunReceiptRow;
    if (row.request_hash !== requestHash || row.kind !== input.kind) {
      throw new AgentRunIdempotencyConflictError(row.id);
    }
    return { receipt: toReceipt(row), replayed: result.changes === 0 };
  }

  function markStarting(
    id: string,
    input: { successorAgentId: string; successorSessionId?: string | null; transcriptId: string },
  ): AgentRunReceipt {
    const receiptId = required(id, 'receiptId');
    const timestamp = now();
    const result = attach.run(
      required(input.successorAgentId, 'successorAgentId'),
      input.successorSessionId ?? null,
      required(input.transcriptId, 'transcriptId'),
      timestamp,
      timestamp,
      receiptId,
    );
    const receipt = get(receiptId);
    if (!receipt) throw new Error(`agent run receipt ${receiptId} not found`);
    if (result.changes !== 1) {
      throw new Error(`cannot transition agent run receipt ${receiptId} from ${receipt.status} to starting`);
    }
    return receipt;
  }

  function markStatus(
    id: string,
    status: AgentRunReceiptStatus,
    input: {
      successorSessionId?: string | null;
      error?: string | null;
      telemetry?: SpawnTelemetry | null;
      liveEvidence?: AgentRunLiveEvidence;
    } = {},
  ): AgentRunReceipt {
    const receiptId = required(id, 'receiptId');
    const terminal = TERMINAL_AGENT_RUN_STATUSES.has(status);
    const timestamp = now();

    if (status === 'live') {
      const evidence = input.liveEvidence;
      const evidenceAge = evidence ? timestamp - evidence.supervisorHeartbeatAt : Number.POSITIVE_INFINITY;
      if (
        !evidence
        || !Number.isInteger(evidence.pid)
        || evidence.pid <= 0
        || !Number.isFinite(evidence.supervisorHeartbeatAt)
        || evidenceAge < 0
        || evidenceAge >= AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS
      ) {
        throw new Error('live status requires a direct PID and fresh supervisor heartbeat evidence');
      }
    }

    const result = setStatus.run(
      status,
      input.successorSessionId ?? null,
      timestamp,
      terminal ? timestamp : null,
      input.error ?? null,
      input.telemetry ? canonicalJson(input.telemetry) : null,
      receiptId,
      status,
      status,
      status,
      status,
    );
    const receipt = get(receiptId);
    if (!receipt) throw new Error(`agent run receipt ${receiptId} not found`);
    if (result.changes !== 1) {
      throw new Error(`cannot transition agent run receipt ${receiptId} from ${receipt.status} to ${status}`);
    }
    return receipt;
  }

  function list(filter: AgentRunReceiptListFilter = {}): AgentRunReceipt[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (statuses.length > 0) {
        clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
    }
    if (filter.kind) {
      clauses.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.predecessorSessionId) {
      clauses.push('predecessor_session_id = ?');
      params.push(filter.predecessorSessionId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM agent_run_receipts ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params, clampListLimit(filter.limit)) as AgentRunReceiptRow[];
    return rows.map(toReceipt);
  }

  return { accept, get, markStarting, markStatus, list };
}

export type AgentRunReceiptStore = ReturnType<typeof createAgentRunReceiptStore>;
