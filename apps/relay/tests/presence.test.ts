/**
 * X3 PRESENCE + HELM v1 tests (src/presence.ts; grand-plan §X3 MVP slice).
 *
 * Covers, per the acceptance list:
 *   - PRESENCE TTL: a heartbeat makes a principal online (with identity tier);
 *     past ~90s without a beat they drop off the roster;
 *   - SUCCESSION ON EXPIRY: holder presence expired past grace ⇒ the helm
 *     passes to the next PRESENT successor, recorded as a helm_events row;
 *   - NO SUCCESSOR PRESENT ⇒ vacant + FLAGGED, also recorded — never silent;
 *   - the AUTHZ MATRIX (401 / non-member 404 no-existence-oracle / plain
 *     member 403 on owner-only writes) and fail-closed input validation.
 *
 * Idiom: stateful fake D1 keyed on SQL substrings (like harbors.test.ts),
 * pdu_ bearer auth through the REAL resolveUserFromRequest path, and the REAL
 * HarborChannel Durable Object running against a Map-backed fake
 * DurableObjectState — presence reads/writes exercise the actual DO code.
 * Time is driven with vi.setSystemTime. Routing is pinned through
 * worker.fetch for each route at least once.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import {
  handlePresenceBeat,
  handleGetPresence,
  handleSetHelm,
  handleGetHelm,
  PRESENCE_TTL_SECONDS,
  HELM_GRACE_SECONDS,
} from '../src/presence.js';
import { HarborChannel } from '../src/harbor-channel.js';
import { handleCreateHarbor, handleAddHarborMember } from '../src/harbors.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';

// ── Principals ────────────────────────────────────────────────────────────────

const ALICE_TOKEN = `pdu_${'a'.repeat(64)}`; // creator/owner
const BOB_TOKEN = `pdu_${'b'.repeat(64)}`;   // plain member
const CAROL_TOKEN = `pdu_${'c'.repeat(64)}`; // member (added in seed)
const MALLORY_TOKEN = `pdu_${'d'.repeat(64)}`; // NON-member

const DAEMON_FP = 'ab'.repeat(32);          // registered, unrevoked, harbor member
const LONER_DAEMON_FP = 'ef'.repeat(32);    // registered, unrevoked, NOT a member
const REVOKED_DAEMON_FP = 'cd'.repeat(32);  // registered but revoked

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

interface FakeHelm {
  harbor_id: string;
  holder_kind: 'user' | 'daemon' | null;
  holder_id: string | null;
  holder_label: string | null;
  succession_json: string;
  state: 'held' | 'vacant';
  vacant_flagged: number;
  seq: number;
  updated_at: number;
  updated_by: string;
}

interface FakeHelmEvent {
  id: string;
  harbor_id: string;
  at: number;
  kind: string;
  detail: string;
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
    { daemon_fingerprint: LONER_DAEMON_FP, pub_key: 'dd'.repeat(32), proof_method: 'acme', proof_metadata: '{}', expires_at: null, revoked: 0, revoked_reason: null },
    { daemon_fingerprint: REVOKED_DAEMON_FP, pub_key: 'ee'.repeat(32), proof_method: 'oidc', proof_metadata: '{}', expires_at: null, revoked: 1, revoked_reason: 'compromised' },
  ];
  const harbors: FakeHarbor[] = [];
  const memberships: FakeMembership[] = [];
  const helms: FakeHelm[] = [];
  const helmEvents: FakeHelmEvent[] = [];
  const ok = { success: true, meta: { changes: 1 } };

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
        if (sql.includes('FROM harbor_helms')) {
          return (helms.find((h) => h.harbor_id === args[0]) ?? null) as T | null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('FROM helm_events')) {
          const rows = helmEvents
            .filter((e) => e.harbor_id === args[0])
            .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
            .slice(0, args[1] as number);
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
        if (sql.includes('INSERT INTO harbor_helms')) {
          // setHelm upsert: VALUES (?, ?, ?, ?, ?, 'held', 0, ?, ?, ?)
          const [harbor_id, holder_kind, holder_id, holder_label, succession_json, seq, updated_at, updated_by] = args as [
            string, 'user' | 'daemon', string, string, string, number, number, string,
          ];
          const next: FakeHelm = {
            harbor_id, holder_kind, holder_id, holder_label, succession_json,
            state: 'held', vacant_flagged: 0, seq, updated_at, updated_by,
          };
          const i = helms.findIndex((h) => h.harbor_id === harbor_id);
          if (i >= 0) helms[i] = next;
          else helms.push(next);
          return ok;
        }
        if (sql.includes('UPDATE harbor_helms SET')) {
          // applyHelmTransition: CAS on (harbor_id, seq); seq = seq + 1 in SQL.
          const [holder_kind, holder_id, holder_label, succession_json, state, vacant_flagged, updated_at, harbor_id, expectedSeq] = args as [
            'user' | 'daemon' | null, string | null, string | null, string, 'held' | 'vacant', number, number, string, number,
          ];
          const h = helms.find((x) => x.harbor_id === harbor_id && x.seq === expectedSeq);
          if (!h) return { success: true, meta: { changes: 0 } };
          h.holder_kind = holder_kind;
          h.holder_id = holder_id;
          h.holder_label = holder_label;
          h.succession_json = succession_json;
          h.state = state;
          h.vacant_flagged = vacant_flagged;
          h.seq = expectedSeq + 1;
          h.updated_at = updated_at;
          h.updated_by = 'relay:dead-man';
          return ok;
        }
        if (sql.includes('INSERT INTO helm_events')) {
          const [id, harbor_id, at, kind, detail] = args as [string, string, number, string, string];
          helmEvents.push({ id, harbor_id, at, kind, detail });
          return ok;
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
  return { db: db as unknown as D1Database, helms, helmEvents };
}

// ── Real HarborChannel DO on a Map-backed fake DurableObjectState ─────────────

function makeFakeDoNamespace(env: () => Env): DurableObjectNamespace {
  const instances = new Map<string, HarborChannel>();
  function instanceFor(key: string): HarborChannel {
    let inst = instances.get(key);
    if (!inst) {
      const map = new Map<string, unknown>();
      let alarm: number | null = null;
      const storage = {
        async get(k: string) { return map.get(k); },
        async put(k: string, v: unknown) { map.set(k, v); },
        async delete(keys: string | string[]) {
          const arr = Array.isArray(keys) ? keys : [keys];
          let n = 0;
          for (const k of arr) if (map.delete(k)) n++;
          return n;
        },
        async list(opts?: { prefix?: string }) {
          const out = new Map<string, unknown>();
          for (const [k, v] of map) {
            if (!opts?.prefix || k.startsWith(opts.prefix)) out.set(k, v);
          }
          return out;
        },
        async getAlarm() { return alarm; },
        async setAlarm(at: number) { alarm = at; },
      };
      const state = { storage } as unknown as DurableObjectState;
      inst = new HarborChannel(state, env());
      instances.set(key, inst);
    }
    return inst;
  }
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: (id: DurableObjectId) => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        instanceFor(String(id)).fetch(new Request(input as string | URL, init as RequestInit)),
    }),
  } as unknown as DurableObjectNamespace;
}

function makeEnv(db: D1Database): Env {
  const env = {
    DB: db,
    KV: { get: async () => null, put: async () => {}, delete: async () => {} } as unknown as KVNamespace,
    PUBLIC_BASE_URL: BASE,
    RELAY_VERSION: '0.1.0-test',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
  (env as { HARBOR_CHANNEL: DurableObjectNamespace }).HARBOR_CHANNEL = makeFakeDoNamespace(() => env);
  return env;
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

/** alice's harbor 'dock' with members bob, carol, and DAEMON_FP. */
async function seedDock(env: Env): Promise<void> {
  const created = await handleCreateHarbor(req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: PUBKEY } }), env);
  expect(created.status).toBe(201);
  for (const body of [{ user: 'bob' }, { user: 'carol' }, { daemon: DAEMON_FP }]) {
    const added = await handleAddHarborMember(
      req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body }),
      env, 'alice', 'dock',
    );
    expect(added.status).toBe(201);
  }
}

