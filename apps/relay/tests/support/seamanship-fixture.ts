/**
 * Shared fixture for the Seamanship surfaces (src/seamanship.ts,
 * src/seamanship-page.ts).
 *
 * WHY A SHARED, STATEFUL FIXTURE rather than the per-file D1 mock this repo
 * usually reaches for: both suites need the same two things to be REAL, or the
 * claims they assert prove nothing.
 *
 *  1. A stateful `skill_listings` table that honours its WHERE clauses. The
 *     central safety property of the publish path is "the delete narrows the
 *     namespace before the insert widens it" — that is a property of a DELETE's
 *     WHERE clause, so a mock that pattern-matched on SQL and shrugged would let
 *     a withdrawal-doesn't-withdraw regression pass green.
 *  2. A GitHub stub that serves real SKILL.md TEXT, so the catalog is parsed by
 *     the production parser from bytes shaped like the files on disk —
 *     frontmatter and all. The tier a skill lands in has to come out of the real
 *     `parseVisibility`, not out of a hand-set field on a stub object, or the
 *     "unknown visibility fails closed" test tests nothing.
 *
 * Installation tokens are pre-seeded into the KV fake (`github_repo_inst_*` and
 * `github_inst_*`), which is exactly how `github-app.ts` short-circuits its App
 * JWT path — so no test needs a real RSA key to exercise a real code path.
 */

import { hashHex, fromHex, base64UrlEncode } from '../../src/crypto.js';
import type { Env } from '../../src/types.js';

export const BASE = 'https://relay.example';
export const WRAP_KEY = 'bb'.repeat(32);
export const COOKIE_VALUE = 'sess-seamanship';
export const LOGIN = 'erichowens';
export const INSTALLATION_ID = 4242;

/** One repo the GitHub stub will serve, and the SKILL.md files inside it. */
export interface FakeRepo {
  fullName: string;
  defaultBranch?: string;
  /** skill directory name -> the literal SKILL.md text served for it. */
  skills: Record<string, string>;
  /** When true the repo answers 404 for `contents/skills` (no skills dir). */
  noSkillsDir?: boolean;
}

export interface ListingSeed {
  namespace: string;
  skill_id: string;
  name: string;
  description: string;
  repo_full_name: string;
  source_path: string;
  updated_at?: number;
}

export interface CacheRowState {
  user_id: string;
  repo_full_name: string;
  source_path: string;
  skill_id: string;
  name: string;
  description: string;
  category: string;
  tags_json: string;
  owner: string | null;
  repos_json: string;
  visibility: string;
  pairs_with_json: string;
  fetched_at: number;
}

export interface Store {
  listings: Map<string, Required<ListingSeed>>;
  cache: Map<string, CacheRowState>;
  /** Every GitHub URL the code under test asked for, in order. */
  ghCalls: string[];
}

