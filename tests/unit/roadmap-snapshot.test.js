/**
 * Unit Tests for the Roadmap Snapshot Reconciliation Guard (lib/roadmap-snapshot.ts)
 *
 * Regression coverage for a real data-loss bug: buildRoadmapSnapshot() used
 * to do a pure "SELECT * and serialize" with no awareness of the committed
 * file it was about to overwrite, so any daemon whose roadmap_items table
 * isn't a strict superset of prior history (an ephemeral/parallel instance,
 * a restored backup, a partial-loss DB) could silently truncate the
 * committed docs/roadmap/roadmap.snapshot.json on the next export. This
 * suite pins the shrink guard added to close that gap, alongside the
 * pre-existing empty-snapshot guard.
 */

import { describe, it, expect } from '@jest/globals';
import { buildRoadmapSnapshot } from '../../lib/roadmap-snapshot.js';

function fakeFetch(items) {
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      return { success: true, items };
    },
  });
}

function item(slug, status = 'backlog', summaryMd = `Summary for ${slug}`) {
  return { slug, status, summaryMd };
}

describe('roadmap-snapshot / empty guard (pre-existing)', () => {
  it('refuses an empty snapshot', async () => {
    await expect(
      buildRoadmapSnapshot({ baseUrl: 'http://x', harbor: 'port-daddy', fetchImpl: fakeFetch([]) }),
    ).rejects.toThrow(/EMPTY/);
  });
});

describe('roadmap-snapshot / shrink guard', () => {
  it('allows a build with no previous snapshot to reconcile against', async () => {
    const snapshot = await buildRoadmapSnapshot({
      baseUrl: 'http://x',
      harbor: 'port-daddy',
      fetchImpl: fakeFetch([item('a'), item('b')]),
    });
    expect(snapshot.count).toBe(2);
  });

  it('allows a build that keeps (or grows) all previously-known slugs', async () => {
    const previousSnapshot = { items: [item('a'), item('b')] };
    const snapshot = await buildRoadmapSnapshot({
      baseUrl: 'http://x',
      harbor: 'port-daddy',
      fetchImpl: fakeFetch([item('a'), item('b'), item('c')]),
      previousSnapshot,
    });
    expect(snapshot.count).toBe(3);
  });

  it('allows a small shrink under the default guard fraction', async () => {
    // 10 previous slugs, 1 missing (10%) — under the default 20% threshold.
    const previous = Array.from({ length: 10 }, (_, i) => item(`s${i}`));
    const now = previous.slice(1); // drop s0 only
    const snapshot = await buildRoadmapSnapshot({
      baseUrl: 'http://x',
      harbor: 'port-daddy',
      fetchImpl: fakeFetch(now),
      previousSnapshot: { items: previous },
    });
    expect(snapshot.count).toBe(9);
  });

  it('REFUSES a build that drops most previously-known slugs (the bug this guard exists for)', async () => {
    // Reproduces exactly what happened in practice: a from-scratch daemon
    // with only 10 items, reconciled against a 298-entry committed snapshot.
    const previous = Array.from({ length: 298 }, (_, i) => item(`prod-item-${i}`));
    const freshDaemon = Array.from({ length: 10 }, (_, i) => item(`new-item-${i}`));
    await expect(
      buildRoadmapSnapshot({
        baseUrl: 'http://x',
        harbor: 'port-daddy',
        fetchImpl: fakeFetch(freshDaemon),
        previousSnapshot: { items: previous },
      }),
    ).rejects.toThrow(/Refusing to build a snapshot that drops/);
  });

  it('names some of the missing slugs in the error message', async () => {
    const previous = [item('keep-me'), item('lost-item-1'), item('lost-item-2')];
    const now = [item('keep-me')];
    await expect(
      buildRoadmapSnapshot({
        baseUrl: 'http://x',
        harbor: 'port-daddy',
        fetchImpl: fakeFetch(now),
        previousSnapshot: { items: previous },
      }),
    ).rejects.toThrow(/lost-item-1/);
  });

  it('respects a custom shrinkGuardFraction', async () => {
    const previous = [item('a'), item('b'), item('c'), item('d')];
    const now = [item('a'), item('b')]; // 50% missing

    // Default guard (20%) refuses.
    await expect(
      buildRoadmapSnapshot({
        baseUrl: 'http://x',
        harbor: 'port-daddy',
        fetchImpl: fakeFetch(now),
        previousSnapshot: { items: previous },
      }),
    ).rejects.toThrow();

    // A caller-widened guard (60%) allows the same shrink through.
    const snapshot = await buildRoadmapSnapshot({
      baseUrl: 'http://x',
      harbor: 'port-daddy',
      fetchImpl: fakeFetch(now),
      previousSnapshot: { items: previous },
      shrinkGuardFraction: 0.6,
    });
    expect(snapshot.count).toBe(2);
  });

  it('allowShrink bypasses the guard entirely for an intentional bulk deletion', async () => {
    const previous = Array.from({ length: 100 }, (_, i) => item(`old-${i}`));
    const now = [item('the-one-survivor')];
    const snapshot = await buildRoadmapSnapshot({
      baseUrl: 'http://x',
      harbor: 'port-daddy',
      fetchImpl: fakeFetch(now),
      previousSnapshot: { items: previous },
      allowShrink: true,
    });
    expect(snapshot.count).toBe(1);
  });
});
