/**
 * Macaroon core crypto (ADR-0053 Phase 1).
 *
 * Standard Birgisson-et-al. construction over HMAC-SHA256, with third-party
 * caveat verification ids sealed under AES-256-GCM. The chain is:
 *
 *   sig_0        = HMAC(rootKey, identifier)
 *   sig_{i+1}    = HMAC(sig_i, caveat_bytes_i)
 *
 * where for a first-party caveat `caveat_bytes = cid`, and for a third-party
 * caveat `caveat_bytes = vid || cid`. The third-party `vid` is the discharge
 * root key sealed under `sig_i`, so a verifier that can recompute `sig_i` (i.e.
 * holds the real root key and every prior caveat) can recover the discharge key
 * and check the discharge macaroon — but a holder cannot, so it cannot forge a
 * discharge.
 *
 * Verification is **per-hop**: each discharge is checked against the key sealed
 * at its own caveat, and bound to the root macaroon's final signature. The naive
 * "compare final signature to a root-derived value" verifier is unsound — proven
 * on branch `defense/anchor-attenuation-soundness` in ProVerif — which is why
 * `verify()` recomputes the chain hop by hop rather than trusting any shortcut.
 *
 * Crypto primitives are Node's built-in `node:crypto` (HMAC-SHA256, AES-256-GCM,
 * SHA-256), matching `lib/note-encryption.ts` and `lib/coordination-crypto.ts`.
 */

import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Caveat, Macaroon, RequestContext } from './types.js';
import { isThirdParty } from './types.js';

const HMAC_ALGO = 'sha256';
const ENC_ALGO = 'aes-256-gcm';
/** Binding key for prepare-for-request: 32 zero bytes, per libmacaroons. */
const BIND_KEY = Buffer.alloc(32, 0);

/** SHA-256 signatures are always 32 bytes → 64 hex chars. */
const SIG_HEX_LEN = 64;
/** Generous upper bound on a vid (a real vid is iv+tag+ct ≈ 120 hex chars).
 *  Bounding the length fail-fast keeps a hostile macaroon from forcing a large
 *  allocation / hex decode at the gate before authentication can reject it. */
const MAX_VID_HEX = 1024;
const HEX_RE = /^[0-9a-f]*$/i;

/**
 * Validate a hex string fail-fast: hex chars only, even length, and (optionally)
 * an exact byte count. Returns false instead of throwing so every caller can
 * fail closed. Used at the untrusted-input boundary (verify / deserialize).
 */
function isValidHex(s: unknown, exactBytes?: number): s is string {
  if (typeof s !== 'string') return false;
  if (s.length % 2 !== 0) return false;
  if (exactBytes !== undefined && s.length !== exactBytes * 2) return false;
  return HEX_RE.test(s);
}

/** Runtime shape check for a single caveat from untrusted JSON. */
function isWellFormedCaveat(c: unknown): c is Caveat {
  if (typeof c !== 'object' || c === null) return false;
  const cav = c as Record<string, unknown>;
  if (typeof cav.cid !== 'string') return false;
  if (cav.vid !== undefined && typeof cav.vid !== 'string') return false;
  if (cav.cl !== undefined && typeof cav.cl !== 'string') return false;
  return true;
}

function hmac(key: Buffer, ...messages: Buffer[]): Buffer {
  const h = createHmac(HMAC_ALGO, key);
  for (const m of messages) h.update(m);
  return h.digest();
}

/** Derive a 32-byte AES key from a chain signature (the signature is already a
 *  32-byte HMAC output, but we hash it so the encryption key is domain-separated
 *  from the MAC value the verifier compares against). */
function deriveEncKey(sig: Buffer): Buffer {
  return createHash('sha256').update(Buffer.from('pd-macaroon-vid\0')).update(sig).digest();
}

