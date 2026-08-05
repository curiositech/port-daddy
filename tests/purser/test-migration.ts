import { migrateAgentRunReceiptsSchema } from '../../lib/agent-run-receipts';
import { Database } from 'bun:sqlite';

jest.mock('bun:sqlite', () => ({ Database: jest.fn() }));

describe('Migration Logic', () => {
  let db: any;

  beforeEach(() => {
    db = { prepare: jest.fn(), all: jest.fn() };
    db.prepare.mockReturnValue({ all: jest.fn() });
  });

  test('migrateAgentRunReceiptsSchema handles legacy tables', () => {
    const legacyColumns = ['id', 'created_at'];
    db.prepare.mockImplementation(() => ({
      all: () => legacyColumns
    }));

    const result = migrateAgentRunReceiptsSchema(db);
    expect(result).toEqual(legacyColumns);
  });
});