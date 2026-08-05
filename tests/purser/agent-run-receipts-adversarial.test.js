const { expect } = require('@jest/globals');
const { createAgentRunReceiptStore, defaultVerifyProcessAlive } = require('../../lib/agent-run-receipts.js');
const { join } = require('path');
const { tmpdir } = require('os');
const { Database } = require('sqlite3');

describe('Adversarial Process Verification', () => {
  const TMP_DIR = tmpdir();
  const NEVER_EXISTED_PID = 2_147_483_647;

  test('Rejects non-integer PID values in live evidence', () => {
    const store = createAgentRunReceiptStore({
      now: () => Date.now(),
      verifyProcessAlive: defaultVerifyProcessAlive
    });
    
    const receipt = store.accept({
      idempotencyKey: 'bad-pid',
      kind: 'spawn',
      request: { a: 1 }
    }).receipt;

    expect(() => store.markStatus(receipt.id, 'live', {
      liveEvidence: { pid: '1234', supervisorHeartbeatAt: Date.now() - 10 }
    })).toThrow(/PID must be an integer/);
  });

  test('Rejects PID values exceeding process ID limits', () => {
    const store = createAgentRunReceiptStore({ now: () => Date.now() });
    
    const receipt = store.accept({
      idempotencyKey: 'huge-pid',
      kind: 'spawn',
      request: { a: 1 }
    }).receipt;

    expect(() => store.markStatus(receipt.id, 'live', {
      liveEvidence: { pid: NEVER_EXISTED_PID + 1, supervisorHeartbeatAt: Date.now() - 10 }
    })).toThrow(/PID exceeds system limits/);
  });

  test('Rejects invalid numeric telemetry values during status updates', () => {
    const store = createAgentRunReceiptStore({ now: () => Date.now() });
    const receipt = store.accept({
      idempotencyKey: 'telemetry-bad',
      kind: 'spawn',
      request: { a: 1 }
    }).receipt;

    const badValues = [NaN, Infinity, -Infinity, -1];
    const fields = ['inputTokens', 'outputTokens', 'costUsd'];
    
    for (const field of fields) {
      for (const value of badValues) {
        expect(() => store.markStatus(receipt.id, 'completed', {
          telemetry: { [field]: value }
        })).toThrow(new RegExp(`telemetry\.${field}`));
      }
    }
  });
});

describe('Legacy Schema Migration Adversarial Tests', () => {
  const SCRATCH_DIR = join(tmpdir(), 'legacy-migration-tests');

  test('Forces migration from pre-2024 schema with missing columns', () => {
    const dbPath = join(SCRATCH_DIR, 'legacy.db');
    const db = new Database(dbPath);
    
    // Create legacy schema without new columns
    db.exec(`
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

    // Insert data with missing columns
    db.run(`
      INSERT INTO agent_run_receipts (id, kind, idempotency_key, status, created_at, updated_at)
      VALUES ('legacy-record', 'spawn', 'old-key', 'completed', 1000, 1000)
    `);

    // Verify migration handles missing columns correctly
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const receipt = store.get('legacy-record');
    
    expect(receipt).toMatchObject({
      id: 'legacy-record',
      status: 'completed',
      budgetUsd: null,
      telemetry: null,
      predecessorSessionId: null,
      successorAgentId: null,
      transcriptId: null
    });
  });

  test('Prevents data loss during schema migration with existing indexes', () => {
    const dbPath = join(SCRATCH_DIR, 'index-preserved.db');
    const db = new Database(dbPath);
    
    // Create schema with existing indexes but missing new columns
    db.exec(`
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

    // Insert data
    db.run(`
      INSERT INTO agent_run_receipts (id, kind, idempotency_key, status, created_at, updated_at)
      VALUES ('index-record', 'spawn', 'index-key', 'accepted', 2000, 2000)
    `);

    // Verify indexes persist after migration
    const store = createAgentRunReceiptStore(db, { now: () => Date.now() });
    const indexes = db.prepare("PRAGMA index_list(agent_run_receipts)").all().map(i => i.name);
    
    expect(indexes).toContain('idx_legacy_idempotency_key');
    expect(indexes).toContain('ux_agent_run_receipts_idempotency_key_hash');
  });
});