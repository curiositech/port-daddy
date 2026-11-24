import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, makeDb, type TestDb } from './helpers/d1-sqlite.js';
import { handleAccountPage, handleLoginPage } from '../src/account-page.js';
import { handleGithubLogin } from '../src/auth-github.js';
import { handleRegisterApi, handleRegisterPage, handleRegisterPageAction } from '../src/work-register.js';
import { base64UrlEncode, fromHex, hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const REPO = 'Synthetic-Fixture/Harbor-Demo';
const DENIED_REPO = 'Synthetic-Fixture/Denied';
const USER_ID = 'u_synthetic';
const COOKIE = 'register-browser-session';
const WRAP_KEY = 'cc'.repeat(32);

let db: TestDb;
let env: Env;

async function seal(token: string): Promise<{ enc: string; iv: string }> {
  const key = await crypto.subtle.importKey('raw', fromHex(WRAP_KEY), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
  );
  return { enc: base64UrlEncode(ciphertext), iv: base64UrlEncode(iv) };
}

function kv(): KVNamespace {
  const rows = new Map<string, string>();
  return {
    get: async (key: string) => rows.get(key) ?? null,
    put: async (key: string, value: string) => void rows.set(key, value),
    delete: async (key: string) => void rows.delete(key),
  } as unknown as KVNamespace;
}

function formRequest(action: 'authorize' | 'revoke', fields: Record<string, string>, origin = BASE): Request {
  return new Request(`${BASE}/account/register/${action}`, {
    method: 'POST',
    headers: {
      Cookie: `__Host-pd_session=${COOKIE}`,
      Origin: origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
  });
}

function openRegister(repo?: string): Promise<Response> {
  const url = new URL('/account/register', BASE);
  if (repo !== undefined) url.searchParams.set('repo', repo);
  return handleRegisterPage(new Request(url, { headers: { Cookie: `__Host-pd_session=${COOKIE}` } }), env);
}

function memberships(): unknown[] {
  return db.raw.prepare('SELECT repo_full_name, user_id FROM work_board_members').all();
}

beforeEach(async () => {
  db = makeDb(applyAllMigrations());
  const sealed = await seal('github-token');
  const at = Math.floor(Date.now() / 1000);
  db.raw
    .prepare('INSERT INTO users (id, github_user_id, login, created_at) VALUES (?, ?, ?, ?)')
    .run(USER_ID, 1, 'synthetic-fixture', at);
  db.raw
    .prepare(
      `INSERT INTO web_sessions
         (token_hash, user_id, gh_token_enc, gh_token_iv, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(hashHex(COOKIE), USER_ID, sealed.enc, sealed.iv, at, at + 3600);
  env = {
    DB: db.DB,
    KV: kv(),
    PUBLIC_BASE_URL: BASE,
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
  } as unknown as Env;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response('{}', {
    status: url === `https://api.github.com/repos/${REPO}`
      || url === 'https://api.github.com/user/installations?per_page=100' ? 200 : 404,
  })));
});

afterEach(() => vi.unstubAllGlobals());

describe('choosing a Register repository', () => {
  it('requires a browser session even for the repository chooser', async () => {
    const response = await handleRegisterPage(new Request(`${BASE}/account/register`), env);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/login');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders a labeled GET form without looking up or enrolling a repository', async () => {
    const response = await openRegister();
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<form method="get" action="/account/register">');
    expect(html).toContain('<label for="register-repo">GitHub owner/repository');
    expect(html).toContain('<input id="register-repo" name="repo" required');
    expect(html).toContain('<button type="submit">Open board</button>');
    expect(html).not.toContain('Authorize this task');
    expect(fetch).not.toHaveBeenCalled();
    expect(memberships()).toEqual([]);
  });

  it.each(['', 'owner/repository/extra', '<b>invalid</b>'])('lets malformed repository input retry (%j)', async input => {
    const response = await openRegister(input);
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('Enter a GitHub repository as owner/repository, without the GitHub URL.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('<form method="get" action="/account/register">');
    if (input) expect(html).not.toContain(input);
    expect(fetch).not.toHaveBeenCalled();
    expect(memberships()).toEqual([]);
  });

  it('offers a retry after an exact repo ACL refusal, then enrolls only the allowed repo', async () => {
    const refused = await openRegister(DENIED_REPO);
    expect(refused.status).toBe(403);
    const retry = await refused.text();
    expect(retry).toContain('No access. Check the repository name');
    expect(retry).toContain('<form method="get" action="/account/register">');
    expect(retry).not.toContain('Authorize this task');
    expect(retry).not.toContain(DENIED_REPO);
    expect(memberships()).toEqual([]);

    const allowed = await openRegister(REPO);
    expect(allowed.status).toBe(200);
    const board = await allowed.text();
    expect(board).toContain('Authorize this task');
    expect(board).toContain(`name="repo" value="${REPO}"`);
    expect(memberships()).toEqual([{ repo_full_name: REPO, user_id: USER_ID }]);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url))
      .toEqual([`https://api.github.com/repos/${DENIED_REPO}`, `https://api.github.com/repos/${REPO}`]);
  });
});

