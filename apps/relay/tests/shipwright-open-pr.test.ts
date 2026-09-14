/**
 * Tests for POST /v1/shipwright/open-pr (src/shipwright.ts, node shipwright-pr-open)
 * and the page's Open-PR deck (src/shipwright-page.ts).
 *
 * Coverage, per the node's gate:
 *   - SESSION + ORIGIN: 401 without a session; 403 cross-origin.
 *   - SERVER RE-VALIDATION: the route 400s on invalid YAML even when the
 *     client CLAIMS validation passed — validateFleetYaml's own verdict is the
 *     gate, never the caller's word, and no GitHub call happens first.
 *   - PROVENANCE: YAML the Shipwright never emitted in this user's own
 *     conversation 400s (the route is not a generic write-to-github primitive).
 *   - TENANCY: session A can never target an installation GitHub does not
 *     attribute to it (GET /user/installations is the source of truth), and a
 *     repo bound to a DIFFERENT installation is refused.
 *   - HAPPY PATH: against a stubbed GitHub layer (the fleet-control.test.ts
 *     fetch-mock idiom) the route mints a fresh branch, PUTs pd-fleet.yml,
 *     opens a PR whose body carries the chat provenance, and returns
 *     OK_PR_CREATED — with ZERO D1 writes (the mock throws on any).
 *   - FORM DIALECT: success 303s straight to the PR; failures 303 back to
 *     /account/shipwright?notice=<code> (the billing form idiom).
 *   - PAGE: the Open-PR deck template offers ONLY the user's own
 *     installations, degrades honestly, and the CSP admits github.com as a
 *     form-action target (the success redirect lands there).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  handleShipwrightOpenPr,
  SHIPWRIGHT_BRANCH_PREFIX,
  MAX_YAML_CHARS,
} from '../src/shipwright.js';
import {
  renderPrTemplate,
  renderShipwrightPage,
  handleShipwrightPage,
  SHIPWRIGHT_NOTICES,
} from '../src/shipwright-page.js';
import { hashHex, fromHex, base64UrlEncode } from '../src/crypto.js';
import type { ShipwrightMessageRow, UserRow } from '../src/db.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const COOKIE_VALUE = 'sess-open-pr';
const WRAP_KEY = 'cc'.repeat(32);
const INSTALLATION_ID = 42;
const TEST_APP_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' }) as string;
const THREAD_ID = `swt_${'b'.repeat(48)}`;
const PR_URL = 'https://github.com/octo/widgets/pull/7';

const GOOD_YAML = [
  'fleet:',
  '  agents:',
  '    code-reviewer:',
  '      trigger: pull_request:opened',
  '      prompt: Review the diff.',
  '      fallbacks:',
  '        - backend: cloudflare',
  `          model: '@cf/qwen/qwen2.5-coder-32b-instruct'`,
].join('\n');

const BAD_YAML = 'something: else';

/** Wrap a roster in a chat turn the way the model emits one (fenced yaml). */
function chatWith(yaml: string): ShipwrightMessageRow[] {
  return [
    { id: 1, role: 'user', content: 'design me a fleet', created_at: 100 },
    {
      id: 2,
      role: 'assistant',
      content: 'Aye. Here is the roster:\n```yaml\n' + yaml + '\n```\nShip it when ready.',
      created_at: 101,
    },
  ];
}

