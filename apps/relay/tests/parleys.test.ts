/**
 * X4 PARLEY v1 tests (src/parleys.ts; grand-plan §X4 MVP slice).
 *
 * Covers, per the acceptance list:
 *   - the STATE MACHINE: open on convene; all named parties sign 'accept' ⇒
 *     agreed; any 'reject' ⇒ lapsed; deadline expiry (lazy, on read/write) ⇒
 *     lapsed — a parley is never a liveness hole;
 *   - IMMUTABILITY AFTER AGREED/LAPSED: no route writes to a non-open parley
 *     (409 PARLEY_CLOSED) and a signed position is write-once (409
 *     ALREADY_SIGNED);
 *   - MEMBER GATING: 401 unauthenticated, non-members get the same 404 as a
 *     nonexistent harbor/parley (no existence oracle), members read, only
 *     NAMED parties sign (403 NOT_A_PARTY), parties must be verified harbor
 *     members at convene time (fail closed);
 *   - the MEDIATOR seat: every parley carries a reserved, tier-labeled
 *     'pd-mediator' observer position with NO auto-behavior, which can never
 *     be named as a party nor sign.
 *
 * Idiom: stateful fake D1 keyed on SQL substrings (like harbors.test.ts),
 * pdu_ bearer auth through the REAL resolveUserFromRequest path, time driven
 * with vi.setSystemTime, routing pinned through worker.fetch per route.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import {
  handleCreateParley,
  handleListParleys,
  handleGetParley,
  handleRespondParley,
  DEFAULT_PARLEY_DEADLINE_HOURS,
  MEDIATOR_ID,
  MEDIATOR_TIER,
} from '../src/parleys.js';
import { handleCreateHarbor, handleAddHarborMember } from '../src/harbors.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';

// ── Principals ────────────────────────────────────────────────────────────────

const ALICE_TOKEN = `pdu_${'a'.repeat(64)}`;   // harbor creator/owner, proposer
const BOB_TOKEN = `pdu_${'b'.repeat(64)}`;     // member, named party
const CAROL_TOKEN = `pdu_${'c'.repeat(64)}`;   // member, NOT a named party
const MALLORY_TOKEN = `pdu_${'d'.repeat(64)}`; // NON-member with an account

const DAEMON_FP = 'ab'.repeat(32);             // registered, unrevoked, harbor member
const LONER_DAEMON_FP = 'ef'.repeat(32);       // registered, unrevoked, NOT a member
const REVOKED_DAEMON_FP = 'cd'.repeat(32);     // registered but revoked

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

interface FakeParley {
  id: string;
  harbor_id: string;
  subject: string;
  proposer_id: string;
  proposer_label: string;
  state: 'open' | 'agreed' | 'lapsed';
  deadline_at: number;
  created_at: number;
  resolved_at: number | null;
}

interface FakePosition {
  parley_id: string;
  party_kind: 'user' | 'daemon' | 'mediator';
  party_id: string;
  party_label: string;
  tier: string;
  is_party: number;
  stance: 'accept' | 'reject' | null;
  position: string | null;
  signed_at: number | null;
}

// ── Stateful fake D1 ──────────────────────────────────────────────────────────

function makeDb() {
  const users: FakeUser[] = [
    mkUser('u_alice', 1, 'alice'),
    mkUser('u_bob', 2, 'bob'),
    mkUser('u_carol', 3, 'carol'),
    mkUser('u_mallory', 4, 'mallory'),
  ];
  const tokens = new Map<string, { user_id: string; expires_at: number | null; revoked_at: number | null }>([
    [hashHex(ALICE_TOKEN), { user_id: 'u_alice', expires_at: null, revoked_at: null }],
    [hashHex(BOB_TOKEN), { user_id: 'u_bob', expires_at: null, revoked_at: null }],
    [hashHex(CAROL_TOKEN), { user_id: 'u_carol', expires_at: null, revoked_at: null }],
    [hashHex(MALLORY_TOKEN), { user_id: 'u_mallory', expires_at: null, revoked_at: null }],
  ]);
  const identities = [
    { daemon_fingerprint: DAEMON_FP, pub_key: 'ff'.repeat(32), proof_method: 'oidc', proof_metadata: '{}', expires_at: null, revoked: 0, revoked_reason: null },
    { daemon_fingerprint: LONER_DAEMON_FP, pub_key: 'dd'.repeat(32), proof_method: 'oidc', proof_metadata: '{}', expires_at: null, revoked: 0, revoked_reason: null },
    { daemon_fingerprint: REVOKED_DAEMON_FP, pub_key: 'ee'.repeat(32), proof_method: 'oidc', proof_metadata: '{}', expires_at: null, revoked: 1, revoked_reason: 'compromised' },
  ];
  const harbors: FakeHarbor[] = [];
  const memberships: FakeMembership[] = [];
  const parleys: FakeParley[] = [];
  const positions: FakePosition[] = [];
  const ok = { success: true, meta: { changes: 1 } };
  const changes = (n: number) => ({ success: true, meta: { changes: n } });

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
        // countUnacceptedParties
        if (sql.includes('COUNT(*) AS n FROM parley_positions')) {
          const n = positions.filter(
            (p) => p.parley_id === args[0] && p.is_party === 1 && p.stance !== 'accept',
          ).length;
          return { n } as T;
        }
        if (sql.includes('FROM parleys WHERE id = ?')) {
          return (parleys.find((p) => p.id === args[0]) ?? null) as T | null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('FROM parleys WHERE harbor_id = ?')) {
          const rows = parleys
            .filter((p) => p.harbor_id === args[0])
            .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
          return { results: rows as T[] };
        }
        if (sql.includes('FROM parley_positions WHERE parley_id = ?')) {
          const rows = positions
            .filter((p) => p.parley_id === args[0])
            .sort(
              (a, b) =>
                b.is_party - a.is_party ||
                a.party_kind.localeCompare(b.party_kind) ||
                a.party_id.localeCompare(b.party_id),
            );
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
            throw new Error('UNIQUE constraint failed: harbor_memberships');
          }
          memberships.push({ harbor_id, member_kind, member_id, role, added_at, added_by });
          return ok;
        }
        if (sql.includes('INSERT INTO parleys')) {
          const [id, harbor_id, subject, proposer_id, proposer_label, deadline_at, created_at] = args as [
            string, string, string, string, string, number, number,
          ];
          parleys.push({ id, harbor_id, subject, proposer_id, proposer_label, state: 'open', deadline_at, created_at, resolved_at: null });
          return ok;
        }
        if (sql.includes('INSERT INTO parley_positions')) {
          const [parley_id, party_kind, party_id, party_label, tier, is_party] = args as [
            string, 'user' | 'daemon' | 'mediator', string, string, string, number,
          ];
          if (positions.some((p) => p.parley_id === parley_id && p.party_kind === party_kind && p.party_id === party_id)) {
            throw new Error('UNIQUE constraint failed: parley_positions');
          }
          positions.push({ parley_id, party_kind, party_id, party_label, tier, is_party, stance: null, position: null, signed_at: null });
          return ok;
        }
        // signParleyPosition (write-once CAS)
        if (sql.includes('UPDATE parley_positions SET stance')) {
          const [stance, position, signed_at, parley_id, party_kind, party_id] = args as [
            'accept' | 'reject', string | null, number, string, 'user' | 'daemon' | 'mediator', string,
          ];
          const row = positions.find(
            (p) =>
              p.parley_id === parley_id && p.party_kind === party_kind && p.party_id === party_id &&
              p.is_party === 1 && p.signed_at === null,
          );
          if (!row) return changes(0);
          row.stance = stance;
          row.position = position;
          row.signed_at = signed_at;
          return changes(1);
        }
        // resolveParleyState (CAS on state='open')
        if (sql.includes('UPDATE parleys SET state = ?, resolved_at = ? WHERE id = ?')) {
          const [state, resolved_at, id] = args as ['agreed' | 'lapsed', number, string];
          const row = parleys.find((p) => p.id === id && p.state === 'open');
          if (!row) return changes(0);
          row.state = state;
          row.resolved_at = resolved_at;
          return changes(1);
        }
        // lapseExpiredParleys
        if (sql.includes("UPDATE parleys SET state = 'lapsed'")) {
          const [resolved_at, harbor_id, now] = args as [number, string, number];
          let n = 0;
          for (const p of parleys) {
            if (p.harbor_id === harbor_id && p.state === 'open' && p.deadline_at < now) {
              p.state = 'lapsed';
              p.resolved_at = resolved_at;
              n += 1;
            }
          }
          return changes(n);
        }
        return ok;
      },
    };
    return stmt;
  }

  const db = {
    prepare,
    async batch(stmts: Array<{ run(): Promise<unknown> }>) {
      const out: unknown[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return { db: db as unknown as D1Database, parleys, positions };
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

const PUBKEY = '1234abcd'.repeat(8);
const T0 = 1_800_000_000; // fixed "now" for fake time
const at = (sec: number) => vi.setSystemTime(new Date(sec * 1000));

/** Harbor alice/dock: alice owner, bob + carol members, DAEMON_FP member. */
async function seedDock(env: Env): Promise<void> {
  const created = await handleCreateHarbor(
    req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: PUBKEY } }), env,
  );
  expect(created.status).toBe(201);
  for (const body of [{ user: 'bob' }, { user: 'carol' }, { daemon: DAEMON_FP }]) {
    const added = await handleAddHarborMember(
      req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body }), env, 'alice', 'dock',
    );
    expect(added.status).toBe(201);
  }
}

