/**
 * Dispatch Queue — operator drops a sentence-shaped goal; the daemon routes it
 * to a worker, the worker produces a PR, the operator (or a reviewer) signs off.
 *
 * Renamed from `nightshift` (PR #143). The verb changed because the use-case
 * generalized: "queue work for autonomous execution" is not exclusively an
 * overnight cron pattern. The legacy `pd nightshift` CLI noun stays as an
 * alias for one minor version so cron jobs and zsh history keep working.
 *
 * The 8-state machine — adopted from ADR-0035 with operator-facing names that
 * read top-to-bottom on `pd morning`:
 *
 *   proposed       -- operator dropped a goal; not yet ready to claim
 *   claimed        -- a worker actor has claimed the work (lease attached)
 *   in_progress    -- the worker is actively making progress (notes flowing)
 *   produced       -- the worker has produced a PR (or branch) but no review yet
 *   review_pending -- waiting for `pd review --accept|--reject`
 *   accepted       -- operator accepted; harbormaster (or operator) will merge
 *   rejected       -- operator rejected; PR closes, salvage flag is set
 *   settled        -- terminal good state; merged or otherwise resolved
 *
 *   failed         -- terminal bad state (hard crash, budget exhaustion, etc.)
 *   salvage        -- terminal: rejected dispatches end here; salvage tooling
 *                     can re-route the goal as a new dispatch
 *
 * Transitions are explicit and one-way (no back-edges) except for two:
 *   - `proposed` may be `cancelled` (alias for `salvage` with an operator
 *     reason) at any time before `claimed`.
 *   - The full transition table is enforced by lib/dispatch/state-machine.ts.
 *
 * NOTE: This state machine deliberately diverges from the wording in ADR-0035
 * (pending/routed/claimed/executing/review_ready/human_review_ready/
 * human_approved/closed). The operator chose the synonym set above as the
 * one that reads naturally on `pd morning`. PR #99 (the ADR-0035 owner) will
 * reconcile the ADR text once this PR lands.
 *
 * Migration of legacy `nightshift_intents` rows (PR #143) happens at
 * createDispatchQueue() startup -- see migrateNightshiftIntents().
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type DispatchState =
  | 'proposed'
  | 'claimed'
  | 'in_progress'
  | 'produced'
  | 'review_pending'
  | 'accepted'
  | 'rejected'
  | 'settled'
  | 'failed'
  | 'salvage';

export type MergePolicy = 'review' | 'auto' | 'never';

/**
 * The backends a dispatch may target. Widened (ADR-0060 fold-in) to the full
 * cli-tube roster. Kept in sync with `DispatchBackend` in ./runner.ts, which is
 * the canonical definition; queue.ts redeclares it here only because runner.ts
 * imports from queue.ts (importing the other direction would cycle). The DB
 * column is free-form `backend TEXT` (no CHECK constraint), so widening the
 * type is purely a compile-time change.
 */
export type DispatchBackend =
  | 'cli:claude-code'
  | 'cli:codex'
  | 'cli:agy'
  | 'cli:gemini'
  | 'cli:groq'
  | 'cli:grok';

/** States from which no further state changes are allowed. */
export const DISPATCH_TERMINAL_STATES: DispatchState[] = [
  'settled',
  'failed',
  'salvage',
];

/** Subset of terminal states that count as "operator already handled". */
export const DISPATCH_RESOLVED_STATES: DispatchState[] = ['settled', 'salvage'];

export interface Dispatch {
  id: string;
  slug: string;
  /** The operator's original goal text. (Was `intent` in nightshift.) */
  goal: string;
  tags: string[];
  state: DispatchState;
  /** Operator who proposed it. `'operator'` is the default for CLI proposals. */
  requestedBy: string;
  /** Actor (if any) targeted at propose time. NULL = auto-route or operator picks later. */
  targetActorId: string | null;
  /** Actor that claimed the work. Filled at claim time. */
  workerActorId: string | null;
  /** Actor (or 'operator') responsible for accept/reject. */
  reviewerActorId: string | null;
  /** Branch the worktree was carved from. Default: 'main'. */
  baseBranch: string;
  backend: DispatchBackend | null;
  budgetUsd: number | null;
  timeoutMs: number | null;
  worktreePath: string | null;
  /** The branch the worker pushes work to. (Was `branch_name` in nightshift.) */
  branch: string | null;
  sessionId: string | null;
  /** Usually a PR ref; arbitrary string for non-PR artifacts. (Was `pr_url`.) */
  resultArtifact: string | null;
  costUsd: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  /** review|auto|never. 'review' is the default and the only safe choice today. */
  mergePolicy: MergePolicy;
  /** Operator's reason on `pd review --reject`. Null until rejected. */
  rejectReason: string | null;
  createdAt: number;
  claimedAt: number | null;
  startedAt: number | null;
  producedAt: number | null;
  reviewedAt: number | null;
  settledAt: number | null;
}

