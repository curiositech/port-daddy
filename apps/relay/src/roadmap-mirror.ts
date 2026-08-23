/**
 * apps/relay/src/roadmap-mirror.ts — the roadmap command-center MIRROR
 * (operator mandate 2026-08-22; PR 1 of the relay roadmap program).
 *
 * Purpose: a daemon PUSHES its per-repo roadmap snapshot to the relay
 * (`PUT /v1/roadmap/snapshot`, pdu_ bearer), and the relay stores an
 * account-scoped REPLICA the operator can read from anywhere
 * (`GET /v1/roadmap/mirror?repo=…`). Push-sync was chosen over repo-snapshot
 * files or a live tunnel on purpose: the daemon stays the SINGLE WRITER of
 * its roadmap, the relay is a phone-book-grade replica — never a second
 * source of truth, never a write path back into the daemon.
 *
 * Honesty (repo law: no Potemkin):
 *   - The watermark is two clocks, labeled: `generated_at` is the daemon's
 *     clock (unix ms, stored verbatim) and `received_at` is the relay's
 *     clock (unix seconds). A reader always knows how stale the mirror is
 *     and never mistakes relay arrival for daemon truth.
 *   - Tombstoned items (deleted_at set) are INGESTED AND SERVED: the
 *     daemon's registry union-merges replicas, so a tombstone is data. The
 *     board excludes them; the item-detail read shows them as deleted.
 *   - Every ingest is a FULL REPLACE per (user, repo) inside ONE
 *     `env.DB.batch()` (D1 batches are transactional), so the mirror is
 *     always exactly one snapshot — never an interleaving of two pushes.
 *
 * Trust boundary: user_id comes from the resolved credential
 * (resolveUserFromRequest — pdu_ bearer or session cookie), never the
 * payload, so one account can neither write nor read another account's
 * mirror. D1 has no row-level security; every query here binds user_id.
 */

import type { Env } from './types.js';
import { resolveUserFromRequest } from './device-flow.js';
import { isSameOrigin } from './auth-github.js';
import type { ScopeTier } from './scope-ladder.js';

// ── contract constants ────────────────────────────────────────────────────────

/**
 * Where the mirror sits on the ADR-0101 scope ladder — declared from the
 * shared vocabulary (scope-ladder.ts), never re-encoded ad hoc (ADR-0101
 * Critical 3). The mirror is TEAM-tier: relay D1 rows keyed to the
 * operator's account, readable only by their own credential. Its ADR-0101
 * Critical-2 export/delete matrix entries: export via GET /account/export
 * (exportRoadmapMirrors), delete via account erasure (db.ts eraseUser) plus
 * the retention sweep's activity cap.
 */
export const ROADMAP_MIRROR_TIER: ScopeTier = 'team';

/** The daemon's closed roadmap lane enum (mirrors lib/db.ts roadmap_items). */
export type MirrorStatus = 'now' | 'backlog' | 'parked' | 'merge' | 'done';
export const MIRROR_STATUSES: readonly MirrorStatus[] = ['now', 'backlog', 'parked', 'merge', 'done'];

/** The closed edge-type enum the mirror stores (hierarchy + dependency). */
export type MirrorEdgeType = 'parent_of' | 'depends_on';
const EDGE_TYPES: readonly MirrorEdgeType[] = ['parent_of', 'depends_on'];

/**
 * Payload guards. Why explicit numbers: an unbounded ingest path on a Worker
 * is a denial-of-service surface AND a D1 cost surface — the caps are the
 * contract, stated in the rejection envelope so a daemon author can size
 * their snapshot instead of guessing.
 */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024; // 2 MB of JSON
export const MAX_SNAPSHOT_ITEMS = 5000;

/**
 * Multi-row INSERT chunk size. Each chunk is ONE statement carrying its rows
 * as a single bound JSON array unpacked by `json_each`, so the D1 per-query
 * bound-parameter limit (100) is never in play regardless of column count.
 */
const INSERT_CHUNK_ROWS = 40;

/**
 * Activity-tail cap per (user, repo). Why: activity is a TAIL, not an
 * archive — the daemon owns full history. Enforced at ingest (only the
 * newest rows land) and re-enforced by the retention sweep so no code path
 * can leave an unbounded table behind.
 */
export const ROADMAP_ACTIVITY_CAP = 200;

// ── wire + row shapes ─────────────────────────────────────────────────────────

/** One roadmap item on the snapshot wire (daemon → relay), camelCase. */
export interface SnapshotItem {
  slug: string;
  status: MirrorStatus;
  kind?: string;
  priority?: number;
  summaryMd?: string;
  descriptionMd?: string | null;
  assigneeId?: string | null;
  startedAt?: number | null;
  dueAt?: number | null;
  estimate?: number | null;
  lastTouchedAt?: number;
  createdAt?: number;
  deletedAt?: number | null;
  dependencies?: unknown[];
  notes?: unknown[];
}

