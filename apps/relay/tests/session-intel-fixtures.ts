/**
 * Shared in-memory D1 + Env fixtures for session-intel tests.
 *
 * Extracted out of session-intel.test.ts so pd-purser's adversarial contract
 * tests (tests/purser/*.test.js, stacked onto this PR via #5628) can import
 * the SAME real mock this suite uses, instead of a second hand-rolled one
 * that could silently drift from the actual INSERT/SELECT shape
 * src/session-intel.ts issues.
 */

import type { Env } from '../src/types.js';

export const OPERATOR = 'super-secret-operator-token-32bytes-min';

interface Row {
  id: string;
  batch_id: string;
  kind: string;
  digest_date: string;
  title: string;
  occurrences: number;
  session_count: number;
  payload_json: string;
  status: string;
  created_at: number;
}

export function makeD1(): { db: D1Database; rows: Row[] } {
  const rows: Row[] = [];

  function prepare(sql: string) {
    // `INSERT OR IGNORE INTO ...` — real SQL in session-intel.ts as of the
    // deterministic-id fix; matches with or without the OR IGNORE modifier.
    const isInsert = /^INSERT (?:OR IGNORE )?INTO session_intel_findings/.test(sql);
    const isSelect = /^SELECT/.test(sql) && sql.includes('FROM session_intel_findings');
    let boundArgs: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => {
        boundArgs = args;
        return stmt;
      },
      run: async () => {
        if (isInsert) {
          // 9 bound placeholders — `status` is a literal 'pending' in the SQL
          // itself, not a `?`, matching the real INSERT in session-intel.ts.
          const [id, batch_id, kind, digest_date, title, occurrences, session_count, payload_json, created_at] = boundArgs as [
            string, string, string, string, string, number, number, string, number,
          ];
          // OR IGNORE semantics: a duplicate primary key is a no-op (0 changes),
          // same as real SQLite/D1 — this is what makes the idempotency test
          // (re-ingest same day -> no duplicate row) actually mean something.
          if (rows.some(r => r.id === id)) {
            return { success: true, meta: { changes: 0 } };
          }
          rows.push({ id, batch_id, kind, digest_date, title, occurrences, session_count, payload_json, status: 'pending', created_at });
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
      all: async () => {
        if (isSelect) {
          const limit = boundArgs[0] as number;
          const results = [...rows]
            .filter(r => r.status === 'pending')
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, limit);
          return { results, success: true };
        }
        return { results: [], success: true };
      },
    };
    return stmt;
  }

  const db = {
    prepare,
    batch: async (stmts: ReturnType<typeof prepare>[]) => {
      const results = [];
      for (const s of stmts) results.push(await (s as unknown as { run: () => Promise<unknown> }).run());
      return results;
    },
    // Also exposed on `db` itself (not just as the sibling `rows` return
    // value) so callers that only destructure `{ db }` can still assert on
    // `db.rows` -- both access patterns point at the same live array.
    rows,
  } as unknown as D1Database;

  return { db, rows };
}

export function makeEnv(db: D1Database, operatorToken = OPERATOR): Env {
  return {
    DB: db,
    RELAY_OPERATOR_TOKEN: operatorToken,
  } as unknown as Env;
}
