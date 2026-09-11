/**
 * Dispatches Routes — operator-facing HTTP surface over `lib/dispatch/queue.ts`.
 *
 * POST   /dispatches                       — propose a new dispatch
 * GET    /dispatches                       — list (filterable by state, requestedBy, limit)
 * GET    /dispatches/:id                   — single dispatch
 * POST   /dispatches/:id/accept            — operator accepts produced work (state → accepted)
 * POST   /dispatches/:id/reject            — operator rejects produced work (state → rejected; body: { reason })
 * POST   /dispatches/:id/cancel            — operator cancels (state → salvage; body: { reason? })
 *
 * Operator-direct only. State-machine internal transitions (claim, start,
 * produce, requestReview, settle) are driven by the dispatch runner and
 * harbormaster, not the operator's HTTP surface. The runner reads/writes the
 * queue directly via lib/dispatch/queue.ts.
 *
 * Authoring note (2026-05-22): this route is the operator-visible half of
 * the dispatch state machine. The other half (runner + harbormaster + popper)
 * walks the state machine internally without operator gestures. The result is
 * the operator types `pd dispatch propose "intent"` (POST /dispatches) and,
 * eventually, sees a `state='review_pending'` dispatch they can accept/reject
 * via FleetBar's Nightshift tab (which calls these POST endpoints).
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type {
  DispatchQueue,
  DispatchState,
  ProposeDispatchInput,
  ListDispatchesOptions,
  Dispatch,
} from '../lib/dispatch/queue.js';
import type { DispatchWorker } from '../lib/dispatch/worker.js';
import {
  WorkIntentMaterializationError,
  type WorkIntentService,
} from '../lib/agent-harbor/work-intent-service.js';

interface DispatchesRouteDeps {
  deps: {
    dispatchQueue: DispatchQueue;
    workIntentService?: WorkIntentService;
    /**
     * Daemon-side worker draining the queue. Absent when PD_DISPATCH_WORKER=false
     * (the operator runs dispatches foreground instead). The worker-status + run
     * routes degrade honestly when it is missing.
     */
    dispatchWorker?: DispatchWorker;
  };
}

