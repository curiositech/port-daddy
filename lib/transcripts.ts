/**
 * Fleet Transcripts — ship-run conversation recorder.
 *
 * Each fleet ship execution (one spawn — one trigger → one LLM run → one
 * set of outputs) produces ONE `fleet_transcripts` row, with the full
 * conversation in `fleet_transcript_messages` (chronological) and any
 * concrete artifacts in `fleet_transcript_outputs`.
 *
 * Why a different table than `transcript-store.ts`:
 *   - transcript-store is an append-only event log keyed on (actor, turn).
 *     Optimized for cost ledger and per-turn rollups.
 *   - fleet-transcripts is the operator-facing surface. One row per ship-run
 *     means dashboard listing is a simple SELECT, no GROUP BY. The child
 *     `messages` table is what the operator expands when they click a row
 *     to see the full conversation.
 *
 * Both can coexist — they answer different questions. This file is the
 * primitive backing `pd transcripts ...` and the dashboard panel.
 *
 * Security:
 *   - Common secret env-var names are scrubbed from message content and
 *     tool-call args (best-effort; not a substitute for keeping secrets
 *     out of prompts).
 *   - Tool args containing string fields > 10KB are truncated to 1KB plus
 *     a SHA-256 hash for later auditability.
 *   - Append-only at the API surface. `deleteTranscript()` is a privileged
 *     operator action exposed only via the destructive-confirm CLI tier.
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

// =============================================================================
// Types
// =============================================================================

// 'thinking' carries an agent's reasoning steps (e.g. codex `reasoning`
// items, Claude extended-thinking blocks). It is a first-class operator-facing
// role: the whole point of full-depth capture is that HOW the agent reasoned
// is visible, not just its final answer.
export type TranscriptRole = 'system' | 'user' | 'assistant' | 'tool' | 'thinking';
export type OutputType = 'pr-comment' | 'issue' | 'draft-pr' | 'commit' | 'noop' | 'message' | 'other';
export type TranscriptStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'over_budget';

export interface TranscriptMessage {
  role: TranscriptRole;
  content: string;
  timestamp: number;
  tool_calls?: Array<{ name: string; args: unknown; result?: unknown }>;
}

export interface TranscriptOutput {
  type: OutputType;
  url?: string;
  summary: string;
}

export interface TranscriptEntry {
  id: string;
  ship: string;
  session_id: string | null;
  spawned_agent_id: string;
  pr_number?: number | null;
  issue_number?: number | null;
  trigger: string;
  backend: string;
  model: string;
  requested_backend?: string;
  effective_backend?: string;
  requested_model?: string;
  effective_model?: string;
  backend_override_source?: string;
  status: TranscriptStatus;
  started_at: number;
  ended_at?: number | null;
  cost_usd?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  messages: TranscriptMessage[];
  outputs: TranscriptOutput[];
  error?: string | null;
  project?: string | null;
  identity?: string | null;
}

/**
 * Durable retention sink for finalized transcripts (lib/transcript-archive.ts).
 * Called fire-and-forget when a transcript reaches a terminal state, so the
 * record survives even if the live DB is lost. MUST NOT throw — it reports its
 * own failures loudly instead (a silent retention loss is what the directive
 * forbids).
 */
export interface TranscriptArchiveSink {
  archive(entry: TranscriptEntry): void;
}

export interface TranscriptFilter {
  ship?: string;
  pr?: number;
  agentId?: string;
  since?: number;
  until?: number;
  limit?: number;
  status?: TranscriptStatus;
}

export interface CostRollupBucket {
  bucket: string;     // ISO date (YYYY-MM-DD)
  ship: string;
  runs: number;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
}

export interface CostRollup {
  since: number;
  until: number;
  total_runs: number;
  total_cost_usd: number;
  total_tokens_in: number;
  total_tokens_out: number;
  by_ship: Array<{ ship: string; runs: number; cost_usd: number }>;
  by_day: CostRollupBucket[];
}

export interface TranscriptListener {
  (event: { type: 'start' | 'update' | 'end'; entry: TranscriptEntry }): void;
}

export interface ShipRegistryEntry {
  id: string;
  source?: 'project' | 'user' | 'system';
  fleet_file?: string | null;
  last_run_at?: number | null;
  last_run_status?: string | null;
  last_finding_count?: number | null;
  health_score?: number | null;
  tender_recommendation?: string | null;
  paused_at?: number | null;
  paused_reason?: string | null;
  updated_at?: number;
}

export interface FleetSuggestion {
  id: string;
  ship_name: string;
  reason: string;
  suggested_at: number;
  priority: number;
  action: 'run-now' | 'adjust-cooldown' | 'pause' | 'review-prompt' | 'graft-skill';
  dismissed_at?: number | null;
  approved_at?: number | null;
}

