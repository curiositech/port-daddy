/**
 * Merge Queue
 *
 * Accepts merge submissions from agents, maintains a priority queue in SQLite,
 * delegates ordering to the active orchestrator plugin, and executes merges
 * through a pluggable MergeExecutor interface (no git operations in this module).
 *
 * Lifecycle: submit -> approve/reject -> order -> execute -> inspect -> merged/failed/reverted
 */

import type Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import type {
  OrchestratorRegistry,
  MergeSubmission,
  MergeDecision,
  MergeQueueEntry,
  MergeSequence,
  MergeFailure,
  MergeStatus,
  RecoveryAction,
  FileClaim,
} from './orchestrator-plugins.js';
import type { GraphEdges, GraphEdgeInput } from './graph-edges.js';
import { locateProjectDir } from './project-locator.js';

// =============================================================================
// Types
// =============================================================================

/** Result of a merge execution -- returned by the MergeExecutor */
export interface MergeResult {
  success: boolean;
  mergeCommit?: string;
  conflictFiles?: string[];
  error?: string;
}

/** Result of a post-merge inspection */
export interface InspectionResult {
  passed: boolean;
  failureType?: MergeFailure['failureType'];
  details?: string;
  violations?: Array<{ rule: string; message: string }>;
}

/**
 * MergeExecutor -- the interface for actual git operations.
 * The merge queue never touches git directly; it delegates to this.
 * This allows tests to mock git and allows different merge strategies.
 */
export interface MergeExecutor {
  /** Merge a branch into the base branch. Returns commit SHA on success. */
  merge(opts: {
    repository: string;
    branch: string;
    baseBranch: string;
    metadata?: Record<string, unknown>;
  }): Promise<MergeResult>;

  /** Revert a merge commit. */
  revert(opts: {
    repository: string;
    mergeCommit: string;
  }): Promise<{ success: boolean; error?: string }>;

  /** Predict conflicts between a branch and base without merging. */
  predictConflicts(opts: {
    repository: string;
    branch: string;
    baseBranch: string;
  }): Promise<{
    hasConflicts: boolean;
    conflictFiles: string[];
    conflictSurface: number;
  }>;

  /** Run post-merge inspection (tests, Arbiter, linting). */
  inspect(opts: {
    repository: string;
    mergeCommit: string;
    metadata?: Record<string, unknown>;
  }): Promise<InspectionResult>;
}

/** Row shape from SQLite */
interface MergeQueueRow {
  id: number;
  agent_id: string;
  session_id: string | null;
  branch: string;
  repository: string;
  base_branch: string;
  claims: string | null;
  conflict_surface: number | null;
  status: string;
  priority: number;
  submitted_at: number;
  merged_at: number | null;
  merge_commit: string | null;
  failure_reason: string | null;
  metadata: string | null;
}

export interface MergeQueueDeps {
  orchestratorRegistry: OrchestratorRegistry;
  executor?: MergeExecutor;
  graphEdges?: GraphEdges;
  activityLog?: {
    log(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
  };
}

/** Conflict prediction result for the API */
export interface ConflictPrediction {
  branchA: string;
  branchB: string;
  hasConflicts: boolean;
  conflictFiles: string[];
  conflictSurface: number;
  sharedClaims: FileClaim[];
}

// =============================================================================
// Helpers
// =============================================================================

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function rowToEntry(row: MergeQueueRow): MergeQueueEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    branch: row.branch,
    repository: row.repository,
    baseBranch: row.base_branch,
    claims: safeJsonParse<FileClaim[]>(row.claims, []),
    conflictSurface: row.conflict_surface ?? 0,
    status: row.status as MergeStatus,
    priority: row.priority,
    submittedAt: row.submitted_at,
    mergedAt: row.merged_at,
    mergeCommit: row.merge_commit,
    failureReason: row.failure_reason,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
  };
}

