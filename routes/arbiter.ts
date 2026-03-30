/**
 * Arbiter Routes — Runtime invariant enforcement API
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Arbiter } from '../lib/arbiter.js';


// ==========================================================================
// Fastify plugin (dual-export)
// ==========================================================================
export const arbiterPlugin: FastifyPluginAsync<{ arbiter: Arbiter }> = async (fastify, opts) => {
  const { arbiter } = opts;

  // GET /arbiter/status
  fastify.get('/arbiter/status', async (request, reply) => {
    return arbiter.getStatus();
  });

  // GET /arbiter/violations
  fastify.get('/arbiter/violations', async (request, reply) => {
    const limit = Math.min(parseInt((request.query as any).limit as string) || 50, 200);
    const offset = parseInt((request.query as any).offset as string) || 0;
    const violations = arbiter.getViolations(limit, offset);

    return {
      success: true,
      violations,
      count: violations.length,
      total: arbiter.getViolationsCount(),
    };
  });

  // POST /arbiter/test-invariant/:name
  fastify.post('/arbiter/test-invariant/:name', async (request, reply) => {
    const { name } = request.params as any;
    const violation = arbiter.injectTestViolation(name);

    if (!violation) {
      reply.code(400); return {
        success: false,
        error: `Unknown invariant: ${name}`,
        validNames: [
          'PID_SQUATTING', 'CAP_ESCALATION', 'NOTE_MONOTONICITY',
          'ESCROW_POSITIVE', 'LOCK_OWNER_VALID', 'HEARTBEAT_FRESHNESS',
        ],
      };
    }

    return { success: true, violation };
  });
};