export interface SkillApplication {
  id: string;
  transcript_id: string;
  ship_name: string;
  skill_id: string;
  skill_version?: string | null;
  outcome: 'improved' | 'neutral' | 'degraded' | 'unknown';
  context?: string | null;
  applied_at: number;
}

export interface TranscriptsModule {
  /** Open or create a transcript row for a starting ship-run. Returns id. */
  start(input: TranscriptStartInput): string;
  /** Append a message to an existing transcript. */
  appendMessage(id: string, message: TranscriptMessage): void;
  /** Append an output artifact to an existing transcript. */
  appendOutput(id: string, output: TranscriptOutput): void;
  /** Mark transcript as completed/failed/cancelled and finalize cost+tokens. */
  finalize(id: string, finalize: TranscriptFinalizeInput): void;
  /** Top-level record (alternative to start/append/finalize when the whole conversation is known up-front). */
  recordTranscript(entry: TranscriptEntry): void;
  /** List recent transcripts (without messages — lightweight). */
  listTranscripts(filter?: TranscriptFilter): TranscriptEntry[];
  /** Get a single transcript with full messages + outputs. */
  getTranscript(id: string): TranscriptEntry | null;
  /** Delete one transcript (destructive — gated at CLI layer). */
  deleteTranscript(id: string): boolean;
  /** Rollup cost by ship + day. */
  costRollup(opts: { since: number; until?: number }): CostRollup;
  /** Durably re-archive every transcript in the DB (retention backfill). Returns count. */
  backfillArchive(): { archived: number };
  /** Subscribe to live transcript events (returns unsubscribe). */
  subscribe(listener: TranscriptListener): () => void;
  /** Emit an event to all subscribers (called internally; exposed for tests). */
  emit(event: { type: 'start' | 'update' | 'end'; entry: TranscriptEntry }): void;
  // Ship registry
  upsertShipRegistry(entry: ShipRegistryEntry): void;
  listShipRegistry(): ShipRegistryEntry[];
  getShipRegistryEntry(id: string): ShipRegistryEntry | null;
  // Fleet suggestions
  writeSuggestion(s: Omit<FleetSuggestion, 'id' | 'suggested_at'>): string;
  writeSuggestionIfNew(s: Omit<FleetSuggestion, 'id' | 'suggested_at'>): string | null;
  listSuggestions(opts?: { includeActioned?: boolean }): FleetSuggestion[];
  approveSuggestion(id: string): boolean;
  dismissSuggestion(id: string): boolean;
  // Skill outcomes
  recordSkillApplication(app: Omit<SkillApplication, 'id'>): string;
  listSkillApplications(opts?: { ship_name?: string; skill_id?: string; limit?: number }): SkillApplication[];
  scoreSkillOutcome(id: string, outcome: SkillApplication['outcome']): boolean;
}

export interface TranscriptStartInput {
  id?: string;
  ship: string;
  session_id?: string | null;
  spawned_agent_id: string;
  pr_number?: number | null;
  issue_number?: number | null;
  trigger: string;
  backend: string;
  model: string;
  requested_backend?: string | null;
  effective_backend?: string | null;
  requested_model?: string | null;
  effective_model?: string | null;
  backend_override_source?: string | null;
  started_at?: number;
  project?: string | null;
  identity?: string | null;
}

export interface TranscriptFinalizeInput {
  status: TranscriptStatus;
  ended_at?: number;
  cost_usd?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  error?: string | null;
}

export interface TranscriptsOptions {
  /** Date.now injector for tests. */
  now?: () => number;
  /** Maximum bytes for an individual tool-arg string field before truncation+hash. Default 10240. */
  maxToolArgFieldBytes?: number;
  /** Max bytes for a single message content cell. Larger contents are truncated with marker. Default 256KB. */
  maxMessageContentBytes?: number;
  /**
   * Durable retention sink. When set, every finalized transcript is written to it
   * (fire-and-forget) so the record survives loss of the live DB. The daemon wires
   * the always-on JSONL archive (lib/transcript-archive.ts) here by default.
   */
  archiveSink?: TranscriptArchiveSink;
}

