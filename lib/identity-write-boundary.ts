/**
 * lib/identity-write-boundary.ts — REQUIRE daemon-minted identity at every
 * attributed write boundary (Harbor Authority / ADR-0122 slice 1; closes #8877).
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS (motivation)
 * ════════════════════════════════════════════════════════════════════════════
 * ADR-0040 gave the daemon a mint (`lib/actor-souls.ts`): the only component
 * that issues principals, each bound to a `<actor_id>.<secret>` lookup-token
 * credential. But the mint was only *wired into the economic choke*
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
 * This EXTENDS actor-souls rather than inventing a parallel mechanism: the
 * credential format, verification, and alias resolution are all ADR-0040's,
 * unchanged. Credentials are obtained from the two mint doors — POST
 * /actors/register, and POST /sugar/begin (which mints for uncredentialed
 * callers and returns the credential once).
 */

import type { ActorSouls } from './actor-souls.js';
import type { SoulClass } from './actor-souls.js';

/** The subset of the ADR-0040 souls store this boundary needs. */
export type IdentityVerifier = Pick<ActorSouls, 'verifyCredential' | 'resolveActor'>;

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
        | 'IDENTITY_ALIAS_MISMATCH'
        | 'IDENTITY_VERIFIER_UNAVAILABLE';
      error: string;
    };

export interface ResolveWriteIdentityParams {
  /** ADR-0040 souls store; absent only in stripped daemon modes. */
  souls?: IdentityVerifier | null;
  /** `<actor_id>.<secret>` from the request (body `credential` / header). */
  credential?: string | null;
  /** Self-asserted display identifier from body/header, already trimmed. */
  assertedAgentId?: string | null;
  /** Route label for the structured reject logs (e.g. 'POST /notes'). */
  route: string;
  /** Multi-tenant scope; defaults to the souls store's default harbor. */
  harbor?: string;
  logger?: BoundaryLogger;
  /**
   * When true the route's writes are ALWAYS attributed (locks, file claims,
   * salvage, sugar/done): even a request asserting no identity at all is
   * rejected 401 instead of resolving anonymous.
   */
  requireIdentity?: boolean;
}

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
  const { souls, credential, assertedAgentId, route, harbor, logger } = params;
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
    const actorId = souls.verifyCredential(credential, harbor);
    if (!actorId) {
      logger?.error('identity_write_rejected', {
        route,
        code: 'IDENTITY_CREDENTIAL_INVALID',
        assertedAgentId: asserted,
      });
      return {
        ok: false,
        httpStatus: 401,
        code: 'IDENTITY_CREDENTIAL_INVALID',
        error: 'actor credential did not verify; forged or stale credentials are rejected',
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
    return {
      ok: true,
      kind: 'verified',
      actorId,
      agentId: asserted ?? actorId,
      soulClass,
      identity: { verified: true, actorId, soulClass },
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
