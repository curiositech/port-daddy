/**
 * pd-vault reference seal — pure-TS twin of the Rust kernel crate (ADR-0120).
 *
 * WHY THIS FILE EXISTS. The canonical vault implementation is the Rust crate
 * `core/kernel/pd-vault` (harbor secret → HKDF-SHA256 channel keys →
 * XChaCha20-Poly1305 sealed payloads, context bound into the AEAD tag). The
 * daemon's seal path (A3) needs those exact bytes today, before the Rust FFI
 * boundary for pd-vault exists. ADR-0120 permits a second implementation of
 * kernel logic under one condition: a shared test-vector fixture, generated
 * from the canonical implementation, asserted by both suites. That fixture is
 * `tests/fixtures/pd-vault-parity-vectors.json` (copied from pd-vault's
 * known-answer constants), and `tests/unit/pd-vault-ts-parity.test.ts` holds
 * this file to it. If this module and the crate ever disagree, the fixture
 * makes the disagreement a red test instead of a silent key/ciphertext fork.
 *
 * DESIGN: the whole surface hides behind the narrow {@link VaultSealProvider}
 * interface, and every consumer (the relay-seal chokepoint) takes the provider
 * as a dependency defaulting to {@link referenceVault}. The intent is that the
 * pd-vault Rust FFI replaces the default without a single call-site change —
 * swap the provider, keep the interface, rerun the same parity vectors.
 *
 * CRYPTO SHAPE (mirrors pd-vault exactly; do not "improve" one side alone):
 *   - unambiguousEncoding: u32_be(count) || (u32_be(len) || bytes)* — the one
 *     anti-ambiguity primitive both the KDF info string and the AEAD
 *     associated data go through. Purpose: `("a", 11)` and `("a1", 1)` must
 *     never share an encoding, or two channels silently share a key.
 *   - deriveChannelKey: HKDF-SHA256, salt = CHANNEL_KEY_LABEL, info =
 *     unambiguousEncoding([label, channel_id, u64_be(epoch)]).
 *   - seal/open: XChaCha20-Poly1305. Node's crypto has the IETF 12-byte-nonce
 *     `chacha20-poly1305` but not the X variant, so the 24-byte nonce is
 *     handled the standard way (draft-irtf-cfrg-xchacha §2): HChaCha20 over
 *     nonce[0..16] derives a subkey, then IETF ChaCha20-Poly1305 runs with
 *     nonce = 4 zero bytes || nonce[16..24]. HChaCha20 is the only primitive
 *     implemented by hand here, and it is pinned transitively by the fixture's
 *     ciphertext vector — a wrong rotation or missing round cannot reproduce
 *     the known answer.
 *
 * FAILURE POSTURE (same as the crate): decryption failure is one opaque error
 * with one message. Wrong key, tampered tag, tampered AAD, cross-channel
 * splice, truncation — indistinguishable on purpose, because a decryption
 * routine that explains which check failed is an oracle. Errors about the
 * caller's own arguments (empty ids, short secrets) stay explicit: those are
 * programming mistakes, not attacker probes.
 *
 * KEY WRAP (RFC 9180 / ADR-0123 A4-B3). A second, independent capability
 * lives lower in this file: wrapChannelKeyForDevice/unwrapChannelKeyForDevice,
 * an HPKE base-mode envelope that seals a channel key to one recipient
 * device's X25519 public key for the join-time / rotation key-distribution
 * channel. It answers a different question than the seal/open pipeline above
 * ("who may receive this key" vs. "who may read this payload"), so it is not
 * on the VaultSealProvider seam. Its own section below carries the full
 * design note; the short version is the same contract as everything else in
 * this file — RFC 9180's own official test vectors pin the primitives, a
 * self-generated KAT pins the wrap/unwrap composition against regression,
 * and open failure is the same one opaque error as XChaCha20-Poly1305's.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

/** Domain-separation label for channel key derivation (pd-vault kdf.rs). */
export const CHANNEL_KEY_LABEL = 'pd-vault/v1/channel';
/** Domain-separation label for sealed-payload associated data (pd-vault seal.rs). */
export const SEAL_AAD_LABEL = 'pd-vault/v1/seal';
/** Length of a derived channel key, in bytes. */
export const CHANNEL_KEY_LEN = 32;
/** XChaCha20-Poly1305 nonce length, in bytes. */
export const NONCE_LEN = 24;
/** Poly1305 tag length, in bytes — sealed output is plaintext length + this. */
export const TAG_LEN = 16;
/** Shortest accepted harbor secret; shorter input keying material is refused, never stretched. */
export const MIN_HARBOR_SECRET_LEN = 32;

/**
 * Every way a vault operation can fail, with the same code taxonomy as the
 * Rust crate's VaultError.
 *
 * Design note on `DECRYPT`: it is deliberately the ONLY decryption-failure
 * code and always carries the message "decryption failed" — see the module
 * docs for why an explanatory decrypt error would be an oracle.
 */
export class VaultTsError extends Error {
  /**
   * @param code Stable machine-readable failure class (mirrors pd-vault's VaultError variants).
   * @param message Human-readable detail; constant for DECRYPT by design.
   */
  constructor(
    public readonly code:
      | 'WEAK_HARBOR_SECRET'
      | 'EMPTY_COMPONENT'
      | 'COMPONENT_TOO_LONG'
      | 'BAD_KEY'
      | 'BAD_NONCE'
      | 'BAD_U64'
      | 'SEAL'
      | 'DECRYPT',
    message: string
  ) {
    super(message);
    this.name = 'VaultTsError';
  }
}

/**
 * The single opaque decryption failure — one shape, one message, by design
 * (the why lives in the module docs: a decrypt error that explains itself is
 * an oracle).
 *
 * @returns The DECRYPT VaultTsError every decryption failure throws.
 */
function decryptFailure(): VaultTsError {
  return new VaultTsError('DECRYPT', 'decryption failed');
}

/**
 * The context a sealed payload is bound to (pd-vault SealAad). Every field is
 * authenticated by the Poly1305 tag: opening with any field changed fails,
 * which is what turns a cross-channel / cross-epoch / cross-seq replay into a
 * decryption failure instead of a successful cross-context read.
 */
export interface SealAad {
  /** The harbor that owns the channel. */
  harborId: string;
  /** The channel the payload belongs to. */
  channelId: string;
  /** The key epoch in force when the payload was sealed. */
  epoch: number;
  /** The payload's position in the channel — binding it stops within-channel replay. */
  seq: number;
}

/**
 * Encode a non-negative integer as the 8-byte big-endian u64 the Rust side
 * uses for epoch/seq. Why the strictness: a fractional or negative or
 * out-of-range value silently truncated here would derive a *valid-looking*
 * key or AAD for a context that does not exist, so the encoding refuses
 * instead.
 *
 * @param value Integer in [0, 2^53) — JS safe-integer range; pd-vault's u64 upper range is unreachable from JSON anyway.
 * @param field Name used in the thrown error.
 * @returns 8-byte big-endian buffer.
 */
function u64be(value: number, field: string): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VaultTsError('BAD_U64', `${field} must be a non-negative safe integer`);
  }
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(value));
  return out;
}

