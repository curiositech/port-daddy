import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

const { createTestDb } = await import('../setup-unit.js');
const {
  AgentRunReceiptNotFoundError,
  createAgentRunReceiptStore,
} = await import('../../lib/agent-run-receipts.js');

function corruptedDataDatabase(db) {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...args) => {
          if (sql.includes('INSERT')) {
            // Insert corrupted data
            db.exec("INSERT INTO agent_run_receipts (idempotency_key_hash, kind, request_hash) VALUES ('corrupted', 'spawn', 'invalid')");
          }
          return statement.run(...args);
        },
        get: (...args) => {
          if (sql.includes('WHERE idempotency_key_hash = ?')) {
            return {
              idempotency_key_hash: 'corrupted',
              kind: 'spawn',
              request_hash: 'invalid',
            };
          }
          return statement.get(...args);
        },
        all: (...args) => statement.all(...args),
      };
    },
  };
}

describe('corrupted data handling', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => db.close());

  test('throws error when reading corrupted receipt data', () => {
    const store = createAgentRunReceiptStore(corruptedDataDatabase(db));
    let failure;

    try {
      store.accept({
        idempotencyKey: 'corrupted',
        kind: 'spawn',
        request: { task: 'corrupted data test' },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AgentRunReceiptNotFoundError);
    expect(failure.message).toMatch(/not found after insert\/conflict/);
    expect(failure.keyHash).toBe('corrupted');
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
  });
});