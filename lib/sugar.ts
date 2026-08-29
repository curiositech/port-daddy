/**
 * Sugar Module — Compound commands for common workflows
 *
 * Provides begin (register + session start), done (session end + unregister),
 * and whoami (current agent/session context). Composes agents + sessions
 * modules atomically with rollback on failure.
 */

import { randomBytes } from 'crypto';
import { parseIdentity } from './identity.js';
import { classifySessionLiveness, decideBeginResume } from './session-liveness.js';
import type { VerifiedContextBootstrapLookup } from './agent-harbor/context-continuity.js';

/** How recent an agent heartbeat counts as "a live process is driving this session right now". */
const SESSION_DRIVING_TTL_MS = 180_000;
import { buildHumanReadableId, cleanAgentDisplayName, deriveAgentDisplayName } from './agent-names.js';
import {
  evaluateSessionWorktreePolicy,
  mergeSessionWorktreeMetadata,
  type SessionWorktreeContext,
} from './worktree-policy.js';
import {
  createGitOriginChecker,
  checkResultNoteSentinel,
  noteSentinelErrorMessage,
  type GitOriginChecker,
} from './git-origin-check.js';

// =============================================================================
// Types
// =============================================================================

interface AgentsModule {
  register(id: string, options?: Record<string, unknown>): Record<string, unknown>;
  unregister(id: string): Record<string, unknown>;
  get(id: string): Record<string, unknown>;
}

interface SessionsModule {
  start(purpose: string, options?: Record<string, unknown>): Record<string, unknown>;
  end(id: string, options?: Record<string, unknown>): Record<string, unknown>;
  list(options?: Record<string, unknown>): Record<string, unknown>;
  get(id: string): Record<string, unknown>;
  getNotes(id?: string | null, options?: Record<string, unknown>): Record<string, unknown>;
  claimFiles(sessionId: string, filePaths: string[], options?: Record<string, unknown>): Record<string, unknown>;
  /** Flip an abandoned durable session back to active. Optional: older deps may not provide it. */
  resurrect?(sessionId: string): void;
  /** Shallow-merge a patch into the session's metadata JSON. Optional: older deps may not provide it. */
  updateMetadata?(sessionId: string, patch: Record<string, unknown>): Record<string, unknown>;
  /** Append an immutable session note. Optional: older deps may not provide it. */
  addNote?(sessionId: string, content: string, options?: Record<string, unknown>): Record<string, unknown>;
  /** Take over a session non-destructively */
  takeover?(sessionId: string, options?: Record<string, unknown>): Record<string, unknown>;
}

interface ActivityLogModule {
  log(type: string, opts: {
    agentId?: string | null;
    targetId?: string | null;
    details: string;
    metadata: Record<string, unknown>;
  }): void;
}

/**
 * Minimal structural view of lib/roadmap-items.ts used by the rent-at-claim
 * gate: slug validation (--roadmap), draft genesis (--roadmap-new).
 */
interface RoadmapItemsModule {
  list(options?: { harbor?: string; status?: 'all' | 'now' | 'backlog'; limit?: number }): Array<{ slug: string; summaryMd: string; status: string; harbor: string }>;
  /** Exact existence check across all harbors — no list() cap involved. */
  slugExists(slug: string): boolean;
  upsert(input: {
    slug: string;
    summaryMd: string;
    status?: 'now' | 'backlog' | 'parked' | 'merge' | 'done';
    promotedByAgentId?: string;
    project?: string;
    notes?: Array<{ at: number; by: string; text: string }>;
  }): { slug: string; harbor: string };
}

interface FeedbackModule {
  list(options?: { harbor?: string; status?: 'open' | 'all'; limit?: number }): Array<{
    feedbackId: string;
    slug: string;
    summary: string;
    severity: string;
    status: string;
    droppedBy: string;
    surface: string | null;
    at: number;
  }>;
}

interface CommitmentsModule {
  create(input: {
    ownerActorId: string;
    objectText: string;
    successCheck?: string | null;
    impossibleCheck?: string | null;
    motivationCheck?: string | null;
    scope?: 'claim' | 'review' | 'standing' | 'default';
    commitmentStrategy?: 'single' | 'open';
  }): any;
  close(id: string, oracleRef: string): any;
  list(options?: Record<string, unknown>): any;
}

interface SugarDeps {
  agents: AgentsModule;
  sessions: SessionsModule;
  activityLog: ActivityLogModule;
  /**
   * Optional roadmap store. When present, `begin` can validate --roadmap
   * slugs and create draft items for --roadmap-new. When absent, those two
   * paths fail closed with ROADMAP_ITEMS_UNAVAILABLE (sidequest still works).
   */
  roadmapItems?: RoadmapItemsModule;
  /**
   * Optional git-origin checker. Defaults to a real-git implementation.
   * Tests inject a stub to simulate ahead / no-upstream / clean states
   * without touching a real repo.
   */
  gitOriginChecker?: GitOriginChecker;
  feedback?: FeedbackModule;
  commitments?: CommitmentsModule;
  /**
   * Read-only verified-context boundary supplied by the composition root. It
   * is intentionally optional while older daemon embeddings lack the M6
   * ledger, so a missing capability returns `none` rather than inventing a
   * transcript-derived continuation.
   */
  contextBootstrapLookup?: ContextBootstrapLookup;
}

/**
 * Exact-session lookup seam for the compaction ledger. A caller may ask only
 * about a predecessor that the surrounding session operation has already
 * proven; this function never performs identity, task, or workspace matching.
 */
export type ContextBootstrapLookup = (sourceSessionId: string) => VerifiedContextBootstrapLookup;

/**
 * Bounded entry-path continuation returned to a new or takeover session.
 * `ready` contains just the verified packet identifiers and last checkpointed
 * plan, not a raw provider transcript or the packet's cited excerpts.
 */
export type ContextContinuationProjection =
  | { status: 'none' }
  | {
      status: 'withheld';
      sourceSessionId: string;
      packetId: string | null;
      reason: 'verified-context-bootstrap-withheld' | 'verified-context-bootstrap-invalid';
    }
  | {
      status: 'ready';
      sourceSessionId: string;
      packet: {
        packetId: string;
        createdAt: string;
        sourceHeadEventId: string;
        sourceHeadHash: string;
        transcriptEventId: string | null;
        contextEnvelopeRef: string | null;
      };
      planCheckpoint: {
        transcriptEventId: string;
        content: string;
        capturedAt: string;
      };
    };

const MAX_ENTRY_CONTEXT_ID_BYTES = 512;
const MAX_ENTRY_CONTEXT_PLAN_BYTES = 16 * 1024;

/**
 * Project a verified compaction lookup into the small continuation contract
 * that session entry paths may expose. The design validates the injected
 * lookup again at the boundary: a malformed fixture or stale adapter is
 * `withheld`, never a reason to substitute notes or raw transcript material.
 *
 * @param sourceSessionId - The exact predecessor established by the caller's
 *   successful takeover or salvage operation.
 * @param lookup - Optional daemon-owned lookup over the append-only ledger.
 * @returns A bounded `none`, `ready`, or `withheld` continuation projection.
 */
