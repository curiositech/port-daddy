/**
 * Note Encryption — Envelope encryption for session notes.
 *
 * Design: Master Key → wraps → Session Key → encrypts → Note Content
 *
 * Verified in ProVerif (harbor_card_v4_escrow_secrecy.pv):
 *   - RESULT not attacker(note_content[]) is true.
 *   - RESULT event(NoteRead) ==> event(NoteWritten) is true.
 *
 * Threat model: Dolev-Yao adversary with read access to the SQLite
 * database file. The daemon master key is stored separately and never
 * written to the database.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { keychain, KEYCHAIN_SERVICE } from './keychain.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LENGTH = 32;  // 256 bits
const IV_LENGTH = 12;   // GCM standard nonce
const TAG_LENGTH = 16;  // GCM standard tag

const MASTER_KEY_DIR = join(homedir(), '.port-daddy');
const MASTER_KEY_PATH = join(MASTER_KEY_DIR, 'master.key');

/** Keychain account for the master key. One per install. */
const KEYCHAIN_ACCOUNT = 'master-key';

/**
 * Load the master key from the OS keychain. Delegates to the shared
 * primitive; converts hex → Buffer and validates length. Returns null
 * on any failure (platform not supported, entry missing, malformed).
 */
function loadKeyFromKeychain(): Buffer | null {
  const hex = keychain.loadSecret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  return buf.length === KEY_LENGTH ? buf : null;
}

/**
 * Store the master key in the OS keychain (hex-encoded).
 * Returns true on success; callers fall back to file on false.
 */
function saveKeyToKeychain(key: Buffer): boolean {
  return keychain.saveSecret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key.toString('hex'));
}

