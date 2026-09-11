/**
 * Macaroon library (ADR-0053 Phase 1 — the macaroon-discharge gate).
 *
 * @deprecated NON-CANONICAL. The canonical macaroon implementation is the Rust
 * kernel crate `core/kernel/pd-anchor` (`pd-anchor::macaroon`) — see ADR-0054
 * §"Update (2026-06-15) — the macaroon gate is kernel-canonical". This TS module
 * is retained as a byte-parity FALLBACK (used only when the FFI dylib is absent,
 * the way `lib/cap-attenuation-monitor.ts` falls back for the harbor enforcer),
 * NOT as a second authoritative implementation. Do NOT extend the construction
 * here independently: any change must keep byte-parity with the Rust impl, proven
 * by the shared test vectors (ADR-0054 Phase 6). New consumers should target the
 * kernel via the planned koffi FFI client, not import this directly.
 *
 * Byte-parity status (ADR-0054 Phase 6): CLOSED. The third-party caveat `vid` here
 * is now the same HMAC commitment (`HMAC(chain_sig, caveat_key)`) as the canonical
 * Rust impl — no longer AES-GCM — and `verify()` takes a `resolveCaveatKey` resolver
 * (the verifier holds the key), matching Rust. Parity is asserted both ways by the
 * shared vectors in `tests/fixtures/macaroon-parity-vectors.json`
 * (`tests/unit/macaroon-parity.test.js` ⇄ the Rust `parity_vectors` test).
 *
 * Public surface:
 *   - Core crypto: create / addFirstPartyCaveat / addThirdPartyCaveat /
 *     prepareForRequest / verify / serialize / deserialize  (macaroon.ts)
 *   - Caveat grammar: builders + parseCaveat / checkCaveat / makeChecker /
 *     narrows  (caveats.ts)
 *   - Rent-paid discharge: mintActorBoundPushGrant / dischargeRentPaid  (discharge.ts)
 *   - The gate: verifyPushGrant  (gate.ts)
 *
 * See `docs/adr/0053-out-of-band-enforcement.md` Appendix A for the schema.
 */

export * from './types.js';
export {
  create,
  addFirstPartyCaveat,
  addThirdPartyCaveat,
  prepareForRequest,
  verify,
  serialize,
  deserialize,
  type VerifyResult,
} from './macaroon.js';
export {
  parseCaveat,
  checkCaveat,
  makeChecker,
  narrows,
  opCaveat,
  repoCaveat,
  branchCaveat,
  denyBranchCaveat,
  hostCaveat,
  spendCeilingCaveat,
  expiresCaveat,
  sessionCaveat,
  type CaveatField,
  type CaveatOp,
  type ParsedCaveat,
} from './caveats.js';
export {
  mintActorBoundPushGrant,
  actorBoundPushGrantIdentifier,
  matchesActorBoundPushGrantIdentifier,
  isCanonicalActorPrincipal,
  dischargeRentPaid,
  ACTOR_BOUND_PUSH_GRANT_DOMAIN,
  CANONICAL_ACTOR_ID_BYTES,
  DISCHARGE_TTL_MS,
  type RentDischargeRecord,
  type GrantMintResult,
  type MintActorBoundPushGrantOptions,
  type DischargeResult,
  type DischargeRentOptions,
} from './discharge.js';
export { verifyPushGrant, type GateResult } from './gate.js';
