/**
 * Regression: CLI readiness must resolve binaries from the same per-user install
 * dirs the executor uses, not the daemon's bare launchd PATH or a stale explicit
 * binary override.
 *
 * The bug: a daemon launched by launchd has PATH=/usr/bin:/bin:/usr/sbin:/sbin,
 * so `which claude` failed and `pd spawn --backend claude-cli` reported
 * "Claude CLI binary not found" for an install that worked in the user's shell —
 * fail-closing a launchable backend before the executor ever ran. commandExists
 * now uses the production resolver, which checks executable files in the
 * standard CLI dirs + PD_CLI_BIN_DIRS and can fall back from a stale
 * operator-scoped override.
 */
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const { commandExists, resolveCliBinary } = await import('../../lib/backend-readiness.js');

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
    prev = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DIRS: process.env.PD_CLI_BIN_DIRS,
      CLAUDE: process.env.PD_CLI_CLAUDE_CODE_BIN,
    };
    process.env.PATH = '/usr/bin:/bin'; // bare: no agent CLI here
    process.env.HOME = dir;
    delete process.env.PD_CLI_BIN_DIRS;
    delete process.env.PD_CLI_CLAUDE_CODE_BIN;
  });

  afterEach(() => {
    if (prev.PATH === undefined) delete process.env.PATH;
    else process.env.PATH = prev.PATH;
    if (prev.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = prev.HOME;
    if (prev.DIRS === undefined) delete process.env.PD_CLI_BIN_DIRS;
    else process.env.PD_CLI_BIN_DIRS = prev.DIRS;
    if (prev.CLAUDE === undefined) delete process.env.PD_CLI_CLAUDE_CODE_BIN;
    else process.env.PD_CLI_CLAUDE_CODE_BIN = prev.CLAUDE;
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

  test('resolves a user-dir claude when launchd PATH is bare', () => {
    const nvmBin = join(dir, '.nvm', 'versions', 'node', 'v22.17.1', 'bin');
    const stub = join(nvmBin, 'claude');
    mkdirSync(nvmBin, { recursive: true });
    writeFileSync(stub, '#!/bin/sh\necho claude\n');
    chmodSync(stub, 0o755);

    const resolution = resolveCliBinary('claude', { envOverride: 'PD_CLI_CLAUDE_CODE_BIN' });

    expect(resolution).toMatchObject({
      found: true,
      command: stub,
      source: 'discovered',
    });
  });

  test('falls back from stale PD_CLI_CLAUDE_CODE_BIN to discovered claude', () => {
    const stale = join(dir, '.local', 'bin', 'claude');
    const nvmBin = join(dir, '.nvm', 'versions', 'node', 'v22.17.1', 'bin');
    const stub = join(nvmBin, 'claude');
    mkdirSync(nvmBin, { recursive: true });
    writeFileSync(stub, '#!/bin/sh\necho claude\n');
    chmodSync(stub, 0o755);
    process.env.PD_CLI_CLAUDE_CODE_BIN = stale;

    const resolution = resolveCliBinary('claude', { envOverride: 'PD_CLI_CLAUDE_CODE_BIN' });

    expect(resolution).toMatchObject({
      found: true,
      command: stub,
      source: 'discovered',
      override: stale,
    });
    expect(resolution.warning).toContain('PD_CLI_CLAUDE_CODE_BIN');
    expect(resolution.warning).toContain(stale);
  });

  test('resolves a bare PD_CLI_CLAUDE_CODE_BIN override from augmented PATH dirs', () => {
    const overrideDir = join(dir, 'override-bin');
    const stub = join(overrideDir, 'claude-beta');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(stub, '#!/bin/sh\necho beta\n');
    chmodSync(stub, 0o755);
    process.env.PD_CLI_BIN_DIRS = overrideDir;
    process.env.PD_CLI_CLAUDE_CODE_BIN = 'claude-beta';

    const resolution = resolveCliBinary('claude', { envOverride: 'PD_CLI_CLAUDE_CODE_BIN' });

    expect(resolution).toMatchObject({
      found: true,
      command: stub,
      source: 'override',
      override: 'claude-beta',
    });
    expect(resolution.warning).toBeUndefined();
  });

  test('falls back when a bare PD_CLI_CLAUDE_CODE_BIN override is missing', () => {
    const nvmBin = join(dir, '.nvm', 'versions', 'node', 'v22.17.1', 'bin');
    const stub = join(nvmBin, 'claude');
    mkdirSync(nvmBin, { recursive: true });
    writeFileSync(stub, '#!/bin/sh\necho claude\n');
    chmodSync(stub, 0o755);
    process.env.PD_CLI_CLAUDE_CODE_BIN = 'claude-beta';

    const resolution = resolveCliBinary('claude', { envOverride: 'PD_CLI_CLAUDE_CODE_BIN' });

    expect(resolution).toMatchObject({
      found: true,
      command: stub,
      source: 'discovered',
      override: 'claude-beta',
    });
    expect(resolution.warning).toContain('PD_CLI_CLAUDE_CODE_BIN=claude-beta');
    expect(resolution.warning).toContain(`using discovered claude at ${stub}`);
  });

  test('treats Windows-style relative overrides as paths, not bare commands', () => {
    const overrideDir = join(dir, 'override-bin');
    const stub = join(overrideDir, 'bin\\claude');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(stub, '#!/bin/sh\necho slashy\n');
    chmodSync(stub, 0o755);
    process.env.PD_CLI_BIN_DIRS = overrideDir;
    process.env.PD_CLI_CLAUDE_CODE_BIN = 'bin\\claude';

    const resolution = resolveCliBinary('claude', { envOverride: 'PD_CLI_CLAUDE_CODE_BIN' });

    expect(resolution).toMatchObject({
      found: false,
      command: 'bin\\claude',
      source: 'unresolved',
      override: 'bin\\claude',
    });
    expect(resolution.warning).toContain('no claude binary was found');
  });
});
