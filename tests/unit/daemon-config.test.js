/**
 * daemon-config tests — KV store, schema validation, defaults, integration
 * with spawn-ancestry's getMaxDepth resolver.
 */

import Database from 'better-sqlite3';
import {
  createDaemonConfig,
  ConfigKeyError,
  ConfigValueError,
  DAEMON_CONFIG_KEYS,
} from '../../lib/daemon-config.js';
import { createAncestry, MaxDepthError, DEFAULT_MAX_SPAWN_DEPTH } from '../../lib/spawn-ancestry.js';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      identity_project TEXT
    );
  `);
  return db;
}

describe('daemon-config: schema + defaults', () => {
  test('list returns the full whitelist with defaults when unset', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    const items = cfg.list();
    const keys = items.map((r) => r.key);
    for (const k of Object.keys(DAEMON_CONFIG_KEYS)) {
      expect(keys).toContain(k);
    }
    const maxDepthRow = items.find((r) => r.key === 'spawn.max_depth');
    expect(maxDepthRow.value).toBe(4);
    expect(maxDepthRow.isDefault).toBe(true);
    expect(maxDepthRow.updatedAt).toBeNull();
  });

  test('get(unknown key) throws ConfigKeyError', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    expect(() => cfg.get('nope.bogus')).toThrow(ConfigKeyError);
  });

  test('getNumber(unknown key) honors fallback without throwing', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    expect(cfg.getNumber('nope.bogus', 99)).toBe(99);
  });
});

describe('daemon-config: set + validation', () => {
  test('set spawn.max_depth = 7', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    const row = cfg.set('spawn.max_depth', 7);
    expect(row.value).toBe(7);
    expect(row.isDefault).toBe(false);
    expect(cfg.getNumber('spawn.max_depth', 0)).toBe(7);
  });

  test('set accepts numeric string and parses it', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    cfg.set('spawn.max_depth', '10');
    expect(cfg.getNumber('spawn.max_depth', 0)).toBe(10);
  });

  test('rejects values below min', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    expect(() => cfg.set('spawn.max_depth', 0)).toThrow(ConfigValueError);
  });

  test('rejects values above max', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    expect(() => cfg.set('spawn.max_depth', 999)).toThrow(ConfigValueError);
  });

  test('rejects non-numeric strings', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    expect(() => cfg.set('spawn.max_depth', 'not-a-number')).toThrow(ConfigValueError);
  });

  test('rejects unknown keys', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    expect(() => cfg.set('bogus.key', 1)).toThrow(ConfigKeyError);
  });

  test('unset restores default', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    cfg.set('spawn.max_depth', 7);
    expect(cfg.getNumber('spawn.max_depth', 0)).toBe(7);
    cfg.unset('spawn.max_depth');
    expect(cfg.getNumber('spawn.max_depth', 0)).toBe(DEFAULT_MAX_SPAWN_DEPTH);
  });

  test('unset(unknown) throws ConfigKeyError (prevents typo-silent unset)', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    expect(() => cfg.unset('bogus.key')).toThrow(ConfigKeyError);
  });
});

describe('daemon-config: idempotency + persistence', () => {
  test('set is idempotent (UPSERT) and bumps updated_at', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    const first = cfg.set('spawn.max_depth', 5);
    const second = cfg.set('spawn.max_depth', 6);
    expect(second.value).toBe(6);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    const items = cfg.list();
    const row = items.find((r) => r.key === 'spawn.max_depth');
    expect(row.value).toBe(6);
    expect(row.isDefault).toBe(false);
  });

  test('schema migration is idempotent (createDaemonConfig twice)', () => {
    const db = freshDb();
    expect(() => createDaemonConfig(db)).not.toThrow();
    expect(() => createDaemonConfig(db)).not.toThrow();
  });
});

describe('daemon-config: wired to spawn-ancestry via getMaxDepth', () => {
  test('ancestry respects daemon-config override at checkSpawn() time', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    const ancestry = createAncestry(db, {
      getMaxDepth: () => cfg.getNumber('spawn.max_depth', DEFAULT_MAX_SPAWN_DEPTH),
    });

    // Build a 2-deep chain.
    ancestry.record({ childSessionId: 'a', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 'b', parentSessionId: 'a', depth: 1, chain: ['a'] });

    // Default depth=4 -> spawning from b (depth 2) is fine.
    expect(() => ancestry.checkSpawn({ parentSessionId: 'b' })).not.toThrow();

    // Tighten the cap to 2 -> depth-2 spawn now refused.
    cfg.set('spawn.max_depth', 2);
    expect(() => ancestry.checkSpawn({ parentSessionId: 'b' })).toThrow(MaxDepthError);

    // Loosen the cap to 10 -> fine again, no daemon restart needed.
    cfg.set('spawn.max_depth', 10);
    expect(() => ancestry.checkSpawn({ parentSessionId: 'b' })).not.toThrow();
  });

  test('per-spawn maxDepth always wins over daemon-config', () => {
    const db = freshDb();
    const cfg = createDaemonConfig(db);
    cfg.set('spawn.max_depth', 10);  // daemon-wide is generous
    const ancestry = createAncestry(db, {
      getMaxDepth: () => cfg.getNumber('spawn.max_depth', DEFAULT_MAX_SPAWN_DEPTH),
    });
    ancestry.record({ childSessionId: 'a', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 'b', parentSessionId: 'a', depth: 1, chain: ['a'] });

    // Per-spawn tight cap should still bite.
    expect(() => ancestry.checkSpawn({ parentSessionId: 'b', maxDepth: 2 })).toThrow(MaxDepthError);
  });

  test('getMaxDepth resolver throwing falls back to DEFAULT_MAX_SPAWN_DEPTH', () => {
    const db = freshDb();
    const ancestry = createAncestry(db, {
      getMaxDepth: () => { throw new Error('oops'); },
    });
    ancestry.record({ childSessionId: 'a', parentSessionId: null, depth: 0, chain: [] });
    // Default is 4 -> depth-1 spawn fine.
    expect(() => ancestry.checkSpawn({ parentSessionId: 'a' })).not.toThrow();
  });
});