/**
 * Encode a component list so no two distinct lists share an encoding
 * (pd-vault `unambiguous_encoding`, byte-identical).
 *
 * Layout: `u32_be(count) || for each component: u32_be(len) || bytes`.
 *
 * WHY: the interesting KDF/AAD failure is never the hash, it is the encoding.
 * Naive concatenation makes ("a", 11) and ("a1", 1) collide, so two channels
 * derive one key and no per-channel test ever notices. Length-prefixing every
 * component (and the count) makes the encoding prefix-free with no reserved
 * separator byte, so channel ids may contain any byte — `/`, `|`, `\0` —
 * without ambiguity.
 *
 * @param components Ordered component byte strings.
 * @returns The injective encoding as a Buffer.
 */
export function unambiguousEncoding(components: readonly Uint8Array[]): Buffer {
  const MAX = 0xffff_ffff;
  if (components.length > MAX) {
    throw new VaultTsError('COMPONENT_TOO_LONG', 'component list exceeds the 32-bit count field');
  }
  const parts: Buffer[] = [];
  const count = Buffer.alloc(4);
  count.writeUInt32BE(components.length);
  parts.push(count);
  for (const component of components) {
    if (component.length > MAX) {
      throw new VaultTsError('COMPONENT_TOO_LONG', 'binding component exceeds the encoding length limit');
    }
    const len = Buffer.alloc(4);
    len.writeUInt32BE(component.length);
    parts.push(len, Buffer.from(component));
  }
  return Buffer.concat(parts);
}

/**
 * UTF-8 encode a label/id string for the encoding primitives. A named helper
 * on purpose: every byte fed to the KDF/AAD encodings goes through one
 * spelling of the string-to-bytes step, so the two paths cannot diverge.
 *
 * @param s The string to encode.
 * @returns Its UTF-8 bytes.
 */
const utf8 = (s: string): Buffer => Buffer.from(s, 'utf8');

/**
 * The canonical AAD byte encoding for a sealed payload (pd-vault
 * `SealAad::encode`, byte-identical — the parity fixture pins it).
 *
 * Purpose: the associated data is what welds a ciphertext to the place it was
 * sealed for. It travels unencrypted (the relay routes on this metadata) but
 * authenticated — change any coordinate and the tag stops verifying.
 *
 * @param aad Harbor/channel/epoch/seq coordinates; harbor and channel must be non-empty.
 * @returns The encoded associated data.
 */
export function encodeSealAad(aad: SealAad): Buffer {
  if (aad.harborId.length === 0) {
    throw new VaultTsError('EMPTY_COMPONENT', 'empty harbor id');
  }
  if (aad.channelId.length === 0) {
    throw new VaultTsError('EMPTY_COMPONENT', 'empty channel id');
  }
  return unambiguousEncoding([
    utf8(SEAL_AAD_LABEL),
    utf8(aad.harborId),
    utf8(aad.channelId),
    u64be(aad.epoch, 'epoch'),
    u64be(aad.seq, 'seq'),
  ]);
}

/**
 * Derive the key for one (channel, epoch) pair from a harbor secret
 * (pd-vault `derive_channel_key`, byte-identical).
 *
 * Pure function by design — same inputs, same key, on any machine, forever;
 * nothing is stored. Rotation is "increment the epoch": forward gives an
 * unrelated key, backward stays derivable so archived ciphertext still opens.
 * (Honest scope, same as the crate: that is blast-radius limiting for a
 * leaked channel key, not forward secrecy for the harbor secret.)
 *
 * @param harborSecret Input keying material, at least {@link MIN_HARBOR_SECRET_LEN} bytes.
 * @param channelId Non-empty channel identifier bound into the derivation.
 * @param epoch Non-negative key epoch counter.
 * @returns The 32-byte channel key.
 */
export function deriveChannelKey(
  harborSecret: Uint8Array,
  channelId: string,
  epoch: number
): Buffer {
  if (harborSecret.length < MIN_HARBOR_SECRET_LEN) {
    throw new VaultTsError(
      'WEAK_HARBOR_SECRET',
      `harbor secret too short: ${harborSecret.length} bytes, minimum ${MIN_HARBOR_SECRET_LEN}`
    );
  }
  if (channelId.length === 0) {
    throw new VaultTsError('EMPTY_COMPONENT', 'empty channel id');
  }
  const info = unambiguousEncoding([utf8(CHANNEL_KEY_LABEL), utf8(channelId), u64be(epoch, 'epoch')]);
  const okm = hkdfSync('sha256', harborSecret, utf8(CHANNEL_KEY_LABEL), info, CHANNEL_KEY_LEN);
  return Buffer.from(okm);
}

// ── HChaCha20 ────────────────────────────────────────────────────────────────

/**
 * The ChaCha20 quarter round, in place on the state array.
 *
 * Why `>>> 0` everywhere: JS bitwise ops work on signed 32-bit ints; the
 * unsigned coercion keeps the additions mod 2^32 like the reference.
 *
 * @param s The 16-word ChaCha state, mutated in place.
 * @param a First word index of the round.
 * @param b Second word index.
 * @param c Third word index.
 * @param d Fourth word index.
 * @returns Nothing — the state array is the output.
 */
function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0; s[d] ^= s[a]; s[d] = ((s[d] << 16) | (s[d] >>> 16)) >>> 0;
  s[c] = (s[c] + s[d]) >>> 0; s[b] ^= s[c]; s[b] = ((s[b] << 12) | (s[b] >>> 20)) >>> 0;
  s[a] = (s[a] + s[b]) >>> 0; s[d] ^= s[a]; s[d] = ((s[d] << 8) | (s[d] >>> 24)) >>> 0;
  s[c] = (s[c] + s[d]) >>> 0; s[b] ^= s[c]; s[b] = ((s[b] << 7) | (s[b] >>> 25)) >>> 0;
}

/**
 * HChaCha20 (draft-irtf-cfrg-xchacha §2.2): derive a 32-byte subkey from a
 * 32-byte key and the first 16 bytes of an extended nonce.
 *
 * Design/motivation: this is the standard bridge from XChaCha20's 24-byte
 * nonce to the IETF ChaCha20-Poly1305 Node already ships — the ONLY primitive
 * this module implements by hand rather than delegating to node:crypto. It is
 * the ChaCha20 block function's 20 rounds WITHOUT the final feed-forward
 * addition, returning words 0..3 and 12..15. Correctness is not taken on
 * faith: the parity fixture's sealed-ciphertext vector cannot be reproduced
 * by a wrong HChaCha20, and the unit suite additionally pins the RFC draft's
 * own HChaCha20 test vector.
 *
 * @param key 32-byte key.
 * @param nonce16 First 16 bytes of the 24-byte XChaCha20 nonce.
 * @returns The 32-byte subkey.
 */
