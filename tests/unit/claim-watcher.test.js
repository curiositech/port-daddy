/**
 * Unit tests for the daemon-side claim watcher.
 *
 * The watcher hashes every claimed file, diffs against the prior tick,
 * and on a hash change snapshots current bytes and DMs the claim-holder.
 * Tests use a temp dir + a fake `listClaims` so we can exercise the
 * detection without standing up a daemon.
 */
import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClaimWatcher } from '../../lib/claim-watcher.js';

describe('claim watcher', () => {
  let dir;
  let snapshotDir;
  let claims;
  let inboxCalls;
  let noteCalls;
  let watcher;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pd-claim-watcher-'));
    snapshotDir = join(dir, 'snapshots');
    mkdirSync(snapshotDir, { recursive: true });
    claims = [];
    inboxCalls = [];
    noteCalls = [];
    watcher = createClaimWatcher({
      listClaims: () => claims,
      sendInbox: (agentId, content, options) => inboxCalls.push({ agentId, content, options }),
      writeNote: (sessionId, note) => noteCalls.push({ sessionId, note }),
      searchRoots: [dir],
      snapshotDir,
      intervalMs: 60_000, // we drive ticks manually
      log: () => {},
    });
  });

  afterEach(() => {
    watcher.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test('detects no change when content is unchanged across ticks', () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    claims.push({ filePath: 'a.txt', sessionId: 'session-A', agentId: 'agent-A' });

    watcher.start();
    watcher.tickOnce(); // baseline
    watcher.tickOnce(); // unchanged

    const status = watcher.status();
    expect(status.changesDetected).toBe(0);
    expect(status.snapshotsWritten).toBe(0);
    expect(inboxCalls).toEqual([]);
  });

  test('snapshots and DMs the claim-holder when content changes mid-claim', () => {
    writeFileSync(join(dir, 'a.txt'), 'before');
    claims.push({ filePath: 'a.txt', sessionId: 'session-A', agentId: 'agent-A' });

    watcher.start();
    watcher.tickOnce(); // baseline of "before"

    writeFileSync(join(dir, 'a.txt'), 'after-the-stomp');
    watcher.tickOnce();

    const status = watcher.status();
    expect(status.changesDetected).toBe(1);
    expect(status.snapshotsWritten).toBe(1);
    expect(inboxCalls).toHaveLength(1);
    expect(inboxCalls[0]).toEqual(expect.objectContaining({
      agentId: 'agent-A',
      options: expect.objectContaining({ type: 'claim_violation' }),
    }));
    expect(String(inboxCalls[0].content)).toContain('a.txt');

    const sessionDir = join(snapshotDir, 'session-A');
    const entries = readdirSync(sessionDir);
    // One snapshot file + one manifest line
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const manifest = readFileSync(join(sessionDir, 'manifest.jsonl'), 'utf8').trim();
    const lines = manifest.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.filePath).toBe('a.txt');
    expect(entry.sessionId).toBe('session-A');
    // Snapshot captures *prior* (pre-stomp) bytes; recovery is a single
    // read of that file. This is the whole point of the watcher: when
    // another session steamrolls a claim, the bytes-as-they-were are
    // preserved off-tree, not the bytes-as-they-now-are.
    const snapshotBytes = readFileSync(entry.snapshotPath, 'utf8');
    expect(snapshotBytes).toBe('before');
  });

  test('records a daemon-side note when content changes mid-claim', () => {
    writeFileSync(join(dir, 'b.txt'), 'one');
    claims.push({ filePath: 'b.txt', sessionId: 'session-B', agentId: 'agent-B' });

    watcher.start();
    watcher.tickOnce();
    writeFileSync(join(dir, 'b.txt'), 'two');
    watcher.tickOnce();

    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0]).toEqual(expect.objectContaining({
      sessionId: 'session-B',
      note: expect.objectContaining({ type: 'warning' }),
    }));
    expect(String(noteCalls[0].note.content)).toContain('b.txt');
  });

  test('handles missing files gracefully (claim points at a path that does not exist)', () => {
    claims.push({ filePath: 'never-existed.txt', sessionId: 'session-C', agentId: 'agent-C' });
    watcher.start();
    expect(() => watcher.tickOnce()).not.toThrow();
    expect(watcher.status().changesDetected).toBe(0);
  });

  test('pruneOnce removes snapshot blobs older than the retention window and preserves manifest', () => {
    // Stand up a watcher with a short retention. Seed a stale snapshot blob plus
    // a manifest entry; verify the blob disappears and the manifest survives.
    const pruneWatcher = createClaimWatcher({
      listClaims: () => [],
      searchRoots: [dir],
      snapshotDir,
      intervalMs: 60_000,
      retentionDays: 1,
      pruneIntervalMs: 60_000,
      log: () => {},
    });
    const sessionDir = join(snapshotDir, 'sess-old');
    mkdirSync(sessionDir, { recursive: true });
    const stalePath = join(sessionDir, 'stale-blob');
    writeFileSync(stalePath, 'stale');
    const manifestPath = join(sessionDir, 'manifest.jsonl');
    writeFileSync(manifestPath, JSON.stringify({ filePath: 'x', snapshotPath: stalePath }) + '\n');
    const ancient = Date.now() / 1000 - 10 * 24 * 60 * 60;
    utimesSync(stalePath, ancient, ancient);

    const result = pruneWatcher.pruneOnce();
    expect(result.pruned).toBe(1);
    expect(result.bytesFreed).toBeGreaterThan(0);
    expect(readdirSync(sessionDir)).toEqual(['manifest.jsonl']);
    expect(readFileSync(manifestPath, 'utf8')).toContain('stale-blob');
  });

  test('start runs an initial prune so daemon boots clean up old snapshots', () => {
    const pruneWatcher = createClaimWatcher({
      listClaims: () => [],
      searchRoots: [dir],
      snapshotDir,
      intervalMs: 60_000,
      retentionDays: 1,
      pruneIntervalMs: 60_000,
      log: () => {},
    });
    const sessionDir = join(snapshotDir, 'sess-boot');
    mkdirSync(sessionDir, { recursive: true });
    const stalePath = join(sessionDir, 'stale-blob');
    writeFileSync(stalePath, 'stale');
    const ancient = Date.now() / 1000 - 10 * 24 * 60 * 60;
    utimesSync(stalePath, ancient, ancient);

    pruneWatcher.start();
    pruneWatcher.stop();

    expect(pruneWatcher.status().snapshotsPruned).toBe(1);
    expect(readdirSync(sessionDir)).toEqual([]);
  });

  test('multiple claims on the same file under different sessions are tracked independently', () => {
    writeFileSync(join(dir, 'shared.txt'), 'v0');
    claims.push({ filePath: 'shared.txt', sessionId: 'session-A', agentId: 'agent-A' });
    claims.push({ filePath: 'shared.txt', sessionId: 'session-B', agentId: 'agent-B' });

    watcher.start();
    watcher.tickOnce();
    writeFileSync(join(dir, 'shared.txt'), 'v1-stomp');
    watcher.tickOnce();

    expect(watcher.status().changesDetected).toBe(2);
    const recipients = new Set(inboxCalls.map(c => c.agentId));
    expect(recipients).toEqual(new Set(['agent-A', 'agent-B']));
  });
});