export interface ProposeDispatchInput {
  goal: string;
  tags?: string[];
  backend?: DispatchBackend;
  budgetUsd?: number;
  timeoutMs?: number;
  /** Default: 'main'. The branch the worktree is carved from. */
  baseBranch?: string;
  /** Skip `proposed` and land directly in `claimed` (operator opt-in). */
  autoClaim?: boolean;
  /** Targeted actor at propose time (optional -- auto-routing not yet wired). */
  targetActorId?: string;
  /** Reviewer actor -- defaults to 'operator' (operator reviews via `pd review`). */
  reviewerActorId?: string;
  /** review|auto|never. Default: 'review'. */
  mergePolicy?: MergePolicy;
  /** Who proposed this. Defaults to 'operator'. */
  requestedBy?: string;
}

export interface MaterializeDispatchProjectionInput extends ProposeDispatchInput {
  /** Stable projection id derived from the WorkIntent append. */
  id: string;
  /** Preserve WorkIntent capture time in the compatibility row when available. */
  createdAt?: number;
}

export interface ListDispatchesOptions {
  state?: DispatchState | 'all' | 'open' | 'terminal' | 'awaiting_review';
  limit?: number;
  since?: number;
}

export interface ClaimDispatchInput {
  id: string;
  worktreePath: string;
  branch: string;
  sessionId: string;
  workerActorId?: string;
}

export interface ProduceDispatchInput {
  id: string;
  resultArtifact?: string | null;
  costUsd?: number | null;
}

export interface SettleDispatchInput {
  id: string;
  state: 'settled' | 'failed' | 'salvage';
  resultArtifact?: string | null;
  costUsd?: number | null;
  errorMessage?: string | null;
}

export interface AcceptDispatchInput {
  id: string;
  /** Operator acknowledgement note. */
  note?: string;
}

export interface RejectDispatchInput {
  id: string;
  /** Required. Surfaces in `pd morning` so the operator can re-route. */
  reason: string;
}

