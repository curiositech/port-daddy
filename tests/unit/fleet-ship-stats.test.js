// Producer test for scripts/fleet-ship-stats.mjs — the per-ship × per-model
// scoreboard the fleet's model decisions are judged against. The queries and
// renderer are the load-bearing parts (the wrangler transport is a thin
// shell), so this suite pins: the SQL windows on the requested day count and
// reads the real table/step names, the renderer surfaces the UNPRICED flag
// (how gpt-oss-20b metered $0 for a week), and argument validation rejects
// the values that would otherwise be inlined into SQL.
import { describe, test, expect } from '@jest/globals';
import { buildQueries, renderShipStats, parseArgs } from '../../scripts/fleet-ship-stats.mjs';

describe('buildQueries', () => {
  test('windows every query on the requested day count', () => {
    const q = buildQueries(7);
    for (const sql of Object.values(q)) {
      expect(sql).toContain('unixepoch() - 7 * 86400');
    }
  });

  test('reads the real tables and step kinds the executor writes', () => {
    const q = buildQueries(14);
    expect(q.spend).toContain('FROM fleet_run_spend');
    expect(q.spend).toContain('GROUP BY ship, model');
    expect(q.health).toContain('FROM fleet_run_steps');
    for (const kind of ['ship-broken', 'ship-no-output', 'ship-adjudicated', 'ship-repair']) {
      expect(q.health).toContain(kind);
    }
    expect(q.purser).toContain('purser-author-repair');
    expect(q.purser).toContain('NON-EXECUTABLE');
    expect(q.runs).toContain('FROM fleet_runs');
  });

  test('rejects a non-positive or fractional window (the inlined-SQL guard)', () => {
    expect(() => buildQueries(0)).toThrow();
    expect(() => buildQueries(-3)).toThrow();
    expect(() => buildQueries(1.5)).toThrow();
  });
});

describe('renderShipStats', () => {
  const data = {
    days: 14,
    runs: [
      { conclusion: 'neutral', n: 249 },
      { conclusion: 'failure', n: 54 },
      { conclusion: 'success', n: 18 },
    ],
    spend: [
      { ship: 'purser', model: '@cf/qwen/qwen3-30b-a3b-fp8', calls: 171, in_tok: 8622265, out_tok: 2483314, usd: 0 },
      { ship: 'qa', model: '@cf/qwen/qwen3-30b-a3b-fp8', calls: 380, in_tok: 8417151, out_tok: 1174529, usd: 0.8283 },
    ],
    health: [
      { ship: 'purser', kind: 'ship-broken', n: 124 },
      { ship: 'purser', kind: 'ship-adjudicated', n: 124 },
      { ship: 'qa', kind: 'ship-broken', n: 4 },
      { ship: 'qa', kind: 'ship-repair', n: 15 },
    ],
    purser: [
      { kind: 'purser-author-repair', outcome: 'failed', n: 83 },
      { kind: 'purser-author-repair', outcome: 'healed', n: 22 },
      { kind: 'purser-tests', outcome: 'non-executable', n: 121 },
    ],
  };

  test('flags a token-bearing $0 row as UNPRICED and leaves priced rows unflagged', () => {
    const text = renderShipStats(data);
    const purserLine = text.split('\n').find(l => l.startsWith('purser') && l.includes('@cf/'));
    expect(purserLine).toContain('UNPRICED');
    const qaLine = text.split('\n').find(l => l.startsWith('qa') && l.includes('@cf/'));
    expect(qaLine).not.toContain('UNPRICED');
  });

  test('orders step health by broken count so the worst ship reads first', () => {
    const text = renderShipStats(data);
    const healthIdx = text.indexOf('STEP HEALTH');
    const purserRow = text.split('\n').find(l => l.startsWith('purser') && !l.includes('@cf/'));
    expect(purserRow).toContain('124');
    expect(text.indexOf('purser', healthIdx)).toBeLessThan(text.indexOf('qa', healthIdx));
  });

  test('carries the verdict mix and the authoring funnel', () => {
    const text = renderShipStats(data);
    expect(text).toContain('neutral=249');
    expect(text).toContain('purser-author-repair');
    expect(text).toContain('failed');
    expect(text).toContain('83');
  });
});

describe('parseArgs', () => {
  test('defaults to a 14-day window against the shared relay database', () => {
    expect(parseArgs([])).toEqual({
      days: 14,
      database: 'port-daddy-relay',
      config: 'apps/fleet-executor/wrangler.deploy.toml',
    });
  });

  test('honors overrides and rejects a bad window', () => {
    expect(parseArgs(['--days', '30', '--database', 'x']).days).toBe(30);
    expect(() => parseArgs(['--days', 'nope'])).toThrow();
    expect(() => parseArgs(['--days', '0'])).toThrow();
  });
});
