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
import {
  extractActorCredential,
  resolveWriteIdentity,
  type BoundaryLogger,
  type IdentityWriteVerdict,
  type IdentityVerifier,
} from '../lib/identity-write-boundary.js';

interface QuorumDeps {
  quorum: Quorum;
  /** Daemon-minted actor verifier shared by all attributed write routes. */
  actorSouls?: (IdentityVerifier & {
    constants?: { defaultHarbor?: string };
  }) | null;
  logger?: BoundaryLogger;
}

interface ProposeBody {
  role?: unknown;
  reason?: unknown;
  threshold?: unknown;
  proposedBy?: unknown;
  as?: unknown;
  harbor?: unknown;
  autoSpawn?: unknown;
  ttlMs?: unknown;
}

interface VoteBody {
  proposalId?: unknown;
  voterId?: unknown;
  as?: unknown;
  stance?: unknown;
  weight?: unknown;
}

function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const canonical = v.trim();
  return canonical.length > 0 ? canonical : undefined;
}

function asPosInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export const quorumPlugin: FastifyPluginAsync<{ deps: QuorumDeps }> = async (fastify, opts) => {
  const { quorum, actorSouls, logger } = opts.deps;

  fastify.post('/quorum/propose', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as ProposeBody;
    const role = asString(body.role);
    const reason = asString(body.reason);
    const harbor = asString(body.harbor);
    const threshold = asPosInt(body.threshold);
    if (!role || !reason || threshold === undefined) {
      reply.code(400);
      return {
        success: false,
        error: 'role, reason, and threshold (integer >= 1) are required',
      };
    }
    if (body.harbor !== undefined && !harbor) {
      reply.code(400);
      return {
        success: false,
        error: 'harbor must be a non-empty canonical tenant name if provided',
        code: 'QUORUM_HARBOR_INVALID',
      };
    }
    if (body.proposedBy !== undefined || body.as !== undefined) {
      reply.code(400);
      return {
        success: false,
        error: 'proposal identity is derived from the actor credential; proposedBy/as overrides are forbidden',
        code: 'QUORUM_IDENTITY_OVERRIDE_FORBIDDEN',
      };
    }

    const defaultHarbor = asString(actorSouls?.constants?.defaultHarbor);
    const proposalHarbor = harbor ?? defaultHarbor;
    if (!proposalHarbor) {
      reply.code(503);
      return {
        success: false,
        error: 'actor identity verifier is unavailable',
        code: 'IDENTITY_VERIFIER_UNAVAILABLE',
      };
    }

    const identity = resolveWriteIdentity({
      souls: actorSouls,
      credential: extractActorCredential(request.headers as Record<string, unknown>, request.body),
      assertedAgentId: null,
      route: 'POST /quorum/propose',
      // Canonicalize exactly once, then use the same tenant for credential
      // verification and durable tuple persistence.
      harbor: proposalHarbor,
      logger,
      requireIdentity: true,
    });
    if (!identity.ok) {
      reply.code(identity.httpStatus);
      return { success: false, error: identity.error, code: identity.code };
    }
    const verifiedIdentity = identity as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;

    const input: ProposeInput = {
      role,
      reason,
      threshold,
      // Credential-derived canonical actor; request-body identity fields are
      // rejected above and never reach durable state.
      proposedBy: verifiedIdentity.actorId,
      // Authority and storage share one durable tenant. A proposal cannot be
      // authenticated in one harbor and persisted into another.
      authorityHarbor: proposalHarbor,
      harbor: proposalHarbor,
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
    const stanceRaw = asString(body.stance);
    if (!proposalId || !stanceRaw) {
      reply.code(400);
      return { success: false, error: 'proposalId and stance are required' };
    }
    if (stanceRaw !== 'yes' && stanceRaw !== 'no' && stanceRaw !== 'abstain') {
      reply.code(400);
      return { success: false, error: 'stance must be one of: yes, no, abstain' };
    }
    if (body.voterId !== undefined || body.as !== undefined) {
      reply.code(400);
      return {
        success: false,
        error: 'voter identity is derived from the actor credential; voterId/as overrides are forbidden',
        code: 'QUORUM_IDENTITY_OVERRIDE_FORBIDDEN',
      };
    }
    const stance: QuorumStance = stanceRaw;
    const proposalStatus = quorum.getStatusById(proposalId);
    if (!proposalStatus) {
      reply.code(404);
      return { success: false, error: `proposal '${proposalId}' not found` };
    }
    const durableAuthorityHarbor = proposalStatus.proposal.authorityHarbor;
    if (
      proposalStatus.proposal.authorityVersion !== 1
      || typeof durableAuthorityHarbor !== 'string'
      || !durableAuthorityHarbor
      || durableAuthorityHarbor !== durableAuthorityHarbor.trim()
      || proposalStatus.proposal.harbor !== durableAuthorityHarbor
    ) {
      reply.code(409);
      return {
        success: false,
        error: 'proposal has no current durable actor authority and cannot accept authenticated votes',
        code: 'QUORUM_AUTHORITY_SCOPE_MISSING',
      };
    }
    const identity = resolveWriteIdentity({
      souls: actorSouls,
      credential: extractActorCredential(request.headers as Record<string, unknown>, request.body),
      assertedAgentId: null,
      route: 'POST /quorum/vote',
      // A vote inherits its tenant from the durable proposal. The caller has
      // no vote-time harbor field with which to redirect credential checks.
      harbor: durableAuthorityHarbor,
      logger,
      requireIdentity: true,
    });
    if (!identity.ok) {
      reply.code(identity.httpStatus);
      return { success: false, error: identity.error, code: identity.code };
    }
    const verifiedIdentity = identity as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;

    if (body.weight !== undefined) {
      reply.code(400);
      return {
        success: false,
        error: 'vote weight is assigned by the server; caller overrides are forbidden',
        code: 'VOTE_WEIGHT_OVERRIDE_FORBIDDEN',
      };
    }
    // Canonical actor ID is the sole voting key. Display aliases and caller
    // body values can neither create another ballot, replace attribution, nor
    // grant voting power. Omitting weight selects the trusted internal default
    // of one; weighted votes remain a direct-module primitive only.
    const input: VoteInput = { proposalId, voterId: verifiedIdentity.actorId, stance };
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
