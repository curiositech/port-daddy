/**
 * Roadmap Items — structured, database-of-record roadmap state.
 *
 * The pitch: roadmap entries are first-class data, not markdown bullets.
 * Cartographer (or any writer) upserts items keyed by `slug`. Status
 * changes are append-only tuples so the audit trail is preserved. Reads
 * fold the upserts and status events into a single current view.
 *
 *   feedback:dropped (high/critical) -> cartographer promotes ->
 *   roadmap:upserted -> dashboard reads -> markdown is a render output.
 *
 * Why tuples (mirrors lib/feedback.ts): we already have
 *   - durable, harbor-scoped storage in SQLite
 *   - pattern-match subscription so any agent can listen with
 *     ['roadmap:upserted', '*', '*'] or ['roadmap:status', '*', '*']
 *   - immutability + provenance baked in (no edit, only append)
 *   - TTL semantics for stale parked entries
 *
 * Markdown (`docs/ROADMAP.md`) becomes a *render output* downstream of
 * this module — `pd roadmap render` reads the tuple stream and writes
 * the file. The file stops being the source of truth.
 *
 * Tuple shapes:
 *   ['roadmap:upserted', slug,
 *     { id, slug, summaryMd, status, promotedFromFeedbackId?,
 *       promotedByAgentId?, promotedAt?, lastTouchedAt, dependencies,
 *       notes, harbor }]
 *
 *   ['roadmap:status', slug, { status, by, at }]
 *
 *   ['roadmap:touched', slug, { at }]
 *
 * Status enum: now < backlog < parked < merge < done.
 * Latest tuple for a slug wins; older tuples remain for audit.
 */

import { randomUUID } from 'node:crypto';

interface TupleRow {
  id: number;
  fields: unknown[];
  writtenBy: string | null;
  createdAt: number;
  expiresAt: number | null;
}

interface TupleSpaceMin {
  out(
    fields: unknown[],
    options?: { harbor?: string; writtenBy?: string; ttlMs?: number },
  ): { id: number };
  rd(
    pattern: unknown[],
    options?: { harbor?: string; limit?: number },
  ): TupleRow[];
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
  tuples: TupleSpaceMin;
  /** Optional clock injection for tests. Defaults to Date.now(). */
  now?: () => number;
}

interface StatusEvent {
  status: RoadmapStatus;
  at: number;
  by: string | null;
}

const STATUSES: RoadmapStatus[] = ['now', 'backlog', 'parked', 'merge', 'done'];
const STATUS_RANK: Record<RoadmapStatus, number> = {
  now: 0,
  merge: 1,
  backlog: 2,
  parked: 3,
  done: 4,
};

const DEFAULT_HARBOR = 'fleet';

function harborForProject(project: string | undefined): string | null {
  const trimmed = typeof project === 'string' ? project.trim() : '';
  return trimmed ? `${trimmed}:fleet` : null;
}

function asEnum<T extends string>(value: string | undefined, allowed: T[], fallback: T): T {
  if (value && (allowed as string[]).includes(value)) return value as T;
  return fallback;
}