export function hchacha20(key: Uint8Array, nonce16: Uint8Array): Buffer {
  if (key.length !== 32) throw new VaultTsError('BAD_KEY', 'hchacha20 key must be 32 bytes');
  if (nonce16.length !== 16) throw new VaultTsError('BAD_NONCE', 'hchacha20 nonce must be 16 bytes');

  const state = new Uint32Array(16);
  // "expand 32-byte k" constants.
  state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;
  const keyView = new DataView(key.buffer, key.byteOffset, key.byteLength);
  for (let i = 0; i < 8; i++) state[4 + i] = keyView.getUint32(i * 4, true);
  const nonceView = new DataView(nonce16.buffer, nonce16.byteOffset, nonce16.byteLength);
  for (let i = 0; i < 4; i++) state[12 + i] = nonceView.getUint32(i * 4, true);

  for (let round = 0; round < 10; round++) {
    quarterRound(state, 0, 4, 8, 12);
    quarterRound(state, 1, 5, 9, 13);
    quarterRound(state, 2, 6, 10, 14);
    quarterRound(state, 3, 7, 11, 15);
    quarterRound(state, 0, 5, 10, 15);
    quarterRound(state, 1, 6, 11, 12);
    quarterRound(state, 2, 7, 8, 13);
    quarterRound(state, 3, 4, 9, 14);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeUInt32LE(state[i], i * 4);
  for (let i = 0; i < 4; i++) out.writeUInt32LE(state[12 + i], 16 + i * 4);
  return out;
}

/**
 * Split a 24-byte XChaCha20 nonce into the HChaCha20 input and the 12-byte
 * IETF nonce (4 zero bytes || last 8 nonce bytes) per draft-irtf-cfrg-xchacha.
 *
 * Why a helper: seal and open must agree on this split exactly; writing it
 * once removes the chance of the two paths diverging.
 *
 * @param nonce The 24-byte XChaCha20 nonce.
 * @returns The HChaCha20 input (first 16 bytes) and the derived 12-byte IETF nonce.
 */
function splitXNonce(nonce: Uint8Array): { hNonce: Uint8Array; ietfNonce: Buffer } {
  if (nonce.length !== NONCE_LEN) {
    throw new VaultTsError('BAD_NONCE', `nonce must be ${NONCE_LEN} bytes`);
  }
  const ietfNonce = Buffer.alloc(12);
  Buffer.from(nonce.subarray(16)).copy(ietfNonce, 4);
  return { hNonce: nonce.subarray(0, 16), ietfNonce };
}

/**
 * Seal a plaintext under a channel key, bound to its context (pd-vault
 * `seal`, byte-identical output).
 *
 * Design note on the nonce: it must be unique for the lifetime of the key;
 * {@link randomNonce} is the intended source (24 random bytes need no counter and no durable
 * state — the whole reason pd-vault picked XChaCha20 over the 12-byte-nonce
 * variant).
 *
 * @param key 32-byte channel key from {@link deriveChannelKey}.
 * @param nonce 24-byte unique nonce.
 * @param plaintext Bytes to seal.
 * @param aad Context coordinates authenticated into the tag.
 * @returns Ciphertext with the 16-byte Poly1305 tag appended.
 */
export function seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: SealAad): Buffer {
  if (key.length !== CHANNEL_KEY_LEN) {
    throw new VaultTsError('BAD_KEY', `key must be ${CHANNEL_KEY_LEN} bytes`);
  }
  const associatedData = encodeSealAad(aad);
  const { hNonce, ietfNonce } = splitXNonce(nonce);
  const subkey = hchacha20(key, hNonce);
  try {
    const cipher = createCipheriv('chacha20-poly1305', subkey, ietfNonce, { authTagLength: TAG_LEN });
    cipher.setAAD(associatedData, { plaintextLength: plaintext.length });
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([body, cipher.getAuthTag()]);
  } catch {
    throw new VaultTsError('SEAL', 'sealing failed');
  }
}

/**
 * Open a ciphertext produced by {@link seal}, or fail (pd-vault `open`).
 *
 * Succeeds only when key, nonce, and every AAD coordinate match what sealed
 * it. FAILURE IS OPAQUE ON PURPOSE: wrong key, tampered bytes, tampered AAD,
 * cross-channel/epoch/seq replay, and truncation all throw the identical
 * DECRYPT error with the identical message — a decrypt path that names which
 * check failed is an oracle (see module docs). Structural errors about the
 * caller's own AAD arguments stay explicit.
 *
 * @param key 32-byte channel key.
 * @param nonce The 24-byte nonce the payload was sealed with.
 * @param ciphertext Sealed bytes (body || tag).
 * @param aad The exact context coordinates used at seal time.
 * @returns The recovered plaintext.
 */
export function open(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: SealAad): Buffer {
  if (key.length !== CHANNEL_KEY_LEN) {
    throw new VaultTsError('BAD_KEY', `key must be ${CHANNEL_KEY_LEN} bytes`);
  }
  const associatedData = encodeSealAad(aad);
  // A short input cannot carry a tag; reported as the same opaque failure as a
  // bad tag on purpose — "too short" would tell a prober where the tag boundary is.
  if (ciphertext.length < TAG_LEN) throw decryptFailure();
  const { hNonce, ietfNonce } = splitXNonce(nonce);
  const subkey = hchacha20(key, hNonce);
  try {
    const decipher = createDecipheriv('chacha20-poly1305', subkey, ietfNonce, { authTagLength: TAG_LEN });
    decipher.setAAD(associatedData, {
      plaintextLength: ciphertext.length - TAG_LEN,
    });
    decipher.setAuthTag(Buffer.from(ciphertext.subarray(ciphertext.length - TAG_LEN)));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext.subarray(0, ciphertext.length - TAG_LEN))),
      decipher.final(),
    ]);
  } catch {
    throw decryptFailure();
  }
}

/**
 * Draw a fresh 24-byte nonce from the OS CSPRNG.
 *
 * Why random is enough here: at 24 bytes the birthday bound stays negligible
 * past any realistic message volume, so no counter and no durable state — a
 * restore-from-backup cannot resurrect a used nonce, which is the failure the
 * 12-byte variant invites.
 *
 * @returns 24 random bytes.
 */
export function randomNonce(): Buffer {
  return randomBytes(NONCE_LEN);
}

/**
 * The narrow seam the Rust FFI replaces later.
 *
 * Design intent: consumers (the relay-seal chokepoint) depend on THIS
 * interface, never on the module functions directly, so swapping the
 * reference implementation for pd-vault-over-FFI is a provider substitution
 * with zero call-site changes — the same parity fixture then gates both.
 */
export interface VaultSealProvider {
  /** See {@link deriveChannelKey}. */
  deriveChannelKey(harborSecret: Uint8Array, channelId: string, epoch: number): Buffer;
  /** See {@link seal}. */
  seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: SealAad): Buffer;
  /** See {@link open}. */
  open(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: SealAad): Buffer;
  /** See {@link randomNonce}. */
  randomNonce(): Buffer;
}

/**
 * The pure-TS reference provider — today's default implementation of
 * {@link VaultSealProvider}, held to the pd-vault parity fixture by
 * tests/unit/pd-vault-ts-parity.test.ts.
 */
export const referenceVault: VaultSealProvider = Object.freeze({
  deriveChannelKey,
  seal,
  open,
  randomNonce,
});

// ── HPKE base-mode key wrap (RFC 9180 / ADR-0123 A4-B3) ─────────────────────

