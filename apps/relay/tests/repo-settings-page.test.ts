/**
 * Tests for the per-repo settings screen (src/repo-settings-page.ts).
 * Coverage:
 *   - normalizeRepoFullName: accepts owner/name (and a pasted GitHub URL),
 *     rejects enumeration-shaped garbage, enforces the length ceilings;
 *   - normalizeSitrepLevel: closed enum, garbage → null;
 *   - renderRepoSettingsPage: script-free; renders REAL rows with the saved
 *     dial checked; empty state teaches (no fabricated rows — repo law);
 *     honest about the local enforcement point (agent.config.json snippet +
 *     the /v1/repo-settings device read path); snippet JSON parses per level;
 *   - handleRepoSettingsPage: no session → 302 /login (the logged-in-only gate);
 *   - handleRepoSettingsApi: no auth → 401 (device read path is gated too);
 *   - full round-trips through a stateful fake D1 (the runs-page.test.ts
 *     idiom: sealed gh token so resolveSession yields a usable session, and a
 *     stubbed global fetch standing in for GitHub's GET /repos/:owner/:repo):
 *     set upserts + re-set updates, unreadable repo rejected, remove deletes
 *     only the caller's row, and the API converges via cookie AND pdu_ bearer.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeRepoFullName,
  normalizeSitrepLevel,
  renderRepoSettingsPage,
  handleRepoSettingsPage,
  handleRepoSettingsSet,
  handleRepoSettingsRemove,
  handleRepoSettingsApi,
  type RepoSettingRow,
  type SitrepLevel,
} from '../src/repo-settings-page.js';
import { hashHex, fromHex, base64UrlEncode } from '../src/crypto.js';
import type { UserRow } from '../src/db.js';
import type { Env } from '../src/types.js';

const WRAP_KEY = 'bb'.repeat(32);
const BASE = 'https://relay.example';
const COOKIE_VALUE = 'sess-value-abc';
const PDU_TOKEN = `pdu_${'ab'.repeat(32)}`;

const baseUser: UserRow = {
  id: 'u_abc',
  github_user_id: 123456,
  login: 'octocat',
  display_name: 'Octo Cat',
  avatar_url: null,
  primary_email: 'octo@example.com',
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
    expect(normalizeRepoFullName('owner/.name')).toBeNull();
    expect(normalizeRepoFullName('.owner/name')).toBeNull();
    expect(normalizeRepoFullName('owner/name with spaces')).toBeNull();
    expect(normalizeRepoFullName('-lead/repo')).toBeNull();
    expect(normalizeRepoFullName(42)).toBeNull();
    expect(normalizeRepoFullName('owner/<script>')).toBeNull();
  });

  // Adopted from the pd-purser adversarial table on this PR, with its
  // self-contradictions corrected: 'owner/name.git' appeared in both the valid
  // and invalid lists (it IS valid — the .git suffix is stripped by contract),
  // and 'owner.name/name' was listed valid although GitHub owner names cannot
  // contain dots (only alphanumerics and hyphens) — pinned as a rejection.
  it('adopts the purser normalization table (corrected)', () => {
    const valid: Array<[string, string]> = [
      ['owner/name.git', 'owner/name'],
      ['https://github.com/owner/name', 'owner/name'],
      // RFC 3986: scheme and host are case-insensitive; the pasted-URL prefix
      // honors that, so an uppercase-scheme paste normalizes the same way.
      ['HTTPS://github.com/owner/name', 'owner/name'],
      ['owner-name/name', 'owner-name/name'],
      ['owner/Name123', 'owner/Name123'],
      ['owner/123name', 'owner/123name'],
      ['owner/name_with.dots', 'owner/name_with.dots'],
      ['owner/name-with-dash', 'owner/name-with-dash'],
      ['OWNER/NAME', 'OWNER/NAME'],
    ];
    for (const [input, expected] of valid) {
      expect(normalizeRepoFullName(input)).toBe(expected);
    }
    const invalid = [
      'owner/name/', // trailing slash
      '/owner/name', // leading slash
      'owner//name', // double slash
      'owner/', // missing repo name
      '/name', // missing owner
      'owner/name?foo=bar', // query string
      'https://github.com/owner/name/', // trailing slash after URL
      'https://github.com/owner/name/sub', // too many segments
      'https://github.com/owner', // missing repo
      'https://github.com/', // missing owner/repo
      'https://github.com', // bare host (prefix strip needs the slash)
      'https://github.com/owner/name.git/', // slash after .git
      'https://github.com/owner/name.git?foo=bar', // query after .git
      'owner.name/name', // GitHub owners cannot contain dots
      '', // empty
      '   ', // whitespace only
      null,
      undefined,
    ];
    for (const input of invalid) {
      expect(normalizeRepoFullName(input)).toBeNull();
    }
  });

  // Adopted from the pd-purser round-2 table (the genuinely new cases; casing,
  // trim, non-strings, and padded levels were already pinned in round 1).
  it('adopts the purser round-2 boundary, URL-form, and owner-charset table', () => {
    // 100 chars is the ceiling for BOTH segments — accepted exactly at the
    // boundary (the 101 rejections are pinned in the length-ceiling test).
    expect(normalizeRepoFullName(`${'o'.repeat(100)}/name`)).toBe(`${'o'.repeat(100)}/name`);
    // Pasted GitHub URLs normalize in any scheme/host casing, http included —
    // scheme and host are case-insensitive per RFC 3986 and GitHub redirects
    // http to one canonical https repo.
    expect(normalizeRepoFullName('http://github.com/owner/name')).toBe('owner/name');
    expect(normalizeRepoFullName('https://GITHUB.COM/owner/name.git')).toBe('owner/name');
    expect(normalizeRepoFullName('HTTP://GitHub.Com/owner/name')).toBe('owner/name');
    // URL fragments are not part of a repository's identity.
    expect(normalizeRepoFullName('https://github.com/owner/name#section')).toBeNull();
    expect(normalizeRepoFullName('owner/name#readme')).toBeNull();
    // GitHub user/org names allow only alphanumerics and hyphens — underscore
    // and dot are name-segment privileges, never owner-segment ones
    // (owner.name/… rejection is pinned in the round-1 table above).
    expect(normalizeRepoFullName('owner_name/repo')).toBeNull();
  });

  it('accepts underscores/dots in names and enforces the length ceilings', () => {
    expect(normalizeRepoFullName('owner/name-with-underscore_123')).toBe(
      'owner/name-with-underscore_123',
    );
    expect(normalizeRepoFullName('owner/dotted.name')).toBe('owner/dotted.name');
    expect(normalizeRepoFullName(`owner/${'x'.repeat(100)}`)).toBe(`owner/${'x'.repeat(100)}`);
    expect(normalizeRepoFullName(`owner/${'x'.repeat(101)}`)).toBeNull();
    expect(normalizeRepoFullName(`${'o'.repeat(101)}/name`)).toBeNull();
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

  // Adopted from the pd-purser adversarial table, corrected: its invalid list
  // literally contained the three valid values, and whitespace-padded variants
  // ('enforce\n', 'off ') — trimming is the advertised contract, so those
  // normalize rather than reject. The coherent rejections are pinned here.
  it('adopts the purser sitrep-level table (corrected)', () => {
    expect(normalizeSitrepLevel(' oFf ')).toBe('off');
    expect(normalizeSitrepLevel('enforce\n')).toBe('enforce');
    expect(normalizeSitrepLevel('off ')).toBe('off');
    expect(normalizeSitrepLevel('suggest\r')).toBe('suggest');
    for (const bad of ['on', 'enforced', 'suggested', '1', 'o', 'foo', 'foo bar', '', '   ', 123, null]) {
      expect(normalizeSitrepLevel(bad)).toBeNull();
    }
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

  it('defaults the add-repository form to enforce (operator doctrine, 2026-08-22)', () => {
    // The add form's hidden dial pins the operator's chosen default: new repos
    // arrive with the SITREP contract enforced, matching the compulsion dial.
    expect(html).toContain('<input type="hidden" name="sitrep" value="enforce">');
    expect(html).toContain('Add with Sitrep enforced');
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
    const scripted = renderRepoSettingsPage(
      { ...baseUser, login: '<script>alert(1)</script>' },
      [
        {
          repo_full_name: 'curiositech/port-daddy',
          sitrep_end_of_turn: 'off',
          settings_json: '{}',
          updated_at: 1_787_220_000,
        },
      ],
    );
    expect(scripted).not.toContain('<script>alert(1)</script>');
    expect(scripted).toContain('&lt;script&gt;');
  });

  it('renders a local snippet whose JSON body is valid for every dial level', () => {
    for (const level of ['off', 'suggest', 'enforce'] as const) {
      const levelHtml = renderRepoSettingsPage(baseUser, [
        {
          repo_full_name: 'curiositech/port-daddy',
          sitrep_end_of_turn: level,
          settings_json: '{}',
          updated_at: 1_787_220_000,
        },
      ]);
      // Recover the snippet from the rendered card, drop the comment line,
      // un-escape, and prove the body parses to the dial we rendered.
      const m = /<code>([\s\S]*?)<\/code>/.exec(levelHtml);
      expect(m).not.toBeNull();
      const unescaped = m![1]!
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      const jsonBody = unescaped.split('\n').slice(1).join('\n');
      expect(JSON.parse(jsonBody)).toEqual({ sitrep: { endOfTurn: level } });
    }
  });
});

describe('session gates (no auth, storage never touched)', () => {
  // An Env whose DB throws if touched via any statement — the gate must reject
  // BEFORE any storage access when there is no session cookie at all.
  const env = {
    DB: {
      prepare() {
        throw new Error('DB must not be touched without a credential');
      },
    },
  } as unknown as Env;

  it('handleRepoSettingsPage 302-redirects signed-out visitors to /login', async () => {
    const res = await handleRepoSettingsPage(new Request(`${BASE}/account/repos`), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('handleRepoSettingsSet and Remove 302-redirect signed-out form POSTs', async () => {
    for (const handler of [handleRepoSettingsSet, handleRepoSettingsRemove]) {
      const res = await handler(new Request(`${BASE}/account/repos/set`, { method: 'POST' }), env);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/login');
    }
  });

  it('handleRepoSettingsApi 401s without a session or device token', async () => {
    const res = await handleRepoSettingsApi(new Request(`${BASE}/v1/repo-settings`), env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });
});

// ── round-trips through a stateful fake D1 (runs-page.test.ts idiom) ─────────

/** Seal a token the way auth-github.sealToken does, so resolveSession decrypts it. */
async function sealForTest(token: string): Promise<{ enc: string; iv: string }> {
  const key = await crypto.subtle.importKey('raw', fromHex(WRAP_KEY), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
  );
  return { enc: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

interface StoredSetting {
  user_id: string;
  repo_full_name: string;
  sitrep_end_of_turn: SitrepLevel;
  settings_json: string;
  created_at: number;
  updated_at: number;
}

/**
 * Stateful fake D1 covering every statement this module (plus session and
 * pdu_-token resolution) issues, dispatched on SQL substrings — the same idiom
 * as interruptions.test.ts / runs-page.test.ts.
 */
function makeDb(sessionHash: string, sealed: { enc: string; iv: string }) {
  const settings = new Map<string, StoredSetting>();
  let seq = 0; // monotonic updated_at tiebreaker so ORDER BY is deterministic

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const s = {
        bind(...v: unknown[]) {
          args = v;
          return s;
        },
        async first() {
          if (sql.startsWith('SELECT user_id, gh_token_enc')) {
            return args[0] === sessionHash
              ? { user_id: baseUser.id, gh_token_enc: sealed.enc, gh_token_iv: sealed.iv, expires_at: 2_000_000_000 }
              : null;
          }
          if (sql.includes('FROM user_tokens')) {
            return args[0] === hashHex(PDU_TOKEN)
              ? { user_id: baseUser.id, expires_at: null, revoked_at: null }
              : null;
          }
          if (sql.includes('FROM users WHERE id')) {
            return args[0] === baseUser.id ? baseUser : null;
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM repo_settings')) {
            const userId = args[0] as string;
            const results = [...settings.values()]
              .filter((r) => r.user_id === userId)
              .sort((a, b) => b.updated_at - a.updated_at)
              .map(({ repo_full_name, sitrep_end_of_turn, settings_json, updated_at }) => ({
                repo_full_name,
                sitrep_end_of_turn,
                settings_json,
                updated_at,
              }));
            return { results };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO repo_settings')) {
            const [userId, repo, level, createdAt, updatedAt] = args as [string, string, SitrepLevel, number, number];
            const key = `${userId} ${repo}`;
            const existing = settings.get(key);
            seq += 1;
            if (existing) {
              // ON CONFLICT: only the dial and updated_at move; created_at stays.
              existing.sitrep_end_of_turn = level;
              existing.updated_at = updatedAt + seq;
            } else {
              settings.set(key, {
                user_id: userId,
                repo_full_name: repo,
                sitrep_end_of_turn: level,
                settings_json: '{}',
                created_at: createdAt,
                updated_at: updatedAt + seq,
              });
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('DELETE FROM repo_settings')) {
            const [userId, repo] = args as [string, string];
            settings.delete(`${userId} ${repo}`);
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } }; // last_used_at bumps etc.
        },
      };
      return s;
    },
  };
  return { db: db as unknown as D1Database, settings };
}

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

