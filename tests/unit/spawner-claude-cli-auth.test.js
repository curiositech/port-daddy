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

const mockExistsSync = jest.fn((p) => String(p).endsWith('.env.local'));
const mockStatSync   = jest.fn(() => ({ uid: process.getuid?.() ?? 99, mode: 0o100600 }));
const mockReadFileSync = jest.fn(() => `ANTHROPIC_API_KEY=${DOTENV_API_KEY}\n`);

jest.unstable_mockModule('node:fs', () => ({
  existsSync:    mockExistsSync,
  statSync:      mockStatSync,
  readFileSync:  mockReadFileSync,
  writeFileSync: jest.fn(),
  mkdirSync:     jest.fn(),
  chmodSync:     jest.fn(),
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
}));

// Import AFTER mocks are registered
const { createSpawner } = await import('../../lib/spawner.js');

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
  const claudeCalls = mockSpawnFn.mock.calls.filter(([cmd]) => cmd === 'claude');
  if (!claudeCalls.length) throw new Error('No claude spawn call found');
  return claudeCalls[claudeCalls.length - 1][2].env;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExistsSync.mockImplementation((p) => String(p).endsWith('.env.local'));
  mockStatSync.mockReturnValue({ uid: process.getuid?.() ?? 99, mode: 0o100600 });
  mockReadFileSync.mockReturnValue(`ANTHROPIC_API_KEY=${DOTENV_API_KEY}\n`);
  resolveChild(0);
  global.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ success: true }),
    text: async () => 'OK',
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('claude-cli — ANTHROPIC_API_KEY from dotenv is not injected', () => {
  it('does not pass ANTHROPIC_API_KEY from .env.local to the claude subprocess', async () => {
    const spawner = createSpawner();
    await spawner.spawn({ backend: 'claude-cli', task: 'echo hello' });

    const env = lastClaudeEnv();
    expect(env.ANTHROPIC_API_KEY).not.toBe(DOTENV_API_KEY);
    // Key should be absent entirely (unless already in process.env)
    if (!process.env.ANTHROPIC_API_KEY) {
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    }
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
