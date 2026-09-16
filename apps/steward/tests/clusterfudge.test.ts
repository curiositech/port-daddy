/**
 * Clusterfudge tests (THE_FULL_WHEEL.md §9): the breaker's state machine, its
 * idempotent trip, the ack-with-decision release, the page's decision-menu
 * shape, and the registry's honesty about which tripwires are actually armed.
 *
 * The properties these pin are the ones a freeze is worthless without: it
 * cannot be released by anything but an operator, it preserves the FIRST
 * cause, and it never crashes the tick that has to keep reporting it.
 */

import { describe, it, expect } from 'vitest';
import {
  ackClusterfudge,
  isFrozen,
  readClusterfudge,
  renderClusterfudgePage,
  tripClusterfudge,
  CLUSTERFUDGE_KEY,
  TRIPWIRES,
  type ClusterfudgeState,
} from '../src/clusterfudge.js';
import { FakeStorage } from './harness.js';

const NOW = 1_700_000_000_000;

describe('the breaker — trip, freeze, release', () => {
  it('a fresh seat reads clear and is not frozen', async () => {
    const store = new FakeStorage();
    const s = await readClusterfudge(store);
    expect(s.tripped).toBe(false);
    expect(isFrozen(s)).toBe(false);
  });

  it('a trip freezes and records the tripwire, evidence, and time', async () => {
    const store = new FakeStorage();
    const s = await tripClusterfudge(store, 'land-fail-loop', '#12 failed 3 ways', NOW);
    expect(s).toMatchObject({ tripped: true, tripwire: 'land-fail-loop', trippedAt: NOW });
    expect(isFrozen(await readClusterfudge(store))).toBe(true);
  });

  it('tripping again preserves the FIRST cause — later trips are consequences', async () => {
    const store = new FakeStorage();
    await tripClusterfudge(store, 'land-fail-loop', 'first cause', NOW);
    const s = await tripClusterfudge(store, 'budget-breach', 'second cause', NOW + 5000);
    expect(s).toMatchObject({ tripwire: 'land-fail-loop', evidence: 'first cause', trippedAt: NOW });
  });

  it('an ack releases and records who decided what', async () => {
    const store = new FakeStorage();
    await tripClusterfudge(store, 'land-fail-loop', '#12 failed 3 ways', NOW);
    const s = await ackClusterfudge(store, 'erich', 'abandon the PR', NOW + 60_000);
    expect(isFrozen(s)).toBe(false);
    expect(s).toMatchObject({ ackedBy: 'erich', ackDecision: 'abandon the PR', ackedAt: NOW + 60_000 });
    // The trip's forensics survive the release — the history is the point.
    expect(s).toMatchObject({ tripwire: 'land-fail-loop', evidence: '#12 failed 3 ways', trippedAt: NOW });
  });

  it('acking a clear breaker is a no-op, not an error — the operator may be racing a release', async () => {
    const store = new FakeStorage();
    const s = await ackClusterfudge(store, 'erich', 'nothing to do', NOW);
    expect(s.tripped).toBe(false);
  });

  it('a corrupt record degrades to clear rather than crashing the tick', async () => {
    const store = new FakeStorage();
    await store.put(CLUSTERFUDGE_KEY, 'not-an-object');
    expect((await readClusterfudge(store)).tripped).toBe(false);
    await store.put(CLUSTERFUDGE_KEY, { tripwire: 'land-fail-loop' } as unknown as ClusterfudgeState);
    expect((await readClusterfudge(store)).tripped).toBe(false);
  });
});

describe('the page — a decision menu, not a wall of logs', () => {
  it('names what fired, the evidence, the options, and how to release', async () => {
    const store = new FakeStorage();
    await tripClusterfudge(store, 'land-fail-loop', '#12: 409 | 403 | 405', NOW);
    const page = renderClusterfudgePage(await readClusterfudge(store));
    expect(page).toContain('FROZEN pending human decision');
    expect(page).toContain('land-fail-loop');
    expect(page).toContain('#12: 409 | 403 | 405');
    expect(page).toContain('1. abandon the PR');
    expect(page).toContain('/clusterfudge/ack');
    // A wall of logs is exactly what this must not be.
    expect(page.split('\n').length).toBeLessThan(12);
  });

  it('a clear breaker renders one line', () => {
    expect(renderClusterfudgePage({ tripped: false })).toBe('CLUSTERFUDGE: clear.');
  });
});

describe('the tripwire registry — an inventory, not an aspiration', () => {
  it('carries all six of §9’s tripwires', () => {
    expect(Object.keys(TRIPWIRES)).toHaveLength(6);
  });

  it('arms exactly the one whose evidence the seat holds today, and says what the rest await', () => {
    const armed = Object.values(TRIPWIRES).filter(t => t.armed).map(t => t.id);
    expect(armed).toEqual(['land-fail-loop']);
    for (const t of Object.values(TRIPWIRES)) {
      // An unarmed tripwire must name its blocker; an armed one needs no excuse.
      if (!t.armed) expect(t.awaits).toBeTruthy();
      expect(t.decisionMenu.length).toBeGreaterThan(0);
      expect(t.threshold).toBeTruthy();
    }
  });
});
