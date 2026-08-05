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

/**
 * Thrown when accept() cannot retrieve the receipt row after the INSERT or
 * ON CONFLICT completed. This should never occur in normal operation (the
 * row must exist if the insert succeeded or conflicted), but defensive
 * programming requires a typed failure path rather than a generic TypeError.
 */
export class AgentRunReceiptNotFoundError extends Error {
  constructor(readonly keyHash: string) {
    super('agent run receipt not found after insert/conflict');
    this.name = 'AgentRunReceiptNotFoundError';
  }
}

/**
 * Real corroboration for the PID inside `AgentRunLiveEvidence`. The caller
 * supplies the evidence numbers, but numbers alone are not proof -- any
 * caller can construct `{ pid: 4242, supervisorHeartbeatAt: Date.now() }`
 * for a PID that doesn't exist. The default here checks the actual OS
 * process table (signal 0: no signal is delivered, it only tests whether a
 * signalable process exists at that pid) so a fabricated PID is rejected
 * regardless of how fresh its attached timestamp looks. Inject a smarter
 * verifier (e.g. one backed by a supervisor's own live registry) when the
 * caller has a better source of truth than the raw OS process table.
 */
export type AgentRunProcessVerifier = (pid: number) => boolean;

/**
 * Checks whether a process with the given PID exists on the OS by attempting
 * to send signal 0 (no-op signal). Purpose: prevent callers from fabricating
 * live-evidence PIDs that merely look valid but reference nonexistent processes.
 *
 * @param pid - Process ID to verify.
 * @returns true if the process exists (or exists but is owned by another user), false otherwise.
 */
export function defaultVerifyProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM still proves the process exists (it's just owned by someone
    // else); ESRCH (or anything else) means no such process.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Returns the SHA-256 hash of the input string as a lowercase hex digest.
 * Purpose: deterministic idempotency key hashing and request fingerprinting.
 *
 * @param value - String to hash.
 * @returns 64-character lowercase hex digest.
 */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * budgetUsd is money; a caller-supplied NaN/Infinity/negative value must
 * never reach the database. Purpose: JSON and SQLite silently turn NaN into
 * null and accept negative numbers, so without this check a bad value degrades
 * into "no budget" or an inverted cap instead of failing loudly.
 *
 * @param value - Budget in USD, or null/undefined for no budget.
 * @returns Validated number or null.
 * @throws Error if value is NaN, Infinity, or negative.
 */
function validateBudgetUsd(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('budgetUsd must be a finite, non-negative number');
  }
  return value;
}

const TELEMETRY_NUMERIC_FIELDS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'costUsd'] as const;

/**
 * Same failure mode as budgetUsd, one level deeper: `canonicalJson` would
 * happily serialize `{ costUsd: NaN }` as `{"costUsd":null}`, silently
 * inventing a "no cost" record instead of rejecting corrupt values. Purpose:
 * ensure telemetry numeric fields are valid before database storage.
 *
 * @param telemetry - Telemetry object to validate, or null/undefined.
 * @returns Validated telemetry or null.
 * @throws Error if any numeric field is NaN, Infinity, or negative.
 */
function validateTelemetry(telemetry: SpawnTelemetry | null | undefined): SpawnTelemetry | null {
  if (telemetry === null || telemetry === undefined) return null;
  for (const field of TELEMETRY_NUMERIC_FIELDS) {
    const value = telemetry[field];
    if (value === undefined && field === 'cachedInputTokens') continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`telemetry.${field} must be a finite, non-negative number`);
    }
  }
  return telemetry;
}

/**
 * Validates and normalizes a required string field, rejecting empty/whitespace-only
 * values, oversized inputs, and unsafe characters (null bytes, newlines). Purpose:
 * prevent injection attacks and database corruption from malformed identifiers.
 *
 * @param value - String to validate.
 * @param field - Field name (for error messages).
 * @param maxBytes - Maximum allowed UTF-8 byte length (default 512).
 * @returns Normalized string.
 * @throws Error if empty after trimming, exceeds maxBytes, or contains null/CR/LF.
 */
