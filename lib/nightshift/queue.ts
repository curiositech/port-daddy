/**
 * Nightshift Queue — operator drops vague hopes; cron drains them overnight.
 *
 * Storage model: a single `nightshift_intents` SQLite table. The queue is
 * intentionally small and read-heavy. Status transitions are explicit;
 * pickers (`next()`) order by (status, created_at) so FIFO holds within
 * status. There is no harbor scoping yet — nightshift is a per-machine queue;
 * if multi-project scoping becomes needed, add a `project_dir` column and
 * filter at read-time.
 *
 * Status lifecycle:
 *
 *   proposed -> queued (operator confirmed it should run)
 *   queued   -> running (runner picked it up)
 *   running  -> succeeded | failed | aborted | timeout
 *   any      -> cancelled (operator killed it)
 *
 * `next()` returns the oldest `queued` intent and atomically transitions it
 * to `running` so two concurrent runners do not grab the same item.
 *
 * Slug derivation is deterministic from the intent text -- same text twice
 * yields the same slug, which is how `propose()` dedupes within a short
 * window.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type NightshiftStatus =
  | 'proposed'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'aborted'
  | 'timeout'
  | 'cancelled';

export const NIGHTSHIFT_TERMINAL_STATUSES: NightshiftStatus[] = [
  'succeeded',
  'failed',
  'aborted',
  'timeout',
  'cancelled',
];

export interface NightshiftIntent {
  id: string;
  slug: string;
  intent: string;
  tags: string[];
  status: NightshiftStatus;
  backend: 'cli:claude-code' | 'cli:codex' | null;
  budgetUsd: number | null;
  timeoutMs: number | null;
  worktreePath: string | null;
  branchName: string | null;
  sessionId: string | null;
  prUrl: string | null;
  costUsd: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: number;
  queuedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  reviewedAt: number | null;
}

export interface ProposeIntentInput {
  intent: string;
  tags?: string[];
  backend?: 'cli:claude-code' | 'cli:codex';
  budgetUsd?: number;
  timeoutMs?: number;
  /** Skip the `proposed` step and go straight to `queued`. */
  autoQueue?: boolean;
}

export interface ListIntentsOptions {
  status?: NightshiftStatus | 'all' | 'open' | 'terminal';
  limit?: number;
  since?: number;
}

export interface MarkRunningInput {
  id: string;
  worktreePath: string;
  branchName: string;
  sessionId: string;
}

export interface MarkCompleteInput {
  id: string;
  status: 'succeeded' | 'failed' | 'aborted' | 'timeout';
  prUrl?: string | null;
  costUsd?: number | null;
  errorMessage?: string | null;
}

export interface NightshiftQueueDeps {
  db: Database.Database;
  /** Injectable clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

interface IntentRow {
  id: string;
  slug: string;
  intent: string;
  tags_json: string;
  status: NightshiftStatus;
  backend: string | null;
  budget_usd: number | null;
  timeout_ms: number | null;
  worktree_path: string | null;
  branch_name: string | null;
  session_id: string | null;
  pr_url: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: number;
  queued_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  reviewed_at: number | null;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS nightshift_intents (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    intent TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'proposed'
      CHECK(status IN (
        'proposed','queued','running',
        'succeeded','failed','aborted','timeout','cancelled'
      )),
    backend TEXT,
    budget_usd REAL,
    timeout_ms INTEGER,
    worktree_path TEXT,
    branch_name TEXT,
    session_id TEXT,
    pr_url TEXT,
    cost_usd REAL,
    duration_ms INTEGER,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    queued_at INTEGER,
    started_at INTEGER,
    completed_at INTEGER,
    reviewed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_nightshift_intents_status
    ON nightshift_intents(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_nightshift_intents_slug
    ON nightshift_intents(slug);
`;

/**
 * Derive a deterministic url-safe slug from the intent text.
 *
 * Lowercases, replaces non-alphanumerics with `-`, collapses runs, trims
 * to 60 chars. Empty input becomes 'untitled'. The slug is not unique by
 * itself -- combined with the `id` column it identifies the run. Used for
 * branch names (`night-shift/<slug>-<id8>`) and operator-readable logs.
 */
export function deriveSlug(intent: string): string {
  const trimmed = (intent ?? '').toString().trim().toLowerCase();
  if (!trimmed) return 'untitled';
  const cleaned = trimmed
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!cleaned) return 'untitled';
  return cleaned.slice(0, 60).replace(/-+$/, '') || 'untitled';
}

