import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { IdentityVerifier } from '../lib/identity-write-boundary.js';
import { extractActorCredential, resolveWriteIdentity } from '../lib/identity-write-boundary.js';
import {
  DurableOwnershipError,
  type DurableTakeoverGrantView,
  type DurableOwnershipService,
  type OwnershipProjection,
  type VerifiedOwnershipActor,
} from '../lib/durable-ownership.js';

interface DurableOwnershipRouteDeps {
  durableOwnership: DurableOwnershipService;
  actorSouls: IdentityVerifier & { constants?: { defaultHarbor?: string } };
  logger?: {
    info(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, metadata?: Record<string, unknown>): void;
  };
}

function bodyObject(request: FastifyRequest): Record<string, unknown> {
  return request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

function headerAgentId(request: FastifyRequest): string | null {
  const header = request.headers['x-agent-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function verifiedActor(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: DurableOwnershipRouteDeps,
  route: string,
  harbor: string,
): VerifiedOwnershipActor | null {
  const body = bodyObject(request);
  if (body.agentId !== undefined && (typeof body.agentId !== 'string' || !body.agentId.trim())) {
    reply.code(400).send({ success: false, code: 'VALIDATION_ERROR', error: 'agentId must be a non-empty string' });
    return null;
  }
  const verdict = resolveWriteIdentity({
    souls: deps.actorSouls,
    credential: extractActorCredential(request.headers as Record<string, unknown>, body),
    assertedAgentId: typeof body.agentId === 'string' ? body.agentId.trim() : headerAgentId(request),
    route,
    harbor,
    logger: deps.logger,
    requireIdentity: true,
  });
  if (!verdict.ok) {
    reply.code(verdict.httpStatus).send({ success: false, code: verdict.code, error: verdict.error });
    return null;
  }
  if (verdict.kind !== 'verified') {
    reply.code(401).send({
      success: false,
      code: 'IDENTITY_CREDENTIAL_REQUIRED',
      error: 'durable ownership actions require a verified actor credential',
    });
    return null;
  }
  return { actorId: verdict.actorId, soulClass: verdict.soulClass };
}

function rejectUnknownField(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  const allowedSet = new Set(allowed);
  return Object.keys(body).find(field => !allowedSet.has(field)) ?? null;
}

function harborFrom(
  value: unknown,
  deps: DurableOwnershipRouteDeps,
): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const fallback = deps.actorSouls.constants?.defaultHarbor?.trim();
  if (fallback) return fallback;
  throw new DurableOwnershipError('harbor is required', 'VALIDATION_ERROR', 400);
}

function sendOwnershipError(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof DurableOwnershipError) {
    reply.code(error.statusCode);
    return { success: false, code: error.code, error: error.message };
  }
  reply.code(500);
  return { success: false, code: 'INTERNAL_ERROR', error: 'internal server error' };
}

function grantStatus(view: DurableTakeoverGrantView) {
  return {
    grantId: view.grant.grantId,
    roadmapSlug: view.grant.roadmapSlug,
    harbor: view.grant.harbor,
    sourceSessionId: view.grant.sourceSessionId,
    successorSessionId: view.grant.successorSessionId,
    state: view.state,
    issuedAt: view.grant.issuedAt,
    expiresAt: view.grant.expiresAt,
    consumedAt: view.consumedAt,
    consumedEpochId: view.consumedEpochId,
    receipts: view.receipts.map(receipt => ({
      receiptId: receipt.receiptId,
      kind: receipt.kind,
      at: receipt.at,
      contentHash: receipt.contentHash,
      signature: receipt.signature,
    })),
  };
}

function ownershipStatus(projection: OwnershipProjection) {
  const current = projection.currentEpoch;
  return {
    roadmapItemId: projection.roadmapItemId,
    roadmapSlug: projection.roadmapSlug,
    currentOwner: projection.currentOwner,
    currentState: projection.currentState,
    currentEpoch: current ? {
      epochId: current.epochId,
      epochNumber: current.epochNumber,
      ownerAgentNodeId: current.ownerAgentNodeId,
      cause: current.cause,
      reason: current.reason,
      createdAt: current.createdAt,
      claimSetHash: current.claimSetHash,
      claims: current.claimBindings.map(claim => ({
        claimNodeId: claim.claimNodeId,
        filePath: claim.filePath,
        selectorKind: claim.selectorKind,
        disposition: claim.disposition,
        contentHash: claim.contentHash,
      })),
    } : null,
    priorOwners: projection.priorOwners,
    activeGrantId: projection.activeGrantId,
  };
}

function issuedGrantResult(result: Awaited<ReturnType<DurableOwnershipService['prepareTakeover']>>) {
  const grant = result.grant;
  return {
    success: true,
    grant: {
      grantId: grant.grantId,
      roadmapSlug: grant.roadmapSlug,
      harbor: grant.harbor,
      predecessorEpochId: grant.predecessorEpochId,
      predecessorAgentNodeId: grant.predecessorAgentNodeId,
      successorAgentNodeId: grant.successorAgentNodeId,
      authorityKind: grant.authorityKind,
      operatorPresenceReceipt: grant.operatorPresenceReceipt,
      sourceSessionId: grant.sourceSessionId,
      successorSessionId: grant.successorSessionId,
      claimBindings: grant.claimBindings,
      briefing: grant.briefing,
      issuedAt: grant.issuedAt,
      expiresAt: grant.expiresAt,
      contentHash: grant.contentHash,
      signature: grant.signature,
    },
    nonce: result.nonce,
    receipt: result.receipt,
  };
}

