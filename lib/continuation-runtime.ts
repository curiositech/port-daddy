import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export const CONTINUATION_RECEIPT_SCHEMA = 'pd.agent-harbor.continuation-receipt.v0' as const;

export type ContinuationMode = 'native' | 'handoff';
export type ContinuationStatus =
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'unsupported'
  | 'orphaned';

export interface ContinuationAcceptInput {
  idempotencyKey: string;
  sourceEpisodeId: number;
  sourceCapsuleId: string;
  durableAgentId?: string | null;
  mode: ContinuationMode;
  sourceAdapter: string;
  sourceSessionId: string;
  sourceAgentId?: string | null;
  predecessorRunId?: string | null;
  targetAdapter: string;
  requestedBackend: string;
  effectiveBackend?: string | null;
  requestedModel?: string | null;
  effectiveModel?: string | null;
  workspaceIdentityHash?: string | null;
  promptHash: string;
}

export interface ContinuationReceipt {
  schema: typeof CONTINUATION_RECEIPT_SCHEMA;
  id: string;
  sourceEpisodeId: number;
  sourceCapsuleId: string;
  durableAgentId: string | null;
  mode: ContinuationMode;
  sourceAdapter: string;
  sourceSessionId: string;
  sourceAgentId: string | null;
  predecessorRunId: string | null;
  targetAdapter: string;
  requestedBackend: string;
  effectiveBackend: string | null;
  requestedModel: string | null;
  effectiveModel: string | null;
  successorRunId: string | null;
  successorSessionId: string | null;
  status: ContinuationStatus;
  promptHash: string;
  requestHash: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  leaseExpiresAt: number;
  error: string | null;
}

interface ContinuationRow {
  schema_version: number;
  id: string;
  idempotency_key_hash: string;
  request_hash: string;
  source_episode_id: number;
  source_capsule_id: string;
  durable_agent_id: string | null;
  mode: ContinuationMode;
  source_adapter: string;
  source_session_id: string;
  source_agent_id: string | null;
  predecessor_run_id: string | null;
  target_adapter: string;
  requested_backend: string;
  effective_backend: string | null;
  requested_model: string | null;
  effective_model: string | null;
  successor_run_id: string | null;
  successor_session_id: string | null;
  status: ContinuationStatus;
  prompt_hash: string;
  owner_id: string | null;
  lease_expires_at: number | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
}

export interface ContinuationStoreOptions {
  ownerId?: string;
  now?: () => number;
  recoverExpired?: boolean;
  acceptedLeaseMs?: number;
}

export class ContinuationIdempotencyConflictError extends Error {
  readonly continuationId: string;

  constructor(continuationId: string) {
    super('idempotency key was already used for a different continuation request');
    this.name = 'ContinuationIdempotencyConflictError';
    this.continuationId = continuationId;
  }
}

const PROCESS_CONTINUATION_OWNER_ID = `daemon-${process.pid}-${randomUUID()}`;
const DEFAULT_ACCEPTED_LEASE_MS = 60_000;
const DEFAULT_RUNNING_LEASE_MS = 6 * 60 * 1_000;
const MAX_RUNNING_LEASE_MS = 6 * 60 * 60 * 1_000 + 5 * 60 * 1_000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function required(value: string, field: string, maxBytes = 1_024): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes || /[\0\r\n]/.test(normalized)) {
    throw new Error(`${field} exceeds its safe identifier boundary`);
  }
  return normalized;
}

function optional(value: string | null | undefined, field: string): string | null {
  return value == null || String(value).trim() === '' ? null : required(String(value), field);
}

function leaseDuration(value: number | undefined, fallback: number, max: number): number {
  const duration = value ?? fallback;
  if (!Number.isInteger(duration) || duration < 1_000 || duration > max) {
    throw new Error(`continuation lease must be an integer from 1000 to ${max}`);
  }
  return duration;
}

function toReceipt(row: ContinuationRow): ContinuationReceipt {
  return {
    schema: CONTINUATION_RECEIPT_SCHEMA,
    id: row.id,
    sourceEpisodeId: row.source_episode_id,
    sourceCapsuleId: row.source_capsule_id,
    durableAgentId: row.durable_agent_id,
    mode: row.mode,
    sourceAdapter: row.source_adapter,
    sourceSessionId: row.source_session_id,
    sourceAgentId: row.source_agent_id,
    predecessorRunId: row.predecessor_run_id,
    targetAdapter: row.target_adapter,
    requestedBackend: row.requested_backend,
    effectiveBackend: row.effective_backend,
    requestedModel: row.requested_model,
    effectiveModel: row.effective_model,
    successorRunId: row.successor_run_id,
    successorSessionId: row.successor_session_id,
    status: row.status,
    promptHash: row.prompt_hash,
    requestHash: row.request_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    leaseExpiresAt: row.lease_expires_at ?? row.updated_at,
    error: row.error,
  };
}

