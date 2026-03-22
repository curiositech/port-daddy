/**
 * Projects & Scan Routes
 *
 * POST /scan         - Deep scan directory, register project, return results + guidance
 * GET  /projects     - List all registered projects
 * GET  /projects/:id - Get project details
 * DELETE /projects/:id - Remove a project
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { scanProject, buildConfigFromScan } from '../lib/scan.js';
import { saveConfig } from '../lib/config.js';
import type { PortDaddyRcConfig } from '../lib/config.js';

interface ProjectEntry {
  id: string;
  root: string;
  type: string;
  services: Record<string, unknown> | null;
  config: unknown;
  last_scanned: string;
  created_at: string;
  metadata: { frameworks?: string[]; [key: string]: unknown } | null;
}

interface ProjectsRouteDeps {
  projects: {
    register(entry: Record<string, unknown>): void;
    get(id: string): ProjectEntry | undefined;
    list(options?: { pattern?: string }): ProjectEntry[];
    remove(id: string): boolean;
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
export function createProjectsRoutes(deps: ProjectsRouteDeps): Router {
  const { projects, metrics, logger, activityLog } = deps;
  const router = Router();

  // ==========================================================================
  // POST /scan - Deep scan a directory for services
  // ==========================================================================
  router.post('/scan', (req: Request, res: Response) => {
    try {
      const { dir, save = true, dryRun = false, useBranch = false } = req.body;
      const targetDir: string = dir || process.cwd();

      // Run the deep scan
      const result = scanProject(targetDir, { useBranch });

      // Build config from scan results
      const config = buildConfigFromScan(result);

      // Register project centrally (skip during dry-run)
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

      // Save .portdaddyrc unless dry-run
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

      res.json({
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
      });

    } catch (error) {
      metrics.errors++;
      logger.error('scan_error', { error: (error as Error).message });
      res.status(500).json({ error: 'scan failed', details: (error as Error).message });
    }
  });

  // ==========================================================================
  // GET /projects - List all registered projects
  // ==========================================================================
  router.get('/projects', (req: Request, res: Response) => {
    try {
      const { pattern } = req.query;
      const all = projects.list({ 
        pattern: typeof pattern === 'string' ? pattern : undefined 
      });

      res.json({
        success: true,
        count: all.length,
        projects: all.map((p: ProjectEntry) => ({
          id: p.id,
          root: p.root,
          type: p.type,
          serviceCount: p.services ? Object.keys(p.services).length : 0,
          lastScanned: p.last_scanned,
          createdAt: p.created_at,
          frameworks: p.metadata?.frameworks || []
        }))
      });

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // GET /projects/:id - Get project details
  // ==========================================================================
  router.get('/projects/:id', (req: Request, res: Response) => {
    try {
      const project = projects.get((req.params.id as string));

      if (!project) {
        return res.status(404).json({
          success: false,
          error: 'Project not found',
          suggestion: 'Run port-daddy scan from the project directory'
        });
      }

      res.json({
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
      });

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // DELETE /projects/:id - Remove a project
  // ==========================================================================
  router.delete('/projects/:id', (req: Request, res: Response) => {
    try {
      const removed = projects.remove((req.params.id as string));

      if (!removed) {
        return res.status(404).json({
          success: false,
          error: 'Project not found'
        });
      }

      logger.info('project_removed', { id: (req.params.id as string) });

      res.json({
        success: true,
        message: `Project "${(req.params.id as string)}" removed`
      });

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
