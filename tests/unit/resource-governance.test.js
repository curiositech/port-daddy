import { describe, expect, test } from '@jest/globals';
import { createResourceGovernance } from '../../lib/resource-governance.js';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

describe('resource governance overview', () => {
  test('measures Port Daddy, rendering, networking, and local AI buckets', () => {
    let now = 1_000;
    const monitor = createResourceGovernance({
      repoRoot: process.cwd(),
      startedAt: 500,
      now: () => now,
      statDisk: () => ({
        path: process.cwd(),
        totalBytes: 100 * GIB,
        freeBytes: 72 * GIB,
        usedBytes: 28 * GIB,
        usedRatio: 0.28,
        status: 'calm',
      }),
      readProcessTable: () => [
        {
          pid: process.pid,
          ppid: 1,
          rssBytes: 180 * MIB,
          cpuPercent: 2.5,
          command: 'node',
          args: 'tsx server.ts',
        },
        {
          pid: 222,
          ppid: 1,
          rssBytes: 640 * MIB,
          cpuPercent: 8.2,
          command: 'FleetBar',
          args: 'PortDaddyFleetBar WebView',
        },
        {
          pid: 333,
          ppid: 1,
          rssBytes: 3 * GIB,
          cpuPercent: 65,
          command: 'ollama',
          args: 'ollama serve',
        },
      ],
    });

    const first = monitor.overview({
      userCap: 2,
      activeAgents: 4,
      activePorts: 12,
      dailySpendUsd: 1.25,
      dailySpawnCount: 5,
      estimatedCostEvents: 1,
    });
    now += 8_000;
    const second = monitor.overview({ userCap: 2, activeAgents: 3, activePorts: 10 });

    expect(first.success).toBe(true);
    expect(first.portDaddy.rssBytes).toBe(180 * MIB);
    expect(first.fleet.activeAgents).toBe(4);
    expect(first.cost.dailySpendUsd).toBe(1.25);
    expect(first.buckets.map((bucket) => bucket.id)).toEqual([
      'memory',
      'disk',
      'port-daddy',
      'network',
      'rendering',
      'local-ai',
      'fleet',
    ]);
    expect(first.buckets.find((bucket) => bucket.id === 'local-ai')).toEqual(expect.objectContaining({
      value: 3 * GIB,
      confidence: 'measured',
    }));
    expect(first.buckets.find((bucket) => bucket.id === 'network')).toEqual(expect.objectContaining({
      value: 12,
      confidence: 'partial',
    }));
    expect(second.history).toHaveLength(2);
    expect(second.history[1]).toEqual(expect.objectContaining({
      activeAgents: 3,
      activePorts: 10,
    }));
  });

  test('keeps cap escalation advisory when no user cap is supplied', () => {
    const monitor = createResourceGovernance({
      repoRoot: process.cwd(),
      readProcessTable: () => [],
      statDisk: () => null,
    });

    const overview = monitor.overview({ activeAgents: 1, activePorts: 2 });

    expect(overview.policy.mode).toBe('observe');
    expect(overview.policy.userCap).toBeNull();
    expect(overview.policy.escalation.recommended).toBe(false);
    expect(overview.policy.escalation.body).toMatch(/Add a project cap/);
  });
});
