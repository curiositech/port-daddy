/**
 * lib/coordination-crypto.ts — Envelope encryption for adversarial-fleet
 * coordination channels (redteam-review ↔ whitehat-defense).
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS
 * ════════════════════════════════════════════════════════════════════════
 * The general-purpose `note-encryption.ts` primitive seals notes against
 * a Dolev-Yao adversary that can read the SQLite file but cannot read the
 * Keychain. That's right for general use. It is NOT enough for adversarial
 * red/white isolation, because both fleets share the same daemon master
 * key — every persona can decrypt every note.
 *
 * For an adversarial round we need PER-FLEET keys, derived from a
 * sec-eng-lead root, rotated every round. A red-team persona's process
 * holds only the redteam-fleet-key.v<N>; a white-hat persona holds only
 * the defense-fleet-key.v<N>. The daemon holds neither. The lead holds
 * both, but only at gate moments.
 *
 * This module supplies:
 *   - per-round HKDF derivation from the lead's root
 *   - envelope schema for ciphertext + AD + signature
 *   - encrypt/decrypt with strong AD binding (project + namespace + round)
 *   - explicit refusal to decrypt across namespaces (defence in depth)
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THREAT MODEL
 * ════════════════════════════════════════════════════════════════════════
 * Honest:    sec-eng-lead's root key, the OS keystore, persona processes.
 * Adversary: the daemon process, anyone with read access to the daemon
 *            DB or backups, ACL bugs that mis-route a tag query.
 * Property:  payload secrecy across the adversarial namespace divide
 *            (red ⇏ white during Phase 1; white ⇏ red during Phase 2)
 *            holds even if the daemon process is fully compromised, as
 *            long as the keystore and the lead's root remain intact.
 *
 * The gate transitions (sec-eng-lead's role) are an explicit hole in
 * this property: the lead decrypts and re-encrypts at Gate B and Gate C.
 * That hole is the point of having gates; it is NOT a vulnerability.
 * It IS what the ProVerif obligation must model.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT THIS MODULE INTENTIONALLY DOES NOT DO
 * ════════════════════════════════════════════════════════════════════════
 *  - Hide tags. Tags are public so routing works and the audit log is
 *    legible. Cardinality of tags leaks metadata; that's documented.
 *  - Encrypt the audit chain. The chain is signed-only; external
 *    verifiers must be able to confirm gate ordering.
 *  - Replace `note-encryption.ts`. That stays the default for general
 *    notes; `coordination-crypto.ts` is opt-in via key_id.
 */

import { randomBytes, createCipheriv, createDecipheriv, hkdfSync, createHash, sign as edSign, verify as edVerify } from 'node:crypto';
import { keychain, KEYCHAIN_SERVICE } from './keychain.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const HKDF_HASH = 'sha256' as const;

const KEYCHAIN_ACCOUNT_ROOT = 'secops-lead-root';
const KEYCHAIN_ACCOUNT_FLEET_PREFIX = 'fleet-key';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FleetId = 'redteam-review' | 'whitehat-defense' | 'audit-public';

/**
 * `key_id` shape: `<fleet>-fleet-key.v<round>` or `audit-pub-key.v<round>`.
 * Stored alongside the ciphertext so the daemon can route to the right
 * decryption attempt without holding the key.
 */
export type KeyId = string;

export interface EnvelopePayload {
  /** Always present. Identifies the key needed to decrypt. */
  key_id: KeyId;
  /** Base64 IV (12 bytes for GCM). */
  iv: string;
  /** Base64 ciphertext over the JSON-encoded payload. */
  ct: string;
  /** Base64 GCM auth tag (16 bytes). */
  tag: string;
  /**
   * Associated data, base64. Bound into AEAD. Includes project, namespace,
   * and round so a payload cannot be replayed across namespaces. Stored
   * cleartext alongside ciphertext; verified during decrypt.
   */
  ad: string;
  /** ISO timestamp of envelope creation (also bound into AD). */
  ts: string;
  /** Persona that produced this envelope (e.g., "redteam:crypto"). */
  signed_by: string;
  /** Ed25519 signature over (ad || ts || ct), base64. */
  sig: string;
  /** Schema version for future algorithm changes. */
  v: 1;
}

export interface RoundContext {
  /** e.g. "v2.1" */
  round: string;
  /** 32 random bytes, emitted in the Gate A audit event (base64). */
  salt: string;
}

export interface EncryptOptions {
  fleet: FleetId;
  round: RoundContext;
  /** Project namespace for the AD binding (must match the daemon route). */
  project: string;
  /** Persona id, e.g. "redteam:crypto", "defense:proofs", "secops:lead". */
  signedBy: string;
  /** Ed25519 private key for signing. 64 bytes (seed+pub) per node:crypto. */
  signingKey: Buffer;
}

