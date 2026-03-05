/**
 * Resurrection Routes
 *
 * Agent self-healing system routes for discovering and reclaiming
 * work from stale or dead agents.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

interface StaleAgent {
  id: string;
  name: string;
  purpose: string | null;
  sessionId: string | null;
  lastHeartbeat: number;
  staleSince: number;
  status: 'stale' | 'dead' | 'resurrecting';
  notes?: string[];
  // Semantic identity components for prefix filtering
  identityProject: string | null;
  identityStack: string | null;
  identityContext: string | null;
}

interface ResurrectionRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  resurrection: {
    pending(options?: { project?: string; stack?: string }): { success: boolean; agents: StaleAgent[]; count: number; filtered?: boolean };
    list(options?: { limit?: number; project?: string; stack?: string }): { success: boolean; agents: StaleAgent[]; count: number; filtered?: boolean };
    claim(agentId: string): { success: boolean; agent?: StaleAgent; context?: Record<string, unknown>; error?: string };
    complete(oldAgentId: string, newAgentId: string): { success: boolean };
    abandon(agentId: string): { success: boolean };
    dismiss(agentId: string): { success: boolean };
    countByProject(project: string): number;
  };
  messaging: {
    publish(channel: string, message: string): { success: boolean };
  };
  activityLog: {
    log(type: string, details: Record<string, unknown>): void;
  };
}

/**
 * Create resurrection routes
 */
export function createResurrectionRoutes(deps: ResurrectionRouteDeps): Router {
  const { logger, metrics, resurrection, messaging } = deps;
  const router = Router();

  // ==========================================================================
  // GET /resurrection/pending - List agents pending resurrection
  // Filter by ?project= and/or ?stack= for context-aware salvage
  // ==========================================================================
  router.get('/resurrection/pending', (req: Request, res: Response) => {
    try {
      const { project, stack } = req.query;
      const result = resurrection.pending({
        project: project as string | undefined,
        stack: stack as string | undefined
      });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      logger.error('resurrection_pending_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // GET /resurrection - List all resurrection queue entries
  // Filter by ?project= and/or ?stack= for context-aware salvage
  // ==========================================================================
  router.get('/resurrection', (req: Request, res: Response) => {
    try {
      const { limit, project, stack } = req.query;
      const result = resurrection.list({
        limit: limit ? parseInt(limit as string, 10) : undefined,
        project: project as string | undefined,
        stack: stack as string | undefined
      });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // POST /resurrection/claim/:agentId - Claim an agent for resurrection
  // ==========================================================================
  router.post('/resurrection/claim/:agentId', (req: Request, res: Response) => {
    try {
      const agentId = req.params.agentId as string;
      const result = resurrection.claim(agentId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Broadcast that this agent is being resurrected
      messaging.publish('resurrection', JSON.stringify({
        event: 'claimed',
        agentId,
        claimedBy: req.body?.newAgentId || 'unknown'
      }));

      logger.info('resurrection_claimed', { agentId });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('resurrection_claim_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // POST /resurrection/complete/:agentId - Mark resurrection as complete
  // ==========================================================================
  router.post('/resurrection/complete/:agentId', (req: Request, res: Response) => {
    try {
      const oldAgentId = req.params.agentId as string;
      const { newAgentId } = req.body;

      if (!newAgentId) {
        return res.status(400).json({ error: 'newAgentId required' });
      }

      const result = resurrection.complete(oldAgentId, newAgentId);

      logger.info('resurrection_complete', { oldAgentId, newAgentId });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('resurrection_complete_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // POST /resurrection/abandon/:agentId - Abandon a resurrection attempt
  // ==========================================================================
  router.post('/resurrection/abandon/:agentId', (req: Request, res: Response) => {
    try {
      const agentId = req.params.agentId as string;
      const result = resurrection.abandon(agentId);

      // Broadcast that the agent is back in the queue
      messaging.publish('resurrection', JSON.stringify({
        event: 'abandoned',
        agentId
      }));

      logger.info('resurrection_abandoned', { agentId });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // DELETE /resurrection/:agentId - Dismiss an agent from the queue
  // ==========================================================================
  router.delete('/resurrection/:agentId', (req: Request, res: Response) => {
    try {
      const agentId = req.params.agentId as string;
      const result = resurrection.dismiss(agentId);

      logger.info('resurrection_dismissed', { agentId });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // Backward-compatible aliases: /salvage -> /resurrection
  // These provide a friendlier name while keeping the original routes intact.
  // ==========================================================================

  router.get('/salvage/pending', (req: Request, res: Response) => {
    try {
      const { project, stack } = req.query;
      const result = resurrection.pending({
        project: project as string | undefined,
        stack: stack as string | undefined
      });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_pending_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  router.get('/salvage', (req: Request, res: Response) => {
    try {
      const { limit, project, stack } = req.query;
      const result = resurrection.list({
        limit: limit ? parseInt(limit as string, 10) : undefined,
        project: project as string | undefined,
        stack: stack as string | undefined
      });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  router.post('/salvage/claim/:agentId', (req: Request, res: Response) => {
    try {
      const agentId = req.params.agentId as string;
      const result = resurrection.claim(agentId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      messaging.publish('resurrection', JSON.stringify({
        event: 'claimed',
        agentId,
        claimedBy: req.body?.newAgentId || 'unknown'
      }));

      logger.info('salvage_claimed', { agentId });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_claim_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  router.post('/salvage/complete/:agentId', (req: Request, res: Response) => {
    try {
      const oldAgentId = req.params.agentId as string;
      const { newAgentId } = req.body;

      if (!newAgentId) {
        return res.status(400).json({ error: 'newAgentId required' });
      }

      const result = resurrection.complete(oldAgentId, newAgentId);

      logger.info('salvage_complete', { oldAgentId, newAgentId });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_complete_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  router.post('/salvage/abandon/:agentId', (req: Request, res: Response) => {
    try {
      const agentId = req.params.agentId as string;
      const result = resurrection.abandon(agentId);

      messaging.publish('resurrection', JSON.stringify({
        event: 'abandoned',
        agentId
      }));

      logger.info('salvage_abandoned', { agentId });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  router.delete('/salvage/:agentId', (req: Request, res: Response) => {
    try {
      const agentId = req.params.agentId as string;
      const result = resurrection.dismiss(agentId);

      logger.info('salvage_dismissed', { agentId });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
