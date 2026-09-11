/**
 * lib/identity-write-boundary.ts — REQUIRE daemon-minted identity at every
 * attributed write boundary (Harbor Authority / ADR-0122 slice 1; closes #8877).
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS (motivation)
 * ════════════════════════════════════════════════════════════════════════════
 * ADR-0040 gave the daemon a mint (`lib/actor-souls.ts`): the only component
 * that issues principals. Actor roots and scoped invocation bodies now use the
 * versioned `pdab1.<actor_id>.<body_id>.<secret>` lookup-token. But the mint was
 * only *wired into the economic choke*
 * (budget-guard) — the write routes (sessions, notes, file claims, locks,
 * salvage, commitments) kept accepting a bare self-asserted `agentId` string
 * from the body or an `x-agent-id` header. Issue #8877 records the
 * consequence: an agent could write durable, attributed records under any
 * name it liked — impersonation and reputation-whitewashing.
 *
 * This module is the shared verdict function every attributed write route
 * calls. The verdict is deliberately TWO-state plus rejection — there is no
 * middle "admitted but flagged" state, per operator directive (2026-08-22):
 * legacy self-asserted acceptance is deleted, not deprecated.
 *
 *   1. VERIFIED  — the caller presented a daemon-minted credential and it
 *                  checked out. The write is attributed to the minted
 *                  actor_id (a self-asserted display name must not resolve
 *                  to a different soul).
 *   2. ANONYMOUS — no identity claim at all, on a route that legitimately
 *                  accepts unattributed writes (an anonymous quick note, a
 *                  session started with no agent). Nothing to attribute
 *                  means nothing to forge. Routes whose writes are always
 *                  attributed (locks, file claims, salvage, sugar/done)
 *                  pass `requireIdentity: true` and never see this state.
 *
 * And the fail-closed rejection rules:
 *
 *   - A self-asserted `agentId` with NO credential is a 401
 *     `IDENTITY_CREDENTIAL_REQUIRED`. Attribution is never taken on faith.
 *   - A credential that is PRESENT but does not verify is a 401
 *     `IDENTITY_CREDENTIAL_INVALID`. A failed check never degrades into
 *     acceptance.
 *   - A verified credential cannot launder a DIFFERENT soul's name: when the
 *     asserted `agentId` resolves (directly or via alias) to a minted actor
 *     other than the credential's, that is a 403 `IDENTITY_ALIAS_MISMATCH`.
 *   - A credential presented while the souls store is unavailable is a 503
 *     `IDENTITY_VERIFIER_UNAVAILABLE` — never verified by assumption.
 *
 * This EXTENDS actor-souls rather than inventing a parallel mechanism. Root
 * credentials come from POST /actors/register and POST /sugar/begin; scoped
 * session bodies come only from the provenance-bound recovery transaction.
 * The boundary never accepts scope coordinates asserted by the request.
 */

import type {
  ActorBodyCredentialProfile,
  ActorCredentialUseContext,
  ActorSouls,
  SessionBodyCredentialAction,
  SoulClass,
} from './actor-souls.js';
import { getWorktreeInfo, type WorktreeInfo } from './worktree.js';

/** The subset of the ADR-0040 souls store this boundary needs. */
export type IdentityVerifier = Pick<ActorSouls, 'verifyCredentialUse' | 'resolveActor'>;

/** Structured logger shape (matches the daemon's route logger). */
export interface BoundaryLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Metadata fragment stamped on records written through a verified identity. */
export interface VerifiedIdentityStamp {
  verified: true;
  actorId: string;
  soulClass: SoulClass;
  bodyCredentialId: string;
  credentialProfile: ActorBodyCredentialProfile;
  intendedAgentId: string;
}

