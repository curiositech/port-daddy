/**
 * Sugar Module — Compound commands for common workflows
 *
 * Provides begin (register + session start), done (session end + unregister),
 * and whoami (current agent/session context). Composes agents + sessions
 * modules atomically with rollback on failure.
 */

import { randomBytes } from 'crypto';

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
  log(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
}

interface SugarDeps {
  agents: AgentsModule;
  sessions: SessionsModule;
  activityLog: ActivityLogModule;
}

interface BeginOptions {
  purpose?: string;
  agentId?: string;
  identity?: string;
  type?: string;
  files?: string[];
  force?: boolean;
  metadata?: Record<string, unknown>;
}

interface DoneOptions {
  agentId?: string;
  sessionId?: string;
  note?: string;
  status?: string;
}

interface WhoamiOptions {
  agentId?: string;
}

// =============================================================================
// Module factory
// =============================================================================

export function createSugar(deps: SugarDeps) {
  const { agents, sessions, activityLog } = deps;

  /**
   * Begin — register agent + start session atomically.
   * Rolls back agent registration if session start fails.
   */
  function begin(options: BeginOptions) {
    const { purpose, identity, type, files, force, metadata } = options;

    if (!purpose || typeof purpose !== 'string' || !purpose.trim()) {
      return { success: false, error: 'purpose is required' };
    }

    // Generate or use provided agent ID
    const agentId = options.agentId || `agent-${randomBytes(4).toString('hex')}`;

    // Step 1: Register the agent
    const registerOpts: Record<string, unknown> = {};
    if (identity) registerOpts.identity = identity;
    if (purpose) registerOpts.purpose = purpose;
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
    if (files && files.length > 0) {
      sessionOpts.files = files;
      if (force) sessionOpts.force = force;
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
      identity: identity || null,
      purpose: purpose.trim(),
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
      details: `Agent ${agentId} began: ${purpose.trim()}`,
      metadata: { agentId, sessionId: sessionResult.id as string, identity: identity || null } as unknown as Record<string, unknown>,
    });

    return response;
  }

  /**
   * Done — end session + unregister agent.
   * Finds active session by agentId if sessionId not provided.
   */
  function done(options: DoneOptions) {
    const { agentId, note, status = 'completed' } = options;
    let { sessionId } = options;

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

    // Count notes before ending (end adds the handoff note)
    const notesBefore = sessions.getNotes(sessionId);
    const beforeCount = (notesBefore.notes as unknown[] || []).length;

    // End the session
    const endOpts: Record<string, unknown> = { status };
    if (note) endOpts.note = note;
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

    const totalNotes = beforeCount + (note ? 1 : 0);

    activityLog.log('sugar_done', {
      details: `Agent ${effectiveAgentId || 'unknown'} done: ${status}`,
      metadata: { agentId: effectiveAgentId || null, sessionId, status } as unknown as Record<string, unknown>,
    });

    return {
      success: true,
      agentId: effectiveAgentId || null,
      sessionId,
      sessionStatus: status,
      agentUnregistered,
      notesCount: totalNotes,
      finalNote: !!note,
    };
  }

  /**
   * Whoami — show current agent/session context.
   */
  function whoami(options: WhoamiOptions) {
    const { agentId } = options;

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
    const sessionId = session.id as string;

    // Get notes count
    const notesResult = sessions.getNotes(sessionId);
    const noteCount = (notesResult.notes as unknown[] || []).length;

    // Get file claims
    const sessionDetail = sessions.get(sessionId);
    const files = ((sessionDetail.files || []) as Array<Record<string, unknown>>)
      .filter((f: Record<string, unknown>) => !f.releasedAt)
      .map((f: Record<string, unknown>) => f.filePath as string);

    const now = Date.now();
    const startedAt = session.createdAt as number;

    return {
      success: true,
      active: true,
      agentId,
      sessionId,
      purpose: session.purpose as string,
      identity: agent.identity as string || null,
      phase: session.phase as string || 'in_progress',
      files,
      noteCount,
      startedAt,
      duration: now - startedAt,
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
