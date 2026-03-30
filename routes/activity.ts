/**
 * Activity Routes
 *
 * Handles activity log queries and statistics.
 * Extracted from server.js lines 1732-1804.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
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
export function createActivityRoutes(deps: ActivityRouteDeps): Router {
  const { logger, metrics, activityLog, correlationEngine } = deps;
  const router = Router();

  // =========================================================================
  // DELETE /activity - Clear activity log
  // =========================================================================
  router.delete('/activity', (req: Request, res: Response) => {
    try {
      activityLog.clear();
      res.json({ success: true, message: 'Activity log cleared' });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /activity/timeline - Get unified timeline (activity + notes)
  // =========================================================================
  router.get('/activity/timeline', async (req: Request, res: Response) => {
    try {
      const { limit, agent, session } = req.query;
      const result = await correlationEngine.getTimeline({
        limit: limit ? parseInt(limit as string, 10) : 50,
        agentId: agent as string | undefined,
        sessionId: session as string | undefined
      });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /activity/subscribe - Subscribe to activity log (SSE)
  // =========================================================================
  router.get('/activity/subscribe', (req: Request, res: Response) => {
    const clientIp: string = req.ip || 'unknown';

    try {
      // Security: Check connection limits
      if (!canOpenConnection(clientIp, 'sse')) {
        return res.status(429).json({ error: 'too many concurrent SSE connections' });
      }

      // Track connection
      trackConnection(clientIp, 'sse', res);

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Subscribe to activity
      const unsubscribe = activityLog.subscribe((entry: any) => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      });

      // Send initial ping
      res.write('event: connected\ndata: {"status":"streaming"}\n\n');

      // Heartbeat
      const heartbeat = setInterval(() => {
        res.write(':heartbeat\n\n');
      }, 30000);

      // Security: Connection timeout
      const connectionTimeout = setTimeout(() => {
        clearInterval(heartbeat);
        unsubscribe();
        untrackConnection(clientIp, 'sse', res);
        res.write('event: timeout\ndata: {"reason":"connection timeout"}\n\n');
        res.end();
      }, connectionLimits.sseTimeout);

      // Cleanup on disconnect
      req.on('close', () => {
        clearInterval(heartbeat);
        clearTimeout(connectionTimeout);
        unsubscribe();
        untrackConnection(clientIp, 'sse', res);
        logger.info('activity_sse_disconnected', { ip: clientIp });
      });

      logger.info('activity_sse_connected', { ip: clientIp });

    } catch (error) {
      metrics.errors++;
      logger.error('activity_subscribe_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /activity - Get recent activity
  // =========================================================================
  router.get('/activity', (req: Request, res: Response) => {
    try {
      const { limit, type, agent, target } = req.query;

      const result = activityLog.getRecent({
        limit: limit ? parseInt(limit as string, 10) : 100,
        type: type as string | undefined,
        agentId: agent as string | undefined,
        targetPattern: target as string | undefined
      });

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('get_activity_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /activity/range - Get activity by time range
  // =========================================================================
  router.get('/activity/range', (req: Request, res: Response) => {
    try {
      const { start, end, limit } = req.query;

      if (!start) {
        return res.status(400).json({ error: 'start timestamp required' });
      }

      const startTime = parseInt(start as string, 10);
      const endTime = end ? parseInt(end as string, 10) : Date.now();

      const result = activityLog.getByTimeRange(startTime, endTime, {
        limit: limit ? parseInt(limit as string, 10) : 1000
      });

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('get_activity_range_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /activity/summary - Get activity summary
  // =========================================================================
  router.get('/activity/summary', (req: Request, res: Response) => {
    try {
      const { since } = req.query;
      const sinceTimestamp = since ? parseInt(since as string, 10) : 0;

      const result = activityLog.getSummary(sinceTimestamp);
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('get_activity_summary_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /activity/stats - Get activity log stats
  // =========================================================================
  router.get('/activity/stats', (_req: Request, res: Response) => {
    try {
      const result = activityLog.getStats();
      res.json(result);
    } catch (error) {
      metrics.errors++;
      logger.error('get_activity_stats_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}

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
      const result = await correlationEngine.getTimeline({
        limit: limit ? parseInt(limit as string, 10) : 50,
        agentId: agent as string | undefined,
        sessionId: session as string | undefined
      });
      return result;
    } catch (error) {
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
        reply.code(429);
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
