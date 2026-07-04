/**
 * Integration: prove `cli:claude-code` (and the cli:* tube family) actually
 * survive the launch gate end-to-end through the REAL readiness + REAL
 * preflight modules composed together — not mocked at the readiness boundary.
 *
 * This is the regression that locks the "sortie contradiction": readiness
 * reports cli:claude-code as `manual_check` (auth unverifiable offline) but now
 * also flags it `launchableUnverified`, and the preflight gate honors that flag.
 *
 * Only `node:child_process` is mocked, so `commandExists('claude')` can be
 * driven without depending on whether the binary is installed in CI. Everything
 * downstream — assessBackendReadiness, the telemetry policy, fleet runtime
 * resolution, and assessSpawnPreflight — runs for real.
 */
import { jest } from '@jest/globals';

const mockSpawnSync = jest.fn();

// Spread the real child_process so the import chain keeps every other export
// (execSync, spawn, …); only `spawnSync` (used by commandExists) is driven.
jest.unstable_mockModule('node:child_process', () => {
  const actual = jest.requireActual('node:child_process');
  return { ...actual, default: actual, spawnSync: mockSpawnSync };
});

const { assessSpawnPreflight } = await import('../../lib/spawn-preflight.js');

function binaryPresent(...names) {
  const present = new Set(names);
  mockSpawnSync.mockImplementation((command, args) => ({
    status: command === 'which' && present.has(args?.[0]) ? 0 : 1,
  }));
}

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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('cli:claude-code sortie launch gate (real readiness + real preflight)', () => {
  test('launches when the claude binary is present (auth unverifiable but launchable)', async () => {
    binaryPresent('claude');

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
    binaryPresent(/* nothing present */);

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
      const bin = backend.split(':')[1] === 'claude-code' ? 'claude' : backend.split(':')[1];
      binaryPresent(bin);

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
