const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const { createAgentRunReceiptStore, AgentRunReceiptNotFoundError, AgentRunIdempotencyConflictError } = require('../../lib/agent-run-receipts');
const { freshDb } = require('./test-utils');

describe('Unique constraint enforcement', () => {
  let db;
  before(() => {
    db = freshDb();
  });

  it('should prevent duplicate inserts via unique constraint', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'unique-test';
    
    await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    
    try {
      await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 2 } });
      expect.fail('Expected unique constraint violation');
    } catch (err) {
      expect(err).to.be.instanceOf(AgentRunIdempotencyConflictError);
    }
  });

  it('should enforce unique constraint at database level', async () => {
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const key = 'db-level-test';
    
    await store.accept({ idempotencyKey: key, kind: 'spawn', request: { a: 1 } });
    
    try {
      db.run('INSERT INTO agent_run_receipts (idempotency_key_hash, kind, request_hash) VALUES (?, ?, ?)',
        [key, 'spawn', 'different-hash']);
      expect.fail('Expected unique constraint violation');
    } catch (err) {
      expect(err).to.include.keys('code', 'message');
      expect(err.code).to.equal('SQLITE_CONSTRAINT');
    }
  });
});