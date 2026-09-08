import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSession } from '../src/auth-github.js';
import { isFleetAdmin, managedFleetInstallations } from '../src/fleet-settings-access.js';
import { handleFleetSettingsPage, renderFleetSettings } from '../src/fleet-settings-page.js';
import { handleFleetPause } from '../src/fleet-observability.js';
import { controlDb } from './support/fleet-controls.js';
import { readFleetControl, writeFleetControl } from '../../../shared/fleet-controls.js';
import type { Env } from '../src/types.js';
import type { ResolvedSession } from '../src/auth-github.js';

vi.mock('../src/auth-github.js', async original => ({ ...await original<typeof import('../src/auth-github.js')>(), resolveSession: vi.fn() }));

const origin = 'https://relay.portdaddy.dev';
const session = { user: { id: 'u_erich', github_user_id: 2093678, login: 'erichowens' }, ghToken: 'synthetic-fixture', cacheNamespace: 'fixture' } as ResolvedSession;
let env: Env;
function request(path: string, form?: string, from: string | null = origin): Request {
  return new Request(origin + path, form === undefined ? {} : { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(from ? { Origin: from } : {}) }, body: form });
}
function installations(account: Record<string, unknown> = { id: 2093678, type: 'User', login: 'erichowens' }): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/memberships/')
    ? { state: 'active', role: 'admin' } : { installations: [{ id: 42, account }] })));
}
beforeEach(() => {
  env = { DB: controlDb(), PUBLIC_BASE_URL: origin, FLEET_ADMIN_GITHUB_IDS: '2093678', RELAY_OPERATOR_TOKEN: 'fixture-break-glass-token-longer-than32' } as Env;
  vi.mocked(resolveSession).mockResolvedValue(session);
  installations();
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Cloudflare administrator whitelist', () => {
  it('accepts only configured durable IDs, never matching login text or old roles', () => {
    expect(isFleetAdmin(session.user, env)).toBe(true);
    expect(isFleetAdmin({ ...session.user, github_user_id: 8 }, env)).toBe(false);
    for (const config of ['', ' ', '2093678,', '2093678,not-an-id', '2093678.0', '*', '9007199254740992']) {
      expect(isFleetAdmin(session.user, { ...env, FLEET_ADMIN_GITHUB_IDS: config })).toBe(false);
    }
  });
  it('refuses a non-allowlisted account for both admin reads and writes', async () => {
    vi.mocked(resolveSession).mockResolvedValue({ ...session, user: { ...session.user, github_user_id: 8 } });
    for (const req of [request('/admin/fleet'), request('/admin/fleet', 'enabled=false&revision=0')]) {
      expect((await handleFleetSettingsPage(req, env, true)).status).toBe(403);
    }
    expect((await readFleetControl(env.DB, 'global')).revision).toBe(0);
  });
  it('rejects the old break-glass global-control bypass', async () => {
    const req = new Request(origin + '/v1/fleet/pause', { method: 'POST', headers: { Authorization: `Bearer ${env.RELAY_OPERATOR_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: false, revision: 0 }) });
    expect((await handleFleetPause(req, env)).status).toBe(401);
  });
  it('redirects signed-out page requests to the existing login', async () => {
    vi.mocked(resolveSession).mockResolvedValue(null);
    const res = await handleFleetSettingsPage(request('/account/fleet'), env);
    expect(res.status).toBe(302); expect(res.headers.get('Location')).toBe('/login');
  });
});

describe('account settings authorization and durable writes', () => {
  it('checks current personal installation ownership and persists its own setting', async () => {
    const res = await handleFleetSettingsPage(request('/account/fleet', 'enabled=false&revision=0&installationId=42'), env);
    expect(res.status).toBe(303);
    expect(await readFleetControl(env.DB, 'installation:42')).toMatchObject({ enabled: false, revision: 1 });
    expect((await readFleetControl(env.DB, 'global')).revision).toBe(0);
  });
  it('refuses another installation and does not accept a supplied user/global scope', async () => {
    expect((await handleFleetSettingsPage(request('/account/fleet', 'enabled=true&revision=0&installationId=99'), env)).status).toBe(403);
    expect((await handleFleetSettingsPage(request('/account/fleet', 'enabled=true&revision=0&installationId=42&scope=global'), env)).status).toBe(400);
  });
  it('requires current organization ADMIN membership, not installation read access', async () => {
    installations({ id: 900, type: 'Organization', login: 'curiositech' });
    expect(await managedFleetInstallations(session, 42)).toEqual([{ id: 42, name: 'curiositech' }]);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/memberships/') ? { state: 'active', role: 'member' }
      : { installations: [{ id: 42, account: { id: 900, type: 'Organization', login: 'curiositech' } }] })));
    expect((await handleFleetSettingsPage(request('/account/fleet', 'enabled=false&revision=0&installationId=42'), env)).status).toBe(403);
  });
  it('never reuses an earlier authorization after GitHub membership is revoked', async () => {
    expect(await managedFleetInstallations(session, 42)).toHaveLength(1);
    installations({ id: 8, type: 'User', login: 'someone-else' });
    expect((await handleFleetSettingsPage(request('/account/fleet', 'enabled=true&revision=0&installationId=42'), env)).status).toBe(403);
  });
  it('fails closed on a GitHub authorization outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
    expect((await handleFleetSettingsPage(request('/account/fleet', 'enabled=true&revision=0&installationId=42'), env)).status).toBe(503);
  });
  it('refuses cross-origin and missing-Origin forms', async () => {
    for (const from of ['https://evil.example', null]) {
      expect((await handleFleetSettingsPage(request('/admin/fleet', 'enabled=true&revision=0', from), env, true)).status).toBe(403);
    }
  });
  it('refuses duplicate fields and a stale resume after a later stop', async () => {
    expect((await handleFleetSettingsPage(request('/admin/fleet', 'enabled=true&enabled=false&revision=0'), env, true)).status).toBe(400);
    await writeFleetControl(env.DB, 'global', true, 0, session.user.id);
    await writeFleetControl(env.DB, 'global', false, 1, session.user.id);
    expect((await handleFleetSettingsPage(request('/admin/fleet', 'enabled=true&revision=1'), env, true)).status).toBe(409);
    expect((await readFleetControl(env.DB, 'global')).enabled).toBe(false);
  });
  it('renders private script-free pages and identifies global override', async () => {
    const response = await handleFleetSettingsPage(request('/account/fleet'), env);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('Global status: off'); expect(html).toContain('Globally stopped');
    expect(html).not.toContain('<script'); expect(html).not.toContain('Fleet administration');
  });
  it('escapes displayed installation names and never presents read failures as enabled', () => {
    const unknown = { scope: 'global', enabled: false, revision: 0, available: false };
    const html = renderFleetSettings({ global: unknown, installations: [{ id: 42, name: '<script>bad</script>', control: unknown }], admin: false });
    expect(html).toContain('&lt;script&gt;bad'); expect(html).toContain('Unavailable · off');
    expect(html).not.toContain('<button');
  });
});