export function hashContinuationPrompt(prompt: string): string {
  return sha256(prompt);
}

function requestHash(input: Omit<ContinuationAcceptInput, 'idempotencyKey'>): string {
  return sha256(JSON.stringify({
    sourceEpisodeId: input.sourceEpisodeId,
    sourceCapsuleId: input.sourceCapsuleId,
    durableAgentId: input.durableAgentId ?? null,
    mode: input.mode,
    sourceAdapter: input.sourceAdapter,
    sourceSessionId: input.sourceSessionId,
    sourceAgentId: input.sourceAgentId ?? null,
    predecessorRunId: input.predecessorRunId ?? null,
    targetAdapter: input.targetAdapter,
    requestedBackend: input.requestedBackend,
    effectiveBackend: input.effectiveBackend ?? null,
    requestedModel: input.requestedModel ?? null,
    effectiveModel: input.effectiveModel ?? null,
    workspaceIdentityHash: input.workspaceIdentityHash ?? null,
    promptHash: input.promptHash,
  }));
}

function ensureColumn(db: Database.Database, columns: Set<string>, name: string, definition: string): void {
  if (columns.has(name)) return;
  db.exec(`ALTER TABLE agent_continuations ADD COLUMN ${name} ${definition}`);
  columns.add(name);
}

