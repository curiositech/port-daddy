/**
 * Tests for lib/observability/maintenance.ts — the port-daddy assembly that actually prunes the
 * audit-identified leaks on the cleanup tick. Guards:
 *   - expired harbor_issued_tokens are deleted (the 101K-row leak)
 *   - semantic_resolution_events is capped to newest N (no prune existed before)
 *   - a missing table doesn't crash the tick (older/partial schema safe)
 *   - tick() returns a footprint sample (self-monitoring is live, not pull-only)
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createObservabilityMaintenance } from '../../lib/observability/maintenance.js';
import { LogGovernor, type LeveledSink } from '../../lib/observability/log-governor.js';

const NOW = 1_000_000_000_000;
const silentSink: LeveledSink = { debug() {}, info() {}, warn() {}, error() {} };

function governor() {
  return new LogGovernor(silentSink, { now: () => NOW });
}

describe('observability maintenance', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE harbor_issued_tokens (jti TEXT PRIMARY KEY, agent_id TEXT, harbor_name TEXT, issued_at INTEGER, expires_at INTEGER);
      CREATE TABLE semantic_resolution_events (id INTEGER PRIMARY KEY AUTOINCREMENT, decision TEXT);
    `);
  });

  test('deletes expired tokens and caps the events table on tick', () => {
    const ins = db.prepare('INSERT INTO harbor_issued_tokens (jti, agent_id, harbor_name, issued_at, expires_at) VALUES (?,?,?,?,?)');
    for (let i = 0; i < 100; i++) ins.run(`old-${i}`, 'a', 'h', NOW - 7_200_000, NOW - 3_600_000); // expired
    for (let i = 0; i < 5; i++) ins.run(`live-${i}`, 'a', 'h', NOW, NOW + 3_600_000); // live
    const insEv = db.prepare('INSERT INTO semantic_resolution_events (decision) VALUES (?)');
    const insMany = db.transaction(() => { for (let i = 0; i < 100; i++) insEv.run('error'); });
    insMany();

    const maint = createObservabilityMaintenance({ db, dbPath: ':memory:', governor: governor(), eventsCap: 10, now: () => NOW });
    maint.tick(NOW);

    expect((db.prepare('SELECT COUNT(*) n FROM harbor_issued_tokens').get() as { n: number }).n).toBe(5); // expired gone
    expect((db.prepare('SELECT COUNT(*) n FROM semantic_resolution_events').get() as { n: number }).n).toBe(10); // capped
  });

  test('a missing table does not crash the tick (partial schema safe)', () => {
    const bare = new Database(':memory:');
    bare.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
    const maint = createObservabilityMaintenance({ db: bare, dbPath: ':memory:', governor: governor(), now: () => NOW });
    expect(() => maint.tick(NOW)).not.toThrow();
    // Legacy tables absent → their policies are skipped, no crash. ink_pheromones
    // is the exception BY DESIGN (db-retention doctrine: a new table is declared
    // bounded from day one): maintenance ensures the table itself and always
    // registers its max-age + cap policies.
    expect(maint.registry.registered()).toEqual(['ink_pheromones:maxage', 'ink_pheromones:cap']);
    bare.close();
  });

  test('ink_pheromones is bounded: 7d max-age + 500-row cap declared and swept', () => {
    const maint = createObservabilityMaintenance({ db, dbPath: ':memory:', governor: governor(), now: () => NOW });
    // The table was ensured by maintenance itself (constructed before the
    // reconcile loop in server.ts) — seed one ancient and one fresh row.
    const ins = db.prepare('INSERT INTO ink_pheromones (subject, note, intensity, actor, updated_at) VALUES (?,?,?,?,?)');
    ins.run('lib/old.ts', 'ancient', 1, 'a', NOW - 8 * 24 * 60 * 60 * 1000); // > 7d
    ins.run('lib/new.ts', 'fresh', 1, 'a', NOW - 1000);
    maint.tick(NOW);
    const rows = db.prepare('SELECT subject FROM ink_pheromones ORDER BY subject').all() as Array<{ subject: string }>;
    expect(rows).toEqual([{ subject: 'lib/new.ts' }]); // ancient swept, fresh kept
  });

  test('tick returns a footprint sample (self-monitoring is push, not pull-only)', () => {
    const maint = createObservabilityMaintenance({ db, dbPath: ':memory:', governor: governor(), now: () => NOW });
    const sample = maint.tick(NOW);
    expect(sample).toHaveProperty('dbBytes');
    expect(sample).toHaveProperty('rows');
    expect(sample.rows).toHaveProperty('harbor_issued_tokens');
  });
});