describe('the browser approval surface', () => {
  it('shows a one-use code once and persists only its hash', async () => {
    const response = await handleRegisterPageAction(
      formRequest('authorize', { repo: REPO, agent: 'codex:register-recovery' }),
      env,
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    const code = /pdr_pair_[0-9a-f]{64}/.exec(html)?.[0];
    expect(code).toBeTruthy();
    expect(html).toContain('works only on this repository');

    const stored = db.raw
      .prepare('SELECT pairing_code_hash, token_hash, agent, repo_full_name FROM work_register_grants')
      .get() as { pairing_code_hash: string; token_hash: null; agent: string; repo_full_name: string };
    expect(stored.pairing_code_hash).toBe(hashHex(code!));
    expect(JSON.stringify(stored)).not.toContain(code!);
    expect(stored.token_hash).toBeNull();
    expect(stored.agent).toBe('codex:register-recovery');
    expect(stored.repo_full_name).toBe(REPO);
  });

  it('renders grants without ever rendering credential material', async () => {
    const made = await handleRegisterPageAction(
      formRequest('authorize', { repo: REPO, agent: 'codex:register-recovery' }),
      env,
    );
    const pairingCode = /pdr_pair_[0-9a-f]{64}/.exec(await made.text())?.[0] ?? '';
    const page = await handleRegisterPage(
      new Request(`${BASE}/account/register?repo=${encodeURIComponent(REPO)}`, {
        headers: { Cookie: `__Host-pd_session=${COOKIE}` },
      }),
      env,
    );
    const html = await page.text();
    expect(html).toContain('Authorize this task');
    expect(html).toContain('codex:register-recovery');
    expect(html).not.toContain(pairingCode);
    expect(html).not.toContain('pd roadmap push');
  });

  it('revokes only through the signed-in same-origin surface', async () => {
    await handleRegisterPageAction(
      formRequest('authorize', { repo: REPO, agent: 'codex:register-recovery' }),
      env,
    );
    const grant = db.raw.prepare('SELECT id FROM work_register_grants').get() as { id: string };

    const crossOrigin = await handleRegisterPageAction(
      formRequest('revoke', { repo: REPO, grant_id: grant.id }, 'https://attacker.example'),
      env,
    );
    expect(crossOrigin.status).toBe(403);
    expect((db.raw.prepare('SELECT revoked_at FROM work_register_grants').get() as { revoked_at: null }).revoked_at).toBeNull();

    const revoked = await handleRegisterPageAction(
      formRequest('revoke', { repo: REPO, grant_id: grant.id }),
      env,
    );
    expect(revoked.status).toBe(303);
    expect((db.raw.prepare('SELECT revoked_at FROM work_register_grants').get() as { revoked_at: number }).revoked_at).toBeGreaterThan(0);
  });

  it('does not let an invalid Register bearer fall through to a wider browser session', async () => {
    const response = await handleRegisterApi(
      new Request(`${BASE}/v1/register/board?repo=${encodeURIComponent(REPO)}`, {
        headers: {
          Cookie: `__Host-pd_session=${COOKIE}`,
          Authorization: 'Bearer pdr_not-a-real-token',
        },
      }),
      env,
    );
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// Opt-in browser proof routes every request in-process. The session is seeded
// instead of completing GitHub OAuth, and GitHub API responses are synthetic.
it.skipIf(!process.env.REGISTER_TASK_PROOF_DIR)(
  'follows the synthetic login-to-Register journey on desktop and mobile',
  async () => {
    const { chromium } = await import('playwright');
    const directory = process.env.REGISTER_TASK_PROOF_DIR!;
    const browser = await chromium.launch({ headless: true });
    try {
      for (const [size, colorScheme] of [
        ['desktop', 'light'], ['desktop', 'dark'], ['mobile', 'light'], ['mobile', 'dark'],
      ] as const) {
        const variant = `${size}-${colorScheme}`;
        const recording = variant === 'desktop-light';
        const viewport = size === 'desktop' ? { width: 1280, height: 900 } : { width: 390, height: 844 };
        const context = await browser.newContext({
          viewport, colorScheme, serviceWorkers: 'block',
          ...(recording ? { recordVideo: { dir: directory, size: viewport } } : {}),
        });
        const page = await context.newPage();
        const video = page.video();
        try {
          await context.route('**/*', async route => {
            const incoming = route.request();
            const url = new URL(incoming.url());
            if (url.origin !== BASE) return route.abort();
            const request = new Request(url, {
              method: incoming.method(),
              headers: await incoming.allHeaders(),
              body: incoming.postDataBuffer(),
            });
            let response: Response;
            if (url.pathname === '/login') response = handleLoginPage();
            else if (url.pathname === '/account') response = await handleAccountPage(request, env);
            else if (url.pathname === '/account/register') response = await handleRegisterPage(request, env);
            else if (url.pathname === '/account/register/authorize') response = await handleRegisterPageAction(request, env);
            else return route.abort();
            await route.fulfill({
              status: response.status,
              headers: Object.fromEntries(response.headers),
              body: await response.text(),
            });
          });
          const capture = async (step: string) => {
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.screenshot({ path: `${directory}/synthetic-${variant}-${step}.png`, fullPage: true });
            // Hold each recorded state long enough to read it in the motion proof.
            if (recording) await page.waitForTimeout(750);
          };

          expect((await page.goto(`${BASE}/login`))?.status()).toBe(200);
          const link = page.getByRole('link', { name: 'Harbor Work Register' });
          expect(await link.isVisible()).toBe(true);
          const authUrl = new URL((await link.getAttribute('href'))!, page.url());
          expect(authUrl.href).toBe(`${BASE}/auth/github/login?return_to=%2Faccount%2Fregister`);
          const oauth = await handleGithubLogin(new Request(authUrl), {
            ...env, GITHUB_OAUTH_CLIENT_ID: 'synthetic-client', GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-secret',
          });
          expect(oauth.status).toBe(302);
          const authorize = new URL(oauth.headers.get('Location')!);
          expect(authorize.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/github/callback`);
          expect(authorize.searchParams.has('scope')).toBe(false);
          const state = await env.KV.get(`oauth_state:${authorize.searchParams.get('state')}`);
          expect(JSON.parse(state!).returnTo).toBe('/account/register');
          if (recording) await link.focus();
          await capture('login');

          await context.addCookies([{
            name: '__Host-pd_session', value: COOKIE, url: BASE, secure: true, httpOnly: true, sameSite: 'Lax',
          }]);
          expect((await page.goto(`${BASE}/account`))?.status()).toBe(200);
          await capture('account');
          const navLink = page.getByRole('navigation', { name: 'Account', exact: true })
            .getByRole('link', { name: 'Harbor Work Register' });
          await navLink.click();
          expect(page.url()).toBe(`${BASE}/account/register`);
          const repo = page.getByRole('textbox', { name: 'GitHub owner/repository' });
          await page.keyboard.press('Tab');
          expect(await repo.evaluate(element => element === document.activeElement)).toBe(true);
          await capture('chooser');
          await repo.pressSequentially(REPO, { delay: recording ? 50 : 0 });
          await page.keyboard.press('Tab');
          const open = page.getByRole('button', { name: 'Open board' });
          expect(await open.evaluate(element => element === document.activeElement)).toBe(true);
          const boardResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('repo') === REPO);
          await page.keyboard.press('Enter');
          expect((await boardResponse).status()).toBe(200);
          await page.getByRole('heading', { name: 'Authorize this task' }).waitFor();
          expect(memberships()).toEqual([{ repo_full_name: REPO, user_id: USER_ID }]);
          await capture('board');

          if (variant === 'mobile-dark') {
            // Keep the synthetic pairing-code screen out of the captured media.
            await page.getByLabel('Task name').fill('codex:synthetic-fixture');
            await page.getByRole('button', { name: 'Make one-use code' }).click();
            await page.getByRole('heading', { name: 'Task approved' }).waitFor();
            await page.getByRole('link', { name: 'Return to the board' }).click();
            await page.getByText('codex:synthetic-fixture', { exact: true }).waitFor();
          }
        } finally {
          await context.close();
        }
        if (video) {
          await video.saveAs(`${directory}/synthetic-register-journey.webm`);
          await video.delete();
        }
      }
    } finally {
      await browser.close();
    }
  },
  30_000,
);
