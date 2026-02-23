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

import { Router } from 'express';
import type { Request, Response } from 'express';

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
      agentId?: string | null;
      type?: string;
    }): Record<string, unknown>;
    getNotes(sessionId?: string | null, options?: {
      limit?: number;
      type?: string;
      since?: number;
    }): Record<string, unknown>;
    claimFiles(sessionId: string, files: string[]): Record<string, unknown>;
    releaseFiles(sessionId: string, files: string[]): Record<string, unknown>;
    getFileConflicts(files: string[]): Record<string, unknown>;
    list(options?: {
      status?: string;
      agentId?: string | null;
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
export function createSessionsRoutes(deps: SessionsRouteDeps): Router {
  const { sessions, metrics, logger, activityLog } = deps;
  const router = Router();

  // ==========================================================================
  // POST /sessions - Start a session
  // ==========================================================================
  router.post('/sessions', (req: Request, res: Response) => {
    try {
      const { purpose, agentId, files, force, metadata } = req.body;

      if (!purpose || typeof purpose !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'purpose must be a non-empty string'
        });
      }

      // Check for file conflicts if force=false (default)
      if (files && Array.isArray(files) && files.length > 0 && !force) {
        const conflictCheck = sessions.getFileConflicts(files);
        if (conflictCheck.conflicts && Array.isArray(conflictCheck.conflicts) && conflictCheck.conflicts.length > 0) {
          return res.status(409).json({
            success: false,
            error: 'File conflicts detected',
            conflicts: conflictCheck.conflicts,
            hint: 'Use force=true to claim files anyway'
          });
        }
      }

      const result = sessions.start(purpose, { agentId, files, metadata });

      if (!result.success) {
        return res.status(400).json(result);
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

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('session_start_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error', details: (error as Error).message });
    }
  });

  // ==========================================================================
  // GET /sessions - List sessions
  // ==========================================================================
  router.get('/sessions', (req: Request, res: Response) => {
    try {
      const statusParam = req.query.status;
      const agentParam = req.query.agent;
      const status = typeof statusParam === 'string' ? statusParam : undefined;
      const agentId = typeof agentParam === 'string' ? agentParam : undefined;
      const includeNotes = req.query.notes === 'true';
      const limitParam = req.query.limit;
      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 50;

      const result = sessions.list({ status, agentId, includeNotes, limit });

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('session_list_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // GET /sessions/:id - Get session details + notes + files
  // ==========================================================================
  router.get('/sessions/:id', (req: Request, res: Response) => {
    try {
      const sessionIdParam = req.params.id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];

      const result = sessions.get(sessionId);

      if (!result.success) {
        return res.status(404).json(result);
      }

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('session_get_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // PUT /sessions/:id - End or abandon a session
  // ==========================================================================
  router.put('/sessions/:id', (req: Request, res: Response) => {
    try {
      const sessionIdParam = req.params.id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { status, note } = req.body;

      let result: Record<string, unknown>;

      if (status === 'abandoned') {
        result = sessions.abandon(sessionId);
      } else {
        result = sessions.end(sessionId, { note, status });
      }

      if (!result.success) {
        return res.status(404).json(result);
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

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('session_end_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // DELETE /sessions/:id - Delete session + cascade notes
  // ==========================================================================
  router.delete('/sessions/:id', (req: Request, res: Response) => {
    try {
      const sessionIdParam = req.params.id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];

      const result = sessions.remove(sessionId);

      if (!result.success) {
        return res.status(404).json(result);
      }

      logger.info('session_deleted', { sessionId });

      res.json({
        success: true,
        message: `Session "${sessionId}" removed`
      });

    } catch (error) {
      metrics.errors++;
      logger.error('session_delete_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // POST /sessions/:id/notes - Add a note to a session
  // ==========================================================================
  router.post('/sessions/:id/notes', (req: Request, res: Response) => {
    try {
      const sessionIdParam = req.params.id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { content, type } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'content must be a non-empty string'
        });
      }

      const result = sessions.addNote(sessionId, content, { type });

      if (!result.success) {
        return res.status(404).json(result);
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

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('session_note_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // GET /sessions/:id/notes - Get notes for a session
  // ==========================================================================
  router.get('/sessions/:id/notes', (req: Request, res: Response) => {
    try {
      const sessionIdParam = req.params.id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const typeParam = req.query.type;
      const limitParam = req.query.limit;
      const sinceParam = req.query.since;

      const type = typeof typeParam === 'string' ? typeParam : undefined;
      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 100;
      const since = typeof sinceParam === 'string' ? parseInt(sinceParam, 10) : undefined;

      const result = sessions.getNotes(sessionId, { type, limit, since });

      if (!result.success) {
        return res.status(404).json(result);
      }

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('session_notes_get_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // POST /sessions/:id/files - Claim files for a session
  // ==========================================================================
  router.post('/sessions/:id/files', (req: Request, res: Response) => {
    try {
      const sessionIdParam = req.params.id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { files, force } = req.body;

      if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'files must be a non-empty array'
        });
      }

      // Check for conflicts if force=false
      if (!force) {
        const conflictCheck = sessions.getFileConflicts(files);
        if (conflictCheck.conflicts && Array.isArray(conflictCheck.conflicts) && conflictCheck.conflicts.length > 0) {
          return res.status(409).json({
            success: false,
            error: 'File conflicts detected',
            conflicts: conflictCheck.conflicts,
            hint: 'Use force=true to claim files anyway'
          });
        }
      }

      const result = sessions.claimFiles(sessionId, files);

      if (!result.success) {
        return res.status(404).json(result);
      }

      logger.info('session_files_claimed', {
        sessionId,
        filesCount: Array.isArray(result.claimed) ? result.claimed.length : 0,
        conflictsCount: Array.isArray(result.conflicts) ? result.conflicts.length : 0
      });

      if (activityLog?.log) {
        activityLog.log('file_claim', {
          details: `Claimed ${Array.isArray(result.claimed) ? result.claimed.length : 0} files for session ${sessionId}`,
          metadata: { sessionId, filesCount: Array.isArray(result.claimed) ? result.claimed.length : 0 }
        });
      }

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('session_files_claim_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // DELETE /sessions/:id/files - Release files from a session
  // ==========================================================================
  router.delete('/sessions/:id/files', (req: Request, res: Response) => {
    try {
      const sessionIdParam = req.params.id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];

      // Support both query params and request body
      let files: string[];
      const pathsParam = req.query.paths;
      if (pathsParam && typeof pathsParam === 'string') {
        files = pathsParam.split(',');
      } else if (req.body.files && Array.isArray(req.body.files)) {
        files = req.body.files;
      } else {
        return res.status(400).json({
          success: false,
          error: 'files must be provided via query param ?paths=file1,file2 or body { files: [] }'
        });
      }

      const result = sessions.releaseFiles(sessionId, files);

      if (!result.success) {
        return res.status(404).json(result);
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

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('session_files_release_error', { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ==========================================================================
  // POST /notes - Quick note (auto-creates session if needed)
  // ==========================================================================
  router.post('/notes', (req: Request, res: Response) => {
    try {
      const { content, agentId, type } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'content must be a non-empty string'
        });
      }

      const result = sessions.quickNote(content, { agentId, type });

      if (!result.success) {
        return res.status(400).json(result);
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

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('quick_note_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // GET /notes - Recent notes across all sessions
  // ==========================================================================
  router.get('/notes', (req: Request, res: Response) => {
    try {
      const limitParam = req.query.limit;
      const typeParam = req.query.type;
      const sinceParam = req.query.since;

      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 50;
      const type = typeof typeParam === 'string' ? typeParam : undefined;
      const since = typeof sinceParam === 'string' ? parseInt(sinceParam, 10) : undefined;

      const result = sessions.getNotes(null, { limit, type, since });

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('notes_get_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
