/**
 * Macaroon library (ADR-0053 Phase 1 — the macaroon-discharge gate).
 *
 * Public surface:
 *   - Core crypto: create / addFirstPartyCaveat / addThirdPartyCaveat /
 *     prepareForRequest / verify / serialize / deserialize  (macaroon.ts)
 *   - Caveat grammar: builders + parseCaveat / checkCaveat / makeChecker /
 *     narrows  (caveats.ts)
 *   - Rent-paid discharge: mintPushGrant / dischargeRentPaid  (discharge.ts)
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
  mintPushGrant,
  dischargeRentPaid,
  DISCHARGE_TTL_MS,
  type RentDischargeRecord,
  type GrantMintResult,
  type MintPushGrantOptions,
  type DischargeResult,
  type DischargeRentOptions,
} from './discharge.js';
export { verifyPushGrant, type GateResult } from './gate.js';
