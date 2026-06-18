/**
 * Info Routes
 *
 * Version, metrics, health, and system port information.
 * Also provides /ports/* endpoints that delegate to V2 services.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Arbiter } from '../lib/arbiter.js';
import type { BosunHeartbeatStatus } from '../lib/bosun-heartbeat.js';
import type { createFleetDaemon } from '../lib/fleet-daemon.js';
import { formatUptime } from '../shared/port-utils.js';
import { detectDrift } from '../lib/binary-drift-detector.js';
import { assessRouteHealth, registeredFromSet, type RouteHealth } from '../lib/route-health.js';

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
  /**
   * Snapshot of the daemon's binary at startup, used by /health to detect
   * brew-upgrade-style binary drift. Optional so older route wirings stay
   * compatible — when absent, /health simply omits the binaryDrift field.
   */
  runningBinarySnapshot?: {
    runningPath: string;
    runningHash: string | null;
    runningSizeBytes: number | null;
  };
  cleanupStale: () => unknown[];
  getSystemPorts: () => SystemPort[];
  fleetDaemon?: ReturnType<typeof createFleetDaemon>;
  arbiter?: Arbiter;
  activityLog?: {
    getRecent(options?: { limit?: number }): {
      success: boolean;
      count: number;
      entries: Array<{
        id: number;
        timestamp: number;
        type: string;
        agentId: string | null;
        targetId: string | null;
        details: string | null;
      }>;
    };
  };
  costTracker?: {
    recent(limit?: number): Array<{
      id: string;
      ts: number;
      backend: string;
      model: string;
      projectName: string | null;
      projectDir: string | null;
      costUsd: number;
      isEstimate: boolean;
    }>;
  };
  bosunHeartbeat?: {
    getStatus(): BosunHeartbeatStatus;
  };
  /**
   * Registry of registered routes ("METHOD /url"), populated by a root-level
   * onRoute hook in server.ts. When present, /health and /status verify the
   * daemon's critical routes are actually mounted (#160). Optional so callers
   * and tests that don't wire it keep prior behavior.
   */
  routeRegistry?: Set<string>;
}

function buildRuntimeSummary(deps: InfoRouteDeps, routeHealth?: RouteHealth | null) {
  const arbiterStatus = deps.arbiter?.getStatus();
  const fleetStatus = deps.fleetDaemon?.getStatus();
  const arbiterReasons = arbiterStatus?.degraded ?? [];
  // #160: a missing critical route is a degradation the probe must surface,
  // not hide behind a clean arbiter. Fold route-health into the reasons.
  const routeReasons = (routeHealth?.missing ?? []).map(
    (r) => `route_missing:${r.method} ${r.url}`,
  );
  const degradedReasons = [...arbiterReasons, ...routeReasons];

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
      launchableAgents: fleetStatus.totalLaunchableAgents,
    } : undefined,
  };
}

function humanizeActivityType(type: string): string {
  return type.toLowerCase().replace(/_/g, ' ');
}

function summarizeActivity(details: string | null, type: string): string {
  const trimmed = details?.trim();
  if (trimmed) return trimmed;
  return humanizeActivityType(type);
}

function buildRecentHistory(deps: InfoRouteDeps) {
  const recentActivity =
    deps.activityLog?.getRecent({ limit: 6 }).entries.map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      type: entry.type,
      agentId: entry.agentId,
      targetId: entry.targetId,
      summary: summarizeActivity(entry.details, entry.type),
    })) ?? [];

  const recentSpend =
    deps.costTracker?.recent(6).map((event) => ({
      id: event.id,
      timestamp: event.ts,
      backend: event.backend,
      model: event.model,
      projectName: event.projectName,
      projectDir: event.projectDir,
      costUsd: event.costUsd,
      isEstimate: event.isEstimate,
    })) ?? [];

  const lastActivityAt = recentActivity[0]?.timestamp ?? recentSpend[0]?.timestamp ?? null;

  return {
    lastActivityAt,
    recentActivity,
    recentSpend,
  };
}

/**
 * Resolve the canonical V4 Bosun supervisor binary.
 *
 * Sample input and output:
 *
 * ```ts
 * resolveBosunBinaryStatus('/Users/me/port-daddy-stable')
 * // => { binaryPath: '/Users/me/port-daddy-stable/dist/core/pd-bosun', binaryExists: true }
 * ```
 *
 * `dist/core/pd-bosun` is the release artifact. The source-tree release binary
 * is only a local-development fallback for checkouts that have not built `dist/`.
 */
function resolveBosunBinaryStatus(rootDir: string) {
  const distBinary = join(rootDir, 'dist', 'core', 'pd-bosun');
  const sourceBinary = join(rootDir, 'core', 'pd-bosun', 'target', 'release', 'pd-bosun');
  const binaryPath = existsSync(distBinary) ? distBinary : sourceBinary;
  return {
    binaryPath,
    binaryExists: existsSync(binaryPath),
  };
}

/**
 * Explain the Bosun writer/supervisor state without leaking retired watchdog
 * wording into operator-facing status.
 *
 * Sample input and output:
 *
 * ```ts
 * describeBosunHeartbeat({ state: 'healthy' }, true)
 * // => 'daemon heartbeat writer active; pd-bosun supervisor binary available'
 * ```
 */