/** One graph edge on the snapshot wire. */
export interface SnapshotEdge {
  scope: string;
  sourceId: string;
  edgeType: MirrorEdgeType;
  targetId: string;
}

/** One activity-tail entry on the snapshot wire. */
export interface SnapshotActivity {
  at: number;
  slug: string;
  kind: string;
  byId?: string | null;
  detail?: unknown;
}

/** The full PUT /v1/roadmap/snapshot body. */
export interface RoadmapSnapshotPayload {
  repoFullName: string;
  harbor: string;
  /** Daemon clock, unix ms — the honest freshness watermark. */
  generatedAt: number;
  daemonLabel?: string | null;
  items: SnapshotItem[];
  edges?: SnapshotEdge[];
  activityTail?: SnapshotActivity[];
}

/** The stored mirror header row. */
export interface MirrorHeaderRow {
  user_id: string;
  repo_full_name: string;
  harbor: string;
  daemon_label: string | null;
  generated_at: number;
  received_at: number;
  item_count: number;
  edge_count: number;
  harbor_id: string | null;
}

/** The stored mirror item row. */
export interface MirrorItemRow {
  user_id: string;
  repo_full_name: string;
  slug: string;
  harbor: string;
  status: MirrorStatus;
  kind: string;
  priority: number;
  summary_md: string;
  description_md: string | null;
  assignee_id: string | null;
  started_at: number | null;
  due_at: number | null;
  estimate: number | null;
  last_touched_at: number;
  created_at: number;
  deleted_at: number | null;
  dependencies_json: string;
  notes_json: string;
}

/** The stored mirror edge row. */
export interface MirrorEdgeRow {
  scope: string;
  source_id: string;
  edge_type: MirrorEdgeType;
  target_id: string;
}

/** The stored activity row. */
export interface MirrorActivityRow {
  at: number;
  slug: string;
  kind: string;
  by_id: string | null;
  detail_json: string | null;
}

// ── small local helpers ───────────────────────────────────────────────────────

/**
 * JSON response helper. Why local: keeps the module dependency-free and the
 * `{ code, error }` envelope consistent with the relay's other /v1 endpoints
 * by design (index.ts threads requestId through this shape).
 *
 * @param status - HTTP status code.
 * @param body - JSON-serializable payload.
 * @returns The JSON Response (no-store: per-account data must not cache).
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// One repo-name shape across the account surfaces, by design: the mirror's
// door uses the SAME normalization contract as the repo-settings screen
// (pasted GitHub URLs accepted, `.git` stripped, GitHub-legal owner/name
// charsets, fragments/queries rejected) — imported, never re-implemented, so
// the two doors cannot drift (no-duplicate-paths doctrine). Re-exported
// because it is part of this module's ingest contract too.
import { normalizeRepoFullName } from './repo-settings-page.js';
export { normalizeRepoFullName };

/**
 * Split an array into fixed-size chunks for multi-row INSERT statements.
 *
 * Why: one bound JSON array per statement keeps each SQL string constant and
 * each statement's row count bounded (~{@link INSERT_CHUNK_ROWS}), so a
 * 5000-item snapshot becomes ~125 small statements inside one transactional
 * batch instead of one enormous string or 5000 round trips.
 *
 * @param arr - The rows to chunk.
 * @param size - Maximum rows per chunk (must be >= 1).
 * @returns The list of chunks, in order.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** A validation failure carrying the explicit JSON-error fields the door returns. */
interface Invalid {
  status: number;
  code: string;
  error: string;
}

/** Discriminated validation result: the normalized snapshot, or the refusal. */
type Validated = { ok: true; snapshot: NormalizedSnapshot } | { ok: false; invalid: Invalid };

/** The fully-normalized snapshot the ingest writes (defaults applied, deduped). */
interface NormalizedSnapshot {
  repoFullName: string;
  harbor: string;
  generatedAt: number;
  daemonLabel: string | null;
  items: NormalizedItem[];
  edges: SnapshotEdge[];
  activity: Array<{ at: number; slug: string; kind: string; byId: string | null; detail: unknown }>;
}

/** One item after normalization: every NOT NULL column has a concrete value. */
interface NormalizedItem {
  slug: string;
  harbor: string;
  status: MirrorStatus;
  kind: string;
  priority: number;
  summaryMd: string;
  descriptionMd: string | null;
  assigneeId: string | null;
  startedAt: number | null;
  dueAt: number | null;
  estimate: number | null;
  lastTouchedAt: number;
  createdAt: number;
  deletedAt: number | null;
  dependencies: unknown[];
  notes: unknown[];
}

