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
import type {
  DurableTakeoverGrantView,
  ExactClaimBinding,
  OwnershipProjection,
  OwnershipState,
} from './durable-ownership.js';

export const ROADMAP_PROJECTION_VERSION = 1 as const;

/** A live claim is only trustworthy while its stream evidence is this fresh. */
export const ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS = AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS;

/** Staleness is an operator warning, never takeover authority. */
export const ROADMAP_OWNERSHIP_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

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

export interface RoadmapOwnershipAgent {
  agentNodeId: string;
  displayName: string | null;
  identity: string | null;
}

export interface RoadmapOwnershipHistoryEntry {
  epochId: string;
  epochNumber: number;
  owner: RoadmapOwnershipAgent;
  state: OwnershipState;
  cause: string;
  reason: string;
  createdAt: number;
  sourceSessionId: string | null;
  successorSessionId: string | null;
  takeoverGrantId: string | null;
}

export interface RoadmapOwnershipBriefingSummary {
  briefingId: string;
  contentHash: string;
  generatedAt: number;
  handoffCapsuleId: string | null;
  knownGaps: string[];
  omittedSources: string[];
  unresolvedQuestions: Array<{ id: string; text: string; sourceRef: string | null }>;
  evidence: Array<{ source: string; ref: string; label: string; contentHash: string | null }>;
}

export interface RoadmapOwnershipBriefingCounts {
  generatedAt: number;
  knownGapCount: number;
  omittedSourceCount: number;
  unresolvedQuestionCount: number;
  evidenceCount: number;
}

export interface RoadmapOwnershipProjection {
  /** Public reads expose summary; exact claims/briefing/actions require a verified party. */
  detailVisibility: 'summary' | 'full';
  currentOwner: RoadmapOwnershipAgent | null;
  currentEpochId: string | null;
  currentEpochNumber: number | null;
  currentState: OwnershipState | 'unassigned' | 'inconsistent';
  stateEvidence: 'ownership-event' | 'session-status' | 'session-stale' | 'none';
  priorOwners: RoadmapOwnershipHistoryEntry[];
  claimCount: number;
  claims: ExactClaimBinding[];
  briefingSummary: RoadmapOwnershipBriefingCounts | null;
  briefing: RoadmapOwnershipBriefingSummary | null;
  takeover: {
    available: boolean;
    operatorPresenceAvailable: boolean;
    actionUrl: string | null;
    activeGrantId: string | null;
    requires: 'verified-current-owner-or-recent-operator-presence';
    note: string;
  };
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
  ownership: RoadmapOwnershipProjection;
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
  /** Optional canonical roster lookup; IDs remain visible if profile lookup fails. */
  resolveAgentNode?: (agentNodeId: string) => { displayName?: string | null; identity?: string | null } | null;
  /**
   * Verified ownership facts from the constitutional daemon coordinator.
   * The generic roadmap projector never reads signed tables directly.
   */
  resolveDurableOwnership?: (
    roadmapSlug: string,
    harbor: string,
  ) => { projection: OwnershipProjection; epochGrant: DurableTakeoverGrantView | null };
  /** True only when this daemon has a real one-shot recent-human-presence verifier. */
  operatorPresenceAvailable?: boolean;
  /** Per-item authorization decision. Omission is public-summary, fail-closed. */
  ownershipDetail?: (roadmapSlug: string, harbor: string) => 'summary' | 'full';
  ownershipStaleAfterMs?: number;
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
  assignee_id?: unknown;
  deleted_at?: unknown;
}

interface RawOwnershipEpochRow {
  epoch_id: string;
  roadmap_item_id: string;
  epoch_number: number;
  owner_agent_node_id: string;
  cause: string;
  source_session_id: string | null;
  successor_session_id: string | null;
  takeover_grant_id: string | null;
  claim_bindings_json: string;
  reason: string;
  created_at: number;
}

interface RawOwnershipGrantRow {
  grant_id: string;
  predecessor_epoch_id: string;
  briefing_json: string;
  issued_at: number;
  expires_at: number;
}

function ownershipAgent(
  agentNodeId: string,
  resolver: BuildRoadmapProjectionOptions['resolveAgentNode'],
): RoadmapOwnershipAgent {
  let resolved: ReturnType<NonNullable<BuildRoadmapProjectionOptions['resolveAgentNode']>> = null;
  try {
    resolved = resolver?.(agentNodeId) ?? null;
  } catch {
    // The canonical id remains truthful even if its optional roster profile is unavailable.
  }
  return {
    agentNodeId,
    displayName: asNullableString(resolved?.displayName),
    identity: asNullableString(resolved?.identity),
  };
}