/** Seal a token the way auth-github.sealToken does, so resolveSession decrypts it. */
async function sealForTest(token: string): Promise<{ enc: string; iv: string }> {
  const key = await crypto.subtle.importKey('raw', fromHex(WRAP_KEY), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
  );
  return { enc: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

const baseUser: UserRow = {
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
};

/**
 * D1 mock for the open-pr path: session + user lookup and the chat-history
 * SELECT. Every write (run) THROWS — the route must never touch D1 state, and
 * a passing happy-path test is the proof.
 */
function makeDb(opts: { history?: ShipwrightMessageRow[]; sealed?: { enc: string; iv: string } } = {}) {
  const stmt = (sql: string) => {
    let bound: unknown[] = [];
    const s = {
      bind(...v: unknown[]) {
        bound = v;
        return s;
      },
      async first<T>(): Promise<T | null> {
        if (sql.startsWith('SELECT user_id, gh_token_enc')) {
          return (bound[0] === hashHex(COOKIE_VALUE)
            ? {
                user_id: 'u_1',
                gh_token_enc: opts.sealed?.enc ?? null,
                gh_token_iv: opts.sealed?.iv ?? null,
                expires_at: 2_000_000_000,
              }
            : null) as T | null;
        }
        if (sql.includes('FROM users WHERE id')) return baseUser as unknown as T;
        if (sql.includes('FROM shipwright_threads WHERE id')) return {
          id: THREAD_ID, user_id: 'u_1', installation_id: INSTALLATION_ID,
          repo_full_name: 'octo/widgets', created_at: 1, updated_at: 1,
        } as T;
        if (sql.includes('FROM shipwright_proposals')) {
          const yaml = bound[4];
          const emitted = (opts.history ?? []).some(
            (m) => m.role === 'assistant' && m.content.includes('```yaml\n' + yaml + '\n```'),
          );
          return (emitted ? { found: 1 } : null) as T | null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('FROM shipwright_chats')) {
          const rows = [...(opts.history ?? [])].sort((a, b) => b.id - a.id);
          return { results: rows as unknown as T[] };
        }
        return { results: [] };
      },
      async run(): Promise<never> {
        throw new Error('D1 write refused: the open-pr route must not mutate state');
      },
    };
    return s as unknown as D1PreparedStatement;
  };
  return { prepare: stmt } as unknown as D1Database;
}

function makeKV(seed: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

interface EnvOpts {
  history?: ShipwrightMessageRow[];
  /** Pre-seed the repo→installation KV binding (skips the App-JWT lookup). */
  repoBoundTo?: number;
  noGithubApp?: boolean;
}

/** Env with a decryptable session token + KV pre-seeded like fleet-control tests. */
async function makeSessionEnv(opts: EnvOpts = {}): Promise<Env> {
  const sealed = await sealForTest('gho_token');
  const seed: Record<string, string> = {
    [`github_inst_${INSTALLATION_ID}`]: JSON.stringify({
      token: 'gh-test-token',
      expiresAt: Date.now() + 3_600_000,
    }),
  };
  if (opts.repoBoundTo !== undefined) {
    seed['github_repo_inst_octo_widgets'] = String(opts.repoBoundTo);
  }
  return {
    DB: makeDb({ history: opts.history, sealed }),
    KV: makeKV(seed),
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
    PUBLIC_BASE_URL: BASE,
    ...(opts.noGithubApp
      ? {}
      : { GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: TEST_APP_KEY }),
  } as unknown as Env;
}

function jsonReq(body: unknown, withCookie = true, origin?: string): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (withCookie) headers.set('Cookie', `__Host-pd_session=${COOKIE_VALUE}`);
  if (origin) headers.set('Origin', origin);
  return new Request(`${BASE}/v1/shipwright/open-pr`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body && typeof body === 'object' ? { threadId: THREAD_ID, ...(body as Record<string, unknown>) } : body),
  });
}

