/**
 * A D1Database over node:sqlite, for tests that want the real code path.
 *
 * WHY THIS EXISTS. A hand-written fake D1 answers queries by reimplementing
 * what the query means, so a test built on one proves the fake works and
 * leaves the shipped SQL unexamined — the failure work-register.test.ts named
 * in place of a green tick. D1 is SQLite and node:sqlite is SQLite, so the
 * honest fix is an adapter, not a stand-in: the statements under test run
 * against a real engine over the committed migrations, and nothing here knows
 * what any of them mean.
 *
 * WHAT IT IS NOT. It is not D1. There is no network, no replication, and
 * `batch()` here is a transaction rather than D1's remote batch. That is
 * enough for statement semantics — which row wins, which constraint bites,
 * what `changes` comes back — and not enough for anything about latency,
 * concurrency across isolates, or D1's own limits. Tests that care about those
 * belong on the staging deploy, and should say so rather than reaching here.
 *
 * ONE ADAPTER, NOT TWO. roadmap-mirror.test.ts grew its own `makeRealDb` first
 * and this file was written second, in ignorance of it — two adapters over the
 * same engine, which is the sort of duplication that ends with the two
 * disagreeing about `batch()` and one suite passing on a semantic the other
 * would have caught. They are folded here, and the version kept is the older
 * one's: `applyAllMigrations()` loads the WHOLE committed chain in filename
 * order, exactly as `check-migrations.mjs` does, so a test cannot pass against
 * a schema fragment that production never sees.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

type Row = Record<string, unknown>;

/** Values SQLite can bind. Anything else is a test bug worth a loud failure. */
function bindable(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

class Stmt {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly args: unknown[] = [],
  ) {}

  bind(...args: unknown[]): Stmt {
    return new Stmt(this.db, this.sql, args.map(bindable));
  }

  async first<T = Row>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.args as never[]));
    return (row as T) ?? null;
  }

  async all<T = Row>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const res = this.db.prepare(this.sql).run(...(this.args as never[]));
    return { meta: { changes: Number(res.changes ?? 0) } };
  }
}

export interface TestDb {
  /** The D1-shaped handle to hand to an `Env`. */
  DB: unknown;
  /** The engine underneath, for arranging fixtures and reading state back. */
  raw: DatabaseSync;
  exec(sql: string): void;
}

/** Load one committed migration, minus FKs to tables the test did not create. */
export function migration(name: string, opts: { dropForeignKeys?: boolean } = {}): string {
  const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
  return opts.dropForeignKeys ? sql.replace(/\s+REFERENCES \w+\([^)]*\)/g, '') : sql;
}

/**
 * Every committed migration, in filename order — the same order
 * `check-migrations.mjs` and the deploy use.
 *
 * Prefer this over naming one migration. A test that loads a single file is
 * testing against a schema that has never existed anywhere: the table it wants
 * may be there, but the foreign keys pointing at the rest of the database are
 * not, so a constraint that would bite in production cannot bite in the test.
 * Reach for `migration()` alone only when a test is specifically about one
 * file's contents.
 *
 * @returns The concatenated chain, ready to hand to `makeDb`.
 */
export function applyAllMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');
}

/**
 * A database with the given schemas applied, and foreign keys ON.
 *
 * Foreign keys are enforced because the migrations declare them and a test that
 * silently ignored them would let a row exist that production would refuse.
 *
 * @param schemas - SQL to apply in order, typically `applyAllMigrations()`.
 * @returns The D1-shaped handle, the engine under it, and a raw `exec`.
 */
export function makeDb(...schemas: string[]): TestDb {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const s of schemas) raw.exec(s);
  const DB = {
    prepare: (sql: string) => new Stmt(raw, sql),
    async batch(statements: Stmt[]) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return { DB, raw, exec: (sql: string) => raw.exec(sql) };
}
