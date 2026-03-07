/**
 * Info Routes
 *
 * Version, metrics, health, and system port information.
 * Also provides /ports/* endpoints that delegate to V2 services.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
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
    claim(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    release(id: string): Record<string, unknown>;
    countActive(): number;
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
}

/**
 * Create info routes
 *
 * @param deps - Dependencies
 * @returns Express router
 */
export function createInfoRoutes(deps: InfoRouteDeps): Router {
  const { metrics, services, config, VERSION, CODE_HASH, STARTED_AT, __dirname, cleanupStale } = deps;
  const router = Router();

  // =========================================================================
  // GET /version
  // =========================================================================
  router.get('/version', (_req: Request, res: Response) => {
    res.json({
      version: VERSION,
      codeHash: CODE_HASH,
      startedAt: STARTED_AT,
      service: 'port-daddy',
      api: 'semantic',
      node_version: process.version,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      installDir: __dirname
    });
  });

  // =========================================================================
  // GET /metrics
  // =========================================================================
  router.get('/metrics', (_req: Request, res: Response) => {
    const uptime_seconds = Math.floor((Date.now() - metrics.uptime_start) / 1000);
    res.json({
      ...metrics,
      active_ports: services.countActive(),
      uptime_seconds,
      uptime_formatted: formatUptime(uptime_seconds)
    });
  });

  // =========================================================================
  // GET /health
  // =========================================================================
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: VERSION,
      uptime_seconds: Math.floor(process.uptime()),
      active_ports: services.countActive(),
      pid: process.pid
    });
  });

  // =========================================================================
  // /ports/* - Thin wrappers delegating to V2 services
  // These exist for CLI compatibility (get-port, release-port, list-ports)
  // =========================================================================

  // POST /ports/request -> delegates to services.claim()
  router.post('/ports/request', (req: Request, res: Response) => {
    try {
      const { project, preferred } = req.body;
      if (!project) {
        return res.status(400).json({ error: 'project name required' });
      }

      const PORT_RANGE_START = config.ports.range_start;
      const PORT_RANGE_END = config.ports.range_end;

      const result = services.claim(project, {
        port: preferred,
        range: [PORT_RANGE_START, PORT_RANGE_END],
        pid: parseInt(req.headers['x-pid'] as string, 10) || process.pid,
        systemPorts: new Set<number>()
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      metrics.total_assignments++;
      res.json({
        port: result.port,
        message: result.existing ? 'existing assignment renewed' : 'port assigned successfully',
        existing: result.existing || false
      });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // DELETE /ports/release -> delegates to services.release()
  router.delete('/ports/release', (req: Request, res: Response) => {
    try {
      const { port, project } = req.body;

      if (!project && port === undefined) {
        return res.status(400).json({ error: 'port or project required' });
      }

      // If releasing by project name, use it directly as identity
      if (project) {
        const result = services.release(project) as Record<string, unknown>;
        metrics.total_releases += (result.released as number) || 0;
        return res.json({ success: true, message: `released ${(result.released as number) || 0} port(s) for project ${project}` });
      }

      // If releasing by port, find the service on that port first
      if (port !== undefined) {
        const found = services.find('*', { port: parseInt(port as string, 10) });
        if (found.success && found.services.length > 0) {
          services.release(found.services[0].id);
          metrics.total_releases++;
          return res.json({ success: true, message: `released port ${port}` });
        }
        return res.json({ success: true, message: `no service on port ${port}` });
      }
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // GET /ports/active -> delegates to services.find('*')
  router.get('/ports/active', (_req: Request, res: Response) => {
    try {
      const result = services.find('*');
      if (!result.success) {
        return res.status(500).json({ error: 'internal server error' });
      }

      const ports = result.services.map((s: ServiceEntry) => ({
        port: s.port,
        project: s.id,
        pid: s.pid,
        started: s.createdAt,
        last_seen: s.lastSeen,
        alive: true, // Services are active if in the list
        age_minutes: Math.floor((Date.now() - s.createdAt) / 60000)
      }));

      res.json({ ports, count: ports.length });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // GET /ports/system - System ports (rate limited)
  const systemPortsLimiter = rateLimit({
    windowMs: 60000, max: 30,
    message: { error: 'System port scanning rate limited' }
  });

  router.get('/ports/system', systemPortsLimiter, (req: Request, res: Response) => {
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

      if (req.query.range_only === 'true') {
        filtered = filtered.filter((p: { port: number }) => p.port >= PORT_RANGE_START && p.port <= PORT_RANGE_END);
      }
      if (req.query.unmanaged_only === 'true') {
        filtered = filtered.filter((p: { managed_by_port_daddy: boolean }) => !p.managed_by_port_daddy);
      }

      res.json({ ports: filtered, count: filtered.length, total_system_ports: systemPorts.length });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // POST /ports/cleanup
  router.post('/ports/cleanup', (_req: Request, res: Response) => {
    try {
      const freed = cleanupStale();
      res.json({ freed, count: freed.length });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
