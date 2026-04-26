import Database from 'better-sqlite3';
import { createTupleSpace } from '../../lib/tuples.js';

describe('tuple delivery', () => {
  let db;
  let tuples;

  beforeEach(() => {
    db = new Database(':memory:');
    tuples = createTupleSpace(db);
  });

  afterEach(() => {
    tuples.destroy?.();
    db.close();
  });

  test('poll returns the first matching tuple and advances the cursor', () => {
    const ignored = tuples.out(['noise', 'not-for-qa'], { harbor: 'fleet-harbor' });
    const expected = tuples.out(['task', 'qa'], { harbor: 'fleet-harbor' });

    const first = tuples.poll(['task', '*'], {
      harbor: 'fleet-harbor',
      afterId: 0,
    });

    expect(first.tuple?.id).toBe(expected.id);
    expect(first.tuple?.fields).toEqual(['task', 'qa']);
    expect(first.lastId).toBe(expected.id);

    const second = tuples.poll(['task', '*'], {
      harbor: 'fleet-harbor',
      afterId: first.lastId,
    });

    expect(second.tuple).toBeNull();
    expect(second.lastId).toBe(first.lastId);
    expect(ignored.id).toBeLessThan(expected.id);
  });

  test('subscribe only notifies matching tuple writes in the same harbor', () => {
    const received = [];
    const unsubscribe = tuples.subscribe(['task', '*'], { harbor: 'fleet-harbor' }, (tuple) => {
      received.push(tuple.fields);
    });

    tuples.out(['task', 'qa'], { harbor: 'fleet-harbor' });
    tuples.out(['task', 'other'], { harbor: 'other-harbor' });
    tuples.out(['noise', 'qa'], { harbor: 'fleet-harbor' });

    expect(received).toEqual([
      ['task', 'qa'],
    ]);

    unsubscribe();
    tuples.out(['task', 'after-unsubscribe'], { harbor: 'fleet-harbor' });
    expect(received).toEqual([
      ['task', 'qa'],
    ]);
  });
});
