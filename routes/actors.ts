import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getActor,
  listActors,
  resolveActorId,
} from '../lib/actor-roster.js';
import type { ActorRecord } from '../lib/actor-roster.js';
import type { createAgents } from '../lib/agents.js';
import type { createAgentInbox } from '../lib/agent-inbox.js';
import type { createResurrection } from '../lib/resurrection.js';
import type { createSessions } from '../lib/sessions.js';
import type { createFleetDaemon } from '../lib/fleet-daemon.js';
import type { ActorSouls } from '../lib/actor-souls.js';
import { createInboxIdentity } from '../lib/inbox-identity.js';

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
  /** ADR-0040 daemon-minted actor identity store (POST /actors/register). */
  actorSouls?: ActorSouls;
  /** Route logger — carries the structured identity-reject lines. */
  logger?: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

interface RegisterActorBody {
  /** Multi-tenant scope. Defaults to the souls store's default harbor. */
  harbor?: string;
  /** Display alias ('project:stack:context'). Display-only; never a principal. */
  alias?: string;
  /** '<actor_id>.<secret>' lookup token from a prior mint. Re-presents a soul. */
  credential?: string;
  /** Operator escape hatch (advisory-above-floor; see ADR-0040 §2.4). */
  operatorToken?: string;
}

interface ActorsQuery {
  project?: string;
  limit?: string;
}

interface SoulParams {
  actorId: string;
}

