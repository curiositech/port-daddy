// Watcher PID registry — closes the "external `pd watch --exec` children
// survive a daemon crash" gap named in AGENTS.md (2026-07-08 investigation,
// issue #676): a daemon that segfaults never runs stopRunningRecord(), so a
// detached watcher-exec child spawned by lib/fleet-engine.ts's startWatcher()
// fallback path survives as an orphan, still holding its own SSE connection
// open. This registry lets the NEXT boot find and kill those orphans instead
// of letting them accumulate across a crash-loop.
//
// PID-recycling safety (added per Copilot review on PR #879): the sweep must
// NOT kill a PID just because it's alive — the OS can recycle a PID onto an
// unrelated process between the watcher child dying and the next boot's
// sweep, and `process.kill(-pid, ...)` targets that process's whole group.
// sweepStaleWatcherPids takes a `getCommandLine` collaborator instead of a
// bare `isAlive` check, and only kills when the live command line still
// contains the exec fragment recorded at spawn time.

import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  watcherPidKey,
  toExecSnippet,
  loadWatcherPidRegistry,
  saveWatcherPidRegistry,
  sweepStaleWatcherPids,
  looksLikeWatchExecInvocation,
} from '../../lib/watcher-pid-registry.js';

describe('looksLikeWatchExecInvocation', () => {
  test('matches a real pd watch --exec invocation', () => {
    expect(looksLikeWatchExecInvocation('/opt/homebrew/bin/pd watch demo:channel --exec say hi', 'say hi')).toBe(true);
  });

  test('rejects an unrelated process that merely contains the snippet as text', () => {
    expect(looksLikeWatchExecInvocation('some-chat-bot --greeting "say hi" --port 4242', 'say hi')).toBe(false);
  });

  test('rejects a command line with --exec but no watch token', () => {
    expect(looksLikeWatchExecInvocation('some-other-tool --exec "say hi"', 'say hi')).toBe(false);
  });

  test('rejects a command line with a watch token but no --exec flag', () => {
    expect(looksLikeWatchExecInvocation('fswatch --event Created say hi', 'say hi')).toBe(false);
  });

  test('rejects when the snippet appears before --exec, not as its argument', () => {
    expect(looksLikeWatchExecInvocation('pd watch "say hi" --exec notify', 'say hi')).toBe(false);
  });

  test('does not treat "watch" as a substring of another word (e.g. "rewatcher")', () => {
    expect(looksLikeWatchExecInvocation('rewatcher-daemon --exec say hi', 'say hi')).toBe(false);
  });
});

describe('watcherPidKey', () => {
  test('is stable and scoped by project + watcher name', () => {
    expect(watcherPidKey('demo', 'notify')).toBe('demo:notify');
    expect(watcherPidKey('demo', 'notify')).not.toBe(watcherPidKey('other', 'notify'));
  });
});

describe('toExecSnippet', () => {
  test('passes short exec strings through unchanged', () => {
    expect(toExecSnippet('say hi')).toBe('say hi');
  });

  test('truncates pathologically long exec strings so the registry cannot grow unbounded', () => {
    const long = 'x'.repeat(10_000);
    const snippet = toExecSnippet(long);
    expect(snippet.length).toBeLessThan(long.length);
    expect(snippet.length).toBeLessThanOrEqual(500);
  });
});

