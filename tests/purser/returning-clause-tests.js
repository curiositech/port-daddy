const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const { createAgentRunReceiptStore, AgentRunReceiptNotFoundError, AgentRunIdempotencyConflictError } = require('../../lib/agent-run-receipts');
const { freshDb } = require('./test-utils');

describe('RETURNING clause validation', () => {
  let db;
  before(() => {
    db = freshDb();
  });

  it('should return full row with generated id on insert', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'returning-test';
    
    const { receipt, replayed } = await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    
    expect(receipt.id).to.match(/^run-[a-f0-9]{8}$/);
    expect(receipt.idempotency_key_hash).to.equal(key);
    expect(replayed).to.be.false;
  });

  it('should return existing row on conflict with same key', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'returning-conflict-test';
    
    const { receipt: r1 } = await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    const { receipt: r2, replayed } = await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 2 } });
    
    expect(r2.id).to.equal(r1.id);
    expect(r2.idempotency_key_hash).to.equal(key);
    expect(replayed).to.be.true;
  });
});