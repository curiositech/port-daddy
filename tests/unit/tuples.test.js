import { createTestDb } from '../setup-unit.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTupleSpace,
  MAX_TUPLE_IDEMPOTENCY_KEY_CHARS,
} from '../../lib/tuples.js';

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
    expect(t.idempotencyKey).toBeNull();
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

describe('outOnce (durable idempotent write)', () => {
  test('two TupleSpace instances on separate connections cannot create duplicates', () => {
    const dir = mkdtempSync(join(process.cwd(), '.test-tuples-out-once-'));
    const path = join(dir, 'tuples.db');
    const dbA = new Database(path);
    const dbB = new Database(path);
    try {
      const tuplesA = createTupleSpace(dbA);
      const tuplesB = createTupleSpace(dbB);
      const notified = [];
      tuplesA.subscribe(['once'], { harbor: ' fleet ' }, (tuple) => notified.push(tuple.id));

      const first = tuplesA.outOnce(['once', 'original'], {
        harbor: ' fleet ',
        idempotencyKey: ' durable-key ',
      });
      const replay = tuplesB.outOnce(['once', 'replacement'], {
        harbor: 'fleet',
        idempotencyKey: 'durable-key',
      });

      expect(first.inserted).toBe(true);
      expect(replay.inserted).toBe(false);
      expect(replay.tuple).toEqual(first.tuple);
      expect(replay.tuple.fields).toEqual(['once', 'original']);
      expect(replay.tuple.idempotencyKey).toBe('durable-key');
      expect(tuplesA.rd(['once'], { harbor: 'fleet' })).toEqual([
        expect.objectContaining({ id: first.tuple.id, idempotencyKey: null }),
      ]);
      expect(notified).toEqual([first.tuple.id]);
    } finally {
      dbA.close();
      dbB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('keeps internal authority rows exact-key-only across every generic public surface', () => {
    const notified = [];
    tuples.subscribe(['parley:auto:lineage'], undefined, (tuple) => notified.push(tuple.id));
    const authority = tuples.outOnce(
      ['parley:auto:lineage', 'lineage-1', 'signal-1', Date.now()],
      {
        harbor: ' fleet ',
        idempotencyKey: 'parley:auto:lineage:lineage-1',
        internalOnly: true,
      },
    );

    expect(authority.inserted).toBe(true);
    expect(authority.tuple.idempotencyKey).toBe('parley:auto:lineage:lineage-1');
    expect(notified).toEqual([]);
    expect(tuples.rd(['parley:auto:lineage'], { harbor: 'fleet' })).toEqual([]);
    expect(tuples.poll(['parley:auto:lineage'], { harbor: 'fleet' }).tuple).toBeNull();
    expect(tuples.scan('fleet')).toEqual([]);
    expect(tuples.count(undefined, 'fleet')).toBe(0);
    expect(tuples.take(['parley:auto:lineage'], { harbor: 'fleet' })).toEqual([]);
    expect(tuples.getByIdempotencyKey('parley:auto:lineage:lineage-1', { harbor: 'fleet' }))
      .toEqual(authority.tuple);
  });

  test('redacts reservation keys from generic reads, polls, scans, and takes', () => {
    const written = tuples.outOnce(['visible', 'payload'], {
      harbor: 'fleet',
      idempotencyKey: 'visible-delivery-key',
    });

    expect(written.tuple.idempotencyKey).toBe('visible-delivery-key');
    expect(tuples.rd(['visible'], { harbor: 'fleet' })[0].idempotencyKey).toBeNull();
    expect(tuples.poll(['visible'], { harbor: 'fleet' }).tuple.idempotencyKey).toBeNull();
    expect(tuples.scan('fleet')[0].idempotencyKey).toBeNull();
    expect(tuples.take(['visible'], { harbor: 'fleet' })[0].idempotencyKey).toBeNull();
    expect(tuples.getByIdempotencyKey('visible-delivery-key', { harbor: 'fleet' })).toBeNull();
  });

  test('isolates the same key by canonical harbor', () => {
    const a = tuples.outOnce(['value', 'a'], { harbor: 'harbor-a', idempotencyKey: 'same' });
    const b = tuples.outOnce(['value', 'b'], { harbor: 'harbor-b', idempotencyKey: 'same' });
    const normalizedA = tuples.outOnce(['value', 'ignored'], {
      harbor: ' harbor-a ',
      idempotencyKey: 'same',
    });

    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(true);
    expect(normalizedA.inserted).toBe(false);
    expect(normalizedA.tuple.id).toBe(a.tuple.id);
    expect(b.tuple.id).not.toBe(a.tuple.id);
  });

  test('round-trips canonical whitespace and null harbors through every query API', () => {
    const notified = [];
    tuples.subscribe(['scope'], { harbor: '   ' }, (tuple) => notified.push(tuple.fields[1]));
    const implicitNull = tuples.out(['scope', 'implicit-null']);
    const whitespaceNull = tuples.out(['scope', 'whitespace-null'], { harbor: '   ' });
    const named = tuples.out(['scope', 'named'], { harbor: ' fleet ' });

    expect(implicitNull.harbor).toBeNull();
    expect(whitespaceNull.harbor).toBeNull();
    expect(named.harbor).toBe('fleet');
    expect(tuples.rd(['scope'], { harbor: ' ' }).map((tuple) => tuple.fields[1]).sort()).toEqual([
      'implicit-null',
      'whitespace-null',
    ]);
    expect(tuples.poll(['scope'], { harbor: ' ' }).tuple.harbor).toBeNull();
    expect(tuples.scan(' ')).toHaveLength(2);
    expect(tuples.count(undefined, ' ')).toBe(2);
    expect(tuples.scan()).toHaveLength(3);
    expect(notified).toEqual(['implicit-null', 'whitespace-null']);
  });

  test('cleans an expired reservation before reusing its key', () => {
    const first = tuples.outOnce(['lease', 'old'], { idempotencyKey: 'lease', ttlMs: 60_000 });
    db.prepare('UPDATE tuples SET expires_at = ? WHERE id = ?').run(Date.now() - 1, first.tuple.id);

    const reused = tuples.outOnce(['lease', 'new'], { idempotencyKey: 'lease' });

    expect(reused.inserted).toBe(true);
    expect(reused.tuple.id).not.toBe(first.tuple.id);
    expect(reused.tuple.fields).toEqual(['lease', 'new']);
    expect(tuples.rd(['lease'])).toHaveLength(1);
  });

  test('reads and compare-deletes reservations through the harbor-key index', () => {
    const first = tuples.outOnce(['owner', 'a'], {
      harbor: ' fleet ',
      idempotencyKey: ' owner-key ',
    });

    expect(tuples.getByIdempotencyKey('owner-key', { harbor: 'fleet' })).toEqual(first.tuple);
    expect(tuples.takeByIdempotencyKey('owner-key', {
      harbor: 'fleet',
      expectedTupleId: first.tuple.id + 1,
    })).toBeNull();
    expect(tuples.getByIdempotencyKey('owner-key', { harbor: ' fleet ' })).toEqual(first.tuple);
    expect(tuples.takeByIdempotencyKey(' owner-key ', {
      harbor: 'fleet',
      expectedTupleId: first.tuple.id,
    })).toEqual(first.tuple);
    expect(tuples.getByIdempotencyKey('owner-key', { harbor: 'fleet' })).toBeNull();
  });

  test('uses the unique harbor-key index for keyed reads', () => {
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM tuples
      WHERE COALESCE(harbor, '') = ?
        AND idempotency_key = ?
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1
    `).all('fleet', 'key', Date.now());

    expect(plan.map((row) => row.detail).join(' ')).toMatch(/idx_tuples_harbor_idempotency/);
  });

  test('rejects empty and over-limit keys without truncating', () => {
    expect(() => tuples.outOnce(['x'], { idempotencyKey: ' ' })).toThrow(/required/);
    expect(() => tuples.outOnce(['x'], {
      idempotencyKey: 'k'.repeat(MAX_TUPLE_IDEMPOTENCY_KEY_CHARS + 1),
    })).toThrow(/exceeds/);
    expect(tuples.count()).toBe(0);
  });

  test('migrates an existing tuples schema and installs the unique expression index', () => {
    const legacyDb = createTestDb();
    try {
      legacyDb.exec(`
        CREATE TABLE tuples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          harbor TEXT,
          fields TEXT NOT NULL,
          written_by TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER
        )
      `);
      legacyDb.prepare(`
        INSERT INTO tuples (harbor, fields, written_by, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('legacy', JSON.stringify(['legacy']), null, Date.now(), null);

      const migrated = createTupleSpace(legacyDb);
      const columns = legacyDb.prepare('PRAGMA table_info(tuples)').all().map((column) => column.name);
      const indexes = legacyDb.prepare('PRAGMA index_list(tuples)').all().map((index) => index.name);
      const reservation = migrated.outOnce(['new'], {
        harbor: 'legacy',
        idempotencyKey: 'migration-key',
      });

      expect(columns).toContain('idempotency_key');
      expect(columns).toContain('internal_only');
      expect(indexes).toContain('idx_tuples_harbor_idempotency');
      expect(reservation.inserted).toBe(true);
      expect(migrated.rd(['legacy'], { harbor: 'legacy' })).toHaveLength(1);
    } finally {
      legacyDb.close();
    }
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
