/**
 * Sugar Routes — Compound commands for common workflows
 *
 * POST /sugar/begin   - Register agent + start session atomically
 * POST /sugar/done    - End session + unregister agent
 * POST /sugar/relink  - Update the active session's rent-at-claim fields
 * GET  /sugar/whoami  - Show current agent/session context
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { asActorId, type ActorSouls } from '../lib/actor-souls.js';
import { createParleyAutoTrigger } from '../lib/parley-auto-trigger.js';
import {
  createSugarParley,
  resolveSugarParleySessionActor,
  SUGAR_PARLEY_NOTE_MAX_CHARS,
  type SugarParley,
} from '../lib/sugar-parley.js';
import type { Parley } from '../lib/parley.js';
import type { WhoisHit } from '../lib/whois.js';
import {
  extractActorCredential,
  resolveWriteIdentity,
  stampIdentityMetadata,
  type IdentityWriteVerdict,
} from '../lib/identity-write-boundary.js';
import { isReservedIdentityName } from '../lib/reserved-identity-names.js';

/**
 * The souls-store subset the sugar routes need. Unlike the other enforced
 * write boundaries, `/sugar/begin` is a MINT DOOR (like POST /actors/register):
 * an uncredentialed begin mints a fresh ADR-0040 soul and returns its
 * credential once, so `register` is required here in addition to the verify /
 * resolve pair the shared boundary uses.
 */
type SugarActorSouls = Pick<ActorSouls, 'verifyCredential' | 'resolveActor' | 'register' | 'constants'>;

interface SugarParleySessions {
  get(sessionId: string): Record<string, unknown>;
  list(options?: Record<string, unknown>): Record<string, unknown>;
  listAllActiveClaims(options?: Record<string, unknown>): Record<string, unknown>;
  addNote(sessionId: string, content: string, options?: { type?: string }): Record<string, unknown>;
}

interface SugarParleyInbox {
  send(agentId: string, content: unknown, options?: {
    from?: string;
    fromActorId?: string | null;
    fromSoulClass?: string | null;
    type?: string;
    contentType?: 'text' | 'json' | 'binary';
  }): { success: boolean; messageId?: number; error?: string };
}

