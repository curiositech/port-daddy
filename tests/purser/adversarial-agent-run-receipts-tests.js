import { beforeEach, describe, expect, test, jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createAgentRunReceiptStore, validateBudgetUsd, validateTelemetry, migrateAgentRunReceiptsSchema } from '../../lib/agent-run-receipts.js';

describe('Adversarial Agent Run Receipt Tests', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  describe('Budget Validation Adversarial Tests', () => {
    test('Rejects non-number budgetUsd values', () => {
      expect(() => validateBudgetUsd('100')).toThrow(/budgetUsd must be a finite, non-negative number/);
      expect(() => validateBudgetUsd({ value: 100 })).toThrow(/budgetUsd must be a finite, non-negative number/);
    });

    test('Allows zero budget', () => {
      expect(validateBudgetUsd(0)).toBe(0);
    });

    test('Rejects stringified numbers', () => {
      expect(() => validateBudgetUsd('100.50')).toThrow(/budgetUsd must be a finite, non-negative number/);
    });

    test('Rejects large finite numbers', () => {
      expect(() => validateBudgetUsd(Number.MAX_VALUE)).toThrow(/budgetUsd must be a finite, non-negative number/);
    });
  });

  describe('Telemetry Validation Adversarial Tests', () => {
    test('Rejects missing required telemetry fields', () => {
      expect(() => validateTelemetry({})).toThrow(/telemetry.inputTokens must be a finite, non-negative number/);
    });

    test('Allows cachedInputTokens as undefined', () => {
      expect(validateTelemetry({ inputTokens: 100, cachedInputTokens: undefined, outputTokens: 50, costUsd: 1.99 })).toBeDefined();
    });

    test('Rejects non-finite telemetry values', () => {
      expect(() => validateTelemetry({ inputTokens: NaN, outputTokens: 100, costUsd: Infinity })).toThrow(/telemetry.inputTokens must be a finite, non-negative number/);
    });

    test('Rejects negative telemetry values', () => {
      expect(() => validateTelemetry({ inputTokens: -1, outputTokens: 100, costUsd: 0 })).toThrow(/telemetry.inputTokens must be a finite, non-negative number/);
    });
  });

  describe('Process Verification Adversarial Tests', () => {
    test('Rejects non-integer PIDs', () => {
      const verifyProcessAlive = jest.fn(() => true);
      const store = createAgentRunReceiptStore(db, { verifyProcessAlive });
      expect(() => store.markStatus('id', 'live', { liveEvidence: { pid: '1234', supervisorHeartbeatAt: Date.now() } })).toThrow(/corroborated/);
      expect(verifyProcessAlive).not.toHaveBeenCalled();
    });

    test('Rejects invalid heartbeat age', () => {
      const verifyProcessAlive = jest.fn(() => true);
      const store = createAgentRunReceiptStore(db, { verifyProcessAlive });
      const now = Date.now();
      expect(() => store.markStatus('id', 'live', { liveEvidence: { pid: 1234, supervisorHeartbeatAt: now - 1000000 } })).toThrow(/corroborated/);
    });

    test('Allows valid PID with existing process', () => {
      const verifyProcessAlive = jest.fn(() => true);
      const store = createAgentRunReceiptStore(db, { verifyProcessAlive });
      const now = Date.now();
      expect(() => store.markStatus('id', 'live', { liveEvidence: { pid: 1234, supervisorHeartbeatAt: now } })).not.toThrow();
      expect(verifyProcessAlive).toHaveBeenCalledWith(1234);
    });
  });

  describe('Schema Migration Adversarial Tests', () => {
    test('Preserves legacy NOT NULL columns', () => {
      db.exec(`
        CREATE TABLE agent_run_receipts (
          id TEXT PRIMARY KEY,
          legacy_key TEXT NOT NULL,
          status TEXT NOT NULL
        );
        INSERT INTO agent_run_receipts (id, legacy_key, status) VALUES ('legacy-id', 'key', 'completed');
      `);
      migrateAgentRunReceiptsSchema(db);
      const row = db.prepare('SELECT legacy_key FROM agent_run_receipts WHERE id = ?').get('legacy-id');
      expect(row.legacy_key).toBe('key');
    });

    test('Adds new columns without altering existing data', () => {
      db.exec(`
        CREATE TABLE agent_run_receipts (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          status TEXT NOT NULL
        );
      `);
      migrateAgentRunReceiptsSchema(db);
      const columns = db.prepare('PRAGMA table_info(agent_run_receipts)').all();
      expect(columns.some(col => col.name === 'budget_usd')).toBe(true);
      expect(columns.some(col => col.name === 'telemetry_json')).toBe(true);
    });
  });
});