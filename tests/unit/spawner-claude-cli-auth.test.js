/**
 * Tests that the claude-cli backend does NOT inject ANTHROPIC_API_KEY from
 * dotenv into the spawned subprocess.
 *
 * The bug: loadDotenvOnce() reads .env.local and merges the result into the
 * subprocess env. If .env.local contains ANTHROPIC_API_KEY, the claude CLI
 * treats it as an "external" key override and rejects it with
 * "Invalid API key · Fix external API key" — even though the user is logged in
 * via the CLI's own OAuth flow.
 *
 * The fix (lib/spawner.ts runClaudeCli): destructure ANTHROPIC_API_KEY out of
 * loadDotenvOnce() before merging, so it never reaches the subprocess.
 * spec.env.ANTHROPIC_API_KEY (user-explicit) is still respected.
 */

import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock node:fs — provide a .env.local containing ANTHROPIC_API_KEY
// ---------------------------------------------------------------------------

const DOTENV_API_KEY = 'sk-ant-LEAKED-FROM-DOTENV';
const FAKE_HOME = '/fake-home';
const FAKE_NVM_CLAUDE = `${FAKE_HOME}/.nvm/versions/node/v22.17.1/bin/claude`;

const mockExistsSync = jest.fn((p) => String(p).endsWith('.env.local'));
const mockAccessSync = jest.fn((p) => {
  if (String(p) === FAKE_NVM_CLAUDE) return;
  throw new Error('not executable');
});
const mockStatSync   = jest.fn((p) => ({
  uid: process.getuid?.() ?? 99,
  mode: 0o100600,
  isFile: () => String(p) === FAKE_NVM_CLAUDE,
}));
const mockReadFileSync = jest.fn(() => `ANTHROPIC_API_KEY=${DOTENV_API_KEY}\n`);
const mockReaddirSync = jest.fn((p) => (
  String(p).endsWith('.nvm/versions/node') ? ['v22.17.1'] : []
));

jest.unstable_mockModule('node:fs', () => ({
  existsSync:    mockExistsSync,
  accessSync:    mockAccessSync,
  constants:     { X_OK: 1 },
  statSync:      mockStatSync,
  readdirSync:   mockReaddirSync,
  readFileSync:  mockReadFileSync,
  writeFileSync: jest.fn(),
  mkdirSync:     jest.fn(),
  chmodSync:     jest.fn(),
  mkdtempSync:   jest.fn(() => '/tmp/pd-spawner-auth-test'),
  rmSync:        jest.fn(),
  // lib/coast-guard.ts (imported transitively via spawner) needs realpathSync.
  realpathSync:  jest.fn((p) => p),
}));

// ---------------------------------------------------------------------------
// Mock node:child_process — capture the env passed to the claude subprocess
// ---------------------------------------------------------------------------

const mockChildProc = {
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on:     jest.fn(),
  kill:   jest.fn(),
  pid:    88888,
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
  reason: 'Unit test coverage for claude-cli spawn environment behavior',
};
const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
const originalClaudeBin = process.env.PD_CLI_CLAUDE_CODE_BIN;

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

function resolveChild(code = 0, stdout = 'done') {
  mockChildProc.stdout.on.mockImplementation((ev, cb) => {
    if (ev === 'data') cb(Buffer.from(stdout));
  });
  mockChildProc.stderr.on.mockImplementation(() => {});
  mockChildProc.on.mockImplementation((ev, cb) => {
    if (ev === 'close') Promise.resolve().then(() => cb(code));
  });
}

/** Returns the env passed to the most recent 'claude' spawn call */
function lastClaudeEnv() {
  const claudeCalls = mockSpawnFn.mock.calls.filter(([cmd]) => String(cmd) === 'claude' || String(cmd).endsWith('/claude'));
  if (!claudeCalls.length) throw new Error('No claude spawn call found');
  return claudeCalls[claudeCalls.length - 1][2].env;
}

beforeEach(() => {
  jest.clearAllMocks();
  // These tests assert the claude-cli env-stripping logic by finding the spawn
  // call whose cmd is the resolved claude binary. The Coast Guard (ADR-0050) wraps subprocess
  // backends under `sandbox-exec` by default, which would nest 'claude' inside
  // args. Disable it here to keep the assertions on the inner claude env direct;
  // the broker scrub (which ALSO removes ANTHROPIC_API_KEY) is covered in
  // coast-guard.test.js + spawner-coast-guard.test.js.
  process.env.PD_COAST_GUARD_OFF = '1';
  delete process.env.PD_CLI_CLAUDE_CODE_BIN;
  process.env.HOME = FAKE_HOME;
  process.env.PATH = '/usr/bin:/bin';
  mockExistsSync.mockImplementation((p) => String(p).endsWith('.env.local'));
  mockAccessSync.mockImplementation((p) => {
    if (String(p) === FAKE_NVM_CLAUDE) return;
    throw new Error('not executable');
  });
  mockStatSync.mockImplementation((p) => ({
    uid: process.getuid?.() ?? 99,
    mode: 0o100600,
    isFile: () => String(p) === FAKE_NVM_CLAUDE,
  }));
  mockReadFileSync.mockReturnValue(`ANTHROPIC_API_KEY=${DOTENV_API_KEY}\n`);
  mockReaddirSync.mockImplementation((p) => (
    String(p).endsWith('.nvm/versions/node') ? ['v22.17.1'] : []
  ));
  resolveChild(0);
  global.fetch = async (input) => {
    const data = String(input).includes('/sugar/begin')
      ? { success: true, sessionId: 'session-claude-cli-auth-test' }
      : { success: true };
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  };
});

