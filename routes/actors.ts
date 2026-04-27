import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getMaritimeActor,
  listMaritimeActors,
  resolveMaritimeActorId,
} from '../lib/maritime-actors.js';
import type { MaritimeActorRecord } from '../lib/maritime-actors.js';
import type { createAgents } from '../lib/agents.js';
import type { createAgentInbox } from '../lib/agent-inbox.js';
import type { createResurrection } from '../lib/resurrection.js';
import type { createSessions } from '../lib/sessions.js';
import type { createFleetDaemon } from '../lib/fleet-daemon.js';

type AgentsManager = ReturnType<typeof createAgents>;
type AgentInboxManager = ReturnType<typeof createAgentInbox>;
type SessionsManager = ReturnType<typeof createSessions>;
type ResurrectionManager = ReturnType<typeof createResurrection>;
type FleetDaemonManager = ReturnType<typeof createFleetDaemon>;

interface ActorsRouteDeps {
  agents?: AgentsManager;
  agentInbox?: AgentInboxManager;
  sessions?: SessionsManager;
  resurrection?: ResurrectionManager;
  fleetDaemon?: FleetDaemonManager;
}

interface ActorsQuery {
  project?: string;
  limit?: string;
}

interface ActorParams {
  id: string;
}

interface ActorMessageBody {
  content?: unknown;
  from?: string;
  type?: string;
  wake?: boolean;
  project?: string;
}

interface ActorInboxQuery {
  unread?: string;
  limit?: string;
  since?: string;
}

function parseLimit(value: string | undefined): number {
  if (!value) return 50;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 200);
}

function identityPrefix(project: string | undefined): string | undefined {
  return project?.trim() ? `${project.trim()}:*` : undefined;
}

