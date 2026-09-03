/**
 * Roadmap Items — durable DB-of-record roadmap state.
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
 * Why a table:
 *   - durable storage that survives tuple wipes / TTL expiry
 *   - cheap UNIQUE(slug, harbor) keeps the slug namespace clean per harbor
 *   - cheap index on (harbor, status) for dashboard / list reads
 *   - an append-only `roadmap_item_status_events` audit trail next door
 *
 * Why still emit tuples:
 *   - existing subscribers (cartographer, dashboard SSE, future actors)
 *     listen to ['roadmap:upserted', '*', '*'] / ['roadmap:status', ...]
 *   - tuples remain the right primitive for "tell me when this changes"
 *   - they're notification-only here, not the durable record
 *
 * Markdown (`docs/ROADMAP.md`) is downstream — `pd roadmap render` reads
 * the table and writes the file. The file is never the source of truth.
 *
 * Status enum: now < merge < backlog < parked < done.
 *
 * Dependencies (ADR-0086 §3, retirement of `dependencies_json`): blocking
 * relations live as `depends_on` edges in `graph_edges` (scope planner:deps,
 * roadmap:item → roadmap:item). The write path here authors those edges and
 * no longer writes the denormalized JSON column; reads derive
 * `item.dependencies` from the edges, UNIONED with any legacy JSON still on
 * the row — the bridge that keeps rows from old replicas correct until the
 * boot backfill in lib/db.ts migrates them (json → edges, column cleared to
 * the '[]' sentinel). The column physically remains for old-replica
 * union-merge compatibility, but it is dead as a source of truth.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createGraphEdges, type GraphEdges } from './graph-edges.js';
import { DEPS_SCOPE, ITEM_TYPE, dependsOnEdge } from './planner-edges.js';

interface TupleSpaceMin {
  out(
    fields: unknown[],
    options?: { harbor?: string; writtenBy?: string; ttlMs?: number },
  ): { id: number };
}

export type RoadmapStatus = 'now' | 'backlog' | 'parked' | 'merge' | 'done';

/**
 * The fixed Jira-style hierarchy ladder (ADR-0086): project > epic >
 * story/bug/chore > task > subtask. Kept as a closed enum so the CHECK
 * constraint in `roadmap_items` and the planner scheduler's ladder validation
 * can never disagree with the TypeScript surface. Migration 085 mirrors this
 * set as a SQLite CHECK constraint.
 */
export type RoadmapKind =
  | 'project'
  | 'epic'
  | 'story'
  | 'task'
  | 'subtask'
  | 'bug'
  | 'chore';

/**
 * One provenance pointer in `source_refs_json`: where a derived roadmap item
 * came from. `path` is repo-relative; `commit` (when known) pins the exact
 * revision of the source document — the doc itself may be deleted by the
 * very PR that lands the item, so the ref is the durable trail back.
 */
export interface RoadmapSourceRef {
  /** Kind of source, e.g. 'doc' for a chomped planning document. */
  type: string;
  /** Repo-relative path of the source. */
  path: string;
  /** Commit SHA of the source at derivation time, when resolvable. */
  commit?: string;
}

export interface RoadmapItem {
  id: string;
  slug: string;
  summaryMd: string;
  status: RoadmapStatus;
  promotedFromFeedbackId: string | null;
  promotedByAgentId: string | null;
  promotedAt: number | null;
  lastTouchedAt: number;
  /**
   * Slugs this item is blocked by. Derived from planner:deps `depends_on`
   * graph edges (∪ any legacy dependencies_json not yet backfilled) —
   * the JSON column is retired as a source of truth (ADR-0086 §3).
   */
  dependencies: string[];
  notes: Array<{ at: number; by: string; text: string }>;
  harbor: string;
  /** Hierarchy rung (ADR-0086 planner column). Defaults to 'task'. */
  kind: RoadmapKind;
  /** Priority 1 (highest) .. 5 (lowest). Defaults to 3. */
  priority: number;
  /** Agent/person the item is assigned to, or null when unassigned. */
  assigneeId: string | null;
  /** Long-form body markdown; `summaryMd` stays the one-line headline. */
  descriptionMd: string | null;
  /** Actual start (epoch ms) — the Gantt's left date anchor when present. */
  startedAt: number | null;
  /** Target finish (epoch ms) — the Gantt's right date anchor when present. */
  dueAt: number | null;
  /** Effort estimate in abstract units — the CPM scheduler's node duration. */
  estimate: number | null;
  /** Free-form label strings (Jira-grade tags). Deduped, order-preserving. */
  tags: string[];
  /** Effort actually spent, in the SAME abstract units as `estimate`. */
  actual: number | null;
  /** Stamped on the status transition into 'done'; cleared on reopen. */
  completedAt: number | null;
  /**
   * Provenance of a derived item: the source documents (+ commit SHA) an
   * ingestion path (e.g. `pd roadmap chomp`) derived this row from, so the
   * item outlives the planning doc that spawned it. Null for hand-made rows.
   */
  sourceRefs: RoadmapSourceRef[] | null;
  /** Soft-delete tombstone (ms). Non-null rows are dead to reads but merge. */
  deletedAt: number | null;
}