/**
 * Is the value a finite number — the only clock/priority shape accepted?
 *
 * Why a guard and not a cast: NaN/Infinity survive `typeof === 'number'` and
 * would poison timestamp columns; the design keeps every numeric door closed
 * to non-finite values.
 *
 * @param v - The candidate value from the wire.
 * @returns True when v is a finite number (narrows the type).
 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Coerce an optional wire value to a finite number, else null.
 *
 * Why: nullable INTEGER columns want a real number or SQL NULL — the intent
 * is that NaN or a string never lands in a clock column.
 *
 * @param v - The candidate value from the wire.
 * @returns The finite number, or null.
 */
function numOrNull(v: unknown): number | null {
  return isFiniteNumber(v) ? v : null;
}

/**
 * Coerce an optional wire value to a non-empty trimmed string, else null.
 *
 * Why the cap: unbounded client strings in id/label columns are a storage
 * denial surface; the design bounds every free-text field at the door.
 *
 * @param v - The candidate value from the wire.
 * @param cap - Maximum stored length.
 * @returns The trimmed, capped string, or null for empty/non-strings.
 */
function strOrNull(v: unknown, cap: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, cap) : null;
}

/**
 * Validate + normalize a parsed snapshot body into the exact rows the batch
 * writes.
 *
 * Why one function: the door has exactly one shape to reason about — every
 * refusal is an explicit `{ code, error }` naming what was wrong (payload
 * caps, lane enum, duplicate slugs), never a silent drop or a half-written
 * mirror. Defaults are applied HERE (kind 'task', priority 3, clocks falling
 * back to generatedAt) so the SQL below never has to invent values.
 *
 * @param body - The parsed (unknown-shaped) request JSON.
 * @returns The normalized snapshot, or the refusal to send back.
 */
