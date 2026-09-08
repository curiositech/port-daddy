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
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

/** Load a committed migration, minus FKs to tables the test did not create. */
export function migration(name: string, opts: { dropForeignKeys?: boolean } = {}): string {
  const path = fileURLToPath(new URL(`../../migrations/${name}`, import.meta.url));
  const sql = readFileSync(path, 'utf8');
  return opts.dropForeignKeys ? sql.replace(/\s+REFERENCES \w+\([^)]*\)/g, '') : sql;
}

export function makeDb(...schemas: string[]): TestDb {
  const raw = new DatabaseSync(':memory:');
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
