/**
 * Sugar Routes — Compound commands for common workflows
 *
 * POST /sugar/begin   - Register agent + start session atomically
 * POST /sugar/done    - End session + unregister agent
 * POST /sugar/relink  - Update the active session's rent-at-claim fields
 * GET  /sugar/whoami  - Show current agent/session context
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { ActorSouls } from '../lib/actor-souls.js';
import { VERIFIED_SUGAR_ACTOR_BINDING } from '../lib/sugar.js';
import {
  extractActorCredential,
  resolveWriteIdentity,
  stampIdentityMetadata,
  type IdentityWriteVerdict,
} from '../lib/identity-write-boundary.js';

/**
 * The souls-store subset the sugar routes need. Unlike the other enforced
 * write boundaries, `/sugar/begin` is a MINT DOOR (like POST /actors/register):
 * an uncredentialed begin mints a fresh ADR-0040 soul and returns its
 * credential once, so `register` is required here in addition to the verify /
 * resolve pair the shared boundary uses.
 */
type SugarActorSouls = Pick<
  ActorSouls,
  'verifyCredential' | 'resolveActor' | 'registerAtomically' | 'constants'
>;

interface SugarRouteDeps {
  sugar: {
    begin(options: Record<string, unknown>): Record<string, unknown>;
    done(options: Record<string, unknown>): Record<string, unknown>;
    whoami(options: Record<string, unknown>): Record<string, unknown>;
    relink(options: Record<string, unknown>): Record<string, unknown>;
    getWelcomeBriefing?(harbor?: string): Record<string, unknown>;
  };
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /**
   * ADR-0040 souls store (#8877 / ADR-0122). `/sugar/begin` mints (or
   * verifies) the daemon-minted identity every subsequent attributed write
   * requires; `/sugar/done` and `/sugar/relink` reject without one.
   */
  actorSouls?: SugarActorSouls | null;
}

type BeginLifecycle = 'durable' | 'ephemeral';

function parseBeginLifecycle(value: unknown): BeginLifecycle | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'durable' || normalized === 'ephemeral' ? normalized : null;
}


