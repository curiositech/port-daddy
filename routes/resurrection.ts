/**
 * Salvage Routes (formerly "Resurrection")
 *
 * Agent self-healing system routes for discovering and reclaiming
 * work from stale or dead agents.
 *
 * Primary routes: /salvage/*
 * Deprecated aliases: /resurrection/* (backward-compatible)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

interface StaleAgent {
  id: string;
  name: string;
  purpose: string | null;
  sessionId: string | null;
  lastHeartbeat: number;
  staleSince: number;
  status: 'pending' | 'stale' | 'dead' | 'resurrecting';
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
    pending(options?: { project?: string; stack?: string; limit?: number }): { success: boolean; agents: StaleAgent[]; count: number; filtered?: boolean };
    list(options?: { limit?: number; project?: string; stack?: string }): { success: boolean; agents: StaleAgent[]; count: number; filtered?: boolean };
    claim(agentId: string): { success: boolean; agent?: StaleAgent; context?: Record<string, unknown>; error?: string };
    show(agentId: string): { success: boolean; agent?: StaleAgent; capsule?: Record<string, unknown> | null; error?: string };
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


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const resurrectionPlugin: FastifyPluginAsync<{ deps: ResurrectionRouteDeps }> = async (fastify, opts) => {
  const { logger, metrics, resurrection, messaging } = opts.deps;

  // Shared handler implementations as async functions

  function parseLimit(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  async function fHandlePending(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { limit, project, stack } = request.query as any;
      return resurrection.pending({
        limit: parseLimit(limit),
        project: project as string | undefined,
        stack: stack as string | undefined
      });
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_pending_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleList(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { limit, project, stack } = request.query as any;
      return resurrection.list({
        limit: parseLimit(limit),
        project: project as string | undefined,
        stack: stack as string | undefined
      });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleClaim(request: FastifyRequest, reply: FastifyReply) {
    try {
      const agentId = (request.params as any).agentId as string;
      const result = resurrection.claim(agentId);

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      messaging.publish('salvage', JSON.stringify({
        event: 'claimed',
        agentId,
        claimedBy: (request.body as any)?.newAgentId || 'unknown'
      }));

      logger.info('salvage_claimed', { agentId });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_claim_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleComplete(request: FastifyRequest, reply: FastifyReply) {
    try {
      const oldAgentId = (request.params as any).agentId as string;
      const { newAgentId } = request.body as any;

      if (!newAgentId) {
        reply.code(400);
        return { error: 'newAgentId required' };
      }

      const result = resurrection.complete(oldAgentId, newAgentId);

      logger.info('salvage_complete', { oldAgentId, newAgentId });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_complete_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleAbandon(request: FastifyRequest, reply: FastifyReply) {
    try {
      const agentId = (request.params as any).agentId as string;
      const result = resurrection.abandon(agentId);

      messaging.publish('salvage', JSON.stringify({
        event: 'abandoned',
        agentId
      }));

      logger.info('salvage_abandoned', { agentId });
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleShow(request: FastifyRequest, reply: FastifyReply) {
    try {
      const agentId = (request.params as any).agentId as string;
      const result = resurrection.show(agentId);

      if (!result.success) {
        reply.code(404);
        return { error: result.error };
      }

      // Read-only: no status flip, no messaging — inspect before claiming.
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_show_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleDismiss(request: FastifyRequest, reply: FastifyReply) {
    try {
      const agentId = (request.params as any).agentId as string;
      const result = resurrection.dismiss(agentId);

      logger.info('salvage_dismissed', { agentId });
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  // PRIMARY ROUTES: /salvage/*
  fastify.get('/salvage/pending', fHandlePending);
  fastify.get('/salvage', fHandleList);
  // Full-capsule render for one queue entry. Fastify static routes
  // (/salvage/pending) win over this param route, so no shadowing.
  fastify.get('/salvage/:agentId', fHandleShow);
  fastify.post('/salvage/claim/:agentId', fHandleClaim);
  fastify.post('/salvage/complete/:agentId', fHandleComplete);
  fastify.post('/salvage/abandon/:agentId', fHandleAbandon);
  fastify.delete('/salvage/:agentId', fHandleDismiss);

  // DEPRECATED ALIASES: /resurrection/*
  fastify.get('/resurrection/pending', fHandlePending);
  fastify.get('/resurrection', fHandleList);
  fastify.post('/resurrection/claim/:agentId', fHandleClaim);
  fastify.post('/resurrection/complete/:agentId', fHandleComplete);
  fastify.post('/resurrection/abandon/:agentId', fHandleAbandon);
  fastify.delete('/resurrection/:agentId', fHandleDismiss);

  // Reap aliases
  fastify.post('/resurrection/reap', fHandlePending);
  fastify.post('/salvage/reap', fHandlePending);
};
