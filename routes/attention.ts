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

interface AttentionRouteDeps {
  attention: Attention;
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

export const attentionPlugin: FastifyPluginAsync<{ deps: AttentionRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { attention, metrics, logger } = deps;

  // GET /attention — aggregate + (by default) mark items seen
  fastify.get('/attention', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const agentId = (query.agentId || '').trim();
      if (!agentId) return badRequest(reply, 'agentId required');

      const peek = query.peek === 'true' || query.peek === '1';
      let limit: number | undefined;
      if (query.limit !== undefined) {
        const parsed = Number.parseInt(query.limit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return badRequest(reply, 'limit must be a positive integer');
        }
        limit = parsed;
      }

      const result = attention.compose(agentId, { peek, limit });
      logger.info('attention_compose', {
        agentId,
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

      const result = attention.subscribe(agentId, channel);
      if (!result.success) {
        return badRequest(reply, result.error || 'subscribe failed');
      }
      logger.info('attention_subscribe', { agentId, channel, newSubscription: result.subscribed });
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

      const result = attention.unsubscribe(agentId, channel);
      if (!result.success) {
        return badRequest(reply, result.error || 'unsubscribe failed');
      }
      logger.info('attention_unsubscribe', { agentId, channel, removed: result.removed });
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

      const channels = attention.listSubscriptions(agentId);
      return { success: true, agentId, channels };
    } catch (error) {
      metrics.errors++;
      logger.error('attention_subscriptions_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