export interface UpsertRoadmapItemInput {
  slug: string;
  summaryMd: string;
  status?: RoadmapStatus;
  promotedFromFeedbackId?: string;
  promotedByAgentId?: string;
  promotedAt?: number;
  dependencies?: string[];
  notes?: Array<{ at: number; by: string; text: string }>;
  harbor?: string;
  project?: string;
  ttlMs?: number;
  kind?: RoadmapKind;
  priority?: number;
  assigneeId?: string | null;
  descriptionMd?: string | null;
  startedAt?: number | null;
  dueAt?: number | null;
  estimate?: number | null;
  /** Replaces the stored tag set when provided (pass [] to clear). */
  tags?: string[];
  actual?: number | null;
  /** Provenance refs for derived items. Omit to preserve the existing value. */
  sourceRefs?: RoadmapSourceRef[];
}

export interface ListRoadmapItemsOptions {
  harbor?: string;
  status?: RoadmapStatus | 'all';
  limit?: number;
  /** Only items whose tag set contains this exact tag (json_each match). */
  tag?: string;
}

export interface UpdateStatusInput {
  slug: string;
  status: RoadmapStatus;
  by: string;
  harbor?: string;
}

export interface RoadmapItemsDeps {
  db: Database.Database;
  tuples: TupleSpaceMin;
  /** Optional clock injection for tests. Defaults to Date.now(). */
  now?: () => number;
  /**
   * The graph_edges module the depends_on edges are authored into. Optional
   * because both handles operate on the same SQLite table: when omitted (unit
   * fixtures, the bun smoke), a local instance is created on the same db so
   * dependency truth is NEVER conditional on wiring.
   */
  graphEdges?: GraphEdges;
}

interface RoadmapItemRow {
  id: string;
  slug: string;
  summary_md: string;
  status: RoadmapStatus;
  promoted_from_feedback_id: string | null;
  promoted_by_agent_id: string | null;
  promoted_at: number | null;
  last_touched_at: number;
  dependencies_json: string;
  notes_json: string;
  harbor: string;
  created_at: number;
  kind: string | null;
  priority: number | null;
  assignee_id: string | null;
  description_md: string | null;
  started_at: number | null;
  due_at: number | null;
  estimate: number | null;
  tags_json: string | null;
  actual: number | null;
  completed_at: number | null;
  source_refs_json: string | null;
  deleted_at: number | null;
}

const STATUSES: RoadmapStatus[] = ['now', 'backlog', 'parked', 'merge', 'done'];
// Mirrors the CHECK(kind IN (…)) constraint in lib/db.ts CORE_SCHEMA_SQL;
// enforced app-side because migrated DBs got the column via ALTER (no CHECK).
const KINDS: RoadmapKind[] = ['project', 'epic', 'story', 'task', 'subtask', 'bug', 'chore'];
// SQLite CASE expression used to ORDER BY status rank without app-side sort.
const STATUS_RANK_SQL = `CASE status
  WHEN 'now' THEN 0
  WHEN 'merge' THEN 1
  WHEN 'backlog' THEN 2
  WHEN 'parked' THEN 3
  WHEN 'done' THEN 4
  ELSE 5
END`;

const DEFAULT_HARBOR = 'fleet';

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

type RoadmapNote = { at: number; by: string; text: string };

