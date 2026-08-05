/**
 * Bun:sqlite compatibility companion for lib/agent-run-receipts.ts.
 *
 * RUNTIME: this file MUST run under `bun test`, not jest. The store's
 * `PortableDatabase`/`PortableStatement` interfaces claim compatibility with
 * both better-sqlite3 (jest) and bun:sqlite (the compiled daemon binary),
 * but jest never actually exercises the bun:sqlite binding. This file
 * imports `bun:sqlite` directly and drives the real store implementation
 * against it -- positional parameter binding, multi-statement `exec()` DDL,
 * `PRAGMA table_info()`-driven schema migration, and `ON CONFLICT` upsert
 * semantics all have to work identically on this engine, not just on
 * better-sqlite3.
 */

import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS,
  AgentRunIdempotencyConflictError,
  createAgentRunReceiptStore,
} from '../../lib/agent-run-receipts.ts';

function freshDb(): Database {
  return new Database(':memory:');
}

describe('agent run receipt ledger under real bun:sqlite', () => {
  test('accept() creates a row, and idempotency_key_hash UNIQUE is real (ON CONFLICT DO NOTHING)', () => {
    const db = freshDb();
    let now = 1_000;
    const store = createAgentRunReceiptStore(db, { now: () => now, verifyProcessAlive: () => true });

    const request = { backend: 'cli:codex', task: 'inspect' };
    const first = store.accept({ idempotencyKey: 'bun-same-key', kind: 'spawn', request });
    const replay = store.accept({ idempotencyKey: 'bun-same-key', kind: 'spawn', request });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.id).toBe(first.receipt.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get() as { n: number }).toMatchObject({ n: 1 });

    expect(() => store.accept({ idempotencyKey: 'bun-same-key', kind: 'spawn', request: { task: 'different' } }))
      .toThrow(AgentRunIdempotencyConflictError);
  });

  test('full lifecycle: accept -> markStarting -> live (with corroborated evidence) -> completed', () => {
    const db = freshDb();
    let now = 1_000;
    const store = createAgentRunReceiptStore(db, { now: () => now, verifyProcessAlive: (pid) => pid === 4242 });

    const receipt = store.accept({
      idempotencyKey: 'bun-lifecycle',
      kind: 'session-continuation',
      predecessorSessionId: 'session-source',
      predecessor: { sessionId: 'session-source', purpose: 'bun test', status: 'completed' },
      budgetUsd: 2.5,
      request: { purpose: 'bun lifecycle' },
    }).receipt;

    const started = store.markStarting(receipt.id, { successorAgentId: 'spawned-bun', transcriptId: 'tx-bun' });
    expect(started.status).toBe('starting');

    now = 2_000;
    const live = store.markStatus(receipt.id, 'live', {
      liveEvidence: { pid: 4242, supervisorHeartbeatAt: now - 10 },
    });
    expect(live.status).toBe('live');

    now = 3_000;
    const completed = store.markStatus(receipt.id, 'completed', {
      telemetry: { inputTokens: 10, outputTokens: 5, costUsd: 0.02, rateMode: 'exact' },
    });
    expect(completed).toMatchObject({
      status: 'completed',
      budgetUsd: 2.5,
      predecessor: { sessionId: 'session-source', purpose: 'bun test', status: 'completed' },
      telemetry: { inputTokens: 10, outputTokens: 5, costUsd: 0.02, rateMode: 'exact' },
    });
  });

  test('a forged pid is rejected even with an in-window heartbeat, under the default real verifier', () => {
    const db = freshDb();
    const now = 1_000;
    // No verifyProcessAlive override -- exercises the real process.kill(pid, 0) check.
    const store = createAgentRunReceiptStore(db, { now: () => now });
    const receipt = store.accept({ idempotencyKey: 'bun-forged-pid', kind: 'spawn', request: { a: 1 } }).receipt;
    store.markStatus(receipt.id, 'unknown', { error: 'restart' });

    expect(() => store.markStatus(receipt.id, 'live', {
      liveEvidence: { pid: 2_147_483_647, supervisorHeartbeatAt: now - 10 },
    })).toThrow(/real process check/i);

    const reconciled = store.markStatus(receipt.id, 'live', {
      liveEvidence: { pid: process.pid, supervisorHeartbeatAt: now - 10 },
    });
    expect(reconciled.status).toBe('live');
  });

  test('restart reconciliation flips accepted/starting/live to unknown, never touches terminal rows', () => {
    const db = freshDb();
    let now = 1_000;
    const firstGeneration = createAgentRunReceiptStore(db, { now: () => now, verifyProcessAlive: () => true });

    const accepted = firstGeneration.accept({ idempotencyKey: 'bun-stays-accepted', kind: 'spawn', request: { a: 1 } }).receipt;
    const done = firstGeneration.accept({ idempotencyKey: 'bun-stays-done', kind: 'spawn', request: { a: 2 } }).receipt;
    firstGeneration.markStatus(done.id, 'completed', { error: null });

    now = 5_000;
    const restarted = createAgentRunReceiptStore(db, { now: () => now });

    expect(restarted.get(accepted.id)).toMatchObject({ status: 'unknown' });
    expect(restarted.get(done.id)).toMatchObject({ status: 'completed', error: null });
  });

  test('rejects NaN/Infinity/negative budgetUsd and telemetry fields rather than silently storing null', () => {
    const db = freshDb();
    const store = createAgentRunReceiptStore(db, { now: () => 1_000, verifyProcessAlive: () => true });

    expect(() => store.accept({ idempotencyKey: 'bun-bad-budget', kind: 'spawn', request: {}, budgetUsd: NaN }))
      .toThrow(/budgetUsd/);
    expect(() => store.accept({ idempotencyKey: 'bun-bad-budget-2', kind: 'spawn', request: {}, budgetUsd: -1 }))
      .toThrow(/budgetUsd/);

    const receipt = store.accept({ idempotencyKey: 'bun-bad-telemetry', kind: 'spawn', request: {} }).receipt;
    expect(() => store.markStatus(receipt.id, 'completed', {
      telemetry: { inputTokens: Infinity, outputTokens: 1, costUsd: 0.01, rateMode: 'exact' },
    })).toThrow(/telemetry\.inputTokens/);
  });

  test('additively migrates a pre-existing narrower agent_run_receipts table under bun:sqlite, retaining data', () => {
    const db = freshDb();
    // Simulate an earlier, narrower revision's table shape, written before
    // this store's full schema existed.
    db.exec(`
      CREATE TABLE agent_run_receipts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO agent_run_receipts (id, kind, idempotency_key, status, created_at, updated_at)
      VALUES ('run-bun-legacy', 'spawn', 'legacy', 'completed', 100, 100)
    `).run();

    // Construction must not throw "no such column" against the narrower table.
    const store = createAgentRunReceiptStore(db, { now: () => 9_000, verifyProcessAlive: () => true });

    const legacyReceipt = store.get('run-bun-legacy');
    expect(legacyReceipt).toMatchObject({ id: 'run-bun-legacy', status: 'completed', budgetUsd: null, telemetry: null });
    expect(legacyReceipt?.requestHash).toMatch(/^[a-f0-9]{64}$/);

    expect(() => db.prepare(`
      INSERT INTO agent_run_receipts (
        id, kind, idempotency_key, status, created_at, updated_at
      ) VALUES ('run-bun-null-hashes', 'spawn', 'legacy-2', 'accepted', 200, 200)
    `).run()).toThrow(/hashes are required/i);

    const fresh = store.accept({ idempotencyKey: 'bun-post-migration', kind: 'spawn', request: { a: 1 } });
    expect(fresh.replayed).toBe(false);
  });

  test(`live evidence older than AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS (${AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS}ms) is rejected`, () => {
    const db = freshDb();
    const now = 100_000;
    const store = createAgentRunReceiptStore(db, { now: () => now, verifyProcessAlive: () => true });
    const receipt = store.accept({ idempotencyKey: 'bun-stale-heartbeat', kind: 'spawn', request: {} }).receipt;
    store.markStatus(receipt.id, 'unknown', { error: 'restart' });

    expect(() => store.markStatus(receipt.id, 'live', {
      liveEvidence: { pid: 1, supervisorHeartbeatAt: now - AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS - 1 },
    })).toThrow(/fresh supervisor heartbeat/i);
  });
});
