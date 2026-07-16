import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import {
  ContinuationIdempotencyConflictError,
  createContinuationStore,
  hashContinuationPrompt,
} from '../../lib/continuation-runtime.js';

function request(overrides = {}) {
  return {
    idempotencyKey: 'continue-key-1',
    sourceEpisodeId: 41,
    sourceCapsuleId: 'capsule-41',
    durableAgentId: 'portdaddy-typography-expert',
    mode: 'native',
    sourceAdapter: 'claude-code',
    sourceSessionId: 'claude-session-41',
    sourceAgentId: 'source-agent-41',
    predecessorRunId: 'run-40',
    targetAdapter: 'claude-code',
    requestedBackend: 'cli:claude-code',
    effectiveBackend: 'cli:claude-code',
    requestedModel: 'sonnet',
    effectiveModel: 'sonnet',
    workspaceIdentityHash: 'd'.repeat(64),
    promptHash: hashContinuationPrompt('Continue without losing context.'),
    ...overrides,
  };
}

describe('continuation receipt store', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  test('persists lineage and hashes without storing the idempotency key or prompt', () => {
    const store = createContinuationStore(db);
    const accepted = store.accept(request());

    expect(accepted.replayed).toBe(false);
    expect(accepted.receipt).toEqual(expect.objectContaining({
      status: 'accepted',
      sourceEpisodeId: 41,
      sourceSessionId: 'claude-session-41',
      targetAdapter: 'claude-code',
      leaseExpiresAt: expect.any(Number),
    }));

    const raw = db.prepare('SELECT * FROM agent_continuations WHERE id = ?').get(accepted.receipt.id);
    expect(raw.idempotency_key_hash).not.toBe('continue-key-1');
    expect(raw.prompt_hash).toBe(hashContinuationPrompt('Continue without losing context.'));
    expect(JSON.stringify(raw)).not.toContain('Continue without losing context.');
  });

  test('replays an identical request and rejects idempotency drift', () => {
    const store = createContinuationStore(db);
    const first = store.accept(request());
    const replay = store.accept(request());

    expect(replay.replayed).toBe(true);
    expect(replay.receipt.id).toBe(first.receipt.id);
    expect(() => store.accept(request({ requestedModel: 'opus' })))
      .toThrow(ContinuationIdempotencyConflictError);
    expect(() => store.accept(request({ workspaceIdentityHash: 'e'.repeat(64) })))
      .toThrow(ContinuationIdempotencyConflictError);
  });

  test('recovers uniqueness conflicts across independent SQLite connections', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-continuation-idempotency-'));
    const path = join(root, 'continuations.sqlite');
    const firstDb = new Database(path, { timeout: 2_000 });
    const secondDb = new Database(path, { timeout: 2_000 });
    try {
      const firstStore = createContinuationStore(firstDb);
      const secondStore = createContinuationStore(secondDb);

      const first = firstStore.accept(request({ idempotencyKey: 'shared-key' }));
      const replay = secondStore.accept(request({ idempotencyKey: 'shared-key' }));

      expect(first.replayed).toBe(false);
      expect(replay.replayed).toBe(true);
      expect(replay.receipt.id).toBe(first.receipt.id);
      expect(firstDb.prepare('SELECT COUNT(*) AS count FROM agent_continuations').get().count).toBe(1);
      expect(() => secondStore.accept(request({
        idempotencyKey: 'shared-key',
        requestedModel: 'opus',
      }))).toThrow(ContinuationIdempotencyConflictError);
    } finally {
      firstDb.close();
      secondDb.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('records daemon-witnessed running and terminal provenance', () => {
    const store = createContinuationStore(db);
    const { receipt } = store.accept(request());

    expect(store.markRunning(receipt.id)).toEqual(expect.objectContaining({ status: 'running' }));
    expect(store.markCompleted(receipt.id, {
      successorRunId: 'spawned-123',
      successorSessionId: 'claude-session-41',
      effectiveBackend: 'claude-cli',
      effectiveModel: 'sonnet',
    })).toEqual(expect.objectContaining({
      status: 'completed',
      successorRunId: 'spawned-123',
      successorSessionId: 'claude-session-41',
    }));
  });

  test('marks only expired prior-generation receipts orphaned during explicit startup recovery', () => {
    let clock = 1_000;
    const firstStore = createContinuationStore(db, {
      ownerId: 'daemon-generation-a',
      now: () => clock,
      recoverExpired: true,
      acceptedLeaseMs: 1_000,
    });
    const accepted = firstStore.accept(request()).receipt;
    const running = firstStore.accept(request({
      idempotencyKey: 'continue-key-2',
      sourceSessionId: 'claude-session-42',
    })).receipt;
    firstStore.markRunning(running.id, 1_000);

    clock = 2_001;
    const restarted = createContinuationStore(db, {
      ownerId: 'daemon-generation-b',
      now: () => clock,
      recoverExpired: true,
    });

    expect(restarted.orphanedAtStartup).toBe(2);
    expect(restarted.get(accepted.id)).toEqual(expect.objectContaining({ status: 'orphaned' }));
    expect(restarted.get(running.id)).toEqual(expect.objectContaining({ status: 'orphaned' }));
    expect(firstStore.markCompleted(running.id)).toBeNull();
  });

  test('a second live SQLite connection cannot orphan or take over an unexpired running receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-continuation-lease-'));
    const path = join(root, 'continuations.sqlite');
    const firstDb = new Database(path, { timeout: 2_000 });
    const secondDb = new Database(path, { timeout: 2_000 });
    let clock = 10_000;
    try {
      const firstStore = createContinuationStore(firstDb, {
        ownerId: 'daemon-generation-a',
        now: () => clock,
        recoverExpired: true,
      });
      const accepted = firstStore.accept(request({ idempotencyKey: 'lease-key' })).receipt;
      expect(firstStore.markRunning(accepted.id, 10_000)).toEqual(expect.objectContaining({ status: 'running' }));

      clock = 15_000;
      const secondStore = createContinuationStore(secondDb, {
        ownerId: 'daemon-generation-b',
        now: () => clock,
        recoverExpired: true,
      });

      expect(secondStore.orphanedAtStartup).toBe(0);
      expect(secondStore.get(accepted.id)).toEqual(expect.objectContaining({ status: 'running' }));
      expect(secondStore.markRunning(accepted.id, 10_000)).toBeNull();
      expect(secondStore.markCompleted(accepted.id)).toBeNull();

      clock = 20_001;
      const recovered = createContinuationStore(secondDb, {
        ownerId: 'daemon-generation-c',
        now: () => clock,
        recoverExpired: true,
      });
      expect(recovered.orphanedAtStartup).toBe(1);
      expect(recovered.get(accepted.id)).toEqual(expect.objectContaining({ status: 'orphaned' }));
      expect(firstStore.markCompleted(accepted.id)).toBeNull();
    } finally {
      firstDb.close();
      secondDb.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('accepted-to-running is a lease-bound compare-and-swap', () => {
    let clock = 100;
    const store = createContinuationStore(db, {
      ownerId: 'daemon-generation-a',
      now: () => clock,
      acceptedLeaseMs: 1_000,
    });
    const accepted = store.accept(request()).receipt;

    clock = 1_101;
    expect(store.markRunning(accepted.id, 5_000)).toBeNull();
    expect(store.get(accepted.id)).toEqual(expect.objectContaining({ status: 'accepted' }));
  });
});
