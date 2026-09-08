/**
 * Roadmap Activity — the live-work join between the roadmap and the fleet.
 *
 * Operator mandate (2026-08-22): "Make sure the roadmap stuff shows ACTIVE
 * IN PROGRESS AGENT WORK" and enables jumping straight into a live agent's
 * transcript. This module is the DATA layer for that command-center view:
 * given a roadmap item (or the whole board), it answers "who is working on
 * this RIGHT NOW, how alive are they, and where do I watch / steer them?"
 *
 * Why a separate module instead of growing lib/roadmap-items.ts: the roadmap
 * table is the durable plan-of-record; this is a *derived, ephemeral* join
 * across four coordination stores that must never gain write authority over
 * the plan. Keeping it read-only and disjoint also keeps this slice free of
 * conflicts with concurrent roadmap-items work.
 *
 * Join paths (all real, none synthesized):
 *   1. `roadmap_claims` (lib/roadmap-pop.ts, ADR-0033/0034) — active claims
 *      (released_at IS NULL) carry slug + session_id + agent_id. Claims tell
 *      you WHO has an item.
 *   2. `sessions.metadata.roadmapLink` (lib/sugar.ts rent-at-claim S3) —
 *      active sessions stamped with the roadmap slug they serve.
 *   3. `roadmap_items.assignee_id` (migration 085, ADR-0086) — the durable
 *      plan-time owner, resolved against BOTH the live agent registry
 *      (`agents`) and the durable roster projection (`harbor_proj_roster`,
 *      ADR-0095), whose `current_session_id` links back to live sessions.
 *   4. `dispatches` (migration 083, ADR-0035/0086) — the canonical run-time
 *      lifecycle. `dispatches.slug` is the roadmap slug and `state` is the
 *      10-state machine (proposed → claimed → in_progress → produced →
 *      review_pending → accepted/rejected → settled, plus failed/salvage).
 *      Dispatches tell you WHERE an item is in the lifecycle; an in-flight
 *      dispatch's session_id is also a work attachment.
 *
 * The operator-facing stage (`stacked → executing → review → done`) is a
 * DOCUMENTED ROLLUP over those canonical states — see `classifyStage` for
 * the exact mapping. failed/rejected/salvage dispatch states are surfaced
 * honestly on the item (`dispatch.state` + `needsAttention`), never hidden
 * inside `done`.
 *
 * Liveness is honest by construction: attachments are classified through
 * `classifySessionLiveness` (lib/session-liveness.ts) using the daemon's
 * REAL stale-threshold ladder from lib/agents.ts (stale = 0.6 × dead, by
 * agent status). A session whose freshest heartbeat is older than its stale
 * threshold is reported `stale`, never `active` — a stale pane is annoying,
 * a lying pane is dangerous.
 *
 * Cockpit links are the deterministic control surfaces the Agent Cockpit
 * already serves (routes/agent-cockpit.ts): `GET /agents/:id/stream` (merged
 * SSE) plus the transcript timeline `GET /sessions/:id/events`
 * (routes/agent-harbor.ts). This module only *emits URLs* for surfaces that
 * exist — it never invents endpoints. Interrupt/steer is deliberately NOT
 * represented as a working control: today's `POST /agents/:id/interrupt` is
 * a publish-only soft signal with no delivery/ack lifecycle, so it ships as
 * a capability-flagged affordance (`available: false`) that names the soft
 * signal AND the planned acknowledged control ingress — see
 * {@link RoadmapInterruptAffordance}. Unproven control is never shown wired.
 *
 * HITL: the only interruption store the daemon can honestly serve today is
 * the held trust-gate spawn approvals (lib/fleet/approval-stream.ts,
 * ADR-0093 L2). Those are keyed by fleet persona name, so they attach to an
 * activity row only on an exact agent-id/name match. Richer HITL (relay-side
 * gates, per-turn pauses) is an extension point, not fabricated here.
 */

import type Database from 'better-sqlite3';
import { classifySessionLiveness } from './session-liveness.js';
import { getStaleThresholdForStatus } from './agents.js';
import { getSharedApprovalStream } from './fleet/approval-stream.js';

/**
 * The operator's flow vocabulary for a roadmap item's lifecycle stage.
 * stacked (no live work) → executing (live agent driving it) → review
 * (a PR is open for it) → done. Chosen over the raw roadmap status enum
 * because the board header speaks flow, not storage.
 */
export type RoadmapActivityStage = 'stacked' | 'executing' | 'review' | 'done';

/**
 * Honest liveness of one work attachment. `active` = heartbeat within the
 * daemon's stale threshold for that agent's status; `stale` = the work
 * context exists but nothing has heartbeated recently enough to call it
 * live; `done` = the session was explicitly completed (an unreleased claim
 * on a finished session is salvage signal, not live work).
 */
export type RoadmapAttachmentLiveness = 'active' | 'stale' | 'done';

/** Which join path produced (or corroborated) an attachment. */
export type RoadmapAttachmentSource =
  | 'claim'
  | 'session-link'
  | 'assignee-agent'
  | 'assignee-node'
  | 'dispatch';

/**
 * The canonical dispatch lifecycle enum (migration 083, ADR-0035).
 * This module never invents states — it reads exactly this vocabulary and
 * rolls it up for the operator (see {@link classifyStage}).
 */
