/**
 * Harbors Routes
 *
 * POST   /harbors                  — create harbor
 * GET    /harbors                  — list harbors
 * GET    /harbors/:name            — get harbor detail
 * DELETE /harbors/:name            — destroy harbor
 * POST   /harbors/:name/enter      — agent enters harbor
 * POST   /harbors/:name/leave      — agent leaves harbor
 * GET    /harbors/:name/members    — list harbor members
 * GET    /harbors/:name/envelope   — read the harbor's enforcement envelope
 * PUT    /harbors/:name/envelope   — set the harbor's enforcement envelope
 * POST   /harbors/:name/check      — dry-run: would <agent> be allowed <action>?
 * GET    /harbors/agent/:agentId   — list harbors an agent is in
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Harbors } from '../lib/harbors.js';
import type { EnvelopeAction } from '../lib/harbor-envelope.js';

interface HarborsRouteDeps {
  harbors: Harbors;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

// ==========================================================================
// Route contracts — typed Fastify generics replace the previous
// `request.body as any` / `request.params as any` casts. Every field below
// is still runtime-validated in the handler (Fastify does not enforce these
// generics without a JSON schema); the types exist so a shape change in
// lib/harbors.ts's options fails `tsc --noEmit`, not a request in prod.
// ==========================================================================

interface NameParam {
  name: string;
}

interface AgentIdParam {
  agentId: string;
}

interface CreateHarborBody {
  name?: unknown;
  scope?: unknown;
  capabilities?: unknown;
  channels?: unknown;
  agentPatterns?: unknown;
  expiresIn?: unknown;
  metadata?: unknown;
}

interface ListHarborsQuery {
  limit?: string;
  pattern?: string;
}

interface EnterHarborBody {
  agentId?: unknown;
  identity?: unknown;
  capabilities?: unknown;
}

interface LeaveHarborBody {
  agentId?: unknown;
}

interface SetEnvelopeBody {
  envelope?: unknown;
  [key: string]: unknown;
}

interface CheckActionBody {
  agentId?: unknown;
  action?: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isEnvelopeAction(value: unknown): value is EnvelopeAction {
  return typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string';
}

function decodedName(request: FastifyRequest<{ Params: NameParam }>): string {
  return decodeURIComponent(request.params.name);
}

// ==========================================================================
// Fastify plugin (dual-export)
// ==========================================================================
export const harborsPlugin: FastifyPluginAsync<{ deps: HarborsRouteDeps }> = async (fastify, opts) => {
  const { harbors, logger } = opts.deps;

  // POST /harbors — create or update harbor
  fastify.post<{ Body: CreateHarborBody }>('/harbors', async (request, reply) => {
    try {
      const { name, scope, capabilities, channels, agentPatterns, expiresIn, metadata } = request.body;
      if (!name || typeof name !== 'string') {
        reply.code(400); return { error: 'name required', code: 'VALIDATION_ERROR' };
      }
      const result = harbors.create(name, {
        scope: typeof scope === 'string' && scope.trim() ? scope.trim() : undefined,
        capabilities: isStringArray(capabilities) ? capabilities : undefined,
        channels: isStringArray(channels) ? channels : undefined,
        agentPatterns: isStringArray(agentPatterns) ? agentPatterns : undefined,
        expiresIn: typeof expiresIn === 'number' ? expiresIn : undefined,
        metadata: metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : undefined,
      });
      if (!result.success) { reply.code(400); return { error: result.error }; }
      logger.info('harbor_created', { name });
      reply.code(201); return { success: true, harbor: result.harbor };
    } catch (err) {
      logger.error('harbor_create_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // GET /harbors — list all harbors
  fastify.get<{ Querystring: ListHarborsQuery }>('/harbors', async (request, reply) => {
    try {
      const limit = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200);
      const pattern = request.query.pattern;
      const list = harbors.list({ limit, pattern });
      return { success: true, harbors: list, count: list.length };
    } catch (err) {
      logger.error('harbors_list_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // GET /harbors/agent/:agentId — list harbors an agent is currently in
  fastify.get<{ Params: AgentIdParam }>('/harbors/agent/:agentId', async (request, reply) => {
    try {
      const { agentId } = request.params;
      const list = harbors.memberships(agentId);
      return { success: true, harbors: list, count: list.length, agentId };
    } catch (err) {
      logger.error('harbors_memberships_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // GET /harbors/:name — get harbor detail
  fastify.get<{ Params: NameParam }>('/harbors/:name', async (request, reply) => {
    try {
      const name = decodedName(request);
      const harbor = harbors.get(name);
      if (!harbor) { reply.code(404); return { error: `harbor '${name}' not found` }; }
      return { success: true, harbor };
    } catch (err) {
      logger.error('harbor_get_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // DELETE /harbors/:name — destroy harbor
  fastify.delete<{ Params: NameParam }>('/harbors/:name', async (request, reply) => {
    try {
      const name = decodedName(request);
      const result = harbors.destroy(name);
      if (!result.success) { reply.code(404); return { error: result.error }; }
      logger.info('harbor_destroyed', { name });
      return { success: true };
    } catch (err) {
      logger.error('harbor_destroy_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // POST /harbors/:name/enter — agent enters harbor
  fastify.post<{ Params: NameParam; Body: EnterHarborBody }>('/harbors/:name/enter', async (request, reply) => {
    try {
      const name = decodedName(request);
      const { agentId, identity, capabilities } = request.body;
      if (!agentId || typeof agentId !== 'string') {
        reply.code(400); return { error: 'agentId required', code: 'VALIDATION_ERROR' };
      }
      const result = await harbors.enter(name, agentId, {
        identity: typeof identity === 'string' ? identity : undefined,
        capabilities: isStringArray(capabilities) ? capabilities : undefined,
      });
      if (!result.success) { reply.code(400); return { error: result.error }; }
      logger.info('harbor_entered', { name, agentId });
      return { success: true, harbor: result.harbor, harborCard: result.harborCard };
    } catch (err) {
      logger.error('harbor_enter_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // POST /harbors/:name/leave — agent leaves harbor
  fastify.post<{ Params: NameParam; Body: LeaveHarborBody }>('/harbors/:name/leave', async (request, reply) => {
    try {
      const name = decodedName(request);
      const { agentId } = request.body;
      if (!agentId || typeof agentId !== 'string') {
        reply.code(400); return { error: 'agentId required', code: 'VALIDATION_ERROR' };
      }
      const result = harbors.leave(name, agentId);
      if (!result.success) { reply.code(404); return { error: result.error }; }
      logger.info('harbor_left', { name, agentId });
      return { success: true };
    } catch (err) {
      logger.error('harbor_leave_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // GET /harbors/:name/members — list members
  fastify.get<{ Params: NameParam }>('/harbors/:name/members', async (request, reply) => {
    try {
      const name = decodedName(request);
      const harbor = harbors.get(name);
      if (!harbor) { reply.code(404); return { error: `harbor '${name}' not found` }; }
      return { success: true, members: harbor.members, count: harbor.members.length };
    } catch (err) {
      logger.error('harbor_members_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // GET /harbors/:name/envelope — read the harbor's enforcement envelope
  fastify.get<{ Params: NameParam }>('/harbors/:name/envelope', async (request, reply) => {
    try {
      const name = decodedName(request);
      if (!harbors.get(name)) { reply.code(404); return { error: `harbor '${name}' not found` }; }
      const envelope = harbors.getEnvelope(name);
      // envelope === null means none is set, which enforces as deny-all.
      return { success: true, name, envelope, enforced: envelope !== null };
    } catch (err) {
      logger.error('harbor_envelope_get_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // PUT /harbors/:name/envelope — set (replace) the harbor's enforcement envelope
  fastify.put<{ Params: NameParam; Body: SetEnvelopeBody }>('/harbors/:name/envelope', async (request, reply) => {
    try {
      const name = decodedName(request);
      const body = request.body;
      const envelope = body && typeof body === 'object' && body.envelope !== undefined ? body.envelope : body;
      const result = harbors.setEnvelope(name, envelope);
      if (!result.success) { reply.code(404); return { error: result.error }; }
      logger.info('harbor_envelope_set', { name });
      return { success: true, name, envelope: harbors.getEnvelope(name) };
    } catch (err) {
      logger.error('harbor_envelope_set_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // POST /harbors/:name/check — dry-run a capability decision (shown-to-user UX).
  // Body: { agentId, action: EnvelopeAction }. Always 200 with the verdict;
  // the boundary names which permission edge governed the decision.
  fastify.post<{ Params: NameParam; Body: CheckActionBody }>('/harbors/:name/check', async (request, reply) => {
    try {
      const name = decodedName(request);
      const { agentId, action } = request.body;
      if (!agentId || typeof agentId !== 'string') {
        reply.code(400); return { error: 'agentId required', code: 'VALIDATION_ERROR' };
      }
      if (!isEnvelopeAction(action)) {
        reply.code(400); return { error: 'action with a kind required', code: 'VALIDATION_ERROR' };
      }
      const verdict = harbors.assertWithinEnvelope(name, agentId, action);
      return { success: true, name, agentId, action, verdict };
    } catch (err) {
      logger.error('harbor_check_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });
};
