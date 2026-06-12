/**
 * Custodian HTTP Surface
 *
 * GET  /custodian/status           — loop state, duty timestamps, harvested/resurrected today
 * GET  /custodian/approvals        — approvals queued for operator
 * POST /custodian/approvals/:id    — resolve a pending approval {decision: 'approved'|'denied'}
 */

import type { FastifyPluginAsync } from 'fastify';
import type { KnowledgeCustodian } from '../lib/knowledge-custodian.js';
import type { OperatorPermissions } from '../lib/operator-permissions.js';

interface CustodianRouteDeps {
  custodian: KnowledgeCustodian;
  operatorPermissions: OperatorPermissions;
}

export const custodianPlugin: FastifyPluginAsync<{ deps: CustodianRouteDeps }> = async (
  fastify,
  { deps },
) => {
  const { custodian, operatorPermissions } = deps;

  fastify.get('/custodian/status', async (_req, reply) => {
    return reply.send(custodian.getStatus());
  });

  fastify.get('/custodian/approvals', async (_req, reply) => {
    return reply.send({ candidates: operatorPermissions.listCandidates() });
  });

  fastify.post<{ Params: { id: string }; Body: { decision: 'approved' | 'denied' } }>(
    '/custodian/approvals/:id',
    async (req, reply) => {
      const patternId = parseInt(req.params.id, 10);
      const { decision } = req.body ?? {};

      if (!Number.isFinite(patternId) || patternId <= 0) {
        return reply.status(400).send({ error: 'id must be a positive integer' });
      }

      if (decision !== 'approved' && decision !== 'denied') {
        return reply.status(400).send({ error: 'decision must be "approved" or "denied"' });
      }

      if (decision === 'approved') {
        operatorPermissions.accept(patternId);
      } else {
        operatorPermissions.denyMeta(patternId);
      }

      return reply.send({ ok: true, patternId, decision });
    },
  );

  fastify.get('/custodian/permissions', async (_req, reply) => {
    return reply.send({ patterns: operatorPermissions.list() });
  });
};
