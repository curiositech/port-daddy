const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const { createAgentRunReceiptStore, AgentRunReceiptNotFoundError, AgentRunIdempotencyConflictError } = require('../../lib/agent-run-receipts');
const { freshDb } = require('./test-utils');

describe('Concurrent idempotency handling', () => {
  let db;
  before(() => {
    db = freshDb();
  });

  it('should allow only one insert with same idempotency key', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'concurrent-test';
    
    const p1 = store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    const p2 = store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 2 } });
    
    const [r1, r2] = await Promise.all([p1, p2]);
    
    expect(r1.receipt.idempotency_key_hash).to.equal(key);
    expect(r2.receipt.idempotency_key_hash).to.equal(key);
    expect(r1.replayed).to.be.false;
    expect(r2.replayed).to.be.true;
    expect(r1.receipt.id).to.not.equal(r2.receipt.id);
  });

  it('should return existing row on conflict with same key', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'conflict-test';
    
    const { receipt: r1 } = await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    const { receipt: r2 } = await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 2 } });
    
    expect(r2.idempotency_key_hash).to.equal(key);
    expect(r2.id).to.equal(r1.id);
    expect(r2.replayed).to.be.true;
  });
});