export type DispatchState =
  | 'proposed'
  | 'claimed'
  | 'in_progress'
  | 'produced'
  | 'review_pending'
  | 'accepted'
  | 'rejected'
  | 'settled'
  | 'failed'
  | 'salvage';

/** Dispatch states that mean a worker is (or should be) driving right now. */
const DISPATCH_EXECUTING_STATES = new Set<DispatchState>(['claimed', 'in_progress', 'produced']);
/** Dispatch terminal-success states (the only ones allowed to roll up to done). */
const DISPATCH_DONE_STATES = new Set<DispatchState>(['accepted', 'settled']);
/** Dispatch states that demand operator attention — NEVER rolled into done. */
const DISPATCH_ATTENTION_STATES = new Set<DispatchState>(['failed', 'rejected', 'salvage']);

/**
 * The roadmap item's canonical dispatch record (WHERE it is in the
 * lifecycle), surfaced verbatim next to the operator rollup so the honest
 * state is always one field away from the pretty one.
 */
export interface RoadmapItemDispatch {
  id: string;
  state: DispatchState;
  sessionId: string | null;
  workerActorId: string | null;
  branch: string | null;
  resultArtifact: string | null;
  errorMessage: string | null;
  createdAt: number;
}

/**
 * Honest interrupt/steer affordance. Design rationale: the existing
 * `POST /agents/:id/interrupt` (routes/agent-cockpit.ts) only PUBLISHES a
 * `control.interrupt` envelope onto the `agent:<id>` channel — there is no
 * delivery/ack/failed/expired lifecycle and no daemon-witnessed proof any
 * loop observed it. Representing that as a wired control would be a lie the
 * operator discovers at the worst moment, so `available` is hard-false until
 * an acknowledged control-command ingress exists. The soft signal is still
 * linked (it is real, just best-effort), and the planned contract is named
 * so the UI slice can build the disabled affordance against a stable shape.
 */
export interface RoadmapInterruptAffordance {
  /** FALSE until an acknowledged control-command lifecycle exists. */
  available: false;
  /** Why the control is not represented as wired. */
  reason: string;
  /** Exists today: fire-and-forget publish of control.interrupt (no ack). */
  softSignalUrl: string;
  /** EXTENSION POINT: the planned acknowledged control ingress route. */
  plannedRoute: '/agent-nodes/:id/control';
  /** EXTENSION POINT: the planned verb vocabulary for that ingress. */
  plannedVerbs: ['interrupt', 'steer'];
}

/**
 * Cockpit links for a live agent — only surfaces that exist and behave as
 * labeled. Deterministic from the agent id, so the UI can render the
 * "watch" button (and the honestly-disabled interrupt affordance) without
 * a second query.
 */
export interface RoadmapCockpitLinks {
  /** Steering channel convention shared with the cockpit: `agent:<id>`. */
  steeringChannel: string;
  /** Merged SSE feed (status + tube + transcript): GET /agents/:id/stream. */
  streamUrl: string;
  /** Interrupt/steer, capability-flagged honest (see the type's doc). */
  interrupt: RoadmapInterruptAffordance;
}

/** A held HITL spawn approval attached to an agent (ADR-0093 L2). */
export interface RoadmapHitlApproval {
  id: string;
  agent: string;
  trigger: string;
  tier: string;
  project: string;
  reason: string | null;
  timestamp: number;
  /** POST here with a decision body — routes/fleet-approvals.ts. */
  decisionUrl: string;
}

/** An active claim row (roadmap_claims) referencing the item's slug. */
export interface RoadmapAttachmentClaim {
  id: number;
  kind: string;
  claimedBy: string;
  claimedAt: number;
}

/**
 * One unit of in-flight work referencing a roadmap item: the session/agent
 * pair (or durable roster node) plus honest liveness and the cockpit links
 * needed to jump into it.
 */
export interface RoadmapWorkAttachment {
  /** Stable dedupe key (session id, else agent id, else node id). */
  key: string;
  /** Every join path that produced or corroborated this attachment. */
  sources: RoadmapAttachmentSource[];
  agentId: string | null;
  agentName: string | null;
  /** True when the agent id resolves in the live registry — interrupt will 404 otherwise. */
  agentRegistered: boolean;
  /** Durable roster person (harbor_proj_roster.agent_node_id), when resolved. */
  agentNodeId: string | null;
  sessionId: string | null;
  sessionStatus: string | null;
  purpose: string | null;
  worktreeId: string | null;
  liveness: RoadmapAttachmentLiveness;
  lastHeartbeatMs: number | null;
  /** ms since the freshest heartbeat; null when nothing ever heartbeated. */
  idleMs: number | null;
  /** The REAL threshold (lib/agents.ts ladder) this liveness was judged against. */
  staleThresholdMs: number;
  claim: RoadmapAttachmentClaim | null;
  /** Present when agentId is known; agentRegistered says whether interrupt will land. */
  cockpit: RoadmapCockpitLinks | null;
  /** Transcript timeline (paged + SSE tail): GET /sessions/:id/events. */
  transcriptUrl: string | null;
  /** Durable roster detail: GET /agent-nodes/:id. */
  agentNodeUrl: string | null;
  /** Held spawn approvals whose fleet persona matches this agent exactly. */
  hitl: RoadmapHitlApproval[];
}

