/**
 * Operator Permission Learning
 *
 * HITL permission pattern store. Starts conservative (all 'ask'), records
 * approvals/denials, proposes meta-permissions once 3 consecutive approvals
 * of the same pattern are seen.
 *
 * Design constraints:
 * - Most-specific projectPrefix wins
 * - Default policy: 'ask' (no assumed trust)
 * - 3 consecutive approvals → set suggestedAt (candidate for auto-approve)
 * - Operator must explicitly accept before policy flips to 'auto'
 */

import type { Database } from 'better-sqlite3';

export type PermissionPolicy = 'ask' | 'auto' | 'deny';
export type PermissionKind = 'resurrect' | 'spawn' | 'merge' | 'approve' | string;
export type RecordDecision = 'approved' | 'denied';

export interface PermissionPattern {
  id: number;
  kind: PermissionKind;
  projectPrefix: string;
  backendTier: string | null;
  costRangeCents: string | null;
  policy: PermissionPolicy;
  approvalCount: number;
  denialCount: number;
  suggestedAt: string | null;
  acceptedAt: string | null;
  lastSeenAt: string;
}

// SQLite returns snake_case column names
interface PermissionPatternRow {
  id: number;
  kind: string;
  project_prefix: string;
  backend_tier: string | null;
  cost_range_cents: string | null;
  policy: string;
  approval_count: number;
  denial_count: number;
  suggested_at: string | null;
  accepted_at: string | null;
  last_seen_at: string;
}

export interface MetaPermissionCandidate {
  id: number;
  kind: PermissionKind;
  projectPrefix: string;
  backendTier: string | null;
  approvalCount: number;
  suggestedAt: string;
  message: string;
}

export interface OperatorPermissions {
  /** Check what policy applies for a given kind + identity. Returns 'ask' by default. */
  check(kind: PermissionKind, identityProject: string, estimatedCostUsd: number): PermissionPolicy;

  /** Record an approval or denial. Updates pattern, may set suggestedAt. */
  record(kind: PermissionKind, identityProject: string, costUsd: number, decision: RecordDecision): void;

  /** Accept a suggested meta-permission, flipping its policy to 'auto'. */
  accept(patternId: number): void;

  /** Deny a suggested meta-permission explicitly, resetting suggestedAt. */
  denyMeta(patternId: number): void;

  /** Return all patterns with suggestedAt set but not yet accepted. */
  listCandidates(): MetaPermissionCandidate[];

