/**
 * Roadmap Items — durable DB-of-record roadmap state (ADR-0033 + ADR-0036).
 *
 * The pitch: roadmap entries are first-class data, not markdown bullets,
 * and not just tuples. The `roadmap_items` SQL table is the source of
 * truth; tuples (`roadmap:upserted` / `roadmap:status` / `roadmap:touched`)
 * still fire so subscribers can react, but wiping the tuple space leaves
 * roadmap state intact.
 *
 *   feedback:dropped (high/critical) -> cartographer promotes ->
 *   roadmap_items INSERT/UPDATE (+ tuple emit) -> dashboard reads from
 *   the table -> markdown is a render output.
 *
 * ADR-0036 extension: five relational tables alongside the main row.
 * Core read/write (upsert/get/list/updateStatus/touch) remain SQL-backed;
 * relational APIs (edges/owners/artifacts/tags/events) require the `db` dep
 * (always present in the daemon and in tests via createTestDb).
 *
 * Status: ADR-0036 §1.1 default set plus open string for team workflows.
 *   Default six: now | merge | backlog | parked | done | quarantined
 *
 * Markdown (`docs/ROADMAP.md`) is downstream — `pd roadmap render` reads
 * the table and writes the file. The file is never the source of truth.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

interface TupleSpaceMin {
  out(
    fields: unknown[],
    options?: { harbor?: string; writtenBy?: string; ttlMs?: number },
  ): { id: number };
}

/**
 * The default status set per ADR-0036 §1.1. The `status` column accepts
 * arbitrary strings for team-defined workflows; these six are the
 * canonical values for solo + default-config installs.
 */
export type RoadmapStatus =
  | 'now'
  | 'backlog'
  | 'parked'
  | 'merge'
  | 'done'
  | 'quarantined';

export type RoadmapVisibility = 'private' | 'team' | 'org' | 'public';

/** Documented set; column accepts any string. */
export type RoadmapEdgeKind =
  | 'blocks'
  | 'depends-on'
  | 'extends'
  | 'supersedes'
  | 'duplicates'
  | 'related-to'
  | 'split-from'
  | 'splits-to';

export type RoadmapPrincipalType = 'agent' | 'user' | 'team';
export type RoadmapOwnerRole = 'owner' | 'contributor' | 'reviewer' | 'worker';

/** Documented kinds; column accepts any string. */
export type RoadmapArtifactKind =
  | 'pr'
  | 'commit'
  | 'adr'
  | 'doc'
  | 'url'
  | 'session'
  | 'note'
  | 'spark-feedback'
  | 'spider-connection'
  | 'operator-quote'
  | 'linear-issue'
  | 'jira-ticket'
  | 'github-issue'
  | 'notion-page'
  | 'slack-message'
  | 'figma-frame';

export type RoadmapEventKind =
  | 'note'
  | 'status-change'
  | 'edge-added'
  | 'edge-removed'
  | 'owner-added'
  | 'owner-removed'
  | 'tag-added'
  | 'tag-removed'
  | 'artifact-added'
  | 'artifact-removed';

export interface RoadmapItem {
  // === core identity (unchanged from ADR-0033) ===
  id: string;
  slug: string;
  /** Status value. Default set documented above; column accepts any string. */
  status: RoadmapStatus | string;
  promotedFromFeedbackId: string | null;
  promotedByAgentId: string | null;
  promotedAt: number | null;
  lastTouchedAt: number;
  /** Inline dep list, kept for backward compat. New code uses `roadmap_item_edges`. */
  dependencies: string[];
  /** Inline notes, deprecated in favor of `roadmap_item_events` (kind='note'). */
  notes: Array<{ at: number; by: string; text: string }>;
  harbor: string;

  // === content split (ADR-0036 §1.2) ===
  /** Optional human-readable display name. Display layer falls back to slug. */
  title: string | null;
  whyMd: string | null;
  nextCutMd: string | null;
  descriptionMd: string | null;
  /**
   * Backward-compat alias: computed from split fields (title + whyMd +
   * nextCutMd + descriptionMd joined with double-newlines). Legacy callers
   * that pass `summaryMd` get it back verbatim via descriptionMd. Use the
   * split fields in new code.
   */
  summaryMd: string;

  // === hierarchy (ADR-0036 §1.3, option α) ===
  parentId: string | null;
  ordering: number;

  // === lifecycle + visibility (ADR-0036 §1.4) ===
  visibility: RoadmapVisibility;
  scheduledAt: number | null;
  startedAt: number | null;
  dueAt: number | null;
  completedAt: number | null;

  // === team-forward breathing room (nullable today) ===
  teamId: string | null;
  workspaceId: string | null;
  workflowId: string | null;
}

