/**
 * Fleet push subscription surface — Web Push (VAPID) registration for the
 * fleet-ui PWA so approval gates reach the operator's devices.
 *
 *   GET    /fleet/push/vapid-public-key   — key the browser subscribes with
 *   GET    /fleet/push/subscriptions      — count + endpoints (observability)
 *   POST   /fleet/push/subscriptions      — register/refresh a subscription
 *   DELETE /fleet/push/subscriptions      — {endpoint} to unsubscribe
 *   POST   /fleet/push/test               — send a test push to every device
 *
 * Trust model: loopback daemon, local operator is the authority — same as
 * every fleet route. Endpoints in the GET listing are truncated: they are
 * capability URLs (anyone holding one can send pushes through the browser
 * vendor to that device).
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getSharedPushNotifier } from '../lib/fleet/push-notifications.js';

export interface FleetPushRouteDeps {
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

export const fleetPushPlugin: FastifyPluginAsync<{ deps: FleetPushRouteDeps }> = async (
  fastify,
  opts,
) => {
  const logger = opts.deps?.logger;

  fastify.get('/fleet/push/vapid-public-key', async () => {
    return { success: true, publicKey: await getSharedPushNotifier().publicKey() };
  });

  fastify.get('/fleet/push/subscriptions', async () => {
    const subs = getSharedPushNotifier().listSubscriptions();
    return {
      success: true,
      count: subs.length,
      subscriptions: subs.map((s) => ({
        endpoint: `${s.endpoint.slice(0, 48)}…`,
        addedAt: s.addedAt,
        userAgent: s.userAgent,
      })),
    };
  });

  fastify.post('/fleet/push/subscriptions', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { subscription?: { endpoint: string; keys: { p256dh: string; auth: string } } };
    try {
      getSharedPushNotifier().addSubscription(
        body?.subscription as { endpoint: string; keys: { p256dh: string; auth: string } },
        request.headers['user-agent'],
      );
    } catch (err) {
      reply.code(400);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    logger?.info('fleet_push_subscribed', { count: getSharedPushNotifier().listSubscriptions().length });
    return { success: true };
  });

  fastify.delete('/fleet/push/subscriptions', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { endpoint?: string };
    if (!body?.endpoint) {
      reply.code(400);
      return { success: false, error: 'endpoint required' };
    }
    const removed = getSharedPushNotifier().removeSubscription(body.endpoint);
    if (!removed) reply.code(404);
    return { success: removed };
  });

  fastify.post('/fleet/push/test', async () => {
    const result = await getSharedPushNotifier().sendToAll({
      title: 'Port Daddy test push',
      body: 'Push delivery for fleet approval gates is working.',
      tag: 'fleet-test',
      deepLink: '/fleet-ui/#approvals',
    });
    return { success: true, ...result };
  });
};
