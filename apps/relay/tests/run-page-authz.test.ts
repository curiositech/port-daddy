/**
 * ADR-0101 Phase 1 additions to the run page (src/fleet-run-page.ts):
 *   - Z1 versioned capability tokens: `v1.<hmac>` accepted; legacy bare `<hmac>`
 *     still accepted (grace); RUN_PAGE_SECRET_PREV accepted for both forms
 *     during rotation; wrong secret rejected.
 *   - Session authz: a signed-in user opens the page iff GitHub says they can
 *     read the run's repo; no session or no access → the same 404.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  handleFleetRunPage,
  handleFleetRunTranscript,
  handleFleetRunTranscriptPage,
  runPageToken,
} from '../src/fleet-run-page.js';
import { hashHex, fromHex, base64UrlEncode } from '../src/crypto.js';
import type { Env } from '../src/types.js';
import type { FleetRunRow, FleetRunStepRow } from '../src/db.js';

/** Seal a token the way auth-github.sealToken does, so resolveSession decrypts it. */
async function sealForTest(token: string): Promise<{ enc: string; iv: string }> {
  const key = await crypto.subtle.importKey('raw', fromHex(WRAP_KEY), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)));
  return { enc: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

const SECRET = 'run-page-secret-that-is-at-least-32-chars';
const PREV = 'previous-run-page-secret-at-least-32-chars';
const WRAP_KEY = 'bb'.repeat(32);
const RUN_ID = 'run:d-1';
const BASE = 'https://relay.example';

function makeRun(repoFullName = 'acme/widgets'): FleetRunRow {
  return {
    id: RUN_ID, delivery_id: 'd-1', repo_full_name: repoFullName, pr_number: 3,
    pr_url: 'https://github.com/acme/widgets/pull/3', head_sha: 'abcdef1234567890',
    conclusion: 'success', ships_csv: 'code-reviewer', neurons: 10, ms: 1000, created_at: 1_700_000_000,
  };
}

// D1 that returns the run + one step, plus a web_sessions/users lookup for a
// single seeded session token hash.
function makeDb(sessionHash?: string, sealed?: { enc: string; iv: string }, repoFullName?: string) {
  const steps: FleetRunStepRow[] = [
    { run_id: RUN_ID, seq: 1, kind: 'ship-verdict', ship: 'code-reviewer', title: 'PASS', detail: null, created_at: 1_700_000_005 },
  ];
  const stmt = (sql: string) => {
    let bound: any[] = [];
    const s = {
      bind(...v: any[]) { bound = v; return s; },
      async first<T>(): Promise<T | null> {
        if (sql.startsWith('SELECT user_id, gh_token_enc')) {
          return (sessionHash && bound[0] === sessionHash
            ? { user_id: 'u_1', gh_token_enc: sealed?.enc ?? null, gh_token_iv: sealed?.iv ?? null, expires_at: 2_000_000_000 }
            : null) as T | null;
        }
        if (sql.includes('FROM users WHERE id')) {
          return { id: 'u_1', github_user_id: 1, login: 'octocat', display_name: null, avatar_url: null, primary_email: null, email_verified: 0, created_at: 0, last_login_at: 0, deleted_at: null } as T;
        }
        if (sql.includes('FROM fleet_runs WHERE id')) return makeRun(repoFullName) as T;
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('fleet_run_transcripts')) {
          return { results: [{ ship: 'qa', attempt: 1, r2_key: 'v1/run/qa.1.jsonl' }] as unknown as T[] };
        }
        return { results: steps as unknown as T[] };
      },
      async run() { return { success: true }; },
    };
    return s as unknown as D1PreparedStatement;
  };
  return { prepare: stmt } as unknown as D1Database;
}

function makeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

function makeEnv(over: Partial<Env> = {}, db = makeDb()): Env {
  return {
    DB: db, KV: makeKV(),
    RELAY_OPERATOR_TOKEN: 'operator-token-at-least-32-bytes-long!!',
    RUN_PAGE_SECRET: SECRET,
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY, PUBLIC_BASE_URL: BASE,
    GITHUB_OAUTH_CLIENT_ID: 'x', GITHUB_OAUTH_CLIENT_SECRET: 'y',
    ...over,
  } as unknown as Env;
}

function pageReq(t?: string, cookie?: string): Request {
  const url = new URL(`${BASE}/fleet/runs/${encodeURIComponent(RUN_ID)}`);
  if (t) url.searchParams.set('t', t);
  return new Request(url, cookie ? { headers: { Cookie: cookie } } : {});
}

afterEach(() => vi.unstubAllGlobals());

describe('Z1 versioned run-page tokens', () => {
  it('accepts v1.<hmac> and the legacy bare <hmac>', async () => {
    const hmac = await runPageToken(SECRET, RUN_ID);
    const env = makeEnv();
    expect((await handleFleetRunPage(pageReq(`v1.${hmac}`), env, RUN_ID)).status).toBe(200);
    expect((await handleFleetRunPage(pageReq(hmac), env, RUN_ID)).status).toBe(200);
  });

  it('accepts a token signed by RUN_PAGE_SECRET_PREV during rotation (both forms)', async () => {
    const prevHmac = await runPageToken(PREV, RUN_ID);
    const env = makeEnv({ RUN_PAGE_SECRET_PREV: PREV });
    expect((await handleFleetRunPage(pageReq(`v1.${prevHmac}`), env, RUN_ID)).status).toBe(200);
    expect((await handleFleetRunPage(pageReq(prevHmac), env, RUN_ID)).status).toBe(200);
  });

  it('rejects a token signed by an unrelated secret (404)', async () => {
    const bad = await runPageToken('some-other-secret-that-is-32-chars-long!', RUN_ID);
    expect((await handleFleetRunPage(pageReq(`v1.${bad}`), makeEnv(), RUN_ID)).status).toBe(404);
    expect((await handleFleetRunPage(pageReq(bad), makeEnv(), RUN_ID)).status).toBe(404);
  });
});

