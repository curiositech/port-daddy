/**
 * X2 harbor invites + join tests (src/invites.ts; ADR-0122 §4 epoch clock).
 *
 * Covers, per the acceptance list:
 *   - the CAS RACE: two concurrent consumes of one invite — exactly one wins,
 *     the loser is byte-identical with a holder of no invite, membership
 *     grows by exactly one, the epoch ticks exactly once;
 *   - EXPIRY and REVOCATION: both answer the same 404 as a nonexistent
 *     invite, premise-asserted so only the property under test can refuse;
 *   - the BYTE-IDENTICAL 404 RULE: nonexistent harbor, garbage token,
 *     expired, revoked, and consumed-by-another all produce one body;
 *   - the EPOCH BUMP: premise-asserted BEFORE the join, ticked by join and
 *     by operator add-member, NOT ticked by replays or refusals;
 *   - IDEMPOTENT JOIN: a replay by the winning member answers 200 with the
 *     standing membership; the crash window (consume landed, membership
 *     write did not) is repaired, but only while the invite is unexpired;
 *   - NO TOKEN AT REST: the store holds only the SHA-256 hash; no list or
 *     detail response ever carries a token or a hash.
 *
 * Idiom: stateful fake D1 keyed on SQL substrings (like harbors.test.ts),
 * authenticating via pdu_ bearer tokens through the REAL
 * resolveUserFromRequest path. The fake's batch() is transactional (snapshot
 * + restore on throw) because the membership-insert + epoch-tick pair relies
 * on D1 batch atomicity: a duplicate INSERT must roll the tick back. Routing
 * is pinned through worker.fetch for each new route at least once.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import {
  handleMintHarborInvite,
  handleListHarborInvites,
  handleRevokeHarborInvite,
  handleJoinHarbor,
} from '../src/invites.js';
import { handleCreateHarbor, handleAddHarborMember, handleGetHarbor } from '../src/harbors.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';

// ── Principals ────────────────────────────────────────────────────────────────

const ALICE_TOKEN = `pdu_${'a'.repeat(64)}`; // creator/owner
const BOB_TOKEN = `pdu_${'b'.repeat(64)}`;   // plain member
const CAROL_TOKEN = `pdu_${'c'.repeat(64)}`; // outsider (invite target)
const DAVE_TOKEN = `pdu_${'d'.repeat(64)}`;  // second outsider (race partner)

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
  authority_epoch: number;
}

interface FakeMembership {
  harbor_id: string;
  member_kind: 'user' | 'daemon';
  member_id: string;
  role: 'owner' | 'member';
  added_at: number;
  added_by: string;
}

interface FakeInvite {
  jti: string;
  harbor_id: string;
  token_hash: string;
  invited_by: string;
  role: 'member';
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  consumed_by: string | null;
  revoked_at: number | null;
  revoked_by: string | null;
}

// ── Stateful fake D1 ──────────────────────────────────────────────────────────

function makeDb() {
  const users: FakeUser[] = [
    mkUser('u_alice', 1, 'alice'),
    mkUser('u_bob', 2, 'bob'),
    mkUser('u_carol', 3, 'carol'),
    mkUser('u_dave', 4, 'dave'),
  ];
  const tokens = new Map<string, { user_id: string; expires_at: number | null; revoked_at: number | null }>([
    [hashHex(ALICE_TOKEN), { user_id: 'u_alice', expires_at: null, revoked_at: null }],
    [hashHex(BOB_TOKEN), { user_id: 'u_bob', expires_at: null, revoked_at: null }],
    [hashHex(CAROL_TOKEN), { user_id: 'u_carol', expires_at: null, revoked_at: null }],
    [hashHex(DAVE_TOKEN), { user_id: 'u_dave', expires_at: null, revoked_at: null }],
  ]);
  const harbors: FakeHarbor[] = [];
  const memberships: FakeMembership[] = [];
  const invites: FakeInvite[] = [];
  const ok = (changes: number) => ({ success: true, meta: { changes } });

  function prepare(sql: string) {
    let args: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        args = v;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM user_tokens')) {
          return (tokens.get(args[0] as string) ?? null) as T | null;
        }
        if (sql.includes('FROM users WHERE id = ?')) {
          return (users.find((u) => u.id === args[0] && u.deleted_at === null) ?? null) as T | null;
        }
        if (sql.includes('FROM users WHERE login')) {
          const q = (args[0] as string).toLowerCase();
          return (users.find((u) => u.login.toLowerCase() === q && u.deleted_at === null) ?? null) as T | null;
        }
        if (sql.includes('FROM harbors WHERE namespace = ? AND name = ?')) {
          const h = harbors.find((x) => x.namespace === args[0] && x.name === args[1]);
          return (h ? { ...h } : null) as T | null;
        }
        if (sql.includes('SELECT role FROM harbor_memberships')) {
          const m = memberships.find(
            (x) => x.harbor_id === args[0] && x.member_kind === args[1] && x.member_id === args[2],
          );
          return (m ? { role: m.role } : null) as T | null;
        }
        if (sql.includes('FROM harbor_invites WHERE harbor_id = ? AND token_hash = ?')) {
          const i = invites.find((x) => x.harbor_id === args[0] && x.token_hash === args[1]);
          return (i ? { ...i } : null) as T | null;
        }
        if (sql.includes('FROM harbor_invites WHERE harbor_id = ? AND jti = ?')) {
          const i = invites.find((x) => x.harbor_id === args[0] && x.jti === args[1]);
          return (i ? { ...i } : null) as T | null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        // listHarborInvites (LEFT JOIN users for inviter logins)
        if (sql.includes('FROM harbor_invites i')) {
          const rows = invites
            .filter((i) => i.harbor_id === args[0])
            .sort((a, b) => b.created_at - a.created_at || (a.jti < b.jti ? -1 : 1))
            .map((i) => ({
              jti: i.jti,
              invited_by: i.invited_by,
              inviter_login: users.find((u) => u.id === i.invited_by)?.login ?? null,
              role: i.role,
              created_at: i.created_at,
              expires_at: i.expires_at,
              consumed_at: i.consumed_at,
              revoked_at: i.revoked_at,
            }));
          return { results: rows as T[] };
        }
        // listHarborMembers
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
        if (sql.includes('UPDATE user_tokens SET last_used_at')) return ok(1);
        if (sql.includes('INSERT INTO harbors')) {
          const [id, namespace, name, pubkey, created_by, created_at] = args as [string, string, string, string, string, number];
          if (harbors.some((h) => h.namespace === namespace && h.name === name)) {
            throw new Error('UNIQUE constraint failed: harbors.namespace, harbors.name');
          }
          harbors.push({ id, namespace, name, pubkey, created_by, created_at, authority_epoch: 1 });
          return ok(1);
        }
        if (sql.includes('INSERT INTO harbor_memberships')) {
          const [harbor_id, member_kind, member_id, role, added_at, added_by] = args as [
            string, 'user' | 'daemon', string, 'owner' | 'member', number, string,
          ];
          if (memberships.some((m) => m.harbor_id === harbor_id && m.member_kind === member_kind && m.member_id === member_id)) {
            throw new Error('UNIQUE constraint failed: harbor_memberships.harbor_id, harbor_memberships.member_kind, harbor_memberships.member_id');
          }
          memberships.push({ harbor_id, member_kind, member_id, role, added_at, added_by });
          return ok(1);
        }
        if (sql.includes('UPDATE harbors SET authority_epoch = authority_epoch + 1')) {
          const h = harbors.find((x) => x.id === args[0]);
          if (h) h.authority_epoch += 1;
          return ok(h ? 1 : 0);
        }
        if (sql.includes('INSERT INTO harbor_invites')) {
          const [jti, harbor_id, token_hash, invited_by, created_at, expires_at] = args as [
            string, string, string, string, number, number,
          ];
          if (invites.some((i) => i.token_hash === token_hash)) {
            throw new Error('UNIQUE constraint failed: harbor_invites.token_hash');
          }
          invites.push({
            jti, harbor_id, token_hash, invited_by,
            role: 'member', created_at, expires_at,
            consumed_at: null, consumed_by: null, revoked_at: null, revoked_by: null,
          });
          return ok(1);
        }
        // THE consume CAS: one statement, whole validity predicate in WHERE.
        // Each guard applies only if the REAL SQL string carries it, so a
        // mutation that drops `AND consumed_at IS NULL` (etc.) from db.ts is
        // reproduced here instead of being papered over by the fake — the
        // race test genuinely observes the statement's predicate.
        if (sql.includes('UPDATE harbor_invites SET consumed_at')) {
          const [consumed_at, consumed_by, harbor_id, token_hash, now] = args as [number, string, string, string, number];
          const i = invites.find(
            (x) =>
              x.harbor_id === harbor_id &&
              x.token_hash === token_hash &&
              (!sql.includes('consumed_at IS NULL') || x.consumed_at === null) &&
              (!sql.includes('revoked_at IS NULL') || x.revoked_at === null) &&
              (!sql.includes('expires_at > ?') || x.expires_at > now),
          );
          if (!i) return ok(0);
          i.consumed_at = consumed_at;
          i.consumed_by = consumed_by;
          return ok(1);
        }
        // The revoke CAS: same live predicate, minus expiry.
        if (sql.includes('UPDATE harbor_invites SET revoked_at')) {
          const [revoked_at, revoked_by, harbor_id, jti] = args as [number, string, string, string];
          const i = invites.find(
            (x) => x.harbor_id === harbor_id && x.jti === jti && x.consumed_at === null && x.revoked_at === null,
          );
          if (!i) return ok(0);
          i.revoked_at = revoked_at;
          i.revoked_by = revoked_by;
          return ok(1);
        }
        return ok(1);
      },
    };
    return stmt;
  }

  const db = {
    prepare,
    // D1 batch = one transaction: all statements land or none do. The fake
    // snapshots and restores on throw because addHarborMembership's
    // [INSERT membership, UPDATE epoch] pair depends on exactly that — a
    // duplicate INSERT must also roll back the epoch tick.
    async batch(stmts: Array<{ run(): Promise<unknown> }>) {
      const snapshot = {
        harbors: harbors.map((h) => ({ ...h })),
        memberships: memberships.map((m) => ({ ...m })),
        invites: invites.map((i) => ({ ...i })),
      };
      const out: unknown[] = [];
      try {
        for (const s of stmts) out.push(await s.run());
      } catch (e) {
        harbors.splice(0, harbors.length, ...snapshot.harbors);
        memberships.splice(0, memberships.length, ...snapshot.memberships);
        invites.splice(0, invites.length, ...snapshot.invites);
        throw e;
      }
      return out;
    },
  };
  return { db: db as unknown as D1Database, harbors, memberships, invites };
}

type FakeState = ReturnType<typeof makeDb>;

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
const NOW = () => Math.floor(Date.now() / 1000);

/** Create dock (alice's harbor) + admit bob as a plain member. */
async function seedDock(env: Env): Promise<void> {
  const created = await handleCreateHarbor(
    req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: PUBKEY } }),
    env,
  );
  expect(created.status).toBe(201);
  const added = await handleAddHarborMember(
    req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'bob' } }),
    env, 'alice', 'dock',
  );
  expect(added.status).toBe(201);
}