/**
 * RFC 9180 HPKE, base mode, ciphersuite DHKEM(X25519, HKDF-SHA256) /
 * HKDF-SHA256 / AES-256-GCM — used ONLY for wrapping a channel key to one
 * recipient device's X25519 public key at join time or key rotation
 * (ADR-0123 A4/B3). Everything above this line is the existing A3 seal
 * pipeline (harbor secret -> channel key -> XChaCha20-Poly1305 payload);
 * this is a second, independent primitive answering a different question —
 * not "who may read this payload" but "who may receive this key" — so it
 * does not implement VaultSealProvider and is not on that seam.
 *
 * WHY HPKE AND NOT A HAND-ROLLED ENVELOPE: key wrap needs public-key
 * encryption (the sender does not share a symmetric key with the recipient
 * device ahead of time — that is the whole problem key wrap solves), and
 * RFC 9180 is the IETF-standardized answer, with an official test-vector
 * suite that lets this file prove its DHKEM/KDF core against bytes it did
 * not generate. Hand-rolling a public-key envelope with no external vector
 * to check against is exactly the mistake pd-vault's design otherwise
 * refuses to make (see the module docs on ADR-0120's shared-fixture rule).
 *
 * WHAT NODE:CRYPTO DOES AND DOES NOT GIVE US:
 *   - generateKeyPairSync('x25519') / diffieHellman() do the curve math —
 *     Node never hands back a wrong-order or non-reduced point, so this file
 *     does not reimplement X25519 the way it reimplements HChaCha20 above.
 *   - HKDF-Extract and HKDF-Expand are NOT separately reachable, though —
 *     hkdfSync() only offers them fused (Extract-then-Expand in one call,
 *     one output). RFC 9180's KeySchedule needs the fission: one
 *     LabeledExtract output (`secret`) feeds three different LabeledExpand
 *     calls (key, base_nonce, exporter_secret), and two more LabeledExtract
 *     outputs (psk_id_hash, info_hash) are used as raw bytes with no Expand
 *     step at all. So hkdfExtract/hkdfExpand below are two HMAC-SHA256
 *     calls apiece, RFC 5869 read straight into code — not a rejection of
 *     node:crypto, just the one seam it does not expose.
 *   - Node's classic (non-WebCrypto) key API takes PEM/DER/JWK, never a raw
 *     scalar or point, so x25519PrivateKeyFromRaw/x25519PublicKeyFromRaw
 *     below wrap a raw 32-byte value in the fixed RFC 8410 DER prefix for
 *     X25519 right before a node:crypto call and strip it back off right
 *     after — keeping this file's own convention of raw Uint8Array/Buffer
 *     keys everywhere (mirroring the Rust side's `[u8; 32]`), never an
 *     opaque KeyObject in a public function signature.
 *   - Zeroing intermediate secrets (the DH output, the KEM shared secret,
 *     the KeySchedule `secret`, the AEAD key) is done best-effort with
 *     `Buffer.fill(0)` once each is no longer needed. This is NOT the
 *     guarantee Rust's `Zeroize` gives: V8 can already have copied or
 *     relocated the underlying bytes before the fill runs, and a failure
 *     path here does not always reach every fill. Worth doing, worth being
 *     honest it is not the same property.
 *
 * VERSION/SUITE DOWNGRADE (ADR-0123 §1: hard failure, never silent). The
 * suite — DHKEM(X25519,HKDF-SHA256)/HKDF-SHA256/AES-256-GCM — and the base
 * mode byte are compile-time constants, never read off the wire: a
 * {@link WrappedKey} is just `{enc, ciphertext}`, no algorithm-agility
 * field, so there is no parse step that could accept an unexpected value in
 * the first place. {@link KeyWrapAad}'s "version" component
 * ({@link KEY_WRAP_AAD_LABEL}) is the same kind of constant:
 * {@link encodeKeyWrapAad} only ever emits the current label, and that label
 * is authenticated into both the KDF context and the AEAD tag, so an
 * envelope sealed under a different version could not have come from this
 * code, and could not be relabelled into opening under this version either.
 *
 * WHAT THIS FILE DOES NOT DO: `HarborKemSecret`'s X25519 agreement (the
 * Rust crate's keys.rs) rejects a non-contributory (low-order-point) peer
 * key outright, via `was_contributory()`. {@link hpkeEncapBase} below only
 * catches the single canonical case — an all-zero DH output, from the
 * identity point — not the full small-subgroup/cofactor sweep x25519-dalek
 * performs. That is a real, intentionally narrower scope for this reference
 * twin, not an oversight: flagging it here so a reviewer treats it as a
 * known gap to close on the Rust side (if hpke.rs reuses `HarborKemSecret`
 * for its own Encap, the Rust side gets the fuller check for free) rather
 * than assuming both sides already match on this one adversarial input.
 *
 * FAILURE POSTURE: identical to the stance above. {@link hpkeOpenBase} has
 * one failure, the same DECRYPT error, for a wrong recipient key, a
 * tampered `enc`, a tampered ciphertext, and any tampered AAD field (every
 * field is bound into the KDF info AND the AEAD tag, both built from the
 * same encoded bytes — see {@link decryptFailure}). Errors about the
 * caller's own arguments (wrong-length keys, an unrecognized grant or
 * key_purpose, an empty AAD field) stay explicit.
 *
 * PROVENANCE: the low-level primitives here (LabeledExtract/LabeledExpand,
 * DHKEM Encap/Decap, KeySchedule, single-shot Seal/Open) are checked against
 * RFC 9180's own official test-vectors.json entry for this exact
 * ciphersuite — see tests/unit/pd-vault-ts-hpke.test.ts.
 * wrapChannelKeyForDevice/unwrapChannelKeyForDevice compose those primitives
 * with port-daddy's own KeyWrapAad; that composition is pinned by a
 * self-generated KAT in the same test file, stated plainly as
 * self-generated (same provenance discipline as pd-vault's Rust-side KATs)
 * pending the Rust crate's own wrap-level fixture to diff against.
 */

/** RFC 9180 KEM identifier for DHKEM(X25519, HKDF-SHA256) (§7.1). */
const HPKE_KEM_ID = 0x0020;
/** RFC 9180 KDF identifier for HKDF-SHA256 (§7.2). */
const HPKE_KDF_ID = 0x0001;
/** RFC 9180 AEAD identifier for AES-256-GCM (§7.3). */
const HPKE_AEAD_ID = 0x0002;

/** Length of a raw X25519 public or private key, in bytes (Npk = Nsk = 32). */
export const X25519_KEY_LEN = 32;
/** AES-256-GCM key length, in bytes (Nk). */
export const HPKE_AEAD_KEY_LEN = 32;
/** AES-256-GCM nonce length, in bytes (Nn) — NOT {@link NONCE_LEN}, which is XChaCha20's 24-byte nonce above. */
export const HPKE_AEAD_NONCE_LEN = 12;
/** AES-256-GCM tag length, in bytes (Nt). */
export const HPKE_AEAD_TAG_LEN = 16;

/** Domain-separation label for the channel-key-wrap associated data (ADR-0123 A4/B3) — see the section doc comment's VERSION/SUITE DOWNGRADE note. */
export const KEY_WRAP_AAD_LABEL = 'pd-vault/keywrap/v1';

