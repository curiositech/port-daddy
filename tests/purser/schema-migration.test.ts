import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createAgentRunReceiptStore } from '../../lib/agent-run-receipts.ts';

describe('Schema migration robustness', () => {
  test('Migration handles existing data with extra columns', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE agent_run_receipts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        extra_column TEXT
      );
    `);
    db.prepare(`
      INSERT INTO agent_run_receipts (id, kind, idempotency_key, status, created_at, updated_at, extra_column)
      VALUES ('migration-test', 'spawn', 'legacy', 'completed', 100, 100, 'value')
    `).run();

    const store = createAgentRunReceiptStore(db, { now: () => 9_000, verifyProcessAlive: () => true });
    const receipt = store.get('migration-test');
    expect(receipt).toMatchObject({ extra_column: 'value' });
  });
});