import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Tool2VecReconciler } from '../lib/skill-graft-reconciler.js';

interface SkillGraftRouteDeps {
  tool2VecReconciler: Tool2VecReconciler;
  logger?: {
    warn(message: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * Recognizes a request whose transport peer is the local machine. The design
 * gates the mutating reconcile route at the socket boundary rather than
 * trusting forwarded headers that an untrusted client can forge.
 *
 * @param request Fastify request with the observed peer address.
 * @returns True only for loopback or in-process test requests.
 */
function isLoopbackRequest(request: FastifyRequest): boolean {
  const ip = request.ip || request.socket?.remoteAddress || '';
  return ip === '127.0.0.1'
    || ip === '::1'
    || ip === '::ffff:127.0.0.1'
    || ip === 'localhost';
}

/**
 * Registers Tool2Vec status and bounded reconciliation routes. The purpose is
 * to keep status read-only for any daemon client while restricting generation
 * to loopback callers and a hard maximum batch size.
 *
 * @param fastify Fastify instance receiving the route registrations.
 * @param options Injected reconciler and optional governed logger.
 * @returns A promise that resolves after both routes are registered.
 */
export const skillGraftPlugin: FastifyPluginAsync<{ deps: SkillGraftRouteDeps }> = async (
  fastify,
  options,
) => {
  const { tool2VecReconciler, logger } = options.deps;

  fastify.get('/skill-graft/status', async () => tool2VecReconciler.status());

  fastify.post(
    '/skill-graft/reconcile',
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        if (isLoopbackRequest(request)) return;
        logger?.warn('tool2vec_reconcile_blocked_non_loopback', { ip: request.ip });
        return reply.code(403).send({ error: 'Tool2Vec reconciliation is loopback-only' });
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as { maxSkills?: unknown };
      const parsed = typeof body.maxSkills === 'number'
        ? body.maxSkills
        : Number.parseInt(String(body.maxSkills ?? '8'), 10);
      const maxSkills = Number.isFinite(parsed) ? Math.min(64, Math.max(1, Math.floor(parsed))) : 8;
      const result = await tool2VecReconciler.reconcile({
        trigger: 'operator-route',
        maxSkills,
      });
      return reply.code(result.acquired ? 200 : 202).send(result);
    },
  );
};
