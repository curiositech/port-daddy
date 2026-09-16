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
import * as scopedFs from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { keychain, KEYCHAIN_SERVICE } from './keychain.js';
import { PD_HOME } from '../shared/paths.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LENGTH = 32;  // 256 bits
const IV_LENGTH = 12;   // GCM standard nonce
const TAG_LENGTH = 16;  // GCM standard tag

const MASTER_KEY_DIR = PD_HOME;
const MASTER_KEY_PATH = join(MASTER_KEY_DIR, 'master.key');
const SCOPED_KEY_ROOT = resolve(MASTER_KEY_DIR) !== resolve(join(homedir(), '.port-daddy'));

/** Existing key corruption is never permission to replace encryption identity. */
class InvalidMasterKeyError extends Error {}

/** Keychain account for the master key. One per install. */
const KEYCHAIN_ACCOUNT = 'master-key';

/**
 * Load the master key from the OS keychain. Delegates to the shared
 * primitive; converts hex → Buffer and validates length. Returns null when
 * unavailable or absent; malformed existing values throw rather than regenerate.
 * The design preserves encryption identity instead of silently replacing it.
 *
 * @returns The existing valid master key, or null when no key is available.
 * @throws InvalidMasterKeyError when an existing value is malformed.
 */
function loadKeyFromKeychain(): Buffer | null {
  const hex = keychain.loadSecret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  if (hex === null) return null;
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new InvalidMasterKeyError('Invalid existing Keychain master key');
  return Buffer.from(hex, 'hex');
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
   * back to plaintext note storage. Explicit scoped storage and invalid existing
   * keys always fail, independently of this option.
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

/**
 * Inspect scoped storage without repairing it: the purpose is to reject foreign
 * or aliased storage before a key read, not change another directory's ownership.
 *
 * @returns The verified directory inode for a post-operation identity check.
 */
function inspectScopedKeyDirectory(): scopedFs.Stats {
  const directory = scopedFs.lstatSync(MASTER_KEY_DIR);
  if (!directory.isDirectory() || directory.isSymbolicLink()
      || scopedFs.realpathSync(MASTER_KEY_DIR) !== resolve(MASTER_KEY_DIR)) {
    throw new Error('Scoped master-key storage must be a real directory without symlinks');
  }
  if (typeof process.getuid === 'function' && directory.uid !== process.getuid()) {
    throw new Error('Scoped master-key directory ownership does not match this process');
  }
  if ((directory.mode & 0o777) !== 0o700) throw new Error('Scoped master-key directory permissions must be 0700');
  return directory;
}

/**
 * Load one private file key or create it exclusively. Design: no canonical
 * Keychain fallback, no symlink following, and no concurrent-creator overwrite.
 * The directory remains a same-user resource, not a filesystem sandbox.
 *
 * @returns A verified 32-byte key held only in process memory.
 */
function loadScopedFileMasterKey(): Buffer {
  const directory = inspectScopedKeyDirectory();
  let existing: scopedFs.Stats | undefined;
  try { existing = scopedFs.lstatSync(MASTER_KEY_PATH); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) {
    throw new Error('Scoped master key must be a regular file without symbolic or hard links');
  }
  if (typeof scopedFs.constants.O_NOFOLLOW !== 'number') throw new Error('Scoped master-key no-follow support is unavailable');
  const flags = scopedFs.constants.O_NOFOLLOW | scopedFs.constants.O_NONBLOCK | (existing
    ? scopedFs.constants.O_RDONLY
    : scopedFs.constants.O_WRONLY | scopedFs.constants.O_CREAT | scopedFs.constants.O_EXCL);
  const fd = scopedFs.openSync(MASTER_KEY_PATH, flags, 0o600);
  try {
    const file = scopedFs.fstatSync(fd);
    if (!file.isFile() || file.nlink !== 1 || (existing && (file.dev !== existing.dev || file.ino !== existing.ino))) {
      throw new Error('Scoped master-key regular file identity changed during initialization');
    }
    if (typeof process.getuid === 'function' && file.uid !== process.getuid()) {
      throw new Error('Scoped master-key file ownership does not match this process');
    }
    if ((file.mode & 0o777) !== 0o600) throw new Error('Scoped master-key file permissions must be 0600');
    let key: Buffer;
    if (existing) {
      if (file.size !== KEY_LENGTH) throw new InvalidMasterKeyError('Invalid existing master-key length; expected 32 bytes');
      key = Buffer.alloc(KEY_LENGTH);
      const extra = Buffer.alloc(1);
      if (scopedFs.readSync(fd, key, 0, KEY_LENGTH, 0) !== KEY_LENGTH
          || scopedFs.readSync(fd, extra, 0, 1, KEY_LENGTH) !== 0) {
        throw new InvalidMasterKeyError('Existing master-key length changed during bounded read');
      }
    } else {
      key = randomBytes(KEY_LENGTH);
    }
    if (!existing) {
      scopedFs.writeFileSync(fd, key);
      scopedFs.fsyncSync(fd);
    }
    const after = inspectScopedKeyDirectory();
    if (after.dev !== directory.dev || after.ino !== directory.ino) {
      throw new Error('Scoped master-key directory identity changed during initialization');
    }
    const finalFile = scopedFs.fstatSync(fd);
    const finalPath = scopedFs.lstatSync(MASTER_KEY_PATH);
    if (!finalPath.isFile() || finalPath.isSymbolicLink() || finalPath.nlink !== 1
        || finalFile.nlink !== 1 || finalFile.size !== KEY_LENGTH
        || finalPath.size !== KEY_LENGTH || finalPath.dev !== file.dev || finalPath.ino !== file.ino
        || (finalFile.mode & 0o777) !== 0o600 || finalFile.uid !== file.uid
        || (existing && (finalFile.mtimeMs !== file.mtimeMs || finalFile.ctimeMs !== file.ctimeMs))) {
      throw new Error('Scoped master-key pathname or file identity changed during initialization');
    }
    return key;
  } finally {
    scopedFs.closeSync(fd);
  }
}

/**
 * Initialize session-note encryption with its selected storage identity.
 * Design: canonical installs retain Keychain preference; explicit private roots
 * cannot borrow the canonical key or silently replace existing key material.
 *
 * @param options Whether an unavailable default-install master key is fatal.
 * @returns The note encryption interface bound to this initialization's key.
 */
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
    if (SCOPED_KEY_ROOT) {
      if (process.env.PORT_DADDY_DISABLE_KEYCHAIN !== '1') {
        throw new Error('Scoped note encryption requires PORT_DADDY_DISABLE_KEYCHAIN=1; canonical Keychain access is refused');
      }
      masterKey = loadScopedFileMasterKey();
    }
    // Tier 1: Keychain
    if (!SCOPED_KEY_ROOT) masterKey = loadKeyFromKeychain();
    if (masterKey && !SCOPED_KEY_ROOT) {
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
        throw new InvalidMasterKeyError('Invalid existing master-key length; expected 32 bytes');
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
        writeFileSync(MASTER_KEY_PATH, masterKey, { mode: 0o600, flag: 'wx' });
        console.error(
          '[NoteEncryption] Generated new master key at', MASTER_KEY_PATH,
          keychainAvailable()
            ? '(Keychain write failed — file fallback)'
            : '(Keychain unavailable on this platform — file fallback)',
        );
      }
    }
  } catch (err) {
    if (requireMasterKey || SCOPED_KEY_ROOT || err instanceof InvalidMasterKeyError) {
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
  if (masterKey && !SCOPED_KEY_ROOT && existsSync(MASTER_KEY_PATH)) {
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
