import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createAgentRunReceiptStore } from '../../lib/agent-run-receipts.ts';

describe('Invalid lifecycle transitions', () => {
  test("Marking receipt as 'live' without 'starting' state should fail", () => {
    const db = new Database(':memory:');
    const store = createAgentRunReceiptStore(db, { now: () => Date.now(), verifyProcessAlive: () => true });

    const receipt = store.accept({
      idempotencyKey: 'invalid-lifecycle',
      kind: 'spawn',
      request: { a: 1 }
    }).receipt;

    expect(() => store.markStatus(receipt.id, 'live', { liveEvidence: { pid: 123, supervisorHeartbeatAt: Date.now() } }))
      .toThrow(/invalid state transition/);
  });
});