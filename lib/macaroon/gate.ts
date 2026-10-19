/**
 * The push-authorization gate (ADR-0053 Phase 1).
 *
 * The single entry point the Relay (`apps/relay`, ADR-0049) and the `pd guard`
 * push broker call: "is this push authorized?" It composes the macaroon chain
 * verification with the Port Daddy caveat grammar and the rent-paid discharge —
 * the agent must present a grant macaroon AND a valid, unexpired, request-bound
 * rent discharge, and every first-party caveat (op, repo, protected-ref deny,
 * expiry, session) must hold for the concrete request.
 *
 * This is the "wall" property: a push whose macaroon lacks a valid rent-paid
 * discharge is rejected here, server-side, regardless of any env var on the
 * agent's box. It is NOT confinement (a malicious same-UID holder can still copy
 * a live discharge inside its 20-min window — only Layer 3 closes that); it
 * makes the gate unforgeable and the audit a verifiable transcript.
 */

import { verify, type VerifyResult } from './macaroon.js';
import { makeChecker } from './caveats.js';
import {
  isCanonicalActorPrincipal,
  matchesActorBoundPushGrantIdentifier,
} from './discharge.js';
import type { Macaroon, RequestContext } from './types.js';

export interface GateResult {
  /** True iff the push is authorized. */
  authorized: boolean;
  /** Machine-readable reason — corrective-only, never names a bypass. */
  reason: string;
}

/**
 * Verify a push grant against a concrete request. `rootKey` is the daemon-held
 * grant root key for `grant.identifier`; `discharges` are the request-bound
 * discharge macaroons the agent presented. The request context carries the
 * facts the first-party caveats are checked against (op, repo, branch, session)
 * and the verification clock (`nowMs`).
 */
export function verifyPushGrant(
  grant: Macaroon,
  rootKey: Buffer,
  discharges: Macaroon[],
  /** Trusted daemon-minted actor principal, never a caller alias or session id. */
  actor: string,
  ctx: RequestContext,
  /** Resolve the discharge key for a third-party caveat id (the daemon holds
   *  these in its store — the HMAC-commitment model). Omit for first-party-only. */
  resolveCaveatKey: (caveatId: string) => Buffer | null = () => null,
): GateResult {
  if (
    !isCanonicalActorPrincipal(actor) ||
    !ctx.repo ||
    !ctx.session ||
    !matchesActorBoundPushGrantIdentifier(grant, actor, ctx.repo, ctx.session)
  ) {
    return { authorized: false, reason: 'macaroon is not actor-bound push authority' };
  }
  const actorPredicate = `actor = ${actor}`;
  if (!grant.caveats.some((caveat) => !caveat.vid && caveat.cid === actorPredicate)) {
    return { authorized: false, reason: 'actor-bound push grant lacks its actor caveat' };
  }
  const checkCaveat = makeChecker(ctx);
  const checker = (predicate: string): boolean =>
    predicate === actorPredicate || checkCaveat(predicate);
  const res: VerifyResult = verify(grant, rootKey, discharges, checker, resolveCaveatKey);
  return { authorized: res.ok, reason: res.reason };
}
