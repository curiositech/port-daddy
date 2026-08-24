/**
 * Messaging Routes
 *
 * Handles pub/sub messaging for agent coordination.
 * Includes SSE subscriptions and long-polling.
 * Extracted from server.js lines 1061-1274.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateChannel } from '../shared/validators.js';
import {
  checkAdversarialProjectWrite,
  projectForChannel,
} from '../lib/coordination-route-guard.js';
import {
  canOpenConnection,
  trackConnection,
  untrackConnection,
  connectionLimits
} from '../shared/connection-tracking.js';
import { decodeMessage, type RawDaemonMessage } from '../lib/tube.js';
import {
  buildLineage,
  summarizeThread,
  renderLineageTree,
} from '../lib/discourse-lineage.js';
import {
  buildConversationalDiagnosticSignal,
  CONFLICT_SIGNAL_PRODUCERS,
  shouldConvene,
} from '../lib/parley-trigger.js';
import {
  authorizeCanonicalInboxOwner,
  type InboxActorSouls,
  type LiveInboxResolver,
} from '../lib/inbox-http-boundary.js';

interface MessagingRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number; messages_published: number };
  messaging: {
    listChannels(): unknown;
    publish(channel: string, payload: unknown, opts: { sender?: string; expires?: unknown }): Record<string, unknown>;
    getMessages(channel: string, opts: { limit: number; after: number | null }): unknown;
    poll(channel: string, afterId: number): Record<string, unknown>;
    subscribe(channel: string, callback: (message: unknown) => void): (() => void) | null;
    clear(channel: string): unknown;
    discoverChannels(opts: { projectDir?: string; query?: string; includeObserved?: boolean }): Record<string, unknown>;
    ensureChannel(name: string, opts: {
      aliases?: string[];
      description?: string | null;
      scope?: string | null;
      projectDir?: string | null;
      metadata?: Record<string, unknown> | null;
    }): Record<string, unknown>;
    resolveChannel(name: string, opts: { projectDir?: string | null }): Record<string, unknown>;
  };
  actorSouls?: InboxActorSouls | null;
  agents?: LiveInboxResolver | null;
}

/**
 * Create messaging routes
 *
 * @param deps - Dependencies
 * @returns Express router
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const messagingPlugin: FastifyPluginAsync<{ deps: MessagingRouteDeps }> = async (fastify, opts) => {
  const { logger, metrics, messaging } = opts.deps;

  // Inbox channels are a derived live-delivery transport for the durable inbox,
  // not a second authority surface. Generic publish/clear is retired; every
  // backlog, poll, lineage, and SSE read requires the exact live canonical
  // owner credential. This hook covers every /msg/:channel route uniformly so
  // a newly added read shape cannot silently bypass the owner boundary.
  fastify.addHook('preHandler', async (request, reply) => {
    const channel = (request.params as { channel?: unknown } | null)?.channel;
    if (typeof channel !== 'string' || !channel.startsWith('inbox:')) return;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send({
        success: false,
        error: 'generic inbox channel mutation is retired; use the canonical inbox ingress',
        code: 'INBOX_CHANNEL_MUTATION_RETIRED',
      });
    }

    const actorId = channel.slice('inbox:'.length);
    const owner = authorizeCanonicalInboxOwner({
      souls: opts.deps.actorSouls,
      resolver: opts.deps.agents,
      headers: request.headers as Record<string, unknown>,
      requestedActorId: actorId,
      route: `${request.method} /msg/inbox:actor`,
      logger: {
        info: (message, meta) => logger.info(message, meta),
        error: (message, meta) => {
          if (logger.error) logger.error(message, meta);
          else logger.info(message, meta);
        },
      },
    });
    if (!owner.ok) {
      return reply.code(owner.httpStatus).send({
        success: false,
        error: owner.error,
        code: owner.code,
      });
    }
  });

  // Bearer token required when PD_WEBHOOK_FORWARD_TOKEN is set.
  // The Cloudflare Worker sets Authorization: Bearer <token> on every forward;
  // any POST to /msg that is missing or has a wrong token is rejected 401.
  // Read from env per-request so the daemon can be reconfigured without restart.
  function isValidForwardToken(authHeader: string | undefined): boolean {
    const configured = (process.env.PD_WEBHOOK_FORWARD_TOKEN || '').trim();
    if (!configured) return true; // token not configured → open (opt-in hardening)
    if (!authHeader) return false;
    // Case-insensitive scheme, collapse multiple spaces, handle leading/trailing whitespace
    const parts = authHeader.trim().split(/\s+/);
    const scheme = parts[0];
    const token = parts[1];
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return false;
    // constant-time compare: walk both strings regardless of mismatch position
    const a = configured;
    const b = token;
    const len = Math.max(a.length, b.length);
    let mismatch = a.length === b.length ? 0 : 1;
    for (let i = 0; i < len; i++) {
      mismatch |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
    }
    return mismatch === 0;
  }

  function parseTruthyFlag(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  function parseAliases(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  // GET /msg - List all channels
  fastify.get('/msg', async (_request: FastifyRequest, _reply: FastifyReply) => {
    try {
      return messaging.listChannels();
    } catch (err) {
      console.error('List channels error:', err);
      _reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /msg/:channel - Publish message
  fastify.post('/msg/:channel', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!isValidForwardToken(request.headers.authorization)) {
        reply.code(401);
        return { error: 'unauthorized' };
      }

      const channelValidation = validateChannel((request.params as any).channel);
      if (!channelValidation.valid) {
        reply.code(400);
        return { error: channelValidation.error };
      }

      const { payload, content, message, sender, expires } = request.body as any;
      const plaintextPayload = payload ?? content ?? message;

      // Adversarial-fleet channels (redteam:*, defense:*) require
      // envelope-encrypted bodies. Ordinary channels are unaffected.
      // For adversarial writes, the daemon publishes the envelope JSON,
      // not any plaintext field — and the guard rejects requests that
      // attach plaintext alongside an envelope (smuggle vector).
      const channel = (request.params as any).channel as string;
      const inferred = projectForChannel(channel);
      let publishPayload: unknown = plaintextPayload;
      if (inferred) {
        const guard = checkAdversarialProjectWrite(inferred, request.body);
        if (guard.ok === false) {
          reply.code(guard.code);
          return {
            error: guard.reason,
            code: 'ADVERSARIAL_PROJECT_GUARD',
          };
        }
        if (guard.envelopeRequired && guard.envelope) {
          publishPayload = JSON.stringify(guard.envelope);
        }
      }

      const result = messaging.publish(channel, publishPayload, { sender, expires });
      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      metrics.messages_published++;
      logger.info('message_published', { channel: (request.params as any).channel, id: result.id as number });

      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /msg/:channel - Get messages from channel
  fastify.get('/msg/:channel', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const channelValidation = validateChannel((request.params as any).channel);
      if (!channelValidation.valid) {
        reply.code(400);
        return { error: channelValidation.error };
      }

      const { limit, after } = request.query as any;
      const MAX_MESSAGE_LIMIT = 1000;
      const requestedLimit = limit ? parseInt(limit as string, 10) : 50;
      const safeLimit = Math.min(Math.max(1, requestedLimit), MAX_MESSAGE_LIMIT);

      return messaging.getMessages((request.params as any).channel, {
        limit: safeLimit,
        after: after ? parseInt(after as string, 10) : null
      });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /msg/:channel/lineage - Argument graph (RCP-14) over a channel's backlog.
  // Decodes the typed tube envelopes, builds the inReplyTo graph typed by
  // `relationship`, and returns a digest (zoom-out) + tree (zoom-in) so any
  // surface (CLI, MCP, pd-console) can render the same reasoning provenance.
  fastify.get('/msg/:channel/lineage', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const channelValidation = validateChannel((request.params as any).channel);
      if (!channelValidation.valid) {
        reply.code(400);
        return { error: channelValidation.error };
      }

      const { limit, conversationId, parleyCost, wastePerContradiction } = request.query as any;
      const MAX_MESSAGE_LIMIT = 2000;
      const requestedLimit = limit ? parseInt(limit as string, 10) : MAX_MESSAGE_LIMIT;
      const safeLimit = Math.min(Math.max(1, requestedLimit), MAX_MESSAGE_LIMIT);
      // ADR-0111/ADR-0129 diagnostic economics. Query values affect only this
      // read-only lineage evaluation; automatic checkpoint policy is immutable.
      const costs = {
        parleyCost: Number.isFinite(parseFloat(parleyCost)) ? parseFloat(parleyCost) : 1,
        wastePerUnresolved: Number.isFinite(parseFloat(wastePerContradiction)) ? parseFloat(wastePerContradiction) : 2,
      };

      const result = messaging.getMessages((request.params as any).channel, { limit: safeLimit, after: null }) as
        { success?: boolean; messages?: Array<{ id: number; payload: unknown; contentType?: string; sender: string | null; createdAt: number }> };

      if (!result || result.success === false || !Array.isArray(result.messages)) {
        const emptyDigest = summarizeThread(buildLineage([]));
        const channel = (request.params as any).channel as string;
        const signal = buildConversationalDiagnosticSignal({
          channel,
          digest: emptyDigest,
          producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
        });
        return {
          ok: true,
          channel,
          digest: emptyDigest,
          parley: shouldConvene(signal, { mode: 'diagnostic', costs }),
          tree: '',
        };
      }

      let decoded = result.messages.map((m) => decodeMessage(m as RawDaemonMessage));
      if (typeof conversationId === 'string' && conversationId) {
        decoded = decoded.filter((m) => m.conversationId === conversationId);
      }

      const graph = buildLineage(decoded);
      const digest = summarizeThread(graph);
      const channel = (request.params as any).channel as string;
      const signal = buildConversationalDiagnosticSignal({
        channel,
        conversationId: graph.conversationId,
        digest,
        producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
      });
      return {
        ok: true,
        channel,
        ...(graph.conversationId ? { conversationId: graph.conversationId } : {}),
        digest,
        // ADR-0111/ADR-0129 diagnostic: evaluate the conversation checkpoint
        // without summoning Parley. P(fail)·waste·|unresolved| > parleyCost.
        parley: shouldConvene(signal, { mode: 'diagnostic', costs }),
        tree: renderLineageTree(graph),
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /msg/:channel/poll - Long-poll for next message
  fastify.get('/msg/:channel/poll', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp: string = request.ip || 'unknown';

    try {
      const channelValidation = validateChannel((request.params as any).channel);
      if (!channelValidation.valid) {
        reply.code(400);
        return { error: channelValidation.error };
      }

      if (!canOpenConnection(clientIp, 'longPoll')) {
        reply.code(429);
        return { error: 'too many concurrent connections' };
      }

      const afterId: number = (request.query as any).after ? parseInt((request.query as any).after as string, 10) : 0;
      const timeout: number = Math.min(parseInt((request.query as any).timeout as string, 10) || 30000, 60000);

      const immediate = messaging.poll((request.params as any).channel, afterId);
      if (immediate.message) {
        return immediate;
      }

      // Long-poll: hijack to handle response manually
      reply.hijack();
      const raw = reply.raw;

      trackConnection(clientIp, 'longPoll');

      const startTime: number = Date.now();
      const checkInterval = setInterval(() => {
        const result = messaging.poll((request.params as any).channel, afterId);
        if (result.message || (Date.now() - startTime) >= timeout) {
          clearInterval(checkInterval);
          untrackConnection(clientIp, 'longPoll');
          raw.writeHead(200, { 'Content-Type': 'application/json' });
          raw.end(JSON.stringify(result));
        }
      }, connectionLimits.pollInterval);

      request.raw.on('close', () => {
        clearInterval(checkInterval);
        untrackConnection(clientIp, 'longPoll');
      });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /msg/:channel/subscribe - Subscribe to channel (SSE)
  fastify.get('/msg/:channel/subscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp: string = request.ip || 'unknown';

    try {
      const channelValidation = validateChannel((request.params as any).channel);
      if (!channelValidation.valid) {
        reply.code(400);
        return { error: channelValidation.error };
      }

      if (!canOpenConnection(clientIp, 'sse')) {
        reply
          .code(429)
          .header('Retry-After', '10')
          .header('Cache-Control', 'no-store');
        return { error: 'too many concurrent SSE connections' };
      }

      // Hijack the response for SSE
      reply.hijack();
      const raw = reply.raw;

      trackConnection(clientIp, 'sse', raw as any);

      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const unsubscribe = messaging.subscribe((request.params as any).channel, (message: unknown) => {
        raw.write(`data: ${JSON.stringify(message)}\n\n`);
      });

      if (!unsubscribe) {
        untrackConnection(clientIp, 'sse', raw as any);
        raw.writeHead(503, { 'Content-Type': 'application/json' });
        raw.end(JSON.stringify({ error: 'subscription limit exceeded' }));
        return;
      }

      raw.write('event: connected\ndata: {"channel":"' + (request.params as any).channel + '"}\n\n');

      const heartbeat = setInterval(() => {
        raw.write(':heartbeat\n\n');
      }, 30000);

      const connectionTimeout = setTimeout(() => {
        clearInterval(heartbeat);
        unsubscribe();
        untrackConnection(clientIp, 'sse', raw as any);
        raw.write('event: timeout\ndata: {"reason":"connection timeout"}\n\n');
        raw.end();
      }, connectionLimits.sseTimeout);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        clearTimeout(connectionTimeout);
        unsubscribe();
        untrackConnection(clientIp, 'sse', raw as any);
        logger.info('sse_disconnected', { channel: (request.params as any).channel, ip: clientIp });
      });

      logger.info('sse_connected', { channel: (request.params as any).channel, ip: clientIp });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /channels - List channels (alias)
  fastify.get('/channels/discover', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { projectDir?: string; q?: string; observed?: string };
      return messaging.discoverChannels({
        projectDir: typeof query.projectDir === 'string' ? query.projectDir : undefined,
        query: typeof query.q === 'string' ? query.q : undefined,
        includeObserved: parseTruthyFlag(query.observed),
      });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  fastify.get('/channels/resolve/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const name = (request.params as { name?: string }).name;
      const channelValidation = validateChannel(name);
      if (!channelValidation.valid) {
        reply.code(400);
        return { error: channelValidation.error };
      }

      const query = request.query as { projectDir?: string };
      const result = messaging.resolveChannel(name as string, {
        projectDir: typeof query.projectDir === 'string' ? query.projectDir : undefined,
      });

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

  fastify.post('/channels/ensure', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (request.body || {}) as {
        name?: string;
        description?: string | null;
        aliases?: string[] | string;
        scope?: string | null;
        projectDir?: string | null;
        metadata?: Record<string, unknown> | null;
      };

      const channelValidation = validateChannel(body.name);
      if (!channelValidation.valid) {
        reply.code(400);
        return { error: channelValidation.error };
      }

      if (body.scope && !['branch', 'worktree', 'repo', 'global'].includes(body.scope)) {
        reply.code(400);
        return { error: 'scope must be one of: branch, worktree, repo, global' };
      }

      const result = messaging.ensureChannel(body.name as string, {
        aliases: parseAliases(body.aliases),
        description: typeof body.description === 'string' ? body.description : null,
        scope: body.scope ?? undefined,
        projectDir: typeof body.projectDir === 'string' ? body.projectDir : null,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : null,
      });

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  fastify.get('/channels', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return messaging.listChannels();
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /msg/:channel - Clear channel
  fastify.delete('/msg/:channel', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const channelValidation = validateChannel((request.params as any).channel);
      if (!channelValidation.valid) {
        reply.code(400);
        return { error: channelValidation.error };
      }

      return messaging.clear((request.params as any).channel);
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
