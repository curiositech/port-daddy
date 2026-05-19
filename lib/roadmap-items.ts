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
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

interface TupleSpaceMin {
  out(
    fields: unknown[],
    options?: { harbor?: string; writtenBy?: string; ttlMs?: number },
  ): { id: number };
}

export type RoadmapStatus = 'now' | 'backlog' | 'parked' | 'merge' | 'done';

export interface RoadmapItem {
  id: string;
  slug: string;
  summaryMd: string;
  status: RoadmapStatus;
  promotedFromFeedbackId: string | null;
  promotedByAgentId: string | null;
  promotedAt: number | null;
  lastTouchedAt: number;
  dependencies: string[];
  notes: Array<{ at: number; by: string; text: string }>;
  harbor: string;
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
}

export interface ListRoadmapItemsOptions {
  harbor?: string;
  status?: RoadmapStatus | 'all';
  limit?: number;
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
}

const STATUSES: RoadmapStatus[] = ['now', 'backlog', 'parked', 'merge', 'done'];
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
  };
}

export function createRoadmapItems(deps: RoadmapItemsDeps) {
  const { db, tuples } = deps;
  const now = deps.now ?? (() => Date.now());

  const selectBySlugStmt = db.prepare<[string, string], RoadmapItemRow>(
    `SELECT * FROM roadmap_items WHERE slug = ? AND harbor = ?`,
  );
  const insertStmt = db.prepare(`
    INSERT INTO roadmap_items (
      id, slug, summary_md, status,
      promoted_from_feedback_id, promoted_by_agent_id, promoted_at,
      last_touched_at, dependencies_json, notes_json, harbor, created_at
    ) VALUES (@id, @slug, @summaryMd, @status,
      @promotedFromFeedbackId, @promotedByAgentId, @promotedAt,
      @lastTouchedAt, @dependenciesJson, @notesJson, @harbor, @createdAt)
  `);
  const updateStmt = db.prepare(`
    UPDATE roadmap_items SET
      summary_md = @summaryMd,
      status = @status,
      promoted_from_feedback_id = @promotedFromFeedbackId,
      promoted_by_agent_id = @promotedByAgentId,
      promoted_at = @promotedAt,
      last_touched_at = @lastTouchedAt,
      dependencies_json = @dependenciesJson,
      notes_json = @notesJson
    WHERE id = @id
  `);
  const updateStatusStmt = db.prepare(`
    UPDATE roadmap_items
       SET status = @status, last_touched_at = @lastTouchedAt
     WHERE id = @id
  `);
  const updateTouchStmt = db.prepare(`
    UPDATE roadmap_items SET last_touched_at = @at WHERE id = @id
  `);
  const insertStatusEventStmt = db.prepare(`
    INSERT INTO roadmap_item_status_events
      (item_id, slug, status, by_agent_id, at, harbor)
    VALUES (@itemId, @slug, @status, @byAgentId, @at, @harbor)
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
    const existing = existingRow ? rowToItem(existingRow) : null;
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
      dependencies: Array.isArray(input.dependencies)
        ? input.dependencies
        : existing?.dependencies ?? [],
      notes: Array.isArray(input.notes) ? input.notes : existing?.notes ?? [],
      harbor,
    };

    const params = {
      id: item.id,
      slug: item.slug,
      summaryMd: item.summaryMd,
      status: item.status,
      promotedFromFeedbackId: item.promotedFromFeedbackId,
      promotedByAgentId: item.promotedByAgentId,
      promotedAt: item.promotedAt,
      lastTouchedAt: item.lastTouchedAt,
      dependenciesJson: JSON.stringify(item.dependencies),
      notesJson: JSON.stringify(item.notes),
      harbor: item.harbor,
      createdAt: existing ? existingRow!.created_at : at,
    };

    if (existing) {
      updateStmt.run(params);
    } else {
      insertStmt.run(params);
    }

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
    return row ? rowToItem(row) : null;
  }

  function list(options: ListRoadmapItemsOptions = {}): RoadmapItem[] {
    const limit = options.limit ?? 1000;
    const params: Record<string, unknown> = { limit };
    const where: string[] = [];
    if (options.harbor !== undefined) {
      where.push('harbor = @harbor');
      params.harbor = options.harbor;
    }
    if (options.status && options.status !== 'all') {
      where.push('status = @status');
      params.status = options.status;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT * FROM roadmap_items
      ${whereSql}
      ORDER BY ${STATUS_RANK_SQL} ASC, last_touched_at DESC
      LIMIT @limit`;
    const rows = db.prepare<typeof params, RoadmapItemRow>(sql).all(params);
    return rows.map(rowToItem);
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
    if (!row) {
      throw new Error(`roadmap.updateStatus: no roadmap item with slug '${input.slug}'`);
    }
    const at = now();
    const lastTouchedAt = Math.max(row.last_touched_at, at);
    updateStatusStmt.run({ id: row.id, status, lastTouchedAt });
    insertStatusEventStmt.run({
      itemId: row.id,
      slug: row.slug,
      status,
      byAgentId: input.by,
      at,
      harbor,
    });
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
    updateTouchStmt.run({ id: row.id, at });
    tuples.out(['roadmap:touched', slug, { at }], { harbor: h });
    return { ...rowToItem(row), lastTouchedAt: at };
  }

  return {
    upsert,
    get,
    list,
    updateStatus,
    touch,
  };
}

export type RoadmapItems = ReturnType<typeof createRoadmapItems>;
