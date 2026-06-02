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

/**
 * Pure pragma router for the bun:sqlite shim — exported so unit tests
 * can verify dispatch without a live Bun runtime.
 *
 * Routes between three better-sqlite3 call shapes:
 *
 *   - Setter:        `foreign_keys = ON`        → execSql('PRAGMA …'), return []
 *   - Function form: `wal_checkpoint(TRUNCATE)` → execSql('PRAGMA …'), return []
 *   - Getter:        `journal_mode`             → querySql('PRAGMA …').all(),
 *                                                 extract scalar when
 *                                                 `{ simple: true }` is passed
 *
 * The getter scalar extraction takes `Object.values(rows[0])[0]`. This
 * survives a column-name divergence between SQLite versions or
 * implementations: regardless of whether the result row is shaped
 * `{ journal_mode: 'wal' }` or anything else, the first value mirrors
 * what better-sqlite3 returns under `{ simple: true }`.
 */
export function executeBunPragma(
  execSql: (sql: string) => void,
  querySql: (sql: string) => { all: () => unknown[] },
  stmt: string,
  options?: { simple?: boolean },
): unknown {
  const trimmed = stmt.trim();

  // Setter form: 'foreign_keys = ON' (must contain `=` not at the end).
  if (/=/.test(trimmed) && !/=\s*$/.test(trimmed)) {
    execSql(`PRAGMA ${trimmed};`);
    return [];
  }

  // Function-pragma form: 'wal_checkpoint(TRUNCATE)'.
  if (/\(/.test(trimmed)) {
    execSql(`PRAGMA ${trimmed};`);
    return [];
  }

  // Getter form: 'journal_mode', 'integrity_check'.
  const rows = querySql(`PRAGMA ${trimmed};`).all();

  if (options?.simple) {
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const first = rows[0] as Record<string, unknown>;
    const values = Object.values(first);
    return values[0];
  }
  return rows;
}

/**
 * Translate better-sqlite3 constructor options into bun:sqlite options.
 *
 * better-sqlite3 accepts `{ readonly?, fileMustExist?, ... }`. bun:sqlite
 * accepts `{ readonly?, readwrite?, create?, ... }` and — critically — throws
 * `SQLITE_MISUSE: flags must include SQLITE_OPEN_READONLY or
 * SQLITE_OPEN_READWRITE` if it cannot derive a read/write flag. Passing
 * better-sqlite3's `{ readonly: false, fileMustExist: true }` straight through
 * left bun:sqlite with neither flag set, so any caller that opened a DB
 * read-write with explicit options crashed under the shipped (bun) runtime
 * while passing under jest (better-sqlite3). This pure function bridges the
 * gap; exported so it can be unit-tested without a live Bun runtime.
 *
 *   - readonly: true            → { readonly: true }
 *   - readonly: false (or unset)→ { readwrite: true, create: !fileMustExist }
 *   - fileMustExist: true       → do NOT create a missing file (create: false)
 *   - fileMustExist: false/unset→ allow creation (create: true) for read-write
 *
 * Unknown keys are passed through untouched so future options still flow.
 */
export function translateBunOptions(opts?: unknown): Record<string, unknown> | undefined {
  if (opts === undefined || opts === null) return undefined;
  if (typeof opts !== 'object') return opts as Record<string, unknown>;
  const o = opts as Record<string, unknown>;
  const { readonly, fileMustExist, ...rest } = o;
  const out: Record<string, unknown> = { ...rest };
  if (readonly === true) {
    out.readonly = true;
  } else {
    out.readwrite = true;
    out.create = fileMustExist === true ? false : true;
  }
  return out;
}

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
    constructor(path: string, opts?: unknown) {
      // Bridge better-sqlite3 option names to bun:sqlite's flag model so
      // callers that open read-write with explicit options don't trip
      // SQLITE_MISUSE under the shipped runtime.
      super(path, translateBunOptions(opts));
    }

    /**
     * better-sqlite3 .pragma() compatibility shim. Routing logic lives
     * in `executeBunPragma()` so it can be unit-tested without a live
     * Bun runtime.
     */
    pragma(stmt: string, options?: { simple?: boolean }): unknown {
      const self = this as unknown as {
        exec: (sql: string) => void;
        query: (sql: string) => { all: () => unknown[] };
      };
      return executeBunPragma(
        self.exec.bind(self),
        self.query.bind(self),
        stmt,
        options,
      );
    }
  }

  DatabaseClass = CompatDatabase as unknown as DatabaseConstructor;
} else {
  // Node (tests, dev). Use better-sqlite3 with its native binding.
  DatabaseClass = require('better-sqlite3') as DatabaseConstructor;
}

export default DatabaseClass;
