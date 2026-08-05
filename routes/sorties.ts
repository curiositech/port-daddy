/**
 * Sortie Routes — first-class mission records over spawned runs
 *
 * POST /sorties          — create + run a sortie
 * GET  /sorties          — list sorties
 * GET  /sorties/:id      — get sortie status/result
 * GET  /sorties/:id/logs — get sortie event log
 */

import { basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import type { Spawner } from '../lib/spawner.js';
import type { Sorties } from '../lib/sorties.js';
import { assessSpawnPreflight } from '../lib/spawn-preflight.js';
import type { CostTracker } from '../lib/cost-tracker.js';
import type { FleetModelTier } from '../lib/fleet-engine.js';
import type { Conductor } from '../lib/fleet/conductor.js';
import { validateProjectRoot } from '../lib/utils.js';
import { KNOWN_BACKEND_IDS } from '../lib/backend-catalog.js';

interface SortieRouteDeps {
  spawner: Spawner;
  sorties: Sorties;
  /**
   * The Daemon Fleet Conductor (ADR-0060). When present, the sortie POST routes
   * its spawn through `conductor.launch(intent)` — the one spawn primitive — so
   * the sortie inherits the bond/lineage/breaker/halt envelope and the daemon
   * has a single chokepoint reaching `spawner.spawn`. The conductor builds the
   * byte-identical spawn spec (pinned by the golden test in fleet-conductor),
   * so behavior is unchanged. When absent (unit tests, legacy wiring), we fall
   * back to the direct `spawner.spawn` call this route used before the Conductor.
   */
  conductor?: Conductor;
  costTracker?: CostTracker;
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

// Single source of truth: lib/backend-catalog.ts (ADR-0057 model-abstraction
// unification). This list used to be a hand-maintained subset that had
// drifted from routes/spawn.ts's own copy (missing lmstudio/deepseek/xai/
// cli:agy/cli:gemini/cli:groq/cli:grok for no documented reason).
const VALID_BACKENDS = KNOWN_BACKEND_IDS;

function buildSortieTask(body: Record<string, unknown>): string {
  if (typeof body.task === 'string' && body.task.trim()) return body.task.trim();

  const parts: string[] = [];
  if (typeof body.goal === 'string' && body.goal.trim()) {
    parts.push(`Goal:\n${body.goal.trim()}`);
  }
  if (typeof body.expectedOutput === 'string' && body.expectedOutput.trim()) {
    parts.push(`Expected output:\n${body.expectedOutput.trim()}`);
  }
  if (typeof body.context === 'string' && body.context.trim()) {
    parts.push(`Context and constraints:\n${body.context.trim()}`);
  }
  return parts.join('\n\n').trim();
}

export const sortiesPlugin: FastifyPluginAsync<{ deps: SortieRouteDeps }> = async (fastify, opts) => {
  const { spawner, sorties, conductor, costTracker, metrics, logger } = opts.deps;

  fastify.get('/sorties', async (request, reply) => {
    try {
      const query = (request.query as Record<string, unknown>) || {};
      const projectDir = typeof query.projectDir === 'string' ? query.projectDir : undefined;
      const limit = typeof query.limit === 'number'
        ? query.limit
        : typeof query.limit === 'string' && query.limit.trim()
          ? parseInt(query.limit, 10)
          : undefined;
      const sortieList = sorties.list({ projectDir, limit });
      return { success: true, sorties: sortieList, count: sortieList.length };
    } catch (error) {
      metrics.errors++;
      logger.error('sorties_list_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/sorties/:id', async (request, reply) => {
    try {
      const id = String((request.params as Record<string, unknown>).id || '');
      const sortie = sorties.get(id);
      if (!sortie) {
        reply.code(404);
        return { success: false, error: `sortie '${id}' not found` };
      }
      return { success: true, sortie };
    } catch (error) {
      metrics.errors++;
      logger.error('sortie_get_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/sorties/:id/logs', async (request, reply) => {
    try {
      const id = String((request.params as Record<string, unknown>).id || '');
      const sortie = sorties.get(id);
      if (!sortie) {
        reply.code(404);
        return { success: false, error: `sortie '${id}' not found` };
      }
      const query = (request.query as Record<string, unknown>) || {};
      const limit = typeof query.limit === 'number'
        ? query.limit
        : typeof query.limit === 'string' && query.limit.trim()
          ? parseInt(query.limit, 10)
          : 200;
      const events = sorties.events(id, limit);
      return { success: true, sortie, events, count: events.length };
    } catch (error) {
      metrics.errors++;
      logger.error('sortie_logs_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.post('/sorties', async (request, reply) => {
    try {
      const body = (request.body as Record<string, unknown>) || {};
      const projectDir = typeof body.projectDir === 'string' ? body.projectDir : '';
      const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
      const backend = typeof body.backend === 'string' ? body.backend : '';
      const budgetUsd = typeof body.budgetUsd === 'number'
        ? body.budgetUsd
        : typeof body.budgetUsd === 'string' && body.budgetUsd.trim()
          ? parseFloat(body.budgetUsd)
          : undefined;
      const validation = validateProjectRoot(projectDir);
      if (!validation.ok) {
        reply.code(400);
        return { success: false, error: validation.error || 'invalid projectDir' };
      }
      if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
        reply.code(400);
        return { success: false, error: 'projectDir must exist and be a directory' };
      }
      if (!goal) {
        reply.code(400);
        return { success: false, error: 'goal is required' };
      }
      if (!backend || !VALID_BACKENDS.has(backend)) {
        reply.code(400);
        return { success: false, error: `backend is required. Valid values: ${[...VALID_BACKENDS].join(', ')}` };
      }
      if (budgetUsd == null || !Number.isFinite(budgetUsd) || budgetUsd <= 0) {
        reply.code(400);
        return { success: false, error: 'budgetUsd must be a positive number' };
      }

      const task = buildSortieTask(body);
      if (!task) {
        reply.code(400);
        return { success: false, error: 'task or goal/expectedOutput/context must produce a non-empty sortie brief' };
      }

      const project = basename(projectDir);
      const sortie = sorties.create({
        projectDir,
        project,
        harbor: `${project}:sortie:pending`,
        goal,
        recipe: typeof body.recipe === 'string' ? body.recipe : null,
        backend,
        model: typeof body.model === 'string' ? body.model : null,
        modelTier: typeof body.modelTier === 'string' ? body.modelTier : null,
        budgetUsd,
        expectedOutput: typeof body.expectedOutput === 'string' ? body.expectedOutput : null,
        metadata: {
          approvalMode: typeof body.approvalMode === 'string' ? body.approvalMode : null,
          roster: Array.isArray(body.roster) ? body.roster : null,
        },
      });
      const harbor = `${project}:sortie:${sortie.id}`;
      const planned = sorties.update(sortie.id, {
        harbor,
        metadata: sortie.metadata || {},
      })!;
      sorties.addEvent(planned.id, 'sortie:created', 'Mission created', { goal, projectDir, harbor });
      sorties.addEvent(planned.id, 'sortie:planned', 'Mission planned', {
        recipe: planned.recipe,
        backend: planned.backend,
        model: planned.model,
        modelTier: planned.modelTier,
        budgetUsd: planned.budgetUsd,
      });

      const preflight = await assessSpawnPreflight({
        backend,
        model: typeof body.model === 'string' ? body.model : undefined,
        modelTier: typeof body.modelTier === 'string' ? body.modelTier as FleetModelTier : undefined,
        identity: typeof body.identity === 'string' ? body.identity : `${project}:sortie:${planned.id}:coordinator`,
        budgetUsd,
      }, { costTracker });

      if (!preflight.launchReady) {
        const blocked = sorties.update(planned.id, {
          status: 'blocked',
          error: preflight.blockedReasons[0] || 'sortie preflight failed',
          metadata: {
            ...(planned.metadata || {}),
            harbor,
            preflight,
          },
        })!;
        sorties.addEvent(blocked.id, 'sortie:blocked', blocked.error || 'Sortie blocked before launch', { preflight });
        reply.code(400);
        return { success: false, error: blocked.error, sortie: blocked, preflight };
      }

      const running = sorties.update(planned.id, {
        status: 'running',
        model: typeof body.model === 'string' ? body.model : preflight.attempts[0]?.model || null,
        modelTier: typeof body.modelTier === 'string' ? body.modelTier : preflight.attempts[0]?.modelTier || null,
        startedAt: Date.now(),
        metadata: {
          ...(planned.metadata || {}),
          harbor,
          preflight,
        },
      })!;
      sorties.addEvent(running.id, 'sortie:started', 'Mission launched', {
        backend,
        model: running.model,
        modelTier: running.modelTier,
        harbor,
      });

      // The exact spawn arguments the legacy sortie path produced. The Conductor
      // rebuilds this byte-for-byte via intentToSpawnSpec (golden-tested), so the
      // observable spawn is identical whether we route through the chokepoint or
      // (fallback) call the spawner directly.
      const identity = typeof body.identity === 'string'
        ? body.identity
        : `${project}:sortie:${running.id}:coordinator`;
      const purpose = typeof body.purpose === 'string'
        ? body.purpose
        : `Sortie: ${goal.slice(0, 120)}`;
      const allowedTools = typeof body.allowedTools === 'string' ? body.allowedTools : undefined;
      const deadlineMs = typeof body.deadlineMs === 'number' ? body.deadlineMs : undefined;
      const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : undefined;
      const deadlineSpec = typeof deadlineMs === 'number' ? { deadlineMs } : {};

      let spawnResult;
      if (conductor) {
        // Route through the ONE spawn primitive (ADR-0060). A sortie is a
        // worktree:'inherit', mergePolicy:'never' intent — run in place, settle
        // immediately, no review gate — matching the legacy sortie lifecycle.
        const launchResult = await conductor.launch({
          source: 'sortie',
          goal,
          task,
          backend,
          model: running.model || undefined,
          modelTier: running.modelTier as ('low' | 'mid' | 'high') | undefined,
          budgetUsd: planned.budgetUsd,
          identity,
          purpose,
          workdir: projectDir,
          allowedTools,
          ...deadlineSpec,
          maxTokens,
          worktree: 'inherit',
          mergePolicy: 'never',
          // The spawner's own assessSpawnIsolation (spawner.ts) remains the
          // authoritative main-checkout gate — exactly as the legacy sortie path
          // relied on. The Conductor's default isMainCheckout probe returns false
          // so it does NOT double-refuse, and we pass no `allowSharedCheckout` so
          // the spawn spec stays byte-identical to the legacy one.
        });
        if (!launchResult.admitted || !launchResult.spawn) {
          const reason = launchResult.refusedReason || 'sortie refused by conductor';
          const blocked = sorties.update(running.id, {
            status: 'failed',
            error: reason,
            completedAt: Date.now(),
          })!;
          sorties.addEvent(blocked.id, 'sortie:failed', reason, { conductor: true });
          reply.code(400);
          return { success: false, error: reason, sortie: blocked };
        }
        spawnResult = launchResult.spawn;
      } else {
        spawnResult = await spawner.spawn({
          backend: backend as any,
          model: running.model || undefined,
          modelTier: running.modelTier as FleetModelTier | undefined,
          budgetUsd: planned.budgetUsd,
          identity,
          purpose,
          task,
          workdir: projectDir,
          allowedTools,
          ...deadlineSpec,
          maxTokens,
        });
      }

      const finalStatus = spawnResult.status === 'completed' ? 'completed' : 'failed';
      const finalSortie = sorties.update(running.id, {
        status: finalStatus,
        spawnAgentId: spawnResult.agentId,
        resultOutput: spawnResult.output,
        error: spawnResult.error,
        completedAt: (typeof spawnResult.completedAt === 'number' ? spawnResult.completedAt : undefined) || Date.now(),
      })!;
      sorties.addEvent(finalSortie.id, spawnResult.status === 'completed' ? 'sortie:completed' : 'sortie:failed', spawnResult.status === 'completed' ? 'Mission completed' : 'Mission failed', {
        spawnAgentId: spawnResult.agentId,
        output: spawnResult.output ? spawnResult.output.slice(0, 400) : null,
        error: spawnResult.error,
      });
      return { success: true, sortie: finalSortie, result: spawnResult };
    } catch (error) {
      metrics.errors++;
      logger.error('sortie_create_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