/**
 * RFC 9180 §3 / RFC 8017 §4.1 I2OSP: big-endian `w`-byte encoding of a
 * non-negative integer. HPKE's suite-id components and LabeledExpand's `L`
 * are always 2 bytes wide here — kept as its own tiny helper rather than
 * folding into {@link u64be} above so the two call sites, one 8 bytes wide
 * and one 2, can never be handed the other's width by mistake. Every call
 * site in this file passes a small internal constant (32, 12, a suite-id
 * component), never caller-supplied input, so this does not pre-validate
 * range the way u64be does for its caller-supplied epoch/seq — Buffer's own
 * `writeUIntBE` throws if a value ever does not fit.
 *
 * @param n Non-negative integer that fits in `w` bytes.
 * @param w Output width, in bytes.
 * @returns The big-endian encoding.
 */
function i2osp(n: number, w: number): Buffer {
  const out = Buffer.alloc(w);
  out.writeUIntBE(n, 0, w);
  return out;
}

/**
 * RFC 5869 HKDF-Extract(salt, ikm) = HMAC-Hash(salt, ikm). Not reachable via
 * {@link hkdfSync} in isolation — see the section doc comment for why this
 * file needs Extract and Expand as two separately callable steps rather than
 * the fused helper {@link deriveChannelKey} uses above. A zero-length salt
 * is valid HMAC-SHA256 input (HMAC zero-pads any key shorter than
 * SHA-256's 64-byte block, so `""` and 32 zero bytes hash identically
 * either way) — this is the salt LabeledExtract passes for every HPKE label
 * except the KeySchedule's "secret" step, where the shared secret itself is
 * the salt.
 *
 * @param salt HMAC key (may be zero-length).
 * @param ikm Input keying material.
 * @returns The 32-byte pseudorandom key.
 */
function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Buffer {
  return createHmac('sha256', Buffer.from(salt)).update(Buffer.from(ikm)).digest();
}

/**
 * RFC 5869 HKDF-Expand(prk, info, length): the T(1)||T(2)||... counter-mode
 * HMAC chain, truncated to `length` bytes.
 *
 * @param prk Pseudorandom key from {@link hkdfExtract}.
 * @param info Context/label bytes.
 * @param length Output length in bytes.
 * @returns `length` bytes of output keying material.
 */
function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Buffer {
  const hashLen = 32;
  const blocks = Math.ceil(length / hashLen);
  const chunks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  for (let counter = 1; counter <= blocks; counter++) {
    previous = createHmac('sha256', Buffer.from(prk))
      .update(Buffer.concat([previous, Buffer.from(info), Buffer.from([counter])]))
      .digest();
    chunks.push(previous);
  }
  return Buffer.concat(chunks).subarray(0, length);
}

/** "HPKE-v1" — the literal 7-byte version string every Labeled call mixes in (RFC 9180 §4), no null terminator, no length prefix. */
const HPKE_VERSION_LABEL = Buffer.from('HPKE-v1', 'ascii');
/** suite_id for DHKEM's own internal LabeledExtract/LabeledExpand calls (RFC 9180 §4.1) — "KEM" || I2OSP(kem_id, 2). Distinct from {@link HPKE_SUITE_ID}; DHKEM never uses the other one. */
const KEM_SUITE_ID = Buffer.concat([Buffer.from('KEM', 'ascii'), i2osp(HPKE_KEM_ID, 2)]);
/** suite_id for everything outside the KEM — KeySchedule et al. (RFC 9180 §5.1) — "HPKE" || kem_id || kdf_id || aead_id. */
const HPKE_SUITE_ID = Buffer.concat([
  Buffer.from('HPKE', 'ascii'),
  i2osp(HPKE_KEM_ID, 2),
  i2osp(HPKE_KDF_ID, 2),
  i2osp(HPKE_AEAD_ID, 2),
]);

/**
 * RFC 9180 §4 LabeledExtract: domain-separates every HKDF-Extract call in
 * HPKE by mixing the version string, the ciphersuite, and a label into the
 * IKM before extracting, so no two distinct (suite, label, purpose) triples
 * can ever collide on the same PRK even if their raw `ikm` bytes coincide.
 *
 * @param salt Extract salt (may be zero-length).
 * @param label ASCII label, e.g. "eae_prk", "secret", "psk_id_hash".
 * @param ikm Input keying material.
 * @param suiteId The KEM's or the outer HPKE's suite_id — never conflated (see {@link KEM_SUITE_ID}/{@link HPKE_SUITE_ID}).
 * @returns The 32-byte labeled PRK.
 */
function labeledExtract(salt: Uint8Array, label: string, ikm: Uint8Array, suiteId: Uint8Array): Buffer {
  const labeledIkm = Buffer.concat([
    HPKE_VERSION_LABEL,
    Buffer.from(suiteId),
    Buffer.from(label, 'ascii'),
    Buffer.from(ikm),
  ]);
  return hkdfExtract(salt, labeledIkm);
}

/**
 * RFC 9180 §4 LabeledExpand: the Expand-side twin of {@link labeledExtract}.
 * The 2-byte length prefix on `labeled_info` is part of the RFC's own
 * domain separation — it is what stops, say, a length-32 "key" expand and a
 * length-12 "base_nonce" expand of the same PRK/context from ever landing on
 * the same labeled_info bytes — not this file's invention.
 *
 * @param prk PRK from {@link labeledExtract}.
 * @param label ASCII label, e.g. "shared_secret", "key", "base_nonce".
 * @param info Context bytes.
 * @param length Output length in bytes.
 * @param suiteId Same suite_id used for the matching {@link labeledExtract} call.
 * @returns `length` bytes of labeled output keying material.
 */
function labeledExpand(
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
  suiteId: Uint8Array
): Buffer {
  const labeledInfo = Buffer.concat([
    i2osp(length, 2),
    HPKE_VERSION_LABEL,
    Buffer.from(suiteId),
    Buffer.from(label, 'ascii'),
    Buffer.from(info),
  ]);
  return hkdfExpand(prk, labeledInfo, length);
}

/**
 * RFC 9180 §4.1 ExtractAndExpand: turns a raw X25519 DH output (a curve
 * point, not a uniform key) into the KEM's shared secret. Uses
 * {@link KEM_SUITE_ID}, never {@link HPKE_SUITE_ID} — DHKEM's internal
 * Labeled calls are suite-scoped to the KEM alone, per §4.1.
 *
 * @param dh Raw Diffie-Hellman output.
 * @param kemContext `enc || pkRm`, identical on the encap and decap sides — see {@link hpkeEncapBase}/{@link hpkeDecapBase}.
 * @returns The 32-byte KEM shared secret (Nsecret for this ciphersuite).
 */
function extractAndExpand(dh: Uint8Array, kemContext: Uint8Array): Buffer {
  const eaePrk = labeledExtract(Buffer.alloc(0), 'eae_prk', dh, KEM_SUITE_ID);
  return labeledExpand(eaePrk, 'shared_secret', kemContext, X25519_KEY_LEN, KEM_SUITE_ID);
}

