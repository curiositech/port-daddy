import { describe, test, expect, beforeEach } from '@jest/globals';
import { createTrie } from '../../lib/trie.ts';

describe('Semantic Trie', () => {
  let trie;

  beforeEach(() => {
    trie = createTrie();
  });

  describe('insert and get', () => {
    test('inserts and retrieves a key', () => {
      trie.insert('myapp:api:main', { port: 3001 });
      const entry = trie.get('myapp:api:main');
      expect(entry).not.toBeNull();
      expect(entry.key).toBe('myapp:api:main');
      expect(entry.value.port).toBe(3001);
    });

    test('returns null for missing key', () => {
      expect(trie.get('nonexistent:key:here')).toBeNull();
    });

    test('overwrites existing key', () => {
      trie.insert('myapp:api:main', { port: 3001 });
      trie.insert('myapp:api:main', { port: 3002 });
      expect(trie.get('myapp:api:main').value.port).toBe(3002);
    });

    test('handles single-segment keys', () => {
      trie.insert('myapp', { name: 'myapp' });
      expect(trie.get('myapp').value.name).toBe('myapp');
    });

    test('handles deep keys', () => {
      trie.insert('a:b:c:d:e:f', 'deep');
      expect(trie.get('a:b:c:d:e:f').value).toBe('deep');
    });

    test('tracks size correctly', () => {
      expect(trie.size()).toBe(0);
      trie.insert('a:b', 1);
      expect(trie.size()).toBe(1);
      trie.insert('a:c', 2);
      expect(trie.size()).toBe(2);
      trie.insert('a:b', 3); // overwrite, not new
      expect(trie.size()).toBe(2);
    });
  });

  describe('remove', () => {
    test('removes an existing key', () => {
      trie.insert('myapp:api:main', 1);
      expect(trie.remove('myapp:api:main')).toBe(true);
      expect(trie.get('myapp:api:main')).toBeNull();
      expect(trie.size()).toBe(0);
    });

    test('returns false for missing key', () => {
      expect(trie.remove('nonexistent')).toBe(false);
    });

    test('does not affect sibling keys', () => {
      trie.insert('myapp:api:main', 1);
      trie.insert('myapp:api:test', 2);
      trie.insert('myapp:web:main', 3);
      trie.remove('myapp:api:test');
      expect(trie.get('myapp:api:main')).not.toBeNull();
      expect(trie.get('myapp:web:main')).not.toBeNull();
      expect(trie.size()).toBe(2);
    });
  });

  describe('prefix search', () => {
    beforeEach(() => {
      trie.insert('myapp:api:main', { type: 'api' });
      trie.insert('myapp:api:test', { type: 'api-test' });
      trie.insert('myapp:web:main', { type: 'web' });
      trie.insert('myapp:web:feature', { type: 'web-feat' });
      trie.insert('other:api:main', { type: 'other' });
    });

    test('finds all entries under a prefix', () => {
      const results = trie.prefix('myapp');
      expect(results.length).toBe(4);
    });

    test('finds entries under a deeper prefix', () => {
      const results = trie.prefix('myapp:api');
      expect(results.length).toBe(2);
    });

    test('returns empty for non-matching prefix', () => {
      const results = trie.prefix('nonexistent');
      expect(results.length).toBe(0);
    });

    test('handles wildcard suffix', () => {
      const results = trie.prefix('myapp:*');
      expect(results.length).toBe(4);
    });
  });

  describe('wildcard match', () => {
    beforeEach(() => {
      trie.insert('myapp:api:main', 1);
      trie.insert('myapp:api:test', 2);
      trie.insert('myapp:web:main', 3);
      trie.insert('other:api:main', 4);
      trie.insert('other:web:test', 5);
    });

    test('matches wildcard in middle', () => {
      const results = trie.match('myapp:*:main');
      expect(results.length).toBe(2); // api:main + web:main
      expect(results.map(r => r.key).sort()).toEqual([
        'myapp:api:main', 'myapp:web:main'
      ]);
    });

    test('matches wildcard at start', () => {
      const results = trie.match('*:api:main');
      expect(results.length).toBe(2); // myapp + other
    });

    test('matches wildcard at end', () => {
      // Note: wildcard at end matches only that segment, not all descendants
      const results = trie.match('myapp:api:*');
      expect(results.length).toBe(2); // main + test
    });

    test('matches multiple wildcards', () => {
      const results = trie.match('*:*:main');
      expect(results.length).toBe(3); // myapp:api:main, myapp:web:main, other:api:main
    });

    test('exact match (no wildcards)', () => {
      const results = trie.match('myapp:api:main');
      expect(results.length).toBe(1);
      expect(results[0].value).toBe(1);
    });

    test('no matches', () => {
      const results = trie.match('*:*:staging');
      expect(results.length).toBe(0);
    });
  });

  describe('harbor bitmask filtering', () => {
    const HARBOR_A = 1n;
    const HARBOR_B = 2n;
    const HARBOR_AB = 3n; // both

    beforeEach(() => {
      trie.insert('myapp:api:main', 1, HARBOR_A);
      trie.insert('myapp:web:main', 2, HARBOR_B);
      trie.insert('shared:util:common', 3, HARBOR_AB);
    });

    test('prefix with harbor filter', () => {
      const resultsA = trie.prefix('myapp', HARBOR_A);
      expect(resultsA.length).toBe(1);
      expect(resultsA[0].key).toBe('myapp:api:main');

      const resultsB = trie.prefix('myapp', HARBOR_B);
      expect(resultsB.length).toBe(1);
      expect(resultsB[0].key).toBe('myapp:web:main');
    });

    test('match with harbor filter', () => {
      const results = trie.match('*:*:main', HARBOR_A);
      expect(results.length).toBe(1); // only myapp:api:main (harbor A)
    });

    test('shared harbor membership', () => {
      const results = trie.prefix('shared', HARBOR_A);
      expect(results.length).toBe(1); // shared:util:common is in both
    });
  });

  describe('all and clear', () => {
    test('all returns every entry', () => {
      trie.insert('a:b', 1);
      trie.insert('c:d', 2);
      trie.insert('e:f', 3);
      expect(trie.all().length).toBe(3);
    });

    test('clear empties the trie', () => {
      trie.insert('a:b', 1);
      trie.insert('c:d', 2);
      trie.clear();
      expect(trie.size()).toBe(0);
      expect(trie.all().length).toBe(0);
    });
  });

  describe('performance', () => {
    test('handles 10,000 entries', () => {
      for (let i = 0; i < 10000; i++) {
        const proj = `proj${i % 100}`;
        const stack = `stack${i % 50}`;
        const ctx = `ctx${i}`;
        trie.insert(`${proj}:${stack}:${ctx}`, i);
      }
      expect(trie.size()).toBe(10000);

      // Wildcard search should be fast
      const start = performance.now();
      const results = trie.match('proj0:*:*');
      const elapsed = performance.now() - start;

      expect(results.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(50); // < 50ms for 10k entries
    });

    test('prefix search on 10,000 entries', () => {
      for (let i = 0; i < 10000; i++) {
        trie.insert(`proj${i % 100}:stack${i % 50}:ctx${i}`, i);
      }

      const start = performance.now();
      const results = trie.prefix('proj0');
      const elapsed = performance.now() - start;

      expect(results.length).toBe(100); // 10000/100 projects
      expect(elapsed).toBeLessThan(50); // Keep a coarse regression guard without flaking on shared CI.
    });
  });

  describe('1:N multi-value keys (entryId)', () => {
    test('stores multiple entries at the same key', () => {
      trie.insert('myapp:api', { agent: 'alpha' }, undefined, 'alpha');
      trie.insert('myapp:api', { agent: 'beta' }, undefined, 'beta');
      expect(trie.size()).toBe(2);
    });

    test('getAll returns all entries at a key', () => {
      trie.insert('myapp:api', { agent: 'alpha' }, undefined, 'alpha');
      trie.insert('myapp:api', { agent: 'beta' }, undefined, 'beta');
      const entries = trie.getAll('myapp:api');
      expect(entries.length).toBe(2);
      expect(entries.map(e => e.value.agent).sort()).toEqual(['alpha', 'beta']);
    });

    test('get returns first entry (backward compat)', () => {
      trie.insert('myapp:api', { agent: 'alpha' }, undefined, 'alpha');
      trie.insert('myapp:api', { agent: 'beta' }, undefined, 'beta');
      const entry = trie.get('myapp:api');
      expect(entry).not.toBeNull();
      expect(entry.value.agent).toBe('alpha');
    });

    test('deduplicates by entryId on re-insert', () => {
      trie.insert('myapp:api', { status: 'starting' }, undefined, 'alpha');
      trie.insert('myapp:api', { status: 'ready' }, undefined, 'alpha');
      expect(trie.size()).toBe(1);
      const entries = trie.getAll('myapp:api');
      expect(entries.length).toBe(1);
      expect(entries[0].value.status).toBe('ready');
    });

    test('removeEntry removes specific entry by entryId', () => {
      trie.insert('myapp:api', { agent: 'alpha' }, undefined, 'alpha');
      trie.insert('myapp:api', { agent: 'beta' }, undefined, 'beta');
      trie.insert('myapp:api', { agent: 'gamma' }, undefined, 'gamma');

      const removed = trie.removeEntry('myapp:api', 'beta');
      expect(removed).toBe(true);
      expect(trie.size()).toBe(2);

      const entries = trie.getAll('myapp:api');
      expect(entries.length).toBe(2);
      expect(entries.map(e => e.value.agent).sort()).toEqual(['alpha', 'gamma']);
    });

    test('removeEntry returns false for missing entryId', () => {
      trie.insert('myapp:api', { agent: 'alpha' }, undefined, 'alpha');
      expect(trie.removeEntry('myapp:api', 'nonexistent')).toBe(false);
      expect(trie.size()).toBe(1);
    });

    test('removeEntry returns false for missing key', () => {
      expect(trie.removeEntry('nonexistent', 'id')).toBe(false);
    });

    test('remove deletes ALL entries at a key', () => {
      trie.insert('myapp:api', { agent: 'alpha' }, undefined, 'alpha');
      trie.insert('myapp:api', { agent: 'beta' }, undefined, 'beta');
      expect(trie.size()).toBe(2);

      trie.remove('myapp:api');
      expect(trie.size()).toBe(0);
      expect(trie.getAll('myapp:api')).toEqual([]);
    });

    test('prefix search returns entries from all 1:N keys', () => {
      trie.insert('myapp:api', { agent: 'alpha' }, undefined, 'alpha');
      trie.insert('myapp:api', { agent: 'beta' }, undefined, 'beta');
      trie.insert('myapp:web', { agent: 'gamma' }, undefined, 'gamma');

      const results = trie.prefix('myapp');
      expect(results.length).toBe(3);
    });

    test('match returns entries from all 1:N keys', () => {
      trie.insert('myapp:api:main', { agent: 'alpha' }, undefined, 'alpha');
      trie.insert('myapp:api:main', { agent: 'beta' }, undefined, 'beta');
      trie.insert('myapp:web:main', { agent: 'gamma' }, undefined, 'gamma');

      const results = trie.match('myapp:*:main');
      expect(results.length).toBe(3);
    });

    test('mixed 1:1 and 1:N keys coexist', () => {
      // 1:1 key (no entryId)
      trie.insert('service:api:main', { type: 'service' });
      // 1:N keys (with entryId)
      trie.insert('myapp:api', { type: 'agent', id: 'a1' }, undefined, 'a1');
      trie.insert('myapp:api', { type: 'agent', id: 'a2' }, undefined, 'a2');

      expect(trie.size()).toBe(3);
      expect(trie.get('service:api:main').value.type).toBe('service');
      expect(trie.getAll('myapp:api').length).toBe(2);
    });

    test('removeEntry prunes empty leaf nodes', () => {
      trie.insert('deep:nested:key', { x: 1 }, undefined, 'only');
      trie.removeEntry('deep:nested:key', 'only');
      expect(trie.size()).toBe(0);
      // Verify the branch was pruned (no stale nodes)
      expect(trie.get('deep:nested:key')).toBeNull();
    });

    test('getAll returns empty array for missing key', () => {
      expect(trie.getAll('nonexistent')).toEqual([]);
    });

    test('entryId is preserved on entries', () => {
      trie.insert('myapp:api', { agent: 'alpha' }, undefined, 'alpha-id');
      const entries = trie.getAll('myapp:api');
      expect(entries[0].entryId).toBe('alpha-id');
    });
  });
});
