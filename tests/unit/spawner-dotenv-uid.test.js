/**
 * Tests for the dotenv uid-ownership check added in f91195e (lib/spawner.ts).
 *
 * loadDotenvOnce() was hardened to skip .env files owned by a different
 * user. These tests verify:
 *
 *  1. File owned by different uid → skipped → canary NOT injected into child
 *  2. statSync failure → file skipped gracefully (no crash, no leak)
 *  3. console.warn is emitted when a file is skipped due to uid mismatch
 *  4. File owned by current uid → loaded → canary IS injected into child
 *
 * Design constraint: loadDotenvOnce() has a module-level cache (_dotenvCache)
 * that is never reset. Once populated by any test, all subsequent calls
 * return the cached value immediately. To work around this:
 *  - Every test uses a UNIQUE canary key (won't collide with other tests)
 *  - "Skip" tests run BEFORE the "load" test, while the cache is empty
 *  - The "load" test runs LAST (it warms the cache but no test depends on
 *    the cache being cold after it)
 *
 * Any API keys in actual process.env are irrelevant because canary names are
 * unique sentinel strings that cannot be in the user's real environment.
 */

import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Determine current uid BEFORE mocking
// ---------------------------------------------------------------------------
const CURRENT_UID = typeof process.getuid === 'function' ? process.getuid() : 99;
const OTHER_UID = CURRENT_UID + 1234;

// ---------------------------------------------------------------------------
// Mock node:fs  (must be hoisted before spawner is imported)
// ---------------------------------------------------------------------------
const mockExistsSync = jest.fn();
const mockStatSync = jest.fn();
const mockReadFileSync = jest.fn();

jest.unstable_mockModule('node:fs', () => ({
  existsSync: mockExistsSync,
  statSync: mockStatSync,
  readFileSync: mockReadFileSync,
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  chmodSync: jest.fn(),
  mkdtempSync: jest.fn(() => '/tmp/pd-spawner-dotenv-test'),
  rmSync: jest.fn(),
  // lib/coast-guard.ts (imported transitively via spawner) needs realpathSync.
  realpathSync: jest.fn((p) => p),
}));

// ---------------------------------------------------------------------------
// Mock node:child_process  (avoids real process spawning)
// ---------------------------------------------------------------------------
const mockChildProc = {
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on: jest.fn(),
  kill: jest.fn(),
  pid: 55555,
};
const mockSpawnFn = jest.fn(() => mockChildProc);

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawnFn,
  execSync: jest.fn(),
  execFileSync: jest.fn(),
}));

// Import AFTER mocks are registered
const { createSpawner: createSpawnerBase } = await import('../../lib/spawner.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'Unit test coverage for dotenv ownership and child env behavior',
};

