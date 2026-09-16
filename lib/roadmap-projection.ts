/**
 * Roadmap Projection — "roadmap is home" (operator decision 4; binder ch19:
 * the fleet is plumbing, the front door is intent).
 *
 * ONE versioned, deterministic read model of the roadmap for every home
 * surface. The three consumers are:
 *
 *   1. web    — the relay account page home (apps/relay/src/account-page.ts)
 *   2. console — pd-console's roadmap-home pane (core/pd-console)
 *   3. iOS    — the Port Daddy iOS app's home screen (apps/pd-ios)
 *
 * PARSIMONY LAW: those surfaces render THIS projection — they never re-derive
 * roadmap state from roadmap_items / claims / dispatches themselves. One
 * derivation, three renderers. A surface that needs a field the projection
 * lacks adds it HERE (additively, tolerant-reader on the consumer side), so
 * the three homes can never drift apart on what "the roadmap" says.
 *
 * Contract (mirrors lib/agent-harbor/projections.ts, binder ch18 C1 /
 * ADR-0095):
 *   - Disposable read model: derived on demand from the durable tables
 *     (roadmap_items, roadmap_item_status_events, roadmap_claims,
 *     dispatches). Nothing is written; the projection can be thrown away and
 *     rebuilt from the DB at any time.
 *   - Tolerant reader: optional columns (popper's nightshift_eligible /
 *     dispatch_id, planner's kind / priority, the deleted_at tombstone) and
 *     optional tables (roadmap_claims, dispatches, status events) may be
 *     absent on older DBs — the projection degrades field-by-field instead of
 *     crashing.
 *   - Deterministic serialization: item order is total (status rank, then
 *     priority, then last_touched_at DESC, then slug), receipt order is total,
 *     and serializeRoadmapProjection() emits canonical sorted-key JSON — the
 *     same DB and the same clock produce byte-identical output, so consumers
 *     can diff projections.
 *
 * Design law 13 (content honesty, binder ch20 §Content honesty laws): "LIVE
 * renders only with stream evidence or a recent heartbeat and says so".
 * liveEvidence here is structurally honest:
 *   - An item with NO popper receipt trail (no dispatch_id stamp) can NEVER
 *     be live — computeLiveEvidence returns live:false before it ever looks
 *     at a clock.
 *   - With a trail, live:true additionally requires stream evidence (dispatch
 *     row timestamps / status-event audit rows) fresher than
 *     ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS (the AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS
 *     precedent) and a non-terminal dispatch state.
 *   - Anything else is labeled stale/static on its face ("showing cached
 *     truth — last evidence 47s") — the projection never fakes freshness.
 *
 * Harbor anchoring mirrors resolveRoadmapHarbor (cli/commands/roadmap.ts):
 * explicit override > $PD_HARBOR > git worktree canonical-root basename >
 * basename(harborRoot). Linked worktrees collapse to the canonical repo root,
 * so every worktree of one project projects the SAME board — anything else
 * re-creates the "harbor split" bug that forked receipts off the project
 * board.
 */

