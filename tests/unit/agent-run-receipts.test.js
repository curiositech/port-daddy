import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const { createTestDb } = await import('../setup-unit.js');
const {
  AGENT_RUN_LIST_MAX_LIMIT,
  AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS,
  createAgentRunReceiptStore,
} = await import('../../lib/agent-run-receipts.js');

// ~/coding/tmp, never /tmp (macOS purges /tmp).
const ALLOWED_TMP_ROOT = resolve(homedir(), 'coding', 'tmp');
const TMP_BASE = resolve(process.env.PD_TEST_SCRATCH || ALLOWED_TMP_ROOT);
if (TMP_BASE !== ALLOWED_TMP_ROOT && !TMP_BASE.startsWith(`${ALLOWED_TMP_ROOT}${sep}`)) {
  throw new Error(`PD_TEST_SCRATCH must stay under ${ALLOWED_TMP_ROOT}`);
}

describe('agent run receipt ledger', () => {
  let db;
  let now;

  beforeEach(() => {
    db = createTestDb();
    now = 1_000;
  });

  afterEach(() => db.close());

  describe('restart reconciliation', () => {
    test('startup flips accepted/starting/live to unknown without inventing failure', () => {
      const firstGeneration = createAgentRunReceiptStore(db, { now: () => now });
      const accepted = firstGeneration.accept({
        idempotencyKey: 'stays-accepted', kind: 'spawn', request: { a: 1 },
      }).receipt;
      const starting = firstGeneration.accept({
        idempotencyKey: 'goes-starting', kind: 'spawn', request: { a: 2 },
      }).receipt;
      firstGeneration.markStarting(starting.id, {
        successorAgentId: 'spawned-1', transcriptId: 'tx-1',
      });
      const live = firstGeneration.accept({
        idempotencyKey: 'goes-live', kind: 'spawn', request: { a: 3 },
      }).receipt;
      firstGeneration.markStarting(live.id, { successorAgentId: 'spawned-2', transcriptId: 'tx-2' });
      firstGeneration.markStatus(live.id, 'live', { liveEvidence: { pid: 111, supervisorHeartbeatAt: now - 10 } });
      const done = firstGeneration.accept({
        idempotencyKey: 'stays-done', kind: 'spawn', request: { a: 4 },
      }).receipt;
      firstGeneration.markStatus(done.id, 'completed', { error: null });

      now = 5_000;
      const restarted = createAgentRunReceiptStore(db, { now: () => now });

      for (const id of [accepted.id, starting.id, live.id]) {
        const receipt = restarted.get(id);
        expect(receipt.status).toBe('unknown');
        expect(receipt.completedAt).toBeNull();
        expect(receipt.error).toMatch(/outcome is unknown/i);
      }
      // Terminal receipts are never touched by restart reconciliation.
      expect(restarted.get(done.id)).toMatchObject({ status: 'completed', error: null });
    });

    test('unknown only advances to live, and only with a fresh direct PID + heartbeat', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const receipt = store.accept({
        idempotencyKey: 'reconcile-key', kind: 'session-continuation', request: { p: 'x' }, predecessorSessionId: 's-1',
      }).receipt;
      store.markStatus(receipt.id, 'unknown', { error: 'restart' });

      expect(() => store.markStatus(receipt.id, 'live')).toThrow(/direct PID and fresh supervisor heartbeat/i);
      expect(() => store.markStatus(receipt.id, 'live', {
        liveEvidence: { pid: 42, supervisorHeartbeatAt: now - AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS },
      })).toThrow(/direct PID and fresh supervisor heartbeat/i);
      expect(() => store.markStatus(receipt.id, 'live', {
        liveEvidence: { pid: 42, supervisorHeartbeatAt: now + 1 },
      })).toThrow(/direct PID and fresh supervisor heartbeat/i);
      expect(() => store.markStatus(receipt.id, 'live', {
        liveEvidence: { pid: 0, supervisorHeartbeatAt: now - 10 },
      })).toThrow(/direct PID and fresh supervisor heartbeat/i);

      // Still unknown after every rejected reconciliation attempt.
      expect(store.get(receipt.id)).toMatchObject({ status: 'unknown', error: 'restart' });

      const reconciled = store.markStatus(receipt.id, 'live', {
        liveEvidence: {
          pid: 4242,
          supervisorHeartbeatAt: now - (AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS - 1),
        },
      });
      expect(reconciled).toMatchObject({ status: 'live', error: null });
    });

    test('direct unknown -> completed does not mutate the receipt', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const receipt = store.accept({
        idempotencyKey: 'lost-liveness', kind: 'spawn', request: { a: 1 },
      }).receipt;
      store.markStatus(receipt.id, 'unknown', { error: 'restart' });

      expect(() => store.markStatus(receipt.id, 'completed', {
        telemetry: { inputTokens: 1, outputTokens: 1, costUsd: 0.01, rateMode: 'exact' },
      })).toThrow(/cannot transition agent run receipt .* from unknown to completed/i);

      expect(store.get(receipt.id)).toMatchObject({ status: 'unknown', error: 'restart', completedAt: null, telemetry: null });
      expect(db.prepare('SELECT status, completed_at FROM agent_run_receipts WHERE id = ?').get(receipt.id)).toMatchObject({
        status: 'unknown', completed_at: null,
      });

      // Only after explicit reconciliation to live does completed take effect.
      store.markStatus(receipt.id, 'live', { liveEvidence: { pid: 99, supervisorHeartbeatAt: now - 5 } });
      const completed = store.markStatus(receipt.id, 'completed', { error: null });
      expect(completed.status).toBe('completed');
    });

    test('terminal statuses are sticky against any further transition', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const receipt = store.accept({
        idempotencyKey: 'sticky-terminal', kind: 'spawn', request: { a: 1 },
      }).receipt;
      store.markStatus(receipt.id, 'cancelled', { error: 'operator cancelled' });
      expect(() => store.markStatus(receipt.id, 'completed')).toThrow(
        /cannot transition agent run receipt .* from cancelled to completed/i,
      );
      expect(() => store.markStatus(receipt.id, 'unknown')).toThrow(
        /cannot transition agent run receipt .* from cancelled to unknown/i,
      );
      expect(store.get(receipt.id)).toMatchObject({ status: 'cancelled', error: 'operator cancelled' });
    });
  });

  describe('predecessor / successor / transcript / budget / telemetry fields', () => {
    test('round-trips lineage, budget, and telemetry across a full lifecycle', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const receipt = store.accept({
        idempotencyKey: 'lifecycle-key',
        kind: 'session-continuation',
        predecessorSessionId: 'session-source',
        predecessor: { sessionId: 'session-source', purpose: 'Original purpose', status: 'completed' },
        budgetUsd: 3.5,
        request: { purpose: 'continue safely' },
      }).receipt;
      expect(receipt).toMatchObject({
        predecessorSessionId: 'session-source',
        predecessor: { sessionId: 'session-source', purpose: 'Original purpose', status: 'completed' },
        budgetUsd: 3.5,
        successorSessionId: null,
        successorAgentId: null,
        transcriptId: null,
      });

      const started = store.markStarting(receipt.id, {
        successorAgentId: 'spawned-accounted',
        successorSessionId: 'session-accounted',
        transcriptId: 'tx-accounted',
      });
      expect(started).toMatchObject({
        status: 'starting',
        successorAgentId: 'spawned-accounted',
        successorSessionId: 'session-accounted',
        transcriptId: 'tx-accounted',
      });

      now = 2_000;
      const completed = store.markStatus(receipt.id, 'completed', {
        telemetry: { inputTokens: 120, cachedInputTokens: 80, outputTokens: 30, costUsd: 0.042, rateMode: 'exact' },
      });
      expect(completed).toMatchObject({
        status: 'completed',
        completedAt: 2_000,
        budgetUsd: 3.5,
        predecessor: { sessionId: 'session-source', purpose: 'Original purpose', status: 'completed' },
        telemetry: { inputTokens: 120, cachedInputTokens: 80, outputTokens: 30, costUsd: 0.042, rateMode: 'exact' },
      });
    });
  });

  describe('corrupt optional JSON', () => {
    test('a corrupt predecessor snapshot or telemetry payload never invents evidence', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const receipt = store.accept({
        idempotencyKey: 'corrupt-json-key',
        kind: 'session-continuation',
        predecessorSessionId: 'session-source',
        predecessor: { sessionId: 'session-source', purpose: 'fine', status: 'completed' },
        request: { a: 1 },
      }).receipt;
      store.markStatus(receipt.id, 'completed', {
        telemetry: { inputTokens: 1, outputTokens: 1, costUsd: 0.01, rateMode: 'exact' },
      });

      db.prepare('UPDATE agent_run_receipts SET predecessor_snapshot_json = ?, telemetry_json = ? WHERE id = ?')
        .run('{not valid json', '[1,2,3]', receipt.id);

      const reread = store.get(receipt.id);
      expect(reread.predecessor).toBeNull();
      expect(reread.telemetry).toBeNull();
      // The rest of the receipt is unaffected by the corrupt optional fields.
      expect(reread.status).toBe('completed');
      expect(reread.predecessorSessionId).toBe('session-source');
    });
  });

  describe('bounded parameterized list queries', () => {
    test('filters by status/kind/predecessor and clamps limit', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      for (let i = 0; i < 3; i += 1) {
        now = 1_000 + i;
        store.accept({ idempotencyKey: `acc-${i}`, kind: 'spawn', request: { i } });
      }
      now = 2_000;
      const cont = store.accept({
        idempotencyKey: 'cont-1', kind: 'session-continuation', request: { i: 'c' }, predecessorSessionId: 'session-p',
      }).receipt;
      store.markStatus(cont.id, 'completed', { error: null });

      expect(store.list({ status: 'accepted' })).toHaveLength(3);
      expect(store.list({ kind: 'session-continuation' })).toHaveLength(1);
      expect(store.list({ predecessorSessionId: 'session-p' })).toHaveLength(1);
      expect(store.list({ status: ['accepted', 'completed'] })).toHaveLength(4);
      expect(store.list({}).map((r) => r.id)[0]).toBe(cont.id); // ORDER BY updated_at DESC

      // Cross the production maximum so this assertion proves clamping instead
      // of vacuously returning every row in a tiny fixture.
      for (let i = 0; i <= AGENT_RUN_LIST_MAX_LIMIT; i += 1) {
        now += 1;
        store.accept({ idempotencyKey: `cap-${i}`, kind: 'spawn', request: { i } });
      }
      expect(store.list({ limit: 10_000 })).toHaveLength(AGENT_RUN_LIST_MAX_LIMIT);
      expect(store.list({ limit: 0 })).toHaveLength(1);
      expect(store.list({ limit: -5 })).toHaveLength(1);

      // No SQL string interpolation of caller-controlled values.
      expect(() => store.list({ status: "accepted' OR '1'='1" })).not.toThrow();
      expect(store.list({ status: "accepted' OR '1'='1" })).toHaveLength(0);
    });
  });

  describe('real file-backed close/reopen persistence', () => {
    let scratchDir;

    beforeEach(() => {
      mkdirSync(TMP_BASE, { recursive: true });
      scratchDir = mkdtempSync(join(TMP_BASE, 'pd-agent-run-receipts-'));
    });

    afterEach(() => {
      rmSync(scratchDir, { recursive: true, force: true });
    });

    test('survives a real close + reopen of the backing sqlite file', () => {
      const dbPath = join(scratchDir, 'receipts.db');
      let fileDb = new Database(dbPath);
      let clock = 10_000;
      let store = createAgentRunReceiptStore(fileDb, { now: () => clock });

      const receipt = store.accept({
        idempotencyKey: 'file-backed-key',
        kind: 'session-continuation',
        predecessorSessionId: 'session-source',
        predecessor: { sessionId: 'session-source', purpose: 'file test', status: 'completed' },
        budgetUsd: 1.25,
        request: { purpose: 'persist across restart' },
      }).receipt;
      store.markStarting(receipt.id, { successorAgentId: 'spawned-file', transcriptId: 'tx-file' });
      store.markStatus(receipt.id, 'live', { liveEvidence: { pid: 555, supervisorHeartbeatAt: clock - 10 } });
      store.markStatus(receipt.id, 'completed', {
        telemetry: { inputTokens: 5, outputTokens: 5, costUsd: 0.001, rateMode: 'exact' },
      });

      fileDb.close();

      clock = 20_000;
      fileDb = new Database(dbPath);
      store = createAgentRunReceiptStore(fileDb, { now: () => clock });

      const reread = store.get(receipt.id);
      expect(reread).toMatchObject({
        status: 'completed',
        predecessorSessionId: 'session-source',
        predecessor: { sessionId: 'session-source', purpose: 'file test', status: 'completed' },
        successorAgentId: 'spawned-file',
        transcriptId: 'tx-file',
        budgetUsd: 1.25,
        telemetry: { inputTokens: 5, outputTokens: 5, costUsd: 0.001, rateMode: 'exact' },
      });

      fileDb.close();
    });

    test('reconciliation on reopen only touches rows that actually lost liveness on disk', () => {
      const dbPath = join(scratchDir, 'reconcile.db');
      let fileDb = new Database(dbPath);
      let clock = 1_000;
      let store = createAgentRunReceiptStore(fileDb, { now: () => clock });

      const lost = store.accept({ idempotencyKey: 'lost', kind: 'spawn', request: { a: 1 } }).receipt;
      const finished = store.accept({ idempotencyKey: 'finished', kind: 'spawn', request: { a: 2 } }).receipt;
      store.markStatus(finished.id, 'completed', { error: null });
      fileDb.close();

      clock = 9_000;
      fileDb = new Database(dbPath);
      store = createAgentRunReceiptStore(fileDb, { now: () => clock });

      expect(store.get(lost.id)).toMatchObject({ status: 'unknown' });
      expect(store.get(finished.id)).toMatchObject({ status: 'completed', error: null });

      fileDb.close();
    });
  });
});
