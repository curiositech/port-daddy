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
