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
import { createInboxIdentity, type InboxSessionLookup } from '../lib/inbox-identity.js';
import type { IdentityVerifier } from '../lib/identity-write-boundary.js';

interface InboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  fromActorId?: string | null;
  fromSoulClass?: string | null;
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
  agents: {
    register(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    heartbeat(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    unregister(id: string): Record<string, unknown>;
    get(id: string): Record<string, unknown>;
    list(opts: { activeOnly: boolean; identityPrefix?: string; purpose?: string }): unknown;
  };
  agentInbox: {
    send(agentId: string, content: unknown, opts?: { from?: string; fromActorId?: string | null; fromSoulClass?: string | null; type?: string; contentType?: 'text' | 'json' | 'binary' }): { success: boolean; messageId?: number; error?: string };
    list(agentId: string, opts?: { unreadOnly?: boolean; limit?: number; since?: number }): { success: boolean; messages: InboxMessage[]; count: number };
    listSent(fromAgent: string, opts?: { unreadOnly?: boolean; limit?: number }): { success: boolean; messages: InboxMessage[]; count: number };
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
  fleetDaemon?: {
    hailAgent(agentId: string, context?: { project?: string; source?: 'inbox' | 'manual' | 'trigger' | 'schedule'; channel?: string; from?: string | null; fromActorId?: string | null; fromSoulClass?: string | null; message?: unknown; messageContent?: string }): Promise<{
      success: boolean;
      error?: string;
      project?: string;
      agent?: string;
    }>;
  };
  contextTracker?: {
    upsertContextHealth(agentId: string, model: string, tokensUsed: number): unknown;
  };
  cloudAppTelemetry?: CloudAppTelemetry;
  /**
   * ADR-0040 souls store (subset). Inbox SENDS require the daemon-minted
   * credential (#8877 / ADR-0122): the inbox is an instruction plane, not a
   * display plane — `from` is written into a spawned agent's prompt as the
   * `- sender:` line. Already supplied through the shared deps bag by
   * server.ts; see lib/inbox-identity.ts for why the locks-shaped check is
   * not sufficient here.
   */
  actorSouls?: IdentityVerifier | null;
  /**
   * Sessions manager (subset). Supplies the daemon-witnessed display-agentId
   * → minted-soul binding that lets `pd inbox send --agent <self>` keep
   * working without binding shared aliases at mint time.
   */
  sessions?: InboxSessionLookup | null;
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
  const { logger, metrics, agents, agentInbox, activityLog, webhooks, messaging, fleetDaemon, contextTracker, cloudAppTelemetry, actorSouls, sessions } = opts.deps;

  // The strict sender gate for the inbox plane. Shared verbatim with
  // routes/actors.ts (POST /actors/:id/message) — the second door into the
  // same agent_inbox table — so the two cannot drift apart.
  const { requireInboxSender } = createInboxIdentity({ souls: actorSouls, sessions, logger });

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
      const agentId = (request.params as any).id as string;
      const { content, from, type, wake, project, contentType, messageContent } = request.body as any;

      // The sender gate runs BEFORE anything observable happens: a rejected
      // request must not store a message, must not log an attribution, and
      // must never reach hailAgent (which spawns a code-editing agent with
      // `from` in its prompt). The body's `from` is dead after this point —
      // `sender.from` is the only attribution used below.
      const sender = requireInboxSender(
        request.headers as Record<string, unknown>,
        request.body,
        from,
        'POST /agents/:id/inbox',
      );
      if (!sender.success) {
        reply.code(sender.httpStatus);
        return sender.result;
      }

      const hasContent = content !== undefined
        && content !== null
        && !(typeof content === 'string' && content.trim() === '');
      if (!hasContent) {
        reply.code(400);
        return { error: 'content required' };
      }

      const agentResult = agents.get(agentId);
      if (!agentResult.success) {
        logger.info('inbox_hail_sent', { agentId, from: sender.from, note: 'Agent not in registry' });
      }

      const safeContentType = contentType === 'text' || contentType === 'json' || contentType === 'binary'
        ? contentType
        : undefined;
      const result = agentInbox.send(agentId, content, {
        from: sender.from,
        fromActorId: sender.fromActorId,
        fromSoulClass: sender.fromSoulClass,
        type,
        contentType: safeContentType,
      });

      if (!result.success) {
        const statusCode = (result as Record<string, unknown>).code === 'RESOURCE_LIMIT' ? 429 : 400;
        reply.code(statusCode);
        return { error: result.error, code: (result as Record<string, unknown>).code };
      }

      logger.info('inbox_message_sent', {
        agentId,
        from: sender.from,
        fromActorId: sender.fromActorId,
        fromSoulClass: sender.fromSoulClass,
        messageId: result.messageId,
      });
      let wakeResult: { success: boolean; error?: string; project?: string; agent?: string } | undefined;
      if (wake === true && fleetDaemon?.hailAgent) {
        wakeResult = await fleetDaemon.hailAgent(agentId, {
          project: typeof project === 'string' ? project : undefined,
          source: 'inbox',
          from: sender.from,
          fromActorId: sender.fromActorId,
          fromSoulClass: sender.fromSoulClass,
          message: content,
          messageContent: typeof messageContent === 'string' && messageContent.trim()
            ? messageContent.trim()
            : typeof content === 'string'
              ? content
              : JSON.stringify(content),
        });
        if (!wakeResult.success) {
          reply.code(409);
          return {
            success: false,
            error: wakeResult.error,
            messageId: result.messageId,
            delivered: true,
            woke: false,
          };
        }
      }

      return {
        ...result,
        delivered: true,
        woke: wake === true,
        wake: wakeResult,
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

  // GET /agents/:id/sent - Read receipts: messages this agent SENT, with read + readAt
  fastify.get('/agents/:id/sent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = (request.params as any).id as string;
      const { unread, limit } = request.query as any;

      return agentInbox.listSent(agentId, {
        unreadOnly: unread === 'true',
        limit: limit ? parseInt(limit as string, 10) : undefined
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
