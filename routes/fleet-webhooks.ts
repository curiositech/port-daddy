/**
 * Fleet webhook receiver route — the inbound HTTP surface for
 * `webhook:<channel>` fleet triggers (I/O wiring Phase 2).
 *
 * POST /webhooks/fleet/:channel
 *   Delivers the request to the channel's registered trigger handler via the
 *   shared FleetWebhookReceiver. The handler (WebhookTriggerSource) performs
 *   HMAC verification when the spec declares `secret:VAR`, then emits a
 *   FleetTriggerEvent that the engine's ADR-0093 trust gate classifies as
 *   ANONYMOUS_EXTERNAL — so an inbound POST can never directly spawn an
 *   agent holding tools beyond the anonymous safe set, and always requires
 *   operator approval.
 *
 * GET /webhooks/fleet
 *   Lists currently armed channels (operator observability; feeds the
 *   `pd fleet sources` health board).
 *
 * Deliberately NOT here: authentication of the poster (that is the per-
 * channel HMAC + the trust gate), queuing (L2 lives behind the gate), and
 * any per-channel configuration (the fleet yml owns that).
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getSharedWebhookReceiver,
  type ReceivedWebhookRequest,
} from '../lib/fleet/webhook-receiver.js';

interface RawBodyRequest extends FastifyRequest {
  /** The EXACT bytes received — HMAC must verify over these, so this stays
   *  a Buffer end-to-end (a UTF-8 string round-trip is lossy for non-UTF8
   *  bodies and would break signatures). */
  rawBody?: Buffer;
}

export interface FleetWebhooksRouteDeps {
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

export const fleetWebhooksPlugin: FastifyPluginAsync<{ deps: FleetWebhooksRouteDeps }> = async (
  fastify,
  opts,
) => {
  const logger = opts.deps?.logger;

  // Capture raw bytes (encapsulated to this plugin) so per-channel HMAC
  // verification hashes exactly what the sender signed, while handlers still
  // see parsed JSON. Non-JSON content types arrive as the raw string.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req: RawBodyRequest, body, done) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    req.rawBody = buf;
    if (buf.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(buf.toString('utf8')));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (req: RawBodyRequest, body, done) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    req.rawBody = buf;
    // Handlers see a string VIEW as the parsed body; the signature source
    // of truth stays the untouched Buffer above.
    done(null, buf.toString('utf8'));
  });

  // POST /webhooks/fleet/:channel — inbound event for a fleet webhook trigger
  fastify.post('/webhooks/fleet/:channel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { channel } = request.params as { channel: string };
    const raw = (request as RawBodyRequest).rawBody ?? Buffer.alloc(0);

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers[name.toLowerCase()] = value;
      else if (Array.isArray(value)) headers[name.toLowerCase()] = value.join(', ');
    }

    const received: ReceivedWebhookRequest = {
      headers,
      body: request.body,
      rawBody: raw, // the exact bytes — never re-encoded
      ip: request.ip,
    };

    const result = await getSharedWebhookReceiver().deliver(channel, received);
    logger?.info('fleet_webhook_delivered', {
      channel,
      status: result.status,
      bytes: received.rawBody.length,
    });
    reply.code(result.status);
    return result.body ?? {};
  });

  // GET /webhooks/fleet — armed channels (observability / health board)
  fastify.get('/webhooks/fleet', async () => {
    return { channels: getSharedWebhookReceiver().channels() };
  });
};