/** Build a SKILL.md from parts. ASCII only — `fetchRepoFile` decodes via atob. */
export function skillMd(frontmatter: string, body = 'Prose body for this skill.\n'): string {
  return `---\n${frontmatter}\n---\n${body}`;
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

function listingKey(ns: string, id: string): string {
  return `${ns} ${id}`;
}

function makeKV(seed: Record<string, string>): KVNamespace {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

/**
 * A D1 fake covering exactly the statements the Seamanship paths issue. Unknown
 * SQL throws rather than silently answering empty — a test that drifts off the
 * queries this models should fail loudly, not quietly pass.
 */
function makeDb(
  store: Store,
  sessionHash: string,
  sealed: { enc: string; iv: string },
  login: string,
): D1Database {
  const prepare = (sql: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        bound = v;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (sql.startsWith('SELECT user_id, gh_token_enc')) {
          return (bound[0] === sessionHash
            ? { user_id: 'u_1', gh_token_enc: sealed.enc, gh_token_iv: sealed.iv, expires_at: 2_000_000_000 }
            : null) as T | null;
        }
        if (sql.includes('FROM users WHERE id')) {
          return {
            id: 'u_1',
            github_user_id: 1,
            login,
            display_name: null,
            avatar_url: null,
            primary_email: null,
            email_verified: 0,
            created_at: 0,
            last_login_at: 0,
            deleted_at: null,
          } as T;
        }
        if (sql.includes('FROM skill_listings') && sql.includes('AND skill_id = ?')) {
          const row = store.listings.get(listingKey(String(bound[0]), String(bound[1])));
          return (row ?? null) as T | null;
        }
        throw new Error(`unmodelled D1 first(): ${sql}`);
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('FROM seamanship_skill_cache')) {
          const [userId, repo, horizon] = bound as [string, string, number];
          const results = [...store.cache.values()].filter(
            (r) => r.user_id === userId && r.repo_full_name === repo && r.fetched_at > horizon,
          );
          return { results: results as unknown as T[] };
        }
        if (sql.includes('FROM skill_listings')) {
          let rows = [...store.listings.values()];
          if (sql.includes('WHERE namespace = ?')) {
            rows = rows.filter((r) => r.namespace === String(bound[0]));
          }
          rows.sort((a, b) =>
            a.namespace === b.namespace
              ? a.skill_id.localeCompare(b.skill_id)
              : a.namespace.localeCompare(b.namespace),
          );
          return { results: rows as unknown as T[] };
        }
        throw new Error(`unmodelled D1 all(): ${sql}`);
      },
      async run() {
        if (sql.startsWith('DELETE FROM skill_listings')) {
          const ns = String(bound[0]);
          for (const [k, v] of [...store.listings]) if (v.namespace === ns) store.listings.delete(k);
          return { success: true };
        }
        if (sql.startsWith('INSERT INTO skill_listings')) {
          const [namespace, skill_id, name, description, repo_full_name, source_path, updated_at] =
            bound as [string, string, string, string, string, string, number];
          store.listings.set(listingKey(namespace, skill_id), {
            namespace,
            skill_id,
            name,
            description,
            repo_full_name,
            source_path,
            updated_at,
          });
          return { success: true };
        }
        if (sql.includes('INSERT INTO seamanship_skill_cache')) {
          const b = bound as [
            string, string, string, string, string, string, string,
            string, string | null, string, string, string, number,
          ];
          store.cache.set(`${b[0]} ${b[1]} ${b[2]}`, {
            user_id: b[0],
            repo_full_name: b[1],
            source_path: b[2],
            skill_id: b[3],
            name: b[4],
            description: b[5],
            category: b[6],
            tags_json: b[7],
            owner: b[8],
            repos_json: b[9],
            visibility: b[10],
            pairs_with_json: b[11],
            fetched_at: b[12],
          });
          return { success: true };
        }
        throw new Error(`unmodelled D1 run(): ${sql}`);
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return { prepare } as unknown as D1Database;
}

export interface Fixture {
  env: Env;
  store: Store;
}

export interface FixtureOptions {
  repos?: FakeRepo[];
  listings?: ListingSeed[];
  login?: string;
  /** Make GET /user/installations fail — the "degraded, not empty" path. */
  installationsUnavailable?: boolean;
  /** Leave the GitHub App creds unset. */
  appUnconfigured?: boolean;
}

/**
 * Build the Env plus a stubbed global `fetch` standing in for GitHub. The
 * caller is responsible for `vi.unstubAllGlobals()` (an `afterEach` does it in
 * both suites).
 */
export async function makeSeamanshipFixture(
  opts: FixtureOptions,
  stubGlobal: (name: string, value: unknown) => void,
): Promise<Fixture> {
  const login = opts.login ?? LOGIN;
  const repos = opts.repos ?? [];
  const sealed = await sealForTest('gho_user_token');
  const store: Store = { listings: new Map(), cache: new Map(), ghCalls: [] };
  for (const seed of opts.listings ?? []) {
    store.listings.set(listingKey(seed.namespace, seed.skill_id), {
      updated_at: 1_700_000_000,
      ...seed,
    });
  }

  const kvSeed: Record<string, string> = {};
  for (const repo of repos) {
    const [owner, name] = repo.fullName.split('/');
    kvSeed[`github_repo_inst_${owner}_${name}`] = String(INSTALLATION_ID);
  }
  kvSeed[`github_inst_${INSTALLATION_ID}`] = JSON.stringify({
    token: 'ghs_installation_token',
    expiresAt: Date.now() + 60 * 60 * 1000,
  });

  const byFullName = new Map(repos.map((r) => [r.fullName, r]));

  const fetchStub = async (input: RequestInfo | URL): Promise<Response> => {
    const raw = String(input);
    store.ghCalls.push(raw);
    const url = new URL(raw);
    const path = url.pathname;

    if (path === '/user/installations') {
      if (opts.installationsUnavailable) return new Response('nope', { status: 500 });
      return Response.json({
        installations: [{ id: INSTALLATION_ID, account: { login, type: 'User' } }],
      });
    }
    if (path === `/user/installations/${INSTALLATION_ID}/repositories`) {
      return Response.json({
        repositories: repos.map((r) => ({
          full_name: r.fullName,
          default_branch: r.defaultBranch ?? 'main',
        })),
      });
    }
    const contents = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(path);
    if (contents) {
      const full = `${contents[1]}/${contents[2]}`;
      const inner = decodeURIComponent(contents[3] ?? '');
      const repo = byFullName.get(full);
      if (!repo || repo.noSkillsDir) return new Response('nope', { status: 404 });
      if (inner === 'skills') {
        return Response.json(
          Object.keys(repo.skills).map((name) => ({ name, path: `skills/${name}`, type: 'dir' })),
        );
      }
      const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(inner);
      const dir = m ? m[1] : undefined;
      const text = dir === undefined ? undefined : repo.skills[dir];
      if (text === undefined) return new Response('nope', { status: 404 });
      return Response.json({ encoding: 'base64', content: btoa(text) });
    }
    const repoMeta = /^\/repos\/([^/]+)\/([^/]+)$/.exec(path);
    if (repoMeta) {
      const repo = byFullName.get(`${repoMeta[1]}/${repoMeta[2]}`);
      if (!repo) return new Response('nope', { status: 404 });
      return Response.json({ default_branch: repo.defaultBranch ?? 'main' });
    }
    return new Response('unmodelled GitHub route', { status: 404 });
  };
  stubGlobal('fetch', fetchStub);

  const appCreds = opts.appUnconfigured
    ? {}
    : {
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: ['-----BEGIN PRIVATE KEY-----', 'unused', '-----END PRIVATE KEY-----'].join('\n'),
      };

  const env = {
    DB: makeDb(store, hashHex(COOKIE_VALUE), sealed, login),
    KV: makeKV(kvSeed),
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
    PUBLIC_BASE_URL: BASE,
    ...appCreds,
  } as unknown as Env;

  return { env, store };
}

/** A request carrying the fixture's session cookie (or none). */
export function req(
  path: string,
  opts: { cookie?: string | null; method?: string } = {},
): Request {
  const cookie = opts.cookie === undefined ? `__Host-pd_session=${COOKIE_VALUE}` : opts.cookie;
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (opts.method === 'POST') headers.Origin = BASE;
  return new Request(`${BASE}${path}`, { method: opts.method ?? 'GET', headers });
}