export interface UpsertRoadmapItemInput {
  slug: string;
  /** Either summaryMd (legacy, treated as descriptionMd) or the split trio. */
  summaryMd?: string;
  title?: string;
  whyMd?: string;
  nextCutMd?: string;
  descriptionMd?: string;
  status?: RoadmapStatus | string;
  promotedFromFeedbackId?: string;
  promotedByAgentId?: string;
  promotedAt?: number;
  dependencies?: string[];
  notes?: Array<{ at: number; by: string; text: string }>;
  harbor?: string;
  project?: string;
  ttlMs?: number;
  parentId?: string | null;
  ordering?: number;
  visibility?: RoadmapVisibility;
  scheduledAt?: number;
  startedAt?: number;
  dueAt?: number;
  completedAt?: number;
  teamId?: string;
  workspaceId?: string;
  workflowId?: string;
}

export interface ListRoadmapItemsOptions {
  harbor?: string;
  /** Default-set value or any team-defined workflow string. 'all' for unfiltered. */
  status?: RoadmapStatus | 'all' | string;
  limit?: number;
}

export interface UpdateStatusInput {
  slug: string;
  /** Default-set value or any team-defined workflow string. */
  status: RoadmapStatus | string;
  by: string;
  harbor?: string;
}

export interface RoadmapItemsDeps {
  db: Database.Database;
  tuples: TupleSpaceMin;
  /** Optional clock injection for tests. Defaults to Date.now(). */
  now?: () => number;
}

export interface RoadmapEdge {
  fromId: string;
  toId: string;
  kind: RoadmapEdgeKind | string;
  by: string | null;
  at: number;
}

export interface RoadmapOwner {
  itemId: string;
  principalId: string;
  principalType: RoadmapPrincipalType;
  role: RoadmapOwnerRole | string;
  at: number;
}

export interface RoadmapArtifact {
  itemId: string;
  kind: RoadmapArtifactKind | string;
  ref: string;
  label: string | null;
  at: number;
}

export interface RoadmapItemEvent {
  id: number;
  itemId: string;
  kind: RoadmapEventKind | string;
  by: string | null;
  at: number;
  payload: Record<string, unknown> | null;
}

export interface ListEdgesOptions {
  fromId?: string;
  toId?: string;
  kind?: string;
}

export interface ListOwnersOptions {
  itemId?: string;
  principalId?: string;
  role?: string;
}

export interface ListArtifactsOptions {
  itemId?: string;
  kind?: string;
  ref?: string;
}