function formReq(fields: Record<string, string>): Request {
  return new Request(`${BASE}/v1/shipwright/open-pr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `__Host-pd_session=${COOKIE_VALUE}`,
      Origin: BASE,
    },
    body: new URLSearchParams({ threadId: THREAD_ID, ...fields }).toString(),
  });
}

/**
 * Stub global fetch as the whole GitHub layer (the fleet-control.test.ts
 * idiom): /user/installations answers the tenancy question; the git/contents/
 * pulls endpoints answer the mutation path; everything else 500s loudly.
 */
function stubGithub(
  installations: Array<{ id: number }>,
  repoInstallation = INSTALLATION_ID,
  revokeStatus = 204,
) {
  const seen: Array<{ url: string; method: string; body: string | null }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    seen.push({ url, method, body: typeof init?.body === 'string' ? init.body : null });
    if (url.includes(`/user/installations/${INSTALLATION_ID}/repositories`)) {
      const granted = installations.some((entry) => entry.id === INSTALLATION_ID);
      return Response.json({ total_count: granted ? 1 : 0, repositories: granted ? [{ full_name: 'octo/widgets' }] : [] });
    }
    if (url.includes('/user/installations')) {
      return Response.json({ installations });
    }
    if (url.endsWith('/repos/octo/widgets/installation') && method === 'GET') {
      return Response.json({ id: repoInstallation });
    }
    if (url.endsWith(`/app/installations/${INSTALLATION_ID}/access_tokens`) && method === 'POST') {
      return Response.json({
        token: 'ghs_scoped_test_token',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        repositories: [{ id: 7, name: 'widgets', full_name: 'octo/widgets' }],
        permissions: { contents: 'write', pull_requests: 'write' },
      });
    }
    if (url.endsWith('/installation/token') && method === 'DELETE') {
      return new Response(null, { status: revokeStatus });
    }
    if (url.includes('/git/refs/heads/main') && method === 'GET') {
      return Response.json({ object: { sha: 'base-sha-123' } });
    }
    if (url.endsWith('/git/refs') && method === 'POST') {
      return new Response(JSON.stringify({ ref: 'refs/heads/x' }), { status: 201 });
    }
    if (url.includes('/contents/pd-fleet.yml?ref=main') && method === 'GET') {
      return new Response('not found', { status: 404 }); // fresh repo: no roster yet
    }
    if (url.includes('/contents/pd-fleet.yml') && method === 'PUT') {
      return Response.json({ commit: { sha: 'commit-sha' } });
    }
    if (url.endsWith('/pulls') && method === 'POST') {
      return new Response(JSON.stringify({ html_url: PR_URL }), { status: 201 });
    }
    if (url.endsWith('/repos/octo/widgets') && method === 'GET') {
      return Response.json({ default_branch: 'main' });
    }
    return new Response('unexpected ' + method + ' ' + url, { status: 500 });
  });
  vi.stubGlobal('fetch', mock);
  return { mock, seen };
}

afterEach(() => vi.unstubAllGlobals());

// ── Session + origin + config gates ──────────────────────────────────────────

describe('open-pr — session/origin/config gates', () => {
  it('401 UNAUTHENTICATED without a session', async () => {
    stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML) });
    const res = await handleShipwrightOpenPr(
      jsonReq({ yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo: 'octo/widgets' }, false),
      env,
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('403 CROSS_ORIGIN on a foreign Origin header', async () => {
    stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML) });
    const res = await handleShipwrightOpenPr(
      jsonReq(
        { yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo: 'octo/widgets' },
        true,
        'https://evil.example',
      ),
      env,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('CROSS_ORIGIN');
  });

  it('503 PR_UNCONFIGURED when the GitHub App secrets are absent (honest idiom)', async () => {
    stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML), noGithubApp: true });
    const res = await handleShipwrightOpenPr(
      jsonReq({ yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo: 'octo/widgets' }),
      env,
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('PR_UNCONFIGURED');
  });
});

// ── Server-side re-validation (the lying-client gate) ────────────────────────

describe('open-pr — the server re-validates; a lying client gets a 400', () => {
  it('400 INVALID_YAML even when the client claims validation passed', async () => {
    const { mock } = stubGithub([{ id: INSTALLATION_ID }]);
    // The invalid roster IS in the chat (provenance is not the failure here).
    const env = await makeSessionEnv({ history: chatWith(BAD_YAML), repoBoundTo: INSTALLATION_ID });
    const res = await handleShipwrightOpenPr(
      jsonReq({
        yaml: BAD_YAML,
        installationId: INSTALLATION_ID,
        repo: 'octo/widgets',
        // The lie. The server must not care.
        validated: true,
        clientVerdict: { valid: true },
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_YAML');
    // Scope authorization may read GitHub, but invalid YAML never mutates it.
    expect(mock.mock.calls.every((c) => (c[1]?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('400 BAD_REQUEST on an oversized roster (bounded before parsing)', async () => {
    stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML) });
    const res = await handleShipwrightOpenPr(
      jsonReq({
        yaml: 'a: ' + 'b'.repeat(MAX_YAML_CHARS),
        installationId: INSTALLATION_ID,
        repo: 'octo/widgets',
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('BAD_REQUEST');
  });

  it('400 NOT_FROM_CHAT for a valid roster the Shipwright never emitted', async () => {
    const { mock } = stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: [], repoBoundTo: INSTALLATION_ID });
    const res = await handleShipwrightOpenPr(
      jsonReq({ yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo: 'octo/widgets' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FROM_CHAT');
    expect(mock.mock.calls.every((c) => (c[1]?.method ?? 'GET') === 'GET')).toBe(true);
  });
});

// ── Tenancy (the billing idiom, GitHub decides) ──────────────────────────────

describe('open-pr — tenancy: a session can never target another tenant', () => {
  it('refuses identical emitted YAML when the requested target is repo B, not thread repo A', async () => {
    const { seen } = stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML), repoBoundTo: INSTALLATION_ID });
    const res = await handleShipwrightOpenPr(
      jsonReq({ yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo: 'octo/repo-b' }),
      env,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('SHIPWRIGHT_SCOPE_UNAVAILABLE');
    expect(seen.every((c) => c.method === 'GET')).toBe(true);
  });

  it('returns the indistinguishable denial when GitHub does not grant the exact repo', async () => {
    // Session A asks for installation 42; GitHub says A owns only 7 — that IS
    // the session-A-vs-session-B test: B's installation is simply one GitHub
    // does not list for A, and the server checks GitHub, not the claim.
    const { seen } = stubGithub([{ id: 7 }]);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML), repoBoundTo: INSTALLATION_ID });
    const res = await handleShipwrightOpenPr(
      jsonReq({ yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo: 'octo/widgets' }),
      env,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('SHIPWRIGHT_SCOPE_UNAVAILABLE');
    // Nothing was created: no branch, no commit, no PR.
    expect(seen.every((c) => c.method === 'GET')).toBe(true);
  });

  it('uses the same denial when the repo belongs to a different installation', async () => {
    const { seen } = stubGithub([{ id: INSTALLATION_ID }], 99);
    // The user owns 42 — but octo/widgets is served by installation 99.
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML), repoBoundTo: 99 });
    const res = await handleShipwrightOpenPr(
      jsonReq({ yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo: 'octo/widgets' }),
      env,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('SHIPWRIGHT_SCOPE_UNAVAILABLE');
    expect(seen.every((c) => c.method === 'GET')).toBe(true);
  });

  it('400 BAD_REQUEST on a smuggled repo path (traversal shapes never parse)', async () => {
    stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML) });
    for (const repo of ['../../evil', 'octo/widgets/extra', 'octo widgets', 'octo']) {
      const res = await handleShipwrightOpenPr(
        jsonReq({ yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo }),
        env,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('BAD_REQUEST');
    }
  });
});

// ── Happy path against the stubbed GitHub layer ──────────────────────────────

describe('open-pr — happy path (stubbed GitHub, fleet-control idiom)', () => {
  it('opens a fresh-branch PR carrying provenance, with zero D1 writes', async () => {
    const { seen } = stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML), repoBoundTo: INSTALLATION_ID });
    const res = await handleShipwrightOpenPr(
      jsonReq({ yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo: 'octo/widgets' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; prUrl: string; branch: string };
    expect(body.code).toBe('OK_PR_CREATED');
    expect(body.prUrl).toBe(PR_URL);
    expect(body.branch.startsWith(SHIPWRIGHT_BRANCH_PREFIX)).toBe(true);

    const mint = seen.find((c) => c.url.endsWith(`/app/installations/${INSTALLATION_ID}/access_tokens`) && c.method === 'POST');
    expect(JSON.parse(mint!.body!)).toEqual({
      repositories: ['widgets'],
      permissions: { contents: 'write', pull_requests: 'write' },
    });
    expect(seen.some((c) => c.url.endsWith('/installation/token') && c.method === 'DELETE')).toBe(true);

    // The mutation shape: fresh branch → contents PUT → PR. Never a bare push.
    expect(seen.some((c) => c.url.endsWith('/git/refs') && c.method === 'POST')).toBe(true);
    const put = seen.find((c) => c.url.includes('/contents/pd-fleet.yml') && c.method === 'PUT');
    expect(put).toBeDefined();
    const putBody = JSON.parse(put!.body!) as { branch: string; content: string };
    expect(putBody.branch).toBe(body.branch);
    // The committed bytes are the submitted roster (base64, utf-8) + newline.
    expect(atob(putBody.content)).toBe(GOOD_YAML + '\n');

    // The PR body carries the chat provenance and the zero-trust posture.
    const pr = seen.find((c) => c.url.endsWith('/pulls') && c.method === 'POST');
    expect(pr).toBeDefined();
    const prPayload = JSON.parse(pr!.body!) as { title: string; body: string; head: string; base: string };
    expect(prPayload.head).toBe(body.branch);
    expect(prPayload.base).toBe('main');
    expect(prPayload.body).toContain('Port Daddy Shipwright');
    expect(prPayload.body).toContain('@octocat');
    expect(prPayload.body).toContain('Provenance');
    expect(prPayload.body).toContain('re-validated');
    expect(prPayload.body).toContain('review and merge');
    // Zero D1 writes: makeDb throws on ANY run() — reaching 200 proves none.
  });

  it('reports an unconfirmed repository-token revocation after the PR opens', async () => {
    const { seen } = stubGithub([{ id: INSTALLATION_ID }], INSTALLATION_ID, 500);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML), repoBoundTo: INSTALLATION_ID });
    const res = await handleShipwrightOpenPr(
      jsonReq({ yaml: GOOD_YAML, installationId: INSTALLATION_ID, repo: 'octo/widgets' }),
      env,
    );
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe('TOKEN_CLEANUP_UNCONFIRMED');
    expect(seen.some((c) => c.url.endsWith('/pulls') && c.method === 'POST')).toBe(true);
    expect(seen.some((c) => c.url.endsWith('/installation/token') && c.method === 'DELETE')).toBe(true);
  });

  it('form dialect: success 303s the browser straight to the PR', async () => {
    stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: chatWith(GOOD_YAML), repoBoundTo: INSTALLATION_ID });
    const res = await handleShipwrightOpenPr(
      formReq({ yaml: GOOD_YAML, installationId: String(INSTALLATION_ID), repo: 'octo/widgets' }),
      env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(PR_URL);
  });

  it('form dialect: failures 303 back to the page with a whitelisted notice', async () => {
    stubGithub([{ id: INSTALLATION_ID }]);
    const env = await makeSessionEnv({ history: chatWith(BAD_YAML), repoBoundTo: INSTALLATION_ID });
    const res = await handleShipwrightOpenPr(
      formReq({ yaml: BAD_YAML, installationId: String(INSTALLATION_ID), repo: 'octo/widgets' }),
      env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/shipwright?notice=invalid_yaml');
    // Every notice the route can 303 with is one the page will actually render.
    expect(SHIPWRIGHT_NOTICES['invalid_yaml']).toBeDefined();
    expect(SHIPWRIGHT_NOTICES['forbidden']).toBeDefined();
    expect(SHIPWRIGHT_NOTICES['repo_not_installed']).toBeDefined();
    expect(SHIPWRIGHT_NOTICES['not_from_chat']).toBeDefined();
    expect(SHIPWRIGHT_NOTICES['github_error']).toBeDefined();
    expect(SHIPWRIGHT_NOTICES['pr_unconfigured']).toBeDefined();
  });
});

// ── The page's Open-PR deck ──────────────────────────────────────────────────

describe('shipwright page — the Open-PR deck', () => {
  it('locks the PR form to the active repository-scoped thread', () => {
    const html = renderPrTemplate([
      { id: INSTALLATION_ID, accountLogin: 'octo', accountType: 'User' },
      { id: 7, accountLogin: '<script>evil</script>', accountType: 'Organization' },
    ], { installations: [], notice: null, threadId: THREAD_ID, repo: 'octo/widgets', installationId: INSTALLATION_ID });
    expect(html).toContain('action="/v1/shipwright/open-pr"');
    expect(html).toContain(`name="threadId" value="${THREAD_ID}"`);
    expect(html).toContain('name="installationId" value=""');
    expect(html).toContain('name="repo" value=""');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<script>evil');
    // The submission is a plain form POST — no client JS in the path.
    expect(html).toContain('method="post"');
  });

  it('degrades honestly: unknown list ≠ empty list, and neither is a dead button', () => {
    const unknown = renderPrTemplate(null);
    expect(unknown).toContain('Open PR unavailable');
    expect(unknown).not.toContain('<form');
    const empty = renderPrTemplate([]);
    expect(empty).toContain('install the Port Daddy');
    expect(empty).not.toContain('<form');
  });

  it('page CSP admits github.com as a form-action target (the success 303 lands there)', async () => {
    const sealed = await sealForTest('gho_token');
    const env = {
      DB: makeDb({ sealed }),
      KV: makeKV(),
      USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
      PUBLIC_BASE_URL: BASE,
    } as unknown as Env;
    stubGithub([{ id: INSTALLATION_ID }]);
    const res = await handleShipwrightPage(
      new Request(`${BASE}/account/shipwright`, {
        headers: { Cookie: `__Host-pd_session=${COOKIE_VALUE}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("form-action 'self' https://github.com");
    const html = await res.text();
    expect(html).toContain('prform-tpl');
  });

  it('renders only whitelisted notices; raw query text is never echoed', () => {
    const withNotice = renderShipwrightPage(baseUser, 'aa'.repeat(16), {
      installations: null,
      notice: 'github_error',
    });
    expect(withNotice).toContain(SHIPWRIGHT_NOTICES['github_error']!);
    const bogus = renderShipwrightPage(baseUser, 'aa'.repeat(16), {
      installations: null,
      notice: null,
    });
    expect(bogus).not.toContain('notice-strip" role');
  });
});