function required(value: string, field: string, maxBytes = 512): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes || /[\0\r\n]/.test(normalized)) {
    throw new Error(`${field} exceeds its safe identifier boundary`);
  }
  return normalized;
}

/**
 * Deterministic JSON serialization with sorted object keys. Purpose: two
 * structurally equivalent values always produce identical strings regardless
 * of field order, enabling stable hashes for request deduplication.
 *
 * @param value - Value to serialize.
 * @returns Canonical JSON string with sorted object keys.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * A corrupt or malformed optional JSON payload must never be promoted into
 * evidence about the receipt. Purpose: fail closed by returning null instead
 * of inventing a shape, preventing corrupt data from being treated as valid.
 *
 * @param value - JSON string to parse, or null.
 * @returns Parsed object if valid, null if malformed/null/non-object.
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

/**
 * Converts a raw SQLite row into the public AgentRunReceipt shape. Purpose:
 * parse optional JSON payloads safely and map snake_case columns to camelCase.
 *
 * @param row - Raw database row.
 * @returns Public receipt object.
 */
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

/**
 * Clamps a caller-supplied limit to the safe range [1, AGENT_RUN_LIST_MAX_LIMIT].
 * Purpose: prevent unbounded queries and ensure at least one result is requested.
 *
 * @param requested - Requested limit, or undefined.
 * @returns Clamped limit in [1, AGENT_RUN_LIST_MAX_LIMIT], defaulting to AGENT_RUN_LIST_DEFAULT_LIMIT.
 */
function clampListLimit(requested: number | undefined): number {
  const parsed = Number.isFinite(requested) ? Math.trunc(requested as number) : AGENT_RUN_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), AGENT_RUN_LIST_MAX_LIMIT);
}

/** Every column beyond the bare skeleton, in ADD-COLUMN order. */
const AGENT_RUN_RECEIPT_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['idempotency_key_hash', 'TEXT'],
  ['request_hash', 'TEXT'],
  ['predecessor_session_id', 'TEXT'],
  ['predecessor_snapshot_json', 'TEXT'],
  ['successor_session_id', 'TEXT'],
  ['successor_agent_id', 'TEXT'],
  ['transcript_id', 'TEXT'],
  ['started_at', 'INTEGER'],
  ['completed_at', 'INTEGER'],
  ['budget_usd', 'REAL'],
  ['telemetry_json', 'TEXT'],
  ['error', 'TEXT'],
];

/**
 * Escapes a column name for safe use in dynamically constructed DDL. Purpose:
 * prevent SQL injection via SQLite's double-quote identifier escaping.
 *
 * @param value - Column name to escape.
 * @returns Safely quoted identifier.
 */
function quoteSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Additive-only migration for the `agent_run_receipts` table. Purpose: allow
 * older database files (fewer columns) to work without "no such column" errors,
 * and allow newer writes to continue working against legacy tables by identifying
 * pre-existing NOT NULL columns that aren't part of this store's schema.
 *
 * A database file written by an earlier, narrower revision of this store
 * (fewer columns -- e.g. no predecessor/successor/transcript/budget/
 * telemetry fields) must never make construction reach a "no such column"
 * failure the first time a query touches a field that revision didn't have.
 * A brand-new database gets the strict schema directly. An older table gets
 * nullable columns through SQLite's additive-only `ALTER TABLE` path, then
 * deterministic hashes are backfilled before the unique index and null-
 * rejection triggers are installed. Existing rows and unrelated indexes are
 * retained without weakening idempotency for future writes.
 *
 * Uniqueness on `idempotency_key_hash` is enforced by a separate UNIQUE
 * INDEX rather than an inline column constraint precisely so this also
 * works when the column is being added to a table that already has rows:
 * SQLite cannot add a UNIQUE column via ALTER TABLE, but a UNIQUE INDEX
 * created afterward enforces the identical guarantee (and produces the same
 * "UNIQUE constraint failed" error on violation).
 *
 * @param db - Portable database instance (better-sqlite3 or bun:sqlite).
 * @returns Names of legacy NOT NULL columns unknown to this store's schema.
 */
