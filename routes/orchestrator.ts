import type { FastifyPluginAsync } from 'fastify';
import { createReactiveOrchestrator } from '../lib/orchestrator.js';

export interface OrchestratorRouteDeps {
  orchestrator: ReturnType<typeof createReactiveOrchestrator>;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
}


// ==========================================================================
// Fastify plugin (dual-export)
// ==========================================================================
export const orchestratorPlugin: FastifyPluginAsync<{ deps: OrchestratorRouteDeps }> = async (fastify, opts) => {
  const { orchestrator, logger, metrics } = opts.deps;

  fastify.post('/orchestrator/up', async (request, reply) => {
    try {
      return { success: true, message: 'Orchestration started' };
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });

  fastify.post('/orchestrator/down', async (request, reply) => {
    try {
      await (orchestrator as any).stop?.();
      return { success: true, message: 'All services stopped' };
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });

  fastify.get('/orchestrator/status', async (request, reply) => {
    try {
      return { status: 'active' };
    } catch (error) {
      reply.code(500); return { error: 'internal server error' };
    }
  });

  fastify.get('/orchestrator/rules', async (request, reply) => {
    try {
      return orchestrator.listRules();
    } catch (error) {
      reply.code(500); return { error: 'internal server error' };
    }
  });

  fastify.post('/orchestrator/rules', async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body.name || typeof body.name !== 'string') {
        reply.code(400); return { error: 'name is required and must be a string' };
      }
      if (!body.channelPattern || typeof body.channelPattern !== 'string') {
        reply.code(400); return { error: 'channelPattern is required' };
      }
      if (!body.action || !['spawn', 'exec'].includes(body.action)) {
        reply.code(400); return { error: 'action must be "spawn" or "exec"' };
      }
      if (!body.payload || typeof body.payload !== 'object') {
        reply.code(400); return { error: 'payload is required and must be an object' };
      }

      if (body.action === 'exec') {
        const cmd = body.payload?.cmd;
        if (!cmd || typeof cmd !== 'string') {
          reply.code(400); return { error: 'exec action requires payload.cmd string' };
        }
        if (/[;&|`$()\{\}!<>]/.test(cmd)) {
          reply.code(400); return { error: 'exec command contains shell metacharacters — use spawn action instead' };
        }
      }

      const result = orchestrator.addRule(body);
      return result;
    } catch (error) {
      reply.code(500); return { error: 'internal server error' };
    }
  });

  fastify.delete('/orchestrator/rules/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id?: string };
      const numericId = Number.parseInt(id ?? '', 10);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        reply.code(400);
        return { error: 'id must be a positive integer' };
      }

      const result = orchestrator.removeRule(numericId);
      if (!result.success) {
        reply.code(404);
        return { error: 'rule not found' };
      }

      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500); return { error: 'internal server error' };
    }
  });
};
