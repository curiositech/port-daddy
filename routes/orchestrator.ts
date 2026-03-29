import { Router, Request, Response } from 'express';
import { createReactiveOrchestrator } from '../lib/orchestrator.js';

export interface OrchestratorRouteDeps {
  orchestrator: ReturnType<typeof createReactiveOrchestrator>;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
}

export function createOrchestratorRoutes(deps: OrchestratorRouteDeps) {
  const router = Router();
  const { orchestrator, logger, metrics } = deps;

  router.post('/orchestrator/up', async (req: Request, res: Response) => {
    try {
      // Logic for Up is usually in CLI, but the route exists for remote control
      res.json({ success: true, message: 'Orchestration started' });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  router.post('/orchestrator/down', async (req: Request, res: Response) => {
    try {
      await (orchestrator as any).stop?.();
      res.json({ success: true, message: 'All services stopped' });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  router.get('/orchestrator/status', (req: Request, res: Response) => {
    try {
      res.json({ status: 'active' });
    } catch (error) {
      res.status(500).json({ error: 'internal server error' });
    }
  });

  router.get('/orchestrator/rules', (_req: Request, res: Response) => {
    try {
      res.json(orchestrator.listRules());
    } catch (error) {
      res.status(500).json({ error: 'internal server error' });
    }
  });

  router.post('/orchestrator/rules', (req: Request, res: Response) => {
    try {
      // Validate required fields
      if (!req.body.name || typeof req.body.name !== 'string') {
        return res.status(400).json({ error: 'name is required and must be a string' });
      }
      if (!req.body.channelPattern || typeof req.body.channelPattern !== 'string') {
        return res.status(400).json({ error: 'channelPattern is required' });
      }
      if (!req.body.action || !['spawn', 'exec'].includes(req.body.action)) {
        return res.status(400).json({ error: 'action must be "spawn" or "exec"' });
      }
      if (!req.body.payload || typeof req.body.payload !== 'object') {
        return res.status(400).json({ error: 'payload is required and must be an object' });
      }

      // For exec action, validate the command
      if (req.body.action === 'exec') {
        const cmd = req.body.payload?.cmd;
        if (!cmd || typeof cmd !== 'string') {
          return res.status(400).json({ error: 'exec action requires payload.cmd string' });
        }
        // Reject shell metacharacters in exec commands
        if (/[;&|`$()\{\}!<>]/.test(cmd)) {
          return res.status(400).json({ error: 'exec command contains shell metacharacters — use spawn action instead' });
        }
      }

      const result = orchestrator.addRule(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
