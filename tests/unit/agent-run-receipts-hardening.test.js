import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const { createTestDb } = await import('../setup-unit.js');
const { createAgentRunReceiptStore } = await import('../../lib/agent-run-receipts.js');

describe('agent run receipt store hardening', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => db.close());

  test.each([NaN, Infinity, -Infinity, -0.01])(
    'rejects invalid budget %s before persistence',
    (budgetUsd) => {
      const store = createAgentRunReceiptStore(db);
      expect(() => store.accept({
        idempotencyKey: `budget-${String(budgetUsd)}`,
        kind: 'spawn',
        request: { task: 'budget validation' },
        budgetUsd,
      })).toThrow(/budgetUsd must be a finite, non-negative number/);
      expect(db.prepare('SELECT COUNT(*) AS n FROM agent_run_receipts').get().n).toBe(0);
    },
  );

  test('rejects non-finite terminal telemetry instead of converting it to null', () => {
    const store = createAgentRunReceiptStore(db);
    const receipt = store.accept({
      idempotencyKey: 'telemetry-invalid',
      kind: 'spawn',
      request: { task: 'telemetry validation' },
    }).receipt;

    expect(() => store.markStatus(receipt.id, 'failed', {
      telemetry: {
        inputTokens: 1,
        outputTokens: 1,
        costUsd: NaN,
        rateMode: 'exact',
      },
    })).toThrow(/telemetry.costUsd must be a finite, non-negative number/);
    expect(store.get(receipt.id).status).toBe('accepted');
  });

  test('requires the configured verifier to corroborate live PID evidence', () => {
    const verifyProcessAlive = jest.fn(() => false);
    const store = createAgentRunReceiptStore(db, {
      now: () => 10_000,
      verifyProcessAlive,
    });
    const receipt = store.accept({
      idempotencyKey: 'forged-live',
      kind: 'spawn',
      request: { task: 'liveness validation' },
    }).receipt;
    store.markStarting(receipt.id, {
      successorAgentId: 'agent-real-id',
      successorSessionId: 'session-real-id',
      transcriptId: 'tx-real-id',
    });

    expect(() => store.markStatus(receipt.id, 'live', {
      liveEvidence: { pid: 42_424, supervisorHeartbeatAt: 10_000 },
    })).toThrow(/corroborated/);
    expect(verifyProcessAlive).toHaveBeenCalledWith(42_424);
    expect(store.get(receipt.id).status).toBe('starting');
  });

  test('additively migrates a narrow legacy table and preserves its rows', () => {
    db.exec(`
      CREATE TABLE agent_run_receipts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        legacy_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO agent_run_receipts (
        id, kind, legacy_key, status, created_at, updated_at
      ) VALUES ('run-legacy', 'spawn', 'old-key', 'completed', 1, 1);
    `);

    const store = createAgentRunReceiptStore(db, { recoverNonTerminal: false });
    expect(store.get('run-legacy')).toEqual(expect.objectContaining({
      id: 'run-legacy',
      status: 'completed',
    }));
    const fresh = store.accept({
      idempotencyKey: 'fresh-after-migration',
      kind: 'spawn',
      request: { task: 'still writable' },
    }).receipt;
    expect(fresh.status).toBe('accepted');
    expect(db.prepare(
      'SELECT legacy_key FROM agent_run_receipts WHERE id = ?',
    ).get(fresh.id).legacy_key).toBeTruthy();
  });
});
