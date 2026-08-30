/** Owner-only routes for exact, one-shot operator admission grants. */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { userInfo } from 'node:os';
import type { OperatorAdmissionGrants } from '../lib/operator-admission-grants.js';

interface OperatorAdmissionRouteDeps {
  operatorAdmissionGrants?: OperatorAdmissionGrants;
  roadmapItems?: { slugExists(slug: string): boolean };
  logger?: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
  operatorIdentity?: () => string;
  /** Fastify.inject is TCP-shaped. Tests opt in explicitly; production never does. */
  allowNonUnixForTests?: boolean;
}

interface IssueBody {
  identity?: unknown;
  worktreeRoot?: unknown;
  roadmapSlug?: unknown;
  ttlMs?: unknown;
  confirmed?: unknown;
}

function isUnixSocketRequest(request: FastifyRequest): boolean {
  return !request.socket?.remoteAddress;
}

function localOperatorIdentity(): string {
  const username = userInfo().username || 'unknown';
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown';
  return `local:${username}:uid:${uid}`;
}

function failureStatus(code: string): number {
  if (code === 'GRANT_NOT_FOUND') return 404;
  if (code === 'GRANT_CONFLICT' || code === 'GRANT_ALREADY_CONSUMED') return 409;
  if (code === 'STORE_UNAVAILABLE') return 503;
  return 400;
}

export const operatorAdmissionPlugin: FastifyPluginAsync<{ deps?: OperatorAdmissionRouteDeps }> = async (fastify, opts) => {
  const deps = opts.deps ?? {};

  fastify.post('/operator/admission-grants', async (
    request: FastifyRequest<{ Body: IssueBody }>,
    reply: FastifyReply,
  ) => {
    if (!deps.allowNonUnixForTests && !isUnixSocketRequest(request)) {
      deps.logger?.warn('operator_admission_issue_rejected', { code: 'OPERATOR_UNIX_SOCKET_REQUIRED', ip: request.ip });
      return reply.code(403).send({
        success: false,
        code: 'OPERATOR_UNIX_SOCKET_REQUIRED',
        error: 'operator admission grants may only be issued over the owner-only daemon Unix socket',
      });
    }
    if (!deps.operatorAdmissionGrants) {
      return reply.code(503).send({ success: false, code: 'GRANT_STORE_UNAVAILABLE', error: 'operator admission grant store is unavailable' });
    }
    const body = request.body ?? {};
    if (body.confirmed !== true) {
      return reply.code(400).send({
        success: false,
        code: 'OPERATOR_CONFIRMATION_REQUIRED',
        error: 'explicit operator confirmation is required for this exact admission grant',
      });
    }
    const roadmapSlug = typeof body.roadmapSlug === 'string' ? body.roadmapSlug.trim() : '';
    if (!roadmapSlug || !deps.roadmapItems?.slugExists(roadmapSlug)) {
      return reply.code(404).send({ success: false, code: 'ROADMAP_SLUG_UNKNOWN', error: `unknown roadmap slug "${roadmapSlug}"` });
    }
    const ttlMs = typeof body.ttlMs === 'number' ? body.ttlMs : Number(body.ttlMs);
    const result = deps.operatorAdmissionGrants.issue({
      identity: typeof body.identity === 'string' ? body.identity : '',
      worktreeRoot: typeof body.worktreeRoot === 'string' ? body.worktreeRoot : '',
      roadmapSlug,
      operatorIdentity: (deps.operatorIdentity ?? localOperatorIdentity)(),
      ...(Number.isFinite(ttlMs) ? { ttlMs } : {}),
    });
    if (!result.success) {
      deps.logger?.warn('operator_admission_issue_rejected', { code: result.code, error: result.error });
      return reply.code(failureStatus(result.code)).send(result);
    }
    deps.logger?.info('operator_admission_grant_issued', {
      grantId: result.grant.grantId,
      bindingHash: result.grant.bindingHash,
      operatorIdentity: result.grant.operatorIdentity,
      expiresAt: result.grant.expiresAt,
      idempotent: result.idempotent,
    });
    return reply.code(result.idempotent ? 200 : 201).send(result);
  });

  fastify.get('/operator/admission-grants', async (_request, reply) => {
    if (!deps.operatorAdmissionGrants) {
      return reply.code(503).send({ success: false, code: 'GRANT_STORE_UNAVAILABLE', error: 'operator admission grant store is unavailable' });
    }
    const grants = deps.operatorAdmissionGrants.list();
    return reply.send({ success: true, count: grants.length, grants });
  });

  fastify.get('/operator/admission-grants/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => {
    if (!deps.operatorAdmissionGrants) {
      return reply.code(503).send({ success: false, code: 'GRANT_STORE_UNAVAILABLE', error: 'operator admission grant store is unavailable' });
    }
    const readback = deps.operatorAdmissionGrants.get(request.params.id);
    if (!readback) return reply.code(404).send({ success: false, code: 'GRANT_NOT_FOUND', error: 'operator admission grant not found' });
    return reply.send({ success: true, ...readback });
  });
};
