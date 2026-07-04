/**
 * Fleet HITL proposals — the operator gate before fleet ideas become work.
 *
 * Cloud ships such as Spark and Spider should be free to generate product/build
 * proposals, but they must not spawn a specialist writer until the operator says
 * yes. This store is that durable yes/no queue.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type FleetProposalStatus = 'pending' | 'approved' | 'rejected' | 'dispatched';

export const FLEET_PROPOSAL_STATUSES: readonly FleetProposalStatus[] = [
  'pending',
  'approved',
  'rejected',
  'dispatched',
];

/** Hard cap on undecided proposals — a misbehaving ship must not grow the queue without bound. */
export const MAX_PENDING_FLEET_PROPOSALS = 200;
/** Hard cap on the serialized `context` payload persisted per proposal. */
export const MAX_CONTEXT_JSON_BYTES = 16_384;

/** Input failed validation — HTTP 400. */
export class FleetProposalValidationError extends Error {}
/** No proposal with that id — HTTP 404. */
export class FleetProposalNotFoundError extends Error {}
/** Proposal exists but is in a state that forbids the transition — HTTP 409. */
export class FleetProposalStateError extends Error {}
/** Caller-supplied id collides with an existing proposal — HTTP 409. */
export class FleetProposalDuplicateError extends Error {}
/** Pending queue is at capacity — HTTP 429. */
export class FleetProposalQueueFullError extends Error {}

export interface FleetProposalLink {
  label: string;
  url: string;
}

export interface FleetProposal {
  id: string;
  title: string;
  summary: string;
  proposalMarkdown: string;
  sourceShip: string;
  sourceKind: string;
  sourceRunId: string | null;
  repoFullName: string | null;
  prNumber: number | null;
  targetSpecialist: string | null;
  assignmentType: string;
  dispatchGoal: string | null;
  budgetUsd: number | null;
  baseBranch: string;
  writePolicy: string;
  validationPlan: string | null;
  expectedArtifacts: string[];
  links: FleetProposalLink[];
  context: Record<string, unknown>;
  status: FleetProposalStatus;
  dispatchId: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  createdAt: number;
  updatedAt: number;
  decidedAt: number | null;
  dispatchedAt: number | null;
  availableActions: FleetProposalAction[];
}

export type FleetProposalAction =
  | { id: 'approve'; label: string; method: 'POST'; path: string }
  | { id: 'reject'; label: string; method: 'POST'; path: string; requiresReason: true };

export interface CreateFleetProposalInput {
  id?: string;
  title: string;
  summary?: string;
  proposalMarkdown?: string;
  sourceShip: string;
  sourceKind?: string;
  sourceRunId?: string;
  sourceUrl?: string;
  repoFullName?: string;
  prNumber?: number;
  targetSpecialist?: string;
  assignmentType?: string;
  dispatchGoal?: string;
  budgetUsd?: number;
  suggestedBudgetUsd?: number;
  baseBranch?: string;
  writePolicy?: string;
  validationPlan?: string;
  validationCommand?: string;
  expectedArtifacts?: unknown;
  links?: unknown;
  context?: unknown;
}

export interface ListFleetProposalsOptions {
  status?: FleetProposalStatus | 'all';
  limit?: number;
  sourceShip?: string;
  repoFullName?: string;
  prNumber?: number;
}

export interface DecideFleetProposalInput {
  id: string;
  decidedBy?: string;
  note?: string;
}

export interface MarkFleetProposalDispatchedInput {
  id: string;
  dispatchId: string;
}

export interface FleetProposalStoreDeps {
  db: Database.Database;
  now?: () => number;
}

