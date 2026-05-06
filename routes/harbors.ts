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
 * GET    /harbors/agent/:agentId   — list harbors an agent is in
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Harbors } from '../lib/harbors.js';

interface HarborsRouteDeps {
  harbors: Harbors;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}


// ==========================================================================
// Fastify plugin (dual-export)
// ==========================================================================
export const harborsPlugin: FastifyPluginAsync<{ deps: HarborsRouteDeps }> = async (fastify, opts) => {
  const { harbors, logger } = opts.deps;

  // POST /harbors — create or update harbor
  fastify.post('/harbors', async (request, reply) => {
    try {
      const { name, scope, capabilities, channels, agentPatterns, expiresIn, metadata } = request.body as any;
      if (!name || typeof name !== 'string') {
        reply.code(400); return { error: 'name required', code: 'VALIDATION_ERROR' };
      }
      const result = harbors.create(name, {
        scope: typeof scope === 'string' && scope.trim() ? scope.trim() : undefined,
        capabilities: Array.isArray(capabilities) ? capabilities as string[] : undefined,
        channels: Array.isArray(channels) ? channels as string[] : undefined,
        agentPatterns: Array.isArray(agentPatterns) ? agentPatterns as string[] : undefined,
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
  fastify.get('/harbors', async (request, reply) => {
    try {
      const limit = Math.min(parseInt(String((request.query as any)['limit'] ?? '50'), 10) || 50, 200);
      const pattern = (request.query as any)['pattern'] as string | undefined;
      const list = harbors.list({ limit, pattern });
      return { success: true, harbors: list, count: list.length };
    } catch (err) {
      logger.error('harbors_list_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // GET /harbors/agent/:agentId — list harbors an agent is currently in
  fastify.get('/harbors/agent/:agentId', async (request, reply) => {
    try {
      const agentId = (request.params as any).agentId as string;
      const list = harbors.memberships(agentId);
      return { success: true, harbors: list, count: list.length, agentId };
    } catch (err) {
      logger.error('harbors_memberships_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // GET /harbors/:name — get harbor detail
  fastify.get('/harbors/:name', async (request, reply) => {
    try {
      const name = decodeURIComponent((request.params as any).name as string);
      const harbor = harbors.get(name);
      if (!harbor) { reply.code(404); return { error: `harbor '${name}' not found` }; }
      return { success: true, harbor };
    } catch (err) {
      logger.error('harbor_get_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });

  // DELETE /harbors/:name — destroy harbor
  fastify.delete('/harbors/:name', async (request, reply) => {
    try {
      const name = decodeURIComponent((request.params as any).name as string);
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
  fastify.post('/harbors/:name/enter', async (request, reply) => {
    try {
      const name = decodeURIComponent((request.params as any).name as string);
      const { agentId, identity, capabilities } = request.body as any;
      if (!agentId || typeof agentId !== 'string') {
        reply.code(400); return { error: 'agentId required', code: 'VALIDATION_ERROR' };
      }
      const result = await harbors.enter(name, agentId, {
        identity: typeof identity === 'string' ? identity : undefined,
        capabilities: Array.isArray(capabilities) ? capabilities as string[] : undefined,
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
  fastify.post('/harbors/:name/leave', async (request, reply) => {
    try {
      const name = decodeURIComponent((request.params as any).name as string);
      const { agentId } = request.body as any;
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
  fastify.get('/harbors/:name/members', async (request, reply) => {
    try {
      const name = decodeURIComponent((request.params as any).name as string);
      const harbor = harbors.get(name);
      if (!harbor) { reply.code(404); return { error: `harbor '${name}' not found` }; }
      return { success: true, members: harbor.members, count: harbor.members.length };
    } catch (err) {
      logger.error('harbor_members_error', { error: String(err) });
      reply.code(500); return { error: 'internal error' };
    }
  });
};
