/**
 * Sugar Routes — Compound commands for common workflows
 *
 * POST /sugar/begin   - Register agent + start session atomically
 * POST /sugar/done    - End session + unregister agent
 * GET  /sugar/whoami  - Show current agent/session context
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

interface SugarRouteDeps {
  sugar: {
    begin(options: Record<string, unknown>): Record<string, unknown>;
    done(options: Record<string, unknown>): Record<string, unknown>;
    whoami(options: Record<string, unknown>): Record<string, unknown>;
  };
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}


// =============================================================================
// Fastify plugin export
// =============================================================================
export const sugarPlugin: FastifyPluginAsync<{ deps: SugarRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { sugar, metrics, logger } = deps;

  // POST /sugar/begin
  fastify.post('/sugar/begin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { purpose, identity, agentId, name, type, files, force, metadata, telos } = request.body as any;

      if (!purpose || typeof purpose !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: 'purpose must be a non-empty string',
          code: 'VALIDATION_ERROR',
        };
      }

      const result = sugar.begin({
        purpose,
        identity,
        agentId,
        name,
        type,
        files,
        force,
        metadata,
        telos,
      });

      if (!result.success) {
        const status = result.code === 'AGENT_REGISTRATION_FAILED' ? 400 : 500;
        reply.code(status);
        return result;
      }

      logger.info('sugar_begin', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        identity,
        purpose,
        telos: result.telos || telos || null,
      });

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_begin_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sugar/done
  fastify.post('/sugar/done', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const {
        agentId,
        sessionId,
        note,
        status,
        selfSalvage,
        self_salvage,
        telosVerdict,
        telos_verdict,
        doable,
        whyStopped,
        why_stopped,
        nextPlan,
        next_plan,
        wisdom,
        evidence,
        risk,
      } = body;

      const VALID_DONE_STATUSES = new Set(['completed', 'abandoned']);
      if (status && !VALID_DONE_STATUSES.has(status)) {
        reply.code(400);
        return {
          success: false,
          error: `Invalid status "${status}". Must be one of: completed, abandoned`,
          code: 'VALIDATION_ERROR',
        };
      }

      const standaloneSelfSalvage = {
        telosVerdict: telosVerdict ?? telos_verdict,
        doable,
        whyStopped: whyStopped ?? why_stopped,
        nextPlan: nextPlan ?? next_plan,
        wisdom,
        evidence,
        risk,
      };
      const hasStandaloneSelfSalvage = Object.values(standaloneSelfSalvage)
        .some((value) => value !== undefined);
      const selfSalvageInput = selfSalvage ?? self_salvage ?? (hasStandaloneSelfSalvage ? standaloneSelfSalvage : undefined);

      const result = sugar.done({ agentId, sessionId, note, status, selfSalvage: selfSalvageInput });

      if (!result.success) {
        const httpStatus = result.code === 'NO_ACTIVE_SESSION'
          ? 404
          : result.code === 'SESSION_OWNERSHIP_MISMATCH'
            ? 409
            : result.code === 'SELF_SALVAGE_VALIDATION_ERROR' || result.code === 'SELF_SALVAGE_STATUS_MISMATCH'
              ? 400
              : 500;
        reply.code(httpStatus);
        return result;
      }

      logger.info('sugar_done', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        status: result.sessionStatus,
        selfSalvageQueued: result.selfSalvageQueued || false,
      });

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_done_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sugar/whoami
  fastify.get('/sugar/whoami', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = typeof (request.query as any).agentId === 'string' ? (request.query as any).agentId : undefined;
      const sessionId = typeof (request.query as any).sessionId === 'string' ? (request.query as any).sessionId : undefined;

      const result = sugar.whoami({ agentId, sessionId });

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_whoami_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