/**
 * Evidence behind a `review` classification. `status-merge` = the item sits
 * in the roadmap's own `merge` lane (PR open, awaiting merge). `pr-link` =
 * one or more GitHub PR URLs found in the item's notes/summary.
 *
 * EXTENSION POINT (clearly marked, no fake data): when structured PR links
 * land on roadmap items (the sibling roadmap-links slice), swap
 * `scanForPrLinks` for the structured field and delete the regex — the
 * `reviewEvidence` shape here is already wide enough to carry it.
 */
export type RoadmapReviewEvidence =
  | { kind: 'status-merge' }
  | { kind: 'pr-link'; urls: string[] };

/** One roadmap item's live-activity view. */
export interface RoadmapItemActivity {
  slug: string;
  harbor: string;
  status: string;
  summaryMd: string;
  assigneeId: string | null;
  lastTouchedAt: number;
  stage: RoadmapActivityStage;
  /** The canonical dispatch record backing the rollup, verbatim. */
  dispatch: RoadmapItemDispatch | null;
  /** True when the dispatch sits in failed/rejected/salvage — surfaced, never hidden in done. */
  needsAttention: boolean;
  reviewEvidence: RoadmapReviewEvidence | null;
  attachments: RoadmapWorkAttachment[];
  counts: { attachments: number; active: number; stale: number };
}

/** Board-wide header counts for the roadmap command center. */
export interface RoadmapActivityBoardCounts {
  items: number;
  byStage: Record<RoadmapActivityStage, number>;
  /** Distinct agent ids with an `active` attachment anywhere on the board. */
  activeAgents: number;
  /** Attachments reported stale (honest not-live) across all items. */
  staleAttachments: number;
  /** Unreleased roadmap_claims rows referencing any listed item. */
  openClaims: number;
  /** Items whose dispatch sits in failed/rejected/salvage (needsAttention). */
  attention: number;
}

/** The board-wide feed: in-flight items plus header counts over ALL items. */
export interface RoadmapActivityBoard {
  generatedAt: number;
  harbor: string | null;
  counts: RoadmapActivityBoardCounts;
  /** Items with in-flight work (any attachment, or a non-stacked stage). */
  items: RoadmapItemActivity[];
}

/** Slim approval shape the module consumes (decouples from fleet-engine). */
export interface PendingApprovalLite {
  id: string;
  agent: string;
  trigger: string;
  tier: string;
  project: string;
  reason: string | null;
  timestamp: number;
}

export interface RoadmapActivityDeps {
  db: Database.Database;
  /** Clock injection for deterministic tests. Defaults to Date.now(). */
  now?: () => number;
  /**
   * Held HITL spawn approvals. Defaults to the shared in-process approval
   * stream; injectable so unit tests (and callers without a fleet engine)
   * control it. Must never throw — the default is wrapped fail-open.
   */
  listPendingApprovals?: () => PendingApprovalLite[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Row shapes (raw SQL reads — this module is read-only over shared tables)
// ─────────────────────────────────────────────────────────────────────────────

interface ItemRow {
  slug: string;
  harbor: string;
  status: string;
  summary_md: string;
  notes_json: string | null;
  last_touched_at: number;
  assignee_id: string | null;
}

interface ClaimRow {
  id: number;
  slug: string;
  kind: string;
  claimed_by: string;
  claimed_at: number;
  session_id: string | null;
  agent_id: string | null;
}

interface SessionRow {
  id: string;
  purpose: string | null;
  status: string;
  agent_id: string | null;
  worktree_id: string | null;
  updated_at: number;
  metadata: string | null;
}

interface AgentRow {
  id: string;
  name: string | null;
  status: string | null;
  last_heartbeat: number;
  purpose: string | null;
}

interface DispatchRow {
  id: string;
  slug: string;
  state: string;
  session_id: string | null;
  worker_actor_id: string | null;
  branch: string | null;
  result_artifact: string | null;
  error_message: string | null;
  created_at: number;
}

interface RosterNodeRow {
  agent_node_id: string;
  display_name: string | null;
  status: string | null;
  current_session_id: string | null;
  last_heartbeat_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for direct unit testing)
// ─────────────────────────────────────────────────────────────────────────────

const PR_URL_RE = /https:\/\/github\.com\/[^\s)"']+\/pull\/\d+/g;

/**
 * Scan free text for GitHub PR URLs — the only review evidence available
 * until structured PR links land on roadmap items (see the extension-point
 * note on {@link RoadmapReviewEvidence}). Purpose: never fabricate review
 * state; only report URLs an agent actually wrote into the record.
 *
 * @param texts - Note bodies / summary markdown to scan.
 * @returns De-duplicated PR URLs, in first-seen order.
 */
export function scanForPrLinks(texts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.match(PR_URL_RE) ?? []) seen.add(match);
  }
  return [...seen];
}

