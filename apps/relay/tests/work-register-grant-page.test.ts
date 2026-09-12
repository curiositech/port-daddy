import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, makeDb, type TestDb } from './helpers/d1-sqlite.js';
import { handleRegisterApi, handleRegisterPage, handleRegisterPageAction } from '../src/work-register.js';
import { base64UrlEncode, fromHex, hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const REPO = 'curiositech/port-daddy';
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

beforeEach(async () => {
  db = makeDb(applyAllMigrations());
  const sealed = await seal('github-token');
  const at = Math.floor(Date.now() / 1000);
  db.raw
    .prepare('INSERT INTO users (id, github_user_id, login, created_at) VALUES (?, ?, ?, ?)')
    .run('u_erich', 1, 'erich-owens', at);
  db.raw
    .prepare(
      `INSERT INTO web_sessions
         (token_hash, user_id, gh_token_enc, gh_token_iv, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(hashHex(COOKIE), 'u_erich', sealed.enc, sealed.iv, at, at + 3600);
  env = {
    DB: db.DB,
    KV: kv(),
    PUBLIC_BASE_URL: BASE,
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
  } as unknown as Env;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => vi.unstubAllGlobals());

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

// Opt-in browser proof uses the real server-rendered handlers, migration chain,
// session crypto and D1 fixture. GitHub ACL is the sole mocked boundary; no
// deployed Relay, local Port Daddy process or paid model is involved.
it.skipIf(!process.env.REGISTER_TASK_PROOF_DIR)(
  'records task approval and responsive Register proof',
  async () => {
    const { chromium } = await import('playwright');
    const { createServer } = await import('node:http');
    const directory = process.env.REGISTER_TASK_PROOF_DIR!;
    let base = '';
    const server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers(incoming.headers as Record<string, string>);
        headers.set('Cookie', `__Host-pd_session=${COOKIE}`);
        const request = new Request(`${base}${incoming.url}`, {
          method: incoming.method,
          headers,
          ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
        });
        const response = incoming.method === 'POST'
          ? await handleRegisterPageAction(request, env)
          : await handleRegisterPage(request, env);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(await response.text());
      } catch {
        outgoing.writeHead(500);
        outgoing.end('Fixture request failed');
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as { port: number };
    base = `http://127.0.0.1:${address.port}`;
    env.PUBLIC_BASE_URL = base;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await context.route('**/*', route =>
        new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(`${base}/account/register?repo=${encodeURIComponent(REPO)}`);
      await page.getByLabel('Task name').fill('codex:register-recovery');
      await page.getByRole('button', { name: 'Make one-use code' }).click();
      await expect.poll(() => page.getByText('Task approved', { exact: true }).count()).toBe(1);
      await page.getByRole('link', { name: 'Return to the board' }).click();
      await expect.poll(() => page.getByText('codex:register-recovery', { exact: true }).count()).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `${directory}/register-task-light.png`, fullPage: true });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await page.screenshot({ path: `${directory}/register-task-dark.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `${directory}/register-task-mobile.png`, fullPage: true });
    } finally {
      await context.close();
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()));
    }
  },
  30_000,
);
