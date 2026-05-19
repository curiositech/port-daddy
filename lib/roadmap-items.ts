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
import type Database from 'better-sqlite3';

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
  // === core identity (unchanged) ===
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
   * Backward-compat alias: title + whyMd + nextCutMd + descriptionMd
   * joined with double-newlines (null fields skipped). Use the split
   * fields in new code.
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
  tuples: TupleSpaceMin;
  /**
   * Better-sqlite3 database for relational tables (edges, owners,
   * artifacts, tags, events). Optional; if absent, the relational APIs
   * throw and the module falls back to tuple-only semantics for the
   * core read/write paths.
   */
  db?: Database.Database;
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

interface StatusEvent {
  status: string;
  at: number;
  by: string | null;
}

const STATUSES: RoadmapStatus[] = ['now', 'backlog', 'parked', 'merge', 'done', 'quarantined'];
const STATUS_RANK: Record<RoadmapStatus, number> = {
  now: 0,
  merge: 1,
  backlog: 2,
  parked: 3,
  done: 4,
  quarantined: 5,
};

const VISIBILITIES: RoadmapVisibility[] = ['private', 'team', 'org', 'public'];
const PRINCIPAL_TYPES: RoadmapPrincipalType[] = ['agent', 'user', 'team'];

function normalizeStatus(value: string | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
}

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
  const db = deps.db;
  const now = deps.now ?? (() => Date.now());

  // ADR-0036: relational tables for edges / owners / artifacts / tags
  // / events. Only created when a db dep is provided; tuple-only
  // callers (legacy) keep working with the core read/write surface.
  if (db) {
    const runSchema = (sql: string) => (db as Database.Database)['exec'](sql);
    runSchema(`
      CREATE TABLE IF NOT EXISTS roadmap_item_edges (
        from_id TEXT NOT NULL,
        to_id   TEXT NOT NULL,
        kind    TEXT NOT NULL,
        by      TEXT,
        at      INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id, kind)
      )
    `);
    runSchema(`CREATE INDEX IF NOT EXISTS idx_roadmap_edges_to ON roadmap_item_edges(to_id)`);
    runSchema(`
      CREATE TABLE IF NOT EXISTS roadmap_item_owners (
        item_id        TEXT NOT NULL,
        principal_id   TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        role           TEXT NOT NULL,
        at             INTEGER NOT NULL,
        PRIMARY KEY (item_id, principal_id, role)
      )
    `);
    runSchema(
      `CREATE INDEX IF NOT EXISTS idx_roadmap_owners_principal
       ON roadmap_item_owners(principal_id, role)`,
    );
    runSchema(`
      CREATE TABLE IF NOT EXISTS roadmap_item_artifacts (
        item_id TEXT NOT NULL,
        kind    TEXT NOT NULL,
        ref     TEXT NOT NULL,
        label   TEXT,
        at      INTEGER NOT NULL,
        PRIMARY KEY (item_id, kind, ref)
      )
    `);
    runSchema(
      `CREATE INDEX IF NOT EXISTS idx_roadmap_artifacts_kind_ref
       ON roadmap_item_artifacts(kind, ref)`,
    );
    runSchema(`
      CREATE TABLE IF NOT EXISTS roadmap_item_tags (
        item_id TEXT NOT NULL,
        tag     TEXT NOT NULL,
        PRIMARY KEY (item_id, tag)
      )
    `);
    runSchema(`CREATE INDEX IF NOT EXISTS idx_roadmap_tags_tag ON roadmap_item_tags(tag)`);
    runSchema(`
      CREATE TABLE IF NOT EXISTS roadmap_item_events (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id   TEXT NOT NULL,
        kind      TEXT NOT NULL,
        by        TEXT,
        at        INTEGER NOT NULL,
        payload   TEXT
      )
    `);
    runSchema(
      `CREATE INDEX IF NOT EXISTS idx_roadmap_events_item
       ON roadmap_item_events(item_id, at DESC)`,
    );
  }

  function relationalOrThrow(): Database.Database {
    if (!db) {
      throw new Error(
        'roadmap-items: relational APIs (edges/owners/artifacts/tags/events) require a db dep',
      );
    }
    return db;
  }

  function normalizeItem(data: unknown): RoadmapItem | null {
    if (!data || typeof data !== 'object') return null;
    const raw = data as Partial<RoadmapItem> & Record<string, unknown>;
    if (!raw.slug || typeof raw.slug !== 'string') return null;
    const title =
      typeof raw.title === 'string' && raw.title.length > 0
        ? raw.title
        : null;
    const whyMd = typeof raw.whyMd === 'string' ? raw.whyMd : null;
    const nextCutMd = typeof raw.nextCutMd === 'string' ? raw.nextCutMd : null;
    const descriptionMd =
      typeof raw.descriptionMd === 'string' ? raw.descriptionMd : null;
    const summaryMd =
      typeof raw.summaryMd === 'string' && raw.summaryMd.length > 0
        ? raw.summaryMd
        : joinSummary({ title, whyMd, nextCutMd, descriptionMd });
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      slug: raw.slug,
      status:
        typeof raw.status === 'string' && raw.status.length > 0
          ? raw.status
          : 'backlog',
      promotedFromFeedbackId:
        typeof raw.promotedFromFeedbackId === 'string'
          ? raw.promotedFromFeedbackId
          : null,
      promotedByAgentId:
        typeof raw.promotedByAgentId === 'string' ? raw.promotedByAgentId : null,
      promotedAt: typeof raw.promotedAt === 'number' ? raw.promotedAt : null,
      lastTouchedAt:
        typeof raw.lastTouchedAt === 'number' ? raw.lastTouchedAt : 0,
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
      notes: Array.isArray(raw.notes) ? (raw.notes as RoadmapItem['notes']) : [],
      harbor: typeof raw.harbor === 'string' ? raw.harbor : DEFAULT_HARBOR,
      title,
      whyMd,
      nextCutMd,
      descriptionMd,
      summaryMd,
      parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
      ordering: typeof raw.ordering === 'number' ? raw.ordering : 0,
      visibility:
        VISIBILITIES.includes(raw.visibility as RoadmapVisibility)
          ? (raw.visibility as RoadmapVisibility)
          : 'private',
      scheduledAt: typeof raw.scheduledAt === 'number' ? raw.scheduledAt : null,
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : null,
      dueAt: typeof raw.dueAt === 'number' ? raw.dueAt : null,
      completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null,
      teamId: typeof raw.teamId === 'string' ? raw.teamId : null,
      workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : null,
      workflowId: typeof raw.workflowId === 'string' ? raw.workflowId : null,
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
      const status = typeof payload.status === 'string' ? payload.status.trim() : '';
      if (!status) continue;
      const event: StatusEvent = {
        status,
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
    const slug = input.slug.trim();
    if (!slug) {
      throw new Error('roadmap.upsert: slug must be non-empty after trim');
    }

    // Content split — accept either summaryMd (legacy) OR the split trio
    // (title/whyMd/nextCutMd/descriptionMd). At least one must be present.
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
    const existing = latestUpserts(harbor).get(slug)?.item;
    const at = now();

    // When only legacy summaryMd is supplied, treat the whole blob as
    // descriptionMd and leave title null (display layer falls back to
    // slug). The computed summaryMd on read returns the description
    // verbatim in that case, matching legacy callers' roundtrip
    // expectation.
    const title =
      input.title !== undefined
        ? (input.title?.trim() || null)
        : existing?.title ?? null;
    const whyMd =
      input.whyMd !== undefined ? input.whyMd : existing?.whyMd ?? null;
    const nextCutMd =
      input.nextCutMd !== undefined ? input.nextCutMd : existing?.nextCutMd ?? null;
    const descriptionMd =
      input.descriptionMd !== undefined
        ? input.descriptionMd
        : hasLegacy
          ? input.summaryMd!.trim()
          : existing?.descriptionMd ?? null;

    const item: RoadmapItem = {
      id: existing?.id ?? randomUUID(),
      slug,
      status: normalizeStatus(input.status, existing?.status ?? 'backlog'),
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
      summaryMd: joinSummary({ title, whyMd, nextCutMd, descriptionMd }),
      parentId:
        input.parentId !== undefined ? input.parentId : existing?.parentId ?? null,
      ordering:
        typeof input.ordering === 'number'
          ? input.ordering
          : existing?.ordering ?? 0,
      visibility: asEnum(input.visibility, VISIBILITIES, existing?.visibility ?? 'private'),
      scheduledAt:
        typeof input.scheduledAt === 'number'
          ? input.scheduledAt
          : existing?.scheduledAt ?? null,
      startedAt:
        typeof input.startedAt === 'number' ? input.startedAt : existing?.startedAt ?? null,
      dueAt: typeof input.dueAt === 'number' ? input.dueAt : existing?.dueAt ?? null,
      completedAt:
        typeof input.completedAt === 'number'
          ? input.completedAt
          : existing?.completedAt ?? null,
      teamId: input.teamId ?? existing?.teamId ?? null,
      workspaceId: input.workspaceId ?? existing?.workspaceId ?? null,
      workflowId: input.workflowId ?? existing?.workflowId ?? null,
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
      // Known statuses sort by rank; unknown (team-custom) statuses sort last,
      // preserving newest-first within the group.
      const aRank = STATUS_RANK[a.status as RoadmapStatus] ?? 99;
      const bRank = STATUS_RANK[b.status as RoadmapStatus] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
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
    const status = normalizeStatus(input.status, 'backlog');
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

  // =========================================================================
  // ADR-0036 relational APIs — only available when a `db` dep is provided.
  // =========================================================================

  function addEdge(edge: { fromId: string; toId: string; kind: string; by?: string }): RoadmapEdge {
    const sqlDb = relationalOrThrow();
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
    sqlDb.prepare(
      `INSERT OR REPLACE INTO roadmap_item_edges (from_id, to_id, kind, by, at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(fromId, toId, kind, edge.by ?? null, at);
    addEventInternal({ itemId: fromId, kind: 'edge-added', by: edge.by ?? null, payload: { toId, edgeKind: kind } });
    return { fromId, toId, kind, by: edge.by ?? null, at };
  }

  function removeEdge(edge: { fromId: string; toId: string; kind: string; by?: string }): boolean {
    const sqlDb = relationalOrThrow();
    const result = sqlDb.prepare(
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
    const sqlDb = relationalOrThrow();
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.fromId) { where.push('from_id = ?'); params.push(options.fromId); }
    if (options.toId) { where.push('to_id = ?'); params.push(options.toId); }
    if (options.kind) { where.push('kind = ?'); params.push(options.kind); }
    let sql = `SELECT from_id, to_id, kind, by, at FROM roadmap_item_edges`;
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY at DESC';
    const rows = sqlDb.prepare(sql).all(...params) as Array<{
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
    const sqlDb = relationalOrThrow();
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
    sqlDb.prepare(
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
    const sqlDb = relationalOrThrow();
    const result = sqlDb.prepare(
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
    const sqlDb = relationalOrThrow();
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.itemId) { where.push('item_id = ?'); params.push(options.itemId); }
    if (options.principalId) { where.push('principal_id = ?'); params.push(options.principalId); }
    if (options.role) { where.push('role = ?'); params.push(options.role); }
    let sql = `SELECT item_id, principal_id, principal_type, role, at FROM roadmap_item_owners`;
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY at DESC';
    const rows = sqlDb.prepare(sql).all(...params) as Array<{
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
    const sqlDb = relationalOrThrow();
    const itemId = input.itemId?.trim();
    const kind = input.kind?.trim();
    const ref = input.ref?.trim();
    if (!itemId || !kind || !ref) {
      throw new Error('roadmap.addArtifact: itemId, kind, and ref are required');
    }
    const at = now();
    const label = input.label ?? null;
    sqlDb.prepare(
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
    const sqlDb = relationalOrThrow();
    const result = sqlDb.prepare(
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
    const sqlDb = relationalOrThrow();
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.itemId) { where.push('item_id = ?'); params.push(options.itemId); }
    if (options.kind) { where.push('kind = ?'); params.push(options.kind); }
    if (options.ref) { where.push('ref = ?'); params.push(options.ref); }
    let sql = `SELECT item_id, kind, ref, label, at FROM roadmap_item_artifacts`;
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY at DESC';
    const rows = sqlDb.prepare(sql).all(...params) as Array<{
      item_id: string; kind: string; ref: string; label: string | null; at: number;
    }>;
    return rows.map((r) => ({ itemId: r.item_id, kind: r.kind, ref: r.ref, label: r.label, at: r.at }));
  }

  function addTag(input: { itemId: string; tag: string; by?: string }): { itemId: string; tag: string } {
    const sqlDb = relationalOrThrow();
    const itemId = input.itemId?.trim();
    const tag = input.tag?.trim();
    if (!itemId || !tag) throw new Error('roadmap.addTag: itemId and tag are required');
    sqlDb.prepare(`INSERT OR IGNORE INTO roadmap_item_tags (item_id, tag) VALUES (?, ?)`).run(itemId, tag);
    addEventInternal({ itemId, kind: 'tag-added', by: input.by ?? null, payload: { tag } });
    return { itemId, tag };
  }

  function removeTag(input: { itemId: string; tag: string; by?: string }): boolean {
    const sqlDb = relationalOrThrow();
    const result = sqlDb.prepare(
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
    const sqlDb = relationalOrThrow();
    const sql = itemId
      ? `SELECT item_id, tag FROM roadmap_item_tags WHERE item_id = ? ORDER BY tag`
      : `SELECT item_id, tag FROM roadmap_item_tags ORDER BY item_id, tag`;
    const rows = sqlDb.prepare(sql).all(...(itemId ? [itemId] : [])) as Array<{
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
    const sqlDb = relationalOrThrow();
    const at = now();
    const payloadJson = input.payload ? JSON.stringify(input.payload) : null;
    const result = sqlDb.prepare(
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
    const sqlDb = relationalOrThrow();
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
    const rows = sqlDb.prepare(sql).all(...params) as Array<{
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
    // ADR-0036 relational APIs (throw without db dep)
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
