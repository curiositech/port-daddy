/**
 * Transcript store — append-only event log for every agent turn, tool call,
 * CLI invocation, and MCP request that flows through Port Daddy.
 *
 * Why this exists: Port Daddy's actors call LLMs via lib/llm-call.ts, the
 * spawner runs Claude/Codex/Gemini/Cloudflare/Ollama as subprocesses, the
 * `pd` CLI shells out, and MCP tools are invoked over stdio — and none of
 * those streams land anywhere durable. The user can see Codex and Claude
 * apps but Cloudflare is invisible; today's "what's the fleet doing"
 * answer is `pd activity` (truncated, agent-IDs only) plus grep over
 * scattered logs.
 *
 * The store gives every actor's turn a uniform, indexable, time-anchored
 * row. Cost ledger reads from it. Episodic memory v2 (PR-B) embeds
 * summaries from it. Comms officer searches it. Harvester walks it.
 *
 * Scope decisions for PR-A:
 *   - SQLite only. No JSONL mirror in v1; can add later if grep ergonomics
 *     matter more than insert speed.
 *   - Content > 1MB is truncated with metadata flag. Filesystem spill
 *     belongs in a follow-up if it becomes a real constraint.
 *   - No FIPA performatives in the schema yet — PR-B adds them as a
 *     `performative` column. Today `role` and `eventType` are free strings
 *     so we don't lock the shape too early.
 *   - No automatic redaction. The cost ledger and recall surfaces will
 *     respect note encryption when sourcing from session_notes; raw
 *     transcript content is operator-only.
 */

import type Database from 'better-sqlite3';

/** Roles align with chat-completion conventions plus a few PD-specific
 *  additions. `audit` covers daemon-emitted "agent X claimed Y" rows so
 *  the same store backs human-readable logs. */
export type TranscriptRole =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'thinking'
  | 'audit';

/** Event types cover the lifecycle of a turn plus out-of-band events.
 *  `turn_complete` is the canonical "one assistant response, one cost
 *  row" granularity. `token` is for streaming UIs; we don't require it.
 *  `cli_call` and `mcp_call` capture pd surfaces themselves so the user
 *  can ask "what did I do" across all interfaces. */
export type TranscriptEventType =
  | 'turn_complete'
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'awaiting_input'
  | 'input_received'
  | 'cli_call'
  | 'mcp_call';

export interface TranscriptEventInput {
  actorId: string;
  sessionId?: string;
  /** Groups events that belong to one logical turn. Spawner-driven LLM
   *  calls typically produce one turn_complete per turnId; streaming UIs
   *  emit many `token` events under one turnId. Callers generate the ID
   *  (e.g. `${sessionId}:${counter}` or a uuid). */
  turnId: string;
  role: TranscriptRole;
  eventType: TranscriptEventType;
  content: string;
  tokensIn?: number;
  tokensOut?: number;
  cachedTokensIn?: number;
  model?: string;
  backend?: string;
  costUsd?: number;
  /** Free-form metadata for PR-A. Will be partially formalized in PR-B
   *  via the ontology starter (Scope/Result/TestFailure/etc). */
  metadata?: Record<string, unknown>;
}

export interface TranscriptEvent {
  id: number;
  ts: number;
  actorId: string;
  sessionId: string | null;
  turnId: string;
  role: TranscriptRole;
  eventType: TranscriptEventType;
  content: string;
  tokensIn: number | null;
  tokensOut: number | null;
  cachedTokensIn: number | null;
  model: string | null;
  backend: string | null;
  costUsd: number | null;
  metadata: Record<string, unknown> | null;
}

export interface TranscriptQuery {
  actorId?: string;
  sessionId?: string;
  turnId?: string;
  eventType?: TranscriptEventType;
  /** Inclusive lower bound (ms since epoch). */
  since?: number;
  /** Inclusive upper bound (ms since epoch). */
  until?: number;
  /** Default 100. Use a large number with `order: 'asc'` to walk forward. */
  limit?: number;
  /** Default 'desc' — newest first. */
  order?: 'asc' | 'desc';
}