function parseOwnershipBriefing(raw: string | null): RoadmapOwnershipBriefingSummary | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const handoff = value.handoff && typeof value.handoff === 'object'
      ? value.handoff as Record<string, unknown>
      : null;
    const lineage = handoff?.lineage && typeof handoff.lineage === 'object'
      ? handoff.lineage as Record<string, unknown>
      : null;
    const unresolved = Array.isArray(value.unresolvedQuestions) ? value.unresolvedQuestions : [];
    const evidence = Array.isArray(value.evidence) ? value.evidence : [];
    return {
      briefingId: asNullableString(value.briefingId) ?? '',
      contentHash: asNullableString(value.contentHash) ?? '',
      generatedAt: asFiniteNumber(value.generatedAt) ?? 0,
      handoffCapsuleId: asNullableString(lineage?.capsuleId),
      knownGaps: parseStringArray(JSON.stringify(value.knownGaps ?? [])),
      omittedSources: parseStringArray(JSON.stringify(value.omittedSources ?? [])),
      unresolvedQuestions: unresolved.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const item = entry as Record<string, unknown>;
        const id = asNullableString(item.id);
        const text = asNullableString(item.text);
        if (!id || !text) return [];
        return [{ id, text, sourceRef: asNullableString(item.sourceRef) }];
      }),
      evidence: evidence.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const item = entry as Record<string, unknown>;
        const source = asNullableString(item.source);
        const ref = asNullableString(item.ref);
        const label = asNullableString(item.label);
        if (!source || !ref || !label) return [];
        return [{ source, ref, label, contentHash: asNullableString(item.contentHash) }];
      }),
    };
  } catch {
    return null;
  }
}

