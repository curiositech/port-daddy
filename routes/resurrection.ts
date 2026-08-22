/**
 * Salvage Routes (formerly "Resurrection")
 *
 * Agent self-healing system routes for discovering and reclaiming
 * work from stale or dead agents.
 *
 * Primary routes: /salvage/*
 * Deprecated aliases: /resurrection/* (backward-compatible)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  extractActorCredential,
  resolveWriteIdentity,
  type IdentityVerifier,
  type IdentityWriteVerdict,
} from '../lib/identity-write-boundary.js';

interface StaleAgent {
  id: string;
  name: string;
  purpose: string | null;
  sessionId: string | null;
  lastHeartbeat: number;
  staleSince: number;
  status: 'pending' | 'stale' | 'dead' | 'resurrecting';
  notes?: string[];
  // Semantic identity components for prefix filtering
  identityProject: string | null;
  identityStack: string | null;
  identityContext: string | null;
}

interface ResurrectionRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  resurrection: {
    pending(options?: { project?: string; stack?: string; limit?: number }): { success: boolean; agents: StaleAgent[]; count: number; filtered?: boolean };
    list(options?: { limit?: number; project?: string; stack?: string }): { success: boolean; agents: StaleAgent[]; count: number; filtered?: boolean };
    claim(agentId: string): { success: boolean; agent?: StaleAgent; context?: Record<string, unknown>; error?: string };
    complete(oldAgentId: string, newAgentId: string): { success: boolean };
    abandon(agentId: string): { success: boolean };
    dismiss(agentId: string): { success: boolean };
    countByProject(project: string): number;
  };
  messaging: {
    publish(channel: string, message: string): { success: boolean };
  };
  activityLog: {
    log(type: string, details: Record<string, unknown>): void;
  };
  /**
   * ADR-0040 souls store (subset). Salvage mutations REQUIRE the daemon-minted
   * credential (#8877 / ADR-0122): successor linkage (`complete`) is the
   * identity-continuity primitive — an unverified `newAgentId` is exactly the
   * reputation-whitewashing hole #8877 names — so claim/complete/abandon/
   * dismiss all reject without a verified credential, and a `newAgentId`
   * bound to a different soul is 403.
   */
  actorSouls?: IdentityVerifier | null;
}