/** Seal a discharge root key under the current chain signature → vid (hex). */
function sealVid(sig: Buffer, caveatKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENC_ALGO, deriveEncKey(sig), iv);
  const ct = Buffer.concat([cipher.update(caveatKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('hex');
}

/** Recover a discharge root key from a vid (hex) using the current chain sig.
 *  Returns null if the vid is malformed or the GCM tag does not authenticate.
 *  Length is bounded and hex-validated fail-fast before any decode. */
function openVid(sig: Buffer, vidHex: string): Buffer | null {
  if (!isValidHex(vidHex) || vidHex.length > MAX_VID_HEX) return null;
  const buf = Buffer.from(vidHex, 'hex');
  if (buf.length < 12 + 16) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  try {
    const decipher = createDecipheriv(ENC_ALGO, deriveEncKey(sig), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    return null;
  }
}

function caveatBytes(c: Caveat): Buffer {
  return isThirdParty(c)
    ? Buffer.concat([Buffer.from(c.vid as string, 'hex'), Buffer.from(c.cid, 'utf8')])
    : Buffer.from(c.cid, 'utf8');
}

/** Recompute the running signature of a macaroon from its root key. Pure. */
function computeSignature(rootKey: Buffer, identifier: string, caveats: Caveat[]): Buffer {
  let sig = hmac(rootKey, Buffer.from(identifier, 'utf8'));
  for (const c of caveats) sig = hmac(sig, caveatBytes(c));
  return sig;
}

/**
 * Mint a fresh macaroon. The `rootKey` must be a high-entropy secret held only
 * by the minter; the returned macaroon carries no copy of it.
 */
export function create(rootKey: Buffer, identifier: string, location: string): Macaroon {
  const sig = hmac(rootKey, Buffer.from(identifier, 'utf8'));
  return { location, identifier, caveats: [], signature: sig.toString('hex') };
}

/**
 * Append a first-party caveat (a predicate the verifier checks locally). Returns
 * a NEW macaroon — attenuation is functional; the input is never mutated. This
 * is the only narrowing operation a holder needs and the chained signature makes
 * it one-directional: you can add `predicate`, never remove one.
 */
export function addFirstPartyCaveat(m: Macaroon, predicate: string): Macaroon {
  const sig = hmac(Buffer.from(m.signature, 'hex'), Buffer.from(predicate, 'utf8'));
  return {
    ...m,
    caveats: [...m.caveats, { cid: predicate }],
    signature: sig.toString('hex'),
  };
}

/**
 * Append a third-party caveat. `caveatKey` becomes the root key of the discharge
 * macaroon the daemon/Relay will mint; `caveatId` is the (already-encrypted, by
 * the caller) opaque id that the discharge service decrypts to learn what to
 * attest. Returns a new macaroon. Only the root minter calls this — it needs
 * `caveatKey` in the clear to seal the vid.
 */
export function addThirdPartyCaveat(
  m: Macaroon,
  caveatKey: Buffer,
  caveatId: string,
  location: string,
): Macaroon {
  const prevSig = Buffer.from(m.signature, 'hex');
  const vid = sealVid(prevSig, caveatKey);
  const cav: Caveat = { cid: caveatId, vid, cl: location };
  const sig = hmac(prevSig, caveatBytes(cav));
  return { ...m, caveats: [...m.caveats, cav], signature: sig.toString('hex') };
}

/**
 * Bind a discharge macaroon to a specific root macaroon, so the discharge cannot
 * be replayed against a different macaroon. Returns a copy of `discharge` with a
 * bound signature. The holder calls this for every discharge before presenting.
 */
export function prepareForRequest(root: Macaroon, discharge: Macaroon): Macaroon {
  const bound = hmac(
    BIND_KEY,
    Buffer.from(root.signature, 'hex'),
    Buffer.from(discharge.signature, 'hex'),
  );
  return { ...discharge, signature: bound.toString('hex') };
}

/** The result of a verification attempt — a verdict plus a machine-readable
 *  reason so callers (the Relay, the guard) can log precisely why a push died. */
export interface VerifyResult {
  ok: boolean;
  reason: string;
}

/**
 * Verify a macaroon. Recomputes the chained signature from `rootKey` hop by hop;
 * at each first-party caveat it calls `checkFirstParty(predicate)`; at each
 * third-party caveat it recovers the sealed discharge key, finds the matching
 * (by identifier) discharge macaroon, and verifies it recursively — requiring
 * the discharge's signature to equal the request-bound value. Finally the
 * recomputed root signature must equal the presented one.
 *
 * `checkFirstParty` returns true iff the predicate holds for the request. It is
 * supplied by the caller (the PD grammar lives in `caveats.ts`) so this core
 * stays predicate-agnostic.
 */
export function verify(
  m: Macaroon,
  rootKey: Buffer,
  discharges: Macaroon[],
  checkFirstParty: (predicate: string) => boolean,
): VerifyResult {
  // Fail-fast on a malformed root signature before any allocation/decode — the
  // top-level macaroon is attacker-controlled input at the gate.
  if (!isValidHex(m.signature, 32)) {
    return { ok: false, reason: 'malformed root signature' };
  }
  const rootBoundSig = Buffer.from(m.signature, 'hex');
  return verifyInner(m, rootKey, discharges, checkFirstParty, rootBoundSig, new Set(), true);
}

function verifyInner(
  m: Macaroon,
  rootKey: Buffer,
  discharges: Macaroon[],
  checkFirstParty: (predicate: string) => boolean,
  rootBoundSig: Buffer,
  seen: Set<string>,
  isRoot: boolean,
): VerifyResult {
  // Fail-closed runtime shape check: a macaroon may arrive from untrusted JSON
  // (a discharge presented at the gate). Never throw on malformed input —
  // return a clean refusal so a hostile payload can't crash the verifier.
  if (
    typeof m.identifier !== 'string' ||
    !Array.isArray(m.caveats) ||
    !isValidHex(m.signature, 32)
  ) {
    return { ok: false, reason: 'malformed macaroon structure' };
  }

  // Loop guard: a discharge that references itself (or a cycle) must not recurse
  // forever. Each macaroon is verified at most once per chain.
  if (seen.has(m.identifier)) {
    return { ok: false, reason: `discharge cycle detected at "${m.identifier}"` };
  }
  seen.add(m.identifier);

  let sig = hmac(rootKey, Buffer.from(m.identifier, 'utf8'));
  for (const c of m.caveats) {
    if (!isWellFormedCaveat(c)) {
      return { ok: false, reason: 'malformed caveat' };
    }
    if (isThirdParty(c)) {
      const caveatKey = openVid(sig, c.vid as string);
      if (!caveatKey) {
        return { ok: false, reason: `third-party caveat vid failed to open for "${c.cid}"` };
      }
      const discharge = discharges.find((d) => d.identifier === c.cid);
      if (!discharge) {
        return { ok: false, reason: `no discharge macaroon for caveat "${c.cid}"` };
      }
      const sub = verifyInner(
        discharge,
        caveatKey,
        discharges,
        checkFirstParty,
        rootBoundSig,
        seen,
        false,
      );
      if (!sub.ok) return sub;
      sig = hmac(sig, caveatBytes(c));
    } else {
      if (!checkFirstParty(c.cid)) {
        return { ok: false, reason: `first-party caveat not satisfied: "${c.cid}"` };
      }
      sig = hmac(sig, caveatBytes(c));
    }
  }

  // The top-level macaroon is checked against its own signature; a discharge is
  // checked against the request-bound value (binding it to this exact root).
  const expected = isRoot ? sig : hmac(BIND_KEY, rootBoundSig, sig);
  if (!timingSafeEqualHex(expected, m.signature)) {
    return { ok: false, reason: `signature mismatch on "${m.identifier}"` };
  }
  return { ok: true, reason: 'verified' };
}

function timingSafeEqualHex(expected: Buffer, presentedHex: string): boolean {
  let presented: Buffer;
  try {
    presented = Buffer.from(presentedHex, 'hex');
  } catch {
    return false;
  }
  if (presented.length !== expected.length) return false;
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ presented[i];
  return diff === 0;
}

/** Serialize to a compact JSON string for transport / storage. */
export function serialize(m: Macaroon): string {
  return JSON.stringify(m);
}

/** Parse a serialized macaroon. Throws on malformed input. */
export function deserialize(s: string): Macaroon {
  const m = JSON.parse(s) as Macaroon;
  if (
    typeof m?.location !== 'string' ||
    typeof m?.identifier !== 'string' ||
    !isValidHex(m?.signature, 32) ||
    !Array.isArray(m?.caveats)
  ) {
    throw new Error('malformed macaroon');
  }
  // Validate every caveat entry — deserialize is the public boundary for
  // untrusted input, so a bad shape must throw here, not surface later in verify.
  for (const c of m.caveats) {
    if (!isWellFormedCaveat(c)) throw new Error('malformed macaroon');
    if (c.vid !== undefined && (!isValidHex(c.vid) || c.vid.length > MAX_VID_HEX)) {
      throw new Error('malformed macaroon');
    }
  }
  return m;
}

/** Re-exported for callers that want to derive the same context type. */
export type { Macaroon, Caveat, RequestContext } from './types.js';
