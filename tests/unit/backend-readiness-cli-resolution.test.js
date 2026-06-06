/**
 * Regression: the claude-cli / codex readiness gate must resolve the binary from
 * the same per-user install dirs the executor uses (lib/spawner.ts augments PATH
 * with ~/.local/bin), not the daemon's bare launchd PATH.
 *
 * The bug: a daemon launched by launchd has PATH=/usr/bin:/bin:/usr/sbin:/sbin,
 * so `which claude` failed and `pd spawn --backend claude-cli` reported
 * "Claude CLI binary not found" for an install that worked in the user's shell —
 * fail-closing a launchable backend before the executor ever ran. commandExists
 * now augments PATH with the standard CLI dirs + a PD_CLI_BIN_DIRS override.
 */
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const { commandExists } = await import('../../lib/backend-readiness.js');

// ~/coding/tmp, never /tmp (macOS purges /tmp).
const TMP_BASE = join(process.env.HOME || '.', 'coding', 'tmp');
// Unique names that exist on no real machine → deterministic on dev and CI.
const ABSENT = 'pd-test-cli-definitely-absent-zzz';
const STUBBED = 'pd-test-cli-stub-zzz';

describe('backend-readiness commandExists CLI resolution', () => {
  let dir;
  let prev;

  beforeEach(() => {
    mkdirSync(TMP_BASE, { recursive: true });
    dir = mkdtempSync(join(TMP_BASE, 'cli-res-'));
    prev = { PATH: process.env.PATH, DIRS: process.env.PD_CLI_BIN_DIRS };
    process.env.PATH = '/usr/bin:/bin'; // bare: no agent CLI here
    delete process.env.PD_CLI_BIN_DIRS;
  });

  afterEach(() => {
    process.env.PATH = prev.PATH;
    if (prev.DIRS === undefined) delete process.env.PD_CLI_BIN_DIRS;
    else process.env.PD_CLI_BIN_DIRS = prev.DIRS;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  test('a binary on no resolvable path is not found', () => {
    expect(commandExists(ABSENT)).toBe(false);
  });

  test('resolves a binary from a PD_CLI_BIN_DIRS dir even when PATH is bare', () => {
    const stub = join(dir, STUBBED);
    writeFileSync(stub, '#!/bin/sh\necho ok\n');
    chmodSync(stub, 0o755);
    expect(commandExists(STUBBED)).toBe(false); // not yet on any searched dir
    process.env.PD_CLI_BIN_DIRS = dir;
    expect(commandExists(STUBBED)).toBe(true); // now resolved via the override
  });
});
