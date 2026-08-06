const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const { createAgentRunReceiptStore, AgentRunReceiptNotFoundError, AgentRunIdempotencyConflictError } = require('../../lib/agent-run-receipts');
const { freshDb } = require('./test-utils');

describe('Status transition validation', () => {
  let db;
  before(() => {
    db = freshDb();
  });

  it('should prevent terminal state transitions from accepted', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'status-test';
    
    const { receipt: r1 } = await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    
    const terminalStates = ['completed', 'failed', 'cancelled', 'over_budget'];
    for (const state of terminalStates) {
      const result = store.markStatus(r1.id, state, { error: null });
      expect(result.status).to.equal('accepted');
      expect(result.completedAt).to.be.null;
    }
  });

  it('should allow no_runtime transition from accepted', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'no-runtime-test';
    
    const { receipt: r1 } = await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    
    const result = store.markStatus(r1.id, 'no_runtime', { error: 'admission refused' });
    expect(result.status).to.equal('no_runtime');
    expect(result.completedAt).to.not.be.null;
  });
});