/**
 * Unit tests for lib/seed-berth-db.ts (ADR-0084 + ADR-0090 berth DB seeding).
 *
 * Real SQLite round-trips: build a fake "prod" registry with both board data
 * (roadmap_items) and LOCAL-ONLY data (services, locks), seed a berth from it,
 * and assert the copy preserves board data while scrubbing the machine-local
 * tables. Scratch DBs live under the linked worktree cache (never /tmp)
 * and are removed after each test.
 */

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';

import Database from '../../lib/sqlite-runtime.js';
import {
  EXECUTABLE_QUEUE_TABLES,
  LOCAL_ONLY_TABLES,
  resolveProdDbPath,
  seedBerthDbFromProd,
  describeSeedResult,
} from '../../lib/seed-berth-db.js';

let scratch;

beforeEach(() => {
  const root = resolve(process.cwd(), '.cache', 'seed-berth-tests');
  mkdirSync(root, { recursive: true });
  scratch = mkdtempSync(join(root, 'test-seed-berth-'));
});

afterEach(() => {
  if (scratch && existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
});

/** Build a fake prod registry with board + LOCAL-ONLY rows. Returns its path. */
function makeProdDb() {
  const path = join(scratch, 'port-registry.db');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE roadmap_items (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE session_notes (id TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE services (name TEXT PRIMARY KEY, port INTEGER);
    CREATE TABLE endpoints (id TEXT PRIMARY KEY, url TEXT);
    CREATE TABLE locks (key TEXT PRIMARY KEY, holder TEXT);
    CREATE TABLE dispatches (id TEXT PRIMARY KEY, state TEXT, goal TEXT);
    CREATE TABLE nightshift_intents (id TEXT PRIMARY KEY, status TEXT);
    INSERT INTO roadmap_items VALUES ('r1', 'ship berths'), ('r2', 'seed db');
    INSERT INTO session_notes VALUES ('n1', 'scope note');
    INSERT INTO services VALUES ('webapp:api:main', 9876), ('other:ui:main', 5173);
    INSERT INTO endpoints VALUES ('e1', 'http://127.0.0.1:9876');
    INSERT INTO locks VALUES ('release', 'agent-7');
    INSERT INTO dispatches VALUES ('d1', 'proposed', 'launch me'), ('d2', 'in_progress', 'recover me');
    INSERT INTO nightshift_intents VALUES ('legacy', 'running');
  `);
  db.close();
  return path;
}

function count(path, table) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } finally {
    db.close();
  }
}

describe('seedBerthDbFromProd', () => {
  test('copies board data and scrubs LOCAL-ONLY tables', () => {
    const source = makeProdDb();
    const target = join(scratch, 'berth', 'port-daddy.db');

    const result = seedBerthDbFromProd({ targetDbPath: target, sourceDbPath: source });

    expect(result.seeded).toBe(true);
    expect(result.reason).toBe('seeded');
    expect(existsSync(target)).toBe(true);

    // Board data survives.
    expect(count(target, 'roadmap_items')).toBe(2);
    expect(count(target, 'session_notes')).toBe(1);

    // Local bindings and executable queues still exist (schema preserved) but
    // are empty. A feature daemon must never auto-recover copied prod work.
    for (const table of [...LOCAL_ONLY_TABLES, ...EXECUTABLE_QUEUE_TABLES]) {
      expect(count(target, table)).toBe(0);
    }
    expect(result.scrubbedTables).toEqual([...LOCAL_ONLY_TABLES, ...EXECUTABLE_QUEUE_TABLES]);
  });

  test('keeps LOCAL-ONLY rows when scrubLocalOnly is false', () => {
    const source = makeProdDb();
    const target = join(scratch, 'berth', 'port-daddy.db');

    const result = seedBerthDbFromProd({
      targetDbPath: target,
      sourceDbPath: source,
      scrubLocalOnly: false,
    });

    expect(result.seeded).toBe(true);
    expect(count(target, 'services')).toBe(2);
    expect(result.scrubbedTables).toEqual([...EXECUTABLE_QUEUE_TABLES]);
    for (const table of EXECUTABLE_QUEUE_TABLES) expect(count(target, table)).toBe(0);
  });

  test.each([true, false])('legacy executable work cannot reappear after seeding (scrub local: %s)', (scrubLocalOnly) => {
    const source = join(scratch, 'legacy-source.db');
    const db = new Database(source);
    db.exec(`CREATE TABLE nightshift_intents (
      id TEXT PRIMARY KEY, slug TEXT, intent TEXT, tags_json TEXT, status TEXT,
      backend TEXT, budget_usd REAL, timeout_ms INTEGER, worktree_path TEXT,
      branch_name TEXT, session_id TEXT, pr_url TEXT, cost_usd REAL, duration_ms INTEGER,
      error_message TEXT, created_at INTEGER, queued_at INTEGER, started_at INTEGER,
      completed_at INTEGER, reviewed_at INTEGER
    ); CREATE TABLE roadmap_items (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO roadmap_items VALUES ('keep-board-history', 'retained');`);
    const legacy = db.prepare('INSERT INTO nightshift_intents (id,slug,intent,tags_json,status,created_at) VALUES (?,?,?,?,?,?)');
    for (const [i, state] of ['proposed', 'queued', 'running'].entries()) {
      legacy.run(`legacy-${i}`, `legacy-${i}`, 'must not execute in a copied berth', '[]', state, 1700000000000);
    }
    const originalQueue = createDispatchQueue({ db });
    expect(originalQueue.list()).toHaveLength(3);
    db.close();
    const target = join(scratch, 'legacy-berth.db');
    const result = seedBerthDbFromProd({ sourceDbPath: source, targetDbPath: target, scrubLocalOnly });
    expect(result.seeded).toBe(true);
    const copy = new Database(target);
    try {
      const queue = createDispatchQueue({ db: copy });
      expect(queue.list()).toEqual([]);
      expect(copy.prepare('SELECT COUNT(*) AS n FROM nightshift_intents').get().n).toBe(0);
      expect(copy.prepare('SELECT title FROM roadmap_items').get().title).toBe('retained');
    } finally { copy.close(); }
    expect(count(source, 'dispatches')).toBe(3);
    expect(count(source, 'nightshift_intents')).toBe(3);
  });

  test('is idempotent — never clobbers an existing berth DB', () => {
    const source = makeProdDb();
    const target = join(scratch, 'berth', 'port-daddy.db');

    expect(seedBerthDbFromProd({ targetDbPath: target, sourceDbPath: source }).seeded).toBe(true);
    expect(count(target, 'dispatches')).toBe(0);
    // Add a row the berth "wrote" after launch; a re-seed must not erase it.
    const db = new Database(target);
    db.exec(`INSERT INTO roadmap_items VALUES ('local', 'berth-local change')`);
    db.close();

    const second = seedBerthDbFromProd({ targetDbPath: target, sourceDbPath: source });
    expect(second.seeded).toBe(false);
    expect(second.reason).toBe('target-exists');
    expect(count(target, 'roadmap_items')).toBe(3); // local change intact
  });

  test('skips cleanly when there is no prod DB (fresh machine)', () => {
    const target = join(scratch, 'berth', 'port-daddy.db');
    const result = seedBerthDbFromProd({ targetDbPath: target, sourceDbPath: null });
    expect(result.seeded).toBe(false);
    expect(result.reason).toBe('no-prod-db');
    expect(existsSync(target)).toBe(false);
  });

  test('produces an integrity-OK copy', () => {
    const source = makeProdDb();
    const target = join(scratch, 'berth', 'port-daddy.db');
    seedBerthDbFromProd({ targetDbPath: target, sourceDbPath: source });
    const db = new Database(target, { readonly: true, fileMustExist: true });
    try {
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
  });
});

describe('resolveProdDbPath', () => {
  test('honors PORT_DADDY_PROD_DB when the file exists', () => {
    const source = makeProdDb();
    expect(resolveProdDbPath({ PORT_DADDY_PROD_DB: source })).toBe(source);
  });

  test('returns null when the override points at a missing file', () => {
    expect(resolveProdDbPath({ PORT_DADDY_PROD_DB: join(scratch, 'nope.db') })).toBeNull();
  });
});

describe('describeSeedResult', () => {
  test('summarizes a successful seed with the scrubbed tables', () => {
    const msg = describeSeedResult({
      seeded: true,
      reason: 'seeded',
      targetDbPath: '/x',
      sourceDbPath: '/y',
      scrubbedTables: ['services', 'locks', 'dispatches'],
      bytes: 4096,
    });
    expect(msg).toContain('seeded from prod registry');
    expect(msg).toContain('dispatches');
    expect(msg).toContain('services, locks');
  });

  test('summarizes the empty-start cases', () => {
    expect(describeSeedResult({ seeded: false, reason: 'no-prod-db', targetDbPath: '/x' })).toContain(
      'starts empty',
    );
  });
});
