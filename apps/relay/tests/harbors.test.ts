/**
 * X2 REMOTE HARBORS v1 tests (src/harbors.ts; grand-plan §X2 MVP slice).
 *
 * Covers, per the acceptance list:
 *   - the AUTHZ MATRIX: unauthenticated / non-member / member / owner across
 *     all four routes (create, mine, detail, add-member);
 *   - DUP NAMES: (namespace, name) unique — 409 in the same namespace, allowed
 *     across namespaces (namespace is server-derived from the creator's login,
 *     never client input);
 *   - MEMBER GATING: non-members get the same 404 as a nonexistent harbor (no
 *     existence oracle), members read, only owners add; membership rows must
 *     reference real principals (relay users / registered unrevoked daemons).
 *
 * Idiom: stateful fake D1 keyed on SQL substrings (like handshake.test.ts /
 * mercy.test.ts), authenticating via pdu_ bearer tokens through the REAL
 * resolveUserFromRequest path (user_tokens + users lookups hit the fake D1).
 * Routing is pinned through worker.fetch for each route at least once.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import {
  handleCreateHarbor,
  handleListMyHarbors,
  handleGetHarbor,
  handleAddHarborMember,
} from '../src/harbors.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';

// ── Principals ────────────────────────────────────────────────────────────────

const ALICE_TOKEN = `pdu_${'a'.repeat(64)}`; // creator/owner
const BOB_TOKEN = `pdu_${'b'.repeat(64)}`;   // plain member
const CAROL_TOKEN = `pdu_${'c'.repeat(64)}`; // non-member

const DAEMON_FP = 'ab'.repeat(32);         // registered, unrevoked
const REVOKED_DAEMON_FP = 'cd'.repeat(32); // registered but revoked

interface FakeUser {
  id: string;
  github_user_id: number;
  login: string;
  display_name: string | null;
  avatar_url: string | null;
  primary_email: string | null;
  email_verified: number;
  created_at: number;
  last_login_at: number | null;
  deleted_at: number | null;
}

const mkUser = (id: string, ghId: number, login: string): FakeUser => ({
  id,
  github_user_id: ghId,
  login,
  display_name: null,
  avatar_url: null,
  primary_email: null,
  email_verified: 1,
  created_at: 1000,
  last_login_at: null,
  deleted_at: null,
});

interface FakeHarbor {
  id: string;
  namespace: string;
  name: string;
  pubkey: string;
  created_by: string;
  created_at: number;
}

interface FakeMembership {
  harbor_id: string;
  member_kind: 'user' | 'daemon';
  member_id: string;
  role: 'owner' | 'member';
  added_at: number;
  added_by: string;
}

// ── Stateful fake D1 ──────────────────────────────────────────────────────────

function makeDb() {
  const users: FakeUser[] = [
    mkUser('u_alice', 1, 'alice'),
    mkUser('u_bob', 2, 'Bob'), // mixed-case login: add-member lookup is case-insensitive
    mkUser('u_carol', 3, 'carol'),
  ];
  const tokens = new Map<string, { user_id: string; expires_at: number | null; revoked_at: number | null }>([
    [hashHex(ALICE_TOKEN), { user_id: 'u_alice', expires_at: null, revoked_at: null }],
    [hashHex(BOB_TOKEN), { user_id: 'u_bob', expires_at: null, revoked_at: null }],
    [hashHex(CAROL_TOKEN), { user_id: 'u_carol', expires_at: null, revoked_at: null }],
  ]);
  const identities = [
    { daemon_fingerprint: DAEMON_FP, pub_key: 'ff'.repeat(32), proof_method: 'oidc', proof_metadata: '{}', expires_at: null, revoked: 0, revoked_reason: null },
    { daemon_fingerprint: REVOKED_DAEMON_FP, pub_key: 'ee'.repeat(32), proof_method: 'oidc', proof_metadata: '{}', expires_at: null, revoked: 1, revoked_reason: 'compromised' },
  ];
  const harbors: FakeHarbor[] = [];
  const memberships: FakeMembership[] = [];
  const ok = { success: true, meta: { changes: 1 } };

  function prepare(sql: string) {
    let args: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        args = v;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        // resolveUserToken path
        if (sql.includes('FROM user_tokens')) {
          return (tokens.get(args[0] as string) ?? null) as T | null;
        }
        if (sql.includes('FROM users WHERE id = ?')) {
          return (users.find((u) => u.id === args[0] && u.deleted_at === null) ?? null) as T | null;
        }
        // getUserByLogin (case-insensitive)
        if (sql.includes('FROM users WHERE login')) {
          const q = (args[0] as string).toLowerCase();
          return (users.find((u) => u.login.toLowerCase() === q && u.deleted_at === null) ?? null) as T | null;
        }
        if (sql.includes('FROM harbors WHERE namespace = ? AND name = ?')) {
          return (harbors.find((h) => h.namespace === args[0] && h.name === args[1]) ?? null) as T | null;
        }
        if (sql.includes('SELECT role FROM harbor_memberships')) {
          const m = memberships.find(
            (x) => x.harbor_id === args[0] && x.member_kind === args[1] && x.member_id === args[2],
          );
          return (m ? { role: m.role } : null) as T | null;
        }
        if (sql.includes('FROM identities')) {
          return (identities.find((i) => i.daemon_fingerprint === args[0]) ?? null) as T | null;
        }
        if (sql.includes('COUNT(*) AS n FROM harbors')) {
          return { n: harbors.length } as T;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        // listHarborsForUser
        if (sql.includes('JOIN harbor_memberships')) {
          const mine = memberships.filter((m) => m.member_kind === 'user' && m.member_id === args[0]);
          const rows = mine
            .map((m) => {
              const h = harbors.find((x) => x.id === m.harbor_id);
              return h ? { ...h, role: m.role } : null;
            })
            .filter((x): x is FakeHarbor & { role: 'owner' | 'member' } => x !== null)
            .sort((a, b) => b.created_at - a.created_at);
          return { results: rows as T[] };
        }
        // listHarborMembers (LEFT JOIN users for logins)
        if (sql.includes('FROM harbor_memberships m')) {
          const rows = memberships
            .filter((m) => m.harbor_id === args[0])
            .sort((a, b) => a.added_at - b.added_at)
            .map((m) => ({
              member_kind: m.member_kind,
              member_id: m.member_id,
              role: m.role,
              added_at: m.added_at,
              login: m.member_kind === 'user' ? (users.find((u) => u.id === m.member_id)?.login ?? null) : null,
            }));
          return { results: rows as T[] };
        }
        return { results: [] };
      },
      async run() {
        if (sql.includes('UPDATE user_tokens SET last_used_at')) return ok;
        if (sql.includes('INSERT INTO harbors')) {
          const [id, namespace, name, pubkey, created_by, created_at] = args as [string, string, string, string, string, number];
          if (harbors.some((h) => h.namespace === namespace && h.name === name)) {
            throw new Error('UNIQUE constraint failed: harbors.namespace, harbors.name');
          }
          harbors.push({ id, namespace, name, pubkey, created_by, created_at });
          return ok;
        }
        if (sql.includes('INSERT INTO harbor_memberships')) {
          const [harbor_id, member_kind, member_id, role, added_at, added_by] = args as [
            string, 'user' | 'daemon', string, 'owner' | 'member', number, string,
          ];
          if (memberships.some((m) => m.harbor_id === harbor_id && m.member_kind === member_kind && m.member_id === member_id)) {
            throw new Error('UNIQUE constraint failed: harbor_memberships.harbor_id, harbor_memberships.member_kind, harbor_memberships.member_id');
          }
          memberships.push({ harbor_id, member_kind, member_id, role, added_at, added_by });
          return ok;
        }
        return ok;
      },
    };
    return stmt;
  }

  const db = {
    prepare,
    // D1 batch: sequential statement execution; the fake mirrors atomicity only
    // insofar as a first-statement UNIQUE throw prevents later statements.
    async batch(stmts: Array<{ run(): Promise<unknown> }>) {
      const out: unknown[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return { db: db as unknown as D1Database, harbors, memberships };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    KV: { get: async () => null, put: async () => {}, delete: async () => {} } as unknown as KVNamespace,
    PUBLIC_BASE_URL: BASE,
    RELAY_VERSION: '0.1.0-test',
  } as unknown as Env;
}

function req(path: string, opts: { method?: string; token?: string; body?: unknown; origin?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.origin) headers.Origin = opts.origin;
  return new Request(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

const PUBKEY = '1234abcd'.repeat(8); // 64 hex chars

/** Create dock (alice's harbor) + admit bob as a plain member. */
async function seedDock(env: Env): Promise<void> {
  const created = await handleCreateHarbor(req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: PUBKEY } }), env);
  expect(created.status).toBe(201);
  const added = await handleAddHarborMember(
    req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'bob' } }),
    env, 'alice', 'dock',
  );
  expect(added.status).toBe(201);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /v1/harbors (create)', () => {
  let env: Env;
  beforeEach(() => {
    env = makeEnv(makeDb().db);
  });

  it('401 unauthenticated — routed through the real worker dispatcher', async () => {
    const res = await worker.fetch(req('/v1/harbors', { method: 'POST', body: { name: 'dock', pubkey: PUBKEY } }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('creates a harbor in the CREATOR-derived namespace with role owner', async () => {
    const res = await worker.fetch(
      req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'Dock', pubkey: PUBKEY.toUpperCase() } }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { harbor: { namespace: string; name: string; pubkey: string; role: string } };
    // namespace comes from alice's login — the request body cannot choose it.
    expect(body.harbor.namespace).toBe('alice');
    expect(body.harbor.name).toBe('dock'); // lowercased
    expect(body.harbor.pubkey).toBe(PUBKEY); // lowercased
    expect(body.harbor.role).toBe('owner');

    // The creator's owner membership row landed with the harbor.
    const mine = await handleListMyHarbors(req('/v1/harbors', { token: ALICE_TOKEN }), env);
    const list = (await mine.json()) as { harbors: Array<{ name: string; role: string }> };
    expect(list.harbors).toEqual([expect.objectContaining({ name: 'dock', role: 'owner' })]);
  });

  it('rejects a bad name and a bad pubkey (400, fail closed)', async () => {
    for (const body of [
      { name: 'x', pubkey: PUBKEY },              // too short
      { name: 'has space', pubkey: PUBKEY },      // bad chars
      { name: '-lead', pubkey: PUBKEY },          // bad edge char
      { name: 'dock', pubkey: 'zz'.repeat(32) },  // not hex
      { name: 'dock', pubkey: 'ab'.repeat(16) },  // wrong length
      { name: 'dock' },                            // pubkey missing
    ]) {
      const res = await handleCreateHarbor(req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body }), env);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('409 DUPLICATE_NAME within a namespace; the same name is fine in another namespace', async () => {
    const mk = (token: string) =>
      handleCreateHarbor(req('/v1/harbors', { method: 'POST', token, body: { name: 'dock', pubkey: PUBKEY } }), env);
    expect((await mk(ALICE_TOKEN)).status).toBe(201);
    const dup = await mk(ALICE_TOKEN);
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { code: string }).code).toBe('DUPLICATE_NAME');
    // bob/dock is a different (namespace, name) pair → allowed.
    expect((await mk(BOB_TOKEN)).status).toBe(201);
  });

  it('refuses a cross-origin browser write (CSRF guard)', async () => {
    const res = await handleCreateHarbor(
      req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: PUBKEY }, origin: 'https://evil.example' }),
      env,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('CROSS_ORIGIN');
  });
});

