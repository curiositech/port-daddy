import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from '../../lib/sqlite-runtime.js';
import {
  applyConsolidationPlan,
  buildConsolidationConfig,
  buildConsolidationPlan,
  discoverCandidateDbPaths,
  parseLsofNames,
  parseLsofPids,
} from '../../scripts/db-consolidate.js';

let scratch;
let config;

function runSql(db, sql) {
  db['exec'](sql);
}

function makeDb(path, rows, lastSeen) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  runSql(db, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE services (
      id TEXT PRIMARY KEY,
      port INTEGER,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE session_notes (
      id TEXT PRIMARY KEY,
      body TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  for (let i = 0; i < rows; i++) {
    db.prepare('INSERT INTO services (id, port, created_at, last_seen) VALUES (?, ?, ?, ?)')
      .run(`svc-${i}`, 3000 + i, lastSeen - i, lastSeen - i);
    db.prepare('INSERT INTO session_notes (id, body, created_at) VALUES (?, ?, ?)')
      .run(`note-${i}`, `body-${i}`, lastSeen - i);
  }
  db.close();
}

function countRows(path, table) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  } finally {
    db.close();
  }
}

beforeEach(() => {
  const root = join(homedir(), '.port-daddy');
  mkdirSync(root, { recursive: true });
  scratch = join(root, `test-db-consolidate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(scratch, { recursive: true });
  config = buildConsolidationConfig({
    homeDir: scratch,
    repoRoot: join(scratch, 'repo'),
  });
});

afterEach(() => {
  if (scratch && existsSync(scratch)) {
    rmSync(scratch, { recursive: true, force: true });
  }
});

describe('db-consolidate discovery', () => {
  test('includes canonical, env, profile, Homebrew, repo, and live-open candidates', () => {
    const profileDb = join(config.pdHome, 'instances', 'dev', 'port-daddy.db');
    mkdirSync(dirname(profileDb), { recursive: true });
    const envDb = join(scratch, 'env.db');
    const liveDb = join(scratch, 'live.db');

    const paths = discoverCandidateDbPaths(config, {
      env: { PORT_DADDY_DB: envDb },
      liveOpenDbs: [liveDb],
    });

    expect(paths).toContain(config.canonicalDbPath);
    expect(paths).toContain(envDb);
    expect(paths).toContain(profileDb);
    expect(paths).toContain(liveDb);
    expect(paths).toContain(join(config.repoRoot, 'port-registry.db'));
    expect(paths).toContain('/opt/homebrew/var/port-daddy/port-registry.db');
    expect(paths).toContain('/usr/local/var/port-daddy/port-registry.db');
  });

  test('parses lsof machine output without shell pipelines', () => {
    expect(parseLsofPids('p123\np456\ncnode\n')).toEqual([123, 456]);
    expect(parseLsofNames('n/tmp/a.db\nn/tmp/a.db-wal\nn/tmp/b.txt\nn/var/db/port-daddy.db\n'))
      .toEqual(['/tmp/a.db', '/var/db/port-daddy.db']);
  });
});

describe('db-consolidate planning and apply', () => {
  test('dry-run planning prefers the live daemon DB over a fresher timestamp', () => {
    const canonical = config.canonicalDbPath;
    const profile = join(config.pdHome, 'instances', 'dev', 'port-daddy.db');
    makeDb(canonical, 1, 1000);
    makeDb(profile, 3, 2000);

    const plan = buildConsolidationPlan({
      config,
      candidatePaths: [canonical, profile],
      liveOpenDbs: [canonical],
      now: () => Date.UTC(2026, 5, 30, 12),
    });

    expect(plan.source.path).toBe(canonical);
    expect(plan.toArchive.map((f) => f.path)).toEqual([profile]);
    expect(countRows(canonical, 'services')).toBe(1);
    expect(countRows(profile, 'services')).toBe(3);
  });

  test('apply stages into canonical, archives the old canonical and the noncanonical source', () => {
    const canonical = config.canonicalDbPath;
    const profile = join(config.pdHome, 'instances', 'dev', 'port-daddy.db');
    makeDb(canonical, 1, 1000);
    makeDb(profile, 4, 5000);

    const plan = buildConsolidationPlan({
      config,
      candidatePaths: [canonical, profile],
      explicitSource: profile,
      liveOpenDbs: [],
      now: () => Date.UTC(2026, 5, 30, 12),
    });

    const result = applyConsolidationPlan(plan);

    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(profile)).toBe(false);
    expect(countRows(canonical, 'services')).toBe(4);
    expect(result.archivedCanonicalPaths.some((p) => p.includes('port-registry.db'))).toBe(true);
    expect(result.archivedPaths.some((p) => p.includes('instances__dev__port-daddy.db'))).toBe(true);
    expect(readdirSync(plan.archiveDir).length).toBeGreaterThanOrEqual(2);
  });

  test('apply refuses to mutate while a daemon has a candidate DB open', () => {
    const canonical = config.canonicalDbPath;
    const profile = join(config.pdHome, 'instances', 'dev', 'port-daddy.db');
    makeDb(canonical, 1, 1000);
    makeDb(profile, 4, 5000);

    const plan = buildConsolidationPlan({
      config,
      candidatePaths: [canonical, profile],
      explicitSource: profile,
      liveOpenDbs: [profile],
      now: () => Date.UTC(2026, 5, 30, 12),
    });

    expect(plan.blockers).toContain(`daemon has candidate DB open: ${profile}`);
    expect(() => applyConsolidationPlan(plan)).toThrow(/refusing to apply/);
    expect(existsSync(profile)).toBe(true);
    expect(countRows(canonical, 'services')).toBe(1);
  });

  test('apply preserves the canonical DB when staged copy fails', () => {
    const canonical = config.canonicalDbPath;
    const profile = join(config.pdHome, 'instances', 'dev', 'port-daddy.db');
    makeDb(canonical, 2, 1000);
    makeDb(profile, 4, 5000);

    const plan = buildConsolidationPlan({
      config,
      candidatePaths: [canonical, profile],
      explicitSource: profile,
      liveOpenDbs: [],
      now: () => Date.UTC(2026, 5, 30, 12),
    });
    plan.source.path = join(config.pdHome, 'missing-source.db');

    expect(() => applyConsolidationPlan(plan)).toThrow(/rolled back/);
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(profile)).toBe(true);
    expect(countRows(canonical, 'services')).toBe(2);
  });
});
