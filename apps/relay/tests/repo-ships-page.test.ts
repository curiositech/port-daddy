import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveSession } from '../src/auth-github.js';
import { handleRepoShips, renderRepoShipsPage } from '../src/repo-ships-page.js';
import { readRepoShipControls, repoShipEnabled, setRepoShipControl } from '../../shared/repo-ship-controls.js';
import { shipControlsDb } from './ship-controls-db.js';
import { seedShipTelemetry } from './ship-telemetry-fixture.js';
import type { Env } from '../src/types.js';

vi.mock('../src/auth-github.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/auth-github.js')>(), resolveSession: vi.fn(),
}));
const BASE = 'https://relay.example';
let store: ReturnType<typeof shipControlsDb>;
let env: Env;
let admin = true;
let configStatus = 200;
let config = 'fleet:\n  agents:\n    purser:\n      class: purser\n      trigger: pull_request:opened\n';
function request(fields: Record<string, string>, origin = BASE) {
  return new Request(`${BASE}/account/ships/set`, { method: 'POST', headers: { Origin: origin }, body: new URLSearchParams(fields) });
}
const off = { repo: 'Owner/Repo', ship: 'purser', enabled: 'off', revision: '0' };

beforeEach(() => {
  store = shipControlsDb();
  env = { DB: store.db, DEFAULT_BRANCH: 'main', PUBLIC_BASE_URL: BASE } as unknown as Env;
  admin = true; configStatus = 200;
  config = 'fleet:\n  agents:\n    purser:\n      class: purser\n      trigger: pull_request:opened\n';
  vi.mocked(resolveSession).mockResolvedValue({ user: { id: 'admin-1' }, ghToken: 'mock-user-token', cacheNamespace: 'test' } as never);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => input.includes('/contents/')
    ? new Response(config, { status: configStatus })
    : Response.json({ full_name: 'owner/repo', permissions: { admin } })));
});
afterEach(() => { store.sqlite.close(); vi.unstubAllGlobals(); });