export function projectContextContinuation(
  sourceSessionId: string | null | undefined,
  lookup?: ContextBootstrapLookup,
): ContextContinuationProjection {
  const source = typeof sourceSessionId === 'string' ? sourceSessionId.trim() : '';
  if (!source || !lookup) return { status: 'none' };

  try {
    const result = lookup(source);
    if (result.status === 'none') return { status: 'none' };
    if (result.sourceSessionId !== source) {
      return {
        status: 'withheld',
        sourceSessionId: source,
        packetId: null,
        reason: 'verified-context-bootstrap-invalid',
      };
    }
    if (result.status === 'withheld') {
      return {
        status: 'withheld',
        sourceSessionId: source,
        packetId: typeof result.packetId === 'string'
          && Buffer.byteLength(result.packetId, 'utf8') <= MAX_ENTRY_CONTEXT_ID_BYTES
          ? result.packetId
          : null,
        reason: 'verified-context-bootstrap-withheld',
      };
    }

    const { packet, bootstrap } = result;
    const checkpoint = bootstrap.planCheckpoint;
    const packetFields = [
      packet.packetId,
      packet.createdAt,
      packet.sourceTranscript.headEventId,
      packet.sourceTranscript.headHash,
    ];
    const checkpointIsBounded = checkpoint !== null && (
      typeof checkpoint.transcriptEventId === 'string'
      && typeof checkpoint.content === 'string'
      && typeof checkpoint.capturedAt === 'string'
      && Buffer.byteLength(checkpoint.transcriptEventId, 'utf8') <= MAX_ENTRY_CONTEXT_ID_BYTES
      && Buffer.byteLength(checkpoint.capturedAt, 'utf8') <= MAX_ENTRY_CONTEXT_ID_BYTES
      && Buffer.byteLength(checkpoint.content, 'utf8') <= MAX_ENTRY_CONTEXT_PLAN_BYTES
    );
    const packetIsBounded = packetFields.every((value) => typeof value === 'string'
      && value.trim().length > 0
      && Buffer.byteLength(value, 'utf8') <= MAX_ENTRY_CONTEXT_ID_BYTES);
    const contextEnvelopeRef = typeof packet.trigger.contextEnvelopeRef === 'string'
      && Buffer.byteLength(packet.trigger.contextEnvelopeRef, 'utf8') <= MAX_ENTRY_CONTEXT_ID_BYTES
      ? packet.trigger.contextEnvelopeRef
      : null;
    if (
      !packetIsBounded
      || !checkpointIsBounded
      || packet.sessionId !== source
      || bootstrap.sessionId !== source
      || bootstrap.packet.packetId !== packet.packetId
      || !packet.validator.passed
      || !bootstrap.revalidation.passed
    ) {
      return {
        status: 'withheld',
        sourceSessionId: source,
        packetId: null,
        reason: 'verified-context-bootstrap-invalid',
      };
    }

    return {
      status: 'ready',
      sourceSessionId: source,
      packet: {
        packetId: packet.packetId,
        createdAt: packet.createdAt,
        sourceHeadEventId: packet.sourceTranscript.headEventId,
        sourceHeadHash: packet.sourceTranscript.headHash,
        transcriptEventId: packet.transcriptEventId ?? null,
        contextEnvelopeRef,
      },
      planCheckpoint: {
        transcriptEventId: checkpoint.transcriptEventId,
        content: checkpoint.content,
        capturedAt: checkpoint.capturedAt,
      },
    };
  } catch {
    return {
      status: 'withheld',
      sourceSessionId: source,
      packetId: null,
      reason: 'verified-context-bootstrap-invalid',
    };
  }
}

interface BeginOptions {
  purpose?: string;
  agentId?: string;
  name?: string;
  identity?: string;
  type?: string;
  files?: string[];
  force?: boolean;
  metadata?: Record<string, unknown>;
  worktree?: SessionWorktreeContext;
  requireLinkedWorktree?: boolean;
  allowMainWorktree?: boolean;
  /** Session retention behavior. Durable survives without a live heartbeat process. */
  lifecycle?: 'durable' | 'ephemeral';
  /**
   * Rent-at-claim (S3): link the session to an EXISTING roadmap item by slug.
   * Validated against the roadmap store; mutually exclusive with the other two.
   */
  roadmapLink?: string;
  /** Rent-at-claim opt-out: one-line reason this work is off-roadmap (min 12 chars). */
  sidequestReason?: string;
  /** Rent-at-claim genesis: create a DRAFT roadmap item with this title and link it. */
  roadmapNewTitle?: string;
  /**
   * Skip the crowded-main-worktree collision check. Set by the CLI when
   * allowMainWorktree was triggered by the long-standing env var
   * (PORT_DADDY_ALLOW_MAIN_WORKTREE_SESSION) rather than the
   * --allow-main-worktree flag. CI / single-user setups don't need the
   * interactive collision check; humans opting in explicitly still do.
   */
  bypassCrowdedGate?: boolean;
}

interface DoneOptions {
  agentId?: string;
  sessionId?: string;
  note?: string;
  status?: string;
  /**
   * Operator escape hatch. When true, the origin-push + result-note
   * preconditions are skipped. `skipOriginCheckReason` is REQUIRED — the
   * override is loud (the final note gets a [OPERATOR-OVERRIDE] prefix).
   */
  skipOriginCheck?: boolean;
  skipOriginCheckReason?: string;
  noPr?: boolean;
  subtask?: boolean;
  forceIncomplete?: boolean;
  forceIncompleteReason?: string;
}

interface WhoamiOptions {
  agentId?: string;
  sessionId?: string;
}

/**
 * Anti-Goodhart valve for rent-at-claim: `relink` re-points the ACTIVE
 * session's rent fields. A wrong link picked just to satisfy the begin gate
 * must never be sticky — fixing it is one command, and the fix is audited.
 */
interface RelinkOptions {
  agentId?: string;
  sessionId?: string;
  /** Link to an EXISTING roadmap item by slug (validated, did-you-mean on miss). */
  roadmapLink?: string;
  /** Opt out with a one-line reason (min 12 chars). */
  sidequestReason?: string;
}

// Rent-at-claim (S3): the one-line cost of starting a session is either a
// roadmap link or an explicit opt-out reason. 12 chars forces a real sentence
// fragment ("fixing CI flake") instead of "stuff" / "work" / "misc".
export const SIDEQUEST_REASON_MIN_CHARS = 12;

function slugifyRoadmapTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/**
 * Did-you-mean for roadmap slugs: rank candidates by shared prefix length
 * with the requested slug. Deliberately dumb — plain string prefixes only,
 * no similarity scoring (operator ruling 2026-07-09).
 */
export function nearestSlugsByPrefix(input: string, slugs: string[], max = 5): string[] {
  const seen = new Set<string>();
  return slugs
    .map((slug) => ({ slug, lcp: commonPrefixLen(input, slug) }))
    .filter((entry) => entry.lcp >= 3)
    .sort((a, b) => b.lcp - a.lcp || a.slug.localeCompare(b.slug))
    .filter((entry) => (seen.has(entry.slug) ? false : (seen.add(entry.slug), true)))
    .slice(0, max)
    .map((entry) => entry.slug);
}

function lifecycleForSession(session: Record<string, unknown>): 'durable' | 'ephemeral' {
  return session.durable === true || session.is_durable === 1 || session.is_durable === true
    ? 'durable'
    : 'ephemeral';
}

// =============================================================================
// Module factory
// =============================================================================