export type IdentityWriteVerdict =
  | {
      ok: true;
      kind: 'verified';
      /** The daemon-minted principal the credential proved. */
      actorId: string;
      /** Effective attribution id for the record (display alias or actorId). */
      agentId: string;
      soulClass: SoulClass;
      bodyCredentialId: string;
      credentialProfile: ActorBodyCredentialProfile;
      intendedAgentId: string;
      /** Metadata fragment routes persist on the written record. */
      identity: VerifiedIdentityStamp;
    }
  | { ok: true; kind: 'anonymous'; agentId: null; identity: null }
  | {
      ok: false;
      httpStatus: 401 | 403 | 503;
      code:
        | 'IDENTITY_CREDENTIAL_REQUIRED'
        | 'IDENTITY_CREDENTIAL_INVALID'
        | 'IDENTITY_CREDENTIAL_SCOPE_MISMATCH'
        | 'IDENTITY_ALIAS_MISMATCH'
        | 'IDENTITY_VERIFIER_UNAVAILABLE';
      error: string;
    };

export interface ResolveWriteIdentityParams {
  /** ADR-0040 souls store; absent only in stripped daemon modes. */
  souls?: IdentityVerifier | null;
  /** Versioned body/root credential from the request carrier. */
  credential?: string | null;
  /** Self-asserted display identifier from body/header, already trimmed. */
  assertedAgentId?: string | null;
  /** Route label for the structured reject logs (e.g. 'POST /notes'). */
  route: string;
  /** Multi-tenant scope; defaults to the souls store's default harbor. */
  harbor?: string;
  /**
   * Daemon-derived action + live resource coordinates. Required for a scoped
   * session body; callers must never copy these fields from the request body.
   */
  credentialUseContext?: ActorCredentialUseContext | null;
  logger?: BoundaryLogger;
  /**
   * When true the route's writes are ALWAYS attributed (locks, file claims,
   * salvage, sugar/done): even a request asserting no identity at all is
   * rejected 401 instead of resolving anonymous.
   */
  requireIdentity?: boolean;
}

interface SessionCredentialSource {
  success?: boolean;
  session?: {
    id?: unknown;
    agentId?: unknown;
    identityProject?: unknown;
    status?: unknown;
    metadata?: { worktree?: unknown };
  };
}

/**
 * Derive a scoped body's exact resource from daemon-owned session state and
 * the live Git checkout. A request never supplies these coordinates. Missing,
 * moved, detached, or branch-switched worktrees fail closed as null.
 */
export function deriveSessionCredentialUseContext(
  sessionId: string,
  action: SessionBodyCredentialAction,
  lookup: (sessionId: string) => SessionCredentialSource,
  inspectWorktree: (cwd?: string) => WorktreeInfo | null = getWorktreeInfo,
): ActorCredentialUseContext | null {
  const result = lookup(sessionId);
  const session = result.success ? result.session : undefined;
  const storedWorktree = session?.metadata?.worktree;
  const root = storedWorktree && typeof storedWorktree === 'object'
    ? (storedWorktree as Record<string, unknown>).root
    : null;
  const liveWorktree = typeof root === 'string' && root.trim()
    ? inspectWorktree(root)
    : null;
  if (
    !session
    || typeof session.id !== 'string'
    || session.id !== sessionId
    || typeof session.agentId !== 'string'
    || !session.agentId.trim()
    || typeof session.identityProject !== 'string'
    || !session.identityProject.trim()
    || session.status !== 'active'
    || !liveWorktree
    || liveWorktree.root !== root
    || typeof liveWorktree.branch !== 'string'
    || !liveWorktree.branch.trim()
  ) {
    return null;
  }
  const intendedAgentId = session.agentId;
  const project = session.identityProject;
  const canonicalWorktree = liveWorktree.root;
  const branch = liveWorktree.branch;
  return {
    action,
    resource: {
      sessionId,
      intendedAgentId,
      project,
      canonicalWorktree,
      branch,
      status: 'active',
    },
  };
}

/** Minimal durable session fields needed to prove mutation ownership. */
export interface SessionOwnerRecord {
  id?: unknown;
  agentId?: unknown;
  metadata?: unknown;
}

