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

  test('canonical requests follow JSON semantics for optional fields and arrays', () => {
    const first = store.accept({
      idempotencyKey: 'json-semantics-key',
      kind: 'spawn',
      request: {
        task: 'inspect',
        optional: undefined,
        ignored: () => 'not JSON',
        args: [1, undefined, 3],
      },
    });
    const replay = store.accept({
      idempotencyKey: 'json-semantics-key',
      kind: 'spawn',
      request: { args: [1, null, 3], task: 'inspect' },
    });

    expect(replay.replayed).toBe(true);
    expect(replay.receipt.id).toBe(first.receipt.id);
  });

  test('a non-JSON root request fails closed before hashing', () => {
    expect(() => store.accept({
      idempotencyKey: 'non-json-root',
      kind: 'spawn',
      request: undefined,
    })).toThrow('agent run receipt payload must be JSON serializable');
  });

  test('same key with a different request fails closed', () => {
    const first = store.accept({
      idempotencyKey: 'drift-key',
      kind: 'spawn',
      request: { backend: 'cli:codex', task: 'one' },
    });

    let conflict;
    try {
      store.accept({
        idempotencyKey: 'drift-key',
        kind: 'spawn',
        request: { backend: 'cli:codex', task: 'two' },
      });
    } catch (err) {
      conflict = err;
    }
    expect(conflict).toBeInstanceOf(AgentRunIdempotencyConflictError);
    expect(conflict.receiptId).toBe(first.receipt.id);
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

  test('repeated sequential accepts produce one owner and one row', () => {
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

  test('rejected starting and terminal transitions fail loudly', () => {
    const receipt = store.accept({
      idempotencyKey: 'transition-key',
      kind: 'spawn',
      request: { backend: 'cli:codex' },
    }).receipt;

    store.markStarting(receipt.id, {
      successorAgentId: 'agent-transition',
      transcriptId: 'tx-transition',
    });
    expect(() => store.markStarting(receipt.id, {
      successorAgentId: 'agent-transition',
      transcriptId: 'tx-transition',
    })).toThrow(`cannot transition agent run receipt ${receipt.id} from starting to starting`);

    store.markStatus(receipt.id, 'completed');
    expect(() => store.markStatus(receipt.id, 'failed')).toThrow(
      `cannot transition agent run receipt ${receipt.id} from completed to failed`,
    );
  });
});

describe('agent run receipt acceptance atomicity', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => db.close());

  test('accept() is one statement: fresh insert and replay each execute exactly one SQL statement', () => {
    let executions = 0;
    const countingDb = {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        const statement = db.prepare(sql);
        return {
          run: (...args) => { executions += 1; return statement.run(...args); },
          get: (...args) => { executions += 1; return statement.get(...args); },
          all: (...args) => { executions += 1; return statement.all(...args); },
        };
      },
    };
    const store = createAgentRunReceiptStore(countingDb, { now: () => 1_000, recoverNonTerminal: false });

    executions = 0;
    const first = store.accept({
      idempotencyKey: 'one-statement-key', kind: 'spawn', request: { backend: 'cli:codex' },
    });
    expect(executions).toBe(1);
    expect(first.replayed).toBe(false);

    executions = 0;
    const replay = store.accept({
      idempotencyKey: 'one-statement-key', kind: 'spawn', request: { backend: 'cli:codex' },
    });
    expect(executions).toBe(1);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
  });

  test('a storage layer that loses the RETURNING row fails closed instead of inventing a receipt', () => {
    const lossyDb = {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        const statement = db.prepare(sql);
        const swallowReturning = sql.includes('ON CONFLICT(idempotency_key_hash) DO UPDATE');
        return {
          run: (...args) => statement.run(...args),
          get: (...args) => {
            const row = statement.get(...args);
            return swallowReturning ? undefined : row;
          },
          all: (...args) => statement.all(...args),
        };
      },
    };
    const store = createAgentRunReceiptStore(lossyDb, { now: () => 1_000, recoverNonTerminal: false });

    expect(() => store.accept({
      idempotencyKey: 'lossy-readback-key', kind: 'spawn', request: { backend: 'cli:codex' },
    })).toThrow(/acceptance returned no row/);
  });

  test('N concurrent accepts of the same key yield exactly one insert and consistent receipts', async () => {
    // Each caller gets its own store instance (its own prepared statements)
    // over the same database, so nothing above the single SQL statement can
    // accidentally serialize them into correctness.
    const callers = Array.from({ length: 8 }, () => createAgentRunReceiptStore(db, {
      now: () => 1_000,
      recoverNonTerminal: false,
    }));
    const request = { backend: 'cli:codex', task: 'spawn-once', env: { A: '1', B: '2' } };

    const results = await Promise.all(callers.map((caller) => Promise.resolve().then(() => caller.accept({
      idempotencyKey: 'concurrent-accept-key',
      kind: 'spawn',
      request,
    }))));

    const winners = results.filter((result) => !result.replayed);
    expect(winners).toHaveLength(1);
    expect(new Set(results.map((result) => result.receipt.id)).size).toBe(1);
    for (const result of results) {
      expect(result.receipt).toEqual(winners[0].receipt);
      expect(result.receipt.status).toBe('accepted');
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
  });
});