export interface DecryptOptions {
  fleet: FleetId;
  round: RoundContext;
  project: string;
  /** Map of persona id → Ed25519 public key. The lead pubkey must always be present. */
  knownVerifyKeys: Record<string, Buffer>;
}

// ─── Root + fleet key derivation ────────────────────────────────────────────

/**
 * Load the sec-eng-lead Ed25519 root from the OS keychain. Returns null if
 * not present — only sec-eng-lead processes should ever need this.
 *
 * Persona processes load only their fleet key (see `loadFleetKey`).
 */
export function loadLeadRoot(): Buffer | null {
  const hex = keychain.loadSecret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ROOT);
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  // Ed25519 private key (64 bytes).
  return buf.length === 64 ? buf : null;
}

/**
 * Sec-eng-lead-only operation. Called once per round (at Gate A). Derives
 * the fleet key from the root + round salt, stashes it in the keychain
 * under a fleet+round-scoped account so the persona processes can load it.
 *
 * The fleet keys are 32 bytes (AES-256-GCM).
 */
export function deriveAndStashFleetKey(
  root: Buffer,
  fleet: FleetId,
  round: RoundContext,
): Buffer {
  const salt = Buffer.from(round.salt, 'base64');
  const info = Buffer.from(`fleet/${fleet}/${round.round}`, 'utf8');
  const derived = Buffer.from(hkdfSync(HKDF_HASH, root, salt, info, KEY_LENGTH));
  const account = `${KEYCHAIN_ACCOUNT_FLEET_PREFIX}-${fleet}-${round.round}`;
  const ok = keychain.saveSecret(KEYCHAIN_SERVICE, account, derived.toString('hex'));
  if (!ok) {
    throw new Error(
      `[coordination-crypto] failed to stash fleet key for ${fleet} ${round.round}; ` +
      `OS keychain unavailable. Refusing to derive in plaintext storage.`,
    );
  }
  return derived;
}

/**
 * Persona-side load. Reads the fleet key for this round; returns null if
 * the keychain entry is absent or wrong length. A null return means this
 * persona is not authorized for this fleet/round — refuse to operate.
 */
export function loadFleetKey(fleet: FleetId, round: RoundContext): Buffer | null {
  const account = `${KEYCHAIN_ACCOUNT_FLEET_PREFIX}-${fleet}-${round.round}`;
  const hex = keychain.loadSecret(KEYCHAIN_SERVICE, account);
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  return buf.length === KEY_LENGTH ? buf : null;
}

/**
 * Build the canonical key_id string. Daemon stores this alongside ciphertext.
 */
export function keyIdFor(fleet: FleetId, round: RoundContext): KeyId {
  return `${fleet === 'audit-public' ? 'audit-pub-key' : `${fleet}-fleet-key`}.${round.round}`;
}

// ─── Associated-data binding ────────────────────────────────────────────────

/**
 * Associated data binds project+namespace+round into AEAD. A ciphertext
 * encrypted for `redteam-review/v2.1` cannot be decrypted as if it were
 * for `whitehat-defense/v2.1` — even if both keys leak, the AD verification
 * fails. This is the "defense in depth" against ACL evasion.
 */
function buildAd(opts: { fleet: FleetId; project: string; round: string; ts: string }): Buffer {
  const ad = JSON.stringify({
    fleet: opts.fleet,
    project: opts.project,
    round: opts.round,
    ts: opts.ts,
  });
  return Buffer.from(ad, 'utf8');
}

// ─── Encrypt / Decrypt ──────────────────────────────────────────────────────

export function encryptEnvelope(
  payload: unknown,
  opts: EncryptOptions,
): EnvelopePayload {
  const fleetKey = loadFleetKey(opts.fleet, opts.round);
  if (!fleetKey) {
    throw new Error(
      `[coordination-crypto] persona "${opts.signedBy}" cannot encrypt for ` +
      `${opts.fleet}/${opts.round.round}: fleet key not in keychain. ` +
      `This persona is not authorized for this fleet/round.`,
    );
  }

  const ts = new Date().toISOString();
  const ad = buildAd({ fleet: opts.fleet, project: opts.project, round: opts.round.round, ts });
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, fleetKey, iv);
  cipher.setAAD(ad);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Wipe the fleet key from this stack frame — node:crypto already copied
  // it into the cipher's state. Doesn't make zeroization perfect (V8 may
  // hold copies elsewhere) but reduces window.
  fleetKey.fill(0);

  // Sign (ad || ts || ct) with the persona's signing key. The signature
  // proves authorship to the lead at gate handoffs without needing the
  // symmetric key.
  const sigInput = Buffer.concat([ad, Buffer.from(ts, 'utf8'), ct]);
  const sig = edSign(null, sigInput, { key: opts.signingKey, format: 'der', type: 'pkcs8' } as never);

  return {
    key_id: keyIdFor(opts.fleet, opts.round),
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
    ad: ad.toString('base64'),
    ts,
    signed_by: opts.signedBy,
    sig: sig.toString('base64'),
    v: 1,
  };
}