export interface DispatchQueueDeps {
  db: Database.Database;
  /** Injectable clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

interface DispatchRow {
  id: string;
  slug: string;
  goal: string;
  tags_json: string;
  state: DispatchState;
  requested_by: string;
  target_actor_id: string | null;
  worker_actor_id: string | null;
  reviewer_actor_id: string | null;
  base_branch: string;
  backend: string | null;
  budget_usd: number | null;
  timeout_ms: number | null;
  worktree_path: string | null;
  branch: string | null;
  session_id: string | null;
  result_artifact: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error_message: string | null;
  merge_policy: MergePolicy;
  reject_reason: string | null;
  created_at: number;
  claimed_at: number | null;
  started_at: number | null;
  produced_at: number | null;
  reviewed_at: number | null;
  settled_at: number | null;
}

/**
 * `dispatches` table -- ADR-0035 schema, simplified for Phase B:
 *
 *   - No FK to body_leases / actors yet (those tables ship with ADR-0022's
 *     migration 082). The columns store IDs as plain TEXT for now; when the
 *     actor tables land, a follow-up migration adds the FK constraints.
 *   - `dispatch_nonces` (crypto replay defense) is deferred to the
 *     dispatch-crypto ADR; the dispatches table itself does not need it.
 *
 * The 8-state machine + transition table is enforced in code (see
 * lib/dispatch/state-machine.ts). The CHECK constraint here is defence in
 * depth, not the primary gate.
 */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    goal TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL DEFAULT 'proposed'
      CHECK(state IN (
        'proposed','claimed','in_progress','produced','review_pending',
        'accepted','rejected','settled','failed','salvage'
      )),
    requested_by TEXT NOT NULL DEFAULT 'operator',
    target_actor_id TEXT,
    worker_actor_id TEXT,
    reviewer_actor_id TEXT,
    base_branch TEXT NOT NULL DEFAULT 'main',
    backend TEXT,
    budget_usd REAL,
    timeout_ms INTEGER,
    worktree_path TEXT,
    branch TEXT,
    session_id TEXT,
    result_artifact TEXT,
    cost_usd REAL,
    duration_ms INTEGER,
    error_message TEXT,
    merge_policy TEXT NOT NULL DEFAULT 'review'
      CHECK(merge_policy IN ('review','auto','never')),
    reject_reason TEXT,
    created_at INTEGER NOT NULL,
    claimed_at INTEGER,
    started_at INTEGER,
    produced_at INTEGER,
    reviewed_at INTEGER,
    settled_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_dispatches_state
    ON dispatches(state, created_at);
  CREATE INDEX IF NOT EXISTS idx_dispatches_slug ON dispatches(slug);
  CREATE INDEX IF NOT EXISTS idx_dispatches_base_branch
    ON dispatches(base_branch, state);
`;

/**
 * Derive a deterministic url-safe slug from goal text. Same algorithm as
 * nightshift's deriveSlug -- kept identical so existing branches/migrated rows
 * still produce the same slug.
 */
export function deriveSlug(goal: string): string {
  const trimmed = (goal ?? '').toString().trim().toLowerCase();
  if (!trimmed) return 'untitled';
  const cleaned = trimmed
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!cleaned) return 'untitled';
  return cleaned.slice(0, 60).replace(/-+$/, '') || 'untitled';
}

/**
 * Branch name for a dispatch. Format: `dispatch/<slug>-<idShort>`.
 *
 * Note: the legacy nightshift form was `night-shift/<slug>-<idShort>`. Rows
 * migrated from `nightshift_intents` keep their original `night-shift/...`
 * branch values (those branches already exist on remotes). New dispatches
 * get the `dispatch/...` prefix.
 */
export function deriveBranchName(slug: string, id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'noid';
  return `dispatch/${slug}-${safeId}`;
}

function rowToDispatch(row: DispatchRow): Dispatch {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json);
    if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === 'string');
  } catch {
    // Tag corruption is non-fatal.
  }
  return {
    id: row.id,
    slug: row.slug,
    goal: row.goal,
    tags,
    state: row.state,
    requestedBy: row.requested_by,
    targetActorId: row.target_actor_id,
    workerActorId: row.worker_actor_id,
    reviewerActorId: row.reviewer_actor_id,
    baseBranch: row.base_branch,
    backend: (row.backend as Dispatch['backend']) || null,
    budgetUsd: row.budget_usd,
    timeoutMs: row.timeout_ms,
    worktreePath: row.worktree_path,
    branch: row.branch,
    sessionId: row.session_id,
    resultArtifact: row.result_artifact,
    costUsd: row.cost_usd,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    mergePolicy: row.merge_policy,
    rejectReason: row.reject_reason,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    startedAt: row.started_at,
    producedAt: row.produced_at,
    reviewedAt: row.reviewed_at,
    settledAt: row.settled_at,
  };
}

/**
 * If a `nightshift_intents` table exists (from PR #143) and the corresponding
 * row is not already present in `dispatches`, copy the row over with the
 * legacy column -> new column mapping:
 *
 *   intent       -> goal
 *   status       -> state (via legacyStatusToState)
 *   branch_name  -> branch
 *   pr_url       -> result_artifact
 *   queued_at    -> claimed_at        (nightshift had no separate claim step)
 *   completed_at -> settled_at
 *
 * Idempotent: runs on every queue construction; INSERT OR IGNORE means
 * already-migrated rows are untouched.
 */
function migrateNightshiftIntents(db: Database.Database, defaultBaseBranch: string): void {
  const legacy = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nightshift_intents'`,
    )
    .get();
  if (!legacy) return;
  const rows = db
    .prepare(
      `SELECT id, slug, intent, tags_json, status, backend, budget_usd, timeout_ms,
              worktree_path, branch_name, session_id, pr_url, cost_usd, duration_ms,
              error_message, created_at, queued_at, started_at, completed_at, reviewed_at
         FROM nightshift_intents`,
    )
    .all() as Array<{
      id: string;
      slug: string;
      intent: string;
      tags_json: string;
      status: string;
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
    }>;
  if (rows.length === 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO dispatches (
       id, slug, goal, tags_json, state, requested_by, base_branch, backend,
       budget_usd, timeout_ms, worktree_path, branch, session_id,
       result_artifact, cost_usd, duration_ms, error_message,
       merge_policy, created_at, claimed_at, started_at, produced_at,
       reviewed_at, settled_at
     ) VALUES (
       ?, ?, ?, ?, ?, 'operator', ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?, ?,
       'review', ?, ?, ?, ?,
       ?, ?
     )`,
  );
  const txn = db.transaction(() => {
    for (const r of rows) {
      const state = legacyStatusToState(r.status);
      insert.run(
        r.id,
        r.slug,
        r.intent,
        r.tags_json,
        state,
        defaultBaseBranch,
        r.backend,
        r.budget_usd,
        r.timeout_ms,
        r.worktree_path,
        r.branch_name, // keep legacy night-shift/... branch refs
        r.session_id,
        r.pr_url,
        r.cost_usd,
        r.duration_ms,
        r.error_message,
        r.created_at,
        r.queued_at,
        r.started_at,
        r.pr_url ? r.completed_at : null,
        r.reviewed_at,
        r.completed_at,
      );
    }
  });
  txn();
}

/**
 * Map legacy nightshift status to dispatch state. Only used during migration;
 * new code never produces nightshift status strings.
 *
 *   proposed   -> proposed
 *   queued     -> claimed       (lease attached; equivalent step)
 *   running    -> in_progress
 *   succeeded  -> settled
 *   failed     -> failed
 *   aborted    -> failed
 *   timeout    -> failed
 *   cancelled  -> salvage
 */
export function legacyStatusToState(status: string): DispatchState {
  switch (status) {
    case 'proposed': return 'proposed';
    case 'queued': return 'claimed';
    case 'running': return 'in_progress';
    case 'succeeded': return 'settled';
    case 'failed': return 'failed';
    case 'aborted': return 'failed';
    case 'timeout': return 'failed';
    case 'cancelled': return 'salvage';
    default: return 'proposed';
  }
}

export function createDispatchQueue(deps: DispatchQueueDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());

  db.exec(SCHEMA_SQL);
  migrateNightshiftIntents(db, 'main');

  const insertStmt = db.prepare(`
    INSERT INTO dispatches (
      id, slug, goal, tags_json, state, requested_by, target_actor_id,
      reviewer_actor_id, base_branch, backend, budget_usd, timeout_ms,
      merge_policy, created_at, claimed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  const selectByIdStmt = db.prepare<[string], DispatchRow>(
    `SELECT * FROM dispatches WHERE id = ?`,
  );

  const selectBySessionIdStmt = db.prepare<[string], DispatchRow>(
    `SELECT * FROM dispatches WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
  );

  const selectAllStmt = db.prepare<[], DispatchRow>(
    `SELECT * FROM dispatches ORDER BY created_at DESC`,
  );

  const selectByStateStmt = db.prepare<[string], DispatchRow>(
    `SELECT * FROM dispatches WHERE state = ? ORDER BY created_at DESC`,
  );

  const selectOpenStmt = db.prepare<[], DispatchRow>(
    `SELECT * FROM dispatches
     WHERE state IN ('proposed','claimed','in_progress','produced','review_pending','accepted')
     ORDER BY created_at DESC`,
  );

  const selectTerminalStmt = db.prepare<[], DispatchRow>(
    `SELECT * FROM dispatches
     WHERE state IN ('settled','failed','salvage','rejected')
     ORDER BY created_at DESC`,
  );

  const selectAwaitingReviewStmt = db.prepare<[], DispatchRow>(
    `SELECT * FROM dispatches WHERE state = 'review_pending'
     ORDER BY produced_at ASC, created_at ASC`,
  );

  const selectSinceStmt = db.prepare<[number], DispatchRow>(
    `SELECT * FROM dispatches
     WHERE COALESCE(settled_at, reviewed_at, produced_at, started_at, claimed_at, created_at) >= ?
     ORDER BY created_at DESC`,
  );

  const claimStmt = db.prepare(`
    UPDATE dispatches
       SET state = 'claimed',
           worker_actor_id = COALESCE(?, worker_actor_id),
           worktree_path = ?,
           branch = ?,
           session_id = ?,
           claimed_at = COALESCE(claimed_at, ?)
     WHERE id = ? AND state = 'proposed'
  `);

  const releaseUnboundAutoClaimStmt = db.prepare(`
    UPDATE dispatches
       SET state = 'proposed',
           claimed_at = NULL
     WHERE id = ?
       AND state = 'claimed'
       AND worker_actor_id IS NULL
       AND worktree_path IS NULL
       AND branch IS NULL
       AND session_id IS NULL
       AND started_at IS NULL
  `);

  const startStmt = db.prepare(`
    UPDATE dispatches
       SET state = 'in_progress',
           started_at = COALESCE(started_at, ?)
     WHERE id = ? AND state = 'claimed'
  `);

  const produceStmt = db.prepare(`
    UPDATE dispatches
       SET state = 'produced',
           result_artifact = COALESCE(?, result_artifact),
           cost_usd = COALESCE(?, cost_usd),
           produced_at = ?,
           duration_ms = CASE
             WHEN started_at IS NOT NULL THEN ? - started_at
             ELSE NULL
           END
     WHERE id = ? AND state = 'in_progress'
  `);

  const requestReviewStmt = db.prepare(`
    UPDATE dispatches
       SET state = 'review_pending'
     WHERE id = ? AND state = 'produced'
  `);

  const acceptStmt = db.prepare(`
    UPDATE dispatches
       SET state = 'accepted',
           reviewed_at = ?,
           error_message = ?
     WHERE id = ? AND state = 'review_pending'
  `);

  const rejectStmt = db.prepare(`
    UPDATE dispatches
       SET state = 'rejected',
           reviewed_at = ?,
           reject_reason = ?
     WHERE id = ? AND state = 'review_pending'
  `);

  const settleStmt = db.prepare(`
    UPDATE dispatches
       SET state = ?,
           result_artifact = COALESCE(?, result_artifact),
           cost_usd = COALESCE(?, cost_usd),
           error_message = COALESCE(?, error_message),
           settled_at = ?
     WHERE id = ? AND state NOT IN ('settled','salvage')
  `);

  const nextSelectStmt = db.prepare<[], DispatchRow>(
    `SELECT * FROM dispatches
     WHERE state = 'proposed'
     ORDER BY created_at ASC
     LIMIT 1`,
  );

  const nextSelectByBaseStmt = db.prepare<[string], DispatchRow>(
    `SELECT * FROM dispatches
     WHERE state = 'proposed' AND base_branch = ?
     ORDER BY created_at ASC
     LIMIT 1`,
  );

  // ── Crash-recovery statements ───────────────────────────────────────────────
  // A dispatch left in `claimed` or `in_progress` when the daemon (or CLI
  // foreground run) died is STRANDED: its worker no longer exists, so nothing
  // will ever advance it. On daemon start we either re-queue it (back to
  // `proposed` so the worker picks it up again — safe because the spawn-adapter
  // re-uses or re-creates the worktree idempotently) or mark it `salvage` if it
  // has exhausted its retry budget. The cutoff is age-based: a dispatch claimed
  // within the last few seconds may belong to a worker that is still alive
  // (concurrent daemon startup races), so recovery only touches rows older than
  // a grace window.
  const selectStrandedStmt = db.prepare<[number], DispatchRow>(
    `SELECT * FROM dispatches
     WHERE state IN ('claimed','in_progress')
       AND COALESCE(started_at, claimed_at, created_at) <= ?
     ORDER BY created_at ASC`,
  );

  const requeueStrandedStmt = db.prepare(`
    UPDATE dispatches
       SET state = 'proposed',
           worker_actor_id = NULL,
           session_id = NULL,
           started_at = NULL,
           error_message = ?
     WHERE id = ? AND state IN ('claimed','in_progress')
  `);

  const salvageStrandedStmt = db.prepare(`
    UPDATE dispatches
       SET state = 'salvage',
           error_message = ?,
           settled_at = ?
     WHERE id = ? AND state IN ('claimed','in_progress')
  `);

  function propose(input: ProposeDispatchInput): Dispatch {
    return materializeProjection({ ...input, id: randomUUID() });
  }

  function materializeProjection(input: MaterializeDispatchProjectionInput): Dispatch {
    if (!input.id || typeof input.id !== 'string') {
      throw new Error('materializeProjection: id is required');
    }
    if (!input.goal || typeof input.goal !== 'string') {
      throw new Error('materializeProjection: goal text is required');
    }
    const goalText = input.goal.trim();
    if (goalText.length === 0) {
      throw new Error('materializeProjection: goal text cannot be empty');
    }
    if (goalText.length > 4000) {
      throw new Error('materializeProjection: goal text cannot exceed 4000 chars');
    }
    // 0 is a legitimate "flat-rate backend, no real-dollar bond" budget (BUG 1,
    // 2026-07-14 halt-mandate) — only negative/non-finite is a caller error.
    // clampBudget() (lib/dispatch/runner.ts) still treats 0 as "use the $5
    // default" for display/lineage-ceiling purposes; the Conductor's
    // effectiveBond() is what actually decides whether a real dollar bond is
    // reserved, based on the dispatch's backend, not this stored number.
    if (input.budgetUsd !== undefined && (input.budgetUsd < 0 || !Number.isFinite(input.budgetUsd))) {
      throw new Error('materializeProjection: budgetUsd must be a non-negative number');
    }
    if (input.timeoutMs !== undefined && (input.timeoutMs <= 0 || !Number.isFinite(input.timeoutMs))) {
      throw new Error('materializeProjection: timeoutMs must be a positive number');
    }
    const mergePolicy: MergePolicy = input.mergePolicy ?? 'review';
    // 'auto' is wired: lib/dispatch/auto-merge.ts's sweep merges the PR itself
    // once CI is green, the PR is mergeable, and there are zero unresolved
    // review threads. See that module's header for the full safety gate; this
    // is a DIFFERENT, narrower path than harbormaster.ts's operator-approval
    // ('accepted' state) two-key merge queue, which remains untouched.
    const existing = selectByIdStmt.get(input.id);
    if (existing) return rowToDispatch(existing);
    const at = input.createdAt ?? now();
    const slug = deriveSlug(goalText);
    const tags = Array.isArray(input.tags)
      ? input.tags.filter((t): t is string => typeof t === 'string' && t.length > 0).slice(0, 16)
      : [];
    const state: DispatchState = input.autoClaim ? 'claimed' : 'proposed';
    const baseBranch = (input.baseBranch && input.baseBranch.trim()) || 'main';
    insertStmt.run(
      input.id,
      slug,
      goalText,
      JSON.stringify(tags),
      state,
      input.requestedBy ?? 'operator',
      input.targetActorId ?? null,
      input.reviewerActorId ?? 'operator',
      baseBranch,
      input.backend ?? null,
      input.budgetUsd ?? null,
      input.timeoutMs ?? null,
      mergePolicy,
      at,
      input.autoClaim ? at : null,
    );
    const row = selectByIdStmt.get(input.id);
    if (!row) throw new Error(`materializeProjection: failed to insert dispatch ${input.id}`);
    return rowToDispatch(row);
  }

  function get(id: string): Dispatch | null {
    const row = selectByIdStmt.get(id);
    return row ? rowToDispatch(row) : null;
  }

  /**
   * Find the (most recent) dispatch that ran under a given worker session id.
   * Used by `pd done` to answer "does the session I'm ending have an
   * auto-merge-policy dispatch that needs a scrap+merge+rebuild pass?"
   */
  function getBySessionId(sessionId: string): Dispatch | null {
    const row = selectBySessionIdStmt.get(sessionId);
    return row ? rowToDispatch(row) : null;
  }

  function list(options: ListDispatchesOptions = {}): Dispatch[] {
    const limit = options.limit && options.limit > 0 ? options.limit : 100;
    let rows: DispatchRow[];
    if (options.since !== undefined && Number.isFinite(options.since)) {
      rows = selectSinceStmt.all(options.since);
    } else if (!options.state || options.state === 'all') {
      rows = selectAllStmt.all();
    } else if (options.state === 'open') {
      rows = selectOpenStmt.all();
    } else if (options.state === 'terminal') {
      rows = selectTerminalStmt.all();
    } else if (options.state === 'awaiting_review') {
      rows = selectAwaitingReviewStmt.all();
    } else {
      rows = selectByStateStmt.all(options.state);
    }
    return rows.slice(0, limit).map(rowToDispatch);
  }

  function peekNextProposed(baseBranch?: string): Dispatch | null {
    const row = baseBranch
      ? nextSelectByBaseStmt.get(baseBranch)
      : nextSelectStmt.get();
    return row ? rowToDispatch(row) : null;
  }

  /**
   * Prepare one explicitly selected dispatch for the daemon worker's atomic
   * claim. The purpose of this narrow back-edge is to reconcile
   * `propose --auto-claim` with `dispatch run`: auto-claim creates a claimed
   * placeholder without a worker lease, while the daemon can only attach its
   * real worktree/session lease by claiming a proposed row. The design never
   * releases a row that already names any worker, worktree, branch, or session;
   * such a row (or one already in progress) is returned unchanged as already
   * queued. Review and merge-policy fields are untouched, and `claimed_at` is
   * cleared only for the placeholder so the real worker claim records the
   * authoritative lease time.
   *
   * @param id - Dispatch selected by `pd dispatch run`.
   * @returns The proposed row ready for daemon claim, or the unchanged row when
   *          a real worker already owns it.
   */
  function prepareForRun(id: string): Dispatch {
    const existing = selectByIdStmt.get(id);
    if (!existing) throw new Error(`prepareForRun: dispatch ${id} not found`);
    if (existing.state === 'proposed') return rowToDispatch(existing);
    if (existing.state === 'in_progress') return rowToDispatch(existing);
    if (existing.state !== 'claimed') {
      throw new Error(`prepareForRun: cannot run dispatch in state ${existing.state}`);
    }

    const hasWorkerLease = existing.worker_actor_id !== null
      || existing.worktree_path !== null
      || existing.branch !== null
      || existing.session_id !== null
      || existing.started_at !== null;
    if (hasWorkerLease) return rowToDispatch(existing);

    releaseUnboundAutoClaimStmt.run(id);
    const updated = selectByIdStmt.get(id);
    if (!updated) throw new Error(`prepareForRun: dispatch ${id} vanished`);
    if (updated.state !== 'proposed' && updated.state !== 'claimed' && updated.state !== 'in_progress') {
      throw new Error(`prepareForRun: dispatch ${id} changed to state ${updated.state}`);
    }
    return rowToDispatch(updated);
  }

  function claimProposed(input: ClaimDispatchInput): Dispatch | null {
    const result = claimStmt.run(
      input.workerActorId ?? null,
      input.worktreePath,
      input.branch,
      input.sessionId,
      now(),
      input.id,
    );
    if (result.changes === 0) return null;
    const updated = selectByIdStmt.get(input.id);
    if (!updated) throw new Error(`claim: dispatch ${input.id} vanished`);
    return rowToDispatch(updated);
  }

  function claim(input: ClaimDispatchInput): Dispatch {
    const existing = selectByIdStmt.get(input.id);
    if (!existing) throw new Error(`claim: dispatch ${input.id} not found`);
    if (existing.state === 'claimed') return rowToDispatch(existing);
    if (existing.state !== 'proposed') {
      throw new Error(`claim: cannot claim dispatch in state ${existing.state}`);
    }
    const updated = claimProposed(input);
    if (!updated) {
      throw new Error(`claim: failed to claim dispatch ${input.id}`);
    }
    return updated;
  }

  function nextProposed(
    input: Omit<ClaimDispatchInput, 'id'> & { baseBranch?: string },
  ): Dispatch | null {
    const txn = db.transaction((): Dispatch | null => {
      const row = input.baseBranch
        ? nextSelectByBaseStmt.get(input.baseBranch)
        : nextSelectStmt.get();
      if (!row) return null;
      const result = claimStmt.run(
        input.workerActorId ?? null,
        input.worktreePath,
        input.branch,
        input.sessionId,
        now(),
        row.id,
      );
      if (result.changes === 0) return null;
      const updated = selectByIdStmt.get(row.id);
      return updated ? rowToDispatch(updated) : null;
    });
    return txn();
  }

  function start(id: string): Dispatch {
    const existing = selectByIdStmt.get(id);
    if (!existing) throw new Error(`start: dispatch ${id} not found`);
    if (existing.state === 'in_progress') return rowToDispatch(existing);
    if (existing.state !== 'claimed') {
      throw new Error(`start: cannot start dispatch in state ${existing.state}`);
    }
    startStmt.run(now(), id);
    const updated = selectByIdStmt.get(id);
    if (!updated) throw new Error(`start: dispatch ${id} vanished`);
    return rowToDispatch(updated);
  }

  function produce(input: ProduceDispatchInput): Dispatch {
    const existing = selectByIdStmt.get(input.id);
    if (!existing) throw new Error(`produce: dispatch ${input.id} not found`);
    if (existing.state === 'produced') return rowToDispatch(existing);
    if (existing.state !== 'in_progress') {
      throw new Error(`produce: cannot produce dispatch in state ${existing.state}`);
    }
    const at = now();
    produceStmt.run(
      input.resultArtifact ?? null,
      input.costUsd ?? null,
      at,
      at,
      input.id,
    );
    const updated = selectByIdStmt.get(input.id);
    if (!updated) throw new Error(`produce: dispatch ${input.id} vanished`);
    return rowToDispatch(updated);
  }

  function requestReview(id: string): Dispatch {
    const existing = selectByIdStmt.get(id);
    if (!existing) throw new Error(`requestReview: dispatch ${id} not found`);
    if (existing.state === 'review_pending') return rowToDispatch(existing);
    if (existing.state !== 'produced') {
      throw new Error(`requestReview: cannot request review in state ${existing.state}`);
    }
    requestReviewStmt.run(id);
    const updated = selectByIdStmt.get(id);
    if (!updated) throw new Error(`requestReview: dispatch ${id} vanished`);
    return rowToDispatch(updated);
  }

  function accept(input: AcceptDispatchInput): Dispatch {
    const existing = selectByIdStmt.get(input.id);
    if (!existing) throw new Error(`accept: dispatch ${input.id} not found`);
    if (existing.state === 'accepted') return rowToDispatch(existing);
    if (existing.state !== 'review_pending') {
      throw new Error(`accept: cannot accept dispatch in state ${existing.state}`);
    }
    acceptStmt.run(
      now(),
      input.note ? `accepted: ${input.note}` : null,
      input.id,
    );
    const updated = selectByIdStmt.get(input.id);
    if (!updated) throw new Error(`accept: dispatch ${input.id} vanished`);
    return rowToDispatch(updated);
  }

  function reject(input: RejectDispatchInput): Dispatch {
    if (!input.reason || !input.reason.trim()) {
      throw new Error('reject: reason is required');
    }
    const existing = selectByIdStmt.get(input.id);
    if (!existing) throw new Error(`reject: dispatch ${input.id} not found`);
    if (existing.state === 'rejected') return rowToDispatch(existing);
    if (existing.state !== 'review_pending') {
      throw new Error(`reject: cannot reject dispatch in state ${existing.state}`);
    }
    rejectStmt.run(now(), input.reason.trim(), input.id);
    const updated = selectByIdStmt.get(input.id);
    if (!updated) throw new Error(`reject: dispatch ${input.id} vanished`);
    return rowToDispatch(updated);
  }

  function settle(input: SettleDispatchInput): Dispatch {
    const existing = selectByIdStmt.get(input.id);
    if (!existing) throw new Error(`settle: dispatch ${input.id} not found`);
    if (DISPATCH_RESOLVED_STATES.includes(existing.state)) {
      return rowToDispatch(existing);
    }
    const allowed: DispatchState[] = ['settled', 'failed', 'salvage'];
    if (!allowed.includes(input.state)) {
      throw new Error(`settle: target state must be one of ${allowed.join('|')}`);
    }
    settleStmt.run(
      input.state,
      input.resultArtifact ?? null,
      input.costUsd ?? null,
      input.errorMessage ?? null,
      now(),
      input.id,
    );
    const updated = selectByIdStmt.get(input.id);
    if (!updated) throw new Error(`settle: dispatch ${input.id} vanished`);
    return rowToDispatch(updated);
  }

  function cancel(id: string, reason?: string): Dispatch {
    const existing = selectByIdStmt.get(id);
    if (!existing) throw new Error(`cancel: dispatch ${id} not found`);
    if (DISPATCH_TERMINAL_STATES.includes(existing.state)) {
      return rowToDispatch(existing);
    }
    settleStmt.run(
      'salvage',
      null,
      null,
      reason ?? 'cancelled by operator',
      now(),
      id,
    );
    const updated = selectByIdStmt.get(id);
    if (!updated) throw new Error(`cancel: dispatch ${id} vanished`);
    return rowToDispatch(updated);
  }

  /**
   * Detect dispatches stranded in `claimed`/`in_progress` by a dead worker and
   * resolve each one. Called on daemon start (and could be called periodically).
   *
   * Policy:
   *   - A dispatch re-queued fewer than `maxRequeues` times is reset to
   *     `proposed` (state machine's privileged "back to the front of the queue"
   *     — the worker re-runs it; the spawn-adapter's worktree creation is
   *     idempotent because gitWorktreeAdd re-uses an existing path).
   *   - A dispatch that has already been re-queued `maxRequeues` times is marked
   *     `salvage` (terminal) so it never loops forever; the operator sees it in
   *     `pd dispatch list --state terminal` and can re-propose it.
   *
   * `olderThanMs` is a grace window: rows whose most-recent transition is within
   * this window are skipped (their worker may still be alive — a concurrent
   * daemon startup, or a worker that just claimed). Default 0 = recover all,
   * which is correct on a cold daemon start because no worker can be alive yet.
   *
   * Returns a summary the caller can log.
   */
  function recoverStranded(opts: {
    now?: number;
    olderThanMs?: number;
    maxRequeues?: number;
  } = {}): { requeued: Dispatch[]; salvaged: Dispatch[] } {
    const at = opts.now ?? now();
    const olderThanMs = opts.olderThanMs ?? 0;
    const maxRequeues = opts.maxRequeues ?? 3;
    const cutoff = at - olderThanMs;
    const stranded = selectStrandedStmt.all(cutoff);
    const requeued: Dispatch[] = [];
    const salvaged: Dispatch[] = [];
    const txn = db.transaction(() => {
      for (const row of stranded) {
        // Count prior recovery markers embedded in the error_message trail.
        const priorRequeues = countRecoveryMarkers(row.error_message);
        if (priorRequeues >= maxRequeues) {
          salvageStrandedStmt.run(
            appendRecoveryMarker(
              row.error_message,
              `salvage: stranded in '${row.state}' and exceeded ${maxRequeues} recovery attempts`,
            ),
            at,
            row.id,
          );
          const updated = selectByIdStmt.get(row.id);
          if (updated) salvaged.push(rowToDispatch(updated));
        } else {
          requeueStrandedStmt.run(
            appendRecoveryMarker(
              row.error_message,
              `recovered: re-queued after being stranded in '${row.state}' (attempt ${priorRequeues + 1})`,
            ),
            row.id,
          );
          const updated = selectByIdStmt.get(row.id);
          if (updated) requeued.push(rowToDispatch(updated));
        }
      }
    });
    txn();
    return { requeued, salvaged };
  }

  return {
    propose,
    materializeProjection,
    get,
    getBySessionId,
    list,
    peekNextProposed,
    prepareForRun,
    claimProposed,
    claim,
    nextProposed,
    start,
    produce,
    requestReview,
    accept,
    reject,
    settle,
    cancel,
    recoverStranded,
  };
}

// ── Recovery marker helpers ────────────────────────────────────────────────────
// We track recovery attempts inside error_message rather than adding a column,
// so the migration surface stays zero. The marker is a machine-greppable tag.
const RECOVERY_MARKER = '[pd-recovery]';

export function countRecoveryMarkers(errorMessage: string | null): number {
  if (!errorMessage) return 0;
  let count = 0;
  let idx = errorMessage.indexOf(RECOVERY_MARKER);
  while (idx !== -1) {
    count += 1;
    idx = errorMessage.indexOf(RECOVERY_MARKER, idx + RECOVERY_MARKER.length);
  }
  return count;
}

export function appendRecoveryMarker(errorMessage: string | null, note: string): string {
  const line = `${RECOVERY_MARKER} ${note}`;
  return errorMessage ? `${errorMessage}\n${line}` : line;
}

export type DispatchQueue = ReturnType<typeof createDispatchQueue>;
