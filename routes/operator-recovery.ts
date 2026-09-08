import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  OperatorRecoveryError,
  type CreateOperatorRecoveryChallengeInput,
  type OperatorRecovery,
  type SignedOperatorRecoveryDecisionInput,
} from '../lib/operator-recovery.js';

interface OperatorRecoveryRouteDeps {
  operatorRecovery?: OperatorRecovery | null;
  logger?: {
    info(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

function unavailable(reply: FastifyReply) {
  return reply.code(503).send({
    success: false,
    code: 'OPERATOR_RECOVERY_UNAVAILABLE',
    error: 'provenance-bound operator recovery is unavailable',
  });
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof OperatorRecoveryError) {
    return reply.code(error.httpStatus).send({ success: false, code: error.code, error: error.message });
  }
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? String((error as { code: string }).code)
    : 'OPERATOR_RECOVERY_INTERNAL';
  const status = code.includes('NOT_FOUND') ? 404
    : code.includes('UNAVAILABLE') ? 503
      : code.includes('INVALID') || code.includes('MISMATCH') ? 401
        : 409;
  return reply.code(status).send({
    success: false,
    code,
    error: 'operator recovery failed before authority could be committed',
  });
}

/**
 * Thin HTTP projection over the daemon service. A loopback caller can create a
 * challenge, but that request creates no authority. Decisions are accepted only
 * after the injected native verifier validates daemon-supplied canonical bytes
 * and signed/notarized FleetBar provenance.
 */
export const operatorRecoveryPlugin: FastifyPluginAsync<{ deps?: OperatorRecoveryRouteDeps }> = async (fastify, opts) => {
  const deps = opts.deps ?? {};

  fastify.post('/operator-recovery/challenges', async (request, reply) => {
    if (!deps.operatorRecovery) return unavailable(reply);
    try {
      const result = await deps.operatorRecovery.createChallenge((request.body ?? {}) as CreateOperatorRecoveryChallengeInput);
      deps.logger?.info('operator_recovery_challenge_created', {
        recoveryId: result.recoveryId,
        actionHash: result.scope.actionHash,
      });
      return reply.code(201).send({ success: true, ...result });
    } catch (error) {
      deps.logger?.error('operator_recovery_challenge_refused', {
        code: (error as { code?: string })?.code,
      });
      return fail(reply, error);
    }
  });

  fastify.post('/operator-recovery/:recoveryId/decision', async (request, reply) => {
    if (!deps.operatorRecovery) return unavailable(reply);
    try {
      const params = request.params as { recoveryId: string };
      const body = (request.body ?? {}) as Omit<SignedOperatorRecoveryDecisionInput, 'recoveryId'>;
      const result = await deps.operatorRecovery.decideAndConsume({
        ...body,
        recoveryId: params.recoveryId,
      });
      deps.logger?.info('operator_recovery_decided', {
        recoveryId: params.recoveryId,
        status: result.status,
      });
      return { success: true, ...result };
    } catch (error) {
      return fail(reply, error);
    }
  });

  fastify.get('/operator-recovery', async (request, reply) => {
    if (!deps.operatorRecovery) return unavailable(reply);
    try {
      const query = (request.query ?? {}) as { status?: string; limit?: string };
      const limit = query.limit === undefined ? undefined : Number(query.limit);
      return deps.operatorRecovery.list({
        status: query.status as 'pending' | 'approved' | 'custody-pending' | 'denied' | 'expired' | 'revoked' | 'consumed' | undefined,
        limit,
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  fastify.get('/operator-recovery/:recoveryId', async (request, reply) => {
    if (!deps.operatorRecovery) return unavailable(reply);
    try {
      const params = request.params as { recoveryId: string };
      return { success: true, ...deps.operatorRecovery.get(params.recoveryId) };
    } catch (error) {
      return fail(reply, error);
    }
  });
};
