/**
 * Projects & Scan Routes
 *
 * POST /scan         - Deep scan directory, register project, return results + guidance
 * GET  /projects     - List all known Port Daddy projects
 * GET  /projects/:id - Get project details
 * DELETE /projects/:id - Remove a project
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { scanProject, buildConfigFromScan } from '../lib/scan.js';
import { saveConfig } from '../lib/config.js';
import type { PortDaddyRcConfig } from '../lib/config.js';
import { loadFleetConfig } from '../lib/fleet-engine.js';

interface ProjectEntry {
  id: string;
  root: string;
  type: string;
  services: Record<string, unknown> | null;
  config: unknown;
  last_scanned: string;
  created_at: string;
  metadata: { frameworks?: string[]; [key: string]: unknown } | null;
  displayName?: string;
  signals?: string[];
  sources?: string[];
  exists?: boolean;
}

interface ProjectsRouteDeps {
  projects: {
    register(entry: Record<string, unknown>): void;
    get(id: string): ProjectEntry | undefined;
    list(options?: { pattern?: string }): ProjectEntry[];
    listKnown?(options?: {
      pattern?: string;
      runtimeRoots?: string[];
      serviceRoots?: string[];
      discoveryRoots?: string[];
      maxDepth?: number;
    }): ProjectEntry[];
    remove(id: string): boolean;
  };
  services?: {
    list?(): {
      services: Array<{ cwd?: string | null }>;
    };
    find?(pattern?: string, options?: Record<string, unknown>): {
      success?: boolean;
      services?: Array<{ cwd?: string | null }>;
    };
  };
  fleetDaemon?: {
    getStatus(): {
      fleets: Array<{ projectDir: string }>;
    };
  };
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  activityLog: {
    log?(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
  };
}

/**
 * Create projects routes
 *
 * @param deps - Route dependencies
 * @returns Express router with project routes
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const projectsPlugin: FastifyPluginAsync<{ deps: ProjectsRouteDeps }> = async (fastify, opts) => {
  const { projects, metrics, logger, activityLog } = opts.deps;

  function extractServiceRoots(): string[] {
    const servicesDep = opts.deps.services;
    if (!servicesDep) return [];

    if (typeof servicesDep.list === 'function') {
      return servicesDep.list().services
        .map((service) => service.cwd ?? null)
        .filter((cwd): cwd is string => typeof cwd === 'string' && cwd.trim().length > 0);
    }

    if (typeof servicesDep.find === 'function') {
      const result = servicesDep.find('*', { limit: 500 });
      if (!result?.success || !Array.isArray(result.services)) return [];
      return result.services
        .map((service) => service.cwd ?? null)
        .filter((cwd): cwd is string => typeof cwd === 'string' && cwd.trim().length > 0);
    }

    return [];
  }

  // POST /scan - Deep scan a directory for services
  fastify.post('/scan', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { dir, save = true, dryRun = false, useBranch = false } = request.body as any;
      const targetDir: string = dir || process.cwd();

      const result = scanProject(targetDir, { useBranch });
      const config = buildConfigFromScan(result);

      if (!dryRun) {
        projects.register({
          id: result.project,
          root: result.root,
          type: result.type,
          config,
          services: result.services,
          metadata: {
            workspaceType: result.workspaceType,
            serviceCount: result.serviceCount,
            frameworks: Object.values(result.services).map((s: Record<string, unknown>) => (s.stack as Record<string, unknown>).name)
          }
        });
      }

      let savedPath: string | null = null;
      if (save && !dryRun && result.serviceCount > 0) {
        savedPath = saveConfig(config as PortDaddyRcConfig, targetDir);
      }

      logger.info('project_scanned', {
        project: result.project,
        type: result.type,
        serviceCount: result.serviceCount,
        saved: !!savedPath
      });

      if (activityLog?.log) {
        activityLog.log('project_scan', {
          details: `Scanned ${result.project}: ${result.serviceCount} services found`,
          metadata: { project: result.project, type: result.type }
        });
      }

      return {
        success: true,
        project: result.project,
        root: result.root,
        type: result.type,
        serviceCount: result.serviceCount,
        services: Object.fromEntries(
          Object.entries(result.services).map(([name, svc]: [string, Record<string, unknown>]) => [
            name,
            {
              dir: svc.relativePath || svc.dir,
              framework: (svc.stack as Record<string, unknown>).name,
              dev: svc.dev,
              health: svc.health,
              preferredPort: svc.preferredPort
            }
          ])
        ),
        suggestions: result.suggestions,
        config,
        saved: !!savedPath,
        savedPath,
        dryRun,
        guidance: result.guidance,
        existingConfig: result.existingConfig ? {
          path: (result.existingConfig as Record<string, unknown>)._path,
          serviceCount: Object.keys((result.existingConfig as Record<string, unknown>).services || {}).length
        } : null
      };
    } catch (error) {
      metrics.errors++;
      logger.error('scan_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /projects - List all known Port Daddy projects
  fastify.get('/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pattern } = request.query as any;
      const runtimeRoots = opts.deps.fleetDaemon?.getStatus().fleets.map((fleet) => fleet.projectDir) ?? [];
      const serviceRoots = extractServiceRoots();

      const all = projects.listKnown
        ? projects.listKnown({
            pattern: typeof pattern === 'string' ? pattern : undefined,
            runtimeRoots,
            serviceRoots,
          })
        : projects.list({
            pattern: typeof pattern === 'string' ? pattern : undefined
          });

      const runningRoots = new Set(runtimeRoots);
      const fleetConfigByRoot = new Map<string, ReturnType<typeof loadFleetConfig>>();

      for (const project of all) {
        try {
          fleetConfigByRoot.set(project.root, loadFleetConfig(project.root));
        } catch {
          fleetConfigByRoot.set(project.root, null);
        }
      }

      return {
        success: true,
        count: all.length,
        projects: all.map((p: ProjectEntry) => ({
          id: p.id,
          displayName: p.displayName || p.id,
          root: p.root,
          type: p.type,
          serviceCount: p.services ? Object.keys(p.services).length : 0,
          lastScanned: p.last_scanned,
          createdAt: p.created_at,
          frameworks: p.metadata?.frameworks || [],
          signals: p.signals || [],
          sources: p.sources || ['registered'],
          exists: p.exists ?? true,
          running: runningRoots.has(p.root),
          configuredAgentCount: fleetConfigByRoot.get(p.root)?.agents.length ?? 0,
          configuredWatcherCount: fleetConfigByRoot.get(p.root)?.watchers.length ?? 0,
        }))
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /projects/:id - Get project details
  fastify.get('/projects/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const project = projects.get((request.params as any).id as string);

      if (!project) {
        reply.code(404);
        return {
          success: false,
          error: 'Project not found',
          suggestion: 'Run port-daddy scan from the project directory'
        };
      }

      return {
        success: true,
        project: {
          id: project.id,
          root: project.root,
          type: project.type,
          config: project.config,
          services: project.services,
          lastScanned: project.last_scanned,
          createdAt: project.created_at,
          metadata: project.metadata
        }
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /projects/:id - Remove a project
  fastify.delete('/projects/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const removed = projects.remove((request.params as any).id as string);

      if (!removed) {
        reply.code(404);
        return {
          success: false,
          error: 'Project not found'
        };
      }

      logger.info('project_removed', { id: (request.params as any).id as string });

      return {
        success: true,
        message: `Project "${(request.params as any).id as string}" removed`
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