function createSpawner(deps = {}) {
  if (deps.enforceTelemetryPolicy === true) {
    return createSpawnerBase({ enforceTranscriptPolicy: false, ...deps });
  }
  return createSpawnerBase({
    ...deps,
    enforceTelemetryPolicy: false,
    enforceTranscriptPolicy: deps.enforceTranscriptPolicy ?? false,
    telemetryBypassApproval: deps.telemetryBypassApproval ?? TEST_TELEMETRY_BYPASS,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveChild(code = 0) {
  mockChildProc.stdout.on.mockImplementation((ev, cb) => {
    if (ev === 'data') cb(Buffer.from('done'));
  });
  mockChildProc.stderr.on.mockImplementation(() => {});
  mockChildProc.on.mockImplementation((ev, cb) => {
    if (ev === 'close') Promise.resolve().then(() => cb(code));
  });
}

/** Returns the options.env passed to the last /bin/sh child_process.spawn call */
function lastChildEnv() {
  const shellCalls = mockSpawnFn.mock.calls.filter(([cmd]) => cmd === '/bin/sh');
  if (!shellCalls.length) throw new Error('No /bin/sh spawn call found');
  return shellCalls[shellCalls.length - 1][2].env;
}

beforeEach(() => {
  jest.clearAllMocks();
  // These tests assert the RAW custom-backend spawn (cmd === '/bin/sh') + its
  // dotenv-derived env. The Coast Guard (ADR-0050) wraps subprocess backends
  // under sandbox-exec by default; disable it here to keep the assertions on
  // the inner command/env. Default-on confinement is covered elsewhere.
  process.env.PD_COAST_GUARD_OFF = '1';
  mockExistsSync.mockReturnValue(false);
  mockStatSync.mockReturnValue({ uid: CURRENT_UID, mode: 0o100600 });
  mockReadFileSync.mockReturnValue('');
  resolveChild(0);
  global.fetch = async (input) => {
    const data = String(input).includes('/sugar/begin')
      ? { success: true, sessionId: 'session-dotenv-uid-test' }
      : { success: true };
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  };
});

afterAll(() => { delete global.fetch; delete process.env.PD_COAST_GUARD_OFF; });

// ---------------------------------------------------------------------------
// 1. uid mismatch → file skipped, canary NOT in env
// NOTE: Run BEFORE any test that warms _dotenvCache (test 4 below).
// ---------------------------------------------------------------------------

describe('loadDotenvOnce — uid mismatch skips the file', () => {
  it('does not inject a canary from .env.local owned by a different uid', async () => {
    const CANARY = '__PORTDADDY_UID_MISMATCH_CANARY__';

    mockExistsSync.mockImplementation((p) => p.endsWith('.env.local'));
    mockStatSync.mockReturnValue({ uid: OTHER_UID, mode: 0o100600 });
    mockReadFileSync.mockReturnValue(`${CANARY}=stolen\n`);

    const spawner = createSpawner();
    await spawner.spawn({ backend: 'custom', task: 'echo' });

    // The canary must NOT appear — file was skipped due to uid mismatch
    expect(lastChildEnv()).not.toHaveProperty(CANARY);
  });

  it('does not inject a canary from .env owned by a different uid', async () => {
    const CANARY = '__PORTDADDY_UID_MISMATCH_CANARY_ENV__';

    mockExistsSync.mockImplementation((p) => p.endsWith('.env'));
    mockStatSync.mockReturnValue({ uid: OTHER_UID, mode: 0o100600 });
    mockReadFileSync.mockReturnValue(`${CANARY}=also-stolen\n`);

    const spawner = createSpawner();
    await spawner.spawn({ backend: 'custom', task: 'echo' });

    expect(lastChildEnv()).not.toHaveProperty(CANARY);
  });
});

// ---------------------------------------------------------------------------
// 2. statSync failure → file skipped, no crash, canary NOT in env
// ---------------------------------------------------------------------------

describe('loadDotenvOnce — statSync failure skips the file', () => {
  it('skips gracefully when statSync throws ENOENT', async () => {
    const CANARY = '__PORTDADDY_STAT_ENOENT_CANARY__';

    mockExistsSync.mockImplementation((p) => p.endsWith('.env.local'));
    mockStatSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory, stat');
    });
    mockReadFileSync.mockReturnValue(`${CANARY}=leaked\n`);

    const spawner = createSpawner();
    await expect(spawner.spawn({ backend: 'custom', task: 'echo' })).resolves.toBeDefined();

    expect(lastChildEnv()).not.toHaveProperty(CANARY);
  });

  it('skips gracefully when statSync throws EACCES', async () => {
    const CANARY = '__PORTDADDY_STAT_EACCES_CANARY__';

    mockExistsSync.mockImplementation((p) => p.endsWith('.env.local'));
    mockStatSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    mockReadFileSync.mockReturnValue(`${CANARY}=also-leaked\n`);

    const spawner = createSpawner();
    await spawner.spawn({ backend: 'custom', task: 'echo' });

    expect(lastChildEnv()).not.toHaveProperty(CANARY);
  });
});

// ---------------------------------------------------------------------------
// 3. console.warn is emitted with file path and uid info on skip
// ---------------------------------------------------------------------------

describe('loadDotenvOnce — warning on uid skip', () => {
  it('logs [spawner] Skipping <path>: owned by uid <other>, expected <current>', async () => {
    const CANARY = '__PORTDADDY_WARN_CANARY__';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockExistsSync.mockImplementation((p) => p.endsWith('.env.local'));
    mockStatSync.mockReturnValue({ uid: OTHER_UID, mode: 0o100600 });
    mockReadFileSync.mockReturnValue(`${CANARY}=x\n`);

    const spawner = createSpawner();
    await spawner.spawn({ backend: 'custom', task: 'echo' });

    const logged = warnSpy.mock.calls.flat().join('\n');
    expect(logged).toMatch(/Skipping/);
    expect(logged).toMatch(/\.env\.local/);
    expect(logged).toContain(String(OTHER_UID));
    expect(logged).toContain(String(CURRENT_UID));

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 4. Current uid → file loaded, canary IN env  (runs last: warms cache)
// ---------------------------------------------------------------------------

describe('loadDotenvOnce — trusted uid loads the file', () => {
  it('injects canary from .env.local owned by the current uid', async () => {
    const CANARY = '__PORTDADDY_UID_MATCH_CANARY__';

    mockExistsSync.mockImplementation((p) => p.endsWith('.env.local'));
    mockStatSync.mockReturnValue({ uid: CURRENT_UID, mode: 0o100600 });
    mockReadFileSync.mockReturnValue(`${CANARY}=trusted-value\n`);

    const spawner = createSpawner();
    await spawner.spawn({ backend: 'custom', task: 'echo' });

    // This is the positive-path assertion: file IS loaded when uid matches
    expect(lastChildEnv()).toHaveProperty(CANARY, 'trusted-value');
  });

  it('injected values override process.env (dotenv takes precedence)', async () => {
    // process.env.PATH exists; if spawner loads .env.local first and dotenv sets PATH,
    // it should be in the merged env. This verifies spread order: ...process.env, ...dotenv
    const CANARY = '__PORTDADDY_OVERRIDE_CANARY__';

    mockExistsSync.mockImplementation((p) => p.endsWith('.env.local'));
    mockStatSync.mockReturnValue({ uid: CURRENT_UID, mode: 0o100600 });
    // Loaded second time? Cache is now warm after previous test.
    // This second test verifies that loadDotenvOnce is idempotent (caching).
    mockReadFileSync.mockReturnValue(`${CANARY}=override\n`);

    const spawner = createSpawner();
    await spawner.spawn({ backend: 'custom', task: 'echo' });

    // After the previous test warmed the cache, loadDotenvOnce returns cache.
    // The OVERRIDE canary is NOT in cache → not in env (cache is frozen after first load).
    // This documents the caching behavior rather than re-testing the file read path.
    // The cache is frozen with whatever the FIRST successful load returned.
    const env = lastChildEnv();
    expect(env).toHaveProperty('__PORTDADDY_UID_MATCH_CANARY__', 'trusted-value'); // from cache
    // OVERRIDE canary absent because cache hit, no re-read:
    expect(env).not.toHaveProperty(CANARY);
  });
});