import { basename, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { getWorktreeInfo, type WorktreeInfo } from './worktree.js';
import { AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS } from './agent-run-receipts.js';
import type { RoadmapStatus } from './roadmap-items.js';

export const ROADMAP_PROJECTION_VERSION = 1 as const;

/** A live claim is only trustworthy while its stream evidence is this fresh. */
export const ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS = AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS;

/**
 * How far ahead of the reader's clock an evidence timestamp may sit before the
 * projection stops believing it.
 *
 * Distributed clocks disagree by seconds routinely — a daemon a second ahead is
 * not lying — so a small forward window stays live. Beyond it, the row is not
 * evidence of anything that has happened, and treating it as fresh is exactly
 * the fake freshness law 13 forbids: `Math.max(0, now - at)` clamped negative
 * ages to 0, so ONE future-dated row rendered "live — events arriving"
 * permanently, immune to the freshness window entirely.
 */
export const ROADMAP_LIVE_EVIDENCE_MAX_SKEW_MS = 30_000;

/** Dispatch states that mean "the work already ended" — never live. */
const TERMINAL_DISPATCH_STATES = new Set([
  'accepted',
  'rejected',
  'settled',
  'failed',
  'salvage',
]);

const DEFAULT_HARBOR = 'fleet';
const DO_THIS_NEXT_MAX = 5;

// Same rank as roadmap-items.ts STATUS_RANK_SQL — the front door leads with
// intent ('now'), then work in flight to merge, then the piles.
const STATUS_RANK: Record<RoadmapStatus, number> = {
  now: 0,
  merge: 1,
  backlog: 2,
  parked: 3,
  done: 4,
};

export type RoadmapReceiptKind = 'status-event' | 'note' | 'dispatch';

export interface RoadmapProjectionReceipt {
  kind: RoadmapReceiptKind;
  at: number;
  by: string | null;
  detail: string;
}

export interface RoadmapProjectionClaim {
  claimedBy: string;
  claimedAt: number;
  kind: string;
  sessionId: string | null;
  agentId: string | null;
}

export interface RoadmapLiveEvidence {
  /** true ONLY with a popper receipt trail AND fresh stream evidence (law 13). */
  live: boolean;
  /** The only stream source the projection recognizes today. */
  source: 'popper-dispatch' | null;
  dispatchId: string | null;
  lastEvidenceAt: number | null;
  ageMs: number | null;
  maxAgeMs: number;
  /** Honest, renderable freshness label — states staleness on its face. */
  label: string;
}

export interface RoadmapProjectionItem {
  id: string;
  slug: string;
  title: string;
  status: RoadmapStatus;
  priority: number;
  claim: RoadmapProjectionClaim | null;
  receipts: RoadmapProjectionReceipt[];
  liveEvidence: RoadmapLiveEvidence;
  lastTouchedAt: number;
  dependencies: string[];
}

export interface RoadmapDoThisNextEntry {
  slug: string;
  title: string;
  reason: 'status-now' | 'popper-next';
}

export interface RoadmapProjection {
  v: typeof ROADMAP_PROJECTION_VERSION;
  harbor: string;
  generatedAt: number;
  items: RoadmapProjectionItem[];
  doThisNext: RoadmapDoThisNextEntry[];
}

export interface BuildRoadmapProjectionOptions {
  /** Explicit harbor override (route ?harbor= / CLI --harbor equivalent). */
  harbor?: string;
  /** Clock injection — the determinism pin injects a fixed clock. */
  now?: () => number;
  /** Env injection for $PD_HARBOR parity with resolveRoadmapHarbor. */
  env?: Record<string, string | undefined>;
  /** Worktree probe injection (defaults to the real git probe). */
  getWorktree?: (root: string) => WorktreeInfo | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Harbor anchoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the harbor a projection of `harborRoot` reads. Mirrors
 * resolveRoadmapHarbor (cli/commands/roadmap.ts) so read and write surfaces
 * agree on the board: explicit > $PD_HARBOR > canonical worktree root
 * basename > basename(harborRoot) > 'fleet'. Linked worktrees collapse to
 * the canonical root — two worktrees of one repo project identically.
 */
export function resolveProjectionHarbor(
  harborRoot: string,
  options: BuildRoadmapProjectionOptions = {},
): string {
  if (options.harbor && options.harbor.trim()) return options.harbor.trim();
  const env = options.env ?? process.env;
  const fromEnv = env.PD_HARBOR?.trim();
  if (fromEnv) return fromEnv;
  const probe = options.getWorktree ?? getWorktreeInfo;
  const worktree = probe(harborRoot);
  if (worktree) {
    const commonDir = resolve(worktree.root, worktree.commonDir);
    const canonicalRoot =
      basename(commonDir) === '.git' ? resolve(commonDir, '..') : worktree.root;
    const projectName = basename(canonicalRoot);
    if (projectName) return projectName;
  }
  return basename(harborRoot) || DEFAULT_HARBOR;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tolerant-reader plumbing
// ─────────────────────────────────────────────────────────────────────────────

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);
  return row != null;
}

function tableColumns(db: Database.Database, name: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((d): d is string => typeof d === 'string')
      : [];
  } catch {
    return [];
  }
}

interface ParsedNote {
  at: number;
  by: string | null;
  text: string;
}

function parseNotes(value: unknown): ParsedNote[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const out: ParsedNote[] = [];
    for (const raw of parsed) {
      if (!raw || typeof raw !== 'object') continue;
      const note = raw as { at?: unknown; by?: unknown; text?: unknown };
      const at = asFiniteNumber(note.at);
      const text = typeof note.text === 'string' ? note.text : null;
      if (at === null || !text) continue;
      out.push({ at, by: asNullableString(note.by), text });
    }
    return out;
  } catch {
    return [];
  }
}

