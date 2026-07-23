/**
 * Tests for lib/observability/retention-registry.ts — the unified retention layer that closes
 * the `harbor_issued_tokens` (101K) and `semantic_resolution_events` unbounded-growth leaks.
 * Each test guards a property whose absence let those tables grow forever:
 *
 *   - ttlPolicy deletes expired, keeps NULL-expiry   (opt-in permanence honored)
 *   - maxAgePolicy deletes past an absolute horizon   (tokens can't live forever)
 *   - capPolicy keeps only the newest N              (a table with no time horizon is bounded)
 *   - sweepAll isolates a failing policy             (one broken sweep can't starve the rest)
 *   - assertRegistered trips on an unbounded table   (a missing policy fails a TEST, not prod)
 *   - reclaim returns freed pages to the file        (pruning actually shrinks the DB)
 */

import { describe, expect, test, beforeEach } from '@jest/globals';
import Database from 'better-sqlite3';
import {
  RetentionRegistry,
  ttlPolicy,
  maxAgePolicy,
  capPolicy,
} from '../../lib/observability/retention-registry.js';

const NOW = 1_000_000_000_000;

describe('retention policies', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
  });

  test('ttlPolicy deletes expired rows but keeps NULL-expiry (opt-in permanent)', () => {
    db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, expires_at INTEGER)');
    db.prepare('INSERT INTO messages (expires_at) VALUES (?)').run(NOW - 1); // expired
    db.prepare('INSERT INTO messages (expires_at) VALUES (?)').run(NOW + 10_000); // live
    db.prepare('INSERT INTO messages (expires_at) VALUES (?)').run(null); // permanent
    const deleted = ttlPolicy(db, 'messages', 'expires_at').sweep(NOW);
    expect(deleted).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM messages').get() as { n: number }).n).toBe(2);
  });

  test('maxAgePolicy deletes rows past an absolute horizon (the token leak fix)', () => {
    db.exec('CREATE TABLE harbor_issued_tokens (jti TEXT PRIMARY KEY, issued_at INTEGER)');
    const ins = db.prepare('INSERT INTO harbor_issued_tokens (jti, issued_at) VALUES (?, ?)');
    ins.run('old', NOW - 8 * 86_400_000); // 8 days old
    ins.run('fresh', NOW - 1_000);
    const deleted = maxAgePolicy(db, 'harbor_issued_tokens', 'issued_at', 7 * 86_400_000).sweep(NOW);
    expect(deleted).toBe(1);
    expect((db.prepare('SELECT jti FROM harbor_issued_tokens').all() as Array<{ jti: string }>).map((r) => r.jti)).toEqual(['fresh']);
  });

  test('capPolicy keeps only the newest N rows', () => {
    db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER)');
    const ins = db.prepare('INSERT INTO events (created_at) VALUES (?)');
    for (let i = 0; i < 10; i++) ins.run(NOW + i);
    const deleted = capPolicy(db, 'events', 'created_at', 3).sweep(NOW);
    expect(deleted).toBe(7);
    expect((db.prepare('SELECT COUNT(*) n FROM events').get() as { n: number }).n).toBe(3);
  });
});

describe('RetentionRegistry', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE a (id INTEGER PRIMARY KEY, expires_at INTEGER)');
    db.exec('CREATE TABLE b (id INTEGER PRIMARY KEY, expires_at INTEGER)');
    db.prepare('INSERT INTO a (expires_at) VALUES (?)').run(NOW - 1);
    db.prepare('INSERT INTO b (expires_at) VALUES (?)').run(NOW - 1);
  });

  test('sweepAll runs every policy and reports per-table deletions', () => {
    const reg = new RetentionRegistry(db).registerAll([ttlPolicy(db, 'a', 'expires_at'), ttlPolicy(db, 'b', 'expires_at')]);
    const results = reg.sweepAll(NOW);
    expect(results.every((r) => r.ok && r.deleted === 1)).toBe(true);
  });

  test('sweepAll isolates a failing policy — others still run', () => {
    const reg = new RetentionRegistry(db).registerAll([
      { name: 'broken', sweep: () => { throw new Error('boom'); } },
      ttlPolicy(db, 'a', 'expires_at'),
    ]);
    const results = reg.sweepAll(NOW);
    expect(results.find((r) => r.name === 'broken')?.ok).toBe(false);
    expect(results.find((r) => r.name === 'a')?.deleted).toBe(1); // ran despite the broken sibling
  });

  test('assertRegistered trips when a watched table has no policy', () => {
    db.exec('CREATE TABLE harbor_issued_tokens (jti TEXT PRIMARY KEY, issued_at INTEGER)');
    const reg = new RetentionRegistry(db).register(ttlPolicy(db, 'a', 'expires_at'));
    expect(() => reg.assertRegistered(['a', 'harbor_issued_tokens'])).toThrow(/harbor_issued_tokens/);
    reg.register(maxAgePolicy(db, 'harbor_issued_tokens', 'issued_at', 1));
    // still throws because table b of the earlier fixture isn't relevant; a + tokens now covered
    expect(() => reg.assertRegistered(['a', 'harbor_issued_tokens'])).not.toThrow();
  });

  test('reclaim returns freed pages to the file after a large delete', () => {
    const vdb = new Database(':memory:');
    vdb.pragma('auto_vacuum = INCREMENTAL'); // must precede table creation
    vdb.exec('CREATE TABLE big (id INTEGER PRIMARY KEY, blob TEXT)');
    const ins = vdb.prepare('INSERT INTO big (blob) VALUES (?)');
    const insMany = vdb.transaction(() => { for (let i = 0; i < 5000; i++) ins.run('x'.repeat(200)); });
    insMany();
    vdb.exec('DELETE FROM big');
    const freeBefore = vdb.pragma('freelist_count', { simple: true }) as number;
    expect(freeBefore).toBeGreaterThan(0);
    const reg = new RetentionRegistry(vdb);
    const reclaimed = reg.reclaim(1); // low threshold to force a run
    expect(reclaimed).toBeGreaterThan(0);
    expect(vdb.pragma('freelist_count', { simple: true }) as number).toBeLessThan(freeBefore);
  });
});
