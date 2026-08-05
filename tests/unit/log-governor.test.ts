/**
 * Tests for lib/observability/log-governor.ts — the dedup/rate-limit/sampling primitive
 * whose ABSENCE produced both the `daemon_heartbeat_write_failed` and `semantic_resolution_failed`
 * write storms. Each test guards a property whose violation re-opens that class of bug:
 *
 *   - burst then suppress          → a loop can't emit more than `burst` lines per window
 *   - rollup on window roll        → suppression is REPORTED, never silently lost
 *   - sampling under-counts nothing→ 1-in-N still reports the true total in the rollup
 *   - LRU eviction flushes         → unbounded distinct keys can't leak memory OR drop tails
 *   - a throwing sink never crashes→ observability is not load-bearing for liveness
 */

import { describe, expect, test } from '@jest/globals';
import { LogGovernor, type LeveledSink } from '../../lib/observability/log-governor.js';

interface Captured { level: string; message: string; meta?: Record<string, unknown> }

function fakeSink(): { sink: LeveledSink; lines: Captured[] } {
  const lines: Captured[] = [];
  const push = (level: string) => (message: string, meta?: Record<string, unknown>) =>
    lines.push({ level, message, meta });
  return {
    lines,
    sink: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
  };
}

/** A controllable clock so windows are deterministic. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('LogGovernor — dedup + rate limit', () => {
  test('emits up to burst, then suppresses within a window', () => {
    const { sink, lines } = fakeSink();
    const c = clock();
    const g = new LogGovernor(sink, { windowMs: 60_000, burst: 3, now: c.now });

    for (let i = 0; i < 7_182; i++) {
      g.governed({ key: 'semantic_resolution_failed', level: 'error', message: 'semantic_resolution_failed' });
    }

    // Exactly `burst` real lines — NOT 7,182. This is the fix for the 313 GB storm.
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.level === 'error')).toBe(true);
    expect(lines.every((l) => !l.meta?.log_rollup)).toBe(true);
  });

  test('window roll emits a rollup reporting the suppressed count', () => {
    const { sink, lines } = fakeSink();
    const c = clock();
    const g = new LogGovernor(sink, { windowMs: 60_000, burst: 2, now: c.now });

    for (let i = 0; i < 100; i++) {
      g.governed({ key: 'k', level: 'warn', message: 'heartbeat_wedged' });
    }
    expect(lines.length).toBe(2); // burst only, no rollup yet

    c.advance(60_000);
    // Next call closes the old window → rollup for the 98 suppressed, then a fresh emission.
    g.governed({ key: 'k', level: 'warn', message: 'heartbeat_wedged' });

    const rollup = lines.find((l) => l.meta?.log_rollup);
    expect(rollup).toBeDefined();
    expect(rollup!.meta!.suppressed).toBe(98);
    expect(rollup!.meta!.key).toBe('k');
    expect(rollup!.level).toBe('warn');
  });

  test('distinct keys are governed independently', () => {
    const { sink, lines } = fakeSink();
    const c = clock();
    const g = new LogGovernor(sink, { windowMs: 60_000, burst: 1, now: c.now });

    g.governed({ key: 'a', level: 'info', message: 'a' });
    g.governed({ key: 'a', level: 'info', message: 'a' }); // suppressed
    g.governed({ key: 'b', level: 'info', message: 'b' }); // its own budget

    expect(lines.filter((l) => l.message === 'a').length).toBe(1);
    expect(lines.filter((l) => l.message === 'b').length).toBe(1);
  });
});

describe('LogGovernor — sampling', () => {
  test('sampleEveryN emits 1-in-N but the rollup reports the true total', () => {
    const { sink, lines } = fakeSink();
    const c = clock();
    // burst high enough that dedup never interferes; isolate sampling behavior.
    const g = new LogGovernor(sink, { windowMs: 60_000, burst: 1_000, now: c.now });

    for (let i = 0; i < 10; i++) {
      g.governed({ key: 'req', level: 'info', message: 'request', sampleEveryN: 5 });
    }
    // Every 5th of 10 → 2 emitted (i=5, i=10 in 1-indexed 'seen').
    const emitted = lines.filter((l) => !l.meta?.log_rollup);
    expect(emitted.length).toBe(2);

    c.advance(60_000);
    g.governed({ key: 'req', level: 'info', message: 'request', sampleEveryN: 5 });
    const rollup = lines.find((l) => l.meta?.log_rollup);
    expect(rollup!.meta!.seen).toBe(10); // honest: total seen, not just emitted
    expect(rollup!.meta!.suppressed).toBe(8);
  });
});

describe('LogGovernor — bounded memory', () => {
  test('LRU eviction flushes the evicted key rollup instead of leaking or dropping silently', () => {
    const { sink, lines } = fakeSink();
    const c = clock();
    const g = new LogGovernor(sink, { windowMs: 60_000, burst: 1, maxKeys: 2, now: c.now });

    // Fill 'old' with suppressed occurrences, then push it out with two new keys.
    g.governed({ key: 'old', level: 'error', message: 'old' });
    g.governed({ key: 'old', level: 'error', message: 'old' }); // suppressed (1)
    g.governed({ key: 'mid', level: 'error', message: 'mid' });
    g.governed({ key: 'new', level: 'error', message: 'new' }); // evicts 'old' (oldest)

    const rollup = lines.find((l) => l.meta?.log_rollup && l.meta?.key === 'old');
    expect(rollup).toBeDefined();
    expect(rollup!.meta!.suppressed).toBe(1);
    expect(g.snapshot().map((s) => s.key).sort()).toEqual(['mid', 'new']);
  });

  test('flushAll emits pending rollups for shutdown', () => {
    const { sink, lines } = fakeSink();
    const c = clock();
    const g = new LogGovernor(sink, { windowMs: 60_000, burst: 1, now: c.now });
    for (let i = 0; i < 5; i++) g.governed({ key: 'k', level: 'warn', message: 'k' });
    lines.length = 0; // ignore the burst emission
    g.flushAll();
    expect(lines.length).toBe(1);
    expect(lines[0].meta!.suppressed).toBe(4);
  });
});

describe('LogGovernor — resilience', () => {
  test('a throwing sink never propagates (observability is not load-bearing)', () => {
    const throwing: LeveledSink = {
      debug() { throw new Error('sink down'); },
      info() { throw new Error('sink down'); },
      warn() { throw new Error('sink down'); },
      error() { throw new Error('sink down'); },
    };
    const g = new LogGovernor(throwing, { now: () => 1 });
    expect(() => g.governed({ key: 'k', level: 'error', message: 'k' })).not.toThrow();
    expect(() => g.error('one-shot')).not.toThrow();
  });
});
