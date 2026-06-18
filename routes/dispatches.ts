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
} from '../lib/dispatch/queue.js';

interface DispatchWorkerHandle {
  getStatus(): {
    running: boolean;
    inFlight: number;
    maxConcurrency: number;
    pollIntervalMs: number;
    startedAt: number | null;
    totalClaimed: number;
    totalSettled: number;
    totalFailed: number;
  };
  /** Kick an immediate poll so a just-proposed dispatch starts without waiting a full interval. */
  poll(): Promise<number>;
}

interface DispatchesRouteDeps {
  deps: {
    dispatchQueue: DispatchQueue;
    /** Daemon-side worker that drains the queue. Absent when PD_DISPATCH_WORKER=false. */
    dispatchWorker?: DispatchWorkerHandle | null;
  };
}

const dispatchesPlugin: FastifyPluginAsync<DispatchesRouteDeps> = async (
  fastify,
  { deps },
) => {
  const { dispatchQueue, dispatchWorker } = deps;

  // POST /dispatches — propose
  fastify.post(
    '/dispatches',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = (req.body ?? {}) as Partial<ProposeDispatchInput>;
      if (!body.goal || typeof body.goal !== 'string') {
        return reply.code(400).send({ ok: false, error: "missing 'goal' string" });
      }
      try {
        const dispatch = dispatchQueue.propose({
          goal: body.goal,
          requestedBy: body.requestedBy ?? 'operator',
          mergePolicy: body.mergePolicy ?? 'review',
          baseBranch: body.baseBranch ?? 'main',
          targetActorId: body.targetActorId,
          reviewerActorId: body.reviewerActorId,
          backend: body.backend,
          budgetUsd: body.budgetUsd,
          timeoutMs: body.timeoutMs,
        });
        return reply.code(201).send({ ok: true, dispatch });
      } catch (err) {
        return reply.code(400).send({
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

  // POST /dispatches/:id/accept — operator approval
  fastify.post<{ Params: { id: string }; Body?: { reviewerActorId?: string; note?: string } }>(
    '/dispatches/:id/accept',
    async (req, reply) => {
      try {
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

  // GET /dispatches/worker/status — is the daemon-side worker draining the queue?
  // Mounted before the /:id routes so 'worker' isn't swallowed by /:id.
  fastify.get('/dispatches/worker/status', async (_req, reply) => {
    if (!dispatchWorker) {
      return reply.send({ ok: true, worker: { running: false, enabled: false } });
    }
    return reply.send({ ok: true, worker: { enabled: true, ...dispatchWorker.getStatus() } });
  });

  // POST /dispatches/:id/run — enqueue-and-return. This is the daemon-driven
  // default for `pd dispatch run <id>`: the dispatch is already `proposed` (or
  // gets reset to it), so the daemon worker will claim and run it server-side,
  // DETACHED from the CLI. We nudge an immediate poll so it starts promptly, then
  // return — we do NOT hold the request open for the (possibly hours-long) run.
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
      // Nudge the worker to pick it up now rather than on the next interval.
      let launched = 0;
      try {
        launched = await dispatchWorker.poll();
      } catch { /* worker self-contains errors; status route still reflects truth */ }
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

  // POST /dispatches/:id/cancel — operator cancel
  fastify.post<{ Params: { id: string }; Body?: { reason?: string } }>(
    '/dispatches/:id/cancel',
    async (req, reply) => {
      try {
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
