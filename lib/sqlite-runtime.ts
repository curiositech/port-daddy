/**
 * SQLite runtime adapter.
 *
 * Re-exports a Database class that is API-compatible with better-sqlite3,
 * picking the underlying engine based on the host runtime:
 *
 *   - Bun runtime (bun:sqlite, ships in the Bun binary)
 *   - Node runtime (better-sqlite3, native binding via prebuildify)
 *
 * Why: bun build --compile cannot bundle better-sqlite3 because the
 * bindings package walks parent dirs for package.json to find
 * build/Release/better_sqlite3.node — and Bun's compiled-binary virtual
 * filesystem has no package.json to walk to. bun:sqlite is built into
 * the Bun runtime itself, so the compiled daemon needs no external
 * native bindings. See ADR-0028 for the migration rationale.
 *
 * Compatibility surface (the methods this codebase actually calls):
 *
 *   new Database(path, opts?) ......... .prepare() .exec() .close()
 *   .pragma(stmt, opts?) .............. .transaction(fn)
 *
 * better-sqlite3 has .pragma(); bun:sqlite does not. We add a shim that
 * routes setter/getter/function-pragma forms to the right bun:sqlite
 * primitives.
 */

import type BetterSqliteDatabase from 'better-sqlite3';
import { createRequire } from 'node:module';

type DatabaseConstructor = typeof BetterSqliteDatabase;

/**
 * Type alias for an open DB handle. better-sqlite3 declares this as
 * `Database.Database` (namespace.interface), but better-sqlite3 uses
 * CommonJS `export =` which cannot be re-exported as a namespace from
 * an ESM module. So we expose a flat `DatabaseInstance` alias instead;
 * callers should `import type { DatabaseInstance } from './sqlite-runtime.js'`.
 */
export type DatabaseInstance = BetterSqliteDatabase.Database;

const isBun: boolean = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

const require = createRequire(import.meta.url);

let DatabaseClass: DatabaseConstructor;

if (isBun) {
  // bun:sqlite is a Bun built-in. createRequire resolves it to the
  // runtime-provided module without involving node_modules.
  const bunSqlite = require('bun:sqlite') as {
    Database: new (path: string, opts?: unknown) => unknown;
  };
  const BunDatabase = bunSqlite.Database;

  class CompatDatabase extends (BunDatabase as new (
    path: string,
    opts?: unknown
  ) => Record<string, unknown>) {
    /**
     * better-sqlite3 .pragma() compatibility shim.
     *
     * Three call shapes used in the codebase:
     *   db.pragma('foreign_keys = ON')              // setter, return ignored
     *   db.pragma('journal_mode', { simple: true }) // getter, returns scalar
     *   db.pragma('wal_checkpoint(TRUNCATE)')       // function-pragma
     */
    pragma(stmt: string, options?: { simple?: boolean }): unknown {
      const trimmed = stmt.trim();
      const self = this as unknown as {
        exec: (sql: string) => void;
        query: (sql: string) => { all: () => unknown[] };
      };

      // Setter form: 'foreign_keys = ON' (must contain `=` not at the end).
      if (/=/.test(trimmed) && !/=\s*$/.test(trimmed)) {
        self.exec(`PRAGMA ${trimmed};`);
        return [];
      }

      // Function-pragma form: 'wal_checkpoint(TRUNCATE)'.
      if (/\(/.test(trimmed)) {
        self.exec(`PRAGMA ${trimmed};`);
        return [];
      }

      // Getter form: 'journal_mode', 'integrity_check'.
      const rows = self.query(`PRAGMA ${trimmed};`).all();

      if (options?.simple) {
        if (!Array.isArray(rows) || rows.length === 0) return undefined;
        const first = rows[0] as Record<string, unknown>;
        const values = Object.values(first);
        return values[0];
      }
      return rows;
    }
  }

  DatabaseClass = CompatDatabase as unknown as DatabaseConstructor;
} else {
  // Node (tests, dev). Use better-sqlite3 with its native binding.
  DatabaseClass = require('better-sqlite3') as DatabaseConstructor;
}

export default DatabaseClass;
