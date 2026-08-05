import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

const { createTestDb } = await import('../setup-unit.js');
const {
  AgentRunReceiptNotFoundError,
  createAgentRunReceiptStore,
} = await import('../../lib/agent-run-receipts.js');

function missingReadbackDatabase(db) {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...args) => statement.run(...args),
        get: (...args) => {
          const row = statement.get(...args);
          return sql.includes('ON CONFLICT(idempotency_key_hash) DO UPDATE')
            ? undefined
            : row;
        },
        all: (...args) => statement.all(...args),
      };
    },
  };
}

describe('agent run receipt readback integrity', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => db.close());

  test('throws a typed integrity error when atomic acceptance cannot be read back', () => {
    const store = createAgentRunReceiptStore(missingReadbackDatabase(db));
    let failure;

    try {
      store.accept({
        idempotencyKey: 'missing-readback',
        kind: 'spawn',
        request: { task: 'must not become a TypeError' },
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
