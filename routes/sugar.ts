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
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  // Durable record of `pd begin` problems as they enter the human suggestion
  // layer. Optional so older harnesses / tests that build deps by hand still
  // register the plugin; when absent we degrade to logging only.
  beginFlakiness?: {
    record(options: {
      code?: string | null;
      error?: string | null;
      hint?: string | null;
      identity?: string | null;
      agentId?: string | null;
      worktree?: string | null;
      lifecycle?: string | null;
      purpose?: string | null;
      httpStatus?: number | null;
    }): unknown;
    getRecent(options?: { limit?: number; class?: string | null }): unknown;
    getSummary(sinceMs?: number, buckets?: number): unknown;
    getStats(): unknown;
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
  const { sugar, metrics, logger, beginFlakiness } = deps;

  // POST /sugar/begin
  fastify.post('/sugar/begin', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as any;
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
    } = body;

    // Every `pd begin` failure — validation, worktree policy, crowded gate,
    // registration/session rollback, or a thrown 500 — is a problem entering the
    // human suggestion layer (the operator is about to read `error` + optional
    // `hint`). Record it durably here so flakiness can be detected and
    // visualised instead of vanishing with the HTTP response. Telemetry is
    // best-effort and must never break the begin path.
    const recordFlaky = (
      result: { code?: unknown; error?: unknown; hint?: unknown },
      status: number,
    ): void => {
      const code = typeof result.code === 'string' ? result.code : null;
      const error = typeof result.error === 'string' ? result.error : null;
      const hint = typeof result.hint === 'string' ? result.hint : null;
      try {
        beginFlakiness?.record({
          code,
          error,
          hint,
          identity: typeof identity === 'string' ? identity : null,
          agentId: typeof agentId === 'string' ? agentId : null,
          worktree: typeof worktree === 'string' ? worktree : null,
          lifecycle: typeof rawLifecycle === 'string' ? rawLifecycle : null,
          purpose: typeof purpose === 'string' ? purpose : null,
          httpStatus: status,
        });
      } catch {
        // Telemetry must never break the begin path.
      }
      (logger.warn ?? logger.info)('sugar_begin_flaky', {
        code,
        httpStatus: status,
        identity,
        hasHint: Boolean(hint),
      });
    };

    try {
      if (!purpose || typeof purpose !== 'string') {
        reply.code(400);
        const result = {
          success: false,
          error: 'purpose must be a non-empty string',
          code: 'VALIDATION_ERROR',
        };
        recordFlaky(result, 400);
        return result;
      }

      const lifecycle = parseBeginLifecycle(rawLifecycle);
      if (!lifecycle) {
        reply.code(400);
        const result = {
          success: false,
          error: 'lifecycle must be explicitly set to "durable" or "ephemeral"',
          code: 'SESSION_LIFECYCLE_REQUIRED',
        };
        recordFlaky(result, 400);
        return result;
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
      });

      if (!result.success) {
        const status = result.code === 'AGENT_REGISTRATION_FAILED'
          || result.code === 'WORKTREE_REQUIRED'
          || result.code === 'MAIN_WORKTREE_SESSION_FORBIDDEN'
          || result.code === 'MAIN_WORKTREE_CROWDED'
          ? 400
          : 500;
        reply.code(status);
        recordFlaky(result, status);
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
      // A thrown handler is the most worrying, race-shaped flakiness — record it
      // under the INTERNAL class so it shows up alongside the softer 400s.
      recordFlaky({ code: 'INTERNAL_ERROR', error: (error as Error).message }, 500);
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sugar/begin/flakiness - Recent `pd begin` problems + rollup summary.
  // This is the read side of the human suggestion layer: the rust console and
  // any operator surface poll it to detect and visualise begin flakiness.
  fastify.get('/sugar/begin/flakiness', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!beginFlakiness) {
        return { success: true, entries: [], count: 0, summary: null };
      }
      const { limit, class: cls, since, buckets } = request.query as Record<string, unknown>;
      const parsedLimit = typeof limit === 'string' ? parseInt(limit, 10) : 50;
      const parsedSince = typeof since === 'string' ? parseInt(since, 10) : 0;
      const parsedBuckets = typeof buckets === 'string' ? parseInt(buckets, 10) : 24;

      const recent = beginFlakiness.getRecent({
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
        class: typeof cls === 'string' && cls.length > 0 ? cls : null,
      }) as { entries?: unknown[]; count?: number };
      const summary = beginFlakiness.getSummary(
        Number.isFinite(parsedSince) ? parsedSince : 0,
        Number.isFinite(parsedBuckets) ? parsedBuckets : 24
      );

      return {
        success: true,
        entries: recent.entries ?? [],
        count: recent.count ?? 0,
        summary,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_begin_flakiness_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sugar/begin/flakiness/stats - Retention / volume stats for the log.
  fastify.get('/sugar/begin/flakiness/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!beginFlakiness) {
        return { success: true, stats: null };
      }
      return beginFlakiness.getStats();
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_begin_flakiness_stats_failed', { error: (error as Error).message });
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
      });

      if (!result.success) {
        const httpStatus = result.code === 'NO_ACTIVE_SESSION'
          ? 404
          : result.code === 'SESSION_OWNERSHIP_MISMATCH'
            ? 409
            : result.code === 'BRANCH_NOT_ON_ORIGIN'
              || result.code === 'RESULT_NOTE_MISSING_SENTINEL'
              || result.code === 'SKIP_ORIGIN_CHECK_REASON_REQUIRED'
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
