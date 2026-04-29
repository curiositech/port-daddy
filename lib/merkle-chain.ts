/**
 * Per-Publisher Merkle Event Chain (Track B2)
 *
 * Pure-function library implementing the per-publisher event chain
 * defined in skills/pd-relay-zero-trust/references/merkle-chain-design.md.
 *
 * Provides:
 *   - tamper-evidence (any rewrite of past events breaks the chain)
 *   - non-equivocation (publisher cannot privately fork its history)
 *   - order proof (publisher's intended sequence is committed)
 *   - external anchorability (signed heads can be committed to DNS, git, etc)
 *
 * What this module does NOT do:
 *   - I/O of any kind (no DB, no network, no process). Pure functions.
 *   - daemon coordination or relay protocol — see lib/relay-store.ts
 *
 * Cross-language compatibility:
 *   These functions must produce byte-for-byte identical output to the Python
 *   reference scripts in skills/pd-relay-zero-trust/scripts/. See
 *   docs/merkle-chain-compat.md for the contract.
 *
 * Hash algorithm: SHA-256 (Node's built-in crypto, no extra dep).
 * Signature algorithm: Ed25519 (Node's built-in crypto; raw 32-byte seed +
 * raw 32-byte public key + raw 64-byte signature; transported as hex).
 */

import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

export const ZERO_HASH = '0'.repeat(64);

/** Encrypted payload as it appears on the wire. The relay never decrypts. */
export interface Ciphertext {
  alg: 'AES-256-GCM';
  iv: string;
  ct: string;
  tag: string;
  wrap: string;
  // Tolerate extra keys in canonical-json hashing. Schema enforces strictness elsewhere.
  [extra: string]: unknown;
}

/**
 * One event as the relay sees it (matches event-envelope.schema.json).
 *
 * Field order in the type does not matter; canonical hashing uses only the
 * subset documented in merkle-chain-design.md and sorts JSON keys for
 * `ciphertext`.
 */
export interface ChainEntry {
  v: 1;
  sender: string;
  channel: string;
  seq: number;
  prev_hash: string;
  this_hash: string;
  iat: number;
  ciphertext: Ciphertext;
  alg: 'EdDSA';
  sig: string;
  kid: string;
  // Optional fields tolerated for forward-compat (e.g., harbor card).
  [extra: string]: unknown;
}

/** Result of walking a chain. Mirrors chain_verify.py's response shape. */
export interface ChainBreak {
  seq: number;
  reason:
    | 'sender_mismatch'
    | 'seq_gap'
    | 'prev_hash_mismatch'
    | 'this_hash_mismatch';
  expected: string;
  got: string;
}

export interface VerifyResult {
  ok: boolean;
  events_walked: number;
  first_break: ChainBreak | null;
  tip_seq: number;
  tip_hash: string;
}

/** Inputs for sign_head. `channel === null` means whole-publisher scope. */
export interface ChainHeadAnchor {
  kind:
    | 'dns-txt'
    | 'git-commit'
    | 'transparency-log'
    | 'blockchain'
    | 'tweet'
    | 'rfc8785-jws';
  ref: string;
  anchored_at?: number;
}

export interface ChainHeadInput {
  sender: string;
  channel: string | null;
  tip_seq: number;
  tip_hash: string;
  issued_at: number;
  anchors?: ChainHeadAnchor[];
}

