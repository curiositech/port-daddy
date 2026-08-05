/**
 * Budget pause-and-ask routes.
 *
 *   GET  /budget/pending                        — list all pending cancellations
 *   GET  /budget/pending/:agentId               — single pending
 *   POST /budget/pending/:agentId/resolve       — operator decision
 *     body: { action: 'raise'|'cancel'|'grace',
 *             topUpUsd?, newBudgetUsdPerDay?, operator? }
 *
 * A pending-cancel is the 60s window between "this agent blew its daily budget"
 * and "SIGTERM fires." The operator can raise the budget (saves the agent),
 * cancel immediately (skips the wait), or extend the grace (buys time to
 * investigate). If nothing happens, the backstop still fires at expiry.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { BudgetPause, ResolveAction } from '../lib/budget-pause.js';

interface BudgetRouteDeps {
  budgetPause?: BudgetPause;
  activityLog?: {
    log(type: string, payload: { details?: string; metadata?: Record<string, unknown> }): void;
  };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

const VALID_ACTIONS: ReadonlySet<ResolveAction> = new Set(['raise', 'cancel', 'grace']);

export const budgetPlugin: FastifyPluginAsync<{ deps: BudgetRouteDeps }> = async (app, opts) => {
  const { budgetPause, activityLog, logger } = opts.deps;

  if (!budgetPause) {
    // No pause module wired — plugin is a no-op. Routes return 501 so
    // callers get a clear "feature not available" signal.
    app.get('/budget/pending', async (_req, reply) => {
      reply.code(501);
      return { error: 'budget pause-and-ask not wired' };
    });
    return;
  }

  app.get('/budget/pending', async () => {
    return { success: true, pending: budgetPause.list(), graceMs: budgetPause.graceMs };
  });

  app.get('/budget/pending/:agentId', async (request: FastifyRequest, reply: FastifyReply) => {
    const agentId = (request.params as Record<string, string>).agentId;
    const entry = budgetPause.get(agentId);
    if (!entry) {
      reply.code(404);
      return { error: `no pending cancel for agent ${agentId}` };
    }
    return { success: true, pending: entry };
  });

  app.post('/budget/pending/:agentId/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const agentId = (request.params as Record<string, string>).agentId;
    const body = (request.body as Record<string, unknown>) || {};
    const action = typeof body.action === 'string' ? (body.action as ResolveAction) : undefined;

    if (!action || !VALID_ACTIONS.has(action)) {
      reply.code(400);
      return { error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}` };
    }

    const topUpUsd = typeof body.topUpUsd === 'number' ? body.topUpUsd : undefined;
    const newBudgetUsdPerDay = typeof body.newBudgetUsdPerDay === 'number' ? body.newBudgetUsdPerDay : undefined;
    const operator = typeof body.operator === 'string' && body.operator.trim()
      ? body.operator.trim()
      : (request.headers['x-agent-id'] as string | undefined) || 'operator';

    if (action === 'raise' && (!topUpUsd || topUpUsd <= 0)) {
      reply.code(400);
      return { error: 'action=raise requires topUpUsd > 0' };
    }

    const result = budgetPause.resolve(agentId, { action, topUpUsd, newBudgetUsdPerDay, operator });
    if (!result.ok) {
      reply.code(409);
      return { error: result.reason || 'could not resolve pending cancel' };
    }

    logger.info('budget_pending_resolved', { agentId, action, operator });
    activityLog?.log('budget.resolve', {
      details: `Budget pending for ${agentId} resolved: ${action} by ${operator}`,
      metadata: { agentId, action, topUpUsd, newBudgetUsdPerDay, operator, project: result.project },
    });

    return { success: true, ...result };
  });
};