export function validateSnapshotPayload(body: unknown): Validated {
  /**
   * Build a refusal. Why a closure: every rejection in this function must
   * carry the same explicit shape (status + code + human reason) by design —
   * one constructor keeps a forgotten field impossible.
   *
   * @param status - HTTP status for the refusal.
   * @param code - Machine-readable error code.
   * @param error - Human-readable reason.
   * @returns The failed Validated branch.
   */
  const bad = (status: number, code: string, error: string): Validated => ({ ok: false, invalid: { status, code, error } });
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return bad(400, 'BAD_PAYLOAD', 'body must be a JSON object');
  }
  const p = body as Record<string, unknown>;
  const repoFullName = normalizeRepoFullName(p.repoFullName);
  if (!repoFullName) return bad(400, 'BAD_REPO', 'repoFullName must be owner/name');
  const harbor = strOrNull(p.harbor, 120);
  if (!harbor) return bad(400, 'BAD_HARBOR', 'harbor must be a non-empty string');
  if (!isFiniteNumber(p.generatedAt) || p.generatedAt <= 0) {
    return bad(400, 'BAD_GENERATED_AT', 'generatedAt must be the daemon clock in unix ms');
  }
  const generatedAt = p.generatedAt;
  const daemonLabel = strOrNull(p.daemonLabel, 120);
  if (!Array.isArray(p.items)) return bad(400, 'BAD_ITEMS', 'items must be an array');
  if (p.items.length > MAX_SNAPSHOT_ITEMS) {
    return bad(413, 'TOO_MANY_ITEMS', `snapshot has ${p.items.length} items; the mirror accepts at most ${MAX_SNAPSHOT_ITEMS}`);
  }
  const rawEdges = p.edges === undefined ? [] : p.edges;
  if (!Array.isArray(rawEdges)) return bad(400, 'BAD_EDGES', 'edges must be an array when present');
  const rawActivity = p.activityTail === undefined ? [] : p.activityTail;
  if (!Array.isArray(rawActivity)) return bad(400, 'BAD_ACTIVITY', 'activityTail must be an array when present');

  const items: NormalizedItem[] = [];
  const seenSlugs = new Set<string>();
  for (let i = 0; i < p.items.length; i++) {
    const raw = p.items[i] as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) return bad(400, 'BAD_ITEM', `items[${i}] must be an object`);
    const slug = strOrNull(raw.slug, 200);
    if (!slug) return bad(400, 'BAD_ITEM', `items[${i}].slug must be a non-empty string`);
    if (seenSlugs.has(slug)) return bad(400, 'DUPLICATE_SLUG', `items[${i}] repeats slug '${slug}'`);
    seenSlugs.add(slug);
    const status = raw.status;
    if (typeof status !== 'string' || !(MIRROR_STATUSES as readonly string[]).includes(status)) {
      return bad(400, 'BAD_STATUS', `items[${i}].status must be one of ${MIRROR_STATUSES.join('|')}`);
    }
    items.push({
      slug,
      harbor,
      status: status as MirrorStatus,
      kind: strOrNull(raw.kind, 40) ?? 'task',
      priority: isFiniteNumber(raw.priority) ? raw.priority : 3,
      summaryMd: typeof raw.summaryMd === 'string' ? raw.summaryMd : '',
      descriptionMd: typeof raw.descriptionMd === 'string' ? raw.descriptionMd : null,
      assigneeId: strOrNull(raw.assigneeId, 200),
      startedAt: numOrNull(raw.startedAt),
      dueAt: numOrNull(raw.dueAt),
      estimate: numOrNull(raw.estimate),
      lastTouchedAt: numOrNull(raw.lastTouchedAt) ?? generatedAt,
      createdAt: numOrNull(raw.createdAt) ?? generatedAt,
      deletedAt: numOrNull(raw.deletedAt),
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
      notes: Array.isArray(raw.notes) ? raw.notes : [],
    });
  }

  // Edges: validate the closed enum, dedupe silently (an edge set is a SET —
  // repeating a member is idempotent, not an error).
  const edges: SnapshotEdge[] = [];
  const seenEdges = new Set<string>();
  for (let i = 0; i < rawEdges.length; i++) {
    const raw = rawEdges[i] as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) return bad(400, 'BAD_EDGE', `edges[${i}] must be an object`);
    const scope = strOrNull(raw.scope, 200);
    const sourceId = strOrNull(raw.sourceId, 200);
    const targetId = strOrNull(raw.targetId, 200);
    const edgeType = raw.edgeType;
    if (!scope || !sourceId || !targetId) {
      return bad(400, 'BAD_EDGE', `edges[${i}] needs scope, sourceId, targetId`);
    }
    if (typeof edgeType !== 'string' || !(EDGE_TYPES as readonly string[]).includes(edgeType)) {
      return bad(400, 'BAD_EDGE_TYPE', `edges[${i}].edgeType must be one of ${EDGE_TYPES.join('|')}`);
    }
    const key = `${scope}\u0000${sourceId}\u0000${edgeType}\u0000${targetId}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ scope, sourceId, edgeType: edgeType as MirrorEdgeType, targetId });
  }

  // Activity: dedupe on the storage PK (at, slug, kind) — last entry wins —
  // then keep only the newest ROADMAP_ACTIVITY_CAP (the tail contract).
  const activityByKey = new Map<string, { at: number; slug: string; kind: string; byId: string | null; detail: unknown }>();
  for (let i = 0; i < rawActivity.length; i++) {
    const raw = rawActivity[i] as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) return bad(400, 'BAD_ACTIVITY', `activityTail[${i}] must be an object`);
    const at = numOrNull(raw.at);
    const slug = strOrNull(raw.slug, 200);
    const kind = strOrNull(raw.kind, 60);
    // `at` must be a POSITIVE INTEGER: it is the PK component and the sort key
    // the tail and the retention cap order by, so a fractional, zero, or
    // negative value would corrupt ordering. The storage CHECK is the
    // backstop; refusing here turns it into an explicit 400 instead of a
    // rolled-back batch.
    if (at == null || !Number.isInteger(at) || at <= 0 || !slug || !kind) {
      return bad(400, 'BAD_ACTIVITY', `activityTail[${i}] needs at (positive integer unix ms), slug, kind`);
    }
    activityByKey.set(`${at}\u0000${slug}\u0000${kind}`, {
      at, slug, kind, byId: strOrNull(raw.byId, 200), detail: raw.detail ?? null,
    });
  }
  const activity = [...activityByKey.values()].sort((a, b) => b.at - a.at).slice(0, ROADMAP_ACTIVITY_CAP);

  return {
    ok: true,
    snapshot: { repoFullName, harbor, generatedAt, daemonLabel, items, edges, activity },
  };
}

// ── ingest (full replace, one transactional batch) ────────────────────────────

/**
 * Best-effort resolution of the daemon-declared harbor label to a remote
 * harbor the pushing user belongs to.
 *
 * Why best-effort + nullable: the daemon's local harbor label and the relay's
 * X2 remote-harbor registry are different namespaces that USUALLY coincide.
 * When a membership-visible harbor of that name exists the mirror links it
 * (harbor_id) for later cross-surface joins; when not, the mirror still
 * ingests — a roadmap must never be refused because its harbor is not (yet)
 * registered remotely.
 *
 * @param env - Worker bindings (D1).
 * @param userId - The pushing account.
 * @param harbor - The daemon-declared harbor label.
 * @returns The harbors.id, or null when no visible match exists.
 */
async function resolveHarborId(env: Env, userId: string, harbor: string): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT h.id AS id FROM harbors h
         JOIN harbor_memberships m ON m.harbor_id = h.id AND m.member_kind = 'user' AND m.member_id = ?
        WHERE h.name = ? LIMIT 1`,
    )
      .bind(userId, harbor.toLowerCase())
      .first<{ id: string }>();
    return row?.id ?? null;
  } catch {
    return null; // linkage is a convenience — never fail an ingest over it
  }
}

