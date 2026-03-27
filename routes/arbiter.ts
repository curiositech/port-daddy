/**
 * Arbiter Routes — Runtime invariant enforcement API
 */

import { Router } from 'express';
import type { Arbiter } from '../lib/arbiter.js';

export function createArbiterRoutes(arbiter: Arbiter): Router {
  const router = Router();

  /**
   * GET /arbiter/status
   * Returns the Arbiter's current status: rules, violations count, uptime.
   */
  router.get('/arbiter/status', (_req, res) => {
    res.json(arbiter.getStatus());
  });

  /**
   * GET /arbiter/violations
   * Returns recorded violations, newest first.
   * Query params: ?limit=50&offset=0
   */
  router.get('/arbiter/violations', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const violations = arbiter.getViolations(limit, offset);

    res.json({
      success: true,
      violations,
      count: violations.length,
      total: arbiter.getViolationsCount(),
    });
  });

  /**
   * POST /arbiter/test-invariant/:name
   * Inject a test violation for demos and paper verification.
   * Valid names: PID_SQUATTING, CAP_ESCALATION, NOTE_MONOTONICITY,
   *              ESCROW_POSITIVE, LOCK_OWNER_VALID, HEARTBEAT_FRESHNESS
   */
  router.post('/arbiter/test-invariant/:name', (req, res) => {
    const { name } = req.params;
    const violation = arbiter.injectTestViolation(name);

    if (!violation) {
      return res.status(400).json({
        success: false,
        error: `Unknown invariant: ${name}`,
        validNames: [
          'PID_SQUATTING', 'CAP_ESCALATION', 'NOTE_MONOTONICITY',
          'ESCROW_POSITIVE', 'LOCK_OWNER_VALID', 'HEARTBEAT_FRESHNESS',
        ],
      });
    }

    res.json({ success: true, violation });
  });

  return router;
}
