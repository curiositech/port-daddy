import { describe, test, expect } from '@jest/globals';
import {
  classifyLifecycle, classifyAttention, pickBreadcrumb, surfacedStatus,
  HARBOR_ENGAGEMENT_WINDOW_MS, HARBOR_PASS_OVER_MS, CLEAN_HEALTH,
} from '../../lib/session-state.js';

const MIN = 60 * 1000;

describe('classifyLifecycle (git truth)', () => {
  const base = { hasCommits: true, worktreeExists: true, branchMerged: false, operatorClosed: false };
  test('worktree gone → archived', () => expect(classifyLifecycle({ ...base, worktreeExists: false })).toBe('archived'));
  test('branch merged → landed', () => expect(classifyLifecycle({ ...base, branchMerged: true })).toBe('landed'));
  test('operator done → landed', () => expect(classifyLifecycle({ ...base, operatorClosed: true })).toBe('landed'));
  test('no commits → nascent', () => expect(classifyLifecycle({ ...base, hasCommits: false })).toBe('nascent'));
  test('has work, unlanded → open', () => expect(classifyLifecycle(base)).toBe('open'));
});

describe('classifyAttention — the fridge/cohort model', () => {
  const now = 10_000_000;
  test('no harbor activity → resting (fridge, indefinite)', () => {
    expect(classifyAttention({ memberLastTouchedMs: now - 999 * MIN, harborLastActivityMs: null, nowMs: now })).toBe('resting');
  });
  test('harbor quiet > 45m → window closed → resting (you wandered off)', () => {
    expect(classifyAttention({ memberLastTouchedMs: now - 50 * MIN, harborLastActivityMs: now - 50 * MIN, nowMs: now })).toBe('resting');
  });
  test('age in the fridge is NOT decay: 3-week-old, no activity → resting, not stale', () => {
    expect(classifyAttention({ memberLastTouchedMs: now - 21 * 24 * 60 * MIN, harborLastActivityMs: now - 21 * 24 * 60 * MIN, nowMs: now })).toBe('resting');
  });
  test('window open + you just touched THIS one → engaged', () => {
    expect(classifyAttention({ memberLastTouchedMs: now - 5 * MIN, harborLastActivityMs: now - 5 * MIN, nowMs: now })).toBe('engaged');
  });
  test('window open (sibling active) but skipping this one < 2h → passed_over', () => {
    expect(classifyAttention({ memberLastTouchedMs: now - 70 * MIN, harborLastActivityMs: now - 2 * MIN, nowMs: now })).toBe('passed_over');
  });
  test('window open, passed over > 2h → cooling (the nudge)', () => {
    expect(classifyAttention({ memberLastTouchedMs: now - 150 * MIN, harborLastActivityMs: now - 2 * MIN, nowMs: now })).toBe('cooling');
  });
  test('warming one sibling starts the clock on a never-touched sibling → cooling', () => {
    // sibling never touched this session (Infinity idle), harbor active now → cooling
    expect(classifyAttention({ memberLastTouchedMs: null, harborLastActivityMs: now - 1 * MIN, nowMs: now })).toBe('cooling');
  });
  test('tunables are the locked 45m / 2h', () => {
    expect(HARBOR_ENGAGEMENT_WINDOW_MS).toBe(45 * MIN);
    expect(HARBOR_PASS_OVER_MS).toBe(120 * MIN);
  });
});

describe('pickBreadcrumb', () => {
  test('prefers a Result: handoff over older notes', () => {
    const got = pickBreadcrumb([
      { summary: 'Scope: editing sugar.ts', updatedAt: 1 },
      { summary: 'Result: shipped PR #267; next: status machine', updatedAt: 2 },
    ]);
    expect(got.summary).toMatch(/^Result:/);
  });
  test('falls back to most recent when no structured prefix', () => {
    const got = pickBreadcrumb([{ summary: 'old', updatedAt: 1 }, { summary: 'newer', updatedAt: 5 }]);
    expect(got.summary).toBe('newer');
  });
  test('empty → null', () => expect(pickBreadcrumb([])).toBeNull());
});

describe('surfacedStatus — worst-actionable-first chip', () => {
  const S = (over) => ({ lifecycle: 'open', attention: 'engaged', health: { ...CLEAN_HEALTH }, breadcrumb: null, lastTouchedMs: 0, ...over });
  test('conflicted beats hot', () => expect(surfacedStatus(S({ health: { behind: false, conflicted: true, duplicative: [] } }))).toBe('conflicted'));
  test('duplicative beats cooling', () => expect(surfacedStatus(S({ attention: 'cooling', health: { behind: false, conflicted: false, duplicative: ['wt-b'] } }))).toBe('duplicative'));
  test('cooling beats engaged', () => expect(surfacedStatus(S({ attention: 'cooling' }))).toBe('cooling'));
  test('landed wins regardless of heat', () => expect(surfacedStatus(S({ lifecycle: 'landed', attention: 'engaged' }))).toBe('landed'));
  test('resting open with clean health → resting', () => expect(surfacedStatus(S({ attention: 'resting' }))).toBe('resting'));
});
