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
}

interface ActivityLogModule {
  log(type: string, opts: {
    agentId?: string | null;
    targetId?: string | null;
    details: string;
    metadata: Record<string, unknown>;
  }): void;
}

interface SugarDeps {
  agents: AgentsModule;
  sessions: SessionsModule;
  activityLog: ActivityLogModule;
  /**
   * Optional git-origin checker. Defaults to a real-git implementation.
   * Tests inject a stub to simulate ahead / no-upstream / clean states
   * without touching a real repo.
   */
  gitOriginChecker?: GitOriginChecker;
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
  /** Create a durable session that survives without a live heartbeat process. */
  durable?: boolean;
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
}

interface WhoamiOptions {
  agentId?: string;
  sessionId?: string;
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
    };
  }

  /**
   * Begin — register agent + start session atomically.
   * Rolls back agent registration if session start fails.
   */
  function begin(options: BeginOptions) {
    const { purpose, identity, type, files, force, durable } = options;

    if (!purpose || typeof purpose !== 'string' || !purpose.trim()) {
      return { success: false, error: 'purpose is required' };
    }

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

    // Idempotent resume. A re-begin for the SAME identity in the SAME worktree
    // must RESUME the existing active session, not fork a parallel one. Forking
    // was the dual-session bug: the first session held the file claims, the
    // second could not re-claim, and the Coordination Guard then rejected the
    // commit. This mirrors the repo's claim/release idempotency discipline.
    // Opt out with an explicit `agentId` or `force: true`.
    const resumeParsed = identity ? parseIdentity(identity) : null;
    const resumeProject = resumeParsed && resumeParsed.valid ? resumeParsed.project : null;
    if (!options.agentId && !force && resumeProject) {
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
        const agentResult = agents.get(s.agentId) as { agent?: { identity?: unknown; timeSinceHeartbeat?: unknown } };
        if (agentResult && agentResult.agent && agentResult.agent.identity === identity) {
          match = s;
          matchAgent = agentResult.agent;
          break;
        }
      }
      if (match && typeof match.id === 'string' && typeof match.agentId === 'string') {
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

    const metadata = mergeSessionWorktreeMetadata(options.metadata, worktreePolicy.worktree, {
      requireLinkedWorktree: options.requireLinkedWorktree,
      allowMainWorktree: options.allowMainWorktree,
    });

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
    if (metadata && typeof metadata === 'object') {
      sessionOpts.metadata = metadata;
    }
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
      lifecycle: durable === true ? 'durable' : 'ephemeral',
      agentRegistered: true,
      sessionStarted: true,
    };
    if (worktreePolicy.worktree) response.worktree = worktreePolicy.worktree;

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
        lifecycle: durable === true ? 'durable' : 'ephemeral',
      } as unknown as Record<string, unknown>,
    });

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

    if (status === 'completed') {
      if (!skipOriginCheck) {
        // 1) Note-sentinel check (cheap, do it first so operators get the most
        //    actionable error when they forget BOTH things).
        const sentinel = checkResultNoteSentinel(effectiveNote);
        if (!sentinel.ok) {
          return {
            success: false,
            code: 'RESULT_NOTE_MISSING_SENTINEL',
            error: 'pd done refused — ' + noteSentinelErrorMessage(),
            hint: noteSentinelErrorMessage(),
          };
        }

        // 2) Origin-push check. The cwd we run git in is the session's
        //    worktree root when we know it, otherwise the daemon's cwd.
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
          };
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

  return { begin, done, whoami };
}
