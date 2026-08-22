/**
 * lib/identity-write-boundary.ts — enforce daemon-minted identity at write
 * boundaries (Harbor Authority / ADR-0122 slice 1; closes the gap in #8877).
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS (motivation)
 * ════════════════════════════════════════════════════════════════════════════
 * ADR-0040 gave the daemon a mint (`lib/actor-souls.ts`): the only component
 * that issues principals, each bound to a `<actor_id>.<secret>` lookup-token
 * credential. But the mint was only *wired into the economic choke*
 * (budget-guard) — the legacy write routes (sessions, notes, file claims,
 * locks) kept accepting a bare self-asserted `agentId` string from the body or
 * an `x-agent-id` header. Issue #8877 records the consequence: an agent can
 * write durable, attributed records (sessions, notes) under any name it
 * likes — impersonation and reputation-whitewashing via the legacy paths.
 *
 * This module is the shared verdict function those write routes now call.
 * Its design goal is to make identity at a write boundary a three-state fact
 * that can never be silently wrong:
 *
 *   1. VERIFIED   — the caller presented a daemon-minted credential and it
 *                   checked out. The write is attributed to the minted
 *                   actor_id (self-asserted display names must agree).
 *   2. DOWNGRADED — no credential, only a self-asserted string. The write is
 *                   still admitted (hard-rejecting would break every existing
 *                   client), but LOUDLY: a structured
 *                   `legacy_identity_downgrade` log line fires and the
 *                   verdict carries a flag object the route persists on the
 *                   record and echoes in the response. Visible, never silent.
 *   3. ANONYMOUS  — no identity claim at all. Routes that permit anonymous
 *                   writes keep permitting them; nothing to attribute means
 *                   nothing to forge.
 *
 * And two rejection rules that make forgery fail closed:
 *
 *   - A credential that is PRESENT but does not verify is a 401 REJECT,
 *     never a downgrade. Failing a credential check must not degrade into
 *     the legacy path, or the enforcement is theater.
 *   - A verified credential cannot launder a DIFFERENT soul's name: when the
 *     self-asserted `agentId` resolves (directly or via alias) to a minted
 *     actor other than the credential's, that is a 403 REJECT.
 *
 * This EXTENDS actor-souls rather than inventing a parallel mechanism: the
 * credential format, verification, and alias resolution are all ADR-0040's,
 * unchanged. What is new is only the per-write verdict + downgrade flagging.
 */

import type { ActorSouls } from './actor-souls.js';
import type { SoulClass } from './actor-souls.js';

/** The subset of the ADR-0040 souls store this boundary needs. */
export type IdentityVerifier = Pick<ActorSouls, 'verifyCredential' | 'resolveActor'>;

/**
 * Durable flag persisted on a record written through a legacy self-asserted
 * identity. Stored in the record's metadata so the downgrade is visible
 * forever, not just in a log line that rotates away.
 */
export interface LegacyIdentityDowngrade {
  /** Discriminator so consumers can find these flags in mixed metadata. */
  mode: 'legacy-self-asserted';
  /** The unverified string the caller asserted. */
  assertedAgentId: string;
  /** What the souls store knows about that string ('unknown' = no soul). */
  soulClass: SoulClass;
  /** When the downgrade was admitted (ms epoch). */
  downgradedAt: number;
}