// ── Time control ──────────────────────────────────────────────────────────────

const T0 = 1_754_000_000; // unix seconds
const at = (sec: number) => vi.setSystemTime(new Date(sec * 1000));

beforeEach(() => {
  vi.useFakeTimers();
  at(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const beat = (env: Env, token: string, body?: unknown) =>
  handlePresenceBeat(
    req('/v1/harbors/alice/dock/presence', { method: 'POST', token, ...(body !== undefined ? { body } : {}) }),
    env, 'alice', 'dock',
  );

const whoIsOnline = async (env: Env, token = ALICE_TOKEN) => {
  const res = await handleGetPresence(req('/v1/harbors/alice/dock/presence', { token }), env, 'alice', 'dock');
  expect(res.status).toBe(200);
  return (await res.json()) as { online: Array<{ kind: string; member: string; tier: string; lastSeenAt: number }>; ttlSeconds: number };
};

const putHelm = (env: Env, token: string, body: unknown) =>
  handleSetHelm(req('/v1/harbors/alice/dock/helm', { method: 'PUT', token, body }), env, 'alice', 'dock');

const getHelmBody = async (env: Env, token = ALICE_TOKEN) => {
  const res = await handleGetHelm(req('/v1/harbors/alice/dock/helm', { token }), env, 'alice', 'dock');
  expect(res.status).toBe(200);
  return (await res.json()) as {
    helm: {
      holder: { kind: string; member: string } | null;
      succession: Array<{ kind: string; member: string }>;
      state: string;
      vacantFlagged: boolean;
      seq: number;
      updatedAt: number;
    } | null;
    events: Array<{ at: number; kind: string; detail: Record<string, unknown> }>;
  };
};

// ── Presence tests ────────────────────────────────────────────────────────────

describe('presence heartbeat + roster (X3 stage 1)', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedDock(env);
  });

  it('401 unauthenticated — routed through the real worker dispatcher', async () => {
    const post = await worker.fetch(req('/v1/harbors/alice/dock/presence', { method: 'POST' }), env, {} as ExecutionContext);
    expect(post.status).toBe(401);
    const get = await worker.fetch(req('/v1/harbors/alice/dock/presence'), env, {} as ExecutionContext);
    expect(get.status).toBe(401);
  });

  it('a NON-MEMBER gets the same 404 as a nonexistent harbor (no existence oracle)', async () => {
    const asMallory = await handleGetPresence(req('/v1/harbors/alice/dock/presence', { token: MALLORY_TOKEN }), env, 'alice', 'dock');
    const noSuch = await handleGetPresence(req('/v1/harbors/alice/ghost/presence', { token: MALLORY_TOKEN }), env, 'alice', 'ghost');
    expect(asMallory.status).toBe(404);
    expect(noSuch.status).toBe(404);
    expect(await asMallory.json()).toEqual(await noSuch.json());
    expect((await beat(env, MALLORY_TOKEN)).status).toBe(404);
  });

  it('refuses a cross-origin browser beat (CSRF guard)', async () => {
    const res = await handlePresenceBeat(
      req('/v1/harbors/alice/dock/presence', { method: 'POST', token: ALICE_TOKEN, origin: 'https://evil.example' }),
      env, 'alice', 'dock',
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('CROSS_ORIGIN');
  });

  it('humans and vouched daemons appear online with their identity tier — via the worker route', async () => {
    const human = await worker.fetch(
      req('/v1/harbors/alice/dock/presence', { method: 'POST', token: ALICE_TOKEN }),
      env, {} as ExecutionContext,
    );
    expect(human.status).toBe(200);
    expect(((await human.json()) as { presence: { tier: string } }).presence.tier).toBe('human');

    at(T0 + 5);
    expect((await beat(env, BOB_TOKEN, { daemon: DAEMON_FP })).status).toBe(200);

    const list = await worker.fetch(req('/v1/harbors/alice/dock/presence', { token: BOB_TOKEN }), env, {} as ExecutionContext);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { online: Array<Record<string, unknown>>; ttlSeconds: number };
    expect(body.ttlSeconds).toBe(PRESENCE_TTL_SECONDS);
    expect(body.online).toEqual([
      { kind: 'daemon', member: DAEMON_FP, tier: 'oidc', lastSeenAt: T0 + 5 },
      { kind: 'user', member: 'alice', tier: 'human', lastSeenAt: T0 },
    ]);
  });

  it('PRESENCE TTL: a principal drops off the roster once their beat is older than 90s', async () => {
    expect((await beat(env, ALICE_TOKEN)).status).toBe(200);

    at(T0 + PRESENCE_TTL_SECONDS); // exactly at the TTL boundary: still online
    expect((await whoIsOnline(env)).online).toHaveLength(1);

    at(T0 + PRESENCE_TTL_SECONDS + 1); // one second past: gone
    expect((await whoIsOnline(env)).online).toEqual([]);

    // A fresh beat brings them straight back.
    expect((await beat(env, ALICE_TOKEN)).status).toBe(200);
    expect((await whoIsOnline(env)).online).toHaveLength(1);
  });

  it('daemon beats fail closed: revoked identity, unregistered fp, non-member daemon', async () => {
    const revoked = await beat(env, ALICE_TOKEN, { daemon: REVOKED_DAEMON_FP });
    expect(revoked.status).toBe(400);
    expect(((await revoked.json()) as { code: string }).code).toBe('UNKNOWN_DAEMON');

    expect((await beat(env, ALICE_TOKEN, { daemon: '99'.repeat(32) })).status).toBe(400);

    const nonMember = await beat(env, ALICE_TOKEN, { daemon: LONER_DAEMON_FP });
    expect(nonMember.status).toBe(400);
    expect(((await nonMember.json()) as { code: string }).code).toBe('NOT_A_MEMBER');

    expect((await whoIsOnline(env)).online).toEqual([]); // nothing leaked onto the roster
  });
});

// ── Helm tests ────────────────────────────────────────────────────────────────

describe('PUT /v1/harbors/:ns/:name/helm — owner-set authority record', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedDock(env);
  });

  it('authz matrix: 401 unauthenticated / 404 non-member / 403 plain member / 200 owner', async () => {
    const body = { holder: { user: 'alice' } };
    const unauth = await worker.fetch(req('/v1/harbors/alice/dock/helm', { method: 'PUT', body }), env, {} as ExecutionContext);
    expect(unauth.status).toBe(401);
    expect((await putHelm(env, MALLORY_TOKEN, body)).status).toBe(404);
    expect((await putHelm(env, BOB_TOKEN, body)).status).toBe(403);

    const owner = await worker.fetch(
      req('/v1/harbors/alice/dock/helm', { method: 'PUT', token: ALICE_TOKEN, body: { holder: { user: 'alice' }, succession: [{ user: 'bob' }] } }),
      env, {} as ExecutionContext,
    );
    expect(owner.status).toBe(200);
    const helm = ((await owner.json()) as { helm: Record<string, unknown> }).helm;
    expect(helm).toMatchObject({
      holder: { kind: 'user', member: 'alice' },
      succession: [{ kind: 'user', member: 'bob' }],
      state: 'held',
      vacantFlagged: false,
      seq: 1,
    });
  });

  it('holder and every successor must be harbor members; specs fail closed (400)', async () => {
    for (const [body, code] of [
      [{ holder: { user: 'mallory' } }, 'BAD_HOLDER'],                              // not a member
      [{ holder: { user: 'nobody' } }, 'BAD_HOLDER'],                               // no such account
      [{ holder: {} }, 'BAD_HOLDER'],                                               // names neither
      [{ holder: { user: 'alice', daemon: DAEMON_FP } }, 'BAD_HOLDER'],             // names both
      [{}, 'BAD_HOLDER'],                                                           // holder missing
      [{ holder: { user: 'alice' }, succession: [{ user: 'mallory' }] }, 'BAD_SUCCESSION'],
      [{ holder: { user: 'alice' }, succession: [{ daemon: LONER_DAEMON_FP }] }, 'BAD_SUCCESSION'], // non-member daemon
      [{ holder: { user: 'alice' }, succession: [{ user: 'alice' }] }, 'BAD_SUCCESSION'],           // repeats holder
      [{ holder: { user: 'alice' }, succession: [{ user: 'bob' }, { user: 'bob' }] }, 'BAD_SUCCESSION'], // repeats successor
      [{ holder: { user: 'alice' }, succession: 'bob' }, 'BAD_SUCCESSION'],         // not an array
    ] as Array<[unknown, string]>) {
      const res = await putHelm(env, ALICE_TOKEN, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { code: string }).code, JSON.stringify(body)).toBe(code);
    }
  });

  it('an owner set is recorded as a helm_set event — never silent', async () => {
    expect((await putHelm(env, ALICE_TOKEN, { holder: { user: 'alice' }, succession: [{ daemon: DAEMON_FP }] })).status).toBe(200);
    const { events } = await getHelmBody(env, BOB_TOKEN); // members can read the audit trail
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'helm_set',
        detail: expect.objectContaining({
          by: 'alice',
          holder: { kind: 'user', member: 'alice' },
          succession: [{ kind: 'daemon', member: DAEMON_FP }],
        }),
      }),
    ]);
  });
});

