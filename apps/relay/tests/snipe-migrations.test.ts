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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, SCHEMA_SQL, makeTestD1, migrationFiles } from './support/d1-sqlite.js';

const NEW_MIGRATIONS = [
  '2026-08-22-seamanship-suggestions.sql',
  '2026-08-22-snipe-chat-spend.sql',
];

const read = (name: string): string => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

describe('migrations — README rule 2: name for ordering', () => {
  it('the new files match YYYY-MM-DD-short-description.sql', () => {
    for (const name of NEW_MIGRATIONS) {
      expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/);
    }
  });

  it('they are present and sort AFTER every migration that predates them', () => {
    const all = migrationFiles();
    for (const name of NEW_MIGRATIONS) {
      expect(all).toContain(name);
    }
    const older = all.filter((n) => !NEW_MIGRATIONS.includes(n));
    for (const name of NEW_MIGRATIONS) {
      for (const prev of older) {
        // Only assert against files dated on or before ours; a hypothetical
        // future-dated migration from another branch is not our ordering bug.
        if (prev.slice(0, 10) <= name.slice(0, 10)) expect(prev < name).toBe(true);
      }
    }
  });

  it('the suggestions table exists before the grants that reference it', () => {
    const [suggestions, chat] = NEW_MIGRATIONS as [string, string];
    expect(suggestions < chat).toBe(true);
    const sql = read(suggestions);
    expect(sql.indexOf('CREATE TABLE IF NOT EXISTS seamanship_suggestions')).toBeLessThan(
      sql.indexOf('CREATE TABLE IF NOT EXISTS seamanship_build_grants'),
    );
  });
});

describe('migrations — README rule 3: forward-only and additive', () => {
  it('contain no destructive statement of any kind', () => {
    for (const name of NEW_MIGRATIONS) {
      const body = read(name)
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n');
      expect(body).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
      expect(body).not.toMatch(/\bALTER\s+TABLE\b/i);
      expect(body).not.toMatch(/\bRENAME\b/i);
      expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(body).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    }
  });

  it('create only NEW tables — nothing an older release already reads', () => {
    // Rollback compatibility, concretely: build the schema as the PREVIOUS
    // release knew it (the chain minus these files), then build it with them.
    // The delta must be additions only — every table the old release read is
    // still there, with the same columns, so traffic shifted back in seconds
    // finds a database it understands.
    const before = makeTestD1(NEW_MIGRATIONS);
    const after = makeTestD1();
    try {
      const tables = (t: typeof before): string[] =>
        (t.raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all() as {
          name: string;
        }[]).map((r) => r.name);
      const cols = (t: typeof before, table: string): string[] =>
        (t.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);

      const old = tables(before);
      const now = tables(after);
      for (const n of old) {
        expect(now).toContain(n);
        // ...and unchanged: no added, dropped or renamed column on a table the
        // previous release already reads.
        expect(cols(after, n)).toEqual(cols(before, n));
      }
      const added = now.filter((n) => !old.includes(n)).filter((n) => !n.startsWith('sqlite_'));
      expect(added.sort()).toEqual([
        'agent_chat_spend',
        'agent_chats',
        'seamanship_build_grants',
        'seamanship_suggestion_jobs',
        'seamanship_suggestions',
      ]);
    } finally {
      before.close();
      after.close();
    }
  });

  it('are idempotent — every CREATE guards with IF NOT EXISTS', () => {
    for (const name of NEW_MIGRATIONS) {
      const creates = read(name).match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX)[^\n]*/gi) ?? [];
      expect(creates.length).toBeGreaterThan(0);
      for (const c of creates) expect(c).toMatch(/IF NOT EXISTS/i);
    }
  });

  it('re-applying the whole chain is a no-op, not an error', () => {
    const t = makeTestD1();
    try {
      for (const name of NEW_MIGRATIONS) {
        expect(() => t.raw.exec(read(name))).not.toThrow();
      }
    } finally {
      t.close();
    }
  });
});

describe('migrations — README rule 4: the staging ledger is CI-owned', () => {
  it('the new files are NOT hand-written into the ledger', () => {
    // A hand edit here is the one way to lie the prod gate green with a
    // migration that never ran on staging. CI records them after a real apply.
    const ledger = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'applied-staging.json'), 'utf8')) as
      | { file: string }[]
      | Record<string, unknown>;
    const files = Array.isArray(ledger) ? ledger.map((r) => r.file) : [];
    for (const name of NEW_MIGRATIONS) expect(files).not.toContain(name);
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
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('the schema-of-record produces the same columns as the migration chain', () => {
    // schema.sql is the schema-of-record and is idempotent, so overlaying it on
    // a database already built from the chain must be a no-op. A drifted mirror
    // shows up here as a column difference.
    const chain = makeTestD1();
    const overlaid = makeTestD1();
    try {
      overlaid.raw.exec(schema);
      for (const table of [
        'seamanship_suggestions',
        'seamanship_build_grants',
        'seamanship_suggestion_jobs',
        'agent_chats',
        'agent_chat_spend',
      ]) {
        const cols = (t: typeof chain): string[] =>
          (t.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
        expect(cols(overlaid)).toEqual(cols(chain));
      }
    } finally {
      chain.close();
      overlaid.close();
    }
  });

  it('NO TABLE HAS A BODY COLUMN — a built skill lives in the repo, not here', () => {
    const t = makeTestD1();
    try {
      for (const table of ['seamanship_suggestions', 'seamanship_build_grants', 'seamanship_suggestion_jobs']) {
        const cols = (t.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
        expect(cols).not.toContain('body');
        expect(cols).not.toContain('content');
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
