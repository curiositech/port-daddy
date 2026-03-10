/**
 * Launch Hints Route
 *
 * GET /launch-hints?cwd=<path>
 *
 * Returns context-aware startup nudges for the CLI banner:
 * - Salvage queue summary filtered to the current project
 * - Whether this folder is new (not yet registered/scanned)
 * - Ordered nudges array (priority 1 = most urgent)
 *
 * All failures are silent — this is a best-effort endpoint.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface StaleAgent {
  id: string;
  purpose?: string;
  staleSince?: string;
  identityProject?: string;
  identityStack?: string;
  identityContext?: string;
}

interface LaunchRouteDeps {
  resurrection: {
    pending(opts?: { project?: string }): { agents: StaleAgent[]; count: number };
  };
  projects: {
    list(): Array<{ root: string }>;
  };
}

interface Nudge {
  type: string;
  message: string;
  cmd: string;
}

export function createLaunchHintsRoutes(deps: LaunchRouteDeps): Router {
  const { resurrection, projects } = deps;
  const router = Router();

  router.get('/launch-hints', (req: Request, res: Response) => {
    try {
      const cwd = (req.query.cwd as string | undefined) || '';

      // Derive project name: try package.json first, then directory name
      let projectName: string | null = null;
      if (cwd) {
        try {
          const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { name?: string };
          // Strip npm scope prefix (@scope/name → name)
          projectName = pkg.name?.split('/').pop() ?? null;
        } catch {
          projectName = cwd.split('/').filter(Boolean).pop() ?? null;
        }
      }

      // Is this folder registered?
      const isNewFolder = cwd ? !projects.list().some(p => p.root === cwd) : false;

      // Salvage — project-scoped first, then total
      const projectSalvage = projectName
        ? resurrection.pending({ project: projectName })
        : { agents: [], count: 0 };

      const totalSalvage = projectName
        ? resurrection.pending()
        : projectSalvage;

      const recentAgents = projectSalvage.agents.slice(0, 3).map(a => {
        const identity = [a.identityProject, a.identityStack, a.identityContext]
          .filter(Boolean).join(':');
        const staleSince = a.staleSince ? new Date(a.staleSince).getTime() : null;
        const minutesAgo = staleSince ? Math.floor((Date.now() - staleSince) / 60_000) : null;
        return { id: a.id, purpose: a.purpose ?? null, identity: identity || null, minutesAgo };
      });

      // Build nudges ordered by urgency
      const nudges: Nudge[] = [];

      if (projectSalvage.count > 0) {
        const n = projectSalvage.count;
        nudges.push({
          type: 'salvage',
          message: `${n} agent${n > 1 ? 's' : ''} from ${projectName || 'this project'} ${n > 1 ? 'are' : 'is'} waiting in the salvage queue`,
          cmd: `pd salvage${projectName ? ` --project ${projectName}` : ''}`,
        });
      } else if (totalSalvage.count > 0) {
        nudges.push({
          type: 'salvage_global',
          message: `${totalSalvage.count} agent${totalSalvage.count > 1 ? 's' : ''} pending salvage across all projects`,
          cmd: 'pd salvage',
        });
      }

      if (isNewFolder) {
        nudges.push({
          type: 'scan',
          message: 'New folder — scan to register your services (detects frameworks, maps ports, enables full coordination)',
          cmd: 'pd scan',
        });
        nudges.push({
          type: 'tutorial',
          message: 'New to Port Daddy? Run the interactive walkthrough',
          cmd: 'pd learn',
        });
        nudges.push({
          type: 'mcp',
          message: 'Add to Claude Code for full agent coordination (CLI + MCP + skills in one install)',
          cmd: 'pd mcp',
        });
      }

      res.json({
        success: true,
        projectName,
        isNewFolder,
        uncharted_waters: isNewFolder,
        salvage: {
          total: totalSalvage.count,
          inProject: projectSalvage.count,
          recent: recentAgents,
        },
        nudges,
      });

    } catch {
      // Best-effort — never 500 the launch hints
      res.json({ success: false, nudges: [], salvage: { total: 0, inProject: 0, recent: [] } });
    }
  });

  return router;
}