function buildOwnershipByItem(
  db: Database.Database,
  harbor: string,
  at: number,
  rows: RawItemRow[],
  options: BuildRoadmapProjectionOptions,
): Map<string, RoadmapOwnershipProjection> {
  const result = new Map<string, RoadmapOwnershipProjection>();
  const resolver = options.resolveAgentNode;
  const staleAfterMs = options.ownershipStaleAfterMs ?? ROADMAP_OWNERSHIP_STALE_AFTER_MS;

  const sessions = new Map<string, { status: string; updatedAt: number }>();
  if (tableExists(db, 'sessions')) {
    for (const session of db.prepare('SELECT id, status, updated_at FROM sessions').all() as Array<{
      id: string;
      status: string;
      updated_at: number;
    }>) {
      sessions.set(session.id, { status: session.status, updatedAt: session.updated_at });
    }
  }

  for (const row of rows) {
    const assignee = asNullableString(row.assignee_id);
    const detailVisibility = options.ownershipDetail?.(row.slug, harbor) === 'full'
      ? 'full' as const
      : 'summary' as const;
    let verified: ReturnType<NonNullable<BuildRoadmapProjectionOptions['resolveDurableOwnership']>> | null = null;
    if (options.resolveDurableOwnership) {
      try {
        verified = options.resolveDurableOwnership(row.slug, harbor);
      } catch {
        result.set(row.id, {
          detailVisibility,
          // The mutable roadmap assignee is evidence of a mismatch, not a
          // substitute AgentNode owner when signed history cannot be verified.
          currentOwner: null,
          currentEpochId: null,
          currentEpochNumber: null,
          currentState: 'inconsistent',
          stateEvidence: 'none',
          priorOwners: [],
          claimCount: 0,
          claims: [],
          briefingSummary: null,
          briefing: null,
          takeover: {
            available: false,
            operatorPresenceAvailable: options.operatorPresenceAvailable === true,
            actionUrl: null,
            activeGrantId: null,
            requires: 'verified-current-owner-or-recent-operator-presence',
            note: 'Signed ownership history could not be verified; takeover is unavailable until daemon integrity is restored.',
          },
        });
        continue;
      }
    }
    const projection = verified?.projection ?? null;
    const current = projection?.currentEpoch ?? null;
    if (!current) {
      const hasUnverifiedOwnershipStore = tableExists(db, 'roadmap_ownership_epochs');
      result.set(row.id, {
        detailVisibility,
        // Never relabel a legacy/display assignee as a canonical AgentNode.
        // The roadmap row itself still carries the mismatch for repair.
        currentOwner: null,
        currentEpochId: null,
        currentEpochNumber: null,
        currentState: assignee || (!options.resolveDurableOwnership && hasUnverifiedOwnershipStore)
          ? 'inconsistent'
          : 'unassigned',
        stateEvidence: 'none',
        priorOwners: [],
        claimCount: 0,
        claims: [],
        briefingSummary: null,
        briefing: null,
        takeover: {
          available: false,
          operatorPresenceAvailable: options.operatorPresenceAvailable === true,
          actionUrl: null,
          activeGrantId: null,
          requires: 'verified-current-owner-or-recent-operator-presence',
          note: hasUnverifiedOwnershipStore && !options.resolveDurableOwnership
            ? 'Ownership storage exists but no verified daemon projector is attached; raw signed rows are never rendered.'
            : assignee
              ? 'Roadmap owner has no canonical ownership epoch; bootstrap is required before takeover.'
              : 'Assign a durable AgentNode before takeover.',
        },
      });
      continue;
    }

    let currentState: RoadmapOwnershipProjection['currentState'] = projection?.currentState ?? 'current';
    let stateEvidence: RoadmapOwnershipProjection['stateEvidence'] = projection?.currentState
      ? 'ownership-event'
      : 'none';
    const effectiveSessionId = current.successorSessionId ?? current.sourceSessionId;
    const session = effectiveSessionId ? sessions.get(effectiveSessionId) : null;
    if (currentState === 'current' && session?.status === 'abandoned') {
      currentState = 'abandoned';
      stateEvidence = 'session-status';
    } else if (
      currentState === 'current'
      && session?.status === 'active'
      && Number.isFinite(session.updatedAt)
      && at - session.updatedAt > staleAfterMs
    ) {
      currentState = 'stale';
      stateEvidence = 'session-stale';
    }
    if (assignee !== current.ownerAgentNodeId || projection?.currentOwner !== current.ownerAgentNodeId) {
      currentState = 'inconsistent';
      stateEvidence = 'none';
    }
    // The epoch retains every predecessor disposition for provenance, but a
    // released claim is not associated with the successor's current work.
    // Current-owner projections therefore show retained/acquired claims only;
    // the signed grant and briefing keep the explicit release history.
    const claims = current.claimBindings.filter(claim => claim.disposition !== 'release');
    const takeoverAvailable = currentState === 'stale' || currentState === 'abandoned';
    const brief = verified?.epochGrant?.grant.briefing ?? null;
    const briefingSummary = brief ? {
      generatedAt: brief.generatedAt,
      knownGapCount: brief.knownGaps.length,
      omittedSourceCount: brief.omittedSources.length,
      unresolvedQuestionCount: brief.unresolvedQuestions.length,
      evidenceCount: brief.evidence.length,
    } : null;
    result.set(row.id, {
      detailVisibility,
      currentOwner: ownershipAgent(current.ownerAgentNodeId, resolver),
      currentEpochId: current.epochId,
      currentEpochNumber: current.epochNumber,
      currentState,
      stateEvidence,
      priorOwners: (projection?.epochs ?? []).slice(1).map(epoch => ({
        epochId: epoch.epochId,
        epochNumber: epoch.epochNumber,
        owner: ownershipAgent(epoch.ownerAgentNodeId, resolver),
        state: 'transferred',
        cause: epoch.cause,
        reason: detailVisibility === 'full'
          ? epoch.reason
          : 'Historical reason requires an ownership-party or operator credential.',
        createdAt: epoch.createdAt,
        sourceSessionId: detailVisibility === 'full' ? epoch.sourceSessionId : null,
        successorSessionId: detailVisibility === 'full' ? epoch.successorSessionId : null,
        takeoverGrantId: detailVisibility === 'full' ? epoch.takeoverGrantId : null,
      })),
      claimCount: claims.length,
      claims: detailVisibility === 'full' ? claims : [],
      briefingSummary,
      briefing: detailVisibility === 'full' && brief ? {
        briefingId: brief.briefingId,
        contentHash: brief.contentHash,
        generatedAt: brief.generatedAt,
        handoffCapsuleId: brief.handoff.lineage.capsuleId ?? null,
        knownGaps: [...brief.knownGaps],
        omittedSources: [...brief.omittedSources],
        unresolvedQuestions: brief.unresolvedQuestions.map(question => ({
          id: question.id,
          text: question.text,
          sourceRef: question.sourceRef,
        })),
        evidence: brief.evidence.map(evidence => ({ ...evidence })),
      } : null,
      takeover: {
        available: takeoverAvailable,
        operatorPresenceAvailable: options.operatorPresenceAvailable === true,
        actionUrl: detailVisibility === 'full' && takeoverAvailable
          ? projection?.activeGrantId && effectiveSessionId
            ? `/sessions/${encodeURIComponent(effectiveSessionId)}/takeover`
            : `/roadmap/items/${encodeURIComponent(row.slug)}/takeovers`
          : null,
        activeGrantId: detailVisibility === 'full' ? projection?.activeGrantId ?? null : null,
        requires: 'verified-current-owner-or-recent-operator-presence',
        note: takeoverAvailable
          ? options.operatorPresenceAvailable === true
            ? 'Staleness is evidence only; operator takeover still requires recent action-bound presence, an admitted successor AgentRun, and an exact signed one-shot grant.'
            : 'Operator takeover is fail-closed because this daemon has no recent-human-presence verifier. A verified current owner may still issue a voluntary handoff to an admitted successor AgentRun.'
          : 'Takeover is shown only for stale or abandoned ownership; it never follows from presence alone.',
      },
    });
  }
  return result;
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
  const ownershipByItem = buildOwnershipByItem(db, harbor, at, rows, options);

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
      ownership: ownershipByItem.get(row.id)!,
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