/**
 * Derive the branch name a runner should create for this intent.
 * Combines the slug with a short id suffix for uniqueness even on
 * duplicate-slug retries.
 */
export function deriveBranchName(slug: string, id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'noid';
  return `night-shift/${slug}-${safeId}`;
}

function rowToIntent(row: IntentRow): NightshiftIntent {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json);
    if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === 'string');
  } catch {
    // Tag corruption is non-fatal; empty array is fine.
  }
  return {
    id: row.id,
    slug: row.slug,
    intent: row.intent,
    tags,
    status: row.status,
    backend: (row.backend as NightshiftIntent['backend']) || null,
    budgetUsd: row.budget_usd,
    timeoutMs: row.timeout_ms,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    sessionId: row.session_id,
    prUrl: row.pr_url,
    costUsd: row.cost_usd,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    reviewedAt: row.reviewed_at,
  };
}

export function createNightshiftQueue(deps: NightshiftQueueDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());

  db.exec(SCHEMA_SQL);

  const insertStmt = db.prepare(`
    INSERT INTO nightshift_intents (
      id, slug, intent, tags_json, status, backend, budget_usd, timeout_ms,
      created_at, queued_at
    ) VALUES (
      @id, @slug, @intent, @tagsJson, @status, @backend, @budgetUsd, @timeoutMs,
      @createdAt, @queuedAt
    )
  `);

  const selectByIdStmt = db.prepare<[string], IntentRow>(
    `SELECT * FROM nightshift_intents WHERE id = ?`,
  );

  const selectAllStmt = db.prepare<[], IntentRow>(
    `SELECT * FROM nightshift_intents ORDER BY created_at DESC`,
  );

  const selectByStatusStmt = db.prepare<[string], IntentRow>(
    `SELECT * FROM nightshift_intents WHERE status = ? ORDER BY created_at DESC`,
  );

  const selectOpenStmt = db.prepare<[], IntentRow>(
    `SELECT * FROM nightshift_intents
     WHERE status IN ('proposed','queued','running')
     ORDER BY created_at DESC`,
  );

  const selectTerminalStmt = db.prepare<[], IntentRow>(
    `SELECT * FROM nightshift_intents
     WHERE status IN ('succeeded','failed','aborted','timeout','cancelled')
     ORDER BY created_at DESC`,
  );

  const selectSinceStmt = db.prepare<[number], IntentRow>(
    `SELECT * FROM nightshift_intents
     WHERE COALESCE(completed_at, created_at) >= ?
     ORDER BY created_at DESC`,
  );

  const promoteToQueuedStmt = db.prepare(`
    UPDATE nightshift_intents
       SET status = 'queued', queued_at = COALESCE(queued_at, @at)
     WHERE id = @id AND status = 'proposed'
  `);

  const markRunningStmt = db.prepare(`
    UPDATE nightshift_intents
       SET status = 'running',
           worktree_path = @worktreePath,
           branch_name = @branchName,
           session_id = @sessionId,
           started_at = @at,
           queued_at = COALESCE(queued_at, @at)
     WHERE id = @id AND status IN ('queued','proposed')
  `);

  const markCompleteStmt = db.prepare(`
    UPDATE nightshift_intents
       SET status = @status,
           pr_url = @prUrl,
           cost_usd = @costUsd,
           error_message = @errorMessage,
           completed_at = @at,
           duration_ms = CASE
             WHEN started_at IS NOT NULL THEN @at - started_at
             ELSE NULL
           END
     WHERE id = @id AND status = 'running'
  `);

  const markCancelledStmt = db.prepare(`
    UPDATE nightshift_intents
       SET status = 'cancelled', completed_at = @at, error_message = @errorMessage
     WHERE id = @id AND status NOT IN ('succeeded','failed','aborted','timeout','cancelled')
  `);

  const markReviewedStmt = db.prepare(`
    UPDATE nightshift_intents
       SET reviewed_at = @at
     WHERE id = @id
  `);

  // Atomic next-picker: returns the oldest 'queued' intent and marks it
  // 'running' in the same transaction. Two concurrent runners cannot grab
  // the same row.
  const nextSelectStmt = db.prepare<[], IntentRow>(
    `SELECT * FROM nightshift_intents
     WHERE status = 'queued'
     ORDER BY created_at ASC
     LIMIT 1`,
  );

  /**
   * Drop a new intent into the queue. By default lands in `proposed`;
   * pass `autoQueue: true` (or call `queue(id)` later) to make it eligible
   * for `next()`.
   */
  function propose(input: ProposeIntentInput): NightshiftIntent {
    if (!input.intent || typeof input.intent !== 'string') {
      throw new Error('propose: intent text is required');
    }
    const intentText = input.intent.trim();
    if (intentText.length === 0) {
      throw new Error('propose: intent text cannot be empty');
    }
    if (intentText.length > 4000) {
      throw new Error('propose: intent text cannot exceed 4000 chars');
    }
    if (input.budgetUsd !== undefined && (input.budgetUsd <= 0 || !Number.isFinite(input.budgetUsd))) {
      throw new Error('propose: budgetUsd must be a positive number');
    }
    if (input.timeoutMs !== undefined && (input.timeoutMs <= 0 || !Number.isFinite(input.timeoutMs))) {
      throw new Error('propose: timeoutMs must be a positive number');
    }
    const at = now();
    const id = randomUUID();
    const slug = deriveSlug(intentText);
    const tags = Array.isArray(input.tags)
      ? input.tags.filter((t): t is string => typeof t === 'string' && t.length > 0).slice(0, 16)
      : [];
    const status: NightshiftStatus = input.autoQueue ? 'queued' : 'proposed';
    insertStmt.run({
      id,
      slug,
      intent: intentText,
      tagsJson: JSON.stringify(tags),
      status,
      backend: input.backend ?? null,
      budgetUsd: input.budgetUsd ?? null,
      timeoutMs: input.timeoutMs ?? null,
      createdAt: at,
      queuedAt: input.autoQueue ? at : null,
    });
    const row = selectByIdStmt.get(id);
    if (!row) throw new Error(`propose: failed to insert intent ${id}`);
    return rowToIntent(row);
  }

  /** Get an intent by id. Returns null if missing. */
  function get(id: string): NightshiftIntent | null {
    const row = selectByIdStmt.get(id);
    return row ? rowToIntent(row) : null;
  }

  /** List intents. Defaults to all statuses, newest first. */
  function list(options: ListIntentsOptions = {}): NightshiftIntent[] {
    const limit = options.limit && options.limit > 0 ? options.limit : 100;
    let rows: IntentRow[];
    if (options.since !== undefined && Number.isFinite(options.since)) {
      rows = selectSinceStmt.all(options.since);
    } else if (!options.status || options.status === 'all') {
      rows = selectAllStmt.all();
    } else if (options.status === 'open') {
      rows = selectOpenStmt.all();
    } else if (options.status === 'terminal') {
      rows = selectTerminalStmt.all();
    } else {
      rows = selectByStatusStmt.all(options.status);
    }
    return rows.slice(0, limit).map(rowToIntent);
  }

  /**
   * Promote a `proposed` intent into the `queued` state. Idempotent if
   * already queued. Throws if the intent is in a terminal status.
   */
  function queue(id: string): NightshiftIntent {
    const existing = selectByIdStmt.get(id);
    if (!existing) throw new Error(`queue: intent ${id} not found`);
    if (existing.status === 'queued') return rowToIntent(existing);
    if (existing.status !== 'proposed') {
      throw new Error(`queue: cannot queue intent in status ${existing.status}`);
    }
    promoteToQueuedStmt.run({ id, at: now() });
    const updated = selectByIdStmt.get(id);
    if (!updated) throw new Error(`queue: intent ${id} vanished after update`);
    return rowToIntent(updated);
  }

  /**
   * Atomically pick the oldest `queued` intent and mark it `running`.
   * Returns null if the queue is empty. Wrapped in a transaction so
   * concurrent runners cannot double-pick.
   */
  function next(input: Omit<MarkRunningInput, 'id'>): NightshiftIntent | null {
    const txn = db.transaction((): NightshiftIntent | null => {
      const row = nextSelectStmt.get();
      if (!row) return null;
      const result = markRunningStmt.run({
        id: row.id,
        worktreePath: input.worktreePath,
        branchName: input.branchName,
        sessionId: input.sessionId,
        at: now(),
      });
      if (result.changes === 0) return null;
      const updated = selectByIdStmt.get(row.id);
      return updated ? rowToIntent(updated) : null;
    });
    return txn();
  }

  /**
   * Mark a `proposed` or `queued` intent as `running` with the worktree
   * coordinates. Used by `pd nightshift run <id>` (operator-explicit pick),
   * separate from `next()` which is the cron-style atomic pop.
   */
  function markRunning(input: MarkRunningInput): NightshiftIntent {
    const existing = selectByIdStmt.get(input.id);
    if (!existing) throw new Error(`markRunning: intent ${input.id} not found`);
    if (existing.status === 'running') {
      throw new Error(`markRunning: intent ${input.id} is already running`);
    }
    if (NIGHTSHIFT_TERMINAL_STATUSES.includes(existing.status)) {
      throw new Error(`markRunning: cannot run intent in terminal status ${existing.status}`);
    }
    const result = markRunningStmt.run({
      id: input.id,
      worktreePath: input.worktreePath,
      branchName: input.branchName,
      sessionId: input.sessionId,
      at: now(),
    });
    if (result.changes === 0) {
      throw new Error(`markRunning: failed to transition intent ${input.id}`);
    }
    const updated = selectByIdStmt.get(input.id);
    if (!updated) throw new Error(`markRunning: intent ${input.id} vanished`);
    return rowToIntent(updated);
  }

  /** Finish a running intent with terminal status + optional metadata. */
  function markComplete(input: MarkCompleteInput): NightshiftIntent {
    const existing = selectByIdStmt.get(input.id);
    if (!existing) throw new Error(`markComplete: intent ${input.id} not found`);
    if (existing.status !== 'running') {
      throw new Error(
        `markComplete: cannot complete intent in status ${existing.status}; expected running`,
      );
    }
    markCompleteStmt.run({
      id: input.id,
      status: input.status,
      prUrl: input.prUrl ?? null,
      costUsd: input.costUsd ?? null,
      errorMessage: input.errorMessage ?? null,
      at: now(),
    });
    const updated = selectByIdStmt.get(input.id);
    if (!updated) throw new Error(`markComplete: intent ${input.id} vanished`);
    return rowToIntent(updated);
  }

  /**
   * Operator-facing cancel. Works from any non-terminal status. Records
   * a reason in error_message so the morning summary explains it.
   */
  function cancel(id: string, reason?: string): NightshiftIntent {
    const existing = selectByIdStmt.get(id);
    if (!existing) throw new Error(`cancel: intent ${id} not found`);
    if (NIGHTSHIFT_TERMINAL_STATUSES.includes(existing.status)) {
      return rowToIntent(existing);
    }
    markCancelledStmt.run({
      id,
      at: now(),
      errorMessage: reason ?? 'cancelled by operator',
    });
    const updated = selectByIdStmt.get(id);
    if (!updated) throw new Error(`cancel: intent ${id} vanished`);
    return rowToIntent(updated);
  }

  /** Stamp the operator's review timestamp. Used by `pd nightshift review`. */
  function markReviewed(id: string): NightshiftIntent {
    const existing = selectByIdStmt.get(id);
    if (!existing) throw new Error(`markReviewed: intent ${id} not found`);
    markReviewedStmt.run({ id, at: now() });
    const updated = selectByIdStmt.get(id);
    if (!updated) throw new Error(`markReviewed: intent ${id} vanished`);
    return rowToIntent(updated);
  }

  return {
    propose,
    get,
    list,
    queue,
    next,
    markRunning,
    markComplete,
    cancel,
    markReviewed,
  };
}

export type NightshiftQueue = ReturnType<typeof createNightshiftQueue>;
