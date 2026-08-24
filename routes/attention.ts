/**
 * Attention Routes — single-call aggregator of inbox + subscribed channels
 *
 * GET  /attention?agentId=...&peek=true&limit=50
 * POST /attention/subscribe       { agentId, channel }
 * POST /attention/unsubscribe     { agentId, channel }
 * GET  /attention/subscriptions?agentId=...
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Attention } from '../lib/attention.js';
import {
  authorizeCanonicalInboxOwner,
  type InboxActorSouls,
  type InboxBoundaryFailure,
  type LiveInboxResolver,
} from '../lib/inbox-http-boundary.js';

interface AttentionRouteDeps {
  attention: Attention;
  actorSouls?: InboxActorSouls | null;
  agents?: LiveInboxResolver | null;
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

function badRequest(reply: FastifyReply, message: string) {
  reply.code(400);
  return { success: false, error: message, code: 'VALIDATION_ERROR' };
}

function boundaryError(reply: FastifyReply, outcome: InboxBoundaryFailure) {
  reply.code(outcome.httpStatus);
  return { success: false, error: outcome.error, code: outcome.code };
}

export const attentionPlugin: FastifyPluginAsync<{ deps: AttentionRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { attention, metrics, logger } = deps;

  // GET /attention — aggregate + (by default) mark items seen
  fastify.get('/attention', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const agentId = (query.agentId || '').trim();
      if (!agentId) return badRequest(reply, 'agentId required');
      const owner = authorizeCanonicalInboxOwner({
        souls: deps.actorSouls,
        resolver: deps.agents,
        headers: request.headers as Record<string, unknown>,
        requestedActorId: agentId,
        route: 'GET /attention',
        logger,
      });
      if (!owner.ok) return boundaryError(reply, owner);

      const peek = query.peek === 'true' || query.peek === '1';
      let limit: number | undefined;
      if (query.limit !== undefined) {
        const parsed = Number.parseInt(query.limit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return badRequest(reply, 'limit must be a positive integer');
        }
        limit = parsed;
      }

      const result = attention.compose(owner.actorId, { peek, limit });
      logger.info('attention_compose', {
        agentId: owner.actorId,
        peek,
        items: result.counts.total,
        inbox: result.counts.inbox,
        channels: result.counts.channels,
      });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('attention_compose_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // POST /attention/subscribe
  fastify.post('/attention/subscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId, channel } = (request.body || {}) as Record<string, string>;
      if (!agentId) return badRequest(reply, 'agentId required');
      if (!channel) return badRequest(reply, 'channel required');
      const owner = authorizeCanonicalInboxOwner({
        souls: deps.actorSouls,
        resolver: deps.agents,
        headers: request.headers as Record<string, unknown>,
        body: request.body,
        requestedActorId: agentId,
        route: 'POST /attention/subscribe',
        logger,
      });
      if (!owner.ok) return boundaryError(reply, owner);

      const result = attention.subscribe(owner.actorId, channel);
      if (!result.success) {
        return badRequest(reply, result.error || 'subscribe failed');
      }
      logger.info('attention_subscribe', { agentId: owner.actorId, channel, newSubscription: result.subscribed });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('attention_subscribe_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // POST /attention/unsubscribe
  fastify.post('/attention/unsubscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId, channel } = (request.body || {}) as Record<string, string>;
      if (!agentId) return badRequest(reply, 'agentId required');
      if (!channel) return badRequest(reply, 'channel required');
      const owner = authorizeCanonicalInboxOwner({
        souls: deps.actorSouls,
        resolver: deps.agents,
        headers: request.headers as Record<string, unknown>,
        body: request.body,
        requestedActorId: agentId,
        route: 'POST /attention/unsubscribe',
        logger,
      });
      if (!owner.ok) return boundaryError(reply, owner);

      const result = attention.unsubscribe(owner.actorId, channel);
      if (!result.success) {
        return badRequest(reply, result.error || 'unsubscribe failed');
      }
      logger.info('attention_unsubscribe', { agentId: owner.actorId, channel, removed: result.removed });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('attention_unsubscribe_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // GET /attention/subscriptions
  fastify.get('/attention/subscriptions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const agentId = (query.agentId || '').trim();
      if (!agentId) return badRequest(reply, 'agentId required');
      const owner = authorizeCanonicalInboxOwner({
        souls: deps.actorSouls,
        resolver: deps.agents,
        headers: request.headers as Record<string, unknown>,
        requestedActorId: agentId,
        route: 'GET /attention/subscriptions',
        logger,
      });
      if (!owner.ok) return boundaryError(reply, owner);

      const channels = attention.listSubscriptions(owner.actorId);
      return { success: true, agentId: owner.actorId, channels };
    } catch (error) {
      metrics.errors++;
      logger.error('attention_subscriptions_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
