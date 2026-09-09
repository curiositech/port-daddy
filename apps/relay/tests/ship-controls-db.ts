/** Real SQLite test adapter: SQL constraints, CAS, and audit triggers are tested,
 * not reproduced as a second in-memory implementation of the policy.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { ShipControlsDb } from '../../shared/repo-ship-controls.js';

export function shipControlsDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/2026-09-08-repo-ship-controls.sql', import.meta.url), 'utf8'));
  const db: ShipControlsDb = {
    prepare(sql) {
      return { bind(...args) {
        return {
          async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...args as never[]) as T[] }; },
          async run() {
            // D1/Miniflare counts total_changes(), including trigger writes.
            // SQLite Statement.run().changes excludes them and masked a real
            // save-success bug: one decision plus its audit event is two.
            const before = Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n);
            sqlite.prepare(sql).run(...args as never[]);
            const after = Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n);
            return { success: true, meta: { changes: after - before } };
          },
        };
      } };
    },
  };
  return { sqlite, db };
}