/** Mint an invite as `token` (default bob) and return its jti + bearer token. */
async function mintInvite(env: Env, opts: { token?: string; ttlHours?: number } = {}): Promise<{ jti: string; token: string; expiresAt: number }> {
  const res = await handleMintHarborInvite(
    req('/v1/harbors/alice/dock/invites', {
      method: 'POST',
      token: opts.token ?? BOB_TOKEN,
      ...(opts.ttlHours !== undefined ? { body: { ttlHours: opts.ttlHours } } : {}),
    }),
    env, 'alice', 'dock',
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { invite: { jti: string; token: string; expiresAt: number } };
  return body.invite;
}

/** The epoch as the member-gated API reports it — used for premise asserts. */
async function epochOf(env: Env): Promise<number> {
  const res = await handleGetHarbor(req('/v1/harbors/alice/dock', { token: ALICE_TOKEN }), env, 'alice', 'dock');
  expect(res.status).toBe(200);
  return ((await res.json()) as { harbor: { authorityEpoch: number } }).harbor.authorityEpoch;
}

// ── Mint ──────────────────────────────────────────────────────────────────────

describe('POST /v1/harbors/:ns/:name/invites (mint)', () => {
  let state: FakeState;
  let env: Env;
  beforeEach(async () => {
    state = makeDb();
    env = makeEnv(state.db);
    await seedDock(env);
  });

  it('401 unauthenticated — routed through the real worker dispatcher', async () => {
    const res = await worker.fetch(
      req('/v1/harbors/alice/dock/invites', { method: 'POST' }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('a plain member mints; the token is returned once and only its hash is stored', async () => {
    const res = await worker.fetch(
      req('/v1/harbors/alice/dock/invites', { method: 'POST', token: BOB_TOKEN }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invite: { jti: string; token: string; role: string; harbor: string; expiresAt: number; createdAt: number } };
    expect(body.invite.jti).toMatch(/^hi_[0-9a-f]{32}$/);
    expect(body.invite.token).toMatch(/^pdi_[0-9a-f]{64}$/);
    expect(body.invite.role).toBe('member'); // I4: an invite grants exactly this
    expect(body.invite.harbor).toBe('alice/dock');
    // Default TTL 72h.
    expect(body.invite.expiresAt - body.invite.createdAt).toBe(72 * 3600);

    // Premise: exactly one invite row landed, and it is THIS invite.
    expect(state.invites).toHaveLength(1);
    expect(state.invites[0]!.jti).toBe(body.invite.jti);
    // The store holds the SHA-256 hash — and NEVER the raw token.
    expect(state.invites[0]!.token_hash).toBe(hashHex(body.invite.token));
    const storeDump = JSON.stringify({ invites: state.invites, harbors: state.harbors, memberships: state.memberships });
    expect(storeDump).toContain(hashHex(body.invite.token)); // negative control: we ARE looking at the right store
    expect(storeDump).not.toContain(body.invite.token);
  });

  it('bounds ttlHours to 1..168 and honors a custom value', async () => {
    for (const ttlHours of [0, 0.5, 169, -4, Number.NaN]) {
      const res = await handleMintHarborInvite(
        req('/v1/harbors/alice/dock/invites', { method: 'POST', token: BOB_TOKEN, body: { ttlHours } }),
        env, 'alice', 'dock',
      );
      expect(res.status, `ttlHours=${ttlHours}`).toBe(400);
    }
    const invite = await mintInvite(env, { ttlHours: 48 });
    expect(invite.expiresAt - NOW()).toBeGreaterThanOrEqual(48 * 3600 - 5);
    expect(invite.expiresAt - NOW()).toBeLessThanOrEqual(48 * 3600 + 5);
  });

  it('non-member and nonexistent harbor answer byte-identically (no oracle)', async () => {
    const asOutsider = await handleMintHarborInvite(
      req('/v1/harbors/alice/dock/invites', { method: 'POST', token: CAROL_TOKEN }),
      env, 'alice', 'dock',
    );
    const noSuchHarbor = await handleMintHarborInvite(
      req('/v1/harbors/alice/ghost/invites', { method: 'POST', token: CAROL_TOKEN }),
      env, 'alice', 'ghost',
    );
    expect(asOutsider.status).toBe(404);
    expect(noSuchHarbor.status).toBe(404);
    expect(await asOutsider.text()).toBe(await noSuchHarbor.text());
  });

  it('refuses a cross-origin browser write (CSRF guard)', async () => {
    const res = await handleMintHarborInvite(
      req('/v1/harbors/alice/dock/invites', { method: 'POST', token: BOB_TOKEN, origin: 'https://evil.example' }),
      env, 'alice', 'dock',
    );
    expect(res.status).toBe(403);
  });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe('GET /v1/harbors/:ns/:name/invites (list)', () => {
  let state: FakeState;
  let env: Env;
  beforeEach(async () => {
    state = makeDb();
    env = makeEnv(state.db);
    await seedDock(env);
  });

  it('members see jti + lifecycle; the response never carries a token or a hash', async () => {
    const minted = await mintInvite(env);
    // Premise: the hash IS at rest, so its absence from the response is a
    // real property of the surface, not of an empty store.
    expect(state.invites[0]!.token_hash).toBe(hashHex(minted.token));

    const res = await worker.fetch(
      req('/v1/harbors/alice/dock/invites', { token: ALICE_TOKEN }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { invites: Array<{ jti: string; inviter: string; status: string }> };
    expect(body.invites).toEqual([expect.objectContaining({ jti: minted.jti, inviter: 'bob', status: 'pending' })]);
    expect(text).not.toContain(minted.token);
    expect(text).not.toContain(hashHex(minted.token));
  });

  it('reports consumed / revoked / expired states honestly', async () => {
    const consumed = await mintInvite(env);
    const revoked = await mintInvite(env);
    const expired = await mintInvite(env);
    const joinRes = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: consumed.token } }),
      env, 'alice', 'dock',
    );
    expect(joinRes.status).toBe(201);
    const revokeRes = await handleRevokeHarborInvite(
      req(`/v1/harbors/alice/dock/invites/${revoked.jti}/revoke`, { method: 'POST', token: BOB_TOKEN }),
      env, 'alice', 'dock', revoked.jti,
    );
    expect(revokeRes.status).toBe(200);
    // Force the third past its expiry directly in the store.
    state.invites.find((i) => i.jti === expired.jti)!.expires_at = NOW() - 10;

    const res = await handleListHarborInvites(req('/v1/harbors/alice/dock/invites', { token: ALICE_TOKEN }), env, 'alice', 'dock');
    const body = (await res.json()) as { invites: Array<{ jti: string; status: string }> };
    const byJti = new Map(body.invites.map((i) => [i.jti, i.status]));
    expect(byJti.get(consumed.jti)).toBe('consumed');
    expect(byJti.get(revoked.jti)).toBe('revoked');
    expect(byJti.get(expired.jti)).toBe('expired');
  });

  it('non-member and nonexistent harbor answer byte-identically', async () => {
    const asOutsider = await handleListHarborInvites(req('/v1/harbors/alice/dock/invites', { token: DAVE_TOKEN }), env, 'alice', 'dock');
    const noSuchHarbor = await handleListHarborInvites(req('/v1/harbors/alice/ghost/invites', { token: DAVE_TOKEN }), env, 'alice', 'ghost');
    expect(asOutsider.status).toBe(404);
    expect(await asOutsider.text()).toBe(await noSuchHarbor.text());
  });
});

// ── Revoke ────────────────────────────────────────────────────────────────────

describe('POST /v1/harbors/:ns/:name/invites/:jti/revoke', () => {
  let state: FakeState;
  let env: Env;
  beforeEach(async () => {
    state = makeDb();
    env = makeEnv(state.db);
    await seedDock(env);
  });

  it('the inviter revokes; a revoked invite joins like no invite at all', async () => {
    const invite = await mintInvite(env); // minted by bob
    // Premise: live before the revoke.
    expect(state.invites[0]!.revoked_at).toBeNull();
    expect(state.invites[0]!.consumed_at).toBeNull();

    const res = await worker.fetch(
      req(`/v1/harbors/alice/dock/invites/${invite.jti}/revoke`, { method: 'POST', token: BOB_TOKEN }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(state.invites[0]!.revoked_at).not.toBeNull();
    expect(state.invites[0]!.revoked_by).toBe('u_bob');

    const join = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'dock',
    );
    const ghost = await handleJoinHarbor(
      req('/v1/harbors/alice/ghost/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'ghost',
    );
    expect(join.status).toBe(404);
    expect(await join.text()).toBe(await ghost.text()); // byte-identical with "no such harbor"
  });

  it('an owner may revoke another member\'s invite; a plain non-inviter member may not', async () => {
    const first = await mintInvite(env); // bob's
    const denied = await handleRevokeHarborInvite(
      req(`/v1/harbors/alice/dock/invites/${first.jti}/revoke`, { method: 'POST', token: CAROL_TOKEN }),
      env, 'alice', 'dock', first.jti,
    );
    expect(denied.status).toBe(404); // carol is not even a member: no oracle

    // Admit carol as a plain member, then she still may not revoke bob's invite.
    const add = await handleAddHarborMember(
      req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'carol' } }),
      env, 'alice', 'dock',
    );
    expect(add.status).toBe(201);
    const forbidden = await handleRevokeHarborInvite(
      req(`/v1/harbors/alice/dock/invites/${first.jti}/revoke`, { method: 'POST', token: CAROL_TOKEN }),
      env, 'alice', 'dock', first.jti,
    );
    expect(forbidden.status).toBe(403);

    // Alice (owner, not the inviter) may.
    const allowed = await handleRevokeHarborInvite(
      req(`/v1/harbors/alice/dock/invites/${first.jti}/revoke`, { method: 'POST', token: ALICE_TOKEN }),
      env, 'alice', 'dock', first.jti,
    );
    expect(allowed.status).toBe(200);
  });

  it('revoking a consumed invite is refused 409; re-revoking is idempotent 200', async () => {
    const invite = await mintInvite(env);
    const join = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'dock',
    );
    expect(join.status).toBe(201); // premise: really consumed
    const afterConsume = await handleRevokeHarborInvite(
      req(`/v1/harbors/alice/dock/invites/${invite.jti}/revoke`, { method: 'POST', token: BOB_TOKEN }),
      env, 'alice', 'dock', invite.jti,
    );
    expect(afterConsume.status).toBe(409);
    expect(((await afterConsume.json()) as { code: string }).code).toBe('ALREADY_CONSUMED');

    const second = await mintInvite(env);
    for (let i = 0; i < 2; i++) {
      const res = await handleRevokeHarborInvite(
        req(`/v1/harbors/alice/dock/invites/${second.jti}/revoke`, { method: 'POST', token: BOB_TOKEN }),
        env, 'alice', 'dock', second.jti,
      );
      expect(res.status, `revoke attempt ${i + 1}`).toBe(200);
    }
  });
});

// ── Join ──────────────────────────────────────────────────────────────────────

describe('POST /v1/harbors/:ns/:name/join', () => {
  let state: FakeState;
  let env: Env;
  beforeEach(async () => {
    state = makeDb();
    env = makeEnv(state.db);
    await seedDock(env);
  });

  it('redeems an invite: membership recorded, epoch ticked — premise-asserted BEFORE', async () => {
    const invite = await mintInvite(env);
    // Premise: creation was epoch 1, admitting bob ticked it to 2, and carol
    // is not yet a member — the join below is a real membership change.
    expect(await epochOf(env)).toBe(2);
    expect(state.memberships.some((m) => m.member_id === 'u_carol')).toBe(false);

    const res = await worker.fetch(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { joined: boolean; harbor: { authorityEpoch: number; role: string } };
    expect(body.joined).toBe(true);
    expect(body.harbor.role).toBe('member');
    expect(body.harbor.authorityEpoch).toBe(3);
    expect(await epochOf(env)).toBe(3);
    expect(state.memberships.find((m) => m.member_id === 'u_carol')).toMatchObject({ role: 'member' });
    // The invite is spent, attributed to carol.
    expect(state.invites[0]!.consumed_by).toBe('u_carol');
  });

  it('is idempotent for the same member: replay answers 200 and does NOT tick the epoch again', async () => {
    const invite = await mintInvite(env);
    const first = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'dock',
    );
    expect(first.status).toBe(201); // premise: the join under replay really happened
    expect(await epochOf(env)).toBe(3);

    const replay = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'dock',
    );
    expect(replay.status).toBe(200);
    const body = (await replay.json()) as { joined: boolean; harbor: { authorityEpoch: number } };
    expect(body.joined).toBe(false);
    expect(body.harbor.authorityEpoch).toBe(3); // unchanged
    expect(await epochOf(env)).toBe(3);
    expect(state.memberships.filter((m) => m.member_id === 'u_carol')).toHaveLength(1);
  });

  it('CAS race: two concurrent redeems of ONE invite — exactly one wins', async () => {
    const invite = await mintInvite(env);
    // Premise: one live invite, neither racer is a member, epoch is 2.
    expect(state.invites).toHaveLength(1);
    expect(state.invites[0]!.consumed_at).toBeNull();
    expect(state.memberships.filter((m) => ['u_carol', 'u_dave'].includes(m.member_id))).toHaveLength(0);
    expect(await epochOf(env)).toBe(2);

    const [asCarol, asDave] = await Promise.all([
      handleJoinHarbor(
        req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
        env, 'alice', 'dock',
      ),
      handleJoinHarbor(
        req('/v1/harbors/alice/dock/join', { method: 'POST', token: DAVE_TOKEN, body: { token: invite.token } }),
        env, 'alice', 'dock',
      ),
    ]);
    const statuses = [asCarol.status, asDave.status].sort();
    expect(statuses).toEqual([201, 404]); // exactly one winner, loser learns nothing
    // Exactly one membership landed and the epoch ticked exactly once.
    expect(state.memberships.filter((m) => ['u_carol', 'u_dave'].includes(m.member_id))).toHaveLength(1);
    expect(await epochOf(env)).toBe(3);
    // The winner on the row is the winner on the wire.
    const winner = asCarol.status === 201 ? 'u_carol' : 'u_dave';
    expect(state.invites[0]!.consumed_by).toBe(winner);
  });

  it('join vs revoke race: two concurrent operations on ONE live invite — exactly one wins', async () => {
    const invite = await mintInvite(env); // minted by bob
    // Premise: one live invite — unconsumed AND unrevoked — carol is not yet
    // a member, and epoch is 2. Either racer's CAS is legal to win from here.
    expect(state.invites).toHaveLength(1);
    expect(state.invites[0]!.consumed_at).toBeNull();
    expect(state.invites[0]!.revoked_at).toBeNull();
    expect(state.memberships.some((m) => m.member_id === 'u_carol')).toBe(false);
    expect(await epochOf(env)).toBe(2);

    // The consume CAS (join) and the revoke CAS race the same row: both gate
    // on `consumed_at IS NULL AND revoked_at IS NULL`, so at most one of the
    // two UPDATEs can match once the other has landed.
    const [joinRes, revokeRes] = await Promise.all([
      handleJoinHarbor(
        req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
        env, 'alice', 'dock',
      ),
      handleRevokeHarborInvite(
        req(`/v1/harbors/alice/dock/invites/${invite.jti}/revoke`, { method: 'POST', token: BOB_TOKEN }),
        env, 'alice', 'dock', invite.jti,
      ),
    ]);

    if (joinRes.status === 201) {
      // Join won the row: carol's membership landed, the epoch ticked once,
      // and revoke's CAS found the invite already closed — 409, not 200.
      expect(revokeRes.status).toBe(409);
      expect(((await revokeRes.json()) as { code: string }).code).toBe('ALREADY_CONSUMED');
      expect(state.memberships.filter((m) => m.member_id === 'u_carol')).toHaveLength(1);
      expect(await epochOf(env)).toBe(3);
      expect(state.invites[0]!.consumed_by).toBe('u_carol');
      expect(state.invites[0]!.revoked_at).toBeNull(); // the revoke never landed
    } else {
      // Revoke won the row: the invite closed before join's CAS could claim
      // it, so join gets the ordinary byte-identical 404 — no membership
      // change, no epoch tick, nothing consumed.
      expect(revokeRes.status).toBe(200);
      expect(joinRes.status).toBe(404);
      expect(((await joinRes.json()) as { code: string }).code).toBe('NOT_FOUND');
      expect(state.memberships.some((m) => m.member_id === 'u_carol')).toBe(false);
      expect(await epochOf(env)).toBe(2);
      expect(state.invites[0]!.consumed_at).toBeNull(); // the join never landed
      expect(state.invites[0]!.revoked_by).toBe('u_bob');
    }
  });

  it('same-invitee concurrent redemption: two joins by ONE user on ONE invite — one 201, one idempotent 200, one tick', async () => {
    const invite = await mintInvite(env);
    // Premise: one live invite, carol is not a member, epoch is 2.
    expect(state.invites).toHaveLength(1);
    expect(state.invites[0]!.consumed_at).toBeNull();
    expect(state.memberships.some((m) => m.member_id === 'u_carol')).toBe(false);
    expect(await epochOf(env)).toBe(2);

    const [a, b] = await Promise.all([
      handleJoinHarbor(
        req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
        env, 'alice', 'dock',
      ),
      handleJoinHarbor(
        req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
        env, 'alice', 'dock',
      ),
    ]);

    // Unlike the two-user race, the CAS loser here IS the consume winner's
    // identity, so it takes the consumed-by-me branch — standing-membership
    // replay or crash-window repair, both 200 joined:false — never the
    // byte-identical 404, which is reserved for everyone else.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 201]);
    const loser = a.status === 200 ? a : b;
    expect(((await loser.json()) as { joined: boolean }).joined).toBe(false);

    // One membership row and exactly one epoch tick, whichever interleaving
    // ran: a duplicate INSERT in the repair window aborts its whole batch, so
    // the clock cannot double-count the same membership change.
    expect(state.memberships.filter((m) => m.member_id === 'u_carol')).toHaveLength(1);
    expect(await epochOf(env)).toBe(3);
    expect(state.invites[0]!.consumed_by).toBe('u_carol');
  });

  it('an expired invite joins like no invite at all — premise-asserted live otherwise', async () => {
    const invite = await mintInvite(env);
    const row = state.invites.find((i) => i.jti === invite.jti)!;
    row.expires_at = NOW() - 10;
    // Premise: unconsumed and unrevoked — only expiry can refuse this join.
    expect(row.consumed_at).toBeNull();
    expect(row.revoked_at).toBeNull();

    const expired = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'dock',
    );
    const ghost = await handleJoinHarbor(
      req('/v1/harbors/alice/ghost/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'ghost',
    );
    expect(expired.status).toBe(404);
    expect(await expired.text()).toBe(await ghost.text());
    expect(state.memberships.some((m) => m.member_id === 'u_carol')).toBe(false);
    expect(await epochOf(env)).toBe(2); // refusals never tick the clock
  });

  it('THE byte-identical 404: ghost harbor / garbage token / expired / revoked / consumed-by-another', async () => {
    const expired = await mintInvite(env);
    state.invites.find((i) => i.jti === expired.jti)!.expires_at = NOW() - 10;
    const revoked = await mintInvite(env);
    expect((await handleRevokeHarborInvite(
      req(`/v1/harbors/alice/dock/invites/${revoked.jti}/revoke`, { method: 'POST', token: BOB_TOKEN }),
      env, 'alice', 'dock', revoked.jti,
    )).status).toBe(200);
    const consumed = await mintInvite(env);
    expect((await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: DAVE_TOKEN, body: { token: consumed.token } }),
      env, 'alice', 'dock',
    )).status).toBe(201); // premise: dave consumed it; carol now probes it

    const probes: Array<[string, string, string]> = [
      ['ghost harbor', 'ghost', `pdi_${'0'.repeat(64)}`],
      ['garbage token on a real harbor', 'dock', 'pdi_not-even-hex'],
      ['expired', 'dock', expired.token],
      ['revoked', 'dock', revoked.token],
      ['consumed by another holder', 'dock', consumed.token],
    ];
    const answers: string[] = [];
    for (const [label, name, token] of probes) {
      const res = await handleJoinHarbor(
        req(`/v1/harbors/alice/${name}/join`, { method: 'POST', token: CAROL_TOKEN, body: { token } }),
        env, 'alice', name,
      );
      expect(res.status, label).toBe(404);
      answers.push(await res.text());
    }
    // Premise: the probes really were distinct causes (5 of them)…
    expect(answers).toHaveLength(5);
    // …and every answer is the same bytes.
    expect(new Set(answers).size).toBe(1);
  });

  it('an existing member redeeming an invite spends it without a membership change or epoch tick', async () => {
    const invite = await mintInvite(env);
    expect(await epochOf(env)).toBe(2);
    const res = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: ALICE_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'dock',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { joined: boolean; harbor: { role: string; authorityEpoch: number } };
    expect(body.joined).toBe(false);
    expect(body.harbor.role).toBe('owner'); // standing role is reported, never downgraded
    expect(body.harbor.authorityEpoch).toBe(2); // no membership change → no tick
    expect(state.invites[0]!.consumed_by).toBe('u_alice'); // but the invite IS spent
    expect(state.memberships.filter((m) => m.member_id === 'u_alice')).toHaveLength(1);
  });

  it('repairs the consume-then-crash window for the winner while the invite is unexpired', async () => {
    const invite = await mintInvite(env);
    // Simulate: carol's consume landed, the membership write did not.
    const row = state.invites.find((i) => i.jti === invite.jti)!;
    row.consumed_at = NOW();
    row.consumed_by = 'u_carol';
    expect(state.memberships.some((m) => m.member_id === 'u_carol')).toBe(false); // premise

    const res = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'dock',
    );
    expect(res.status).toBe(201);
    expect(state.memberships.some((m) => m.member_id === 'u_carol' && m.role === 'member')).toBe(true);
    expect(await epochOf(env)).toBe(3); // the repair IS the membership change

    // But an expired spent invite repairs nothing (no indefinite re-admission).
    const stale = await mintInvite(env);
    const staleRow = state.invites.find((i) => i.jti === stale.jti)!;
    staleRow.consumed_at = NOW() - 20;
    staleRow.consumed_by = 'u_dave';
    staleRow.expires_at = NOW() - 10;
    const denied = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: DAVE_TOKEN, body: { token: stale.token } }),
      env, 'alice', 'dock',
    );
    expect(denied.status).toBe(404);
    expect(state.memberships.some((m) => m.member_id === 'u_dave')).toBe(false);
  });

  it('shape errors are 400 (pre-resolution); unauthenticated is 401', async () => {
    const noToken = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: {} }),
      env, 'alice', 'dock',
    );
    expect(noToken.status).toBe(400);
    const noBody = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN }),
      env, 'alice', 'dock',
    );
    expect(noBody.status).toBe(400);
    const anon = await worker.fetch(
      req('/v1/harbors/alice/dock/join', { method: 'POST', body: { token: 'pdi_x' } }),
      env, {} as ExecutionContext,
    );
    expect(anon.status).toBe(401);
  });
});

