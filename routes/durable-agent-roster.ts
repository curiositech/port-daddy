import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { DurableAgentRoster } from '../lib/durable-agent-roster.js';
import { DurableAgentRosterError, normalizeDurableAgentScope } from '../lib/durable-agent-roster.js';
import {
  HandoffScannerUnavailableError,
  HandoffSecretError,
  HandoffValidationError,
} from '../lib/handoff-capsule.js';
import type { EpisodicMemory, Episode } from '../lib/episodic-memory.js';

interface DurableAgentRosterRouteDeps {
  durableAgentRoster: DurableAgentRoster;
  episodicMemory: Pick<EpisodicMemory, 'get'>;
  metrics: { errors: number };
  logger: {
    info(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

function isLoopbackRequest(request: FastifyRequest): boolean {
  const address = request.ip || request.socket?.remoteAddress || '';
  return address === ''
    || address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

function loopbackGuard(logger: DurableAgentRosterRouteDeps['logger']) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (isLoopbackRequest(request)) return;
    logger.error('durable_agent_roster_mutation_blocked', { remoteAddress: request.ip });
    await reply.code(403).send({ success: false, error: 'durable roster mutations are loopback-only', code: 'LOOPBACK_ONLY' });
  };
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new DurableAgentRosterError(`${field} must be a positive integer`, 'INVALID_REQUEST', 400);
  }
  return parsed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function episodeCapsule(episode: Episode): Record<string, unknown> | null {
  const capsule = episode.metadata?.capsule;
  return capsule && typeof capsule === 'object' && !Array.isArray(capsule)
    ? capsule as Record<string, unknown>
    : null;
}

function capsuleRecord(capsule: Record<string, unknown> | null, field: string): Record<string, unknown> | null {
  const value = capsule?.[field];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireHandoffEpisode(
  episodicMemory: Pick<EpisodicMemory, 'get'>,
  episodeId: number,
): { episode: Episode; capsule: Record<string, unknown> } {
  const episode = episodicMemory.get(episodeId);
  if (!episode || episode.episodeType !== 'handoff' || episode.sourceType !== 'handoff-capsule') {
    throw new DurableAgentRosterError('handoff episode not found', 'HANDOFF_EPISODE_NOT_FOUND', 404);
  }
  const capsule = episodeCapsule(episode);
  if (!capsule) {
    throw new DurableAgentRosterError('handoff episode has no sanitized capsule', 'HANDOFF_CAPSULE_MISSING', 409);
  }
  return { episode, capsule };
}

function routeError(
  error: unknown,
  reply: FastifyReply,
  deps: DurableAgentRosterRouteDeps,
): Record<string, unknown> {
  if (error instanceof DurableAgentRosterError) {
    reply.code(error.statusCode);
    return { success: false, error: error.message, code: error.code };
  }
  if (error instanceof HandoffValidationError) {
    reply.code(400);
    return { success: false, error: error.message, code: 'INVALID_PROFILE' };
  }
  if (error instanceof HandoffSecretError) {
    reply.code(422);
    return { success: false, error: 'durable agent profile quarantined by secret scanning', code: 'PROFILE_QUARANTINED' };
  }
  if (error instanceof HandoffScannerUnavailableError) {
    reply.code(503);
    return { success: false, error: error.message, code: 'SCANNER_UNAVAILABLE', failClosed: true };
  }
  deps.metrics.errors += 1;
  deps.logger.error('durable_agent_roster_error', { errorType: error instanceof Error ? error.name : 'unknown' });
  reply.code(500);
  return { success: false, error: 'internal server error', code: 'INTERNAL_ERROR' };
}

export const durableAgentRosterPlugin: FastifyPluginAsync<{ deps: DurableAgentRosterRouteDeps }> = async (fastify, opts) => {
  const deps = opts.deps;
  const guard = loopbackGuard(deps.logger);

  fastify.get('/durable-agents', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const agents = deps.durableAgentRoster.list({
        scopeKey: stringValue(query.scopeKey),
        repoRoot: stringValue(query.repoRoot),
        includeRetired: query.includeRetired === 'true' || query.includeRetired === true,
        limit: query.limit === undefined ? undefined : positiveInteger(query.limit, 'limit'),
      });
      return { success: true, agents, count: agents.length };
    } catch (error) {
      return routeError(error, reply, deps);
    }
  });

  fastify.get('/durable-agents/search', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const result = await deps.durableAgentRoster.search(stringValue(query.q) ?? '', {
        scopeKey: stringValue(query.scopeKey),
        repoRoot: stringValue(query.repoRoot),
        includeRetired: query.includeRetired === 'true' || query.includeRetired === true,
        limit: query.limit === undefined ? undefined : positiveInteger(query.limit, 'limit'),
      });
      return { success: true, ...result };
    } catch (error) {
      return routeError(error, reply, deps);
    }
  });

  fastify.get('/durable-agents/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return {
        success: true,
        agent: deps.durableAgentRoster.get(id),
        revisions: deps.durableAgentRoster.history(id),
      };
    } catch (error) {
      return routeError(error, reply, deps);
    }
  });

  fastify.post('/durable-agents', { preHandler: guard, bodyLimit: 768 * 1024 }, async (request, reply) => {
    try {
      const result = await deps.durableAgentRoster.create((request.body ?? {}) as any);
      deps.logger.info('durable_agent_created', { agentNodeId: result.agent.agentNodeId, slug: result.agent.profile.slug });
      reply.code(201);
      return { success: true, ...result };
    } catch (error) {
      return routeError(error, reply, deps);
    }
  });

  fastify.post('/durable-agents/promote', { preHandler: guard, bodyLimit: 768 * 1024 }, async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const sourceSessionId = stringValue(body.sourceSessionId);
      if (!sourceSessionId) {
        throw new DurableAgentRosterError('sourceSessionId is required', 'INCOMPLETE_PROMOTION_LINEAGE', 400);
      }
      const handoffEpisodeId = positiveInteger(body.handoffEpisodeId, 'handoffEpisodeId');
      const { capsule } = requireHandoffEpisode(deps.episodicMemory, handoffEpisodeId);
      const source = capsuleRecord(capsule, 'source');
      const workspace = capsuleRecord(capsule, 'workspace');
      if (source?.sessionId !== sourceSessionId) {
        throw new DurableAgentRosterError(
          'handoff episode does not belong to the source session',
          'PROMOTION_LINEAGE_MISMATCH',
          409,
        );
      }
      const requestedScope = body.scope;
      if (
        requestedScope
        && typeof requestedScope === 'object'
        && !Array.isArray(requestedScope)
        && (requestedScope as Record<string, unknown>).kind === 'repo'
      ) {
        const sourceRepoRoot = stringValue(workspace?.repoRoot);
        if (!sourceRepoRoot) {
          throw new DurableAgentRosterError(
            'repo-scoped promotion requires a handoff with verified repository provenance',
            'PROMOTION_SCOPE_MISMATCH',
            409,
          );
        }
        const sourceScope = normalizeDurableAgentScope({ kind: 'repo', repoRoot: sourceRepoRoot });
        const targetScope = normalizeDurableAgentScope(requestedScope as { kind: 'repo'; repoRoot?: string | null });
        if (sourceScope.key !== targetScope.key) {
          throw new DurableAgentRosterError(
            'repo-scoped durable agent must match the promoted session repository',
            'PROMOTION_SCOPE_MISMATCH',
            409,
          );
        }
      }
      const createInput = {
        ...body,
        origin: {
          kind: 'session-promotion' as const,
          sourceSessionId,
          handoffEpisodeId,
          sourceAgentId: stringValue(source.agentId) ?? null,
          sourceAdapter: stringValue(source.adapter) ?? null,
        },
      };
      delete (createInput as Record<string, unknown>).sourceSessionId;
      delete (createInput as Record<string, unknown>).handoffEpisodeId;
      const result = await deps.durableAgentRoster.create(createInput as any, { verifiedPromotion: true });
      deps.logger.info('durable_agent_promoted', {
        agentNodeId: result.agent.agentNodeId,
        sourceSessionId,
        handoffEpisodeId,
      });
      reply.code(201);
      return { success: true, ...result };
    } catch (error) {
      return routeError(error, reply, deps);
    }
  });

  fastify.patch('/durable-agents/:id', { preHandler: guard, bodyLimit: 768 * 1024 }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await deps.durableAgentRoster.update(id, (request.body ?? {}) as any);
      return { success: true, ...result };
    } catch (error) {
      return routeError(error, reply, deps);
    }
  });

  fastify.post('/durable-agents/:id/handoffs', { preHandler: guard }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const episodeId = positiveInteger(body.episodeId, 'episodeId');
      const { capsule } = requireHandoffEpisode(deps.episodicMemory, episodeId);
      const source = capsuleRecord(capsule, 'source');
      const target = capsuleRecord(capsule, 'target');
      const sourceAgentId = stringValue(source?.agentId);
      const targetAgentId = stringValue(target?.agentId);
      if (sourceAgentId !== id && targetAgentId !== id) {
        throw new DurableAgentRosterError(
          'handoff capsule is not bound to this durable agent identity',
          'HANDOFF_IDENTITY_MISMATCH',
          409,
        );
      }
      const agent = await deps.durableAgentRoster.attachHandoffEpisode(id, episodeId);
      reply.code(201);
      return { success: true, agent };
    } catch (error) {
      return routeError(error, reply, deps);
    }
  });

  fastify.post('/durable-agents/:id/retire', { preHandler: guard }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await deps.durableAgentRoster.retire(id);
      return { success: true, ...result };
    } catch (error) {
      return routeError(error, reply, deps);
    }
  });
};
