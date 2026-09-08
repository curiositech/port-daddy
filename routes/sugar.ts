/**
 * Sugar Routes — Compound commands for common workflows
 *
 * POST /sugar/begin   - Register agent + start session atomically
 * POST /sugar/done    - End session + unregister agent
 * POST /sugar/relink  - Update the active session's rent-at-claim fields
 * GET  /sugar/whoami  - Show current agent/session context
 * GET  /sugar/find    - Recover a session by begin idempotency key or by identity
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { ActorSouls } from '../lib/actor-souls.js';
import {
  authorizeSessionOwner,
  extractActorCredential,
  resolveWriteIdentity,
  stampIdentityMetadata,
  type IdentityWriteVerdict,
} from '../lib/identity-write-boundary.js';
import { isReservedIdentityName } from '../lib/reserved-identity-names.js';
import {
  BEGIN_IDEMPOTENCY_KEY_PATTERN,
  beginRequestFingerprint,
  beginScopeKey,
  isValidBeginIdempotencyKey,
  type BeginIdempotency,
} from '../lib/begin-idempotency.js';

/**
 * The souls-store subset the sugar routes need. Unlike the other enforced
 * write boundaries, `/sugar/begin` is a MINT DOOR (like POST /actors/register):
 * an uncredentialed begin mints a fresh ADR-0040 soul and returns its
 * credential once, so `register` is required here in addition to the verify /
 * resolve pair the shared boundary uses.
 */
type SugarActorSouls = Pick<ActorSouls, 'verifyCredential' | 'resolveActor' | 'register'>;

interface SugarRouteDeps {
  sessions?: {
    get(sessionId: string, options?: Record<string, unknown>): Record<string, unknown>;
    list(options?: Record<string, unknown>): Record<string, unknown>;
  } | null;
  /**
   * Begin idempotency store (lib/begin-idempotency.ts). When present, a
   * `/sugar/begin` carrying a known `idempotencyKey` replays the original
   * session instead of minting again, and `GET /sugar/find?key=` recovers a
   * session whose response was lost. Optional so older embeddings and
   * narrow route tests keep working; without it the key is accepted and
   * ignored (the pre-fix behaviour).
   */
  beginIdempotency?: BeginIdempotency | null;
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
  const { sugar, sessions, metrics, logger, actorSouls, beginIdempotency } = deps;

  const asTrimmedString = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  /**
   * Read the begin idempotency key from its two carriers: body
   * `idempotencyKey` (the pd CLI / SDK / MCP) or the `idempotency-key`
   * header (generic HTTP clients). Body wins when both are present.
   *
   * @returns `undefined` when no key was sent, the raw value otherwise
   *          (validated by the caller so a malformed key is a 400, not silence).
   */
  const extractBeginIdempotencyKey = (request: FastifyRequest): unknown => {
    const body = request.body as Record<string, unknown> | null | undefined;
    if (body && body.idempotencyKey !== undefined && body.idempotencyKey !== null) return body.idempotencyKey;
    const header = (request.headers as Record<string, unknown>)['idempotency-key'];
    if (typeof header === 'string' && header.trim()) return header.trim();
    return undefined;
  };

  /**
   * Fetch one session row without notes/claims. `sessions` is optional on
   * this plugin (narrow route tests omit it); without it liveness cannot be
   * checked and the caller decides what to trust.
   */
  const peekSession = (sessionId: string): Record<string, unknown> | null => {
    if (!sessions) return null;
    try {
      const result = sessions.get(sessionId, { metadataOnly: true }) as { success?: boolean; session?: Record<string, unknown> };
      return result && result.success && result.session && typeof result.session === 'object' ? result.session : null;
    } catch {
      return null;
    }
  };

  /**
   * Project a session row into the recovery shape `GET /sugar/find` and a
   * begin replay share: ids and lifecycle, never notes or claims.
   */
  const projectRecoverableSession = (session: Record<string, unknown>) => {
    const metadata = session.metadata && typeof session.metadata === 'object'
      ? session.metadata as Record<string, unknown>
      : null;
    return {
      sessionId: session.id as string,
      agentId: typeof session.agentId === 'string' ? session.agentId : null,
      status: typeof session.status === 'string' ? session.status : null,
      purpose: typeof session.purpose === 'string' ? session.purpose : null,
      identity: typeof metadata?.identityString === 'string' ? metadata.identityString : null,
      worktreeId: typeof session.worktreeId === 'string' ? session.worktreeId : null,
      lifecycle: session.durable === true ? 'durable' : 'ephemeral',
      createdAt: typeof session.createdAt === 'number' ? session.createdAt : null,
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : null,
    };
  };

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