/**
 * Create salvage routes (with /resurrection backward-compatible aliases)
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const resurrectionPlugin: FastifyPluginAsync<{ deps: ResurrectionRouteDeps }> = async (fastify, opts) => {
  const { logger, metrics, resurrection, messaging, actorSouls } = opts.deps;

  /**
   * The strict identity gate for every salvage mutation.
   *
   * Purpose: salvage claim/complete rewrite ANOTHER agent's lineage (who took
   * over its work, which successor id continues its record), which makes them
   * always-attributed write boundaries under #8877 / ADR-0122. The caller
   * must present the daemon-minted credential (`x-actor-credential` header or
   * body `credential`); a self-asserted successor id with no credential is
   * 401, a forged credential is 401, and a successor id that resolves to a
   * DIFFERENT minted soul than the credential's is 403 — you cannot complete
   * salvage onto someone else's identity. The dead agent's id in the path is
   * the TARGET of the operation, not the caller's assertion, so it is not
   * checked here.
   *
   * @param request - The incoming Fastify request (credential carriers).
   * @param assertedNewAgentId - The successor id the caller asserts, if any.
   * @param route - Route label for structured reject logs.
   * @returns The verified verdict, or the HTTP status and error body.
   */
  const requireSalvageIdentity = (
    request: FastifyRequest,
    assertedNewAgentId: unknown,
    route: string,
  ):
    | { success: true; verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }> }
    | { success: false; httpStatus: number; result: Record<string, unknown> } => {
    const verdict = resolveWriteIdentity({
      souls: actorSouls,
      credential: extractActorCredential(request.headers as Record<string, unknown>, request.body),
      assertedAgentId: typeof assertedNewAgentId === 'string' ? assertedNewAgentId : null,
      route,
      logger,
      requireIdentity: true,
    });
    if (!verdict.ok) {
      return {
        success: false,
        httpStatus: verdict.httpStatus,
        result: { success: false, error: verdict.error, code: verdict.code },
      };
    }
    return { success: true, verdict: verdict as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }> };
  };

  // Shared handler implementations as async functions

  function parseLimit(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  async function fHandlePending(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { limit, project, stack } = request.query as any;
      return resurrection.pending({
        limit: parseLimit(limit),
        project: project as string | undefined,
        stack: stack as string | undefined
      });
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_pending_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleList(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { limit, project, stack } = request.query as any;
      return resurrection.list({
        limit: parseLimit(limit),
        project: project as string | undefined,
        stack: stack as string | undefined
      });
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleClaim(request: FastifyRequest, reply: FastifyReply) {
    try {
      const agentId = (request.params as any).agentId as string;
      const identity = requireSalvageIdentity(request, (request.body as any)?.newAgentId, 'POST /salvage/claim/:agentId');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }
      const result = resurrection.claim(agentId);

      if (!result.success) {
        reply.code(400);
        return { error: result.error };
      }

      messaging.publish('salvage', JSON.stringify({
        event: 'claimed',
        agentId,
        claimedBy: (request.body as any)?.newAgentId || identity.verdict.actorId,
        claimedByActorId: identity.verdict.actorId
      }));

      logger.info('salvage_claimed', { agentId, claimedByActorId: identity.verdict.actorId });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_claim_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleComplete(request: FastifyRequest, reply: FastifyReply) {
    try {
      const oldAgentId = (request.params as any).agentId as string;
      const { newAgentId } = request.body as any;

      // The successor id must be a non-empty STRING: a truthy non-string
      // (number, object) would slip past requireSalvageIdentity's typeof
      // narrowing (it treats non-strings as "no asserted id", skipping the
      // alias-mismatch check) and land unvalidated in the successor record.
      if (typeof newAgentId !== 'string' || !newAgentId.trim()) {
        reply.code(400);
        return { error: 'newAgentId required' };
      }

      // #8877: successor linkage is the whitewashing primitive — the caller
      // must hold a verified credential, and `newAgentId` must not resolve
      // to a different minted soul than that credential's.
      const identity = requireSalvageIdentity(request, newAgentId, 'POST /salvage/complete/:agentId');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }

      const result = resurrection.complete(oldAgentId, newAgentId);

      logger.info('salvage_complete', { oldAgentId, newAgentId, completedByActorId: identity.verdict.actorId });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('salvage_complete_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleAbandon(request: FastifyRequest, reply: FastifyReply) {
    try {
      const agentId = (request.params as any).agentId as string;
      const identity = requireSalvageIdentity(request, null, 'POST /salvage/abandon/:agentId');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }
      const result = resurrection.abandon(agentId);

      messaging.publish('salvage', JSON.stringify({
        event: 'abandoned',
        agentId
      }));

      logger.info('salvage_abandoned', { agentId });
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  async function fHandleDismiss(request: FastifyRequest, reply: FastifyReply) {
    try {
      const agentId = (request.params as any).agentId as string;
      const identity = requireSalvageIdentity(request, null, 'DELETE /salvage/:agentId');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }
      const result = resurrection.dismiss(agentId);

      logger.info('salvage_dismissed', { agentId });
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  }

  // PRIMARY ROUTES: /salvage/*
  fastify.get('/salvage/pending', fHandlePending);
  fastify.get('/salvage', fHandleList);
  fastify.post('/salvage/claim/:agentId', fHandleClaim);
  fastify.post('/salvage/complete/:agentId', fHandleComplete);
  fastify.post('/salvage/abandon/:agentId', fHandleAbandon);
  fastify.delete('/salvage/:agentId', fHandleDismiss);

  // DEPRECATED ALIASES: /resurrection/*
  fastify.get('/resurrection/pending', fHandlePending);
  fastify.get('/resurrection', fHandleList);
  fastify.post('/resurrection/claim/:agentId', fHandleClaim);
  fastify.post('/resurrection/complete/:agentId', fHandleComplete);
  fastify.post('/resurrection/abandon/:agentId', fHandleAbandon);
  fastify.delete('/resurrection/:agentId', fHandleDismiss);

  // Reap aliases
  fastify.post('/resurrection/reap', fHandlePending);
  fastify.post('/salvage/reap', fHandlePending);
};
