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

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LENGTH = 32;  // 256 bits
const IV_LENGTH = 12;   // GCM standard nonce
const TAG_LENGTH = 16;  // GCM standard tag

const MASTER_KEY_DIR = join(homedir(), '.port-daddy');
const MASTER_KEY_PATH = join(MASTER_KEY_DIR, 'master.key');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EncryptedPayload {
  /** Base64-encoded initialization vector */
  iv: string;
  /** Base64-encoded ciphertext */
  ct: string;
  /** Base64-encoded authentication tag */
  tag: string;
  /** Version marker for future algorithm changes */
  v: 1;
}

export interface NoteEncryption {
  /** Whether encryption is available (master key exists) */
  isEnabled(): boolean;

  /** Generate a new random session key */
  generateSessionKey(): Buffer;

  /** Wrap a session key with the master key for storage */
  wrapSessionKey(sessionKey: Buffer): string;

  /** Unwrap a session key using the master key */
  unwrapSessionKey(wrapped: string): Buffer;

  /** Encrypt note content with a session key */
  encryptNote(plaintext: string, sessionKey: Buffer): string;

  /** Decrypt note content with a session key. Returns null on failure. */
  decryptNote(encrypted: string, sessionKey: Buffer): string | null;

  /** Check if a content string is encrypted (vs plaintext legacy) */
  isEncrypted(content: string): boolean;
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

export function createNoteEncryption(): NoteEncryption {
  let masterKey: Buffer | null = null;

  // Load or generate master key. IO failures (missing file, full disk) disable
  // encryption gracefully. Permission failures propagate — callers must not start
  // with a key file that has insecure permissions.
  try {
    if (existsSync(MASTER_KEY_PATH)) {
      masterKey = readFileSync(MASTER_KEY_PATH);
      if (masterKey.length !== KEY_LENGTH) {
        console.error('[NoteEncryption] Master key wrong length, regenerating');
        masterKey = null;
      }
    }

    if (!masterKey) {
      masterKey = randomBytes(KEY_LENGTH);
      mkdirSync(MASTER_KEY_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(MASTER_KEY_PATH, masterKey, { mode: 0o600 });
      console.error('[NoteEncryption] Generated new master key at', MASTER_KEY_PATH);
    } else {
      console.error('[NoteEncryption] Master key loaded');
    }
  } catch (err) {
    masterKey = null; // Ensure encryption is truly disabled if initialization fails
    console.error('[NoteEncryption] Failed to load/generate master key:', (err as Error).message);
    console.error('[NoteEncryption] Note encryption DISABLED — notes will be stored plaintext');
  }

  // Permission verification is outside the graceful-degradation catch block.
  // If permissions are unfixable, this throws — callers must not proceed.
  if (masterKey) {
    verifyPermissions(MASTER_KEY_DIR, 0o700, 'key directory');
    verifyPermissions(MASTER_KEY_PATH, 0o600, 'master key file');
  }

  function encrypt(plaintext: Buffer, key: Buffer): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      ct: ciphertext.toString('base64'),
      tag: tag.toString('base64'),
      v: 1,
    };
  }

  function decrypt(payload: EncryptedPayload, key: Buffer): Buffer | null {
    try {
      const iv = Buffer.from(payload.iv, 'base64');
      const ciphertext = Buffer.from(payload.ct, 'base64');
      const tag = Buffer.from(payload.tag, 'base64');

      const decipher = createDecipheriv(ALGORITHM, key, iv);
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

    wrapSessionKey(sessionKey: Buffer): string {
      if (!masterKey) throw new Error('Note encryption not enabled');
      const payload = encrypt(sessionKey, masterKey);
      return JSON.stringify(payload);
    },

    unwrapSessionKey(wrapped: string): Buffer {
      if (!masterKey) throw new Error('Note encryption not enabled');
      const payload: EncryptedPayload = JSON.parse(wrapped);
      const result = decrypt(payload, masterKey);
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
        return parsed.v === 1 && parsed.iv && parsed.ct && parsed.tag;
      } catch {
        return false;
      }
    },
  };
}
