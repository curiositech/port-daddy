import { afterEach, beforeEach, describe, expect, test, beforeAll } from '@jest/globals';

const { createTestDb } = await import('../setup-unit.js');
const {
  AgentRunReceiptNotFoundError,
  createAgentRunReceiptStore,
} = await import('../../lib/agent-run-receipts.js');

function concurrentDatabase(db) {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...args) => {
          if (sql.includes('INSERT')) {
            // Simulate concurrent writes
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

describe('concurrent acceptance handling', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => db.close());

  test('fails closed under high concurrency', () => {
    const store = createAgentRunReceiptStore(concurrentDatabase(db));
    const key = 'concurrent-key';
    const requests = Array(100).fill(null).map((_, i) => ({
      idempotencyKey: `${key}-${i}`,
      kind: 'spawn',
      request: { task: `concurrent-${i}` },
    }));

    const errors = [];
    requests.forEach((request) => {
      try {
        store.accept(request);
      } catch (error) {
        errors.push(error);
      }
    });

    expect(errors.length).toBeGreaterThan(0);
    errors.forEach((error) => {
      expect(error).toBeInstanceOf(AgentRunReceiptNotFoundError);
      expect(error.keyHash).toMatch(/^[a-f0-9]{64}$/);
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(requests.length);
  });
});