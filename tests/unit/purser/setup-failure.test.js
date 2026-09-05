/**
 * Purser contract, obligation 5 — a synchronous spawn throw AFTER a successful
 * Coast Guard wrap must dispose the wrap, return an honest receipt, name the
 * actually-attempted wrapper alongside the original binary, and clean up the
 * codex scratch tempDir.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol): the authored draft
 * referenced `mockWithCoastGuard`/`spawnViaCliTube` without importing or
 * defining anything, asserted a hardcoded `/usr/bin/claude` binary path that
 * no fixture installs, and asserted `rmSync('/tmp/test-tempdir', ...)` — a
 * path the implementation never creates (the codex scratch lives under
 * `~/.port-daddy/cli-tube-scratch`, deliberately NOT the OS temp dir). This
 * rewrite keeps the draft's full intent and makes every assertion true of the
 * real implementation: cli 'codex' (the only provider that creates a scratch
 * tempDir), real fs (so the tempDir genuinely exists and its cleanup is
 * observable), mocked child_process and coast-guard-runner exactly like the
 * main backend suite.
 */
import { jest } from '@jest/globals';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockSpawn = jest.fn();
const mockCoastGuardReceipt = {
  tool: 'pd-coast-guard',
  agentId: 'cli-tube/codex',
  backend: 'cli:codex',
  confined: true,
  mechanism: 'seatbelt',
};
const mockCoastGuardDispose = jest.fn();
const mockWithCoastGuard = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  execFile: jest.fn(),
  execFileSync: jest.fn(),
}));
jest.unstable_mockModule('../../../lib/spawner/coast-guard-runner.js', () => ({
  withCoastGuard: mockWithCoastGuard,
}));

const { spawnViaCliTube } = await import('../../../lib/spawner/backends/cli-tube.js');

const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
let fakeHome;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'pd-purser-setup-failure-'));
  process.env.HOME = fakeHome;
  process.env.PATH = '/usr/bin:/bin';
  const binDir = join(fakeHome, '.local', 'bin');
  mkdirSync(binDir, { recursive: true });
  const codexBin = join(binDir, 'codex');
  writeFileSync(codexBin, '#!/bin/sh\necho ok\n');
  chmodSync(codexBin, 0o755);
  mockSpawn.mockReset();
  mockCoastGuardDispose.mockReset();
  mockWithCoastGuard.mockReset();
});

afterEach(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }); } catch { /* noop */ }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
});

describe('spawnViaCliTube — synchronous spawn throw after a successful wrap', () => {
  test('returns the honest receipt, names the wrapper + original binary, disposes the wrap, and cleans the codex scratch tempDir', async () => {
    const codexBin = join(fakeHome, '.local', 'bin', 'codex');
    mockWithCoastGuard.mockImplementationOnce(async (input) => ({
      cmd: '/usr/bin/sandbox-wrapper',
      args: ['--', input.cmd, ...input.args],
      env: { ...input.env, PD_TEST_CONFINED: '1' },
      confined: true,
      receipt: () => mockCoastGuardReceipt,
      dispose: mockCoastGuardDispose,
    }));
    mockSpawn.mockImplementationOnce(() => { throw new Error('spawn error'); });

    const res = await spawnViaCliTube({ cli: 'codex', prompt: 'test' });

    // Obligation 5: structured error naming BOTH the wrapper actually exec'd
    // and the original binary it wrapped — a debugging operator needs both.
    expect(res.error).toBe(
      `Failed to spawn /usr/bin/sandbox-wrapper (Coast Guard wrapper for "${codexBin}"): spawn error`,
    );
    expect(res.exitCode).toBe(1);
    // The receipt is returned, not dropped, and the wrap is disposed once.
    expect(res.coastGuardReceipt).toBe(mockCoastGuardReceipt);
    expect(mockCoastGuardDispose).toHaveBeenCalledTimes(1);
    // The codex scratch tempDir (created under ~/.port-daddy/cli-tube-scratch
    // for --output-last-message capture) must not leak: the scratch root is
    // either gone or empty after the failed spawn.
    const scratchRoot = join(fakeHome, '.port-daddy', 'cli-tube-scratch');
    if (existsSync(scratchRoot)) {
      expect(readdirSync(scratchRoot)).toEqual([]);
    }
  });
});
