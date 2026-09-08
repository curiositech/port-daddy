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
import { OPERATOR, makeD1, makeEnv } from './session-intel-fixtures.js';

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

  it('rejects a base64-encoded secret shape (flagged by pd-purser adversarial tests)', async () => {
    const { db, rows } = makeD1();
    const encoded = Buffer.from('token: sk-ant-abc123def456ghi789jkl').toString('base64');
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, {
        digestDate: '2026-08-05',
        findings: [{ ...GOOD_FINDING, payload: { excerpt: encoded } }],
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UNREDACTED_CONTENT');
    expect(rows.length).toBe(0);
  });

  it('does not false-positive on ordinary base64-shaped strings with no secret inside', async () => {
    const { db, rows } = makeD1();
    const encoded = Buffer.from('just an ordinary excerpt of build output, nothing sensitive here').toString('base64');
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, {
        digestDate: '2026-08-05',
        findings: [{ ...GOOD_FINDING, payload: { excerpt: encoded } }],
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    expect(rows.length).toBe(1);
  });
});

describe('session-intel ingest — idempotency', () => {
  it('re-ingesting the same digest twice does not duplicate rows', async () => {
    const { db, rows } = makeD1();
    const env = makeEnv(db);
    const body = { digestDate: '2026-08-05', findings: [GOOD_FINDING] };
    const first = await handleSessionIntelIngest(req('/v1/session-intel/ingest', 'POST', OPERATOR, body), env);
    const second = await handleSessionIntelIngest(req('/v1/session-intel/ingest', 'POST', OPERATOR, body), env);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.accepted).toBe(1);
    expect(secondBody.accepted).toBe(0); // OR IGNORE absorbed the retry
    expect(rows.length).toBe(1); // still exactly one row, not two
  });

  it('5 concurrent identical ingests still land exactly one row (flagged by pd-purser adversarial tests)', async () => {
    // Every concurrent request legitimately succeeds at the HTTP layer --
    // that's the correct idempotent-POST contract (a retry is not an error).
    // The real dedup signal is `accepted` and the row count, not the HTTP
    // status: only ONE request's insert should actually land.
    const { db, rows } = makeD1();
    const env = makeEnv(db);
    const body = { digestDate: '2026-08-05', findings: [GOOD_FINDING] };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => handleSessionIntelIngest(req('/v1/session-intel/ingest', 'POST', OPERATOR, body), env)),
    );
    expect(results.every(r => r.status === 200)).toBe(true);
    const bodies = await Promise.all(results.map(r => r.json()));
    const totalAccepted = bodies.reduce((sum: number, b: any) => sum + b.accepted, 0);
    expect(totalAccepted).toBe(1); // exactly one of the 5 was the real insert
    expect(rows.length).toBe(1); // and exactly one row landed, not five
  });

  it('the same (digestDate, kind, title) produces the same id across independent ingest calls', async () => {
    const { db: db1, rows: rows1 } = makeD1();
    const { db: db2, rows: rows2 } = makeD1();
    const body = { digestDate: '2026-08-05', findings: [GOOD_FINDING] };
    await handleSessionIntelIngest(req('/v1/session-intel/ingest', 'POST', OPERATOR, body), makeEnv(db1));
    await handleSessionIntelIngest(req('/v1/session-intel/ingest', 'POST', OPERATOR, body), makeEnv(db2));
    expect(rows1[0].id).toBe(rows2[0].id); // deterministic, not random
  });

  it('a different title on the same day produces a different id (no false collision)', async () => {
    const { db, rows } = makeD1();
    const env = makeEnv(db);
    await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, { digestDate: '2026-08-05', findings: [GOOD_FINDING] }),
      env,
    );
    await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, { digestDate: '2026-08-05', findings: [{ ...GOOD_FINDING, title: 'a different finding' }] }),
      env,
    );
    expect(rows.length).toBe(2);
    expect(rows[0].id).not.toBe(rows[1].id);
  });
});

describe('session-intel ingest — date validation', () => {
  it('rejects an impossible date like 2026-99-99', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, { digestDate: '2026-99-99', findings: [GOOD_FINDING] }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a date that JS would silently roll over (2026-02-30)', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, { digestDate: '2026-02-30', findings: [GOOD_FINDING] }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
  });

  it('accepts a real leap-day date (2028-02-29)', async () => {
    const { db } = makeD1();
    const res = await handleSessionIntelIngest(
      req('/v1/session-intel/ingest', 'POST', OPERATOR, { digestDate: '2028-02-29', findings: [GOOD_FINDING] }),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
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