/**
 * PURE stage classifier — the operator's flow vocabulary as a DOCUMENTED
 * ROLLUP over the canonical states, never a parallel state machine.
 *
 * The mapping (the canonical dispatch enum is authoritative for lifecycle,
 * claims/sessions are authoritative for who-is-live):
 *
 *   done      ← roadmap status 'done', OR dispatch accepted|settled
 *   review    ← dispatch review_pending, OR real PR evidence
 *               (roadmap 'merge' lane / PR link in the record)
 *   executing ← dispatch claimed|in_progress|produced, OR any attachment
 *               with an ACTIVE (heartbeat-honest) liveness
 *   stacked   ← everything else: no dispatch / proposed / no live work —
 *               INCLUDING failed|rejected|salvage, which go back on the
 *               stack and are flagged via `needsAttention` + the verbatim
 *               `dispatch.state`, never laundered into 'done'.
 *
 * Design: precedence is done > review > executing > stacked because the
 * flow reads left-to-right and a later stage subsumes an earlier one — an
 * item with an open PR is "in review" even while an agent is still live on
 * it (it's addressing review). The purpose of returning a rollup AND
 * keeping the canonical state on the item is that the pretty word is never
 * more than one field away from the honest one.
 *
 * @param itemStatus - The roadmap item's storage status (now/backlog/parked/merge/done).
 * @param dispatchState - The item's canonical dispatch state, or null when no dispatch exists.
 * @param reviewEvidence - Real PR-open evidence, or null.
 * @param attachments - The item's attachments with honest liveness.
 * @returns The flow stage for the board.
 */
export function classifyStage(
  itemStatus: string,
  dispatchState: DispatchState | null,
  reviewEvidence: RoadmapReviewEvidence | null,
  attachments: Array<Pick<RoadmapWorkAttachment, 'liveness'>>,
): RoadmapActivityStage {
  if (itemStatus === 'done' || (dispatchState && DISPATCH_DONE_STATES.has(dispatchState))) {
    return 'done';
  }
  if (dispatchState === 'review_pending' || reviewEvidence) return 'review';
  if (
    (dispatchState && DISPATCH_EXECUTING_STATES.has(dispatchState)) ||
    attachments.some((a) => a.liveness === 'active')
  ) {
    return 'executing';
  }
  return 'stacked';
}

/**
 * Map the session-liveness state machine onto the attachment vocabulary.
 *
 * Why the mapping: `classifySessionLiveness` speaks the durable-session
 * dialect (active/dormant/done) where "dormant" means parked-and-resumable.
 * For the operator's live-activity pane the honest word for "no process is
 * driving this right now" is `stale` — the mandate is that stale work must
 * never masquerade as active, and dormancy is exactly that condition here.
 *
 * @param state - The discriminated state from classifySessionLiveness.
 * @returns The attachment liveness label.
 */
function toAttachmentLiveness(state: 'active' | 'dormant' | 'done'): RoadmapAttachmentLiveness {
  if (state === 'active') return 'active';
  if (state === 'done') return 'done';
  return 'stale';
}

/**
 * Parse an ISO-8601 timestamp (the durable roster projection stores TEXT
 * timestamps) into ms-epoch, or null when absent/invalid. Defensive by
 * design — a malformed projection row must degrade to "no heartbeat"
 * (reported stale), never crash the board.
 *
 * @param iso - ISO timestamp text or null.
 * @returns ms-epoch or null.
 */
function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Fail-open default HITL source: the shared in-process approval stream.
 * Design rationale: wrapped in try/catch because a missing fleet engine
 * must never take the roadmap board down — an empty list is the honest
 * degraded answer, mirroring how lib/agents.ts surfaces the same stream.
 *
 * @returns Slimmed pending approvals, or [] on any failure.
 */
function defaultListPendingApprovals(): PendingApprovalLite[] {
  try {
    return getSharedApprovalStream()
      .list()
      .map((p) => ({
        id: p.id,
        agent: p.agent,
        trigger: p.trigger,
        tier: String(p.tier),
        project: p.project,
        reason: typeof p.reason === 'string' ? p.reason : null,
        timestamp: p.timestamp,
      }));
  } catch {
    return [];
  }
}

/**
 * Safely JSON-parse a TEXT column into a record, or null. Motivation:
 * session metadata and item notes are free-form JSON written by many
 * agents; a single malformed row must not 500 the whole activity feed.
 *
 * @param value - Raw TEXT column value.
 * @returns Parsed object or null.
 */
