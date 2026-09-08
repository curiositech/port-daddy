/**
 * Unit Tests for lib/note-encryption.ts — actual module import
 *
 * Tests the NoteEncryption module directly (as opposed to note-encryption.test.js
 * which only tests the raw crypto primitives).
 *
 * Actual module initialization uses a private fixture PD_HOME with Keychain
 * disabled. Tests must never consult or create the operator's real master key.
 */

import { afterAll, beforeAll, describe, test, expect, jest } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const scratch = join(homedir(), 'coding', 'tmp');
mkdirSync(scratch, { recursive: true });
const fixture = mkdtempSync(join(scratch, 'note-encryption-module-fixture-'));
let enc;
let selectedHome;

beforeAll(async () => {
  const previous = { PD_HOME: process.env.PD_HOME, PORT_DADDY_DISABLE_KEYCHAIN: process.env.PORT_DADDY_DISABLE_KEYCHAIN };
  process.env.PD_HOME = fixture;
  process.env.PORT_DADDY_DISABLE_KEYCHAIN = '1';
  try {
    await jest.isolateModulesAsync(async () => {
      const { createNoteEncryption } = await import('../../lib/note-encryption.js');
      selectedHome = (await import('../../shared/paths.js')).PD_HOME;
      enc = createNoteEncryption({ requireMasterKey: true });
    });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

test('initializes the real module with its own private file key', () => {
  expect(selectedHome).toBe(fixture);
  expect(selectedHome).not.toBe(join(homedir(), '.port-daddy'));
  expect(readFileSync(join(fixture, 'master.key'))).toHaveLength(32);
  expect(statSync(fixture).mode & 0o777).toBe(0o700);
  expect(statSync(join(fixture, 'master.key')).mode & 0o777).toBe(0o600);
});

// ─── isEnabled() ─────────────────────────────────────────────────────────────

describe('isEnabled()', () => {
  test('returns a boolean', () => {
    expect(typeof enc.isEnabled()).toBe('boolean');
  });

  test('returns true when master key was loaded or generated', () => {
    // In test environment, master key should always be creatable
    expect(enc.isEnabled()).toBe(true);
  });
});

// ─── generateSessionKey() ────────────────────────────────────────────────────

describe('generateSessionKey()', () => {
  test('returns a Buffer', () => {
    const key = enc.generateSessionKey();
    expect(Buffer.isBuffer(key)).toBe(true);
  });

  test('returns a 32-byte key (256 bits)', () => {
    const key = enc.generateSessionKey();
    expect(key.length).toBe(32);
  });

  test('generates unique keys each call', () => {
    const k1 = enc.generateSessionKey();
    const k2 = enc.generateSessionKey();
    expect(Buffer.compare(k1, k2)).not.toBe(0);
  });
});

// ─── wrapSessionKey() / unwrapSessionKey() ───────────────────────────────────

describe('wrapSessionKey() / unwrapSessionKey()', () => {
  test('wraps a session key to a JSON string', () => {
    const sessionKey = enc.generateSessionKey();
    const wrapped = enc.wrapSessionKey(sessionKey);
    expect(typeof wrapped).toBe('string');
    // Should be valid JSON with EncryptedPayload shape
    const parsed = JSON.parse(wrapped);
    expect(parsed.v).toBe(1);
    expect(parsed.iv).toBeDefined();
    expect(parsed.ct).toBeDefined();
    expect(parsed.tag).toBeDefined();
  });

  test('unwraps correctly — round-trip preserves key', () => {
    const sessionKey = enc.generateSessionKey();
    const wrapped = enc.wrapSessionKey(sessionKey);
    const unwrapped = enc.unwrapSessionKey(wrapped);
    expect(Buffer.compare(unwrapped, sessionKey)).toBe(0);
  });

  test('wraps session keys with a harbor scope when supplied', () => {
    const sessionKey = enc.generateSessionKey();
    const wrapped = enc.wrapSessionKey(sessionKey, 'workgroup-ai:fleet');
    const parsed = JSON.parse(wrapped);

    expect(parsed.v).toBe(2);
    expect(parsed.scope).toBe('workgroup-ai:fleet');
    expect(parsed.kdf).toBe('hmac-sha256');
    expect(Buffer.compare(enc.unwrapSessionKey(wrapped, 'workgroup-ai:fleet'), sessionKey)).toBe(0);
    expect(() => enc.unwrapSessionKey(wrapped, 'port-daddy:fleet')).toThrow(/scope mismatch/);
  });

  test('different session keys produce different wrapped outputs', () => {
    const k1 = enc.generateSessionKey();
    const k2 = enc.generateSessionKey();
    const w1 = enc.wrapSessionKey(k1);
    const w2 = enc.wrapSessionKey(k2);
    expect(w1).not.toBe(w2);
  });

  test('two wraps of the same key produce different IVs (randomized)', () => {
    const key = enc.generateSessionKey();
    const w1 = JSON.parse(enc.wrapSessionKey(key));
    const w2 = JSON.parse(enc.wrapSessionKey(key));
    expect(w1.iv).not.toBe(w2.iv);
  });

  test('throws when unwrapping invalid JSON', () => {
    expect(() => enc.unwrapSessionKey('not-json')).toThrow();
  });

  test('throws when unwrapping tampered ciphertext', () => {
    const key = enc.generateSessionKey();
    const wrapped = JSON.parse(enc.wrapSessionKey(key));
    // Tamper with the ciphertext
    const ctBytes = Buffer.from(wrapped.ct, 'base64');
    ctBytes[0] ^= 0xff;
    wrapped.ct = ctBytes.toString('base64');
    const tamperedStr = JSON.stringify(wrapped);
    expect(() => enc.unwrapSessionKey(tamperedStr)).toThrow();
  });
});

// ─── encryptNote() / decryptNote() ───────────────────────────────────────────

describe('encryptNote() / decryptNote()', () => {
  test('encrypts note content to a JSON string', () => {
    const sessionKey = enc.generateSessionKey();
    const plaintext = 'Fixed the login bug in auth middleware';
    const encrypted = enc.encryptNote(plaintext, sessionKey);

    expect(typeof encrypted).toBe('string');
    const parsed = JSON.parse(encrypted);
    expect(parsed.v).toBe(1);
    expect(parsed.iv).toBeDefined();
    expect(parsed.ct).toBeDefined();
    expect(parsed.tag).toBeDefined();
  });

  test('ciphertext does not contain plaintext', () => {
    const sessionKey = enc.generateSessionKey();
    const plaintext = 'my-secret-note-content';
    const encrypted = enc.encryptNote(plaintext, sessionKey);
    expect(encrypted).not.toContain('my-secret-note-content');
  });

  test('decrypts back to original plaintext', () => {
    const sessionKey = enc.generateSessionKey();
    const plaintext = 'Agent completed task: refactored auth module';
    const encrypted = enc.encryptNote(plaintext, sessionKey);
    const decrypted = enc.decryptNote(encrypted, sessionKey);
    expect(decrypted).toBe(plaintext);
  });

  test('returns null when decrypting with wrong key', () => {
    const key1 = enc.generateSessionKey();
    const key2 = enc.generateSessionKey();
    const encrypted = enc.encryptNote('secret content', key1);
    const result = enc.decryptNote(encrypted, key2);
    expect(result).toBeNull();
  });

  test('returns null for tampered ciphertext', () => {
    const sessionKey = enc.generateSessionKey();
    const encrypted = JSON.parse(enc.encryptNote('tamper test', sessionKey));
    const ctBytes = Buffer.from(encrypted.ct, 'base64');
    ctBytes[0] ^= 0xff;
    encrypted.ct = ctBytes.toString('base64');
    const result = enc.decryptNote(JSON.stringify(encrypted), sessionKey);
    expect(result).toBeNull();
  });

  test('returns null for tampered auth tag', () => {
    const sessionKey = enc.generateSessionKey();
    const encrypted = JSON.parse(enc.encryptNote('tag test', sessionKey));
    const tagBytes = Buffer.from(encrypted.tag, 'base64');
    tagBytes[0] ^= 0xff;
    encrypted.tag = tagBytes.toString('base64');
    const result = enc.decryptNote(JSON.stringify(encrypted), sessionKey);
    expect(result).toBeNull();
  });

  test('returns null for non-JSON input', () => {
    const sessionKey = enc.generateSessionKey();
    const result = enc.decryptNote('not json', sessionKey);
    expect(result).toBeNull();
  });

  test('returns null for JSON missing required fields', () => {
    const sessionKey = enc.generateSessionKey();
    // Missing tag field
    const result = enc.decryptNote(JSON.stringify({ v: 1, iv: 'abc', ct: 'def' }), sessionKey);
    expect(result).toBeNull();
  });

  test('returns null for wrong version number', () => {
    const sessionKey = enc.generateSessionKey();
    const result = enc.decryptNote(
      JSON.stringify({ v: 99, iv: 'abc', ct: 'def', tag: 'ghi' }),
      sessionKey
    );
    expect(result).toBeNull();
  });

  test('encrypts empty string (decryptNote returns null due to empty ciphertext check)', () => {
    // AES-GCM on empty plaintext produces empty ciphertext (empty base64 string).
    // decryptNote guards against empty fields with `!payload.ct`, so it returns null.
    // This tests the actual behavior of the module.
    const sessionKey = enc.generateSessionKey();
    const encrypted = enc.encryptNote('', sessionKey);
    const decrypted = enc.decryptNote(encrypted, sessionKey);
    // Empty ciphertext fails the !payload.ct guard — returns null
    expect(decrypted).toBeNull();
  });

  test('encrypts unicode content', () => {
    const sessionKey = enc.generateSessionKey();
    const unicode = 'Agent résumé: tâche complétée — 完成任务';
    const encrypted = enc.encryptNote(unicode, sessionKey);
    const decrypted = enc.decryptNote(encrypted, sessionKey);
    expect(decrypted).toBe(unicode);
  });

  test('encrypts large content (10KB)', () => {
    const sessionKey = enc.generateSessionKey();
    const large = 'a'.repeat(10000);
    const encrypted = enc.encryptNote(large, sessionKey);
    const decrypted = enc.decryptNote(encrypted, sessionKey);
    expect(decrypted).toBe(large);
  });

  test('two encryptions of same content produce different IVs', () => {
    const sessionKey = enc.generateSessionKey();
    const e1 = JSON.parse(enc.encryptNote('same content', sessionKey));
    const e2 = JSON.parse(enc.encryptNote('same content', sessionKey));
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.ct).not.toBe(e2.ct);
  });
});

// ─── isEncrypted() ───────────────────────────────────────────────────────────

describe('isEncrypted()', () => {
  test('returns truthy for encrypted content', () => {
    const sessionKey = enc.generateSessionKey();
    const encrypted = enc.encryptNote('test content', sessionKey);
    expect(enc.isEncrypted(encrypted)).toBeTruthy();
  });

  test('returns falsy for plaintext strings', () => {
    expect(enc.isEncrypted('Just a regular note about fixing bugs')).toBeFalsy();
  });

  test('returns falsy for arbitrary JSON without v:1', () => {
    expect(enc.isEncrypted(JSON.stringify({ foo: 'bar' }))).toBeFalsy();
  });

  test('returns falsy for JSON with wrong version', () => {
    const content = JSON.stringify({ v: 2, iv: 'abc', ct: 'def', tag: 'ghi' });
    expect(enc.isEncrypted(content)).toBeFalsy();
  });

  test('returns falsy for JSON missing iv/ct/tag', () => {
    expect(enc.isEncrypted(JSON.stringify({ v: 1 }))).toBeFalsy();
  });

  test('returns false for empty string', () => {
    expect(enc.isEncrypted('')).toBe(false);
  });

  test('returns false for non-JSON string', () => {
    expect(enc.isEncrypted('not-json!')).toBe(false);
  });

  test('wrapped session key is also detected as encrypted', () => {
    const sessionKey = enc.generateSessionKey();
    const wrapped = enc.wrapSessionKey(sessionKey);
    expect(enc.isEncrypted(wrapped)).toBeTruthy();
  });
});

// ─── Full round-trip (envelope encryption) ───────────────────────────────────

describe('Full envelope encryption round-trip', () => {
  test('wrap key → encrypt note → unwrap key → decrypt note', () => {
    const sessionKey = enc.generateSessionKey();
    const plaintext = 'Critical finding: null pointer in auth.ts line 42';

    // Session key is wrapped with master key for storage
    const wrappedKey = enc.wrapSessionKey(sessionKey);

    // Note is encrypted with session key
    const encryptedNote = enc.encryptNote(plaintext, sessionKey);

    // Later: unwrap session key, decrypt note
    const recoveredKey = enc.unwrapSessionKey(wrappedKey);
    const decrypted = enc.decryptNote(encryptedNote, recoveredKey);

    expect(decrypted).toBe(plaintext);
  });

  test('isEncrypted correctly identifies encrypted vs plaintext notes', () => {
    const sessionKey = enc.generateSessionKey();
    const plainNote = 'This is a legacy plaintext note';
    const encNote = enc.encryptNote('This is encrypted', sessionKey);

    expect(enc.isEncrypted(plainNote)).toBeFalsy();
    expect(enc.isEncrypted(encNote)).toBeTruthy();
  });
});
