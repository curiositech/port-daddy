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
  type CreateFleetProposalInput,
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
      return reply.code(400).send({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  fastify.get('/fleet-proposals', async (request: FastifyRequest, reply: FastifyReply) => {
    const store = requireStore(deps, reply);
    if (!store) return;
    const q = (request.query ?? {}) as Record<string, string | undefined>;
    const status = q.status as FleetProposalStatus | 'all' | undefined;
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
      try {
        const body = request.body ?? {};
        let proposal = store.approve({
          id: request.params.id,
          decidedBy: body.decidedBy,
          note: body.note,
        });
        let dispatch = null;
        const shouldDispatch = body.dispatch !== false;
        if (shouldDispatch) {
          if (!deps.dispatchQueue) {
            return reply.code(503).send({
              success: false,
              error: 'dispatch queue not wired; proposal approved but no specialist was assigned',
              proposal,
            });
          }
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
        }
        return reply.send({
          success: true,
          proposal,
          dispatch,
          pendingCount: store.pendingCount(),
        });
      } catch (err) {
        return reply.code(400).send({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
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
        return reply.code(400).send({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
};