interface SoulLifecycleBody {
  /** Operator escape hatch (ADR-0040 §2.4) — required for retire/resurrect. */
  operatorToken?: unknown;
  reason?: unknown;
  by?: unknown;
  harbor?: unknown;
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

function actorOr404(id: string, deps: ActorsRouteDeps, project?: string): ActorRecord | null {
  const actor = getActor(id, collectProjectionInput(deps, { project }));
  return actor ? attachMailboxStats(actor, deps) : null;
}

export const actorsPlugin: FastifyPluginAsync<{ deps?: ActorsRouteDeps }> = async (fastify, opts) => {
  const deps = opts.deps ?? {};

  // POST /actors/:id/message is the SECOND door into the same agent_inbox
  // table, with the same unverified `from` and the same wake → hailAgent
  // path. Credentialing only /agents/:id/inbox would be bypassable in one
  // line of curl, so both doors share one gate (lib/inbox-identity.ts).
  const { requireInboxSender } = createInboxIdentity({
    souls: deps.actorSouls,
    sessions: deps.sessions,
    logger: deps.logger,
  });

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
  // shared spend pool — so minting fresh ids buys no new budget.
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

    const body = request.body ?? {};
    const outcome = deps.actorSouls.register({
      harbor: typeof body.harbor === 'string' ? body.harbor : undefined,
      alias: typeof body.alias === 'string' ? body.alias : undefined,
      credential: typeof body.credential === 'string' ? body.credential : undefined,
      operatorToken: typeof body.operatorToken === 'string' ? body.operatorToken : undefined,
    });

    if (!outcome.ok) {
      return reply.code(outcome.httpStatus).send({
        success: false,
        error: outcome.code === 'CREDENTIAL_INVALID'
          ? 'credential did not verify'
          : outcome.code === 'RESERVED_ALIAS'
            ? 'that alias is a reserved authority name; a self-service soul may not bind it (only an operator-token registration can)'
            : 'identity store unavailable',
        code: outcome.code,
      });
    }

    // The plaintext credential is returned ONCE (only on a fresh mint). The
    // caller MUST persist it to re-authenticate the same soul; there is no
    // recovery path (a lost credential means a new newcomer next time).
    if (outcome.status === 'minted') {
      return reply.code(201).send({
        success: true,
        status: 'minted',
        actorId: outcome.actorId,
        soulClass: outcome.soulClass,
        credential: outcome.credential,
      });
    }

    return reply.send({
      success: true,
      status: 'resolved',
      actorId: outcome.actorId,
      soulClass: outcome.soulClass,
    });
  });

  // ─── Retire / resurrect a minted soul (identity keystone) ─────────────────
  // Retirement is FINAL unless resurrected through this door. Both are
  // operator actions (the operator token, ADR-0040 §2.4), both are journaled
  // to the forensics sink (ADR-0089), and the DB refuses every other way
  // back (lib/actor-souls.ts triggers). `souls/` is a distinct segment from
  // the canonical actor roster ids served by /actors/:id.
  const requireOperator = (
    body: SoulLifecycleBody,
    reply: FastifyReply,
  ): boolean => {
    if (!deps.actorSouls) {
      void reply.code(501).send({ success: false, error: 'actor identity store is unavailable', code: 'ACTOR_SOULS_UNAVAILABLE' });
      return false;
    }
    if (typeof body.operatorToken !== 'string' || !deps.actorSouls.verifyOperatorToken(body.operatorToken)) {
      deps.logger?.error?.('actor_soul_lifecycle_refused', { reason: 'operator token missing or invalid' });
      void reply.code(403).send({ success: false, error: 'a valid operatorToken is required to change a soul\'s lifecycle', code: 'OPERATOR_TOKEN_REQUIRED' });
      return false;
    }
    if (typeof body.reason !== 'string' || !body.reason.trim()) {
      void reply.code(400).send({ success: false, error: 'reason required', code: 'VALIDATION_ERROR' });
      return false;
    }
    return true;
  };

  fastify.post('/actors/souls/:actorId/retire', async (
    request: FastifyRequest<{ Params: SoulParams; Body: SoulLifecycleBody }>,
    reply: FastifyReply,
  ) => {
    const body = request.body ?? {};
    if (!requireOperator(body, reply)) return reply;
    const souls = deps.actorSouls as ActorSouls;
    const outcome = souls.retire(request.params.actorId, {
      reason: (body.reason as string).trim(),
      by: typeof body.by === 'string' && body.by.trim() ? body.by.trim() : 'operator',
      harbor: typeof body.harbor === 'string' ? body.harbor : undefined,
    });
    if (!outcome.ok) {
      const status = outcome.code === 'SOUL_NOT_FOUND' ? 404 : 409;
      return reply.code(status).send({ success: false, error: outcome.code === 'SOUL_NOT_FOUND' ? 'unknown soul' : 'soul is already retired', code: outcome.code });
    }
    deps.logger?.info?.('actor_soul_retired', { actorId: outcome.actorId, retiredAt: outcome.retiredAt });
    return reply.send({ success: true, actorId: outcome.actorId, retired: true, retiredAt: outcome.retiredAt });
  });

  fastify.post('/actors/souls/:actorId/resurrect', async (
    request: FastifyRequest<{ Params: SoulParams; Body: SoulLifecycleBody }>,
    reply: FastifyReply,
  ) => {
    const body = request.body ?? {};
    if (!requireOperator(body, reply)) return reply;
    const souls = deps.actorSouls as ActorSouls;
    const outcome = souls.resurrect(request.params.actorId, {
      reason: (body.reason as string).trim(),
      by: typeof body.by === 'string' && body.by.trim() ? body.by.trim() : 'operator',
      harbor: typeof body.harbor === 'string' ? body.harbor : undefined,
    });
    if (!outcome.ok) {
      const status = outcome.code === 'SOUL_NOT_FOUND' ? 404 : 409;
      return reply.code(status).send({ success: false, error: outcome.code === 'SOUL_NOT_FOUND' ? 'unknown soul' : 'soul is not retired', code: outcome.code });
    }
    deps.logger?.info?.('actor_soul_resurrected', { actorId: outcome.actorId, receipt: outcome.receipt });
    return reply.send({ success: true, actorId: outcome.actorId, resurrected: true, receipt: outcome.receipt, resurrectedAt: outcome.resurrectedAt });
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
    const actor = actorOr404(request.params.id, deps);
    if (!actor) {
      return reply.code(404).send({
        success: false,
        error: `Unknown actor: ${request.params.id}`,
        code: 'ACTOR_NOT_FOUND',
      });
    }

    const { content, from, type, wake, project } = request.body ?? {};

    // Same strict gate as POST /agents/:id/inbox, applied before the message
    // is stored or the wake path can spawn anything. The body's `from` is
    // dead after this point.
    const sender = requireInboxSender(
      request.headers as Record<string, unknown>,
      request.body,
      from,
      'POST /actors/:id/message',
    );
    if (!sender.success) {
      return reply.code(sender.httpStatus).send(sender.result);
    }

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
      from: sender.from,
      fromActorId: sender.fromActorId,
      fromSoulClass: sender.fromSoulClass,
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
        from: sender.from,
        fromActorId: sender.fromActorId,
        fromSoulClass: sender.fromSoulClass,
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
        error: `Unknown actor: ${request.params.id}`,
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
        error: `Unknown actor: ${request.params.id}`,
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
        error: `Unknown actor: ${request.params.id}`,
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