  /** Return all patterns. */
  list(): PermissionPattern[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS operator_permission_patterns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT NOT NULL,
  project_prefix    TEXT NOT NULL DEFAULT '',
  backend_tier      TEXT,
  cost_range_cents  TEXT,
  policy            TEXT NOT NULL DEFAULT 'ask',
  approval_count    INTEGER NOT NULL DEFAULT 0,
  denial_count      INTEGER NOT NULL DEFAULT 0,
  suggested_at      TEXT,
  accepted_at       TEXT,
  last_seen_at      TEXT NOT NULL
)
`;

const INDEX = `
CREATE INDEX IF NOT EXISTS idx_opp_kind_project
  ON operator_permission_patterns(kind, project_prefix)
`;

function rowToPattern(row: PermissionPatternRow): PermissionPattern {
  return {
    id: row.id,
    kind: row.kind as PermissionKind,
    projectPrefix: row.project_prefix,
    backendTier: row.backend_tier,
    costRangeCents: row.cost_range_cents,
    policy: row.policy as PermissionPolicy,
    approvalCount: row.approval_count,
    denialCount: row.denial_count,
    suggestedAt: row.suggested_at,
    acceptedAt: row.accepted_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function createOperatorPermissions(db: Database): OperatorPermissions {
  db.prepare(SCHEMA).run();
  db.prepare(INDEX).run();

  function check(
    kind: PermissionKind,
    identityProject: string,
    _estimatedCostUsd: number,
  ): PermissionPolicy {
    // Find most-specific matching pattern (longest project_prefix that is a prefix of identityProject)
    const candidates = (db.prepare(`
      SELECT * FROM operator_permission_patterns
      WHERE kind = ? AND ? LIKE (project_prefix || '%')
      ORDER BY length(project_prefix) DESC, id ASC
    `).all(kind, identityProject) as PermissionPatternRow[]).map(rowToPattern);

    if (candidates.length === 0) return 'ask';
    const match = candidates[0];

    // Touch last_seen_at
    db.prepare(
      `UPDATE operator_permission_patterns SET last_seen_at = datetime('now') WHERE id = ?`
    ).run(match.id);

    return match.policy as PermissionPolicy;
  }

  function record(
    kind: PermissionKind,
    identityProject: string,
    _costUsd: number,
    decision: RecordDecision,
  ): void {
    const isApproval = decision === 'approved';

    // Find or create a pattern row for this exact (kind, project_prefix=identityProject)
    // We store by exact project_prefix for learning; check() uses prefix-matching for lookup
    let pattern: PermissionPattern | undefined = (() => {
      const raw = db.prepare(`
        SELECT * FROM operator_permission_patterns
        WHERE kind = ? AND project_prefix = ?
      `).get(kind, identityProject) as PermissionPatternRow | undefined;
      return raw ? rowToPattern(raw) : undefined;
    })();

    if (!pattern) {
      db.prepare(`
        INSERT INTO operator_permission_patterns
          (kind, project_prefix, policy, approval_count, denial_count, last_seen_at)
        VALUES (?, ?, 'ask', 0, 0, datetime('now'))
      `).run(kind, identityProject);
      pattern = rowToPattern(db.prepare(`
        SELECT * FROM operator_permission_patterns
        WHERE kind = ? AND project_prefix = ?
      `).get(kind, identityProject) as PermissionPatternRow) as PermissionPattern;
    }

    if (isApproval) {
      const newApprovalCount = pattern.approvalCount + 1;
      const shouldSuggest = newApprovalCount >= 3 && pattern.acceptedAt === null;

      db.prepare(`
        UPDATE operator_permission_patterns
        SET approval_count = ?,
            last_seen_at = datetime('now'),
            suggested_at = CASE WHEN ? THEN datetime('now') ELSE suggested_at END
        WHERE id = ?
      `).run(newApprovalCount, shouldSuggest ? 1 : 0, pattern.id);
    } else {
      if (pattern.acceptedAt !== null) {
        // Already accepted: only track the denial, don't revoke auto-approval
        db.prepare(`
          UPDATE operator_permission_patterns
          SET denial_count = denial_count + 1,
              last_seen_at = datetime('now')
          WHERE id = ?
        `).run(pattern.id);
      } else {
        // Not yet accepted: reset consecutive approval streak so sequence must restart
        db.prepare(`
          UPDATE operator_permission_patterns
          SET denial_count = denial_count + 1,
              approval_count = 0,
              suggested_at = NULL,
              last_seen_at = datetime('now')
          WHERE id = ?
        `).run(pattern.id);
      }
    }
  }

  function accept(patternId: number): void {
    db.prepare(`
      UPDATE operator_permission_patterns
      SET policy = 'auto', accepted_at = datetime('now')
      WHERE id = ? AND suggested_at IS NOT NULL
    `).run(patternId);
  }

  function denyMeta(patternId: number): void {
    db.prepare(`
      UPDATE operator_permission_patterns
      SET suggested_at = NULL, approval_count = 0
      WHERE id = ?
    `).run(patternId);
  }

  function listCandidates(): MetaPermissionCandidate[] {
    const rows = (db.prepare(`
      SELECT * FROM operator_permission_patterns
      WHERE suggested_at IS NOT NULL AND accepted_at IS NULL
      ORDER BY approval_count DESC
    `).all() as PermissionPatternRow[]).map(rowToPattern);

    return rows.map(r => ({
      id: r.id,
      kind: r.kind,
      projectPrefix: r.projectPrefix,
      backendTier: r.backendTier,
      approvalCount: r.approvalCount,
      suggestedAt: r.suggestedAt!,
      message: `You have approved ${r.approvalCount} ${r.kind} operations for "${r.projectPrefix}". Auto-approve these going forward? [accept/deny]`,
    }));
  }

  function list(): PermissionPattern[] {
    return (db.prepare(
      `SELECT * FROM operator_permission_patterns ORDER BY kind, project_prefix`
    ).all() as PermissionPatternRow[]).map(rowToPattern);
  }

  return { check, record, accept, denyMeta, listCandidates, list };
}