// =============================================================================
// Fastify plugin export
// =============================================================================
export const sugarPlugin: FastifyPluginAsync<{ deps: SugarRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { sugar, metrics, logger, actorSouls } = deps;

  /**
   * Resolve the identity for `/sugar/begin` — the fleet's mint door.
   *
   * Why begin is special (#8877 / ADR-0122): every OTHER attributed write
   * boundary requires a daemon-minted credential outright. But begin is where
   * an agent first appears, so it composes the mint into the same atomic
   * step, with strictly fail-closed rules:
   *
   * - Credential presented → it MUST verify (401 otherwise), and neither the
   *   asserted `agentId` nor `identity` may resolve to a DIFFERENT minted
   *   soul (403) — a real credential cannot launder another soul's name.
   * - No credential, and an asserted name resolves to an EXISTING minted
   *   soul → 401 IDENTITY_CREDENTIAL_REQUIRED. A registered name is owned;
   *   asserting it without its credential is exactly the impersonation #8877
   *   describes.
   * - No credential, names unowned (or none) → request a fresh newcomer mint.
   *   The route later commits that mint, canonical inbox registration, and
   *   session start in one shared-DB transaction against a daemon-owned
   *   admission scope. Caller display identity never selects that scope.
   * - Souls store unavailable → 503. Never admit an unverifiable identity.
   *
   * @param request - Incoming begin request (credential carriers: header
   *        `x-actor-credential` or body `credential`).
   * @param asserted - The self-asserted names on the request: `agentId` and
   *        `identity` (project:stack:context), either may be absent.
   * @returns A verified verdict, a side-effect-free mint request, or the HTTP
   *          error contract to return.
   */
  const resolveBeginIdentity = (
    request: FastifyRequest,
    asserted: { agentId?: unknown; identity?: unknown },
  ):
    | {
        success: true;
        kind: 'verified';
        verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;
      }
    | { success: true; kind: 'mint'; assertedAgentId: string | null; assertedIdentity: string | null }
    | { success: false; httpStatus: number; result: Record<string, unknown> } => {
    const credential = extractActorCredential(request.headers as Record<string, unknown>, request.body);
    const agentId = typeof asserted.agentId === 'string' && asserted.agentId.trim() ? asserted.agentId.trim() : null;
    const identity = typeof asserted.identity === 'string' && asserted.identity.trim() ? asserted.identity.trim() : null;

    if (!actorSouls) {
      logger.error('identity_write_rejected', { route: 'POST /sugar/begin', code: 'IDENTITY_VERIFIER_UNAVAILABLE' });
      return {
        success: false,
        httpStatus: 503,
        result: {
          success: false,
          error: 'the identity store is unavailable; refusing to admit an unverifiable identity',
          code: 'IDENTITY_VERIFIER_UNAVAILABLE',
        },
      };
    }

    if (credential) {
      const verdict = resolveWriteIdentity({
        souls: actorSouls,
        credential,
        assertedAgentId: agentId,
        route: 'POST /sugar/begin',
        logger,
      });
      if (!verdict.ok) {
        return {
          success: false,
          httpStatus: verdict.httpStatus,
          result: { success: false, error: verdict.error, code: verdict.code },
        };
      }
      // resolveWriteIdentity checked `agentId`; `identity` is a second
      // asserted name on this route and gets the identical laundering check.
      if (verdict.kind === 'verified' && identity) {
        const resolved = actorSouls.resolveActor(identity);
        if (resolved.soulClass !== 'unknown' && resolved.actorId !== verdict.actorId) {
          logger.error('identity_write_rejected', {
            route: 'POST /sugar/begin',
            code: 'IDENTITY_ALIAS_MISMATCH',
            actorId: verdict.actorId,
            assertedIdentity: identity,
          });
          return {
            success: false,
            httpStatus: 403,
            result: {
              success: false,
              error: `identity "${identity}" belongs to a different minted actor than the presented credential`,
              code: 'IDENTITY_ALIAS_MISMATCH',
            },
          };
        }
      }
      // A credential always yields `verified` (never anonymous) on success.
      return {
        success: true,
        kind: 'verified',
        verdict: verdict as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>,
      };
    }

    // Uncredentialed: refuse names owned by existing minted souls.
    for (const name of [agentId, identity]) {
      if (!name) continue;
      const resolved = actorSouls.resolveActor(name);
      if (resolved.soulClass !== 'unknown') {
        logger.error('identity_write_rejected', {
          route: 'POST /sugar/begin',
          code: 'IDENTITY_CREDENTIAL_REQUIRED',
          assertedAgentId: name,
        });
        return {
          success: false,
          httpStatus: 401,
          result: {
            success: false,
            error: `"${name}" resolves to an existing minted actor; present that actor's credential (x-actor-credential header or body "credential") to write under it`,
            code: 'IDENTITY_CREDENTIAL_REQUIRED',
          },
        };
      }
    }

    return {
      success: true,
      kind: 'mint',
      assertedAgentId: agentId,
      assertedIdentity: identity,
    };
  };

  /**
   * The strict identity gate shared by `/sugar/done` and `/sugar/relink`.
   *
   * Purpose: both routes mutate an attributed session (ending it, rewriting
   * its rent-at-claim links), so they are always-attributed write boundaries:
   * a daemon-minted credential is REQUIRED (the one `/sugar/begin` returned),
   * a forged one is 401, and an asserted `agentId` bound to a different soul
   * is 403. There is no anonymous path here by design.
   *
   * @param request - The incoming request (credential carriers as above).
   * @param bodyAgentId - The raw asserted `agentId` from the body, if any.
   * @param route - Route label for structured reject logs.
   * @returns The successful verdict, or the HTTP status + error body.
   */
  const requireSugarIdentity = (
    request: FastifyRequest,
    bodyAgentId: unknown,
    route: string,
  ):
    | { success: true; verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }> }
    | { success: false; httpStatus: number; result: Record<string, unknown> } => {
    const verdict = resolveWriteIdentity({
      souls: actorSouls,
      credential: extractActorCredential(request.headers as Record<string, unknown>, request.body),
      assertedAgentId: typeof bodyAgentId === 'string' ? bodyAgentId : null,
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
    // requireIdentity guarantees the successful verdict is verified.
    return {
      success: true,
      verdict: verdict as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>,
    };
  };

  // POST /sugar/begin
  fastify.post('/sugar/begin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const {
        purpose,
        identity,
        agentId,
        name,
        type,
        files,
        force,
        metadata,
        worktree,
        requireLinkedWorktree,
        allowMainWorktree,
        bypassCrowdedGate,
        lifecycle: rawLifecycle,
        roadmapLink,
        sidequestReason,
        roadmapNewTitle,
      } = request.body as any;

      if (!purpose || typeof purpose !== 'string') {
        logger.warn('sugar_begin_rejected', {
          code: 'VALIDATION_ERROR',
          error: 'purpose must be a non-empty string',
          identity,
          lifecycle: rawLifecycle,
          purpose,
          fileCount: Array.isArray(files) ? files.length : 0,
          hasSidequestReason: typeof sidequestReason === 'string' && sidequestReason.length > 0,
        });
        reply.code(400);
        return {
          success: false,
          error: 'purpose must be a non-empty string',
          code: 'VALIDATION_ERROR',
        };
      }

      const lifecycle = parseBeginLifecycle(rawLifecycle);
      if (!lifecycle) {
        logger.warn('sugar_begin_rejected', {
          code: 'SESSION_LIFECYCLE_REQUIRED',
          error: 'lifecycle must be explicitly set to "durable" or "ephemeral"',
          identity,
          lifecycle: rawLifecycle,
          purpose,
          fileCount: Array.isArray(files) ? files.length : 0,
          hasSidequestReason: typeof sidequestReason === 'string' && sidequestReason.length > 0,
        });
        reply.code(400);
        return {
          success: false,
          error: 'lifecycle must be explicitly set to "durable" or "ephemeral"',
          code: 'SESSION_LIFECYCLE_REQUIRED',
        };
      }

      // #8877 / ADR-0122: begin is the mint door. Verify a presented
      // credential (401/403 on forgery or laundering), or mint a fresh soul
      // for an uncredentialed caller whose asserted names are unowned — and
      // return that credential ONCE so every later attributed write can
      // present it.
      const beginIdentity = resolveBeginIdentity(request, { agentId, identity });
      if (!beginIdentity.success) {
        logger.warn('sugar_begin_rejected', {
          code: beginIdentity.result.code,
          error: beginIdentity.result.error,
          identity,
          lifecycle,
          purpose,
          fileCount: Array.isArray(files) ? files.length : 0,
          hasSidequestReason: typeof sidequestReason === 'string' && sidequestReason.length > 0,
        });
        reply.code(beginIdentity.httpStatus);
        return beginIdentity.result;
      }

      const beginWithVerdict = (
        verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>,
      ) => {
        const canonicalActorBinding = {
          actorId: verdict.actorId,
          harbor: actorSouls!.constants.defaultHarbor,
          // A request body can suggest display names, but the daemon selects
          // the delivery endpoint. It is always the canonical actor principal.
          inboxTarget: verdict.actorId,
        };
        const stampedMetadata = stampIdentityMetadata(
          metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null,
          verdict,
        );
        const canonicalMetadata = {
          ...(stampedMetadata ?? {}),
          actorInbox: {
            verified: true,
            ...canonicalActorBinding,
          },
        };

        return sugar.begin({
          purpose,
          identity,
          // The daemon-minted principal is the sole lifecycle owner. The raw
          // body agentId was checked above only for cross-soul laundering and
          // never crosses into lib/sugar as authority.
          [VERIFIED_SUGAR_ACTOR_BINDING]: canonicalActorBinding,
          name,
          type,
          files,
          force,
          // The session row is a durable attributed record: stamp the daemon's
          // identity verdict into its metadata (the caller-supplied `identity`
          // metadata key can never pre-fill the daemon's verdict slot).
          metadata: canonicalMetadata,
          worktree,
          requireLinkedWorktree,
          allowMainWorktree,
          bypassCrowdedGate,
          lifecycle,
          roadmapLink,
          sidequestReason,
          roadmapNewTitle,
        });
      };

      let beginVerdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;
      let mintedCredential: string | null = null;
      let result: Record<string, any>;
      if (beginIdentity.kind === 'verified') {
        beginVerdict = beginIdentity.verdict;
        result = beginWithVerdict(beginVerdict);
      } else {
        // A fresh soul, its canonical live inbox, and its session are one
        // shared-DB commit. The daemon-owned default harbor also owns the
        // admission bucket; caller identity/project strings are display only.
        const atomic = actorSouls!.registerAtomically({
          harbor: actorSouls!.constants.defaultHarbor,
          project: actorSouls!.constants.defaultHarbor,
        }, registration => {
          const actorId = registration.actorId as string;
          const verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }> = {
            ok: true,
            kind: 'verified',
            actorId,
            agentId: beginIdentity.assertedAgentId ?? beginIdentity.assertedIdentity ?? actorId,
            soulClass: registration.soulClass,
            identity: {
              verified: true,
              actorId,
              soulClass: registration.soulClass,
            },
          };
          const beginResult = beginWithVerdict(verdict);
          return {
            success: beginResult.success === true,
            verdict,
            result: beginResult,
            credential: registration.status === 'minted' ? registration.credential : null,
          };
        });

        if (!atomic.ok && atomic.code !== 'REGISTRATION_EFFECT_FAILED') {
          logger.error('identity_write_rejected', { route: 'POST /sugar/begin', code: atomic.code });
          reply.code(atomic.httpStatus);
          return {
            success: false,
            error: atomic.code === 'NEWCOMER_ADMIT_LIMIT'
              ? 'newcomer admission limit reached for this daemon scope today'
              : 'identity store unavailable',
            code: atomic.code,
          };
        }
        if (!atomic.ok) {
          if (!atomic.effect) {
            reply.code(503);
            return {
              success: false,
              error: 'fresh identity and live inbox could not be committed atomically',
              code: 'IDENTITY_REGISTRATION_ATOMIC_FAILED',
            };
          }
          beginVerdict = atomic.effect.verdict;
          result = atomic.effect.result;
        } else {
          beginVerdict = atomic.effect.verdict;
          result = atomic.effect.result;
          mintedCredential = atomic.effect.credential;
        }
      }

      if (!result.success) {
        const status = result.code === 'SESSION_IDENTITY_UNVERIFIED'
          || result.code === 'SESSION_IDENTITY_STAMP_INVALID'
          || result.code === 'FILE_CONFLICT'
          ? 409
          : result.code === 'AGENT_REGISTRATION_FAILED'
          || result.code === 'WORKTREE_REQUIRED'
          || result.code === 'MAIN_WORKTREE_SESSION_FORBIDDEN'
          || result.code === 'MAIN_WORKTREE_CROWDED'
          || result.code === 'ROADMAP_RENT_CONFLICT'
          || result.code === 'ROADMAP_SLUG_UNKNOWN'
          || result.code === 'ROADMAP_TITLE_REQUIRED'
          || result.code === 'SIDEQUEST_REASON_TOO_SHORT'
          || result.code === 'ROADMAP_ITEMS_UNAVAILABLE'
          ? 400
          : 500;
        logger.warn('sugar_begin_rejected', {
          code: result.code,
          error: result.error,
          identity,
          lifecycle,
          purpose,
          fileCount: Array.isArray(files) ? files.length : 0,
          hasSidequestReason: typeof sidequestReason === 'string' && sidequestReason.length > 0,
        });
        reply.code(status);
        return result;
      }

      // Surface the identity verdict (as `actorIdentity` — `identity` on this
      // response is already the project:stack:context display string); when
      // this begin MINTED, return the plaintext credential exactly once — the
      // caller must persist it and present it (x-actor-credential header or
      // body `credential`) on every subsequent attributed write. There is no
      // recovery path for a lost credential (a fresh begin mints a fresh
      // newcomer soul).
      result.actorIdentity = beginVerdict.identity;
      result.actorId = beginVerdict.actorId;
      if (mintedCredential) {
        result.credential = mintedCredential;
      }

      logger.info('sugar_begin', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        actorId: beginVerdict.actorId,
        minted: Boolean(mintedCredential),
        identity,
        lifecycle,
        purpose,
      });

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_begin_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sugar/done
  fastify.post('/sugar/done', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const {
        agentId,
        sessionId,
        note,
        status,
        skipOriginCheck,
        skipOriginCheckReason,
        noPr,
        subtask,
        forceIncomplete,
        forceIncompleteReason,
      } = request.body as any;
 
      const VALID_DONE_STATUSES = new Set(['completed', 'abandoned']);
      if (status && !VALID_DONE_STATUSES.has(status)) {
        reply.code(400);
        return {
          success: false,
          error: `Invalid status "${status}". Must be one of: completed, abandoned`,
          code: 'VALIDATION_ERROR',
        };
      }

      // #8877: ending a session mutates an attributed durable record — the
      // daemon-minted credential from /sugar/begin is REQUIRED, forged is
      // 401, another soul's agentId is 403. No anonymous path.
      const doneIdentity = requireSugarIdentity(request, agentId, 'POST /sugar/done');
      if (!doneIdentity.success) {
        reply.code(doneIdentity.httpStatus);
        return doneIdentity.result;
      }

      const result = sugar.done({
        [VERIFIED_SUGAR_ACTOR_BINDING]: {
          actorId: doneIdentity.verdict.actorId,
          harbor: actorSouls!.constants.defaultHarbor,
          inboxTarget: doneIdentity.verdict.actorId,
        },
        agentId: doneIdentity.verdict.actorId,
        sessionId,
        note,
        status,
        skipOriginCheck,
        skipOriginCheckReason,
        noPr,
        subtask,
        forceIncomplete,
        forceIncompleteReason,
      });

      if (!result.success) {
        const httpStatus = result.code === 'NO_ACTIVE_SESSION'
          ? 404
          : result.code === 'SESSION_OWNERSHIP_MISMATCH'
            ? 409
            : result.code === 'BRANCH_NOT_ON_ORIGIN'
              || result.code === 'RESULT_NOTE_MISSING_SENTINEL'
              || result.code === 'SKIP_ORIGIN_CHECK_REASON_REQUIRED'
              || result.code === 'PLAN_UNCHECKED_ITEMS'
              || result.code === 'FORCE_INCOMPLETE_REASON_REQUIRED'
              ? 400
              : 500;
        reply.code(httpStatus);
        return result;
      }

      logger.info('sugar_done', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        status: result.sessionStatus,
      });

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_done_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sugar/relink — anti-Goodhart valve: rent-at-claim links are never sticky.
  fastify.post('/sugar/relink', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId, sessionId, roadmapLink, sidequestReason } = request.body as any;

      // #8877: relink rewrites an attributed session's rent-at-claim links —
      // same always-attributed boundary as /sugar/done.
      const relinkIdentity = requireSugarIdentity(request, agentId, 'POST /sugar/relink');
      if (!relinkIdentity.success) {
        reply.code(relinkIdentity.httpStatus);
        return relinkIdentity.result;
      }

      const result = sugar.relink({
        agentId: relinkIdentity.verdict.actorId,
        sessionId,
        roadmapLink,
        sidequestReason,
      });

      if (!result.success) {
        const status = result.code === 'NO_ACTIVE_SESSION'
          ? 404
          : result.code === 'SESSION_OWNERSHIP_MISMATCH'
            ? 409
            : result.code === 'ROADMAP_RENT_CONFLICT'
              || result.code === 'ROADMAP_RENT_REQUIRED'
              || result.code === 'ROADMAP_SLUG_UNKNOWN'
              || result.code === 'SIDEQUEST_REASON_TOO_SHORT'
              || result.code === 'ROADMAP_ITEMS_UNAVAILABLE'
              ? 400
              : 500;
        reply.code(status);
        return result;
      }

      logger.info('sugar_relink', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        roadmapLink: result.roadmapLink,
        sidequestReason: result.sidequestReason,
      });

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_relink_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sugar/whoami
  fastify.get('/sugar/whoami', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = typeof (request.query as any).agentId === 'string' ? (request.query as any).agentId : undefined;
      const sessionId = typeof (request.query as any).sessionId === 'string' ? (request.query as any).sessionId : undefined;

      const result = sugar.whoami({ agentId, sessionId });

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_whoami_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sugar/welcome
  fastify.get('/sugar/welcome', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const harbor = typeof (request.query as any).harbor === 'string' ? (request.query as any).harbor : undefined;
      if (sugar.getWelcomeBriefing) {
        return sugar.getWelcomeBriefing(harbor);
      }
      return { success: false, error: 'Welcome briefing not supported by this sugar provider' };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_welcome_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
