/**
 * Tuple Space Routes — Shared coordination for agent swarms
 *
 * POST /tuples           — Write a tuple (out)
 * GET  /tuples           — Read tuples by pattern (rd)
 * DELETE /tuples         — Take tuples by pattern (in — removes matches)
 * GET  /tuples/scan      — List all tuples
 * GET  /tuples/count     — Count tuples
 */

import { Router, type Request, type Response } from 'express';
import type { TupleSpace } from '../lib/tuples.js';

interface TupleRouteDeps {
  tuples: TupleSpace;
}

export function createTupleRoutes({ tuples }: TupleRouteDeps): Router {
  const router = Router();

  // POST /tuples — Write a tuple
  router.post('/tuples', (req: Request, res: Response) => {
    const { fields, harbor, writtenBy, ttlMs } = req.body;

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'fields must be a non-empty array',
        code: 'VALIDATION_ERROR',
      });
    }

    const tuple = tuples.out(fields, {
      harbor: harbor || null,
      writtenBy: writtenBy || null,
      ttlMs: typeof ttlMs === 'number' ? ttlMs : undefined,
    });

    res.json({ success: true, tuple });
  });

  // GET /tuples?pattern=[...]&harbor=...&limit=N — Read by pattern
  router.get('/tuples', (req: Request, res: Response) => {
    const patternStr = req.query.pattern as string | undefined;
    const harbor = req.query.harbor as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    let pattern: unknown[] = ['*'];
    if (patternStr) {
      try {
        pattern = JSON.parse(patternStr);
        if (!Array.isArray(pattern)) {
          return res.status(400).json({ success: false, error: 'pattern must be a JSON array' });
        }
      } catch {
        return res.status(400).json({ success: false, error: 'pattern must be valid JSON array' });
      }
    }

    const matches = tuples.rd(pattern, { harbor, limit });
    res.json({ success: true, tuples: matches, count: matches.length });
  });

  // DELETE /tuples — Take (remove) matching tuples
  router.delete('/tuples', (req: Request, res: Response) => {
    const { pattern, harbor, limit } = req.body;

    if (!Array.isArray(pattern)) {
      return res.status(400).json({ success: false, error: 'pattern must be a JSON array' });
    }

    const taken = tuples.take(pattern, {
      harbor: harbor || undefined,
      limit: typeof limit === 'number' ? limit : undefined,
    });

    res.json({ success: true, taken, count: taken.length });
  });

  // GET /tuples/scan?harbor=... — List all tuples
  router.get('/tuples/scan', (req: Request, res: Response) => {
    const harbor = req.query.harbor as string | undefined;
    const all = tuples.scan(harbor);
    res.json({ success: true, tuples: all, count: all.length });
  });

  // GET /tuples/count?harbor=... — Count tuples
  router.get('/tuples/count', (req: Request, res: Response) => {
    const harbor = req.query.harbor as string | undefined;
    const c = tuples.count(undefined, harbor);
    res.json({ success: true, count: c });
  });

  return router;
}
