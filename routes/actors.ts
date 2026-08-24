import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getActor,
  listActors,
  resolveActorId,
} from '../lib/actor-roster.js';
import type { ActorRecord } from '../lib/actor-roster.js';
import {
  VERIFIED_ACTOR_INBOX_REGISTRATION,
  type createAgents,
} from '../lib/agents.js';
import type { createAgentInbox } from '../lib/agent-inbox.js';
import type { createResurrection } from '../lib/resurrection.js';
import type { createSessions } from '../lib/sessions.js';
import type { ActorSouls } from '../lib/actor-souls.js';
import {
  authorizeCanonicalInboxOwner,
  createExternalInboxRateLimiter,
  parseExternalInboxContent,
  resolveCanonicalInboxTarget,
  resolveExternalInboxSender,
  type ExternalInboxRateLimiter,
  type InboxBoundaryFailure,
} from '../lib/inbox-http-boundary.js';
import type { BoundaryLogger } from '../lib/identity-write-boundary.js';

type AgentsManager = ReturnType<typeof createAgents>;
type AgentInboxManager = ReturnType<typeof createAgentInbox>;
type SessionsManager = ReturnType<typeof createSessions>;
type ResurrectionManager = ReturnType<typeof createResurrection>;

interface ActorsRouteDeps {
  agents?: AgentsManager;
  agentInbox?: AgentInboxManager;
  sessions?: SessionsManager;
  resurrection?: ResurrectionManager;
  /** ADR-0040 daemon-minted actor identity store (POST /actors/register). */
  actorSouls?: ActorSouls;
  logger?: BoundaryLogger;
  externalInboxLimiter?: ExternalInboxRateLimiter;
}