interface SugarParleyWhois {
  search(query: string, options?: { kind?: 'agent'; limit?: number }): Promise<WhoisHit[]>;
}

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
  /**
   * Normal-agent Parley dependencies. They remain optional at this plugin
   * boundary so focused Sugar identity tests can mount only the mint door;
   * production wiring supplies all of them through registerAllRoutes.
   */
  sessions?: SugarParleySessions;
  parley?: Pick<Parley, 'admitAutomatic' | 'get' | 'respond' | 'settleAutomaticConsensus'>;
  whois?: SugarParleyWhois;
  agentInbox?: SugarParleyInbox;
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
  const {
    sugar,
    metrics,
    logger,
    actorSouls,
    sessions,
    parley,
    whois,
    agentInbox,
  } = deps;

  /**
   * The Sugar coordinator deliberately derives live party delivery from the
   * session authority. A display name, stale session, or inbox address never
   * substitutes for the daemon-minted actor identity in an automatic Parley.
   */
  const sugarParley: SugarParley | null = (() => {
    if (!sessions || !parley || !whois || !actorSouls) return null;
    const autoTrigger = createParleyAutoTrigger({
      parley,
      resolveLiveParty: (candidateActorId) => {
        const active = sessions.list({ status: 'active', allWorktrees: true, limit: 1_000 }) as {
          success?: unknown;
          sessions?: Array<{ id?: unknown; agentId?: unknown; status?: unknown }>;
        };
        if (active.success !== true || !Array.isArray(active.sessions)) return null;
        const matches = active.sessions
          .filter((session) => session.status === 'active')
          .filter((session) => typeof session.id === 'string' && typeof session.agentId === 'string')
          .map((session) => ({
            sessionId: session.id as string,
            agentId: session.agentId as string,
            actorId: resolveSugarParleySessionActor(session, actorSouls),
          }))
          .filter((session): session is { sessionId: string; agentId: string; actorId: string } => (
            session.actorId === candidateActorId
          ))
          .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
        const selected = matches[0];
        if (!selected) return null;
        return {
          actorId: asActorId(selected.actorId),
          inboxTarget: selected.agentId,
          sessionId: selected.sessionId,
          lineageRootSessionId: selected.sessionId,
        };
      },
    });
    return createSugarParley({ sessions, actorSouls, whois, parleyAutoTrigger: autoTrigger, parley });
  })();

  function canonicalHarbor(): string | null {
    const harbor = actorSouls?.constants?.defaultHarbor;
    return typeof harbor === 'string' && harbor.trim() ? harbor.trim() : null;
  }

  function stringInput(value: unknown, maxChars: number): string | null {
    return typeof value === 'string' && value.trim() && value.trim().length <= maxChars
      ? value.trim()
      : null;
  }

  function coordinatorUnavailable(reply: FastifyReply) {
    reply.code(503);
    return {
      success: false,
      error: 'Sugar Parley coordination is unavailable until the live session, semantic, Parley, and identity authorities are present.',
      code: 'SUGAR_PARLEY_UNAVAILABLE',
    };
  }

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
   * - No credential, names unowned (or none) → MINT a fresh newcomer soul
   *   (drawing on the shared per-project newcomer pool, so minting buys no
   *   budget) and return its credential ONCE on the response. The caller
   *   must present it on every later attributed write (done, notes, claims,
   *   locks, ...). Self-assertion never becomes attribution: the durable
   *   record is stamped with the MINTED actorId.
   * - Souls store unavailable → 503. Never admit an unverifiable identity.
   *
   * @param request - Incoming begin request (credential carriers: header
   *        `x-actor-credential` or body `credential`).
   * @param asserted - The self-asserted names on the request: `agentId` and
   *        `identity` (project:stack:context), either may be absent.
   * @returns On success, the verified/minted verdict plus the plaintext
   *          credential when this call minted (to return once); on failure,
   *          the HTTP status and error body to return.
   */
  const resolveBeginIdentity = (
    request: FastifyRequest,
    asserted: { agentId?: unknown; identity?: unknown },
  ):
    | {
        success: true;
        verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;
        mintedCredential: string | null;
      }
    | { success: false; httpStatus: number; result: Record<string, unknown> } => {
    const credential = extractActorCredential(request.headers as Record<string, unknown>, request.body);
    const agentId = typeof asserted.agentId === 'string' && asserted.agentId.trim() ? asserted.agentId.trim() : null;
    const identity = typeof asserted.identity === 'string' && asserted.identity.trim() ? asserted.identity.trim() : null;

    const reservedNameRejection = (name: string) => ({
      success: false as const,
      httpStatus: 403,
      result: {
        success: false,
        error: `"${name}" is a reserved authority name and cannot be self-claimed as a display agentId; choose a namespaced name (e.g. "proj:node:dev"), or present the credential of the soul that owns "${name}"`,
        code: 'IDENTITY_RESERVED_NAME',
      },
    });

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
      const verified = verdict as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;

      // Reserved authority/system names (`system`, `coxswain`, …) may be
      // claimed ONLY by the credential that already owns them (a bound alias
      // to the SAME soul). A real credential that does not own the reserved
      // name cannot bind it — otherwise a throwaway newcomer soul could stamp
      // a session under `system` and launder an inbox `from: "system"`.
      for (const name of [agentId, identity]) {
        if (!name || !isReservedIdentityName(name)) continue;
        if (actorSouls.resolveActor(name).actorId !== verified.actorId) {
          logger.error('identity_write_rejected', {
            route: 'POST /sugar/begin',
            code: 'IDENTITY_RESERVED_NAME',
            assertedName: name,
            actorId: verified.actorId,
          });
          return reservedNameRejection(name);
        }
      }
      return {
        success: true,
        verdict: verified,
        mintedCredential: null,
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

    // A self-minted (uncredentialed) caller may never bind a reserved
    // authority/system name. An owned reserved name was already caught by the
    // 401 loop above (present the owner's credential); anything still reserved
    // here is unowned, and minting a fresh soul under it would manufacture the
    // very session binding that authorises an inbox `from: "system"`.
    for (const name of [agentId, identity]) {
      if (!name || !isReservedIdentityName(name)) continue;
      logger.error('identity_write_rejected', {
        route: 'POST /sugar/begin',
        code: 'IDENTITY_RESERVED_NAME',
        assertedName: name,
      });
      return reservedNameRejection(name);
    }

    // Mint a fresh newcomer soul. The identity's project scopes the shared
    // newcomer admission pool; the alias is NOT bound (identities like
    // "proj:node:dev" are shared display strings across a fleet, and binding
    // one agent's soul to them would lock every other legitimate agent out).
    const project = identity ? identity.split(':')[0] : undefined;
    const outcome = actorSouls.register({ project });
    if (!outcome.ok) {
      logger.error('identity_write_rejected', { route: 'POST /sugar/begin', code: outcome.code });
      return {
        success: false,
        httpStatus: outcome.httpStatus,
        result: {
          success: false,
          error: outcome.code === 'NEWCOMER_ADMIT_LIMIT'
            ? 'newcomer admission limit reached for this project today'
            : 'identity store unavailable',
          code: outcome.code,
        },
      };
    }
    const actorId = outcome.actorId as string;
    const soulClass = outcome.soulClass;
    return {
      success: true,
      verdict: {
        ok: true,
        kind: 'verified',
        actorId,
        agentId: agentId ?? identity ?? actorId,
        soulClass,
        identity: { verified: true, actorId, soulClass },
      },
      mintedCredential: outcome.status === 'minted' ? outcome.credential : null,
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
    if (verdict.kind !== 'verified') {
      return {
        success: false,
        httpStatus: 401,
        result: {
          success: false,
          error: 'a daemon-minted actor credential is required for this Sugar coordination action',
          code: 'IDENTITY_CREDENTIAL_REQUIRED',
        },
      };
    }
    return { success: true, verdict };
  };

  /**
   * Bounded Sugar Parley actions authenticate the minted credential first and
   * bind it to the supplied session through the verified session stamp in the
   * coordinator. A generated Sugar display handle is an observation for the
   * client, not an authority assertion: it can legitimately be absent from,
   * or independently present in, the soul alias table.
   */
  const requireSugarParleyIdentity = (request: FastifyRequest, route: string) =>
    requireSugarIdentity(request, null, route);

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

      const result = sugar.begin({
        purpose,
        identity,
        agentId,
        name,
        type,
        files,
        force,
        // The session row is a durable attributed record: stamp the daemon's
        // identity verdict into its metadata (the caller-supplied `identity`
        // metadata key can never pre-fill the daemon's verdict slot).
        metadata: stampIdentityMetadata(
          metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null,
          beginIdentity.verdict,
        ),
        worktree,
        requireLinkedWorktree,
        allowMainWorktree,
        bypassCrowdedGate,
        lifecycle,
        roadmapLink,
        sidequestReason,
        roadmapNewTitle,
      });

      if (!result.success) {
        const status = result.code === 'AGENT_REGISTRATION_FAILED'
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
      result.actorIdentity = beginIdentity.verdict.identity;
      result.actorId = beginIdentity.verdict.actorId;
      if (beginIdentity.mintedCredential) {
        result.credential = beginIdentity.mintedCredential;
      }

      logger.info('sugar_begin', {
        agentId: result.agentId,
        sessionId: result.sessionId,
        actorId: beginIdentity.verdict.actorId,
        minted: Boolean(beginIdentity.mintedCredential),
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

      const result = sugar.relink({ agentId, sessionId, roadmapLink, sidequestReason });

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

  // GET /sugar/parley-card — a read-only, server-derived coordination prompt.
  // It is intentionally a normal Sugar affordance, never a UI wrapper around
  // the raw /parley debug protocol. The daemon recomputes semantic and
  // structural evidence for each read, so card IDs are observations, not
  // client-created authority.
  fastify.get('/sugar/parley-card', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!sugarParley) return coordinatorUnavailable(reply);
      const query = request.query as Record<string, unknown>;
      const sessionId = stringInput(query.sessionId, 256);
      const identity = requireSugarParleyIdentity(request, 'GET /sugar/parley-card');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }
      if (!sessionId) {
        reply.code(400);
        return {
          success: false,
          error: 'sessionId is required to derive a coordination card from the recorded session purpose.',
          code: 'VALIDATION_ERROR',
        };
      }
      const preview = await sugarParley.preview({
        sessionId,
        actorId: identity.verdict.actorId,
      });
      return { success: true, ...preview };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_parley_card_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // POST /sugar/parley/work-separately — preserve the agent's normal work
  // path while leaving a durable, evidence-bound note for later briefings.
  fastify.post('/sugar/parley/work-separately', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!sugarParley || !sessions) return coordinatorUnavailable(reply);
      const body = request.body as Record<string, unknown>;
      const identity = requireSugarParleyIdentity(request, 'POST /sugar/parley/work-separately');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }
      const sessionId = stringInput(body.sessionId, 256);
      const signalId = stringInput(body.signalId, 512);
      if (!sessionId || !signalId) {
        reply.code(400);
        return { success: false, error: 'sessionId and card signalId are required.', code: 'VALIDATION_ERROR' };
      }
      const preview = await sugarParley.preview({ sessionId, actorId: identity.verdict.actorId });
      if (preview.state !== 'ready' || preview.card.signalId !== signalId) {
        reply.code(409);
        return {
          success: false,
          error: 'The coordination card changed; re-read its evidence before choosing work separately.',
          code: 'SUGAR_PARLEY_CARD_STALE',
        };
      }
      const note = sessions.addNote(
        sessionId,
        `[Sugar Parley v1] Work separately selected for ${preview.card.surface}. Evidence: ${preview.card.structuralEvidence.sourceClaimRef}; ${preview.card.semanticEvidence.evidenceRef}.`,
        { type: 'parley_work_separately' },
      );
      if (note.success !== true) {
        reply.code(409);
        return { success: false, error: String(note.error || 'Could not record the work-separately decision.'), code: 'SUGAR_PARLEY_NOTE_FAILED' };
      }
      return {
        success: true,
        kind: 'sugar_parley_work_separately_receipt',
        schemaVersion: 1,
        cardId: preview.card.cardId,
        signalId: preview.card.signalId,
        surface: preview.card.surface,
        noteId: note.noteId ?? null,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_parley_work_separately_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // POST /sugar/parley/note — a human action that sends an attributed,
  // evidence-scoped note to the matched live peer. This is not a substitute
  // for a Parley; it gives a quiet coordination option before convening one.
  fastify.post('/sugar/parley/note', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!sugarParley || !sessions || !agentInbox) return coordinatorUnavailable(reply);
      const body = request.body as Record<string, unknown>;
      const identity = requireSugarParleyIdentity(request, 'POST /sugar/parley/note');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }
      const sessionId = stringInput(body.sessionId, 256);
      const signalId = stringInput(body.signalId, 512);
      const message = stringInput(body.message, SUGAR_PARLEY_NOTE_MAX_CHARS);
      if (!sessionId || !signalId || !message) {
        reply.code(400);
        return { success: false, error: 'sessionId, card signalId, and a bounded note are required.', code: 'VALIDATION_ERROR' };
      }
      const preview = await sugarParley.preview({ sessionId, actorId: identity.verdict.actorId });
      if (preview.state !== 'ready' || preview.card.signalId !== signalId) {
        reply.code(409);
        return {
          success: false,
          error: 'The coordination card changed; re-read its evidence before sending a note.',
          code: 'SUGAR_PARLEY_CARD_STALE',
        };
      }
      const peer = preview.card.participants.find((participant) => participant.actorId !== identity.verdict.actorId);
      if (!peer) {
        reply.code(409);
        return { success: false, error: 'No distinct live peer remains for this coordination card.', code: 'SUGAR_PARLEY_PEER_GONE' };
      }
      const delivered = agentInbox.send(peer.agentId, {
        kind: 'sugar_parley_note',
        schemaVersion: 1,
        cardId: preview.card.cardId,
        surface: preview.card.surface,
        evidenceRefs: [
          preview.card.structuralEvidence.sourceClaimRef,
          preview.card.structuralEvidence.peerClaimRef,
          preview.card.semanticEvidence.evidenceRef,
        ].sort(),
        message,
      }, {
        from: identity.verdict.agentId,
        fromActorId: identity.verdict.actorId,
        fromSoulClass: identity.verdict.soulClass,
        type: 'sugar_parley_note',
        contentType: 'json',
      });
      if (!delivered.success) {
        reply.code(409);
        return { success: false, error: delivered.error || 'The matched peer inbox rejected the note.', code: 'SUGAR_PARLEY_NOTE_DELIVERY_FAILED' };
      }
      const note = sessions.addNote(
        sessionId,
        `[Sugar Parley v1] Sent an attributed note for ${preview.card.surface}: ${message}`,
        { type: 'parley_note' },
      );
      if (note.success !== true) {
        reply.code(409);
        return { success: false, error: String(note.error || 'The note was delivered but could not be recorded.'), code: 'SUGAR_PARLEY_NOTE_AUDIT_FAILED' };
      }
      return {
        success: true,
        kind: 'sugar_parley_note_receipt',
        schemaVersion: 1,
        cardId: preview.card.cardId,
        peerAgentId: peer.agentId,
        messageId: delivered.messageId ?? null,
        noteId: note.noteId ?? null,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_parley_note_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // POST /sugar/parley/resolve-together — re-derives the exact evidence,
  // admits a bounded automatic Parley, and returns the visually distinct hook
  // context the spawned Parley outbox delivers to both verified participants.
  fastify.post('/sugar/parley/resolve-together', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!sugarParley) return coordinatorUnavailable(reply);
      const body = request.body as Record<string, unknown>;
      const identity = requireSugarParleyIdentity(request, 'POST /sugar/parley/resolve-together');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }
      const sessionId = stringInput(body.sessionId, 256);
      const signalId = stringInput(body.signalId, 512);
      const harbor = canonicalHarbor();
      if (!sessionId || !signalId || !harbor) {
        reply.code(400);
        return { success: false, error: 'sessionId, card signalId, and a canonical harbor are required.', code: 'VALIDATION_ERROR' };
      }
      const receipt = await sugarParley.resolveTogether({
        sessionId,
        actorId: identity.verdict.actorId,
        signalId,
        harbor,
      });
      if (receipt.state === 'rejected') {
        reply.code(409);
        return { success: false, ...receipt, code: 'SUGAR_PARLEY_CARD_STALE' };
      }
      if (receipt.state === 'failed') {
        reply.code(502);
        return { success: false, ...receipt, code: 'SUGAR_PARLEY_CONVENE_FAILED' };
      }
      logger.info('sugar_parley_resolve_together', {
        actorId: identity.verdict.actorId,
        sessionId,
        signalId: receipt.signalId,
        parleyId: receipt.parleyId,
        state: receipt.state,
      });
      return { success: true, ...receipt };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_parley_resolve_together_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // POST /sugar/parley/settle — acknowledges a typed, evidence-bound
  // settlement. The service permits mutation only after every verified live
  // party acknowledges the exact same object; then it releases those exact
  // claims, appends checked plan receipts, and lets the automatic lineage enter
  // its durable cooldown rather than nagging a settled surface again.
  fastify.post('/sugar/parley/settle', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!sugarParley) return coordinatorUnavailable(reply);
      const body = request.body as Record<string, unknown>;
      const identity = requireSugarParleyIdentity(request, 'POST /sugar/parley/settle');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }
      const sessionId = stringInput(body.sessionId, 256);
      const parleyId = stringInput(body.parleyId, 256);
      const summary = stringInput(body.summary, SUGAR_PARLEY_NOTE_MAX_CHARS);
      const nextStep = stringInput(body.nextStep, SUGAR_PARLEY_NOTE_MAX_CHARS);
      const harbor = canonicalHarbor();
      if (!sessionId || !parleyId || !summary || !nextStep || !harbor) {
        reply.code(400);
        return { success: false, error: 'sessionId, parleyId, summary, nextStep, and a canonical harbor are required.', code: 'VALIDATION_ERROR' };
      }
      const receipt = sugarParley.settle({
        sessionId,
        actorId: identity.verdict.actorId,
        parleyId,
        harbor,
        summary,
        nextStep,
      });
      if (receipt.state === 'rejected') {
        reply.code(403);
        return { success: false, ...receipt, code: 'SUGAR_PARLEY_SETTLEMENT_REJECTED' };
      }
      if (receipt.state === 'failed') {
        reply.code(502);
        return { success: false, ...receipt, code: 'SUGAR_PARLEY_SETTLEMENT_EFFECTS_FAILED' };
      }
      reply.code(receipt.state === 'awaiting-peer' ? 202 : 200);
      return { success: true, ...receipt };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_parley_settle_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // POST /sugar/parley/message — normal-language exchange within a previously
  // convened Sugar Parley. The client never selects a protocol performative;
  // the server writes its fixed human-message representation after proving
  // canonical membership and active session lineage.
  fastify.post('/sugar/parley/message', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!parley) return coordinatorUnavailable(reply);
      const body = request.body as Record<string, unknown>;
      const identity = requireSugarParleyIdentity(request, 'POST /sugar/parley/message');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }
      const parleyId = stringInput(body.parleyId, 256);
      const sessionId = stringInput(body.sessionId, 256);
      const message = stringInput(body.message, SUGAR_PARLEY_NOTE_MAX_CHARS);
      const harbor = canonicalHarbor();
      if (!parleyId || !sessionId || !message || !harbor) {
        reply.code(400);
        return { success: false, error: 'parleyId, sessionId, message, and a canonical harbor are required.', code: 'VALIDATION_ERROR' };
      }
      const summary = parley.get(parleyId, harbor);
      const participant = summary?.parley.automatic?.participants.find((item) => item.actorId === identity.verdict.actorId);
      if (!summary || summary.parley.automatic?.checkpoint !== 'session_begin'
        || summary.parley.automatic.kind !== 'task_convergence'
        || !participant || participant.sessionId !== sessionId) {
        reply.code(403);
        return { success: false, error: 'This credential and active session are not a party to a bounded Sugar Parley.', code: 'SUGAR_PARLEY_MEMBERSHIP_REQUIRED' };
      }
      const turn = parley.respond({
        parleyId,
        harbor,
        party: identity.verdict.actorId,
        performative: 'inform',
        content: message,
        evidenceRefs: summary.parley.automatic.evidenceRefs,
      });
      return {
        success: true,
        kind: 'sugar_parley_message_receipt',
        schemaVersion: 1,
        parleyId,
        turnSequence: turn.turnSequence,
        replayed: turn.replayed,
        notified: turn.notified,
        notifyFailures: turn.notifyFailures,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_parley_message_error', { error: (error as Error).message });
      reply.code(409);
      return { success: false, error: (error as Error).message, code: 'SUGAR_PARLEY_MESSAGE_REJECTED' };
    }
  });
};
