// tests/unit/purser/data-integrity-malformed-json.test.ts
import { open } from 'node:sqlite';
import sqlite3 from 'sqlite3';

describe('SQLite JSON handling – malformed JSON should be rejected', () => {
  let db: ReturnType<typeof open>;

  beforeAll(async () => {
    // In‑memory SQLite instance – mirrors the environment used by the
    // relay tests (node:sqlite with the sqlite3 driver).
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    // Simple table used by the statement under test.
    await db.exec(`
      CREATE TABLE test_json (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT
      );
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  test('json_each throws on malformed JSON input', async () => {
    // This mirrors the INSERT … SELECT … FROM json_each(?) pattern used in
    // replaceRoadmapMirror.  We deliberately feed it broken JSON.
    const stmt = await db.prepare(
      `INSERT INTO test_json (value)
       SELECT json_extract(value, '$.x')
       FROM json_each(?)`,
    );

    const malformedJson = '{ this is not valid JSON! ]';

    // The SQLite driver should reject the malformed payload with an error.
    await expect(stmt.run(malformedJson)).rejects.toThrow();
  });

  test('well‑formed JSON is accepted (sanity check)', async () => {
    const stmt = await db.prepare(
      `INSERT INTO test_json (value)
       SELECT json_extract(value, '$.x')
       FROM json_each(?)`,
    );

    const goodJson = JSON.stringify([{ x: 1 }, { x: 2 }]);

    // No error should be thrown for valid JSON.
    await expect(stmt.run(goodJson)).resolves.not.toThrow();

    // Verify that rows were inserted as expected.
    const rows = await db.all<{ value: string }>(`SELECT value FROM test_json`);
    expect(rows.map((r) => r.value)).toEqual(['1', '2']);
  });
});