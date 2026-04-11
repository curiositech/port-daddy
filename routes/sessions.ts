/**
 * Sessions & Notes Routes
 *
 * POST   /sessions                - Start a session
 * GET    /sessions                - List sessions
 * GET    /sessions/:id            - Get session details
 * PUT    /sessions/:id            - End or abandon a session
 * DELETE /sessions/:id            - Delete session + cascade notes
 * POST   /sessions/:id/notes      - Add a note to a session
 * GET    /sessions/:id/notes      - Get notes for a session
 * POST   /sessions/:id/files      - Claim files for a session
 * DELETE /sessions/:id/files      - Release files from a session
 * POST   /notes                   - Quick note (auto-creates session if needed)
 * GET    /notes                   - Recent notes across all sessions
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

interface SessionsRouteDeps {
  sessions: {
    start(purpose: string, options?: {
      agentId?: string | null;
      files?: string[];
      metadata?: Record<string, unknown> | null;
    }): Record<string, unknown>;
    end(sessionId: string, options?: {
      note?: string;
      status?: string;
    }): Record<string, unknown>;
    abandon(sessionId: string): Record<string, unknown>;
    remove(sessionId: string): Record<string, unknown>;
    addNote(sessionId: string, content: string, options?: {
      type?: string;
    }): Record<string, unknown>;
    quickNote(content: string, options?: {
      sessionId?: string | null;
      agentId?: string | null;
      type?: string;
    }): Record<string, unknown>;
    getNotes(sessionId?: string | null, options?: {
      limit?: number;
      type?: string;
      since?: number;
    }): Record<string, unknown>;
    claimFiles(sessionId: string, files: string[], options?: {
      regions?: Array<{ path: string; startLine?: number; endLine?: number; symbol?: string; symbolPath?: string }>;
      force?: boolean;
    }): Record<string, unknown>;
    releaseFiles(sessionId: string, files: string[], options?: {
      regions?: Array<{ path: string; startLine?: number; endLine?: number; symbolPath?: string }>;
    }): Record<string, unknown>;
    getFileConflicts(files: string[]): Record<string, unknown>;
    setPhase(sessionId: string, phase: string): Record<string, unknown>;
    listAllActiveClaims(options?: { path?: string; symbol?: string; symbolPath?: string; agentId?: string; purpose?: string }): Record<string, unknown>;
    getClaimOwner(filePath: string, range?: { startLine?: number; endLine?: number; symbolPath?: string }): Record<string, unknown>;
    list(options?: {
      status?: string;
      agentId?: string | null;
      project?: string | null;
      purpose?: string | null;
      worktreeId?: string | null;
      allWorktrees?: boolean;
      includeNotes?: boolean;
      limit?: number;
    }): Record<string, unknown>;
    get(sessionId: string): Record<string, unknown>;
    cleanup(options?: {
      olderThan?: number;
      status?: string;
    }): Record<string, unknown>;
  };
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  activityLog: {
    log?(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
  };
}

/**
 * Create sessions routes
 *
 * @param deps - Route dependencies
 * @returns Express router with session routes
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const sessionsPlugin: FastifyPluginAsync<{ deps: SessionsRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { sessions, metrics, logger, activityLog } = deps;

  // POST /sessions - Start a session
  fastify.post('/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { purpose, agentId, files, force, metadata } = request.body as any;

      if (!purpose || typeof purpose !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: 'purpose must be a non-empty string',
          code: 'VALIDATION_ERROR'
        };
      }

      if (files && Array.isArray(files) && files.length > 0 && !force) {
        const conflictCheck = sessions.getFileConflicts(files);
        if (conflictCheck.conflicts && Array.isArray(conflictCheck.conflicts) && conflictCheck.conflicts.length > 0) {
          reply.code(409);
          return {
            success: false,
            error: 'File conflicts detected',
            code: 'FILE_CONFLICT',
            conflicts: conflictCheck.conflicts,
            hint: 'Use force=true to claim files anyway'
          };
        }
      }

      const result = sessions.start(purpose, { agentId, files, metadata });

      if (!result.success) {
        reply.code(400);
        return { ...result, code: 'VALIDATION_ERROR' };
      }

      logger.info('session_started', {
        sessionId: result.id,
        purpose,
        agentId,
        filesCount: files ? files.length : 0
      });

      if (activityLog?.log) {
        activityLog.log('session_start', {
          details: `Started session: ${purpose}`,
          metadata: { sessionId: result.id as string, purpose, agentId }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_start_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sessions - List sessions
  fastify.get('/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as any;
      const statusParam = q.status;
      const agentParam = q.agent;
      const projectParam = q.project;
      const purposeParam = q.purpose;
      const worktreeParam = q.worktree;
      const status = typeof statusParam === 'string' ? statusParam : undefined;
      const agentId = typeof agentParam === 'string' ? agentParam : undefined;
      const project = typeof projectParam === 'string' ? projectParam : undefined;
      const purpose = typeof purposeParam === 'string' ? purposeParam : undefined;
      const worktreeId = typeof worktreeParam === 'string' ? worktreeParam : undefined;
      const allWorktrees = q.all === 'true' || q.allWorktrees === 'true';
      const includeNotes = q.notes === 'true';
      const limitParam = q.limit;
      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 50;

      const result = sessions.list({ status, agentId, project, purpose, worktreeId, allWorktrees, includeNotes, limit });

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_list_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sessions/:id - Get session details + notes + files
  fastify.get('/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];

      const result = sessions.get(sessionId);

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_get_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // PUT /sessions/:id - End or abandon a session
  fastify.put('/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { status, note } = request.body as any;

      let result: Record<string, unknown>;

      if (status === 'abandoned') {
        result = sessions.abandon(sessionId);
      } else {
        result = sessions.end(sessionId, { note, status });
      }

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      logger.info('session_ended', {
        sessionId,
        status: result.status,
        releasedFiles: Array.isArray(result.releasedFiles) ? result.releasedFiles.length : 0
      });

      if (activityLog?.log) {
        activityLog.log('session_end', {
          details: `Ended session: ${sessionId} (${result.status})`,
          metadata: { sessionId, status: result.status as string }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_end_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // PUT /sessions/:id/phase - Set session phase
  fastify.put('/sessions/:id/phase', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { phase } = request.body as any;

      if (!phase || typeof phase !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: 'phase must be a non-empty string',
          code: 'VALIDATION_ERROR'
        };
      }

      const result = sessions.setPhase(sessionId, phase);

      if (!result.success) {
        const statusCode = result.error === 'session not found' ? 404 : 400;
        reply.code(statusCode);
        return { ...result, code: result.code || 'SESSION_NOT_FOUND' };
      }

      logger.info('session_phase_set', {
        sessionId,
        phase: result.phase,
        previousPhase: result.previousPhase
      });

      if (activityLog?.log) {
        activityLog.log('session_phase', {
          details: `Session ${sessionId} phase: ${result.previousPhase} → ${result.phase}`,
          metadata: { sessionId, phase: result.phase as string, previousPhase: result.previousPhase as string }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_phase_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /sessions/:id - Delete session + cascade notes
  fastify.delete('/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];

      const result = sessions.remove(sessionId);

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      logger.info('session_deleted', { sessionId });

      return {
        success: true,
        message: `Session "${sessionId}" removed`
      };

    } catch (error) {
      metrics.errors++;
      logger.error('session_delete_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sessions/:id/notes - Add a note to a session
  fastify.post('/sessions/:id/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { content, type } = request.body as any;

      if (!content || typeof content !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: 'content must be a non-empty string',
          code: 'VALIDATION_ERROR'
        };
      }

      const result = sessions.addNote(sessionId, content, { type });

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      logger.info('session_note_added', {
        sessionId,
        noteId: result.noteId,
        type: type || 'note'
      });

      if (activityLog?.log) {
        activityLog.log('session_note', {
          details: `Note added to session ${sessionId}`,
          metadata: { sessionId, noteId: result.noteId as number, type: type || 'note' }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_note_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sessions/:id/notes - Get notes for a session
  fastify.get('/sessions/:id/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const q = request.query as any;
      const typeParam = q.type;
      const limitParam = q.limit;
      const sinceParam = q.since;

      const type = typeof typeParam === 'string' ? typeParam : undefined;
      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 100;
      const since = typeof sinceParam === 'string' ? parseInt(sinceParam, 10) : undefined;

      const result = sessions.getNotes(sessionId, { type, limit, since });

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_notes_get_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sessions/:id/files - Claim files for a session
  fastify.post('/sessions/:id/files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { files, regions, force } = request.body as any;

      const hasFiles = files && Array.isArray(files) && files.length > 0;
      const hasRegions = regions && Array.isArray(regions) && regions.length > 0;

      if (!hasFiles && !hasRegions) {
        reply.code(400);
        return {
          success: false,
          error: 'files or regions must be provided',
          code: 'VALIDATION_ERROR'
        };
      }

      if (hasRegions) {
        for (const region of regions) {
          if (!region.path || typeof region.path !== 'string') {
            reply.code(400);
            return {
              success: false,
              error: 'each region must have a non-empty path',
              code: 'VALIDATION_ERROR'
            };
          }
          if (region.startLine !== undefined && (typeof region.startLine !== 'number' || region.startLine < 1)) {
            reply.code(400);
            return {
              success: false,
              error: 'startLine must be a positive integer (1-indexed)',
              code: 'VALIDATION_ERROR'
            };
          }
          if (region.endLine !== undefined && region.startLine !== undefined && region.endLine < region.startLine) {
            reply.code(400);
            return {
              success: false,
              error: 'endLine must be >= startLine',
              code: 'VALIDATION_ERROR'
            };
          }
          if (region.symbolPath !== undefined && (typeof region.symbolPath !== 'string' || !region.symbolPath.trim())) {
            reply.code(400);
            return {
              success: false,
              error: 'symbolPath must be a non-empty string when provided',
              code: 'VALIDATION_ERROR'
            };
          }
        }
      }

      if (hasFiles && !force) {
        const conflictCheck = sessions.getFileConflicts(files);
        if (conflictCheck.conflicts && Array.isArray(conflictCheck.conflicts) && conflictCheck.conflicts.length > 0) {
          reply.code(409);
          return {
            success: false,
            error: 'File conflicts detected',
            code: 'FILE_CONFLICT',
            conflicts: conflictCheck.conflicts,
            hint: 'Use force=true to claim files anyway'
          };
        }
      }

      const result = sessions.claimFiles(sessionId, files || [], { regions, force });

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      logger.info('session_files_claimed', {
        sessionId,
        filesCount: Array.isArray(result.claimed) ? result.claimed.length : 0,
        regionsCount: hasRegions ? regions.length : 0,
        conflictsCount: Array.isArray(result.conflicts) ? result.conflicts.length : 0
      });

      if (activityLog?.log) {
        activityLog.log('file_claim', {
          details: `Claimed ${Array.isArray(result.claimed) ? result.claimed.length : 0} files for session ${sessionId}`,
          metadata: { sessionId, filesCount: Array.isArray(result.claimed) ? result.claimed.length : 0 }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_files_claim_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /sessions/:id/files - Release files from a session
  fastify.delete('/sessions/:id/files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];

      let files: string[] = [];
      let regions: Array<{ path: string; startLine?: number; endLine?: number; symbolPath?: string }> | undefined;

      const pathsParam = (request.query as any).paths;
      if (pathsParam && typeof pathsParam === 'string') {
        files = pathsParam.split(',');
      } else if ((request.body as any)?.files && Array.isArray((request.body as any).files)) {
        files = (request.body as any).files;
      }

      if ((request.body as any)?.regions && Array.isArray((request.body as any).regions)) {
        regions = (request.body as any).regions;
      }

      if (files.length === 0 && (!regions || regions.length === 0)) {
        reply.code(400);
        return {
          success: false,
          error: 'files or regions must be provided via query param ?paths=file1,file2 or body { files: [], regions: [] }',
          code: 'VALIDATION_ERROR'
        };
      }

      const result = sessions.releaseFiles(sessionId, files, { regions });

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      logger.info('session_files_released', {
        sessionId,
        filesCount: Array.isArray(result.released) ? result.released.length : 0
      });

      if (activityLog?.log) {
        activityLog.log('file_release', {
          details: `Released ${Array.isArray(result.released) ? result.released.length : 0} files from session ${sessionId}`,
          metadata: { sessionId, filesCount: Array.isArray(result.released) ? result.released.length : 0 }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_files_release_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /notes - Quick note (auto-creates session if needed)
  fastify.post('/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { content, sessionId, agentId, type } = request.body as any;

      if (!content || typeof content !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: 'content must be a non-empty string',
          code: 'VALIDATION_ERROR'
        };
      }

      const result = sessions.quickNote(content, { sessionId, agentId, type });

      if (!result.success) {
        const code = result.code === 'SESSION_NOT_FOUND' ? 404
          : result.code === 'SESSION_NOT_ACTIVE' || result.code === 'AMBIGUOUS_ACTIVE_SESSION' ? 409
          : 400;
        reply.code(code);
        return result;
      }

      logger.info('quick_note_added', {
        noteId: result.noteId,
        sessionId: result.sessionId,
        type: type || 'note'
      });

      if (activityLog?.log) {
        activityLog.log('session_note', {
          details: 'Quick note added',
          metadata: { noteId: result.noteId as number, sessionId: result.sessionId as string, type: type || 'note' }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('quick_note_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /files - List all active file claims across all sessions
  fastify.get('/files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { path, symbol, symbolPath, agent, purpose } = request.query as any;
      const result = sessions.listAllActiveClaims({
        path: typeof path === 'string' ? path : undefined,
        symbol: typeof symbol === 'string' ? symbol : undefined,
        symbolPath: typeof symbolPath === 'string' ? symbolPath : undefined,
        agentId: typeof agent === 'string' ? agent : undefined,
        purpose: typeof purpose === 'string' ? purpose : undefined
      });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('files_list_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /files/who-owns - Check who owns a specific file
  fastify.get('/files/who-owns', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const pathParam = (request.query as any).path;
      if (!pathParam || typeof pathParam !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: 'path query parameter is required',
          code: 'VALIDATION_ERROR'
        };
      }

      const startLineParam = (request.query as any).startLine;
      const endLineParam = (request.query as any).endLine;
      const symbolPathParam = (request.query as any).symbolPath;
      let range: { startLine?: number; endLine?: number; symbolPath?: string } | undefined;
      if (typeof startLineParam === 'string' && typeof endLineParam === 'string') {
        range = {
          startLine: parseInt(startLineParam, 10),
          endLine: parseInt(endLineParam, 10),
        };
      }
      if (typeof symbolPathParam === 'string' && symbolPathParam.trim()) {
        range = {
          ...(range || {}),
          symbolPath: symbolPathParam,
        };
      }

      const result = sessions.getClaimOwner(pathParam, range);
      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('files_who_owns_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /notes - Recent notes across all sessions
  fastify.get('/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as any;
      const limitParam = q.limit;
      const typeParam = q.type;
      const sinceParam = q.since;

      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 50;
      const type = typeof typeParam === 'string' ? typeParam : undefined;
      const since = typeof sinceParam === 'string' ? parseInt(sinceParam, 10) : undefined;

      const result = sessions.getNotes(null, { limit, type, since });

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('notes_get_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