/** Structured logger shape (matches the daemon's route logger). */
export interface BoundaryLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
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
      identity: { verified: true; actorId: string; soulClass: SoulClass };
    }
  | {
      ok: true;
      kind: 'downgraded';
      agentId: string;
      soulClass: SoulClass;
      downgrade: LegacyIdentityDowngrade;
      identity: { verified: false; downgrade: LegacyIdentityDowngrade };
    }
  | { ok: true; kind: 'anonymous'; agentId: null; identity: null }
  | {
      ok: false;
      httpStatus: 401 | 403 | 503;
      code:
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
  /** Route label for the structured downgrade/reject logs (e.g. 'POST /notes'). */
  route: string;
  /** Multi-tenant scope; defaults to the souls store's default harbor. */
  harbor?: string;
  logger?: BoundaryLogger;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
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
 * Resolve the identity a write should be attributed to, enforcing the
 * daemon-minted credential where one is presented and emitting a loud,
 * structured "legacy-identity downgrade" where only a self-asserted string
 * arrived (issue #8877 / ADR-0122 slice 1).
 *
 * Design invariants (see the module header for the full rationale):
 * - A presented-but-invalid credential REJECTS 401 — it never falls back to
 *   the legacy path, because a silent fallback would let forgery masquerade
 *   as a downgrade.
 * - A valid credential + an asserted agentId that resolves to a DIFFERENT
 *   minted soul REJECTS 403 — a real credential must not launder another
 *   soul's name onto a durable record.
 * - A credential presented while the souls store is unavailable REJECTS 503 —
 *   fail-closed, mirroring actor-souls' register() posture: never verify by
 *   assumption.
 * - A bare self-asserted id is ADMITTED as a flagged downgrade (hard
 *   enforcement would break every pre-ADR-0122 client), with a structured
 *   `legacy_identity_downgrade` log AND a metadata flag the caller persists
 *   on the record, so the record itself testifies it was legacy-attributed.
 *
 * @param params - Souls store, credential, asserted id, route label, logger.
 * @returns A verdict: verified / downgraded / anonymous, or a typed rejection
 *          with the HTTP status the route should return.
 */
export function resolveWriteIdentity(params: ResolveWriteIdentityParams): IdentityWriteVerdict {
  const { souls, credential, assertedAgentId, route, harbor, logger } = params;
  const now = params.now ?? Date.now;
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
        error: 'actor credential did not verify; forged or stale credentials are rejected, never downgraded',
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

  if (asserted) {
    const soulClass: SoulClass = souls ? souls.resolveActor(asserted, harbor).soulClass : 'unknown';
    const downgrade: LegacyIdentityDowngrade = {
      mode: 'legacy-self-asserted',
      assertedAgentId: asserted,
      soulClass,
      downgradedAt: now(),
    };
    // LOUD by design: one structured line per admitted legacy write, so the
    // fleet's observability plane can count/alarm on downgrades and the
    // migration to credentialed writes is measurable, not aspirational.
    logger?.info('legacy_identity_downgrade', {
      route,
      assertedAgentId: asserted,
      soulClass,
    });
    return {
      ok: true,
      kind: 'downgraded',
      agentId: asserted,
      soulClass,
      downgrade,
      identity: { verified: false, downgrade },
    };
  }

  return { ok: true, kind: 'anonymous', agentId: null, identity: null };
}

/**
 * Merge an identity verdict's flag fragment into a record's metadata object.
 *
 * Purpose: routes persist the verdict on the durable record itself (under the
 * reserved `identity` key) so a downgraded write remains visibly downgraded
 * after every log line has rotated — the record testifies, not the log. The
 * design deliberately overwrites any caller-supplied `identity` key: that key
 * is the daemon's verdict slot, and letting the request body pre-fill it
 * would reopen the self-assertion hole this module closes.
 *
 * @param metadata - Caller-supplied record metadata (may be null/undefined).
 * @param verdict - A successful verdict from resolveWriteIdentity.
 * @returns The metadata with the verdict's `identity` fragment merged in, or
 *          the original metadata untouched for anonymous writes.
 */
export function stampIdentityMetadata(
  metadata: Record<string, unknown> | null | undefined,
  verdict: Extract<IdentityWriteVerdict, { ok: true }>,
): Record<string, unknown> | null {
  if (verdict.kind === 'anonymous' || !verdict.identity) return metadata ?? null;
  return { ...(metadata ?? {}), identity: verdict.identity };
}