export type SessionOwnerAuthorization =
  | {
      ok: true;
      /** Stored display/runtime agent id; never copied from the request. */
      ownerAgentId: string;
      /** Canonical daemon-minted actor id that owns the session. */
      ownerActorId: string;
      source: 'identity-stamp';
    }
  | {
      ok: false;
      httpStatus: 403;
      code: 'SESSION_OWNERSHIP_MISMATCH' | 'SESSION_OWNER_UNVERIFIABLE';
      error: string;
    };

/**
 * Extract an actor credential from a request, checking the dedicated header
 * first and then the body's `credential` field.
 *
 * Why a helper instead of inline reads: every enforced route must look in the
 * same two places or clients get inconsistent enforcement — the purpose here
 * is one canonical extraction order (`x-actor-credential` header wins, body
 * `credential` is the fallback) shared by all write boundaries.
 *
 * @param headers - Request headers (Fastify's `request.headers`).
 * @param body - Parsed request body (may be undefined/null).
 * @returns The credential string, or null when neither carrier is present.
 */
export function extractActorCredential(
  headers: Record<string, unknown>,
  body: unknown,
): string | null {
  const header = headers['x-actor-credential'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const fromBody = (body as Record<string, unknown>).credential;
    if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
  }
  return null;
}

/**
 * Resolve the identity a write should be attributed to, requiring the
 * daemon-minted ADR-0040 credential for every attributed write
 * (#8877 / ADR-0122 slice 1).
 *
 * Design invariants (see the module header for the full rationale):
 * - A self-asserted `agentId` with no credential REJECTS 401
 *   `IDENTITY_CREDENTIAL_REQUIRED` — self-assertion is never attribution.
 * - A presented-but-invalid credential REJECTS 401
 *   `IDENTITY_CREDENTIAL_INVALID` — a failed check never falls back to
 *   acceptance.
 * - A valid credential + an asserted agentId that resolves to a DIFFERENT
 *   minted soul REJECTS 403 — a real credential must not launder another
 *   soul's name onto a durable record.
 * - A credential presented while the souls store is unavailable REJECTS 503 —
 *   fail-closed, mirroring actor-souls' register() posture: never verify by
 *   assumption. (An UNCREDENTIALED attributed write while the store is down
 *   still 401s — it would 401 with the store up, too.)
 * - No identity claim at all resolves `anonymous` ONLY when the route accepts
 *   unattributed writes; with `requireIdentity: true` it REJECTS 401.
 *
 * @param params - Souls store, credential, asserted id, route label, logger.
 * @returns A verdict: verified / anonymous, or a typed rejection with the
 *          HTTP status the route should return.
 */
