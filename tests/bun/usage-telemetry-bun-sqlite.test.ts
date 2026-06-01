/**
 * Regression test for the bun:sqlite usage-telemetry bind bug.
 *
 * RUNTIME: `bun test` only. `lib/usage-telemetry.ts` `record()` builds an
 * INSERT into `usage_events`. It previously used better-sqlite3's bare-key
 * `@named` object binding (`@timestamp, @surface, ...` bound with
 * `{ timestamp, surface, ... }`). That idiom is INVALID under bun:sqlite
 * (the `bun build --compile` daemon): the parameters resolve to NULL, so
 * the very first `NOT NULL` column (`timestamp`) throws
 * "NOT NULL constraint failed". This is the same class of bug #193 fixed
 * for the roadmap routes; this test pins the telemetry path under the
 * real engine so it cannot silently re-regress.
 *
 * The fix converts the INSERT to positional `?` bound from an ordered
 * `INSERT_COLUMNS` array. This test drives the REAL `createUsageTelemetry`
 * against a real `bun:sqlite` Database and asserts a row is written and
 * read back correctly. Run against the pre-fix source and it throws
 * "NOT NULL constraint failed: usage_events.timestamp".
 */

import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createUsageTelemetry } from '../../lib/usage-telemetry.ts';

const BUILD = { version: '0.0.0-test', codeHash: 'deadbeef', buildDate: '2026-01-01' };

describe('createUsageTelemetry().record() under real bun:sqlite', () => {
  test('records a minimal event without throwing (the bind fix)', () => {
    const db = new Database(':memory:');
    const telemetry = createUsageTelemetry(db as never, BUILD);

    const result = telemetry.record({ surface: 'cli', kind: 'command', name: 'test.repro' });
    expect(result.success).toBe(true);
    expect(typeof result.id).toBe('number');

    const rows = db.query('SELECT surface, kind, name, version FROM usage_events').all() as Array<{
      surface: string; kind: string; name: string; version: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].surface).toBe('cli');
    expect(rows[0].kind).toBe('command');
    expect(rows[0].name).toBe('test.repro');
    // version defaults from build meta — proves the positional bind is
    // delivering values, not NULLs.
    expect(rows[0].version).toBe('0.0.0-test');
  });

  test('records a fully-populated event with typed numeric fields', () => {
    const db = new Database(':memory:');
    const telemetry = createUsageTelemetry(db as never, BUILD);

    telemetry.record({
      surface: 'agent',
      kind: 'spawn',
      name: 'fleet.qa',
      agentId: 'agent-1',
      backend: 'claude-cli',
      model: 'opus',
      project: 'port-daddy',
      durationMs: 1234,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.42,
      costIsEstimate: true,
    });

    const row = db
      .query('SELECT input_tokens, output_tokens, total_tokens, cost_usd, cost_is_estimate, duration_ms FROM usage_events')
      .get() as Record<string, number>;
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
    expect(row.total_tokens).toBe(150);
    expect(row.cost_usd).toBeCloseTo(0.42, 5);
    expect(row.cost_is_estimate).toBe(1);
    expect(row.duration_ms).toBe(1234);
  });
});