/**
 * Replace one (user, repo) mirror with a validated snapshot, atomically.
 *
 * Design: DELETE the four table slices then INSERT the new rows, all inside
 * ONE `env.DB.batch()` — D1 executes a batch as a transaction, so a reader
 * either sees the previous snapshot or the new one, never a mix, and a
 * failing statement rolls the whole replace back. Multi-row INSERTs bind one
 * JSON array per statement and unpack it with `json_each` (~40 rows each),
 * which keeps every statement under D1's bound-parameter limit regardless of
 * column count.
 *
 * @param env - Worker bindings (D1).
 * @param userId - The resolved account id (from the credential, never the payload).
 * @param s - The validated, normalized snapshot.
 * @param receivedAt - Relay clock, unix seconds (the arrival half of the watermark).
 * @returns The stored counts (items incl. tombstones, edges, activity rows).
 */
export async function replaceRoadmapMirror(
  env: Env,
  userId: string,
  s: NormalizedSnapshot,
  receivedAt: number,
): Promise<{ itemCount: number; edgeCount: number; activityCount: number; harborId: string | null }> {
  const harborId = await resolveHarborId(env, userId, s.harbor);
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM roadmap_mirror_items WHERE user_id = ? AND repo_full_name = ?').bind(userId, s.repoFullName),
    env.DB.prepare('DELETE FROM roadmap_mirror_edges WHERE user_id = ? AND repo_full_name = ?').bind(userId, s.repoFullName),
    env.DB.prepare('DELETE FROM roadmap_mirror_activity WHERE user_id = ? AND repo_full_name = ?').bind(userId, s.repoFullName),
    env.DB.prepare('DELETE FROM roadmap_mirrors WHERE user_id = ? AND repo_full_name = ?').bind(userId, s.repoFullName),
    env.DB.prepare(
      `INSERT INTO roadmap_mirrors (user_id, repo_full_name, harbor, daemon_label, generated_at, received_at, item_count, edge_count, harbor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(userId, s.repoFullName, s.harbor, s.daemonLabel, s.generatedAt, receivedAt, s.items.length, s.edges.length, harborId),
  ];
  for (const rows of chunk(s.items, INSERT_CHUNK_ROWS)) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO roadmap_mirror_items
           (user_id, repo_full_name, harbor, slug, status, kind, priority, summary_md, description_md,
            assignee_id, started_at, due_at, estimate, last_touched_at, created_at, deleted_at,
            dependencies_json, notes_json)
         SELECT ?1, ?2, ?3,
                json_extract(value, '$.slug'), json_extract(value, '$.status'),
                json_extract(value, '$.kind'), json_extract(value, '$.priority'),
                json_extract(value, '$.summaryMd'), json_extract(value, '$.descriptionMd'),
                json_extract(value, '$.assigneeId'), json_extract(value, '$.startedAt'),
                json_extract(value, '$.dueAt'), json_extract(value, '$.estimate'),
                json_extract(value, '$.lastTouchedAt'), json_extract(value, '$.createdAt'),
                json_extract(value, '$.deletedAt'),
                json_extract(value, '$.dependencies'), json_extract(value, '$.notes')
           FROM json_each(?4)`,
      ).bind(userId, s.repoFullName, s.harbor, JSON.stringify(rows)),
    );
  }
  for (const rows of chunk(s.edges, INSERT_CHUNK_ROWS)) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO roadmap_mirror_edges (user_id, repo_full_name, scope, source_id, edge_type, target_id)
         SELECT ?1, ?2,
                json_extract(value, '$.scope'), json_extract(value, '$.sourceId'),
                json_extract(value, '$.edgeType'), json_extract(value, '$.targetId')
           FROM json_each(?3)`,
      ).bind(userId, s.repoFullName, JSON.stringify(rows)),
    );
  }
  for (const rows of chunk(s.activity, INSERT_CHUNK_ROWS)) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind, by_id, detail_json)
         SELECT ?1, ?2,
                json_extract(value, '$.at'), json_extract(value, '$.slug'), json_extract(value, '$.kind'),
                json_extract(value, '$.byId'), json_extract(value, '$.detail')
           FROM json_each(?3)`,
      ).bind(userId, s.repoFullName, JSON.stringify(rows)),
    );
  }
  await env.DB.batch(stmts);
  return { itemCount: s.items.length, edgeCount: s.edges.length, activityCount: s.activity.length, harborId };
}

// ── read model ────────────────────────────────────────────────────────────────

