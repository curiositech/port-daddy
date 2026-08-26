/**
 * WS-B slice B3 (relay half) tests — src/device-keys.ts device X25519-key
 * registry + wrap-relay routes.
 *
 * Covers, per the implementation spec's acceptance list:
 *   - HAPPY PATH for each of the five routes;
 *   - CROSS-HARBOR / CROSS-ACCOUNT READ REJECTION: a harbor member cannot
 *     fetch another member's device's key wraps within the SAME harbor
 *     (device-ownership gate), and cannot resolve a device belonging to an
 *     account outside a shared harbor via the peer-pubkey lookup (member
 *     gate + owner-role recheck, collapsed into one "no such device" 404 —
 *     no existence oracle);
 *   - MALFORMED REQUEST BODIES: bad deviceId/pubkey shapes, bad epoch, empty
 *     grant/keyPurpose/keyId, non-Base64URL enc/ciphertext;
 *   - THE RELAY NEVER SEES PLAINTEXT: a REAL HPKE round trip through
 *     lib/pd-vault-ts.ts proves the bytes the relay stores and returns are
 *     genuine ciphertext (garbage without the recipient's private key,
 *     recoverable only with it) — plus a static-import check that
 *     src/device-keys.ts and the WS-B additions to src/db.ts never import
 *     any vault primitive capable of producing or consuming plaintext.
 *
 * Idiom: stateful fake D1 keyed on SQL substrings (like harbors.test.ts /
 * harbor-invites.test.ts), authenticating via pdu_ bearer tokens through the
 * REAL resolveUserFromRequest path. Routing is pinned through worker.fetch
 * for each route at least once.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import worker from '../src/index.js';
import {
  handleRegisterDeviceKey,
  handleListDeviceKeys,
  handleGetHarborDeviceKey,
  handlePostHarborWrap,
  handleGetHarborWraps,
} from '../src/device-keys.js';
import { handleCreateHarbor, handleAddHarborMember } from '../src/harbors.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';
import {
  wrapChannelKeyForDevice,
  unwrapChannelKeyForDevice,
  CHANNEL_KEY_LEN,
  type KeyWrapAad,
} from '../../../lib/pd-vault-ts.js';

const BASE = 'https://relay.example';
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Principals ────────────────────────────────────────────────────────────────

const ALICE_TOKEN = `pdu_${'a'.repeat(64)}`; // owner of alice/dock
const BOB_TOKEN = `pdu_${'b'.repeat(64)}`;   // plain member of alice/dock
const CAROL_TOKEN = `pdu_${'c'.repeat(64)}`; // owner of carol/pier — NOT a dock member
const DAVE_TOKEN = `pdu_${'d'.repeat(64)}`;  // never joins any harbor

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

interface FakeDeviceKey {
  user_id: string;
  device_id: string;
  x25519_pubkey: string;
  created_at: number;
  updated_at: number;
}

interface FakeWrap {
  harbor_id: string;
  authority_epoch: number;
  recipient_device_id: string;
  key_purpose: string;
  key_id: string;
  grant: string;
  recipient_user_id: string;
  enc: string;
  ciphertext: string;
  wrapped_by: string;
  created_at: number;
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
  const deviceKeys: FakeDeviceKey[] = [];
  const wraps: FakeWrap[] = [];
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
        // upsertDeviceKey's existence probe (most specific — check before the
        // general "SELECT * FROM device_keys WHERE user_id" pattern below).
        if (sql.includes('SELECT 1 FROM device_keys WHERE user_id = ? AND device_id = ?')) {
          const d = deviceKeys.find((x) => x.user_id === args[0] && x.device_id === args[1]);
          return (d ? ({ 1: 1 } as unknown) : null) as T | null;
        }
        // getDeviceKey
        if (sql.includes('SELECT * FROM device_keys WHERE user_id = ? AND device_id = ?')) {
          const d = deviceKeys.find((x) => x.user_id === args[0] && x.device_id === args[1]);
          return (d ? { ...d } : null) as T | null;
        }
        // getDeviceKeyOwner
        if (sql.includes('SELECT user_id, x25519_pubkey, updated_at FROM device_keys WHERE device_id = ?')) {
          const d = deviceKeys.find((x) => x.device_id === args[0]);
          return (d ? { user_id: d.user_id, x25519_pubkey: d.x25519_pubkey, updated_at: d.updated_at } : null) as T | null;
        }
        // insertHarborKeyWrap's conflict-disambiguation re-read
        if (sql.includes('SELECT enc, ciphertext FROM harbor_key_wraps')) {
          const [harbor_id, authority_epoch, recipient_device_id, key_purpose, key_id] = args as [
            string, number, string, string, string,
          ];
          const w = wraps.find(
            (x) =>
              x.harbor_id === harbor_id &&
              x.authority_epoch === authority_epoch &&
              x.recipient_device_id === recipient_device_id &&
              x.key_purpose === key_purpose &&
              x.key_id === key_id,
          );
          return (w ? { enc: w.enc, ciphertext: w.ciphertext } : null) as T | null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        // listDeviceKeys
        if (sql.includes('FROM device_keys WHERE user_id = ? ORDER BY updated_at DESC')) {
          const rows = deviceKeys
            .filter((d) => d.user_id === args[0])
            .sort((a, b) => b.updated_at - a.updated_at)
            .map((d) => ({ ...d }));
          return { results: rows as T[] };
        }
        // listHarborKeyWraps
        if (sql.includes('FROM harbor_key_wraps WHERE harbor_id = ? AND recipient_device_id = ?')) {
          const hasSince = sql.includes('authority_epoch >= ?');
          const [harbor_id, recipient_device_id, sinceEpoch] = args as [string, string, number | undefined];
          const rows = wraps
            .filter(
              (w) =>
                w.harbor_id === harbor_id &&
                w.recipient_device_id === recipient_device_id &&
                (!hasSince || w.authority_epoch >= (sinceEpoch as number)),
            )
            .sort((a, b) => a.authority_epoch - b.authority_epoch)
            .map((w) => ({ ...w }));
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
        if (sql.includes('INSERT INTO device_keys')) {
          const [user_id, device_id, x25519_pubkey, created_at, updated_at] = args as [
            string, string, string, number, number,
          ];
          const existing = deviceKeys.find((d) => d.user_id === user_id && d.device_id === device_id);
          if (existing) {
            existing.x25519_pubkey = x25519_pubkey;
            existing.updated_at = updated_at;
          } else {
            // device_id is globally unique (device_keys_device_id_idx), not just
            // scoped to (user_id, device_id) — model that here too, or this fake
            // can never catch the cross-account collision the real index does.
            if (deviceKeys.some((d) => d.device_id === device_id && d.user_id !== user_id)) {
              throw new Error('UNIQUE constraint failed: device_keys.device_id');
            }
            deviceKeys.push({ user_id, device_id, x25519_pubkey, created_at, updated_at });
          }
          return ok(1);
        }
        if (sql.includes('INSERT INTO harbor_key_wraps')) {
          const [
            harbor_id, authority_epoch, recipient_device_id, key_purpose, key_id, grant,
            recipient_user_id, enc, ciphertext, wrapped_by, created_at,
          ] = args as [string, number, string, string, string, string, string, string, string, string, number];
          if (
            wraps.some(
              (w) =>
                w.harbor_id === harbor_id &&
                w.authority_epoch === authority_epoch &&
                w.recipient_device_id === recipient_device_id &&
                w.key_purpose === key_purpose &&
                w.key_id === key_id,
            )
          ) {
            throw new Error('UNIQUE constraint failed: harbor_key_wraps.harbor_id, harbor_key_wraps.authority_epoch, harbor_key_wraps.recipient_device_id, harbor_key_wraps.key_purpose, harbor_key_wraps.key_id');
          }
          wraps.push({
            harbor_id, authority_epoch, recipient_device_id, key_purpose, key_id, grant,
            recipient_user_id, enc, ciphertext, wrapped_by, created_at,
          });
          return ok(1);
        }
        return ok(1);
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
  return { db: db as unknown as D1Database, harbors, memberships, deviceKeys, wraps };
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

const HARBOR_PUBKEY = '1234abcd'.repeat(8); // 64 hex chars

/** alice/dock (alice owner, bob member) + carol/pier (carol owner only, unconnected). */
async function seedHarbors(env: Env): Promise<void> {
  expect((await handleCreateHarbor(req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: HARBOR_PUBKEY } }), env)).status).toBe(201);
  expect((await handleAddHarborMember(req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'bob' } }), env, 'alice', 'dock')).status).toBe(201);
  expect((await handleCreateHarbor(req('/v1/harbors', { method: 'POST', token: CAROL_TOKEN, body: { name: 'pier', pubkey: HARBOR_PUBKEY } }), env)).status).toBe(201);
}