export function createContinuationStore(
  db: Database.Database,
  options: ContinuationStoreOptions = {},
) {
  const ownerId = required(options.ownerId ?? PROCESS_CONTINUATION_OWNER_ID, 'ownerId');
  const now = options.now ?? Date.now;
  const acceptedLeaseMs = leaseDuration(
    options.acceptedLeaseMs,
    DEFAULT_ACCEPTED_LEASE_MS,
    MAX_RUNNING_LEASE_MS,
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_continuations (
      schema_version INTEGER NOT NULL DEFAULT 2,
      id TEXT PRIMARY KEY,
      idempotency_key_hash TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      source_episode_id INTEGER NOT NULL,
      source_capsule_id TEXT NOT NULL,
      durable_agent_id TEXT,
      mode TEXT NOT NULL,
      source_adapter TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      source_agent_id TEXT,
      predecessor_run_id TEXT,
      target_adapter TEXT NOT NULL,
      requested_backend TEXT NOT NULL,
      effective_backend TEXT,
      requested_model TEXT,
      effective_model TEXT,
      successor_run_id TEXT,
      successor_session_id TEXT,
      status TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      lease_expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT
    );
  `);

  const columns = new Set(
    (db.prepare('PRAGMA table_info(agent_continuations)').all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  ensureColumn(db, columns, 'owner_id', 'TEXT');
  ensureColumn(db, columns, 'lease_expires_at', 'INTEGER');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_continuations_episode
      ON agent_continuations(source_episode_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_continuations_agent
      ON agent_continuations(durable_agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_continuations_status
      ON agent_continuations(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_continuations_lease
      ON agent_continuations(status, lease_expires_at);
  `);

  const expectedColumns = new Set([
    'schema_version', 'id', 'idempotency_key_hash', 'request_hash',
    'source_episode_id', 'source_capsule_id', 'durable_agent_id', 'mode',
    'source_adapter', 'source_session_id', 'source_agent_id', 'predecessor_run_id',
    'target_adapter', 'requested_backend', 'effective_backend', 'requested_model',
    'effective_model', 'successor_run_id', 'successor_session_id', 'status',
    'prompt_hash', 'owner_id', 'lease_expires_at', 'created_at', 'updated_at',
    'started_at', 'completed_at', 'error',
  ]);
  for (const column of expectedColumns) {
    if (!columns.has(column)) {
      throw new Error(`agent_continuations migration verification failed: missing ${column}`);
    }
  }

  let orphanedAtStartup = 0;
  if (options.recoverExpired) {
    const recover = db.transaction(() => {
      const orphanedAt = now();
      return db.prepare(`
        UPDATE agent_continuations
        SET status = 'orphaned', updated_at = ?, completed_at = ?,
            error = COALESCE(error, 'continuation lease expired before daemon recovery')
        WHERE status IN ('accepted', 'running')
          AND (owner_id IS NULL OR owner_id <> ?)
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
      `).run(orphanedAt, orphanedAt, ownerId, orphanedAt) as { changes: number };
    });
    orphanedAtStartup = recover.immediate().changes;
  }

  const stmts = {
    insert: db.prepare(`
      INSERT INTO agent_continuations (
        schema_version, id, idempotency_key_hash, request_hash,
        source_episode_id, source_capsule_id, durable_agent_id, mode,
        source_adapter, source_session_id, source_agent_id, predecessor_run_id,
        target_adapter, requested_backend, effective_backend,
        requested_model, effective_model, successor_run_id, successor_session_id,
        status, prompt_hash, owner_id, lease_expires_at,
        created_at, updated_at, started_at, completed_at, error
      ) VALUES (
        2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL,
        'accepted', ?, ?, ?, ?, ?, NULL, NULL, NULL
      )
      ON CONFLICT(idempotency_key_hash) DO NOTHING
    `),
    get: db.prepare('SELECT * FROM agent_continuations WHERE id = ? LIMIT 1'),
    getByKey: db.prepare('SELECT * FROM agent_continuations WHERE idempotency_key_hash = ? LIMIT 1'),
    running: db.prepare(`
      UPDATE agent_continuations
      SET status = 'running', started_at = COALESCE(started_at, ?),
          updated_at = ?, lease_expires_at = ?
      WHERE id = ? AND owner_id = ? AND status = 'accepted' AND lease_expires_at > ?
    `),
    terminal: db.prepare(`
      UPDATE agent_continuations
      SET status = ?, effective_backend = COALESCE(?, effective_backend),
          effective_model = COALESCE(?, effective_model),
          successor_run_id = COALESCE(?, successor_run_id),
          successor_session_id = COALESCE(?, successor_session_id),
          error = ?, updated_at = ?, completed_at = ?, lease_expires_at = ?
      WHERE id = ? AND owner_id = ? AND status IN ('accepted', 'running')
    `),
    list: db.prepare(`
      SELECT * FROM agent_continuations
      WHERE (? IS NULL OR source_episode_id = ?)
        AND (? IS NULL OR durable_agent_id = ?)
        AND (? IS NULL OR status = ?)
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `),
  };

  function get(id: string): ContinuationReceipt | null {
    const row = stmts.get.get(id) as ContinuationRow | undefined;
    return row ? toReceipt(row) : null;
  }

  function accept(input: ContinuationAcceptInput): { receipt: ContinuationReceipt; replayed: boolean } {
    if (!Number.isInteger(input.sourceEpisodeId) || input.sourceEpisodeId < 1) {
      throw new Error('sourceEpisodeId must be a positive integer');
    }
    if (input.mode !== 'native' && input.mode !== 'handoff') throw new Error('invalid continuation mode');
    const idempotencyKeyHash = sha256(required(input.idempotencyKey, 'idempotencyKey', 512));
    const normalized: Omit<ContinuationAcceptInput, 'idempotencyKey'> = {
      sourceEpisodeId: input.sourceEpisodeId,
      sourceCapsuleId: required(input.sourceCapsuleId, 'sourceCapsuleId'),
      durableAgentId: optional(input.durableAgentId, 'durableAgentId'),
      mode: input.mode,
      sourceAdapter: required(input.sourceAdapter, 'sourceAdapter'),
      sourceSessionId: required(input.sourceSessionId, 'sourceSessionId'),
      sourceAgentId: optional(input.sourceAgentId, 'sourceAgentId'),
      predecessorRunId: optional(input.predecessorRunId, 'predecessorRunId'),
      targetAdapter: required(input.targetAdapter, 'targetAdapter'),
      requestedBackend: required(input.requestedBackend, 'requestedBackend'),
      effectiveBackend: optional(input.effectiveBackend, 'effectiveBackend'),
      requestedModel: optional(input.requestedModel, 'requestedModel'),
      effectiveModel: optional(input.effectiveModel, 'effectiveModel'),
      workspaceIdentityHash: optional(input.workspaceIdentityHash, 'workspaceIdentityHash'),
      promptHash: required(input.promptHash, 'promptHash', 128),
    };
    const normalizedRequestHash = requestHash(normalized);
    const id = `continuation-${randomUUID()}`;
    const acceptedAt = now();
    const inserted = stmts.insert.run(
      id,
      idempotencyKeyHash,
      normalizedRequestHash,
      normalized.sourceEpisodeId,
      normalized.sourceCapsuleId,
      normalized.durableAgentId ?? null,
      normalized.mode,
      normalized.sourceAdapter,
      normalized.sourceSessionId,
      normalized.sourceAgentId ?? null,
      normalized.predecessorRunId ?? null,
      normalized.targetAdapter,
      normalized.requestedBackend,
      normalized.effectiveBackend ?? null,
      normalized.requestedModel ?? null,
      normalized.effectiveModel ?? null,
      normalized.promptHash,
      ownerId,
      acceptedAt + acceptedLeaseMs,
      acceptedAt,
      acceptedAt,
    ) as { changes: number };
    if (inserted.changes === 1) {
      const receipt = get(id);
      if (!receipt) throw new Error('continuation receipt was not readable after insert');
      return { receipt, replayed: false };
    }

    const existing = stmts.getByKey.get(idempotencyKeyHash) as ContinuationRow | undefined;
    if (!existing) throw new Error('idempotent continuation was not readable after conflict');
    if (existing.request_hash !== normalizedRequestHash) {
      throw new ContinuationIdempotencyConflictError(existing.id);
    }
    return { receipt: toReceipt(existing), replayed: true };
  }

  function markRunning(id: string, requestedLeaseMs?: number): ContinuationReceipt | null {
    const runningAt = now();
    const runningLeaseMs = leaseDuration(
      requestedLeaseMs,
      DEFAULT_RUNNING_LEASE_MS,
      MAX_RUNNING_LEASE_MS,
    );
    const updated = stmts.running.run(
      runningAt,
      runningAt,
      runningAt + runningLeaseMs,
      id,
      ownerId,
      runningAt,
    ) as { changes: number };
    return updated.changes === 1 ? get(id) : null;
  }

  function markTerminal(
    id: string,
    status: Extract<ContinuationStatus, 'completed' | 'failed' | 'unsupported'>,
    terminalOptions: {
      effectiveBackend?: string | null;
      effectiveModel?: string | null;
      successorRunId?: string | null;
      successorSessionId?: string | null;
      error?: string | null;
    } = {},
  ): ContinuationReceipt | null {
    const terminalAt = now();
    const error = terminalOptions.error ? terminalOptions.error.slice(0, 4_000) : null;
    const updated = stmts.terminal.run(
      status,
      terminalOptions.effectiveBackend ?? null,
      terminalOptions.effectiveModel ?? null,
      terminalOptions.successorRunId ?? null,
      terminalOptions.successorSessionId ?? null,
      error,
      terminalAt,
      terminalAt,
      terminalAt,
      id,
      ownerId,
    ) as { changes: number };
    return updated.changes === 1 ? get(id) : null;
  }

  function list(listOptions: {
    sourceEpisodeId?: number;
    durableAgentId?: string;
    status?: ContinuationStatus;
    limit?: number;
  } = {}): ContinuationReceipt[] {
    const sourceEpisodeId = Number.isInteger(listOptions.sourceEpisodeId) ? listOptions.sourceEpisodeId as number : null;
    const durableAgentId = listOptions.durableAgentId?.trim() || null;
    const status = listOptions.status ?? null;
    const limit = Math.min(Math.max(listOptions.limit ?? 100, 1), 500);
    const rows = stmts.list.all(
      sourceEpisodeId,
      sourceEpisodeId,
      durableAgentId,
      durableAgentId,
      status,
      status,
      limit,
    ) as ContinuationRow[];
    return rows.map(toReceipt);
  }

  return {
    ownerId,
    orphanedAtStartup,
    accept,
    get,
    list,
    markRunning,
    markCompleted: (id: string, terminalOptions: Parameters<typeof markTerminal>[2] = {}) =>
      markTerminal(id, 'completed', terminalOptions),
    markFailed: (id: string, terminalOptions: Parameters<typeof markTerminal>[2] = {}) =>
      markTerminal(id, 'failed', terminalOptions),
    markUnsupported: (id: string, error: string) =>
      markTerminal(id, 'unsupported', { error }),
  };
}

export type ContinuationStore = ReturnType<typeof createContinuationStore>;