/**
 * Read one mirror's header (the watermark row), or null when the repo has
 * never been pushed for this account.
 *
 * Why a dedicated read: the header is the freshness contract every consumer
 * (board page, item page, verification GET) leads with — one query keeps
 * those surfaces incapable of disagreeing about staleness.
 *
 * @param env - Worker bindings (D1).
 * @param userId - The account whose mirror to read.
 * @param repo - The normalized owner/name.
 * @returns The header row, or null.
 */
export async function readMirrorHeader(env: Env, userId: string, repo: string): Promise<MirrorHeaderRow | null> {
  const row = await env.DB.prepare('SELECT * FROM roadmap_mirrors WHERE user_id = ? AND repo_full_name = ?')
    .bind(userId, repo)
    .first<MirrorHeaderRow>();
  return row ?? null;
}

/**
 * Read the board: live (non-tombstoned) items grouped by status lane,
 * freshest-touched first within each lane.
 *
 * Why tombstones are excluded HERE (and only here): the board answers "what
 * is the roadmap now"; a deleted item is not on the roadmap — but it stays
 * queryable via {@link readItemDetail} because deletion is information.
 *
 * @param env - Worker bindings (D1).
 * @param userId - The account whose mirror to read.
 * @param repo - The normalized owner/name.
 * @returns Items grouped into the five lanes (every lane present, possibly empty).
 */
export async function readBoard(env: Env, userId: string, repo: string): Promise<Record<MirrorStatus, MirrorItemRow[]>> {
  const res = await env.DB.prepare(
    `SELECT * FROM roadmap_mirror_items
      WHERE user_id = ? AND repo_full_name = ? AND deleted_at IS NULL
      ORDER BY status, last_touched_at DESC`,
  )
    .bind(userId, repo)
    .all<MirrorItemRow>();
  const board = Object.fromEntries(MIRROR_STATUSES.map((sVal) => [sVal, [] as MirrorItemRow[]])) as Record<MirrorStatus, MirrorItemRow[]>;
  for (const row of res.results ?? []) {
    (board[row.status] ?? (board[row.status] = [])).push(row);
  }
  return board;
}

/**
 * Read one item in full — tombstones INCLUDED — plus its edges in BOTH
 * directions (as source and as target).
 *
 * Why both directions: an item's place in the graph is "what I depend
 * on / parent" AND "what depends on me / my children"; serving only one
 * direction would make the detail page lie about half the structure.
 *
 * @param env - Worker bindings (D1).
 * @param userId - The account whose mirror to read.
 * @param repo - The normalized owner/name.
 * @param slug - The item slug.
 * @returns The item + outgoing/incoming edges, or null when the slug is unknown.
 */
export async function readItemDetail(
  env: Env,
  userId: string,
  repo: string,
  slug: string,
): Promise<{ item: MirrorItemRow; edgesOut: MirrorEdgeRow[]; edgesIn: MirrorEdgeRow[] } | null> {
  const item = await env.DB.prepare(
    'SELECT * FROM roadmap_mirror_items WHERE user_id = ? AND repo_full_name = ? AND slug = ? LIMIT 1',
  )
    .bind(userId, repo, slug)
    .first<MirrorItemRow>();
  if (!item) return null;
  const edgesOut = await env.DB.prepare(
    'SELECT scope, source_id, edge_type, target_id FROM roadmap_mirror_edges WHERE user_id = ? AND repo_full_name = ? AND source_id = ?',
  )
    .bind(userId, repo, slug)
    .all<MirrorEdgeRow>();
  const edgesIn = await env.DB.prepare(
    'SELECT scope, source_id, edge_type, target_id FROM roadmap_mirror_edges WHERE user_id = ? AND repo_full_name = ? AND target_id = ?',
  )
    .bind(userId, repo, slug)
    .all<MirrorEdgeRow>();
  return { item, edgesOut: edgesOut.results ?? [], edgesIn: edgesIn.results ?? [] };
}

/**
 * Read the activity tail, newest first.
 *
 * Why bounded: activity is a tail by contract ({@link ROADMAP_ACTIVITY_CAP});
 * the daemon owns full history, so the read never pages.
 *
 * @param env - Worker bindings (D1).
 * @param userId - The account whose mirror to read.
 * @param repo - The normalized owner/name.
 * @param limit - Maximum rows (default the cap).
 * @returns The newest activity rows.
 */
export async function readActivityTail(
  env: Env,
  userId: string,
  repo: string,
  limit: number = ROADMAP_ACTIVITY_CAP,
): Promise<MirrorActivityRow[]> {
  const res = await env.DB.prepare(
    `SELECT at, slug, kind, by_id, detail_json FROM roadmap_mirror_activity
      WHERE user_id = ? AND repo_full_name = ? ORDER BY at DESC LIMIT ?`,
  )
    .bind(userId, repo, limit)
    .all<MirrorActivityRow>();
  return res.results ?? [];
}

