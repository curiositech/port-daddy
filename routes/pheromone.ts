/**
 * Pheromone Routes — Stigmergic coordination API
 *
 * POST /pheromone/spray   — Set a pheromone value on an entity
 * GET  /pheromone/:table/:id — Read pheromone values for an entity
 * GET  /pheromone          — List all non-zero pheromones
 */

import { Router, type Request, type Response } from 'express';
import type { createPheromoneManager } from '../lib/pheromone.js';

type PheromoneManager = ReturnType<typeof createPheromoneManager>;

interface PheromoneRouteDeps {
  pheromones: PheromoneManager;
}

export function createPheromoneRoutes(deps: PheromoneRouteDeps): Router {
  const { pheromones } = deps;
  const router = Router();

  /**
   * POST /pheromone/spray
   * Body: { table, id, key, strength }
   */
  router.post('/pheromone/spray', (req: Request, res: Response) => {
    const { table, id, key, strength } = req.body as Record<string, unknown>;

    if (!table || typeof table !== 'string') {
      return res.status(400).json({ success: false, error: 'table is required (services, projects, sessions, agents)' });
    }
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ success: false, error: 'id is required' });
    }
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ success: false, error: 'key is required (e.g., "confidence", "activity")' });
    }
    const str = typeof strength === 'number' ? strength : parseFloat(String(strength));
    if (isNaN(str) || str < 0 || str > 1) {
      return res.status(400).json({ success: false, error: 'strength must be a number between 0 and 1' });
    }

    const result = pheromones.spray(table, id, key, str);
    if (!result.success) {
      return res.status(404).json({ success: false, error: `Entity not found: ${table}/${id}` });
    }

    res.json({ success: true, table, id, key, strength: str, pheromones: result.pheromones });
  });

  /**
   * GET /pheromone/:table/:id
   * Read pheromone values for a specific entity.
   */
  router.get('/pheromone/:table/:id', (req: Request, res: Response) => {
    const { table, id } = req.params;

    const result = pheromones.sniff(table, id);
    if (!result.success) {
      return res.status(404).json({ success: false, error: `Entity not found: ${table}/${id}` });
    }

    res.json({ success: true, table, id, pheromones: result.pheromones });
  });

  /**
   * GET /pheromone
   * List all entities with non-zero pheromones.
   */
  router.get('/pheromone', (_req: Request, res: Response) => {
    const results = pheromones.list();
    res.json({
      success: true,
      count: results.length,
      pheromones: results,
    });
  });

  return router;
}