interface FleetProposalRow {
  id: string;
  title: string;
  summary: string;
  proposal_markdown: string;
  source_ship: string;
  source_kind: string;
  source_run_id: string | null;
  repo_full_name: string | null;
  pr_number: number | null;
  target_specialist: string | null;
  assignment_type: string;
  dispatch_goal: string | null;
  budget_usd: number | null;
  base_branch: string;
  write_policy: string;
  validation_plan: string | null;
  expected_artifacts_json: string;
  links_json: string;
  context_json: string;
  status: FleetProposalStatus;
  dispatch_id: string | null;
  decision_note: string | null;
  decided_by: string | null;
  created_at: number;
  updated_at: number;
  decided_at: number | null;
  dispatched_at: number | null;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS fleet_hitl_proposals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    proposal_markdown TEXT NOT NULL,
    source_ship TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'cloud-fleet',
    source_run_id TEXT,
    repo_full_name TEXT,
    pr_number INTEGER,
    target_specialist TEXT,
    assignment_type TEXT NOT NULL DEFAULT 'specialist-pr',
    dispatch_goal TEXT,
    budget_usd REAL,
    base_branch TEXT NOT NULL DEFAULT 'main',
    write_policy TEXT NOT NULL DEFAULT 'approved-dispatch-only',
    validation_plan TEXT,
    expected_artifacts_json TEXT NOT NULL DEFAULT '[]',
    links_json TEXT NOT NULL DEFAULT '[]',
    context_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','approved','rejected','dispatched')),
    dispatch_id TEXT,
    decision_note TEXT,
    decided_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    decided_at INTEGER,
    dispatched_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_fleet_hitl_proposals_status
    ON fleet_hitl_proposals(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_fleet_hitl_proposals_source_ship
    ON fleet_hitl_proposals(source_ship, created_at);
  CREATE INDEX IF NOT EXISTS idx_fleet_hitl_proposals_pr
    ON fleet_hitl_proposals(repo_full_name, pr_number, created_at);
`;

function cleanString(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, max);
}

function optionalString(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseLinks(value: string): FleetProposalLink[] {
  try {
    return normalizeLinks(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeExpectedArtifacts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 240))
    .slice(0, 24);
}

function normalizeLinks(value: unknown): FleetProposalLink[] {
  if (!Array.isArray(value)) return [];
  const links: FleetProposalLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const url = optionalString(record.url, 2000);
    if (!url) continue;
    links.push({
      label: cleanString(record.label, url, 120),
      url,
    });
    if (links.length >= 16) break;
  }
  return links;
}

function normalizeProposalLinks(input: CreateFleetProposalInput): FleetProposalLink[] {
  const links = normalizeLinks(input.links);
  const sourceUrl = optionalString(input.sourceUrl, 2000);
  if (sourceUrl && !links.some((link) => link.url === sourceUrl)) {
    links.unshift({ label: 'source', url: sourceUrl });
  }
  return links.slice(0, 16);
}

function normalizeContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function availableActions(id: string, status: FleetProposalStatus): FleetProposalAction[] {
  if (status !== 'pending') return [];
  return [
    { id: 'approve', label: 'Approve + assign', method: 'POST', path: `/fleet-proposals/${id}/approve` },
    { id: 'reject', label: 'Reject', method: 'POST', path: `/fleet-proposals/${id}/reject`, requiresReason: true },
  ];
}

function rowToProposal(row: FleetProposalRow): FleetProposal {
  const status = row.status;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    proposalMarkdown: row.proposal_markdown,
    sourceShip: row.source_ship,
    sourceKind: row.source_kind,
    sourceRunId: row.source_run_id,
    repoFullName: row.repo_full_name,
    prNumber: row.pr_number,
    targetSpecialist: row.target_specialist,
    assignmentType: row.assignment_type,
    dispatchGoal: row.dispatch_goal,
    budgetUsd: row.budget_usd,
    baseBranch: row.base_branch,
    writePolicy: row.write_policy,
    validationPlan: row.validation_plan,
    expectedArtifacts: parseStringArray(row.expected_artifacts_json),
    links: parseLinks(row.links_json || '[]'),
    context: parseJsonObject(row.context_json),
    status,
    dispatchId: row.dispatch_id,
    decisionNote: row.decision_note,
    decidedBy: row.decided_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    dispatchedAt: row.dispatched_at,
    availableActions: availableActions(row.id, status),
  };
}

export function buildFleetProposalDispatchGoal(proposal: FleetProposal): string {
  const repo = proposal.repoFullName
    ? `Repo: ${proposal.repoFullName}${proposal.prNumber ? ` PR #${proposal.prNumber}` : ''}`
    : null;
  const artifacts = proposal.expectedArtifacts.length
    ? proposal.expectedArtifacts.map((item) => `- ${item}`).join('\n')
    : '- tested PR\n- validation notes\n- docs or skill updates if the change creates new operator behavior';
  const validation = proposal.validationPlan ?? 'Run focused unit tests plus the smallest integration/build check that proves the proposal.';
  const proposalBody = proposal.proposalMarkdown.slice(0, 1800);
  return [
    'HITL-approved fleet proposal. Build this as a tested PR.',
    '',
    `Title: ${proposal.title}`,
    `Source ship: ${proposal.sourceShip}`,
    repo,
    `Target specialist: ${proposal.targetSpecialist ?? 'auto-route'}`,
    `Write policy: ${proposal.writePolicy}`,
    `Base branch: ${proposal.baseBranch}`,
    '',
    'Summary:',
    proposal.summary,
    '',
    'Validation required:',
    validation,
    '',
    'Expected artifacts:',
    artifacts,
    '',
    'Proposal:',
    proposalBody,
  ]
    .filter((part): part is string => part !== null)
    .join('\n')
    .slice(0, 3900);
}

export function createFleetProposalStore(deps: FleetProposalStoreDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());
  db.exec(SCHEMA_SQL);

  const insertStmt = db.prepare(`
    INSERT INTO fleet_hitl_proposals (
      id, title, summary, proposal_markdown, source_ship, source_kind,
      source_run_id, repo_full_name, pr_number, target_specialist,
      assignment_type, dispatch_goal, budget_usd, base_branch, write_policy,
      validation_plan, expected_artifacts_json, links_json, context_json,
      status, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      'pending', ?, ?
    )
  `);

  const selectByIdStmt = db.prepare<[string], FleetProposalRow>(
    `SELECT * FROM fleet_hitl_proposals WHERE id = ?`,
  );
  const pendingCountStmt = db.prepare<[], { count: number }>(
    `SELECT COUNT(*) AS count FROM fleet_hitl_proposals WHERE status = 'pending'`,
  );
  const approveStmt = db.prepare(`
    UPDATE fleet_hitl_proposals
       SET status = 'approved',
           decision_note = ?,
           decided_by = ?,
           decided_at = ?,
           updated_at = ?
     WHERE id = ? AND status = 'pending'
  `);
  const rejectStmt = db.prepare(`
    UPDATE fleet_hitl_proposals
       SET status = 'rejected',
           decision_note = ?,
           decided_by = ?,
           decided_at = ?,
           updated_at = ?
     WHERE id = ? AND status IN ('pending','approved')
  `);
  const dispatchedStmt = db.prepare(`
    UPDATE fleet_hitl_proposals
       SET status = 'dispatched',
           dispatch_id = ?,
           dispatched_at = ?,
           updated_at = ?
     WHERE id = ? AND status = 'approved'
  `);

  function create(input: CreateFleetProposalInput): FleetProposal {
    const title = cleanString(input.title, '', 180);
    if (!title) throw new FleetProposalValidationError('proposal title is required');
    const sourceShip = cleanString(input.sourceShip, '', 80);
    if (!sourceShip) throw new FleetProposalValidationError('sourceShip is required');
    const summary = cleanString(input.summary, title, 1000);
    const proposalMarkdown = cleanString(input.proposalMarkdown, summary, 12_000);
    const budgetUsd = optionalNumber(input.budgetUsd ?? input.suggestedBudgetUsd);
    if (budgetUsd !== null && budgetUsd <= 0) {
      throw new FleetProposalValidationError('budgetUsd must be a positive number when provided');
    }
    const contextJson = JSON.stringify(normalizeContext(input.context));
    if (contextJson.length > MAX_CONTEXT_JSON_BYTES) {
      throw new FleetProposalValidationError(
        `context too large (${contextJson.length} bytes serialized, max ${MAX_CONTEXT_JSON_BYTES})`,
      );
    }
    if (pendingCount() >= MAX_PENDING_FLEET_PROPOSALS) {
      throw new FleetProposalQueueFullError(
        `pending proposal queue is full (${MAX_PENDING_FLEET_PROPOSALS}); decide existing proposals before submitting more`,
      );
    }
    const prNumber = optionalNumber(input.prNumber);
    const at = now();
    const id = cleanString(input.id, randomUUID(), 160).replace(/[^a-zA-Z0-9:_./-]/g, '-');
    if (selectByIdStmt.get(id)) {
      throw new FleetProposalDuplicateError(`proposal ${id} already exists`);
    }
    insertStmt.run(
      id,
      title,
      summary,
      proposalMarkdown,
      sourceShip,
      cleanString(input.sourceKind, 'cloud-fleet', 80),
      optionalString(input.sourceRunId, 200),
      optionalString(input.repoFullName, 240),
      prNumber,
      optionalString(input.targetSpecialist, 120),
      cleanString(input.assignmentType, 'specialist-pr', 80),
      optionalString(input.dispatchGoal, 3900),
      budgetUsd,
      cleanString(input.baseBranch, 'main', 160),
      cleanString(input.writePolicy, 'approved-dispatch-only', 120),
      optionalString(input.validationPlan ?? input.validationCommand, 2000),
      JSON.stringify(normalizeExpectedArtifacts(input.expectedArtifacts)),
      JSON.stringify(normalizeProposalLinks(input)),
      contextJson,
      at,
      at,
    );
    const row = selectByIdStmt.get(id);
    if (!row) throw new Error(`failed to create fleet proposal ${id}`);
    return rowToProposal(row);
  }

  function get(id: string): FleetProposal | null {
    const row = selectByIdStmt.get(id);
    return row ? rowToProposal(row) : null;
  }

  function list(options: ListFleetProposalsOptions = {}): FleetProposal[] {
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 500) : 100;
    // Filters and LIMIT are pushed into SQL so a large table never gets
    // materialized in memory just to serve a bounded page.
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.status && options.status !== 'all') {
      clauses.push('status = ?');
      params.push(options.status);
    }
    if (options.sourceShip) {
      clauses.push('source_ship = ?');
      params.push(options.sourceShip);
    }
    if (options.repoFullName) {
      clauses.push('repo_full_name = ?');
      params.push(options.repoFullName);
    }
    if (options.prNumber !== undefined) {
      clauses.push('pr_number = ?');
      params.push(options.prNumber);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare<(string | number)[], FleetProposalRow>(
        `SELECT * FROM fleet_hitl_proposals${where} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params, limit);
    return rows.map(rowToProposal);
  }

  function pendingCount(): number {
    return pendingCountStmt.get()?.count ?? 0;
  }

  function requireRow(id: string): FleetProposalRow {
    const row = selectByIdStmt.get(id);
    if (!row) throw new FleetProposalNotFoundError(`proposal ${id} not found`);
    return row;
  }

  function approve(input: DecideFleetProposalInput): FleetProposal {
    const existing = requireRow(input.id);
    if (existing.status === 'approved' || existing.status === 'dispatched') {
      return rowToProposal(existing);
    }
    if (existing.status !== 'pending') {
      throw new FleetProposalStateError(`cannot approve proposal in state ${existing.status}`);
    }
    const at = now();
    const result = approveStmt.run(
      optionalString(input.note, 2000),
      cleanString(input.decidedBy, 'operator', 120),
      at,
      at,
      input.id,
    );
    const updated = requireRow(input.id);
    if (result.changes === 0) {
      // Another writer changed the row between our read and the guarded UPDATE
      // (WHERE status = 'pending'). Never report a non-approved row as approved.
      if (updated.status === 'approved' || updated.status === 'dispatched') {
        return rowToProposal(updated);
      }
      throw new FleetProposalStateError(`cannot approve proposal in state ${updated.status}`);
    }
    return rowToProposal(updated);
  }

  function reject(input: DecideFleetProposalInput): FleetProposal {
    const reason = cleanString(input.note, '', 2000);
    if (reason.length < 3) {
      throw new FleetProposalValidationError('reject requires a reason (>=3 chars)');
    }
    const existing = requireRow(input.id);
    if (existing.status === 'rejected') return rowToProposal(existing);
    if (existing.status === 'dispatched') {
      throw new FleetProposalStateError('cannot reject a proposal after it has been dispatched');
    }
    const at = now();
    const result = rejectStmt.run(
      reason,
      cleanString(input.decidedBy, 'operator', 120),
      at,
      at,
      input.id,
    );
    const updated = requireRow(input.id);
    if (result.changes === 0) {
      if (updated.status === 'rejected') return rowToProposal(updated);
      throw new FleetProposalStateError(`cannot reject proposal in state ${updated.status}`);
    }
    return rowToProposal(updated);
  }

  function markDispatched(input: MarkFleetProposalDispatchedInput): FleetProposal {
    const existing = requireRow(input.id);
    if (existing.status === 'dispatched') return rowToProposal(existing);
    if (existing.status !== 'approved') {
      throw new FleetProposalStateError(`cannot dispatch proposal in state ${existing.status}`);
    }
    const at = now();
    const result = dispatchedStmt.run(input.dispatchId, at, at, input.id);
    const updated = requireRow(input.id);
    if (result.changes === 0) {
      if (updated.status === 'dispatched') return rowToProposal(updated);
      throw new FleetProposalStateError(`cannot dispatch proposal in state ${updated.status}`);
    }
    return rowToProposal(updated);
  }

  return {
    create,
    get,
    list,
    pendingCount,
    approve,
    reject,
    markDispatched,
  };
}

export type FleetProposalStore = ReturnType<typeof createFleetProposalStore>;
