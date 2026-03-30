/**
 * Agents Routes
 *
 * V2 Agent Endpoints for agent registry and heartbeat.
 * Provides agent registration, heartbeat, and resource tracking.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateAgentId } from '../shared/validators.js';
import { WebhookEvent } from '../lib/webhooks.js';

interface InboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  content: string;
  type: string;
  read: boolean;
  createdAt: number;
}

interface AgentsRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  agents: {
    register(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    heartbeat(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    unregister(id: string): Record<string, unknown>;
    get(id: string): Record<string, unknown>;
    list(opts: { activeOnly: boolean; identityPrefix?: string; purpose?: string }): unknown;
  };
  agentInbox: {
    send(agentId: string, content: string, opts?: { from?: string; type?: string }): { success: boolean; messageId?: number; error?: string };
    list(agentId: string, opts?: { unreadOnly?: boolean; limit?: number; since?: number }): { success: boolean; messages: InboxMessage[]; count: number };
    markRead(agentId: string, messageId: number): { success: boolean };
    markAllRead(agentId: string): { success: boolean; marked: number };
    clear(agentId: string): { success: boolean; deleted: number };
    stats(agentId: string): { success: boolean; total: number; unread: number };
  };
  activityLog: {
    logAgent: {
      register(id: string): void;
      heartbeat(id: string): void;
      unregister(id: string): void;
    };
  };
  webhooks: {
    trigger(event: string, payload: Record<string, unknown>, opts: { targetId: string }): void;
  };
  messaging: {
    publish(channel: string, message: string): { success: boolean };
  };
}

/**
 * Create agents routes
 *
 * @param deps - Route dependencies
 * @returns Express router with agent routes
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const agentsPlugin: FastifyPluginAsync<{ deps: AgentsRouteDeps }> = async (fastify, opts) => {
  const { logger, metrics, agents, agentInbox, activityLog, webhooks, messaging } = opts.deps;

  // POST /agents - Register an agent
  fastify.post('/agents', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, name, type, metadata, agentCard, maxServices, maxLocks, identity, worktreeId, purpose } = request.body as any;

      if (!id) {
        reply.code(400);
        return { error: 'agent id required' };
      }

      const idValidation = validateAgentId(id);
      if (!idValidation.valid) {
        reply.code(400);
        return { error: idValidation.error };
      }

      const result = agents.register(id, {
        name,
        pid: parseInt(request.headers['x-pid'] as string, 10) || process.pid,
        type: type || 'cli',
        metadata,
        agentCard,
        maxServices,
        maxLocks,
        identity,
        worktreeId,
        purpose
      });

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      if (result.registered) {
        activityLog.logAgent.register(id);

        webhooks.trigger(WebhookEvent.AGENT_REGISTER, {
          agentId: id,
          name: name || id,
          type: type || 'cli',
          identity,
          purpose
        }, { targetId: id });

        messaging.publish('agents', JSON.stringify({
          event: 'registered',
          agentId: id,
          name: name || id,
          type: type || 'cli',
          identity,
          purpose: purpose || metadata?.purpose || null,
          timestamp: Date.now()
        }));
      }

      logger.info('agent_registered', { agentId: id, registered: result.registered as boolean, identity, salvageHint: result.salvageHint });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('agent_register_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /agents/:id/heartbeat - Send heartbeat
  fastify.post('/agents/:id/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const id = (request.params as any).id as string;

      const result = agents.heartbeat(id, {
        pid: parseInt(request.headers['x-pid'] as string, 10) || process.pid
      });

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      if (result.registered || Math.random() < 0.1) {
        activityLog.logAgent.heartbeat(id);
      }

      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /agents/:id - Unregister an agent
  fastify.delete('/agents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const id = (request.params as any).id as string;

      const result = agents.unregister(id);

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      if (result.unregistered) {
        activityLog.logAgent.unregister(id);

        webhooks.trigger(WebhookEvent.AGENT_UNREGISTER, {
          agentId: id
        }, { targetId: id });

        messaging.publish('agents', JSON.stringify({
          event: 'unregistered',
          agentId: id,
          timestamp: Date.now()
        }));
      }

      logger.info('agent_unregistered', { agentId: id });
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /agents/:id - Get agent info
  fastify.get('/agents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = agents.get((request.params as any).id as string);

      if (!result.success) {
        reply.code(404);
        return { error: result.error };
      }

      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /agents - List all agents
  fastify.get('/agents', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { active, identity, purpose } = request.query as any;
      return agents.list({
        activeOnly: active === 'true',
        identityPrefix: typeof identity === 'string' ? identity : undefined,
        purpose: typeof purpose === 'string' ? purpose : undefined
      });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /agents/:id/inbox - Send message to agent's inbox
  fastify.post('/agents/:id/inbox', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = (request.params as any).id as string;
      const { content, from, type } = request.body as any;

      if (!content) {
        reply.code(400);
        return { error: 'content required' };
      }

      const agentResult = agents.get(agentId);
      if (!agentResult.success) {
        logger.info('inbox_hail_sent', { agentId, from, note: 'Agent not in registry' });
      }

      const result = agentInbox.send(agentId, content, { from, type });

      if (!result.success) {
        const statusCode = (result as Record<string, unknown>).code === 'RESOURCE_LIMIT' ? 429 : 400;
        reply.code(statusCode);
        return { error: result.error, code: (result as Record<string, unknown>).code };
      }

      logger.info('inbox_message_sent', { agentId, from, messageId: result.messageId });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('inbox_send_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /agents/:id/inbox - Read agent's inbox
  fastify.get('/agents/:id/inbox', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = (request.params as any).id as string;
      const { unread, limit, since } = request.query as any;

      return agentInbox.list(agentId, {
        unreadOnly: unread === 'true',
        limit: limit ? parseInt(limit as string, 10) : undefined,
        since: since ? parseInt(since as string, 10) : undefined
      });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /agents/:id/inbox/stats - Get inbox stats
  fastify.get('/agents/:id/inbox/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = (request.params as any).id as string;
      return agentInbox.stats(agentId);
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // PUT /agents/:id/inbox/:messageId/read - Mark message as read
  fastify.put('/agents/:id/inbox/:messageId/read', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = (request.params as any).id as string;
      const messageId = parseInt((request.params as any).messageId as string, 10);

      return agentInbox.markRead(agentId, messageId);
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // PUT /agents/:id/inbox/read-all - Mark all messages as read
  fastify.put('/agents/:id/inbox/read-all', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = (request.params as any).id as string;
      return agentInbox.markAllRead(agentId);
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /agents/:id/inbox - Clear inbox
  fastify.delete('/agents/:id/inbox', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = (request.params as any).id as string;
      const result = agentInbox.clear(agentId);
      logger.info('inbox_cleared', { agentId, deleted: result.deleted });
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