async function makeSessionEnv() {
  const sealed = await sealForTest('gho_token');
  const { db, settings } = makeDb(hashHex(COOKIE_VALUE), sealed);
  const env = {
    DB: db,
    KV: makeKv(),
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
    PUBLIC_BASE_URL: BASE,
  } as unknown as Env;
  return { env, settings };
}

const COOKIE = { Cookie: `__Host-pd_session=${COOKIE_VALUE}` };

function setReq(repo: string, sitrep: string): Request {
  const body = new URLSearchParams({ repo, sitrep });
  return new Request(`${BASE}/account/repos/set`, {
    method: 'POST',
    headers: { ...COOKIE, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

function removeReq(repo: string): Request {
  const body = new URLSearchParams({ repo });
  return new Request(`${BASE}/account/repos/remove`, {
    method: 'POST',
    headers: { ...COOKIE, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

/** Stub GitHub's GET /repos/:owner/:repo — readable repos answer 200, rest 404. */
function stubRepoAccess(readable: string[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const repo = /\/repos\/(.+)$/.exec(String(input))?.[1] ?? '';
    return new Response('', { status: readable.includes(repo) ? 200 : 404 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /account/repos/set — upsert round-trip', () => {
  it('stores a readable repo and 303s back with an ok notice', async () => {
    const { env, settings } = await makeSessionEnv();
    stubRepoAccess(['acme/widgets']);
    const res = await handleRepoSettingsSet(setReq('acme/widgets', 'suggest'), env);
    expect(res.status).toBe(303);
    const loc = res.headers.get('Location')!;
    expect(loc.startsWith('/account/repos?')).toBe(true);
    expect(new URL(`${BASE}${loc}`).searchParams.get('err')).toBeNull();
    const stored = [...settings.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      user_id: baseUser.id,
      repo_full_name: 'acme/widgets',
      sitrep_end_of_turn: 'suggest',
    });
  });

  it('re-setting the same repo updates the dial in place (one row, not two)', async () => {
    const { env, settings } = await makeSessionEnv();
    stubRepoAccess(['acme/widgets']);
    await handleRepoSettingsSet(setReq('acme/widgets', 'suggest'), env);
    const created = [...settings.values()][0]!.created_at;
    await handleRepoSettingsSet(setReq('acme/widgets', 'enforce'), env);
    const stored = [...settings.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.sitrep_end_of_turn).toBe('enforce');
    expect(stored[0]!.created_at).toBe(created);
  });

  it('rejects a repo GitHub says the user cannot read, storing nothing', async () => {
    const { env, settings } = await makeSessionEnv();
    stubRepoAccess([]); // GitHub 404s everything
    const res = await handleRepoSettingsSet(setReq('evil/secrets', 'enforce'), env);
    expect(res.status).toBe(303);
    expect(new URL(`${BASE}${res.headers.get('Location')}`).searchParams.get('err')).toBe('1');
    expect(settings.size).toBe(0);
  });

  it('rejects a malformed repo or dial before ever probing GitHub', async () => {
    const { env, settings } = await makeSessionEnv();
    const fetchMock = stubRepoAccess(['acme/widgets']);
    for (const [repo, sitrep] of [
      ['not-a-repo', 'suggest'],
      ['acme/widgets', 'loudly'],
    ] as const) {
      const res = await handleRepoSettingsSet(setReq(repo, sitrep), env);
      expect(res.status).toBe(303);
      expect(new URL(`${BASE}${res.headers.get('Location')}`).searchParams.get('err')).toBe('1');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(settings.size).toBe(0);
  });
});

describe('POST /account/repos/remove — delete round-trip', () => {
  it('removes only the caller-owned row for that repo', async () => {
    const { env, settings } = await makeSessionEnv();
    stubRepoAccess(['acme/widgets', 'acme/gears']);
    await handleRepoSettingsSet(setReq('acme/widgets', 'off'), env);
    await handleRepoSettingsSet(setReq('acme/gears', 'enforce'), env);
    const res = await handleRepoSettingsRemove(removeReq('acme/widgets'), env);
    expect(res.status).toBe(303);
    const left = [...settings.values()].map((r) => r.repo_full_name);
    expect(left).toEqual(['acme/gears']);
  });
});

describe('GET /account/repos + GET /v1/repo-settings — the two surfaces agree', () => {
  it('renders stored rows on the page after a set', async () => {
    const { env } = await makeSessionEnv();
    stubRepoAccess(['acme/widgets']);
    await handleRepoSettingsSet(setReq('acme/widgets', 'enforce'), env);
    const res = await handleRepoSettingsPage(new Request(`${BASE}/account/repos`, { headers: COOKIE }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const html = await res.text();
    expect(html).toContain('acme/widgets');
    expect(html).toMatch(/value="enforce"\s+checked/);
  });

  it('serves the same record as JSON via the session cookie, honoring ?repo=', async () => {
    const { env } = await makeSessionEnv();
    stubRepoAccess(['acme/widgets', 'acme/gears']);
    await handleRepoSettingsSet(setReq('acme/widgets', 'suggest'), env);
    await handleRepoSettingsSet(setReq('acme/gears', 'enforce'), env);
    const all = await handleRepoSettingsApi(new Request(`${BASE}/v1/repo-settings`, { headers: COOKIE }), env);
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { code: string; settings: Array<{ repo: string; sitrep: { endOfTurn: string } }> };
    expect(allBody.code).toBe('OK');
    expect(allBody.settings.map((s) => s.repo).sort()).toEqual(['acme/gears', 'acme/widgets']);
    const one = await handleRepoSettingsApi(
      new Request(`${BASE}/v1/repo-settings?repo=acme/gears`, { headers: COOKIE }),
      env,
    );
    const oneBody = (await one.json()) as { settings: Array<{ repo: string; sitrep: { endOfTurn: string } }> };
    expect(oneBody.settings).toEqual([
      expect.objectContaining({ repo: 'acme/gears', sitrep: { endOfTurn: 'enforce' } }),
    ]);
  });

  it('serves the record to a paired device via a pdu_ bearer token', async () => {
    const { env } = await makeSessionEnv();
    stubRepoAccess(['acme/widgets']);
    await handleRepoSettingsSet(setReq('acme/widgets', 'suggest'), env);
    const res = await handleRepoSettingsApi(
      new Request(`${BASE}/v1/repo-settings`, { headers: { Authorization: `Bearer ${PDU_TOKEN}` } }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Array<{ repo: string; sitrep: { endOfTurn: string } }> };
    expect(body.settings).toEqual([
      expect.objectContaining({ repo: 'acme/widgets', sitrep: { endOfTurn: 'suggest' } }),
    ]);
  });

  it('400s a malformed ?repo= filter instead of guessing', async () => {
    const { env } = await makeSessionEnv();
    const res = await handleRepoSettingsApi(
      new Request(`${BASE}/v1/repo-settings?repo=${encodeURIComponent('a/b/c')}`, { headers: COOKIE }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('BAD_REPO');
  });
});
