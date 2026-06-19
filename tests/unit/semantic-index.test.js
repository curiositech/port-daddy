/**
 * Unit Tests for Semantic Index (semantic-index.ts)
 *
 * Tests the in-memory trie index backed by SQLite:
 *   - initialize() loads services, agents, sessions, harbors from DB
 *   - index() / unindex() / unindexEntry() for runtime mutations
 *   - lookup() / lookupAll() / find() / all() queries
 *   - Error handling when tables are missing or empty
 *   - Wildcard and prefix patterns
 *   - 1:N entries per key (multiple agents on same identity)
 *
 * Each test uses a fresh in-memory SQLite DB via createTestDb().
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSemanticIndex } from '../../lib/semantic-index.js';

describe('Semantic Index', () => {
  let db;
  let index;

  // Monotonic counter for deterministic, collision-free service ports.
  // services.port carries a UNIQUE constraint (see tests/setup-unit.js), so a
  // random port (the old `3000 + Math.random()*1000`) had a birthday-collision
  // chance of hitting `UNIQUE constraint failed: services.port` whenever a test
  // inserted two services — a non-deterministic flake on CI. Resetting the
  // counter in beforeEach keeps every test isolated and every port distinct.
  let servicePortSeq;

  beforeEach(() => {
    db = createTestDb();
    index = createSemanticIndex(db);
    servicePortSeq = 0;
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function insertService(id) {
    const port = 3000 + ++servicePortSeq; // deterministic & unique per insert
    db.prepare(
      'INSERT INTO services (id, port, status, created_at, last_seen) VALUES (?, ?, ?, ?, ?)'
    ).run(id, port, 'assigned', Date.now(), Date.now());
  }

  function insertAgent(id, project, stack = null, context = null, status = 'active') {
    db.prepare(
      `INSERT INTO agents (id, identity_project, identity_stack, identity_context, status, registered_at, last_heartbeat)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, project, stack, context, status, Date.now(), Date.now());
  }

  function insertSession(id, project, status = 'active') {
    db.prepare(
      `INSERT INTO sessions (id, purpose, identity_project, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, 'test session', project, status, Date.now(), Date.now());
  }

  function insertHarbor(name) {
    // Harbors table may not exist in test DB — create it
    db.exec(`
      CREATE TABLE IF NOT EXISTS harbors (
        name TEXT PRIMARY KEY,
        scope TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO harbors (name, scope, created_at) VALUES (?, NULL, ?)').run(name, Date.now());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZE — COLD START FROM SQLITE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('initialize()', () => {
    it('should load services from SQLite into the trie', () => {
      insertService('myapp:api:main');
      insertService('myapp:web:main');

      index.initialize();

      expect(index.size()).toBe(2);
      const entry = index.lookup('myapp:api:main');
      expect(entry).not.toBeNull();
      expect(entry.type).toBe('service');
      expect(entry.id).toBe('myapp:api:main');
      expect(entry.identity).toBe('myapp:api:main');
    });

    it('should load agents with semantic identity', () => {
      insertAgent('agent-1', 'myapp', 'api', 'main');
      insertAgent('agent-2', 'myapp', 'web', null);

      index.initialize();

      const agent1 = index.lookup('myapp:api:main');
      expect(agent1).not.toBeNull();
      expect(agent1.type).toBe('agent');
      expect(agent1.id).toBe('agent-1');
      expect(agent1.status).toBe('active');

      const agent2 = index.lookup('myapp:web');
      expect(agent2).not.toBeNull();
      expect(agent2.type).toBe('agent');
      expect(agent2.id).toBe('agent-2');
    });

    it('should skip agents without any identity parts', () => {
      insertAgent('agent-no-identity', null, null, null);

      index.initialize();

      // Only agents with identity are indexed
      expect(index.size()).toBe(0);
    });

    it('should load active sessions with identity_project', () => {
      insertSession('sess-1', 'myapp', 'active');
      insertSession('sess-2', 'other', 'active');
      insertSession('sess-3', 'done', 'completed'); // not loaded — only active

      index.initialize();

      const sess = index.lookup('myapp');
      expect(sess).not.toBeNull();
      expect(sess.type).toBe('session');
      expect(sess.id).toBe('sess-1');

      // sess-3 is completed, should not be indexed
      const doneSess = index.lookup('done');
      expect(doneSess).toBeNull();
    });

    it('should skip sessions without identity_project', () => {
      insertSession('sess-no-proj', null, 'active');

      index.initialize();

      expect(index.size()).toBe(0);
    });

    it('should load harbors', () => {
      insertHarbor('deploy-harbor');
      insertHarbor('test-harbor');

      index.initialize();

      const h = index.lookup('deploy-harbor');
      expect(h).not.toBeNull();
      expect(h.type).toBe('harbor');
      expect(h.id).toBe('deploy-harbor');
    });

    it('should be idempotent — second call is a no-op', () => {
      insertService('myapp:api:main');

      index.initialize();
      expect(index.size()).toBe(1);

      // Insert another service after first init
      insertService('myapp:web:main');
      index.initialize(); // should not re-load

      // Still only 1 — the second init was skipped
      expect(index.size()).toBe(1);
    });

    it('should handle missing tables gracefully', () => {
      // Drop the services table to simulate early init
      db.exec('DROP TABLE IF EXISTS services');

      // Should not throw — logs error and skips
      expect(() => index.initialize()).not.toThrow();
    });

    it('should handle empty database', () => {
      index.initialize();
      expect(index.size()).toBe(0);
      expect(index.all()).toEqual([]);
    });

    it('should build composite identity from project+stack+context', () => {
      insertAgent('agent-full', 'proj', 'stack', 'ctx');

      index.initialize();

      const entry = index.lookup('proj:stack:ctx');
      expect(entry).not.toBeNull();
      expect(entry.identity).toBe('proj:stack:ctx');
    });

    it('should build partial identity from project only', () => {
      insertAgent('agent-proj-only', 'myproj', null, null);

      index.initialize();

      const entry = index.lookup('myproj');
      expect(entry).not.toBeNull();
      expect(entry.identity).toBe('myproj');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INDEX / UNINDEX — RUNTIME MUTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('index() and unindex()', () => {
    it('should add a new entry to the trie', () => {
      index.index('test:svc:alpha', { type: 'service', id: 'svc-1', identity: 'test:svc:alpha' });

      expect(index.size()).toBe(1);
      const entry = index.lookup('test:svc:alpha');
      expect(entry.type).toBe('service');
      expect(entry.id).toBe('svc-1');
    });

    it('should remove an entry from the trie', () => {
      index.index('test:svc:beta', { type: 'service', id: 'svc-2', identity: 'test:svc:beta' });
      expect(index.size()).toBe(1);

      const removed = index.unindex('test:svc:beta');
      expect(removed).toBe(true);
      expect(index.size()).toBe(0);
      expect(index.lookup('test:svc:beta')).toBeNull();
    });

    it('should return false when unindexing non-existent key', () => {
      const removed = index.unindex('nonexistent:key');
      expect(removed).toBe(false);
    });

    it('should support 1:N entries via entryId', () => {
      const identity = 'shared:pool';
      index.index(identity, { type: 'agent', id: 'a1', identity }, 'a1');
      index.index(identity, { type: 'agent', id: 'a2', identity }, 'a2');
      index.index(identity, { type: 'agent', id: 'a3', identity }, 'a3');

      const all = index.lookupAll(identity);
      expect(all).toHaveLength(3);
      expect(all.map(e => e.id).sort()).toEqual(['a1', 'a2', 'a3']);
    });

    it('should remove a specific entryId without affecting others', () => {
      const identity = 'shared:pool';
      index.index(identity, { type: 'agent', id: 'a1', identity }, 'a1');
      index.index(identity, { type: 'agent', id: 'a2', identity }, 'a2');

      const removed = index.unindexEntry(identity, 'a1');
      expect(removed).toBe(true);

      const remaining = index.lookupAll(identity);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('a2');
    });

    it('should return false when unindexEntry targets non-existent entryId', () => {
      index.index('key', { type: 'service', id: 's1', identity: 'key' });

      const removed = index.unindexEntry('key', 'no-such-entry');
      expect(removed).toBe(false);
    });

    it('should return false when unindexEntry targets non-existent key', () => {
      const removed = index.unindexEntry('nonexistent', 'any');
      expect(removed).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOKUP — EXACT QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('lookup() and lookupAll()', () => {
    it('should return null for non-existent key', () => {
      expect(index.lookup('does:not:exist')).toBeNull();
    });

    it('should return first entry for lookup() on 1:N key', () => {
      const identity = 'multi:agents';
      index.index(identity, { type: 'agent', id: 'first', identity }, 'first');
      index.index(identity, { type: 'agent', id: 'second', identity }, 'second');

      const entry = index.lookup(identity);
      expect(entry).not.toBeNull();
      expect(entry.type).toBe('agent');
      // Should be either first or second (first inserted)
      expect(['first', 'second']).toContain(entry.id);
    });

    it('should return empty array for lookupAll() on non-existent key', () => {
      expect(index.lookupAll('nope')).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND — PATTERN MATCHING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('find()', () => {
    beforeEach(() => {
      index.index('myapp:api:main', { type: 'service', id: 's1', identity: 'myapp:api:main' });
      index.index('myapp:api:staging', { type: 'service', id: 's2', identity: 'myapp:api:staging' });
      index.index('myapp:web:main', { type: 'service', id: 's3', identity: 'myapp:web:main' });
      index.index('other:api:main', { type: 'service', id: 's4', identity: 'other:api:main' });
    });

    it('should find by exact key (no wildcard)', () => {
      const results = index.find('myapp:api:main');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('s1');
    });

    it('should find by simple prefix pattern (trailing *)', () => {
      const results = index.find('myapp:*');
      expect(results.length).toBeGreaterThanOrEqual(3);
      expect(results.every(e => e.identity.startsWith('myapp:'))).toBe(true);
    });

    it('should find by complex wildcard pattern (middle *)', () => {
      const results = index.find('*:api:main');
      expect(results.length).toBeGreaterThanOrEqual(2);
      const ids = results.map(e => e.id);
      expect(ids).toContain('s1'); // myapp:api:main
      expect(ids).toContain('s4'); // other:api:main
    });

    it('should find by multi-segment prefix', () => {
      const results = index.find('myapp:api:*');
      expect(results.length).toBeGreaterThanOrEqual(2);
      const ids = results.map(e => e.id);
      expect(ids).toContain('s1'); // myapp:api:main
      expect(ids).toContain('s2'); // myapp:api:staging
    });

    it('should return empty for non-matching pattern', () => {
      const results = index.find('noexist:*');
      expect(results).toEqual([]);
    });

    it('should return empty for non-matching exact key', () => {
      const results = index.find('totally:missing:key');
      expect(results).toEqual([]);
    });

    it('should return all entries for 1:N key without wildcard', () => {
      const identity = 'shared:key';
      index.index(identity, { type: 'agent', id: 'a1', identity }, 'a1');
      index.index(identity, { type: 'agent', id: 'a2', identity }, 'a2');

      const results = index.find('shared:key');
      expect(results).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ALL — FULL LISTING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('all()', () => {
    it('should return all indexed entries', () => {
      index.index('a:b', { type: 'service', id: 's1', identity: 'a:b' });
      index.index('c:d', { type: 'agent', id: 'a1', identity: 'c:d' });

      const results = index.all();
      expect(results).toHaveLength(2);
    });

    it('should return empty array when nothing is indexed', () => {
      expect(index.all()).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SIZE AND DUMP
  // ═══════════════════════════════════════════════════════════════════════════

  describe('size() and dump()', () => {
    it('should return 0 for empty index', () => {
      expect(index.size()).toBe(0);
    });

    it('should track size as entries are added and removed', () => {
      index.index('a', { type: 'service', id: '1', identity: 'a' });
      expect(index.size()).toBe(1);

      index.index('b', { type: 'service', id: '2', identity: 'b' });
      expect(index.size()).toBe(2);

      index.unindex('a');
      expect(index.size()).toBe(1);
    });

    it('should return dump output (trie debug representation)', () => {
      index.index('x:y:z', { type: 'service', id: 's', identity: 'x:y:z' });
      const dump = index.dump();
      // dump() returns a string or object representation of the trie
      expect(dump).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MIXED TYPES — SERVICES + AGENTS + SESSIONS + HARBORS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('mixed types from initialize()', () => {
    it('should index all entity types simultaneously', () => {
      insertService('myapp:api:main');
      insertAgent('agent-1', 'myapp', 'worker', null);
      insertSession('sess-1', 'myapp', 'active');
      insertHarbor('build-harbor');

      index.initialize();

      expect(index.size()).toBeGreaterThanOrEqual(4);

      expect(index.lookup('myapp:api:main').type).toBe('service');
      expect(index.lookup('myapp:worker').type).toBe('agent');
      // 'myapp' could match session or agent depending on insertion order
      const myappEntries = index.lookupAll('myapp');
      const types = myappEntries.map(e => e.type);
      expect(types).toContain('session');
      expect(index.lookup('build-harbor').type).toBe('harbor');
    });

    it('should support prefix search across types', () => {
      insertService('myapp:api:main');
      insertAgent('agent-1', 'myapp', 'worker', null);

      index.initialize();

      const results = index.find('myapp:*');
      expect(results.length).toBeGreaterThanOrEqual(2);
      const types = new Set(results.map(e => e.type));
      expect(types.has('service')).toBe(true);
      expect(types.has('agent')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST-INITIALIZE MUTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('mutations after initialize()', () => {
    it('should allow indexing after initialize()', () => {
      index.initialize();
      expect(index.size()).toBe(0);

      index.index('new:svc', { type: 'service', id: 'new-1', identity: 'new:svc' });
      expect(index.size()).toBe(1);
      expect(index.lookup('new:svc').id).toBe('new-1');
    });

    it('should allow unindexing items loaded by initialize()', () => {
      insertService('myapp:api:main');
      index.initialize();
      expect(index.size()).toBe(1);

      index.unindex('myapp:api:main');
      expect(index.size()).toBe(0);
    });
  });
});
