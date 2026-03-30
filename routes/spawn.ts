/**
 * Spawn Routes — AI Agent Launcher
 *
 * POST /spawn        — launch an AI agent, body: SpawnSpec, returns SpawnResult
 * GET  /spawn        — list active spawned agents
 * DELETE /spawn/:id  — kill a spawned agent
 */

import type { FastifyPluginAsync } from 'fastify';
import { createSpawner } from '../lib/spawner.js';
import type { SpawnSpec } from '../lib/spawner.js';

// Module-level spawner instance (shared across requests)
const spawner = createSpawner();

interface SpawnRouteDeps {
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

const VALID_BACKENDS = new Set(['ollama', 'claude', 'claude-cli', 'gemini', 'aider', 'custom']);


// ==========================================================================
// Fastify plugin (dual-export)
// ==========================================================================
export const spawnPlugin: FastifyPluginAsync<{ deps: SpawnRouteDeps }> = async (fastify, opts) => {
  const { metrics, logger } = opts.deps;

  // POST /spawn — Launch an AI agent
  fastify.post('/spawn', async (request, reply) => {
    try {
      const { backend, model, identity, purpose, task, files, workdir, env, timeout, allowedTools, maxTokens } = request.body as any;

      if (!backend || typeof backend !== 'string') {
        reply.code(400); return {
          success: false,
          error: 'backend is required. Valid values: ollama, claude, gemini, aider, custom',
          code: 'VALIDATION_ERROR',
        };
      }

      if (!VALID_BACKENDS.has(backend)) {
        reply.code(400); return {
          success: false,
          error: `Invalid backend "${backend}". Valid values: ${[...VALID_BACKENDS].join(', ')}`,
          code: 'VALIDATION_ERROR',
        };
      }

      if (!task || typeof task !== 'string' || !task.trim()) {
        reply.code(400); return {
          success: false,
          error: 'task is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        };
      }

      if (typeof task === 'string' && task.length > 100000) {
        reply.code(400); return {
          success: false,
          error: 'task must not exceed 100000 characters',
          code: 'VALIDATION_ERROR',
        };
      }

      if (backend === 'custom' && /[;&|`$(){}!<>]/.test(task as string)) {
        reply.code(400); return {
          success: false,
          error: 'Custom backend task contains shell metacharacters. Use explicit arguments instead of shell syntax.',
          code: 'VALIDATION_ERROR',
        };
      }

      const spec: SpawnSpec = {
        backend: backend as SpawnSpec['backend'],
        task: task.trim(),
      };

      if (model && typeof model === 'string') spec.model = model;
      if (identity && typeof identity === 'string') spec.identity = identity;
      if (purpose && typeof purpose === 'string') spec.purpose = purpose;
      if (Array.isArray(files)) spec.files = files as string[];
      if (workdir && typeof workdir === 'string') spec.workdir = workdir;
      if (env && typeof env === 'object' && !Array.isArray(env)) spec.env = env as Record<string, string>;
      if (timeout && typeof timeout === 'number') spec.timeout = timeout;
      if (allowedTools && typeof allowedTools === 'string') spec.allowedTools = allowedTools;
      if (maxTokens && typeof maxTokens === 'number') spec.maxTokens = maxTokens;

      logger.info('spawn_start', {
        backend,
        model: spec.model || null,
        identity: spec.identity || null,
        purpose: spec.purpose || null,
      });

      const result = await spawner.spawn(spec);

      logger.info('spawn_complete', {
        agentId: result.agentId,
        backend: result.backend,
        status: result.status,
      });

      return { success: true, ...result };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // GET /spawn — List active spawned agents
  fastify.get('/spawn', async (request, reply) => {
    try {
      const agents = spawner.list();
      return {
        success: true,
        agents,
        count: agents.length,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_list_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // DELETE /spawn/:id — Kill a spawned agent
  fastify.delete('/spawn/:id', async (request, reply) => {
    try {
      const id = String((request.params as any).id);

      spawner.kill(id);

      logger.info('spawn_kill', { agentId: id });

      return {
        success: true,
        agentId: id,
        message: `Agent ${id} killed`,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_kill_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });
};