/**
 * Returns the decrypted payload, or null on any failure (wrong key, bad
 * AD, bad signature, malformed envelope). Failures DO NOT distinguish
 * between cause; callers see "couldn't read it" and either retry with
 * the next key or surface an integrity event to the audit log.
 */
export function decryptEnvelope<T = unknown>(
  env: EnvelopePayload,
  opts: DecryptOptions,
): T | null {
  if (env.v !== 1) return null;
  if (env.key_id !== keyIdFor(opts.fleet, opts.round)) return null;

  const fleetKey = loadFleetKey(opts.fleet, opts.round);
  if (!fleetKey) return null;

  const ad = Buffer.from(env.ad, 'base64');
  const expectedAd = buildAd({
    fleet: opts.fleet, project: opts.project, round: opts.round.round, ts: env.ts,
  });
  // Constant-time-ish AD compare. The AEAD AD check would reject anyway
  // but we want this branch to fail BEFORE we try the AEAD, so that a
  // namespace-mismatched envelope never even tries to decrypt.
  if (ad.length !== expectedAd.length || !ad.equals(expectedAd)) {
    fleetKey.fill(0);
    return null;
  }

  // Verify signature (rejects forged origins even if key leaks).
  const verifyKey = opts.knownVerifyKeys[env.signed_by];
  if (!verifyKey) {
    fleetKey.fill(0);
    return null;
  }
  const sigInput = Buffer.concat([ad, Buffer.from(env.ts, 'utf8'), Buffer.from(env.ct, 'base64')]);
  const sigOk = edVerify(null, sigInput, { key: verifyKey, format: 'der', type: 'spki' } as never, Buffer.from(env.sig, 'base64'));
  if (!sigOk) {
    fleetKey.fill(0);
    return null;
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, fleetKey, Buffer.from(env.iv, 'base64'));
    decipher.setAAD(ad);
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(env.ct, 'base64')),
      decipher.final(),
    ]);
    fleetKey.fill(0);
    return JSON.parse(plain.toString('utf8')) as T;
  } catch {
    fleetKey.fill(0);
    return null;
  }
}

// ─── Daemon-side guard ──────────────────────────────────────────────────────

/**
 * The daemon never decrypts. But it MUST refuse writes that don't carry
 * a key_id whose namespace matches the project the write targets. This
 * is the tightest perimeter we can enforce without a key, and it stops
 * an attacker from silently writing plaintext into a sealed namespace.
 */
export function daemonAcceptsEnvelopeFor(env: EnvelopePayload, project: string): boolean {
  if (env.v !== 1) return false;
  if (!env.key_id || !env.iv || !env.ct || !env.tag || !env.ad || !env.sig) return false;
  // key_id must mention the project's expected fleet
  if (project === 'redteam-review' && !env.key_id.startsWith('redteam-review-fleet-key.')) return false;
  if (project === 'whitehat-defense' && !env.key_id.startsWith('whitehat-defense-fleet-key.')) return false;
  // 12-byte IV, 16-byte tag, both base64
  if (Buffer.from(env.iv, 'base64').length !== IV_LENGTH) return false;
  if (Buffer.from(env.tag, 'base64').length !== TAG_LENGTH) return false;
  return true;
}

// ─── Audit-log re-encryption (Gate C only) ──────────────────────────────────

/**
 * Sec-eng-lead-only. At Gate C the lead reads both fleets' streams,
 * assembles the dialogue artifact, and re-encrypts it under the public
 * audit key for git publication. The audit key is symmetric but the
 * lead also signs the bundle so external readers can verify the lead's
 * authorship of the dialogue.
 *
 * Not implemented yet — this is the gate operation, owned by sec-eng-lead.
 * Stub left here so the surface is present and the ProVerif model has a
 * concrete operation to model.
 */
export function rewrapForAudit(_inputs: never): never {
  throw new Error(
    '[coordination-crypto] rewrapForAudit is the Gate C operation; ' +
    'implement when wiring sec-eng-lead. See comms-protocol.md §"Gate handoffs".',
  );
}
