/**
 * Webhooks Routes
 *
 * Webhook subscription management endpoints.
 * Provides registration, listing, updating, and testing of webhooks.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { WebhookEvent } from '../lib/webhooks.js';

interface WebhooksRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  webhooks: {
    register(url: string, opts: Record<string, unknown>): Record<string, unknown>;
    list(opts: { activeOnly: boolean }): unknown;
    get(id: string): Record<string, unknown>;
    update(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    remove(id: string): Record<string, unknown>;
    test(id: string): Promise<unknown>;
    getDeliveries(id: string, opts: { limit: number }): unknown;
  };
}

/**
 * Create webhooks routes
 *
 * @param deps - Route dependencies
 * @returns Express router with webhook routes
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const webhooksPlugin: FastifyPluginAsync<{ deps: WebhooksRouteDeps }> = async (fastify, opts) => {
  const { logger, metrics, webhooks } = opts.deps;

  // POST /webhooks - Register a webhook
  fastify.post('/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { url, events, secret, filterPattern, metadata } = request.body as any;

      if (!url) {
        reply.code(400);
        return { error: 'url required' };
      }

      const result = webhooks.register(url, { events, secret, filterPattern, metadata });

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      logger.info('webhook_registered', { id: result.id as string, url, events });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('webhook_register_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /webhooks - List webhooks
  fastify.get('/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { active } = request.query as any;
      return webhooks.list({ activeOnly: active === 'true' });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /webhooks/events - Get available webhook events
  fastify.get('/webhooks/events', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      success: true,
      events: Object.values(WebhookEvent),
      descriptions: {
        'service.claim': 'Fired when a service claims a port',
        'service.release': 'Fired when a service releases a port',
        'agent.register': 'Fired when an agent registers',
        'agent.unregister': 'Fired when an agent unregisters',
        'agent.stale': 'Fired when an agent is detected as stale',
        'lock.acquire': 'Fired when a lock is acquired',
        'lock.release': 'Fired when a lock is released',
        'message.publish': 'Fired when a message is published to a channel',
        'daemon.start': 'Fired when Port Daddy daemon starts',
        'daemon.stop': 'Fired when Port Daddy daemon stops'
      }
    };
  });

  // GET /webhooks/:id - Get webhook by ID
  fastify.get('/webhooks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = webhooks.get((request.params as any).id as string);

      if (!result.success) {
        reply.code(404);
        return { error: result.error };
      }

      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // PUT /webhooks/:id - Update webhook
  fastify.put('/webhooks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { url, events, filterPattern, active, metadata } = request.body as any;

      const result = webhooks.update((request.params as any).id as string, { url, events, filterPattern, active, metadata });

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      logger.info('webhook_updated', { id: (request.params as any).id as string });
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /webhooks/:id - Delete webhook
  fastify.delete('/webhooks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = webhooks.remove((request.params as any).id as string);

      if (!result.success) {
        reply.code(404);
        return { error: result.error };
      }

      logger.info('webhook_deleted', { id: (request.params as any).id as string });
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /webhooks/:id/test - Test a webhook
  fastify.post('/webhooks/:id/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await webhooks.test((request.params as any).id as string);
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /webhooks/:id/deliveries - Get webhook deliveries
  fastify.get('/webhooks/:id/deliveries', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { limit } = request.query as any;
      return webhooks.getDeliveries((request.params as any).id as string, {
        limit: limit ? parseInt(limit as string, 10) : 50
      });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
