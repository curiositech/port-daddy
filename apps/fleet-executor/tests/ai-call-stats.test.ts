/**
 * Tests for recordShipAiCallStats (src/execute.ts) — the best-effort
 * fleet_ai_call_stats flush, one row per (run_id, ship), that
 * FleetAiCircuit.runForShip's in-memory aggregation gets written through.
 *
 * Coverage requested by pd-qa on #9800: the D1-unavailable / throwing-insert
 * path must be verified to swallow the failure rather than propagate it —
 * the same best-effort contract recordShipSpend holds to, pinned here since
 * this is the function that carries it forward for AI-call stats.
 */

import { describe, it, expect, vi } from 'vitest';
import { recordShipAiCallStats } from '../src/execute.js';
import type { ShipConfig } from '../src/fleet.js';
import type { ShipAiCallStats } from '../src/ai-resilience.js';
import { makeEnv } from './harness.js';

function ship(over: Partial<ShipConfig> = {}): ShipConfig {
  return {
    name: 'purser',
    trigger: 'pull_request:opened',
    prompt: 'p',
    cfModel: '@cf/qwen/qwen3-30b-a3b-fp8',
    temperature: null,
    role: 'r',
    telos: 't',
    blocking: false,
    needsExecution: false,
    ideation: false,
    purser: false,
    blockWithoutSandbox: false,
    testPaths: [],
    graft: [],
    ...over,
  } as ShipConfig;
}

function stats(over: Partial<ShipAiCallStats> = {}): ShipAiCallStats {
  return {
    ship: 'purser',
    calls: 3,
    okCalls: 2,
    timeoutCalls: 1,
    errorCalls: 1,
    totalElapsedMs: 45_000,
    maxElapsedMs: 30_000,
    ...over,
  };
}

describe('recordShipAiCallStats', () => {
  it('is a no-op without a DB binding', async () => {
    const env = makeEnv({ DB: undefined });
    await expect(recordShipAiCallStats(env, 'run:1', ship(), stats(), 300_000)).resolves.toBeUndefined();
  });

  it('is a no-op when the ship made no tracked AI calls', async () => {
    const run = vi.fn();
    const env = makeEnv({
      DB: { prepare: () => ({ bind: () => ({ run }) }) } as unknown as D1Database,
    });
    await recordShipAiCallStats(env, 'run:1', ship(), null, 300_000);
    await recordShipAiCallStats(env, 'run:1', ship(), stats({ calls: 0 }), 300_000);
    expect(run).not.toHaveBeenCalled();
  });

  it('binds every field in order on a successful insert', async () => {
    const bind = vi.fn((..._args: unknown[]) => ({
      run: async () => ({ success: true, meta: { changes: 1 } }),
    }));
    const env = makeEnv({
      DB: { prepare: () => ({ bind }) } as unknown as D1Database,
    });
    await recordShipAiCallStats(env, 'run:1', ship({ name: 'lookout' }), stats(), 300_000);
    expect(bind).toHaveBeenCalledTimes(1);
    const [runId, shipName, calls, okCalls, timeoutCalls, errorCalls, totalElapsedMs, maxElapsedMs, deadlineMs] =
      bind.mock.calls[0]!;
    expect({ runId, shipName, calls, okCalls, timeoutCalls, errorCalls, totalElapsedMs, maxElapsedMs, deadlineMs }).toEqual({
      runId: 'run:1',
      shipName: 'lookout',
      calls: 3,
      okCalls: 2,
      timeoutCalls: 1,
      errorCalls: 1,
      totalElapsedMs: 45_000,
      maxElapsedMs: 30_000,
      deadlineMs: 300_000,
    });
  });

  it('swallows a throwing D1 insert — never changes the run (pd-qa MEDIUM finding on #9800)', async () => {
    const env = makeEnv({
      DB: {
        prepare: () => ({
          bind: () => ({
            async run() {
              throw new Error('D1 unavailable');
            },
          }),
        }),
      } as unknown as D1Database,
    });
    await expect(
      recordShipAiCallStats(env, 'run:1', ship(), stats(), 300_000),
    ).resolves.toBeUndefined();
  });
});