function describeBosunHeartbeat(
  heartbeat: BosunHeartbeatStatus,
  binaryExists: boolean,
): string | null {
  if (heartbeat.state !== 'healthy') {
    return heartbeat.lastError;
  }
  if (binaryExists) {
    return 'daemon heartbeat writer active; pd-bosun supervisor binary available';
  }
  return 'daemon heartbeat writer active; pd-bosun supervisor not installed (optional)';
}

function buildGuardianSummary(deps: InfoRouteDeps) {
  const heartbeat = deps.bosunHeartbeat?.getStatus() ?? null;
  const bosunBinary = resolveBosunBinaryStatus(deps.__dirname);
  const bosunStatus = heartbeat ? {
    monitoredUrl: `file://${heartbeat.heartbeatPath}`,
    binaryPath: bosunBinary.binaryPath,
    binaryExists: bosunBinary.binaryExists,
    enabled: heartbeat.enabled,
    state: heartbeat.state === 'healthy' ? 'idle' : heartbeat.state,
    reason: describeBosunHeartbeat(heartbeat, bosunBinary.binaryExists),
    lastCheckAt: heartbeat.lastWrittenAt,
    lastHealthyAt: heartbeat.state === 'healthy' ? heartbeat.lastWrittenAt : null,
    lastFailureAt: heartbeat.state === 'degraded' || heartbeat.state === 'displaced' ? Date.now() : null,
    failureCount: heartbeat.lastError ? 1 : 0,
    heartbeat,
  } : {
    monitoredUrl: null,
    binaryPath: bosunBinary.binaryPath,
    binaryExists: bosunBinary.binaryExists,
    enabled: false,
    state: 'disabled',
    reason: 'daemon heartbeat writer unavailable',
    lastCheckAt: null,
    lastHealthyAt: null,
    lastFailureAt: null,
    failureCount: 0,
    heartbeat: null,
  };

  return {
    supervisor: {
      state: 'launchctl_preferred',
      summary: 'launchctl is the authoritative daemon supervisor on macOS',
    },
    bosun: bosunStatus,
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
    // Cheap drift check: one realpath + one hash of the on-disk pd binary.
    // Tells callers (FleetBar, dashboards, `pd doctor`) whether the running
    // daemon is now older than what `pd` resolves to on PATH.
    const binaryDrift = deps.runningBinarySnapshot
      ? detectDrift({ runningSnapshot: deps.runningBinarySnapshot })
      : undefined;
    // #160: verify the daemon's own critical routes are mounted before claiming
    // health. Feature-detected: only when the route registry was wired.
    const routeHealth = deps.routeRegistry
      ? assessRouteHealth(registeredFromSet(deps.routeRegistry))
      : null;
    const runtime = buildRuntimeSummary(deps, routeHealth);
    return {
      // #160: top-level liveness reflects whether the daemon can actually serve
      // its route contract. Arbiter/rule degradation is surfaced separately in
      // `runtime` (it does not mean the daemon is 404'ing its own endpoints).
      status: routeHealth && !routeHealth.ok ? 'degraded' : 'ok',
      version: VERSION,
      uptime_seconds: Math.floor(process.uptime()),
      active_ports,
      pid: process.pid,
      fleet: fleet ? {
        running: fleet.running,
        projects: fleet.fleets.length,
        agents: fleet.totalAgents,
        watchers: fleet.totalWatchers,
        launchableAgents: fleet.totalLaunchableAgents,
        skippedProjects: fleet.skipped.length,
      } : undefined,
      routes: routeHealth ?? undefined,
      runtime,
      binaryDrift: binaryDrift ? {
        drifted: binaryDrift.drifted,
        runningHash: binaryDrift.runningHash,
        onDiskHash: binaryDrift.onDiskHash,
        runningPath: binaryDrift.runningPath,
        onDiskPath: binaryDrift.onDiskPath,
        reason: binaryDrift.reason,
        checkedAt: binaryDrift.checkedAt,
      } : undefined,
    };
  });

  // GET /status
  fastify.get('/status', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const active_ports = services.count();
    const uptime_seconds = Math.floor(process.uptime());
    const fleet = deps.fleetDaemon?.getStatus();
    const history = buildRecentHistory(deps);
    const routeHealth = deps.routeRegistry
      ? assessRouteHealth(registeredFromSet(deps.routeRegistry))
      : null;
    const runtime = buildRuntimeSummary(deps, routeHealth);
    return {
      status: routeHealth && !routeHealth.ok ? 'degraded' : 'ok',
      routes: routeHealth ?? undefined,
      version: VERSION,
      pid: process.pid,
      uptimeSeconds: uptime_seconds,
      uptimeHuman: formatUptime(uptime_seconds),
      daemon: {
        version: VERSION,
        codeHash: CODE_HASH,
        startedAt: STARTED_AT,
        installDir: __dirname,
        nodeVersion: process.version,
      },
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
          launchableAgents: f.launchableAgents,
          blockedAgents: f.blockedAgents,
        })),
        totalAgents: fleet.totalAgents,
        totalWatchers: fleet.totalWatchers,
        totalLaunchableAgents: fleet.totalLaunchableAgents,
        launchableAgents: fleet.totalLaunchableAgents,
        skippedProjects: fleet.skipped,
      } : undefined,
      runtime,
      guardians: buildGuardianSummary(deps),
      history,
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
