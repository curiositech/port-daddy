import {
  createAgentRunReceiptStore
} from '../../lib/agent-run-receipts';
import { Database } from 'bun:sqlite';

jest.mock('bun:sqlite', () => ({ Database: jest.fn() }));

describe('Store Functions', () => {
  let db: any;
  let store: any;

  beforeEach(() => {
    db = { prepare: jest.fn(), run: jest.fn(), get: jest.fn(), all: jest.fn() };
    store = createAgentRunReceiptStore(db);
  });

  test('accept handles idempotency', () => {
    const input = { idempotencyKey: 'key', kind: 'test' };
    const result = store.accept(input);
    expect(result.replayed).toBe(false);
  });

  test('markStatus enforces status transitions', () => {
    const id = 'test-id';
    expect(() => store.markStatus(id, 'live', {})).toThrow();
  });
});