describe('repository ship storage and authority', () => {
  it('supports dot-prefixed repositories and D1 trigger-inclusive change counts', async () => {
    expect(await setRepoShipControl(store.db, 'Owner/.github', '*', false, 0, 'admin')).toBe(true);
    expect(repoShipEnabled(await readRepoShipControls(store.db, 'owner/.github'), 'qa')).toBe(false);
    expect(await setRepoShipControl(store.db, 'Owner/.github', '*', true, 0, 'admin')).toBe(false);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM repo_ship_control_events').get()!.n).toBe(1);
  });
  it('saves case-insensitive repo state and an atomic audit event; other repos are unaffected', async () => {
    const result = await handleRepoShips(request(off), env);
    expect(result.status).toBe(303);
    const saved = await readRepoShipControls(store.db, 'OWNER/REPO');
    expect(repoShipEnabled(saved, 'purser')).toBe(false);
    expect(repoShipEnabled(saved, 'qa')).toBe(true);
    expect(repoShipEnabled(await readRepoShipControls(store.db, 'owner/other'), 'purser')).toBe(true);
    expect(store.sqlite.prepare('SELECT ship, enabled, updated_by FROM repo_ship_control_events').all())
      .toEqual([{ ship: 'purser', enabled: 0, updated_by: 'admin-1' }]);
    expect(fetch).toHaveBeenCalledTimes(2); // metadata and config only; no launch/AI
  });
  it('rejects stale ON forms without changing the gate or audit log', async () => {
    await handleRepoShips(request(off), env);
    const stale = await handleRepoShips(request({ ...off, enabled: 'on' }), env);
    expect(stale.status).toBe(409);
    expect(repoShipEnabled(await readRepoShipControls(store.db, off.repo), 'purser')).toBe(false);
    expect(store.sqlite.prepare('SELECT * FROM repo_ship_control_events').all()).toHaveLength(1);
    expect((await handleRepoShips(request({ ...off, enabled: 'on', revision: '1' }), env)).status).toBe(303);
    expect(repoShipEnabled(await readRepoShipControls(store.db, off.repo), 'purser')).toBe(true);
  });
  it('requires a fresh admin witness on every write, even for public repos', async () => {
    await handleRepoShips(request(off), env);
    admin = false;
    expect((await handleRepoShips(request({ ...off, enabled: 'on', revision: '1' }), env)).status).toBe(403);
    expect(repoShipEnabled(await readRepoShipControls(store.db, off.repo), 'purser')).toBe(false);
  });
  it('accepts dotted ship names exactly as the executor does', async () => {
    config = 'fleet:\n  agents:\n    audit.security:\n      prompt: Audit security\n      trigger: pull_request:opened\n';
    expect((await handleRepoShips(request({ ...off, ship: 'audit.security' }), env)).status).toBe(303);
    expect(repoShipEnabled(await readRepoShipControls(store.db, off.repo), 'audit.security')).toBe(false);
  });
  it('rejects an oversized body even without Content-Length, before GitHub or SQL', async () => {
    const oversized = request({ ...off, padding: 'x'.repeat(8192) });
    expect(oversized.headers.get('Content-Length')).toBeNull();
    expect((await handleRepoShips(oversized, env)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.sqlite.prepare('SELECT * FROM repo_ship_control_events').all()).toHaveLength(0);
  });
  it('refuses cross-origin writes, signed-out requests, and invented ships', async () => {
    expect((await handleRepoShips(request(off, 'https://evil.example'), env)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect((await handleRepoShips(request({ ...off, ship: 'invented' }), env)).status).toBe(400);
    vi.mocked(resolveSession).mockResolvedValue(null);
    expect((await handleRepoShips(request(off), env)).headers.get('Location')).toBe('/login');
    expect(store.sqlite.prepare('SELECT * FROM repo_ship_control_events').all()).toHaveLength(0);
  });
  it('lets admins turn the repository off during a config outage, but never on', async () => {
    configStatus = 503;
    expect((await handleRepoShips(request({ ...off, ship: '*' }), env)).status).toBe(303);
    expect((await handleRepoShips(request({ ...off, ship: '*', enabled: 'on', revision: '1' }), env)).status).toBe(503);
    await setRepoShipControl(store.db, off.repo, 'purser', true, 0, 'admin-1');
    expect(repoShipEnabled(await readRepoShipControls(store.db, off.repo), 'purser')).toBe(false);
  });
  it('fails closed on missing binding/table and malformed control data', async () => {
    expect(repoShipEnabled(await readRepoShipControls(undefined, off.repo), 'qa')).toBe(false);
    store.sqlite.exec('DROP TABLE repo_ship_controls');
    expect(repoShipEnabled(await readRepoShipControls(store.db, off.repo), 'qa')).toBe(false);
    expect((await handleRepoShips(request(off), env)).status).toBe(503);
  });
  it('cannot write invalid values past SQL checks', () => {
    expect(() => store.sqlite.exec("INSERT INTO repo_ship_controls VALUES ('owner/repo', 'qa', 2, 1, 'admin', 0)")).toThrow();
    expect(() => store.sqlite.exec("INSERT INTO repo_ship_controls VALUES ('Owner/Repo', 'qa', 0, 1, 'admin', 0)")).toThrow();
  });
});

describe('signed-in ship UI', () => {
  it('offers credential renewal without exposing repository data when the GitHub token is unavailable', async () => {
    const prepare = vi.spyOn(store.db, 'prepare');
    vi.mocked(resolveSession).mockResolvedValue({ user: { id: 'admin-1' }, ghToken: null, cacheNamespace: 'test' } as never);
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    const body = await result.text();
    expect(result.status).toBe(403);
    expect(body).toContain('Reconnect GitHub to continue.');
    expect(body).toContain('href="/auth/github/login?return_to=%2Faccount%2Fships%3Frepo%3Downer%2Frepo&amp;reauth=1"');
    expect(body).toContain('Back to account');
    expect(prepare).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'Reconnect GitHub to continue.', '/auth/github/login?return_to=%2Faccount%2Fships%3Frepo%3Downer%2Frepo&amp;reauth=1', 403, 1],
    [403, 'GitHub did not grant repository access.', '/auth/github/login?return_to=%2Faccount%2Fships%3Frepo%3Downer%2Frepo&amp;reauth=1', 403, 1],
    [404, 'GitHub did not grant repository access.', '/auth/github/login?return_to=%2Faccount%2Fships%3Frepo%3Downer%2Frepo&amp;reauth=1', 403, 1],
    [429, 'GitHub API limit reached.', '/account/ships?repo=owner%2Frepo', 503, 1],
    [503, 'GitHub repository check failed.', '/account/ships?repo=owner%2Frepo', 503, 2],
  ])('distinguishes GitHub status %s without querying private telemetry', async (upstream, message, action, status, calls) => {
    const prepare = vi.spyOn(store.db, 'prepare');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: upstream }));
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    const body = await result.text();
    expect(result.status).toBe(status);
    expect(body).toContain(message);
    expect(body).toContain(`href="${action}"`);
    if (upstream === 403 || upstream === 404) {
      expect(body).toContain('href="https://github.com/settings/installations"');
      expect(body).toContain('Manage GitHub App access');
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(calls);
    warning.mockRestore();
  });
  it('reports GitHub rate limiting as temporary and includes a trustworthy reset time', async () => {
    const prepare = vi.spyOn(store.db, 'prepare');
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 403, headers: {
      'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1789113313',
    } }));
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    const body = await result.text();
    expect(result.status).toBe(503);
    expect(body).toContain('GitHub API limit reached.');
    expect(body).toContain('2026-09-11T07:55:13.000Z');
    expect(body).toContain('No ship setting changed.');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('classifies a bare GitHub 429 as rate limiting when advisory headers are absent', async () => {
    const prepare = vi.spyOn(store.db, 'prepare');
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 429 }));
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    const body = await result.text();
    expect(result.status).toBe(503);
    expect(body).toContain('GitHub API limit reached.');
    expect(body).toContain('No ship setting changed.');
    expect(body).not.toContain('GitHub could not be reached.');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('retries one transient GitHub failure before granting a fresh witness', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ full_name: 'owner/repo', permissions: { admin: true } }))
      .mockResolvedValueOnce(new Response(config));
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    expect(result.status).toBe(200);
    expect(await result.text()).toContain('All cloud ships');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('reports a persistent upstream status with a safe GitHub request reference', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 503, headers: {
      'X-GitHub-Request-Id': 'SAFE:REQUEST:ID',
    } }));
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    const body = await result.text();
    expect(result.status).toBe(503);
    expect(body).toContain('GitHub repository check failed.');
    expect(body).toContain('status 503 (request SAFE:REQUEST:ID)');
    expect(body).toContain('Reconnect GitHub');
    expect(body).not.toContain('mock-user-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith('repo-witness-unavailable', {
      reason: 'github-status', status: 503, requestId: 'SAFE:REQUEST:ID',
    });
    warning.mockRestore();
  });
  it('retries a transport exception once, then reports only its safe class', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fetch).mockRejectedValue(new TypeError('secret network detail'));
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    const body = await result.text();
    expect(result.status).toBe(503);
    expect(body).toContain('The Relay could not complete the GitHub repository check.');
    expect(body).not.toContain('secret network detail');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith('repo-witness-unavailable', {
      reason: 'transport', error: 'TypeError',
    });
    warning.mockRestore();
  });
  it.each([
    [Response.json({}), 'malformed-response', 'response the Relay could not verify'],
    [Response.json({ full_name: 'owner/other' }), 'repository-mismatch', 'different repository identity'],
  ])('keeps %s GitHub evidence unavailable as %s', async (upstream, reason, detail) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(upstream);
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    expect(result.status).toBe(503);
    expect(await result.text()).toContain(detail);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls.at(-1)?.[1]).toMatchObject({ reason });
    warning.mockRestore();
  });
  it('honors Retry-After instead of immediately retrying a GitHub 503', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 503, headers: { 'Retry-After': '60' } }));
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    expect(result.status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });
  it('drops an untrusted GitHub request reference instead of reflecting or logging it', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 502, headers: {
      'X-GitHub-Request-Id': '<script>not-a-request-id</script>',
      'Retry-After': '60',
    } }));
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo`), env);
    const body = await result.text();
    expect(result.status).toBe(503);
    expect(body).not.toContain('not-a-request-id');
    expect(warning).toHaveBeenCalledWith('repo-witness-unavailable', {
      reason: 'github-status', status: 502, requestId: undefined,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });
  it('does not query private telemetry before fresh repository authorization', async () => {
    const prepare = vi.spyOn(store.db, 'prepare');
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
    const denied = await handleRepoShips(new Request(`${BASE}/account/ships?repo=private/other`), env);
    expect(denied.status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
    vi.mocked(resolveSession).mockResolvedValue(null);
    expect((await handleRepoShips(new Request(`${BASE}/account/ships?repo=private/other`), env)).status).toBe(302);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('reads saved state, names the repo, and presents an explicit save action', async () => {
    await handleRepoShips(request(off), env);
    const result = await handleRepoShips(new Request(`${BASE}/account/ships?repo=owner/repo&saved=1`), env);
    const body = await result.text();
    expect(body).toContain('Saved. The state below was read back');
    expect(body).toContain('Turn purser on for owner/repo');
    expect(body).toContain('value="1"');
    expect(body).toContain('does not launch a job');
    expect(body).not.toContain('mock-user-token');
    expect(body).not.toContain('<script');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
  it('is read-only for non-admins and escapes untrusted roster text', () => {
    const body = renderRepoShipsPage('owner/repo', [{ name: 'qa', role: '<script>bad</script>', trigger: 'pull_request:opened' }], { available: true, rows: [] }, false);
    expect(body).not.toContain('action="/account/ships/set"');
    expect(body).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(body).toContain('separate Steward service');
  });
});

// Opt-in visual acceptance uses the real handler and real SQLite, with only
// GitHub identity/config mocked. An ephemeral loopback HTTP adapter preserves
// browser redirects and Origin semantics; no deployed relay, PD, or paid AI runs.
it.skipIf(!process.env.SHIP_CONTROLS_PROOF_DIR)('records browser control round-trip and responsive proof', async () => {
  seedShipTelemetry(store.sqlite);
  const { chromium } = await import('playwright');
  const { createServer } = await import('node:http');
  const directory = process.env.SHIP_CONTROLS_PROOF_DIR!;
  let base = '';
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const response = await handleRepoShips(new Request(`${base}${incoming.url}`, {
        method: incoming.method, headers: incoming.headers as Record<string, string>,
        ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      }), env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch { outgoing.writeHead(500); outgoing.end('Fixture request failed'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
  env.PUBLIC_BASE_URL = base;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: directory } });
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/account/ships?repo=owner/repo`);
    await page.getByRole('button', { name: 'Turn purser off for owner/repo', exact: true }).click();
    await expect.poll(() => page.locator('body').innerText(), { timeout: 5000 }).toContain('Saved.');
    await expect.poll(() => page.getByRole('button', { name: 'Turn purser on for owner/repo', exact: true }).count()).toBe(1);
    expect(repoShipEnabled(await readRepoShipControls(store.db, 'owner/repo'), 'purser')).toBe(false);
    await page.getByText('purser activity, costs and transcripts', { exact: true }).click();
    await expect.poll(() => page.getByRole('link', { name: 'Read purser transcript · 8 turns · incomplete →', exact: true }).count()).toBe(2);
    expect(await page.getByText('Sandbox test import failed; contract was not tested.', { exact: false }).count()).toBeGreaterThan(0);
    await page.screenshot({ path: `${directory}/ships-light.png`, fullPage: true });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.screenshot({ path: `${directory}/ships-dark.png`, fullPage: true });
    await page.getByRole('button', { name: 'Turn purser on for owner/repo', exact: true }).click();
    await expect.poll(() => page.getByRole('button', { name: 'Turn purser off for owner/repo', exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: 'Turn All cloud ships off for owner/repo', exact: true }).click();
    await expect.poll(() => page.getByText('Held by All cloud ships').count()).toBeGreaterThan(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${directory}/ships-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => document.documentElement.style.zoom = '2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${directory}/ships-200pct.png`, fullPage: true });
    vi.mocked(resolveSession).mockResolvedValue({ user: { id: 'admin-1' }, ghToken: null, cacheNamespace: 'test' } as never);
    await page.goto(`${base}/account/ships?repo=owner/repo`);
    await expect.poll(() => page.getByRole('link', { name: 'Choose GitHub account', exact: true }).count()).toBe(1);
    expect(await page.getByRole('link', { name: 'Choose GitHub account', exact: true }).getAttribute('href')).toContain('reauth=1');
    await page.screenshot({ path: `${directory}/ships-auth-renew.png`, fullPage: true });
    vi.mocked(resolveSession).mockResolvedValue({ user: { id: 'admin-1' }, ghToken: 'mock-user-token', cacheNamespace: 'test' } as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429, headers: {
      'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1789113313',
    } })));
    await page.goto(`${base}/account/ships?repo=owner/repo`);
    await expect.poll(() => page.getByRole('heading', { name: 'GitHub API limit reached.', exact: true }).count()).toBe(1);
    await page.screenshot({ path: `${directory}/ships-rate-limited.png`, fullPage: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503, headers: {
      'X-GitHub-Request-Id': 'SAFE:PROOF:REFERENCE',
    } })));
    await page.goto(`${base}/account/ships?repo=owner/repo`);
    await expect.poll(() => page.getByRole('heading', { name: 'GitHub repository check failed.', exact: true }).count()).toBe(1);
    await expect.poll(() => page.getByRole('link', { name: 'Reconnect GitHub', exact: true }).count()).toBe(1);
    expect(await page.getByRole('link', { name: 'Reconnect GitHub', exact: true }).getAttribute('href')).toContain('reauth=1');
    await page.screenshot({ path: `${directory}/ships-repository-check-failed.png`, fullPage: true });
  } finally {
    await context.close(); await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 30_000);