/**
 * Compute a conflict surface score between two sets of file claims.
 * Score is 0.0 (no overlap) to 1.0 (complete overlap).
 */
function computeClaimOverlap(claimsA: FileClaim[], claimsB: FileClaim[]): number {
  if (claimsA.length === 0 || claimsB.length === 0) return 0;

  const pathsA = new Set(claimsA.map(c => c.path));
  const pathsB = new Set(claimsB.map(c => c.path));

  let overlapCount = 0;
  for (const path of pathsA) {
    if (pathsB.has(path)) overlapCount++;
  }

  const totalUnique = new Set([...pathsA, ...pathsB]).size;
  return totalUnique > 0 ? overlapCount / totalUnique : 0;
}

// =============================================================================
// Merge Queue Factory
// =============================================================================

export function createMergeQueue(db: Database.Database, deps: MergeQueueDeps) {
  const { orchestratorRegistry, executor, graphEdges, activityLog } = deps;
  const events = new EventEmitter();

  // ── Schema ──────────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS merge_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      session_id TEXT,
      branch TEXT NOT NULL,
      repository TEXT NOT NULL,
      base_branch TEXT NOT NULL DEFAULT 'main',
      claims TEXT,
      conflict_surface REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      submitted_at INTEGER NOT NULL,
      merged_at INTEGER,
      merge_commit TEXT,
      failure_reason TEXT,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_merge_queue_status ON merge_queue(status);
    CREATE INDEX IF NOT EXISTS idx_merge_queue_agent ON merge_queue(agent_id);
    CREATE INDEX IF NOT EXISTS idx_merge_queue_repo ON merge_queue(repository);
    CREATE INDEX IF NOT EXISTS idx_merge_queue_submitted ON merge_queue(submitted_at);
  `);

  const stmts = {
    insert: db.prepare(`
      INSERT INTO merge_queue (agent_id, session_id, branch, repository, base_branch, claims, conflict_surface, status, priority, submitted_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getById: db.prepare(`SELECT * FROM merge_queue WHERE id = ?`),
    getByBranch: db.prepare(`SELECT * FROM merge_queue WHERE branch = ? AND repository = ? AND status NOT IN ('merged', 'reverted', 'rejected')`),
    listPending: db.prepare(`SELECT * FROM merge_queue WHERE status IN ('pending', 'approved') ORDER BY priority DESC, submitted_at ASC`),
    listByStatus: db.prepare(`SELECT * FROM merge_queue WHERE status = ? ORDER BY priority DESC, submitted_at ASC`),
    listByRepo: db.prepare(`SELECT * FROM merge_queue WHERE repository = ? ORDER BY submitted_at DESC`),
    listAll: db.prepare(`SELECT * FROM merge_queue ORDER BY submitted_at DESC LIMIT ?`),
    updateStatus: db.prepare(`UPDATE merge_queue SET status = ? WHERE id = ?`),
    updateMerged: db.prepare(`UPDATE merge_queue SET status = 'merged', merged_at = ?, merge_commit = ? WHERE id = ?`),
    updateFailed: db.prepare(`UPDATE merge_queue SET status = 'failed', failure_reason = ? WHERE id = ?`),
    updateReverted: db.prepare(`UPDATE merge_queue SET status = 'reverted', failure_reason = ? WHERE id = ?`),
    updatePriority: db.prepare(`UPDATE merge_queue SET priority = ? WHERE id = ?`),
    remove: db.prepare(`DELETE FROM merge_queue WHERE id = ?`),
    cleanup: db.prepare(`DELETE FROM merge_queue WHERE status IN ('merged', 'reverted', 'rejected') AND submitted_at < ?`),
    countByStatus: db.prepare(`SELECT status, COUNT(*) as count FROM merge_queue GROUP BY status`),
    listCleanable: db.prepare(`SELECT * FROM merge_queue WHERE status IN ('merged', 'reverted', 'rejected') AND submitted_at < ?`),
  };

  function graphScopeForEntry(id: number): string {
    return `merge:entry:${id}`;
  }

  function syncEntryGraph(entry: MergeQueueEntry | null): void {
    if (!graphEdges || !entry) return;

    const projectDir = locateProjectDir(entry.repository) || entry.repository;
    const scope = graphScopeForEntry(entry.id);
    const edges: GraphEdgeInput[] = [
      {
        scope,
        projectDir,
        sourceType: 'agent',
        sourceId: entry.agentId,
        edgeType: 'submitted_merge',
        targetType: 'merge_entry',
        targetId: String(entry.id),
        metadata: {
          status: entry.status,
          repository: entry.repository,
        },
      },
      {
        scope,
        projectDir,
        sourceType: 'merge_entry',
        sourceId: String(entry.id),
        edgeType: 'branch',
        targetType: 'branch',
        targetId: entry.branch,
        metadata: {
          repository: entry.repository,
          status: entry.status,
        },
      },
      {
        scope,
        projectDir,
        sourceType: 'branch',
        sourceId: entry.branch,
        edgeType: 'targets_base',
        targetType: 'branch',
        targetId: entry.baseBranch,
        metadata: {
          entryId: entry.id,
          repository: entry.repository,
        },
      },
      {
        scope,
        projectDir,
        sourceType: 'branch',
        sourceId: entry.branch,
        edgeType: 'in_repository',
        targetType: 'repository',
        targetId: entry.repository,
        metadata: {
          entryId: entry.id,
          status: entry.status,
        },
      },
      {
        scope,
        projectDir,
        sourceType: 'merge_entry',
        sourceId: String(entry.id),
        edgeType: 'status',
        targetType: 'status',
        targetId: entry.status,
        metadata: {
          branch: entry.branch,
        },
      },
    ];

    if (entry.sessionId) {
      edges.push({
        scope,
        projectDir,
        sourceType: 'merge_entry',
        sourceId: String(entry.id),
        edgeType: 'from_session',
        targetType: 'session',
        targetId: entry.sessionId,
        metadata: {
          agentId: entry.agentId,
        },
      });
    }

    for (const claim of entry.claims) {
      edges.push({
        scope,
        projectDir,
        sourceType: 'branch',
        sourceId: entry.branch,
        edgeType: 'touches',
        targetType: 'file',
        targetId: claim.path,
        metadata: {
          claimType: claim.symbol ? 'symbol' : 'file',
          entryId: entry.id,
          startLine: claim.startLine ?? null,
          endLine: claim.endLine ?? null,
          symbol: claim.symbol ?? null,
        },
      });
    }

    if (entry.mergeCommit) {
      edges.push({
        scope,
        projectDir,
        sourceType: 'merge_entry',
        sourceId: String(entry.id),
        edgeType: 'produced_commit',
        targetType: 'commit',
        targetId: entry.mergeCommit,
        metadata: {
          branch: entry.branch,
          repository: entry.repository,
        },
      });
    }

    graphEdges.replaceScope(scope, edges);
  }

  // ── Submit ──────────────────────────────────────────────────────────────

  async function submit(submission: MergeSubmission): Promise<{
    success: boolean;
    entryId?: number;
    decision: MergeDecision;
    entry?: MergeQueueEntry;
  }> {
    // Check for duplicate (same branch+repo already in queue)
    const existing = stmts.getByBranch.get(submission.branch, submission.repository) as MergeQueueRow | undefined;
    if (existing) {
      return {
        success: false,
        entryId: existing.id,
        decision: {
          approved: false,
          reason: `Branch "${submission.branch}" is already in the merge queue (entry #${existing.id}, status: ${existing.status})`,
        },
      };
    }

    // Compute conflict surface against other pending entries
    const pendingRows = stmts.listPending.all() as MergeQueueRow[];
    let maxConflictSurface = 0;
    for (const row of pendingRows) {
      const existingClaims = safeJsonParse<FileClaim[]>(row.claims, []);
      const overlap = computeClaimOverlap(submission.claims, existingClaims);
      if (overlap > maxConflictSurface) maxConflictSurface = overlap;
    }

    // Ask the orchestrator for a decision
    const decision = await orchestratorRegistry.onMergeSubmitted(submission);

    const status: MergeStatus = decision.approved ? 'approved' : 'rejected';
    const now = Date.now();

    const result = stmts.insert.run(
      submission.agentId,
      submission.sessionId || null,
      submission.branch,
      submission.repository,
      submission.baseBranch || 'main',
      JSON.stringify(submission.claims),
      maxConflictSurface,
      status,
      decision.priority ?? 0,
      now,
      submission.metadata ? JSON.stringify(submission.metadata) : null
    );

    const entryId = Number(result.lastInsertRowid);
    const entry = get(entryId);
    syncEntryGraph(entry);

    activityLog?.log('merge.submitted', {
      details: `Merge submitted: ${submission.branch} -> ${submission.baseBranch || 'main'} (${status})`,
      metadata: {
        entryId,
        agentId: submission.agentId,
        branch: submission.branch,
        repository: submission.repository,
        approved: decision.approved,
        conflictSurface: maxConflictSurface,
      },
    });

    events.emit('submitted', { entryId, decision, submission });

    return { success: decision.approved, entryId, decision, entry: entry || undefined };
  }

  // ── Query ───────────────────────────────────────────────────────────────

  function get(id: number): MergeQueueEntry | null {
    const row = stmts.getById.get(id) as MergeQueueRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  function list(options: {
    status?: MergeStatus;
    repository?: string;
    limit?: number;
  } = {}): MergeQueueEntry[] {
    let rows: MergeQueueRow[];
    if (options.status) {
      rows = stmts.listByStatus.all(options.status) as MergeQueueRow[];
    } else if (options.repository) {
      rows = stmts.listByRepo.all(options.repository) as MergeQueueRow[];
    } else {
      rows = stmts.listAll.all(options.limit ?? 100) as MergeQueueRow[];
    }
    return rows.map(rowToEntry);
  }

  function listPending(): MergeQueueEntry[] {
    return (stmts.listPending.all() as MergeQueueRow[]).map(rowToEntry);
  }

  // ── Ordering ────────────────────────────────────────────────────────────

  async function getOrder(): Promise<MergeSequence> {
    const pending = listPending();
    return orchestratorRegistry.computeMergeOrder(pending);
  }

  async function reorder(): Promise<MergeSequence> {
    const sequence = await getOrder();
    // Update priorities based on computed order
    for (let i = 0; i < sequence.order.length; i++) {
      stmts.updatePriority.run(sequence.order.length - i, sequence.order[i]);
    }
    events.emit('reordered', sequence);
    return sequence;
  }

  // ── Execution ───────────────────────────────────────────────────────────

  async function execute(id: number): Promise<{
    success: boolean;
    mergeCommit?: string;
    error?: string;
    recoveryAction?: RecoveryAction;
  }> {
    const entry = get(id);
    if (!entry) {
      return { success: false, error: `Entry #${id} not found` };
    }
    if (entry.status !== 'pending' && entry.status !== 'approved') {
      return { success: false, error: `Entry #${id} is not pending/approved (status: ${entry.status})` };
    }
    if (!executor) {
      return { success: false, error: 'No MergeExecutor configured -- cannot execute merges' };
    }

    // Mark as merging
    stmts.updateStatus.run('merging', id);
    events.emit('merging', { entryId: id, branch: entry.branch });

    activityLog?.log('merge.executing', {
      details: `Executing merge: ${entry.branch} -> ${entry.baseBranch}`,
      metadata: { entryId: id, agentId: entry.agentId, branch: entry.branch },
    });

    // Execute the merge
    const mergeResult = await executor.merge({
      repository: entry.repository,
      branch: entry.branch,
      baseBranch: entry.baseBranch,
      metadata: entry.metadata,
    });

    if (!mergeResult.success) {
      const failure: MergeFailure = {
        entryId: id,
        agentId: entry.agentId,
        branch: entry.branch,
        repository: entry.repository,
        failureType: 'conflict',
        details: mergeResult.error || 'Merge failed',
      };

      const recovery = await orchestratorRegistry.onMergeFailure(failure);
      await handleRecovery(id, failure, recovery);

      return { success: false, error: mergeResult.error, recoveryAction: recovery };
    }

    // Merge succeeded -- run inspection
    stmts.updateStatus.run('inspecting', id);
    events.emit('inspecting', { entryId: id, mergeCommit: mergeResult.mergeCommit });

    const inspection = await executor.inspect({
      repository: entry.repository,
      mergeCommit: mergeResult.mergeCommit!,
      metadata: entry.metadata,
    });

    if (!inspection.passed) {
      const failure: MergeFailure = {
        entryId: id,
        agentId: entry.agentId,
        branch: entry.branch,
        repository: entry.repository,
        failureType: inspection.failureType || 'inspection_failure',
        details: inspection.details || 'Post-merge inspection failed',
        mergeCommit: mergeResult.mergeCommit,
      };

      const recovery = await orchestratorRegistry.onMergeFailure(failure);
      await handleRecovery(id, failure, recovery);

      return { success: false, error: inspection.details, recoveryAction: recovery };
    }

    // Everything passed
    stmts.updateMerged.run(Date.now(), mergeResult.mergeCommit, id);
    syncEntryGraph(get(id));

    activityLog?.log('merge.completed', {
      details: `Merge completed: ${entry.branch} -> ${entry.baseBranch} (${mergeResult.mergeCommit})`,
      metadata: {
        entryId: id, agentId: entry.agentId, branch: entry.branch,
        mergeCommit: mergeResult.mergeCommit,
      },
    });

    events.emit('merged', { entryId: id, mergeCommit: mergeResult.mergeCommit });
    return { success: true, mergeCommit: mergeResult.mergeCommit };
  }

  // ── Recovery ────────────────────────────────────────────────────────────

  async function handleRecovery(id: number, failure: MergeFailure, recovery: RecoveryAction): Promise<void> {
    switch (recovery.action) {
      case 'revert':
        if (failure.mergeCommit && executor) {
          await executor.revert({ repository: failure.repository, mergeCommit: failure.mergeCommit });
        }
        stmts.updateReverted.run(
          `${failure.failureType}: ${failure.details} (reverted)`,
          id
        );
        syncEntryGraph(get(id));
        activityLog?.log('merge.reverted', {
          details: `Merge reverted: ${failure.branch} -- ${failure.details}`,
          metadata: { entryId: id, agentId: failure.agentId, recovery },
        });
        events.emit('reverted', { entryId: id, failure, recovery });
        break;

      case 'retry':
        stmts.updateStatus.run('pending', id);
        syncEntryGraph(get(id));
        activityLog?.log('merge.retry_scheduled', {
          details: `Merge retry scheduled: ${failure.branch} (after ${recovery.retryAfterMs ?? 0}ms)`,
          metadata: { entryId: id, agentId: failure.agentId, recovery },
        });
        events.emit('retry_scheduled', { entryId: id, failure, recovery });
        break;

      case 'park':
        stmts.updateFailed.run(`Parked: ${failure.details}`, id);
        syncEntryGraph(get(id));
        activityLog?.log('merge.parked', {
          details: `Merge parked: ${failure.branch} -- ${recovery.reason}`,
          metadata: { entryId: id, agentId: failure.agentId, recovery },
        });
        events.emit('parked', { entryId: id, failure, recovery });
        break;

      case 'reassign':
        stmts.updateFailed.run(
          `Reassigned to ${recovery.reassignTo}: ${failure.details}`,
          id
        );
        syncEntryGraph(get(id));
        activityLog?.log('merge.reassigned', {
          details: `Merge reassigned: ${failure.branch} -> agent ${recovery.reassignTo}`,
          metadata: { entryId: id, agentId: failure.agentId, recovery },
        });
        events.emit('reassigned', { entryId: id, failure, recovery });
        break;
    }
  }

  // ── Inspection (standalone) ─────────────────────────────────────────────

  async function inspect(id: number): Promise<InspectionResult> {
    const entry = get(id);
    if (!entry) {
      return { passed: false, failureType: 'inspection_failure', details: `Entry #${id} not found` };
    }
    if (!entry.mergeCommit) {
      return { passed: false, failureType: 'inspection_failure', details: `Entry #${id} has no merge commit` };
    }
    if (!executor) {
      return { passed: false, failureType: 'inspection_failure', details: 'No MergeExecutor configured' };
    }

    return executor.inspect({
      repository: entry.repository,
      mergeCommit: entry.mergeCommit,
      metadata: entry.metadata,
    });
  }

  // ── Conflict Prediction ─────────────────────────────────────────────────

  async function predictConflicts(
    branch: string,
    repository: string,
    baseBranch: string = 'main'
  ): Promise<ConflictPrediction[]> {
    const predictions: ConflictPrediction[] = [];
    const pendingEntries = listPending();

    for (const entry of pendingEntries) {
      if (entry.repository !== repository) continue;

      const sharedClaims: FileClaim[] = [];

      // Executor-based prediction (when available)
      if (executor) {
        try {
          const result = await executor.predictConflicts({
            repository,
            branch: entry.branch,
            baseBranch,
          });
          predictions.push({
            branchA: branch,
            branchB: entry.branch,
            hasConflicts: result.hasConflicts,
            conflictFiles: result.conflictFiles,
            conflictSurface: result.conflictSurface,
            sharedClaims,
          });
        } catch {
          predictions.push({
            branchA: branch,
            branchB: entry.branch,
            hasConflicts: false,
            conflictFiles: [],
            conflictSurface: 0,
            sharedClaims,
          });
        }
      } else {
        predictions.push({
          branchA: branch,
          branchB: entry.branch,
          hasConflicts: false,
          conflictFiles: [],
          conflictSurface: 0,
          sharedClaims,
        });
      }
    }

    return predictions;
  }

  // ── Removal & Cleanup ──────────────────────────────────────────────────

  function remove(id: number): { success: boolean; removed: boolean } {
    const entry = get(id);
    if (!entry) return { success: false, removed: false };
    if (entry.status === 'merging' || entry.status === 'inspecting') {
      return { success: false, removed: false };
    }
    const result = stmts.remove.run(id);
    graphEdges?.replaceScope(graphScopeForEntry(id), []);
    events.emit('removed', { entryId: id });
    return { success: true, removed: result.changes > 0 };
  }

  function cleanup(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): { cleaned: number } {
    const cutoff = Date.now() - olderThanMs;
    const cleanable = stmts.listCleanable.all(cutoff) as MergeQueueRow[];
    const result = stmts.cleanup.run(cutoff);
    for (const row of cleanable) {
      graphEdges?.replaceScope(graphScopeForEntry(row.id), []);
    }
    return { cleaned: result.changes };
  }

  // ── Stats ───────────────────────────────────────────────────────────────

  function stats(): Record<string, number> {
    const rows = stmts.countByStatus.all() as Array<{ status: string; count: number }>;
    const result: Record<string, number> = { total: 0 };
    for (const row of rows) {
      result[row.status] = row.count;
      result.total += row.count;
    }
    return result;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  return {
    submit,
    get,
    list,
    listPending,
    getOrder,
    reorder,
    execute,
    inspect,
    predictConflicts,
    remove,
    cleanup,
    stats,
    on: events.on.bind(events),
  };
}

export type MergeQueue = ReturnType<typeof createMergeQueue>;