/** Convene an alice↔bob parley; returns its id. */
async function convene(env: Env, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await handleCreateParley(
    req('/v1/harbors/alice/dock/parleys', {
      method: 'POST', token: ALICE_TOKEN,
      body: { subject: 'who merges the auth refactor first', parties: [{ user: 'bob' }], ...extra },
    }),
    env, 'alice', 'dock',
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { parley: { id: string } }).parley.id;
}

const respond = (env: Env, id: string, token: string | undefined, body: unknown) =>
  handleRespondParley(
    req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', ...(token ? { token } : {}), body }),
    env, 'alice', 'dock', id,
  );

beforeEach(() => {
  vi.useFakeTimers();
  at(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── Convene ───────────────────────────────────────────────────────────────────

describe('POST /v1/harbors/:ns/:name/parleys (convene)', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedDock(env);
  });

  it('401 unauthenticated — routed through the real worker dispatcher', async () => {
    const res = await worker.fetch(
      req('/v1/harbors/alice/dock/parleys', { method: 'POST', body: { subject: 's', parties: [{ user: 'bob' }] } }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('a NON-MEMBER gets the same 404 as a nonexistent harbor (no existence oracle)', async () => {
    const asMallory = await handleCreateParley(
      req('/v1/harbors/alice/dock/parleys', { method: 'POST', token: MALLORY_TOKEN, body: { subject: 's', parties: [{ user: 'bob' }] } }),
      env, 'alice', 'dock',
    );
    const noSuch = await handleCreateParley(
      req('/v1/harbors/alice/ghost/parleys', { method: 'POST', token: MALLORY_TOKEN, body: { subject: 's', parties: [{ user: 'bob' }] } }),
      env, 'alice', 'ghost',
    );
    expect(asMallory.status).toBe(404);
    expect(noSuch.status).toBe(404);
    expect(await asMallory.json()).toEqual(await noSuch.json());
  });

  it('refuses a cross-origin browser write (CSRF guard)', async () => {
    const res = await handleCreateParley(
      req('/v1/harbors/alice/dock/parleys', { method: 'POST', token: ALICE_TOKEN, body: { subject: 's', parties: [{ user: 'bob' }] }, origin: 'https://evil.example' }),
      env, 'alice', 'dock',
    );
    expect(res.status).toBe(403);
  });

  it('convenes OPEN with default 24h deadline, proposer auto-named, mediator seat reserved (tier-labeled, not a party)', async () => {
    const res = await worker.fetch(
      req('/v1/harbors/alice/dock/parleys', { method: 'POST', token: ALICE_TOKEN, body: { subject: 'merge order', parties: [{ user: 'bob' }, { daemon: DAEMON_FP }] } }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      parley: { state: string; proposer: string; deadlineAt: number; createdAt: number; resolvedAt: number | null };
      positions: Array<{ kind: string; party: string; tier: string; named: boolean; stance: unknown; signedAt: unknown }>;
    };
    expect(body.parley.state).toBe('open');
    expect(body.parley.proposer).toBe('alice');
    expect(body.parley.resolvedAt).toBeNull();
    expect(body.parley.deadlineAt - body.parley.createdAt).toBe(DEFAULT_PARLEY_DEADLINE_HOURS * 3600);

    // Named parties: alice (auto), bob, the daemon — each unsigned. Plus the
    // reserved pd-mediator observer, tier-labeled, NOT a named party.
    const named = body.positions.filter((p) => p.named);
    expect(named.map((p) => p.party).sort()).toEqual(['alice', 'bob', DAEMON_FP].sort());
    expect(named.every((p) => p.stance === null && p.signedAt === null)).toBe(true);
    const mediator = body.positions.find((p) => p.kind === 'mediator');
    expect(mediator).toMatchObject({ party: MEDIATOR_ID, tier: MEDIATOR_TIER, named: false, stance: null });
    // Daemon tier comes from the identity registry's proof method.
    expect(body.positions.find((p) => p.kind === 'daemon')?.tier).toBe('oidc');
  });

  it('fails closed on bad input: subject, parties, deadline, membership, revoked daemons', async () => {
    const mk = (body: unknown) =>
      handleCreateParley(req('/v1/harbors/alice/dock/parleys', { method: 'POST', token: ALICE_TOKEN, body }), env, 'alice', 'dock');
    for (const body of [
      { parties: [{ user: 'bob' }] },                                   // subject missing
      { subject: '', parties: [{ user: 'bob' }] },                      // subject empty
      { subject: 's', parties: [] },                                    // no parties
      { subject: 's' },                                                  // parties missing
      { subject: 's', parties: [{ user: 'bob' }], deadlineHours: 0 },   // deadline too short
      { subject: 's', parties: [{ user: 'bob' }], deadlineHours: 9999 },// deadline too long
      { subject: 's', parties: [{ user: 'mallory' }] },                 // account exists, NOT a member
      { subject: 's', parties: [{ user: 'nobody' }] },                  // no such account
      { subject: 's', parties: [{ daemon: LONER_DAEMON_FP }] },         // daemon not a member
      { subject: 's', parties: [{ daemon: REVOKED_DAEMON_FP }] },       // revoked identity
      { subject: 's', parties: [{ user: 'bob', daemon: DAEMON_FP }] },  // ambiguous spec
      { subject: 's', parties: [{ user: 'alice' }] },                   // only the proposer — no counterparty
    ]) {
      const res = await mk(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("the mediator identity is RESERVED: naming 'pd-mediator' as a party is refused", async () => {
    const res = await handleCreateParley(
      req('/v1/harbors/alice/dock/parleys', { method: 'POST', token: ALICE_TOKEN, body: { subject: 's', parties: [{ user: 'pd-mediator' }] } }),
      env, 'alice', 'dock',
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('reserved');
  });
});

// ── List + detail ─────────────────────────────────────────────────────────────

describe('GET list + detail (member-gated, no oracle)', () => {
  let env: Env;
  let id: string;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedDock(env);
    id = await convene(env);
  });

  it('401 unauthenticated on both — routed through the real worker dispatcher', async () => {
    expect((await worker.fetch(req('/v1/harbors/alice/dock/parleys'), env, {} as ExecutionContext)).status).toBe(401);
    expect((await worker.fetch(req(`/v1/harbors/alice/dock/parleys/${id}`), env, {} as ExecutionContext)).status).toBe(401);
  });

  it('members list and read detail with positions', async () => {
    const list = await worker.fetch(req('/v1/harbors/alice/dock/parleys', { token: CAROL_TOKEN }), env, {} as ExecutionContext);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { parleys: Array<{ id: string; state: string }> }).parleys).toEqual([
      expect.objectContaining({ id, state: 'open' }),
    ]);

    const detail = await worker.fetch(req(`/v1/harbors/alice/dock/parleys/${id}`, { token: BOB_TOKEN }), env, {} as ExecutionContext);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { parley: { id: string }; positions: unknown[] };
    expect(body.parley.id).toBe(id);
    expect(body.positions.length).toBe(3); // alice, bob, mediator seat
  });

  it('non-members and unknown parleys are the same 404 (no oracle); wrong-harbor path leaks nothing', async () => {
    const asMallory = await handleGetParley(req(`/v1/harbors/alice/dock/parleys/${id}`, { token: MALLORY_TOKEN }), env, 'alice', 'dock', id);
    expect(asMallory.status).toBe(404);
    const unknown = await handleGetParley(req('/v1/harbors/alice/dock/parleys/p_nope', { token: BOB_TOKEN }), env, 'alice', 'dock', 'p_nope');
    expect(unknown.status).toBe(404);

    // A second harbor cannot read dock's parley through its own path.
    const created = await handleCreateHarbor(
      req('/v1/harbors', { method: 'POST', token: MALLORY_TOKEN, body: { name: 'cove', pubkey: PUBKEY } }), env,
    );
    expect(created.status).toBe(201);
    const crossPath = await handleGetParley(req(`/v1/harbors/mallory/cove/parleys/${id}`, { token: MALLORY_TOKEN }), env, 'mallory', 'cove', id);
    expect(crossPath.status).toBe(404);
    expect(await crossPath.json()).toEqual(await unknown.json());
  });
});

// ── State machine + immutability ──────────────────────────────────────────────

describe('respond — state machine, gating, immutability', () => {
  let env: Env;
  let id: string;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedDock(env);
    id = await convene(env);
  });

  it('member-but-not-named-party gets 403 NOT_A_PARTY; non-member the 404', async () => {
    const carol = await respond(env, id, CAROL_TOKEN, { stance: 'accept' });
    expect(carol.status).toBe(403);
    expect(((await carol.json()) as { code: string }).code).toBe('NOT_A_PARTY');
    expect((await respond(env, id, MALLORY_TOKEN, { stance: 'accept' })).status).toBe(404);
    expect((await respond(env, id, undefined, { stance: 'accept' })).status).toBe(401);
  });

  it('refuses cross-origin and malformed stances (fail closed)', async () => {
    const cross = await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token: BOB_TOKEN, body: { stance: 'accept' }, origin: 'https://evil.example' }),
      env, 'alice', 'dock', id,
    );
    expect(cross.status).toBe(403);
    for (const body of [{}, { stance: 'maybe' }, { stance: 42 }]) {
      expect((await respond(env, id, BOB_TOKEN, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('stays OPEN until every named party accepts, then flips to AGREED once', async () => {
    const first = await respond(env, id, BOB_TOKEN, { stance: 'accept', position: 'I rebase after alice merges' });
    expect(first.status).toBe(200);
    const afterFirst = (await first.json()) as { parley: { state: string }; signed: { party: string; stance: string; position: string } };
    expect(afterFirst.parley.state).toBe('open'); // alice has not signed yet
    expect(afterFirst.signed).toMatchObject({ party: 'bob', stance: 'accept', position: 'I rebase after alice merges' });

    const second = await worker.fetch(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token: ALICE_TOKEN, body: { stance: 'accept' } }),
      env, {} as ExecutionContext,
    );
    expect(second.status).toBe(200);
    const afterSecond = (await second.json()) as { parley: { state: string; resolvedAt: number | null } };
    expect(afterSecond.parley.state).toBe('agreed');
    expect(afterSecond.parley.resolvedAt).toBe(T0);
  });

  it('the mediator observer seat never blocks agreement and can never sign', async () => {
    await respond(env, id, BOB_TOKEN, { stance: 'accept' });
    const done = await respond(env, id, ALICE_TOKEN, { stance: 'accept' });
    // Agreement reached with the pd-mediator seat still unsigned (is_party=0).
    expect(((await done.json()) as { parley: { state: string } }).parley.state).toBe('agreed');
    const detail = await handleGetParley(req(`/v1/harbors/alice/dock/parleys/${id}`, { token: ALICE_TOKEN }), env, 'alice', 'dock', id);
    const positions = ((await detail.json()) as { positions: Array<{ kind: string; stance: unknown; signedAt: unknown }> }).positions;
    expect(positions.find((p) => p.kind === 'mediator')).toMatchObject({ stance: null, signedAt: null });
  });

  it('IMMUTABLE after agreed: further responses are 409 PARLEY_CLOSED and positions are untouched', async () => {
    await respond(env, id, BOB_TOKEN, { stance: 'accept' });
    await respond(env, id, ALICE_TOKEN, { stance: 'accept' });

    const late = await respond(env, id, BOB_TOKEN, { stance: 'reject', position: 'changed my mind' });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { code: string }).code).toBe('PARLEY_CLOSED');

    const detail = await handleGetParley(req(`/v1/harbors/alice/dock/parleys/${id}`, { token: BOB_TOKEN }), env, 'alice', 'dock', id);
    const body = (await detail.json()) as { parley: { state: string }; positions: Array<{ party: string; stance: string | null }> };
    expect(body.parley.state).toBe('agreed'); // still agreed, nothing rewritten
    expect(body.positions.find((p) => p.party === 'bob')?.stance).toBe('accept');
  });

  it('a signed position is WRITE-ONCE even while the parley is open', async () => {
    expect((await respond(env, id, BOB_TOKEN, { stance: 'accept' })).status).toBe(200);
    const again = await respond(env, id, BOB_TOKEN, { stance: 'reject' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe('ALREADY_SIGNED');
  });

  it('any REJECT lapses the parley immediately (agreement is impossible; no zombie-open state)', async () => {
    const res = await respond(env, id, BOB_TOKEN, { stance: 'reject', position: 'this split is wrong' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parley: { state: string; resolvedAt: number | null } };
    expect(body.parley.state).toBe('lapsed');
    expect(body.parley.resolvedAt).toBe(T0);
    // ...and the artifact is now immutable.
    expect((await respond(env, id, ALICE_TOKEN, { stance: 'accept' })).status).toBe(409);
  });

  it('deadline expiry lapses lazily on read and on respond — never a liveness hole', async () => {
    at(T0 + DEFAULT_PARLEY_DEADLINE_HOURS * 3600 + 1);
    const list = await handleListParleys(req('/v1/harbors/alice/dock/parleys', { token: ALICE_TOKEN }), env, 'alice', 'dock');
    expect(((await list.json()) as { parleys: Array<{ state: string }> }).parleys[0]?.state).toBe('lapsed');

    const late = await respond(env, id, BOB_TOKEN, { stance: 'accept' });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { code: string }).code).toBe('PARLEY_CLOSED');
  });

  it('an accept just before the deadline still counts; expiry only fires past it', async () => {
    at(T0 + DEFAULT_PARLEY_DEADLINE_HOURS * 3600 - 1);
    expect((await respond(env, id, BOB_TOKEN, { stance: 'accept' })).status).toBe(200);
    const done = await respond(env, id, ALICE_TOKEN, { stance: 'accept' });
    expect(((await done.json()) as { parley: { state: string } }).parley.state).toBe('agreed');
  });

  it('a daemon party signs via a vouching member operator; unregistered/revoked/non-party daemons fail closed', async () => {
    const withDaemon = await convene(env, { parties: [{ user: 'bob' }, { daemon: DAEMON_FP }] });

    // Carol is a harbor member but NOT a named party herself — she may still
    // vouch the daemon's seat (X3 presence idiom: operator-plane vouching).
    const daemonSign = await respond(env, withDaemon, CAROL_TOKEN, { daemon: DAEMON_FP, stance: 'accept' });
    expect(daemonSign.status).toBe(200);

    expect((await respond(env, withDaemon, ALICE_TOKEN, { daemon: REVOKED_DAEMON_FP, stance: 'accept' })).status).toBe(400);
    // Registered + unrevoked but not a named party of THIS parley → 403.
    const notParty = await respond(env, withDaemon, ALICE_TOKEN, { daemon: LONER_DAEMON_FP, stance: 'accept' });
    expect(notParty.status).toBe(403);

    // Remaining human parties accept → agreed, daemon signature included.
    await respond(env, withDaemon, BOB_TOKEN, { stance: 'accept' });
    const done = await respond(env, withDaemon, ALICE_TOKEN, { stance: 'accept' });
    expect(((await done.json()) as { parley: { state: string } }).parley.state).toBe('agreed');
  });
});
