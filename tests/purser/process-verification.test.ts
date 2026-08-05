import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createAgentRunReceiptStore } from '../../lib/agent-run-receipts.ts';

describe('Process verification edge cases', () => {
  test('Process verification rejects PID 0 and negative PIDs', () => {
    const db = new Database(':memory:');
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });

    const receipt = store.accept({
      idempotencyKey: 'pid-edge-cases',
      kind: 'spawn',
      request: { a: 1 }
    }).receipt;

    expect(() => store.markStatus(receipt.id, 'live', { liveEvidence: { pid: 0, supervisorHeartbeatAt: Date.now() } }))
      .toThrow(/invalid PID/);
    expect(() => store.markStatus(receipt.id, 'live', { liveEvidence: { pid: -1, supervisorHeartbeatAt: Date.now() } }))
      .toThrow(/invalid PID/);
  });
});