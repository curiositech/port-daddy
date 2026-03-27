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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

// ─── Implementation ─────────────────────────────────────────────────────────

export function createNoteEncryption(): NoteEncryption {
  let masterKey: Buffer | null = null;

  // Load or generate master key
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
      mkdirSync(MASTER_KEY_DIR, { recursive: true });
      writeFileSync(MASTER_KEY_PATH, masterKey, { mode: 0o600 });
      console.error('[NoteEncryption] Generated new master key at', MASTER_KEY_PATH);
    } else {
      console.error('[NoteEncryption] Master key loaded');
    }
  } catch (err) {
    console.error('[NoteEncryption] Failed to load/generate master key:', (err as Error).message);
    console.error('[NoteEncryption] Note encryption DISABLED — notes will be stored plaintext');
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
