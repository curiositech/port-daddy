/**
 * Fleet doctrine HTTP surface.
 *
 * All mutations append a Harbor doctrine-evidence event. In particular,
 * decision-time guidance is a POST because a retrieval receipt is evidence
 * that an agent actually saw an advisory packet; a GET would make that claim
 * impossible to audit.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseInstance } from '../lib/sqlite-runtime.js';
import {
  extractActorCredential,
  resolveWriteIdentity,
  type BoundaryLogger,
  type IdentityVerifier,
  type IdentityWriteVerdict,
} from '../lib/identity-write-boundary.js';
import {
  createDoctrineLedger,
  DoctrineNotFoundError,
  DoctrineStateError,
  DoctrineValidationError,
  type AdmitDoctrineInput,
  type DecisionEpisodeInput,
  type DoctrineApplicationInput,
  type DoctrineCandidateInput,
  type DoctrineContestInput,
  type DoctrineHarvestInput,
  type DoctrineOutcomeInput,
  type DoctrineRetrieveInput,
  type DoctrineRetireInput,
  type DoctrineSupersedeInput,
  type ExperimentInput,
  type TreatmentRunInput,
} from '../lib/doctrine.js';

interface DoctrineRouteDeps {
  deps: {
    db?: DatabaseInstance;
    /** All doctrine mutations are attributed writes, never anonymous claims. */
    actorSouls?: IdentityVerifier | null;
    logger?: BoundaryLogger;
  };
}

