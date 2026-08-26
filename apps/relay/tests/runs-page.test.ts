/**
 * Tests for the per-account fleet-runs index (src/runs-page.ts, ADR-0101):
 *   - session gate: no cookie → 302 /login (same as /account).
 *   - authz filter: only runs in repos GitHub says the user can read appear;
 *     unreadable repos' runs are absent, and readability is probed once per
 *     DISTINCT repo (per-request cache).
 *   - distinct-repo probe cap: at most MAX_REPO_CHECKS repos are checked and
 *     the page honestly announces the truncation.
 *   - XSS guard: hostile repo names / ship lists render escaped.
 *   - transport: no-store + noindex + script-free CSP.
 *   - empty state teaches instead of fabricating rows.
 *
 * Idioms follow run-page-authz.test.ts: hand-rolled D1/KV mocks, a sealed
 * gh-token so resolveSession yields a usable session, and a stubbed global
 * fetch standing in for GitHub's GET /repos/:owner/:repo.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleRunsPage, MAX_REPO_CHECKS, renderRunsPage } from '../src/runs-page.js';
import { hashHex, fromHex, base64UrlEncode } from '../src/crypto.js';
import type { Env } from '../src/types.js';
import type { FleetRunRow } from '../src/db.js';
import type { FleetRunProjection } from '../src/fleet-run-intents.js';

const WRAP_KEY = 'bb'.repeat(32);
const BASE = 'https://relay.example';
const COOKIE_VALUE = 'sess-value-abc';

/** Seal a token the way auth-github.sealToken does, so resolveSession decrypts it. */
async function sealForTest(token: string): Promise<{ enc: string; iv: string }> {
  const key = await crypto.subtle.importKey('raw', fromHex(WRAP_KEY), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
  );
  return { enc: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

function makeRun(over: Partial<FleetRunRow> = {}): FleetRunRow {
  return {
    id: 'run:d-1',
    delivery_id: 'd-1',
    repo_full_name: 'acme/widgets',
    pr_number: 3,
    pr_url: 'https://github.com/acme/widgets/pull/3',
    head_sha: 'abcdef1234567890',
    conclusion: 'success',
    ships_csv: 'code-reviewer',
    neurons: 10,
    ms: 61_000,
    created_at: Math.floor(Date.now() / 1000) - 3600,
    ...over,
  };
}

/**
 * D1 mock answering exactly the three queries this page path issues:
 * web_sessions lookup, users lookup, and the fleet_runs list.
 */
function makeDb(runs: FleetRunRow[], sessionHash?: string, sealed?: { enc: string; iv: string }) {
  const stmt = (sql: string) => {
    let bound: unknown[] = [];
    const s = {
      bind(...v: unknown[]) {
        bound = v;
        return s;
      },
      async first<T>(): Promise<T | null> {
        if (sql.startsWith('SELECT user_id, gh_token_enc')) {
          return (sessionHash && bound[0] === sessionHash
            ? {
                user_id: 'u_1',
                gh_token_enc: sealed?.enc ?? null,
                gh_token_iv: sealed?.iv ?? null,
                expires_at: 2_000_000_000,
              }
            : null) as T | null;
        }
        if (sql.includes('FROM users WHERE id')) {
          return {
            id: 'u_1',
            github_user_id: 1,
            login: 'octocat',
            display_name: null,
            avatar_url: null,
            primary_email: null,
            email_verified: 0,
            created_at: 0,
            last_login_at: 0,
            deleted_at: null,
          } as T;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('FROM fleet_runs')) return { results: runs as unknown as T[] };
        return { results: [] };
      },
      async run() {
        return { success: true };
      },
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

async function makeSessionEnv(runs: FleetRunRow[]): Promise<Env> {
  const sealed = await sealForTest('gho_token');
  return {
    DB: makeDb(runs, hashHex(COOKIE_VALUE), sealed),
    KV: makeKV(),
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
    PUBLIC_BASE_URL: BASE,
  } as unknown as Env;
}

function runsReq(cookie = `__Host-pd_session=${COOKIE_VALUE}`): Request {
  return new Request(`${BASE}/account/runs`, cookie ? { headers: { Cookie: cookie } } : {});
}

/** Stub GitHub's GET /repos/:owner/:repo — readable repos answer 200, rest 404. */
function stubRepoAccess(readable: string[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    const captured = /\/repos\/(.+)$/.exec(u)?.[1];
    const repo = captured ? decodeURIComponent(captured) : '';
    return new Response('', { status: readable.includes(repo) ? 200 : 404 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('GET /account/runs — session gate', () => {
  it('redirects to /login when there is no session cookie', async () => {
    const env = await makeSessionEnv([makeRun()]);
    const res = await handleRunsPage(new Request(`${BASE}/account/runs`), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('redirects to /login on an unknown session cookie', async () => {
    const env = await makeSessionEnv([makeRun()]);
    const res = await handleRunsPage(runsReq('__Host-pd_session=not-a-real-session'), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });
});

describe('GET /account/runs — repo ACL filter', () => {
  it('lists only runs in repos the user can read, grouped by repo', async () => {
    const runs = [
      makeRun({ id: 'run:a1', repo_full_name: 'acme/widgets', pr_number: 3 }),
      makeRun({ id: 'run:b1', repo_full_name: 'evil/secrets', pr_number: 9 }),
      makeRun({ id: 'run:a2', repo_full_name: 'acme/widgets', pr_number: 4 }),
    ];
    stubRepoAccess(['acme/widgets']);
    const res = await handleRunsPage(runsReq(), await makeSessionEnv(runs));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('acme/widgets');
    expect(html).toContain('/fleet/runs/run%3Aa1');
    expect(html).toContain('/fleet/runs/run%3Aa2');
    // the unreadable repo leaves no trace — neither name nor run link
    expect(html).not.toContain('evil/secrets');
    expect(html).not.toContain('run%3Ab1');
  });

  it('probes each distinct repo exactly once per request', async () => {
    const runs = [
      makeRun({ id: 'run:a1', repo_full_name: 'acme/widgets' }),
      makeRun({ id: 'run:a2', repo_full_name: 'acme/widgets' }),
      makeRun({ id: 'run:a3', repo_full_name: 'acme/widgets' }),
      makeRun({ id: 'run:c1', repo_full_name: 'acme/gears' }),
    ];
    const fetchMock = stubRepoAccess(['acme/widgets', 'acme/gears']);
    const res = await handleRunsPage(runsReq(), await makeSessionEnv(runs));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 2 distinct repos, 4 runs
  });

  it('renders run facts: PR #, conclusion badge, ships, wall-clock', async () => {
    const runs = [
      makeRun({ id: 'run:a1', pr_number: 42, conclusion: 'failure', ships_csv: 'code-reviewer,security', ms: 121_000 }),
    ];
    stubRepoAccess(['acme/widgets']);
    const html = await (await handleRunsPage(runsReq(), await makeSessionEnv(runs))).text();
    expect(html).toContain('#42');
    expect(html).toContain('badge failure');
    expect(html).toContain('failure');
    expect(html).toContain('pd-code-reviewer, pd-security');
    expect(html).toContain('2m 1s');
  });

  it('caps distinct-repo checks and announces the truncation honestly', async () => {
    const runs = Array.from({ length: MAX_REPO_CHECKS + 3 }, (_, i) =>
      makeRun({ id: `run:r${i}`, repo_full_name: `acme/repo-${i}` }),
    );
    const fetchMock = stubRepoAccess(runs.map((r) => r.repo_full_name));
    const html = await (await handleRunsPage(runsReq(), await makeSessionEnv(runs))).text();
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REPO_CHECKS);
    expect(html).toContain('Partial view');
    expect(html).toContain(`${MAX_REPO_CHECKS} distinct`);
    // runs beyond the cap are absent
    expect(html).not.toContain(`repo-${MAX_REPO_CHECKS}`);
  });

  it('fails closed on malformed repo names without spending a GitHub probe', async () => {
    const runs = [makeRun({ id: 'run:bad', repo_full_name: 'no-slash-here' })];
    const fetchMock = stubRepoAccess(['no-slash-here']);
    const html = await (await handleRunsPage(runsReq(), await makeSessionEnv(runs))).text();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(html).not.toContain('run%3Abad');
  });
});

describe('GET /account/runs — XSS guard', () => {
  it('escapes hostile repo names and ship lists', async () => {
    const hostile = 'acme/<img src=x onerror=alert(1)>';
    const runs = [
      makeRun({
        id: 'run:x1',
        repo_full_name: hostile,
        ships_csv: '"><script>alert(2)</script>',
      }),
    ];
    stubRepoAccess([hostile]);
    const html = await (await handleRunsPage(runsReq(), await makeSessionEnv(runs))).text();
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('GET /account/runs — transport headers', () => {
  it('serves no-store, noindex HTML under a script-free CSP', async () => {
    stubRepoAccess(['acme/widgets']);
    const res = await handleRunsPage(runsReq(), await makeSessionEnv([makeRun()]));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src'); // no script source is ever allowed
    expect(await res.text()).not.toContain('<script');
  });
});

describe('GET /account/runs — live logical state', () => {
  it('renders a queued intent with generation, estimate, and no invented ships', () => {
    const base = makeRun();
    const queued: FleetRunProjection = {
      ...base,
      id: 'intent:delivery-live',
      delivery_id: 'delivery-live',
      conclusion: 'queued',
      ships_csv: '',
      ms: 0,
      logical_state: 'queued',
      generation: 4,
      attempt_count: 0,
      queued_at: 1_700_000_000,
      started_at: null,
      last_progress_at: 1_700_000_000,
      finished_at: null,
      superseded_by: null,
      last_error: null,
      expected_start_at: 1_700_000_060,
      expected_finish_at: 1_700_000_120,
      queue_ahead_estimate: 1,
      has_transcript: false,
    };
    const html = renderRunsPage(
      {
        id: 'u_1',
        github_user_id: 1,
        login: 'octocat',
        display_name: null,
        avatar_url: null,
        primary_email: null,
        email_verified: 0,
        created_at: 0,
        last_login_at: 0,
        deleted_at: null,
      },
      [{ repo: 'acme/widgets', runs: [queued] }],
      { truncated: false, nowSec: 1_700_000_010 },
    );
    expect(html).toContain('/fleet/runs/intent%3Adelivery-live');
    expect(html).toContain('badge queued');
    expect(html).toContain('generation 4');
    expect(html).toContain('expected');
    expect(html).not.toContain('pd-—');
  });

  it('renders corrupt active metadata as an explicit invariant breach, not a plausible value', () => {
    const base = makeRun();
    const projectionBase = {
      ...base,
      generation: 1,
      queued_at: 1_700_000_000,
      started_at: null,
      last_progress_at: 1_700_000_000,
      finished_at: null,
      superseded_by: null,
      expected_start_at: null,
      expected_finish_at: null,
      queue_ahead_estimate: null,
      has_transcript: false,
    };
    const runs: FleetRunProjection[] = [
      {
        ...projectionBase,
        logical_state: 'enqueue_failed',
        conclusion: 'enqueue_failed',
        ships_csv: '',
        attempt_count: 0,
        last_error: null,
      } as FleetRunProjection,
      {
        ...projectionBase,
        id: 'run:active',
        delivery_id: 'active',
        logical_state: 'running',
        conclusion: 'pending',
        ships_csv: '',
        attempt_count: Number.NaN,
      } as FleetRunProjection,
    ];
    const html = renderRunsPage(
      {
        id: 'u_1', github_user_id: 1, login: 'octocat', display_name: null,
        avatar_url: null, primary_email: null, email_verified: 0,
        created_at: 0, last_login_at: 0, deleted_at: null,
      },
      [{ repo: 'acme/widgets', runs }],
      { truncated: false, nowSec: 1_700_000_010 },
    );
    expect(html).toContain('admission record incomplete');
    expect(html).toContain('queue handoff failed without durable error detail');
    expect(html).toContain('platform attempt 1 · transcript arriving');
    expect(html).not.toContain('attempt NaN');
  });

  it('labels a retrying delivery as a scheduled provider retry with its attempt', () => {
    const retrying: FleetRunProjection = {
      ...makeRun({ conclusion: 'retrying', ships_csv: '', ms: 0 }),
      id: 'intent:provider-retry', delivery_id: 'provider-retry', logical_state: 'retrying',
      generation: 4, attempt_count: 2, queued_at: 1_700_000_000, started_at: 1_700_000_001,
      last_progress_at: 1_700_000_010, finished_at: null, superseded_by: null,
      last_error: 'Workers AI circuit open on attempt 2/3; queue retry scheduled in 31s',
      expected_start_at: 1_700_000_030, expected_finish_at: 1_700_000_090,
      queue_ahead_estimate: 0, has_transcript: false,
    };
    const html = renderRunsPage(
      { id: 'u_1', github_user_id: 1, login: 'octocat', display_name: null, avatar_url: null, primary_email: null, email_verified: 0, created_at: 0, last_login_at: 0, deleted_at: null },
      [{ repo: 'acme/widgets', runs: [retrying] }],
      { truncated: false, nowSec: 1_700_000_010 },
    );
    expect(html).toContain('badge retrying');
    expect(html).toContain('provider retry · platform attempt 2 scheduled');
    expect(html).toContain('expected 22:14 UTC');
  });

  it('decodes a legacy continuation cursor in the run list', () => {
    const retrying: FleetRunProjection = {
      ...makeRun({ conclusion: 'retrying', ships_csv: '', ms: 0 }),
      id: 'intent:continuation-retry',
      delivery_id: 'continuation-retry',
      logical_state: 'retrying',
      generation: 5,
      attempt_count: 101,
      queued_at: 1_700_000_000,
      started_at: 1_700_000_001,
      last_progress_at: 1_700_000_010,
      finished_at: null,
      superseded_by: null,
      last_error: 'retry scheduled',
      expected_start_at: null,
      expected_finish_at: null,
      queue_ahead_estimate: 0,
      has_transcript: false,
    };
    const html = renderRunsPage(
      { id: 'u_1', github_user_id: 1, login: 'octocat', display_name: null, avatar_url: null, primary_email: null, email_verified: 0, created_at: 0, last_login_at: 0, deleted_at: null },
      [{ repo: 'acme/widgets', runs: [retrying] }],
      { truncated: false, nowSec: 1_700_000_010 },
    );
    expect(html).toContain(
      'provider retry · continuation 1, platform attempt 1 scheduled',
    );
    expect(html).not.toContain('attempt 101');
  });
});

describe('GET /account/runs — empty state', () => {
  it('teaches instead of fabricating rows when there are no runs', async () => {
    stubRepoAccess([]);
    const html = await (await handleRunsPage(runsReq(), await makeSessionEnv([]))).text();
    expect(html).toContain('No runs yet');
    expect(html).toContain('install the Port Daddy Fleet GitHub App');
    expect(html).not.toContain('class="run-row"'); // no fake rows
  });

  it('shows the same empty state when runs exist but none are readable', async () => {
    stubRepoAccess([]); // GitHub says 404 to everything
    const html = await (
      await handleRunsPage(runsReq(), await makeSessionEnv([makeRun({ repo_full_name: 'evil/secrets' })]))
    ).text();
    expect(html).toContain('No runs yet');
    expect(html).not.toContain('evil/secrets');
  });
});
