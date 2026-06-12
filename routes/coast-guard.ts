/**
 * Coast Guard rent → slash routes (ADR-0050, phase 7).
 *
 *   POST /coast-guard/rent-breach { sessionId, commitsWithoutNote? }
 *        — Record a coordination-rent breach for the CALLER'S OWN session and
 *          apply the graduated slash decision. ADVISORY by default (logs the
 *          slash that WOULD happen, debits nothing); only debits a bond when the
 *          daemon runs with PD_RENT_SLASH_MODE=enforce.
 *
 *   POST /coast-guard/rent-cure { sessionId }
 *        — The caller paid rent again (a note per commit). Decay their breach
 *          escalation by one toward grace (graduated, not grim).
 *
 *   GET  /coast-guard/rent-status?sessionId=
 *        — Read the current mode + the caller's breach state. Side-effect free.
 *
 * SYBIL / GRIEFING DEFENSE (the load-bearing design choice): the breaching
 * PRINCIPAL is derived SERVER-SIDE from the session row's own `agentId` — it is
 * NEVER read from the request body. A caller can therefore only ever escalate /
 * slash ITS OWN principal's bond; it cannot name a neighbour to slash them. The
 * slash itself targets that principal's own bond (see rent-slash-enforcer.ts).
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Bonds } from '../lib/bonds.js';
import type { RentBreachLedger } from '../lib/coast-guard/rent-breach-ledger.js';
import { parseIdentity } from '../lib/identity.js';
import { resolveRentSlashMode, type RentSlashMode } from '../lib/coast-guard/rent-slash.js';
import { applyRentSlash } from '../lib/coast-guard/rent-slash-enforcer.js';

interface SessionView {
  agentId: string | null;
  identityProject: string | null;
  status: string;
}

interface CoastGuardRouteDeps {
  bonds: Bonds;
  breachLedger: RentBreachLedger;
  /** Minimal session lookup: returns the caller's own session, or a failure. */
  sessions: {
    get(sessionId: string): { success: boolean; session?: SessionView; error?: string };
  };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Override the resolved mode (tests). Defaults to env-resolved (advisory). */
  resolveMode?: () => RentSlashMode;
  metrics?: { errors: number };
}

/** Derive the slashable project from the principal identity, falling back to
 *  the session's recorded identity_project. The bond is keyed under the
 *  identity's project segment. */
function projectFor(principal: string, identityProject: string | null): string | null {
  const parsed = parseIdentity(principal);
  if (parsed.valid && parsed.project) return parsed.project;
  return identityProject || null;
}

export const coastGuardPlugin: FastifyPluginAsync<{ deps: CoastGuardRouteDeps }> = async (
  app,
  opts,
) => {
  const { bonds, breachLedger, sessions, logger, metrics } = opts.deps;
  const resolveMode = opts.deps.resolveMode ?? (() => resolveRentSlashMode());

  /** Resolve the caller's own principal from their session id. Returns a 4xx
   *  body on any failure (no session, no identity) — never throws to the caller. */
  function resolveCaller(sessionId: unknown):
    | { ok: true; principal: string; project: string }
    | { ok: false; code: number; error: string } {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return { ok: false, code: 400, error: 'sessionId is required' };
    }
    const res = sessions.get(sessionId.trim());
    if (!res.success || !res.session) {
      return { ok: false, code: 404, error: 'session not found' };
    }
    const principal = res.session.agentId;
    if (!principal) {
      // No semantic identity → no bond to key against. Nothing to escalate.
      return { ok: false, code: 422, error: 'session has no identity (agentId); nothing to bond against' };
    }
    const project = projectFor(principal, res.session.identityProject);
    if (!project) {
      return { ok: false, code: 422, error: 'cannot resolve a project for this principal' };
    }
    return { ok: true, principal, project };
  }

  app.post('/coast-guard/rent-breach', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (request.body as Record<string, unknown>) || {};
      const caller = resolveCaller(body.sessionId);
      if (!caller.ok) {
        reply.code(caller.code);
        return { error: caller.error };
      }
      const commitsWithoutNoteRaw = Number(body.commitsWithoutNote);
      const commitsWithoutNote =
        Number.isFinite(commitsWithoutNoteRaw) && commitsWithoutNoteRaw > 0
          ? Math.floor(commitsWithoutNoteRaw)
          : 1;

      const mode = resolveMode();
      // Record the breach FIRST (the escalation memory), then act on the count.
      // Even in 'off' we record — the ledger is observability the operator can
      // read before deciding to arm enforce; recording moves no money.
      const breachCount = breachLedger.recordBreach(caller.principal, caller.project, Date.now());

      const outcome = applyRentSlash(
        { bonds, mode, logger: { info: (m) => logger.info(m), warn: (m) => logger.warn(m) } },
        { principal: caller.principal, project: caller.project, breachCount, commitsWithoutNote },
      );

      return {
        success: true,
        mode: outcome.mode,
        principal: caller.principal,
        project: caller.project,
        breachCount,
        // Echo the decision so the operator/dashboard can see what WOULD/ DID happen.
        shouldSlash: outcome.decision?.shouldSlash ?? false,
        fraction: outcome.decision?.fraction ?? 0,
        bondId: outcome.bondId,
        amountUsd: outcome.amountUsd,
        slashed: outcome.slashed,
        skipReason: outcome.skipReason ?? null,
      };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('coast_guard_rent_breach_error', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  app.post('/coast-guard/rent-cure', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (request.body as Record<string, unknown>) || {};
      const caller = resolveCaller(body.sessionId);
      if (!caller.ok) {
        reply.code(caller.code);
        return { error: caller.error };
      }
      const breachCount = breachLedger.cure(caller.principal, Date.now());
      return { success: true, principal: caller.principal, breachCount };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('coast_guard_rent_cure_error', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  app.get('/coast-guard/rent-status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = (request.query as Record<string, string | undefined>) || {};
      const mode = resolveMode();
      const sessionId = q.sessionId?.trim();
      if (!sessionId) {
        // No session → just report the daemon's current mode.
        return { success: true, mode, state: null };
      }
      const caller = resolveCaller(sessionId);
      if (!caller.ok) {
        reply.code(caller.code);
        return { error: caller.error };
      }
      const state = breachLedger.getState(caller.principal);
      return { success: true, mode, principal: caller.principal, project: caller.project, state };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('coast_guard_rent_status_error', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
