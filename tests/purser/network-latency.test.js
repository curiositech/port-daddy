import { afterEach, beforeEach, describe, expect, test, beforeAll } from '@jest/globals';

const { createTestDb } = await import('../setup-unit.js');
const {
  AgentRunReceiptNotFoundError,
  createAgentRunReceiptStore,
} = await import('../../lib/agent-run-receipts.js');

function latencyDatabase(db) {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...args) => {
          if (sql.includes('INSERT')) {
            // Simulate network latency by delaying the insert
            return new Promise(resolve => setTimeout(() => {
              statement.run(...args);
              resolve();
            }, 1000));
          }
          return statement.run(...args);
        },
        get: (...args) => {
          if (sql.includes('WHERE idempotency_key_hash = ?')) {
            // Simulate delayed read
            return new Promise(resolve => setTimeout(() => {
              resolve(undefined);
            }, 1500));
          }
          return statement.get(...args);
        },
        all: (...args) => statement.all(...args),
      };
    },
  };
}

describe('network latency handling', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => db.close());

  test('throws error under network latency conditions', async () => {
    const store = createAgentRunReceiptStore(latencyDatabase(db));
    let failure;

    try {
      await store.accept({
        idempotencyKey: 'latency-test',
        kind: 'spawn',
        request: { task: 'latency test' },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AgentRunReceiptNotFoundError);
    expect(failure.message).toMatch(/not found after insert\/conflict/);
    expect(failure.keyHash).toBe('latency-test');
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
  });
});