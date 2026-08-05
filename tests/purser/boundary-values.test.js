import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

const { createTestDb } = await import('../setup-unit.js');
const {
  AgentRunReceiptNotFoundError,
  createAgentRunReceiptStore,
} = await import('../../lib/agent-run-receipts.js');

function boundaryValueDatabase(db) {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...args) => {
          if (sql.includes('INSERT')) {
            // Force invalid key hash length
            const [_, keyHash] = args;
            if (keyHash.length !== 64) {
              throw new Error('Invalid key hash length');
            }
          }
          return statement.run(...args);
        },
        get: (...args) => {
          if (sql.includes('WHERE idempotency_key_hash = ?')) {
            return undefined;
          }
          return statement.get(...args);
        },
        all: (...args) => statement.all(...args),
      };
    },
  };
}

describe('boundary value handling', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => db.close());

  test('handles extreme idempotency key lengths', () => {
    const store = createAgentRunReceiptStore(boundaryValueDatabase(db));
    let failure;

    // Test 64-character hash (valid)
    try {
      store.accept({
        idempotencyKey: 'a'.repeat(64),
        kind: 'spawn',
        request: { task: 'valid hash' },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeUndefined();

    // Test 63-character hash (invalid)
    try {
      store.accept({
        idempotencyKey: 'a'.repeat(63),
        kind: 'spawn',
        request: { task: 'invalid hash' },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AgentRunReceiptNotFoundError);
    expect(failure.keyHash).toBe('a'.repeat(63));
  });
});