/**
 * Export every mirror an account holds — all four tables, in full — for the
 * ADR-0101 self-service /account/export path.
 *
 * Why in full: the mirror rows ARE the user's data (their own roadmaps,
 * pushed by their own daemons); an export that summarized them would fail
 * the "it leaves with them" contract the export page states.
 *
 * @param env - Worker bindings (D1).
 * @param userId - The exporting account.
 * @returns One entry per mirrored repo: header + items + edges + activity.
 */
export async function exportRoadmapMirrors(env: Env, userId: string): Promise<unknown[]> {
  const headers = await env.DB.prepare(
    'SELECT * FROM roadmap_mirrors WHERE user_id = ? ORDER BY repo_full_name',
  )
    .bind(userId)
    .all<MirrorHeaderRow>();
  const out: unknown[] = [];
  for (const h of headers.results ?? []) {
    const items = await env.DB.prepare(
      'SELECT * FROM roadmap_mirror_items WHERE user_id = ? AND repo_full_name = ? ORDER BY slug',
    )
      .bind(userId, h.repo_full_name)
      .all<MirrorItemRow>();
    const edges = await env.DB.prepare(
      'SELECT scope, source_id, edge_type, target_id FROM roadmap_mirror_edges WHERE user_id = ? AND repo_full_name = ?',
    )
      .bind(userId, h.repo_full_name)
      .all<MirrorEdgeRow>();
    const activity = await readActivityTail(env, userId, h.repo_full_name);
    out.push({
      repo: h.repo_full_name,
      harbor: h.harbor,
      daemonLabel: h.daemon_label,
      generatedAt: h.generated_at,
      receivedAt: h.received_at,
      itemCount: h.item_count,
      edgeCount: h.edge_count,
      items: (items.results ?? []).map(itemJson),
      edges: (edges.results ?? []).map(edgeJson),
      activity: activity.map(activityJson),
    });
  }
  return out;
}

// ── JSON projections (one shape for every consumer) ───────────────────────────

/**
 * Project a stored item row to the wire (camelCase; JSON bags parsed).
 *
 * Why one projection: the board, the item detail, and the account export all
 * serve items — a single shape keeps those surfaces incapable of
 * disagreeing, and the explicit `deleted` flag makes tombstones legible by
 * design instead of asking every consumer to interpret deletedAt.
 *
 * @param r - The stored roadmap_mirror_items row.
 * @returns The wire representation.
 */
function itemJson(r: MirrorItemRow): Record<string, unknown> {
  return {
    slug: r.slug,
    harbor: r.harbor,
    status: r.status,
    kind: r.kind,
    priority: r.priority,
    summaryMd: r.summary_md,
    descriptionMd: r.description_md,
    assigneeId: r.assignee_id,
    startedAt: r.started_at,
    dueAt: r.due_at,
    estimate: r.estimate,
    lastTouchedAt: r.last_touched_at,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
    deleted: r.deleted_at != null,
    dependencies: safeParse(r.dependencies_json, []),
    notes: safeParse(r.notes_json, []),
  };
}

/**
 * Project a stored edge row to the wire.
 *
 * Why: same single-projection rationale as itemJson — detail reads and the
 * export must emit identical edge shapes.
 *
 * @param r - The stored roadmap_mirror_edges row.
 * @returns The wire representation.
 */
function edgeJson(r: MirrorEdgeRow): Record<string, unknown> {
  return { scope: r.scope, sourceId: r.source_id, edgeType: r.edge_type, targetId: r.target_id };
}

/**
 * Project a stored activity row to the wire.
 *
 * Why: same single-projection rationale as itemJson; `detail` is re-inflated
 * from its stored JSON so consumers get structure, not a string.
 *
 * @param r - The stored roadmap_mirror_activity row.
 * @returns The wire representation.
 */
function activityJson(r: MirrorActivityRow): Record<string, unknown> {
  return { at: r.at, slug: r.slug, kind: r.kind, byId: r.by_id, detail: safeParse(r.detail_json, null) };
}

/**
 * Parse stored JSON defensively.
 *
 * Why: the CHECK constraints keep these columns valid, but a read path must
 * still never throw over one row — the fallback keeps the whole response
 * serving (defense in depth over a single layer).
 *
 * @param s - The stored JSON text (or null).
 * @param fallback - Value to return when null/unparsable.
 * @returns The parsed value or the fallback.
 */
function safeParse(s: string | null, fallback: unknown): unknown {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return fallback;
  }
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