/**
 * RFC 8410 §7 fixed DER prefixes for an X25519 key with no ASN.1 parameters
 * (curve25519 has none). Node's classic crypto key API only speaks
 * PEM/DER/JWK — there is no "import 32 raw bytes" entry point — and this
 * file's whole convention is raw Uint8Array/Buffer keys everywhere. So the
 * wrapper goes on right before a node:crypto call needs a KeyObject and
 * comes back off right after; nothing outside x25519PrivateKeyFromRaw /
 * x25519PublicKeyFromRaw / x25519RawPublicKey below ever sees a KeyObject.
 */
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
/** See {@link X25519_PKCS8_PREFIX}; the SPKI (public-key) equivalent. */
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

/**
 * Wrap a raw 32-byte X25519 private scalar as a KeyObject node:crypto can
 * run `diffieHellman` with. PKCS8 (RFC 5958) does not require a public-key
 * field for this algorithm, so 32 raw bytes plus the fixed prefix is a
 * complete, valid private key — Node/OpenSSL derive the public point from
 * the scalar on demand (see {@link x25519RawPublicKey}).
 *
 * @param scalar 32-byte raw private key.
 * @returns A KeyObject usable with `diffieHellman`/`createPublicKey`.
 */
function x25519PrivateKeyFromRaw(scalar: Uint8Array): KeyObject {
  if (scalar.length !== X25519_KEY_LEN) {
    throw new VaultTsError('BAD_KEY', `X25519 private key must be ${X25519_KEY_LEN} bytes`);
  }
  return createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, Buffer.from(scalar)]),
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Wrap a raw 32-byte X25519 public point as a KeyObject. RFC 9180 §7.1.1:
 * every 32-byte string is a syntactically valid Montgomery u-coordinate —
 * there is nothing to reject at this layer; a degenerate (low-order) point
 * only matters once it is used in a DH agreement (see {@link hpkeEncapBase}).
 *
 * @param point 32-byte raw public key.
 * @returns A KeyObject usable with `diffieHellman`.
 */
function x25519PublicKeyFromRaw(point: Uint8Array): KeyObject {
  if (point.length !== X25519_KEY_LEN) {
    throw new VaultTsError('BAD_KEY', `X25519 public key must be ${X25519_KEY_LEN} bytes`);
  }
  return createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, Buffer.from(point)]),
    format: 'der',
    type: 'spki',
  });
}

/**
 * The inverse of {@link x25519PublicKeyFromRaw}: strip the fixed SPKI
 * prefix back off, leaving the 32 raw point bytes — this is what
 * SerializePublicKey (RFC 9180 §7.1.1's identity function for X25519) means
 * in terms Node's key API can produce.
 *
 * @param keyObject A public (or public-derivable-from-private) X25519 KeyObject.
 * @returns The 32-byte raw point.
 */
function x25519RawPublicKey(keyObject: KeyObject): Buffer {
  const der = keyObject.export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(der.length - X25519_KEY_LEN));
}

/**
 * RFC 9180 §4.1 Encap: generate an ephemeral X25519 keypair, agree with the
 * recipient's public key, and derive the KEM shared secret. The sender side
 * of DHKEM(X25519, HKDF-SHA256).
 *
 * @param recipientPubkey The recipient's 32-byte raw X25519 public key.
 * @param ephemeralSecret Override the ephemeral private key instead of
 *   drawing one from the CSPRNG. Exists ONLY to replay RFC 9180's official
 *   test vectors, which fix skE — production callers
 *   ({@link wrapChannelKeyForDevice}) never pass this. Passing it turns off
 *   the property that makes reusing a recipient key across many envelopes
 *   safe (a fresh ephemeral every call), which is why it is not on
 *   {@link hpkeSealBase}'s or wrapChannelKeyForDevice's own signature by
 *   omission rather than by a runtime check.
 * @returns `enc` (the serialized ephemeral public key) and the KEM shared secret.
 */
export function hpkeEncapBase(
  recipientPubkey: Uint8Array,
  ephemeralSecret?: Uint8Array
): { enc: Buffer; sharedSecret: Buffer } {
  if (recipientPubkey.length !== X25519_KEY_LEN) {
    throw new VaultTsError('BAD_KEY', `X25519 public key must be ${X25519_KEY_LEN} bytes`);
  }
  const pkR = x25519PublicKeyFromRaw(recipientPubkey);
  const skE =
    ephemeralSecret !== undefined
      ? x25519PrivateKeyFromRaw(ephemeralSecret)
      : generateKeyPairSync('x25519').privateKey;
  const enc = x25519RawPublicKey(createPublicKey(skE));
  // The one degenerate-agreement case this reference twin catches — see the
  // section doc comment's "WHAT THIS FILE DOES NOT DO" note for the scope
  // this deliberately does not cover. Node's OpenSSL backend does not always
  // hand back an all-zero result for a low-order peer key the way a
  // constant-time userspace X25519 implementation (x25519-dalek, @noble)
  // would: for the canonical identity point it throws its own opaque
  // "failed during derivation" error straight out of diffieHellman(), before
  // this function's own bytes-based check ever runs. Both paths are covered
  // here — the throw is caught and re-raised as this module's own explicit
  // error, and the all-zero check stays as a second line of defense for any
  // low-order point OpenSSL does not reject at the DH call itself.
  let dh: Buffer;
  try {
    dh = diffieHellman({ privateKey: skE, publicKey: pkR });
  } catch {
    throw new VaultTsError('BAD_KEY', 'recipient public key is a low-order point');
  }
  if (dh.equals(Buffer.alloc(X25519_KEY_LEN))) {
    throw new VaultTsError('BAD_KEY', 'recipient public key is a low-order point');
  }
  const kemContext = Buffer.concat([enc, Buffer.from(recipientPubkey)]);
  const sharedSecret = extractAndExpand(dh, kemContext);
  dh.fill(0);
  return { enc, sharedSecret };
}

/**
 * RFC 9180 §4.1 Decap: the recipient side. Re-derives the recipient's own
 * public key from its private scalar (`pk(skR)`) rather than taking it as a
 * parameter — `kem_context` must be byte-identical to what the sender
 * built, and the sender built it from the pkR it encapsulated to, so the
 * recipient has to reproduce that exact serialization from its own secret
 * rather than being handed it, or a caller-supplied mismatch would silently
 * break every agreement without a symptom until this line.
 *
 * Checked for a degenerate (low-order) `enc` the same way
 * {@link hpkeEncapBase} checks its recipient key — not asymmetrically,
 * matching the Rust crate, where `decap` and `encap` both route through the
 * same contributory-agreement check. `enc` is attacker-reachable wire data,
 * so a distinguishing "degenerate enc" error here would on its own be
 * exactly the kind of oracle {@link hpkeOpenBase} exists to refuse — but
 * {@link hpkeOpenBase} wraps this whole function in a try/catch that already
 * collapses every failure mode (a thrown `BAD_KEY` here, a native OpenSSL
 * derivation failure, a downstream AEAD tag mismatch) into the one opaque
 * decrypt error, so the explicit check costs nothing on that front. What it
 * buys: on the platform this was developed and tested on, Node's OpenSSL
 * backend happens to throw natively for every standard low-order Curve25519
 * point on this exact (private, public) call shape too — verified directly,
 * not assumed — so today the native throw alone would already stop this.
 * That is undocumented backend behavior, not a contract; a different
 * Node/OpenSSL build is free to return a shared secret instead of throwing.
 * The explicit all-zero check below is the defense that does not depend on
 * which one it does — the same reason {@link hpkeEncapBase} keeps its own
 * check even though its own native throw was observed too.
 *
 * @param enc The sender's serialized ephemeral public key.
 * @param recipientSecret The recipient's 32-byte raw X25519 private key.
 * @returns The KEM shared secret — identical to {@link hpkeEncapBase}'s
 *   output for the matching sender call, or an unrelated value if `enc` was
 *   tampered or `recipientSecret` is the wrong key.
 */
