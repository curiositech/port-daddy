import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createAgentRunReceiptStore } from '../../lib/agent-run-receipts.ts';

describe('Numeric validation boundary cases', () => {
  test('Rejects very large budgetUsd and string inputs', () => {
    const db = new Database(':memory:');
    const store = createAgentRunReceiptStore(db, { now: () => Date.now(), verifyProcessAlive: () => true });

    expect(() => store.accept({
      idempotencyKey: 'large-budget',
      kind: 'spawn',
      request: { a: 1 },
      budgetUsd: 1e308
    })).toThrow(/budgetUsd/);

    expect(() => store.accept({
      idempotencyKey: 'string-budget',
      kind: 'spawn',
      request: { a: 1 },
      budgetUsd: '100.50'
    })).toThrow(/budgetUsd/);
  });
});