/**
 * Roadmap ownership and grant routes. These are thin transport adapters over
 * the single daemon coordinator; no request-carried identity, claim snapshot,
 * worktree tuple, or briefing can cross the authority boundary.
 */
export const durableOwnershipPlugin: FastifyPluginAsync<{ deps: DurableOwnershipRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;

  fastify.get('/roadmap/items/:slug/ownership', async (request, reply) => {
    try {
      const slug = String((request.params as { slug?: unknown }).slug ?? '');
      const harbor = harborFrom((request.query as { harbor?: unknown } | undefined)?.harbor, deps);
      const actor = verifiedActor(request, reply, deps, 'GET /roadmap/items/:slug/ownership', harbor);
      if (!actor) return reply;
      return { success: true, ownership: ownershipStatus(deps.durableOwnership.getProjection(slug, harbor)) };
    } catch (error) {
      return sendOwnershipError(reply, error);
    }
  });

  fastify.get('/takeover-grants/:grantId', async (request, reply) => {
    const grantId = String((request.params as { grantId?: unknown }).grantId ?? '');
    const grant = deps.durableOwnership.getGrant(grantId);
    if (!grant) {
      reply.code(404);
      return { success: false, code: 'GRANT_NOT_FOUND', error: 'takeover grant not found' };
    }
    const queryHarbor = (request.query as { harbor?: unknown } | undefined)?.harbor;
    if (queryHarbor !== undefined && harborFrom(queryHarbor, deps) !== grant.grant.harbor) {
      reply.code(409);
      return { success: false, code: 'GRANT_BINDING_MISMATCH', error: 'requested harbor does not match the signed grant' };
    }
    const actor = verifiedActor(request, reply, deps, 'GET /takeover-grants/:grantId', grant.grant.harbor);
    if (!actor) return reply;
    if (actor.actorId !== grant.grant.authorizedActorId && actor.actorId !== grant.grant.successorActorId) {
      reply.code(403);
      return { success: false, code: 'AUTHORITY_REQUIRED', error: 'actor is not a party to this takeover grant' };
    }
    return { success: true, grant: grantStatus(grant) };
  });

  fastify.post('/roadmap/items/:slug/ownership/bootstrap', async (request, reply) => {
    const body = bodyObject(request);
    const unknown = rejectUnknownField(body, ['harbor', 'sourceSessionId', 'reason', 'agentId', 'credential']);
    if (unknown) {
      reply.code(400);
      return {
        success: false,
        code: 'UNKNOWN_FIELD',
        error: `${unknown} is not accepted by this action`,
      };
    }
    const harbor = harborFrom(body.harbor, deps);
    const actor = verifiedActor(request, reply, deps, 'POST /roadmap/items/:slug/ownership/bootstrap', harbor);
    if (!actor) return reply;
    try {
      const result = await deps.durableOwnership.bootstrapCanonical({
        roadmapSlug: String((request.params as { slug?: unknown }).slug ?? ''),
        harbor,
        sourceSessionId: typeof body.sourceSessionId === 'string' ? body.sourceSessionId : '',
        reason: typeof body.reason === 'string' ? body.reason : '',
      }, actor);
      return { success: true, ...result };
    } catch (error) {
      return sendOwnershipError(reply, error);
    }
  });

  fastify.post('/roadmap/items/:slug/takeovers', async (request, reply) => {
    const body = bodyObject(request);
    const unknown = rejectUnknownField(body, [
      'harbor', 'successorSessionId', 'reason', 'claimDispositions', 'ttlMs',
      'operatorPresenceProof', 'agentId', 'credential',
    ]);
    if (unknown) {
      reply.code(400);
      return {
        success: false,
        code: 'UNKNOWN_FIELD',
        error: `${unknown} is not accepted by this action`,
      };
    }
    const harbor = harborFrom(body.harbor, deps);
    const actor = verifiedActor(request, reply, deps, 'POST /roadmap/items/:slug/takeovers', harbor);
    if (!actor) return reply;
    try {
      const result = await deps.durableOwnership.prepareTakeover({
        roadmapSlug: String((request.params as { slug?: unknown }).slug ?? ''),
        harbor,
        successorSessionId: typeof body.successorSessionId === 'string' ? body.successorSessionId : '',
        reason: typeof body.reason === 'string' ? body.reason : '',
        claimDispositions: Array.isArray(body.claimDispositions)
          ? body.claimDispositions as Array<{ claimNodeId: string; disposition: 'transfer' | 'release' }>
          : body.claimDispositions as never,
        ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : undefined,
        operatorPresenceProof: typeof body.operatorPresenceProof === 'string'
          ? body.operatorPresenceProof
          : undefined,
      }, actor);
      deps.logger?.info('durable_takeover_grant_issued', {
        grantId: result.grant.grantId,
        predecessorAgentNodeId: result.grant.predecessorAgentNodeId,
        successorAgentNodeId: result.grant.successorAgentNodeId,
      });
      return issuedGrantResult(result);
    } catch (error) {
      deps.logger?.error('durable_takeover_grant_rejected', {
        error: error instanceof Error ? error.message : String(error),
      });
      return sendOwnershipError(reply, error);
    }
  });
};

export default durableOwnershipPlugin;
