/**
 * Spawn Routes — AI Agent Launcher
 *
 * POST /spawn        — launch an AI agent, body: SpawnSpec, returns SpawnResult
 * GET  /spawn        — list active spawned agents
 * DELETE /spawn/:id  — kill a spawned agent
 */

import type { FastifyPluginAsync } from 'fastify';
import type { SpawnSpec, Spawner } from '../lib/spawner.js';
import { assessSpawnPreflight } from '../lib/spawn-preflight.js';
import type { CostTracker } from '../lib/cost-tracker.js';
import type { FleetModelTier, FleetRuntimeTarget } from '../lib/fleet-engine.js';
import type { Ancestry } from '../lib/spawn-ancestry.js';
import {
  parseGatherPolicy,
  gatherByPolicy,
  GatherPolicyError,
  type ChildHandle,
  type ChildResult,
} from '../lib/spawn-gather.js';

interface SpawnRouteDeps {
  spawner: Spawner;
  spawnAncestry?: Ancestry;
  costTracker?: CostTracker;
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

const VALID_BACKENDS = new Set(['ollama', 'claude', 'claude-cli', 'gemini', 'cloudflare', 'codex', 'aider', 'custom']);


// ==========================================================================
// Fastify plugin (dual-export)
// ==========================================================================
export const spawnPlugin: FastifyPluginAsync<{ deps: SpawnRouteDeps }> = async (fastify, opts) => {
  const { metrics, logger, spawner, costTracker, spawnAncestry } = opts.deps;

  fastify.post('/spawn/preflight', async (request, reply) => {
    try {
      const body = (request.body as Record<string, unknown>) || {};
      const fallbacks = Array.isArray(body.fallbacks)
        ? (body.fallbacks.filter((value): value is FleetRuntimeTarget => !!value && typeof value === 'object'))
        : undefined;
      const budgetUsd = typeof body.budgetUsd === 'number'
        ? body.budgetUsd
        : typeof body.budgetUsd === 'string' && body.budgetUsd.trim()
          ? parseFloat(body.budgetUsd)
          : undefined;

      const preflight = await assessSpawnPreflight({
        backend: typeof body.backend === 'string' ? body.backend : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        modelTier: typeof body.modelTier === 'string' ? body.modelTier as FleetModelTier : undefined,
        fallbacks,
        identity: typeof body.identity === 'string' ? body.identity : undefined,
        budgetUsd: Number.isFinite(budgetUsd) ? budgetUsd : undefined,
      }, { costTracker });

      return { success: true, ...preflight };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_preflight_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /spawn — Launch an AI agent
  fastify.post('/spawn', async (request, reply) => {
    try {
      const {
        backend,
        name,
        model,
        modelTier,
        identity,
        purpose,
        task,
        files,
        workdir,
        env,
        timeout,
        allowedTools,
        maxTokens,
        budgetUsd: rawBudgetUsd,
        parentSessionId,
        maxSpawnDepth,
        parallel: rawParallel,
        gather: rawGather,
      } = request.body as any;

      if (!backend || typeof backend !== 'string') {
        reply.code(400); return {
          success: false,
          error: 'backend is required. Valid values: ollama, claude, claude-cli, gemini, cloudflare, codex, aider, custom',
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

      const parsedBudgetUsd = typeof rawBudgetUsd === 'number'
        ? rawBudgetUsd
        : typeof rawBudgetUsd === 'string' && rawBudgetUsd.trim()
          ? parseFloat(rawBudgetUsd)
          : undefined;
      const preflight = await assessSpawnPreflight({
        backend,
        model,
        modelTier: typeof modelTier === 'string' ? modelTier as FleetModelTier : undefined,
        identity,
        budgetUsd: Number.isFinite(parsedBudgetUsd) ? parsedBudgetUsd : undefined,
      }, { costTracker });

      if (!preflight.launchReady) {
        reply.code(400);
        return {
          success: false,
          error: preflight.blockedReasons[0] || 'spawn preflight failed',
          code: 'PRECONDITION_FAILED',
          preflight,
        };
      }

      const spec: SpawnSpec = {
        backend: backend as SpawnSpec['backend'],
        task: task.trim(),
      };

      if (model && typeof model === 'string') spec.model = model;
      else if (preflight.attempts[0]?.model) spec.model = preflight.attempts[0].model;
      if (name && typeof name === 'string') spec.name = name;
      if (typeof modelTier === 'string') spec.modelTier = modelTier as FleetModelTier;
      else if (preflight.attempts[0]?.modelTier) spec.modelTier = preflight.attempts[0].modelTier as FleetModelTier;
      if (identity && typeof identity === 'string') spec.identity = identity;
      if (purpose && typeof purpose === 'string') spec.purpose = purpose;
      if (Array.isArray(files)) spec.files = files as string[];
      if (workdir && typeof workdir === 'string') spec.workdir = workdir;
      if (env && typeof env === 'object' && !Array.isArray(env)) spec.env = env as Record<string, string>;
      if (timeout && typeof timeout === 'number') spec.timeout = timeout;
      if (allowedTools && typeof allowedTools === 'string') spec.allowedTools = allowedTools;
      if (maxTokens && typeof maxTokens === 'number') spec.maxTokens = maxTokens;
      if (typeof parentSessionId === 'string' && parentSessionId.trim()) {
        spec.parentSessionId = parentSessionId.trim();
      }
      if (typeof maxSpawnDepth === 'number' && Number.isFinite(maxSpawnDepth) && maxSpawnDepth > 0) {
        spec.maxSpawnDepth = Math.floor(maxSpawnDepth);
      }

      // Parallel + gather branch. When --parallel N (with N > 1) and a
      // gather policy are present, fan out N spawns and apply the policy.
      // Backward-compat: missing/=1 parallel falls through to the single
      // spawner.spawn(spec) path below.
      const parallelN = typeof rawParallel === 'number'
        ? Math.floor(rawParallel)
        : typeof rawParallel === 'string' && rawParallel.trim()
          ? parseInt(rawParallel, 10)
          : 1;

      if (Number.isFinite(parallelN) && parallelN > 1) {
        let parsedGather;
        try {
          parsedGather = parseGatherPolicy(typeof rawGather === 'string' ? rawGather : 'all');
        } catch (err) {
          reply.code(400);
          return {
            success: false,
            error: (err as GatherPolicyError).message,
            code: 'VALIDATION_ERROR',
          };
        }

        logger.info('spawn_parallel_start', {
          backend,
          model: spec.model || null,
          identity: spec.identity || null,
          parallel: parallelN,
          gather: parsedGather.policy + (parsedGather.k !== undefined ? `=${parsedGather.k}` : ''),
        });

        // Build N independent children. Each gets its OWN spec object so the
        // spawner's per-child mutation (childProcess wiring, etc.) doesn't
        // cross-contaminate siblings.
        const children: ChildHandle[] = [];
        const childAgentIds: string[] = [];
        for (let i = 0; i < parallelN; i++) {
          const childSpec: SpawnSpec = { ...spec };
          // Stable handle id for the gather layer; the actual agentId is
          // assigned by the spawner and surfaces via the result.
          const handleId = `pending-${i}`;
          const handle: ChildHandle = {
            agentId: handleId,
            run: async (): Promise<ChildResult> => {
              const r = await spawner.spawn(childSpec);
              childAgentIds[i] = r.agentId;
              return {
                agentId: r.agentId,
                status: r.status,
                output: r.output,
                error: r.error,
                backend: r.backend,
                model: r.model,
                telemetry: r.telemetry,
                startedAt: r.startedAt,
                completedAt: r.completedAt,
              };
            },
            kill: () => {
              const realId = childAgentIds[i];
              if (realId) spawner.kill(realId);
            },
          };
          children.push(handle);
        }

        const gathered = await gatherByPolicy(children, parsedGather);

        logger.info('spawn_parallel_complete', {
          parallel: parallelN,
          gather: parsedGather.policy,
          winner: gathered.winner.agentId,
          killed: gathered.killed.length,
        });

        return {
          success: true,
          mode: 'parallel',
          parallel: parallelN,
          gather: parsedGather,
          winner: gathered.winner,
          killed: gathered.killed,
          all: gathered.all,
          gathered_at: gathered.gathered_at,
        };
      }

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

  // GET /spawn/tree/:sessionId — Render ancestry tree rooted at the session
  fastify.get('/spawn/tree/:sessionId', async (request, reply) => {
    try {
      if (!spawnAncestry) {
        reply.code(503);
        return { success: false, error: 'spawn ancestry not wired into this daemon' };
      }
      const sessionId = String((request.params as any).sessionId);
      const row = spawnAncestry.getRow(sessionId);
      const ascii = spawnAncestry.tree(sessionId);
      return {
        success: true,
        sessionId,
        depth: row?.depth ?? 0,
        chain: row ? [...row.chain, sessionId] : [sessionId],
        children: spawnAncestry.childrenOf(sessionId).map((c) => ({
          sessionId: c.childSessionId,
          depth: c.depth,
        })),
        ascii,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_tree_error', { error: (error as Error).message });
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