interface RegisterActorBody {
  /** Retired caller scope. Any supplied value is rejected. */
  harbor?: string;
  /** Display alias ('project:stack:context'). Display-only; never a principal. */
  alias?: string;
  /** '<actor_id>.<secret>' lookup token from a prior mint. Re-presents a soul. */
  credential?: string;
  /** Operator escape hatch (advisory-above-floor; see ADR-0040 §2.4). */
  operatorToken?: string;
  /** Retired caller scope. Admission uses a daemon-owned bucket. */
  project?: string;
  /** Display-only legacy handle. It is ignored and never becomes a party. */
  agentId?: string;
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
  contentType?: unknown;
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

function attachMailboxStats(actor: ActorRecord, deps: ActorsRouteDeps): ActorRecord {
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

function actorOr404(
  id: string,
  deps: ActorsRouteDeps,
  project?: string,
  includeMailboxStats: boolean = true,
): ActorRecord | null {
  const actor = getActor(id, collectProjectionInput(deps, { project }));
  return actor && includeMailboxStats ? attachMailboxStats(actor, deps) : actor;
}

export const actorsPlugin: FastifyPluginAsync<{ deps?: ActorsRouteDeps }> = async (fastify, opts) => {
  const deps = opts.deps ?? {};
  const externalInboxLimiter = deps.externalInboxLimiter ?? createExternalInboxRateLimiter();

  function boundaryError(reply: FastifyReply, outcome: InboxBoundaryFailure) {
    return reply.code(outcome.httpStatus).send({
      success: false,
      error: outcome.error,
      code: outcome.code,
    });
  }

  fastify.get('/actors', async (request: FastifyRequest<{ Querystring: ActorsQuery }>) => {
    const input = collectProjectionInput(deps, request.query ?? {});
    const actors = listActors(input)
      .map(actor => attachMailboxStats(actor, deps));

    return {
      success: true,
      count: actors.length,
      actors,
    };
  });

  // ADR-0040 keystone: the ONLY path to a daemon-minted, non-forgeable
  // principal. A minted actor_id is bound to a lookup-token credential
  // ("<actor_id>.<secret>"); re-presenting a valid credential returns the SAME
  // id (idempotent), a forged/mismatched one is rejected 401 (never mints), and
  // an uncredentialed registration mints a fresh NEWCOMER that draws from the
  // daemon-selected local admission bucket — request fields cannot buy a new
  // tenant budget by renaming their project or harbor.
  //
  // This is NOT self-asserted registration. POST /agents still exists for
  // liveness bookkeeping but its self-asserted `id` is a DISPLAY handle only;
  // an above-floor economic ceiling requires a minted, credentialed, graduated
  // soul, enforced at the budget-guard spend choke.
  fastify.post('/actors/register', async (
    request: FastifyRequest<{ Body: RegisterActorBody }>,
    reply: FastifyReply,
  ) => {
    if (!deps.actorSouls) {
      return reply.code(501).send({
        success: false,
        error: 'actor identity minting is unavailable',
        code: 'ACTOR_SOULS_UNAVAILABLE',
      });
    }
    if (!deps.agents) {
      return reply.code(503).send({
        success: false,
        error: 'the verified actor inbox registry is unavailable',
        code: 'ACTOR_INBOX_REGISTRY_UNAVAILABLE',
      });
    }

    const body = request.body ?? {};
    // Local registration has exactly one daemon-owned authority scope. Request
    // JSON, Host, forwarding headers, and loopback provenance cannot select a
    // tenant. A future multi-tenant ingress must inject an authenticated scope
    // into the daemon dependency graph before reaching this route.
    if (body.harbor !== undefined || body.project !== undefined) {
      return reply.code(400).send({
        success: false,
        error: 'actor registration scope is selected by the daemon, not request fields',
        code: 'ACTOR_REGISTRATION_SCOPE_UNVERIFIED',
      });
    }
    const harbor = deps.actorSouls.constants.defaultHarbor;
    const outcome = deps.actorSouls.registerAtomically({
      harbor,
      alias: typeof body.alias === 'string' ? body.alias : undefined,
      credential: typeof body.credential === 'string' ? body.credential : undefined,
      operatorToken: typeof body.operatorToken === 'string' ? body.operatorToken : undefined,
      // The current local daemon admits every newcomer against one server-owned
      // bucket. Caller project/display identity has zero admission authority.
      project: harbor,
    }, registration => deps.agents!.register(registration.actorId, {
      name: typeof body.alias === 'string' ? body.alias : null,
      metadata: {
        actorIdentity: {
          verified: true,
          actorId: registration.actorId,
          harbor,
        },
      },
      [VERIFIED_ACTOR_INBOX_REGISTRATION]: {
        actorId: registration.actorId,
        harbor,
      },
    }));

    if (!outcome.ok) {
      if (outcome.code === 'REGISTRATION_EFFECT_FAILED') {
        const effect = outcome.effect as { code?: string } | undefined;
        return reply.code(503).send({
          success: false,
          error: 'the verified actor inbox could not be registered',
          code: effect?.code || 'ACTOR_INBOX_REGISTRATION_FAILED',
        });
      }
      return reply.code(outcome.httpStatus).send({
        success: false,
        error: outcome.code === 'CREDENTIAL_INVALID'
          ? 'credential did not verify'
          : outcome.code === 'NEWCOMER_ADMIT_LIMIT'
            ? 'newcomer admission limit reached for this project today'
            : 'identity store unavailable',
        code: outcome.code,
      });
    }
    const registration = outcome.registration;

    // The plaintext credential is returned ONCE (only on a fresh mint). The
    // caller MUST persist it to re-authenticate the same soul; there is no
    // recovery path (a lost credential means a new newcomer next time).
    if (registration.status === 'minted') {
      return reply.code(201).send({
        success: true,
        status: 'minted',
        actorId: registration.actorId,
        inboxTarget: registration.actorId,
        soulClass: registration.soulClass,
        credential: registration.credential,
      });
    }

    return reply.send({
      success: true,
      status: 'resolved',
      actorId: registration.actorId,
      inboxTarget: registration.actorId,
      soulClass: registration.soulClass,
    });
  });

  fastify.get('/actors/:id', async (
    request: FastifyRequest<{ Params: ActorParams; Querystring: ActorsQuery }>,
    reply: FastifyReply,
  ) => {
    const resolvedId = resolveActorId(request.params.id);
    if (!resolvedId) {
      return reply.code(404).send({
        success: false,
        error: `Unknown actor: ${request.params.id}`,
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
    const content = parseExternalInboxContent(request.body);
    if (!content.ok) return boundaryError(reply, content);
    if (!deps.agentInbox) {
      return reply.code(501).send({
        success: false,
        error: 'actor inbox is unavailable',
        code: 'ACTOR_INBOX_UNAVAILABLE',
      });
    }
    const target = resolveCanonicalInboxTarget({
      souls: deps.actorSouls,
      resolver: deps.agents,
      requestedActorId: request.params.id,
    });
    if (!target.ok) return boundaryError(reply, target);
    const sender = resolveExternalInboxSender({
      souls: deps.actorSouls,
      resolver: deps.agents,
      headers: request.headers as Record<string, unknown>,
      harbor: target.harbor,
      route: 'POST /actors/:id/message',
      logger: deps.logger,
    });
    if (!sender.ok) return boundaryError(reply, sender);
    const rate = externalInboxLimiter.consume({
      senderActorId: sender.provenance.actorId,
      targetActorId: target.actorId,
    });
    if (!rate.ok) {
      return reply
        .code(429)
        .header('Retry-After', String(rate.retryAfterSeconds ?? 1))
        .send({
          success: false,
          error: 'external inbox delivery rate limit exceeded',
          code: 'INBOX_RATE_LIMITED',
          scope: rate.scope,
        });
    }

    const result = deps.agentInbox.send(target.inboxTarget, content.content, {
      from: sender.from,
      type: sender.messageType,
      contentType: content.contentType,
    });
    if (!result.success) {
      const statusCode = (result as Record<string, unknown>).code === 'RESOURCE_LIMIT' ? 429 : 400;
      return reply.code(statusCode).send({
        success: false,
        error: result.error,
        code: (result as Record<string, unknown>).code,
      });
    }

    return {
      success: true,
      actorId: target.actorId,
      inboxTarget: target.inboxTarget,
      messageId: result.messageId,
      delivered: true,
      woke: false,
      provenance: sender.provenance,
    };
  });

  fastify.get('/actors/:id/inbox', async (
    request: FastifyRequest<{ Params: ActorParams; Querystring: ActorInboxQuery }>,
    reply: FastifyReply,
  ) => {
    if (!deps.agentInbox) {
      return reply.code(501).send({
        success: false,
        error: 'actor inbox is unavailable',
        code: 'ACTOR_INBOX_UNAVAILABLE',
      });
    }
    const owner = authorizeCanonicalInboxOwner({
      souls: deps.actorSouls,
      resolver: deps.agents,
      headers: request.headers as Record<string, unknown>,
      requestedActorId: request.params.id,
      route: 'GET /actors/:id/inbox',
      logger: deps.logger,
    });
    if (!owner.ok) return boundaryError(reply, owner);

    const limit = parseLimit(request.query?.limit);
    const result = deps.agentInbox.list(owner.inboxTarget, {
      unreadOnly: request.query?.unread === 'true',
      limit,
      since: parseSince(request.query?.since),
    });

    return {
      success: true,
      actorId: owner.actorId,
      inboxTarget: owner.inboxTarget,
      messages: result.messages,
      count: result.count,
    };
  });

  fastify.get('/actors/:id/inbox/stats', async (
    request: FastifyRequest<{ Params: ActorParams }>,
    reply: FastifyReply,
  ) => {
    if (!deps.agentInbox) {
      return reply.code(501).send({
        success: false,
        error: 'actor inbox is unavailable',
        code: 'ACTOR_INBOX_UNAVAILABLE',
      });
    }
    const owner = authorizeCanonicalInboxOwner({
      souls: deps.actorSouls,
      resolver: deps.agents,
      headers: request.headers as Record<string, unknown>,
      requestedActorId: request.params.id,
      route: 'GET /actors/:id/inbox/stats',
      logger: deps.logger,
    });
    if (!owner.ok) return boundaryError(reply, owner);

    const stats = deps.agentInbox.stats(owner.inboxTarget);
    return {
      success: true,
      actorId: owner.actorId,
      inboxTarget: owner.inboxTarget,
      total: stats.total,
      unread: stats.unread,
      max: deps.agentInbox.MAX_INBOX_MESSAGES ?? null,
    };
  });

  fastify.put('/actors/:id/inbox/read-all', async (
    request: FastifyRequest<{ Params: ActorParams }>,
    reply: FastifyReply,
  ) => {
    if (!deps.agentInbox) {
      return reply.code(501).send({
        success: false,
        error: 'actor inbox is unavailable',
        code: 'ACTOR_INBOX_UNAVAILABLE',
      });
    }
    const owner = authorizeCanonicalInboxOwner({
      souls: deps.actorSouls,
      resolver: deps.agents,
      headers: request.headers as Record<string, unknown>,
      requestedActorId: request.params.id,
      route: 'PUT /actors/:id/inbox/read-all',
      logger: deps.logger,
    });
    if (!owner.ok) return boundaryError(reply, owner);

    const result = deps.agentInbox.markAllRead(owner.inboxTarget);
    return {
      success: true,
      actorId: owner.actorId,
      inboxTarget: owner.inboxTarget,
      marked: result.marked ?? 0,
    };
  });
};
