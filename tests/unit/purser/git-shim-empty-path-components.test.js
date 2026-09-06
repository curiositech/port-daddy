// the complete contents of tests/unit/purser/git-shim-empty-path-components.test.js
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GIT_SHIM_CONTENT } from '../../../cli/utils/git-shim.js';

/**
 * Detect an available Bash binary. The shim relies on Bash‑specific syntax,
 * so the tests are skipped when Bash cannot be found.
 */
const BASH = (() => {
  const probe = spawnSync('/bin/sh', ['-c', 'command -v bash'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0 || !probe.stdout.trim()) return null;
  const bash = probe.stdout.trim();
  const ok = spawnSync(bash, ['-c', 'exit 0'], { encoding: 'utf8' });
  return ok.status === 0 ? bash : null;
})();

/**
 * Create an isolated temporary directory containing:
 *  - a `shim` directory with the generated git‑shim executable
 *  - a `real` directory with a dummy `git` that echoes its arguments
 *
 * Returns paths needed by the tests.
 */
function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-shim-empty-path-'));
  const shimDir = join(dir, 'shim');
  const realDir = join(dir, 'real');
  mkdirSync(shimDir, { recursive: true });
  mkdirSync(realDir, { recursive: true });

  const shimPath = join(shimDir, 'git');
  writeFileSync(shimPath, GIT_SHIM_CONTENT);
  chmodSync(shimPath, 0o755);

  const realGitPath = join(realDir, 'git');
  writeFileSync(
    realGitPath,
    '#!/bin/sh\nprintf "REAL_GIT %s\\n" "$*"\n',
  );
  chmodSync(realGitPath, 0o755);

  return { dir, shimDir, realDir, shimPath, realGitPath };
}

/**
 * Execute the shim using Bash, overriding PATH and disabling recursive shim
 * activation via `PD_SHIM_OFF`.
 *
 * @param {string} shimPath   Absolute path to the shim binary.
 * @param {string} pathValue  The PATH string to inject.
 * @param {string[]} argv     Arguments passed to the shim (default: ['--version']).
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function runShim(shimPath, pathValue, argv = ['--version']) {
  return spawnSync(BASH, [shimPath, ...argv], {
    env: { ...process.env, PATH: pathValue, PD_SHIM_OFF: '' },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

// If Bash is unavailable we cannot meaningfully run the shim; skip the suite.
const describeIfBash = BASH ? describe : describe.skip;

describeIfBash('git shim – handling of empty PATH components', () => {
  let sandbox;

  beforeAll(() => {
    sandbox = makeSandbox();
  });

  afterAll(() => {
    rmSync(sandbox.dir, { recursive: true, force: true });
  });

  test('executes real git when PATH has leading, trailing, and consecutive colons', () => {
    const { shimPath, shimDir, realDir } = sandbox;
    // PATH layout:
    //   :<shimDir>:<realDir>::<realDir>:
    // leading colon → empty component before shimDir
    // trailing colon → empty component after final realDir
    // double colon → empty component between the two realDir entries
    const pathValue = `:${shimDir}:${realDir}::${realDir}:`;

    const result = runShim(shimPath, pathValue, ['--test-arg']);
    expect(result.status).toBe(0);
    // The dummy real git script prints “REAL_GIT <args>”
    expect(result.stdout).toContain('REAL_GIT');
    expect(result.stdout).toMatch(/REAL_GIT --test-arg/);
    // No error messages should be emitted
    expect(result.stderr).toBe('');
  });

  test('does not attempt to exec empty components (no EAGAIN/EWOULDBLOCK/ETIMEDOUT)', () => {
    const { shimPath, shimDir, realDir } = sandbox;
    // Path consisting solely of empty components and the two directories
    const pathValue = `::${shimDir}::${realDir}::`;

    const result = runShim(shimPath, pathValue, []);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('REAL_GIT');
    // Ensure the shim fell back to the real git implementation rather than failing
    expect(result.stderr).toBe('');
  });
});