/** A signed chain head as defined in merkle-chain-head.schema.json. */
export interface SignedChainHead {
  v: 1;
  sender: string;
  channel: string | null;
  tip_seq: number;
  tip_hash: string;
  issued_at: number;
  anchors: ChainHeadAnchor[];
  alg: 'EdDSA';
  sig: string; // hex-encoded raw 64-byte Ed25519 signature
  kid: string; // hex-encoded raw 32-byte Ed25519 public key
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/**
 * RFC 8785-ish canonical JSON, byte-for-byte compatible with
 * `skills/pd-relay-zero-trust/scripts/_envelope.py:canonical_json`:
 *
 *   - object keys sorted lexicographically (Unicode code point order, which
 *     matches Python's `sort_keys=True` for the strings we use)
 *   - separators (",", ":") — no whitespace
 *   - non-ASCII characters emitted verbatim (matches `ensure_ascii=False`)
 *   - integer numbers emitted via JSON.stringify (matches Python for ints)
 *
 * IMPORTANT: this canonicalizer does not normalize floats, NaN, ±Infinity, or
 * BigInt because the schemas above only carry strings, ints, and small object
 * shapes. If the schema gains floats, revisit number formatting carefully.
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalJson: non-finite number not allowed (${value})`);
    }
    // For integers this matches Python's `json.dumps(int)`. For non-integers
    // we mirror JSON.stringify, which is correct for the schemas we use today
    // but — like the Python side — is not RFC 8785-strict for floats.
    return Number.isInteger(value) ? value.toFixed(0) : JSON.stringify(value);
  }

  if (typeof value === 'string') {
    // JSON.stringify gives a JSON string literal with proper escapes.
    // Python's json.dumps(..., ensure_ascii=False) emits the same escapes for
    // the control characters and quote/backslash that JSON requires, and
    // leaves non-ASCII alone — which is what JSON.stringify also does.
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(); // lexicographic on UTF-16 code units
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(JSON.stringify(k) + ':' + canonicalize(obj[k]));
    }
    return '{' + parts.join(',') + '}';
  }

  if (typeof value === 'undefined') {
    throw new Error('canonicalJson: undefined is not representable in JSON');
  }
  if (typeof value === 'bigint') {
    // Could be supported, but the Python side uses ints only. Refuse rather
    // than silently produce mismatched output.
    throw new Error('canonicalJson: bigint is not supported');
  }

  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

// ---------------------------------------------------------------------------
// next_hash
// ---------------------------------------------------------------------------

/**
 * Compute `this_hash` for a single event, per the design doc.
 *
 *   this_hash = SHA256(prev_hash || sender || channel || seq || iat || canonical_json(ciphertext))
 *
 * Matches `chain_verify.py:hash_event` exactly. All operands are encoded as
 * UTF-8 strings; integers are stringified in base 10.
 *
 * The two-arg form `next_hash(prev_hash, event)` matches the master-plan
 * deliverable signature: pass either the full event object or its
 * canonical-JSON serialization. The full-form `next_hash_fields` is the
 * underlying primitive.
 */
export function next_hash(
  prev_hash: string,
  event: Uint8Array | string | ChainEntry,
): string {
  if (typeof event === 'string') {
    return sha256Hex(utf8(prev_hash + event));
  }
  if (event instanceof Uint8Array) {
    const h = createHash('sha256');
    h.update(utf8(prev_hash));
    h.update(event);
    return h.digest('hex');
  }
  // Full envelope: hash with the structured fields per design.
  return next_hash_fields({
    prev_hash,
    sender: event.sender,
    channel: event.channel,
    seq: event.seq,
    iat: event.iat,
    ciphertext: event.ciphertext,
  });
}

/** Structured hash inputs for an event chain entry. */
export interface NextHashFields {
  prev_hash: string;
  sender: string;
  channel: string;
  seq: number;
  iat: number;
  ciphertext: Ciphertext | Record<string, unknown>;
}

export function next_hash_fields(f: NextHashFields): string {
  const h = createHash('sha256');
  h.update(utf8(f.prev_hash));
  h.update(utf8(f.sender));
  h.update(utf8(f.channel));
  h.update(utf8(String(f.seq)));
  h.update(utf8(String(f.iat)));
  h.update(utf8(canonicalJson(f.ciphertext)));
  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// verify_chain
// ---------------------------------------------------------------------------

export interface VerifyChainOptions {
  expected_sender?: string;
  starting_prev_hash?: string;
}

/**
 * Walk an ordered list of events and report the first break, if any.
 *
 * Mirrors `chain_verify.py:handle` — same ordering of checks, same break
 * `reason` strings, same response shape. Two TS-produced or Python-produced
 * outputs over the same inputs are byte-comparable (modulo JSON key order,
 * which the Python script also does not control).
 */
export function verify_chain(
  events: ChainEntry[],
  options: VerifyChainOptions = {},
): VerifyResult {
  const expected_sender = options.expected_sender;
  const starting = options.starting_prev_hash ?? ZERO_HASH;

  let last_seq = -1;
  let last_hash = starting;
  let walked = 0;

  for (const evt of events) {
    const seq = evt.seq;

    if (expected_sender && evt.sender !== expected_sender) {
      return {
        ok: false,
        events_walked: walked,
        first_break: {
          seq,
          reason: 'sender_mismatch',
          expected: expected_sender,
          got: evt.sender,
        },
        tip_seq: last_seq,
        tip_hash: last_hash,
      };
    }

    if (seq !== last_seq + 1) {
      return {
        ok: false,
        events_walked: walked,
        first_break: {
          seq,
          reason: 'seq_gap',
          expected: String(last_seq + 1),
          got: String(seq),
        },
        tip_seq: last_seq,
        tip_hash: last_hash,
      };
    }

    if (evt.prev_hash !== last_hash) {
      return {
        ok: false,
        events_walked: walked,
        first_break: {
          seq,
          reason: 'prev_hash_mismatch',
          expected: last_hash,
          got: evt.prev_hash,
        },
        tip_seq: last_seq,
        tip_hash: last_hash,
      };
    }

    const recomputed = next_hash_fields({
      prev_hash: evt.prev_hash,
      sender: evt.sender,
      channel: evt.channel,
      seq: evt.seq,
      iat: evt.iat,
      ciphertext: evt.ciphertext,
    });

    if (recomputed !== evt.this_hash) {
      return {
        ok: false,
        events_walked: walked,
        first_break: {
          seq,
          reason: 'this_hash_mismatch',
          expected: recomputed,
          got: evt.this_hash,
        },
        tip_seq: last_seq,
        tip_hash: last_hash,
      };
    }

    last_seq = seq;
    last_hash = evt.this_hash;
    walked += 1;
  }

  return {
    ok: true,
    events_walked: walked,
    first_break: null,
    tip_seq: last_seq,
    tip_hash: last_hash,
  };
}

// ---------------------------------------------------------------------------
// sign_head / verify_head
// ---------------------------------------------------------------------------

/**
 * Build the canonical bytes that get signed for a chain head.
 *
 * Matches `chain_anchor.py:head_message`: canonical_json over
 * { v, sender, channel, tip_seq, tip_hash, issued_at, anchors }.
 */
export function head_message(input: ChainHeadInput): Uint8Array {
  const payload = {
    v: 1,
    sender: input.sender,
    channel: input.channel ?? null,
    tip_seq: input.tip_seq,
    tip_hash: input.tip_hash,
    issued_at: input.issued_at,
    anchors: input.anchors ?? [],
  };
  return utf8(canonicalJson(payload));
}

/**
 * Sign a chain head with a 32-byte Ed25519 seed.
 *
 * The output's `kid` is the raw public key, hex-encoded. The output's `sig`
 * is the raw 64-byte Ed25519 signature, hex-encoded. This matches the Python
 * reference's serialization byte-for-byte.
 */
export function sign_head(
  head: ChainHeadInput,
  signing_key: Uint8Array,
): SignedChainHead {
  if (signing_key.length !== 32) {
    throw new Error(
      `sign_head: signing_key must be a 32-byte Ed25519 seed (got ${signing_key.length})`,
    );
  }

  const msg = head_message(head);
  const { sig, pub } = ed25519Sign(signing_key, msg);

  return {
    v: 1,
    sender: head.sender,
    channel: head.channel ?? null,
    tip_seq: head.tip_seq,
    tip_hash: head.tip_hash,
    issued_at: head.issued_at,
    anchors: head.anchors ?? [],
    alg: 'EdDSA',
    sig: bytesToHex(sig),
    kid: bytesToHex(pub),
  };
}

/**
 * Verify a signed chain head against a 32-byte Ed25519 public key.
 *
 * Returns true iff the canonical head bytes verify under the supplied key
 * AND the head's payload fields match the message that was signed (i.e. the
 * head wasn't mutated post-signature). Returns false on any algorithm
 * mismatch, length mismatch, or signature failure.
 */
export function verify_head(
  signed_head: SignedChainHead,
  pub_key: Uint8Array,
): boolean {
  if (signed_head.alg !== 'EdDSA') return false;
  if (pub_key.length !== 32) return false;

  let sig: Uint8Array;
  try {
    sig = hexToBytes(signed_head.sig);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;

  const msg = head_message({
    sender: signed_head.sender,
    channel: signed_head.channel,
    tip_seq: signed_head.tip_seq,
    tip_hash: signed_head.tip_hash,
    issued_at: signed_head.issued_at,
    anchors: signed_head.anchors,
  });

  try {
    return ed25519Verify(pub_key, msg, sig);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function bytesToHex(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i++) {
    out += b[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string (${hex.length})`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hexToBytes: invalid hex at byte ${i}`);
    }
    out[i] = byte;
  }
  return out;
}

// Ed25519 SPKI/PKCS8 ASN.1 prefixes — Node's KeyObject only takes DER, not raw
// bytes, so we wrap the raw 32-byte material in the canonical headers.
const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22, 0x04, 0x20,
]);
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function ed25519PrivateKeyFromSeed(seed: Uint8Array) {
  const der = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
  der.set(ED25519_PKCS8_PREFIX, 0);
  der.set(seed, ED25519_PKCS8_PREFIX.length);
  return createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
}

function ed25519PublicKeyFromRaw(pub: Uint8Array) {
  const der = new Uint8Array(ED25519_SPKI_PREFIX.length + 32);
  der.set(ED25519_SPKI_PREFIX, 0);
  der.set(pub, ED25519_SPKI_PREFIX.length);
  return createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' });
}

function ed25519DerivePublic(privateKeyObj: ReturnType<typeof createPrivateKey>): Uint8Array {
  const pubObj = createPublicKey(privateKeyObj);
  // SPKI export = SPKI prefix (12 bytes) + 32-byte raw public key
  const der = pubObj.export({ format: 'der', type: 'spki' }) as Buffer;
  return new Uint8Array(der.subarray(der.length - 32));
}

function ed25519Sign(seed: Uint8Array, msg: Uint8Array): { sig: Uint8Array; pub: Uint8Array } {
  const sk = ed25519PrivateKeyFromSeed(seed);
  const pub = ed25519DerivePublic(sk);
  const sig = cryptoSign(null, Buffer.from(msg), sk);
  return { sig: new Uint8Array(sig), pub };
}

function ed25519Verify(pub: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  const pk = ed25519PublicKeyFromRaw(pub);
  return cryptoVerify(null, Buffer.from(msg), pk, Buffer.from(sig));
}