function safeJsonParse(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construct the roadmap-activity read model.
 *
 * Design: everything here is a read-only projection computed at request
 * time from the coordination tables other modules own (roadmap_items,
 * roadmap_claims, sessions, agents, harbor_proj_roster). No caching, no
 * writes, no tuples — staleness of the *view* is bounded by the request,
 * and honesty of the *liveness labels* is bounded by the heartbeat ladder.
 * Tables that may not exist yet (roadmap_claims before the first pop,
 * harbor_proj_roster before the first harbor event) are probed via
 * sqlite_master and skipped — a missing join source contributes nothing
 * rather than faking anything.
 *
 * @param deps - db handle plus optional clock / HITL injection.
 * @returns The activity API: `itemActivity(slug)` and `board()`.
 */
export function createRoadmapActivity(deps: RoadmapActivityDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());
  const listPendingApprovals = deps.listPendingApprovals ?? defaultListPendingApprovals;

  /**
   * Probe whether a table exists. Purpose: the claims table and the harbor
   * roster projection are created lazily by their owning modules; this
   * read-only module must degrade gracefully when they have never been
   * initialized (fresh daemon, unit fixture).
   *
   * @param name - Table name to probe.
   * @returns True when the table exists.
   */
  function tableExists(name: string): boolean {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name);
    return row != null;
  }

  /**
   * Probe whether roadmap_items carries the planner's assignee_id column
   * (migration 085). Why: legacy databases (and minimal test fixtures)
   * predate it; the assignee join path simply doesn't exist there.
   *
   * @returns True when the column is present.
   */
  function hasAssigneeColumn(): boolean {
    const cols = db.prepare('PRAGMA table_info(roadmap_items)').all() as Array<{ name: string }>;
    return cols.some((c) => c.name === 'assignee_id');
  }

  /**
   * Load live roadmap items (tombstones excluded), optionally filtered by
   * harbor and/or slug. Design: the assignee column is selected only when
   * it exists, so the same SQL serves legacy schemas — the purpose is one
   * read path for both migrated and pre-085 databases.
   *
   * @param filter - harbor / slug filters and a row cap.
   * @returns Raw item rows.
   */
  function loadItems(filter: { harbor?: string; slug?: string; limit?: number }): ItemRow[] {
    const assignee = hasAssigneeColumn() ? 'assignee_id' : 'NULL AS assignee_id';
    const where: string[] = ['deleted_at IS NULL'];
    const args: unknown[] = [];
    if (filter.harbor) {
      where.push('harbor = ?');
      args.push(filter.harbor);
    }
    if (filter.slug) {
      where.push('slug = ?');
      args.push(filter.slug);
    }
    args.push(filter.limit ?? 2000);
    return db
      .prepare(
        `SELECT slug, harbor, status, summary_md, notes_json, last_touched_at, ${assignee}
           FROM roadmap_items
          WHERE ${where.join(' AND ')}
          ORDER BY last_touched_at DESC
          LIMIT ?`,
      )
      .all(...args) as ItemRow[];
  }

  /**
   * Load ACTIVE (unreleased) roadmap claims, keyed by slug. Why the array
   * shape: the partial unique index guarantees at most one active claim
   * per slug today, but the purpose here is a read model robust against
   * historical data, so we never assume that invariant held forever.
   *
   * @returns Map of slug → active claim rows (empty when the table is absent).
   */
  function loadOpenClaimsBySlug(): Map<string, ClaimRow[]> {
    const bySlug = new Map<string, ClaimRow[]>();
    if (!tableExists('roadmap_claims')) return bySlug;
    const rows = db
      .prepare(
        `SELECT id, slug, kind, claimed_by, claimed_at, session_id, agent_id
           FROM roadmap_claims WHERE released_at IS NULL`,
      )
      .all() as ClaimRow[];
    for (const row of rows) {
      const list = bySlug.get(row.slug) ?? [];
      list.push(row);
      bySlug.set(row.slug, list);
    }
    return bySlug;
  }

  /**
   * Load active sessions whose metadata carries a `roadmapLink` slug
   * (rent-at-claim S3), keyed by that slug. Why bounded and app-side
   * parsed: JSON parsing in the app layer is portable across
   * better-sqlite3 and bun:sqlite (the compiled daemon), unlike
   * json_extract quirks — the design mirrors lib/roadmap-items.ts's
   * positional-binding caution.
   *
   * @returns Map of slug → linked active session rows.
   */
  function loadLinkedSessionsBySlug(): Map<string, SessionRow[]> {
    const bySlug = new Map<string, SessionRow[]>();
    const rows = db
      .prepare(
        `SELECT id, purpose, status, agent_id, worktree_id, updated_at, metadata
           FROM sessions
          WHERE status = 'active' AND metadata IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT 2000`,
      )
      .all() as SessionRow[];
    for (const row of rows) {
      const meta = safeJsonParse(row.metadata);
      const link =
        meta && typeof meta === 'object'
          ? (meta as Record<string, unknown>).roadmapLink
          : null;
      if (typeof link !== 'string' || !link) continue;
      const list = bySlug.get(link) ?? [];
      list.push(row);
      bySlug.set(link, list);
    }
    return bySlug;
  }

  /**
   * Load the newest dispatch per roadmap slug. Why newest-first collapse:
   * ADR-0086 intends one live dispatch per item; historical re-dispatches
   * can leave older terminal rows behind, and the design intent here is to
   * report where the item is NOW, which is the latest lifecycle record.
   * The table is created lazily by lib/dispatch/queue.ts, so absence is a
   * legitimate state (fresh daemon, unit fixture) and yields an empty map.
   *
   * @param slug - Optional single-slug scope (per-item endpoint).
   * @returns Map of slug → newest dispatch record.
   */
  function loadDispatchesBySlug(slug?: string): Map<string, RoadmapItemDispatch> {
    const bySlug = new Map<string, RoadmapItemDispatch>();
    if (!tableExists('dispatches')) return bySlug;
    const rows = (
      slug
        ? db
            .prepare(
              `SELECT id, slug, state, session_id, worker_actor_id, branch,
                      result_artifact, error_message, created_at
                 FROM dispatches WHERE slug = ? ORDER BY created_at DESC`,
            )
            .all(slug)
        : db
            .prepare(
              `SELECT id, slug, state, session_id, worker_actor_id, branch,
                      result_artifact, error_message, created_at
                 FROM dispatches ORDER BY created_at DESC`,
            )
            .all()
    ) as DispatchRow[];
    for (const row of rows) {
      if (bySlug.has(row.slug)) continue; // newest wins (rows are DESC)
      bySlug.set(row.slug, {
        id: row.id,
        state: row.state as DispatchState,
        sessionId: row.session_id,
        workerActorId: row.worker_actor_id,
        branch: row.branch,
        resultArtifact: row.result_artifact,
        errorMessage: row.error_message,
        createdAt: row.created_at,
      });
    }
    return bySlug;
  }

  /**
   * Look up one session row by id. Purpose: resolve claim/roster
   * references whose sessions may already be completed — those are still
   * reported (marked done) rather than hidden, by design, because an
   * unreleased claim on a finished session is salvage signal.
   *
   * @param id - session id.
   * @returns The row or null.
   */
  function getSession(id: string): SessionRow | null {
    return (
      (db
        .prepare(
          `SELECT id, purpose, status, agent_id, worktree_id, updated_at, metadata
             FROM sessions WHERE id = ?`,
        )
        .get(id) as SessionRow | undefined) ?? null
    );
  }

  /**
   * Look up one live-registry agent by id. Purpose: the registry row
   * carries the heartbeat and status this module's liveness honesty is
   * built on — a null here is WHY an attachment reports agentRegistered
   * false and its interrupt link is flagged as possibly dead.
   *
   * @param id - agent id.
   * @returns The row or null when unregistered.
   */
  function getAgent(id: string): AgentRow | null {
    return (
      (db
        .prepare(`SELECT id, name, status, last_heartbeat, purpose FROM agents WHERE id = ?`)
        .get(id) as AgentRow | undefined) ?? null
    );
  }

  /**
   * Look up one durable roster node (harbor_proj_roster projection).
   * Why: a planner assignee may be a durable person rather than a live
   * registry agent; the node's current_session_id is the designed bridge
   * from the durable roster back to live sessions.
   *
   * @param id - agent node id (the daemon-minted durable person).
   * @returns The row or null (also null when the projection was never built).
   */
  function getRosterNode(id: string): RosterNodeRow | null {
    if (!tableExists('harbor_proj_roster')) return null;
    return (
      (db
        .prepare(
          `SELECT agent_node_id, display_name, status, current_session_id, last_heartbeat_at
             FROM harbor_proj_roster WHERE agent_node_id = ?`,
        )
        .get(id) as RosterNodeRow | undefined) ?? null
    );
  }

  /** Accumulator used while merging join paths into one attachment. */
  interface AttachmentDraft {
    sources: Set<RoadmapAttachmentSource>;
    agentId: string | null;
    agentNodeId: string | null;
    sessionId: string | null;
    claim: RoadmapAttachmentClaim | null;
    nodeHeartbeatMs: number | null;
    nodeDisplayName: string | null;
    nodeStatus: string | null;
  }

  /**
   * Build the merged, liveness-classified attachment list for one item.
   *
   * Motivation: the three join paths frequently describe the SAME work
   * (a popped claim linked to the session that also carries roadmapLink),
   * so drafts are deduped on session id (else agent id, else node id) and
   * their sources merged — the UI should see one row per unit of work with
   * every corroborating path listed, not three rows for one agent.
   *
   * @param item - The roadmap item row.
   * @param claims - Active claims for the item's slug.
   * @param linkedSessions - Active sessions stamped with the item's slug.
   * @param dispatch - The item's canonical dispatch (its session is a work attachment while in flight).
   * @param approvals - Held HITL approvals (attached on exact agent match).
   * @returns Attachments sorted freshest-heartbeat-first.
   */
  function buildAttachments(
    item: ItemRow,
    claims: ClaimRow[],
    linkedSessions: SessionRow[],
    dispatch: RoadmapItemDispatch | null,
    approvals: PendingApprovalLite[],
  ): RoadmapWorkAttachment[] {
    const drafts = new Map<string, AttachmentDraft>();

    /**
     * Get-or-create the draft for a dedupe key. Purpose: every join path
     * funnels through one accumulator per unit of work, which is why the
     * three paths can corroborate a single attachment instead of
     * triplicating it.
     *
     * @param key - session id, else agent id, else node/claim key.
     * @returns The (possibly fresh) mutable draft.
     */
    const draftFor = (key: string): AttachmentDraft => {
      let d = drafts.get(key);
      if (!d) {
        d = {
          sources: new Set(),
          agentId: null,
          agentNodeId: null,
          sessionId: null,
          claim: null,
          nodeHeartbeatMs: null,
          nodeDisplayName: null,
          nodeStatus: null,
        };
        drafts.set(key, d);
      }
      return d;
    };

    // Path 1 — active roadmap claims (slug ↔ session/agent).
    for (const claim of claims) {
      const key = claim.session_id ?? claim.agent_id ?? `claim:${claim.id}`;
      const d = draftFor(key);
      d.sources.add('claim');
      d.sessionId = d.sessionId ?? claim.session_id;
      d.agentId = d.agentId ?? claim.agent_id;
      d.claim = d.claim ?? {
        id: claim.id,
        kind: claim.kind,
        claimedBy: claim.claimed_by,
        claimedAt: claim.claimed_at,
      };
    }

    // Path 2 — rent-at-claim session links (metadata.roadmapLink ↔ slug).
    for (const session of linkedSessions) {
      const key = session.id;
      // A claim keyed by agent id may describe the same work: re-key onto
      // the session when the agent matches, so the two paths merge.
      const existingByAgent = session.agent_id
        ? [...drafts.entries()].find(([k, d]) => d.agentId === session.agent_id && k !== key && d.sessionId == null)
        : undefined;
      if (existingByAgent) {
        const [oldKey, old] = existingByAgent;
        drafts.delete(oldKey);
        old.sessionId = session.id;
        drafts.set(key, old);
      }
      const d = draftFor(key);
      d.sources.add('session-link');
      d.sessionId = session.id;
      d.agentId = d.agentId ?? session.agent_id;
    }

    // Path 4 — the canonical dispatch's session, while the dispatch is in
    // flight (claimed/in_progress/produced/review_pending). Terminal and
    // proposed dispatches attach nothing: there is no work context to watch.
    if (
      dispatch?.sessionId &&
      (DISPATCH_EXECUTING_STATES.has(dispatch.state) || dispatch.state === 'review_pending')
    ) {
      const d = draftFor(dispatch.sessionId);
      d.sources.add('dispatch');
      d.sessionId = dispatch.sessionId;
    }

    // Path 3 — planner assignee (durable owner ↔ registry agent / roster node).
    if (item.assignee_id) {
      const assignee = item.assignee_id;
      const registryAgent = getAgent(assignee);
      const rosterNode = getRosterNode(assignee);
      if (registryAgent || rosterNode) {
        // Merge onto an existing draft for the same agent/session if present.
        const nodeSession = rosterNode?.current_session_id ?? null;
        const mergeKey =
          [...drafts.entries()].find(
            ([, d]) =>
              (registryAgent && d.agentId === assignee) ||
              (nodeSession && d.sessionId === nodeSession),
          )?.[0] ?? (nodeSession || assignee);
        const d = draftFor(mergeKey);
        if (registryAgent) {
          d.sources.add('assignee-agent');
          d.agentId = d.agentId ?? assignee;
        }
        if (rosterNode) {
          d.sources.add('assignee-node');
          d.agentNodeId = rosterNode.agent_node_id;
          d.sessionId = d.sessionId ?? rosterNode.current_session_id;
          d.nodeHeartbeatMs = parseIsoMs(rosterNode.last_heartbeat_at);
          d.nodeDisplayName = rosterNode.display_name;
          d.nodeStatus = rosterNode.status;
        }
      }
    }

    const nowMs = now();
    const attachments: RoadmapWorkAttachment[] = [];
    for (const [key, d] of drafts) {
      const session = d.sessionId ? getSession(d.sessionId) : null;
      const agentId = d.agentId ?? session?.agent_id ?? null;
      const agent = agentId ? getAgent(agentId) : null;

      // Freshest heartbeat across the registry agent and the roster node.
      const heartbeats = [agent?.last_heartbeat ?? null, d.nodeHeartbeatMs].filter(
        (v): v is number => typeof v === 'number',
      );
      const lastHeartbeatMs = heartbeats.length > 0 ? Math.max(...heartbeats) : null;

      // The REAL threshold ladder (lib/agents.ts): stale = 0.6 × dead by
      // agent status. Judged per attachment so a `draining` agent goes
      // stale far sooner than a background `busy` one — honesty over
      // uniformity.
      const staleThresholdMs = getStaleThresholdForStatus(agent?.status ?? d.nodeStatus ?? undefined);

      const state = classifySessionLiveness({
        status: session?.status ?? 'active',
        attachedAgentId: agentId,
        lastHeartbeatMs,
        nowMs,
        liveTtlMs: staleThresholdMs,
      });
      const liveness = toAttachmentLiveness(state.state);
      const idleMs =
        lastHeartbeatMs == null ? null : Math.max(0, nowMs - lastHeartbeatMs);

      const agentName = agent?.name ?? d.nodeDisplayName ?? null;
      const hitl = approvals
        .filter((p) => p.agent === agentId || (agentName != null && p.agent === agentName))
        .map((p) => ({ ...p, decisionUrl: `/fleet/approvals/${encodeURIComponent(p.id)}/decision` }));

      attachments.push({
        key,
        sources: [...d.sources],
        agentId,
        agentName,
        agentRegistered: agent != null,
        agentNodeId: d.agentNodeId,
        sessionId: d.sessionId ?? null,
        sessionStatus: session?.status ?? null,
        purpose: session?.purpose ?? agent?.purpose ?? null,
        worktreeId: session?.worktree_id ?? null,
        liveness,
        lastHeartbeatMs,
        idleMs,
        staleThresholdMs,
        claim: d.claim,
        cockpit: agentId
          ? {
              steeringChannel: `agent:${agentId}`,
              streamUrl: `/agents/${encodeURIComponent(agentId)}/stream`,
              interrupt: {
                available: false,
                reason:
                  'interrupt is a publish-only soft signal today (no delivery/ack lifecycle); acknowledged control ingress is pending',
                softSignalUrl: `/agents/${encodeURIComponent(agentId)}/interrupt`,
                plannedRoute: '/agent-nodes/:id/control',
                plannedVerbs: ['interrupt', 'steer'],
              },
            }
          : null,
        transcriptUrl: d.sessionId
          ? `/sessions/${encodeURIComponent(d.sessionId)}/events`
          : null,
        agentNodeUrl: d.agentNodeId
          ? `/agent-nodes/${encodeURIComponent(d.agentNodeId)}`
          : null,
        hitl,
      });
    }

    return attachments.sort(
      (a, b) => (b.lastHeartbeatMs ?? 0) - (a.lastHeartbeatMs ?? 0),
    );
  }

  /**
   * Assemble one item's full activity view: attachments, review evidence,
   * and stage. Design intent: this is the SINGLE place the classification
   * pipeline is composed, which is why the per-item endpoint and the board
   * agree by construction rather than by convention.
   *
   * @param item - The raw item row.
   * @param claimsBySlug - Pre-grouped active claims (board reuse).
   * @param linksBySlug - Pre-grouped linked sessions (board reuse).
   * @param dispatchesBySlug - Pre-grouped canonical dispatches (board reuse).
   * @param approvals - Held HITL approvals.
   * @returns The item's activity view.
   */
  function buildItemActivity(
    item: ItemRow,
    claimsBySlug: Map<string, ClaimRow[]>,
    linksBySlug: Map<string, SessionRow[]>,
    dispatchesBySlug: Map<string, RoadmapItemDispatch>,
    approvals: PendingApprovalLite[],
  ): RoadmapItemActivity {
    const dispatch = dispatchesBySlug.get(item.slug) ?? null;
    const attachments = buildAttachments(
      item,
      claimsBySlug.get(item.slug) ?? [],
      linksBySlug.get(item.slug) ?? [],
      dispatch,
      approvals,
    );

    const notes = safeJsonParse(item.notes_json);
    const noteTexts = Array.isArray(notes)
      ? notes.map((n) => (n && typeof n === 'object' ? String((n as Record<string, unknown>).text ?? '') : ''))
      : [];
    const prUrls = scanForPrLinks([item.summary_md, ...noteTexts]);
    const reviewEvidence: RoadmapReviewEvidence | null =
      item.status === 'done'
        ? null
        : prUrls.length > 0
          ? { kind: 'pr-link', urls: prUrls }
          : item.status === 'merge'
            ? { kind: 'status-merge' }
            : null;

    const stage = classifyStage(item.status, dispatch?.state ?? null, reviewEvidence, attachments);
    const needsAttention = dispatch != null && DISPATCH_ATTENTION_STATES.has(dispatch.state);

    return {
      slug: item.slug,
      harbor: item.harbor,
      status: item.status,
      summaryMd: item.summary_md,
      assigneeId: item.assignee_id ?? null,
      lastTouchedAt: item.last_touched_at,
      stage,
      dispatch,
      needsAttention,
      reviewEvidence,
      attachments,
      counts: {
        attachments: attachments.length,
        active: attachments.filter((a) => a.liveness === 'active').length,
        stale: attachments.filter((a) => a.liveness === 'stale').length,
      },
    };
  }

  /**
   * The live-work join for ONE roadmap item — `GET /roadmap/items/:slug/activity`.
   *
   * Purpose: answer "who is on this item right now and where do I watch
   * them" in one call. An item with no in-flight work returns an EMPTY
   * attachment list (the null state the UI renders), not an error; only an
   * unknown slug is null.
   *
   * @param slug - Roadmap item slug.
   * @param options - Optional harbor scope (default: first match across harbors, freshest first).
   * @returns The item's activity view, or null when the slug doesn't exist.
   */
  function itemActivity(
    slug: string,
    options: { harbor?: string } = {},
  ): RoadmapItemActivity | null {
    const items = loadItems({ slug, harbor: options.harbor, limit: 10 });
    if (items.length === 0) return null;
    const item = items[0];
    return buildItemActivity(
      item,
      loadOpenClaimsBySlug(),
      loadLinkedSessionsBySlug(),
      loadDispatchesBySlug(item.slug),
      listPendingApprovals(),
    );
  }

  /**
   * The board-wide feed — `GET /roadmap/activity`.
   *
   * Purpose: one payload for the roadmap command-center header (stage
   * counts over ALL items) plus every item that has in-flight work (any
   * attachment, or a non-stacked stage). Stacked-and-idle items are counted
   * but not listed, keeping the feed proportional to actual activity;
   * `includeStacked` lists everything for full-board renders.
   *
   * @param options - harbor scope, includeStacked, and a listing cap.
   * @returns The board feed with header counts.
   */
  function board(
    options: { harbor?: string; includeStacked?: boolean; limit?: number } = {},
  ): RoadmapActivityBoard {
    const items = loadItems({ harbor: options.harbor });
    const claimsBySlug = loadOpenClaimsBySlug();
    const linksBySlug = loadLinkedSessionsBySlug();
    const dispatchesBySlug = loadDispatchesBySlug();
    const approvals = listPendingApprovals();

    const activities = items.map((item) =>
      buildItemActivity(item, claimsBySlug, linksBySlug, dispatchesBySlug, approvals),
    );

    const byStage: Record<RoadmapActivityStage, number> = {
      stacked: 0,
      executing: 0,
      review: 0,
      done: 0,
    };
    const activeAgentIds = new Set<string>();
    let staleAttachments = 0;
    let openClaims = 0;
    let attention = 0;
    for (const activity of activities) {
      byStage[activity.stage] += 1;
      if (activity.needsAttention) attention += 1;
      for (const a of activity.attachments) {
        if (a.liveness === 'active' && a.agentId) activeAgentIds.add(a.agentId);
        if (a.liveness === 'stale') staleAttachments += 1;
        if (a.claim) openClaims += 1;
      }
    }

    const inFlight = activities.filter(
      (a) =>
        options.includeStacked ||
        a.stage !== 'stacked' ||
        a.attachments.length > 0 ||
        a.needsAttention,
    );
    const limit = options.limit ?? 500;

    return {
      generatedAt: now(),
      harbor: options.harbor ?? null,
      counts: {
        items: activities.length,
        byStage,
        activeAgents: activeAgentIds.size,
        staleAttachments,
        openClaims,
        attention,
      },
      items: inFlight.slice(0, limit),
    };
  }

  return { itemActivity, board };
}

export type RoadmapActivity = ReturnType<typeof createRoadmapActivity>;
