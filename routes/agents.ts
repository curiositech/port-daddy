/**
 * Agents Routes
 *
 * V2 Agent Endpoints for agent registry and heartbeat.
 * Provides agent registration, heartbeat, and resource tracking.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateAgentId } from '../shared/validators.js';
import { WebhookEvent } from '../lib/webhooks.js';
import { getEffectiveContextWindow } from '../lib/context-window-tracker.js';
import type { CloudAppTelemetry } from '../lib/cloud-app-telemetry.js';
import {
  authorizeCanonicalInboxOwner,
  createExternalInboxRateLimiter,
  parseExternalInboxContent,
  resolveCanonicalInboxTarget,
  resolveExternalInboxSender,
  type ExternalInboxRateLimiter,
  type InboxActorSouls,
  type InboxBoundaryFailure,
  type LiveInboxResolver,
} from '../lib/inbox-http-boundary.js';

interface InboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  content: unknown;
  contentType?: string;
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
  agents: LiveInboxResolver & {
    register(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    heartbeat(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    unregister(id: string): Record<string, unknown>;
    get(id: string): Record<string, unknown>;
    list(opts: { activeOnly: boolean; identityPrefix?: string; purpose?: string }): unknown;
  };
  agentInbox: {
    send(agentId: string, content: unknown, opts?: { from?: string; type?: string; contentType?: 'text' | 'json' | 'binary' }): { success: boolean; messageId?: number; error?: string };
    list(agentId: string, opts?: { unreadOnly?: boolean; limit?: number; since?: number }): { success: boolean; messages: InboxMessage[]; count: number };
    listSent(fromAgent: string, opts?: { unreadOnly?: boolean; limit?: number }): { success: boolean; messages: InboxMessage[]; count: number };
    markRead(agentId: string, messageId: number): { success: boolean };
    markAllRead(agentId: string): { success: boolean; marked: number };
    stats(agentId: string): { success: boolean; total: number; unread: number };
  };
  /** Daemon-minted identity verifier and daemon-owned default harbor. */
  actorSouls?: InboxActorSouls | null;
  /** Test injection only; production gets one bounded limiter per plugin. */
  externalInboxLimiter?: ExternalInboxRateLimiter;
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
  contextTracker?: {
    upsertContextHealth(agentId: string, model: string, tokensUsed: number): unknown;
  };
  cloudAppTelemetry?: CloudAppTelemetry;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePid(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.trunc(parsed);
  return normalized >= 0 ? normalized : undefined;
}

function requestPid(request: FastifyRequest, body: Record<string, unknown>): number {
  return parsePid(firstHeaderValue(request.headers['x-pid']))
    ?? parsePid(body.pid)
    ?? process.pid;
}

function inboxBoundaryError(reply: FastifyReply, outcome: InboxBoundaryFailure) {
  reply.code(outcome.httpStatus);
  return { success: false, error: outcome.error, code: outcome.code };
}

function parseInboxReadLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(Math.trunc(parsed), 200);
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
  const {
    logger,
    metrics,
    agents,
    agentInbox,
    actorSouls,
    activityLog,
    webhooks,
    messaging,
    contextTracker,
    cloudAppTelemetry,
  } = opts.deps;
  const externalInboxLimiter = opts.deps.externalInboxLimiter ?? createExternalInboxRateLimiter();

  // POST /agents - Register an agent
  fastify.post('/agents', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ((request.body as Record<string, unknown>) || {});
      const { id, name, type, metadata, agentCard, maxServices, maxLocks, identity, worktreeId, purpose } = body as any;

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
        pid: requestPid(request, body),
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
      const body = (request.body as Record<string, unknown>) || {};

      // A heartbeat extends the live inbox lease used by identity resolution.
      // Once an id is a server-bound canonical actor, only that exact soul may
      // extend it; otherwise an anonymous caller could keep a stale victim live.
      const current = agents.get(id);
      const currentAgent = (current as {
        agent?: { actorInboxBinding?: { verified?: boolean } | null };
      }).agent;
      if (current.success && currentAgent?.actorInboxBinding?.verified === true) {
        const owner = authorizeCanonicalInboxOwner({
          souls: actorSouls,
          resolver: agents,
          headers: request.headers as Record<string, unknown>,
          requestedActorId: id,
          route: 'POST /agents/:id/heartbeat',
          logger,
        });
        if (!owner.ok) return inboxBoundaryError(reply, owner);
      }

      const result = agents.heartbeat(id, {
        pid: requestPid(request, body),
        status: typeof body.status === 'string' ? body.status : undefined,
        readiness: Array.isArray(body.readiness) ? body.readiness : undefined,
        progress: typeof body.progress === 'string' ? body.progress : undefined,
      });

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      if (result.registered || Math.random() < 0.1) {
        activityLog.logAgent.heartbeat(id);
      }

      // Optional context health update — agents that know their token usage report it here.
      const model = typeof body.model === 'string' ? body.model : null;
      const rawUsedPct = typeof body.context_window_used_pct === 'number' ? body.context_window_used_pct : null;
      // Clamp to [0, 1] to reject NaN/Infinity/negative/out-of-range values from agents
      const usedPct = rawUsedPct !== null && Number.isFinite(rawUsedPct)
        ? Math.min(1, Math.max(0, rawUsedPct))
        : null;
      if (contextTracker && model && usedPct !== null) {
        const tokensUsed = Math.round(usedPct * getEffectiveContextWindow(model));
        contextTracker.upsertContextHealth(id, model, tokensUsed);
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
      const agentId = (request.params as any).id as string;
      const result = agents.get(agentId);

      if (!result.success) {
        const remoteAgent = cloudAppTelemetry?.getAgent(agentId);
        if (remoteAgent) {
          return {
            success: true,
            agent: {
              ...remoteAgent,
              timeSinceHeartbeat: Date.now() - remoteAgent.lastHeartbeat,
            },
          };
        }
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
      const activeOnly = active === 'true';
      const identityPrefix = typeof identity === 'string' ? identity : undefined;
      const purposeFilter = typeof purpose === 'string' ? purpose : undefined;
      const localResult = agents.list({
        activeOnly,
        identityPrefix,
        purpose: purposeFilter
      });
      const localRecord = localResult as Record<string, unknown>;
      const localAgents = Array.isArray(localRecord.agents) ? localRecord.agents : [];
      const remoteAgents = cloudAppTelemetry?.agents({
        activeOnly,
        identityPrefix,
        purpose: purposeFilter,
      }) ?? [];
      const allAgents = [...localAgents, ...remoteAgents].sort((a, b) => {
        const aHeartbeat = typeof (a as any).lastHeartbeat === 'number' ? (a as any).lastHeartbeat : 0;
        const bHeartbeat = typeof (b as any).lastHeartbeat === 'number' ? (b as any).lastHeartbeat : 0;
        return bHeartbeat - aHeartbeat;
      });

      return {
        ...localRecord,
        success: localRecord.success !== false,
        agents: allAgents,
        count: allAgents.length,
        localCount: localAgents.length,
        remoteCount: remoteAgents.length,
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /agents/:id/inbox - Send message to agent's inbox
  fastify.post('/agents/:id/inbox', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const requestedActorId = (request.params as any).id as string;
      const content = parseExternalInboxContent(request.body);
      if (!content.ok) return inboxBoundaryError(reply, content);
      const target = resolveCanonicalInboxTarget({
        souls: actorSouls,
        resolver: agents,
        requestedActorId,
      });
      if (!target.ok) return inboxBoundaryError(reply, target);
      const sender = resolveExternalInboxSender({
        souls: actorSouls,
        resolver: agents,
        headers: request.headers as Record<string, unknown>,
        harbor: target.harbor,
        route: 'POST /agents/:id/inbox',
        logger,
      });
      if (!sender.ok) return inboxBoundaryError(reply, sender);
      const rate = externalInboxLimiter.consume({
        senderActorId: sender.provenance.actorId,
        targetActorId: target.actorId,
      });
      if (!rate.ok) {
        reply.code(429).header('Retry-After', String(rate.retryAfterSeconds ?? 1));
        return {
          success: false,
          error: 'external inbox delivery rate limit exceeded',
          code: 'INBOX_RATE_LIMITED',
          scope: rate.scope,
        };
      }

      const result = agentInbox.send(target.inboxTarget, content.content, {
        from: sender.from,
        type: sender.messageType,
        contentType: content.contentType,
      });

      if (!result.success) {
        const statusCode = (result as Record<string, unknown>).code === 'RESOURCE_LIMIT' ? 429 : 400;
        reply.code(statusCode);
        return { error: result.error, code: (result as Record<string, unknown>).code };
      }

      logger.info('inbox_message_sent', {
        actorId: target.actorId,
        sender: sender.provenance.actorId,
        provenance: sender.provenance.kind,
        messageId: result.messageId,
      });

      return {
        ...result,
        actorId: target.actorId,
        inboxTarget: target.inboxTarget,
        delivered: true,
        woke: false,
        provenance: sender.provenance,
      };
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
      const owner = authorizeCanonicalInboxOwner({
        souls: actorSouls,
        resolver: agents,
        headers: request.headers as Record<string, unknown>,
        requestedActorId: agentId,
        route: 'GET /agents/:id/inbox',
        logger,
      });
      if (!owner.ok) return inboxBoundaryError(reply, owner);

      return agentInbox.list(owner.inboxTarget, {
        unreadOnly: unread === 'true',
        limit: parseInboxReadLimit(limit),
        since: since ? parseInt(since as string, 10) : undefined
      });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /agents/:id/sent - Read receipts: messages this agent SENT, with read + readAt
  fastify.get('/agents/:id/sent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = (request.params as any).id as string;
      const { unread, limit } = request.query as any;
      const owner = authorizeCanonicalInboxOwner({
        souls: actorSouls,
        resolver: agents,
        headers: request.headers as Record<string, unknown>,
        requestedActorId: agentId,
        route: 'GET /agents/:id/sent',
        logger,
      });
      if (!owner.ok) return inboxBoundaryError(reply, owner);

      return agentInbox.listSent(owner.actorId, {
        unreadOnly: unread === 'true',
        limit: parseInboxReadLimit(limit)
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
      const owner = authorizeCanonicalInboxOwner({
        souls: actorSouls,
        resolver: agents,
        headers: request.headers as Record<string, unknown>,
        requestedActorId: agentId,
        route: 'GET /agents/:id/inbox/stats',
        logger,
      });
      if (!owner.ok) return inboxBoundaryError(reply, owner);
      return agentInbox.stats(owner.inboxTarget);
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
      if (!Number.isSafeInteger(messageId) || messageId <= 0) {
        reply.code(400);
        return { success: false, error: 'messageId must be a positive integer', code: 'VALIDATION_ERROR' };
      }
      const owner = authorizeCanonicalInboxOwner({
        souls: actorSouls,
        resolver: agents,
        headers: request.headers as Record<string, unknown>,
        requestedActorId: agentId,
        route: 'PUT /agents/:id/inbox/:messageId/read',
        logger,
      });
      if (!owner.ok) return inboxBoundaryError(reply, owner);

      return agentInbox.markRead(owner.inboxTarget, messageId);
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
      const owner = authorizeCanonicalInboxOwner({
        souls: actorSouls,
        resolver: agents,
        headers: request.headers as Record<string, unknown>,
        requestedActorId: agentId,
        route: 'PUT /agents/:id/inbox/read-all',
        logger,
      });
      if (!owner.ok) return inboxBoundaryError(reply, owner);
      return agentInbox.markAllRead(owner.inboxTarget);
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
