/**
 * Macaroon types — the grant object for ADR-0053 out-of-band enforcement.
 *
 * A macaroon (Birgisson et al., 2014, "Macaroons: Cookies with Contextual
 * Caveats for Decentralized Authorization in the Cloud") is a bearer credential
 * whose authority can only ever be *narrowed* by its holder, never broadened.
 * The holder appends caveats; each caveat is folded into a chained HMAC so a
 * tampered or removed caveat breaks the signature. The root key that seeds the
 * chain never leaves the minting daemon/Relay (Appendix A of ADR-0053), so the
 * holder can present-and-verify but can neither mint nor re-sign.
 *
 * This file is the wire/shape contract only. The crypto lives in `macaroon.ts`,
 * the Port Daddy caveat grammar in `caveats.ts`, and the rent-paid discharge in
 * `discharge.ts`.
 */

/**
 * A single caveat. First-party caveats carry only `cid` (a predicate string the
 * verifier checks locally). Third-party caveats additionally carry `vid` (the
 * verification id binding a discharge key into the chain) and `cl` (the location
 * to fetch the discharge from). The discriminator is the presence of `vid`.
 */
export interface Caveat {
  /** Caveat id. First-party: a predicate (e.g. `op = push`). Third-party: the
   *  opaque, encrypted caveat id the discharge service decrypts. */
  cid: string;
  /** Verification id (hex). Present ONLY on third-party caveats: the discharge
   *  root key sealed under the chain signature at this point. */
  vid?: string;
  /** Caveat location. Present ONLY on third-party caveats: where to discharge. */
  cl?: string;
}

/** True iff the caveat is third-party (requires a discharge macaroon). */
export function isThirdParty(c: Caveat): boolean {
  return typeof c.vid === 'string' && c.vid.length > 0;
}

/**
 * The macaroon itself. `signature` is the running chained HMAC over all caveats,
 * hex-encoded. Serialization is plain JSON — the security is in the signature,
 * not in obscurity of the envelope.
 */
export interface Macaroon {
  /** Hint to the verifier: who minted this / who to ask. e.g. `pd://daemon/<repo>`. */
  location: string;
  /** Opaque grant id; maps to a root key held only by the minter. */
  identifier: string;
  /** Ordered caveats, each HMAC-chained to the previous signature. */
  caveats: Caveat[];
  /** Running signature (hex): HMAC(prev_sig, caveat_bytes), seeded by the root key. */
  signature: string;
}

/**
 * The context a verifier checks first-party caveats against — the concrete facts
 * of the request being authorized. A caveat predicate either holds for this
 * context or it does not. Fields are optional because not every caveat kind is
 * relevant to every request (a `host` caveat is meaningless for a git push).
 */
export interface RequestContext {
  /** The operation being attempted. */
  op?: 'push' | 'api-call';
  /** Repository id, e.g. `curiositech/port-daddy`. */
  repo?: string;
  /** The git ref/branch being pushed to (short name, e.g. `feat/x`). */
  branch?: string;
  /** Outbound host for a Layer-2 API call, e.g. `api.anthropic.com`. */
  host?: string;
  /** USD this call would spend (for `spend_usd <=` ceilings). */
  spendUsd?: number;
  /** The coordinating session id. */
  session?: string;
  /** Verification wall-clock (unix ms). Injected, never read from the system
   *  clock inside the checker, so verification is deterministic and testable. */
  nowMs: number;
}
