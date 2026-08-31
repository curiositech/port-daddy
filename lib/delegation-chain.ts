/**
 * Multi-hop Delegation Chain Walker
 *
 * Spec: whitepaper/formal/proverif/anchor/delegation/chain-replay.pv (§3)
 *
 * Each hop signs hopBind(nonce, prev_id, next_id, message_hash).
 * The walker verifies depth-N chains with nonce-freshness tracking,
 * rejecting splices and replays.
 *
 * Reference implementation: lib/merkle-chain.ts (Ed25519 primitives).
 *
 * Mapping from chain-replay.pv to runtime:
 *   hopBind(nonce, id, id, message)  →  hopBindBytes()
 *   id_of_pk(pkey)                   →  bytesToHex(pubKey)
 *   issued_nonce table               →  NonceTable.issued
 *   consumed_nonce table             →  NonceTable.consumed
 *   Principal / HopA / HopB         →  signHop()
 *   HopC_Verifier                    →  verifyDelegationChain()
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import { bytesToHex, hexToBytes } from './merkle-chain.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One hop in a delegation chain. */
export interface DelegationHop {
  nonce: string;       // hex-encoded 16-byte random nonce
  prevId: string;      // hex-encoded Ed25519 public key of the signer (= signer id) — also the verification key
  nextId: string;      // hex-encoded Ed25519 public key of the next agent
  messageHash: string; // hex-encoded SHA-256 of the delegated message
  sig: string;         // hex-encoded Ed25519 signature over hopBind(nonce, prevId, nextId, messageHash)
}

/** Result of verifying a delegation chain. */
export interface DelegationVerifyResult {
  ok: boolean;
  rejectReason?:
    | 'invalid_hop_count'
    | 'principal_mismatch'
    | 'chain_id_mismatch'
    | 'message_hash_mismatch'
    | 'nonce_not_issued'
    | 'nonce_already_consumed'
    | 'sig_verify_failed';
  hopIndex?: number;
}

// ---------------------------------------------------------------------------
// NonceTable
// Mirrors issued_nonce + consumed_nonce tables in chain-replay.pv.
// ---------------------------------------------------------------------------

export class NonceTable {
  private readonly issued = new Set<string>();
  private readonly consumed = new Set<string>();

  issue(nonce: string): void {
    this.issued.add(nonce);
  }

  isIssued(nonce: string): boolean {
    return this.issued.has(nonce);
  }

  isConsumed(nonce: string): boolean {
    return this.consumed.has(nonce);
  }

  consume(nonce: string): void {
    this.consumed.add(nonce);
  }
}

// ---------------------------------------------------------------------------
// hopBind canonical encoding
// Matches: hopBind(nonce, id, id, message) : bitstring [data] in .pv
//
// Domain separation is REQUIRED. The .pv uses a typed constructor [data], so
// the algebraic model rules out collisions with other signed payloads in the
// system. The TS runtime can't lean on type-level discrimination, so the
// signed bytes carry an explicit DST string. Any other signer using shared
// keys + an object shape that happens to match {messageHash, nextId, nonce,
// prevId} would otherwise produce a forged hop sig — confused deputy.
//
// Keys sorted lexicographically for determinism: _dst < messageHash < nextId
// < nonce < prevId. The leading _dst keeps the byte order obviously DST-led
// even before parsing.
// ---------------------------------------------------------------------------

/** Fixed domain-separation tag. Bumping the version is a hard wire-break. */
export const HOP_BIND_DST = 'anchor.delegation.hopBind.v1';

export function hopBindBytes(
  nonce: string,
  prevId: string,
  nextId: string,
  messageHash: string,
): Uint8Array {
  const canonical = JSON.stringify({ _dst: HOP_BIND_DST, messageHash, nextId, nonce, prevId });
  return new TextEncoder().encode(canonical);
}

// ---------------------------------------------------------------------------
// hashMessage: SHA-256 of raw message bytes
// ---------------------------------------------------------------------------

export function hashMessage(message: Uint8Array): string {
  return createHash('sha256').update(message).digest('hex');
}

// ---------------------------------------------------------------------------
// Ed25519 helpers (same DER-wrapping pattern as lib/merkle-chain.ts)
// ---------------------------------------------------------------------------

const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22, 0x04, 0x20,
]);
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function privateKeyFromSeed(seed: Uint8Array) {
  const der = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
  der.set(ED25519_PKCS8_PREFIX);
  der.set(seed, ED25519_PKCS8_PREFIX.length);
  return createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
}

function publicKeyFromRaw(pub: Uint8Array) {
  const der = new Uint8Array(ED25519_SPKI_PREFIX.length + 32);
  der.set(ED25519_SPKI_PREFIX);
  der.set(pub, ED25519_SPKI_PREFIX.length);
  return createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' });
}

function derivePublic(sk: ReturnType<typeof createPrivateKey>): Uint8Array {
  const der = createPublicKey(sk).export({ format: 'der', type: 'spki' }) as Buffer;
  return new Uint8Array(der.subarray(der.length - 32));
}

function ed25519Sign(seed: Uint8Array, msg: Uint8Array): { sig: Uint8Array; pub: Uint8Array } {
  const sk = privateKeyFromSeed(seed);
  const pub = derivePublic(sk);
  const sig = cryptoSign(null, Buffer.from(msg), sk);
  return { sig: new Uint8Array(sig), pub };
}

function ed25519Verify(pubRaw: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  return cryptoVerify(null, Buffer.from(msg), publicKeyFromRaw(pubRaw), Buffer.from(sig));
}