/** First non-empty line of summary_md, stripped of heading/bullet markers. */
function titleFromSummary(summaryMd: string): string {
  for (const rawLine of summaryMd.split('\n')) {
    const line = rawLine.replace(/^[#>\s*-]+/, '').trim();
    if (line) return line;
  }
  return summaryMd.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Law-13 live evidence
// ─────────────────────────────────────────────────────────────────────────────

interface DispatchEvidence {
  state: string | null;
  requestedBy: string | null;
  createdAt: number | null;
  lastEventAt: number | null;
}

/**
 * Law-13 gate. Structure enforces honesty: the no-trail branch returns before
 * any clock is consulted, so an item without a popper receipt trail can never
 * emit live:true, whatever its timestamps say.
 */
function computeLiveEvidence(input: {
  dispatchId: string | null;
  dispatch: DispatchEvidence | null;
  statusEventAts: number[];
  now: number;
}): RoadmapLiveEvidence {
  const maxAgeMs = ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS;
  if (!input.dispatchId) {
    return {
      live: false,
      source: null,
      dispatchId: null,
      lastEvidenceAt: null,
      ageMs: null,
      maxAgeMs,
      label: 'static — no dispatch receipt trail',
    };
  }

  const evidenceAts = [...input.statusEventAts];
  if (input.dispatch) {
    if (input.dispatch.createdAt !== null) evidenceAts.push(input.dispatch.createdAt);
    if (input.dispatch.lastEventAt !== null) evidenceAts.push(input.dispatch.lastEventAt);
  }
  const lastEvidenceAt = evidenceAts.length ? Math.max(...evidenceAts) : null;

  const state = input.dispatch?.state ?? null;
  if (state && TERMINAL_DISPATCH_STATES.has(state)) {
    return {
      live: false,
      source: 'popper-dispatch',
      dispatchId: input.dispatchId,
      lastEvidenceAt,
      ageMs: lastEvidenceAt !== null ? Math.max(0, input.now - lastEvidenceAt) : null,
      maxAgeMs,
      label: `settled — dispatch ${state}`,
    };
  }

  if (lastEvidenceAt === null) {
    return {
      live: false,
      source: 'popper-dispatch',
      dispatchId: input.dispatchId,
      lastEvidenceAt: null,
      ageMs: null,
      maxAgeMs,
      label: 'stale — dispatch trail without stream evidence',
    };
  }

  // Future-dated evidence is refused BEFORE the freshness comparison: the
  // clamp below would otherwise turn a negative age into 0 and make it look
  // maximally fresh. Fails closed — an unbelievable timestamp yields
  // not-live, never live.
  const skewMs = lastEvidenceAt - input.now;
  if (skewMs > ROADMAP_LIVE_EVIDENCE_MAX_SKEW_MS) {
    return {
      live: false,
      source: 'popper-dispatch',
      dispatchId: input.dispatchId,
      lastEvidenceAt,
      ageMs: 0,
      maxAgeMs,
      label: `unverifiable — evidence dated ${Math.round(skewMs / 1000)}s in the future`,
    };
  }

  const ageMs = Math.max(0, input.now - lastEvidenceAt);
  if (ageMs <= maxAgeMs) {
    return {
      live: true,
      source: 'popper-dispatch',
      dispatchId: input.dispatchId,
      lastEvidenceAt,
      ageMs,
      maxAgeMs,
      label: 'live — events arriving',
    };
  }
  return {
    live: false,
    source: 'popper-dispatch',
    dispatchId: input.dispatchId,
    lastEvidenceAt,
    ageMs,
    maxAgeMs,
    label: `showing cached truth — last evidence ${Math.round(ageMs / 1000)}s`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The projection
// ─────────────────────────────────────────────────────────────────────────────

interface RawItemRow {
  id: string;
  slug: string;
  summary_md: string;
  status: string;
  last_touched_at: number;
  dependencies_json?: string;
  notes_json?: string;
  harbor: string;
  // Optional columns, tolerant-read:
  priority?: unknown;
  nightshift_eligible?: unknown;
  dispatch_id?: unknown;
  deleted_at?: unknown;
}

export function buildRoadmapProjection(
  db: Database.Database,
  harborRoot: string,
  options: BuildRoadmapProjectionOptions = {},
): RoadmapProjection {
  const now = options.now ?? (() => Date.now());
  const at = now();
  const harbor = resolveProjectionHarbor(harborRoot, options);

  const itemCols = tableColumns(db, 'roadmap_items');
  const hasDeletedAt = itemCols.has('deleted_at');
  const rows = db
    .prepare(
      `SELECT * FROM roadmap_items WHERE harbor = ?${
        hasDeletedAt ? ' AND deleted_at IS NULL' : ''
      }`,
    )
    .all(harbor) as RawItemRow[];

  // Status-event audit rows (receipt trail) per item id.
  const statusEventsByItem = new Map<
    string,
    Array<{ at: number; by: string | null; status: string }>
  >();
  if (tableExists(db, 'roadmap_item_status_events') && rows.length) {
    const events = db
      .prepare(
        `SELECT item_id, status, by_agent_id, at
           FROM roadmap_item_status_events WHERE harbor = ?`,
      )
      .all(harbor) as Array<{
      item_id: string;
      status: string;
      by_agent_id: string | null;
      at: number;
    }>;
    for (const event of events) {
      const list = statusEventsByItem.get(event.item_id) ?? [];
      list.push({ at: event.at, by: event.by_agent_id, status: event.status });
      statusEventsByItem.set(event.item_id, list);
    }
  }

  // Active claims (roadmap_claims, released_at IS NULL) per slug.
  const claimsBySlug = new Map<string, RoadmapProjectionClaim>();
  if (tableExists(db, 'roadmap_claims')) {
    const claims = db
      .prepare(
        `SELECT slug, kind, claimed_by, claimed_at, session_id, agent_id
           FROM roadmap_claims WHERE released_at IS NULL`,
      )
      .all() as Array<{
      slug: string;
      kind: string;
      claimed_by: string;
      claimed_at: number;
      session_id: string | null;
      agent_id: string | null;
    }>;
    for (const claim of claims) {
      claimsBySlug.set(claim.slug, {
        claimedBy: claim.claimed_by,
        claimedAt: claim.claimed_at,
        kind: claim.kind,
        sessionId: claim.session_id ?? null,
        agentId: claim.agent_id ?? null,
      });
    }
  }

  // Dispatch rows (stream evidence for the popper trail), when present.
  const hasDispatches = tableExists(db, 'dispatches');
  const dispatchStmt = hasDispatches
    ? db.prepare(
        `SELECT state, requested_by, created_at, claimed_at, started_at,
                produced_at, reviewed_at, settled_at
           FROM dispatches WHERE id = ?`,
      )
    : null;

  function dispatchEvidence(dispatchId: string): DispatchEvidence | null {
    if (!dispatchStmt) return null;
    const row = dispatchStmt.get(dispatchId) as
      | {
          state: string | null;
          requested_by: string | null;
          created_at: number | null;
          claimed_at: number | null;
          started_at: number | null;
          produced_at: number | null;
          reviewed_at: number | null;
          settled_at: number | null;
        }
      | undefined;
    if (!row) return null;
    const stamps = [
      row.created_at,
      row.claimed_at,
      row.started_at,
      row.produced_at,
      row.reviewed_at,
      row.settled_at,
    ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return {
      state: asNullableString(row.state),
      requestedBy: asNullableString(row.requested_by),
      createdAt: asFiniteNumber(row.created_at),
      lastEventAt: stamps.length ? Math.max(...stamps) : null,
    };
  }

  const doneSlugs = new Set(
    rows.filter((r) => r.status === 'done').map((r) => r.slug),
  );

  const items: RoadmapProjectionItem[] = rows.map((row) => {
    const status = (
      row.status in STATUS_RANK ? row.status : 'backlog'
    ) as RoadmapStatus;
    const dispatchId = asNullableString(row.dispatch_id);
    const dispatch = dispatchId ? dispatchEvidence(dispatchId) : null;
    const statusEvents = statusEventsByItem.get(row.id) ?? [];
    const notes = parseNotes(row.notes_json);

    const receipts: RoadmapProjectionReceipt[] = [];
    for (const event of statusEvents) {
      receipts.push({
        kind: 'status-event',
        at: event.at,
        by: event.by,
        detail: `status -> ${event.status}`,
      });
    }
    for (const note of notes) {
      receipts.push({ kind: 'note', at: note.at, by: note.by, detail: note.text });
    }
    if (dispatchId) {
      receipts.push({
        kind: 'dispatch',
        at: dispatch?.createdAt ?? row.last_touched_at,
        by: dispatch?.requestedBy ?? 'roadmap-popper',
        detail: `dispatch ${dispatchId}${dispatch?.state ? ` (${dispatch.state})` : ''}`,
      });
    }
    // Total receipt order: at, then kind, then detail — deterministic.
    // Code-unit comparison, not localeCompare, for the reason given at the item
    // sort below: localeCompare reads the host locale, so it cannot be part of
    // an order this module calls canonical. `detail` is the one that made this
    // more than theoretical — it interpolates free-form dispatch state, so it
    // is the field most likely to carry mixed case or non-ASCII.
    receipts.sort(
      (a, b) =>
        a.at - b.at ||
        (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
        (a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0),
    );

    return {
      id: row.id,
      slug: row.slug,
      title: titleFromSummary(row.summary_md),
      status,
      priority: asFiniteNumber(row.priority) ?? 3,
      claim: claimsBySlug.get(row.slug) ?? null,
      receipts,
      liveEvidence: computeLiveEvidence({
        dispatchId,
        dispatch,
        statusEventAts: statusEvents.map((e) => e.at),
        now: at,
      }),
      lastTouchedAt: row.last_touched_at,
      dependencies: parseStringArray(row.dependencies_json),
    };
  });

  // Total item order: status rank, priority, freshest-first, slug tiebreak.
  //
  // The slug tiebreak compares code units, NOT localeCompare. Two reasons, and
  // the first alone is disqualifying:
  //
  //   1. localeCompare consults the host's default locale, so this "canonical"
  //      order was not actually canonical — the same projection could serialize
  //      in two different orders on two machines, which is the one thing a
  //      canonical serialization may not do.
  //   2. It disagrees with the other consumers of this projection. iOS sorts
  //      with Swift's `<` and the console with a plain byte compare; only this
  //      side was locale-aware. Demonstrated: 'alpha'.localeCompare('Beta') is
  //      -1 while 'alpha' < 'Beta' is false, so a mixed-case pair of slugs came
  //      out in one order on the web and the opposite order on the phone, from
  //      one projection that claims to define the order.
  //
  // Code-unit comparison is what the Swift and Rust consumers already do, so
  // this side moves to them rather than asking two other languages to
  // reimplement ICU collation.
  items.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.priority - b.priority ||
      b.lastTouchedAt - a.lastTouchedAt ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );

  // doThisNext: intent first ('now' items, already sorted), then the popper's
  // next candidate — nightshift-eligible backlog, unclaimed by any dispatch,
  // dependencies all done (mirrors lib/roadmap-popper.ts nextCandidate).
  const doThisNext: RoadmapDoThisNextEntry[] = [];
  for (const item of items) {
    if (item.status !== 'now') break; // items are status-rank sorted
    if (doThisNext.length >= DO_THIS_NEXT_MAX) break;
    doThisNext.push({ slug: item.slug, title: item.title, reason: 'status-now' });
  }
  if (doThisNext.length < DO_THIS_NEXT_MAX) {
    const nightshiftEligible = new Set(
      rows
        .filter((r) => asFiniteNumber(r.nightshift_eligible) === 1)
        .map((r) => r.id),
    );
    const popperCandidate = items.find(
      (item) =>
        item.status === 'backlog' &&
        nightshiftEligible.has(item.id) &&
        item.liveEvidence.dispatchId === null &&
        item.dependencies.every((dep) => doneSlugs.has(dep)),
    );
    if (popperCandidate && !doThisNext.some((e) => e.slug === popperCandidate.slug)) {
      doThisNext.push({
        slug: popperCandidate.slug,
        title: popperCandidate.title,
        reason: 'popper-next',
      });
    }
  }

  return {
    v: ROADMAP_PROJECTION_VERSION,
    harbor,
    generatedAt: at,
    items,
    doThisNext,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic serialization
// ─────────────────────────────────────────────────────────────────────────────

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical JSON: recursively sorted keys, compact separators. The same
 * projection value always serializes to the same bytes, so consumers can
 * cache-key and diff the projection instead of re-deriving roadmap state.
 */
export function serializeRoadmapProjection(projection: RoadmapProjection): string {
  return JSON.stringify(canonicalize(projection));
}
