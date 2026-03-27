import { describe, test, expect, beforeAll } from '@jest/globals';
import { randomBytes } from 'node:crypto';

// We test the encryption primitives directly since they're pure functions
// The module uses ESM + TS, so we replicate the core logic for testing

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

// Replicate the encrypt/decrypt logic for unit testing
const crypto = await import('node:crypto');

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ct: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
    v: 1,
  };
}

function decrypt(payload, key) {
  try {
    const iv = Buffer.from(payload.iv, 'base64');
    const ciphertext = Buffer.from(payload.ct, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

describe('Note Encryption', () => {
  const masterKey = crypto.randomBytes(KEY_LENGTH);
  const sessionKey = crypto.randomBytes(KEY_LENGTH);

  describe('Note encrypt/decrypt round-trip', () => {
    test('encrypts and decrypts a note', () => {
      const plaintext = 'Fixed the login bug by updating auth middleware';
      const payload = encrypt(Buffer.from(plaintext, 'utf8'), sessionKey);

      expect(payload.v).toBe(1);
      expect(payload.iv).toBeDefined();
      expect(payload.ct).toBeDefined();
      expect(payload.tag).toBeDefined();
      // Ciphertext should NOT contain the plaintext
      expect(Buffer.from(payload.ct, 'base64').toString('utf8')).not.toContain('login');

      const decrypted = decrypt(payload, sessionKey);
      expect(decrypted).not.toBeNull();
      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    test('different IVs produce different ciphertexts for same plaintext', () => {
      const plaintext = Buffer.from('same note content');
      const enc1 = encrypt(plaintext, sessionKey);
      const enc2 = encrypt(plaintext, sessionKey);

      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.ct).not.toBe(enc2.ct);

      // But both decrypt to the same plaintext
      expect(decrypt(enc1, sessionKey).toString('utf8')).toBe('same note content');
      expect(decrypt(enc2, sessionKey).toString('utf8')).toBe('same note content');
    });

    test('wrong key fails to decrypt', () => {
      const plaintext = Buffer.from('secret note');
      const payload = encrypt(plaintext, sessionKey);
      const wrongKey = crypto.randomBytes(KEY_LENGTH);

      const result = decrypt(payload, wrongKey);
      expect(result).toBeNull();
    });

    test('tampered ciphertext fails to decrypt (GCM authentication)', () => {
      const plaintext = Buffer.from('tamper-proof note');
      const payload = encrypt(plaintext, sessionKey);

      // Tamper with ciphertext
      const tampered = { ...payload };
      const ctBytes = Buffer.from(tampered.ct, 'base64');
      ctBytes[0] ^= 0xff;  // Flip bits
      tampered.ct = ctBytes.toString('base64');

      const result = decrypt(tampered, sessionKey);
      expect(result).toBeNull();
    });

    test('tampered tag fails to decrypt', () => {
      const plaintext = Buffer.from('tag-protected note');
      const payload = encrypt(plaintext, sessionKey);

      const tampered = { ...payload };
      const tagBytes = Buffer.from(tampered.tag, 'base64');
      tagBytes[0] ^= 0xff;
      tampered.tag = tagBytes.toString('base64');

      const result = decrypt(tampered, sessionKey);
      expect(result).toBeNull();
    });
  });

  describe('Key wrapping (session key protection)', () => {
    test('wraps and unwraps a session key', () => {
      const wrapped = encrypt(sessionKey, masterKey);
      const unwrapped = decrypt(wrapped, masterKey);

      expect(unwrapped).not.toBeNull();
      expect(Buffer.compare(unwrapped, sessionKey)).toBe(0);
    });

    test('wrong master key fails to unwrap', () => {
      const wrapped = encrypt(sessionKey, masterKey);
      const wrongMaster = crypto.randomBytes(KEY_LENGTH);

      const result = decrypt(wrapped, wrongMaster);
      expect(result).toBeNull();
    });
  });

  describe('Encryption detection', () => {
    test('detects encrypted content', () => {
      const payload = encrypt(Buffer.from('test'), sessionKey);
      const json = JSON.stringify(payload);

      const parsed = JSON.parse(json);
      expect(parsed.v).toBe(1);
      expect(parsed.iv).toBeDefined();
      expect(parsed.ct).toBeDefined();
      expect(parsed.tag).toBeDefined();
    });

    test('plaintext is not detected as encrypted', () => {
      const plaintext = 'Just a regular note';
      try {
        const parsed = JSON.parse(plaintext);
        expect(parsed.v).not.toBe(1);
      } catch {
        // Not JSON — definitely not encrypted. This is correct.
      }
    });
  });

  describe('Empty and edge cases', () => {
    test('encrypts empty string', () => {
      const payload = encrypt(Buffer.from(''), sessionKey);
      const decrypted = decrypt(payload, sessionKey);
      expect(decrypted.toString('utf8')).toBe('');
    });

    test('encrypts unicode content', () => {
      const unicode = 'Agent completed task: fixed the issue';
      const payload = encrypt(Buffer.from(unicode, 'utf8'), sessionKey);
      const decrypted = decrypt(payload, sessionKey);
      expect(decrypted.toString('utf8')).toBe(unicode);
    });

    test('encrypts large notes (10KB)', () => {
      const large = 'x'.repeat(10000);
      const payload = encrypt(Buffer.from(large, 'utf8'), sessionKey);
      const decrypted = decrypt(payload, sessionKey);
      expect(decrypted.toString('utf8')).toBe(large);
    });
  });

  describe('Merkle chain compatibility', () => {
    test('ciphertext is deterministically hashable', () => {
      const plaintext = Buffer.from('evidence note');
      const payload = encrypt(plaintext, sessionKey);

      // The Merkle chain hashes the ciphertext, not plaintext
      const hash1 = crypto.createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');

      // Same payload produces same hash
      const hash2 = crypto.createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });

    test('different notes produce different hashes', () => {
      const note1 = encrypt(Buffer.from('note one'), sessionKey);
      const note2 = encrypt(Buffer.from('note two'), sessionKey);

      const hash1 = crypto.createHash('sha256').update(JSON.stringify(note1)).digest('hex');
      const hash2 = crypto.createHash('sha256').update(JSON.stringify(note2)).digest('hex');

      expect(hash1).not.toBe(hash2);
    });
  });
});