// ── The epoch clock across membership-write paths ─────────────────────────────

describe('authority epoch (ADR-0122 §4 clock)', () => {
  let state: FakeState;
  let env: Env;
  beforeEach(() => {
    state = makeDb();
    env = makeEnv(state.db);
  });

  it('creation is epoch 1; every membership write ticks it; refused duplicates do not', async () => {
    const created = await handleCreateHarbor(
      req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: PUBKEY } }),
      env,
    );
    expect(created.status).toBe(201);
    expect(((await created.json()) as { harbor: { authorityEpoch: number } }).harbor.authorityEpoch).toBe(1);
    expect(await epochOf(env)).toBe(1); // premise for the first tick

    const add = await handleAddHarborMember(
      req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'bob' } }),
      env, 'alice', 'dock',
    );
    expect(add.status).toBe(201);
    expect(await epochOf(env)).toBe(2); // operator add-member ticks the clock

    // A refused duplicate add is not a membership change: batch rolls back, no tick.
    const dup = await handleAddHarborMember(
      req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'bob' } }),
      env, 'alice', 'dock',
    );
    expect(dup.status).toBe(409);
    expect(await epochOf(env)).toBe(2);

    const invite = await mintInvite(env);
    const join = await handleJoinHarbor(
      req('/v1/harbors/alice/dock/join', { method: 'POST', token: CAROL_TOKEN, body: { token: invite.token } }),
      env, 'alice', 'dock',
    );
    expect(join.status).toBe(201);
    expect(await epochOf(env)).toBe(3); // join ticks the same clock
    expect(state.harbors[0]!.authority_epoch).toBe(3); // and it is the ROW, not response arithmetic
  });
});
