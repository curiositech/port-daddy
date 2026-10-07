import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSession } from '../src/auth-github.js';
import { handlePublisherGrantsPage } from '../src/publisher-grants-page.js';
import type { Env } from '../src/types.js';

vi.mock('../src/auth-github.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/auth-github.js')>(), resolveSession: vi.fn(),
}));

const BASE = 'https://relay.example';
const REPO = 'owner/repo';
const FP = 'ab'.repeat(32);
const OTHER_FP = 'cd'.repeat(32);
const NOW = 1_800_000_000;

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE identities (
      daemon_fingerprint TEXT PRIMARY KEY, pub_key TEXT NOT NULL,
      proof_method TEXT NOT NULL, proof_metadata TEXT NOT NULL,
      expires_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0,
      revoked_reason TEXT, created_at INTEGER NOT NULL
    );`);
  sqlite.exec(readFileSync(new URL('../migrations/2026-09-14-publisher-grants-v2.sql', import.meta.url), 'utf8')
    .split('-- The first valid use')[0]!);
  const db = {
    prepare(sql: string) {
      return { bind(...args: unknown[]) {
        return {
          async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...args as never[]) as T[] }; },
          async first<T>() { return (sqlite.prepare(sql).get(...args as never[]) ?? null) as T | null; },
          async run() { const result = sqlite.prepare(sql).run(...args as never[]); return { success: true, meta: { changes: Number(result.changes) } }; },
        };
      } };
    },
  };
  return { sqlite, db };
}

function post(path: 'create' | 'revoke', values: Array<[string, string]>, origin = BASE): Request {
  return new Request(`${BASE}/account/publisher-grants/${path}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
}

function createValues(fingerprint = FP): Array<[string, string]> {
  return [
    ['repo', REPO], ['subject_fingerprint', fingerprint],
    ['operation', 'pull-request.publish'], ['operation', 'pull-request.comment'],
    ['branch_allow', 'codex/, fleet/'], ['base_allow', 'main'],
    ['mutations_per_day', '20'], ['expires_days', '7'],
  ];
}

let sqlite: DatabaseSync;
let env: Env;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
  const store = database();
  sqlite = store.sqlite;
  sqlite.prepare('INSERT INTO users VALUES (?)').run('user-1');
  sqlite.prepare('INSERT INTO users VALUES (?)').run('user-2');
  const insertIdentity = sqlite.prepare('INSERT INTO identities VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertIdentity.run(FP, 'key', 'oidc', JSON.stringify({ repository: REPO }), NOW + 3600, 0, null, NOW - 60);
  insertIdentity.run(OTHER_FP, 'key', 'oidc', JSON.stringify({ repository: 'owner/other' }), NOW + 3600, 0, null, NOW - 60);
  env = { DB: store.db, PUBLIC_BASE_URL: BASE } as unknown as Env;
  vi.mocked(resolveSession).mockResolvedValue({ user: { id: 'user-1' }, ghToken: 'user-token', cacheNamespace: 'test' } as never);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/repos/owner/repo')) return Response.json({ full_name: REPO, permissions: { admin: true } });
    if (url.includes('/user/installations?')) return Response.json({ installations: [{ id: 42 }] });
    if (url.includes('/user/installations/42/repositories')) return Response.json({ repositories: [{ full_name: REPO }] });
    return new Response('', { status: 404 });
  }));
});

afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('publisher grant operator surface', () => {
  it('lists only live OIDC identities proved for the exact repository', async () => {
    sqlite.prepare('INSERT INTO identities VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('ef'.repeat(32), 'key', 'oidc', JSON.stringify({ repository: REPO }), NOW - 1, 0, null, NOW - 60);
    const response = await handlePublisherGrantsPage(new Request(`${BASE}/account/publisher-grants?repo=${REPO}`), env);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain(`${FP.slice(0, 16)}…`);
    expect(body).not.toContain(OTHER_FP.slice(0, 16));
    expect(body).not.toContain('efefefefefefefef');
    expect(body).toContain('App installation 42');
    expect(body).toContain('name="branch_allow" required value="pd-agent/"');
  });

  it('creates an exact, bounded grant and confirms it by readback', async () => {
    const response = await handlePublisherGrantsPage(post('create', createValues()), env);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('saved=1');
    const row = sqlite.prepare('SELECT * FROM publisher_grants').get() as Record<string, unknown>;
    expect(row.account_user_id).toBe('user-1');
    expect(row.subject_fingerprint).toBe(FP);
    expect(row.subject_class).toBe('ci');
    expect(row.installation_id).toBe(42);
    expect(JSON.parse(String(row.repositories_json))).toEqual([REPO]);
    expect(JSON.parse(String(row.operations_json))).toEqual(['pull-request.publish', 'pull-request.comment']);
    expect(JSON.parse(String(row.branch_allow_json))).toEqual(['codex/', 'fleet/']);
    expect(row.expires_at).toBe(NOW + 7 * 86_400);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('immediately revokes only its account and repository grant with readback', async () => {
    await handlePublisherGrantsPage(post('create', createValues()), env);
    const grantId = String((sqlite.prepare('SELECT grant_id FROM publisher_grants').get() as { grant_id: string }).grant_id);
    const response = await handlePublisherGrantsPage(post('revoke', [['repo', REPO], ['grant_id', grantId]]), env);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('revoked=1');
    expect(sqlite.prepare('SELECT revoked_at, revoked_reason FROM publisher_grants').get())
      .toEqual({ revoked_at: NOW, revoked_reason: 'operator-ui' });
  });

  it('rejects cross-account revocation without mutating the grant', async () => {
    await handlePublisherGrantsPage(post('create', createValues()), env);
    const grantId = String((sqlite.prepare('SELECT grant_id FROM publisher_grants').get() as { grant_id: string }).grant_id);
    vi.mocked(resolveSession).mockResolvedValue({ user: { id: 'user-2' }, ghToken: 'token-2', cacheNamespace: 'other' } as never);
    expect((await handlePublisherGrantsPage(post('revoke', [['repo', REPO], ['grant_id', grantId]]), env)).status).toBe(403);
    expect((sqlite.prepare('SELECT revoked_at FROM publisher_grants').get() as { revoked_at: null }).revoked_at).toBeNull();
  });

  it('requires same-origin browser evidence before GitHub or storage access', async () => {
    const missing = new Request(`${BASE}/account/publisher-grants/create`, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(createValues()) });
    expect((await handlePublisherGrantsPage(missing, env)).status).toBe(403);
    expect((await handlePublisherGrantsPage(post('create', createValues(), 'https://evil.example'), env)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM publisher_grants').get()).toEqual({ n: 0 });
  });

  it('fails closed for repo mismatch, malformed scope, and unavailable storage', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ full_name: 'owner/other', permissions: { admin: true } }));
    expect((await handlePublisherGrantsPage(post('create', createValues()), env)).status).toBe(403);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM publisher_grants').get()).toEqual({ n: 0 });

    const malformed = createValues().map(([key, value]) => key === 'branch_allow' ? [key, 'codex/*'] as [string, string] : [key, value] as [string, string]);
    expect((await handlePublisherGrantsPage(post('create', malformed), env)).status).toBe(400);
    sqlite.exec('DROP TABLE publisher_grants');
    expect((await handlePublisherGrantsPage(post('create', createValues()), env)).status).toBe(503);
  });

  it('requires both fresh repo-admin and user-owned App installation scope', async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/repos/owner/repo')) return Response.json({ full_name: REPO, permissions: { admin: false } });
      return Response.json({ installations: [] });
    });
    expect((await handlePublisherGrantsPage(post('create', createValues()), env)).status).toBe(403);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM publisher_grants').get()).toEqual({ n: 0 });

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/repos/owner/repo')) return Response.json({ full_name: REPO, permissions: { admin: true } });
      if (url.includes('/user/installations?')) return Response.json({ installations: [{ id: 42 }] });
      return Response.json({ repositories: [{ full_name: 'owner/other' }] });
    });
    expect((await handlePublisherGrantsPage(post('create', createValues()), env)).status).toBe(403);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM publisher_grants').get()).toEqual({ n: 0 });
  });

  it('fails closed instead of hiding malformed stored grant authority', async () => {
    // Simulate legacy/corrupted D1 state despite the current write trigger.
    sqlite.exec('DROP TRIGGER publisher_grants_insert_scope');
    sqlite.prepare(`INSERT INTO publisher_grants
      (grant_id, epoch, surface, account_user_id, subject_fingerprint, subject_class,
       installation_id, repositories_json, operations_json, branch_allow_json,
       base_allow_json, mutations_per_day, expires_at, created_at, created_via)
      VALUES (?, 1, 'publisher', 'user-1', ?, 'ci', 42, ?, '[7]', '["codex/"]', '["main"]', 2, ?, ?, 'account-ui')`)
      .run(`pdg_${'12'.repeat(16)}`, FP, JSON.stringify([REPO]), NOW + 1000, NOW);
    const response = await handlePublisherGrantsPage(new Request(`${BASE}/account/publisher-grants?repo=${REPO}`), env);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('storage is unavailable');
  });

  it('requires a session and never offers a bearer route', async () => {
    vi.mocked(resolveSession).mockResolvedValue(null);
    const response = await handlePublisherGrantsPage(new Request(`${BASE}/account/publisher-grants?repo=${REPO}`), env);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/login');
    expect(fetch).not.toHaveBeenCalled();
  });
});
