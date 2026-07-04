/**
 * Fleet HITL proposal routes.
 *
 * Ships submit proposals here; operator apps approve or reject them here. The
 * create route is inert by design: it never spawns an agent or writes a branch.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  buildFleetProposalDispatchGoal,
  createFleetProposalStore,
  FLEET_PROPOSAL_STATUSES,
  FleetProposalDuplicateError,
  FleetProposalNotFoundError,
  FleetProposalQueueFullError,
  FleetProposalStateError,
  FleetProposalValidationError,
  type CreateFleetProposalInput,
  type FleetProposal,
  type FleetProposalStatus,
  type FleetProposalStore,
} from '../lib/fleet-hitl-proposals.js';
import type { DispatchQueue } from '../lib/dispatch/queue.js';
import type Database from 'better-sqlite3';

interface FleetHitlProposalRouteDeps {
  deps: {
    db?: Database.Database;
    fleetProposals?: FleetProposalStore;
    dispatchQueue?: DispatchQueue;
    now?: () => number;
  };
}

function parseLimit(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 500) : undefined;
}

function parsePrNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

/**
 * Map store errors to honest HTTP codes: caller mistakes are 4xx with the
 * precise class (400 validation, 404 unknown id, 409 state/duplicate conflict,
 * 429 queue full); anything unrecognized is a 500, not a mislabelled 400.
 */
function statusCodeFor(err: unknown): number {
  if (err instanceof FleetProposalValidationError) return 400;
  if (err instanceof FleetProposalNotFoundError) return 404;
  if (err instanceof FleetProposalStateError) return 409;
  if (err instanceof FleetProposalDuplicateError) return 409;
  if (err instanceof FleetProposalQueueFullError) return 429;
  return 500;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function requireStore(
  deps: FleetHitlProposalRouteDeps['deps'],
  reply: FastifyReply,
): FleetProposalStore | null {
  if (deps.fleetProposals) return deps.fleetProposals;
  if (deps.db) {
    deps.fleetProposals = createFleetProposalStore({ db: deps.db, now: deps.now });
    return deps.fleetProposals;
  }
  reply.code(503).send({ success: false, error: 'fleet proposal store not wired' });
  return null;
}

export const fleetHitlProposalsPlugin: FastifyPluginAsync<FleetHitlProposalRouteDeps> = async (
  fastify,
  { deps },
) => {
  fastify.post('/fleet-proposals', async (request: FastifyRequest, reply: FastifyReply) => {
    const store = requireStore(deps, reply);
    if (!store) return;
    try {
      const proposal = store.create((request.body ?? {}) as CreateFleetProposalInput);
      return reply.code(201).send({
        success: true,
        proposal,
        pendingCount: store.pendingCount(),
      });
    } catch (err) {
      return reply.code(statusCodeFor(err)).send({
        success: false,
        error: errorMessage(err),
      });
    }
  });

  fastify.get('/fleet-proposals', async (request: FastifyRequest, reply: FastifyReply) => {
    const store = requireStore(deps, reply);
    if (!store) return;
    const q = (request.query ?? {}) as Record<string, string | undefined>;
    const status = q.status as FleetProposalStatus | 'all' | undefined;
    if (status !== undefined && status !== 'all' && !FLEET_PROPOSAL_STATUSES.includes(status)) {
      return reply.code(400).send({
        success: false,
        error: `invalid status '${status}' (expected ${[...FLEET_PROPOSAL_STATUSES, 'all'].join('|')})`,
      });
    }
    const proposals = store.list({
      status,
      limit: parseLimit(q.limit),
      sourceShip: q.sourceShip,
      repoFullName: q.repoFullName,
      prNumber: parsePrNumber(q.prNumber),
    });
    return reply.send({
      success: true,
      proposals,
      count: proposals.length,
      pendingCount: store.pendingCount(),
    });
  });

  fastify.get<{ Params: { id: string } }>(
    '/fleet-proposals/:id',
    async (request, reply) => {
      const store = requireStore(deps, reply);
      if (!store) return;
      const proposal = store.get(request.params.id);
      if (!proposal) {
        return reply.code(404).send({ success: false, error: `proposal ${request.params.id} not found` });
      }
      return reply.send({ success: true, proposal });
    },
  );

  fastify.post<{ Params: { id: string }; Body?: { decidedBy?: string; note?: string; dispatch?: boolean } }>(
    '/fleet-proposals/:id/approve',
    async (request, reply) => {
      const store = requireStore(deps, reply);
      if (!store) return;
      let proposal: FleetProposal;
      try {
        const body = request.body ?? {};
        proposal = store.approve({
          id: request.params.id,
          decidedBy: body.decidedBy,
          note: body.note,
        });
      } catch (err) {
        return reply.code(statusCodeFor(err)).send({
          success: false,
          error: errorMessage(err),
        });
      }
      let dispatch = null;
      const shouldDispatch = (request.body ?? {}).dispatch !== false;
      if (shouldDispatch) {
        if (!deps.dispatchQueue) {
          return reply.code(503).send({
            success: false,
            error: 'dispatch queue not wired; proposal approved but no specialist was assigned',
            proposal,
          });
        }
        try {
          dispatch = deps.dispatchQueue.propose({
            goal: proposal.dispatchGoal ?? buildFleetProposalDispatchGoal(proposal),
            tags: ['fleet-proposal', proposal.sourceShip],
            requestedBy: `fleet-proposal:${proposal.sourceShip}`,
            targetActorId: proposal.targetSpecialist ?? undefined,
            reviewerActorId: 'operator',
            baseBranch: proposal.baseBranch,
            budgetUsd: proposal.budgetUsd ?? undefined,
            mergePolicy: 'review',
          });
          proposal = store.markDispatched({ id: proposal.id, dispatchId: dispatch.id });
        } catch (err) {
          // Approval persisted but the dispatch handoff failed. Surface the
          // approved proposal so the caller knows a retry of approve will
          // re-attempt only the dispatch step (approve is idempotent).
          const code = err instanceof FleetProposalStateError ? 409 : 500;
          return reply.code(code).send({
            success: false,
            error: `proposal approved but dispatch handoff failed: ${errorMessage(err)}`,
            proposal,
          });
        }
      }
      return reply.send({
        success: true,
        proposal,
        dispatch,
        pendingCount: store.pendingCount(),
      });
    },
  );

  fastify.post<{ Params: { id: string }; Body?: { decidedBy?: string; reason?: string; note?: string } }>(
    '/fleet-proposals/:id/reject',
    async (request, reply) => {
      const store = requireStore(deps, reply);
      if (!store) return;
      try {
        const body = request.body ?? {};
        const proposal = store.reject({
          id: request.params.id,
          decidedBy: body.decidedBy,
          note: body.reason ?? body.note,
        });
        return reply.send({
          success: true,
          proposal,
          pendingCount: store.pendingCount(),
        });
      } catch (err) {
        return reply.code(statusCodeFor(err)).send({
          success: false,
          error: errorMessage(err),
        });
      }
    },
  );
};
