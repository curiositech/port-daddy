/**
 * Merge Queue Routes
 *
 * POST   /merge/submit         - Submit branch to merge queue
 * GET    /merge/queue           - List queued merges with ordering
 * GET    /merge/queue/:id       - Get specific merge status
 * POST   /merge/queue/reorder   - Orchestrator requests reorder
 * POST   /merge/execute/:id     - Force-execute a specific merge
 * DELETE /merge/queue/:id       - Remove from queue
 * GET    /merge/predict         - Predict conflicts between branches
 * POST   /merge/inspect/:id     - Run post-merge inspection
 * GET    /merge/stats           - Queue statistics
 * GET    /merge/plugins         - List orchestrator plugins
 * POST   /merge/plugins         - Register orchestrator plugin (activate only)
 * PUT    /merge/plugins/active  - Switch active orchestrator plugin
 */

import type { FastifyPluginAsync } from 'fastify';
import type { MergeQueue } from '../lib/merge-queue.js';
import type { OrchestratorRegistry } from '../lib/orchestrator-plugins.js';

export interface MergeQueueRouteDeps {
  mergeQueue: MergeQueue;
  orchestratorRegistry: OrchestratorRegistry;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
}

export const mergeQueuePlugin: FastifyPluginAsync<{ deps: MergeQueueRouteDeps }> = async (fastify, opts) => {
  const { mergeQueue, orchestratorRegistry, logger, metrics } = opts.deps;

  // ── POST /merge/submit ────────────────────────────────────────────────

  fastify.post('/merge/submit', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;

      if (!body.agentId || typeof body.agentId !== 'string') {
        reply.code(400); return { error: 'agentId is required and must be a string' };
      }
      if (!body.branch || typeof body.branch !== 'string') {
        reply.code(400); return { error: 'branch is required and must be a string' };
      }
      if (!body.repository || typeof body.repository !== 'string') {
        reply.code(400); return { error: 'repository is required and must be a string' };
      }

      const claims = Array.isArray(body.claims) ? body.claims : [];
      for (const claim of claims) {
        if (!claim || typeof claim !== 'object' || !claim.path || typeof claim.path !== 'string') {
          reply.code(400); return { error: 'Each claim must have a path string' };
        }
      }

      const result = await mergeQueue.submit({
        agentId: body.agentId as string,
        sessionId: (body.sessionId as string) || undefined,
        branch: body.branch as string,
        repository: body.repository as string,
        baseBranch: (body.baseBranch as string) || 'main',
        claims,
        metadata: (body.metadata as Record<string, unknown>) || undefined,
      });

      if (!result.success) {
        reply.code(result.entryId ? 409 : 422);
      }

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('merge_submit_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── GET /merge/queue ──────────────────────────────────────────────────

  fastify.get('/merge/queue', async (request, reply) => {
    try {
      const query = request.query as Record<string, string>;
      const status = query.status as string | undefined;
      const repository = query.repository as string | undefined;
      const limit = Math.min(parseInt(query.limit || '100', 10), 500);

      const entries = mergeQueue.list({
        status: status as any,
        repository,
        limit,
      });

      // Also include the orchestrator's computed order for pending items
      let order;
      try {
        order = await mergeQueue.getOrder();
      } catch {
        order = null;
      }

      return {
        success: true,
        entries,
        count: entries.length,
        order,
        activePlugin: orchestratorRegistry.getActive(),
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── GET /merge/queue/:id ──────────────────────────────────────────────

  fastify.get('/merge/queue/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const entryId = parseInt(id, 10);
      if (isNaN(entryId)) {
        reply.code(400); return { error: 'id must be a number' };
      }

      const entry = mergeQueue.get(entryId);
      if (!entry) {
        reply.code(404); return { error: `Entry #${entryId} not found` };
      }

      return { success: true, entry };
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── POST /merge/queue/reorder ─────────────────────────────────────────

  fastify.post('/merge/queue/reorder', async (request, reply) => {
    try {
      const sequence = await mergeQueue.reorder();
      return { success: true, sequence };
    } catch (error) {
      metrics.errors++;
      logger.error('merge_reorder_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── POST /merge/execute/:id ───────────────────────────────────────────

  fastify.post('/merge/execute/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const entryId = parseInt(id, 10);
      if (isNaN(entryId)) {
        reply.code(400); return { error: 'id must be a number' };
      }

      const result = await mergeQueue.execute(entryId);

      if (!result.success) {
        reply.code(result.error?.includes('not found') ? 404 : 422);
      }

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('merge_execute_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── DELETE /merge/queue/:id ───────────────────────────────────────────

  fastify.delete('/merge/queue/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const entryId = parseInt(id, 10);
      if (isNaN(entryId)) {
        reply.code(400); return { error: 'id must be a number' };
      }

      const result = mergeQueue.remove(entryId);

      if (!result.success) {
        const entry = mergeQueue.get(entryId);
        if (!entry) {
          reply.code(404); return { error: `Entry #${entryId} not found` };
        }
        reply.code(409); return { error: `Cannot remove entry #${entryId} — status is ${entry.status}` };
      }

      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── GET /merge/predict ────────────────────────────────────────────────

  fastify.get('/merge/predict', async (request, reply) => {
    try {
      const query = request.query as Record<string, string>;

      if (!query.branch || !query.repository) {
        reply.code(400); return { error: 'branch and repository query params are required' };
      }

      const predictions = await mergeQueue.predictConflicts(
        query.branch,
        query.repository,
        query.baseBranch || 'main'
      );

      return {
        success: true,
        branch: query.branch,
        repository: query.repository,
        baseBranch: query.baseBranch || 'main',
        predictions,
        count: predictions.length,
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── POST /merge/inspect/:id ───────────────────────────────────────────

  fastify.post('/merge/inspect/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const entryId = parseInt(id, 10);
      if (isNaN(entryId)) {
        reply.code(400); return { error: 'id must be a number' };
      }

      const result = await mergeQueue.inspect(entryId);

      if (!result.passed && result.details?.includes('not found')) {
        reply.code(404);
      }

      return { success: result.passed, inspection: result };
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── GET /merge/stats ──────────────────────────────────────────────────

  fastify.get('/merge/stats', async (request, reply) => {
    try {
      const queueStats = mergeQueue.stats();
      const activePlugin = orchestratorRegistry.getActive();

      return {
        success: true,
        stats: queueStats,
        activePlugin,
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── GET /merge/plugins ────────────────────────────────────────────────

  fastify.get('/merge/plugins', async (request, reply) => {
    try {
      const plugins = orchestratorRegistry.listPlugins();
      const active = orchestratorRegistry.getActive();

      return {
        success: true,
        plugins,
        active,
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // ── PUT /merge/plugins/active ─────────────────────────────────────────

  fastify.put('/merge/plugins/active', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      if (!body.name || typeof body.name !== 'string') {
        reply.code(400); return { error: 'name is required and must be a string' };
      }

      try {
        const result = orchestratorRegistry.activate(body.name);
        return result;
      } catch (err) {
        reply.code(404); return { error: (err as Error).message };
      }
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });
};
