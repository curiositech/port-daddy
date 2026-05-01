/**
 * Test-only HTTP hooks. Mounted ONLY when NODE_ENV === 'test'.
 *
 * Why this exists separately from the main route surface:
 *   The kill-switch pipeline (cost-tracker → budget-guard → onKill →
 *   pause-and-ask → spawner.kill → bonds.slash) cannot be exercised end-to-
 *   end from the outside without an actual subprocess paying real LLM money.
 *   Spec docs/shipwright/FLEETCONTROL-HARDENING.md §6.2 calls for an
 *   integration test that proves the chain fires correctly under a budget
 *   breach. Adding a narrow test-mode "synthesize a charge" endpoint is the
 *   cheapest way to get a real end-to-end signal without forking a fake LLM
 *   or polluting production with debug routes.
 *
 * Safety:
 *   - The plugin no-ops in non-test environments. Even if a misconfigured
 *     daemon set NODE_ENV=test in production, every test-mode route is a
 *     thin pass-through to existing primitives — none of them bypass any
 *     governance check.
 *   - All test-mode routes are namespaced under /test/* so any operator
 *     glancing at the route list sees them clearly labeled.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { CostTracker } from '../lib/cost-tracker.js';

interface TestHooksDeps {
  costTracker: CostTracker;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

export const testHooksPlugin: FastifyPluginAsync<{ deps: TestHooksDeps }> = async (app, opts) => {
  const enabled = process.env.NODE_ENV === 'test';
  if (!enabled) {
    return;
  }

  const { costTracker, logger } = opts.deps;
  logger.warn('test_hooks_active', {
    note: 'NODE_ENV=test detected — /test/* hooks mounted. Do not run a production daemon with NODE_ENV=test.',
  });

  /**
   * POST /test/cost-event
   *   { backend?, model?, projectName, spawnId, inputTokens?, outputTokens? }
   *
   * Drives `costTracker.record()` exactly the way `lib/spawner.ts` does
   * after a real LLM charge. Triggers the cost-tracker → budget-guard →
   * pause-and-ask chain identically to a real spawn. The caller picks
   * model + token counts to produce the desired USD.
   *
   * Used by tests/integration/fleet-budget-kill.integration.test.js.
   */
  app.post('/test/cost-event', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as Record<string, unknown>) || {};
    const backend = typeof body.backend === 'string' ? body.backend : 'claude-cli';
    const model = typeof body.model === 'string' ? body.model : 'claude-sonnet-4-5';
    const projectName = typeof body.projectName === 'string' ? body.projectName : null;
    const spawnId = typeof body.spawnId === 'string' ? body.spawnId : null;
    const inputTokens = typeof body.inputTokens === 'number' ? body.inputTokens : 0;
    const outputTokens = typeof body.outputTokens === 'number' ? body.outputTokens : 0;

    if (!projectName) { reply.code(400); return { error: 'projectName required' }; }
    if (!spawnId) { reply.code(400); return { error: 'spawnId required' }; }

    const recorded = costTracker.record({
      backend, model, projectName, spawnId,
      inputTokens, outputTokens,
    });

    return { success: true, recorded };
  });
};