export interface TranscriptStats {
  total: number;
  uniqueActors: number;
  uniqueSessions: number;
  uniqueTurns: number;
  firstEventTs: number | null;
  lastEventTs: number | null;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

export interface TranscriptStoreOptions {
  /** Date.now injection point for tests. */
  now?: () => number;
  /** Hard cap on a single content cell. Larger contents are truncated and
   *  metadata.truncated is set with originalLength. Default 1 MB. */
  maxContentBytes?: number;
}

export interface TranscriptStore {
  record(event: TranscriptEventInput): TranscriptEvent;
  query(options?: TranscriptQuery): TranscriptEvent[];
  stats(scope?: { actorId?: string; sessionId?: string; since?: number; until?: number }): TranscriptStats;
}

const VALID_ROLES: TranscriptRole[] = ['system', 'user', 'assistant', 'tool', 'thinking', 'audit'];
const VALID_EVENT_TYPES: TranscriptEventType[] = [
  'turn_complete',
  'token',
  'tool_call',
  'tool_result',
  'error',
  'awaiting_input',
  'input_received',
  'cli_call',
  'mcp_call',
];

const DEFAULT_MAX_CONTENT_BYTES = 1_000_000;
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 10_000;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS transcript_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL,
    session_id TEXT,
    turn_id TEXT NOT NULL,
    role TEXT NOT NULL,
    event_type TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    cached_tokens_in INTEGER,
    model TEXT,
    backend TEXT,
    cost_usd REAL,
    metadata TEXT,
    ts INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_actor_ts ON transcript_events(actor_id, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_session_ts ON transcript_events(session_id, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_event_type_ts ON transcript_events(event_type, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_turn ON transcript_events(turn_id, ts)`,
];

export function createTranscriptStore(
  db: Database.Database,
  options: TranscriptStoreOptions = {},
): TranscriptStore {
  const now = options.now ?? Date.now;
  const maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;

  for (const stmt of SCHEMA_STATEMENTS) {
    db.prepare(stmt).run();
  }

  const insertStmt = db.prepare(`
    INSERT INTO transcript_events (
      actor_id, session_id, turn_id, role, event_type, content,
      tokens_in, tokens_out, cached_tokens_in, model, backend, cost_usd,
      metadata, ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getByIdStmt = db.prepare(`SELECT * FROM transcript_events WHERE id = ? LIMIT 1`);

  function rowToEvent(row: Record<string, unknown>): TranscriptEvent {
    let metadata: Record<string, unknown> | null = null;
    if (row.metadata != null) {
      try {
        metadata = JSON.parse(row.metadata as string);
      } catch {
        metadata = { _parseError: true, raw: row.metadata };
      }
    }
    return {
      id: row.id as number,
      actorId: row.actor_id as string,
      sessionId: (row.session_id as string | null) ?? null,
      turnId: row.turn_id as string,
      role: row.role as TranscriptRole,
      eventType: row.event_type as TranscriptEventType,
      content: row.content as string,
      tokensIn: (row.tokens_in as number | null) ?? null,
      tokensOut: (row.tokens_out as number | null) ?? null,
      cachedTokensIn: (row.cached_tokens_in as number | null) ?? null,
      model: (row.model as string | null) ?? null,
      backend: (row.backend as string | null) ?? null,
      costUsd: (row.cost_usd as number | null) ?? null,
      metadata,
      ts: row.ts as number,
    };
  }

  function record(event: TranscriptEventInput): TranscriptEvent {
    if (!event.actorId || typeof event.actorId !== 'string') {
      throw new Error('transcript-store: actorId must be a non-empty string');
    }
    if (!event.turnId || typeof event.turnId !== 'string') {
      throw new Error('transcript-store: turnId must be a non-empty string');
    }
    if (!VALID_ROLES.includes(event.role)) {
      throw new Error(`transcript-store: invalid role "${event.role}"`);
    }
    if (!VALID_EVENT_TYPES.includes(event.eventType)) {
      throw new Error(`transcript-store: invalid eventType "${event.eventType}"`);
    }
    if (typeof event.content !== 'string') {
      throw new Error('transcript-store: content must be a string');
    }

    let storedContent = event.content;
    let metadata = event.metadata ? { ...event.metadata } : undefined;
    const contentBytes = Buffer.byteLength(storedContent, 'utf8');
    if (contentBytes > maxContentBytes) {
      storedContent = storedContent.slice(0, maxContentBytes);
      metadata = {
        ...(metadata ?? {}),
        truncated: true,
        originalLength: event.content.length,
        originalBytes: contentBytes,
      };
    }

    const ts = now();
    const result = insertStmt.run(
      event.actorId,
      event.sessionId ?? null,
      event.turnId,
      event.role,
      event.eventType,
      storedContent,
      event.tokensIn ?? null,
      event.tokensOut ?? null,
      event.cachedTokensIn ?? null,
      event.model ?? null,
      event.backend ?? null,
      event.costUsd ?? null,
      metadata ? JSON.stringify(metadata) : null,
      ts,
    );

    const id = Number(result.lastInsertRowid);
    const row = getByIdStmt.get(id) as Record<string, unknown>;
    return rowToEvent(row);
  }

  function query(opts: TranscriptQuery = {}): TranscriptEvent[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.actorId != null) {
      where.push('actor_id = ?');
      params.push(opts.actorId);
    }
    if (opts.sessionId != null) {
      where.push('session_id = ?');
      params.push(opts.sessionId);
    }
    if (opts.turnId != null) {
      where.push('turn_id = ?');
      params.push(opts.turnId);
    }
    if (opts.eventType != null) {
      where.push('event_type = ?');
      params.push(opts.eventType);
    }
    if (opts.since != null) {
      where.push('ts >= ?');
      params.push(opts.since);
    }
    if (opts.until != null) {
      where.push('ts <= ?');
      params.push(opts.until);
    }

    const order = opts.order === 'asc' ? 'ASC' : 'DESC';
    const requestedLimit = opts.limit ?? DEFAULT_QUERY_LIMIT;
    const limit = Math.min(Math.max(1, requestedLimit), MAX_QUERY_LIMIT);

    const sql = `
      SELECT * FROM transcript_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ts ${order}, id ${order}
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  function stats(scope: { actorId?: string; sessionId?: string; since?: number; until?: number } = {}): TranscriptStats {
    const where: string[] = [];
    const params: unknown[] = [];
    if (scope.actorId != null) {
      where.push('actor_id = ?');
      params.push(scope.actorId);
    }
    if (scope.sessionId != null) {
      where.push('session_id = ?');
      params.push(scope.sessionId);
    }
    if (scope.since != null) {
      where.push('ts >= ?');
      params.push(scope.since);
    }
    if (scope.until != null) {
      where.push('ts <= ?');
      params.push(scope.until);
    }

    const sql = `
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT actor_id) AS unique_actors,
        COUNT(DISTINCT session_id) AS unique_sessions,
        COUNT(DISTINCT turn_id) AS unique_turns,
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts,
        COALESCE(SUM(cost_usd), 0) AS total_cost,
        COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
        COALESCE(SUM(tokens_out), 0) AS total_tokens_out
      FROM transcript_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `;
    const row = db.prepare(sql).get(...params) as Record<string, unknown>;
    return {
      total: Number(row.total ?? 0),
      uniqueActors: Number(row.unique_actors ?? 0),
      uniqueSessions: Number(row.unique_sessions ?? 0),
      uniqueTurns: Number(row.unique_turns ?? 0),
      firstEventTs: row.first_ts == null ? null : Number(row.first_ts),
      lastEventTs: row.last_ts == null ? null : Number(row.last_ts),
      totalCostUsd: Number(row.total_cost ?? 0),
      totalTokensIn: Number(row.total_tokens_in ?? 0),
      totalTokensOut: Number(row.total_tokens_out ?? 0),
    };
  }

  return { record, query, stats };
}
