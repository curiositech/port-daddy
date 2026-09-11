/**
 * Activity Routes
 *
 * Handles activity log queries and statistics.
 * Extracted from server.js lines 1732-1804.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  canOpenConnection,
  trackConnection,
  untrackConnection,
  connectionLimits
} from '../shared/connection-tracking.js';

interface ActivityRouteDeps {
  logger: { 
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  activityLog: {
    getRecent(opts: { limit: number; type?: string; agentId?: string; targetPattern?: string }): any;
    getByTimeRange(start: number, end: number, opts: { limit: number }): unknown;
    getSummary(since: number): unknown;
    getStats(): unknown;
    subscribe(callback: (entry: any) => void): () => void;
    clear(): void;
  };
  sessions: any;
  correlationEngine: {
    getTimeline(options: { limit?: number; agentId?: string; sessionId?: string }): Promise<any[]>;
  };
}

/**
 * Create activity routes
 *
 * @param deps - Dependencies
 * @returns Express router
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const activityPlugin: FastifyPluginAsync<{ deps: ActivityRouteDeps }> = async (fastify, opts) => {
  const { logger, metrics, activityLog, correlationEngine } = opts.deps;

  // DELETE /activity - Clear activity log
  fastify.delete('/activity', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      activityLog.clear();
      return { success: true, message: 'Activity log cleared' };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /activity/timeline - Get unified timeline
  fastify.get('/activity/timeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { limit, agent, session } = request.query as any;
      const parsedLimit = limit === undefined ? 50 : typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : NaN;
      if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
        return reply.code(400).send({ success: false, code: 'VALIDATION_ERROR', error: 'timeline limit must be an integer from 1 to 1000' });
      }
      const result = await correlationEngine.getTimeline({
        limit: parsedLimit,
        agentId: agent as string | undefined,
        sessionId: session as string | undefined
      });
      return result;
    } catch (error) {
      if ((error as { code?: string })?.code === 'TIMELINE_SOURCE_UNAVAILABLE') {
        metrics.errors++;
        return reply.code(503).send({ success: false, code: 'TIMELINE_SOURCE_UNAVAILABLE', error: 'one or more timeline sources are unavailable' });
      }
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /activity/subscribe - Subscribe to activity log (SSE)
  fastify.get('/activity/subscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp: string = request.ip || 'unknown';

    try {
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

      const unsubscribe = activityLog.subscribe((entry: any) => {
        raw.write(`data: ${JSON.stringify(entry)}\n\n`);
      });

      raw.write('event: connected\ndata: {"status":"streaming"}\n\n');

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
        logger.info('activity_sse_disconnected', { ip: clientIp });
      });

      logger.info('activity_sse_connected', { ip: clientIp });
    } catch (error) {
      metrics.errors++;
      logger.error('activity_subscribe_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /activity - Get recent activity
  fastify.get('/activity', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { limit, type, agent, target } = request.query as any;

      return activityLog.getRecent({
        limit: limit ? parseInt(limit as string, 10) : 100,
        type: type as string | undefined,
        agentId: agent as string | undefined,
        targetPattern: target as string | undefined
      });
    } catch (error) {
      metrics.errors++;
      logger.error('get_activity_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /activity/range - Get activity by time range
  fastify.get('/activity/range', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { start, end, limit } = request.query as any;

      if (!start) {
        reply.code(400);
        return { error: 'start timestamp required' };
      }

      const startTime = parseInt(start as string, 10);
      const endTime = end ? parseInt(end as string, 10) : Date.now();

      return activityLog.getByTimeRange(startTime, endTime, {
        limit: limit ? parseInt(limit as string, 10) : 1000
      });
    } catch (error) {
      metrics.errors++;
      logger.error('get_activity_range_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /activity/summary - Get activity summary
  fastify.get('/activity/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { since } = request.query as any;
      const sinceTimestamp = since ? parseInt(since as string, 10) : 0;

      return activityLog.getSummary(sinceTimestamp);
    } catch (error) {
      metrics.errors++;
      logger.error('get_activity_summary_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /activity/stats - Get activity log stats
  fastify.get('/activity/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return activityLog.getStats();
    } catch (error) {
      metrics.errors++;
      logger.error('get_activity_stats_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