    // Mint a fresh newcomer soul. The alias is NOT bound (identities like
    // "proj:node:dev" are shared display strings across a fleet, and binding
    // one agent's soul to them would lock every other legitimate agent out).
    // Budget guard still resolves the minted soul into the shared newcomer
    // spend pool; registration count is not an authority boundary.
    const outcome = actorSouls.register({});
    if (!outcome.ok) {
      logger.error('identity_write_rejected', { route: 'POST /sugar/begin', code: outcome.code });
      return {
        success: false,
        httpStatus: outcome.httpStatus,
        result: {
          success: false,
          error: 'identity store unavailable',
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
    | { success: true; verdict: Extract<IdentityWriteVerdict, { ok: true }> }
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
    return { success: true, verdict };
  };

  /**
   * Authorize an explicit sugar target against the owner stored on that
   * session, then return its canonical agent id for the service layer.
   *
   * Design intent: a valid credential proves the caller actor but never grants
   * authority over an arbitrary `sessionId`. Caller-supplied `agentId` is not
   * consulted here; the daemon-stamped owner is the only binding.
   *
   * @param sessionId - Explicit request target, when present.
   * @param verdict - Credential-backed identity verdict from this request.
   * @returns Stored owner for an authorized target, no owner for agent-scoped
   *          resolution, or a structured HTTP rejection.
   */
  const authorizeSugarSession = (
    sessionId: unknown,
    assertedAgentId: unknown,
    verdict: Extract<IdentityWriteVerdict, { ok: true }>,
  ):
    | { success: true; sessionId: string; ownerAgentId: string }
    | { success: false; httpStatus: number; result: Record<string, unknown> } => {
    if (verdict.kind !== 'verified') {
      return {
        success: false,
        httpStatus: 401,
        result: {
          success: false,
          code: 'IDENTITY_CREDENTIAL_REQUIRED',
          error: 'explicit session mutation requires a verified actor credential',
        },
      };
    }
    if (!sessions) {
      return {
        success: false,
        httpStatus: 503,
        result: {
          success: false,
          code: 'SESSION_STORE_UNAVAILABLE',
          error: 'session ownership cannot be verified because the session store is unavailable',
        },
      };
    }
    const explicitSessionId = typeof sessionId === 'string' && sessionId.trim()
      ? sessionId.trim()
      : null;
    const asserted = typeof assertedAgentId === 'string' && assertedAgentId.trim()
      ? assertedAgentId.trim()
      : null;
    let candidates: Array<Record<string, unknown>> = [];
    if (explicitSessionId) {
      const lookup = sessions.get(explicitSessionId);
      const stored = lookup.success === true && lookup.session && typeof lookup.session === 'object'
        ? lookup.session as Record<string, unknown>
        : null;
      if (stored) candidates = [stored];
    } else {
      const listed = sessions.list({
        status: 'active',
        ...(asserted ? { agentId: asserted } : {}),
        allWorktrees: true,
        limit: 5_000,
      });
      candidates = listed.success === true && Array.isArray(listed.sessions)
        ? listed.sessions.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
        : [];
    }

    if (candidates.length === 0) {
      return {
        success: false,
        httpStatus: 404,
        result: {
          success: false,
          code: 'NO_ACTIVE_SESSION',
          error: explicitSessionId
            ? `Session ${explicitSessionId} not found`
            : 'No active session belongs to the presented actor.',
        },
      };
    }

    const authorized = candidates.flatMap((stored) => {
      const authorization = authorizeSessionOwner(stored, verdict, actorSouls);
      return authorization.ok ? [{ stored, authorization }] : [];
    });
    if (authorized.length === 0) {
      if (!explicitSessionId) {
        return {
          success: false,
          httpStatus: 404,
          result: {
            success: false,
            code: 'NO_ACTIVE_SESSION',
            error: 'No active session belongs to the presented actor.',
          },
        };
      }
      const firstFailure = authorizeSessionOwner(candidates[0], verdict, actorSouls);
      return {
        success: false,
        httpStatus: firstFailure.ok ? 403 : firstFailure.httpStatus,
        result: {
          success: false,
          code: firstFailure.ok ? 'SESSION_OWNERSHIP_MISMATCH' : firstFailure.code,
          error: firstFailure.ok
            ? 'the presented credential does not own the selected session'
            : firstFailure.error,
        },
      };
    }
    if (authorized.length > 1) {
      return {
        success: false,
        httpStatus: 409,
        result: {
          success: false,
          code: 'AMBIGUOUS_ACTIVE_SESSION',
          error: 'Multiple active sessions match this actor; pass an exact sessionId.',
          candidates: authorized.map(({ stored }) => ({
            sessionId: typeof stored.id === 'string' ? stored.id : '<unknown>',
            worktreeId: typeof stored.worktreeId === 'string' ? stored.worktreeId : null,
            status: typeof stored.status === 'string' ? stored.status : null,
            lifecycle: stored.durable === true ? 'durable' : 'ephemeral',
          })),
        },
      };
    }

    const [{ stored, authorization }] = authorized;
    const resolvedSessionId = typeof stored.id === 'string' && stored.id.trim()
      ? stored.id.trim()
      : null;
    if (!resolvedSessionId) {
      return {
        success: false,
        httpStatus: 403,
        result: {
          success: false,
          code: 'SESSION_OWNER_UNVERIFIABLE',
          error: 'the selected session has no stable identifier; refusing mutation',
        },
      };
    }
    return {
      success: true,
      sessionId: resolvedSessionId,
      ownerAgentId: authorization.ownerAgentId,
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

      // Begin idempotency (lib/begin-idempotency.ts). A retry of a begin whose
      // response was lost carries the same key; answer it with the ORIGINAL
      // session before the mint door below can mint a second soul or the
      // resume path can 403 it for lacking the credential it never received.
      const rawIdempotencyKey = extractBeginIdempotencyKey(request);
      if (rawIdempotencyKey !== undefined && !isValidBeginIdempotencyKey(rawIdempotencyKey)) {
        logger.warn('sugar_begin_rejected', { code: 'IDEMPOTENCY_KEY_INVALID', identity, lifecycle, purpose });
        reply.code(400);
        return {
          success: false,
          error: `idempotencyKey must match ${BEGIN_IDEMPOTENCY_KEY_PATTERN.source} (a UUID v4 or ULID per logical begin)`,
          code: 'IDEMPOTENCY_KEY_INVALID',
        };
      }
      const idempotencyKey = rawIdempotencyKey as string | undefined;
      const requestWorktreeId = worktree && typeof worktree === 'object' && typeof (worktree as { id?: unknown }).id === 'string'
        ? (worktree as { id: string }).id
        : null;
      const requestScope = beginScopeKey({
        identity: asTrimmedString(identity),
        agentId: asTrimmedString(agentId),
        worktreeId: requestWorktreeId,
      });
      const requestFingerprint = idempotencyKey ? beginRequestFingerprint(request.body as Record<string, unknown>) : null;

      if (idempotencyKey && beginIdempotency) {
        const known = beginIdempotency.lookup(idempotencyKey);
        if (known) {
          // A key is bound to the (identity, agentId, worktree) it was minted
          // under. From any other context it is opaque: no ids are disclosed.
          if (known.scope !== requestScope) {
            logger.warn('sugar_begin_rejected', { code: 'IDEMPOTENCY_KEY_SCOPE_MISMATCH', identity, lifecycle, purpose });
            reply.code(409);
            return {
              success: false,
              error: 'idempotencyKey was recorded for a different identity, agent, or worktree; mint a fresh key for this begin',
              code: 'IDEMPOTENCY_KEY_SCOPE_MISMATCH',
            };
          }
          // A presented credential must be the recorded actor's. A forged one
          // is 401 exactly as on a fresh begin; another soul's is 403.
          const presentedCredential = extractActorCredential(request.headers as Record<string, unknown>, request.body);
          if (presentedCredential) {
            if (!actorSouls) {
              reply.code(503);
              return {
                success: false,
                error: 'the identity store is unavailable; refusing to admit an unverifiable identity',
                code: 'IDENTITY_VERIFIER_UNAVAILABLE',
              };
            }
            const verdict = resolveWriteIdentity({
              souls: actorSouls,
              credential: presentedCredential,
              assertedAgentId: null,
              route: 'POST /sugar/begin',
              logger,
            });
            if (!verdict.ok) {
              reply.code(verdict.httpStatus);
              return { success: false, error: verdict.error, code: verdict.code };
            }
            if (verdict.kind === 'verified' && known.actorId && verdict.actorId !== known.actorId) {
              logger.error('identity_write_rejected', {
                route: 'POST /sugar/begin',
                code: 'IDEMPOTENCY_KEY_ACTOR_MISMATCH',
                actorId: verdict.actorId,
              });
              reply.code(403);
              return {
                success: false,
                error: 'the presented credential does not belong to the actor that made this begin',
                code: 'IDEMPOTENCY_KEY_ACTOR_MISMATCH',
              };
            }
          }
          const recordedSession = peekSession(known.sessionId);
          const sessionStillActive = sessions
            ? recordedSession !== null && recordedSession.status === 'active'
            : true;
          if (sessionStillActive) {
            // Same key, same context, DIFFERENT begin: refuse rather than
            // silently hand back the old session. Same context, so naming the
            // recorded session is not a disclosure.
            if (known.fingerprint !== requestFingerprint) {
              logger.warn('sugar_begin_rejected', { code: 'IDEMPOTENCY_KEY_REUSED', identity, lifecycle, purpose, sessionId: known.sessionId });
              reply.code(409);
              return {
                success: false,
                error: `idempotencyKey was already used for a different begin (session "${known.sessionId}"); mint a fresh key, or resume that session with the same request`,
                code: 'IDEMPOTENCY_KEY_REUSED',
                sessionId: known.sessionId,
                agentId: known.agentId,
              };
            }
            const replayedCredential = beginIdempotency.openCredential(known, idempotencyKey);
            logger.info('sugar_begin_replayed', {
              agentId: known.agentId,
              sessionId: known.sessionId,
              actorId: known.actorId,
              credentialReplayed: Boolean(replayedCredential),
              identity,
              lifecycle,
              purpose,
            });
            return {
              ...known.response,
              success: true,
              replayed: true,
              ...(replayedCredential ? { credential: replayedCredential } : {}),
            };
          }
          // The recorded session is gone or closed: this is a genuinely new
          // begin under an old key. Fall through; success re-records the key.
        }
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

      const callerMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...metadata as Record<string, unknown> }
        : null;
      // This proof is written only by the daemon's in-process spawner seam.
      // A public caller cannot pre-seed the marker and acquire managed
      // completion authority through request metadata.
      if (callerMetadata) delete callerMetadata.managedSpawn;

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
          callerMetadata,
          beginIdentity.verdict,
        ),
        worktree,
        requireLinkedWorktree,
        allowMainWorktree,
        lifecycle,
        roadmapLink,
        sidequestReason,
        roadmapNewTitle,
      });

      if (!result.success) {
        const status = result.code === 'SESSION_OWNERSHIP_MISMATCH'
          || result.code === 'SESSION_OWNER_UNVERIFIABLE'
          ? 403
          : result.code === 'AMBIGUOUS_ACTIVE_SESSION'
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
      result.actorIdentity = beginIdentity.verdict.identity;
      result.actorId = beginIdentity.verdict.actorId;
      if (beginIdentity.mintedCredential) {
        result.credential = beginIdentity.mintedCredential;
      }

      // Record (key → session) so a re-send of this exact begin after a lost
      // response replays it. The credential is sealed under the key: the DB
      // never holds it in the clear, and only the requester can open it.
      // A failed record must not fail the begin — the session is real — but
      // it is logged loudly because it re-opens the double-create window.
      if (idempotencyKey && beginIdempotency && requestFingerprint) {
        try {
          // Stamped BEFORE recording so the replayed copy carries it too.
          result.idempotencyKeyRecorded = true;
          beginIdempotency.record({
            key: idempotencyKey,
            scope: requestScope,
            fingerprint: requestFingerprint,
            sessionId: result.sessionId as string,
            agentId: result.agentId as string,
            actorId: beginIdentity.verdict.actorId,
            response: result,
            credential: beginIdentity.mintedCredential,
          });
        } catch (error) {
          delete result.idempotencyKeyRecorded;
          logger.warn('sugar_begin_idempotency_record_failed', {
            sessionId: result.sessionId,
            agentId: result.agentId,
            error: (error as Error).message,
          });
        }
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

      const doneSession = authorizeSugarSession(sessionId, agentId, doneIdentity.verdict);
      if (!doneSession.success) {
        reply.code(doneSession.httpStatus);
        return doneSession.result;
      }

      if (skipOriginCheck === true || forceIncomplete === true) {
        reply.code(403);
        return {
          success: false,
          code: 'OPERATOR_CAPABILITY_REQUIRED',
          error: 'completion overrides require a daemon-verified, action-scoped operator capability; actor credentials and reason strings are not operator authority',
          hint: 'Complete the delivery and plan gates normally. Managed ephemeral spawns use the daemon-owned exact-session completion path.',
        };
      }

      const result = sugar.done({
        agentId: doneSession.ownerAgentId,
        sessionId: doneSession.sessionId,
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
            || result.code === 'SESSION_OWNER_UNVERIFIABLE'
            || result.code === 'OPERATOR_CAPABILITY_REQUIRED'
            ? 403
            : result.code === 'AMBIGUOUS_ACTIVE_SESSION'
              ? 409
              : result.code === 'NO_ACTIVE_SESSION_SCOPE'
                ? 400
            : result.code === 'BRANCH_NOT_ON_ORIGIN'
              || result.code === 'RESULT_NOTE_MISSING_SENTINEL'
              || result.code === 'PLAN_UNCHECKED_ITEMS'
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

      const relinkSession = authorizeSugarSession(sessionId, agentId, relinkIdentity.verdict);
      if (!relinkSession.success) {
        reply.code(relinkSession.httpStatus);
        return relinkSession.result;
      }

      const result = sugar.relink({
        agentId: relinkSession.ownerAgentId,
        sessionId: relinkSession.sessionId,
        roadmapLink,
        sidequestReason,
      });

      if (!result.success) {
        const status = result.code === 'NO_ACTIVE_SESSION'
          ? 404
          : result.code === 'SESSION_OWNERSHIP_MISMATCH'
            || result.code === 'SESSION_OWNER_UNVERIFIABLE'
            ? 403
            : result.code === 'AMBIGUOUS_ACTIVE_SESSION'
              ? 409
              : result.code === 'NO_ACTIVE_SESSION_SCOPE'
                ? 400
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

  // GET /sugar/find — successor discovery for an agent that lost its local
  // state. Two doors:
  //   ?key=<idempotencyKey>   the begin attempt's key. Holding it proves the
  //                           caller made that begin, so the session AND its
  //                           sealed credential come back; the caller can drive
  //                           the session again as if the response had arrived.
  //   ?identity=<p:s:c>       the most recent live session(s) for an identity
  //                           in a worktree (or across all with allWorktrees=1;
  //                           includeClosed=1 adds finished/abandoned rows).
  //                           Ids only — no credential; the hints say how to
  //                           continue (`pd session takeover <id>`) so this
  //                           composes with, and never bypasses, takeover.
  fastify.get('/sugar/find', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const key = asTrimmedString(query.key);
      const identity = asTrimmedString(query.identity);

      if (key) {
        if (!isValidBeginIdempotencyKey(key)) {
          reply.code(400);
          return { success: false, error: `key must match ${BEGIN_IDEMPOTENCY_KEY_PATTERN.source}`, code: 'IDEMPOTENCY_KEY_INVALID' };
        }
        if (!beginIdempotency) {
          reply.code(503);
          return { success: false, error: 'begin idempotency store unavailable on this daemon', code: 'IDEMPOTENCY_UNAVAILABLE' };
        }
        const known = beginIdempotency.lookup(key);
        if (!known) {
          reply.code(404);
          return {
            success: false,
            error: 'no begin recorded under this key (unknown, or expired after the retention window)',
            code: 'IDEMPOTENCY_KEY_UNKNOWN',
            hint: identity ? undefined : 'Search by identity instead: pd session find --identity <project:stack:context>',
          };
        }
        const session = peekSession(known.sessionId);
        if (sessions && !session) {
          reply.code(410);
          return {
            success: false,
            error: `the session recorded under this key ("${known.sessionId}") no longer exists`,
            code: 'IDEMPOTENCY_SESSION_GONE',
            sessionId: known.sessionId,
            agentId: known.agentId,
          };
        }
        const projected = session
          ? projectRecoverableSession(session)
          : { sessionId: known.sessionId, agentId: known.agentId, status: null, purpose: null, identity: null, worktreeId: null, lifecycle: null, createdAt: known.createdAt, updatedAt: null };
        const credential = beginIdempotency.openCredential(known, key);
        const driveable = projected.status === 'active';
        logger.info('sugar_find', { by: 'key', sessionId: known.sessionId, agentId: known.agentId, credentialReplayed: Boolean(credential) });
        return {
          success: true,
          foundBy: 'key',
          ...projected,
          actorId: known.actorId,
          driveable,
          ...(credential ? { credential } : {}),
          hint: driveable
            ? (credential
              ? 'Session recovered with its credential; continue working (pd note / pd done).'
              : 'Session is active but no credential was sealed under this key; present the credential you hold.')
            : `Session "${known.sessionId}" is ${projected.status ?? 'closed'}. Continue it explicitly with: pd session takeover ${known.sessionId}`,
        };
      }

      if (!identity) {
        reply.code(400);
        return {
          success: false,
          error: 'pass key=<begin idempotency key> or identity=<project:stack:context>',
          code: 'VALIDATION_ERROR',
        };
      }
      if (!sessions) {
        reply.code(503);
        return { success: false, error: 'session lookup unavailable on this daemon', code: 'SESSIONS_UNAVAILABLE' };
      }
      const truthy = (value: unknown): boolean => value === true || value === '1' || value === 'true';
      const worktreeId = asTrimmedString(query.worktreeId);
      // Without a caller worktree, search the fleet: the daemon's own cwd is
      // never the right default for a CLI running in another worktree.
      const allWorktrees = truthy(query.allWorktrees) || !worktreeId;
      const includeClosed = truthy(query.includeClosed);
      const listed = sessions.list({
        ...(includeClosed ? {} : { status: 'active' }),
        ...(worktreeId ? { worktreeId } : {}),
        allWorktrees,
        limit: 500,
      }) as { sessions?: Array<Record<string, unknown>> };
      const rows = Array.isArray(listed?.sessions) ? listed.sessions : [];
      const matches = rows
        .map(projectRecoverableSession)
        .filter((row) => row.identity === identity)
        .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0) || String(left.sessionId).localeCompare(String(right.sessionId)));
      const newest = matches[0] ?? null;
      logger.info('sugar_find', { by: 'identity', identity, worktreeId, allWorktrees, includeClosed, matches: matches.length });
      return {
        success: true,
        foundBy: 'identity',
        identity,
        worktreeId,
        allWorktrees,
        includeClosed,
        count: matches.length,
        sessionId: newest?.sessionId ?? null,
        agentId: newest?.agentId ?? null,
        sessions: matches,
        hint: !newest
          ? (includeClosed
            ? `No sessions recorded for "${identity}"${worktreeId ? ' in this worktree' : ''}. Start one with: pd begin`
            : `No active session for "${identity}"${worktreeId ? ' in this worktree' : ''}. Re-run with includeClosed=1 (pd session find --all) to see finished ones, or pd begin.`)
          : newest.status === 'active'
            ? `Session "${newest.sessionId}" is active. With its begin key: pd session find --key <key> restores the credential. Without it, its owner must close it (pd done / pd session abandon) before: pd session takeover ${newest.sessionId}`
            : `Session "${newest.sessionId}" is ${newest.status}. Continue it explicitly with: pd session takeover ${newest.sessionId}`,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('sugar_find_error', { error: (error as Error).message });
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
