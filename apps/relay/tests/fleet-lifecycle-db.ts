import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

/** Actual migration chain and SQLite constraints, shared across producer/consumer tests. */
export function fleetLifecycleDb(beforeControlMigration?: (sqlite: DatabaseSync) => void) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    if (file === '2026-09-14-fleet-control-waiting.sql') beforeControlMigration?.(sqlite);
    sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  function prepare(sql: string) {
    let args: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { args = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...args as never[]) ?? null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...args as never[]) }; },
      async run() { return { success: true, meta: { changes: sqlite.prepare(sql).run(...args as never[]).changes } }; },
    };
    return statement;
  }
  const db = { prepare, async batch(statements: ReturnType<typeof prepare>[]) {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  return { sqlite, db };
}
