import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SpawnResult } from './spawner.js';

export const AGENT_RUN_RECEIPT_SCHEMA = 'pd.agent-run-receipt.v1' as const;

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
  successorSessionId: string | null;
  successorAgentId: string | null;
  transcriptId: string | null;
  status: AgentRunReceiptStatus;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
}

interface AgentRunReceiptRow {
  id: string;
  kind: AgentRunKind;
  idempotency_key_hash: string;
  request_hash: string;
  predecessor_session_id: string | null;
  successor_session_id: string | null;
  successor_agent_id: string | null;
  transcript_id: string | null;
  status: AgentRunReceiptStatus;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
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

function toReceipt(row: AgentRunReceiptRow): AgentRunReceipt {
  return {
    schema: AGENT_RUN_RECEIPT_SCHEMA,
    id: row.id,
    kind: row.kind,
    requestHash: row.request_hash,
    predecessorSessionId: row.predecessor_session_id,
    successorSessionId: row.successor_session_id,
    successorAgentId: row.successor_agent_id,
    transcriptId: row.transcript_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
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
      successor_session_id TEXT,
      successor_agent_id TEXT,
      transcript_id TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
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
      successor_session_id, successor_agent_id, transcript_id, status,
      created_at, updated_at, started_at, completed_at, error
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 'accepted', ?, ?, NULL, NULL, NULL)
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
        updated_at = ?, completed_at = ?, error = ?
    WHERE id = ?
      AND (
        status IN ('accepted', 'starting', 'live')
        OR (
          status = 'unknown'
          AND ? IN ('completed', 'failed', 'cancelled', 'over_budget', 'no_runtime')
        )
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
      timestamp,
      timestamp,
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
    input: { successorSessionId?: string | null; error?: string | null } = {},
  ): AgentRunReceipt {
    const terminal = ['completed', 'failed', 'cancelled', 'over_budget', 'no_runtime'].includes(status);
    const timestamp = now();
    setStatus.run(
      status,
      input.successorSessionId ?? null,
      timestamp,
      terminal ? timestamp : null,
      input.error ?? null,
      required(id, 'receiptId'),
      status,
    );
    const receipt = get(id);
    if (!receipt) throw new Error(`agent run receipt ${id} not found`);
    return receipt;
  }

  return { accept, get, markStarting, markStatus };
}

export type AgentRunReceiptStore = ReturnType<typeof createAgentRunReceiptStore>;