const dispatchesPlugin: FastifyPluginAsync<DispatchesRouteDeps> = async (
  fastify,
  { deps },
) => {
  const { dispatchQueue, dispatchWorker } = deps;

  function idempotencyKey(req: FastifyRequest, body: Record<string, unknown>): string | undefined {
    const header = req.headers['idempotency-key'];
    if (typeof header === 'string' && header.trim()) return header.trim();
    if (Array.isArray(header) && typeof header[0] === 'string' && header[0].trim()) {
      return header[0].trim();
    }
    return typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : undefined;
  }

  function missingWorkIntentService(reply: FastifyReply) {
    return reply.code(503).send({
      ok: false,
      error: 'WorkIntent dispatch intake is unavailable; refusing compatibility dispatch side effect',
    });
  }

  function ensureDispatchIntent(dispatch: Dispatch, reply: FastifyReply): true | FastifyReply {
    if (!deps.workIntentService) {
      return missingWorkIntentService(reply);
    }
    try {
      deps.workIntentService.ensureDispatchIntent(dispatch);
      return true;
    } catch (err) {
      return reply.code(409).send({
        ok: false,
        error:
          'dispatch side effect refused because WorkIntent import failed: ' +
          (err instanceof Error ? err.message : String(err)),
        dispatch,
      });
    }
  }

  function isProjectionValidationError(message: string): boolean {
    return message.includes('goal text') ||
      // BUG 1 (2026-07-14 halt-mandate): the budget message became
      // "non-negative" when budgetUsd 0 was legalized. Match the stable
      // "budgetUsd must be a" prefix so this classifier does not silently
      // downgrade a validation error to a 500 on a future wording tweak.
      message.includes('budgetUsd must be a') ||
      message.includes('timeoutMs must be a positive number') ||
      message.includes('projectDir must be an absolute path') ||
      message.includes('projectDir contains invalid characters');
      // NOTE: `merge_policy='auto'` used to throw here (blocked pending
      // harbormaster); it is now accepted at propose time and merges are
      // handled by lib/dispatch/auto-merge.ts. No projection-validation
      // branch needed for it anymore.
  }

  // POST /dispatches — propose
  fastify.post(
    '/dispatches',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = (req.body ?? {}) as Partial<ProposeDispatchInput> & { idempotencyKey?: string };
      if (!body.goal || typeof body.goal !== 'string') {
        return reply.code(400).send({ ok: false, error: "missing 'goal' string" });
      }
      if (!deps.workIntentService) {
        return missingWorkIntentService(reply);
      }
      try {
        const result = deps.workIntentService.captureDispatch({
          goal: body.goal,
          requestedBy: body.requestedBy ?? 'operator',
          mergePolicy: body.mergePolicy ?? 'review',
          baseBranch: body.baseBranch ?? 'main',
          projectDir: body.projectDir,
          targetActorId: body.targetActorId,
          reviewerActorId: body.reviewerActorId,
          backend: body.backend,
          budgetUsd: body.budgetUsd,
          timeoutMs: body.timeoutMs,
          tags: body.tags,
          idempotencyKey: idempotencyKey(req, body as Record<string, unknown>),
        }, dispatchQueue);
        return reply.code(result.append.duplicate ? 200 : 201).send({
          ok: true,
          dispatch: result.dispatch,
          workIntent: {
            intentId: result.intent.intentId,
            idempotencyKey: result.intent.idempotencyKey,
            duplicate: result.append.duplicate,
          },
        });
      } catch (err) {
        if (err instanceof WorkIntentMaterializationError) {
          const statusCode = isProjectionValidationError(err.message) ? 400 : 500;
          return reply.code(statusCode).send({
            ok: false,
            error:
              'WorkIntent captured but dispatch projection materialization failed; no spawn was started. ' +
              err.message,
            phase: 'dispatch_projection_materialization',
            workIntent: {
              intentId: err.intent.intentId,
              idempotencyKey: err.intent.idempotencyKey,
              duplicate: err.append.duplicate,
            },
          });
        }
        return reply.code(500).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // GET /dispatches — list with filters
  fastify.get(
    '/dispatches',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>;
      const opts: ListDispatchesOptions = {};
      if (q.state) opts.state = q.state as DispatchState;
      if (q.limit) {
        const n = Number(q.limit);
        if (Number.isFinite(n) && n > 0) opts.limit = Math.min(n, 500);
      }
      let dispatches = dispatchQueue.list(opts);
      if (q.requestedBy) {
        dispatches = dispatches.filter((d) => d.requestedBy === q.requestedBy);
      }
      return reply.send({ ok: true, dispatches, count: dispatches.length });
    },
  );

  // GET /dispatches/worker/status — is the daemon-side worker draining the queue?
  // MUST be registered before the `/:id` routes so the literal 'worker' segment
  // isn't swallowed by the `/dispatches/:id` param matcher.
  fastify.get('/dispatches/worker/status', async (_req, reply) => {
    if (!dispatchWorker) {
      return reply.send({ ok: true, worker: { running: false, enabled: false } });
    }
    return reply.send({ ok: true, worker: { enabled: true, ...dispatchWorker.getStatus() } });
  });

  // GET /dispatches/:id — single dispatch
  fastify.get<{ Params: { id: string } }>(
    '/dispatches/:id',
    async (req, reply) => {
      const dispatch = dispatchQueue.get(req.params.id);
      if (!dispatch) {
        return reply.code(404).send({ ok: false, error: `dispatch ${req.params.id} not found` });
      }
      return reply.send({ ok: true, dispatch });
    },
  );

  // POST /dispatches/:id/run — enqueue-and-return. The daemon worker auto-drains
  // `proposed` dispatches on its poll interval; this route NUDGES an immediate
  // poll so `pd dispatch run <id>` starts promptly, then returns — it does NOT
  // hold the request open for the (possibly hours-long) run. Honest degradation:
  // 503 when the worker is disabled, 409 when the dispatch isn't `proposed`.
  fastify.post<{ Params: { id: string } }>(
    '/dispatches/:id/run',
    async (req, reply) => {
      const dispatch = dispatchQueue.get(req.params.id);
      if (!dispatch) {
        return reply.code(404).send({ ok: false, error: `dispatch ${req.params.id} not found` });
      }
      if (!dispatchWorker) {
        return reply.code(503).send({
          ok: false,
          error:
            'dispatch worker is disabled (PD_DISPATCH_WORKER=false); ' +
            'run with `pd dispatch run <id> --foreground` or enable the worker',
          dispatch,
        });
      }
      // Only `proposed` dispatches are claimable. If already running/terminal,
      // report honestly rather than pretending we queued it.
      if (dispatch.state !== 'proposed') {
        return reply.code(409).send({
          ok: false,
          error: `dispatch is in state '${dispatch.state}'; only 'proposed' dispatches can be (re)queued`,
          dispatch,
        });
      }
      const ensured = ensureDispatchIntent(dispatch, reply);
      if (ensured !== true) return ensured;
      let launched = 0;
      try {
        launched = await dispatchWorker.poll();
      } catch { /* worker self-contains errors; the status route still reflects truth */ }
      const after = dispatchQueue.get(req.params.id) ?? dispatch;
      return reply.send({
        ok: true,
        queued: true,
        launchedThisTick: launched,
        dispatch: after,
        message:
          'Dispatch queued for daemon-side execution. It runs detached from this CLI; ' +
          'poll `pd dispatch show <id>` or `pd dispatch status <id>` for progress.',
      });
    },
  );

  // POST /dispatches/:id/accept — operator approval
  fastify.post<{ Params: { id: string }; Body?: { reviewerActorId?: string; note?: string } }>(
    '/dispatches/:id/accept',
    async (req, reply) => {
      try {
        const existing = dispatchQueue.get(req.params.id);
        if (!existing) throw new Error(`accept: dispatch ${req.params.id} not found`);
        const ensured = ensureDispatchIntent(existing, reply);
        if (ensured !== true) return ensured;
        const body = req.body ?? {};
        const dispatch = dispatchQueue.accept({
          id: req.params.id,
          note: body.note,
        });
        return reply.send({ ok: true, dispatch });
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // POST /dispatches/:id/reject — operator rejection w/ required reason
  fastify.post<{ Params: { id: string }; Body: { reason: string; reviewerActorId?: string } }>(
    '/dispatches/:id/reject',
    async (req, reply) => {
      const body = req.body ?? ({} as { reason: string });
      if (!body.reason || typeof body.reason !== 'string' || body.reason.trim().length < 3) {
        return reply.code(400).send({
          ok: false,
          error: "reject requires non-empty 'reason' (>=3 chars)",
        });
      }
      try {
        const existing = dispatchQueue.get(req.params.id);
        if (!existing) throw new Error(`reject: dispatch ${req.params.id} not found`);
        const ensured = ensureDispatchIntent(existing, reply);
        if (ensured !== true) return ensured;
        const dispatch = dispatchQueue.reject({
          id: req.params.id,
          reason: body.reason.trim(),
        });
        return reply.send({ ok: true, dispatch });
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // POST /dispatches/:id/cancel — operator cancel
  fastify.post<{ Params: { id: string }; Body?: { reason?: string } }>(
    '/dispatches/:id/cancel',
    async (req, reply) => {
      try {
        const existing = dispatchQueue.get(req.params.id);
        if (!existing) throw new Error(`cancel: dispatch ${req.params.id} not found`);
        const ensured = ensureDispatchIntent(existing, reply);
        if (ensured !== true) return ensured;
        const dispatch = dispatchQueue.cancel(req.params.id, req.body?.reason);
        return reply.send({ ok: true, dispatch });
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
};

export { dispatchesPlugin };
