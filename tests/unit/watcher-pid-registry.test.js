// Watcher PID registry — closes the "external `pd watch --exec` children
// survive a daemon crash" gap named in AGENTS.md (2026-07-08 investigation,
// issue #676): a daemon that segfaults never runs stopRunningRecord(), so a
// detached watcher-exec child spawned by lib/fleet-engine.ts's startWatcher()
// fallback path survives as an orphan, still holding its own SSE connection
// open. This registry lets the NEXT boot find and kill those orphans instead
// of letting them accumulate across a crash-loop.

import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  watcherPidKey,
  loadWatcherPidRegistry,
  saveWatcherPidRegistry,
  sweepStaleWatcherPids,
} from '../../lib/watcher-pid-registry.js';

describe('watcherPidKey', () => {
  test('is stable and scoped by project + watcher name', () => {
    expect(watcherPidKey('demo', 'notify')).toBe('demo:notify');
    expect(watcherPidKey('demo', 'notify')).not.toBe(watcherPidKey('other', 'notify'));
  });
});

describe('loadWatcherPidRegistry / saveWatcherPidRegistry', () => {
  test('round-trips through disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-watcher-pids-'));
    try {
      const file = join(dir, 'watcher-pids.json');
      const registry = { 'demo:notify': { pid: 4242, startedAt: 111 } };
      saveWatcherPidRegistry(file, registry);
      expect(existsSync(file)).toBe(true);
      const loaded = loadWatcherPidRegistry(file);
      expect(loaded).toEqual(registry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns empty registry for a missing file (no daemon has ever spawned an external watcher)', () => {
    const registry = loadWatcherPidRegistry('/nonexistent/path/watcher-pids.json');
    expect(registry).toEqual({});
  });

  test('degrades to empty registry for a corrupt/truncated file instead of throwing', () => {
    // A segfault mid-write is exactly the scenario this module exists to
    // survive — a truncated JSON file must never crash the next boot.
    const dir = mkdtempSync(join(tmpdir(), 'pd-watcher-pids-corrupt-'));
    try {
      const file = join(dir, 'watcher-pids.json');
      writeFileSync(file, '{"demo:notify": {"pid": 42, "start'); // truncated
      expect(() => loadWatcherPidRegistry(file)).not.toThrow();
      expect(loadWatcherPidRegistry(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('degrades to empty registry when the file contains a JSON array, not an object', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-watcher-pids-array-'));
    try {
      const file = join(dir, 'watcher-pids.json');
      writeFileSync(file, '[1,2,3]');
      expect(loadWatcherPidRegistry(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('creates parent directories on save', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-watcher-pids-mkdir-'));
    try {
      const file = join(dir, 'nested', 'deep', 'watcher-pids.json');
      saveWatcherPidRegistry(file, { 'demo:notify': { pid: 1, startedAt: 1 } });
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'demo:notify': { pid: 1, startedAt: 1 } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sweepStaleWatcherPids', () => {
  test('kills and drops an alive entry belonging to the given project', () => {
    const registry = { 'demo:notify': { pid: 4242, startedAt: 1 } };
    const killedPids = [];
    const result = sweepStaleWatcherPids(
      registry,
      'demo',
      () => true, // alive
      (pid) => killedPids.push(pid),
    );
    expect(killedPids).toEqual([4242]);
    expect(result.killed).toEqual([{ key: 'demo:notify', pid: 4242 }]);
    expect(result.registry).toEqual({}); // dropped either way
  });

  test('does not call kill for an already-dead entry, but still drops it', () => {
    const registry = { 'demo:notify': { pid: 4242, startedAt: 1 } };
    const killCalls = [];
    const result = sweepStaleWatcherPids(registry, 'demo', () => false, (pid) => killCalls.push(pid));
    expect(killCalls.length).toBe(0);
    expect(result.killed).toEqual([]);
    expect(result.registry).toEqual({});
  });

  test('leaves entries belonging to a DIFFERENT project untouched', () => {
    const registry = {
      'demo:notify': { pid: 1, startedAt: 1 },
      'other-project:watch': { pid: 2, startedAt: 2 },
    };
    const killedPids = [];
    const result = sweepStaleWatcherPids(registry, 'demo', () => true, (pid) => killedPids.push(pid));
    expect(killedPids).toEqual([1]);
    expect(result.registry).toEqual({ 'other-project:watch': { pid: 2, startedAt: 2 } });
  });

  test('a project name that is a prefix of another project does not collide (colon-scoped keys)', () => {
    // "demo" must not match "demo-extended:watch" — the sweep matches on the
    // literal "demo:" prefix (with the separator), not a bare substring.
    const registry = { 'demo-extended:watch': { pid: 9, startedAt: 1 } };
    const killedPids = [];
    const result = sweepStaleWatcherPids(registry, 'demo', () => true, (pid) => killedPids.push(pid));
    expect(killedPids).toEqual([]);
    expect(result.registry).toEqual(registry);
  });

  test('empty registry sweeps cleanly with no kills', () => {
    const result = sweepStaleWatcherPids({}, 'demo', () => true, () => {
      throw new Error('should never be called');
    });
    expect(result.killed).toEqual([]);
    expect(result.registry).toEqual({});
  });
});