export function hpkeDecapBase(enc: Uint8Array, recipientSecret: Uint8Array): Buffer {
  const skR = x25519PrivateKeyFromRaw(recipientSecret);
  const pkE = x25519PublicKeyFromRaw(enc);
  let dh: Buffer;
  try {
    dh = diffieHellman({ privateKey: skR, publicKey: pkE });
  } catch {
    throw new VaultTsError('BAD_KEY', 'enc is a low-order point');
  }
  if (dh.equals(Buffer.alloc(X25519_KEY_LEN))) {
    throw new VaultTsError('BAD_KEY', 'enc is a low-order point');
  }
  const pkRm = x25519RawPublicKey(createPublicKey(skR));
  const kemContext = Buffer.concat([Buffer.from(enc), pkRm]);
  const sharedSecret = extractAndExpand(dh, kemContext);
  dh.fill(0);
  return sharedSecret;
}

/**
 * RFC 9180 §5.1 KeySchedule, base mode only (mode_base = 0x00, psk =
 * psk_id = the empty string, per §5.1's `default_psk`/`default_psk_id`) —
 * this file has no reason to implement PSK or Auth mode, so it does not.
 *
 * @param sharedSecret The KEM shared secret from {@link hpkeEncapBase}/{@link hpkeDecapBase}.
 * @param info Context bytes — for wrapChannelKeyForDevice/unwrapChannelKeyForDevice this is {@link encodeKeyWrapAad}'s output.
 * @returns The AEAD key, base nonce, and exporter secret, plus
 *   `keyScheduleContext` — exposed only so the RFC vector test can pin it
 *   independently of the three derived values it feeds.
 */
export function hpkeKeyScheduleBase(
  sharedSecret: Uint8Array,
  info: Uint8Array
): { key: Buffer; baseNonce: Buffer; exporterSecret: Buffer; keyScheduleContext: Buffer } {
  const defaultPsk = Buffer.alloc(0);
  const defaultPskId = Buffer.alloc(0);
  const pskIdHash = labeledExtract(Buffer.alloc(0), 'psk_id_hash', defaultPskId, HPKE_SUITE_ID);
  const infoHash = labeledExtract(Buffer.alloc(0), 'info_hash', info, HPKE_SUITE_ID);
  const keyScheduleContext = Buffer.concat([Buffer.from([0x00]), pskIdHash, infoHash]);
  const secret = labeledExtract(sharedSecret, 'secret', defaultPsk, HPKE_SUITE_ID);
  const key = labeledExpand(secret, 'key', keyScheduleContext, HPKE_AEAD_KEY_LEN, HPKE_SUITE_ID);
  const baseNonce = labeledExpand(secret, 'base_nonce', keyScheduleContext, HPKE_AEAD_NONCE_LEN, HPKE_SUITE_ID);
  const exporterSecret = labeledExpand(secret, 'exp', keyScheduleContext, 32, HPKE_SUITE_ID);
  secret.fill(0);
  return { key, baseNonce, exporterSecret, keyScheduleContext };
}

/**
 * RFC 9180 §6.1 SealBase: SetupBaseS + a single ctx.Seal, base mode. Every
 * call is a fresh HPKE context used exactly once — seq is always 0, so
 * ComputeNonce is always exactly `base_nonce` unmodified (§5.2's
 * ComputeNonce/IncrementSeq have no reason to exist in this file, since
 * nothing here calls Seal/Open twice on the same context).
 *
 * @param recipientPubkey The recipient's 32-byte raw X25519 public key.
 * @param info HPKE context info (personalizes the KDF).
 * @param aad AEAD associated data (authenticated, not encrypted).
 * @param plaintext Bytes to seal.
 * @param ephemeralSecret Test-only ephemeral override — see {@link hpkeEncapBase}.
 * @returns `enc` and the AES-256-GCM ciphertext (body || 16-byte tag).
 */
export function hpkeSealBase(
  recipientPubkey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
  ephemeralSecret?: Uint8Array
): { enc: Buffer; ciphertext: Buffer } {
  const { enc, sharedSecret } = hpkeEncapBase(recipientPubkey, ephemeralSecret);
  const ks = hpkeKeyScheduleBase(sharedSecret, info);
  sharedSecret.fill(0);
  try {
    const cipher = createCipheriv('aes-256-gcm', ks.key, ks.baseNonce, { authTagLength: HPKE_AEAD_TAG_LEN });
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const ciphertext = Buffer.concat([body, cipher.getAuthTag()]);
    return { enc, ciphertext };
  } catch {
    throw new VaultTsError('SEAL', 'sealing failed');
  } finally {
    ks.key.fill(0);
  }
}

/**
 * RFC 9180 §6.1 OpenBase: SetupBaseR + a single ctx.Open, base mode — the
 * exact inverse of {@link hpkeSealBase}.
 *
 * FAILURE IS OPAQUE ON PURPOSE, same posture as {@link open} above: a wrong
 * recipient secret, a tampered `enc`, a tampered ciphertext, and a tampered
 * `info`/`aad` (any single field of {@link encodeKeyWrapAad}'s output, since
 * both parameters are the same encoded bytes for
 * wrapChannelKeyForDevice/unwrapChannelKeyForDevice) are all indistinguishable
 * failures. `enc` specifically gets no separate validation here: a
 * wrong-length `enc` fails to parse inside the try block below and falls
 * into the same catch as every other failure, rather than a distinguishing
 * "malformed enc" error that would tell a prober something a
 * tampered-but-well-formed enc would not.
 *
 * @param enc The sender's serialized ephemeral public key.
 * @param recipientSecret The recipient's 32-byte raw X25519 private key.
 * @param info Must equal the `info` used to seal.
 * @param aad Must equal the `aad` used to seal.
 * @param ciphertext Sealed bytes (body || tag) from {@link hpkeSealBase}.
 * @returns The recovered plaintext.
 */
export function hpkeOpenBase(
  enc: Uint8Array,
  recipientSecret: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array
): Buffer {
  if (recipientSecret.length !== X25519_KEY_LEN) {
    throw new VaultTsError('BAD_KEY', `X25519 private key must be ${X25519_KEY_LEN} bytes`);
  }
  // Same reasoning as open()'s identical check above: a short input cannot
  // carry a tag, and reporting that as anything but the generic failure
  // would tell a prober where the tag boundary is.
  if (ciphertext.length < HPKE_AEAD_TAG_LEN) throw decryptFailure();
  try {
    const sharedSecret = hpkeDecapBase(enc, recipientSecret);
    const ks = hpkeKeyScheduleBase(sharedSecret, info);
    sharedSecret.fill(0);
    const tagStart = ciphertext.length - HPKE_AEAD_TAG_LEN;
    const decipher = createDecipheriv('aes-256-gcm', ks.key, ks.baseNonce, { authTagLength: HPKE_AEAD_TAG_LEN });
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(ciphertext.subarray(tagStart)));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext.subarray(0, tagStart))),
      decipher.final(),
    ]);
    ks.key.fill(0);
    return plaintext;
  } catch {
    throw decryptFailure();
  }
}

