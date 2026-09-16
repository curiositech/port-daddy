import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type {
  CallParleyInput,
  Parley,
  ParleyPerformative,
  ParleyStatus,
  ParleyTrigger,
  ResolveParleyInput,
  RespondParleyInput,
} from '../lib/parley.js';

interface ParleyDeps {
  parley: Parley;
}

/**
 * Normalizes an optional scalar request field before passing it to Parley policy.
 * The purpose is to distinguish absent fields from canonical, non-blank user input.
 * @param value Untrusted request value.
 * @returns A trimmed non-empty string, or undefined when no scalar value was supplied.
 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Normalizes an optional request array into usable non-blank strings.
 * The design prevents malformed transport values from reaching Parley domain methods.
 * @param value Untrusted request value.
 * @returns Canonical string entries, or undefined when the field is not an array.
 */
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/**
 * Parses a positive integer request value without accepting fractional or non-finite input.
 * The purpose is to maintain bounded lifecycle settings at the HTTP boundary.
 * @param value Untrusted request value.
 * @returns A positive integer, or undefined when validation fails.
 */
function asPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Narrows a transport string to one of Parley's supported performatives.
 * The design keeps route validation aligned with the domain protocol vocabulary.
 * @param value Candidate request value.
 * @returns Whether the value is a supported Parley performative.
 */
function isPerformative(value: string | undefined): value is ParleyPerformative {
  return value === 'propose'
    || value === 'critique'
    || value === 'revise'
    || value === 'agree'
    || value === 'refuse'
    || value === 'inform';
}

/**
 * Narrows a transport string to a supported automatic or operator trigger.
 * The purpose is to reject invented trigger names before durable state is written.
 * @param value Candidate request value.
 * @returns Whether the value is a supported Parley trigger.
 */
function isTrigger(value: string | undefined): value is ParleyTrigger {
  return value === 'operator' || value === 'claim_overlap' || value === 'detector' || value === 'swarm_fit';
}

/**
 * Narrows a transport string to a queryable Parley lifecycle status.
 * The design keeps list filtering explicit instead of forwarding arbitrary store values.
 * @param value Candidate query value.
 * @returns Whether the value is a supported Parley status.
 */
function isStatus(value: string | undefined): value is ParleyStatus {
  return value === 'SUMMONED'
    || value === 'CONVENED'
    || value === 'COLLAPSED'
    || value === 'ESCALATED'
    || value === 'VOIDED';
}

/**
 * Registers the Parley HTTP boundary and forwards validated context to the domain service.
 * The purpose is to ensure call, response, receipt, lookup, and CAP0-gated resolve paths share harbor scope.
 * @param fastify Fastify instance receiving the Parley routes.
 * @param opts Plugin dependencies, including the configured Parley service.
 * @returns A promise that resolves after the route set is registered.
 */
export const parleyPlugin: FastifyPluginAsync<{ deps: ParleyDeps }> = async (fastify, opts) => {
  const { parley } = opts.deps;

  fastify.post('/parley/call', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const surface = asString(body.surface);
    const reason = asString(body.reason);
    const calledBy = asString(body.calledBy) ?? asString(body.as);
    const parties = asStringArray(body.parties) ?? asStringArray(body.with);
    const triggerRaw = asString(body.trigger);
    if (!surface || !reason || !calledBy || !parties) {
      reply.code(400);
      return { success: false, error: 'surface, reason, calledBy, and parties[] are required' };
    }
    const input: CallParleyInput = {
      surface,
      reason,
      calledBy,
      parties,
      harbor: asString(body.harbor),
      trigger: isTrigger(triggerRaw) ? triggerRaw : undefined,
      ttlMs: asPositiveInt(body.ttlMs),
      roundLimit: asPositiveInt(body.roundLimit),
    };
    try {
      const record = parley.call(input);
      return { success: true, parley: record };
    } catch (error) {
      reply.code(400);
      return { success: false, error: error instanceof Error ? error.message : 'call failed' };
    }
  });

  fastify.post('/parley/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const parleyId = asString(body.parleyId);
    const harbor = asString(body.harbor);
    const party = asString(body.party) ?? asString(body.as);
    const performativeRaw = asString(body.performative);
    const content = asString(body.content);
    if (!parleyId || !party || !performativeRaw || !content) {
      reply.code(400);
      return { success: false, error: 'parleyId, party, performative, and content are required' };
    }
    if (!isPerformative(performativeRaw)) {
      reply.code(400);
      return { success: false, error: 'performative must be propose/critique/revise/agree/refuse/inform' };
    }
    const input: RespondParleyInput = {
      parleyId,
      harbor,
      party,
      performative: performativeRaw,
      content,
      proposalId: asString(body.proposalId) ?? null,
      evidenceRefs: asStringArray(body.evidenceRefs) ?? [],
    };
    try {
      const { turn, notified, notifyFailures } = parley.respond(input);
      const status = parley.get(parleyId, harbor);
      return { success: true, turn, notified, notifyFailures, status };
    } catch (error) {
      reply.code(400);
      return { success: false, error: error instanceof Error ? error.message : 'respond failed' };
    }
  });

  fastify.post('/parley/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const parleyId = asString(body.parleyId);
    const harbor = asString(body.harbor);
    const statusRaw = asString(body.status);
    const resolvedBy = asString(body.resolvedBy) ?? asString(body.as);
    if (!parleyId || !statusRaw || !resolvedBy) {
      reply.code(400);
      return { success: false, error: 'parleyId, status, and resolvedBy are required' };
    }
    if (statusRaw !== 'COLLAPSED' && statusRaw !== 'ESCALATED' && statusRaw !== 'VOIDED') {
      reply.code(400);
      return { success: false, error: 'status must be COLLAPSED, ESCALATED, or VOIDED' };
    }
    const input: ResolveParleyInput = {
      parleyId,
      harbor,
      status: statusRaw,
      resolvedBy,
      decision: asString(body.decision) ?? null,
      reason: asString(body.reason) ?? null,
      dissenters: asStringArray(body.dissenters) ?? [],
    };
    try {
      const outcome = parley.resolve(input);
      const summary = parley.get(parleyId, harbor);
      return { success: true, outcome, summary };
    } catch (error) {
      reply.code(400);
      return { success: false, error: error instanceof Error ? error.message : 'resolve failed' };
    }
  });

  fastify.get('/parley', async (request: FastifyRequest) => {
    const query = request.query as Record<string, unknown>;
    const statusRaw = asString(query.status);
    const summaries = parley.list({
      harbor: asString(query.harbor),
      status: isStatus(statusRaw) ? statusRaw : undefined,
      limit: asPositiveInt(query.limit) ?? 50,
    });
    return { success: true, parleys: summaries, count: summaries.length };
  });

  fastify.get('/parley/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id?: string };
    const parleyId = asString(params.id);
    if (!parleyId) {
      reply.code(400);
      return { success: false, error: 'parley id required in path' };
    }
    // Reading is seeing: `?as=<participant>` records a read receipt before the
    // summary is built, so the returned receipts already reflect this read.
    // Unknown parties are ignored rather than rejected — the read still works.
    const query = request.query as Record<string, unknown>;
    const harbor = asString(query.harbor);
    const as = asString(query.as);
    let receiptRecorded = false;
    if (as) {
      try {
        parley.markSeen({ parleyId, harbor, party: as });
        receiptRecorded = true;
      } catch {
        receiptRecorded = false;
      }
    }
    const summary = parley.get(parleyId, harbor);
    if (!summary) {
      reply.code(404);
      return { success: false, error: `parley '${parleyId}' not found` };
    }
    return { success: true, summary, receiptRecorded };
  });
};