export function resolveWriteIdentity(params: ResolveWriteIdentityParams): IdentityWriteVerdict {
  const {
    souls,
    credential,
    assertedAgentId,
    route,
    harbor,
    logger,
    credentialUseContext,
  } = params;
  const asserted = typeof assertedAgentId === 'string' && assertedAgentId.trim()
    ? assertedAgentId.trim()
    : null;

  if (credential) {
    if (!souls) {
      logger?.error('identity_write_rejected', {
        route,
        code: 'IDENTITY_VERIFIER_UNAVAILABLE',
      });
      return {
        ok: false,
        httpStatus: 503,
        code: 'IDENTITY_VERIFIER_UNAVAILABLE',
        error: 'a credential was presented but the identity store is unavailable; refusing to write unverified',
      };
    }
    const credentialVerdict = souls.verifyCredentialUse(credential, {
      harbor,
      context: credentialUseContext,
    });
    if (!credentialVerdict.ok && credentialVerdict.code === 'CREDENTIAL_SCOPE_MISMATCH') {
      logger?.error('identity_write_rejected', {
        route,
        code: 'IDENTITY_CREDENTIAL_SCOPE_MISMATCH',
        assertedAgentId: asserted,
      });
      return {
        ok: false,
        httpStatus: 403,
        code: 'IDENTITY_CREDENTIAL_SCOPE_MISMATCH',
        error: 'this body credential is not authorized for the daemon-derived action and session resource',
      };
    }
    if (!credentialVerdict.ok) {
      logger?.error('identity_write_rejected', {
        route,
        code: 'IDENTITY_CREDENTIAL_INVALID',
        credentialFailure: credentialVerdict.code,
        assertedAgentId: asserted,
      });
      return {
        ok: false,
        httpStatus: 401,
        code: 'IDENTITY_CREDENTIAL_INVALID',
        error: 'actor credential did not verify; forged or stale credentials are rejected',
      };
    }
    const actorId = credentialVerdict.actorId;
    const scopedIntendedAgentId = credentialVerdict.intendedAgentId;
    if (scopedIntendedAgentId && asserted && asserted !== scopedIntendedAgentId) {
      logger?.error('identity_write_rejected', {
        route,
        code: 'IDENTITY_CREDENTIAL_SCOPE_MISMATCH',
        actorId,
        assertedAgentId: asserted,
        intendedAgentId: scopedIntendedAgentId,
      });
      return {
        ok: false,
        httpStatus: 403,
        code: 'IDENTITY_CREDENTIAL_SCOPE_MISMATCH',
        error: `this body credential is bound to agentId "${scopedIntendedAgentId}", not "${asserted}"`,
      };
    }
    if (asserted) {
      const resolved = souls.resolveActor(asserted, harbor);
      if (resolved.soulClass !== 'unknown' && resolved.actorId !== actorId) {
        logger?.error('identity_write_rejected', {
          route,
          code: 'IDENTITY_ALIAS_MISMATCH',
          actorId,
          assertedAgentId: asserted,
        });
        return {
          ok: false,
          httpStatus: 403,
          code: 'IDENTITY_ALIAS_MISMATCH',
          error: `agentId "${asserted}" belongs to a different minted actor than the presented credential`,
        };
      }
    }
    const soulClass = souls.resolveActor(actorId, harbor).soulClass;
    const intendedAgentId = scopedIntendedAgentId ?? asserted ?? actorId;
    return {
      ok: true,
      kind: 'verified',
      actorId,
      agentId: intendedAgentId,
      soulClass,
      bodyCredentialId: credentialVerdict.bodyCredentialId,
      credentialProfile: credentialVerdict.profile,
      intendedAgentId,
      identity: {
        verified: true,
        actorId,
        soulClass,
        bodyCredentialId: credentialVerdict.bodyCredentialId,
        credentialProfile: credentialVerdict.profile,
        intendedAgentId,
      },
    };
  }

  if (asserted || params.requireIdentity) {
    logger?.error('identity_write_rejected', {
      route,
      code: 'IDENTITY_CREDENTIAL_REQUIRED',
      assertedAgentId: asserted,
    });
    return {
      ok: false,
      httpStatus: 401,
      code: 'IDENTITY_CREDENTIAL_REQUIRED',
      error: asserted
        ? `agentId "${asserted}" was asserted without a daemon-minted credential; attributed writes require one (mint via POST /actors/register or POST /sugar/begin, then present it as the x-actor-credential header or body "credential")`
        : 'this write is always attributed; present a daemon-minted actor credential (x-actor-credential header or body "credential")',
    };
  }

  return { ok: true, kind: 'anonymous', agentId: null, identity: null };
}

/**
 * Bind a verified credential actor to the actor recorded on a durable session.
 *
 * Purpose: a valid credential proves only who the caller is; it does not prove
 * that the caller owns an arbitrary `sessionId`. New sessions carry the
 * daemon-stamped `metadata.identity.actorId`, which is authoritative. Legacy
 * rows fail closed: a public actor can bind a previously-unused display alias
 * after the row was created, so a present-day alias mapping cannot testify to
 * historical ownership. The request's `agentId` is deliberately absent from
 * this API so it can never become ownership proof.
 *
 * @param session - Stored session returned by the daemon's session store.
 * @param verdict - Verified identity verdict for the current request.
 * @param _souls - Reserved for the canonical resolver; never used to infer
 *        ownership of an unstamped historical row.
 * @returns Canonical stored owner binding, or a structured 403 rejection.
 */
