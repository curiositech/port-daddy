/**
 * Salvage Routes (formerly "Resurrection")
 *
 * Agent self-healing system routes for discovering and reclaiming
 * work from stale or dead agents.
 *
 * Primary routes: /salvage/*
 * Deprecated aliases: /resurrection/* (backward-compatible)
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
 * Create salvage routes (with /resurrection backward-compatible aliases)
 */
export function createResurrectionRoutes(deps: ResurrectionRouteDeps): Router {
  const { logger, metrics, resurrection, messaging } = deps;
  const router = Router();

  // --------------------------------------------------------------------------
  // Route handlers (shared between /salvage and /resurrection paths)
  // --------------------------------------------------------------------------

  function handlePending(req: Request, res: Response) {
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
  }

  function handleList(req: Request, res: Response) {
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
  }

  function handleClaim(req: Request, res: Response) {
    try {
      const agentId = req.params.agentId as string;
      const result = resurrection.claim(agentId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Broadcast that this agent is being salvaged
      messaging.publish('salvage', JSON.stringify({
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
  }

  function handleComplete(req: Request, res: Response) {
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
  }

  function handleAbandon(req: Request, res: Response) {
    try {
      const agentId = req.params.agentId as string;
      const result = resurrection.abandon(agentId);

      // Broadcast that the agent is back in the queue
      messaging.publish('salvage', JSON.stringify({
        event: 'abandoned',
        agentId
      }));

      logger.info('salvage_abandoned', { agentId });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  }

  function handleDismiss(req: Request, res: Response) {
    try {
      const agentId = req.params.agentId as string;
      const result = resurrection.dismiss(agentId);

      logger.info('salvage_dismissed', { agentId });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  }

  // ==========================================================================
  // PRIMARY ROUTES: /salvage/*
  // ==========================================================================
  router.get('/salvage/pending', handlePending);
  router.get('/salvage', handleList);
  router.post('/salvage/claim/:agentId', handleClaim);
  router.post('/salvage/complete/:agentId', handleComplete);
  router.post('/salvage/abandon/:agentId', handleAbandon);
  router.delete('/salvage/:agentId', handleDismiss);

  // ==========================================================================
  // DEPRECATED ALIASES: /resurrection/* (backward-compatible)
  // ==========================================================================
  router.get('/resurrection/pending', handlePending);
  router.get('/resurrection', handleList);
  router.post('/resurrection/claim/:agentId', handleClaim);
  router.post('/resurrection/complete/:agentId', handleComplete);
  router.post('/resurrection/abandon/:agentId', handleAbandon);
  router.delete('/resurrection/:agentId', handleDismiss);

  // Also support POST /resurrection/reap as an alias for pending check
  // (some older clients call this to trigger the reaper)
  router.post('/resurrection/reap', handlePending);
  router.post('/salvage/reap', handlePending);

  return router;
}
