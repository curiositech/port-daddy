/**
 * Spawn Ancestry tests — cycle detection + depth limit + tree rendering.
 *
 * The ancestry module is keyed off session ids and uses an in-process SQLite
 * handle, so these tests exercise the real schema migration + real prepared
 * statements without spinning up the daemon.
 */

import Database from 'better-sqlite3';
import {
  createAncestry,
  CycleDetectedError,
  MaxDepthError,
  DEFAULT_MAX_SPAWN_DEPTH,
  SPAWN_ANCESTRY_SCHEMA_SQL,
} from '../../lib/spawn-ancestry.js';

function freshDb() {
  const db = new Database(':memory:');
  // Mimic the parts of CORE_SCHEMA_SQL the resolver needs.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      purpose TEXT,
      status TEXT,
      phase TEXT,
      agent_id TEXT,
      worktree_id TEXT,
      identity_project TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      completed_at INTEGER,
      metadata TEXT
    );
  `);
  return db;
}

function makeSession(db, id, identityProject) {
  db.prepare(
    'INSERT INTO sessions (id, identity_project, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(id, identityProject, Date.now(), Date.now());
}

describe('spawn-ancestry: schema', () => {
  test('ensures schema on construction (idempotent)', () => {
    const db = freshDb();
    expect(() => createAncestry(db)).not.toThrow();
    // Calling twice is fine.
    expect(() => createAncestry(db)).not.toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spawn_ancestry'").all();
    expect(tables).toHaveLength(1);
  });

  test('schema SQL constant matches what the table looks like', () => {
    expect(SPAWN_ANCESTRY_SCHEMA_SQL).toContain('spawn_ancestry');
    expect(SPAWN_ANCESTRY_SCHEMA_SQL).toContain('child_session_id TEXT PRIMARY KEY');
  });
});

describe('spawn-ancestry: root spawn', () => {
  test('parentSessionId=null returns depth=0, empty chain', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    const planned = ancestry.checkSpawn({ parentSessionId: null });
    expect(planned.ok).toBe(true);
    expect(planned.depth).toBe(0);
    expect(planned.chain).toEqual([]);
  });

  test('record + getChain for a root session returns just that id', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 'root-1', parentSessionId: null, depth: 0, chain: [] });
    expect(ancestry.getChain('root-1')).toEqual(['root-1']);
  });
});

describe('spawn-ancestry: depth tracking', () => {
  test('chain grows by one per spawn', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 'a', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 'b', parentSessionId: 'a', depth: 1, chain: ['a'] });
    ancestry.record({ childSessionId: 'c', parentSessionId: 'b', depth: 2, chain: ['a', 'b'] });

    const plannedD = ancestry.checkSpawn({ parentSessionId: 'c' });
    expect(plannedD.depth).toBe(3);
    expect(plannedD.chain).toEqual(['a', 'b', 'c']);
  });

  test('refuses spawn at default depth ceiling (max=4 → depth >= 4 refused)', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    // Build chain a -> b -> c -> d (so d sits at depth 3). Spawning a child
    // from d would be depth 4, which is exactly the ceiling → refused.
    ancestry.record({ childSessionId: 'a', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 'b', parentSessionId: 'a', depth: 1, chain: ['a'] });
    ancestry.record({ childSessionId: 'c', parentSessionId: 'b', depth: 2, chain: ['a', 'b'] });
    ancestry.record({ childSessionId: 'd', parentSessionId: 'c', depth: 3, chain: ['a', 'b', 'c'] });

    // Spawning from d (depth 3) gives child depth 4 → refuse.
    expect(() => ancestry.checkSpawn({ parentSessionId: 'd' })).toThrow(MaxDepthError);
    // Spawning from c (depth 2) gives child depth 3 → fine.
    expect(() => ancestry.checkSpawn({ parentSessionId: 'c' })).not.toThrow();
  });

  test('honors a --max-depth override', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 'a', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 'b', parentSessionId: 'a', depth: 1, chain: ['a'] });

    // With max-depth=2, third child should be refused.
    expect(() => ancestry.checkSpawn({ parentSessionId: 'b', maxDepth: 2 })).toThrow(MaxDepthError);
    // With the default max-depth, fine.
    expect(() => ancestry.checkSpawn({ parentSessionId: 'b' })).not.toThrow();
  });

  test('MaxDepthError carries the full chain + suggestion text', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 'a', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 'b', parentSessionId: 'a', depth: 1, chain: ['a'] });

    try {
      ancestry.checkSpawn({ parentSessionId: 'b', maxDepth: 2 });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MaxDepthError);
      expect(err.depth).toBe(2);
      expect(err.maxDepth).toBe(2);
      expect(err.chain).toEqual(['a', 'b']);
      expect(err.message).toContain('--max-depth');
    }
  });
});

describe('spawn-ancestry: cycle detection', () => {
  test('A spawns B spawns A — refused', () => {
    const db = freshDb();
    // Two sessions, two identities.
    makeSession(db, 's1', 'agent-alpha');
    makeSession(db, 's2', 'agent-beta');
    const ancestry = createAncestry(db);

    ancestry.record({ childSessionId: 's1', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 's2', parentSessionId: 's1', depth: 1, chain: ['s1'] });

    // s2 (agent-beta) tries to spawn a child with identity agent-alpha.
    // That would reintroduce 'agent-alpha' into the chain → cycle.
    expect(() =>
      ancestry.checkSpawn({
        parentSessionId: 's2',
        proposedChildIdentity: 'agent-alpha',
      })
    ).toThrow(CycleDetectedError);
  });

  test('CycleDetectedError shows the full chain', () => {
    const db = freshDb();
    makeSession(db, 's1', 'agent-alpha');
    makeSession(db, 's2', 'agent-beta');
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 's1', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 's2', parentSessionId: 's1', depth: 1, chain: ['s1'] });

    try {
      ancestry.checkSpawn({
        parentSessionId: 's2',
        proposedChildIdentity: 'agent-alpha',
      });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CycleDetectedError);
      expect(err.chain).toEqual(['s1', 's2']);
      expect(err.collidingIdentity).toBe('agent-alpha');
      expect(err.message).toContain('s1');
      expect(err.message).toContain('s2');
      expect(err.message).toContain('agent-alpha');
    }
  });

  test('different identities never cycle (A -> B -> C with three distinct identities)', () => {
    const db = freshDb();
    makeSession(db, 's1', 'agent-alpha');
    makeSession(db, 's2', 'agent-beta');
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 's1', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 's2', parentSessionId: 's1', depth: 1, chain: ['s1'] });

    expect(() =>
      ancestry.checkSpawn({
        parentSessionId: 's2',
        proposedChildIdentity: 'agent-gamma',
      })
    ).not.toThrow();
  });

  test('no identity supplied → cycle check skipped (still depth-checked)', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 's1', parentSessionId: null, depth: 0, chain: [] });
    expect(() => ancestry.checkSpawn({ parentSessionId: 's1' })).not.toThrow();
  });
});

describe('spawn-ancestry: tree rendering', () => {
  test('ascii tree shows root + nested children', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 'root', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 'child-1', parentSessionId: 'root', depth: 1, chain: ['root'] });
    ancestry.record({ childSessionId: 'child-2', parentSessionId: 'root', depth: 1, chain: ['root'] });
    ancestry.record({ childSessionId: 'grand-1', parentSessionId: 'child-1', depth: 2, chain: ['root', 'child-1'] });

    const ascii = ancestry.tree('root');
    expect(ascii).toContain('root');
    expect(ascii).toContain('child-1');
    expect(ascii).toContain('child-2');
    expect(ascii).toContain('grand-1');
    // child-1 should appear above child-2 (insertion order)
    expect(ascii.indexOf('child-1')).toBeLessThan(ascii.indexOf('child-2'));
    // grand-1 should appear after child-1 and before child-2
    expect(ascii.indexOf('grand-1')).toBeGreaterThan(ascii.indexOf('child-1'));
    expect(ascii.indexOf('grand-1')).toBeLessThan(ascii.indexOf('child-2'));
  });

  test('childrenOf returns one-hop descendants only', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 'root', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 'k1', parentSessionId: 'root', depth: 1, chain: ['root'] });
    ancestry.record({ childSessionId: 'k2', parentSessionId: 'root', depth: 1, chain: ['root'] });
    ancestry.record({ childSessionId: 'gk', parentSessionId: 'k1', depth: 2, chain: ['root', 'k1'] });

    const kids = ancestry.childrenOf('root').map((c) => c.childSessionId);
    expect(kids).toEqual(['k1', 'k2']);
  });
});

describe('spawn-ancestry: idempotency', () => {
  test('record() is idempotent (UPSERT)', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);
    ancestry.record({ childSessionId: 's', parentSessionId: null, depth: 0, chain: [], now: 100 });
    ancestry.record({ childSessionId: 's', parentSessionId: null, depth: 0, chain: [], now: 200 });
    const row = ancestry.getRow('s');
    expect(row).not.toBeNull();
    expect(row.createdAt).toBe(200);
  });
});

describe('spawn-ancestry: defaults', () => {
  test('DEFAULT_MAX_SPAWN_DEPTH is 4', () => {
    expect(DEFAULT_MAX_SPAWN_DEPTH).toBe(4);
  });
});
