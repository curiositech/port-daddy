import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

const { createTestDb } = await import('../setup-unit.js');
const {
  AgentRunIdempotencyConflictError,
  createAgentRunReceiptStore,
} = await import('../../lib/agent-run-receipts.js');

describe('agent run receipt admission', () => {
  let db;
  let store;

  beforeEach(() => {
    db = createTestDb();
    store = createAgentRunReceiptStore(db, { now: () => 1_000 });
  });

  afterEach(() => db.close());

  test('same key and canonical request replay one durable receipt', () => {
    const first = store.accept({
      idempotencyKey: 'same-key',
      kind: 'spawn',
      request: { backend: 'cli:codex', task: 'inspect', env: { B: '2', A: '1' } },
    });
    const replay = store.accept({
      idempotencyKey: 'same-key',
      kind: 'spawn',
      request: { task: 'inspect', env: { A: '1', B: '2' }, backend: 'cli:codex' },
    });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.id).toBe(first.receipt.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
  });

  test('same key with a different request fails closed', () => {
    const first = store.accept({
      idempotencyKey: 'drift-key',
      kind: 'spawn',
      request: { backend: 'cli:codex', task: 'one' },
    });

    expect(() => store.accept({
      idempotencyKey: 'drift-key',
      kind: 'spawn',
      request: { backend: 'cli:codex', task: 'two' },
    })).toThrow(expect.objectContaining({
      constructor: AgentRunIdempotencyConflictError,
      receiptId: first.receipt.id,
    }));
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
  });

  test('the database enforces idempotency when the store is bypassed', () => {
    const accepted = store.accept({
      idempotencyKey: 'db-unique-key',
      kind: 'spawn',
      request: { backend: 'cli:codex' },
    }).receipt;
    const row = db.prepare(
      'SELECT idempotency_key_hash FROM agent_run_receipts WHERE id = ?',
    ).get(accepted.id);

    expect(() => db.prepare(`
      INSERT INTO agent_run_receipts (
        id, kind, idempotency_key_hash, request_hash, status, created_at, updated_at
      ) VALUES ('run-forced-dupe', 'spawn', ?, 'forced-hash', 'accepted', 1, 1)
    `).run(row.idempotency_key_hash)).toThrow(/UNIQUE constraint failed/);
  });

  test('racing accepts produce one owner and one row', () => {
    const request = { backend: 'cli:codex', task: 'race' };
    const results = Array.from({ length: 5 }, () => store.accept({
      idempotencyKey: 'race-key',
      kind: 'spawn',
      request,
    }));

    expect(new Set(results.map((result) => result.receipt.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
  });
});