afterAll(() => {
  delete process.env.PD_COAST_GUARD_OFF;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalClaudeBin === undefined) delete process.env.PD_CLI_CLAUDE_CODE_BIN;
  else process.env.PD_CLI_CLAUDE_CODE_BIN = originalClaudeBin;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('claude-cli — ANTHROPIC_API_KEY from dotenv is not injected', () => {
  it('does not pass ANTHROPIC_API_KEY from .env.local to the claude subprocess', async () => {
    const spawner = createSpawner();
    await spawner.spawn({ backend: 'claude-cli', task: 'echo hello' });

    const env = lastClaudeEnv();
    // After 0df9155: ANTHROPIC_API_KEY is stripped from BOTH dotenv AND process.env.
    // Must be unconditionally undefined (unless spec.env provides it).
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('still passes ANTHROPIC_API_KEY when explicitly provided in spec.env', async () => {
    const EXPLICIT_KEY = 'sk-ant-EXPLICIT-FROM-SPEC-ENV';
    const spawner = createSpawner();

    await spawner.spawn({
      backend: 'claude-cli',
      task:    'echo hello',
      env:     { ANTHROPIC_API_KEY: EXPLICIT_KEY },
    });

    const env = lastClaudeEnv();
    expect(env.ANTHROPIC_API_KEY).toBe(EXPLICIT_KEY);
  });

  it('does not affect other dotenv values — non-ANTHROPIC keys still injected', async () => {
    const spawner = createSpawner();
    // The cache is warm from the first test with ANTHROPIC_API_KEY only.
    // Other keys (e.g. MY_CUSTOM_VAR) would be in cache if they were in the file.
    // This verifies we're doing surgical removal, not dropping all dotenv.
    await spawner.spawn({ backend: 'claude-cli', task: 'echo hello' });

    const env = lastClaudeEnv();
    // PATH augmentation should still be present (from spawner logic, not dotenv)
    expect(env.PATH).toBeDefined();
    expect(env.PATH).toContain('.local/bin');
  });
});

// ---------------------------------------------------------------------------
// stdio: stdin must be closed for claude-cli (no "no stdin data" warnings)
// ---------------------------------------------------------------------------

describe('claude-cli — stdin is closed (stdio: ignore)', () => {
  it('spawns with stdio [ignore, pipe, pipe] to close stdin', async () => {
    const spawner = createSpawner();
    await spawner.spawn({ backend: 'claude-cli', task: 'echo hello' });

    // Find the 'claude' spawn call and inspect the options
    const claudeCalls = mockSpawnFn.mock.calls.filter(([cmd]) => String(cmd) === 'claude' || String(cmd).endsWith('/claude'));
    expect(claudeCalls.length).toBeGreaterThanOrEqual(1);

    const opts = claudeCalls[claudeCalls.length - 1][2];
    expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });
});

// ---------------------------------------------------------------------------
// launchd PATH: stale explicit binary must fall back to discovered user install
// ---------------------------------------------------------------------------

describe('claude-cli — launchd binary resolution', () => {
  it('falls back from stale PD_CLI_CLAUDE_CODE_BIN to the discovered NVM claude binary', async () => {
    process.env.PD_CLI_CLAUDE_CODE_BIN = `${FAKE_HOME}/.local/bin/claude`;
    const spawner = createSpawner();

    await spawner.spawn({ backend: 'claude-cli', task: 'echo hello' });

    const claudeCalls = mockSpawnFn.mock.calls.filter(([cmd]) => String(cmd) === FAKE_NVM_CLAUDE);
    expect(claudeCalls.length).toBeGreaterThanOrEqual(1);
    expect(claudeCalls[claudeCalls.length - 1][2].env.PATH).toContain(`${FAKE_HOME}/.nvm/versions/node/v22.17.1/bin`);
  });
});

// ---------------------------------------------------------------------------
// BUG: spec.env.PATH is silently overwritten by augmentedPath
// The doc claims "custom env from spec.env is applied last (highest priority)"
// but PATH specifically is hardcoded AFTER the spec.env spread.
// ---------------------------------------------------------------------------

describe('claude-cli — spec.env.PATH override (known bug)', () => {
  it('spec.env.PATH is overwritten by augmentedPath — PATH is NOT highest priority', async () => {
    const CUSTOM_PATH = '/my/custom/path/only';
    const spawner = createSpawner();

    await spawner.spawn({
      backend: 'claude-cli',
      task: 'echo hello',
      env: { PATH: CUSTOM_PATH },
    });

    const env = lastClaudeEnv();
    // BUG: The user-provided PATH is silently dropped.
    // If this assertion starts failing, the bug was fixed — update accordingly.
    expect(env.PATH).not.toBe(CUSTOM_PATH);
    expect(env.PATH).toContain('.local/bin');
  });
});
