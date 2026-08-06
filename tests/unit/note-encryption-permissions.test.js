/**
 * Tests for the verifyPermissions code path added in f91195e.
 *
 * Bug #2: verifyPermissions throws when chmod fails, but the throw is caught
 * by the outer try-catch in createNoteEncryption(). The daemon starts with
 * encryption silently disabled instead of refusing to start, contradicting
 * the commit message "Refuse to start if permissions unfixable".
 *
 * These tests must be in a separate file because they mock node:fs before
 * import — Jest module mocks are per-file.
 */

import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock node:fs — must be hoisted before the module under test is imported
// ---------------------------------------------------------------------------

const mockStat = jest.fn();
const mockChmod = jest.fn();
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();

jest.unstable_mockModule('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  statSync: mockStat,
  chmodSync: mockChmod,
}));

const { createNoteEncryption } = await import('../../lib/note-encryption.js');

// These tests deliberately drive createNoteEncryption() through its failure
// paths (bad permissions, chmod/statSync errors), which log via console.error
// by design. Silence it so CI output isn't drowned in expected, asserted-on
// error logs.
let consoleErrorSpy;
beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  consoleErrorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid 32-byte key */
const VALID_KEY = Buffer.alloc(32, 0xab);

function setupKeyExists({ dirMode = 0o700, keyMode = 0o600 } = {}) {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(VALID_KEY);
  mockStat.mockImplementation((p) => {
    if (p.endsWith('master.key')) return { mode: 0o100000 | keyMode };
    return { mode: 0o40000 | dirMode }; // directory
  });
}

// ---------------------------------------------------------------------------
// Happy path: correct permissions
// ---------------------------------------------------------------------------

describe('verifyPermissions — correct permissions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not call chmodSync when dir=0o700 and file=0o600', () => {
    setupKeyExists({ dirMode: 0o700, keyMode: 0o600 });

    const enc = createNoteEncryption();

    expect(enc.isEnabled()).toBe(true);
    expect(mockChmod).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fixable permissions: wrong mode, chmod succeeds
// ---------------------------------------------------------------------------

describe('verifyPermissions — fixable permissions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls chmodSync and enables encryption when key file has 0o644 but chmod succeeds', () => {
    setupKeyExists({ dirMode: 0o700, keyMode: 0o644 });
    mockChmod.mockImplementation(() => {
      // chmod succeeds — update the stat mock so second call returns 0o600
      mockStat.mockImplementation((p) => {
        if (p.endsWith('master.key')) return { mode: 0o100000 | 0o600 };
        return { mode: 0o40000 | 0o700 };
      });
    });

    const enc = createNoteEncryption();

    expect(mockChmod).toHaveBeenCalled();
    expect(enc.isEnabled()).toBe(true);
  });

  it('calls chmodSync on directory when dir has 0o755 but chmod succeeds', () => {
    setupKeyExists({ dirMode: 0o755, keyMode: 0o600 });
    mockChmod.mockImplementation(() => {
      mockStat.mockImplementation((p) => {
        if (p.endsWith('master.key')) return { mode: 0o100600 };
        return { mode: 0o40700 };
      });
    });

    const enc = createNoteEncryption();

    expect(mockChmod).toHaveBeenCalled();
    expect(enc.isEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug #2: unfixable permissions — should throw, not silently degrade
// ---------------------------------------------------------------------------

describe('verifyPermissions — unfixable permissions (Bug #2)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws when key file permissions are wrong and chmod fails', () => {
    setupKeyExists({ dirMode: 0o700, keyMode: 0o644 });
    mockChmod.mockImplementation(() => {
      throw new Error('Operation not permitted');
    });

    // Bug #2: currently the throw is caught and encryption is silently disabled.
    // The correct behavior (per commit intent) is to refuse to start with an error.
    //
    // This test FAILS against current code because createNoteEncryption() swallows
    // the exception and returns an object with isEnabled()===false instead of throwing.
    expect(() => createNoteEncryption()).toThrow(/permissions|chmod|unfixable|Refusing/i);
  });

  it('throws when directory permissions are wrong and chmod fails', () => {
    setupKeyExists({ dirMode: 0o755, keyMode: 0o600 });
    mockChmod.mockImplementation(() => {
      throw new Error('EPERM: operation not permitted');
    });

    expect(() => createNoteEncryption()).toThrow(/permissions|chmod|unfixable|Refusing/i);
  });

  it('does NOT silently return isEnabled()===false when permissions are unfixable', () => {
    setupKeyExists({ dirMode: 0o644, keyMode: 0o644 });
    mockChmod.mockImplementation(() => {
      throw new Error('EPERM');
    });

    // This is the observable symptom of Bug #2: instead of throwing, the
    // module returns a degraded instance that silently stores notes as plaintext.
    let enc;
    let threw = false;
    try {
      enc = createNoteEncryption();
    } catch {
      threw = true;
    }

    // Either must throw, or — if it returns — encryption must still be enabled
    // (fix the permissions via another mechanism). It must NOT silently disable
    // encryption and return isEnabled()===false.
    if (!threw) {
      expect(enc.isEnabled()).toBe(true); // will fail if bug is present
    }
  });
});

// ---------------------------------------------------------------------------
// statSync failure (key dir or file not accessible)
// ---------------------------------------------------------------------------

describe('verifyPermissions — statSync failure', () => {
  beforeEach(() => jest.clearAllMocks());

  it('propagates error when statSync throws on key directory', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(VALID_KEY);
    mockStat.mockImplementation((p) => {
      if (!p.endsWith('master.key')) {
        throw new Error('EACCES: permission denied, stat');
      }
      return { mode: 0o100600 };
    });

    // statSync throwing on the directory is a hard failure — cannot verify safety
    // The module should not silently continue with a key it can't verify.
    expect(() => createNoteEncryption()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Strict daemon mode — master key is mandatory, not best-effort
// ---------------------------------------------------------------------------

describe('requireMasterKey strict mode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws when master-key generation fails in strict mode', () => {
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => createNoteEncryption({ requireMasterKey: true })).toThrow(/mandatory|master-key initialization failed/i);
  });
});
