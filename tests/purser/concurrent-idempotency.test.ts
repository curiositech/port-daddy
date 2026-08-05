import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createAgentRunReceiptStore } from '../../lib/agent-run-receipts.ts';

describe('Concurrent idempotency key handling', () => {
  test('Multiple concurrent accepts with same key should only persist one', async () => {
    const db = new Database(':memory:');
    const store = createAgentRunReceiptStore(db, { now: () => Date.now(), verifyProcessAlive: () => true });

    const key = 'concurrent-test';
    const requests = Array(100).fill(0).map(() => ({
      idempotencyKey: key,
      kind: 'spawn',
      request: { a: 1 }
    }));

    await Promise.all(requests.map(req =>
      Promise.resolve().then(() => store.accept(req))
    ));

    const count = db.prepare('SELECT COUNT(*) FROM agent_run_receipts').get() as { COUNT: number };
    expect(count.COUNT).toBe(1);
  });
});