describe('session-gated run pages', () => {
  it('a signed-in user who can read the repo opens the page without a token', async () => {
    const cookieValue = 'sess-value-abc';
    const sealed = await sealForTest('gho_token');
    const env = makeEnv({}, makeDb(hashHex(cookieValue), sealed));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 }))); // repo read OK
    const res = await handleFleetRunPage(pageReq(undefined, `__Host-pd_session=${cookieValue}`), env, RUN_ID);
    expect(res.status).toBe(200);
  });

  it('a signed-in user who CANNOT read the repo gets the same 404', async () => {
    const cookieValue = 'sess-value-abc';
    const sealed = await sealForTest('gho_token');
    const env = makeEnv({}, makeDb(hashHex(cookieValue), sealed));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 }))); // no repo access
    const res = await handleFleetRunPage(pageReq(undefined, `__Host-pd_session=${cookieValue}`), env, RUN_ID);
    expect(res.status).toBe(404);
  });

  it('no session and no token → 404', async () => {
    const res = await handleFleetRunPage(pageReq(), makeEnv(), RUN_ID);
    expect(res.status).toBe(404);
  });
});

// The transcript surfaces (HTML viewer + raw .jsonl) authorize through the
// shared authorizedForRun — the SAME three credentials as the receipt. These
// tests pin the session leg of that contract: signed-in-with-repo-read opens
// both surfaces, signed-in-WITHOUT-repo-read gets the indistinguishable 404.
describe('session-gated transcript surfaces (authorizedForRun)', () => {
  const TURN = JSON.stringify({
    v: 1, seq: 0, phase: 'map', chunk: null, kind: 'assistant', model: 'm', ts: 1_700_000_000,
    latencyMs: 10, usage: null, costUsd: null, content: [{ type: 'text', text: 'hello' }],
    sysRef: null, truncated: false,
  }) + '\n';

  function transcriptsBucket(): unknown {
    return {
      get: async (key: string) =>
        key === 'v1/run/qa.1.jsonl' ? ({ body: TURN, text: async () => TURN } as unknown) : null,
    };
  }

  function transcriptReq(path: string, cookie?: string): Request {
    return new Request(`${BASE}${path}`, cookie ? { headers: { Cookie: cookie } } : {});
  }

  it('a signed-in user who can read the repo opens the viewer AND the raw .jsonl', async () => {
    const cookieValue = 'sess-value-abc';
    const sealed = await sealForTest('gho_token');
    const env = makeEnv({ TRANSCRIPTS: transcriptsBucket() as never }, makeDb(hashHex(cookieValue), sealed));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 }))); // repo read OK
    const cookie = `__Host-pd_session=${cookieValue}`;
    const page = await handleFleetRunTranscriptPage(
      transcriptReq(`/fleet/runs/${encodeURIComponent(RUN_ID)}/transcript/qa`, cookie), env, RUN_ID, 'qa');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('raw session transcript');
    const raw = await handleFleetRunTranscript(
      transcriptReq(`/fleet/runs/${encodeURIComponent(RUN_ID)}/transcript/qa.jsonl`, cookie), env, RUN_ID, 'qa');
    expect(raw.status).toBe(200);
  });

  it('a signed-in user who CANNOT read the repo gets the same 404 on both surfaces', async () => {
    const cookieValue = 'sess-value-abc';
    const sealed = await sealForTest('gho_token');
    const env = makeEnv({ TRANSCRIPTS: transcriptsBucket() as never }, makeDb(hashHex(cookieValue), sealed));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 }))); // no repo access
    const cookie = `__Host-pd_session=${cookieValue}`;
    expect(
      (await handleFleetRunTranscriptPage(
        transcriptReq(`/fleet/runs/${encodeURIComponent(RUN_ID)}/transcript/qa`, cookie), env, RUN_ID, 'qa')).status,
    ).toBe(404);
    expect(
      (await handleFleetRunTranscript(
        transcriptReq(`/fleet/runs/${encodeURIComponent(RUN_ID)}/transcript/qa.jsonl`, cookie), env, RUN_ID, 'qa')).status,
    ).toBe(404);
  });

  it('a run with an EMPTY repo_full_name refuses the session path without ever asking GitHub', async () => {
    const cookieValue = 'sess-value-abc';
    const sealed = await sealForTest('gho_token');
    const env = makeEnv(
      { TRANSCRIPTS: transcriptsBucket() as never },
      makeDb(hashHex(cookieValue), sealed, ''), // '' .split('/') → [''] — falsy owner refuses
    );
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleFleetRunTranscriptPage(
      transcriptReq(`/fleet/runs/${encodeURIComponent(RUN_ID)}/transcript/qa`, `__Host-pd_session=${cookieValue}`),
      env, RUN_ID, 'qa');
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
