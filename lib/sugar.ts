/**
 * Sugar Module — Compound commands for common workflows
 *
 * Provides begin (register + session start), done (session end + unregister),
 * and whoami (current agent/session context). Composes agents + sessions
 * modules atomically with rollback on failure.
 */

import { randomBytes } from 'crypto';
import { parseIdentity } from './identity.js';
import { buildHumanReadableId, cleanAgentDisplayName, deriveAgentDisplayName } from './agent-names.js';
import { normalizeAgentTelos } from './agent-telos.js';
import { formatSelfSalvageNote, normalizeSelfSalvage, type SelfSalvageCapsule } from './telos-salvage.js';

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
}

interface ActivityLogModule {
  log(type: string, opts: {
    agentId?: string | null;
    targetId?: string | null;
    details: string;
    metadata: Record<string, unknown>;
  }): void;
}

interface ResurrectionModule {
  selfSalvage(agent: {
    id: string;
    name: string;
    purpose?: string | null;
    sessionId?: string | null;
    lastHeartbeat?: number;
    notes?: string[];
    selfSalvage: SelfSalvageCapsule;
    identityProject?: string | null;
    identityStack?: string | null;
    identityContext?: string | null;
  }): Record<string, unknown>;
}

interface SugarDeps {
  agents: AgentsModule;
  sessions: SessionsModule;
  activityLog: ActivityLogModule;
  resurrection?: ResurrectionModule;
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
  telos?: unknown;
}

interface DoneOptions {
  agentId?: string;
  sessionId?: string;
  note?: string;
  status?: string;
  selfSalvage?: unknown;
}

interface WhoamiOptions {
  agentId?: string;
  sessionId?: string;
}

// =============================================================================
// Module factory
// =============================================================================

export function createSugar(deps: SugarDeps) {
  const { agents, sessions, activityLog, resurrection } = deps;

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
      telos: agent?.telos || null,
      telosHeadline: typeof agent?.telosHeadline === 'string' ? agent.telosHeadline : null,
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
    const { purpose, identity, type, files, force, metadata } = options;

    if (!purpose || typeof purpose !== 'string' || !purpose.trim()) {
      return { success: false, error: 'purpose is required' };
    }

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
    const telosResult = normalizeAgentTelos(options.telos ?? metadata?.telos, {
      fallbackHeadline: purpose,
      fallbackCurrentIntent: purpose,
      source: options.telos ? 'self' : 'derived',
    });
    if (!telosResult.success || !telosResult.telos) {
      return { success: false, error: telosResult.error || 'telos is required', code: 'TELOS_REQUIRED' };
    }

    // Step 1: Register the agent
    const registerOpts: Record<string, unknown> = {};
    if (name) registerOpts.name = name;
    if (identity) registerOpts.identity = identity;
    if (purpose) registerOpts.purpose = purpose;
    registerOpts.telos = telosResult.telos;
    if (type) registerOpts.type = type;
    if (metadata) registerOpts.metadata = metadata;

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
    sessionOpts.metadata = {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      telos: telosResult.telos,
    };

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
      telos: telosResult.telos,
      telosHeadline: telosResult.telos.headline,
      agentRegistered: true,
      sessionStarted: true,
    };

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
        telos: telosResult.telos,
      } as unknown as Record<string, unknown>,
    });

    return response;
  }

  /**
   * Done — end session + unregister agent.
   * Finds active session by agentId if sessionId not provided.
   */
  function done(options: DoneOptions) {
    const { agentId, note } = options;
    let status = options.status || 'completed';
    let { sessionId } = options;
    const selfSalvage = normalizeSelfSalvage(options.selfSalvage);

    if (!selfSalvage.success) {
      return {
        success: false,
        error: selfSalvage.error,
        code: 'SELF_SALVAGE_VALIDATION_ERROR',
      };
    }

    if (selfSalvage.shouldQueue) {
      if (options.status && options.status !== 'abandoned') {
        return {
          success: false,
          error: 'Queueable self-salvage means the telos is unfinished; use status "abandoned" or omit status.',
          code: 'SELF_SALVAGE_STATUS_MISMATCH',
        };
      }
      status = 'abandoned';
    }

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

    const effectiveAgentId = agentId || findAgentForSession(sessionId);
    const sessionBeforeResult = sessions.get(sessionId);
    const sessionBefore = sessionBeforeResult.success && sessionBeforeResult.session
      ? sessionBeforeResult.session as Record<string, unknown>
      : null;
    const agentBeforeResult = effectiveAgentId ? agents.get(effectiveAgentId) : { success: false };
    const agentBefore = agentBeforeResult.success && agentBeforeResult.agent
      ? agentBeforeResult.agent as Record<string, unknown>
      : null;

    // Count notes before ending (end adds the handoff note)
    const notesBefore = sessions.getNotes(sessionId);
    const beforeCount = (notesBefore.notes as unknown[] || []).length;

    // End the session
    const endOpts: Record<string, unknown> = { status };
    const finalNoteParts = [];
    if (note) finalNoteParts.push(note);
    if (selfSalvage.capsule) finalNoteParts.push(formatSelfSalvageNote(selfSalvage.capsule));
    if (finalNoteParts.length > 0) endOpts.note = finalNoteParts.join('\n\n');
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
    let selfSalvageQueued = false;
    if (selfSalvage.shouldQueue && selfSalvage.capsule && resurrection && effectiveAgentId) {
      const liveNotes = Array.isArray(notesBefore.notes)
        ? notesBefore.notes.map((noteRow: Record<string, unknown>) => String(noteRow.content || '')).filter(Boolean)
        : [];
      const queueResult = resurrection.selfSalvage({
        id: effectiveAgentId,
        name: typeof agentBefore?.name === 'string' ? agentBefore.name : effectiveAgentId,
        purpose: typeof sessionBefore?.purpose === 'string' ? sessionBefore.purpose : null,
        sessionId,
        lastHeartbeat: typeof agentBefore?.lastHeartbeat === 'number' ? agentBefore.lastHeartbeat : Date.now(),
        notes: [
          ...liveNotes,
          ...(endOpts.note ? [String(endOpts.note)] : []),
        ],
        selfSalvage: selfSalvage.capsule,
        identityProject: typeof sessionBefore?.identityProject === 'string' ? sessionBefore.identityProject : null,
        identityStack: typeof sessionBefore?.identityStack === 'string' ? sessionBefore.identityStack : null,
        identityContext: typeof sessionBefore?.identityContext === 'string' ? sessionBefore.identityContext : null,
      });
      selfSalvageQueued = !!queueResult.success;
    }

    if (effectiveAgentId) {
      const unregResult = agents.unregister(effectiveAgentId);
      agentUnregistered = !!unregResult.unregistered;
    }

    const totalNotes = beforeCount + (finalNoteParts.length > 0 ? 1 : 0);

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
        selfSalvage: selfSalvage.capsule || undefined,
        selfSalvageQueued,
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
      finalNote: finalNoteParts.length > 0,
      selfSalvage: selfSalvage.capsule || null,
      selfSalvageQueued,
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

        if (session.status === 'active') {
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