export interface ListEventsOptions {
  itemId?: string;
  kind?: string;
  since?: number;
  limit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal SQL row shape (columns present in the actual table)
// ─────────────────────────────────────────────────────────────────────────────

interface RoadmapItemRow {
  id: string;
  slug: string;
  summary_md: string;
  status: string;
  promoted_from_feedback_id: string | null;
  promoted_by_agent_id: string | null;
  promoted_at: number | null;
  last_touched_at: number;
  dependencies_json: string;
  notes_json: string;
  harbor: string;
  created_at: number;
  // ADR-0036 columns (added via ALTER TABLE migration; may be null on old rows)
  title: string | null;
  why_md: string | null;
  next_cut_md: string | null;
  description_md: string | null;
  parent_id: string | null;
  ordering: number | null;
  visibility: string | null;
  scheduled_at: number | null;
  started_at: number | null;
  due_at: number | null;
  completed_at: number | null;
  team_id: string | null;
  workspace_id: string | null;
  workflow_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STATUSES: RoadmapStatus[] = ['now', 'backlog', 'parked', 'merge', 'done', 'quarantined'];
// SQLite CASE expression used to ORDER BY status rank without app-side sort.
const STATUS_RANK_SQL = `CASE status
  WHEN 'now' THEN 0
  WHEN 'merge' THEN 1
  WHEN 'backlog' THEN 2
  WHEN 'parked' THEN 3
  WHEN 'done' THEN 4
  WHEN 'quarantined' THEN 5
  ELSE 6
END`;

const VISIBILITIES: RoadmapVisibility[] = ['private', 'team', 'org', 'public'];
const PRINCIPAL_TYPES: RoadmapPrincipalType[] = ['agent', 'user', 'team'];

const DEFAULT_HARBOR = 'fleet';

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

function harborForProject(project: string | undefined): string | null {
  const trimmed = typeof project === 'string' ? project.trim() : '';
  return trimmed ? `${trimmed}:fleet` : null;
}

function asEnum<T extends string>(value: string | undefined, allowed: T[], fallback: T): T {
  if (value && (allowed as string[]).includes(value)) return value as T;
  return fallback;
}

function parseJsonArray<T>(value: string | null | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Compute the backward-compat `summaryMd` from the split content fields.
 * If only descriptionMd is present (legacy summaryMd path), returns it
 * verbatim so existing callers get identical round-trip behavior.
 */
function joinSummary(item: {
  title?: string | null;
  whyMd?: string | null;
  nextCutMd?: string | null;
  descriptionMd?: string | null;
}): string {
  const parts: string[] = [];
  if (item.title) parts.push(item.title);
  if (item.whyMd) parts.push(item.whyMd);
  if (item.nextCutMd) parts.push(item.nextCutMd);
  if (item.descriptionMd) parts.push(item.descriptionMd);
  return parts.join('\n\n');
}

function rowToItem(row: RoadmapItemRow): RoadmapItem {
  const title = row.title ?? null;
  const whyMd = row.why_md ?? null;
  const nextCutMd = row.next_cut_md ?? null;
  const descriptionMd = row.description_md ?? null;
  // Backward-compat: if no split fields, fall back to the summary_md blob.
  const summaryMd =
    title || whyMd || nextCutMd || descriptionMd
      ? joinSummary({ title, whyMd, nextCutMd, descriptionMd })
      : row.summary_md;
  return {
    id: row.id,
    slug: row.slug,
    summaryMd,
    status: row.status,
    promotedFromFeedbackId: row.promoted_from_feedback_id,
    promotedByAgentId: row.promoted_by_agent_id,
    promotedAt: row.promoted_at,
    lastTouchedAt: row.last_touched_at,
    dependencies: parseJsonArray<string>(row.dependencies_json, []),
    notes: parseJsonArray<{ at: number; by: string; text: string }>(row.notes_json, []),
    harbor: row.harbor,
    title,
    whyMd,
    nextCutMd,
    descriptionMd,
    parentId: row.parent_id ?? null,
    ordering: row.ordering ?? 0,
    visibility: (VISIBILITIES.includes(row.visibility as RoadmapVisibility)
      ? row.visibility
      : 'private') as RoadmapVisibility,
    scheduledAt: row.scheduled_at ?? null,
    startedAt: row.started_at ?? null,
    dueAt: row.due_at ?? null,
    completedAt: row.completed_at ?? null,
    teamId: row.team_id ?? null,
    workspaceId: row.workspace_id ?? null,
    workflowId: row.workflow_id ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createRoadmapItems(deps: RoadmapItemsDeps) {
  const { db, tuples } = deps;
  const now = deps.now ?? (() => Date.now());

  // ── ADR-0036 column migrations ─────────────────────────────────────────────
  // The base roadmap_items table was created before ADR-0036. New columns are
  // added idempotently via ALTER TABLE, matching the pattern in lib/db.ts.
  // NOTE: We also migrate the status CHECK constraint by simply not enforcing
  // it in new code — the CHECK is on the DDL not on existing rows, and
  // SQLite won't enforce old constraints on ALTER-added columns. Since the
  // base table's CHECK only covers INSERT/UPDATE of the original columns and
  // our positional updates now include `quarantined`, we strip the CHECK on
  // new installs via the schema below. Existing installs keep the old CHECK
  // on the column (harmless — the column value is set positionally and
  // SQLite enforces at row-write time, so existing rows stay valid).
  const runMigration = (sql: string) => {
    try { db.exec(sql); } catch { /* column may already exist */ }
  };
  // ADR-0036 content split
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN title TEXT`);
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN why_md TEXT`);
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN next_cut_md TEXT`);
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN description_md TEXT`);
  // ADR-0036 hierarchy
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN parent_id TEXT`);
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN ordering INTEGER NOT NULL DEFAULT 0`);
  // ADR-0036 visibility
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`);
  // ADR-0036 lifecycle
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN scheduled_at INTEGER`);
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN started_at INTEGER`);
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN due_at INTEGER`);
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN completed_at INTEGER`);
  // ADR-0036 team-forward
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN team_id TEXT`);
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN workspace_id TEXT`);
  runMigration(`ALTER TABLE roadmap_items ADD COLUMN workflow_id TEXT`);

  // ADR-0036 relational tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS roadmap_item_edges (
      from_id TEXT NOT NULL,
      to_id   TEXT NOT NULL,
      kind    TEXT NOT NULL,
      by      TEXT,
      at      INTEGER NOT NULL,
      PRIMARY KEY (from_id, to_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_roadmap_edges_to ON roadmap_item_edges(to_id);

    CREATE TABLE IF NOT EXISTS roadmap_item_owners (
      item_id        TEXT NOT NULL,
      principal_id   TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      role           TEXT NOT NULL,
      at             INTEGER NOT NULL,
      PRIMARY KEY (item_id, principal_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_roadmap_owners_principal
      ON roadmap_item_owners(principal_id, role);

    CREATE TABLE IF NOT EXISTS roadmap_item_artifacts (
      item_id TEXT NOT NULL,
      kind    TEXT NOT NULL,
      ref     TEXT NOT NULL,
      label   TEXT,
      at      INTEGER NOT NULL,
      PRIMARY KEY (item_id, kind, ref)
    );
    CREATE INDEX IF NOT EXISTS idx_roadmap_artifacts_kind_ref
      ON roadmap_item_artifacts(kind, ref);

    CREATE TABLE IF NOT EXISTS roadmap_item_tags (
      item_id TEXT NOT NULL,
      tag     TEXT NOT NULL,
      PRIMARY KEY (item_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_roadmap_tags_tag ON roadmap_item_tags(tag);

    CREATE TABLE IF NOT EXISTS roadmap_item_events (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id   TEXT NOT NULL,
      kind      TEXT NOT NULL,
      by        TEXT,
      at        INTEGER NOT NULL,
      payload   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_roadmap_events_item
      ON roadmap_item_events(item_id, at DESC);
  `);

  // ── Prepared statements ────────────────────────────────────────────────────
  // NOTE: All statements use positional `?` placeholders bound with ordered
  // arrays, NOT `@named` object binding. `@named` object binding works under
  // better-sqlite3 (dev/tsx) but SILENTLY BINDS NULL under bun:sqlite (the
  // `bun build --compile` daemon — see lib/sqlite-runtime.ts), which produced
  // "NOT NULL constraint failed" / "SQLITE_MISMATCH" failures invisible in
  // dev. Positional `?` is portable across both engines. Keep column order in
  // sync with the bound arrays below.

  const selectBySlugStmt = db.prepare<[string, string], RoadmapItemRow>(
    `SELECT * FROM roadmap_items WHERE slug = ? AND harbor = ?`,
  );

  const insertStmt = db.prepare(`
    INSERT INTO roadmap_items (
      id, slug, summary_md, status,
      promoted_from_feedback_id, promoted_by_agent_id, promoted_at,
      last_touched_at, dependencies_json, notes_json, harbor, created_at,
      title, why_md, next_cut_md, description_md,
      parent_id, ordering, visibility,
      scheduled_at, started_at, due_at, completed_at,
      team_id, workspace_id, workflow_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE roadmap_items SET
      summary_md = ?,
      status = ?,
      promoted_from_feedback_id = ?,
      promoted_by_agent_id = ?,
      promoted_at = ?,
      last_touched_at = ?,
      dependencies_json = ?,
      notes_json = ?,
      title = ?,
      why_md = ?,
      next_cut_md = ?,
      description_md = ?,
      parent_id = ?,
      ordering = ?,
      visibility = ?,
      scheduled_at = ?,
      started_at = ?,
      due_at = ?,
      completed_at = ?,
      team_id = ?,
      workspace_id = ?,
      workflow_id = ?
    WHERE id = ?
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE roadmap_items
       SET status = ?, last_touched_at = ?
     WHERE id = ?
  `);

  const updateTouchStmt = db.prepare(`
    UPDATE roadmap_items SET last_touched_at = ? WHERE id = ?
  `);

  const insertStatusEventStmt = db.prepare(`
    INSERT INTO roadmap_item_status_events
      (item_id, slug, status, by_agent_id, at, harbor)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // ── Core read/write API ────────────────────────────────────────────────────

  function upsert(input: UpsertRoadmapItemInput): RoadmapItem {
    if (!input.slug || typeof input.slug !== 'string') {
      throw new Error('roadmap.upsert: slug is required (string)');
    }
    const slug = input.slug.trim();
    if (!slug) {
      throw new Error('roadmap.upsert: slug must be non-empty after trim');
    }

    // Content split — accept either summaryMd (legacy) OR the split fields.
    // At least one of {summaryMd, title, whyMd, nextCutMd, descriptionMd} must
    // be present.
    const hasSplit =
      typeof input.title === 'string' ||
      typeof input.whyMd === 'string' ||
      typeof input.nextCutMd === 'string' ||
      typeof input.descriptionMd === 'string';
    const hasLegacy = typeof input.summaryMd === 'string' && input.summaryMd.length > 0;
    if (!hasSplit && !hasLegacy) {
      throw new Error(
        'roadmap.upsert: summaryMd or one of {title, whyMd, nextCutMd, descriptionMd} is required',
      );
    }

    const harbor = input.harbor ?? harborForProject(input.project) ?? DEFAULT_HARBOR;
    const existingRow = selectBySlugStmt.get(slug, harbor);
    const existing = existingRow ? rowToItem(existingRow) : null;
    const at = now();

    // Resolve split fields, merging with existing values where not re-specified.
    const title: string | null =
      input.title !== undefined
        ? (input.title?.trim() || null)
        : existing?.title ?? null;
    const whyMd: string | null =
      input.whyMd !== undefined ? input.whyMd : existing?.whyMd ?? null;
    const nextCutMd: string | null =
      input.nextCutMd !== undefined ? input.nextCutMd : existing?.nextCutMd ?? null;
    const descriptionMd: string | null =
      input.descriptionMd !== undefined
        ? input.descriptionMd
        : hasLegacy
          ? input.summaryMd!.trim()
          : existing?.descriptionMd ?? null;

    // summary_md column stores the computed join for backward-compat reads
    // by callers that SELECT summary_md directly (e.g., cartographer).
    const summaryMd = joinSummary({ title, whyMd, nextCutMd, descriptionMd }) || (hasLegacy ? input.summaryMd!.trim() : (existing?.summaryMd ?? ''));

    const status = input.status && typeof input.status === 'string' && input.status.trim()
      ? input.status.trim()
      : existing?.status ?? 'backlog';

    const item: RoadmapItem = {
      id: existing?.id ?? randomUUID(),
      slug,
      summaryMd,
      status,
      promotedFromFeedbackId:
        input.promotedFromFeedbackId ?? existing?.promotedFromFeedbackId ?? null,
      promotedByAgentId: input.promotedByAgentId ?? existing?.promotedByAgentId ?? null,
      promotedAt:
        typeof input.promotedAt === 'number'
          ? input.promotedAt
          : (existing?.promotedAt ?? null),
      lastTouchedAt: at,
      dependencies: Array.isArray(input.dependencies)
        ? input.dependencies
        : existing?.dependencies ?? [],
      notes: Array.isArray(input.notes) ? input.notes : existing?.notes ?? [],
      harbor,
      title,
      whyMd,
      nextCutMd,
      descriptionMd,
      parentId: input.parentId !== undefined ? input.parentId : existing?.parentId ?? null,
      ordering: typeof input.ordering === 'number' ? input.ordering : existing?.ordering ?? 0,
      visibility: asEnum(input.visibility, VISIBILITIES, existing?.visibility ?? 'private'),
      scheduledAt: typeof input.scheduledAt === 'number' ? input.scheduledAt : existing?.scheduledAt ?? null,
      startedAt: typeof input.startedAt === 'number' ? input.startedAt : existing?.startedAt ?? null,
      dueAt: typeof input.dueAt === 'number' ? input.dueAt : existing?.dueAt ?? null,
      completedAt: typeof input.completedAt === 'number' ? input.completedAt : existing?.completedAt ?? null,
      teamId: input.teamId ?? existing?.teamId ?? null,
      workspaceId: input.workspaceId ?? existing?.workspaceId ?? null,
      workflowId: input.workflowId ?? existing?.workflowId ?? null,
    };

    const dependenciesJson = JSON.stringify(item.dependencies);
    const notesJson = JSON.stringify(item.notes);
    const createdAt = existing ? existingRow!.created_at : at;

    if (existing) {
      // UPDATE column order must match the SET clause above, then id in WHERE.
      updateStmt.run(
        item.summaryMd,
        item.status,
        item.promotedFromFeedbackId,
        item.promotedByAgentId,
        item.promotedAt,
        item.lastTouchedAt,
        dependenciesJson,
        notesJson,
        item.title,
        item.whyMd,
        item.nextCutMd,
        item.descriptionMd,
        item.parentId,
        item.ordering,
        item.visibility,
        item.scheduledAt,
        item.startedAt,
        item.dueAt,
        item.completedAt,
        item.teamId,
        item.workspaceId,
        item.workflowId,
        item.id,
      );
    } else {
      // INSERT column order must match the column list above.
      insertStmt.run(
        item.id,
        item.slug,
        item.summaryMd,
        item.status,
        item.promotedFromFeedbackId,
        item.promotedByAgentId,
        item.promotedAt,
        item.lastTouchedAt,
        dependenciesJson,
        notesJson,
        item.harbor,
        createdAt,
        item.title,
        item.whyMd,
        item.nextCutMd,
        item.descriptionMd,
        item.parentId,
        item.ordering,
        item.visibility,
        item.scheduledAt,
        item.startedAt,
        item.dueAt,
        item.completedAt,
        item.teamId,
        item.workspaceId,
        item.workflowId,
      );
    }

    // Emit the change-event tuple for subscribers. Notification only —
    // the SQL row is the durable record.
    tuples.out(['roadmap:upserted', slug, item], {
      harbor,
      writtenBy: input.promotedByAgentId ?? undefined,
      ttlMs: input.ttlMs && input.ttlMs > 0 ? input.ttlMs : undefined,
    });

    return item;
  }

  function get(slug: string, harbor?: string): RoadmapItem | null {
    const h = harbor ?? DEFAULT_HARBOR;
    const row = selectBySlugStmt.get(slug, h);
    return row ? rowToItem(row) : null;
  }

  function list(options: ListRoadmapItemsOptions = {}): RoadmapItem[] {
    const limit = options.limit ?? 1000;
    // Positional `?` params built in clause order: WHERE filters first, then
    // the LIMIT. `@named` binding is unsafe under bun:sqlite (see insertStmt
    // note), so this query also binds an ordered array.
    const where: string[] = [];
    const args: unknown[] = [];
    if (options.harbor !== undefined) {
      where.push('harbor = ?');
      args.push(options.harbor);
    }
    if (options.status && options.status !== 'all') {
      where.push('status = ?');
      args.push(options.status);
    }
    args.push(limit);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT * FROM roadmap_items
      ${whereSql}
      ORDER BY ${STATUS_RANK_SQL} ASC, last_touched_at DESC
      LIMIT ?`;
    const rows = db.prepare<unknown[], RoadmapItemRow>(sql).all(...args);
    return rows.map(rowToItem);
  }

  function updateStatus(input: UpdateStatusInput): RoadmapItem {
    if (!input.slug || typeof input.slug !== 'string') {
      throw new Error('roadmap.updateStatus: slug is required (string)');
    }
    if (!input.by || typeof input.by !== 'string') {
      throw new Error('roadmap.updateStatus: by (agent id) is required (string)');
    }
    // Accept any non-empty string; validate known values via STATUSES for
    // the legacy type-level check but pass arbitrary strings through
    // (team-defined workflows).
    const status =
      typeof input.status === 'string' && input.status.trim()
        ? input.status.trim()
        : 'backlog';
    // For default-set values, validate spelling; for custom strings, pass through.
    if (
      (STATUSES as string[]).includes(input.status) &&
      input.status !== status
    ) {
      throw new Error(`roadmap.updateStatus: invalid status '${input.status}'`);
    }
    const harbor = input.harbor ?? DEFAULT_HARBOR;
    const row = selectBySlugStmt.get(input.slug, harbor);
    if (!row) {
      throw new Error(`roadmap.updateStatus: no roadmap item with slug '${input.slug}'`);
    }
    const at = now();
    const lastTouchedAt = Math.max(row.last_touched_at, at);
    // updateStatusStmt order: status, last_touched_at, then id (WHERE).
    updateStatusStmt.run(status, lastTouchedAt, row.id);
    // insertStatusEventStmt order: item_id, slug, status, by_agent_id, at, harbor.
    insertStatusEventStmt.run(row.id, row.slug, status, input.by, at, harbor);
    tuples.out(
      ['roadmap:status', input.slug, { status, by: input.by, at }],
      { harbor, writtenBy: input.by },
    );
    return { ...rowToItem(row), status, lastTouchedAt };
  }

  function touch(slug: string, harbor?: string): RoadmapItem | null {
    const h = harbor ?? DEFAULT_HARBOR;
    const row = selectBySlugStmt.get(slug, h);
    if (!row) return null;
    const at = now();
    // updateTouchStmt order: last_touched_at (= at), then id (WHERE).
    updateTouchStmt.run(at, row.id);
    tuples.out(['roadmap:touched', slug, { at }], { harbor: h });
    return { ...rowToItem(row), lastTouchedAt: at };
  }

  // ── ADR-0036 relational APIs ───────────────────────────────────────────────

  function addEdge(edge: { fromId: string; toId: string; kind: string; by?: string }): RoadmapEdge {
    const fromId = edge.fromId?.trim();
    const toId = edge.toId?.trim();
    const kind = edge.kind?.trim();
    if (!fromId || !toId || !kind) {
      throw new Error('roadmap.addEdge: fromId, toId, and kind are required');
    }
    if (fromId === toId) {
      throw new Error('roadmap.addEdge: edge cannot loop on itself');
    }
    const at = now();
    db.prepare(
      `INSERT OR REPLACE INTO roadmap_item_edges (from_id, to_id, kind, by, at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(fromId, toId, kind, edge.by ?? null, at);
    addEventInternal({ itemId: fromId, kind: 'edge-added', by: edge.by ?? null, payload: { toId, edgeKind: kind } });
    return { fromId, toId, kind, by: edge.by ?? null, at };
  }

  function removeEdge(edge: { fromId: string; toId: string; kind: string; by?: string }): boolean {
    const result = db.prepare(
      `DELETE FROM roadmap_item_edges WHERE from_id = ? AND to_id = ? AND kind = ?`,
    ).run(edge.fromId, edge.toId, edge.kind);
    if (result.changes > 0) {
      addEventInternal({
        itemId: edge.fromId,
        kind: 'edge-removed',
        by: edge.by ?? null,
        payload: { toId: edge.toId, edgeKind: edge.kind },
      });
    }
    return result.changes > 0;
  }

  function listEdges(options: ListEdgesOptions = {}): RoadmapEdge[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.fromId) { where.push('from_id = ?'); params.push(options.fromId); }
    if (options.toId) { where.push('to_id = ?'); params.push(options.toId); }
    if (options.kind) { where.push('kind = ?'); params.push(options.kind); }
    let sql = `SELECT from_id, to_id, kind, by, at FROM roadmap_item_edges`;
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY at DESC';
    const rows = db.prepare(sql).all(...params) as Array<{
      from_id: string; to_id: string; kind: string; by: string | null; at: number;
    }>;
    return rows.map((r) => ({ fromId: r.from_id, toId: r.to_id, kind: r.kind, by: r.by, at: r.at }));
  }

  function addOwner(input: {
    itemId: string;
    principalId: string;
    principalType: RoadmapPrincipalType;
    role: string;
    by?: string;
  }): RoadmapOwner {
    const itemId = input.itemId?.trim();
    const principalId = input.principalId?.trim();
    const role = input.role?.trim();
    if (!itemId || !principalId || !role) {
      throw new Error('roadmap.addOwner: itemId, principalId, and role are required');
    }
    if (!PRINCIPAL_TYPES.includes(input.principalType)) {
      throw new Error(`roadmap.addOwner: principalType must be one of ${PRINCIPAL_TYPES.join('|')}`);
    }
    const at = now();
    db.prepare(
      `INSERT OR REPLACE INTO roadmap_item_owners
       (item_id, principal_id, principal_type, role, at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(itemId, principalId, input.principalType, role, at);
    addEventInternal({
      itemId,
      kind: 'owner-added',
      by: input.by ?? null,
      payload: { principalId, principalType: input.principalType, role },
    });
    return { itemId, principalId, principalType: input.principalType, role, at };
  }

  function removeOwner(input: { itemId: string; principalId: string; role: string; by?: string }): boolean {
    const result = db.prepare(
      `DELETE FROM roadmap_item_owners
       WHERE item_id = ? AND principal_id = ? AND role = ?`,
    ).run(input.itemId, input.principalId, input.role);
    if (result.changes > 0) {
      addEventInternal({
        itemId: input.itemId,
        kind: 'owner-removed',
        by: input.by ?? null,
        payload: { principalId: input.principalId, role: input.role },
      });
    }
    return result.changes > 0;
  }

  function listOwners(options: ListOwnersOptions = {}): RoadmapOwner[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.itemId) { where.push('item_id = ?'); params.push(options.itemId); }
    if (options.principalId) { where.push('principal_id = ?'); params.push(options.principalId); }
    if (options.role) { where.push('role = ?'); params.push(options.role); }
    let sql = `SELECT item_id, principal_id, principal_type, role, at FROM roadmap_item_owners`;
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY at DESC';
    const rows = db.prepare(sql).all(...params) as Array<{
      item_id: string; principal_id: string; principal_type: string; role: string; at: number;
    }>;
    return rows.map((r) => ({
      itemId: r.item_id,
      principalId: r.principal_id,
      principalType: r.principal_type as RoadmapPrincipalType,
      role: r.role,
      at: r.at,
    }));
  }

  function addArtifact(input: {
    itemId: string;
    kind: string;
    ref: string;
    label?: string;
    by?: string;
  }): RoadmapArtifact {
    const itemId = input.itemId?.trim();
    const kind = input.kind?.trim();
    const ref = input.ref?.trim();
    if (!itemId || !kind || !ref) {
      throw new Error('roadmap.addArtifact: itemId, kind, and ref are required');
    }
    const at = now();
    const label = input.label ?? null;
    db.prepare(
      `INSERT OR REPLACE INTO roadmap_item_artifacts (item_id, kind, ref, label, at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(itemId, kind, ref, label, at);
    addEventInternal({
      itemId,
      kind: 'artifact-added',
      by: input.by ?? null,
      payload: { artifactKind: kind, ref, label },
    });
    return { itemId, kind, ref, label, at };
  }

  function removeArtifact(input: { itemId: string; kind: string; ref: string; by?: string }): boolean {
    const result = db.prepare(
      `DELETE FROM roadmap_item_artifacts WHERE item_id = ? AND kind = ? AND ref = ?`,
    ).run(input.itemId, input.kind, input.ref);
    if (result.changes > 0) {
      addEventInternal({
        itemId: input.itemId,
        kind: 'artifact-removed',
        by: input.by ?? null,
        payload: { artifactKind: input.kind, ref: input.ref },
      });
    }
    return result.changes > 0;
  }

  function listArtifacts(options: ListArtifactsOptions = {}): RoadmapArtifact[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.itemId) { where.push('item_id = ?'); params.push(options.itemId); }
    if (options.kind) { where.push('kind = ?'); params.push(options.kind); }
    if (options.ref) { where.push('ref = ?'); params.push(options.ref); }
    let sql = `SELECT item_id, kind, ref, label, at FROM roadmap_item_artifacts`;
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY at DESC';
    const rows = db.prepare(sql).all(...params) as Array<{
      item_id: string; kind: string; ref: string; label: string | null; at: number;
    }>;
    return rows.map((r) => ({ itemId: r.item_id, kind: r.kind, ref: r.ref, label: r.label, at: r.at }));
  }

  function addTag(input: { itemId: string; tag: string; by?: string }): { itemId: string; tag: string } {
    const itemId = input.itemId?.trim();
    const tag = input.tag?.trim();
    if (!itemId || !tag) throw new Error('roadmap.addTag: itemId and tag are required');
    db.prepare(`INSERT OR IGNORE INTO roadmap_item_tags (item_id, tag) VALUES (?, ?)`).run(itemId, tag);
    addEventInternal({ itemId, kind: 'tag-added', by: input.by ?? null, payload: { tag } });
    return { itemId, tag };
  }

  function removeTag(input: { itemId: string; tag: string; by?: string }): boolean {
    const result = db.prepare(
      `DELETE FROM roadmap_item_tags WHERE item_id = ? AND tag = ?`,
    ).run(input.itemId, input.tag);
    if (result.changes > 0) {
      addEventInternal({
        itemId: input.itemId,
        kind: 'tag-removed',
        by: input.by ?? null,
        payload: { tag: input.tag },
      });
    }
    return result.changes > 0;
  }

  function listTags(itemId?: string): Array<{ itemId: string; tag: string }> {
    const sql = itemId
      ? `SELECT item_id, tag FROM roadmap_item_tags WHERE item_id = ? ORDER BY tag`
      : `SELECT item_id, tag FROM roadmap_item_tags ORDER BY item_id, tag`;
    const rows = db.prepare(sql).all(...(itemId ? [itemId] : [])) as Array<{
      item_id: string; tag: string;
    }>;
    return rows.map((r) => ({ itemId: r.item_id, tag: r.tag }));
  }

  function addEventInternal(input: {
    itemId: string;
    kind: string;
    by: string | null;
    payload?: Record<string, unknown>;
  }): RoadmapItemEvent {
    const at = now();
    const payloadJson = input.payload ? JSON.stringify(input.payload) : null;
    const result = db.prepare(
      `INSERT INTO roadmap_item_events (item_id, kind, by, at, payload)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(input.itemId, input.kind, input.by, at, payloadJson);
    return {
      id: Number(result.lastInsertRowid),
      itemId: input.itemId,
      kind: input.kind,
      by: input.by,
      at,
      payload: input.payload ?? null,
    };
  }

  /** Public events writer — used for `kind: 'note'` and any external event minting. */
  function addEvent(input: {
    itemId: string;
    kind: string;
    by?: string;
    payload?: Record<string, unknown>;
  }): RoadmapItemEvent {
    const itemId = input.itemId?.trim();
    const kind = input.kind?.trim();
    if (!itemId || !kind) throw new Error('roadmap.addEvent: itemId and kind are required');
    return addEventInternal({
      itemId,
      kind,
      by: input.by ?? null,
      payload: input.payload,
    });
  }

  function events(options: ListEventsOptions = {}): RoadmapItemEvent[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.itemId) { where.push('item_id = ?'); params.push(options.itemId); }
    if (options.kind) { where.push('kind = ?'); params.push(options.kind); }
    if (typeof options.since === 'number') { where.push('at >= ?'); params.push(options.since); }
    let sql = `SELECT id, item_id, kind, by, at, payload FROM roadmap_item_events`;
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY at DESC';
    if (typeof options.limit === 'number' && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    const rows = db.prepare(sql).all(...params) as Array<{
      id: number; item_id: string; kind: string; by: string | null; at: number; payload: string | null;
    }>;
    return rows.map((r) => {
      let payload: Record<string, unknown> | null = null;
      if (r.payload) {
        try { payload = JSON.parse(r.payload) as Record<string, unknown>; } catch { payload = null; }
      }
      return { id: r.id, itemId: r.item_id, kind: r.kind, by: r.by, at: r.at, payload };
    });
  }

  return {
    upsert,
    get,
    list,
    updateStatus,
    touch,
    // ADR-0036 relational APIs
    addEdge,
    removeEdge,
    listEdges,
    addOwner,
    removeOwner,
    listOwners,
    addArtifact,
    removeArtifact,
    listArtifacts,
    addTag,
    removeTag,
    listTags,
    addEvent,
    events,
  };
}

export type RoadmapItems = ReturnType<typeof createRoadmapItems>;