/**
 * PUT /v1/roadmap/snapshot — the daemon's push path.
 *
 * Auth: pdu_ bearer (a paired daemon) or the session cookie, via
 * resolveUserFromRequest — the same dual gate as the other /v1 account
 * surfaces, with isSameOrigin as the CSRF layer for the cookie case. The
 * mirror lands under the CREDENTIAL's user id, so one account can never
 * write another's mirror regardless of what the payload claims.
 *
 * Guards: >2 MB body or >5000 items are refused with explicit JSON errors
 * (413) BEFORE any storage work; malformed JSON is a 400. Why refuse loudly
 * instead of truncating: a silently trimmed mirror would be a lie — the
 * design prefers a daemon that KNOWS its snapshot was too big.
 *
 * @param request - The incoming PUT.
 * @param env - Worker bindings.
 * @returns 200 { code:'OK', … counts + watermark }; 4xx explicit refusals.
 */
export async function handleRoadmapSnapshotPut(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  const user = await resolveUserFromRequest(request, env);
  if (!user) return json(401, { code: 'UNAUTHENTICATED', error: 'pdu_ bearer token or session required' });

  // Size gate first — Content-Length when the client declares it, then the
  // actual body — so an oversized push is refused as cheaply as possible.
  const declared = parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_SNAPSHOT_BYTES) {
    return json(413, { code: 'PAYLOAD_TOO_LARGE', error: `snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes` });
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json(400, { code: 'BAD_PAYLOAD', error: 'unreadable request body' });
  }
  if (raw.length > MAX_SNAPSHOT_BYTES) {
    return json(413, { code: 'PAYLOAD_TOO_LARGE', error: `snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes` });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return json(400, { code: 'BAD_JSON', error: 'body must be valid JSON' });
  }
  const validated = validateSnapshotPayload(body);
  if (!validated.ok) {
    return json(validated.invalid.status, { code: validated.invalid.code, error: validated.invalid.error });
  }
  const receivedAt = Math.floor(Date.now() / 1000);
  const stored = await replaceRoadmapMirror(env, user.id, validated.snapshot, receivedAt);
  return json(200, {
    code: 'OK',
    error: null,
    repo: validated.snapshot.repoFullName,
    harbor: validated.snapshot.harbor,
    harborId: stored.harborId,
    generatedAt: validated.snapshot.generatedAt,
    receivedAt,
    itemCount: stored.itemCount,
    edgeCount: stored.edgeCount,
    activityCount: stored.activityCount,
  });
}

/**
 * GET /v1/roadmap/mirror?repo=owner/name[&slug=…] — the verification read.
 *
 * Auth: session cookie or pdu_ bearer (resolveUserFromRequest) — the reader
 * only ever sees their OWN account's mirror. Without `slug` the response is
 * the header (watermark) + the board grouped by status + the activity tail;
 * with `slug` it is that item in full (tombstones included, marked
 * `deleted`) plus its edges in both directions. Why one endpoint with a
 * `slug` switch: the verification read and the future board/item pages share
 * a single query surface by design, so the pages can never drift from what
 * this endpoint proves.
 *
 * @param request - The incoming GET.
 * @param env - Worker bindings.
 * @returns 200 mirror JSON; 400 bad params; 401 unauthenticated; 404 no mirror/slug.
 */
export async function handleRoadmapMirrorGet(request: Request, env: Env): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return json(401, { code: 'UNAUTHENTICATED', error: 'pdu_ bearer token or session required' });
  const url = new URL(request.url);
  const repo = normalizeRepoFullName(url.searchParams.get('repo'));
  if (!repo) return json(400, { code: 'BAD_REPO', error: 'repo must be owner/name' });
  const header = await readMirrorHeader(env, user.id, repo);
  if (!header) return json(404, { code: 'NO_MIRROR', error: `no roadmap mirror for ${repo} on this account` });
  const headerBody = {
    repo: header.repo_full_name,
    harbor: header.harbor,
    harborId: header.harbor_id,
    daemonLabel: header.daemon_label,
    generatedAt: header.generated_at, // daemon clock, unix ms — the honest watermark
    receivedAt: header.received_at, // relay clock, unix seconds
    itemCount: header.item_count,
    edgeCount: header.edge_count,
  };
  const slug = url.searchParams.get('slug');
  if (slug) {
    const detail = await readItemDetail(env, user.id, repo, slug);
    if (!detail) return json(404, { code: 'NO_ITEM', error: `no mirrored item '${slug}' for ${repo}` });
    return json(200, {
      code: 'OK',
      error: null,
      mirror: headerBody,
      item: itemJson(detail.item),
      edgesOut: detail.edgesOut.map(edgeJson),
      edgesIn: detail.edgesIn.map(edgeJson),
    });
  }
  const board = await readBoard(env, user.id, repo);
  const activity = await readActivityTail(env, user.id, repo);
  return json(200, {
    code: 'OK',
    error: null,
    mirror: headerBody,
    board: Object.fromEntries(MIRROR_STATUSES.map((lane) => [lane, (board[lane] ?? []).map(itemJson)])),
    activity: activity.map(activityJson),
  });
}
