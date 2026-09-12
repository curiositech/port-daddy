import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/** Purpose: use real SQLite behind a D1 shape without connecting to a service.
 * @param enabledInstallations Explicit synthetic grants; defaults to no grants.
 * @returns An in-memory database with the actual control migration applied.
 */
export function controlDb(enabledInstallations: number[] = []): D1Database {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../migrations/2026-09-08-fleet-controls.sql', import.meta.url), 'utf8'));
  if (enabledInstallations.length) {
    const seed = sql.prepare('INSERT INTO fleet_controls VALUES (?, 1, 1, ?, 1)');
    for (const scope of ['global', ...enabledInstallations.map(id => `installation:${id}`)]) seed.run(scope, 'test-admin');
  }
  const db = {
    /** Purpose: reject fixtures that accidentally exercise a replica-read shape.
     * @param mode Required primary-session constraint.
     * @returns This in-memory primary binding.
     */
    withSession(mode: string) { if (mode !== 'first-primary') throw new Error('Expected primary read'); return db; },
    /** Purpose: preserve real SQL constraints instead of mocking outcomes.
     * @param query Application SQL.
     * @returns A D1-shaped prepared statement.
     */
    prepare(query: string) {
      let args: any[] = [];
      const stmt = {
        /** Purpose: keep parameters separate from SQL text.
         * @param values Positional SQL parameters.
         * @returns The bound statement.
         */
        bind(...values: any[]) { args = values; return stmt; },
        /** Purpose: preserve D1's missing-row null contract.
         * @returns First real SQLite row or null.
         */
        async first() { return sql.prepare(query).get(...args) ?? null; },
        /** Purpose: expose D1's success witness and real query results.
         * @returns Success envelope containing all selected rows.
         */
        async all() { return { success: true, results: sql.prepare(query).all(...args) }; },
        /** Purpose: exercise actual SQL writes and trigger failures.
         * @returns SQLite mutation metadata in a D1 envelope.
         */
        async run() { return { success: true, meta: sql.prepare(query).run(...args) }; },
      };
      return stmt;
    },
  };
  return db as unknown as D1Database;
}
