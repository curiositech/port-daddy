/**
 * Tests for the per-repo settings screen (src/repo-settings-page.ts).
 * Coverage:
 *   - normalizeRepoFullName: accepts owner/name (and a pasted GitHub URL),
 *     rejects enumeration-shaped garbage;
 *   - normalizeSitrepLevel: closed enum, garbage → null;
 *   - renderRepoSettingsPage: script-free; renders REAL rows with the saved
 *     dial checked; empty state teaches (no fabricated rows — repo law);
 *     honest about the local enforcement point (agent.config.json snippet +
 *     the /v1/repo-settings device read path);
 *   - handleRepoSettingsPage: no session → 302 /login (the logged-in-only gate);
 *   - handleRepoSettingsApi: no auth → 401 (device read path is gated too).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeRepoFullName,
  normalizeSitrepLevel,
  renderRepoSettingsPage,
  handleRepoSettingsPage,
  handleRepoSettingsApi,
  type RepoSettingRow,
} from '../src/repo-settings-page.js';
import type { UserRow } from '../src/db.js';
import type { Env } from '../src/types.js';

const baseUser: UserRow = {
  id: 'u_abc',
  github_user_id: 123456,
  login: 'erichowens',
  display_name: 'Erich Owens',
  avatar_url: null,
  primary_email: 'erich@example.com',
  email_verified: 1,
  created_at: 1_700_000_000,
  last_login_at: null,
  deleted_at: null,
};

const rows: RepoSettingRow[] = [
  {
    repo_full_name: 'curiositech/port-daddy',
    sitrep_end_of_turn: 'enforce',
    settings_json: '{}',
    updated_at: 1_755_600_000,
  },
  {
    repo_full_name: 'curiositech/windags',
    sitrep_end_of_turn: 'off',
    settings_json: '{}',
    updated_at: 1_755_500_000,
  },
];

describe('normalizeRepoFullName', () => {
  it('accepts owner/name and normalizes a pasted GitHub URL', () => {
    expect(normalizeRepoFullName('curiositech/port-daddy')).toBe('curiositech/port-daddy');
    expect(normalizeRepoFullName('  curiositech/port-daddy  ')).toBe('curiositech/port-daddy');
    expect(normalizeRepoFullName('https://github.com/curiositech/port-daddy.git')).toBe(
      'curiositech/port-daddy',
    );
  });
  it('rejects shapes that could probe or break downstream surfaces', () => {
    expect(normalizeRepoFullName('no-slash')).toBeNull();
    expect(normalizeRepoFullName('a/b/c')).toBeNull();
    expect(normalizeRepoFullName('owner/.dotfirst')).toBeNull();
    expect(normalizeRepoFullName('owner/name with spaces')).toBeNull();
    expect(normalizeRepoFullName('-lead/repo')).toBeNull();
    expect(normalizeRepoFullName(42)).toBeNull();
    expect(normalizeRepoFullName('owner/<script>')).toBeNull();
  });
});

describe('normalizeSitrepLevel', () => {
  it('is a closed enum', () => {
    expect(normalizeSitrepLevel('off')).toBe('off');
    expect(normalizeSitrepLevel(' Suggest ')).toBe('suggest');
    expect(normalizeSitrepLevel('ENFORCE')).toBe('enforce');
    expect(normalizeSitrepLevel('loudly')).toBeNull();
    expect(normalizeSitrepLevel(undefined)).toBeNull();
  });
});

describe('renderRepoSettingsPage', () => {
  const html = renderRepoSettingsPage(baseUser, rows);
  it('is script-free (ships under a no-script CSP)', () => {
    expect(html).not.toContain('<script');
  });
  it('renders the real rows with the stored dial checked', () => {
    expect(html).toContain('curiositech/port-daddy');
    expect(html).toContain('curiositech/windags');
    // enforce is checked on the first repo
    expect(html).toMatch(/value="enforce"\s+checked/);
  });
  it('describes the sitrep contract on the setting itself', () => {
    expect(html).toContain('Sitrep — end-of-turn report');
    expect(html).toContain('roadmap');
  });
  it('is honest about local enforcement (no server-reaches-into-checkouts fiction)', () => {
    expect(html).toContain('agent.config.json');
    expect(html).toContain('/v1/repo-settings');
    expect(html).toContain('never');
  });
  it('teaches with an empty state instead of fabricating rows', () => {
    const emptyHtml = renderRepoSettingsPage(baseUser, []);
    expect(emptyHtml).toContain('No repositories configured yet.');
    expect(emptyHtml).not.toContain('<article class="repo-card"');
  });
  it('escapes interpolated data (XSS guard)', () => {
    const evil = renderRepoSettingsPage(
      { ...baseUser, login: '<img src=x onerror=alert(1)>' },
      [],
    );
    expect(evil).not.toContain('<img src=x');
  });
});

describe('session gates', () => {
  // An Env whose DB throws if touched and whose KV is absent — the gate must
  // reject BEFORE any storage access when there is no session/token.
  const env = {
    DB: new Proxy({}, { get: () => () => { throw new Error('DB must not be touched'); } }),
  } as unknown as Env;

  it('handleRepoSettingsPage 302-redirects signed-out visitors to /login', async () => {
    const res = await handleRepoSettingsPage(new Request('https://relay.portdaddy.dev/account/repos'), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('handleRepoSettingsApi 401s without a session or device token', async () => {
    const res = await handleRepoSettingsApi(new Request('https://relay.portdaddy.dev/v1/repo-settings'), env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });
});