/** Append-only note merge: existing notes first, new ones after, deduped on (at, by, text). */
function mergeNotes(existing: RoadmapNote[], incoming: RoadmapNote[]): RoadmapNote[] {
  const seen = new Set(existing.map((n) => `${n.at}\x00${n.by}\x00${n.text}`));
  const merged = [...existing];
  for (const note of incoming) {
    const key = `${note.at}\x00${note.by}\x00${note.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(note);
  }
  return merged;
}

/**
 * Clamp a priority to the 1..5 integer band the CHECK constraint enforces.
 *
 * Why clamp instead of throw: priorities arrive from CLI flags, HTTP bodies,
 * and older rows alike — the intent of an out-of-band value ("0", "99") is a
 * strongest/weakest priority, not a request to abort the write, so we saturate
 * to the nearest legal rung and default the absent/garbled case to 3 (middle).
 *
 * @param value - Candidate priority from any caller surface.
 * @returns An integer in [1, 5]; 3 when the input is not a finite number.
 */
function clampPriority(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 3;
  return Math.min(5, Math.max(1, n));
}

/**
 * Sanitize an optional epoch-ms / effort number: finite positive numbers pass
 * through (rounded), everything else collapses to null. The purpose is that
 * schedule math (Gantt anchors, CPM durations) never meets NaN or negative
 * time — absence is an honest null, not a poisoned zero.
 *
 * @param value - Candidate number from any caller surface.
 * @returns The rounded positive number, or null.
 */
function positiveOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/**
 * Normalize a tag list into the canonical stored shape: trimmed, non-empty,
 * order-preserving, and deduped case-sensitively.
 *
 * Why normalize here instead of at each caller: tags arrive from repeatable
 * CLI flags, HTTP arrays, and re-upserts of previously stored rows. One
 * canonical shape at the write boundary is what makes the `?tag=` filter an
 * exact json_each match rather than a fuzzy LIKE — the design intent is that
 * a tag is an identifier, not prose. The 64-tag ceiling bounds row growth so
 * a runaway writer cannot bloat a coordination row into a document store.
 *
 * @param value - Candidate tags from any caller surface.
 * @returns Deduped, trimmed tags (max 64); [] when input is not an array.
 */
function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of value) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 64) break;
  }
  return out;
}

function rowToItem(row: RoadmapItemRow): RoadmapItem {
  return {
    id: row.id,
    slug: row.slug,
    summaryMd: row.summary_md,
    status: row.status,
    promotedFromFeedbackId: row.promoted_from_feedback_id,
    promotedByAgentId: row.promoted_by_agent_id,
    promotedAt: row.promoted_at,
    lastTouchedAt: row.last_touched_at,
    dependencies: parseJsonArray<string>(row.dependencies_json, []),
    notes: parseJsonArray<{ at: number; by: string; text: string }>(row.notes_json, []),
    harbor: row.harbor,
    kind: asEnum(row.kind ?? undefined, KINDS, 'task'),
    priority: clampPriority(row.priority ?? 3),
    assigneeId: row.assignee_id ?? null,
    descriptionMd: row.description_md ?? null,
    startedAt: row.started_at ?? null,
    dueAt: row.due_at ?? null,
    estimate: positiveOrNull(row.estimate),
    tags: normalizeTags(parseJsonArray<string>(row.tags_json, [])),
    actual: positiveOrNull(row.actual),
    completedAt: row.completed_at ?? null,
    sourceRefs: row.source_refs_json
      ? parseJsonArray<RoadmapSourceRef>(row.source_refs_json, [])
      : null,
    deletedAt: row.deleted_at ?? null,
  };
}

export function createRoadmapItems(deps: RoadmapItemsDeps) {
  const { db, tuples } = deps;
  const now = deps.now ?? (() => Date.now());
  // Dependency edges are authored into graph_edges (ADR-0086 §3). Falling back
  // to a local instance is safe because graph_edges is one shared table — the
  // handle is a convenience, not a partition — and createGraphEdges is an
  // idempotent CREATE IF NOT EXISTS.
  const graphEdges = deps.graphEdges ?? createGraphEdges(db);

  const selectBySlugStmt = db.prepare<[string, string], RoadmapItemRow>(
    `SELECT * FROM roadmap_items WHERE slug = ? AND harbor = ?`,
  );
  // depends_on edge reads. Prepared directly (not via graphEdges.list) so the
  // hot list() path can hydrate every item's dependencies in ONE scan instead
  // of an N+1 of per-item list() calls, and so ORDER BY makes reads
  // deterministic.
  const selectDepsForSlugStmt = db.prepare<[string, string, string], { target_id: string }>(
    `SELECT target_id FROM graph_edges
      WHERE scope = ? AND edge_type = 'depends_on' AND source_type = ? AND source_id = ?
      ORDER BY target_id ASC`,
  );
  const selectAllDepsStmt = db.prepare<[string, string], { source_id: string; target_id: string }>(
    `SELECT source_id, target_id FROM graph_edges
      WHERE scope = ? AND edge_type = 'depends_on' AND source_type = ?
      ORDER BY source_id ASC, target_id ASC`,
  );

  /**
   * Merge edge-derived dependencies with any legacy JSON residue into one
   * sorted, deduped list.
   *
   * Why a union: after retirement the edges are the truth, but a row written
   * by an OLD replica (or seeded raw in a fixture) still carries its deps in
   * dependencies_json until the boot backfill clears it. Reading only edges
   * would silently unblock such an item; reading only JSON would ignore the
   * new truth. The union is correct in both regimes because every retired-era
   * write clears the JSON to '[]' — a stale mix cannot occur.
   *
   * @param edgeDeps - target slugs from planner:deps depends_on edges.
   * @param legacyDeps - slugs parsed from the row's dependencies_json.
   * @returns Sorted unique dependency slugs.
   */
  function unionDependencies(edgeDeps: string[], legacyDeps: string[]): string[] {
    return [...new Set([...edgeDeps, ...legacyDeps])].sort();
  }

  /**
   * Hydrate one item's `dependencies` from the edge store (∪ legacy JSON).
   *
   * The design intent is that every read surface returns the SAME dependency
   * truth regardless of which write era produced the row — callers never see
   * the raw JSON column again.
   *
   * @param item - The row-mapped item (dependencies = legacy JSON residue).
   * @returns The item with dependencies replaced by the derived union.
   */
  function hydrateDependencies(item: RoadmapItem): RoadmapItem {
    const edgeDeps = selectDepsForSlugStmt
      .all(DEPS_SCOPE, ITEM_TYPE, item.slug)
      .map((r) => r.target_id);
    return { ...item, dependencies: unionDependencies(edgeDeps, item.dependencies) };
  }

  /**
   * Converge the item's outgoing depends_on edges to `nextDeps` — remember the
   * missing ones, forget the removed ones. The design intent is edge-by-edge
   * authorship (never replaceScope): planner:deps is an authored scope shared
   * by every item, so a wholesale replace from one item's write would destroy
   * every other item's edges. That is exactly WHY the board's derived
   * writePlanEdges no longer touches this scope.
   *
   * @param slug - The dependent item's slug (edge source).
   * @param nextDeps - The complete new dependency set for this item.
   */
  function writeDependencyEdges(slug: string, nextDeps: string[]): void {
    const current = new Set(
      selectDepsForSlugStmt.all(DEPS_SCOPE, ITEM_TYPE, slug).map((r) => r.target_id),
    );
    const next = new Set(nextDeps);
    for (const dep of next) {
      if (!current.has(dep)) graphEdges.remember(dependsOnEdge(slug, dep));
    }
    for (const dep of current) {
      if (!next.has(dep)) {
        const edge = dependsOnEdge(slug, dep);
        graphEdges.forget(edge);
      }
    }
  }
  // NOTE: All statements use positional `?` placeholders bound with ordered
  // arrays, NOT `@named` object binding. `@named` object binding works under
  // better-sqlite3 (dev/tsx) but SILENTLY BINDS NULL under bun:sqlite (the
  // `bun build --compile` daemon — see lib/sqlite-runtime.ts), which produced
  // "NOT NULL constraint failed" / "SQLITE_MISMATCH" failures invisible in
  // dev. Positional `?` is portable across both engines. Keep column order in
  // sync with the bound arrays below.
  // dependencies_json is RETIRED as a write target (ADR-0086 §3): the INSERT
  // leans on the column's DEFAULT '[]' and the UPDATE pins the '[]' sentinel,
  // which doubles as the per-row migration — the first retired-era write of a
  // legacy row moves its deps into graph_edges (writeDependencyEdges) and
  // clears the JSON so the read-bridge union can never resurrect removed deps.
  const insertStmt = db.prepare(`
    INSERT INTO roadmap_items (
      id, slug, summary_md, status,
      promoted_from_feedback_id, promoted_by_agent_id, promoted_at,
      last_touched_at, notes_json, harbor, created_at,
      kind, priority, assignee_id, description_md, started_at, due_at, estimate,
      tags_json, actual, completed_at, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE roadmap_items SET
      summary_md = ?,
      status = ?,
      promoted_from_feedback_id = ?,
      promoted_by_agent_id = ?,
      promoted_at = ?,
      last_touched_at = ?,
      dependencies_json = '[]',
      notes_json = ?,
      kind = ?,
      priority = ?,
      assignee_id = ?,
      description_md = ?,
      started_at = ?,
      due_at = ?,
      estimate = ?,
      tags_json = ?,
      actual = ?,
      completed_at = ?,
      source_refs_json = ?,
      deleted_at = NULL
    WHERE id = ?
  `);
  // Status transitions own the completion stamp: entering 'done' stamps
  // completed_at (idempotently — a done→done re-assert keeps the original
  // stamp), leaving 'done' clears it so a reopened item never claims a
  // completion date it no longer holds.
  const updateStatusStmt = db.prepare(`
    UPDATE roadmap_items
       SET status = ?, last_touched_at = ?, completed_at = ?
     WHERE id = ?
  `);
  const updateTouchStmt = db.prepare(`
    UPDATE roadmap_items SET last_touched_at = ?, notes_json = COALESCE(?, notes_json) WHERE id = ?
  `);
  const insertStatusEventStmt = db.prepare(`
    INSERT INTO roadmap_item_status_events
      (item_id, slug, status, by_agent_id, at, harbor)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function upsert(input: UpsertRoadmapItemInput): RoadmapItem {
    if (!input.slug || typeof input.slug !== 'string') {
      throw new Error('roadmap.upsert: slug is required (string)');
    }
    if (!input.summaryMd || typeof input.summaryMd !== 'string') {
      throw new Error('roadmap.upsert: summaryMd is required (string)');
    }
    const slug = input.slug.trim();
    if (!slug) {
      throw new Error('roadmap.upsert: slug must be non-empty after trim');
    }
    const summaryMd = input.summaryMd.trim();
    if (!summaryMd) {
      throw new Error('roadmap.upsert: summaryMd must be non-empty after trim');
    }
    const harbor = input.harbor ?? harborForProject(input.project) ?? DEFAULT_HARBOR;
    const existingRow = selectBySlugStmt.get(slug, harbor);
    // Hydrate so "preserve when omitted" preserves the EDGE truth (∪ legacy
    // JSON), not just whatever JSON residue the row carries.
    const existing = existingRow ? hydrateDependencies(rowToItem(existingRow)) : null;
    const at = now();

    const item: RoadmapItem = {
      id: existing?.id ?? randomUUID(),
      slug,
      summaryMd,
      status: asEnum(input.status, STATUSES, existing?.status ?? 'backlog'),
      promotedFromFeedbackId:
        input.promotedFromFeedbackId ?? existing?.promotedFromFeedbackId ?? null,
      promotedByAgentId: input.promotedByAgentId ?? existing?.promotedByAgentId ?? null,
      promotedAt:
        typeof input.promotedAt === 'number'
          ? input.promotedAt
          : (existing?.promotedAt ?? null),
      lastTouchedAt: at,
      // Dependencies land in graph_edges (writeDependencyEdges below), not in
      // the retired JSON column. Provided input REPLACES the set ([] clears);
      // omission preserves the hydrated edge truth.
      dependencies: Array.isArray(input.dependencies)
        ? [...new Set(input.dependencies.map((d) => (typeof d === 'string' ? d.trim() : '')).filter(Boolean))].sort()
        : existing?.dependencies ?? [],
      // Notes are APPEND-ONLY across upserts: an upsert that hits an existing
      // row merges its notes onto the existing list instead of replacing it.
      // Replacing was silent data loss — any caller that didn't first fetch
      // the row (e.g. a slug collision it never anticipated) wiped all prior
      // notes. Dedupe on the (at, by, text) triple keeps retries idempotent.
      notes: Array.isArray(input.notes)
        ? mergeNotes(existing?.notes ?? [], input.notes)
        : existing?.notes ?? [],
      harbor,
      // Planner columns (ADR-0086): an upsert that omits a field PRESERVES the
      // existing value — partial writers (promote, import, touch-adjacent
      // upserts) must never silently strip sizing/assignment another surface
      // recorded. Explicit null clears (assignee/description/dates/estimate).
      kind: input.kind !== undefined ? asEnum(input.kind, KINDS, 'task') : existing?.kind ?? 'task',
      priority:
        input.priority !== undefined ? clampPriority(input.priority) : existing?.priority ?? 3,
      assigneeId:
        input.assigneeId !== undefined
          ? (typeof input.assigneeId === 'string' && input.assigneeId.trim()
              ? input.assigneeId.trim()
              : null)
          : existing?.assigneeId ?? null,
      descriptionMd:
        input.descriptionMd !== undefined
          ? (typeof input.descriptionMd === 'string' && input.descriptionMd.trim()
              ? input.descriptionMd
              : null)
          : existing?.descriptionMd ?? null,
      startedAt:
        input.startedAt !== undefined ? positiveOrNull(input.startedAt) : existing?.startedAt ?? null,
      dueAt: input.dueAt !== undefined ? positiveOrNull(input.dueAt) : existing?.dueAt ?? null,
      estimate:
        input.estimate !== undefined ? positiveOrNull(input.estimate) : existing?.estimate ?? null,
      // Jira-grade fields (2026-08-22 mandate): tags replace-when-provided
      // (like dependencies — [] clears); actual follows the estimate rules so
      // planned-vs-actual stays a same-unit comparison.
      tags: input.tags !== undefined ? normalizeTags(input.tags) : existing?.tags ?? [],
      actual: input.actual !== undefined ? positiveOrNull(input.actual) : existing?.actual ?? null,
      // The completion stamp tracks the effective status of THIS write: an
      // upsert that lands (or keeps) the item in 'done' stamps/keeps
      // completed_at; any other status clears it (a reopened item holds no
      // completion date). updateStatus() applies the same rule.
      completedAt: null, // provisional; derived below once status is final
      // Provenance is preserved on partial upserts for the same reason the
      // planner columns are: a writer that never knew about `sourceRefs` must
      // not erase the trail back to the doc this item was chomped from.
      sourceRefs: Array.isArray(input.sourceRefs)
        ? input.sourceRefs
        : (existing?.sourceRefs ?? null),
      // An upsert asserts the item lives: it always clears any tombstone
      // (resurrection), mirrored by `deleted_at = NULL` in updateStmt.
      deletedAt: null,
    };
    item.completedAt = item.status === 'done' ? existing?.completedAt ?? at : null;

    const notesJson = JSON.stringify(item.notes);
    const tagsJson = JSON.stringify(item.tags);
    const sourceRefsJson = item.sourceRefs ? JSON.stringify(item.sourceRefs) : null;
    const createdAt = existing ? existingRow!.created_at : at;

    if (existing) {
      // UPDATE column order (18 SET placeholders + id in the WHERE clause,
      // 19 binds): summary_md, status, promoted_from_feedback_id,
      // promoted_by_agent_id, promoted_at, last_touched_at, notes_json, kind,
      // priority, assignee_id, description_md, started_at, due_at, estimate,
      // tags_json, actual, completed_at, source_refs_json, then id.
      // (dependencies_json is pinned to the retired '[]' sentinel and
      // deleted_at to NULL in the SQL — literals, neither one bound.)
      updateStmt.run(
        item.summaryMd,
        item.status,
        item.promotedFromFeedbackId,
        item.promotedByAgentId,
        item.promotedAt,
        item.lastTouchedAt,
        notesJson,
        item.kind,
        item.priority,
        item.assigneeId,
        item.descriptionMd,
        item.startedAt,
        item.dueAt,
        item.estimate,
        tagsJson,
        item.actual,
        item.completedAt,
        sourceRefsJson,
        item.id,
      );
    } else {
      // INSERT column order (22 columns, 22 placeholders, 22 binds): id, slug,
      // summary_md, status, promoted_from_feedback_id, promoted_by_agent_id,
      // promoted_at, last_touched_at, notes_json, harbor, created_at, kind,
      // priority, assignee_id, description_md, started_at, due_at, estimate,
      // tags_json, actual, completed_at, source_refs_json.
      // (dependencies_json rides its DEFAULT '[]' — the column is retired.)
      insertStmt.run(
        item.id,
        item.slug,
        item.summaryMd,
        item.status,
        item.promotedFromFeedbackId,
        item.promotedByAgentId,
        item.promotedAt,
        item.lastTouchedAt,
        notesJson,
        item.harbor,
        createdAt,
        item.kind,
        item.priority,
        item.assigneeId,
        item.descriptionMd,
        item.startedAt,
        item.dueAt,
        item.estimate,
        tagsJson,
        item.actual,
        item.completedAt,
        sourceRefsJson,
      );
    }

    // Converge this item's outgoing depends_on edges to the effective set.
    // After the row write, so a constraint failure above never half-applies
    // the relation change.
    writeDependencyEdges(item.slug, item.dependencies);

    // Emit the change-event tuple for subscribers. Notification only —
    // the row is the durable record.
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
    if (!row || row.deleted_at != null) return null;
    return hydrateDependencies(rowToItem(row));
  }

  const slugExistsStmt = db.prepare<[string], { one: number }>(
    `SELECT 1 AS one FROM roadmap_items WHERE slug = ? AND deleted_at IS NULL LIMIT 1`,
  );

  /**
   * Exact existence check across ALL harbors. Rent-at-claim slug validation
   * uses this instead of scanning a capped list() — a LIMIT'd list silently
   * rejects valid slugs once the table outgrows the cap.
   */
  function slugExists(slug: string): boolean {
    return slugExistsStmt.get(slug) != null;
  }

  function list(options: ListRoadmapItemsOptions = {}): RoadmapItem[] {
    const limit = options.limit ?? 1000;
    // Positional `?` params built in clause order: WHERE filters first, then
    // the LIMIT. `@named` binding is unsafe under bun:sqlite (see insertStmt
    // note), so this query also binds an ordered array.
    // Tombstoned rows are dead to every read surface; they exist only so
    // union-merge reconciliation can propagate the deletion.
    const where: string[] = ['deleted_at IS NULL'];
    const args: unknown[] = [];
    if (options.harbor !== undefined) {
      where.push('harbor = ?');
      args.push(options.harbor);
    }
    if (options.status && options.status !== 'all') {
      where.push('status = ?');
      args.push(options.status);
    }
    if (options.tag !== undefined && options.tag.trim()) {
      // Exact-match tag filter via json_each over the stored JSON array —
      // tags are identifiers, so `?tag=relay` must not match 'relay-v2'
      // (which a LIKE '%relay%' shortcut would).
      where.push(`EXISTS (
        SELECT 1 FROM json_each(roadmap_items.tags_json) WHERE json_each.value = ?
      )`);
      args.push(options.tag.trim());
    }
    args.push(limit);
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const sql = `SELECT * FROM roadmap_items
      ${whereSql}
      ORDER BY ${STATUS_RANK_SQL} ASC, last_touched_at DESC
      LIMIT ?`;
    const rows = db.prepare<unknown[], RoadmapItemRow>(sql).all(...args);
    // Batched dependency hydration: ONE scan of the planner:deps scope keyed
    // by source slug, instead of a per-item edge query (N+1) on the hot path.
    const edgesBySlug = new Map<string, string[]>();
    for (const edge of selectAllDepsStmt.all(DEPS_SCOPE, ITEM_TYPE)) {
      const arr = edgesBySlug.get(edge.source_id) ?? [];
      arr.push(edge.target_id);
      edgesBySlug.set(edge.source_id, arr);
    }
    return rows.map((row) => {
      const item = rowToItem(row);
      return {
        ...item,
        dependencies: unionDependencies(edgesBySlug.get(item.slug) ?? [], item.dependencies),
      };
    });
  }

  function updateStatus(input: UpdateStatusInput): RoadmapItem {
    if (!input.slug || typeof input.slug !== 'string') {
      throw new Error('roadmap.updateStatus: slug is required (string)');
    }
    if (!input.by || typeof input.by !== 'string') {
      throw new Error('roadmap.updateStatus: by (agent id) is required (string)');
    }
    const status = asEnum(input.status, STATUSES, 'backlog');
    if (input.status && input.status !== status) {
      throw new Error(`roadmap.updateStatus: invalid status '${input.status}'`);
    }
    const harbor = input.harbor ?? DEFAULT_HARBOR;
    const row = selectBySlugStmt.get(input.slug, harbor);
    if (!row || row.deleted_at != null) {
      throw new Error(`roadmap.updateStatus: no roadmap item with slug '${input.slug}'`);
    }
    const at = now();
    const lastTouchedAt = Math.max(row.last_touched_at, at);
    // Completion stamp (Jira-grade time tracking): entering 'done' stamps
    // completed_at once (a done→done re-assert keeps the first stamp);
    // any transition out of 'done' clears it.
    const completedAt = status === 'done' ? row.completed_at ?? at : null;
    // updateStatusStmt order: status, last_touched_at, completed_at, then id (WHERE).
    updateStatusStmt.run(status, lastTouchedAt, completedAt, row.id);
    // insertStatusEventStmt order: item_id, slug, status, by_agent_id, at, harbor.
    insertStatusEventStmt.run(row.id, row.slug, status, input.by, at, harbor);
    tuples.out(
      ['roadmap:status', input.slug, { status, by: input.by, at }],
      { harbor, writtenBy: input.by },
    );
    return { ...hydrateDependencies(rowToItem(row)), status, lastTouchedAt, completedAt };
  }

  const listDependentsStmt = db.prepare(
    `SELECT * FROM roadmap_items r
      WHERE r.deleted_at IS NULL AND r.harbor = ?
        AND (
          EXISTS (
            SELECT 1 FROM graph_edges e
            WHERE e.scope = ? AND e.edge_type = 'depends_on'
              AND e.source_type = ? AND e.source_id = r.slug AND e.target_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM json_each(r.dependencies_json)
            WHERE json_each.value = ?
          )
        )
      ORDER BY r.slug ASC`,
  );

  /**
   * List the LIVE items that depend on `slug` — the reverse of the
   * `dependencies` array — within one harbor.
   *
   * Why this exists: the Jira-card detail read must answer both directions of
   * the blocking relation. `dependencies` (the planner:deps `depends_on`
   * edges) answers "what blocks me"; this query answers "what do I block" by
   * walking the same edges in reverse, UNIONED with any legacy
   * dependencies_json residue not yet backfilled — the same bridge every
   * other read uses, so both directions agree in every write era. Exact
   * matches only (a dependency on 'relay' never matches 'relay-v2').
   *
   * @param slug - The dependency slug being blocked on.
   * @param harbor - Harbor scope (defaults to the fleet harbor).
   * @returns Live dependent items, slug-ordered for deterministic reads.
   */
  function listDependents(slug: string, harbor?: string): RoadmapItem[] {
    const h = harbor ?? DEFAULT_HARBOR;
    const rows = listDependentsStmt.all(h, DEPS_SCOPE, ITEM_TYPE, slug, slug) as RoadmapItemRow[];
    return rows.map((row) => hydrateDependencies(rowToItem(row)));
  }

  /**
   * Append one already-authorized receipt without resending a stale item.
   * The immediate transaction serializes note merges; only notes and the
   * touch timestamp change, never summary, ownership, status, or graph edges.
   * @param slug - Exact existing item; a missing/deleted item is never created.
   * @param harbor - Exact item namespace, not an identity credential realm.
   * @param note - Optional trusted note; HTTP callers must pass owner checks.
   * @returns Current item, or null; replaying an exact note is a complete no-op.
   */
  function touch(slug: string, harbor?: string, note?: RoadmapItem['notes'][number]): RoadmapItem | null {
    return db.transaction(() => {
      const h = harbor ?? DEFAULT_HARBOR;
      const row = selectBySlugStmt.get(slug, h);
      if (!row || row.deleted_at != null) return null;
      // Other read projections tolerate malformed JSON. A writer cannot do
      // that: replacing damaged history with [] would silently destroy it.
      let storedNotes: unknown;
      try { storedNotes = JSON.parse(row.notes_json); } catch { throw new Error('ROADMAP_HISTORY_INVALID'); }
      if (!Array.isArray(storedNotes) || storedNotes.some((entry) => !entry || typeof entry !== 'object'
        || !Number.isSafeInteger(entry.at) || entry.at < 0 || typeof entry.by !== 'string' || typeof entry.text !== 'string')) {
        throw new Error('ROADMAP_HISTORY_INVALID');
      }
      const item = hydrateDependencies(rowToItem(row));
      const notes = note ? mergeNotes(item.notes, [note]) : item.notes;
      // A retry must not manufacture newer freshness from an old receipt.
      if (note && notes.length === item.notes.length) return item;
      const serverNow = now();
      if (note && (!Number.isSafeInteger(note.at) || note.at <= 0 || note.at > serverNow)) {
        throw new Error('ROADMAP_NOTE_CLOCK_INVALID');
      }
      const at = Math.max(row.last_touched_at, serverNow);
      updateTouchStmt.run(at, note ? JSON.stringify(notes) : null, row.id);
      tuples.out(['roadmap:touched', slug, { at }], { harbor: h });
      return { ...item, notes, lastTouchedAt: at };
    }).immediate();
  }

  const tombstoneItemStmt = db.prepare(`
    UPDATE roadmap_items SET deleted_at = ?, last_touched_at = ? WHERE id = ?
  `);

  /**
   * Remove a roadmap item — as a SOFT DELETE tombstone, never a hard DELETE.
   *
   * The registry is a multi-replica system (durable home, instance shards,
   * committed snapshot, backups) reconciled by union-merge; a hard delete in
   * one replica silently resurrects from any replica that still carries the
   * row. Setting `deleted_at` and bumping `last_touched_at` makes the
   * deletion itself the newest write, so last-write-wins reconciliation
   * propagates it. The append-only status-event audit rows are PRESERVED —
   * the tombstone plus the surviving trail are the deletion record. An
   * upsert on the same (slug, harbor) resurrects the row (clears the
   * tombstone).
   *
   * Returns the removed item, or `{ removed: false }` when the slug/harbor
   * pair does not exist or is already tombstoned. This is the operation the
   * Planner pane's "duplicate slug" / "harbor split" flags need to become
   * auto-fixable instead of merely loud.
   */
  function remove(slug: string, harbor?: string): { removed: boolean; item: RoadmapItem | null } {
    const h = harbor ?? DEFAULT_HARBOR;
    const row = selectBySlugStmt.get(slug, h);
    if (!row || row.deleted_at != null) return { removed: false, item: null };
    const at = now();
    const lastTouchedAt = Math.max(row.last_touched_at + 1, at);
    tombstoneItemStmt.run(at, lastTouchedAt, row.id);
    const item = { ...hydrateDependencies(rowToItem(row)), deletedAt: at, lastTouchedAt };
    tuples.out(['roadmap:removed', slug, { harbor: h, id: row.id }], { harbor: h });
    return { removed: true, item };
  }

  return {
    upsert,
    get,
    slugExists,
    list,
    listDependents,
    updateStatus,
    touch,
    remove,
  };
}

export type RoadmapItems = ReturnType<typeof createRoadmapItems>;
