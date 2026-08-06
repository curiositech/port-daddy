const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const { createAgentRunReceiptStore, AgentRunReceiptNotFoundError, AgentRunIdempotencyConflictError } = require('../../lib/agent-run-receipts');
const { freshDb } = require('./test-utils');

describe('Transaction isolation validation', () => {
  let db;
  before(() => {
    db = freshDb();
  });

  it('should prevent race conditions with same idempotency key', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'transaction-test';
    
    const p1 = store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    const p2 = store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 2 } });
    
    const [r1, r2] = await Promise.all([p1, p2]);
    
    expect(r1.receipt.idempotency_key_hash).to.equal(key);
    expect(r2.receipt.idempotency_key_hash).to.equal(key);
    expect(r1.replayed).to.be.false;
    expect(r2.replayed).to.be.true;
    expect(r1.receipt.id).to.not.equal(r2.receipt.id);
  });

  it('should maintain consistency during concurrent updates', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'concurrent-update-test';
    
    const { receipt: r1 } = await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    
    const p1 = store.markStatus(r1.id, 'completed', { error: null });
    const p2 = store.markStatus(r1.id, 'failed', { error: 'test' });
    
    const [r2, r3] = await Promise.all([p1, p2]);
    
    expect(r2.status).to.equal('completed');
    expect(r3.status).to.equal('completed');
    expect(r3.error).to.be.null;
  });
});