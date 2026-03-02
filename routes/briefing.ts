/**
 * Briefing Routes
 *
 * POST /briefing          — Generate .portdaddy/ in projectRoot, write to disk
 * GET  /briefing/:project — Return briefing as JSON (no disk write)
 */

import { Router, type Request, type Response } from 'express';

interface BriefingRouteDeps {
  briefing: {
    generate(projectRoot: string, options?: { project?: string | null; writeToDisk?: boolean; full?: boolean }): {
      success: boolean;
      briefingPath?: string;
      files?: string[];
      briefing?: Record<string, unknown>;
      error?: string;
    };
    sync(projectRoot: string, options?: { project?: string | null; full?: boolean }): {
      success: boolean;
      briefingPath?: string;
      files?: string[];
      archivedSessions?: number;
      archivedAgents?: number;
      error?: string;
    };
    gatherData(project: string, projectRoot: string): Record<string, unknown>;
    detectProject(projectRoot: string, explicitProject?: string | null): string;
  };
}

export function createBriefingRoutes(deps: BriefingRouteDeps): Router {
  const router = Router();
  const { briefing } = deps;

  /**
   * POST /briefing — Generate .portdaddy/ briefing and write to disk
   */
  router.post('/briefing', (req: Request, res: Response): void => {
    const { projectRoot, project, full } = req.body as {
      projectRoot?: string;
      project?: string;
      full?: boolean;
    };

    if (!projectRoot || typeof projectRoot !== 'string') {
      res.status(400).json({ success: false, error: 'projectRoot is required' });
      return;
    }

    try {
      if (full) {
        const result = briefing.sync(projectRoot, { project, full: true });
        if (!result.success) {
          res.status(400).json(result);
          return;
        }
        res.json(result);
      } else {
        const result = briefing.generate(projectRoot, { project });
        if (!result.success) {
          res.status(400).json(result);
          return;
        }
        res.json(result);
      }
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  /**
   * GET /briefing/:project — Return briefing data as JSON (no disk write)
   */
  router.get('/briefing/:project', (req: Request, res: Response): void => {
    const { project } = req.params;
    const projectRoot = (req.query.projectRoot as string) || process.cwd();

    try {
      const result = briefing.generate(projectRoot, { project: project as string, writeToDisk: false });
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      res.json({ success: true, briefing: result.briefing });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}
