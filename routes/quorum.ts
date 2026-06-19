/**
 * Quorum Routes — `/quorum/*`
 *
 * HTTP wrapper over `lib/quorum.ts`. Exposes the propose/vote/list/get
 * primitives so agents (and the dashboard) can drive consensus across
 * the swarm.
 *
 * Phase 1 surface:
 *   POST   /quorum/propose         — propose a role; returns proposal
 *   POST   /quorum/vote            — record a vote; auto-marks passed
 *   GET    /quorum/proposals       — list active proposals (harbor scope)
 *   GET    /quorum/proposals/:id   — full status (votes, tally, passed)
 *
 * Phase 2 (separate slice): the fleet daemon will subscribe to
 * `quorum:passed` tuples and auto-spawn declared `spawnable_roles:`.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Quorum, ProposeInput, VoteInput, QuorumStance } from '../lib/quorum.js';

interface QuorumDeps {
  quorum: Quorum;
}

interface ProposeBody {
  role?: unknown;
  reason?: unknown;
  threshold?: unknown;
  proposedBy?: unknown;
  harbor?: unknown;
  autoSpawn?: unknown;
  ttlMs?: unknown;
}

interface VoteBody {
  proposalId?: unknown;
  voterId?: unknown;
  stance?: unknown;
  weight?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asPosInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export const quorumPlugin: FastifyPluginAsync<{ deps: QuorumDeps }> = async (fastify, opts) => {
  const { quorum } = opts.deps;

  fastify.post('/quorum/propose', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as ProposeBody;
    const role = asString(body.role);
    const reason = asString(body.reason);
    const proposedBy = asString(body.proposedBy);
    const threshold = asPosInt(body.threshold);
    if (!role || !reason || !proposedBy || threshold === undefined) {
      reply.code(400);
      return {
        success: false,
        error: 'role, reason, proposedBy, and threshold (integer >= 1) are required',
      };
    }
    const input: ProposeInput = {
      role,
      reason,
      threshold,
      proposedBy,
      harbor: asString(body.harbor),
      autoSpawn: body.autoSpawn === true,
      ttlMs: typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) ? body.ttlMs : undefined,
    };
    try {
      const proposal = quorum.propose(input);
      return { success: true, proposal };
    } catch (error) {
      reply.code(400);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'propose failed',
      };
    }
  });

  fastify.post('/quorum/vote', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as VoteBody;
    const proposalId = asString(body.proposalId);
    const voterId = asString(body.voterId);
    const stanceRaw = asString(body.stance);
    if (!proposalId || !voterId || !stanceRaw) {
      reply.code(400);
      return { success: false, error: 'proposalId, voterId, and stance are required' };
    }
    if (stanceRaw !== 'yes' && stanceRaw !== 'no' && stanceRaw !== 'abstain') {
      reply.code(400);
      return { success: false, error: 'stance must be one of: yes, no, abstain' };
    }
    const stance: QuorumStance = stanceRaw;
    const weight = typeof body.weight === 'number' && Number.isFinite(body.weight) && body.weight >= 0
      ? body.weight
      : undefined;
    const input: VoteInput = { proposalId, voterId, stance, weight };
    try {
      const vote = quorum.vote(input);
      const status = quorum.getStatusById(proposalId);
      return { success: true, vote, status };
    } catch (error) {
      reply.code(400);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'vote failed',
      };
    }
  });

  fastify.get('/quorum/proposals', async (request: FastifyRequest, _reply: FastifyReply) => {
    const q = request.query as Record<string, unknown>;
    const harbor = asString(q.harbor);
    const limit = asPosInt(q.limit) ?? 50;
    const proposals = quorum.listProposals({ harbor, limit });
    return { success: true, proposals, count: proposals.length };
  });

  fastify.get('/quorum/proposals/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id?: string };
    const proposalId = asString(params.id);
    if (!proposalId) {
      reply.code(400);
      return { success: false, error: 'proposal id required in path' };
    }
    const status = quorum.getStatusById(proposalId);
    if (!status) {
      reply.code(404);
      return { success: false, error: `proposal '${proposalId}' not found` };
    }
    return { success: true, status };
  });
};
