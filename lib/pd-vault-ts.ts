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
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

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
