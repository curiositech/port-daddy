/**
 * Tests for lib/observability/gated-loader.ts — the fix for the `getEmbedder()` permanent-rejection
 * runaway. Each test guards a property whose absence produced the 313 GB storm:
 *
 *   - success memoizes                    (happy path unchanged; load runs once)
 *   - after N failures the breaker OPENs  (a broken dep STOPS being re-loaded every tick)
 *   - tryGet returns null when OPEN        (callers skip optional work silently — no spam)
 *   - a transient failure still recovers   (HALF_OPEN probe re-loads after cool-down)
 *   - concurrent callers coalesce          (a burst can't stampede the resource)
 *   - persistent failure is governed       (one line/window, not one per tick)
 */

import { describe, expect, test } from '@jest/globals';
import { createGatedLoader } from '../../lib/observability/gated-loader.js';
import { LogGovernor, type LeveledSink } from '../../lib/observability/log-governor.js';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}
const noSleep = async () => {};

function fakeSink(): { sink: LeveledSink; lines: Array<{ level: string; message: string; meta?: Record<string, unknown> }> } {
  const lines: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];
  const push = (level: string) => (message: string, meta?: Record<string, unknown>) => lines.push({ level, message, meta });
  return { lines, sink: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') } };
}

describe('createGatedLoader', () => {
  test('memoizes a successful load (runs once)', async () => {
    let calls = 0;
    const g = createGatedLoader(async () => { calls++; return 42; }, { name: 'embedder', now: () => 0 });
    expect(await g.get()).toBe(42);
    expect(await g.get()).toBe(42);
    expect(calls).toBe(1);
  });

  test('after failureThreshold the breaker OPENs and stops re-loading', async () => {
    let calls = 0;
    const c = clock();
    const g = createGatedLoader(
      async () => { calls++; throw new Error('Library not loaded: libonnxruntime'); },
      { name: 'embedder', failureThreshold: 3, openTimeoutMs: 60_000, now: c.now, sleep: noSleep },
    );

    // Simulate fleet-agent ticks hammering the resolver.
    for (let i = 0; i < 50; i++) await g.tryGet();

    // Load attempted only until the breaker opened (3), NOT 50 times. This is the runaway fix.
    expect(calls).toBe(3);
    expect(g.state()).toBe('OPEN');
  });

  test('tryGet returns null while OPEN (caller skips optional work)', async () => {
    const c = clock();
    const g = createGatedLoader(
      async () => { throw new Error('down'); },
      { name: 'dep', failureThreshold: 1, openTimeoutMs: 60_000, now: c.now, sleep: noSleep },
    );
    await g.tryGet(); // trips OPEN
    expect(await g.tryGet()).toBeNull();
  });

  test('recovers via a HALF_OPEN probe after the cool-down', async () => {
    let healthy = false;
    let calls = 0;
    const c = clock();
    const g = createGatedLoader(
      async () => { calls++; if (!healthy) throw new Error('warming up'); return 'ready'; },
      { name: 'embedder', failureThreshold: 2, openTimeoutMs: 60_000, now: c.now, sleep: noSleep },
    );
    await g.tryGet(); await g.tryGet(); // 2 failures → OPEN
    expect(g.state()).toBe('OPEN');
    const callsAtOpen = calls;

    // Still cooling: no new load attempts.
    await g.tryGet();
    expect(calls).toBe(callsAtOpen);

    // Cool-down elapsed + dependency now healthy → HALF_OPEN probe loads and closes.
    healthy = true;
    c.advance(60_001);
    expect(await g.tryGet()).toBe('ready');
    expect(g.state()).toBe('CLOSED');
  });

  test('concurrent callers coalesce onto a single in-flight load', async () => {
    let calls = 0;
    let release: (v: number) => void = () => {};
    const gate = new Promise<number>((r) => { release = r; });
    const g = createGatedLoader(async () => { calls++; return gate; }, { name: 'dep', now: () => 0 });

    const a = g.get();
    const b = g.get();
    const c = g.get();
    release(7);
    expect(await Promise.all([a, b, c])).toEqual([7, 7, 7]);
    expect(calls).toBe(1); // one load served all three
  });

  test('persistent load failure is governed to one line per window', async () => {
    const { sink, lines } = fakeSink();
    const c = clock();
    const gov = new LogGovernor(sink, { windowMs: 300_000, burst: 1, now: c.now });
    const g = createGatedLoader(
      async () => { throw new Error('Library not loaded'); },
      { name: 'embedder', failureThreshold: 100, now: c.now, sleep: noSleep }, // high threshold → keeps trying to load
      gov,
    );
    for (let i = 0; i < 20; i++) await g.tryGet();
    const failLines = lines.filter((l) => l.message === 'dependency_load_failed' && !l.meta?.log_rollup);
    expect(failLines.length).toBe(1); // 20 load failures, 1 governed line
  });
});