function statusFor(error: unknown): number {
  if (error instanceof DoctrineValidationError) return 400;
  if (error instanceof DoctrineNotFoundError) return 404;
  if (error instanceof DoctrineStateError) return 409;
  return 500;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function queryText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireLedger(deps: DoctrineRouteDeps['deps'], reply: FastifyReply) {
  if (!deps.db) {
    reply.code(503).send({ success: false, error: 'doctrine evidence ledger is not wired in this daemon' });
    return null;
  }
  return createDoctrineLedger(deps.db);
}

function recordBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Doctrine evidence is durable, attributed Harbor history.  Do not accept a
 * caller's `actorId` as evidence of who made it: require the daemon-minted
 * credential and replace both actor and admission-reviewer claims with the
 * verified principal before the ledger sees the request.
 */
function doctrineMutationInput<T>(
  deps: DoctrineRouteDeps['deps'],
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  options: { deriveReviewer?: boolean } = {},
): T | null {
  const body = recordBody(request.body);
  const headerAgent = request.headers['x-agent-id'];
  const assertedHeader = Array.isArray(headerAgent) ? headerAgent[0] : headerAgent;
  const assertedActor = typeof body.actorId === 'string' && body.actorId.trim()
    ? body.actorId.trim()
    : typeof assertedHeader === 'string' && assertedHeader.trim()
      ? assertedHeader.trim()
      : null;
  const verdict = resolveWriteIdentity({
    souls: deps.actorSouls,
    credential: extractActorCredential(request.headers as Record<string, unknown>, body),
    assertedAgentId: assertedActor,
    route,
    logger: deps.logger,
    requireIdentity: true,
  });
  if (verdict.ok === false) {
    reply.code(verdict.httpStatus).send({ success: false, error: verdict.error, code: verdict.code });
    return null;
  }
  const verified = verdict as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;
  // Never persist the bearer credential itself.  `actorId` and `reviewerId`
  // are server-derived, so a pdc request may omit either body claim entirely.
  const { credential: _credential, actorId: _assertedActor, reviewerId: _assertedReviewer, ...rest } = body;
  return {
    ...rest,
    actorId: verified.actorId,
    ...(options.deriveReviewer ? { reviewerId: verified.actorId } : {}),
  } as T;
}

function mutation<T>(reply: FastifyReply, action: () => T, status = 201): T | void {
  try {
    const result = action();
    return reply.code(status).send({ success: true, ...result as object }) as unknown as T;
  } catch (error) {
    return reply.code(statusFor(error)).send({ success: false, error: messageFor(error) }) as unknown as T;
  }
}

/** Canonical, advisory-only doctrine routes. */
export const doctrinePlugin: FastifyPluginAsync<DoctrineRouteDeps> = async (fastify, { deps }) => {
  fastify.get('/doctrine/status', async (_request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const candidates = ledger.listCandidates();
    const episodes = ledger.listEpisodes();
    return reply.send({
      success: true,
      advisory: true,
      canonicalStore: 'agent-harbor:doctrine-evidence',
      counts: {
        episodes: episodes.length,
        harvests: ledger.listHarvests().length,
        candidates: candidates.length,
        provisional: candidates.filter((candidate) => candidate.status === 'provisional').length,
        established: candidates.filter((candidate) => candidate.status === 'established').length,
        contested: candidates.filter((candidate) => candidate.status === 'contested').length,
        retired: candidates.filter((candidate) => candidate.status === 'retired').length,
      },
    });
  });

  fastify.get('/doctrine/candidates', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const query = request.query as Record<string, unknown>;
    const status = queryText(query.status);
    if (status && !['candidate', 'provisional', 'established', 'contested', 'retired'].includes(status)) {
      return reply.code(400).send({ success: false, error: 'invalid doctrine status' });
    }
    const candidates = ledger.listCandidates({
      ...(status ? { status: status as any } : {}),
      ...(queryText(query.projectDir) ? { projectDir: queryText(query.projectDir) } : {}),
      ...(queryText(query.decisionClass) ? { decisionClass: queryText(query.decisionClass) } : {}),
    });
    return reply.send({ success: true, advisory: true, candidates, count: candidates.length });
  });

  fastify.get('/doctrine/episodes', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const query = request.query as Record<string, unknown>;
    const episodes = ledger.listEpisodes({
      ...(queryText(query.projectDir) ? { projectDir: queryText(query.projectDir) } : {}),
      ...(queryText(query.decisionClass) ? { decisionClass: queryText(query.decisionClass) } : {}),
    });
    return reply.send({ success: true, episodes, count: episodes.length });
  });

  fastify.get('/doctrine/harvests', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const query = request.query as Record<string, unknown>;
    const harvests = ledger.listHarvests({
      ...(queryText(query.projectDir) ? { projectDir: queryText(query.projectDir) } : {}),
      ...(queryText(query.decisionClass) ? { decisionClass: queryText(query.decisionClass) } : {}),
    });
    return reply.send({ success: true, advisory: true, harvests, count: harvests.length });
  });

  fastify.get<{ Params: { id: string } }>('/doctrine/harvests/:id', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const harvest = ledger.getHarvest(request.params.id);
    if (!harvest) return reply.code(404).send({ success: false, error: 'doctrine harvest not found' });
    return reply.send({ success: true, advisory: true, harvest });
  });

  fastify.get<{ Params: { id: string } }>('/doctrine/experiments/:id', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const experiment = ledger.getExperiment(request.params.id);
    if (!experiment) return reply.code(404).send({ success: false, error: 'doctrine experiment not found' });
    return reply.send({ success: true, experiment });
  });

  fastify.get<{ Params: { id: string } }>('/doctrine/:id', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const detail = ledger.getDoctrine(request.params.id);
    if (!detail) return reply.code(404).send({ success: false, error: 'doctrine not found' });
    return reply.send({ success: true, advisory: true, ...detail });
  });

  fastify.post<{ Body: DecisionEpisodeInput }>('/doctrine/episodes', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const input = doctrineMutationInput<DecisionEpisodeInput>(deps, request, reply, 'POST /doctrine/episodes');
    if (!input) return;
    return mutation(reply, () => ({ episode: ledger.recordEpisode(input) }));
  });

  fastify.post<{ Body: DoctrineHarvestInput }>('/doctrine/harvests', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const input = doctrineMutationInput<DoctrineHarvestInput>(deps, request, reply, 'POST /doctrine/harvests');
    if (!input) return;
    return mutation(reply, () => ({ advisory: true as const, harvest: ledger.harvest(input) }));
  });

  fastify.post<{ Body: DoctrineCandidateInput }>('/doctrine/candidates', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const input = doctrineMutationInput<DoctrineCandidateInput>(deps, request, reply, 'POST /doctrine/candidates');
    if (!input) return;
    return mutation(reply, () => ({ candidate: ledger.proposeCandidate(input) }));
  });

  fastify.post<{ Body: ExperimentInput }>('/doctrine/experiments', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const input = doctrineMutationInput<ExperimentInput>(deps, request, reply, 'POST /doctrine/experiments');
    if (!input) return;
    return mutation(reply, () => ({ experiment: ledger.preregisterExperiment(input) }));
  });

  fastify.post<{ Params: { id: string }; Body: Omit<TreatmentRunInput, 'experimentId'> }>(
    '/doctrine/experiments/:id/runs',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      const input = doctrineMutationInput<Omit<TreatmentRunInput, 'experimentId'>>(
        deps,
        request,
        reply,
        'POST /doctrine/experiments/:id/runs',
      );
      if (!input) return;
      return mutation(reply, () => ({
        run: (() => {
          const recorded = ledger.recordTreatmentRun({ ...input, experimentId: request.params.id });
          return { ...recorded, arm: input.arm };
        })(),
      }));
    },
  );

  fastify.post<{ Params: { id: string }; Body: Omit<AdmitDoctrineInput, 'candidateId'> }>(
    '/doctrine/candidates/:id/admit',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      const input = doctrineMutationInput<Omit<AdmitDoctrineInput, 'candidateId'>>(
        deps,
        request,
        reply,
        'POST /doctrine/candidates/:id/admit',
        { deriveReviewer: true },
      );
      if (!input) return;
      return mutation(reply, () => ({ doctrine: ledger.admit({ ...input, candidateId: request.params.id }) }));
    },
  );

  fastify.post<{ Body: DoctrineRetrieveInput }>('/doctrine/orders', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const input = doctrineMutationInput<DoctrineRetrieveInput>(deps, request, reply, 'POST /doctrine/orders');
    if (!input) return;
    return mutation(reply, () => ledger.retrieve(input), 200);
  });

  fastify.post<{ Params: { id: string }; Body: Omit<DoctrineApplicationInput, 'retrievalId'> }>(
    '/doctrine/retrievals/:id/application',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      const input = doctrineMutationInput<Omit<DoctrineApplicationInput, 'retrievalId'>>(
        deps,
        request,
        reply,
        'POST /doctrine/retrievals/:id/application',
      );
      if (!input) return;
      return mutation(reply, () => ({
        application: ledger.recordApplication({ ...input, retrievalId: request.params.id }),
      }));
    },
  );

  fastify.post<{ Params: { id: string }; Body: Omit<DoctrineOutcomeInput, 'applicationId'> }>(
    '/doctrine/applications/:id/outcome',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      const input = doctrineMutationInput<Omit<DoctrineOutcomeInput, 'applicationId'>>(
        deps,
        request,
        reply,
        'POST /doctrine/applications/:id/outcome',
      );
      if (!input) return;
      return mutation(reply, () => ({
        outcome: ledger.recordOutcome({ ...input, applicationId: request.params.id }),
      }));
    },
  );

  fastify.post<{ Params: { id: string }; Body: Omit<DoctrineContestInput, 'doctrineId'> }>(
    '/doctrine/:id/contest',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      const input = doctrineMutationInput<Omit<DoctrineContestInput, 'doctrineId'>>(
        deps,
        request,
        reply,
        'POST /doctrine/:id/contest',
      );
      if (!input) return;
      return mutation(reply, () => ({
        contest: ledger.contest({ ...input, doctrineId: request.params.id }),
      }));
    },
  );

  fastify.post<{ Params: { id: string }; Body: Omit<DoctrineSupersedeInput, 'doctrineId'> }>(
    '/doctrine/:id/supersede',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      const input = doctrineMutationInput<Omit<DoctrineSupersedeInput, 'doctrineId'>>(
        deps,
        request,
        reply,
        'POST /doctrine/:id/supersede',
      );
      if (!input) return;
      return mutation(reply, () => ({
        advisory: true as const,
        supersession: ledger.supersede({ ...input, doctrineId: request.params.id }),
      }));
    },
  );

  fastify.post<{ Params: { id: string }; Body: Omit<DoctrineRetireInput, 'doctrineId'> }>(
    '/doctrine/:id/retire',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      const input = doctrineMutationInput<Omit<DoctrineRetireInput, 'doctrineId'>>(
        deps,
        request,
        reply,
        'POST /doctrine/:id/retire',
      );
      if (!input) return;
      return mutation(reply, () => ({
        advisory: true as const,
        retirement: ledger.retire({ ...input, doctrineId: request.params.id }),
      }));
    },
  );
};
