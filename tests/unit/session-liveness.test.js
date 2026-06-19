import { describe, test, expect } from '@jest/globals';
import { classifySessionLiveness, decideBeginResume } from '../../lib/session-liveness.js';

const BASE = { status: 'active', lastHeartbeatMs: 1000, nowMs: 1000, liveTtlMs: 60000 };

describe('classifySessionLiveness — work reality, not the clock', () => {
  test('fresh heartbeat → active', () => {
    expect(classifySessionLiveness({ ...BASE, nowMs: 1000 }).state).toBe('active');
  });
  test('two-day-old session, worktree intact, unmerged → DORMANT, not dead', () => {
    const twoDays = 1000 + 2 * 24 * 3600 * 1000;
    const l = classifySessionLiveness({ ...BASE, nowMs: twoDays, worktree: { exists: true, branchMerged: false } });
    expect(l.state).toBe('dormant');
  });
  test('no heartbeat ever → dormant (still resumable), not done', () => {
    expect(classifySessionLiveness({ ...BASE, lastHeartbeatMs: null, nowMs: 999999 }).state).toBe('dormant');
  });
  test('operator completed → done/completed regardless of anything', () => {
    const l = classifySessionLiveness({ ...BASE, status: 'completed' });
    expect(l).toEqual({ state: 'done', reason: 'completed' });
  });
  test('worktree removed → done/worktree-removed', () => {
    const l = classifySessionLiveness({ ...BASE, nowMs: 1e12, worktree: { exists: false, branchMerged: false } });
    expect(l).toEqual({ state: 'done', reason: 'worktree-removed' });
  });
  test('branch merged → done/branch-merged (work landed)', () => {
    const l = classifySessionLiveness({ ...BASE, nowMs: 1e12, worktree: { exists: true, branchMerged: true } });
    expect(l).toEqual({ state: 'done', reason: 'branch-merged' });
  });
});

describe('decideBeginResume', () => {
  test('dormant → resume, no warning (the come-back path)', () => {
    expect(decideBeginResume({ state: 'dormant', idleMs: 9e9 })).toEqual({ action: 'resume', warn: null });
  });
  test('active → resume with driven-elsewhere warning (soft, not a block)', () => {
    expect(decideBeginResume({ state: 'active', attachedAgentId: 'a', idleMs: 1 })).toEqual({ action: 'resume', warn: 'driven-elsewhere' });
  });
  test('done → create fresh', () => {
    expect(decideBeginResume({ state: 'done', reason: 'completed' })).toEqual({ action: 'create' });
  });
});
