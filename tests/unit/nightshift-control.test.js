/**
 * Tests for the nightshift kill-switch / status surface.
 *
 * Each test uses a unique PD_STATE_DIR under ~/coding/tmp/ so the operator's
 * real ~/.pd is never touched.
 */

import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';

import { createTestDb } from '../setup-unit.js';
import { createNightshiftQueue } from '../../lib/nightshift/queue.js';
import {
  disableNightshift,
  enableNightshift,
  readDisableState,
  haltAll,
  haltIntent,
  recordSpawnPid,
  getStatusReport,
  clearSpawnPid,
} from '../../lib/nightshift/control.js';

function freshStateDir() {
  const dir = join(homedir(), 'coding', 'tmp', `pd-night-ctl-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  process.env.PD_STATE_DIR = dir;
  return dir;
}

function cleanupStateDir(dir) {
  delete process.env.PD_STATE_DIR;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('disable / enable', () => {
  let stateDir;
  beforeEach(() => { stateDir = freshStateDir(); });
  afterEach(() => { cleanupStateDir(stateDir); });

  test('readDisableState returns disabled=false when the flag is absent', () => {
    const info = readDisableState();
    expect(info.disabled).toBe(false);
    expect(info.reason).toBeNull();
  });

  test('disableNightshift writes the flag with the supplied reason', () => {
    const info = disableNightshift('on fire');
    expect(info.disabled).toBe(true);
    expect(info.reason).toBe('on fire');
    expect(existsSync(info.flagPath)).toBe(true);
  });

  test('disableNightshift with no reason still writes a flag (with a default body)', () => {
    const info = disableNightshift();
    expect(info.disabled).toBe(true);
    expect(info.reason).toMatch(/disabled by operator/);
  });

  test('enableNightshift removes the flag', () => {
    disableNightshift('temporary');
    const after = enableNightshift();
    expect(after.disabled).toBe(false);
    expect(existsSync(after.flagPath)).toBe(false);
  });

  test('enable when already enabled is idempotent', () => {
    const a = enableNightshift();
    const b = enableNightshift();
    expect(a.disabled).toBe(false);
    expect(b.disabled).toBe(false);
  });

  test('the flag path lives under the configured state dir', () => {
    const info = disableNightshift('x');
    expect(info.flagPath.startsWith(stateDir)).toBe(true);
  });
});

describe('haltIntent / haltAll', () => {
  let db;
  let queue;
  let stateDir;
  beforeEach(() => {
    stateDir = freshStateDir();
    db = createTestDb();
    queue = createNightshiftQueue({ db });
  });
  afterEach(() => {
    db.close();
    cleanupStateDir(stateDir);
  });

  test('haltIntent returns error when intent not found', () => {
    const res = haltIntent(queue, 'no-such-id');
    expect(res.signaled).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  test('haltIntent on a non-running intent reports alreadyGone', () => {
    const intent = queue.propose({ intent: 'foo', autoQueue: true });
    const res = haltIntent(queue, intent.id);
    expect(res.signaled).toBe(false);
    expect(res.alreadyGone).toBe(true);
  });

  test('haltIntent with no recorded PID marks the intent aborted', () => {
    const intent = queue.propose({ intent: 'foo', autoQueue: true });
    queue.markRunning({
      id: intent.id,
      worktreePath: '/some/path',
      branchName: 'night-shift/foo',
      sessionId: 's1',
    });
    const res = haltIntent(queue, intent.id);
    expect(res.signaled).toBe(false);
    expect(res.alreadyGone).toBe(true);
    const reloaded = queue.get(intent.id);
    expect(reloaded.status).toBe('aborted');
  });

  test('haltIntent sends SIGTERM when PID is recorded', () => {
    const intent = queue.propose({ intent: 'foo', autoQueue: true });
    queue.markRunning({
      id: intent.id,
      worktreePath: '/some/path',
      branchName: 'night-shift/foo',
      sessionId: 's1',
    });
    recordSpawnPid(intent.id, 99999);
    const killFn = jest.fn();
    const res = haltIntent(queue, intent.id, { killFn });
    expect(killFn).toHaveBeenCalledWith(99999, 'SIGTERM');
    expect(res.signaled).toBe(true);
    expect(res.signal).toBe('SIGTERM');
  });

  test('haltIntent --kill sends SIGKILL', () => {
    const intent = queue.propose({ intent: 'foo', autoQueue: true });
    queue.markRunning({
      id: intent.id,
      worktreePath: '/some/path',
      branchName: 'night-shift/foo',
      sessionId: 's1',
    });
    recordSpawnPid(intent.id, 99999);
    const killFn = jest.fn();
    const res = haltIntent(queue, intent.id, { killFn, kill: true });
    expect(killFn).toHaveBeenCalledWith(99999, 'SIGKILL');
    expect(res.signal).toBe('SIGKILL');
  });

  test('haltIntent on ESRCH marks intent aborted and clears the PID file', () => {
    const intent = queue.propose({ intent: 'foo', autoQueue: true });
    queue.markRunning({
      id: intent.id,
      worktreePath: '/some/path',
      branchName: 'night-shift/foo',
      sessionId: 's1',
    });
    recordSpawnPid(intent.id, 99999);
    const killFn = jest.fn(() => {
      const e = new Error('kill ESRCH');
      e.code = 'ESRCH';
      throw e;
    });
    const res = haltIntent(queue, intent.id, { killFn });
    expect(res.signaled).toBe(false);
    expect(res.alreadyGone).toBe(true);
    expect(queue.get(intent.id).status).toBe('aborted');
  });

  test('haltAll halts every running intent', () => {
    const a = queue.propose({ intent: 'a', autoQueue: true });
    const b = queue.propose({ intent: 'b', autoQueue: true });
    queue.markRunning({ id: a.id, worktreePath: '/x', branchName: 'night-shift/a', sessionId: 'sa' });
    queue.markRunning({ id: b.id, worktreePath: '/y', branchName: 'night-shift/b', sessionId: 'sb' });
    recordSpawnPid(a.id, 11111);
    recordSpawnPid(b.id, 22222);
    const killFn = jest.fn();
    const res = haltAll(queue, { killFn });
    expect(res.total).toBe(2);
    expect(killFn).toHaveBeenCalledTimes(2);
  });

  test('haltAll on empty queue returns total=0', () => {
    const res = haltAll(queue, { killFn: jest.fn() });
    expect(res.total).toBe(0);
    expect(res.results).toHaveLength(0);
  });
});

describe('getStatusReport', () => {
  let db;
  let queue;
  let stateDir;
  beforeEach(() => {
    stateDir = freshStateDir();
    db = createTestDb();
    queue = createNightshiftQueue({ db });
  });
  afterEach(() => {
    db.close();
    cleanupStateDir(stateDir);
  });

  test('reports disabled state, active list, and recent terminal list', () => {
    const a = queue.propose({ intent: 'active', autoQueue: true });
    queue.markRunning({
      id: a.id, worktreePath: '/x', branchName: 'night-shift/a', sessionId: 's1',
    });
    const b = queue.propose({ intent: 'done', autoQueue: true });
    queue.markRunning({
      id: b.id, worktreePath: '/y', branchName: 'night-shift/b', sessionId: 's2',
    });
    queue.markComplete({ id: b.id, status: 'succeeded', costUsd: 0.5 });

    const report = getStatusReport(queue);
    expect(report.disabled.disabled).toBe(false);
    expect(report.active.length).toBe(1);
    expect(report.active[0].intentId).toBe(a.id);
    expect(report.recentTerminal.length).toBe(1);
    expect(report.recentTerminal[0].intentId).toBe(b.id);
  });

  test('reports disabled=true when the flag is set', () => {
    disableNightshift('test');
    const report = getStatusReport(queue);
    expect(report.disabled.disabled).toBe(true);
    expect(report.disabled.reason).toBe('test');
  });

  test('elapsedMs is computed against startedAt and the injected clock', () => {
    let now = 1_700_000_000_000;
    const q2 = createNightshiftQueue({ db: createTestDb(), now: () => now });
    const a = q2.propose({ intent: 'active', autoQueue: true });
    q2.markRunning({
      id: a.id, worktreePath: '/x', branchName: 'night-shift/a', sessionId: 's1',
    });
    const later = now + 5 * 60 * 1000;
    const report = getStatusReport(q2, { now: () => later });
    expect(report.active[0].elapsedMs).toBe(5 * 60 * 1000);
  });
});