export function createSugar(deps: SugarDeps) {
  const { agents, sessions, activityLog } = deps;
  const gitOriginChecker: GitOriginChecker = deps.gitOriginChecker || createGitOriginChecker();

  function sessionTarget(identityProject: string | null | undefined, sessionId: string): string {
    return identityProject ? `${identityProject}:session:${sessionId}` : sessionId;
  }

  function buildWhoamiResponse(
    session: Record<string, unknown>,
    notes: unknown[],
    files: Array<Record<string, unknown>>,
    agent: Record<string, unknown> | null,
    fallbackAgentId?: string,
  ) {
    const sessionId = session.id as string;
    const startedAt = typeof session.createdAt === 'number' ? session.createdAt : Date.now();
    const sessionMeta = session.metadata && typeof session.metadata === 'object'
      ? session.metadata as Record<string, unknown>
      : null;

    return {
      success: true,
      active: true,
      agentId: typeof session.agentId === 'string' ? session.agentId : fallbackAgentId,
      sessionId,
      purpose: session.purpose as string,
      sessionName: deriveAgentDisplayName({ purpose: session.purpose as string, fallback: 'Port Daddy Session' }),
      agentName: cleanAgentDisplayName(agent?.name) || null,
      name: cleanAgentDisplayName(agent?.name) || null,
      identity: typeof agent?.identity === 'string' ? agent.identity : null,
      phase: session.phase as string || 'in_progress',
      files: files
        .filter((file: Record<string, unknown>) => !file.releasedAt)
        .map((file: Record<string, unknown>) => file.filePath as string),
      noteCount: notes.length,
      startedAt,
      duration: Date.now() - startedAt,
      // Rent-at-claim (S3): surface the roadmap link / sidequest opt-out.
      roadmapLink: typeof sessionMeta?.roadmapLink === 'string' ? sessionMeta.roadmapLink : null,
      sidequestReason: typeof sessionMeta?.sidequestReason === 'string' ? sessionMeta.sidequestReason : null,
    };
  }

  /**
   * Begin — register agent + start session atomically.
   * Rolls back agent registration if session start fails.
   */
  function begin(options: BeginOptions) {
    const { purpose, identity, type, files, force } = options;

    if (!purpose || typeof purpose !== 'string' || !purpose.trim()) {
      return { success: false, error: 'purpose is required' };
    }

    const lifecycle = options.lifecycle;
    if (lifecycle !== 'durable' && lifecycle !== 'ephemeral') {
      return {
        success: false,
        error: 'lifecycle is required and must be "durable" or "ephemeral"',
        code: 'SESSION_LIFECYCLE_REQUIRED',
      };
    }
    const durable = lifecycle === 'durable';

    const worktreePolicy = evaluateSessionWorktreePolicy({
      worktree: options.worktree,
      requireLinkedWorktree: options.requireLinkedWorktree,
      allowMainWorktree: options.allowMainWorktree,
    });
    if (!worktreePolicy.success) {
      return {
        success: false,
        error: worktreePolicy.error,
        code: worktreePolicy.code,
        hint: worktreePolicy.hint,
        worktree: worktreePolicy.worktree,
      };
    }

    // =========================================================================
    // Rent-at-claim (S3): resolve the roadmap link / sidequest opt-out BEFORE
    // the resume decision so a bogus --roadmap slug fails loudly instead of
    // silently resuming. Enforcement (refusing when none is given) lives in
    // the pd CLI and the MCP begin_session tool — the daemon's raw HTTP
    // surface stays lenient for direct programmatic callers in v1.
    // =========================================================================
    const rent: {
      roadmapLink?: string;
      sidequestReason?: string;
      roadmapCreated?: boolean;
      roadmapExisting?: boolean;
    } = {};
    // Deferred --roadmap-new write. Validation happens up front (fail loudly
    // before any other work), but the roadmap INSERT is deferred until the
    // begin actually succeeds — a begin that dies at the crowded-worktree
    // gate or at agent/session registration must not leave an orphan roadmap
    // item behind (there is no rollback for it).
    let pendingRoadmapNew: { slug: string; title: string; by: string; project?: string } | null = null;
    {
      const givenRentFields = [options.roadmapLink, options.sidequestReason, options.roadmapNewTitle]
        .filter((v) => v !== undefined && v !== null);
      if (givenRentFields.length > 1) {
        return {
          success: false,
          error: 'roadmapLink, sidequestReason, and roadmapNewTitle are mutually exclusive — pass exactly one.',
          code: 'ROADMAP_RENT_CONFLICT',
        };
      }

      const rentParsedIdentity = identity ? parseIdentity(identity) : null;
      const rentProject = rentParsedIdentity && rentParsedIdentity.valid ? rentParsedIdentity.project : undefined;

      if (options.sidequestReason !== undefined) {
        const reason = typeof options.sidequestReason === 'string' ? options.sidequestReason.trim() : '';
        if (reason.length < SIDEQUEST_REASON_MIN_CHARS) {
          return {
            success: false,
            error: `sidequest reason must be at least ${SIDEQUEST_REASON_MIN_CHARS} characters — say what the work actually is.`,
            code: 'SIDEQUEST_REASON_TOO_SHORT',
          };
        }
        rent.sidequestReason = reason;
      }

      if (options.roadmapLink !== undefined) {
        if (!deps.roadmapItems) {
          return {
            success: false,
            error: 'roadmap linking requires the roadmap service, which is not available on this daemon.',
            code: 'ROADMAP_ITEMS_UNAVAILABLE',
          };
        }
        const requested = typeof options.roadmapLink === 'string' ? options.roadmapLink.trim() : '';
        // Validate across ALL harbors: items are created under project-scoped
        // harbors ('port-daddy', 'demo:fleet', 'fleet') by different writers,
        // and a link to any of them is a real link. Existence is an exact
        // indexed lookup (slugExists) — never a capped list() scan, which
        // would reject valid slugs once the table outgrows the cap. The
        // capped list feeds ONLY the did-you-mean suggestions.
        if (!requested || !deps.roadmapItems.slugExists(requested)) {
          const slugs = deps.roadmapItems.list({ status: 'all', limit: 5000 }).map((item) => item.slug);
          const didYouMean = nearestSlugsByPrefix(requested, slugs);
          return {
            success: false,
            error: `Unknown roadmap slug "${requested}".`
              + (didYouMean.length > 0 ? ` Did you mean: ${didYouMean.join(', ')}?` : ''),
            code: 'ROADMAP_SLUG_UNKNOWN',
            didYouMean,
          };
        }
        rent.roadmapLink = requested;
      }

      if (options.roadmapNewTitle !== undefined) {
        const title = typeof options.roadmapNewTitle === 'string' ? options.roadmapNewTitle.trim() : '';
        const slug = slugifyRoadmapTitle(title);
        if (!title || !slug) {
          return {
            success: false,
            error: 'roadmapNewTitle must be a non-empty title.',
            code: 'ROADMAP_TITLE_REQUIRED',
          };
        }
        if (!deps.roadmapItems) {
          return {
            success: false,
            error: 'roadmap item creation requires the roadmap service, which is not available on this daemon.',
            code: 'ROADMAP_ITEMS_UNAVAILABLE',
          };
        }
        const by = options.agentId || 'pd-begin';
        if (deps.roadmapItems.slugExists(slug)) {
          // Slug collision: the item already exists (possibly in another
          // harbor). LINK to it instead of upserting — an upsert here would
          // silently rewrite the existing item's summary/status/notes from a
          // begin() call that never intended an edit.
          rent.roadmapLink = slug;
          rent.roadmapExisting = true;
        } else {
          pendingRoadmapNew = { slug, title, by, project: rentProject };
          rent.roadmapLink = slug;
          rent.roadmapCreated = true;
        }
      }
    }
    const rentMetadata: Record<string, unknown> = {};
    if (rent.roadmapLink) rentMetadata.roadmapLink = rent.roadmapLink;
    if (rent.sidequestReason) rentMetadata.sidequestReason = rent.sidequestReason;
    // Materialize the deferred --roadmap-new item. Called ONLY on the two
    // success paths (resume, fresh start) after the begin can no longer fail.
    const materializePendingRoadmapNew = () => {
      if (!pendingRoadmapNew || !deps.roadmapItems) return;
      const { slug, title, by, project } = pendingRoadmapNew;
      pendingRoadmapNew = null;
      deps.roadmapItems.upsert({
        slug,
        summaryMd: title,
        status: 'backlog',
        promotedByAgentId: by,
        project,
        notes: [{ at: Date.now(), by, text: 'genesis-at-begin' }],
      });
    };

    // Idempotent resume. A re-begin for the SAME identity in the SAME worktree
    // must RESUME the existing active session, not fork a parallel one. Forking
    // was the dual-session bug: the first session held the file claims, the
    // second could not re-claim, and the Coordination Guard then rejected the
    // commit. This mirrors the repo's claim/release idempotency discipline.
    // Opt out with an explicit `agentId` or `force: true`.
    const resumeParsed = identity ? parseIdentity(identity) : null;
    const resumeProject = resumeParsed && resumeParsed.valid ? resumeParsed.project : null;
    if (!force && !options.agentId && resumeProject) {
      // Scope to the current worktree. When the policy resolved a worktree use
      // its id; otherwise let list() auto-detect via getWorktreeId() (same
      // default sessions.start() uses), so create + lookup agree.
      const listOpts: Record<string, unknown> = { status: 'active', allWorktrees: false, limit: 50 };
      if (worktreePolicy.worktree) listOpts.worktreeId = worktreePolicy.worktree.id;
      const active = sessions.list(listOpts);
      const activeRows: Array<Record<string, unknown>> =
        active && typeof active === 'object' && Array.isArray((active as { sessions?: unknown[] }).sessions)
          ? ((active as { sessions: Array<Record<string, unknown>> }).sessions)
          : [];
      // Match on the EXACT full identity, not just the project: two identities
      // that share a project but differ by stack/context (demo:test:alpha vs
      // demo:test:beta) must NOT collapse. identityProject is a cheap pre-filter;
      // the agent's full identity is the real key.
      let match: Record<string, unknown> | undefined;
      let matchAgent: { identity?: unknown; timeSinceHeartbeat?: unknown } | undefined;
      for (const s of activeRows) {
        if (!s || s.identityProject !== resumeProject || typeof s.agentId !== 'string') continue;
        
        // `identityString`, not `identity`: the latter is the daemon's
        // reserved identity-verdict slot (lib/identity-write-boundary.ts).
        let storedIdentity: string | null = null;
        if (s.metadata && typeof s.metadata === 'object') {
          const metaObj = s.metadata as Record<string, unknown>;
          if (typeof metaObj.identityString === 'string') {
            storedIdentity = metaObj.identityString;
          }
        } else if (s.metadata && typeof s.metadata === 'string') {
          try {
            const parsed = JSON.parse(s.metadata);
            if (parsed && typeof parsed.identityString === 'string') {
              storedIdentity = parsed.identityString;
            }
          } catch (e) {}
        }

        if (storedIdentity === identity) {
          match = s;
          const agentResult = agents.get(s.agentId) as { agent?: { identity?: unknown; timeSinceHeartbeat?: unknown } };
          if (agentResult && agentResult.agent) matchAgent = agentResult.agent;
          break;
        }

        // Fallback to agent roster
        const agentResult = agents.get(s.agentId) as { agent?: { identity?: unknown; timeSinceHeartbeat?: unknown } };
        if (agentResult && agentResult.agent && agentResult.agent.identity === identity) {
          match = s;
          matchAgent = agentResult.agent;
          break;
        }
      }

      if (!match) {
        // Fall back to recently closed (completed or abandoned) sessions of the same identity in the same worktree
        const listOptsClosed: Record<string, unknown> = { allWorktrees: false, limit: 50 };
        if (worktreePolicy.worktree) listOptsClosed.worktreeId = worktreePolicy.worktree.id;
        const allSessions = sessions.list(listOptsClosed);
        const allRows: Array<Record<string, unknown>> =
          allSessions && typeof allSessions === 'object' && Array.isArray((allSessions as { sessions?: unknown[] }).sessions)
            ? ((allSessions as { sessions: Array<Record<string, unknown>> }).sessions)
            : [];
        for (const s of allRows) {
          if (!s || s.status === 'active' || s.identityProject !== resumeProject || typeof s.agentId !== 'string') {
            continue;
          }

          // `identityString`, not `identity`: the latter is the daemon's
          // reserved identity-verdict slot (lib/identity-write-boundary.ts).
          let storedIdentity: string | null = null;
          if (s.metadata && typeof s.metadata === 'object') {
            const metaObj = s.metadata as Record<string, unknown>;
            if (typeof metaObj.identityString === 'string') {
              storedIdentity = metaObj.identityString;
            }
          } else if (s.metadata && typeof s.metadata === 'string') {
            try {
              const parsed = JSON.parse(s.metadata);
              if (parsed && typeof parsed.identityString === 'string') {
                storedIdentity = parsed.identityString;
              }
            } catch (e) {}
          }

          if (storedIdentity === identity) {
            match = s;
            const agentResult = agents.get(s.agentId) as { agent?: { identity?: unknown; timeSinceHeartbeat?: unknown } };
            if (agentResult && agentResult.agent) matchAgent = agentResult.agent;
            break;
          }

          // Fallback to agent roster
          const agentResult = agents.get(s.agentId) as { agent?: { identity?: unknown; timeSinceHeartbeat?: unknown } };
          if (agentResult && agentResult.agent && agentResult.agent.identity === identity) {
            match = s;
            matchAgent = agentResult.agent;
            break;
          }
        }
      }

      if (match && typeof match.id === 'string' && typeof match.agentId === 'string') {
        if (match.status !== 'active' && sessions.takeover) {
          // Resumption / takeover of recently closed session
          const finalAgentId = options.agentId || match.agentId;
          const takeoverRes = sessions.takeover(match.id, {
            agentId: finalAgentId,
            purpose: purpose.trim(),
            project: resumeProject,
            worktreeId: worktreePolicy.worktree?.id || undefined,
            durable: durable,
            claimFiles: true,
            metadata: {
              ...rentMetadata,
              takeoverReason: 'Idempotent resumption of recently closed session',
            }
          }) as any;

          if (takeoverRes && takeoverRes.success) {
            materializePendingRoadmapNew();
            const displayName = takeoverRes.sessionName || purpose.trim();
            const resumed: Record<string, unknown> = {
              success: true,
              resumed: true,
              takeover: true,
              agentId: finalAgentId,
              sessionId: takeoverRes.successorId,
              agentName: displayName,
              sessionName: displayName,
              name: displayName,
              identity: identity || null,
              purpose: purpose.trim(),
              lifecycle: durable ? 'durable' : 'ephemeral',
              agentRegistered: false,
              sessionStarted: false,
            };
            if (worktreePolicy.worktree) resumed.worktree = worktreePolicy.worktree;
            if (takeoverRes.claimedFiles) resumed.fileClaims = takeoverRes.claimedFiles;
            if (takeoverRes.conflicts) resumed.fileConflicts = takeoverRes.conflicts;
            if (rent.roadmapLink) resumed.roadmapLink = rent.roadmapLink;
            if (rent.sidequestReason) resumed.sidequestReason = rent.sidequestReason;
            if (rent.roadmapCreated) resumed.roadmapCreated = true;
            if (rent.roadmapExisting) resumed.roadmapExisting = true;
            // The takeover result, not a caller-provided field, proves which
            // predecessor may contribute bounded context. A missing/invalid
            // lookup remains `none`/`withheld`; it never falls back to notes.
            resumed.contextContinuation = projectContextContinuation(
              typeof takeoverRes.predecessorId === 'string' ? takeoverRes.predecessorId : null,
              deps.contextBootstrapLookup,
            );

            // Auto-enroll commitment for takeover
            if (deps.commitments) {
              deps.commitments.create({
                ownerActorId: finalAgentId,
                objectText: `De-register agent and close session for project: ${identity || 'default'}`,
                scope: 'default',
                commitmentStrategy: 'single',
                successCheck: `session:${takeoverRes.successorId}:completed`,
              });
            }

            activityLog.log('sugar_begin', {
              agentId: finalAgentId,
              details: 'sugar_begin_takeover_closed',
              metadata: { sessionId: takeoverRes.successorId, predecessorSessionId: match.id, identity: identity || null },
            });
            return resumed;
          }
        } else if (match.status === 'active') {
        // A session is a DURABLE WORK CONTEXT: resume it whether a process is
        // actively driving it (active) or it's been parked since you closed your
        // laptop (dormant). Only a `done` session forks a fresh one. See
        // lib/session-liveness.ts.
        const nowMs = Date.now();
        const sinceBeat = typeof matchAgent?.timeSinceHeartbeat === 'number' ? matchAgent.timeSinceHeartbeat : null;
        const liveness = classifySessionLiveness({
          status: typeof match.status === 'string' ? match.status : 'active',
          attachedAgentId: match.agentId,
          lastHeartbeatMs: sinceBeat == null ? null : nowMs - sinceBeat,
          nowMs,
          liveTtlMs: SESSION_DRIVING_TTL_MS,
        });
        const decision = decideBeginResume(liveness);
        if (decision.action === 'resume') {
          const resumedSessionId: string = match.id;
          const resumedAgentId: string = match.agentId;
          const displayName =
            (typeof match.agentName === 'string' && match.agentName)
            || (typeof match.name === 'string' && match.name)
            || identity
            || 'Port Daddy Agent';
          const resumed: Record<string, unknown> = {
            success: true,
            resumed: true,
            agentId: resumedAgentId,
            sessionId: resumedSessionId,
            agentName: displayName,
            sessionName: displayName,
            name: displayName,
            identity: identity || null,
            purpose: purpose.trim(),
            lifecycle: lifecycleForSession(match),
            agentRegistered: false,
            sessionStarted: false,
          };
          if (worktreePolicy.worktree) resumed.worktree = worktreePolicy.worktree;
          if (files && files.length > 0) {
            const claim = sessions.claimFiles(resumedSessionId, files, { agentId: resumedAgentId }) as Record<string, unknown>;
            if (claim && typeof claim === 'object') {
              if ('claimed' in claim) resumed.fileClaims = claim.claimed;
              if (Array.isArray(claim.conflicts) && claim.conflicts.length > 0) resumed.fileConflicts = claim.conflicts;
            }
          }
          // Rent-at-claim: a fresh link/reason on re-begin updates the
          // resumed session's record (the link is session state, not call state).
          // Switching rent MODE clears the other field — a session is either
          // roadmap-linked or a sidequest, never ambiguously both.
          if (Object.keys(rentMetadata).length > 0) {
            materializePendingRoadmapNew();
            const rentPatch: Record<string, unknown> = { ...rentMetadata };
            if (rent.roadmapLink) rentPatch.sidequestReason = undefined;
            if (rent.sidequestReason) rentPatch.roadmapLink = undefined;
            sessions.updateMetadata?.(resumedSessionId, rentPatch);
          }
          if (rent.roadmapLink) resumed.roadmapLink = rent.roadmapLink;
          if (rent.sidequestReason) resumed.sidequestReason = rent.sidequestReason;
          if (rent.roadmapCreated) resumed.roadmapCreated = true;
          if (rent.roadmapExisting) resumed.roadmapExisting = true;
          // Re-attaching a harness to this exact durable session makes that
          // session the explicit continuation source. It is never discovered
          // by identity, workspace, agent, or prior-note similarity.
          resumed.contextContinuation = projectContextContinuation(
            resumedSessionId,
            deps.contextBootstrapLookup,
          );
          if (decision.warn === 'driven-elsewhere') {
            resumed.warn = 'Another live process is already driving this session; attaching anyway (worktree isolation is the real guard).';
          }
          activityLog.log('sugar_begin', {
            agentId: resumedAgentId,
            details: 'sugar_begin_resumed',
            metadata: { sessionId: resumedSessionId, identity: identity || null },
          });
          return resumed;
        }
        // decision.action === 'create' falls through to start a fresh session.
      }
    }
  }

    // Crowded-main-worktree gate. `--allow-main-worktree` survives only
    // when the operator is alone in the main worktree. As soon as another
    // live session exists in the same main worktree, both must move to
    // linked worktrees — concurrent agents in one tree corrupt each
    // other's edits via shared `.git` state (branch switches, rebases,
    // unstaged-file wipes).
    //
    // Known gaps (acceptable for v1, follow-ups tracked):
    //   - SELECT-then-INSERT race: two begin() calls within ~ms both
    //     see 0 collisions and both register. Window is small; atomic
    //     fix would need a tx around sessions.start or a unique idx.
    //   - Zombie sessions (active row, dead process) block legitimate
    //     next agents until reaped. Same pattern in sessions.ts:1199.
    //   - sessions.start() called via routes/sessions.ts:351 bypasses
    //     this gate. Tracked as a follow-up; users hitting /sessions/start
    //     directly are aware of the policy already.
    if (
      worktreePolicy.worktree
      && worktreePolicy.worktree.isMain
      && options.allowMainWorktree === true
      && options.bypassCrowdedGate !== true
    ) {
      // Yes/no collision check — limit: 1 keeps it cheap. We deliberately
      // don't surface a count because list() with a low limit would
      // under-report; senders just need to know they're not alone.
      const colliding = sessions.list({
        status: 'active',
        worktreeId: worktreePolicy.worktree.id,
        allWorktrees: false,
        limit: 1,
      });
      const rows = (colliding && typeof colliding === 'object' && 'sessions' in colliding
        ? (colliding as { sessions?: unknown[] }).sessions
        : Array.isArray(colliding) ? colliding : null);
      const hasCollision = Array.isArray(rows) && rows.length > 0;
      if (hasCollision) {
        return {
          success: false,
          error:
            `Refusing main-worktree session: another active session is already in this worktree (${worktreePolicy.worktree.root}). `
            + `Concurrent agents on the same main worktree corrupt each other via shared .git state.`,
          code: 'MAIN_WORKTREE_CROWDED',
          // Do not name the `--allow-main-worktree` bypass in this agent-facing
          // hint: the agent we just stopped would simply take that exit. The
          // hint points only to the correct action; the flag stays in `--help`.
          hint:
            `Create a linked worktree and run pd begin there:\n`
            + `  git worktree add ~/coding/tmp/${(options.identity ?? options.name ?? 'work').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'work'} -b <branch>\n`
            + `then cd into it before calling pd begin.`,
          worktree: worktreePolicy.worktree,
        };
      }
    }

    const worktreeMetadata = mergeSessionWorktreeMetadata(options.metadata, worktreePolicy.worktree, {
      requireLinkedWorktree: options.requireLinkedWorktree,
      allowMainWorktree: options.allowMainWorktree,
    });
    const metadata = Object.keys(rentMetadata).length > 0
      ? { ...(worktreeMetadata && typeof worktreeMetadata === 'object' ? worktreeMetadata : {}), ...rentMetadata }
      : worktreeMetadata;

    const name = deriveAgentDisplayName({
      name: options.name,
      purpose,
      identity,
      type,
      fallback: 'Port Daddy Agent',
    });
    const sessionName = deriveAgentDisplayName({
      name: options.name,
      purpose,
      identity,
      type,
      fallback: 'Port Daddy Session',
    });
    // Generate or use provided agent ID. The suffix keeps the stable machine key
    // unique; the slug keeps `pd begin` output readable to humans.
    const agentId = options.agentId || buildHumanReadableId('agent', name, randomBytes(4).toString('hex'), 'work');

    // Step 1: Register the agent
    const registerOpts: Record<string, unknown> = {};
    if (name) registerOpts.name = name;
    if (identity) registerOpts.identity = identity;
    if (purpose) registerOpts.purpose = purpose;
    if (type) registerOpts.type = type;
    if (metadata) registerOpts.metadata = metadata;
    if (worktreePolicy.worktree) registerOpts.worktreeId = worktreePolicy.worktree.id;

    const agentResult = agents.register(agentId, registerOpts);
    if (!agentResult.success) {
      return {
        success: false,
        error: `Agent registration failed: ${agentResult.error}`,
        code: agentResult.code || 'AGENT_REGISTRATION_FAILED',
      };
    }

    // Step 2: Start session (rollback agent on failure)
    const sessionOpts: Record<string, unknown> = { agentId };
    if (worktreePolicy.worktree) sessionOpts.worktreeId = worktreePolicy.worktree.id;
    let identityProject: string | null = null;
    if (identity) {
      const parsedIdentity = parseIdentity(identity);
      if (parsedIdentity.valid) {
        identityProject = parsedIdentity.project;
        sessionOpts.project = parsedIdentity.project;
      }
    }
    if (files && files.length > 0) {
      sessionOpts.files = files;
      if (force) sessionOpts.force = force;
    }
    // `identity` is the RESERVED daemon verdict slot (lib/identity-write-boundary.ts
    // `stampIdentityMetadata`), and routes/sugar.ts has already stamped the
    // verified actorId into it. Writing the display `project:stack:context`
    // string there erased the daemon's stamp on every `pd begin` session,
    // which (a) left routes/sessions.ts' file-claim soul check with nothing to
    // compare against for begin-created sessions and (b) removed the only
    // daemon-witnessed display-agentId → soul binding, which the inbox sender
    // gate needs (lib/inbox-identity.ts branch (b)). The display string keeps
    // its own key; the verdict slot belongs to the daemon.
    const sessionMetadata = {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      identityString: identity || null,
    };
    sessionOpts.metadata = sessionMetadata;
    if (durable) {
      sessionOpts.durable = true;
    }

    const sessionResult = sessions.start(purpose.trim(), sessionOpts);
    if (!sessionResult.success) {
      // Rollback: unregister the agent
      agents.unregister(agentId);
      return {
        success: false,
        error: `Session start failed: ${sessionResult.error}`,
        code: 'SESSION_START_FAILED',
      };
    }

    // Begin succeeded — safe to materialize the deferred --roadmap-new item.
    materializePendingRoadmapNew();

    // Build response
    const response: Record<string, unknown> = {
      success: true,
      agentId,
      sessionId: sessionResult.id,
      agentName: name,
      sessionName,
      name,
      identity: identity || null,
      purpose: purpose.trim(),
      lifecycle,
      agentRegistered: true,
      sessionStarted: true,
    };
    if (worktreePolicy.worktree) response.worktree = worktreePolicy.worktree;
    if (rent.roadmapLink) response.roadmapLink = rent.roadmapLink;
    if (rent.sidequestReason) response.sidequestReason = rent.sidequestReason;
    if (rent.roadmapCreated) response.roadmapCreated = true;
    if (rent.roadmapExisting) response.roadmapExisting = true;
    // Fresh begin has no proven lineage. In particular, it must not search
    // for a similar-looking historical session and attach its packet.
    response.contextContinuation = { status: 'none' };

    // Include file claims if present
    if (sessionResult.files) {
      response.fileClaims = sessionResult.files;
    }
    if (sessionResult.conflicts && Array.isArray(sessionResult.conflicts) && (sessionResult.conflicts as unknown[]).length > 0) {
      response.fileConflicts = sessionResult.conflicts;
    }

    // Include salvage hint from agent registration
    if (agentResult.salvageHint) {
      response.salvageHint = agentResult.salvageHint;
    }

    activityLog.log('sugar_begin', {
      agentId,
      targetId: sessionTarget(identityProject, sessionResult.id as string),
      details: `Agent ${agentId} began: ${purpose.trim()}`,
      metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        agentId,
        sessionId: sessionResult.id as string,
        identity: identity || null,
        identityProject: identityProject || undefined,
        lifecycle,
      } as unknown as Record<string, unknown>,
    });

    // Auto-enroll commitment to complete session (Law 1: daemon/module derives deadline)
    if (deps.commitments) {
      deps.commitments.create({
        ownerActorId: agentId,
        objectText: `De-register agent and close session for project: ${identity || 'default'}`,
        scope: 'default',
        commitmentStrategy: 'single',
        successCheck: `session:${sessionResult.id}:completed`,
      });
    }

    return response;
  }

  /**
   * Done — end session + unregister agent.
   * Finds active session by agentId if sessionId not provided.
   *
   * Hard preconditions (enforced unless `skipOriginCheck` is set):
   *   1. The session's branch is not ahead of its upstream on origin.
   *   2. The result note contains one of: a PR URL, "no-pr-yet: <reason>",
   *      or "not-applicable: <reason>".
   *
   * See lib/git-origin-check.ts for the motivation and details.
   */
  function done(options: DoneOptions) {
    const { agentId, note, status = 'completed' } = options;
    let { sessionId } = options;
    const skipOriginCheck = options.skipOriginCheck === true;
    const skipOriginCheckReason = typeof options.skipOriginCheckReason === 'string'
      ? options.skipOriginCheckReason.trim()
      : '';

    // Find session by agent if not provided
    if (!sessionId && agentId) {
      const listResult = sessions.list({ agentId, status: 'active', allWorktrees: true });
      const sessionsList = (listResult.sessions || []) as Array<{ id: string }>;
      if (sessionsList.length > 0) {
        sessionId = sessionsList[0].id;
      }
    }

    // Fallback: find most recent active session (only if no explicit agentId was given)
    if (!sessionId && !agentId) {
      const listResult = sessions.list({ status: 'active', allWorktrees: true, limit: 1 });
      const sessionsList = (listResult.sessions || []) as Array<{ id: string }>;
      if (sessionsList.length > 0) {
        sessionId = sessionsList[0].id;
      }
    }

    if (!sessionId) {
      return {
        success: false,
        error: 'No active session found',
        code: 'NO_ACTIVE_SESSION',
      };
    }

    // Verify ownership: if agentId is provided and sessionId was also provided,
    // confirm the session belongs to this agent. Prevents agent A from closing
    // agent B's session by passing B's sessionId.
    if (agentId && options.sessionId) {
      const sessionInfo = sessions.get(sessionId);
      if (sessionInfo.success && sessionInfo.session) {
        const session = sessionInfo.session as Record<string, unknown>;
        if (session.agentId && session.agentId !== agentId) {
          return {
            success: false,
            error: `Session ${sessionId} belongs to agent ${session.agentId}, not ${agentId}`,
            code: 'SESSION_OWNERSHIP_MISMATCH',
          };
        }
      }
    }

    // =========================================================================
    // Hard preconditions — only applied for "completed" status. Abandoned
    // sessions are explicitly a "this work is not landing" handoff; we let
    // those through without the push/PR-URL gate.
    // =========================================================================
    let effectiveNote = typeof note === 'string' ? note : undefined;
    const isSubtaskOrNoPr = options.noPr === true || options.subtask === true;

    if (status === 'completed') {
      // Resolve the session worktree once for every completion path. In
      // particular, `--skip-origin-check` may bypass the push/upstream gate but
      // it must never bypass the stricter repository claim made by `--no-pr`.
      const sessionInfo = sessions.get(sessionId);
      const sessionRow = sessionInfo.success && sessionInfo.session
        ? sessionInfo.session as Record<string, unknown>
        : null;
      const meta = sessionRow && typeof sessionRow.metadata === 'object' && sessionRow.metadata !== null
        ? sessionRow.metadata as Record<string, unknown>
        : null;
      const worktreeMeta = meta && typeof meta.worktree === 'object' && meta.worktree !== null
        ? meta.worktree as Record<string, unknown>
        : null;
      const worktreeRoot = worktreeMeta && typeof worktreeMeta.root === 'string' && worktreeMeta.root.trim()
        ? worktreeMeta.root
        : undefined;

      if (options.noPr === true) {
        const sentinel = checkResultNoteSentinel(effectiveNote);
        if (!sentinel.ok) {
          const standardSentinel = 'not-applicable: ledger-only session, no repository artifact';
          effectiveNote = effectiveNote && effectiveNote.trim()
            ? `${effectiveNote.trim()}\n\n${standardSentinel}`
            : standardSentinel;
        }

        const ledgerOnly = gitOriginChecker.checkLedgerOnly
          ? gitOriginChecker.checkLedgerOnly(worktreeRoot)
          : null;
        if (!ledgerOnly?.ok) {
          return {
            success: false,
            code: 'LEDGER_ONLY_CHECK_FAILED',
            error: `pd done refused — ${ledgerOnly?.error ?? 'ledger-only repository verification is unavailable'}`,
            hint: ledgerOnly?.hint ?? 'Run this close through a Port Daddy build that can verify worktree cleanliness and unpublished commits.',
            branch: null,
            upstream: null,
            ahead: null,
            originCheckCode: null,
            ledgerOnlyCheckCode: ledgerOnly?.code ?? 'CHECK_UNAVAILABLE',
            dirtyEntries: ledgerOnly?.dirtyEntries ?? null,
            unpublishedCommits: ledgerOnly?.unpublishedCommits ?? null,
          };
        }
      }

      if (!skipOriginCheck) {
        // 1) Note-sentinel check (cheap, do it first so operators get the most
        //    actionable error when they forget BOTH things).
        const sentinel = checkResultNoteSentinel(effectiveNote);
        if (!sentinel.ok) {
          if (isSubtaskOrNoPr) {
            const standardSentinel = options.noPr === true
              ? 'not-applicable: ledger-only session, no repository artifact'
              : 'not-applicable: subtask code delivery';
            effectiveNote = effectiveNote && effectiveNote.trim()
              ? `${effectiveNote.trim()}\n\n${standardSentinel}`
              : standardSentinel;
          } else {
            return {
              success: false,
              code: 'RESULT_NOTE_MISSING_SENTINEL',
              error: 'pd done refused — ' + noteSentinelErrorMessage(),
              hint: noteSentinelErrorMessage(),
            };
          }
        }

        // 2) Origin-push check. `--no-pr` has already passed its stricter
        // ledger-only verification above; ordinary completions still require a
        // published branch unless the operator supplied the loud override.
        if (options.noPr !== true) {
          const originCheck = gitOriginChecker.checkBranchOnOrigin(worktreeRoot);
          if (!originCheck.ok) {
            return {
              success: false,
              code: 'BRANCH_NOT_ON_ORIGIN',
              error: `pd done refused — ${originCheck.error}`,
              hint: originCheck.hint,
              branch: originCheck.branch ?? null,
              upstream: originCheck.upstream ?? null,
              ahead: originCheck.ahead ?? null,
              originCheckCode: originCheck.code,
              ledgerOnlyCheckCode: null,
              dirtyEntries: null,
              unpublishedCommits: null,
            };
          }
        }
      } else {
        // Skip-origin-check requested. Require a reason and stamp the note.
        if (!skipOriginCheckReason) {
          return {
            success: false,
            code: 'SKIP_ORIGIN_CHECK_REASON_REQUIRED',
            error: 'pd done --skip-origin-check requires --reason "<reason>".',
            hint: 'Provide a one-line reason describing why the origin-push gate is being bypassed (e.g., "local experiment, not shipping").',
          };
        }
        // Prepend a loud override marker so audits can grep for them.
        const overrideStamp = `[OPERATOR-OVERRIDE skip-origin-check] reason: ${skipOriginCheckReason}`;
        effectiveNote = effectiveNote && effectiveNote.length > 0
          ? `${overrideStamp}\n${effectiveNote}`
          : overrideStamp;
      }
    }

    // 3) Plan checklist validation
    if (status === 'completed') {
      const planNotesResult = sessions.getNotes(sessionId, { type: 'todo_list', limit: 1 });
      const planNotes = (planNotesResult.success && Array.isArray(planNotesResult.notes) ? planNotesResult.notes : []) as Array<{ content: string }>;
      if (planNotes.length > 0) {
        const latestPlan = planNotes[0].content;
        const uncheckedRegex = /\[\s\]/;
        if (uncheckedRegex.test(latestPlan)) {
          const forceIncomplete = options.forceIncomplete === true;
          const forceIncompleteReason = typeof options.forceIncompleteReason === 'string'
            ? options.forceIncompleteReason.trim()
            : '';

          if (!forceIncomplete) {
            return {
              success: false,
              code: 'PLAN_UNCHECKED_ITEMS',
              error: 'pd done refused — your session plan still has unchecked todo items.',
              hint: 'Complete the items, update your plan with "pd plan check <id>", or close with "pd done --force-incomplete --reason \\"<why>\\"".',
            };
          }

          if (!forceIncompleteReason || forceIncompleteReason.length < 12) {
            return {
              success: false,
              code: 'FORCE_INCOMPLETE_REASON_REQUIRED',
              error: 'pd done --force-incomplete requires --reason "<reason>" (min 12 chars).',
              hint: 'Provide a clear description of why the plan is incomplete (e.g., "features deferred to next ticket").',
            };
          }

          // Prepend incomplete marker to final note
          const overrideStamp = `[OPERATOR-OVERRIDE force-incomplete] reason: ${forceIncompleteReason}`;
          effectiveNote = effectiveNote && effectiveNote.length > 0
            ? `${overrideStamp}\n${effectiveNote}`
            : overrideStamp;
        }
      }
    }

    // Count notes before ending (end adds the handoff note)
    const notesBefore = sessions.getNotes(sessionId);
    const beforeCount = (notesBefore.notes as unknown[] || []).length;

    // End the session
    const endOpts: Record<string, unknown> = { status };
    if (effectiveNote) endOpts.note = effectiveNote;
    const sessionResult = sessions.end(sessionId, endOpts);

    if (!sessionResult.success) {
      return {
        success: false,
        error: `Session end failed: ${sessionResult.error}`,
        code: 'SESSION_END_FAILED',
      };
    }

    // Unregister the agent
    let agentUnregistered = false;
    const effectiveAgentId = agentId || findAgentForSession(sessionId);
    if (effectiveAgentId) {
      const unregResult = agents.unregister(effectiveAgentId);
      agentUnregistered = !!unregResult.unregistered;
    }

    // Close associated commitments
    if (deps.commitments && effectiveAgentId) {
      try {
        const openCommitments = deps.commitments.list({ ownerActorId: effectiveAgentId, state: 'open' }) as any;
        const rows = Array.isArray(openCommitments) ? openCommitments : (openCommitments?.commitments || []);
        for (const c of rows) {
          if (c.successCheck === `session:${sessionId}:completed`) {
            deps.commitments.close(c.id, `session:${sessionId}:completed`);
          }
        }
      } catch (err) {
        // Fail silently
      }
    }

    const totalNotes = beforeCount + (effectiveNote ? 1 : 0);

    const sessionInfo = sessions.get(sessionId);
    const session = sessionInfo.success && sessionInfo.session ? sessionInfo.session as Record<string, unknown> : null;
    const identityProject = typeof session?.identityProject === 'string' ? session.identityProject : null;

    activityLog.log('sugar_done', {
      agentId: effectiveAgentId || null,
      targetId: sessionTarget(identityProject, sessionId),
      details: `Agent ${effectiveAgentId || 'unknown'} done: ${status}`,
      metadata: {
        agentId: effectiveAgentId || null,
        sessionId,
        status,
        identityProject: identityProject || undefined,
      } as unknown as Record<string, unknown>,
    });

    return {
      success: true,
      agentId: effectiveAgentId || null,
      sessionId,
      sessionStatus: status,
      agentUnregistered,
      notesCount: totalNotes,
      finalNote: !!effectiveNote,
      releasedFiles: (sessionResult as any).releasedFiles,
    };
  }

  /**
   * Whoami — show current agent/session context.
   */
  function whoami(options: WhoamiOptions) {
    const { agentId } = options;
    const explicitSessionId = typeof options.sessionId === 'string' && options.sessionId.trim()
      ? options.sessionId.trim()
      : undefined;

    if (explicitSessionId) {
      const sessionInfo = sessions.get(explicitSessionId);
      if (sessionInfo.success && sessionInfo.session) {
        const session = sessionInfo.session as Record<string, unknown>;
        const sessionAgentId = typeof session.agentId === 'string' ? session.agentId : null;

        if (agentId && sessionAgentId && sessionAgentId !== agentId) {
          return {
            success: true,
            active: false,
            agentId,
            sessionId: explicitSessionId,
            hint: `Session "${explicitSessionId}" belongs to agent "${sessionAgentId}", not "${agentId}".`,
          };
        }

        // Durable sessions remain "active" even if the daemon marked them abandoned
        // because the agent process heartbeat stopped. They're work contexts, not
        // process lifetimes — only pd done / worktree-removed / branch-merged ends them.
        const isDurable = session.durable === true ||
          session.is_durable === 1 || session.is_durable === true;
        const isEffectivelyActive = session.status === 'active' ||
          (isDurable && session.status === 'abandoned');

        if (isEffectivelyActive) {
          // For abandoned-but-durable sessions, resurrect to active in the DB
          // so future checks don't require special-casing.
          if (isDurable && session.status === 'abandoned') {
            sessions.resurrect?.(explicitSessionId);
          }

          const lookupAgentId = sessionAgentId || agentId;
          const agentResult = lookupAgentId ? agents.get(lookupAgentId) : { success: false };
          const agent = agentResult.success ? agentResult.agent as Record<string, unknown> : null;

          return buildWhoamiResponse(
            session,
            (sessionInfo.notes as unknown[] | undefined) || [],
            (sessionInfo.files as Array<Record<string, unknown>> | undefined) || [],
            agent,
            lookupAgentId || undefined,
          );
        }

        return {
          success: true,
          active: false,
          agentId: sessionAgentId || agentId,
          sessionId: explicitSessionId,
          hint: `Session "${explicitSessionId}" is ${session.status || 'inactive'}. Use pd begin to start a session.`,
        };
      }
    }

    if (!agentId) {
      return {
        success: true,
        active: false,
        hint: 'No agent ID provided. Use pd begin to start a session.',
      };
    }

    // Look up agent
    const agentResult = agents.get(agentId);
    if (!agentResult.success) {
      return {
        success: true,
        active: false,
        hint: `Agent "${agentId}" not found. Use pd begin to start a session.`,
      };
    }

    const agent = agentResult.agent as Record<string, unknown>;

    // Find active session for this agent
    const listResult = sessions.list({ agentId, status: 'active', allWorktrees: true });
    const sessionsList = (listResult.sessions || []) as Array<Record<string, unknown>>;

    if (sessionsList.length === 0) {
      // Abandoned-but-durable sessions are still live work contexts: an
      // abandonment write (e.g. zombie protocol) suspends them, it doesn't
      // end them. Find the most recent one, resurrect it, and report active.
      const abandonedResult = sessions.list({ agentId, status: 'abandoned', allWorktrees: true });
      const abandonedList = (abandonedResult.sessions || []) as Array<Record<string, unknown>>;
      const durableSession = abandonedList.find(s => s.durable === true);
      if (durableSession) {
        sessions.resurrect?.(durableSession.id as string);
        const durableDetail = sessions.get(durableSession.id as string);
        if (durableDetail.success && durableDetail.session) {
          return buildWhoamiResponse(
            durableDetail.session as Record<string, unknown>,
            (durableDetail.notes as unknown[] | undefined) || [],
            (durableDetail.files as Array<Record<string, unknown>> | undefined) || [],
            agent,
            agentId,
          );
        }
      }

      return {
        success: true,
        active: false,
        agentId,
        hint: `Agent "${agentId}" registered but no active session.`,
      };
    }

    const session = sessionsList[0];
    const sessionDetail = sessions.get(session.id as string);
    if (sessionDetail.success && sessionDetail.session) {
      return buildWhoamiResponse(
        sessionDetail.session as Record<string, unknown>,
        (sessionDetail.notes as unknown[] | undefined) || [],
        (sessionDetail.files as Array<Record<string, unknown>> | undefined) || [],
        agent,
        agentId,
      );
    }

    return {
      success: true,
      active: false,
      agentId,
      hint: `Agent "${agentId}" has an active session, but details could not be loaded.`,
    };
  }

  /**
   * Find which agent owns a session (internal helper)
   */
  function findAgentForSession(sessionId: string): string | null {
    const sessionDetail = sessions.get(sessionId);
    if (!sessionDetail.success) return null;
    const session = sessionDetail.session as Record<string, unknown>;
    return (session.agentId as string) || null;
  }

  /**
   * Relink — update the ACTIVE session's rent-at-claim fields.
   *
   * Same validation as begin: an existing roadmap slug (with prefix
   * did-you-mean) OR a sidequest reason (min 12 chars), mutually exclusive.
   * Switching mode clears the other field — a session is either
   * roadmap-linked or a sidequest, never ambiguously both. Every relink
   * appends an audit note recording old -> new.
   */
  function relink(options: RelinkOptions) {
    const { agentId } = options;
    let { sessionId } = options;

    // ------------------------------------------------------------------
    // Validate the rent fields FIRST (same semantics as begin).
    // ------------------------------------------------------------------
    const given = [options.roadmapLink, options.sidequestReason]
      .filter((v) => v !== undefined && v !== null);
    if (given.length > 1) {
      return {
        success: false,
        error: 'roadmapLink and sidequestReason are mutually exclusive — pass exactly one.',
        code: 'ROADMAP_RENT_CONFLICT',
      };
    }
    if (given.length === 0) {
      return {
        success: false,
        error: 'relink needs a roadmap link or a sidequest reason — pass exactly one.',
        code: 'ROADMAP_RENT_REQUIRED',
      };
    }

    let newRoadmapLink: string | undefined;
    let newSidequestReason: string | undefined;

    if (options.sidequestReason !== undefined) {
      const reason = typeof options.sidequestReason === 'string' ? options.sidequestReason.trim() : '';
      if (reason.length < SIDEQUEST_REASON_MIN_CHARS) {
        return {
          success: false,
          error: `sidequest reason must be at least ${SIDEQUEST_REASON_MIN_CHARS} characters — say what the work actually is.`,
          code: 'SIDEQUEST_REASON_TOO_SHORT',
        };
      }
      newSidequestReason = reason;
    }

    if (options.roadmapLink !== undefined) {
      if (!deps.roadmapItems) {
        return {
          success: false,
          error: 'roadmap linking requires the roadmap service, which is not available on this daemon.',
          code: 'ROADMAP_ITEMS_UNAVAILABLE',
        };
      }
      const requested = typeof options.roadmapLink === 'string' ? options.roadmapLink.trim() : '';
      if (!requested || !deps.roadmapItems.slugExists(requested)) {
        const slugs = deps.roadmapItems.list({ status: 'all', limit: 5000 }).map((item) => item.slug);
        const didYouMean = nearestSlugsByPrefix(requested, slugs);
        return {
          success: false,
          error: `Unknown roadmap slug "${requested}".`
            + (didYouMean.length > 0 ? ` Did you mean: ${didYouMean.join(', ')}?` : ''),
          code: 'ROADMAP_SLUG_UNKNOWN',
          didYouMean,
        };
      }
      newRoadmapLink = requested;
    }

    // ------------------------------------------------------------------
    // Resolve the active session (same resolution order as done()).
    // ------------------------------------------------------------------
    if (!sessionId && agentId) {
      const listResult = sessions.list({ agentId, status: 'active', allWorktrees: true });
      const sessionsList = (listResult.sessions || []) as Array<{ id: string }>;
      if (sessionsList.length > 0) sessionId = sessionsList[0].id;
    }
    if (!sessionId && !agentId) {
      const listResult = sessions.list({ status: 'active', allWorktrees: true, limit: 1 });
      const sessionsList = (listResult.sessions || []) as Array<{ id: string }>;
      if (sessionsList.length > 0) sessionId = sessionsList[0].id;
    }
    if (!sessionId) {
      return {
        success: false,
        error: 'No active session found — relink needs an active session (pd begin first).',
        code: 'NO_ACTIVE_SESSION',
      };
    }

    const sessionInfo = sessions.get(sessionId);
    if (!sessionInfo.success || !sessionInfo.session) {
      return {
        success: false,
        error: `Session ${sessionId} not found`,
        code: 'NO_ACTIVE_SESSION',
      };
    }
    const session = sessionInfo.session as Record<string, unknown>;

    // Ownership: an explicit sessionId must belong to the calling agent.
    if (agentId && options.sessionId && session.agentId && session.agentId !== agentId) {
      return {
        success: false,
        error: `Session ${sessionId} belongs to agent ${session.agentId}, not ${agentId}`,
        code: 'SESSION_OWNERSHIP_MISMATCH',
      };
    }

    const meta = session.metadata && typeof session.metadata === 'object'
      ? session.metadata as Record<string, unknown>
      : null;
    const previousRoadmapLink = typeof meta?.roadmapLink === 'string' ? meta.roadmapLink : null;
    const previousSidequestReason = typeof meta?.sidequestReason === 'string' ? meta.sidequestReason : null;

    // ------------------------------------------------------------------
    // Apply: switching rent MODE clears the other field.
    // ------------------------------------------------------------------
    const patch: Record<string, unknown> = {};
    if (newRoadmapLink) {
      patch.roadmapLink = newRoadmapLink;
      patch.sidequestReason = undefined;
    }
    if (newSidequestReason) {
      patch.sidequestReason = newSidequestReason;
      patch.roadmapLink = undefined;
    }
    sessions.updateMetadata?.(sessionId, patch);

    // Audit trail: old -> new, as an immutable session note + activity event.
    const describeRent = (link: string | null | undefined, reason: string | null | undefined) =>
      link ? `roadmap:${link}` : reason ? `sidequest:${reason}` : 'none';
    const oldDesc = describeRent(previousRoadmapLink, previousSidequestReason);
    const newDesc = describeRent(newRoadmapLink, newSidequestReason);
    sessions.addNote?.(sessionId, `rent-relink: ${oldDesc} -> ${newDesc}`, { type: 'relink' });

    const identityProject = typeof session.identityProject === 'string' ? session.identityProject : null;
    const effectiveAgentId = agentId || (typeof session.agentId === 'string' ? session.agentId : null);
    activityLog.log('sugar_relink', {
      agentId: effectiveAgentId,
      targetId: sessionTarget(identityProject, sessionId),
      details: `Agent ${effectiveAgentId || 'unknown'} relinked rent: ${oldDesc} -> ${newDesc}`,
      metadata: {
        sessionId,
        agentId: effectiveAgentId || undefined,
        identityProject: identityProject || undefined,
        previousRoadmapLink: previousRoadmapLink || undefined,
        previousSidequestReason: previousSidequestReason || undefined,
        roadmapLink: newRoadmapLink || undefined,
        sidequestReason: newSidequestReason || undefined,
      } as unknown as Record<string, unknown>,
    });

    const response: Record<string, unknown> = {
      success: true,
      sessionId,
      agentId: effectiveAgentId,
      previousRoadmapLink,
      previousSidequestReason,
    };
    if (newRoadmapLink) response.roadmapLink = newRoadmapLink;
    if (newSidequestReason) response.sidequestReason = newSidequestReason;
    return response;
  }

  function getWelcomeBriefing(harbor?: string) {
    const nextHarbor = harbor || 'fleet';
    
    // 1. Next most important thing on the roadmap
    let nextRoadmap: Record<string, any> | null = null;
    if (deps.roadmapItems) {
      const nowItems = deps.roadmapItems.list({ harbor: nextHarbor, status: 'now', limit: 1 });
      if (nowItems.length > 0) {
        nextRoadmap = nowItems[0];
      } else {
        const backlogItems = deps.roadmapItems.list({ harbor: nextHarbor, status: 'backlog', limit: 1 });
        if (backlogItems.length > 0) {
          nextRoadmap = backlogItems[0];
        }
      }
    }

    // 2. Ongoing projects (active sessions)
    const active = sessions.list({ status: 'active', limit: 10 });
    const ongoing: Array<Record<string, any>> = [];
    const activeRows: Array<Record<string, any>> =
      active && typeof active === 'object' && Array.isArray((active as any).sessions)
        ? ((active as any).sessions)
        : [];
    for (const s of activeRows) {
      if (!s) continue;
      const agentResult = agents.get(s.agentId) as any;
      const agentName = agentResult?.agent?.name || s.agentName || s.name || 'Anonymous Agent';
      const identity = agentResult?.agent?.identity || s.identity || null;
      ongoing.push({
        sessionId: s.id,
        agentId: s.agentId,
        agentName,
        identity,
        purpose: s.purpose,
        worktree: s.worktree,
      });
    }

    // 3. High-pri bugs needing attention (open feedback)
    const highPriBugs: Array<Record<string, any>> = [];
    if (deps.feedback) {
      const openFeedback = deps.feedback.list({ harbor: nextHarbor, status: 'open', limit: 50 });
      for (const f of openFeedback) {
        if (f.severity === 'high' || f.severity === 'critical') {
          highPriBugs.push(f);
        }
      }
    }

    // 4. Dormant or engineering excellence opportunities
    const dormant: Array<Record<string, any>> = [];
    for (const s of activeRows) {
      if (!s) continue;
      const agentResult = agents.get(s.agentId) as any;
      const beat = agentResult?.agent?.timeSinceHeartbeat;
      if (typeof beat === 'number' && beat > 30 * 60 * 1000) { // dormant for > 30 minutes
        dormant.push({
          sessionId: s.id,
          purpose: s.purpose,
          agentId: s.agentId,
          lastActiveAgoMinutes: Math.floor(beat / (60 * 1000)),
        });
      }
    }

    return {
      success: true,
      nextRoadmap,
      ongoing,
      highPriBugs,
      dormant,
    };
  }

  return { begin, done, whoami, relink, getWelcomeBriefing };
}