export function createRoadmapItems(deps: RoadmapItemsDeps) {
  const { tuples } = deps;
  const now = deps.now ?? (() => Date.now());

  function normalizeItem(data: unknown): RoadmapItem | null {
    if (!data || typeof data !== 'object') return null;
    const item = data as RoadmapItem;
    if (!item.slug || typeof item.slug !== 'string') return null;
    return {
      ...item,
      promotedFromFeedbackId: item.promotedFromFeedbackId ?? null,
      promotedByAgentId: item.promotedByAgentId ?? null,
      promotedAt: typeof item.promotedAt === 'number' ? item.promotedAt : null,
      dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
      notes: Array.isArray(item.notes) ? item.notes : [],
    };
  }

  /**
   * Collect the latest upsert tuple per slug. Tuples are append-only, so
   * "latest" = highest tuple id for a given slug.
   */
  function latestUpserts(harbor?: string): Map<string, { row: TupleRow; item: RoadmapItem }> {
    const matches = tuples.rd(['roadmap:upserted', '*', '*'], { harbor, limit: 10000 });
    const latest = new Map<string, { row: TupleRow; item: RoadmapItem }>();
    for (const row of matches) {
      const slug = row.fields[1];
      if (typeof slug !== 'string') continue;
      const item = normalizeItem(row.fields[2]);
      if (!item) continue;
      const existing = latest.get(slug);
      if (!existing || row.id > existing.row.id) {
        latest.set(slug, { row, item });
      }
    }
    return latest;
  }

  /**
   * Collect the most recent status event per slug. Used to overlay
   * status changes on top of the latest upsert without re-writing the
   * upsert tuple.
   */
  function latestStatuses(harbor?: string): Map<string, StatusEvent> {
    const matches = tuples.rd(['roadmap:status', '*', '*'], { harbor, limit: 10000 });
    const latest = new Map<string, { row: TupleRow; event: StatusEvent }>();
    for (const row of matches) {
      const slug = row.fields[1];
      if (typeof slug !== 'string') continue;
      const data = row.fields[2];
      if (!data || typeof data !== 'object') continue;
      const payload = data as Record<string, unknown>;
      const status = typeof payload.status === 'string' ? payload.status : null;
      if (!status || !(STATUSES as string[]).includes(status)) continue;
      const event: StatusEvent = {
        status: status as RoadmapStatus,
        at: typeof payload.at === 'number' ? payload.at : 0,
        by: typeof payload.by === 'string' ? payload.by : null,
      };
      const existing = latest.get(slug);
      if (!existing || row.id > existing.row.id) {
        latest.set(slug, { row, event });
      }
    }
    const out = new Map<string, StatusEvent>();
    for (const [slug, v] of latest) out.set(slug, v.event);
    return out;
  }

  /**
   * Collect the most recent touch event per slug. Touches refresh
   * `lastTouchedAt` without changing any other field — used by the
   * cartographer to mark "still relevant" without minting an audit
   * event in the status stream.
   */
  function latestTouches(harbor?: string): Map<string, number> {
    const matches = tuples.rd(['roadmap:touched', '*', '*'], { harbor, limit: 10000 });
    const latest = new Map<string, number>();
    for (const row of matches) {
      const slug = row.fields[1];
      if (typeof slug !== 'string') continue;
      const data = row.fields[2];
      const at = data && typeof data === 'object'
        ? (data as Record<string, unknown>).at
        : undefined;
      if (typeof at !== 'number') continue;
      const existing = latest.get(slug);
      if (existing === undefined || at > existing) {
        latest.set(slug, at);
      }
    }
    return latest;
  }

  function applyOverlays(
    item: RoadmapItem,
    status: StatusEvent | undefined,
    touchedAt: number | undefined,
  ): RoadmapItem {
    const out: RoadmapItem = { ...item };
    if (status) out.status = status.status;
    if (typeof touchedAt === 'number' && touchedAt > out.lastTouchedAt) {
      out.lastTouchedAt = touchedAt;
    }
    return out;
  }

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
    const harbor = input.harbor ?? harborForProject(input.project) ?? DEFAULT_HARBOR;

    // Re-use existing id when upserting an existing slug so audit trails
    // tied to a stable id (e.g. dashboard hyperlinks) keep working.
    const existing = latestUpserts(harbor).get(slug)?.item;
    const at = now();
    const item: RoadmapItem = {
      id: existing?.id ?? randomUUID(),
      slug,
      summaryMd: input.summaryMd.trim(),
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

    tuples.out(['roadmap:upserted', slug, item], {
      harbor,
      writtenBy: input.promotedByAgentId ?? undefined,
      ttlMs: input.ttlMs && input.ttlMs > 0 ? input.ttlMs : undefined,
    });

    return item;
  }

  function get(slug: string, harbor?: string): RoadmapItem | null {
    const upserts = latestUpserts(harbor);
    const found = upserts.get(slug);
    if (!found) return null;
    const status = latestStatuses(harbor).get(slug);
    const touchedAt = latestTouches(harbor).get(slug);
    return applyOverlays(found.item, status, touchedAt);
  }

  function list(options: ListRoadmapItemsOptions = {}): RoadmapItem[] {
    const { harbor } = options;
    const limit = options.limit ?? 1000;
    const upserts = latestUpserts(harbor);
    const statuses = latestStatuses(harbor);
    const touches = latestTouches(harbor);

    const items: RoadmapItem[] = [];
    for (const { item } of upserts.values()) {
      const overlayed = applyOverlays(item, statuses.get(item.slug), touches.get(item.slug));
      if (options.status && options.status !== 'all' && overlayed.status !== options.status) {
        continue;
      }
      items.push(overlayed);
    }

    items.sort((a, b) => {
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rank !== 0) return rank;
      return b.lastTouchedAt - a.lastTouchedAt;
    });

    return items.slice(0, limit);
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
    const item = get(input.slug, input.harbor);
    if (!item) {
      throw new Error(`roadmap.updateStatus: no roadmap item with slug '${input.slug}'`);
    }
    const at = now();
    tuples.out(
      ['roadmap:status', input.slug, { status, by: input.by, at }],
      { harbor: input.harbor ?? item.harbor, writtenBy: input.by },
    );
    return { ...item, status, lastTouchedAt: Math.max(item.lastTouchedAt, at) };
  }

  function touch(slug: string, harbor?: string): RoadmapItem | null {
    const item = get(slug, harbor);
    if (!item) return null;
    const at = now();
    tuples.out(['roadmap:touched', slug, { at }], {
      harbor: harbor ?? item.harbor,
    });
    return { ...item, lastTouchedAt: at };
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
