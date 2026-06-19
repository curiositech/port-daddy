import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';

let db;
let tuples;

beforeEach(() => {
  db = createTestDb();
  tuples = createTupleSpace(db);
});

afterEach(() => {
  db.close();
});

describe('out (write)', () => {
  test('writes a tuple and returns it', () => {
    const t = tuples.out(['connection', 'trie+pubsub', 'spider', 0.9]);
    expect(t.id).toBeGreaterThan(0);
    expect(t.fields).toEqual(['connection', 'trie+pubsub', 'spider', 0.9]);
    expect(t.harbor).toBeNull();
    expect(t.writtenBy).toBeNull();
  });

  test('writes with harbor and writtenBy', () => {
    const t = tuples.out(['idea', 'add caching'], { harbor: 'myapp:fleet', writtenBy: 'spark' });
    expect(t.harbor).toBe('myapp:fleet');
    expect(t.writtenBy).toBe('spark');
  });

  test('writes with TTL', () => {
    const t = tuples.out(['temp', 'data'], { ttlMs: 60000 });
    expect(t.expiresAt).toBeGreaterThan(Date.now());
    expect(t.expiresAt).toBeLessThanOrEqual(Date.now() + 60000);
  });
});

describe('rd (read)', () => {
  test('exact match on first field', () => {
    tuples.out(['connection', 'A', 'spider', 0.9]);
    tuples.out(['idea', 'B', 'spark', 0.8]);
    tuples.out(['connection', 'C', 'spider', 0.7]);

    const matches = tuples.rd(['connection']);
    expect(matches).toHaveLength(2);
    const names = matches.map(m => m.fields[1]).sort();
    expect(names).toEqual(['A', 'C']);
  });

  test('wildcard matches any value', () => {
    tuples.out(['connection', 'A', 'spider', 0.9]);
    tuples.out(['connection', 'B', 'qa', 0.5]);

    const matches = tuples.rd(['connection', '*', 'spider']);
    expect(matches).toHaveLength(1);
    expect(matches[0].fields[1]).toBe('A');
  });

  test('numeric greater-than pattern', () => {
    tuples.out(['score', 'agent-1', 0.3]);
    tuples.out(['score', 'agent-2', 0.8]);
    tuples.out(['score', 'agent-3', 0.95]);

    const matches = tuples.rd(['score', '*', '>0.7']);
    expect(matches).toHaveLength(2);
  });

  test('numeric less-than pattern', () => {
    tuples.out(['score', 'agent-1', 0.3]);
    tuples.out(['score', 'agent-2', 0.8]);

    const matches = tuples.rd(['score', '*', '<0.5']);
    expect(matches).toHaveLength(1);
    expect(matches[0].fields[1]).toBe('agent-1');
  });

  test('harbor scoping', () => {
    tuples.out(['fact', 'A'], { harbor: 'project-a:fleet' });
    tuples.out(['fact', 'B'], { harbor: 'project-b:fleet' });

    const matches = tuples.rd(['fact'], { harbor: 'project-a:fleet' });
    expect(matches).toHaveLength(1);
    expect(matches[0].fields[1]).toBe('A');
  });

  test('expired tuples are not returned', () => {
    // Write a tuple that's already expired
    const now = Date.now();
    db.prepare('INSERT INTO tuples (harbor, fields, written_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(null, JSON.stringify(['expired', 'data']), null, now - 10000, now - 1000);

    tuples.out(['fresh', 'data']);

    const matches = tuples.rd(['*']);
    expect(matches).toHaveLength(1);
    expect(matches[0].fields[0]).toBe('fresh');
  });

  test('limit caps results', () => {
    for (let i = 0; i < 10; i++) {
      tuples.out(['item', i]);
    }

    const matches = tuples.rd(['item'], { limit: 3 });
    expect(matches).toHaveLength(3);
  });

  test('empty pattern matches all', () => {
    tuples.out(['a', 1]);
    tuples.out(['b', 2]);
    expect(tuples.rd(['*'])).toHaveLength(2);
  });
});

describe('take (in)', () => {
  test('removes matching tuples', () => {
    tuples.out(['task', 'build-auth', 'pending']);
    tuples.out(['task', 'build-api', 'pending']);
    tuples.out(['task', 'build-auth', 'done']);

    const taken = tuples.take(['task', 'build-auth']);
    expect(taken).toHaveLength(2);

    // Only the api task remains
    const remaining = tuples.scan();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].fields[1]).toBe('build-api');
  });

  test('take with limit removes only N', () => {
    tuples.out(['log', 'entry-1']);
    tuples.out(['log', 'entry-2']);
    tuples.out(['log', 'entry-3']);

    const taken = tuples.take(['log'], { limit: 1 });
    expect(taken).toHaveLength(1);
    expect(tuples.count()).toBe(2);
  });
});

describe('scan', () => {
  test('returns all non-expired tuples', () => {
    tuples.out(['a', 1]);
    tuples.out(['b', 2], { harbor: 'fleet' });
    expect(tuples.scan()).toHaveLength(2);
  });

  test('filters by harbor', () => {
    tuples.out(['a', 1], { harbor: 'fleet-a' });
    tuples.out(['b', 2], { harbor: 'fleet-b' });
    expect(tuples.scan('fleet-a')).toHaveLength(1);
  });
});

describe('count', () => {
  test('counts all tuples', () => {
    tuples.out(['a']);
    tuples.out(['b']);
    tuples.out(['c']);
    expect(tuples.count()).toBe(3);
  });

  test('counts by harbor', () => {
    tuples.out(['a'], { harbor: 'h1' });
    tuples.out(['b'], { harbor: 'h1' });
    tuples.out(['c'], { harbor: 'h2' });
    expect(tuples.count(undefined, 'h1')).toBe(2);
  });

  test('counts by pattern', () => {
    tuples.out(['connection', 'A', 0.9]);
    tuples.out(['idea', 'B', 0.5]);
    tuples.out(['connection', 'C', 0.7]);
    expect(tuples.count(['connection'])).toBe(2);
  });
});

describe('pattern matching edge cases', () => {
  test('pattern longer than tuple does not match', () => {
    tuples.out(['short']);
    expect(tuples.rd(['short', 'extra'])).toHaveLength(0);
  });

  test('pattern shorter than tuple matches prefix', () => {
    tuples.out(['a', 'b', 'c', 'd']);
    expect(tuples.rd(['a', 'b'])).toHaveLength(1);
  });

  test('null in pattern acts as wildcard', () => {
    tuples.out(['type', 'value', 42]);
    expect(tuples.rd(['type', null, 42])).toHaveLength(1);
  });

  test('semantic identity prefix match (myapp:*)', () => {
    tuples.out(['connection', 'myapp:api:main', 'spider']);
    tuples.out(['connection', 'myapp:frontend:dev', 'spider']);
    tuples.out(['connection', 'other:api:main', 'qa']);

    const matches = tuples.rd(['connection', 'myapp:*']);
    expect(matches).toHaveLength(2);
  });

  test('semantic identity wildcard match (myapp:*:main)', () => {
    tuples.out(['status', 'myapp:api:main', 'healthy']);
    tuples.out(['status', 'myapp:frontend:main', 'healthy']);
    tuples.out(['status', 'myapp:api:staging', 'unhealthy']);

    const matches = tuples.rd(['status', 'myapp:*:main']);
    expect(matches).toHaveLength(2);
  });

  test('boolean matching', () => {
    tuples.out(['flag', true]);
    tuples.out(['flag', false]);
    expect(tuples.rd(['flag', true])).toHaveLength(1);
  });
});