/** Thin wrapper so existing code paths read cleanly. */
function keychainAvailable(): boolean {
  return keychain.available();
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EncryptedPayload {
  /** Base64-encoded initialization vector */
  iv: string;
  /** Base64-encoded ciphertext */
  ct: string;
  /** Base64-encoded authentication tag */
  tag: string;
  /** Version marker for future algorithm changes */
  v: 1 | 2;
  /** Optional encryption scope for scoped key wrapping. */
  scope?: string;
  /** Optional scoped-key derivation marker. */
  kdf?: 'hmac-sha256';
}

export interface NoteEncryption {
  /** Whether encryption is available (master key exists) */
  isEnabled(): boolean;

  /** Generate a new random session key */
  generateSessionKey(): Buffer;

  /** Wrap a session key with the master key for storage */
  wrapSessionKey(sessionKey: Buffer, scope?: string | null): string;

  /** Unwrap a session key using the master key */
  unwrapSessionKey(wrapped: string, scope?: string | null): Buffer;

  /** Encrypt note content with a session key */
  encryptNote(plaintext: string, sessionKey: Buffer): string;

  /** Decrypt note content with a session key. Returns null on failure. */
  decryptNote(encrypted: string, sessionKey: Buffer): string | null;

  /** Check if a content string is encrypted (vs plaintext legacy) */
  isEncrypted(content: string): boolean;
}

export interface NoteEncryptionOptions {
  /**
   * When true, master-key initialization failures are fatal instead of falling
   * back to plaintext note storage.
   */
  requireMasterKey?: boolean;
}

// ─── Permission Verification ────────────────────────────────────────────────

/**
 * Verify and repair file/directory permissions. Returns true if permissions
 * are now correct; throws if they cannot be fixed.
 */
function verifyPermissions(path: string, expectedMode: number, label: string): void {
  const actual = statSync(path).mode & 0o777;
  if (actual === expectedMode) return;

  const actualOctal = '0o' + actual.toString(8);
  const expectedOctal = '0o' + expectedMode.toString(8);
  console.error(
    `[NoteEncryption] WARNING: ${label} has permissions ${actualOctal}, expected ${expectedOctal} — attempting to fix`
  );

  try {
    chmodSync(path, expectedMode);
    console.error(`[NoteEncryption] Fixed ${label} permissions to ${expectedOctal}`);
  } catch (chmodErr) {
    throw new Error(
      `Cannot fix permissions on ${label} (${path}): ${(chmodErr as Error).message}. ` +
      `Refusing to start with exposed key file.`
    );
  }
}

// ─── Implementation ─────────────────────────────────────────────────────────

export function createNoteEncryption(options: NoteEncryptionOptions = {}): NoteEncryption {
  const requireMasterKey = options.requireMasterKey === true;
  let masterKey: Buffer | null = null;

  // Key acquisition priority:
  //   1. macOS Keychain — mediated cross-process access via user consent.
  //      Net improvement over file-at-rest; the key material never lives
  //      on the filesystem as a readable blob.
  //   2. File fallback at MASTER_KEY_PATH — readable by every same-user
  //      process. Preserved for Linux/Windows and migration. When the
  //      Keychain becomes available on a machine that has a legacy file,
  //      the file's contents are copied into the Keychain and a warning
  //      suggests deletion.
  //   3. Generate fresh — into Keychain if available, else file.
  //
  // IO failures degrade encryption gracefully (plaintext notes) unless
  // requireMasterKey is true, in which case they are fatal.
  try {
    // Tier 1: Keychain
    masterKey = loadKeyFromKeychain();
    if (masterKey) {
      console.error('[NoteEncryption] Master key loaded from macOS Keychain');
    }

    // Tier 2: File (legacy + non-macOS)
    if (!masterKey && existsSync(MASTER_KEY_PATH)) {
      const fileKey = readFileSync(MASTER_KEY_PATH);
      if (fileKey.length === KEY_LENGTH) {
        masterKey = fileKey;
        console.error('[NoteEncryption] Master key loaded from file at', MASTER_KEY_PATH);
        if (keychainAvailable() && saveKeyToKeychain(masterKey)) {
          console.error(
            '[NoteEncryption] Migrated master key to macOS Keychain. The file at',
            MASTER_KEY_PATH,
            'is no longer required; delete it after confirming the daemon restarts cleanly.',
          );
        }
      } else {
        console.error('[NoteEncryption] Master key file wrong length, regenerating');
      }
    }

    // Tier 3: Generate. Prefer Keychain; fall back to file.
    if (!masterKey) {
      masterKey = randomBytes(KEY_LENGTH);
      const stashedInKeychain = keychainAvailable() && saveKeyToKeychain(masterKey);
      if (stashedInKeychain) {
        console.error('[NoteEncryption] Generated new master key in macOS Keychain');
      } else {
        mkdirSync(MASTER_KEY_DIR, { recursive: true, mode: 0o700 });
        writeFileSync(MASTER_KEY_PATH, masterKey, { mode: 0o600 });
        console.error(
          '[NoteEncryption] Generated new master key at', MASTER_KEY_PATH,
          keychainAvailable()
            ? '(Keychain write failed — file fallback)'
            : '(Keychain unavailable on this platform — file fallback)',
        );
      }
    }
  } catch (err) {
    if (requireMasterKey) {
      throw new Error(
        `Note encryption is mandatory but master-key initialization failed: ${(err as Error).message}`
      );
    }
    masterKey = null;
    console.error('[NoteEncryption] Failed to load/generate master key:', (err as Error).message);
    console.error('[NoteEncryption] Note encryption DISABLED — notes will be stored plaintext');
  }

  if (!masterKey && requireMasterKey) {
    throw new Error('Note encryption is mandatory but no master key is available');
  }

  // Permission verification only matters when the file fallback is in use.
  // If the key lives in the Keychain, the file may not exist — that is
  // the desired state going forward.
  if (masterKey && existsSync(MASTER_KEY_PATH)) {
    verifyPermissions(MASTER_KEY_DIR, 0o700, 'key directory');
    verifyPermissions(MASTER_KEY_PATH, 0o600, 'master key file');
  }

  function normalizeScope(scope?: string | null): string | null {
    const trimmed = typeof scope === 'string' ? scope.trim() : '';
    return trimmed || null;
  }

  function deriveWrappingKey(scope?: string | null): Buffer {
    if (!masterKey) throw new Error('Note encryption not enabled');
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope) return masterKey;
    return createHmac('sha256', masterKey)
      .update('port-daddy:note-wrap:v2')
      .update('\0')
      .update(normalizedScope)
      .digest();
  }

  function encrypt(plaintext: Buffer, key: Buffer, associatedData?: string | null): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const aad = normalizeScope(associatedData);
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      ct: ciphertext.toString('base64'),
      tag: tag.toString('base64'),
      v: 1,
    };
  }

  function decrypt(payload: EncryptedPayload, key: Buffer, associatedData?: string | null): Buffer | null {
    try {
      const iv = Buffer.from(payload.iv, 'base64');
      const ciphertext = Buffer.from(payload.ct, 'base64');
      const tag = Buffer.from(payload.tag, 'base64');

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      const aad = normalizeScope(associatedData);
      if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      return null;
    }
  }

  return {
    isEnabled() {
      return masterKey !== null;
    },

    generateSessionKey() {
      return randomBytes(KEY_LENGTH);
    },

    wrapSessionKey(sessionKey: Buffer, scope?: string | null): string {
      if (!masterKey) throw new Error('Note encryption not enabled');
      const normalizedScope = normalizeScope(scope);
      const payload = encrypt(sessionKey, deriveWrappingKey(normalizedScope), normalizedScope);
      if (normalizedScope) {
        payload.v = 2;
        payload.scope = normalizedScope;
        payload.kdf = 'hmac-sha256';
      }
      return JSON.stringify(payload);
    },

    unwrapSessionKey(wrapped: string, scope?: string | null): Buffer {
      if (!masterKey) throw new Error('Note encryption not enabled');
      const payload: EncryptedPayload = JSON.parse(wrapped);
      const payloadScope = normalizeScope(payload.scope);
      const expectedScope = normalizeScope(scope);
      let result: Buffer | null;

      if (payload.v === 2 || payloadScope) {
        if (!payloadScope) throw new Error('Scoped wrapped key missing scope');
        if (expectedScope && expectedScope !== payloadScope) {
          throw new Error('Wrapped session key scope mismatch');
        }
        result = decrypt(payload, deriveWrappingKey(payloadScope), payloadScope);
      } else {
        // Legacy v1 wraps used the install master key directly. Keep them
        // readable so old session notes do not become orphaned.
        result = decrypt(payload, masterKey);
      }
      if (!result) throw new Error('Failed to unwrap session key — master key mismatch?');
      return result;
    },

    encryptNote(plaintext: string, sessionKey: Buffer): string {
      const payload = encrypt(Buffer.from(plaintext, 'utf8'), sessionKey);
      return JSON.stringify(payload);
    },

    decryptNote(encrypted: string, sessionKey: Buffer): string | null {
      try {
        const payload: EncryptedPayload = JSON.parse(encrypted);
        if (payload.v !== 1 || !payload.iv || !payload.ct || !payload.tag) return null;
        const result = decrypt(payload, sessionKey);
        return result ? result.toString('utf8') : null;
      } catch {
        return null;
      }
    },

    isEncrypted(content: string): boolean {
      try {
        const parsed = JSON.parse(content);
        if (!parsed.iv || !parsed.ct || !parsed.tag) return false;
        if (parsed.v === 1) return true;
        return parsed.v === 2 && typeof parsed.scope === 'string' && parsed.kdf === 'hmac-sha256';
      } catch {
        return false;
      }
    },
  };
}