export function authorizeSessionOwner(
  session: SessionOwnerRecord,
  verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>,
  _souls?: IdentityVerifier | null,
): SessionOwnerAuthorization {
  const sessionId = typeof session.id === 'string' && session.id.trim()
    ? session.id.trim()
    : '<unknown>';
  const ownerAgentId = typeof session.agentId === 'string' && session.agentId.trim()
    ? session.agentId.trim()
    : null;
  if (!ownerAgentId) {
    return {
      ok: false,
      httpStatus: 403,
      code: 'SESSION_OWNER_UNVERIFIABLE',
      error: `session "${sessionId}" has no attributable owner; refusing credentialed mutation`,
    };
  }

  const metadata = session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata)
    ? session.metadata as Record<string, unknown>
    : null;
  const rawStamp = metadata?.identity;
  const stamp = rawStamp && typeof rawStamp === 'object' && !Array.isArray(rawStamp)
    ? rawStamp as Record<string, unknown>
    : null;

  let ownerActorId: string | null = null;
  if (stamp?.verified === true) {
    ownerActorId = typeof stamp.actorId === 'string' && stamp.actorId.trim()
      ? stamp.actorId.trim()
      : null;
    if (!ownerActorId) {
      return {
        ok: false,
        httpStatus: 403,
        code: 'SESSION_OWNER_UNVERIFIABLE',
        error: `session "${sessionId}" has a malformed verified owner stamp; refusing mutation`,
      };
    }
  } else {
    return {
      ok: false,
      httpStatus: 403,
      code: 'SESSION_OWNER_UNVERIFIABLE',
      error: `session "${sessionId}" predates daemon-stamped actor ownership; refusing mutation until an operator-witnessed migration stamps it`,
    };
  }

  if (ownerActorId !== verdict.actorId) {
    return {
      ok: false,
      httpStatus: 403,
      code: 'SESSION_OWNERSHIP_MISMATCH',
      error: `the presented credential does not own session "${sessionId}"`,
    };
  }

  return { ok: true, ownerAgentId, ownerActorId, source: 'identity-stamp' };
}

/**
 * Merge an identity verdict's stamp into a record's metadata object.
 *
 * Purpose: routes persist the verdict on the durable record itself (under the
 * reserved `identity` key) so the record testifies who wrote it — not just a
 * log line that rotates away. The design deliberately overwrites any
 * caller-supplied `identity` key IN EVERY CASE, including anonymous writes:
 * that key is the daemon's verdict slot, and letting the request body pre-fill
 * it would reopen the self-assertion hole this module closes (an anonymous
 * caller could otherwise plant `identity: { verified: true, ... }`).
 *
 * @param metadata - Caller-supplied record metadata (may be null/undefined).
 * @param verdict - A successful verdict from resolveWriteIdentity.
 * @returns The metadata with the verdict's `identity` fragment merged in for
 *          verified writes, or with the reserved key stripped for anonymous
 *          writes.
 */
export function stampIdentityMetadata(
  metadata: Record<string, unknown> | null | undefined,
  verdict: Extract<IdentityWriteVerdict, { ok: true }>,
): Record<string, unknown> | null {
  if (verdict.kind === 'anonymous' || !verdict.identity) {
    if (metadata && Object.prototype.hasOwnProperty.call(metadata, 'identity')) {
      const { identity: _discarded, ...rest } = metadata;
      return rest;
    }
    return metadata ?? null;
  }
  return { ...(metadata ?? {}), identity: verdict.identity };
}