// =============================================================================
// Schema
// =============================================================================

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS fleet_transcripts (
    id TEXT PRIMARY KEY,
    ship TEXT NOT NULL,
    session_id TEXT,
    spawned_agent_id TEXT NOT NULL,
    pr_number INTEGER,
    issue_number INTEGER,
    trigger TEXT NOT NULL,
    backend TEXT NOT NULL,
    model TEXT NOT NULL,
    requested_backend TEXT,
    effective_backend TEXT,
    requested_model TEXT,
    effective_model TEXT,
    backend_override_source TEXT NOT NULL DEFAULT 'none',
    status TEXT NOT NULL DEFAULT 'running',
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    cost_usd REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    error TEXT,
    project TEXT,
    identity TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fleet_transcripts_ship_started
     ON fleet_transcripts(ship, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_fleet_transcripts_pr
     ON fleet_transcripts(pr_number)
     WHERE pr_number IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_fleet_transcripts_started
     ON fleet_transcripts(started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_fleet_transcripts_status
     ON fleet_transcripts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_fleet_transcripts_agent
     ON fleet_transcripts(spawned_agent_id)`,
  `CREATE TABLE IF NOT EXISTS fleet_transcript_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript_id TEXT NOT NULL REFERENCES fleet_transcripts(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    tool_calls_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fleet_transcript_messages_transcript
     ON fleet_transcript_messages(transcript_id, seq)`,
  `CREATE TABLE IF NOT EXISTS fleet_transcript_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript_id TEXT NOT NULL REFERENCES fleet_transcripts(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    url TEXT,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fleet_transcript_outputs_transcript
     ON fleet_transcript_outputs(transcript_id, seq)`,

  // ── Fleet ship registry ────────────────────────────────────────────
  // One row per declared ship, maintained by Tender. Source of truth for
  // the suggestibility layer: health scores, recommendations, pause state.
  `CREATE TABLE IF NOT EXISTS fleet_ship_registry (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'project',
    fleet_file TEXT,
    last_run_at INTEGER,
    last_run_status TEXT,
    last_finding_count INTEGER,
    health_score REAL,
    tender_recommendation TEXT,
    paused_at INTEGER,
    paused_reason TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fleet_ship_registry_updated
     ON fleet_ship_registry(updated_at DESC)`,

  // ── Fleet suggestions ──────────────────────────────────────────────
  // Tender writes rows here; operator drains them via /fleet/suggestions
  // and pd suggest. Approved rows become one-shot fleet runs.
  `CREATE TABLE IF NOT EXISTS fleet_suggestions (
    id TEXT PRIMARY KEY,
    ship_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    suggested_at INTEGER NOT NULL,
    priority INTEGER NOT NULL DEFAULT 5,
    action TEXT NOT NULL DEFAULT 'run-now',
    dismissed_at INTEGER,
    approved_at INTEGER,
    CHECK (action IN ('run-now','adjust-cooldown','pause','review-prompt','graft-skill'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fleet_suggestions_pending
     ON fleet_suggestions(priority DESC, suggested_at DESC)
     WHERE dismissed_at IS NULL AND approved_at IS NULL`,

  // ── Skill application outcomes ─────────────────────────────────────
  // One row per skill grafted per transcript run. Outcome starts as
  // 'unknown'; Tender retrospectively scores by comparing finding rate
  // and cost to the ship's baseline.
  `CREATE TABLE IF NOT EXISTS skill_applications (
    id TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL REFERENCES fleet_transcripts(id) ON DELETE CASCADE,
    ship_name TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    skill_version TEXT,
    outcome TEXT NOT NULL DEFAULT 'unknown',
    context TEXT,
    applied_at INTEGER NOT NULL,
    CHECK (outcome IN ('improved','neutral','degraded','unknown'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_skill_applications_transcript
     ON skill_applications(transcript_id)`,
  `CREATE INDEX IF NOT EXISTS idx_skill_applications_ship_skill
     ON skill_applications(ship_name, skill_id, applied_at DESC)`,
];

const FLEET_TRANSCRIPT_RUNTIME_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: 'requested_backend', definition: 'TEXT' },
  { name: 'effective_backend', definition: 'TEXT' },
  { name: 'requested_model', definition: 'TEXT' },
  { name: 'effective_model', definition: 'TEXT' },
  { name: 'backend_override_source', definition: "TEXT NOT NULL DEFAULT 'none'" },
];

// =============================================================================
// Redaction
// =============================================================================

/**
 * Env-var names that frequently carry secrets. We redact case-insensitively.
 * Curated list (not keyword-based NLP — these are stable, structured
 * identifiers that match well-known secret env conventions).
 */
const SECRET_ENV_PATTERNS: RegExp[] = [
  /\b(?:[A-Z_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|CREDENTIAL|BEARER))(?:\s*[:=]\s*|["']?\s*[:=]\s*["']?)([^\s"',}\];]+)/gi,
  /\b(?:Bearer|bearer)\s+([A-Za-z0-9._\-+/=]{16,})/g,
  // GitHub PAT / app tokens
  /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g,
  // OpenAI keys
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  // Anthropic keys
  /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
  // Stripe
  /\b((?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,})\b/g,
  // AWS access keys
  /\b(AKIA[0-9A-Z]{16})\b/g,
];

export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of SECRET_ENV_PATTERNS) {
    out = out.replace(re, (match, captured: string) => {
      // For key:value style matches we want to redact the value (group 1).
      // For Bearer/known prefixes we redact the whole captured token.
      if (captured) {
        const tail = captured.length > 4 ? captured.slice(-4) : '';
        return match.replace(captured, `[REDACTED:${tail}]`);
      }
      return '[REDACTED]';
    });
  }
  return out;
}

// =============================================================================
// Tool-arg truncation
// =============================================================================

function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function truncateLargeStrings(value: unknown, limit: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > limit) {
      const head = value.slice(0, 1024);
      const hash = hashSha256(value);
      return `${head}\n[truncated: original=${value.length} chars sha256:${hash}]`;
    }
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => truncateLargeStrings(v, limit));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateLargeStrings(v, limit);
    }
    return out;
  }
  return value;
}

// =============================================================================
// Implementation
// =============================================================================

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const DEFAULT_TOOL_ARG_FIELD_BYTES = 10_240;
const DEFAULT_MESSAGE_CONTENT_BYTES = 256_000;

export function createTranscripts(
  db: Database.Database,
  options: TranscriptsOptions = {},
): TranscriptsModule {
  const now = options.now ?? Date.now;
  const maxToolArgFieldBytes = options.maxToolArgFieldBytes ?? DEFAULT_TOOL_ARG_FIELD_BYTES;
  const maxMessageContentBytes = options.maxMessageContentBytes ?? DEFAULT_MESSAGE_CONTENT_BYTES;
  const archiveSink = options.archiveSink;

  /**
   * Push a finalized transcript to the durable retention sink. Fire-and-forget:
   * a sink failure must never block transcript recording or the spawn. The sink
   * reports its own failures loudly (lib/transcript-archive.ts).
   */
  function archiveFinalized(entry: TranscriptEntry | null): void {
    if (!entry || !archiveSink) return;
    try {
      archiveSink.archive(entry);
    } catch {
      // The sink owns loud failure reporting; never propagate.
    }
  }

  for (const stmt of SCHEMA_STATEMENTS) {
    db.prepare(stmt).run();
  }
  const transcriptColumns = new Set(
    (db.prepare('PRAGMA table_info(fleet_transcripts)').all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  for (const column of FLEET_TRANSCRIPT_RUNTIME_COLUMNS) {
    if (!transcriptColumns.has(column.name)) {
      db.exec(`ALTER TABLE fleet_transcripts ADD COLUMN ${column.name} ${column.definition}`);
    }
  }

  const insertTranscriptStmt = db.prepare(`
    INSERT INTO fleet_transcripts (
      id, ship, session_id, spawned_agent_id, pr_number, issue_number,
      trigger, backend, model, requested_backend, effective_backend,
      requested_model, effective_model, backend_override_source,
      status, started_at, ended_at,
      cost_usd, tokens_in, tokens_out, error, project, identity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertTranscriptStmt = db.prepare(`
    INSERT INTO fleet_transcripts (
      id, ship, session_id, spawned_agent_id, pr_number, issue_number,
      trigger, backend, model, requested_backend, effective_backend,
      requested_model, effective_model, backend_override_source,
      status, started_at, ended_at,
      cost_usd, tokens_in, tokens_out, error, project, identity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ship = excluded.ship,
      session_id = excluded.session_id,
      spawned_agent_id = excluded.spawned_agent_id,
      pr_number = excluded.pr_number,
      issue_number = excluded.issue_number,
      trigger = excluded.trigger,
      backend = excluded.backend,
      model = excluded.model,
      requested_backend = excluded.requested_backend,
      effective_backend = excluded.effective_backend,
      requested_model = excluded.requested_model,
      effective_model = excluded.effective_model,
      backend_override_source = excluded.backend_override_source,
      status = excluded.status,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      cost_usd = excluded.cost_usd,
      tokens_in = excluded.tokens_in,
      tokens_out = excluded.tokens_out,
      error = excluded.error,
      project = excluded.project,
      identity = excluded.identity
  `);

  const insertMessageStmt = db.prepare(`
    INSERT INTO fleet_transcript_messages (transcript_id, seq, role, content, timestamp, tool_calls_json)
    VALUES (?, COALESCE((SELECT MAX(seq) + 1 FROM fleet_transcript_messages WHERE transcript_id = ?), 0), ?, ?, ?, ?)
  `);

  const insertOutputStmt = db.prepare(`
    INSERT INTO fleet_transcript_outputs (transcript_id, seq, type, url, summary, created_at)
    VALUES (?, COALESCE((SELECT MAX(seq) + 1 FROM fleet_transcript_outputs WHERE transcript_id = ?), 0), ?, ?, ?, ?)
  `);

  const finalizeStmt = db.prepare(`
    UPDATE fleet_transcripts
       SET status = ?,
           ended_at = ?,
           cost_usd = COALESCE(?, cost_usd),
           tokens_in = COALESCE(?, tokens_in),
           tokens_out = COALESCE(?, tokens_out),
           error = COALESCE(?, error)
     WHERE id = ?
  `);

  const getTranscriptRowStmt = db.prepare(`SELECT * FROM fleet_transcripts WHERE id = ?`);
  const getMessagesStmt = db.prepare(`
    SELECT role, content, timestamp, tool_calls_json
      FROM fleet_transcript_messages
     WHERE transcript_id = ?
     ORDER BY seq ASC
  `);
  const getOutputsStmt = db.prepare(`
    SELECT type, url, summary
      FROM fleet_transcript_outputs
     WHERE transcript_id = ?
     ORDER BY seq ASC
  `);

  const deleteTranscriptStmt = db.prepare(`DELETE FROM fleet_transcripts WHERE id = ?`);

  // In-memory subscriber registry (SSE clients wait on these).
  const subscribers = new Set<TranscriptListener>();

  function newId(): string {
    // 12 hex chars + ms timestamp → readable but collision-resistant for our scale
    const ts = now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return `tx_${ts}_${rand}`;
  }

  function rowToHeader(row: Record<string, unknown>): TranscriptEntry {
    return {
      id: row.id as string,
      ship: row.ship as string,
      session_id: (row.session_id as string | null) ?? null,
      spawned_agent_id: row.spawned_agent_id as string,
      pr_number: (row.pr_number as number | null) ?? null,
      issue_number: (row.issue_number as number | null) ?? null,
      trigger: row.trigger as string,
      backend: row.backend as string,
      model: row.model as string,
      requested_backend: (row.requested_backend as string | null) ?? (row.backend as string),
      effective_backend: (row.effective_backend as string | null) ?? (row.backend as string),
      requested_model: (row.requested_model as string | null) ?? (row.model as string),
      effective_model: (row.effective_model as string | null) ?? (row.model as string),
      backend_override_source: (row.backend_override_source as string | null) ?? 'none',
      status: row.status as TranscriptStatus,
      started_at: row.started_at as number,
      ended_at: (row.ended_at as number | null) ?? null,
      cost_usd: (row.cost_usd as number | null) ?? null,
      tokens_in: (row.tokens_in as number | null) ?? null,
      tokens_out: (row.tokens_out as number | null) ?? null,
      error: (row.error as string | null) ?? null,
      project: (row.project as string | null) ?? null,
      identity: (row.identity as string | null) ?? null,
      messages: [],
      outputs: [],
    };
  }

  function loadMessages(id: string): TranscriptMessage[] {
    const rows = getMessagesStmt.all(id) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      let toolCalls: TranscriptMessage['tool_calls'] = undefined;
      if (row.tool_calls_json) {
        try {
          toolCalls = JSON.parse(row.tool_calls_json as string);
        } catch {
          toolCalls = undefined;
        }
      }
      const msg: TranscriptMessage = {
        role: row.role as TranscriptRole,
        content: row.content as string,
        timestamp: row.timestamp as number,
      };
      if (toolCalls) msg.tool_calls = toolCalls;
      return msg;
    });
  }

  function loadOutputs(id: string): TranscriptOutput[] {
    const rows = getOutputsStmt.all(id) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const o: TranscriptOutput = {
        type: row.type as OutputType,
        summary: row.summary as string,
      };
      if (row.url) o.url = row.url as string;
      return o;
    });
  }

  function start(input: TranscriptStartInput): string {
    const id = input.id ?? newId();
    const startedAt = input.started_at ?? now();
    insertTranscriptStmt.run(
      id,
      input.ship,
      input.session_id ?? null,
      input.spawned_agent_id,
      input.pr_number ?? null,
      input.issue_number ?? null,
      input.trigger,
      input.backend,
      input.model,
      input.requested_backend ?? input.backend,
      input.effective_backend ?? input.backend,
      input.requested_model ?? input.model,
      input.effective_model ?? input.model,
      input.backend_override_source ?? 'none',
      'running',
      startedAt,
      null,
      null,
      null,
      null,
      null,
      input.project ?? null,
      input.identity ?? null,
    );
    const row = getTranscriptRowStmt.get(id) as Record<string, unknown>;
    const entry = rowToHeader(row);
    emit({ type: 'start', entry });
    return id;
  }

  function normalizeContent(value: string): string {
    if (typeof value !== 'string') return '';
    let content = redactSecrets(value);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxMessageContentBytes) {
      const head = content.slice(0, Math.min(content.length, maxMessageContentBytes));
      const hash = hashSha256(content);
      content = `${head}\n[truncated: original=${content.length} chars sha256:${hash}]`;
    }
    return content;
  }

  function appendMessage(id: string, message: TranscriptMessage): void {
    const headerRow = getTranscriptRowStmt.get(id) as Record<string, unknown> | undefined;
    if (!headerRow) {
      throw new Error(`transcripts: no transcript with id "${id}"`);
    }
    const content = normalizeContent(message.content ?? '');
    let toolCallsJson: string | null = null;
    if (message.tool_calls && message.tool_calls.length > 0) {
      const sanitized = message.tool_calls.map((tc) => ({
        name: tc.name,
        args: truncateLargeStrings(tc.args, maxToolArgFieldBytes),
        ...(tc.result !== undefined
          ? { result: truncateLargeStrings(tc.result, maxToolArgFieldBytes) }
          : {}),
      }));
      toolCallsJson = JSON.stringify(sanitized);
    }
    insertMessageStmt.run(
      id,
      id,
      message.role,
      content,
      message.timestamp ?? now(),
      toolCallsJson,
    );
    const refreshed = getTranscript(id);
    if (refreshed) emit({ type: 'update', entry: refreshed });
  }

  function appendOutput(id: string, output: TranscriptOutput): void {
    const headerRow = getTranscriptRowStmt.get(id) as Record<string, unknown> | undefined;
    if (!headerRow) {
      throw new Error(`transcripts: no transcript with id "${id}"`);
    }
    insertOutputStmt.run(
      id,
      id,
      output.type,
      output.url ?? null,
      output.summary,
      now(),
    );
    const refreshed = getTranscript(id);
    if (refreshed) emit({ type: 'update', entry: refreshed });
  }

  function finalize(id: string, fin: TranscriptFinalizeInput): void {
    finalizeStmt.run(
      fin.status,
      fin.ended_at ?? now(),
      fin.cost_usd ?? null,
      fin.tokens_in ?? null,
      fin.tokens_out ?? null,
      fin.error ?? null,
      id,
    );
    const refreshed = getTranscript(id);
    if (refreshed) emit({ type: 'end', entry: refreshed });
    archiveFinalized(refreshed);
  }

  function recordTranscript(entry: TranscriptEntry): void {
    upsertTranscriptStmt.run(
      entry.id,
      entry.ship,
      entry.session_id ?? null,
      entry.spawned_agent_id,
      entry.pr_number ?? null,
      entry.issue_number ?? null,
      entry.trigger,
      entry.backend,
      entry.model,
      entry.requested_backend ?? entry.backend,
      entry.effective_backend ?? entry.backend,
      entry.requested_model ?? entry.model,
      entry.effective_model ?? entry.model,
      entry.backend_override_source ?? 'none',
      entry.status,
      entry.started_at,
      entry.ended_at ?? null,
      entry.cost_usd ?? null,
      entry.tokens_in ?? null,
      entry.tokens_out ?? null,
      entry.error ?? null,
      entry.project ?? null,
      entry.identity ?? null,
    );
    for (const m of entry.messages || []) {
      appendMessage(entry.id, m);
    }
    for (const o of entry.outputs || []) {
      appendOutput(entry.id, o);
    }
    const refreshed = getTranscript(entry.id);
    if (refreshed) emit({ type: 'end', entry: refreshed });
    archiveFinalized(refreshed);
  }

  function getTranscript(id: string): TranscriptEntry | null {
    const row = getTranscriptRowStmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const header = rowToHeader(row);
    header.messages = loadMessages(id);
    header.outputs = loadOutputs(id);
    return header;
  }

  function listTranscripts(filter: TranscriptFilter = {}): TranscriptEntry[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.ship) { where.push('ship = ?'); params.push(filter.ship); }
    if (filter.pr != null) { where.push('pr_number = ?'); params.push(filter.pr); }
    if (filter.agentId) { where.push('spawned_agent_id = ?'); params.push(filter.agentId); }
    if (filter.since != null) { where.push('started_at >= ?'); params.push(filter.since); }
    if (filter.until != null) { where.push('started_at <= ?'); params.push(filter.until); }
    if (filter.status) { where.push('status = ?'); params.push(filter.status); }

    const limit = Math.min(MAX_LIMIT, Math.max(1, filter.limit ?? DEFAULT_LIMIT));
    const sql = `
      SELECT * FROM fleet_transcripts
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY started_at DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    // Headers only — no messages/outputs (caller can fetch by id)
    return rows.map(rowToHeader);
  }

  function deleteTranscript(id: string): boolean {
    const result = deleteTranscriptStmt.run(id);
    // CASCADE drops messages and outputs via the FK ON DELETE CASCADE
    return result.changes > 0;
  }

  function costRollup(opts: { since: number; until?: number }): CostRollup {
    const since = opts.since;
    const until = opts.until ?? now();

    const totals = db.prepare(`
      SELECT
        COUNT(*) AS runs,
        COALESCE(SUM(cost_usd), 0) AS cost,
        COALESCE(SUM(tokens_in), 0) AS tin,
        COALESCE(SUM(tokens_out), 0) AS tout
      FROM fleet_transcripts
      WHERE started_at >= ? AND started_at <= ?
    `).get(since, until) as Record<string, unknown>;

    const byShipRows = db.prepare(`
      SELECT ship, COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost
        FROM fleet_transcripts
       WHERE started_at >= ? AND started_at <= ?
       GROUP BY ship
       ORDER BY cost DESC, runs DESC
    `).all(since, until) as Array<Record<string, unknown>>;

    const byDayRows = db.prepare(`
      SELECT
        date(started_at / 1000, 'unixepoch') AS bucket,
        ship,
        COUNT(*) AS runs,
        COALESCE(SUM(cost_usd), 0) AS cost,
        COALESCE(SUM(tokens_in), 0) AS tin,
        COALESCE(SUM(tokens_out), 0) AS tout
      FROM fleet_transcripts
      WHERE started_at >= ? AND started_at <= ?
      GROUP BY bucket, ship
      ORDER BY bucket DESC, ship ASC
    `).all(since, until) as Array<Record<string, unknown>>;

    return {
      since,
      until,
      total_runs: Number(totals.runs ?? 0),
      total_cost_usd: Number(totals.cost ?? 0),
      total_tokens_in: Number(totals.tin ?? 0),
      total_tokens_out: Number(totals.tout ?? 0),
      by_ship: byShipRows.map((r) => ({
        ship: r.ship as string,
        runs: Number(r.runs ?? 0),
        cost_usd: Number(r.cost ?? 0),
      })),
      by_day: byDayRows.map((r) => ({
        bucket: r.bucket as string,
        ship: r.ship as string,
        runs: Number(r.runs ?? 0),
        cost_usd: Number(r.cost ?? 0),
        tokens_in: Number(r.tin ?? 0),
        tokens_out: Number(r.tout ?? 0),
      })),
    };
  }

  function subscribe(listener: TranscriptListener): () => void {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function emit(event: { type: 'start' | 'update' | 'end'; entry: TranscriptEntry }): void {
    for (const listener of subscribers) {
      try {
        listener(event);
      } catch {
        // Subscriber failures never block recording
      }
    }
  }

  /**
   * Retention backfill: push every transcript currently in the DB to the archive
   * sink, so durable retention covers history, not just runs since the sink was
   * enabled ("log ALL transcripts"). No-op without a sink. Returns the count.
   */
  function backfillArchive(): { archived: number } {
    if (!archiveSink) return { archived: 0 };
    let archived = 0;
    for (const header of listTranscripts({})) {
      archiveFinalized(getTranscript(header.id) ?? header);
      archived += 1;
    }
    return { archived };
  }

  // ==========================================================================
  // Ship registry
  // ==========================================================================

  function upsertShipRegistry(entry: ShipRegistryEntry): void {
    db.prepare(`
      INSERT INTO fleet_ship_registry
        (id, source, fleet_file, last_run_at, last_run_status, last_finding_count,
         health_score, tender_recommendation, paused_at, paused_reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        fleet_file = excluded.fleet_file,
        last_run_at = COALESCE(excluded.last_run_at, fleet_ship_registry.last_run_at),
        last_run_status = COALESCE(excluded.last_run_status, fleet_ship_registry.last_run_status),
        last_finding_count = COALESCE(excluded.last_finding_count, fleet_ship_registry.last_finding_count),
        health_score = COALESCE(excluded.health_score, fleet_ship_registry.health_score),
        tender_recommendation = excluded.tender_recommendation,
        paused_at = excluded.paused_at,
        paused_reason = excluded.paused_reason,
        updated_at = excluded.updated_at
    `).run(
      entry.id, entry.source ?? 'project', entry.fleet_file ?? null,
      entry.last_run_at ?? null, entry.last_run_status ?? null,
      entry.last_finding_count ?? null, entry.health_score ?? null,
      entry.tender_recommendation ?? null, entry.paused_at ?? null,
      entry.paused_reason ?? null, now(),
    );
  }

  function listShipRegistry(): ShipRegistryEntry[] {
    return db.prepare(`SELECT * FROM fleet_ship_registry ORDER BY id`).all() as ShipRegistryEntry[];
  }

  function getShipRegistryEntry(id: string): ShipRegistryEntry | null {
    return db.prepare(`SELECT * FROM fleet_ship_registry WHERE id = ?`).get(id) as ShipRegistryEntry | null;
  }

  // ==========================================================================
  // Fleet suggestions
  // ==========================================================================

  function writeSuggestion(s: Omit<FleetSuggestion, 'id' | 'suggested_at'>): string {
    const id = `sug_${Math.random().toString(36).slice(2, 10)}`;
    db.prepare(`
      INSERT INTO fleet_suggestions (id, ship_name, reason, suggested_at, priority, action)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, s.ship_name, s.reason, now(), s.priority ?? 5, s.action ?? 'run-now');
    return id;
  }

  function listSuggestions(opts: { includeActioned?: boolean } = {}): FleetSuggestion[] {
    const where = opts.includeActioned ? '' : 'WHERE dismissed_at IS NULL AND approved_at IS NULL';
    return db.prepare(`
      SELECT * FROM fleet_suggestions ${where}
      ORDER BY priority DESC, suggested_at DESC
    `).all() as FleetSuggestion[];
  }

  function approveSuggestion(id: string): boolean {
    const result = db.prepare(`UPDATE fleet_suggestions SET approved_at = ? WHERE id = ?`).run(now(), id);
    return result.changes > 0;
  }

  function dismissSuggestion(id: string): boolean {
    const result = db.prepare(`UPDATE fleet_suggestions SET dismissed_at = ? WHERE id = ?`).run(now(), id);
    return result.changes > 0;
  }

  // Deduplicate: if an unactioned suggestion already exists for this ship+action, skip.
  function writeSuggestionIfNew(s: Omit<FleetSuggestion, 'id' | 'suggested_at'>): string | null {
    const existing = db.prepare(`
      SELECT id FROM fleet_suggestions
      WHERE ship_name = ? AND action = ? AND dismissed_at IS NULL AND approved_at IS NULL
    `).get(s.ship_name, s.action);
    if (existing) return null;
    return writeSuggestion(s);
  }

  // ==========================================================================
  // Skill application outcomes
  // ==========================================================================

  function recordSkillApplication(app: Omit<SkillApplication, 'id'>): string {
    const id = `ska_${Math.random().toString(36).slice(2, 10)}`;
    db.prepare(`
      INSERT INTO skill_applications
        (id, transcript_id, ship_name, skill_id, skill_version, outcome, context, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, app.transcript_id, app.ship_name, app.skill_id,
      app.skill_version ?? null, app.outcome ?? 'unknown',
      app.context ?? null, app.applied_at ?? now(),
    );
    return id;
  }

  function listSkillApplications(opts: { ship_name?: string; skill_id?: string; limit?: number } = {}): SkillApplication[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (opts.ship_name) { conditions.push('ship_name = ?'); params.push(opts.ship_name); }
    if (opts.skill_id) { conditions.push('skill_id = ?'); params.push(opts.skill_id); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 200;
    return db.prepare(`
      SELECT * FROM skill_applications ${where}
      ORDER BY applied_at DESC LIMIT ?
    `).all(...params, limit) as SkillApplication[];
  }

  function scoreSkillOutcome(id: string, outcome: SkillApplication['outcome']): boolean {
    const result = db.prepare(`UPDATE skill_applications SET outcome = ? WHERE id = ?`).run(outcome, id);
    return result.changes > 0;
  }

  return {
    start,
    appendMessage,
    appendOutput,
    finalize,
    recordTranscript,
    listTranscripts,
    getTranscript,
    deleteTranscript,
    costRollup,
    subscribe,
    emit,
    backfillArchive,
    // Ship registry
    upsertShipRegistry,
    listShipRegistry,
    getShipRegistryEntry,
    // Suggestions
    writeSuggestion,
    writeSuggestionIfNew,
    listSuggestions,
    approveSuggestion,
    dismissSuggestion,
    // Skill outcomes
    recordSkillApplication,
    listSkillApplications,
    scoreSkillOutcome,
  };
}

export type Transcripts = ReturnType<typeof createTranscripts>;
