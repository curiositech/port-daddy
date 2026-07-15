import type { FastifyPluginAsync } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { EpisodicMemory } from '../lib/episodic-memory.js';
import {
  HandoffBudgetError,
  HandoffScannerUnavailableError,
  HandoffSecretError,
  HandoffValidationError,
  sanitizeHandoffCapsule,
  type GitleaksRunner,
  type HandoffCapsuleV0,
} from '../lib/handoff-capsule.js';
import { harvestSession, type HarvestResult } from '../lib/session-harvest.js';

interface MemoryRouteDeps {
  episodicMemory: EpisodicMemory;
  db?: Database;
  blobs?: {
    store(content: string, opts: { mimeType?: string; agentId?: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
  };
  gitleaksRunner?: GitleaksRunner;
  harvestSessionFn?: typeof harvestSession;
  metrics: { errors: number };
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

interface HandoffRequestBody {
  capsule?: unknown;
  tokenBudget?: number;
  coordinationSessionId?: string;
}

class HandoffHarvestUnavailableError extends Error {
  constructor() {
    super('session harvest dependency unavailable');
    this.name = 'HandoffHarvestUnavailableError';
  }
}

function handoffTitle(capsule: HandoffCapsuleV0): string {
  const firstLine = capsule.telos.split('\n')[0]?.trim() || capsule.source.sessionId;
  return `Handoff: ${firstLine}`.slice(0, 200);
}

function handoffSummary(capsule: HandoffCapsuleV0): string {
  const lines = [
    capsule.telos,
    ...capsule.operatorTurns.map((turn) => `Operator: ${turn.text}`),
    ...capsule.decisions.map((decision) => `Decision (${decision.source}): ${decision.text}`),
    ...capsule.coordination.map((item) => `${item.kind.toUpperCase()}: ${item.text}`),
  ];
  return lines.join('\n\n');
}

export const memoryPlugin: FastifyPluginAsync<{ deps: MemoryRouteDeps }> = async (fastify, opts) => {
  const { episodicMemory, metrics, logger } = opts.deps;

  fastify.post('/memory/handoffs', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const body = (request.body as HandoffRequestBody | undefined) ?? {};
    try {
      const capsule = sanitizeHandoffCapsule(body.capsule, {
        tokenBudget: body.tokenBudget,
        gitleaksRunner: opts.deps.gitleaksRunner,
      });

      let harvest: HarvestResult | null = null;
      if (body.coordinationSessionId !== undefined) {
        if (typeof body.coordinationSessionId !== 'string' || body.coordinationSessionId.trim().length === 0) {
          throw new HandoffValidationError('coordinationSessionId must be a non-empty string');
        }
        if (!opts.deps.db) {
          throw new HandoffHarvestUnavailableError();
        }
        harvest = await (opts.deps.harvestSessionFn ?? harvestSession)(
          body.coordinationSessionId,
          opts.deps.db,
          {
            episodicMemory,
            blobs: opts.deps.blobs,
          },
        );
      }

      const sourceAgent = capsule.source.agentId ?? capsule.source.adapter;
      const episode = episodicMemory.remember({
        projectDir: capsule.identity.projectDir ?? capsule.workspace.repoRoot ?? capsule.workspace.cwd,
        project: capsule.identity.project,
        harbor: capsule.identity.harbor,
        agentId: capsule.source.agentId,
        episodeType: 'handoff',
        title: handoffTitle(capsule),
        summary: handoffSummary(capsule),
        sourceType: 'handoff-capsule',
        sourceId: `${sourceAgent}:${capsule.source.sessionId}`,
        worktreeId: capsule.workspace.worktreeId,
        branchName: capsule.workspace.branch,
        metadata: {
          capsule,
          coordinationSessionId: body.coordinationSessionId ?? null,
        },
      });

      reply.code(201);
      return {
        success: true,
        capsule,
        episode,
        harvest: harvest
          ? { attempted: true, ...harvest }
          : { attempted: false, reason: 'no coordinationSessionId' },
      };
    } catch (error) {
      if (error instanceof HandoffValidationError) {
        reply.code(400);
        return { success: false, error: error.message };
      }
      if (error instanceof HandoffBudgetError) {
        reply.code(413);
        return {
          success: false,
          error: 'handoff capsule exceeds token budget without dropping operator context',
          requestedTokens: error.requestedTokens,
          minimumRequiredTokens: error.minimumRequiredTokens,
        };
      }
      if (error instanceof HandoffSecretError) {
        reply.code(422);
        return {
          success: false,
          error: 'handoff capsule quarantined by secret scanning',
          findingCount: error.findingCount,
        };
      }
      if (error instanceof HandoffScannerUnavailableError) {
        metrics.errors++;
        logger.error('memory_handoff_scanner_unavailable', { errorType: error.name });
        reply.code(503);
        return {
          success: false,
          error: error.message,
          failClosed: true,
        };
      }
      if (error instanceof HandoffHarvestUnavailableError) {
        metrics.errors++;
        logger.error('memory_handoff_harvest_unavailable', { errorType: error.name });
        reply.code(503);
        return { success: false, error: error.message };
      }
      metrics.errors++;
      logger.error('memory_handoff_error', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/memory/episodes', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      const episodes = episodicMemory.list({
        projectDir: query.projectDir,
        project: query.project,
        harbor: query.harbor,
        agentId: query.agentId,
        episodeType: query.episodeType,
        query: query.query || query.q,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
      return { success: true, episodes, count: episodes.length };
    } catch (error) {
      metrics.errors++;
      logger.error('memory_episodes_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/memory/stats', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      return {
        success: true,
        ...episodicMemory.stats(query.projectDir, query.project),
      };
    } catch (error) {
      metrics.errors++;
      logger.error('memory_stats_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
