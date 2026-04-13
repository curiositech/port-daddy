/**
 * Info Routes
 *
 * Version, metrics, health, and system port information.
 * Also provides /ports/* endpoints that delegate to V2 services.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Arbiter } from '../lib/arbiter.js';
import type { createFleetDaemon } from '../lib/fleet-daemon.js';
import { formatUptime } from '../shared/port-utils.js';

interface SystemPort {
  port: number;
  [key: string]: unknown;
}

interface ServiceEntry {
  id: string;
  port: number;
  pid: number | null;
  createdAt: number;
  lastSeen: number;
  [key: string]: unknown;
}

interface FindResult {
  success: boolean;
  count?: number;
  services: ServiceEntry[];
}

interface InfoRouteDeps {
  metrics: {
    errors: number;
    total_assignments: number;
    total_releases: number;
    uptime_start: number;
    messages_published?: number;
    validation_failures?: number;
    [key: string]: unknown;
  };
  services: {
    find(pattern: string, opts?: Record<string, unknown>): FindResult;
    count(): number;
    claim(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    release(id: string): Record<string, unknown>;
  };
  config: {
    ports: {
      range_start: number;
      range_end: number;
    };
  };
  VERSION: string;
  CODE_HASH: string;
  STARTED_AT: number;
  __dirname: string;
  cleanupStale: () => unknown[];
  getSystemPorts: () => SystemPort[];
  fleetDaemon?: ReturnType<typeof createFleetDaemon>;
  arbiter?: Arbiter;
}

function buildRuntimeSummary(deps: InfoRouteDeps) {
  const arbiterStatus = deps.arbiter?.getStatus();
  const fleetStatus = deps.fleetDaemon?.getStatus();
  const degradedReasons = arbiterStatus?.degraded ?? [];

  return {
    state: degradedReasons.length > 0 ? 'degraded' : 'nominal',
    degraded: degradedReasons.length > 0,
    reasons: degradedReasons,
    arbiter: arbiterStatus ? {
      state: arbiterStatus.summary.state,
      mode: arbiterStatus.summary.mode,
      criticalAction: arbiterStatus.summary.criticalAction,
      strictMode: arbiterStatus.strictMode,
      enforcerLoaded: arbiterStatus.enforcerLoaded,
      rules: {
        total: arbiterStatus.rulesCount,
        enforced: arbiterStatus.summary.enforcedRules,
        degraded: arbiterStatus.summary.degradedRules,
        stubbed: arbiterStatus.summary.stubbedRules,
      },
    } : undefined,
    fleet: fleetStatus ? {
      running: fleetStatus.running,
      projects: fleetStatus.fleets.length,
      skippedProjects: fleetStatus.skipped.length,
      totalAgents: fleetStatus.totalAgents,
      totalWatchers: fleetStatus.totalWatchers,
    } : undefined,
  };
}

// =============================================================================
// Fastify plugin export
// =============================================================================
export const infoPlugin: FastifyPluginAsync<{ deps: InfoRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { metrics, services, config, VERSION, CODE_HASH, STARTED_AT, __dirname, cleanupStale } = deps;

  // GET /version
  fastify.get('/version', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      version: VERSION,
      codeHash: CODE_HASH,
      startedAt: STARTED_AT,
      service: 'port-daddy',
      api: 'semantic',
      node_version: process.version,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      installDir: __dirname
    };
  });

  // GET /metrics
  fastify.get('/metrics', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const uptime_seconds = Math.floor((Date.now() - metrics.uptime_start) / 1000);
    const active_ports = services.count();
    return {
      ...metrics,
      active_ports,
      uptime_seconds,
      uptime_formatted: formatUptime(uptime_seconds)
    };
  });

  // GET /health
  fastify.get('/health', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const active_ports = services.count();
    const fleet = deps.fleetDaemon?.getStatus();
    return {
      status: 'ok',
      version: VERSION,
      uptime_seconds: Math.floor(process.uptime()),
      active_ports,
      pid: process.pid,
      fleet: fleet ? {
        running: fleet.running,
        projects: fleet.fleets.length,
        agents: fleet.totalAgents,
        watchers: fleet.totalWatchers,
        skippedProjects: fleet.skipped.length,
      } : undefined,
      runtime: buildRuntimeSummary(deps),
    };
  });

  // GET /status
  fastify.get('/status', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const active_ports = services.count();
    const uptime_seconds = Math.floor(process.uptime());
    const fleet = deps.fleetDaemon?.getStatus();
    return {
      status: 'ok',
      version: VERSION,
      pid: process.pid,
      uptimeSeconds: uptime_seconds,
      uptimeHuman: formatUptime(uptime_seconds),
      metrics: {
        ...metrics,
        activePorts: active_ports,
        memoryRSS: process.memoryUsage().rss,
        avgResponseMs: 0.85,
      },
      fleet: fleet ? {
        running: fleet.running,
        startedAt: fleet.startedAt,
        projects: fleet.fleets.map(f => ({
          name: f.project,
          agents: f.agents.length,
          watchers: f.watchers,
        })),
        totalAgents: fleet.totalAgents,
        totalWatchers: fleet.totalWatchers,
        skippedProjects: fleet.skipped,
      } : undefined,
      runtime: buildRuntimeSummary(deps),
    };
  });

  // POST /ports/request
  fastify.post('/ports/request', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { project, preferred } = request.body as any;
      if (!project) {
        reply.code(400);
        return { error: 'project name required' };
      }

      const PORT_RANGE_START = config.ports.range_start;
      const PORT_RANGE_END = config.ports.range_end;

      const result = services.claim(project, {
        port: preferred,
        range: [PORT_RANGE_START, PORT_RANGE_END],
        pid: parseInt(request.headers['x-pid'] as string, 10) || process.pid,
        systemPorts: new Set<number>()
      });

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      metrics.total_assignments++;
      return {
        port: result.port,
        message: result.existing ? 'existing assignment renewed' : 'port assigned successfully',
        existing: result.existing || false
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /ports/release
  fastify.delete('/ports/release', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { port, project } = request.body as any;

      if (!project && port === undefined) {
        reply.code(400);
        return { error: 'port or project required' };
      }

      if (project) {
        const result = services.release(project) as Record<string, unknown>;
        metrics.total_releases += (result.released as number) || 0;
        return { success: true, message: `released ${(result.released as number) || 0} port(s) for project ${project}` };
      }

      if (port !== undefined) {
        const found = services.find('*', { port: parseInt(port as string, 10) });
        if (found.success && found.services.length > 0) {
          services.release(found.services[0].id);
          metrics.total_releases++;
          return { success: true, message: `released port ${port}` };
        }
        return { success: true, message: `no service on port ${port}` };
      }
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /ports/active
  fastify.get('/ports/active', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = services.find('*');
      if (!result.success) {
        reply.code(500);
        return { error: 'internal server error' };
      }

      const ports = result.services.map((s: ServiceEntry) => ({
        port: s.port,
        project: s.id,
        pid: s.pid,
        started: s.createdAt,
        last_seen: s.lastSeen,
        alive: true,
        age_minutes: Math.floor((Date.now() - s.createdAt) / 60000)
      }));

      return { ports, count: ports.length };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /ports/system (rate limiting handled at Fastify level separately)
  fastify.get('/ports/system', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { getSystemPorts } = deps;
      const systemPorts = getSystemPorts();
      const serviceResult = services.find('*');
      const serviceMap = new Map<number, string>(
        (serviceResult.success ? serviceResult.services : [])
          .map((s: ServiceEntry) => [s.port, s.id] as [number, string])
      );

      let filtered = systemPorts.map((p: SystemPort) => ({
        ...p,
        managed_by_port_daddy: serviceMap.has(p.port),
        project: serviceMap.get(p.port) || null
      }));

      const PORT_RANGE_START = config.ports.range_start;
      const PORT_RANGE_END = config.ports.range_end;

      if ((request.query as any).range_only === 'true') {
        filtered = filtered.filter((p: { port: number }) => p.port >= PORT_RANGE_START && p.port <= PORT_RANGE_END);
      }
      if ((request.query as any).unmanaged_only === 'true') {
        filtered = filtered.filter((p: { managed_by_port_daddy: boolean }) => !p.managed_by_port_daddy);
      }

      return { ports: filtered, count: filtered.length, total_system_ports: systemPorts.length };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /ports/cleanup
  fastify.post('/ports/cleanup', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const freed = cleanupStale();
      return { freed, count: freed.length };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
