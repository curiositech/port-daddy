/**
 * Fleet doctrine HTTP surface.
 *
 * All mutations append a Harbor doctrine-evidence event. In particular,
 * decision-time guidance is a POST because a retrieval receipt is evidence
 * that an agent actually saw an advisory packet; a GET would make that claim
 * impossible to audit.
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { DatabaseInstance } from '../lib/sqlite-runtime.js';
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
  type DoctrineOutcomeInput,
  type DoctrineRetrieveInput,
  type ExperimentInput,
  type TreatmentRunInput,
} from '../lib/doctrine.js';

interface DoctrineRouteDeps {
  deps: { db?: DatabaseInstance };
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
        candidates: candidates.length,
        provisional: candidates.filter((candidate) => candidate.status === 'provisional').length,
        established: candidates.filter((candidate) => candidate.status === 'established').length,
        contested: candidates.filter((candidate) => candidate.status === 'contested').length,
      },
    });
  });

  fastify.get('/doctrine/candidates', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    const query = request.query as Record<string, unknown>;
    const status = queryText(query.status);
    if (status && !['candidate', 'provisional', 'established', 'contested', 'deprecated'].includes(status)) {
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
    return mutation(reply, () => ({ episode: ledger.recordEpisode(request.body) }));
  });

  fastify.post<{ Body: DoctrineCandidateInput }>('/doctrine/candidates', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    return mutation(reply, () => ({ candidate: ledger.proposeCandidate(request.body) }));
  });

  fastify.post<{ Body: ExperimentInput }>('/doctrine/experiments', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    return mutation(reply, () => ({ experiment: ledger.preregisterExperiment(request.body) }));
  });

  fastify.post<{ Params: { id: string }; Body: Omit<TreatmentRunInput, 'experimentId'> }>(
    '/doctrine/experiments/:id/runs',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      return mutation(reply, () => ({
        treatmentRun: ledger.recordTreatmentRun({ ...request.body, experimentId: request.params.id }),
      }));
    },
  );

  fastify.post<{ Params: { id: string }; Body: Omit<AdmitDoctrineInput, 'candidateId'> }>(
    '/doctrine/candidates/:id/admit',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      return mutation(reply, () => ({ doctrine: ledger.admit({ ...request.body, candidateId: request.params.id }) }));
    },
  );

  fastify.post<{ Body: DoctrineRetrieveInput }>('/doctrine/orders', async (request, reply) => {
    const ledger = requireLedger(deps, reply);
    if (!ledger) return;
    return mutation(reply, () => ledger.retrieve(request.body), 200);
  });

  fastify.post<{ Params: { id: string }; Body: Omit<DoctrineApplicationInput, 'retrievalId'> }>(
    '/doctrine/retrievals/:id/application',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      return mutation(reply, () => ({
        application: ledger.recordApplication({ ...request.body, retrievalId: request.params.id }),
      }));
    },
  );

  fastify.post<{ Params: { id: string }; Body: Omit<DoctrineOutcomeInput, 'applicationId'> }>(
    '/doctrine/applications/:id/outcome',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      return mutation(reply, () => ({
        outcome: ledger.recordOutcome({ ...request.body, applicationId: request.params.id }),
      }));
    },
  );

  fastify.post<{ Params: { id: string }; Body: Omit<DoctrineContestInput, 'doctrineId'> }>(
    '/doctrine/:id/contest',
    async (request, reply) => {
      const ledger = requireLedger(deps, reply);
      if (!ledger) return;
      return mutation(reply, () => ({
        contest: ledger.contest({ ...request.body, doctrineId: request.params.id }),
      }));
    },
  );
};
