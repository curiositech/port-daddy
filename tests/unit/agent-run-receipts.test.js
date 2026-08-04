import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

const { createTestDb } = await import('../setup-unit.js');
const {
  AgentRunIdempotencyConflictError,
  createAgentRunReceiptStore,
} = await import('../../lib/agent-run-receipts.js');

describe('agent run receipt ledger', () => {
  let db;
  let now;

  beforeEach(() => {
    db = createTestDb();
    now = 1_000;
  });

  afterEach(() => db.close());

  test('exact idempotent replay returns one stable receipt', () => {
    const store = createAgentRunReceiptStore(db, { now: () => now });
    const request = { backend: 'cli:codex', task: 'inspect', env: { B: '2', A: '1' } };
    const first = store.accept({ idempotencyKey: 'same-key', kind: 'spawn', request });
    const replay = store.accept({
      idempotencyKey: 'same-key',
      kind: 'spawn',
      request: { task: 'inspect', env: { A: '1', B: '2' }, backend: 'cli:codex' },
    });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.id).toBe(first.receipt.id);
    expect(replay.receipt.requestHash).toBe(first.receipt.requestHash);
  });

  test('same key with request drift conflicts without launching another run', () => {
    const store = createAgentRunReceiptStore(db, { now: () => now });
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
  });

  test('restart recovery labels nonterminal receipts unknown without inventing failure', () => {
    const firstGeneration = createAgentRunReceiptStore(db, { now: () => now });
    const accepted = firstGeneration.accept({
      idempotencyKey: 'restart-key',
      kind: 'session-continuation',
      predecessorSessionId: 'session-old',
      request: { purpose: 'continue safely' },
    }).receipt;
    firstGeneration.markStarting(accepted.id, {
      successorAgentId: 'spawned-new',
      successorSessionId: 'session-new',
      transcriptId: 'tx-new',
    });

    now = 2_000;
    const restarted = createAgentRunReceiptStore(db, { now: () => now });
    expect(restarted.get(accepted.id)).toEqual(expect.objectContaining({
      status: 'unknown',
      successorAgentId: 'spawned-new',
      successorSessionId: 'session-new',
      completedAt: null,
      error: expect.stringMatching(/outcome is unknown/i),
    }));
  });
});
