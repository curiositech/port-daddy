/**
 * The migrations added by this change, checked against migrations/README.md.
 *
 * The README's rules are not style preferences — each one exists because
 * breaking it produces a specific outage:
 *
 *   Rule 1 (never edit a committed migration): Wrangler tracks applied files by
 *     NAME, so an edited file is never re-applied anywhere it already ran.
 *   Rule 2 (YYYY-MM-DD-name.sql): lexicographic order IS application order.
 *   Rule 3 (forward-only, rollback-compatible): a prod rollback shifts traffic
 *     in seconds and does NOT un-migrate the database, so every migration must
 *     leave the schema usable by the PREVIOUS Worker release.
 *   Rule 4 (staging first, ledger is CI-owned): a hand-edited ledger is the one
 *     way to lie the prod gate green.
 *
 * These tests pin the mechanical half of that — the half a reviewer would have
 * to check by eye otherwise.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS_DIR, SCHEMA_SQL, makeTestD1, migrationFiles } from './support/d1-sqlite.js';

const read = (name: string): string => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
const CONTROL_WAITING_MIGRATION = '2026-09-14-fleet-control-waiting.sql';
const LEGACY_DESTRUCTIVE_MIGRATIONS = new Map([
  ['2026-08-09-executor-identity.sql', '31ab959be16f9da9cf175f6291dfa9e826bfe5fdeef686630840513144fa5a92'],
]);
const GUARDED_MIGRATIONS = migrationFiles().filter((name) => !LEGACY_DESTRUCTIVE_MIGRATIONS.has(name));
const ledger = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'applied-staging.json'), 'utf8')) as {
  applied?: { file: string }[];
};
const appliedMigrations = new Set((ledger.applied ?? []).map((row) => row.file));
const PENDING_MIGRATIONS = migrationFiles().filter((name) => !appliedMigrations.has(name));
const ROLLBACK_COMPATIBILITY_COHORT = [...new Set([
  ...PENDING_MIGRATIONS,
  CONTROL_WAITING_MIGRATION,
])];

describe('migrations — README rule 2: name for ordering', () => {
  it('the new files match YYYY-MM-DD-short-description.sql', () => {
    for (const name of migrationFiles()) {
      expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/);
    }
  });

  it('discovers every migration except an immutable legacy destructive migration', () => {
    expect(GUARDED_MIGRATIONS).toContain(CONTROL_WAITING_MIGRATION);
    expect(GUARDED_MIGRATIONS.length + LEGACY_DESTRUCTIVE_MIGRATIONS.size)
      .toBe(migrationFiles().length);
    for (const [name, digest] of LEGACY_DESTRUCTIVE_MIGRATIONS) {
      expect(createHash('sha256').update(read(name)).digest('hex'), name).toBe(digest);
    }
  });

  it('the suggestions table exists before the grants that reference it', () => {
    const suggestions = '2026-08-22-seamanship-suggestions.sql';
    const chat = '2026-08-22-snipe-chat-spend.sql';
    expect(suggestions < chat).toBe(true);
    const sql = read(suggestions);
    expect(sql.indexOf('CREATE TABLE IF NOT EXISTS seamanship_suggestions')).toBeLessThan(
      sql.indexOf('CREATE TABLE IF NOT EXISTS seamanship_build_grants'),
    );
  });
});

describe('migrations — README rule 3: forward-only and additive', () => {
  it('guards every present and future migration after the policy floor against destructive SQL', () => {
    for (const name of GUARDED_MIGRATIONS) {
      const body = read(name)
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n');
      expect(body).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
      expect(body).not.toMatch(/\bRENAME\b/i);
      expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(body).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
      const alters = body
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => /^ALTER\s+TABLE\b/i.test(statement));
      for (const alter of alters) {
        expect(alter, `${name}: ALTER TABLE must only add a column`).toMatch(
          /^ALTER\s+TABLE\s+[A-Za-z_][A-Za-z0-9_]*\s+ADD\s+COLUMN\s+[A-Za-z_][A-Za-z0-9_]*\b/is,
        );
      }
    }
  });

  it('preserves every existing table and column contract for the previous Worker release', () => {
    // Rollback compatibility, concretely: build the schema as the PREVIOUS
    // release knew it (the chain minus these files), then build it with them.
    // The delta must be additions only — every table the old release read is
    // still there, with the same columns, so traffic shifted back in seconds
    // finds a database it understands.
    const before = makeTestD1(ROLLBACK_COMPATIBILITY_COHORT);
    const after = makeTestD1();
    try {
      const tables = (t: typeof before): string[] =>
        (t.raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all() as {
          name: string;
        }[]).map((r) => r.name);
      const cols = (t: typeof before, table: string): Record<string, unknown>[] =>
        t.raw.prepare(`PRAGMA table_info(${table})`).all() as Record<string, unknown>[];

      const old = tables(before);
      const now = tables(after);
      for (const n of old) {
        expect(now).toContain(n);
        // Additive columns are rollback-compatible; every column the previous
        // release knows must retain its exact SQLite contract.
        const current = new Map(cols(after, n).map((column) => [column.name, column]));
        for (const previous of cols(before, n)) {
          expect(current.get(previous.name as string), `${n}.${String(previous.name)}`).toEqual(previous);
        }
      }
    } finally {
      before.close();
      after.close();
    }
  });

});

describe('migrations — README rule 4: the staging ledger is CI-owned', () => {
  it('discovers the exact pending set from a unique, referentially valid ledger', () => {
    // CI owns the ledger write after a real staging apply. This read-side test
    // must remain valid both before and after that generated update.
    const applied = (ledger.applied ?? []).map((row) => row.file);
    expect(new Set(applied).size).toBe(applied.length);
    for (const name of applied) expect(migrationFiles()).toContain(name);
    expect(PENDING_MIGRATIONS).toEqual(
      migrationFiles().filter((name) => !new Set(applied).has(name)),
    );
  });
});

describe('migrations — the schema-of-record mirrors them', () => {
  const schema = readFileSync(SCHEMA_SQL, 'utf8');

  it('every new table appears in schema.sql', () => {
    for (const table of [
      'seamanship_suggestions',
      'seamanship_build_grants',
      'seamanship_suggestion_jobs',
      'agent_chats',
      'agent_chat_spend',
      'fleet_run_intents',
      'fleet_control_requeues',
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('the schema-of-record produces the same columns as the migration chain', () => {
    // Build independently: IF NOT EXISTS over a migrated database masks drift.
    const chain = makeTestD1();
    const fresh = new DatabaseSync(':memory:');
    try {
      fresh.exec(schema);
      for (const table of [
        'seamanship_suggestions',
        'seamanship_build_grants',
        'seamanship_suggestion_jobs',
        'agent_chats',
        'agent_chat_spend',
        'fleet_run_intents',
        'fleet_control_requeues',
      ]) {
        const cols = (db: DatabaseSync) => db.prepare(`PRAGMA table_info(${table})`).all();
        expect(cols(fresh), table).toEqual(cols(chain.raw));
      }
      for (const db of [chain.raw, fresh]) {
        db.exec(`INSERT INTO fleet_run_intents
          (delivery_id, repo_full_name, pr_number, pr_url, head_sha, event_type, generation,
           state, control_waiting_at)
          VALUES ('held', 'a/b', 1, 'https://github.com/a/b/pull/1', 'sha', 'pull_request',
                  1, 'retrying', 123)`);
        expect(db.prepare('SELECT control_waiting_at, control_wait_count, requeue_revision FROM fleet_run_intents').get())
          .toEqual({ control_waiting_at: 123, control_wait_count: 0, requeue_revision: null });
        expect(() => db.exec("UPDATE fleet_run_intents SET state = 'invented'")).toThrow();
        db.exec("INSERT INTO fleet_control_requeues VALUES ('request', 'held', 1, 2, 'operator', 0)");
        expect(() => db.exec("INSERT INTO fleet_control_requeues VALUES ('other', 'held', 1, 2, 'operator', 0)")).toThrow();
        expect(() => db.exec("INSERT INTO fleet_control_requeues VALUES ('request', 'other', 2, 2, 'operator', 0)")).toThrow();
      }
    } finally {
      chain.close();
      fresh.close();
    }
  });

  /**
   * The privacy invariant of this whole feature: skill BODIES live in the
   * operator's repo and are fetched on demand through the GitHub App. D1 holds
   * the public projection — names, descriptions, and the coordinates needed to
   * go and get a body — and never the text itself.
   *
   * The table list here is DISCOVERED, not written down, and that is the point.
   * The previous version of this test hardcoded three suggestion-workflow
   * tables. `skill_listings` and `seamanship_skill_cache` were added later —
   * the two tables that actually hold skill metadata, and the two this
   * invariant is most about — and nothing updated the list, so the assertion
   * quietly stopped covering the tables that mattered while still passing. A
   * hardcoded list of things to check is a list that goes stale the first time
   * someone adds a table and does not think of this file.
   *
   * Discovering from sqlite_schema means a new seamanship table is covered the
   * moment it exists, whether or not its author reads this test.
   */
  it('NO seamanship table has a body-shaped column — a skill lives in the repo, not here', () => {
    const t = makeTestD1();
    try {
      const tables = (
        t.raw
          .prepare(
            `SELECT name FROM sqlite_schema
              WHERE type = 'table'
                AND name NOT LIKE 'sqlite_%'
                AND (name LIKE 'seamanship%' OR name = 'skill_listings')
              ORDER BY name`,
          )
          .all() as { name: string }[]
      ).map((r) => r.name);

      // Premise: discovery actually found the tables. Without this the loop
      // below is vacuously true if the LIKE pattern ever stops matching — the
      // same silent-no-op this test exists to prevent, one level up.
      expect(tables).toContain('skill_listings');
      expect(tables).toContain('seamanship_skill_cache');
      expect(tables).toContain('seamanship_suggestions');
      expect(tables.length).toBeGreaterThanOrEqual(5);

      // Anything that could hold a SKILL.md body. `description` is deliberately
      // absent from this list: a one-line description IS the public projection.
      const forbidden = ['body', 'content', 'markdown', 'full_text', 'text', 'source', 'raw'];
      for (const table of tables) {
        const cols = (
          t.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).map((r) => r.name);
        for (const bad of forbidden) {
          expect(cols).not.toContain(bad);
        }
      }
    } finally {
      t.close();
    }
  });

  it('the status CHECK is exactly the four the law defines', () => {
    const sql = read('2026-08-22-seamanship-suggestions.sql');
    expect(sql).toContain("status IN ('proposed', 'approved', 'dismissed', 'built')");
  });

  it('one grant per suggestion, forever — suggestion_id is the PRIMARY KEY', () => {
    const t = makeTestD1();
    try {
      const row = t.raw
        .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='seamanship_build_grants'")
        .get() as { sql: string };
      expect(row.sql).toMatch(/suggestion_id\s+TEXT\s+PRIMARY KEY/);
    } finally {
      t.close();
    }
  });

  it('one active suggestion job per (account, repo) — a partial unique index', () => {
    const t = makeTestD1();
    try {
      const row = t.raw
        .prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name='seamanship_suggestion_jobs_active_idx'")
        .get() as { sql: string } | undefined;
      expect(row?.sql).toMatch(/UNIQUE/i);
      expect(row?.sql).toMatch(/WHERE state IN \('queued', 'running'\)/);
    } finally {
      t.close();
    }
  });
});
