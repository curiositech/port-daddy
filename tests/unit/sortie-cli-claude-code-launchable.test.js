/**
 * Integration: prove `cli:claude-code` (and the cli:* tube family) actually
 * survive the launch gate end-to-end through the REAL readiness + REAL
 * preflight modules composed together — not mocked at the readiness boundary.
 *
 * This is the regression that locks the "sortie contradiction": readiness
 * reports cli:claude-code as `manual_check` (auth unverifiable offline) but now
 * also flags it `launchableUnverified`, and the preflight gate honors that flag.
 *
 * The binaries are real temporary executable files exposed through
 * PD_CLI_BIN_DIRS, so this exercises the production resolver used by readiness
 * and spawn. Everything downstream — assessBackendReadiness, the telemetry
 * policy, fleet runtime resolution, and assessSpawnPreflight — runs for real.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { jest } from '@jest/globals';

const { assessSpawnPreflight } = await import('../../lib/spawn-preflight.js');

const costTracker = {
  budgetStatus: jest.fn(() => ({
    project: 'port-daddy',
    budgetUsdPerDay: 5,
    spentUsd: 0,
    remainingUsd: 5,
    percentUsed: 0,
    overBudget: false,
  })),
};

const TMP_BASE = join(process.env.HOME || '.', 'coding', 'tmp');
const BACKEND_BIN = {
  'cli:claude-code': 'claude',
  'cli:codex': 'codex',
  'cli:gemini': 'gemini',
  'cli:groq': 'groq',
  'cli:grok': 'grok',
};
const CLI_BIN_OVERRIDES = [
  'PD_CLI_CLAUDE_CODE_BIN',
  'PD_CLI_CODEX_BIN',
  'PD_CLI_GEMINI_BIN',
  'PD_CLI_GROQ_BIN',
  'PD_CLI_GROK_BIN',
];

let tempHome;
let binDir;
let previousEnv;

function installCli(name) {
  const file = join(binDir, name);
  writeFileSync(file, '#!/bin/sh\necho ok\n');
  chmodSync(file, 0o755);
  return file;
}

beforeEach(() => {
  jest.clearAllMocks();
  previousEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PD_CLI_BIN_DIRS: process.env.PD_CLI_BIN_DIRS,
    PD_USE_CLI_BACKEND: process.env.PD_USE_CLI_BACKEND,
    PD_CLI_CLAUDE_CODE_BIN: process.env.PD_CLI_CLAUDE_CODE_BIN,
    PD_CLI_CODEX_BIN: process.env.PD_CLI_CODEX_BIN,
    PD_CLI_GEMINI_BIN: process.env.PD_CLI_GEMINI_BIN,
    PD_CLI_GROQ_BIN: process.env.PD_CLI_GROQ_BIN,
    PD_CLI_GROK_BIN: process.env.PD_CLI_GROK_BIN,
  };
  mkdirSync(TMP_BASE, { recursive: true });
  tempHome = mkdtempSync(join(TMP_BASE, 'sortie-cli-launch-'));
  binDir = join(tempHome, 'cli-bin');
  mkdirSync(binDir, { recursive: true });
  process.env.HOME = tempHome;
  process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  process.env.PD_CLI_BIN_DIRS = binDir;
  process.env.PD_USE_CLI_BACKEND = 'none';
  for (const key of CLI_BIN_OVERRIDES) delete process.env[key];
});

afterEach(() => {
  if (previousEnv.PATH === undefined) delete process.env.PATH;
  else process.env.PATH = previousEnv.PATH;
  if (previousEnv.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = previousEnv.HOME;
  if (previousEnv.PD_CLI_BIN_DIRS === undefined) delete process.env.PD_CLI_BIN_DIRS;
  else process.env.PD_CLI_BIN_DIRS = previousEnv.PD_CLI_BIN_DIRS;
  if (previousEnv.PD_USE_CLI_BACKEND === undefined) delete process.env.PD_USE_CLI_BACKEND;
  else process.env.PD_USE_CLI_BACKEND = previousEnv.PD_USE_CLI_BACKEND;
  for (const key of CLI_BIN_OVERRIDES) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('cli:claude-code sortie launch gate (real readiness + real preflight)', () => {
  test('launches when the claude binary is present (auth unverifiable but launchable)', async () => {
    installCli('claude');

    const result = await assessSpawnPreflight({
      backend: 'cli:claude-code',
      identity: 'port-daddy:sortie:proof',
      budgetUsd: 5,
    }, { costTracker });

    expect(result.launchReady).toBe(true);
    expect(result.blockedReasons).toEqual([]);
    expect(result.warnings.join('\n')).toMatch(/auth could not be verified offline/i);
    expect(result.localExecutionLikely).toBe(true);
  });

  test('blocks when the claude binary is missing (genuinely needs setup)', async () => {
    const result = await assessSpawnPreflight({
      backend: 'cli:claude-code',
      identity: 'port-daddy:sortie:proof',
      budgetUsd: 5,
    }, { costTracker });

    expect(result.launchReady).toBe(false);
    expect(result.blockedReasons.join('\n')).toMatch(/cli:claude-code.*needs_setup/i);
  });

  test.each(['cli:codex', 'cli:gemini', 'cli:groq', 'cli:grok'])(
    '%s also launches when its binary is present',
    async (backend) => {
      installCli(BACKEND_BIN[backend]);

      const result = await assessSpawnPreflight({
        backend,
        identity: 'port-daddy:sortie:proof',
        budgetUsd: 5,
      }, { costTracker });

      expect(result.launchReady).toBe(true);
      expect(result.blockedReasons).toEqual([]);
    },
  );
});
