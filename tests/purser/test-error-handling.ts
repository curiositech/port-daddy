import {
  AgentRunIdempotencyConflictError,
  AgentRunReceiptNotFoundError
} from '../../lib/agent-run-receipts';

describe('Error Classes', () => {
  test('AgentRunIdempotencyConflictError has correct message', () => {
    const error = new AgentRunIdempotencyConflictError('test-key');
    expect(error.message).toBe('idempotency key conflict: test-key');
  });

  test('AgentRunReceiptNotFoundError has correct message', () => {
    const error = new AgentRunReceiptNotFoundError('test-hash');
    expect(error.message).toBe('agent run receipt not found after insert/conflict');
  });
});