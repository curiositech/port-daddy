/**
 * PR LIFECYCLE GATE.
 *
 * The positive cases are cheap; the fail-open cases are the ones that matter.
 * A wrong `over: true` silently removes the review gate from a LIVE pull
 * request and is indistinguishable from a clean run, so every ambiguous input
 * below is pinned to `over: false`.
 */
import { describe, it, expect } from 'vitest';
import { classifyPrLifecycle } from '../src/pr-lifecycle.js';

describe('classifyPrLifecycle — the PR is over', () => {
  it('skips a merged PR, and says merged rather than closed', () => {
    // GitHub reports a merged PR as state:'closed'; "merged" is the useful word.
    const d = classifyPrLifecycle({ state: 'closed', merged: true });
    expect(d.over).toBe(true);
    expect(d.state).toBe('merged');
    expect(d.reason).toMatch(/already merged/);
  });

  it('skips a closed-unmerged PR', () => {
    const d = classifyPrLifecycle({ state: 'closed', merged: false });
    expect(d.over).toBe(true);
    expect(d.state).toBe('closed');
  });

  it('treats merged:true as decisive even if state disagrees', () => {
    expect(classifyPrLifecycle({ state: 'open', merged: true }).over).toBe(true);
  });

  it('is case- and whitespace-insensitive on state', () => {
    expect(classifyPrLifecycle({ state: '  CLOSED  ' }).over).toBe(true);
  });
});

describe('classifyPrLifecycle — the PR is live', () => {
  it('reviews an open PR', () => {
    const d = classifyPrLifecycle({ state: 'open', merged: false });
    expect(d.over).toBe(false);
    expect(d.state).toBe('open');
  });

  it('reviews when merged is absent and state is open', () => {
    expect(classifyPrLifecycle({ state: 'open' }).over).toBe(false);
  });
});

describe('classifyPrLifecycle — fails OPEN on every ambiguity', () => {
  // Rationale, since these look like they are being lenient for no reason:
  // wrongly reviewing a dead PR costs a few model calls. Wrongly SKIPPING a
  // live one removes its review gate and reports neutral, which reads as
  // success. The asymmetry decides the direction.
  it('reviews when state is absent entirely', () => {
    const d = classifyPrLifecycle({});
    expect(d.over).toBe(false);
    expect(d.state).toBe('unknown');
    expect(d.reason).toMatch(/absent/);
  });

  it('reviews when state is empty or whitespace', () => {
    expect(classifyPrLifecycle({ state: '' }).over).toBe(false);
    expect(classifyPrLifecycle({ state: '   ' }).over).toBe(false);
  });

  it('reviews on an unrecognised state, and names it in the reason', () => {
    const d = classifyPrLifecycle({ state: 'draft' });
    expect(d.over).toBe(false);
    expect(d.state).toBe('unknown');
    expect(d.reason).toMatch(/unrecognised \(draft\)/);
  });

  it('reviews when merged is a non-boolean truthy value', () => {
    // Only a literal `true` counts. A stray string must not skip a live PR.
    const d = classifyPrLifecycle({ state: 'open', merged: 'yes' as unknown as boolean });
    expect(d.over).toBe(false);
  });
});
