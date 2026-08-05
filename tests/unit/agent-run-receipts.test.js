import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { createTestDb } = await import('../setup-unit.js');
const {
  AGENT_RUN_LIST_MAX_LIMIT,
  AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS,
  AgentRunIdempotencyConflictError,
  createAgentRunReceiptStore,
  defaultVerifyProcessAlive,
} = await import('../../lib/agent-run-receipts.js');

// A PID number that exceeds the process-id ceiling on every real OS (Linux
// default pid_max is ~4.2M, macOS's is far lower), so process.kill() against
// it always throws ESRCH -- a deterministic "this PID has never existed"
// stand-in without relying on a real child process outliving the test.
const NEVER_EXISTED_PID = 2_147_483_647;

// ~/coding/tmp, never /tmp (macOS purges /tmp).
const TMP_BASE = join(process.env.HOME || '.', 'coding', 'tmp');

describe('agent run receipt ledger', () => {
  let db;
  let now;

  beforeEach(() => {
    db = createTestDb();
    now = 1_000;
  });

  afterEach(() => db.close());

  describe('idempotency', () => {
    test('same key + same request replays the same receipt without re-inserting', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const request = { backend: 'cli:codex', task: 'inspect', env: { B: '2', A: '1' } };
      const first = store.accept({ idempotencyKey: 'same-key', kind: 'spawn', request });
      const replay = store.accept({
        idempotencyKey: 'same-key',
        kind: 'spawn',
        // Field order differs but canonicalizes to the same request hash.
        request: { task: 'inspect', env: { A: '1', B: '2' }, backend: 'cli:codex' },
      });

      expect(first.replayed).toBe(false);
      expect(replay.replayed).toBe(true);
      expect(replay.receipt.id).toBe(first.receipt.id);
      expect(replay.receipt.requestHash).toBe(first.receipt.requestHash);
      expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
    });

    test('same key + different request conflicts and does not launch a second run', () => {
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
      expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
    });

    test('idempotency_key_hash is a real database-level UNIQUE constraint', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const accepted = store.accept({
        idempotencyKey: 'db-unique-key',
        kind: 'spawn',
        request: { backend: 'cli:codex' },
      }).receipt;

      // Bypass the store entirely and try to force a duplicate key hash in
      // directly. If idempotency depended on app-level SELECT-then-INSERT
      // logic rather than the schema, this raw insert would succeed.
      const dupeKeyHash = db.prepare('SELECT idempotency_key_hash FROM agent_run_receipts WHERE id = ?').get(accepted.id).idempotency_key_hash;
      expect(() => db.prepare(`
        INSERT INTO agent_run_receipts (
          id, kind, idempotency_key_hash, request_hash, status, created_at, updated_at
        ) VALUES ('run-forced-dupe', 'spawn', ?, 'forced-hash', 'accepted', 1, 1)
      `).run(dupeKeyHash)).toThrow(/UNIQUE constraint failed/);
    });

    test('two racing accepts on the same key never produce two rows', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const request = { backend: 'cli:codex', task: 'race' };
      const results = Array.from({ length: 5 }, () => store.accept({ idempotencyKey: 'race-key', kind: 'spawn', request }));
      const ids = new Set(results.map((r) => r.receipt.id));
      expect(ids.size).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(1);
    });
  });

  describe('restart reconciliation', () => {
    test('startup flips accepted/starting/live to unknown without inventing failure', () => {
      // This test is about restart reconciliation, not process verification --
      // stub the verifier permissive so a fabricated pid doesn't fail it for
      // an unrelated reason.
      const firstGeneration = createAgentRunReceiptStore(db, { now: () => now, verifyProcessAlive: () => true });
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
      // This test targets shape/freshness validation, which rejects before
      // the process check ever runs (short-circuit) -- except the final
      // success case, so stub the verifier permissive for that case.
      const store = createAgentRunReceiptStore(db, { now: () => now, verifyProcessAlive: () => true });
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
        liveEvidence: { pid: 4242, supervisorHeartbeatAt: now - 30_000 },
      });
      expect(reconciled).toMatchObject({ status: 'live', error: null });
    });

    test('direct unknown -> completed does not mutate the receipt', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now, verifyProcessAlive: () => true });
      const receipt = store.accept({
        idempotencyKey: 'lost-liveness', kind: 'spawn', request: { a: 1 },
      }).receipt;
      store.markStatus(receipt.id, 'unknown', { error: 'restart' });

      const attempted = store.markStatus(receipt.id, 'completed', {
        telemetry: { inputTokens: 1, outputTokens: 1, costUsd: 0.01, rateMode: 'exact' },
      });

      expect(attempted).toMatchObject({ status: 'unknown', error: 'restart', completedAt: null, telemetry: null });
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
      expect(store.markStatus(receipt.id, 'completed')).toMatchObject({ status: 'cancelled', error: 'operator cancelled' });
      expect(store.markStatus(receipt.id, 'unknown')).toMatchObject({ status: 'cancelled', error: 'operator cancelled' });
    });
  });

  describe('live evidence requires real process corroboration', () => {
    test('a shape-valid but forged/nonexistent PID is rejected by the default verifier', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const receipt = store.accept({ idempotencyKey: 'forged-pid', kind: 'spawn', request: { a: 1 } }).receipt;
      store.markStatus(receipt.id, 'unknown', { error: 'restart' });

      // The evidence *shape* is perfectly valid -- integer pid, fresh
      // heartbeat -- but no process with this pid has ever existed. Caller-
      // shaped data that merely looks right must not count as evidence.
      expect(() => store.markStatus(receipt.id, 'live', {
        liveEvidence: { pid: NEVER_EXISTED_PID, supervisorHeartbeatAt: now - 10 },
      })).toThrow(/real process check/i);
      expect(store.get(receipt.id)).toMatchObject({ status: 'unknown' });
    });

    test('the current process\'s own real, live PID is accepted by the default verifier', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const receipt = store.accept({ idempotencyKey: 'real-pid', kind: 'spawn', request: { a: 1 } }).receipt;
      store.markStatus(receipt.id, 'unknown', { error: 'restart' });

      const reconciled = store.markStatus(receipt.id, 'live', {
        liveEvidence: { pid: process.pid, supervisorHeartbeatAt: now - 10 },
      });
      expect(reconciled).toMatchObject({ status: 'live', error: null });
    });

    test('defaultVerifyProcessAlive itself: true for the running process, false for a pid that never existed', () => {
      expect(defaultVerifyProcessAlive(process.pid)).toBe(true);
      expect(defaultVerifyProcessAlive(NEVER_EXISTED_PID)).toBe(false);
    });

    test('an injected verifier is consulted instead of the default, and its answer is authoritative', () => {
      const store = createAgentRunReceiptStore(db, {
        now: () => now,
        // A stand-in for a supervisor-backed check: only pid 555 is "alive",
        // regardless of what the real OS process table says about it.
        verifyProcessAlive: (pid) => pid === 555,
      });
      const receipt = store.accept({ idempotencyKey: 'injected-verifier', kind: 'spawn', request: { a: 1 } }).receipt;
      store.markStatus(receipt.id, 'unknown', { error: 'restart' });

      // Shape-valid, and the real OS process table would say this pid is
      // alive (it's our own pid) -- but the injected verifier says no.
      expect(() => store.markStatus(receipt.id, 'live', {
        liveEvidence: { pid: process.pid, supervisorHeartbeatAt: now - 10 },
      })).toThrow(/real process check/i);

      const reconciled = store.markStatus(receipt.id, 'live', {
        liveEvidence: { pid: 555, supervisorHeartbeatAt: now - 10 },
      });
      expect(reconciled).toMatchObject({ status: 'live', error: null });
    });
  });

  describe('numeric field validation', () => {
    test('rejects NaN, Infinity, and negative budgetUsd at accept()', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      for (const bad of [NaN, Infinity, -Infinity, -0.01, -1]) {
        expect(() => store.accept({
          idempotencyKey: `bad-budget-${bad}`, kind: 'spawn', request: { a: 1 }, budgetUsd: bad,
        })).toThrow(/budgetUsd/);
      }
    });

    test('accepts a valid zero-or-positive budgetUsd and null/undefined', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      expect(store.accept({ idempotencyKey: 'zero-budget', kind: 'spawn', request: {}, budgetUsd: 0 }).receipt.budgetUsd).toBe(0);
      expect(store.accept({ idempotencyKey: 'pos-budget', kind: 'spawn', request: {}, budgetUsd: 2.5 }).receipt.budgetUsd).toBe(2.5);
      expect(store.accept({ idempotencyKey: 'null-budget', kind: 'spawn', request: {} }).receipt.budgetUsd).toBeNull();
    });

    test('rejects NaN, Infinity, and negative numeric telemetry fields at markStatus()', () => {
      const store = createAgentRunReceiptStore(db, { now: () => now });
      const badValues = [NaN, Infinity, -Infinity, -1];
      const fields = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'costUsd'];
      for (const field of fields) {
        for (const bad of badValues) {
          const receipt = store.accept({
            idempotencyKey: `bad-telemetry-${field}-${bad}`, kind: 'spawn', request: { field, bad },
          }).receipt;
          const telemetry = { inputTokens: 1, outputTokens: 1, costUsd: 0.01, rateMode: 'exact', [field]: bad };
          expect(() => store.markStatus(receipt.id, 'completed', { telemetry }))
            .toThrow(new RegExp(`telemetry\\.${field}`));
          // The bad write never landed -- receipt is unaffected.
          expect(store.get(receipt.id)).toMatchObject({ status: 'accepted', telemetry: null });
        }
      }
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

      // Even an absurd requested limit never exceeds the hard cap.
      expect(store.list({ limit: 10_000 })).toHaveLength(Math.min(4, AGENT_RUN_LIST_MAX_LIMIT));
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
      // This test is about persistence across close/reopen, not process
      // verification -- stub the verifier permissive.
      let store = createAgentRunReceiptStore(fileDb, { now: () => clock, verifyProcessAlive: () => true });

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

    test('additively migrates a pre-existing narrower agent_run_receipts table, retaining data and indexes', () => {
      const dbPath = join(scratchDir, 'legacy-schema.db');
      let fileDb = new Database(dbPath);

      // A stand-in for an earlier, narrower revision of this store: only the
      // bare-bones columns, a plain (non-unique, non-hashed) idempotency key,
      // no predecessor/successor/transcript/budget/telemetry fields, and its
      // own pre-existing index. Construction against this file must never
      // reach a "no such column" error.
      fileDb.exec(`
        CREATE TABLE agent_run_receipts (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_legacy_idempotency_key ON agent_run_receipts(idempotency_key);
      `);
      fileDb.prepare(`
        INSERT INTO agent_run_receipts (id, kind, idempotency_key, status, created_at, updated_at)
        VALUES ('run-legacy-1', 'spawn', 'legacy-key', 'completed', 500, 500)
      `).run();
      fileDb.close();

      // Reopen with the CURRENT store implementation against the legacy file.
      fileDb = new Database(dbPath);
      const store = createAgentRunReceiptStore(fileDb, { now: () => 9_000, verifyProcessAlive: () => true });

      // The pre-existing row and its data survived, untouched, in full.
      const legacyRow = fileDb.prepare('SELECT * FROM agent_run_receipts WHERE id = ?').get('run-legacy-1');
      expect(legacyRow).toMatchObject({
        id: 'run-legacy-1', kind: 'spawn', idempotency_key: 'legacy-key', status: 'completed',
        created_at: 500, updated_at: 500,
      });
      // New columns exist and default to NULL for the legacy row rather than
      // throwing -- reading it back through the store's own API works.
      const legacyReceipt = store.get('run-legacy-1');
      expect(legacyReceipt).toMatchObject({
        id: 'run-legacy-1', status: 'completed', budgetUsd: null, telemetry: null,
        predecessorSessionId: null, successorAgentId: null, transcriptId: null,
      });
      expect(legacyReceipt.requestHash).toMatch(/^[a-f0-9]{64}$/);

      // The legacy table's own pre-existing index is untouched...
      const indexes = fileDb.prepare("PRAGMA index_list(agent_run_receipts)").all().map((i) => i.name);
      expect(indexes).toContain('idx_legacy_idempotency_key');
      // ...and the current schema's own indexes (including the replacement
      // UNIQUE index that stands in for the old inline UNIQUE constraint)
      // were added alongside it.
      expect(indexes).toContain('idx_agent_run_receipts_status');
      expect(indexes).toContain('idx_agent_run_receipts_predecessor');
      expect(indexes).toContain('ux_agent_run_receipts_idempotency_key_hash');

      // SQLite cannot add NOT NULL to an existing column without rebuilding
      // the table, so migration installs equivalent write-boundary triggers.
      // Future direct writers cannot evade idempotency with nullable hashes.
      expect(() => fileDb.prepare(`
        INSERT INTO agent_run_receipts (
          id, kind, idempotency_key, status, created_at, updated_at
        ) VALUES ('run-null-hashes', 'spawn', 'legacy-2', 'accepted', 600, 600)
      `).run()).toThrow(/hashes are required/i);

      // The store is fully functional against the migrated file: a brand
      // new accept() works end to end, including the idempotency_key_hash
      // UNIQUE guarantee added by the migration.
      const fresh = store.accept({ idempotencyKey: 'post-migration-key', kind: 'spawn', request: { a: 1 } });
      expect(fresh.replayed).toBe(false);
      const replay = store.accept({ idempotencyKey: 'post-migration-key', kind: 'spawn', request: { a: 1 } });
      expect(replay.replayed).toBe(true);
      expect(replay.receipt.id).toBe(fresh.receipt.id);

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