describe('loadWatcherPidRegistry / saveWatcherPidRegistry', () => {
  test('round-trips through disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-watcher-pids-'));
    try {
      const file = join(dir, 'watcher-pids.json');
      const registry = { 'demo:notify': { pid: 4242, startedAt: 111, execSnippet: 'say hi' } };
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
      saveWatcherPidRegistry(file, { 'demo:notify': { pid: 1, startedAt: 1, execSnippet: 'x' } });
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'demo:notify': { pid: 1, startedAt: 1, execSnippet: 'x' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sweepStaleWatcherPids', () => {
  test('kills and drops an entry whose live command line matches the recorded execSnippet', () => {
    const registry = { 'demo:notify': { pid: 4242, startedAt: 1, execSnippet: 'say hi' } };
    const killedPids = [];
    const result = sweepStaleWatcherPids(
      registry,
      'demo',
      () => 'pd watch demo:channel --exec "say hi"', // live process, command matches
      (pid) => killedPids.push(pid),
    );
    expect(killedPids).toEqual([4242]);
    expect(result.killed).toEqual([{ key: 'demo:notify', pid: 4242 }]);
    expect(result.unconfirmed).toEqual([]);
    expect(result.registry).toEqual({}); // dropped either way
  });

  // The core PID-recycling defense (Copilot review, PR #879): a live PID
  // whose command line does NOT contain the recorded exec fragment must be
  // left alone, not killed, because the OS may have recycled that PID onto
  // an unrelated process since the original watcher child died.
  test('does NOT kill a live PID whose command line no longer matches — reports it as unconfirmed instead', () => {
    const registry = { 'demo:notify': { pid: 4242, startedAt: 1, execSnippet: 'say hi' } };
    const killCalls = [];
    const result = sweepStaleWatcherPids(
      registry,
      'demo',
      () => 'some-unrelated-daemon --serve --port 9999', // PID recycled onto a stranger
      (pid) => killCalls.push(pid),
    );
    expect(killCalls).toEqual([]);
    expect(result.killed).toEqual([]);
    expect(result.unconfirmed).toEqual([{ key: 'demo:notify', pid: 4242 }]);
    expect(result.registry).toEqual({}); // still dropped from the registry — stale either way
  });

  test('an entry with no execSnippet at all (pre-dates the field) is never killed, always unconfirmed when alive', () => {
    const registry = { 'demo:notify': { pid: 4242, startedAt: 1 } }; // no execSnippet
    const killCalls = [];
    const result = sweepStaleWatcherPids(
      registry,
      'demo',
      () => 'literally anything, even a plausible-looking watch command',
      (pid) => killCalls.push(pid),
    );
    expect(killCalls).toEqual([]);
    expect(result.unconfirmed).toEqual([{ key: 'demo:notify', pid: 4242 }]);
  });

  test('does not call kill or report unconfirmed for an already-dead entry (getCommandLine returns null), but still drops it', () => {
    const registry = { 'demo:notify': { pid: 4242, startedAt: 1, execSnippet: 'say hi' } };
    const killCalls = [];
    const result = sweepStaleWatcherPids(registry, 'demo', () => null, (pid) => killCalls.push(pid));
    expect(killCalls.length).toBe(0);
    expect(result.killed).toEqual([]);
    expect(result.unconfirmed).toEqual([]);
    expect(result.registry).toEqual({});
  });

  test('leaves entries belonging to a DIFFERENT project untouched', () => {
    const registry = {
      'demo:notify': { pid: 1, startedAt: 1, execSnippet: 'a' },
      'other-project:watch': { pid: 2, startedAt: 2, execSnippet: 'b' },
    };
    const killedPids = [];
    const result = sweepStaleWatcherPids(
      registry,
      'demo',
      () => 'pd watch some:channel --exec "a"', // matches demo:notify's snippet
      (pid) => killedPids.push(pid),
    );
    expect(killedPids).toEqual([1]);
    expect(result.registry).toEqual({ 'other-project:watch': { pid: 2, startedAt: 2, execSnippet: 'b' } });
  });

  test('a project name that is a prefix of another project does not collide (colon-scoped keys)', () => {
    // "demo" must not match "demo-extended:watch" — the sweep matches on the
    // literal "demo:" prefix (with the separator), not a bare substring.
    const registry = { 'demo-extended:watch': { pid: 9, startedAt: 1, execSnippet: 'x' } };
    const killedPids = [];
    const result = sweepStaleWatcherPids(registry, 'demo', () => 'pd watch c --exec "x"', (pid) => killedPids.push(pid));
    expect(killedPids).toEqual([]);
    expect(result.registry).toEqual(registry);
  });

  // The core defense against a coincidental substring match (2nd Copilot
  // review round, PR #879): a bare `cmdline.includes(execSnippet)` check
  // could false-positive-match an unrelated process whose OWN arguments
  // happen to contain the same short/generic text as the recorded snippet —
  // especially likely after PID reuse, since the new process has nothing to
  // do with watchers at all.
  test('does NOT kill a live PID whose command line coincidentally contains the exec snippet but is not a watch --exec invocation', () => {
    const registry = { 'demo:notify': { pid: 4242, startedAt: 1, execSnippet: 'say hi' } };
    const killCalls = [];
    const result = sweepStaleWatcherPids(
      registry,
      'demo',
      // An unrelated process whose arguments happen to contain "say hi" as
      // plain text, but is NOT a `pd watch ... --exec ...` invocation.
      () => 'some-unrelated-chat-bot --greeting "say hi" --port 4242',
      (pid) => killCalls.push(pid),
    );
    expect(killCalls).toEqual([]);
    expect(result.unconfirmed).toEqual([{ key: 'demo:notify', pid: 4242 }]);
  });

  test('empty registry sweeps cleanly with no kills', () => {
    const result = sweepStaleWatcherPids({}, 'demo', () => 'anything', () => {
      throw new Error('should never be called');
    });
    expect(result.killed).toEqual([]);
    expect(result.unconfirmed).toEqual([]);
    expect(result.registry).toEqual({});
  });
});