function migrateAgentRunReceiptsSchema(db: PortableDatabase): string[] {
  const tableExists = Boolean(db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'agent_run_receipts'
    LIMIT 1
  `).get());

  if (!tableExists) {
    db.exec(`
      CREATE TABLE agent_run_receipts (
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
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_run_receipts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const tableInfo = db.prepare('PRAGMA table_info(agent_run_receipts)').all() as Array<{
    name: string;
    notnull: number;
    dflt_value: unknown;
  }>;
  const existingColumns = new Set(tableInfo.map((column) => column.name));
  for (const [column, type] of AGENT_RUN_RECEIPT_COLUMNS) {
    if (!existingColumns.has(column)) {
      db.exec(`ALTER TABLE agent_run_receipts ADD COLUMN ${quoteSqlIdentifier(column)} ${type}`);
    }
  }

  if (tableExists) {
    const legacyRows = db.prepare(`
      SELECT id, idempotency_key_hash, request_hash
      FROM agent_run_receipts
      WHERE idempotency_key_hash IS NULL OR request_hash IS NULL
    `).all() as Array<{ id: string; idempotency_key_hash: string | null; request_hash: string | null }>;
    const backfill = db.prepare(`
      UPDATE agent_run_receipts
      SET idempotency_key_hash = COALESCE(idempotency_key_hash, ?),
          request_hash = COALESCE(request_hash, ?)
      WHERE id = ?
    `);
    for (const row of legacyRows) {
      const legacyId = required(row.id, 'legacyReceiptId');
      backfill.run(
        sha256(`legacy-idempotency:${legacyId}`),
        sha256(canonicalJson({ legacyReceiptId: legacyId })),
        legacyId,
      );
    }
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_run_receipts_idempotency_key_hash
      ON agent_run_receipts(idempotency_key_hash);
    CREATE INDEX IF NOT EXISTS idx_agent_run_receipts_status
      ON agent_run_receipts(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_run_receipts_predecessor
      ON agent_run_receipts(predecessor_session_id, created_at DESC);
    CREATE TRIGGER IF NOT EXISTS trg_agent_run_receipts_hashes_not_null_insert
      BEFORE INSERT ON agent_run_receipts
      WHEN NEW.idempotency_key_hash IS NULL OR NEW.request_hash IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'agent_run_receipts hashes are required');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_agent_run_receipts_hashes_not_null_update
      BEFORE UPDATE OF idempotency_key_hash, request_hash ON agent_run_receipts
      WHEN NEW.idempotency_key_hash IS NULL OR NEW.request_hash IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'agent_run_receipts hashes are required');
      END;
  `);

  const knownColumns = new Set(['id', 'kind', 'status', 'created_at', 'updated_at', ...AGENT_RUN_RECEIPT_COLUMNS.map(([name]) => name)]);
  return tableInfo
    .filter((column) => column.notnull === 1 && column.dflt_value === null && !knownColumns.has(column.name))
    .map((column) => column.name);
}

/**
 * Durable, restart-safe ledger for agent run receipts. Purpose: database-level
 * idempotency enforcement (UNIQUE constraint + atomic INSERT...ON CONFLICT)
 * prevents duplicate runs even under concurrency, and restart reconciliation
 * ensures lost-liveness receipts are marked `unknown` until explicitly verified.
 *
 * Idempotency is enforced by the database itself: `idempotency_key_hash` is
 * UNIQUE and acceptance is one atomic `INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING` statement, so two concurrent callers racing on the same key can
 * never create two rows or observe a gap between insertion and retrieval.
 *
 * A run that loses liveness (daemon restart while `accepted`/`starting`/
 * `live`) is marked `unknown` and can only ever be reconciled back to `live`
 * with fresh, direct evidence (a real PID plus a recent supervisor
 * heartbeat). `unknown` never transitions straight to a terminal status —
 * lost liveness is never silently treated as success.
 *
 * @param db - Portable database instance (better-sqlite3 or bun:sqlite).
 * @param options - Optional configuration (now function, recoverNonTerminal flag, process verifier).
 * @returns Store object with methods {accept, get, markStarting, markStatus, list}.
 */
export function createAgentRunReceiptStore(
  db: PortableDatabase,
  options: {
    now?: () => number;
    recoverNonTerminal?: boolean;
    verifyProcessAlive?: AgentRunProcessVerifier;
  } = {},
) {
  const now = options.now ?? Date.now;
  const verifyProcessAlive = options.verifyProcessAlive ?? defaultVerifyProcessAlive;

  const legacyRequiredColumns = migrateAgentRunReceiptsSchema(db);

  if (options.recoverNonTerminal !== false) {
    const recoveredAt = now();
    db.prepare(`
      UPDATE agent_run_receipts
      SET status = 'unknown', updated_at = ?,
          error = COALESCE(error, 'Daemon restarted before a terminal event; task outcome is unknown.')
      WHERE status IN ('accepted', 'starting', 'live')
    `).run(recoveredAt);
  }

  // A pre-existing database file controls its own column names, so identifiers
  // still need SQLite quoting even though they came from PRAGMA table_info.
  const legacyColumnList = legacyRequiredColumns.map((column) => `, ${quoteSqlIdentifier(column)}`).join('');
  const legacyValueList = legacyRequiredColumns.map(() => ', 0').join('');
  const insert = db.prepare(`
    INSERT INTO agent_run_receipts (
      id, kind, idempotency_key_hash, request_hash, predecessor_session_id,
      predecessor_snapshot_json, successor_session_id, successor_agent_id,
      transcript_id, status, created_at, updated_at, started_at, completed_at,
      budget_usd, telemetry_json, error${legacyColumnList}
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'accepted', ?, ?, NULL, NULL, ?, NULL, NULL${legacyValueList})
    ON CONFLICT(idempotency_key_hash) DO UPDATE
      SET idempotency_key_hash = excluded.idempotency_key_hash
    RETURNING *
  `);
  const byId = db.prepare('SELECT * FROM agent_run_receipts WHERE id = ? LIMIT 1');
  const attach = db.prepare(`
    UPDATE agent_run_receipts
    SET successor_agent_id = ?, successor_session_id = COALESCE(?, successor_session_id),
        transcript_id = ?, status = 'starting', started_at = COALESCE(started_at, ?),
        updated_at = ?, error = NULL
    WHERE id = ? AND status = 'accepted'
  `);
  // Status lattice: acceptance may only open a runtime, fail admission, or
  // lose observability. A successful/failed/cancelled execution must first
  // reach `starting`; `unknown` can only return to `live` with fresh direct
  // evidence. Terminal states are sticky.
  const setStatus = db.prepare(`
    UPDATE agent_run_receipts
    SET status = ?, successor_session_id = COALESCE(?, successor_session_id),
        updated_at = ?, completed_at = ?, error = ?,
        telemetry_json = COALESCE(?, telemetry_json)
    WHERE id = ?
      AND (
        (status = 'accepted' AND ? IN ('starting', 'unknown', 'no_runtime'))
        OR (status = 'starting' AND ? IN ('live', 'unknown', 'completed', 'failed', 'cancelled', 'over_budget', 'no_runtime'))
        OR (status = 'live' AND ? IN ('unknown', 'completed', 'failed', 'cancelled', 'over_budget', 'no_runtime'))
        OR (status = 'unknown' AND ? = 'live')
      )
  `);

  /**
   * Retrieves a single agent run receipt by its ID. Purpose: public API for
   * fetching receipts after accepting or marking status changes.
   *
   * @param id - Receipt ID.
   * @returns Receipt object if found, null otherwise.
   */
  function get(id: string): AgentRunReceipt | null {
    const row = byId.get(required(id, 'receiptId')) as AgentRunReceiptRow | undefined;
    return row ? toReceipt(row) : null;
  }

  /**
   * Atomically accepts a new agent run request or replays an existing one.
   * Purpose: database-level idempotency (UNIQUE constraint + one atomic
   * INSERT...ON CONFLICT...RETURNING statement) ensures two concurrent callers
   * with the same key never produce duplicate runs or an insert/read gap.
   *
   * @param input - Request with idempotencyKey, kind, request payload, optional predecessor and budget.
   * @returns Object with {receipt, replayed} where replayed is true if key already existed.
   * @throws AgentRunIdempotencyConflictError if the key exists but the request differs.
   * @throws AgentRunReceiptNotFoundError if the receipt cannot be retrieved after insert.
   */
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
    const budgetUsd = validateBudgetUsd(input.budgetUsd);
    const row = insert.get(
      id,
      required(input.kind, 'kind'),
      keyHash,
      requestHash,
      input.predecessorSessionId ?? null,
      input.predecessor ? canonicalJson(input.predecessor) : null,
      timestamp,
      timestamp,
      budgetUsd,
    ) as AgentRunReceiptRow | undefined;
    if (!row) {
      throw new AgentRunReceiptNotFoundError(keyHash);
    }
    if (row.request_hash !== requestHash || row.kind !== input.kind) {
      throw new AgentRunIdempotencyConflictError(row.id);
    }
    return { receipt: toReceipt(row), replayed: row.id !== id };
  }

  /**
   * Transitions an 'accepted' receipt to 'starting' and attaches successor
   * identifiers. Purpose: record when the agent actually begins execution.
   *
   * @param id - Receipt ID.
   * @param input - Object with successorAgentId, optional successorSessionId, and transcriptId.
   * @returns Updated receipt.
   * @throws Error if the receipt is not found after update.
   */
  function markStarting(
    id: string,
    input: { successorAgentId: string; successorSessionId?: string | null; transcriptId: string },
  ): AgentRunReceipt {
    const receiptId = required(id, 'receiptId');
    const timestamp = now();
    attach.run(
      required(input.successorAgentId, 'successorAgentId'),
      input.successorSessionId ?? null,
      required(input.transcriptId, 'transcriptId'),
      timestamp,
      timestamp,
      receiptId,
    );
    const receipt = get(receiptId);
    if (!receipt) throw new Error(`agent run receipt ${receiptId} not found`);
    return receipt;
  }

  /**
   * Updates the receipt status according to the status lattice. Purpose: enforce
   * forward-only transitions (except `unknown` -> `live` with fresh evidence) and
   * terminal-status stickiness, preventing lost liveness from being silently
   * treated as success.
   *
   * @param id - Receipt ID.
   * @param status - New status to set.
   * @param input - Optional successorSessionId, error, telemetry, and liveEvidence (required for 'live').
   * @returns Updated receipt.
   * @throws Error if liveEvidence is invalid or uncorroborated when status is 'live'.
   * @throws Error if the receipt is not found after update.
   */
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
      const shapeValid = !!evidence
        && Number.isInteger(evidence.pid)
        && evidence.pid > 0
        && Number.isFinite(evidence.supervisorHeartbeatAt)
        && evidenceAge >= 0
        && evidenceAge < AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS;
      // Shape-valid numbers are not evidence by themselves -- any caller can
      // fabricate a {pid, supervisorHeartbeatAt} pair that merely looks
      // fresh. Only an independent process check corroborates it.
      if (!shapeValid || !verifyProcessAlive(evidence!.pid)) {
        throw new Error('live status requires a direct PID and fresh supervisor heartbeat evidence corroborated by a real process check');
      }
    }

    const telemetry = validateTelemetry(input.telemetry);
    setStatus.run(
      status,
      input.successorSessionId ?? null,
      timestamp,
      terminal ? timestamp : null,
      input.error ?? null,
      telemetry ? canonicalJson(telemetry) : null,
      receiptId,
      status,
      status,
      status,
      status,
    );
    const receipt = get(receiptId);
    if (!receipt) throw new Error(`agent run receipt ${receiptId} not found`);
    return receipt;
  }

  /**
   * Returns receipts matching the optional filters, ordered by updated_at DESC.
   * Purpose: paginated query API with safe limits to prevent unbounded reads.
   *
   * @param filter - Optional status/kind/predecessorSessionId filters and limit.
   * @returns Array of matching receipts (limit clamped to [1, AGENT_RUN_LIST_MAX_LIMIT]).
   */
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
