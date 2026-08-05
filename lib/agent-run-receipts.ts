import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SpawnResult, SpawnTelemetry } from './spawner.js';

export const AGENT_RUN_RECEIPT_SCHEMA = 'pd.agent-run-receipt.v1' as const;
export const AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS = 65_000;

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

export const TERMINAL_AGENT_RUN_STATUSES = new Set<AgentRunReceiptStatus>([
  'completed',
  'failed',
  'cancelled',
  'over_budget',
  'no_runtime',
]);

export function agentRunStatusForSpawnResult(result: SpawnResult): AgentRunReceiptStatus {
  if (result.agentId === 'blocked') return 'no_runtime';
  if (result.status === 'killed') return 'cancelled';
  if (result.status === 'running') return 'starting';
  return result.status;
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

export interface AgentRunPredecessorSnapshot {
  sessionId: string;
  purpose: string | null;
  status: string | null;
}

export interface AgentRunLiveEvidence {
  pid: number;
  supervisorHeartbeatAt: number;
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * Parse one nullable ledger payload without making a corrupt optional field
 * hide the receipt itself. The design intent is fail-closed evidence: callers
 * receive no snapshot or telemetry rather than an invented object.
 *
 * @param value JSON stored beside the authoritative receipt state.
 * @returns The decoded object, or null when the optional evidence is absent or invalid.
 */
function parseJsonObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : null;
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

export function createAgentRunReceiptStore(
  db: Database.Database,
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

  const columns = new Set(
    (db.prepare('PRAGMA table_info(agent_run_receipts)').all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!columns.has('predecessor_snapshot_json')) {
    db.exec('ALTER TABLE agent_run_receipts ADD COLUMN predecessor_snapshot_json TEXT');
  }
  if (!columns.has('budget_usd')) {
    db.exec('ALTER TABLE agent_run_receipts ADD COLUMN budget_usd REAL');
  }
  if (!columns.has('telemetry_json')) {
    db.exec('ALTER TABLE agent_run_receipts ADD COLUMN telemetry_json TEXT');
  }

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
        OR (status = 'unknown' AND ? IN ('live', 'completed', 'failed', 'cancelled', 'over_budget', 'no_runtime'))
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
      input.kind,
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
    const timestamp = now();
    attach.run(
      required(input.successorAgentId, 'successorAgentId'),
      input.successorSessionId ?? null,
      required(input.transcriptId, 'transcriptId'),
      timestamp,
      timestamp,
      required(id, 'receiptId'),
    );
    const receipt = get(id);
    if (!receipt) throw new Error(`agent run receipt ${id} not found`);
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
    const terminal = ['completed', 'failed', 'cancelled', 'over_budget', 'no_runtime'].includes(status);
    const timestamp = now();
    const receiptId = required(id, 'receiptId');
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
    setStatus.run(
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
    const receipt = get(id);
    if (!receipt) throw new Error(`agent run receipt ${id} not found`);
    return receipt;
  }

  return { accept, get, markStarting, markStatus };
}

export type AgentRunReceiptStore = ReturnType<typeof createAgentRunReceiptStore>;
