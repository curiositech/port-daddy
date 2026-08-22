/**
 * Sugar Routes — Compound commands for common workflows
 *
 * POST /sugar/begin   - Register agent + start session atomically
 * POST /sugar/done    - End session + unregister agent
 * POST /sugar/relink  - Update the active session's rent-at-claim fields
 * GET  /sugar/whoami  - Show current agent/session context
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

interface SugarRouteDeps {
  sugar: {
    begin(options: Record<string, unknown>): Record<string, unknown>;
    done(options: Record<string, unknown>): Record<string, unknown>;
    whoami(options: Record<string, unknown>): Record<string, unknown>;
    relink(options: Record<string, unknown>): Record<string, unknown>;
    getWelcomeBriefing?(harbor?: string): Record<string, unknown>;
  };
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

type BeginLifecycle = 'durable' | 'ephemeral';

function parseBeginLifecycle(value: unknown): BeginLifecycle | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'durable' || normalized === 'ephemeral' ? normalized : null;
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
      const {
        purpose,
        identity,
        agentId,
        name,
        type,
        files,
        force,
        metadata,
        worktree,
        requireLinkedWorktree,
        allowMainWorktree,
        bypassCrowdedGate,
        lifecycle: rawLifecycle,
        roadmapLink,
        sidequestReason,
        roadmapNewTitle,
      } = request.body as any;

      if (!purpose || typeof purpose !== 'string') {
        logger.warn('sugar_begin_rejected', {
          code: 'VALIDATION_ERROR',
          error: 'purpose must be a non-empty string',
          identity,
          lifecycle: rawLifecycle,
          purpose,
          fileCount: Array.isArray(files) ? files.length : 0,
          hasSidequestReason: typeof sidequestReason === 'string' && sidequestReason.length > 0,
        });
        reply.code(400);
        return {
          success: false,
          error: 'purpose must be a non-empty string',
          code: 'VALIDATION_ERROR',
        };
      }

      const lifecycle = parseBeginLifecycle(rawLifecycle);
      if (!lifecycle) {
        logger.warn('sugar_begin_rejected', {
          code: 'SESSION_LIFECYCLE_REQUIRED',
          error: 'lifecycle must be explicitly set to "durable" or "ephemeral"',
          identity,
          lifecycle: rawLifecycle,
          purpose,
          fileCount: Array.isArray(files) ? files.length : 0,
          hasSidequestReason: typeof sidequestReason === 'string' && sidequestReason.length > 0,
        });
        reply.code(400);
        return {
          success: false,
          error: 'lifecycle must be explicitly set to "durable" or "ephemeral"',
          code: 'SESSION_LIFECYCLE_REQUIRED',
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
        worktree,
        requireLinkedWorktree,
        allowMainWorktree,
        bypassCrowdedGate,
        lifecycle,
        roadmapLink,
        sidequestReason,
        roadmapNewTitle,
      });

      if (!result.success) {
        const status = result.code === 'AGENT_REGISTRATION_FAILED'
          || result.code === 'WORKTREE_REQUIRED'
          || result.code === 'MAIN_WORKTREE_SESSION_FORBIDDEN'
          || result.code === 'MAIN_WORKTREE_CROWDED'
          || result.code === 'ROADMAP_RENT_CONFLICT'
          || result.code === 'ROADMAP_SLUG_UNKNOWN'
          || result.code === 'ROADMAP_TITLE_REQUIRED'
          || result.code === 'SIDEQUEST_REASON_TOO_SHORT'
          || result.code === 'ROADMAP_ITEMS_UNAVAILABLE'
          ? 400
          : 500;
        logger.warn('sugar_begin_rejected', {
          code: result.code,
          error: result.error,
          identity,
          lifecycle,
          purpose,
          fileCount: Array.isArray(files) ? files.length : 0,
          hasSidequestReason: typeof sidequestReason === 'string' && sidequestReason.length > 0,
        });
        reply.code(status);
        return result;
      }

      logger.info('sugar_begin', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        identity,
        lifecycle,
        purpose,
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
      const {
        agentId,
        sessionId,
        note,
        status,
        skipOriginCheck,
        skipOriginCheckReason,
        noPr,
        subtask,
        forceIncomplete,
        forceIncompleteReason,
      } = request.body as any;
 
      const VALID_DONE_STATUSES = new Set(['completed', 'abandoned']);
      if (status && !VALID_DONE_STATUSES.has(status)) {
        reply.code(400);
        return {
          success: false,
          error: `Invalid status "${status}". Must be one of: completed, abandoned`,
          code: 'VALIDATION_ERROR',
        };
      }
 
      const result = sugar.done({
        agentId,
        sessionId,
        note,
        status,
        skipOriginCheck,
        skipOriginCheckReason,
        noPr,
        subtask,
        forceIncomplete,
        forceIncompleteReason,
      });

      if (!result.success) {
        const httpStatus = result.code === 'NO_ACTIVE_SESSION'
          ? 404
          : result.code === 'SESSION_OWNERSHIP_MISMATCH'
            ? 409
            : result.code === 'BRANCH_NOT_ON_ORIGIN'
              || result.code === 'RESULT_NOTE_MISSING_SENTINEL'
              || result.code === 'SKIP_ORIGIN_CHECK_REASON_REQUIRED'
              || result.code === 'PLAN_UNCHECKED_ITEMS'
              || result.code === 'FORCE_INCOMPLETE_REASON_REQUIRED'
              ? 400
              : 500;
        reply.code(httpStatus);
        return result;
      }

      logger.info('sugar_done', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        status: result.sessionStatus,
      });

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_done_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sugar/relink — anti-Goodhart valve: rent-at-claim links are never sticky.
  fastify.post('/sugar/relink', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId, sessionId, roadmapLink, sidequestReason } = request.body as any;

      const result = sugar.relink({ agentId, sessionId, roadmapLink, sidequestReason });

      if (!result.success) {
        const status = result.code === 'NO_ACTIVE_SESSION'
          ? 404
          : result.code === 'SESSION_OWNERSHIP_MISMATCH'
            ? 409
            : result.code === 'ROADMAP_RENT_CONFLICT'
              || result.code === 'ROADMAP_RENT_REQUIRED'
              || result.code === 'ROADMAP_SLUG_UNKNOWN'
              || result.code === 'SIDEQUEST_REASON_TOO_SHORT'
              || result.code === 'ROADMAP_ITEMS_UNAVAILABLE'
              ? 400
              : 500;
        reply.code(status);
        return result;
      }

      logger.info('sugar_relink', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        roadmapLink: result.roadmapLink,
        sidequestReason: result.sidequestReason,
      });

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_relink_error', { error: (error as Error).message });
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

  // GET /sugar/welcome
  fastify.get('/sugar/welcome', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const harbor = typeof (request.query as any).harbor === 'string' ? (request.query as any).harbor : undefined;
      if (sugar.getWelcomeBriefing) {
        return sugar.getWelcomeBriefing(harbor);
      }
      return { success: false, error: 'Welcome briefing not supported by this sugar provider' };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_welcome_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
