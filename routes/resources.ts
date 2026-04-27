import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  createResourceGovernance,
  type ResourceGovernance,
} from '../lib/resource-governance.js';

interface ResourceRouteDeps {
  resourceGovernance?: ResourceGovernance;
  repoRoot?: string;
  STARTED_AT?: number;
  agents?: {
    list(options?: { activeOnly?: boolean }): {
      agents?: Array<{ isActive?: boolean; status?: string }>;
      count?: number;
    };
  };
  services?: {
    find(pattern?: string, options?: Record<string, unknown>): {
      success?: boolean;
      services?: Array<{ port?: number; status?: string }>;
      count?: number;
    };
  };
  fleetDaemon?: {
    getStatus(): {
      fleets?: Array<{ running?: boolean; agents?: unknown[] }>;
      totalAgents?: number;
      totalLaunchableAgents?: number;
      launchableAgents?: number;
    };
  };
  costTracker?: {
    total(opts?: { since?: number }): {
      totalUsd: number;
      spawnCount: number;
      estimatedCount: number;
    };
  };
  logger?: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

function parsePositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export const resourcesPlugin: FastifyPluginAsync<{ deps: ResourceRouteDeps }> = async (fastify, opts) => {
  const deps = opts.deps;
  const monitor = deps.resourceGovernance ?? createResourceGovernance({
    repoRoot: deps.repoRoot ?? process.cwd(),
    startedAt: deps.STARTED_AT,
  });

  fastify.get('/resources/overview', async (request: FastifyRequest, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const userCap = parsePositiveInt(query.maxConcurrentSpawns);
      const activeAgentResult = deps.agents?.list({ activeOnly: true });
      const activeAgents = activeAgentResult?.agents?.length ?? activeAgentResult?.count ?? undefined;
      const serviceResult = deps.services?.find('*', { limit: 500 });
      const activePorts = serviceResult?.services?.filter((service) => typeof service.port === 'number').length
        ?? serviceResult?.count
        ?? undefined;
      const cost = deps.costTracker?.total({ since: Date.now() - 86_400_000 });

      return monitor.overview({
        userCap,
        activeAgents,
        activePorts,
        fleetStatus: deps.fleetDaemon?.getStatus() ?? null,
        dailySpendUsd: cost?.totalUsd,
        dailySpawnCount: cost?.spawnCount,
        estimatedCostEvents: cost?.estimatedCount,
      });
    } catch (error) {
      deps.logger?.error('resource_overview_failed', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'resource overview unavailable' };
    }
  });
};
