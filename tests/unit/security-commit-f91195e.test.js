/**
 * Tests for commit f91195e — security: encrypt webhook secrets, verify key
 * permissions, pin dotenv paths.
 *
 * Changed files under test:
 *   lib/note-encryption.ts  — new verifyPermissions() code path
 *   lib/webhooks.ts         — encryptSecret/decryptSecret + HMAC path
 *
 * Tests annotated [BUG] will FAIL until the bug is fixed.
 * Tests annotated [GAP] fill coverage holes and should PASS.
 */

import { jest } from '@jest/globals';
import { randomBytes, createHmac } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

// =============================================================================
// Shared node:fs mock — affects both note-encryption and webhooks imports
// =============================================================================

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockStatSync = jest.fn();
const mockChmodSync = jest.fn();

jest.unstable_mockModule('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  statSync: mockStatSync,
  chmodSync: mockChmodSync,
}));

// Keep this default-install regression suite on its mocked filesystem even when
// the test runner deliberately selects a private PD_HOME for other suites.
jest.unstable_mockModule('../../shared/paths.js', () => ({ PD_HOME: join(homedir(), '.port-daddy') }));

// Import AFTER mock registration
const { createNoteEncryption } = await import('../../lib/note-encryption.js');
const { createTestDb, createMockFetch, waitFor } = await import('../setup-unit.js');
const { createWebhooks, WebhookEvent } = await import('../../lib/webhooks.js');

// =============================================================================
// lib/note-encryption.ts — verifyPermissions code path
// =============================================================================
//
// verifyPermissions() is called AFTER masterKey = readFileSync(...). If chmod
// fails, the outer try-catch logs "DISABLED" but never nulls masterKey.
// isEnabled() returns true when it must return false.

describe('note-encryption: verifyPermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // [GAP] Baseline: correct permissions → enabled
  test('isEnabled() returns true when key exists with correct permissions', () => {
    const key = randomBytes(32);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(key);
    // statSync returns correct mode for directory (0o700) and file (0o600)
    mockStatSync.mockImplementation((p) => ({
      mode: p.endsWith('master.key') ? 0o600 : 0o700,
    }));

    expect(createNoteEncryption().isEnabled()).toBe(true);
  });

  // [GAP] Auto-repair: wrong permissions but chmod succeeds → still enabled
  test('isEnabled() returns true when permissions are wrong but chmod succeeds', () => {
    const key = randomBytes(32);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(key);
    mockStatSync.mockReturnValue({ mode: 0o644 }); // world-readable
    mockChmodSync.mockImplementation(() => {}); // chmod succeeds

    expect(createNoteEncryption().isEnabled()).toBe(true);
  });

  // FIXED: verifyPermissions is now outside the graceful-degradation try-catch.
  // If chmod fails, createNoteEncryption() throws — "refuse to start".
  test('createNoteEncryption() throws when chmod fails (permissions unfixable)', () => {
    const key = randomBytes(32);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(key);
    mockStatSync.mockReturnValue({ mode: 0o644 }); // wrong — triggers chmod
    mockChmodSync.mockImplementation(() => {
      throw new Error('Operation not permitted');
    });

    expect(() => createNoteEncryption()).toThrow(/permissions|chmod|unfixable|Refusing/i);
  });

  // FIXED corollary: since createNoteEncryption() throws, callers never get
  // an instance with an exposed key. wrapSessionKey() is not reached.
  test('createNoteEncryption() throws before returning an instance when chmod fails', () => {
    const key = randomBytes(32);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(key);
    mockStatSync.mockReturnValue({ mode: 0o644 });
    mockChmodSync.mockImplementation(() => {
      throw new Error('Operation not permitted');
    });

    expect(() => createNoteEncryption()).toThrow();
  });

  // FIXED: `masterKey = null` added to the catch block. If mkdirSync throws,
  // the catch clears masterKey → isEnabled() is false.
  test('isEnabled() returns false when new key generation fails (mkdir error)', () => {
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    expect(createNoteEncryption().isEnabled()).toBe(false);
  });

  // Existing key corruption is never a request to replace encryption identity.
  test('invalid existing key throws without any regeneration write', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(randomBytes(16));
    mockMkdirSync.mockImplementation(() => {});
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('Read-only filesystem');
    });

    expect(() => createNoteEncryption()).toThrow(/invalid.*length/i);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  // FIXED: unwritten ephemeral key. masterKey is null after catch, so isEnabled()
  // is false and wrapSessionKey() throws 'not enabled'.
  test('wrapSessionKey() throws when key was generated but never persisted', () => {
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockImplementation(() => {});
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('Read-only filesystem'); // key never persisted
    });

    const enc = createNoteEncryption();
    expect(enc.isEnabled()).toBe(false);
    expect(() => enc.wrapSessionKey(enc.generateSessionKey())).toThrow();
  });
});

