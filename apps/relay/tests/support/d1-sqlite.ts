/**
 * A D1-shaped facade over an in-memory `node:sqlite` database, built by
 * applying the relay's real migration chain.
 *
 * WHY A REAL DATABASE AND NOT A MOCK. The Snipe approval gate's guarantees are
 * SQL guarantees: a conditional UPDATE that matches zero rows, a PRIMARY KEY
 * that forbids a second grant, a UNIQUE that forbids a duplicate suggestion, a
 * CHECK that forbids an unknown status. A hand-rolled mock answers whatever the
 * test author expected it to answer, so a test written against one proves the
 * author's belief about the schema rather than the schema. Here the constraints
 * are the ones that will ship.
 *
 * Faithfulness notes, all deliberate:
 *   · `first()` returns `null` for "no row" (node:sqlite returns undefined).
 *   · `run()` returns `{ success, meta: { changes } }`, the shape the relay's
 *     code reads.
 *   · `PRAGMA foreign_keys = ON`, so a REFERENCES violation throws here exactly
 *     as it would in D1.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const APP_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const MIGRATIONS_DIR = join(APP_ROOT, 'migrations');
export const SCHEMA_SQL = join(APP_ROOT, 'schema.sql');

/** Migration filenames, in the lexicographic order Wrangler applies them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith('.sql'))
    .sort();
}

export interface TestD1 {
  db: D1Database;
  raw: DatabaseSync;
  /** Every SQL string the code under test prepared, in order. */
  calls: string[];
  close(): void;
}

/**
 * Build a fresh database with the migration chain applied.
 *
 * `exclude` omits named files, which is how a rollback-compatibility test
 * reconstructs the schema as the PREVIOUS Worker release knew it.
 */
export function makeTestD1(exclude: readonly string[] = []): TestD1 {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const name of migrationFiles()) {
    if (exclude.includes(name)) continue;
    raw.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
  }
  const calls: string[] = [];

  const prepare = (sql: string): D1PreparedStatement => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        bound = v;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        calls.push(sql);
        const row = raw.prepare(sql).get(...(bound as never[]));
        return (row ?? null) as T | null;
      },
      async all<T>(): Promise<{ results: T[]; success: boolean }> {
        calls.push(sql);
        return { results: raw.prepare(sql).all(...(bound as never[])) as T[], success: true };
      },
      async run() {
        calls.push(sql);
        const r = raw.prepare(sql).run(...(bound as never[]));
        return { success: true, meta: { changes: Number(r.changes) } };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };

  return {
    db: { prepare } as unknown as D1Database,
    raw,
    calls,
    close() {
      raw.close();
    },
  };
}

/**
 * Insert a user + a live web session.
 *
 * Pass `sealed` to give the session a decryptable GitHub user-to-server token
 * — `resolveSession` unwraps it, and the tenancy gates (`userOwnsInstallation`)
 * fail closed without one, so a handler under test would 403 for the wrong
 * reason.
 */
export function seedSession(
  t: TestD1,
  m: {
    userId?: string;
    login?: string;
    tokenHash: string;
    now?: number;
    sealed?: { enc: string; iv: string };
  },
): { userId: string; login: string } {
  const userId = m.userId ?? 'u_1';
  const login = m.login ?? 'octocat';
  // Real wall-clock by default: resolveSession compares expires_at against
  // Date.now(), so a fixed epoch would seed a session that is already expired
  // and every gated handler would 401 for the wrong reason.
  const now = m.now ?? Math.floor(Date.now() / 1000);
  t.raw
    .prepare(
      'INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, ?, ?, ?, 0)',
    )
    .run(userId, Math.floor(Math.random() * 1_000_000) + 1, login, now);
  t.raw
    .prepare(
      'INSERT INTO web_sessions (token_hash, user_id, gh_token_enc, gh_token_iv, created_at, expires_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(m.tokenHash, userId, m.sealed?.enc ?? null, m.sealed?.iv ?? null, now, now + 7 * 24 * 3600);
  return { userId, login };
}

/** Insert one suggestion row directly, bypassing the job. */
export function seedSuggestion(
  t: TestD1,
  m: {
    id: string;
    userId: string;
    repo: string;
    skillName: string;
    status?: string;
    now?: number;
    description?: string;
    rationale?: string;
  },
): void {
  const now = m.now ?? 1_760_000_000;
  t.raw
    .prepare(
      'INSERT INTO seamanship_suggestions (id, user_id, repo_full_name, skill_name, description, ' +
        'rationale, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      m.id,
      m.userId,
      m.repo,
      m.skillName,
      m.description ?? 'does a thing. NOT for other things (use something-else).',
      m.rationale ?? 'this repo keeps hand-rolling it',
      m.status ?? 'proposed',
      now,
      now,
    );
}

/** Read one suggestion row back, as plain data. */
export function readSuggestion(t: TestD1, id: string): Record<string, unknown> | undefined {
  return t.raw.prepare('SELECT * FROM seamanship_suggestions WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
}

/**
 * A Map-backed KV. Faithful where it matters: an unknown key reads as `null`
 * (not as some stub's catch-all value), so a cache MISS behaves like a miss and
 * the code under test takes its real fallback path.
 */
export function makeKV(seed: Record<string, string> = {}): KVNamespace {
  const store = new Map(Object.entries(seed));
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}
