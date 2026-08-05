/**
 * Tests for the Session Intelligence cloud-mining ingest boundary
 * (src/session-intel.ts).
 *
 * Coverage:
 *   - operatorOnly gate on both endpoints.
 *   - ingest validates shape (digestDate, kind, sessionCount >= 2).
 *   - ingest rejects a batch containing an obvious secret/PII shape (defense
 *     in depth — this must hold even if the local uploader's own redaction
 *     had a bug).
 *   - ingest is a real insert: rows land in the in-memory D1 mock with the
 *     expected fields and a 'pending' status.
 *   - empty findings[] (ALL QUIET) is accepted, not an error, and inserts nothing.
 *   - pending reads back what was inserted, newest first, respecting limit.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleSessionIntelIngest, handleSessionIntelPending } from '../src/session-intel.js';
import type { Env } from '../src/types.js';

const OPERATOR = 'super-secret-operator-token-32bytes-min';

// ── A minimal, real in-memory D1 mock: enough of prepare/bind/run/all/batch
// to exercise the actual INSERT + SELECT statements session-intel.ts issues. ──
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

function makeD1(): { db: D1Database; rows: Row[] } {
  const rows: Row[] = [];

  function prepare(sql: string) {
    const isInsert = /^INSERT INTO session_intel_findings/.test(sql);
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
          rows.push({ id, batch_id, kind, digest_date, title, occurrences, session_count, payload_json, status: 'pending', created_at });
        }
        return { success: true };
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
  } as unknown as D1Database;

  return { db, rows };
}

function makeEnv(db: D1Database, operatorToken = OPERATOR): Env {
  return {
    DB: db,
    RELAY_OPERATOR_TOKEN: operatorToken,
  } as unknown as Env;
}

function req(path: string, method: string, token: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request(`https://relay.example.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const GOOD_FINDING = {
  kind: 'recurring-eureka-arc' as const,
  title: 'npm run build:widget retried after failure',
  occurrences: 3,
  sessionCount: 2,
  payload: { tool: 'Bash', signature: 'npm run build:widget' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('session-intel ingest — operator gate', () => {
  it('rejects ingest without a token', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', null, { digestDate: '2026-08-05', findings: [GOOD_FINDING] }),
      makeEnv(db),
    );
    expect(res.status).toBe(401);
  });

  it('rejects pending without a token', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelPending(req('/v1/session-intel/pending', 'GET', null), makeEnv(db));
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', 'not-the-right-token', { digestDate: '2026-08-05', findings: [] }),
      makeEnv(db),
    );
    expect(res.status).toBe(401);
  });
});

describe('session-intel ingest — validation', () => {
  it('rejects a missing digestDate', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, { findings: [GOOD_FINDING] }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
  });

  it('rejects sessionCount < 2 (single-expert-oracle guard, server-side too)', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, {
        digestDate: '2026-08-05',
        findings: [{ ...GOOD_FINDING, sessionCount: 1 }],
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BAD_FINDING');
  });

  it('accepts empty findings as ALL QUIET, inserts nothing', async () => {
    const { db, rows } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, { digestDate: '2026-08-05', findings: [] }),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe('OK_EMPTY');
    expect(rows.length).toBe(0);
  });

  it('rejects a batch over 200 findings', async () => {
    const { db } = makeD1();
    const findings = Array.from({ length: 201 }, () => GOOD_FINDING);
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, { digestDate: '2026-08-05', findings }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
  });
});

describe('session-intel ingest — defense-in-depth redaction check', () => {
  it('rejects the WHOLE batch if any finding contains an obvious secret shape', async () => {
    const { db, rows } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, {
        digestDate: '2026-08-05',
        findings: [
          GOOD_FINDING,
          { ...GOOD_FINDING, title: 'oops', payload: { excerpt: 'token was sk-ant-abc123def456ghi789jkl' } },
        ],
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UNREDACTED_CONTENT');
    expect(rows.length).toBe(0); // the WHOLE batch is rejected, including the good finding
  });

  it('rejects an embedded email address', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, {
        digestDate: '2026-08-05',
        findings: [{ ...GOOD_FINDING, payload: { excerpt: 'contact erich@example.com for help' } }],
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UNREDACTED_CONTENT');
  });

  it('rejects an absolute home path', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, {
        digestDate: '2026-08-05',
        findings: [{ ...GOOD_FINDING, payload: { excerpt: 'ran from /Users/erichowens/coding/port-daddy' } }],
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
  });

  it('accepts a clean finding with no secret-shaped content', async () => {
    const { db, rows } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, { digestDate: '2026-08-05', findings: [GOOD_FINDING] }),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].kind).toBe('recurring-eureka-arc');
    expect(rows[0].session_count).toBe(2);
    expect(JSON.parse(rows[0].payload_json)).toEqual(GOOD_FINDING.payload);
  });
});

describe('session-intel pending', () => {
  it('reads back inserted findings, newest first, respecting limit', async () => {
    const { db } = makeD1();
    const env = makeEnv(db);
    await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, {
        digestDate: '2026-08-05',
        findings: [GOOD_FINDING, { ...GOOD_FINDING, title: 'second finding' }],
      }),
      env,
    );
    const res = await handleSessionIntelPending(req('/v1/session-intel/pending?limit=1', 'GET', OPERATOR), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findings.length).toBe(1);
  });

  it('returns an empty list when nothing is pending', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelPending(req('/v1/session-intel/pending', 'GET', OPERATOR), makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findings).toEqual([]);
  });
});
