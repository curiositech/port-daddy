import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

const { createTestDb } = await import('../setup-unit.js');
const {
  AgentRunReceiptNotFoundError,
  createAgentRunReceiptStore,
} = await import('../../lib/agent-run-receipts.js');

function concurrentDeletionDatabase(db) {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...args) => {
          if (sql.includes('INSERT')) {
            // Simulate concurrent deletion after insert
            db.exec('DELETE FROM agent_run_receipts');
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

describe('concurrent deletion integrity', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => db.close());

  test('throws error when receipt is deleted concurrently after insertion', () => {
    const store = createAgentRunReceiptStore(concurrentDeletionDatabase(db));
    let failure;

    try {
      store.accept({
        idempotencyKey: 'concurrent-delete',
        kind: 'spawn',
        request: { task: 'ensure persistence' },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AgentRunReceiptNotFoundError);
    expect(failure.message).toMatch(/not found after insert\/conflict/);
    expect(failure.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
  });
});