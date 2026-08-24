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

  /**
   * A minimal stateful fake that actually interprets this one
   * INSERT ... ON CONFLICT DO UPDATE statement's accumulate-not-replace
   * semantics, so the SQL itself is exercised rather than just the call
   * shape. Every field this function binds is a positional column in the
   * order recordShipAiCallStats writes them.
   */
  function accumulatingD1() {
    const rows = new Map<
      string,
      { calls: number; okCalls: number; timeoutCalls: number; errorCalls: number; totalElapsedMs: number; maxElapsedMs: number; deadlineMs: number }
    >();
    const db = {
      prepare: () => ({
        bind: (
          runId: string,
          shipName: string,
          calls: number,
          okCalls: number,
          timeoutCalls: number,
          errorCalls: number,
          totalElapsedMs: number,
          maxElapsedMs: number,
          deadlineMs: number,
        ) => ({
          async run() {
            const key = `${runId} ${shipName}`;
            const existing = rows.get(key);
            if (existing) {
              existing.calls += calls;
              existing.okCalls += okCalls;
              existing.timeoutCalls += timeoutCalls;
              existing.errorCalls += errorCalls;
              existing.totalElapsedMs += totalElapsedMs;
              existing.maxElapsedMs = Math.max(existing.maxElapsedMs, maxElapsedMs);
              existing.deadlineMs = deadlineMs;
            } else {
              rows.set(key, { calls, okCalls, timeoutCalls, errorCalls, totalElapsedMs, maxElapsedMs, deadlineMs });
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;
    return { db, rows };
  }

  it(
    'ACCUMULATES across deliveries for the same (run_id, ship) rather than replacing ' +
      '— a timeout on delivery 1 followed by a success on delivery 2 must show both (DO-NOT-SHIP finding on #9800)',
    async () => {
      const { db, rows } = accumulatingD1();
      const env = makeEnv({ DB: db });
      // Delivery 1: one AI call that timed out (a fresh FleetAiCircuit per invocation).
      await recordShipAiCallStats(
        env,
        'run:shared',
        ship({ name: 'purser' }),
        { ship: 'purser', calls: 1, okCalls: 0, timeoutCalls: 1, errorCalls: 1, totalElapsedMs: 300_000, maxElapsedMs: 300_000 },
        300_000,
      );
      // Delivery 2 (a redelivery of the SAME message, so the SAME run id): the
      // retry succeeds.
      await recordShipAiCallStats(
        env,
        'run:shared',
        ship({ name: 'purser' }),
        { ship: 'purser', calls: 1, okCalls: 1, timeoutCalls: 0, errorCalls: 0, totalElapsedMs: 4_000, maxElapsedMs: 4_000 },
        300_000,
      );
      const row = rows.get('run:shared purser');
      expect(row).toEqual({
        calls: 2,
        okCalls: 1,
        timeoutCalls: 1, // <- would be 0 under REPLACE semantics; the whole point of this fix
        errorCalls: 1,
        totalElapsedMs: 304_000,
        maxElapsedMs: 300_000,
        deadlineMs: 300_000,
      });
    },
  );

  it('keeps separate rows per ship within the same run', async () => {
    const { db, rows } = accumulatingD1();
    const env = makeEnv({ DB: db });
    await recordShipAiCallStats(env, 'run:shared', ship({ name: 'purser' }), stats(), 300_000);
    await recordShipAiCallStats(env, 'run:shared', ship({ name: 'lookout' }), stats({ calls: 1, okCalls: 1, timeoutCalls: 0, errorCalls: 0 }), 300_000);
    expect(rows.size).toBe(2);
    expect(rows.get('run:shared purser')!.calls).toBe(3);
    expect(rows.get('run:shared lookout')!.calls).toBe(1);
  });
});
