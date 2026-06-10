/**
 * Context Health Routes — swarm-wide token budget visibility.
 *
 * GET /context/overview — aggregated health for all active agents.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ContextWindowTracker } from '../lib/context-window-tracker.js';
import type { OperatorPermissions } from '../lib/operator-permissions.js';
import type { KnowledgeCustodian } from '../lib/knowledge-custodian.js';

interface ContextRouteDeps {
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  contextTracker: ContextWindowTracker;
  resurrection?: {
    listPending(): Array<unknown>;
  };
  /** Optional: when provided, /context/overview reports real pending approvals count. */
  operatorPermissions?: OperatorPermissions;
  /** Optional: when provided, /context/overview reports real custodian status. */
  custodian?: KnowledgeCustodian;
}

export const contextRoutes: FastifyPluginAsync<{ deps: ContextRouteDeps }> = async (
  fastify,
  { deps },
) => {
  const { contextTracker } = deps;

  fastify.get('/context/overview', async (req, reply) => {
    try {
      const query = req.query as Record<string, string>;
      const project = query.project || undefined;
      const agents = contextTracker.getSwarmContextSummary(project);
      const today = new Date().toISOString().slice(0, 10);
      const dailyCosts = contextTracker.getDailyCostByAgent(today);
      const swarmDailyCostUsd = contextTracker.getSwarmDailyCostUsd(today);

      const costMap = new Map(dailyCosts.map(c => [c.agentId, c.costUsd]));

      const pendingResurrections = deps.resurrection
        ? deps.resurrection.listPending().length
        : 0;

      const pendingApprovals = deps.operatorPermissions
        ? deps.operatorPermissions.listCandidates().length
        : 0;

      const custodianStatus = deps.custodian
        ? (() => {
            const s = deps.custodian.getStatus();
            return { running: s.running, lastDutyAt: s.lastDutyAt, episodesHarvestedToday: s.episodesHarvestedToday };
          })()
        : { running: false, lastDutyAt: null, episodesHarvestedToday: 0 };

      return reply.send({
        agents: agents.map(h => ({
          agentId: h.agentId,
          model: h.model,
          contextHealth: {
            tokensUsed: h.tokensUsed,
            effectiveMax: h.effectiveMax,
            usedPct: h.usedPct,
            remaining: h.remaining,
            pressureLevel: h.pressureLevel,
            updatedAt: h.updatedAt,
          },
          dailyCostUsd: costMap.get(h.agentId) ?? 0,
          pressureLevel: h.pressureLevel,
        })),
        pendingResurrections,
        pendingApprovals,
        custodianStatus,
        swarmDailyCostUsd,
      });
    } catch (err) {
      deps.metrics.errors++;
      deps.logger.error('GET /context/overview failed', { err });
      return reply.status(500).send({ error: 'context overview unavailable' });
    }
  });

  fastify.get('/context/task-ledger', async (req, reply) => {
    try {
      const query = req.query as Record<string, string>;
      const rawLimit = query.limit ? parseInt(query.limit, 10) : 50;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 50;
      const rows = contextTracker.getTaskLedger(
        query.agentId || undefined,
        query.since || undefined,
        limit,
      );
      return reply.send({ rows, count: rows.length });
    } catch (err) {
      deps.metrics.errors++;
      deps.logger.error('GET /context/task-ledger failed', { err });
      return reply.status(500).send({ error: 'task ledger unavailable' });
    }
  });
};
