/**
 * Rent-paid discharge (ADR-0053 Appendix A §A.3).
 *
 * This is the keystone that ties the macaroon crypto to Port Daddy's compulsion
 * engine. A push grant carries exactly one third-party caveat — "the daemon
 * attests rent-paid for session S". To use the grant, the agent must present a
 * discharge macaroon that the daemon mints ONLY when `evaluateLeaseRent()`
 * (`lib/coast-guard/compulsion.ts`, ADR-0050 phase 7) returns `paid`. The
 * discharge is short-lived (20 min), so a lapse in coordination kills the
 * capability within one window with nothing to revoke — the absence of a fresh
 * discharge *is* the revocation (the Nash-equilibrium property, realized in
 * crypto rather than a hook).
 *
 * The daemon holds the discharge root key (`caveatKey`) keyed by the caveat id;
 * the agent never sees it, so it can request a discharge but cannot mint one.
 */

import {
  evaluateLeaseRent,
  DEFAULT_RENT_POLICY,
  type LeaseFacts,
  type RentEvaluation,
  type RentPolicy,
} from '../coast-guard/compulsion.js';
import { createHash } from 'node:crypto';
import { create, addFirstPartyCaveat, addThirdPartyCaveat } from './macaroon.js';
import type { Macaroon } from './types.js';
import {
  opCaveat,
  repoCaveat,
  denyBranchCaveat,
  expiresCaveat,
  sessionCaveat,
} from './caveats.js';

/** Default discharge lifetime — matches the rent TTL in Appendix A §A.4. */
export const DISCHARGE_TTL_MS = 20 * 60 * 1000;
export const ACTOR_BOUND_PUSH_GRANT_DOMAIN = 'port-daddy/actor-bound-push-grant/v1';
const ACTOR_BOUND_PUSH_GRANT_PREFIX = 'pd-actor-push-v1:';
const MAX_ACTOR_BOUND_GRANT_ID_BYTES = 64;
const MAX_ACTOR_BOUND_SCOPE_BYTES = 512;
const MAX_ACTOR_BOUND_KEY_BYTES = 128;
export const CANONICAL_ACTOR_ID_BYTES = 26;

const DEFAULT_LOCATION = 'pd://daemon';
const RENT_LOCATION = 'pd://daemon/rent';

/**
 * What the daemon must persist to later discharge a rent caveat: the discharge
 * root key and the session it is bound to. Stored keyed by `rentCaveatId`. (In
 * the integration PR this is a SQLite row; the core lib stays storage-agnostic.)
 */
export interface RentDischargeRecord {
  /** Root key of the discharge macaroon. Held only by the daemon. */
  caveatKey: Buffer;
  /** The session whose rent this caveat gates. */
  session: string;
}

export interface GrantMintResult {
  /** The push grant — carries no root key; safe to hand to the agent. */
  macaroon: Macaroon;
  /** The third-party caveat id the daemon will discharge. */
  rentCaveatId: string;
  /** The secret the daemon stores (keyed by `rentCaveatId`) to mint discharges. */
  record: RentDischargeRecord;
}

export interface MintActorBoundPushGrantOptions {
  /** Grant root key — held only by the daemon; never embedded in the macaroon. */
  rootKey: Buffer;
  /** Opaque grant id (maps to `rootKey` in the daemon). */
  grantId: string;
  /** Repository the grant authorizes pushes to. */
  repoId: string;
  /** Canonical daemon-minted actor principal; aliases and sessions are invalid. */
  actor: string;
  /** Session the grant is bound to. */
  session: string;
  /** Hard expiry of the grant itself (unix ms). */
  expiresMs: number;
  /** Discharge root key — caller supplies it (no randomness in this pure fn). */
  caveatKey: Buffer;
  /** Nonce making the rent caveat id unique per grant (caller-supplied). */
  rentNonce: string;
  /** Protected branch the grant must never push to. Default `main`. */
  protectedBranch?: string;
  /** Macaroon location hint. */
  location?: string;
}

/**
 * Mint a push grant: a macaroon with the non-negotiable first-party caveats the
 * root daemon always appends (op=push, repo, deny protected branch, hard expiry,
 * session bind) plus the single third-party rent-paid caveat. The agent may
 * attenuate further (one branch, sooner expiry) but can never broaden.
 *
 * Returns the macaroon, the rent caveat id, and the secret record the daemon
 * must store to discharge it later.
 */