function parseSince(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function collectProjectionInput(deps: ActorsRouteDeps, query: ActorsQuery) {
  const project = query.project?.trim() || undefined;
  const limit = parseLimit(query.limit);

  const agents = deps.agents?.list({
    activeOnly: false,
    identityPrefix: identityPrefix(project),
  }).agents ?? [];

  const sessions = deps.sessions?.list({
    project,
    allWorktrees: true,
    includeNotes: false,
    limit,
  }).sessions ?? [];

  const salvage = deps.resurrection?.list({
    project,
    limit,
  }).agents ?? [];

  return { agents, sessions, salvage };
}

function attachMailboxStats(actor: MaritimeActorRecord, deps: ActorsRouteDeps): MaritimeActorRecord {
  if (!deps.agentInbox?.stats) return actor;
  const stats = deps.agentInbox.stats(actor.inboxTarget);
  if (!stats.success) return actor;
  return {
    ...actor,
    mailboxStats: {
      total: stats.total,
      unread: stats.unread,
      max: deps.agentInbox.MAX_INBOX_MESSAGES ?? null,
    },
  };
}

function actorOr404(id: string, deps: ActorsRouteDeps, project?: string): MaritimeActorRecord | null {
  const actor = getMaritimeActor(id, collectProjectionInput(deps, { project }));
  return actor ? attachMailboxStats(actor, deps) : null;
}

export const actorsPlugin: FastifyPluginAsync<{ deps?: ActorsRouteDeps }> = async (fastify, opts) => {
  const deps = opts.deps ?? {};

  fastify.get('/actors', async (request: FastifyRequest<{ Querystring: ActorsQuery }>) => {
    const input = collectProjectionInput(deps, request.query ?? {});
    const actors = listMaritimeActors(input)
      .map(actor => attachMailboxStats(actor, deps));

    return {
      success: true,
      count: actors.length,
      actors,
    };
  });

  fastify.get('/actors/:id', async (
    request: FastifyRequest<{ Params: ActorParams; Querystring: ActorsQuery }>,
    reply: FastifyReply,
  ) => {
    const resolvedId = resolveMaritimeActorId(request.params.id);
    if (!resolvedId) {
      return reply.code(404).send({
        success: false,
        error: `Unknown maritime actor: ${request.params.id}`,
        code: 'ACTOR_NOT_FOUND',
      });
    }

    const actor = actorOr404(resolvedId, deps, request.query?.project);

    return {
      success: true,
      actor,
      resolvedId,
    };
  });

  fastify.post('/actors/:id/message', async (
    request: FastifyRequest<{ Params: ActorParams; Body: ActorMessageBody }>,
    reply: FastifyReply,
  ) => {
    const actor = actorOr404(request.params.id, deps);
    if (!actor) {
      return reply.code(404).send({
        success: false,
        error: `Unknown maritime actor: ${request.params.id}`,
        code: 'ACTOR_NOT_FOUND',
      });
    }

    const { content, from, type, wake, project } = request.body ?? {};
    if (content === undefined || content === null || content === '') {
      return reply.code(400).send({
        success: false,
        error: 'content required',
        code: 'VALIDATION_ERROR',
      });
    }
    if (!deps.agentInbox) {
      return reply.code(501).send({
        success: false,
        error: 'actor inbox is unavailable',
        code: 'ACTOR_INBOX_UNAVAILABLE',
      });
    }

    const result = deps.agentInbox.send(actor.inboxTarget, content, {
      from: typeof from === 'string' ? from : undefined,
      type: typeof type === 'string' ? type : 'actor.message',
    });
    if (!result.success) {
      const statusCode = (result as Record<string, unknown>).code === 'RESOURCE_LIMIT' ? 429 : 400;
      return reply.code(statusCode).send({
        success: false,
        error: result.error,
        code: (result as Record<string, unknown>).code,
      });
    }

    let wakeResult: unknown = null;
    if (wake === true && actor.compatibilityFleetAgent && deps.fleetDaemon?.hailAgent) {
      wakeResult = await deps.fleetDaemon.hailAgent(actor.compatibilityFleetAgent, {
        project: typeof project === 'string' ? project : undefined,
        source: 'inbox',
        from: typeof from === 'string' ? from : null,
        message: content,
        messageContent: String(content),
      });
    }

    return {
      success: true,
      actorId: actor.id,
      inboxTarget: actor.inboxTarget,
      messageId: result.messageId,
      delivered: true,
      woke: wake === true && !!actor.compatibilityFleetAgent && !!wakeResult,
      wake: wakeResult,
    };
  });

  fastify.get('/actors/:id/inbox', async (
    request: FastifyRequest<{ Params: ActorParams; Querystring: ActorInboxQuery }>,
    reply: FastifyReply,
  ) => {
    const actor = actorOr404(request.params.id, deps);
    if (!actor) {
      return reply.code(404).send({
        success: false,
        error: `Unknown maritime actor: ${request.params.id}`,
        code: 'ACTOR_NOT_FOUND',
      });
    }
    if (!deps.agentInbox) {
      return reply.code(501).send({
        success: false,
        error: 'actor inbox is unavailable',
        code: 'ACTOR_INBOX_UNAVAILABLE',
      });
    }

    const limit = parseLimit(request.query?.limit);
    const result = deps.agentInbox.list(actor.inboxTarget, {
      unreadOnly: request.query?.unread === 'true',
      limit,
      since: parseSince(request.query?.since),
    });

    return {
      success: true,
      actorId: actor.id,
      inboxTarget: actor.inboxTarget,
      messages: result.messages,
      count: result.count,
    };
  });

  fastify.get('/actors/:id/inbox/stats', async (
    request: FastifyRequest<{ Params: ActorParams }>,
    reply: FastifyReply,
  ) => {
    const actor = actorOr404(request.params.id, deps);
    if (!actor) {
      return reply.code(404).send({
        success: false,
        error: `Unknown maritime actor: ${request.params.id}`,
        code: 'ACTOR_NOT_FOUND',
      });
    }
    if (!deps.agentInbox) {
      return reply.code(501).send({
        success: false,
        error: 'actor inbox is unavailable',
        code: 'ACTOR_INBOX_UNAVAILABLE',
      });
    }

    const stats = deps.agentInbox.stats(actor.inboxTarget);
    return {
      success: true,
      actorId: actor.id,
      inboxTarget: actor.inboxTarget,
      total: stats.total,
      unread: stats.unread,
      max: deps.agentInbox.MAX_INBOX_MESSAGES ?? null,
    };
  });

  fastify.put('/actors/:id/inbox/read-all', async (
    request: FastifyRequest<{ Params: ActorParams }>,
    reply: FastifyReply,
  ) => {
    const actor = actorOr404(request.params.id, deps);
    if (!actor) {
      return reply.code(404).send({
        success: false,
        error: `Unknown maritime actor: ${request.params.id}`,
        code: 'ACTOR_NOT_FOUND',
      });
    }
    if (!deps.agentInbox) {
      return reply.code(501).send({
        success: false,
        error: 'actor inbox is unavailable',
        code: 'ACTOR_INBOX_UNAVAILABLE',
      });
    }

    const result = deps.agentInbox.markAllRead(actor.inboxTarget);
    return {
      success: true,
      actorId: actor.id,
      inboxTarget: actor.inboxTarget,
      marked: result.marked ?? 0,
    };
  });
};
