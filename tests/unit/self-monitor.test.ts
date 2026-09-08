/**
 * Tests for lib/observability/self-monitor.ts — the alarm that was missing during the 313 GB
 * dev-latest-daemon write storm. Each test guards a property whose absence let that incident
 * run silent:
 *
 *   - crosses ceiling → alarm            (something finally watches our OWN footprint)
 *   - crit vs warn severity              (graduated response)
 *   - growth rate between samples        (fast climb alarms before the ceiling)
 *   - crit raises a durable audit alarm  (not just an ephemeral log line)
 *   - sustained breach is governed       (the alarm can't become the spam it catches)
 */

import { describe, expect, test } from '@jest/globals';
import { SelfMonitor, type MetricSources, type Alarm } from '../../lib/observability/self-monitor.js';
import { LogGovernor, type LeveledSink } from '../../lib/observability/log-governor.js';

function fakeSink(): { sink: LeveledSink; lines: Array<{ level: string; meta?: Record<string, unknown> }> } {
  const lines: Array<{ level: string; meta?: Record<string, unknown> }> = [];
  const push = (level: string) => (_m: string, meta?: Record<string, unknown>) => lines.push({ level, meta });
  return { lines, sink: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') } };
}

function sources(v: { db?: number; wal?: number; rows?: Record<string, number> }): MetricSources {
  return {
    dbBytes: () => v.db ?? 0,
    walBytes: () => v.wal ?? 0,
    rowCount: (t) => v.rows?.[t] ?? 0,
  };
}

const MB = 1024 * 1024;

describe('SelfMonitor', () => {
  test('raises a crit alarm when DB size crosses the crit ceiling', () => {
    const { sink, lines } = fakeSink();
    const gov = new LogGovernor(sink, { now: () => 0 });
    const m = new SelfMonitor(
      sources({ db: 250 * MB }),
      { dbBytes: { warn: 100 * MB, crit: 200 * MB }, walBytes: { warn: 32 * MB, crit: 64 * MB }, tableRows: {}, now: () => 0 },
      gov,
    );
    const s = m.sample();
    const dbAlarm = s.alarms.find((a) => a.metric === 'db_bytes');
    expect(dbAlarm?.severity).toBe('crit');
    expect(lines.some((l) => l.level === 'error' && l.meta?.metric === 'db_bytes')).toBe(true);
  });

  test('warn tier fires below crit', () => {
    const m = new SelfMonitor(
      sources({ db: 150 * MB }),
      { dbBytes: { warn: 100 * MB, crit: 200 * MB }, walBytes: { warn: 32 * MB, crit: 64 * MB }, tableRows: {}, now: () => 0 },
    );
    expect(m.sample().alarms.find((a) => a.metric === 'db_bytes')?.severity).toBe('warn');
  });

  test('per-table row ceilings alarm independently', () => {
    const m = new SelfMonitor(
      sources({ rows: { harbor_issued_tokens: 101_284, messages: 100 } }),
      {
        dbBytes: { warn: Infinity, crit: Infinity },
        walBytes: { warn: Infinity, crit: Infinity },
        tableRows: { harbor_issued_tokens: { warn: 10_000, crit: 50_000 }, messages: { warn: 10_000, crit: 50_000 } },
        now: () => 0,
      },
    );
    const alarms = m.sample().alarms;
    expect(alarms.find((a) => a.metric === 'rows:harbor_issued_tokens')?.severity).toBe('crit');
    expect(alarms.find((a) => a.metric === 'rows:messages')).toBeUndefined();
  });

  test('computes growth rate between samples', () => {
    let db = 100 * MB;
    let t = 0;
    const m = new SelfMonitor(
      { dbBytes: () => db, walBytes: () => 0, rowCount: () => 0 },
      { dbBytes: { warn: 50 * MB, crit: 500 * MB }, walBytes: { warn: Infinity, crit: Infinity }, tableRows: {}, now: () => t },
    );
    m.sample(); // prime
    t = 10_000; // +10s
    db = 100 * MB + 20 * MB; // +20 MB
    const alarm = m.sample().alarms.find((a) => a.metric === 'db_bytes');
    expect(alarm).toBeDefined();
    expect(alarm!.ratePerSec).toBeCloseTo(2 * MB, -3); // ~2 MB/s
  });

  test('crit alarm invokes the durable onAlarm sink; warn does not', () => {
    const durable: Alarm[] = [];
    const critMon = new SelfMonitor(
      sources({ db: 300 * MB }),
      { dbBytes: { warn: 100 * MB, crit: 200 * MB }, walBytes: { warn: Infinity, crit: Infinity }, tableRows: {}, now: () => 0 },
      undefined,
      (a) => durable.push(a),
    );
    critMon.sample();
    expect(durable).toHaveLength(1);
    expect(durable[0].severity).toBe('crit');
  });

  test('sustained breach is governed to one line per window (not per sample)', () => {
    const { sink, lines } = fakeSink();
    let t = 0;
    const gov = new LogGovernor(sink, { windowMs: 300_000, burst: 1, now: () => t });
    const m = new SelfMonitor(
      sources({ db: 300 * MB }),
      { dbBytes: { warn: 100 * MB, crit: 200 * MB }, walBytes: { warn: Infinity, crit: Infinity }, tableRows: {}, now: () => t },
      gov,
    );
    for (let i = 0; i < 50; i++) { t += 1000; m.sample(); }
    // 50 samples, all breaching, but governed to a single error line in the window.
    expect(lines.filter((l) => l.level === 'error' && !l.meta?.log_rollup).length).toBe(1);
  });
});