export function mintActorBoundPushGrant(opts: MintActorBoundPushGrantOptions): GrantMintResult {
  const protectedBranch = opts.protectedBranch ?? 'main';
  if (
    opts.rootKey.length === 0 ||
    opts.rootKey.length > MAX_ACTOR_BOUND_KEY_BYTES ||
    opts.caveatKey.length === 0 ||
    opts.caveatKey.length > MAX_ACTOR_BOUND_KEY_BYTES ||
    !Number.isSafeInteger(opts.expiresMs) ||
    opts.expiresMs <= 0 ||
    !boundedText(opts.rentNonce, MAX_ACTOR_BOUND_SCOPE_BYTES) ||
    !boundedText(protectedBranch, MAX_ACTOR_BOUND_SCOPE_BYTES)
  ) {
    throw new Error('macaroon: malformed actor-bound push grant fields');
  }
  const rentCaveatId = `rent-paid:${opts.session}:${opts.rentNonce}`;
  const identifier = actorBoundPushGrantIdentifier(
    opts.grantId,
    opts.actor,
    opts.repoId,
    opts.session,
  );

  let m = create(opts.rootKey, identifier, opts.location ?? `${DEFAULT_LOCATION}/${opts.repoId}`);
  m = addFirstPartyCaveat(m, opCaveat('push'));
  m = addFirstPartyCaveat(m, repoCaveat(opts.repoId));
  m = addFirstPartyCaveat(m, denyBranchCaveat(protectedBranch));
  m = addFirstPartyCaveat(m, expiresCaveat(opts.expiresMs));
  m = addFirstPartyCaveat(m, `actor = ${opts.actor}`);
  m = addFirstPartyCaveat(m, sessionCaveat(opts.session));
  m = addThirdPartyCaveat(m, opts.caveatKey, rentCaveatId, RENT_LOCATION);

  return {
    macaroon: m,
    rentCaveatId,
    record: { caveatKey: opts.caveatKey, session: opts.session },
  };
}

/** Canonical actor-bound identifier shared with the Rust pd-anchor recipe. */
export function actorBoundPushGrantIdentifier(
  grantId: string,
  actor: string,
  repoId: string,
  session: string,
): string {
  if (
    !boundedText(grantId, MAX_ACTOR_BOUND_GRANT_ID_BYTES) ||
    grantId.includes(':') ||
    !isCanonicalActorPrincipal(actor) ||
    !boundedText(repoId, MAX_ACTOR_BOUND_SCOPE_BYTES) ||
    !boundedText(session, MAX_ACTOR_BOUND_SCOPE_BYTES)
  ) {
    throw new Error('macaroon: malformed actor-bound push grant scope');
  }
  const hash = createHash('sha256');
  for (const field of [ACTOR_BOUND_PUSH_GRANT_DOMAIN, grantId, actor, repoId, session]) {
    const bytes = Buffer.from(field, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  }
  return `${ACTOR_BOUND_PUSH_GRANT_PREFIX}${grantId}:${hash.digest('hex')}`;
}

/** Structural actor-bound commitment check. HMAC verification is still required. */
export function matchesActorBoundPushGrantIdentifier(
  grant: Macaroon,
  actor: string,
  repoId: string,
  session: string,
): boolean {
  if (!grant.identifier.startsWith(ACTOR_BOUND_PUSH_GRANT_PREFIX)) return false;
  const rest = grant.identifier.slice(ACTOR_BOUND_PUSH_GRANT_PREFIX.length);
  const separator = rest.lastIndexOf(':');
  if (separator <= 0) return false;
  const grantId = rest.slice(0, separator);
  try {
    return grant.identifier === actorBoundPushGrantIdentifier(grantId, actor, repoId, session);
  } catch {
    return false;
  }
}

export function isCanonicalActorPrincipal(actor: string): boolean {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(actor);
}

function boundedText(value: string, maxBytes: number): boolean {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= maxBytes &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

export interface DischargeResult {
  ok: boolean;
  /** Corrective-only reason (never names a bypass) when `ok` is false. */
  reason: string;
  /** The discharge macaroon when rent is paid. */
  discharge?: Macaroon;
  /** The full rent evaluation, for audit/logging. */
  evaluation: RentEvaluation;
}

export interface DischargeRentOptions {
  /** The stored secret for this caveat id. */
  record: RentDischargeRecord;
  /** The third-party caveat id being discharged. */
  rentCaveatId: string;
  /** The session the discharge is requested for — must match the record. */
  session: string;
  /** Current lease facts (gathered by `compulsion-facts.ts` in production). */
  facts: LeaseFacts;
  /** Verification clock (unix ms); injected for determinism. */
  nowMs: number;
  /** Rent policy override. */
  policy?: RentPolicy;
  /** Discharge lifetime; default 20 min. */
  ttlMs?: number;
}

/**
 * Discharge a rent caveat: evaluate the lease, and mint a short-lived discharge
 * macaroon ONLY if rent is `paid`. Any other verdict (rent-due, idle, stale)
 * refuses with the evaluation's corrective reason — the agent learns what to fix
 * (publish a note, rebase), never how to bypass.
 */
export function dischargeRentPaid(opts: DischargeRentOptions): DischargeResult {
  const policy = opts.policy ?? DEFAULT_RENT_POLICY;

  // Bind check: the discharge request must be for the session the caveat gates.
  if (opts.session !== opts.record.session) {
    return {
      ok: false,
      reason: `rent caveat is bound to a different session; request a discharge for that session.`,
      evaluation: evaluateLeaseRent(opts.facts, policy),
    };
  }

  const evaluation = evaluateLeaseRent(opts.facts, policy);
  if (evaluation.verdict !== 'paid') {
    return { ok: false, reason: evaluation.reason, evaluation };
  }

  const ttl = opts.ttlMs ?? DISCHARGE_TTL_MS;
  let discharge = create(opts.record.caveatKey, opts.rentCaveatId, RENT_LOCATION);
  discharge = addFirstPartyCaveat(discharge, expiresCaveat(opts.nowMs + ttl));

  return { ok: true, reason: 'rent is current', discharge, evaluation };
}