describe('GET /v1/harbors (mine)', () => {
  it('401 unauthenticated', async () => {
    const env = makeEnv(makeDb().db);
    const res = await worker.fetch(req('/v1/harbors'), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });

  it('lists only the harbors the caller belongs to, with their role', async () => {
    const env = makeEnv(makeDb().db);
    await seedDock(env);

    const bob = (await (await handleListMyHarbors(req('/v1/harbors', { token: BOB_TOKEN }), env)).json()) as {
      harbors: Array<{ namespace: string; name: string; role: string }>;
    };
    expect(bob.harbors).toEqual([expect.objectContaining({ namespace: 'alice', name: 'dock', role: 'member' })]);

    const carol = (await (await handleListMyHarbors(req('/v1/harbors', { token: CAROL_TOKEN }), env)).json()) as {
      harbors: unknown[];
    };
    expect(carol.harbors).toEqual([]);
  });
});

describe('GET /v1/harbors/:namespace/:name — member gate', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedDock(env);
  });

  it('401 unauthenticated — routed through the real worker dispatcher', async () => {
    const res = await worker.fetch(req('/v1/harbors/alice/dock'), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });

  it('members (owner and plain) read the harbor + its member list', async () => {
    for (const token of [ALICE_TOKEN, BOB_TOKEN]) {
      const res = await worker.fetch(req('/v1/harbors/alice/dock', { token }), env, {} as ExecutionContext);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        harbor: { namespace: string; name: string; pubkey: string };
        members: Array<{ kind: string; member: string; role: string }>;
      };
      expect(body.harbor).toMatchObject({ namespace: 'alice', name: 'dock', pubkey: PUBKEY });
      expect(body.members).toEqual([
        expect.objectContaining({ kind: 'user', member: 'alice', role: 'owner' }),
        expect.objectContaining({ kind: 'user', member: 'Bob', role: 'member' }),
      ]);
    }
  });

  it('a NON-MEMBER gets the same 404 as a nonexistent harbor (no existence oracle)', async () => {
    const asCarol = await handleGetHarbor(req('/v1/harbors/alice/dock', { token: CAROL_TOKEN }), env, 'alice', 'dock');
    const noSuch = await handleGetHarbor(req('/v1/harbors/alice/ghost', { token: CAROL_TOKEN }), env, 'alice', 'ghost');
    expect(asCarol.status).toBe(404);
    expect(noSuch.status).toBe(404);
    expect(await asCarol.json()).toEqual(await noSuch.json());
  });
});

