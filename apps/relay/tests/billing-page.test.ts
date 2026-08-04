/**
 * Tests for the billing storefront (src/billing-page.ts + the browser-form
 * dialect added to src/billing.ts; ADR-0116 front-end).
 *
 * Coverage:
 *   - session gate: no/unknown cookie → 302 /login (same as /account).
 *   - tenant boundary: the page lists ONLY installations GitHub returns for
 *     the session's token, so another tenant's balance can never appear —
 *     even when its ledger rows exist in D1.
 *   - zero-installation empty state teaches; GitHub failure renders an honest
 *     "unknown" degraded panel (never a fabricated empty state).
 *   - free-tier honesty: fail-open copy; enrolled/not-enrolled/exhausted chips.
 *   - buy buttons post the CREDIT_PACKS presets to /billing/checkout; Manage
 *     posts to /billing/portal; neither renders when Stripe is unconfigured.
 *   - notices: only whitelisted ?notice= keys render; raw text is never echoed.
 *   - XSS guard on GitHub-controlled account names.
 *   - transport: no-store + noindex + script-free CSP.
 *   - form dialect of POST /billing/checkout + /billing/portal: 303 to Stripe
 *     on success, 303 back to /account/billing?notice=<code> on failure,
 *     303 /login without a session; ownership still denies foreign ids.
 *
 * Idioms follow runs-page.test.ts: hand-rolled D1/KV mocks, a sealed gh-token
 * so resolveSession yields a usable session, and a stubbed global fetch
 * standing in for GitHub's GET /user/installations and Stripe's REST API.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleBillingPage, MAX_INSTALLATIONS } from '../src/billing-page.js';
import { handleCreateCheckout, handlePortalLink } from '../src/billing.js';
import { hashHex, fromHex, base64UrlEncode } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const WRAP_KEY = 'bb'.repeat(32);
const BASE = 'https://relay.example';
const COOKIE_VALUE = 'sess-value-abc';
const STRIPE_CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_xyz';
const STRIPE_PORTAL_URL = 'https://billing.stripe.com/p/session/xyz';

/** Seal a token the way auth-github.sealToken does, so resolveSession decrypts it. */
async function sealForTest(token: string): Promise<{ enc: string; iv: string }> {
  const key = await crypto.subtle.importKey('raw', fromHex(WRAP_KEY), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
  );
  return { enc: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

interface LedgerRow {
  installation_id: number;
  delta_usd: number;
}

/**
 * D1 mock answering the queries this path issues: web_sessions + users
 * (resolveSession), the COUNT+SUM billing-status read, and — for the checkout
 * form dialect — stripe_customers reads/writes + credit_ledger inserts.
 */
function makeDb(ledger: LedgerRow[], sessionHash?: string, sealed?: { enc: string; iv: string }) {
  const customers = new Map<number, string>();
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
        if (sql.includes('COUNT(*) AS n') && sql.includes('FROM credit_ledger')) {
          const rows = ledger.filter((r) => r.installation_id === bound[0]);
          return { n: rows.length, bal: rows.reduce((a, r) => a + r.delta_usd, 0) } as T;
        }
        if (sql.includes('FROM credit_ledger WHERE reason = ? AND stripe_ref = ?')) {
          return null;
        }
        if (sql.includes('FROM stripe_customers WHERE installation_id')) {
          const id = customers.get(bound[0] as number);
          return (id ? { stripe_customer_id: id } : null) as T | null;
        }
        return null;
      },
      async run() {
        if (sql.includes('INTO stripe_customers')) {
          const [installation_id, stripe_customer_id] = bound as [number, string];
          if (!customers.has(installation_id)) customers.set(installation_id, stripe_customer_id);
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
    return s as unknown as D1PreparedStatement;
  };
  return { db: { prepare: stmt } as unknown as D1Database, customers };
}

function makeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

async function makeSessionEnv(
  ledger: LedgerRow[] = [],
  over: Partial<Env> = {},
): Promise<{ env: Env; customers: Map<number, string> }> {
  const sealed = await sealForTest('gho_token');
  const { db, customers } = makeDb(ledger, hashHex(COOKIE_VALUE), sealed);
  const env = {
    DB: db,
    KV: makeKV(),
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
    PUBLIC_BASE_URL: BASE,
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    ...over,
  } as unknown as Env;
  return { env, customers };
}

function pageReq(path = '/account/billing', cookie = `__Host-pd_session=${COOKIE_VALUE}`): Request {
  return new Request(`${BASE}${path}`, cookie ? { headers: { Cookie: cookie } } : {});
}

function formReq(path: string, fields: Record<string, string>): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `__Host-pd_session=${COOKIE_VALUE}`,
      Origin: BASE,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

interface InstallationStub {
  id: number;
  account?: { login?: string; type?: string };
}

/**
 * Stub global fetch: GitHub's GET /user/installations answers with `insts`
 * (or `ghStatus` on failure); Stripe's POST endpoints answer canned success.
 */
function stubGithubAndStripe(insts: InstallationStub[], ghStatus = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.includes('api.github.com/user/installations')) {
      if (ghStatus !== 200) return new Response('upstream sad', { status: ghStatus });
      return Response.json({ installations: insts });
    }
    if (u.includes('api.stripe.com/v1/customers')) {
      return Response.json({ id: 'cus_test_1' });
    }
    if (u.includes('api.stripe.com/v1/checkout/sessions')) {
      return Response.json({ id: 'cs_test_1', url: STRIPE_CHECKOUT_URL });
    }
    if (u.includes('api.stripe.com/v1/billing_portal/sessions')) {
      return Response.json({ url: STRIPE_PORTAL_URL });
    }
    return new Response('unexpected fetch: ' + u, { status: 500 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

// ── session gate ──────────────────────────────────────────────────────────────

describe('GET /account/billing — session gate', () => {
  it('redirects to /login when there is no session cookie', async () => {
    stubGithubAndStripe([]);
    const { env } = await makeSessionEnv();
    const res = await handleBillingPage(new Request(`${BASE}/account/billing`), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('redirects to /login on an unknown session cookie', async () => {
    stubGithubAndStripe([]);
    const { env } = await makeSessionEnv();
    const res = await handleBillingPage(pageReq('/account/billing', '__Host-pd_session=nope'), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });
});

// ── tenant boundary ───────────────────────────────────────────────────────────

describe('GET /account/billing — tenant boundary', () => {
  it("lists only the user's own installations; another tenant's balance never renders", async () => {
    stubGithubAndStripe([{ id: 11, account: { login: 'acme', type: 'Organization' } }]);
    const { env } = await makeSessionEnv([
      { installation_id: 11, delta_usd: 30 },
      // Another tenant's fat ledger — MUST stay invisible.
      { installation_id: 22, delta_usd: 999 },
    ]);
    const res = await handleBillingPage(pageReq(), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('acme');
    expect(html).toContain('installation 11');
    expect(html).toContain('$30.00');
    expect(html).not.toContain('999');
    expect(html).not.toContain('installation 22');
  });

  it('shows a balance per installation, from that installation ledger only', async () => {
    stubGithubAndStripe([
      { id: 1, account: { login: 'alpha' } },
      { id: 2, account: { login: 'beta' } },
    ]);
    const { env } = await makeSessionEnv([
      { installation_id: 1, delta_usd: 50 },
      { installation_id: 1, delta_usd: -12.5 },
      { installation_id: 2, delta_usd: 20 },
    ]);
    const html = await (await handleBillingPage(pageReq(), env)).text();
    expect(html).toContain('$37.50');
    expect(html).toContain('$20.00');
  });
});

// ── empty + degraded states ───────────────────────────────────────────────────

describe('GET /account/billing — empty and degraded states', () => {
  it('zero installations → empty state teaches, no fabricated cards', async () => {
    stubGithubAndStripe([]);
    const { env } = await makeSessionEnv([{ installation_id: 22, delta_usd: 999 }]);
    const html = await (await handleBillingPage(pageReq(), env)).text();
    expect(html).toContain('No GitHub App installations found');
    expect(html).not.toContain('class="inst"'); // no fake cards
    expect(html).not.toContain('999'); // and still nobody else's money
  });

  it('GitHub failure → honest "unknown" panel, never an empty state or balances', async () => {
    stubGithubAndStripe([], 502);
    const { env } = await makeSessionEnv([{ installation_id: 11, delta_usd: 30 }]);
    const res = await handleBillingPage(pageReq(), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('could not list your installations');
    expect(html).not.toContain('No GitHub App installations found');
    expect(html).not.toContain('$30.00');
  });
});

// ── free tier honesty + chips ─────────────────────────────────────────────────

describe('GET /account/billing — free-tier honesty', () => {
  it('always explains fail-open: free until enrolled', async () => {
    stubGithubAndStripe([]);
    const { env } = await makeSessionEnv();
    const html = await (await handleBillingPage(pageReq(), env)).text();
    expect(html).toContain('Free until enrolled');
    expect(html).toContain('billing fails open');
    expect(html).toContain('no credit history runs free');
  });

  it('distinguishes not-enrolled (free) from enrolled-but-exhausted', async () => {
    stubGithubAndStripe([
      { id: 1, account: { login: 'fresh' } }, // no ledger rows → free tier
      { id: 2, account: { login: 'spent' } }, // rows, balance 0 → exhausted
      { id: 3, account: { login: 'flush' } }, // rows, positive → active
    ]);
    const { env } = await makeSessionEnv([
      { installation_id: 2, delta_usd: 20 },
      { installation_id: 2, delta_usd: -20 },
      { installation_id: 3, delta_usd: 50 },
    ]);
    const html = await (await handleBillingPage(pageReq(), env)).text();
    expect(html).toContain('Free tier — not enrolled');
    expect(html).toContain('Out of credit — runs skip');
    expect(html).toContain('Credits active');
  });
});

// ── buy / manage buttons ──────────────────────────────────────────────────────

describe('GET /account/billing — buy and manage buttons', () => {
  it('renders one form per credit pack posting to /billing/checkout, plus Manage → /billing/portal', async () => {
    stubGithubAndStripe([{ id: 7, account: { login: 'acme' } }]);
    const { env } = await makeSessionEnv();
    const html = await (await handleBillingPage(pageReq(), env)).text();
    expect(html).toContain('action="/billing/checkout"');
    expect(html).toContain('name="pack" value="starter"');
    expect(html).toContain('name="pack" value="pro"');
    expect(html).toContain('name="pack" value="team"');
    expect(html).toContain('Starter — $20 credit');
    expect(html).toContain('Pro — $50 credit');
    expect(html).toContain('Team — $200 credit');
    expect(html).toContain('name="installationId" value="7"');
    expect(html).toContain('action="/billing/portal"');
  });

  it('renders NO buy/manage forms when Stripe is unconfigured — honest notice instead', async () => {
    stubGithubAndStripe([{ id: 7, account: { login: 'acme' } }]);
    const { env } = await makeSessionEnv([], { STRIPE_SECRET_KEY: undefined });
    const html = await (await handleBillingPage(pageReq(), env)).text();
    expect(html).not.toContain('action="/billing/checkout"');
    expect(html).not.toContain('action="/billing/portal"');
    expect(html).toContain('Stripe is not configured');
  });
});

// ── notices ───────────────────────────────────────────────────────────────────

describe('GET /account/billing — notices', () => {
  it('renders a whitelisted notice', async () => {
    stubGithubAndStripe([]);
    const { env } = await makeSessionEnv();
    const html = await (
      await handleBillingPage(pageReq('/account/billing?notice=checkout-cancelled'), env)
    ).text();
    expect(html).toContain('Checkout cancelled — nothing was charged.');
  });

  it('ignores (and never echoes) an unknown notice value', async () => {
    stubGithubAndStripe([]);
    const { env } = await makeSessionEnv();
    const hostile = '<img src=x onerror=alert(1)>';
    const html = await (
      await handleBillingPage(pageReq(`/account/billing?notice=${encodeURIComponent(hostile)}`), env)
    ).text();
    expect(html).not.toContain(hostile);
    expect(html).not.toContain('class="notice-strip');
  });
});

// ── XSS + transport ───────────────────────────────────────────────────────────

describe('GET /account/billing — XSS guard and transport', () => {
  it('escapes hostile GitHub account names', async () => {
    stubGithubAndStripe([{ id: 5, account: { login: '<script>alert(1)</script>' } }]);
    const { env } = await makeSessionEnv();
    const html = await (await handleBillingPage(pageReq(), env)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('serves no-store, noindex HTML under a script-free CSP that allows Stripe form targets', async () => {
    stubGithubAndStripe([]);
    const { env } = await makeSessionEnv();
    const res = await handleBillingPage(pageReq(), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    expect(csp).toContain("form-action 'self' https://checkout.stripe.com https://billing.stripe.com");
    expect(await res.text()).not.toContain('<script');
  });
});

// ── truncation cap ────────────────────────────────────────────────────────────

describe('GET /account/billing — installation cap', () => {
  it('caps rendered installations and announces the truncation honestly', async () => {
    const many = Array.from({ length: MAX_INSTALLATIONS + 5 }, (_, i) => ({
      id: i + 1,
      account: { login: `org-${i + 1}` },
    }));
    stubGithubAndStripe(many);
    const { env } = await makeSessionEnv();
    const html = await (await handleBillingPage(pageReq(), env)).text();
    expect(html).toContain(`org-${MAX_INSTALLATIONS}`);
    expect(html).not.toContain(`org-${MAX_INSTALLATIONS + 1}`);
    expect(html).toContain('Partial view');
  });
});

// ── form dialect: POST /billing/checkout ──────────────────────────────────────

describe('POST /billing/checkout — browser form dialect', () => {
  it('303s to Stripe Checkout for an owned installation', async () => {
    stubGithubAndStripe([{ id: 7, account: { login: 'acme' } }]);
    const { env } = await makeSessionEnv();
    const res = await handleCreateCheckout(
      formReq('/billing/checkout', { installationId: '7', pack: 'starter' }),
      env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(STRIPE_CHECKOUT_URL);
  });

  it("303s back with notice=forbidden for an installation the user doesn't own", async () => {
    stubGithubAndStripe([{ id: 7 }]); // GitHub says: only 7
    const { env } = await makeSessionEnv();
    const res = await handleCreateCheckout(
      formReq('/billing/checkout', { installationId: '22', pack: 'starter' }),
      env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/billing?notice=forbidden');
  });

  it('303s to /login without a session', async () => {
    stubGithubAndStripe([{ id: 7 }]);
    const { env } = await makeSessionEnv();
    const req = new Request(`${BASE}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE },
      body: new URLSearchParams({ installationId: '7', pack: 'starter' }).toString(),
    });
    const res = await handleCreateCheckout(req, env);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('303s back with notice=billing_unconfigured when Stripe secrets are absent', async () => {
    stubGithubAndStripe([{ id: 7 }]);
    const { env } = await makeSessionEnv([], { STRIPE_SECRET_KEY: undefined });
    const res = await handleCreateCheckout(
      formReq('/billing/checkout', { installationId: '7', pack: 'starter' }),
      env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/billing?notice=billing_unconfigured');
  });

  it('303s back with notice=bad_pack on an unknown pack (never an arbitrary amount)', async () => {
    stubGithubAndStripe([{ id: 7 }]);
    const { env } = await makeSessionEnv();
    const res = await handleCreateCheckout(
      formReq('/billing/checkout', { installationId: '7', pack: 'yacht' }),
      env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/billing?notice=bad_pack');
  });

  it('refuses a cross-origin form post', async () => {
    stubGithubAndStripe([{ id: 7 }]);
    const { env } = await makeSessionEnv();
    const req = new Request(`${BASE}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `__Host-pd_session=${COOKIE_VALUE}`,
        Origin: 'https://evil.example',
      },
      body: new URLSearchParams({ installationId: '7', pack: 'starter' }).toString(),
    });
    const res = await handleCreateCheckout(req, env);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/billing?notice=cross_origin');
  });

  it('JSON dialect still returns { url } (contract untouched)', async () => {
    stubGithubAndStripe([{ id: 7 }]);
    const { env } = await makeSessionEnv();
    const req = new Request(`${BASE}/billing/checkout`, {
      method: 'POST',
      headers: { Cookie: `__Host-pd_session=${COOKIE_VALUE}` },
      body: JSON.stringify({ installationId: 7, pack: 'starter' }),
    });
    const res = await handleCreateCheckout(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe(STRIPE_CHECKOUT_URL);
  });
});

// ── form dialect: POST /billing/portal ────────────────────────────────────────

describe('POST /billing/portal — browser form dialect', () => {
  it('303s to the Stripe portal for an owned installation with a customer record', async () => {
    stubGithubAndStripe([{ id: 7 }]);
    const { env, customers } = await makeSessionEnv();
    customers.set(7, 'cus_existing');
    const res = await handlePortalLink(formReq('/billing/portal', { installationId: '7' }), env);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(STRIPE_PORTAL_URL);
  });

  it('303s back with notice=no_customer before any purchase exists', async () => {
    stubGithubAndStripe([{ id: 7 }]);
    const { env } = await makeSessionEnv();
    const res = await handlePortalLink(formReq('/billing/portal', { installationId: '7' }), env);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/billing?notice=no_customer');
  });

  it("303s back with notice=forbidden for another tenant's installation", async () => {
    stubGithubAndStripe([{ id: 7 }]);
    const { env, customers } = await makeSessionEnv();
    customers.set(22, 'cus_other_tenant');
    const res = await handlePortalLink(formReq('/billing/portal', { installationId: '22' }), env);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/billing?notice=forbidden');
  });
});