/** Register a device for the given token, returning its (fake, format-valid) pubkey. */
async function registerDevice(env: Env, token: string, deviceId: string, pubkey: string): Promise<void> {
  const res = await handleRegisterDeviceKey(
    req('/v1/devices/keys', { method: 'POST', token, body: { deviceId, pubkey } }),
    env,
  );
  expect(res.status, `register ${deviceId}`).toBeLessThan(300);
}

const PK_ALICE = 'aa'.repeat(32);
const PK_BOB = 'bb'.repeat(32);
const PK_CAROL = 'cc'.repeat(32);
const PK_DAVE = 'dd'.repeat(32);

// ── POST /v1/devices/keys ───────────────────────────────────────────────────

describe('POST /v1/devices/keys — register/rotate my device', () => {
  let env: Env;
  beforeEach(() => {
    env = makeEnv(makeDb().db);
  });

  it('401 unauthenticated — routed through the real worker dispatcher', async () => {
    const res = await worker.fetch(
      req('/v1/devices/keys', { method: 'POST', body: { deviceId: 'd1', pubkey: PK_ALICE } }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('403 cross-origin (CSRF guard)', async () => {
    const res = await handleRegisterDeviceKey(
      req('/v1/devices/keys', { method: 'POST', token: ALICE_TOKEN, body: { deviceId: 'd1', pubkey: PK_ALICE }, origin: 'https://evil.example' }),
      env,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('CROSS_ORIGIN');
  });

  it('registers (201) then rotates (200) the same device — malformed bodies rejected (400)', async () => {
    const created = await handleRegisterDeviceKey(req('/v1/devices/keys', { method: 'POST', token: ALICE_TOKEN, body: { deviceId: 'alice-mac', pubkey: PK_ALICE } }), env);
    expect(created.status).toBe(201);

    const rotatedKey = 'ab'.repeat(32);
    const rotated = await handleRegisterDeviceKey(req('/v1/devices/keys', { method: 'POST', token: ALICE_TOKEN, body: { deviceId: 'alice-mac', pubkey: rotatedKey } }), env);
    expect(rotated.status).toBe(200);

    const list = (await (await handleListDeviceKeys(req('/v1/devices/keys', { token: ALICE_TOKEN }), env)).json()) as {
      devices: Array<{ deviceId: string; pubkey: string }>;
    };
    expect(list.devices).toEqual([{ deviceId: 'alice-mac', pubkey: rotatedKey, updatedAt: expect.any(Number) }]);

    for (const body of [
      {},                                              // both missing
      { deviceId: 'd1' },                               // pubkey missing
      { pubkey: PK_ALICE },                              // deviceId missing
      { deviceId: '', pubkey: PK_ALICE },                // empty deviceId
      { deviceId: 'has space', pubkey: PK_ALICE },       // bad chars
      { deviceId: 'x'.repeat(129), pubkey: PK_ALICE },   // too long
      { deviceId: 'd1', pubkey: 'zz'.repeat(32) },       // not hex
      { deviceId: 'd1', pubkey: 'ab'.repeat(16) },       // wrong length
      { deviceId: 'd1', pubkey: 42 },                    // wrong type
    ]) {
      const res = await handleRegisterDeviceKey(req('/v1/devices/keys', { method: 'POST', token: ALICE_TOKEN, body }), env);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    const badJson = await handleRegisterDeviceKey(
      new Request(`${BASE}/v1/devices/keys`, { method: 'POST', headers: { Authorization: `Bearer ${ALICE_TOKEN}`, 'Content-Type': 'application/json' }, body: 'not json' }),
      env,
    );
    expect(badJson.status).toBe(400);
  });

  it('409 when deviceId is already claimed by a DIFFERENT account — not a 500', async () => {
    // deviceId is globally unique (device_keys_device_id_idx), not just scoped
    // to (user_id, device_id) — a second account choosing the same caller-picked
    // id is a routine collision, not a theoretical one, and must fail closed
    // with a controlled 409 rather than an unhandled constraint violation.
    const alice = await handleRegisterDeviceKey(
      req('/v1/devices/keys', { method: 'POST', token: ALICE_TOKEN, body: { deviceId: 'shared-name', pubkey: PK_ALICE } }),
      env,
    );
    expect(alice.status).toBe(201);

    const bob = await handleRegisterDeviceKey(
      req('/v1/devices/keys', { method: 'POST', token: BOB_TOKEN, body: { deviceId: 'shared-name', pubkey: PK_BOB } }),
      env,
    );
    expect(bob.status).toBe(409);
    expect(((await bob.json()) as { code: string }).code).toBe('CONFLICT');

    // Alice's own registration is untouched by Bob's rejected attempt.
    const list = (await (await handleListDeviceKeys(req('/v1/devices/keys', { token: ALICE_TOKEN }), env)).json()) as {
      devices: Array<{ deviceId: string; pubkey: string }>;
    };
    expect(list.devices).toEqual([{ deviceId: 'shared-name', pubkey: PK_ALICE, updatedAt: expect.any(Number) }]);

    // Alice can still re-register (rotate) her own device under that id.
    const aliceRotate = await handleRegisterDeviceKey(
      req('/v1/devices/keys', { method: 'POST', token: ALICE_TOKEN, body: { deviceId: 'shared-name', pubkey: PK_ALICE } }),
      env,
    );
    expect(aliceRotate.status).toBe(200);
  });
});

// ── GET /v1/devices/keys ─────────────────────────────────────────────────────

describe('GET /v1/devices/keys — my own devices only', () => {
  it('401 unauthenticated; each account sees only its own devices', async () => {
    const env = makeEnv(makeDb().db);
    const unauth = await worker.fetch(req('/v1/devices/keys'), env, {} as ExecutionContext);
    expect(unauth.status).toBe(401);

    await registerDevice(env, ALICE_TOKEN, 'alice-mac', PK_ALICE);
    await registerDevice(env, BOB_TOKEN, 'bob-phone', PK_BOB);

    const aliceList = (await (await handleListDeviceKeys(req('/v1/devices/keys', { token: ALICE_TOKEN }), env)).json()) as { devices: unknown[] };
    expect(aliceList.devices).toEqual([expect.objectContaining({ deviceId: 'alice-mac' })]);

    const bobList = (await (await handleListDeviceKeys(req('/v1/devices/keys', { token: BOB_TOKEN }), env)).json()) as { devices: unknown[] };
    expect(bobList.devices).toEqual([expect.objectContaining({ deviceId: 'bob-phone' })]);
  });
});

// ── GET /v1/harbors/:ns/:name/devices/:deviceId/key ─────────────────────────

describe('GET /v1/harbors/:ns/:name/devices/:deviceId/key — a peer device pubkey', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedHarbors(env);
    await registerDevice(env, ALICE_TOKEN, 'alice-mac', PK_ALICE);
    await registerDevice(env, BOB_TOKEN, 'bob-phone', PK_BOB);
    await registerDevice(env, CAROL_TOKEN, 'carol-phone', PK_CAROL);
  });

  it('401 unauthenticated — routed through the real worker dispatcher', async () => {
    const res = await worker.fetch(req('/v1/harbors/alice/dock/devices/bob-phone/key'), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });

  it('a fellow member fetches the peer pubkey', async () => {
    const res = await handleGetHarborDeviceKey(req('/v1/harbors/alice/dock/devices/bob-phone/key', { token: ALICE_TOKEN }), env, 'alice', 'dock', 'bob-phone');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { device: { deviceId: string; pubkey: string } };
    expect(body.device).toEqual({ deviceId: 'bob-phone', pubkey: PK_BOB, updatedAt: expect.any(Number) });
  });

  it('a non-member of the harbor gets the same 404 as a nonexistent harbor (no existence oracle)', async () => {
    const asDave = await handleGetHarborDeviceKey(req('/v1/harbors/alice/dock/devices/bob-phone/key', { token: DAVE_TOKEN }), env, 'alice', 'dock', 'bob-phone');
    const noSuchHarbor = await handleGetHarborDeviceKey(req('/v1/harbors/alice/ghost/devices/bob-phone/key', { token: DAVE_TOKEN }), env, 'alice', 'ghost', 'bob-phone');
    expect(asDave.status).toBe(404);
    expect(noSuchHarbor.status).toBe(404);
    expect(await asDave.json()).toEqual(await noSuchHarbor.json());
  });

  it("CROSS-HARBOR LEAK CHECK: a real, registered device whose account is NOT a member of THIS harbor resolves to 404, not the pubkey", async () => {
    // Carol's device is genuinely registered — just not on alice/dock. Alice
    // (a real dock member) must not be able to read it through dock's path.
    const res = await handleGetHarborDeviceKey(req('/v1/harbors/alice/dock/devices/carol-phone/key', { token: ALICE_TOKEN }), env, 'alice', 'dock', 'carol-phone');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a nonexistent device id 404s; a malformed device id path segment 404s without touching storage semantics', async () => {
    const unknown = await handleGetHarborDeviceKey(req('/v1/harbors/alice/dock/devices/ghost-device/key', { token: ALICE_TOKEN }), env, 'alice', 'dock', 'ghost-device');
    expect(unknown.status).toBe(404);
    const malformed = await handleGetHarborDeviceKey(req('/v1/harbors/alice/dock/devices/has space/key', { token: ALICE_TOKEN }), env, 'alice', 'dock', 'has space');
    expect(malformed.status).toBe(404);
  });

  it('routes through the real worker dispatcher', async () => {
    const res = await worker.fetch(req('/v1/harbors/alice/dock/devices/bob-phone/key', { token: ALICE_TOKEN }), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });
});

// ── POST /v1/harbors/:ns/:name/wraps ────────────────────────────────────────

describe('POST /v1/harbors/:ns/:name/wraps — post an HPKE-wrapped envelope', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedHarbors(env);
    await registerDevice(env, BOB_TOKEN, 'bob-phone', PK_BOB);
    await registerDevice(env, DAVE_TOKEN, 'dave-laptop', PK_DAVE); // registered, but never joins dock
  });

  const goodBody = () => ({
    recipientDeviceId: 'bob-phone',
    authorityEpoch: 1,
    grant: 'use',
    keyPurpose: 'channel',
    keyId: 'chan-1',
    enc: Buffer.from('e'.repeat(32)).toString('base64url'),
    ciphertext: Buffer.from('c'.repeat(48)).toString('base64url'),
  });

  const post = (token: string | undefined, body: unknown) =>
    handlePostHarborWrap(req('/v1/harbors/alice/dock/wraps', { method: 'POST', ...(token ? { token } : {}), body }), env, 'alice', 'dock');

  it('401 / 403 cross-origin / 404 non-member', async () => {
    expect((await post(undefined, goodBody())).status).toBe(401);
    expect(
      (await handlePostHarborWrap(req('/v1/harbors/alice/dock/wraps', { method: 'POST', token: ALICE_TOKEN, body: goodBody(), origin: 'https://evil.example' }), env, 'alice', 'dock')).status,
    ).toBe(403);
    expect((await post(DAVE_TOKEN, goodBody())).status).toBe(404); // dave is not a dock member
  });

  it('ANY member (not just an owner) may post — matches invites.ts precedent', async () => {
    const asBob = await post(BOB_TOKEN, goodBody());
    expect(asBob.status).toBe(201);
  });

  it('happy path: 201 create, 200 idempotent replay, 409 on a conflicting overwrite', async () => {
    const first = await post(ALICE_TOKEN, goodBody());
    expect(first.status).toBe(201);

    const replay = await post(ALICE_TOKEN, goodBody()); // byte-identical enc/ciphertext
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { code: string }).code).toBe('OK');

    const conflicting = await post(ALICE_TOKEN, { ...goodBody(), ciphertext: Buffer.from('DIFFERENT-BYTES!!!').toString('base64url') });
    expect(conflicting.status).toBe(409);
    expect(((await conflicting.json()) as { code: string }).code).toBe('CONFLICT');
  });

  it('unknown recipient device → 404 UNKNOWN_DEVICE', async () => {
    const res = await post(ALICE_TOKEN, { ...goodBody(), recipientDeviceId: 'nobody-home' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('UNKNOWN_DEVICE');
  });

  it("CROSS-HARBOR ROUTING CHECK: a registered device whose account is not a dock member → 400 RECIPIENT_NOT_MEMBER", async () => {
    const res = await post(ALICE_TOKEN, { ...goodBody(), recipientDeviceId: 'dave-laptop' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('RECIPIENT_NOT_MEMBER');
  });

  it('rejects malformed bodies (400)', async () => {
    const g = goodBody();
    for (const body of [
      { ...g, recipientDeviceId: '' },
      { ...g, recipientDeviceId: 'has space' },
      { ...g, authorityEpoch: 0 },
      { ...g, authorityEpoch: -1 },
      { ...g, authorityEpoch: 1.5 },
      { ...g, authorityEpoch: 'one' },
      { ...g, authorityEpoch: 999 },              // exceeds the harbor's current epoch (1)
      { ...g, grant: '' },
      { ...g, grant: 'x'.repeat(65) },
      { ...g, keyPurpose: '' },
      { ...g, keyId: '' },
      { ...g, enc: '' },
      { ...g, ciphertext: '' },
      { ...g, enc: '!!! not base64url @@@' },
      { ...g, ciphertext: '!!! not base64url @@@' },
    ]) {
      const res = await post(ALICE_TOKEN, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const badJson = await handlePostHarborWrap(
      new Request(`${BASE}/v1/harbors/alice/dock/wraps`, { method: 'POST', headers: { Authorization: `Bearer ${ALICE_TOKEN}`, 'Content-Type': 'application/json' }, body: 'not json' }),
      env, 'alice', 'dock',
    );
    expect(badJson.status).toBe(400);
  });

  it('accepts an authorityEpoch equal to the current epoch after it advances', async () => {
    // Adding carol as a second dock member ticks the epoch to 2.
    expect((await handleAddHarborMember(req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'carol' } }), env, 'alice', 'dock')).status).toBe(201);
    const res = await post(ALICE_TOKEN, { ...goodBody(), authorityEpoch: 2 });
    expect(res.status).toBe(201);
  });

  it('routes through the real worker dispatcher', async () => {
    const res = await worker.fetch(req('/v1/harbors/alice/dock/wraps', { method: 'POST', token: ALICE_TOKEN, body: goodBody() }), env, {} as ExecutionContext);
    expect(res.status).toBe(201);
  });
});

// ── GET /v1/harbors/:ns/:name/wraps ─────────────────────────────────────────

describe('GET /v1/harbors/:ns/:name/wraps — fetch pending wraps for MY device', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeDb().db);
    await seedHarbors(env);
    await registerDevice(env, ALICE_TOKEN, 'alice-mac', PK_ALICE);
    await registerDevice(env, BOB_TOKEN, 'bob-phone', PK_BOB);
    await handlePostHarborWrap(
      req('/v1/harbors/alice/dock/wraps', { method: 'POST', token: ALICE_TOKEN, body: {
        recipientDeviceId: 'bob-phone', authorityEpoch: 1, grant: 'use', keyPurpose: 'channel', keyId: 'chan-1',
        enc: Buffer.from('e1').toString('base64url'), ciphertext: Buffer.from('c1').toString('base64url'),
      } }),
      env, 'alice', 'dock',
    );
  });

  it('401 unauthenticated; 404 non-member; 400 missing deviceId', async () => {
    expect((await handleGetHarborWraps(req('/v1/harbors/alice/dock/wraps'), env, 'alice', 'dock')).status).toBe(401);
    expect((await handleGetHarborWraps(req('/v1/harbors/alice/dock/wraps', { token: DAVE_TOKEN }), env, 'alice', 'dock')).status).toBe(404);
    expect((await handleGetHarborWraps(req('/v1/harbors/alice/dock/wraps', { token: BOB_TOKEN }), env, 'alice', 'dock')).status).toBe(400);
  });

  it('the owning device fetches its own pending wraps', async () => {
    const res = await handleGetHarborWraps(req('/v1/harbors/alice/dock/wraps?deviceId=bob-phone', { token: BOB_TOKEN }), env, 'alice', 'dock');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wraps: Array<{ keyId: string; enc: string; ciphertext: string }> };
    expect(body.wraps).toHaveLength(1);
    expect(body.wraps[0]).toMatchObject({ keyId: 'chan-1', grant: 'use', keyPurpose: 'channel', authorityEpoch: 1 });
  });

  it("CROSS-ACCOUNT LEAK CHECK: Alice (a fellow dock member) cannot read Bob's device's wraps by naming his deviceId", async () => {
    const res = await handleGetHarborWraps(req('/v1/harbors/alice/dock/wraps?deviceId=bob-phone', { token: ALICE_TOKEN }), env, 'alice', 'dock');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('a deviceId that was never registered at all is also 403 (same answer — no oracle on which devices exist)', async () => {
    const res = await handleGetHarborWraps(req('/v1/harbors/alice/dock/wraps?deviceId=ghost-device', { token: ALICE_TOKEN }), env, 'alice', 'dock');
    expect(res.status).toBe(403);
  });

  it('sinceEpoch filters out older wraps', async () => {
    expect((await handleAddHarborMember(req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body: { user: 'carol' } }), env, 'alice', 'dock')).status).toBe(201);
    await handlePostHarborWrap(
      req('/v1/harbors/alice/dock/wraps', { method: 'POST', token: ALICE_TOKEN, body: {
        recipientDeviceId: 'bob-phone', authorityEpoch: 2, grant: 'use', keyPurpose: 'channel', keyId: 'chan-2',
        enc: Buffer.from('e2').toString('base64url'), ciphertext: Buffer.from('c2').toString('base64url'),
      } }),
      env, 'alice', 'dock',
    );
    const filtered = (await (await handleGetHarborWraps(req('/v1/harbors/alice/dock/wraps?deviceId=bob-phone&sinceEpoch=2', { token: BOB_TOKEN }), env, 'alice', 'dock')).json()) as {
      wraps: Array<{ keyId: string }>;
    };
    expect(filtered.wraps).toEqual([expect.objectContaining({ keyId: 'chan-2' })]);
  });

  it('routes through the real worker dispatcher', async () => {
    const res = await worker.fetch(req('/v1/harbors/alice/dock/wraps?deviceId=bob-phone', { token: BOB_TOKEN }), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });
});

