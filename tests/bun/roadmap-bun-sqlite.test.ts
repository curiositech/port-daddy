/**
 * Regression test for the bun:sqlite roadmap datatype-mismatch bug.
 *
 * RUNTIME: this file MUST run under `bun test`, not jest. It imports
 * `bun:sqlite` directly so it exercises the SAME engine the
 * `bun build --compile` daemon ships with — the one place the bug
 * manifested. Jest (better-sqlite3) is lax about exactly the binding
 * mistakes bun:sqlite rejects, so the original bug was invisible to the
 * jest suite and shipped to the compiled daemon.
 *
 * The live symptom was `GET /roadmap/items` returning HTTP 500
 * `{"code":"SQLITE_MISMATCH","message":"datatype mismatch"}` even when
 * `roadmap_items` was EMPTY. Root cause: the pre-#193 `list()` bound
 * `LIMIT @limit` with a bare-key object `{ limit: 1000 }`. bun:sqlite
 * does NOT accept better-sqlite3's bare-key `@named` object binding, so
 * the parameter resolved to NULL → `LIMIT NULL` → datatype mismatch.
 *
 * This test:
 *   1. Proves the engine semantics directly (bare-key `@named` object
 *      binding fails under bun:sqlite; positional `?` works). This is the
 *      "before fix" failure mode, asserted as the engine contract so it
 *      can never silently regress.
 *   2. Drives the REAL `createRoadmapItems().list()` against a real
 *      `bun:sqlite` Database for every query shape that 500'd in prod
 *      (no filter / status=all / status=now / harbor / limit), asserting
 *      they all succeed. Run this file against the pre-#193 source and
 *      step 2 throws SQLITE_MISMATCH; against current source it passes.
 */

import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createRoadmapItems } from '../../lib/roadmap-items.ts';

const ROADMAP_DDL = `
  CREATE TABLE roadmap_items (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    summary_md TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'backlog'
      CHECK(status IN ('now','backlog','parked','merge','done')),
    promoted_from_feedback_id TEXT,
    promoted_by_agent_id TEXT,
    promoted_at INTEGER,
    last_touched_at INTEGER NOT NULL,
    dependencies_json TEXT NOT NULL DEFAULT '[]',
    notes_json TEXT NOT NULL DEFAULT '[]',
    harbor TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE(slug, harbor)
  );
  CREATE INDEX idx_roadmap_items_harbor_status ON roadmap_items(harbor, status);
  CREATE INDEX idx_roadmap_items_live ON roadmap_items(harbor, status) WHERE deleted_at IS NULL;
  CREATE INDEX idx_roadmap_items_last_touched ON roadmap_items(last_touched_at);
  CREATE TABLE roadmap_item_status_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('now','backlog','parked','merge','done')),
    by_agent_id TEXT,
    at INTEGER NOT NULL,
    harbor TEXT NOT NULL
  );
`;

function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec(ROADMAP_DDL);
  return db;
}

/** Minimal tuple-space stub — list() never emits tuples, but upsert() does. */
function stubTuples() {
  return { out: () => ({ id: 1 }) };
}

describe('bun:sqlite engine contract (the bug surface)', () => {
  test('bare-key @named object binding silently fails under bun:sqlite', () => {
    const db = freshDb();
    // This is exactly the pre-#193 idiom: `@named` SQL bound with a
    // bare-key object. better-sqlite3 accepts it; bun:sqlite does not.
    const stmt = db.prepare(`SELECT * FROM roadmap_items LIMIT @limit`);
    expect(() => stmt.all({ limit: 1000 } as never)).toThrow();
  });

  test('LIMIT bound NULL throws the exact datatype-mismatch error', () => {
    const db = freshDb();
    const stmt = db.prepare(`SELECT * FROM roadmap_items LIMIT ?`);
    // A NULL LIMIT is what the bad bind resolved to. This reproduces the
    // live "SQLITE_MISMATCH: datatype mismatch".
    expect(() => stmt.all(null as never)).toThrow(/mismatch/i);
  });

  test('positional ? binding with an integer limit works (the fix)', () => {
    const db = freshDb();
    const stmt = db.prepare(`SELECT * FROM roadmap_items LIMIT ?`);
    expect(stmt.all(1000)).toEqual([]);
  });
});

describe('createRoadmapItems().list() under real bun:sqlite', () => {
  // Each query shape below 500'd against the live compiled daemon.
  // They must all return without throwing — empty AND populated.

  test('list() shapes succeed on an EMPTY table', () => {
    const db = freshDb();
    const roadmap = createRoadmapItems({ db: db as never, tuples: stubTuples() });

    expect(roadmap.list()).toEqual([]);
    expect(roadmap.list({ status: 'all' })).toEqual([]);
    expect(roadmap.list({ status: 'now' })).toEqual([]);
    expect(roadmap.list({ harbor: 'fleet' })).toEqual([]);
    expect(roadmap.list({ limit: 5 })).toEqual([]);
    expect(roadmap.list({ harbor: 'fleet', status: 'all', limit: 50 })).toEqual([]);
  });

  test('list() shapes succeed on a POPULATED table and honor ordering/limit', () => {
    const db = freshDb();
    let clock = 1_000;
    const roadmap = createRoadmapItems({
      db: db as never,
      tuples: stubTuples(),
      now: () => ++clock,
    });

    roadmap.upsert({ slug: 'a', summaryMd: 'backlog item', status: 'backlog' });
    roadmap.upsert({ slug: 'b', summaryMd: 'now item', status: 'now' });
    roadmap.upsert({ slug: 'c', summaryMd: 'done item', status: 'done' });

    const all = roadmap.list({ status: 'all' });
    expect(all).toHaveLength(3);
    // STATUS_RANK orders now < merge < backlog < parked < done.
    expect(all.map((i) => i.slug)).toEqual(['b', 'a', 'c']);

    expect(roadmap.list({ status: 'now' }).map((i) => i.slug)).toEqual(['b']);
    expect(roadmap.list({ limit: 1 })).toHaveLength(1);
    expect(roadmap.list({ harbor: 'fleet' })).toHaveLength(3);
  });
});
