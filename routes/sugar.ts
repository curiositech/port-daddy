/**
 * Sugar Routes — Compound commands for common workflows
 *
 * POST /sugar/begin   - Register agent + start session atomically
 * POST /sugar/done    - End session + unregister agent
 * GET  /sugar/whoami  - Show current agent/session context
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

interface SugarRouteDeps {
  sugar: {
    begin(options: Record<string, unknown>): Record<string, unknown>;
    done(options: Record<string, unknown>): Record<string, unknown>;
    whoami(options: Record<string, unknown>): Record<string, unknown>;
  };
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export function createSugarRoutes(deps: SugarRouteDeps): Router {
  const { sugar, metrics, logger } = deps;
  const router = Router();

  // ==========================================================================
  // POST /sugar/begin — Register agent + start session
  // ==========================================================================
  router.post('/sugar/begin', (req: Request, res: Response) => {
    try {
      const { purpose, identity, agentId, type, files, force, metadata } = req.body;

      if (!purpose || typeof purpose !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'purpose must be a non-empty string',
          code: 'VALIDATION_ERROR',
        });
      }

      const result = sugar.begin({
        purpose,
        identity,
        agentId,
        type,
        files,
        force,
        metadata,
      });

      if (!result.success) {
        const status = result.code === 'AGENT_REGISTRATION_FAILED' ? 400 : 500;
        return res.status(status).json(result);
      }

      logger.info('sugar_begin', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        identity,
        purpose,
      });

      res.json(result);
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_begin_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error', details: (error as Error).message });
    }
  });

  // ==========================================================================
  // POST /sugar/done — End session + unregister agent
  // ==========================================================================
  router.post('/sugar/done', (req: Request, res: Response) => {
    try {
      const { agentId, sessionId, note, status } = req.body;

      // Validate status allowlist
      const VALID_DONE_STATUSES = new Set(['completed', 'abandoned']);
      if (status && !VALID_DONE_STATUSES.has(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status "${status}". Must be one of: completed, abandoned`,
          code: 'VALIDATION_ERROR',
        });
      }

      const result = sugar.done({ agentId, sessionId, note, status });

      if (!result.success) {
        const httpStatus = result.code === 'NO_ACTIVE_SESSION' ? 404 : 500;
        return res.status(httpStatus).json(result);
      }

      logger.info('sugar_done', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        status: result.sessionStatus,
      });

      res.json(result);
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_done_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error', details: (error as Error).message });
    }
  });

  // ==========================================================================
  // GET /sugar/whoami — Show current agent/session context
  // ==========================================================================
  router.get('/sugar/whoami', (req: Request, res: Response) => {
    try {
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;

      const result = sugar.whoami({ agentId });

      res.json(result);
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_whoami_error', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error', details: (error as Error).message });
    }
  });

  return router;
}