// =============================================================================
// lib/webhooks.ts — HMAC signature correctness
// =============================================================================
//
// The existing test (webhooks.test.js:381) only checks toMatch(/^sha256=/).
// That's COVERAGE THEATER — it passes whether the HMAC key is the plaintext
// secret, a ciphertext blob, or any other string.
//
// These tests assert the ACTUAL HMAC value to catch decryption bugs.

describe('webhooks: HMAC signature value correctness', () => {
  let db;
  let webhooks;
  let mockFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    // Force getMasterKey() in webhooks.ts to find no key file.
    // This means encryptSecret() returns plaintext and decryptSecret() returns
    // it unchanged — the simplest path that still exercises the full HMAC flow.
    mockExistsSync.mockReturnValue(false);

    db = createTestDb();
    webhooks = createWebhooks(db);
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    delete global.fetch;
  });

  // [GAP] Existing test only checks format. This one checks the VALUE.
  // If decryptSecret() returned a ciphertext blob instead of the plaintext,
  // the HMAC would not be verifiable with the original secret.
  test('delivered HMAC is verifiable with the original plaintext secret', async () => {
    const plainSecret = 'my-webhook-secret-abc123';

    webhooks.register('https://example.com/hook', { secret: plainSecret });
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, { port: 3000 });

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];

    const deliveredSig = call.opts.headers['X-PortDaddy-Signature'];
    expect(deliveredSig).toBeDefined();

    const body = JSON.parse(call.opts.body);
    const expectedSig = `sha256=${createHmac('sha256', plainSecret)
      .update(JSON.stringify(body))
      .digest('hex')}`;

    expect(deliveredSig).toBe(expectedSig);
  });

  // [GAP] No signature when no secret
  test('no X-PortDaddy-Signature header when no secret is configured', async () => {
    webhooks.register('https://example.com/hook');
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    expect(mockFetch.calls[0].opts.headers['X-PortDaddy-Signature']).toBeUndefined();
  });

  // [GAP] Multiple events use the same secret consistently
  test('two deliveries with the same secret produce independently verifiable HMACs', async () => {
    const secret = 'consistent-secret-xyz';
    webhooks.register('https://example.com/hook', { secret });

    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, { port: 3000 });
    webhooks.trigger(WebhookEvent.SERVICE_RELEASE, { port: 3000 });

    await waitFor(() => mockFetch.calls.length >= 2, 2000);

    for (const call of mockFetch.calls.slice(0, 2)) {
      const sig = call.opts.headers['X-PortDaddy-Signature'];
      const body = JSON.parse(call.opts.body);
      const expected = `sha256=${createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex')}`;
      expect(sig).toBe(expected);
    }
  });

  // [GAP] Pathological secret starting with '{' — decryptSecret() attempts to
  // parse it as a cipher envelope, fails the v !== 1 check (since it has no v
  // field), and returns stored. Verify the HMAC is still computed correctly.
  test('plaintext secret starting with "{" is used verbatim for HMAC', async () => {
    const weirdSecret = '{"key":"not-actually-encrypted"}';

    webhooks.register('https://example.com/hook', { secret: weirdSecret });
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];

    const body = JSON.parse(call.opts.body);
    const expectedSig = `sha256=${createHmac('sha256', weirdSecret)
      .update(JSON.stringify(body))
      .digest('hex')}`;

    expect(call.opts.headers['X-PortDaddy-Signature']).toBe(expectedSig);
  });

  // [GAP] MISSING NEGATIVE: secret that looks EXACTLY like a valid cipher
  // envelope (has v:1, ct, iv, tag) but no master key → returned as-is.
  // The HMAC must equal HMAC(the-full-json-string, plaintext), not garbage.
  test('secret that looks like a cipher envelope produces NO signature when no key', async () => {
    // A v1 envelope stored without a master key available cannot be decrypted.
    // The correct behavior is to omit the signature entirely — never use the
    // raw JSON envelope as an HMAC key (that would leak ciphertext structure).
    const envelopeSecret = JSON.stringify({ v: 1, ct: 'YWJj', iv: 'ZGVm', tag: 'Z2hp' });

    webhooks.register('https://example.com/hook', { secret: envelopeSecret });
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];

    // No signature — decryptSecret returns null when master key is unavailable
    expect(call.opts.headers['X-PortDaddy-Signature']).toBeUndefined();
  });
});

// =============================================================================
// lib/spawner.ts — uid-based dotenv ownership check (documented gap)
// =============================================================================
//
// loadDotenvOnce() has a new uid ownership check. Zero tests cover this.
// The function is module-internal and caches in a module-level variable,
// making unit-testing without a full module re-import difficult.
//
// This is flagged as a coverage gap. A dedicated test file using
// jest.unstable_mockModule('node:fs', ...) before a fresh spawner import
// would cover: owned-by-self → loaded, owned-by-root → skipped,
// statSync throws → skipped, process.getuid undefined → skip uid check.
//
// Tracking: add tests/unit/spawner-dotenv.test.js

test('spawner uid-check tests are a documented gap — see comment above', () => {
  // Placeholder so this describe block is visible in output
  expect(true).toBe(true);
});