describe('GET helm — dead-man succession on read (D5/D6: no ballots)', () => {
  let env: Env;
  const EXPIRY = PRESENCE_TTL_SECONDS + HELM_GRACE_SECONDS; // silent past this ⇒ pass

  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedDock(env);
  });

  it('helm: null when never set (distinct from vacant); routed through the worker', async () => {
    const res = await worker.fetch(req('/v1/harbors/alice/dock/helm', { token: BOB_TOKEN }), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { helm: unknown; events: unknown[] };
    expect(body.helm).toBeNull();
    expect(body.events).toEqual([]);
  });

  it('a held helm with a live (or within-grace) holder does not move', async () => {
    await beat(env, ALICE_TOKEN);
    expect((await putHelm(env, ALICE_TOKEN, { holder: { user: 'alice' }, succession: [{ user: 'bob' }] })).status).toBe(200);

    at(T0 + EXPIRY); // exactly at the boundary: still held by alice
    await beat(env, BOB_TOKEN); // bob IS present — but no pass may fire yet
    const { helm } = await getHelmBody(env);
    expect(helm).toMatchObject({ holder: { kind: 'user', member: 'alice' }, state: 'held', seq: 1 });
  });

  it('SUCCESSION ON EXPIRY: holder silent past grace ⇒ next PRESENT successor takes the helm, audited', async () => {
    await beat(env, ALICE_TOKEN);
    expect((await putHelm(env, ALICE_TOKEN, { holder: { user: 'alice' }, succession: [{ user: 'bob' }, { user: 'carol' }] })).status).toBe(200);

    at(T0 + EXPIRY + 1);
    await beat(env, BOB_TOKEN); // bob is present at read time
    const { helm, events } = await getHelmBody(env, CAROL_TOKEN);
    expect(helm).toMatchObject({
      holder: { kind: 'user', member: 'bob' },
      succession: [{ kind: 'user', member: 'carol' }], // bob left the list; order preserved
      state: 'held',
      vacantFlagged: false,
      seq: 2,
      updatedAt: T0 + EXPIRY + 1,
    });
    expect(events[0]).toMatchObject({
      kind: 'dead_man_pass',
      at: T0 + EXPIRY + 1,
      detail: {
        from: { kind: 'user', member: 'alice' },
        to: { kind: 'user', member: 'bob' },
        holderLastSeenAt: T0,
      },
    });
    expect(events[1]).toMatchObject({ kind: 'helm_set' });

    // The pass is durable: a later read while bob stays live changes nothing.
    at(T0 + EXPIRY + 30);
    await beat(env, BOB_TOKEN);
    const again = await getHelmBody(env);
    expect(again.helm).toMatchObject({ holder: { kind: 'user', member: 'bob' }, seq: 2 });
    expect(again.events).toHaveLength(2);
  });

  it('skips ABSENT successors: the first PRESENT one takes the helm', async () => {
    expect((await putHelm(env, ALICE_TOKEN, { holder: { user: 'alice' }, succession: [{ user: 'bob' }, { user: 'carol' }] })).status).toBe(200);

    at(T0 + EXPIRY + 1);
    await beat(env, CAROL_TOKEN); // only carol is present; bob never beat
    const { helm } = await getHelmBody(env);
    expect(helm).toMatchObject({
      holder: { kind: 'user', member: 'carol' },
      succession: [{ kind: 'user', member: 'bob' }], // bob keeps his place in line
      state: 'held',
    });
  });

  it('NO SUCCESSOR PRESENT ⇒ vacant + FLAGGED, recorded — and stays put until an owner re-sets', async () => {
    expect((await putHelm(env, ALICE_TOKEN, { holder: { user: 'alice' }, succession: [{ user: 'bob' }] })).status).toBe(200);

    at(T0 + EXPIRY + 1); // nobody is present at all
    const { helm, events } = await getHelmBody(env);
    expect(helm).toMatchObject({
      holder: null,
      succession: [{ kind: 'user', member: 'bob' }], // list preserved for the owner to inspect
      state: 'vacant',
      vacantFlagged: true,
      seq: 2,
    });
    expect(events[0]).toMatchObject({
      kind: 'dead_man_vacant',
      detail: expect.objectContaining({ from: { kind: 'user', member: 'alice' } }),
    });

    // Vacant is terminal for the dead-man rule: a successor coming online
    // later does NOT auto-take a vacant helm — recovery is an owner PUT.
    at(T0 + EXPIRY + 60);
    await beat(env, BOB_TOKEN);
    const later = await getHelmBody(env);
    expect(later.helm).toMatchObject({ state: 'vacant', vacantFlagged: true, seq: 2 });
    expect(later.events).toHaveLength(2); // no new events — nothing changed silently either

    const reset = await putHelm(env, ALICE_TOKEN, { holder: { user: 'bob' } });
    expect(reset.status).toBe(200);
    const fixed = await getHelmBody(env);
    expect(fixed.helm).toMatchObject({ holder: { kind: 'user', member: 'bob' }, state: 'held', vacantFlagged: false, seq: 3 });
  });

  it('a freshly set helm gets a full window even if the holder NEVER beat', async () => {
    expect((await putHelm(env, ALICE_TOKEN, { holder: { user: 'alice' }, succession: [{ user: 'bob' }] })).status).toBe(200);

    at(T0 + EXPIRY); // within the window measured from updated_at
    await beat(env, BOB_TOKEN);
    expect((await getHelmBody(env)).helm).toMatchObject({ holder: { kind: 'user', member: 'alice' }, state: 'held' });

    at(T0 + EXPIRY + 1); // window over, holder never showed ⇒ pass
    await beat(env, BOB_TOKEN);
    expect((await getHelmBody(env)).helm).toMatchObject({ holder: { kind: 'user', member: 'bob' }, state: 'held' });
  });

  it('a daemon successor can take the helm, carrying its identity tier on the roster', async () => {
    expect((await putHelm(env, ALICE_TOKEN, { holder: { user: 'alice' }, succession: [{ daemon: DAEMON_FP }] })).status).toBe(200);

    at(T0 + EXPIRY + 1);
    await beat(env, BOB_TOKEN, { daemon: DAEMON_FP });
    const { helm } = await getHelmBody(env);
    expect(helm).toMatchObject({ holder: { kind: 'daemon', member: DAEMON_FP }, state: 'held' });
  });
});
