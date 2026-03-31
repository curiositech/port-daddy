/**
 * Fleet Routes — Always-On Fleet Management
 *
 * GET    /fleet            — Aggregated fleet status across all projects
 * GET    /fleet/:project   — Specific project's fleet status
 * POST   /fleet/start      — Start all fleets (or specific project via body)
 * POST   /fleet/stop       — Stop all fleets (or specific project via body)
 * POST   /fleet/reload     — Re-read all configs and restart changed fleets
 * POST   /fleet/register   — Register a project directory for fleet management
 * GET    /fleet/events     — SSE stream of all fleet lifecycle events
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { createFleetDaemon } from '../lib/fleet-daemon.js';
import {
  canOpenConnection,
  trackConnection,
  untrackConnection,
} from '../shared/connection-tracking.js';

interface FleetRouteDeps {
  fleetDaemon: ReturnType<typeof createFleetDaemon>;
  messaging: {
    subscribe(channel: string, callback: (msg: unknown) => void): (() => void) | null;
  };
}

export const fleetPlugin: FastifyPluginAsync<{ deps: FleetRouteDeps }> = async (fastify, opts) => {
  const { fleetDaemon, messaging } = opts.deps;

  // GET /fleet — Aggregated status
  fastify.get('/fleet', async () => {
    const status = fleetDaemon.getStatus();
    return { success: true, ...status };
  });

  // GET /fleet/:project — Specific project status
  fastify.get('/fleet/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    const { project } = request.params as { project: string };
    const status = fleetDaemon.getStatus();
    const fleet = status.fleets.find(f => f.project === project);
    if (!fleet) {
      reply.code(404);
      return { success: false, error: `No fleet running for project: ${project}` };
    }
    return { success: true, fleet };
  });

  // POST /fleet/start — Start fleets
  fastify.post('/fleet/start', async (request: FastifyRequest) => {
    const { projectDir } = (request.body as { projectDir?: string }) || {};

    if (projectDir) {
      const result = fleetDaemon.startProject(projectDir);
      return { success: result.success, error: result.error };
    }

    fleetDaemon.start();
    const status = fleetDaemon.getStatus();
    return {
      success: true,
      message: `Fleet daemon started with ${status.fleets.length} project(s)`,
      fleets: status.fleets.map(f => f.project),
    };
  });

  // POST /fleet/stop — Stop fleets
  fastify.post('/fleet/stop', async (request: FastifyRequest) => {
    const { projectDir } = (request.body as { projectDir?: string }) || {};

    if (projectDir) {
      const result = fleetDaemon.stopProject(projectDir);
      return { success: result.success, error: result.error };
    }

    fleetDaemon.stop();
    return { success: true, message: 'All fleets stopped' };
  });

  // POST /fleet/reload — Re-read configs and restart
  fastify.post('/fleet/reload', async () => {
    fleetDaemon.reload();
    const status = fleetDaemon.getStatus();
    return {
      success: true,
      message: `Fleet daemon reloaded with ${status.fleets.length} project(s)`,
      fleets: status.fleets.map(f => f.project),
    };
  });

  // POST /fleet/register — Register a project for fleet management
  fastify.post('/fleet/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectDir } = (request.body as { projectDir?: string }) || {};
    if (!projectDir || typeof projectDir !== 'string') {
      reply.code(400);
      return { success: false, error: 'projectDir is required' };
    }

    const result = fleetDaemon.startProject(projectDir);
    if (!result.success) {
      reply.code(400);
    }
    return { success: result.success, error: result.error };
  });

  // GET /fleet/events — SSE stream of fleet lifecycle events
  fastify.get('/fleet/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp: string = request.ip || 'unknown';

    if (!canOpenConnection(clientIp, 'sse')) {
      reply.code(429);
      return { error: 'too many concurrent SSE connections' };
    }

    reply.hijack();
    const raw = reply.raw;

    trackConnection(clientIp, 'sse', raw as any);

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('data: {"type":"connected"}\n\n');

    // Subscribe to the fleet-wide event channel
    const unsub = messaging.subscribe('fleet:events', (msg: unknown) => {
      try {
        const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
        raw.write(`data: ${payload}\n\n`);
      } catch {
        // Client disconnected
      }
    });

    if (!unsub) {
      untrackConnection(clientIp, 'sse', raw as any);
      raw.end();
      return;
    }

    // Heartbeat to detect dead connections
    const heartbeat = setInterval(() => {
      try { raw.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 30000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsub();
      untrackConnection(clientIp, 'sse', raw as any);
    });
  });
};