describe('POST /v1/harbors/:namespace/:name/members — owner gate', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedDock(env);
  });

  const add = (token: string | undefined, body: unknown) =>
    handleAddHarborMember(
      req('/v1/harbors/alice/dock/members', { method: 'POST', ...(token ? { token } : {}), body }),
      env, 'alice', 'dock',
    );

  it('authz matrix: 401 unauthenticated / 404 non-member / 403 plain member / 201 owner', async () => {
    expect((await add(undefined, { user: 'carol' })).status).toBe(401);
    expect((await add(CAROL_TOKEN, { user: 'carol' })).status).toBe(404); // non-member: same as nonexistent
    expect((await add(BOB_TOKEN, { user: 'carol' })).status).toBe(403);  // member, not owner
    const owner = await add(ALICE_TOKEN, { user: 'carol' });
    expect(owner.status).toBe(201);
    expect(((await owner.json()) as { member: { member: string; role: string } }).member).toMatchObject({ member: 'carol', role: 'member' });
  });

  it('routes the member add through the real worker dispatcher', async () => {
    const res = await worker.fetch(
      req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'carol' } }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
  });

  it('user lookup is by existing relay account, case-insensitively; unknown login fails closed', async () => {
    // 'BOB' resolves to the mixed-case 'Bob' account — but bob is already a member.
    const dup = await add(ALICE_TOKEN, { user: 'BOB' });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { code: string }).code).toBe('ALREADY_MEMBER');
    const unknown = await add(ALICE_TOKEN, { user: 'mallory' });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { code: string }).code).toBe('UNKNOWN_USER');
  });

  it('daemon members must be registered, unrevoked identities', async () => {
    const good = await add(ALICE_TOKEN, { daemon: DAEMON_FP });
    expect(good.status).toBe(201);
    expect(((await good.json()) as { member: { kind: string; member: string } }).member).toMatchObject({ kind: 'daemon', member: DAEMON_FP });

    const revoked = await add(ALICE_TOKEN, { daemon: REVOKED_DAEMON_FP });
    expect(revoked.status).toBe(400);
    expect(((await revoked.json()) as { code: string }).code).toBe('UNKNOWN_DAEMON');

    const unknown = await add(ALICE_TOKEN, { daemon: 'ef'.repeat(32) });
    expect(unknown.status).toBe(400);
  });

  it('rejects ambiguous or malformed member specs and bad roles (400)', async () => {
    for (const body of [
      {},                                        // neither
      { user: 'carol', daemon: DAEMON_FP },      // both
      { user: 'carol', role: 'admiral' },        // bad role
      { user: 42 },                              // wrong type
    ]) {
      const res = await add(ALICE_TOKEN, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("an added 'owner' can then add members themselves", async () => {
    expect((await add(ALICE_TOKEN, { user: 'carol', role: 'owner' })).status).toBe(201);
    const byCarol = await handleAddHarborMember(
      req('/v1/harbors/alice/dock/members', { method: 'POST', token: CAROL_TOKEN, body: { daemon: DAEMON_FP } }),
      env, 'alice', 'dock',
    );
    expect(byCarol.status).toBe(201);
  });
});