/**
 * The context a wrapped channel key is bound to (ADR-0123 A4/B3
 * KeyWrapAad). Every field feeds BOTH the HPKE `info` (personalizes the KDF
 * context) and the AEAD `aad` (authenticates the field into the GCM tag) —
 * see {@link encodeKeyWrapAad}. Structurally the same idea as {@link SealAad}
 * above, applied to key distribution instead of payload sealing.
 */
export interface KeyWrapAad {
  /** The account the recipient device belongs to. */
  accountId: string;
  /** The harbor that owns the key. */
  harborId: string;
  /** The authority epoch in force when the key was wrapped. */
  authorityEpoch: number;
  /** The device the key is being wrapped FOR. */
  recipientDeviceId: string;
  /**
   * The ADR-0042 grant ladder level this key conveys — typically `"use"`,
   * `"read"`, or `"manage"`, but this type does not enforce that set (matches
   * the Rust crate's `&str` exactly — see {@link encodeKeyWrapAad}'s doc
   * comment for why): the ladder position is enforced by whatever consults
   * this string, not by the vault. Only emptiness is rejected here.
   */
  grant: string;
  /**
   * What the wrapped key is for — typically `"channel"`, `"content"`, or
   * `"snapshot"`, same non-enforcement note as {@link grant}.
   */
  keyPurpose: string;
  /** The specific key's id — e.g. the channel_id, for a "channel"-purpose key. */
  keyId: string;
}

/**
 * A channel key sealed to one recipient device (ADR-0123 A4/B3). Safe to
 * serialize and send over the wire — the point of HPKE key wrap is that
 * this is the only form the key leaves this module in.
 */
export interface WrappedKey {
  /** The sender's ephemeral X25519 public key (RFC 9180's `enc`). */
  enc: Buffer;
  /** AES-256-GCM ciphertext (body || 16-byte tag). */
  ciphertext: Buffer;
}

/**
 * The canonical AAD byte encoding for a wrapped channel key (ADR-0123 A4/B3
 * KeyWrapAad, byte-identical to the Rust side — pinned by the self-generated
 * KAT in tests/unit/pd-vault-ts-hpke.test.ts pending the crate's own
 * wrap-level fixture). Goes through the SAME {@link unambiguousEncoding}
 * primitive as {@link encodeSealAad} — one anti-ambiguity encoding for the
 * whole file, not a second one invented for this second use.
 *
 * The label component IS the version: see the section doc comment's
 * VERSION/SUITE DOWNGRADE note for why a hard-coded, always-current label
 * closes the downgrade path structurally rather than by runtime comparison.
 *
 * @param aad Wrap context; account/harbor/device/grant/purpose/key ids must
 *   all be non-empty. `grant` and `keyPurpose` are NOT validated against a
 *   closed set here — matches the Rust crate exactly (see {@link KeyWrapAad}):
 *   the ladder/purpose meaning is enforced by whatever consults this string,
 *   not by the vault.
 * @returns The encoded associated data.
 */
export function encodeKeyWrapAad(aad: KeyWrapAad): Buffer {
  if (aad.accountId.length === 0) throw new VaultTsError('EMPTY_COMPONENT', 'empty account id');
  if (aad.harborId.length === 0) throw new VaultTsError('EMPTY_COMPONENT', 'empty harbor id');
  if (aad.recipientDeviceId.length === 0) {
    throw new VaultTsError('EMPTY_COMPONENT', 'empty recipient device id');
  }
  if (aad.grant.length === 0) throw new VaultTsError('EMPTY_COMPONENT', 'empty grant');
  if (aad.keyPurpose.length === 0) throw new VaultTsError('EMPTY_COMPONENT', 'empty key purpose');
  if (aad.keyId.length === 0) throw new VaultTsError('EMPTY_COMPONENT', 'empty key id');
  return unambiguousEncoding([
    utf8(KEY_WRAP_AAD_LABEL),
    utf8(aad.accountId),
    utf8(aad.harborId),
    u64be(aad.authorityEpoch, 'authority_epoch'),
    utf8(aad.recipientDeviceId),
    utf8(aad.grant),
    utf8(aad.keyPurpose),
    utf8(aad.keyId),
  ]);
}

/**
 * Wrap a channel key to one recipient device's X25519 public key
 * (ADR-0123 A4/B3; pd-vault `wrap_channel_key_for_device`, byte-identical).
 *
 * This is HPKE base-mode Seal with `info` AND `aad` both set to
 * {@link encodeKeyWrapAad}'s output — info personalizes the KDF context,
 * aad additionally authenticates every field into the AES-GCM tag so the
 * relay (which can see this metadata in cleartext framing) cannot swap any
 * of it in transit. See {@link hpkeSealBase}.
 *
 * @param key The 32-byte channel key to wrap.
 * @param recipientPubkey The recipient device's 32-byte raw X25519 public key.
 * @param aad The wrap context — see {@link KeyWrapAad}.
 * @returns The wrapped key: `enc` plus ciphertext, safe to send over the wire.
 */
export function wrapChannelKeyForDevice(
  key: Uint8Array,
  recipientPubkey: Uint8Array,
  aad: KeyWrapAad
): WrappedKey {
  if (key.length !== CHANNEL_KEY_LEN) {
    throw new VaultTsError('BAD_KEY', `key must be ${CHANNEL_KEY_LEN} bytes`);
  }
  const encoded = encodeKeyWrapAad(aad);
  return hpkeSealBase(recipientPubkey, encoded, encoded, key);
}

/**
 * Recover a channel key wrapped by {@link wrapChannelKeyForDevice}, or fail
 * (pd-vault `unwrap_channel_key_for_device`).
 *
 * FAILURE IS OPAQUE ON PURPOSE, same posture as {@link open} above — see
 * {@link hpkeOpenBase}, which this delegates to entirely. Succeeds only when
 * `recipientSecret` is the private half of the key `wrapChannelKeyForDevice`
 * sealed to, and `aad` is byte-identical to what was used to wrap.
 *
 * @param wrapped The wrapped key from {@link wrapChannelKeyForDevice}.
 * @param recipientSecret The recipient device's 32-byte raw X25519 private key.
 * @param aad The exact wrap context used to seal.
 * @returns The recovered 32-byte channel key.
 */
export function unwrapChannelKeyForDevice(
  wrapped: WrappedKey,
  recipientSecret: Uint8Array,
  aad: KeyWrapAad
): Buffer {
  const encoded = encodeKeyWrapAad(aad);
  return hpkeOpenBase(wrapped.enc, recipientSecret, encoded, encoded, wrapped.ciphertext);
}