/** Derive agent id (hex-encoded Ed25519 public key) from a 32-byte seed. */
export function agentIdFromSeed(seed: Uint8Array): string {
  const sk = privateKeyFromSeed(seed);
  return bytesToHex(derivePublic(sk));
}

// ---------------------------------------------------------------------------
// signHop
// Corresponds to Principal / HopA / HopB in chain-replay.pv.
// ---------------------------------------------------------------------------

/**
 * Sign one delegation hop.
 *
 * The signer becomes the "previous" agent in the chain.
 * A fresh nonce is generated, recorded in the table, and bound into the signature:
 *   sign(sk, hopBind(nonce, prevId, nextId, messageHash))
 */
export function signHop(
  signerSeed: Uint8Array,
  nextId: string,
  messageHash: string,
  nonceTable: NonceTable,
): DelegationHop {
  if (signerSeed.length !== 32) {
    throw new Error(`signHop: signerSeed must be 32 bytes (got ${signerSeed.length})`);
  }

  const sk = privateKeyFromSeed(signerSeed);
  const pubBytes = derivePublic(sk);
  const prevId = bytesToHex(pubBytes);

  const nonce = bytesToHex(randomBytes(16));
  nonceTable.issue(nonce);

  const msg = hopBindBytes(nonce, prevId, nextId, messageHash);
  const sigBytes = new Uint8Array(cryptoSign(null, Buffer.from(msg), sk));

  return {
    nonce,
    prevId,
    nextId,
    messageHash,
    sig: bytesToHex(sigBytes),
  };
}

// ---------------------------------------------------------------------------
// verifyDelegationChain
// Corresponds to HopC_Verifier in chain-replay.pv.
// ---------------------------------------------------------------------------

/**
 * Verify a delegation chain of depth N.
 *
 * Checks (in order):
 *  1. hop count is non-zero
 *  2. hops[0].prevId === principalId  (principal mismatch)
 *  3. hops[i].nextId === hops[i+1].prevId  (splice detection)
 *  4. hops[last].nextId === finalId  (chain ends at expected recipient)
 *  5. all hops carry the same messageHash  (message substitution)
 *  6. all nonces were issued and not yet consumed  (replay protection)
 *  7. all signatures verify against their respective prevId public keys
 *
 * On success, all nonces are atomically consumed.
 */
export function verifyDelegationChain(
  hops: DelegationHop[],
  principalId: string,
  finalId: string,
  messageHash: string,
  nonceTable: NonceTable,
): DelegationVerifyResult {
  if (hops.length === 0) {
    return { ok: false, rejectReason: 'invalid_hop_count' };
  }

  // Check 2: principal id matches first hop's signer
  if (hops[0].prevId !== principalId) {
    return { ok: false, rejectReason: 'principal_mismatch', hopIndex: 0 };
  }

  // Check 3: chain connectivity — each hop's nextId matches the next hop's prevId
  for (let i = 0; i < hops.length - 1; i++) {
    if (hops[i].nextId !== hops[i + 1].prevId) {
      return { ok: false, rejectReason: 'chain_id_mismatch', hopIndex: i };
    }
  }

  // Check 4: last hop terminates at finalId
  if (hops[hops.length - 1].nextId !== finalId) {
    return { ok: false, rejectReason: 'chain_id_mismatch', hopIndex: hops.length - 1 };
  }

  // Check 5: all hops bind the same message
  for (let i = 0; i < hops.length; i++) {
    if (hops[i].messageHash !== messageHash) {
      return { ok: false, rejectReason: 'message_hash_mismatch', hopIndex: i };
    }
  }

  // Check 6: nonce freshness (issued_nonce + consumed_nonce tables from .pv)
  for (let i = 0; i < hops.length; i++) {
    const { nonce } = hops[i];
    if (!nonceTable.isIssued(nonce)) {
      return { ok: false, rejectReason: 'nonce_not_issued', hopIndex: i };
    }
    if (nonceTable.isConsumed(nonce)) {
      return { ok: false, rejectReason: 'nonce_already_consumed', hopIndex: i };
    }
  }

  // Check 7: signature verification for every hop.
  // Verification key is bound to chain identity: the same prevId that carries
  // chain connectivity is used to verify the hop sig. This is what the .pv's
  // signer ≡ id_of_pk(pk(skP)) constraint enforces algebraically. A previous
  // version had a separate `kid` field which the verifier trusted blindly,
  // allowing an attacker to set prevId = idVictim and kid = idEve and forge
  // a sig under skEve that the verifier would accept as Victim's delegation.
  // Eliminated the redundant field; prevId is now the single source of truth.
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    let pubBytes: Uint8Array;
    let sigBytes: Uint8Array;
    try {
      pubBytes = hexToBytes(hop.prevId);
      sigBytes = hexToBytes(hop.sig);
    } catch {
      return { ok: false, rejectReason: 'sig_verify_failed', hopIndex: i };
    }
    if (pubBytes.length !== 32 || sigBytes.length !== 64) {
      return { ok: false, rejectReason: 'sig_verify_failed', hopIndex: i };
    }

    const msg = hopBindBytes(hop.nonce, hop.prevId, hop.nextId, hop.messageHash);
    let valid: boolean;
    try {
      valid = ed25519Verify(pubBytes, msg, sigBytes);
    } catch {
      return { ok: false, rejectReason: 'sig_verify_failed', hopIndex: i };
    }
    if (!valid) {
      return { ok: false, rejectReason: 'sig_verify_failed', hopIndex: i };
    }
  }

  // All checks passed — atomically consume all nonces (insert consumed_nonce)
  for (const hop of hops) {
    nonceTable.consume(hop.nonce);
  }

  return { ok: true };
}