// ── THE RELAY NEVER SEES PLAINTEXT ──────────────────────────────────────────

describe('the relay never sees a channel key in the clear', () => {
  it(
    'a REAL HPKE round trip (lib/pd-vault-ts.ts) posted through the wrap route stores and returns only ' +
      'opaque ciphertext: the stored/returned bytes are garbage without the recipient private key, and the ' +
      'plaintext channel key never appears verbatim in any request/response body',
    async () => {
      const env = makeEnv(makeDb().db);
      await seedHarbors(env);

      // A REAL X25519 device keypair (Bob's phone) — raw 32-byte scalars via JWK.
      const { publicKey, privateKey } = generateKeyPairSync('x25519');
      const bobPub = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url');
      const bobSecret = Buffer.from((privateKey.export({ format: 'jwk' }) as { d: string }).d, 'base64url');
      expect(bobPub).toHaveLength(32);
      expect(bobSecret).toHaveLength(32);
      await registerDevice(env, BOB_TOKEN, 'bob-real-device', bobPub.toString('hex'));

      // A random "channel key" standing in for the real secret pd-vault would
      // hand this function in production.
      const channelKey = randomBytes(CHANNEL_KEY_LEN);
      const channelKeyHex = channelKey.toString('hex');

      // The AAD is opaque to the relay — it is never decoded or interpreted
      // by src/device-keys.ts, only carried as ciphertext bytes — so its
      // exact field values need only be self-consistent between the wrap and
      // the later unwrap in THIS test, not match any relay-internal id.
      const aad: KeyWrapAad = {
        accountId: 'u_bob',
        harborId: 'h_dock_test',
        authorityEpoch: 1,
        recipientDeviceId: 'bob-real-device',
        grant: 'use',
        keyPurpose: 'channel',
        keyId: 'chan-real-1',
      };

      const wrapped = wrapChannelKeyForDevice(channelKey, bobPub, aad);
      const encB64 = wrapped.enc.toString('base64url');
      const ciphertextB64 = wrapped.ciphertext.toString('base64url');

      // Sanity: the wrap itself does not merely echo the plaintext.
      expect(ciphertextB64).not.toEqual(channelKey.toString('base64url'));

      const postRes = await handlePostHarborWrap(
        req('/v1/harbors/alice/dock/wraps', {
          method: 'POST', token: ALICE_TOKEN,
          body: { recipientDeviceId: 'bob-real-device', authorityEpoch: 1, grant: 'use', keyPurpose: 'channel', keyId: 'chan-real-1', enc: encB64, ciphertext: ciphertextB64 },
        }),
        env, 'alice', 'dock',
      );
      expect(postRes.status).toBe(201);
      const postBody = await postRes.text();
      // The create response echoes ROUTING METADATA ONLY — never the key
      // material it was given, wrapped or otherwise.
      expect(postBody).not.toContain(channelKeyHex);
      expect(postBody).not.toContain(encB64);
      expect(postBody).not.toContain(ciphertextB64);

      const getRes = await handleGetHarborWraps(
        req('/v1/harbors/alice/dock/wraps?deviceId=bob-real-device', { token: BOB_TOKEN }),
        env, 'alice', 'dock',
      );
      expect(getRes.status).toBe(200);
      const getText = await getRes.text();
      // The fetch response necessarily carries the wrapped bytes back (that's
      // the whole point) — but never the plaintext key, in hex OR base64url.
      expect(getText).not.toContain(channelKeyHex);
      expect(getText).not.toContain(channelKey.toString('base64'));
      expect(getText).toContain(encB64);
      expect(getText).toContain(ciphertextB64);

      const getBody = JSON.parse(getText) as { wraps: Array<{ enc: string; ciphertext: string }> };
      const returned = getBody.wraps[0]!;

      // PROOF OF GENUINE CIPHERTEXT: it does NOT open under a wrong key...
      const wrongSecret = randomBytes(32);
      expect(() =>
        unwrapChannelKeyForDevice(
          { enc: base64UrlDecodeBuf(returned.enc), ciphertext: base64UrlDecodeBuf(returned.ciphertext) },
          wrongSecret,
          aad,
        ),
      ).toThrow();

      // ...and it DOES open correctly under the real recipient private key,
      // recovering exactly the original channel key bytes byte-for-byte —
      // the definitive proof that what the relay stored and returned is a
      // real HPKE-wrapped envelope, not a plaintext key in disguise.
      const recovered = unwrapChannelKeyForDevice(
        { enc: base64UrlDecodeBuf(returned.enc), ciphertext: base64UrlDecodeBuf(returned.ciphertext) },
        bobSecret,
        aad,
      );
      expect(Buffer.from(recovered).equals(channelKey)).toBe(true);
    },
  );

  it('src/device-keys.ts and src/db.ts never IMPORT a vault primitive that could produce or consume plaintext', () => {
    const deviceKeysSrc = readFileSync(join(__dirname, '../src/device-keys.ts'), 'utf8');
    const dbSrc = readFileSync(join(__dirname, '../src/db.ts'), 'utf8');
    // Neither file may IMPORT from pd-vault-ts (or anything named like it) —
    // the relay's whole custody model is that it never links against code
    // that can wrap, unwrap, seal, or open anything. This checks import
    // statements specifically, not prose: both files' doc comments legitimately
    // NAME wrapChannelKeyForDevice/unwrapChannelKeyForDevice in their trust-
    // boundary explanations (the daemon runs them, off-relay) — the property
    // under test is "never imported", not "never mentioned".
    const importLine = /^\s*import\b[^;]*;/gm;
    for (const [label, src] of [['device-keys.ts', deviceKeysSrc], ['db.ts', dbSrc]] as const) {
      const imports = src.match(importLine) ?? [];
      for (const line of imports) {
        expect(line.toLowerCase(), `${label} import must not reference pd-vault`).not.toContain('pd-vault');
      }
    }
  });
});

/** Base64URL-decode via Buffer (independent of the relay's own decoder — this is the test's own check). */
function base64UrlDecodeBuf(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}
