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

  test('uses the prepared-statement API shared by better-sqlite3 and bun:sqlite', () => {
    const portableDb = {
      exec: db.exec.bind(db),
      prepare: db.prepare.bind(db),
    };
    const store = createAgentRunReceiptStore(portableDb);
    const receipt = store.accept({
      idempotencyKey: 'portable-schema-introspection',
      kind: 'spawn',
      request: { backend: 'cli:codex' },
    }).receipt;
    expect(store.get(receipt.id)).toMatchObject({ id: receipt.id, status: 'accepted' });
  });

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

  test('migrates the first receipt table in place without discarding accepted work', () => {
    db.exec(`
      CREATE TABLE agent_run_receipts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        predecessor_session_id TEXT,
        successor_session_id TEXT,
        successor_agent_id TEXT,
        transcript_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT
      )
    `);
    const store = createAgentRunReceiptStore(db, { now: () => now });
    const columns = db.pragma('table_info(agent_run_receipts)').map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining([
      'predecessor_snapshot_json',
      'budget_usd',
      'telemetry_json',
    ]));
    expect(store.accept({
      idempotencyKey: 'post-migration',
      kind: 'spawn',
      request: { task: 'continue' },
      budgetUsd: 1,
    }).receipt).toMatchObject({ budgetUsd: 1, telemetry: null });
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
      predecessor: { sessionId: 'session-old', purpose: 'Original', status: 'completed' },
      request: { purpose: 'continue safely' },
    }).receipt;
    firstGeneration.markStarting(accepted.id, {
      successorAgentId: 'spawned-new',
      successorSessionId: 'session-new',
      predecessor: { sessionId: 'session-old', purpose: 'Original', status: 'completed' },
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

  test('terminal ownership is sticky while unknown requires direct evidence to reconcile live', () => {
    const store = createAgentRunReceiptStore(db, { now: () => now });
    const cancelled = store.accept({
      idempotencyKey: 'sticky-terminal',
      kind: 'spawn',
      request: { backend: 'cli:codex', task: 'bounded' },
    }).receipt;
    store.markStatus(cancelled.id, 'cancelled', { error: 'operator cancelled' });
    expect(store.markStatus(cancelled.id, 'completed')).toMatchObject({
      status: 'cancelled',
      error: 'operator cancelled',
    });

    const unknown = store.accept({
      idempotencyKey: 'unknown-reconcile',
      kind: 'session-continuation',
      request: { predecessorId: 'session-a' },
      predecessorSessionId: 'session-a',
    }).receipt;
    store.markStatus(unknown.id, 'unknown', { error: 'restart' });
    expect(() => store.markStatus(unknown.id, 'live')).toThrow(/direct PID and fresh supervisor heartbeat/i);
    expect(() => store.markStatus(unknown.id, 'live', {
      liveEvidence: { pid: 4242, supervisorHeartbeatAt: now - 65_000 },
    })).toThrow(/direct PID and fresh supervisor heartbeat/i);
    expect(() => store.markStatus(unknown.id, 'live', {
      liveEvidence: { pid: 4242, supervisorHeartbeatAt: now + 1 },
    })).toThrow(/direct PID and fresh supervisor heartbeat/i);
    expect(store.markStatus(unknown.id, 'live', {
      liveEvidence: { pid: 4242, supervisorHeartbeatAt: now - 30_000 },
    })).toMatchObject({ status: 'live', error: null });
    expect(store.markStatus(unknown.id, 'starting')).toMatchObject({ status: 'live' });
    expect(store.markStatus(unknown.id, 'completed')).toMatchObject({
      status: 'completed',
      error: null,
    });
  });

  test('persists frozen lineage and budget while rejected terminal evidence cannot mutate accounting', () => {
    const firstGeneration = createAgentRunReceiptStore(db, { now: () => now });
    const receipt = firstGeneration.accept({
      idempotencyKey: 'durable-accounting',
      kind: 'session-continuation',
      predecessorSessionId: 'session-source',
      predecessor: { sessionId: 'session-source', purpose: 'Frozen purpose', status: 'completed' },
      budgetUsd: 3.5,
      request: { purpose: 'continue safely' },
    }).receipt;
    firstGeneration.markStarting(receipt.id, {
      successorAgentId: 'spawned-accounted',
      successorSessionId: 'session-accounted',
      transcriptId: 'tx-accounted',
    });
    firstGeneration.markStatus(receipt.id, 'cancelled', { error: 'operator cancelled' });
    now = 2_000;
    firstGeneration.markStatus(receipt.id, 'completed', {
      telemetry: {
        inputTokens: 120,
        cachedInputTokens: 80,
        outputTokens: 30,
        costUsd: 0.042,
        rateMode: 'exact',
      },
    });

    const restarted = createAgentRunReceiptStore(db, { now: () => 3_000 });
    expect(restarted.get(receipt.id)).toMatchObject({
      status: 'cancelled',
      error: 'operator cancelled',
      predecessor: { sessionId: 'session-source', purpose: 'Frozen purpose', status: 'completed' },
      budgetUsd: 3.5,
      telemetry: null,
    });
  });

  test('persists backend telemetry atomically with an accepted terminal transition', () => {
    const store = createAgentRunReceiptStore(db, { now: () => now });
    const receipt = store.accept({
      idempotencyKey: 'durable-accounting-success',
      kind: 'spawn',
      request: { backend: 'cli:codex', task: 'bounded' },
    }).receipt;
    store.markStatus(receipt.id, 'completed', {
      telemetry: {
        inputTokens: 120,
        cachedInputTokens: 80,
        outputTokens: 30,
        costUsd: 0.042,
        rateMode: 'exact',
      },
    });

    const restarted = createAgentRunReceiptStore(db, { now: () => now + 1_000 });
    expect(restarted.get(receipt.id)).toMatchObject({
      status: 'completed',
      telemetry: {
        inputTokens: 120,
        cachedInputTokens: 80,
        outputTokens: 30,
        costUsd: 0.042,
        rateMode: 'exact',
      },
    });
  });
});
