/**
 * Tests for the APNs push module (src/push-apns.ts) and its hook into the
 * interruption nag engine. Coverage, per the acceptance list:
 *   - provider JWT shape: ES256 header {alg,kid}, claims {iss,iat}, a raw
 *     r||s signature that verifies against the .p8 public key; cache reuse
 *     within the 50-min TTL; refresh after; rotated key material re-mints;
 *   - send path against a mocked fetch: every typed outcome branch —
 *     delivered / token-gone (410 AND 400 BadDeviceToken, both marking the
 *     token dead in D1) / retryable (5xx, 429, network, 403 with JWT-cache
 *     drop) / failed (other 4xx) / config-missing (silent, zero fetches);
 *   - honest headers: apns-topic, apns-push-type alert, apns-priority 10 for
 *     critical/high and 5 for normal/low, collapse id per interruption;
 *   - the interruption hook fires per the SAME decay schedule fixture as the
 *     webhook transport (full-jitter next_nag_at advance, stage dedupe), an
 *     undelivered push retries next sweep at the same stage, and delivery by
 *     either transport advances the stage exactly once;
 *   - config-missing no-op pin: without APNs secrets the sweep behaves exactly
 *     as before (expiry still happens; zero pushes);
 *   - device registry endpoints: house auth (pdu_ bearer or session), upsert
 *     per (user, device), token eviction, suffix-only listing, unregister.
 *
 * Same injection idiom as interruptions.test.ts: a stateful fake D1 dispatched
 * on SQL substrings, stubbed global fetch, injected SweepIo {rand, sleep}.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apnsConfigured,
  apnsPriority,
  getApnsJwt,
  resetApnsJwtCache,
  sendApnsPush,
  sendInterruptionPushes,
  handleRegisterApnsDevice,
  handleUnregisterApnsDevice,
  handleListApnsDevices,
  APNS_JWT_TTL_SECONDS,
  type ApnsPushMessage,
  jwtFingerprint,
} from '../src/push-apns.js';
import {
  runInterruptionNagSweep,
  MAX_NAGS,
  type InterruptionRow,
  type InterruptionUrgency,
} from '../src/interruptions.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';
import type { UserRow } from '../src/db.js';

const NOW = 1_800_000_000;
const T0 = NOW * 1000;
const WEBHOOK = 'https://hooks.example.test/hitl-routing-key';
const IO = { rand: () => 0.5, sleep: async () => {} };
const TOPIC = 'dev.portdaddy.ios';
const KEY_ID = 'ABC123DEFG';
const TEAM_ID = 'TEAM123456';
const DEVICE_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

// ── Key material (a real P-256 keypair, minted once per run) ─────────────────

let P8_PEM = '';
let PUBLIC_KEY: CryptoKey;

async function mintP8(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = Buffer.from(pkcs8).toString('base64').replace(/(.{64})/g, '$1\n');
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
    publicKey: pair.publicKey,
  };
}

function b64urlDecode(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ── Fake infra (interruptions.test.ts idiom + the apns_device_tokens table) ──

const ok = (changes: number) => ({ success: true, meta: { changes } });

interface DeviceRow {
  user_id: string;
  device_id: string;
  token: string;
  platform: string;
  created_at: number;
  last_seen_at: number;
  dead_at: number | null;
}

interface FakePage {
  id: string;
  user_id: string;
  kind: string;
  sent_at: number;
}

function baseUser(id: string, login: string): UserRow {
  return {
    id,
    github_user_id: 1,
    login,
    display_name: null,
    avatar_url: null,
    primary_email: null,
    email_verified: 0,
    created_at: NOW,
    last_login_at: null,
    deleted_at: null,
  } as UserRow;
}

function makeDb() {
  const rows: InterruptionRow[] = [];
  const pages: FakePage[] = [];
  const devices: DeviceRow[] = [];
  const users = new Map<string, UserRow>();
  const tokens = new Map<string, { user_id: string; expires_at: number | null; revoked_at: number | null }>();

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const s = {
        bind(...v: unknown[]) {
          args = v;
          return s;
        },
        async first() {
          if (sql.includes('FROM users')) {
            const u = users.get(args[0] as string);
            return u && u.deleted_at === null ? u : null;
          }
          if (sql.includes('FROM user_tokens') && sql.startsWith('SELECT')) {
            return tokens.get(args[0] as string) ?? null;
          }
          if (sql.includes('COUNT(*)') && sql.includes('FROM interruption_pages')) {
            const digestOnly = sql.includes("kind = 'digest'");
            const [userId, since] = args as [string, number];
            return {
              n: pages.filter(
                (p) => p.user_id === userId && p.sent_at >= since && (!digestOnly || p.kind === 'digest'),
              ).length,
            };
          }
          if (sql.includes('COUNT(*)') && sql.includes('FROM operator_interruptions')) {
            if (sql.includes('user_id')) {
              const userId = args[0] as string;
              return { n: rows.filter((r) => r.user_id === userId && r.state === 'open').length };
            }
            return { n: rows.filter((r) => r.state === 'open').length };
          }
          if (sql.includes('ORDER BY CASE urgency')) {
            const userId = args[0] as string;
            const open = rows
              .filter((r) => r.user_id === userId && r.state === 'open')
              .sort((a, b) => a.created_at - b.created_at);
            return open[0] ?? null;
          }
          return null;
        },
        async all() {
          if (sql.includes('SELECT token FROM apns_device_tokens')) {
            const [userId] = args as [string, number];
            return {
              results: devices
                .filter((d) => d.user_id === userId && d.dead_at === null)
                .sort((a, b) => b.last_seen_at - a.last_seen_at)
                .map((d) => ({ token: d.token })),
            };
          }
          if (sql.includes('FROM apns_device_tokens WHERE user_id')) {
            const userId = args[0] as string;
            return {
              results: devices
                .filter((d) => d.user_id === userId)
                .sort((a, b) => b.last_seen_at - a.last_seen_at),
            };
          }
          if (sql.includes("state = 'open' AND next_nag_at <= ?")) {
            const now = args[0] as number;
            return {
              results: rows
                .filter((r) => r.state === 'open' && r.next_nag_at <= now)
                .sort((a, b) => a.user_id.localeCompare(b.user_id) || a.created_at - b.created_at),
            };
          }
          if (sql.includes("state = 'expired' AND gave_up_paged_at IS NULL")) {
            const since = args[0] as number;
            return {
              results: rows.filter(
                (r) => r.state === 'expired' && r.gave_up_paged_at === null && (r.closed_at ?? 0) >= since,
              ),
            };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO apns_device_tokens')) {
            const [userId, deviceId, token, platform, createdAt, lastSeenAt] = args as [
              string,
              string,
              string,
              string,
              number,
              number,
            ];
            const existing = devices.find((d) => d.user_id === userId && d.device_id === deviceId);
            if (existing) {
              existing.token = token;
              existing.platform = platform;
              existing.last_seen_at = lastSeenAt;
              existing.dead_at = null;
              return ok(1);
            }
            devices.push({
              user_id: userId,
              device_id: deviceId,
              token,
              platform,
              created_at: createdAt,
              last_seen_at: lastSeenAt,
              dead_at: null,
            });
            return ok(1);
          }
          if (sql.includes('DELETE FROM apns_device_tokens') && sql.includes('NOT (')) {
            const [token, userId, deviceId] = args as [string, string, string];
            let removed = 0;
            for (let i = devices.length - 1; i >= 0; i--) {
              const d = devices[i]!;
              if (d.token === token && !(d.user_id === userId && d.device_id === deviceId)) {
                devices.splice(i, 1);
                removed++;
              }
            }
            return ok(removed);
          }
          if (sql.includes('DELETE FROM apns_device_tokens')) {
            const [userId, deviceId] = args as [string, string];
            let removed = 0;
            for (let i = devices.length - 1; i >= 0; i--) {
              const d = devices[i]!;
              if (d.user_id === userId && d.device_id === deviceId) {
                devices.splice(i, 1);
                removed++;
              }
            }
            return ok(removed);
          }
          if (sql.includes('UPDATE apns_device_tokens SET dead_at')) {
            const [deadAt, token] = args as [number, string];
            const d = devices.find((x) => x.token === token && x.dead_at === null);
            if (!d) return ok(0);
            d.dead_at = deadAt;
            return ok(1);
          }
          if (sql.includes("SET state = 'expired'")) {
            const [closedAt, id] = args as [number, string];
            const r = rows.find((x) => x.id === id);
            if (!r || r.state !== 'open') return ok(0);
            r.state = 'expired';
            r.closed_at = closedAt;
            return ok(1);
          }
          if (sql.includes('nag_count = nag_count + 1')) {
            const [stage, now, nextAt, id] = args as [number, number, number, string];
            const r = rows.find((x) => x.id === id);
            if (!r) return ok(0);
            r.nag_count += 1;
            r.decay_stage = stage;
            r.last_nagged_at = now;
            r.next_nag_at = nextAt;
            return ok(1);
          }
          if (sql.includes('SET gave_up_paged_at')) {
            const id = args[args.length - 1] as string;
            const r = rows.find((x) => x.id === id);
            if (!r) return ok(0);
            r.gave_up_paged_at = args[0] as number;
            if (sql.includes('last_nagged_at')) r.last_nagged_at = args[1] as number;
            return ok(1);
          }
          if (sql.includes('INSERT INTO interruption_pages')) {
            const [id, userId, kind, sentAt] = args as [string, string, string, number];
            pages.push({ id, user_id: userId, kind, sent_at: sentAt });
            return ok(1);
          }
          return ok(0);
        },
      };
      return s;
    },
  };
  return { db: db as unknown as D1Database, rows, pages, devices, users, tokens };
}

function makeKv() {
  const store = new Map<string, string>();
  return {
    kv: {
      async get(k: string) {
        return store.get(k) ?? null;
      },
      async put(k: string, v: string) {
        store.set(k, v);
      },
      async delete(k: string) {
        store.delete(k);
      },
    } as unknown as KVNamespace,
    store,
  };
}

function makeEnv(db: D1Database, kv: KVNamespace, over: Partial<Record<keyof Env, unknown>> = {}): Env {
  return { DB: db, KV: kv, RELAY_VERSION: '0.1.0-test', ...over } as unknown as Env;
}

/** APNs credential overrides for makeEnv. */
function apnsVars(): Partial<Record<keyof Env, unknown>> {
  return { APNS_AUTH_KEY: P8_PEM, APNS_KEY_ID: KEY_ID, APNS_TEAM_ID: TEAM_ID, APNS_TOPIC: TOPIC };
}

function seed(rows: InterruptionRow[], over: Partial<InterruptionRow> = {}): InterruptionRow {
  const row: InterruptionRow = {
    id: `oi_${(rows.length + 1).toString(16).padStart(4, '0')}`,
    user_id: 'u1',
    installation_id: null,
    source_agent: 'fleet-executor/purser',
    source_session: 'run:test',
    title: 'Grant contents:write',
    body: 'The App cannot push the test branch.',
    urgency: 'critical' as InterruptionUrgency,
    state: 'open',
    answer: null,
    created_at: NOW - 600,
    last_nagged_at: null,
    nag_count: 0,
    decay_stage: 0,
    next_nag_at: NOW - 1,
    closed_at: null,
    gave_up_paged_at: null,
    ...over,
  };
  rows.push(row);
  return row;
}

function seedDevice(devices: DeviceRow[], over: Partial<DeviceRow> = {}): DeviceRow {
  const row: DeviceRow = {
    user_id: 'u1',
    device_id: 'iphone-1',
    token: DEVICE_TOKEN,
    platform: 'ios',
    created_at: NOW - 86_400,
    last_seen_at: NOW - 3600,
    dead_at: null,
    ...over,
  };
  devices.push(row);
  return row;
}

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Stub fetch with a per-call {status, body?, headers?} script (last repeats). */
function stubFetch(
  script: Array<{ status: number; body?: string; headers?: Record<string, string> }> = [{ status: 200 }],
) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const step = script[Math.min(calls.length, script.length - 1)] ?? { status: 200 };
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
      calls.push({
        url: String(url),
        headers,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return new Response(step.body ?? '', { status: step.status, headers: step.headers });
    }),
  );
  return calls;
}

const PDU = `pdu_${'ab'.repeat(32)}`;

function bearerReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${PDU}` },
  });
}

function authAs(f: ReturnType<typeof makeDb>, userId = 'u1', login = 'skipper') {
  f.users.set(userId, baseUser(userId, login));
  f.tokens.set(hashHex(PDU), { user_id: userId, expires_at: null, revoked_at: null });
}

beforeEach(async () => {
  resetApnsJwtCache();
  if (!P8_PEM) {
    const kp = await mintP8();
    P8_PEM = kp.pem;
    PUBLIC_KEY = kp.publicKey;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 1. Provider JWT: shape, signature, cache ─────────────────────────────────

describe('getApnsJwt (ES256 provider token)', () => {
  it('mints header {alg:ES256, kid}, claims {iss: teamId, iat}, and a signature the .p8 public key verifies', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, apnsVars());
    const jwt = await getApnsJwt(env, T0);

    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    const header = JSON.parse(b64urlDecode(parts[0]!).toString('utf8')) as Record<string, unknown>;
    const claims = JSON.parse(b64urlDecode(parts[1]!).toString('utf8')) as Record<string, unknown>;
    expect(header).toEqual({ alg: 'ES256', kid: KEY_ID });
    expect(claims).toEqual({ iss: TEAM_ID, iat: NOW });

    // WebCrypto ES256 signatures are raw r||s — 64 bytes, JOSE format.
    const sig = b64urlDecode(parts[2]!);
    expect(sig.length).toBe(64);
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      PUBLIC_KEY,
      sig,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    expect(verified).toBe(true);
  });

  it('reuses the cached token within the 50-min TTL and re-mints after it', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, apnsVars());
    const first = await getApnsJwt(env, T0);
    // 49 minutes later: same token, byte for byte — no re-sign.
    expect(await getApnsJwt(env, T0 + 49 * 60 * 1000)).toBe(first);
    // Past the TTL: a fresh token with a fresh iat.
    const later = T0 + (APNS_JWT_TTL_SECONDS + 60) * 1000;
    const refreshed = await getApnsJwt(env, later);
    expect(refreshed).not.toBe(first);
    const claims = JSON.parse(b64urlDecode(refreshed.split('.')[1]!).toString('utf8')) as { iat: number };
    expect(claims.iat).toBe(Math.floor(later / 1000));
  });

  it('rotated key material re-mints immediately (fingerprinted cache)', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    const first = await getApnsJwt(makeEnv(f.db, kv, apnsVars()), T0);
    const rotated = await getApnsJwt(makeEnv(f.db, kv, { ...apnsVars(), APNS_KEY_ID: 'ZZZ999ZZZZ' }), T0 + 1000);
    expect(rotated).not.toBe(first);
    const header = JSON.parse(b64urlDecode(rotated.split('.')[0]!).toString('utf8')) as { kid: string };
    expect(header.kid).toBe('ZZZ999ZZZZ');
  });

  it('throws when unconfigured (callers turn this into a typed outcome)', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    await expect(getApnsJwt(makeEnv(f.db, kv), T0)).rejects.toThrow(/not configured/);
  });
});

// ── 2. sendApnsPush: every typed outcome branch ──────────────────────────────

const PUSH: ApnsPushMessage = {
  kind: 'nag',
  title: 'Grant contents:write',
  body: 'fleet-executor/purser is blocked — nag 1/5',
  urgency: 'critical',
  interruptionId: 'oi_0001',
  nagCount: 0,
};

describe('sendApnsPush', () => {
  it('delivers with honest headers: topic, alert type, priority 10 for critical, per-ask collapse id', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const f = makeDb();
    const { kv } = makeKv();
    const out = await sendApnsPush(DEVICE_TOKEN, PUSH, makeEnv(f.db, kv, apnsVars()), T0);
    expect(out).toEqual({ kind: 'delivered' });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe(`https://api.push.apple.com/3/device/${DEVICE_TOKEN}`);
    expect(c.headers['apns-topic']).toBe(TOPIC);
    expect(c.headers['apns-push-type']).toBe('alert');
    expect(c.headers['apns-priority']).toBe('10');
    expect(c.headers['apns-collapse-id']).toBe('pd-oi-oi_0001');
    expect(c.headers['authorization']).toMatch(/^bearer eyJ/);
    const aps = c.body.aps as Record<string, unknown>;
    expect((aps.alert as Record<string, unknown>).title).toBe('Grant contents:write');
    expect(aps.sound).toBe('default');
    expect(c.body.kind).toBe('nag');
    expect(c.body.interruption_id).toBe('oi_0001');
  });

  it('priority is honest to the interruption class: normal/low pages send 5, no sound', async () => {
    expect(apnsPriority('critical')).toBe('10');
    expect(apnsPriority('high')).toBe('10');
    expect(apnsPriority('normal')).toBe('5');
    expect(apnsPriority('low')).toBe('5');
    const calls = stubFetch([{ status: 200 }]);
    const f = makeDb();
    const { kv } = makeKv();
    await sendApnsPush(DEVICE_TOKEN, { ...PUSH, urgency: 'low' }, makeEnv(f.db, kv, apnsVars()), T0);
    expect(calls[0]!.headers['apns-priority']).toBe('5');
    expect((calls[0]!.body.aps as Record<string, unknown>).sound).toBeUndefined();
  });

  // What makes a dead token stay dead is the durable `dead_at` stamp asserted
  // below — not the log line that accompanies it. Auditability of token-death
  // events belongs in a telemetry event with a stable shape; asserting a
  // console call here would pin the logging implementation instead of the
  // behaviour, and break on a refactor that improves it.
  it('410 Unregistered ⇒ token-gone AND the token is marked dead in D1', async () => {
    stubFetch([{ status: 410, body: '{"reason":"Unregistered"}' }]);
    const f = makeDb();
    const { kv } = makeKv();
    const dev = seedDevice(f.devices);
    const out = await sendApnsPush(DEVICE_TOKEN, PUSH, makeEnv(f.db, kv, apnsVars()), T0);
    expect(out).toEqual({ kind: 'token-gone' });
    expect(dev.dead_at).toBe(NOW);
  });

  it('400 BadDeviceToken ⇒ token-gone and dead too; other 4xx ⇒ failed, never retried', async () => {
    stubFetch([{ status: 400, body: '{"reason":"BadDeviceToken"}' }]);
    const f = makeDb();
    const { kv } = makeKv();
    const dev = seedDevice(f.devices);
    const env = makeEnv(f.db, kv, apnsVars());
    expect(await sendApnsPush(DEVICE_TOKEN, PUSH, env, T0)).toEqual({ kind: 'token-gone' });
    expect(dev.dead_at).toBe(NOW);

    vi.unstubAllGlobals();
    const calls = stubFetch([{ status: 400, body: '{"reason":"PayloadTooLarge"}' }]);
    const out = await sendApnsPush(DEVICE_TOKEN, PUSH, env, T0);
    expect(out).toEqual({ kind: 'failed', status: 400, reason: 'PayloadTooLarge' });
    expect(calls).toHaveLength(1); // exactly one attempt — no in-call retry
  });

  it('5xx / 429 / network are retryable (sweep-level retry, not in-call)', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, apnsVars());

    let calls = stubFetch([{ status: 503 }]);
    expect(await sendApnsPush(DEVICE_TOKEN, PUSH, env, T0)).toEqual({ kind: 'retryable', retryAfterSec: null });
    expect(calls).toHaveLength(1);

    vi.unstubAllGlobals();
    calls = stubFetch([{ status: 429, headers: { 'Retry-After': '120' } }]);
    expect(await sendApnsPush(DEVICE_TOKEN, PUSH, env, T0)).toEqual({ kind: 'retryable', retryAfterSec: 120 });
    expect(calls).toHaveLength(1);

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    expect(await sendApnsPush(DEVICE_TOKEN, PUSH, env, T0)).toEqual({ kind: 'retryable', retryAfterSec: null });
  });

  it('403 provider-token trouble drops the JWT cache so the next mint is fresh', async () => {
    stubFetch([{ status: 403, body: '{"reason":"ExpiredProviderToken"}' }]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, apnsVars());
    const before = await getApnsJwt(env, T0);
    expect(await sendApnsPush(DEVICE_TOKEN, PUSH, env, T0)).toEqual({ kind: 'retryable', retryAfterSec: null });
    // Within TTL, a surviving cache would return `before` byte-for-byte; the
    // 403 dropped it, so a new iat proves a fresh mint.
    const after = await getApnsJwt(env, T0 + 60_000);
    expect(after).not.toBe(before);
  });

  it('config-missing is a silent no-op: no fetch, no throw', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const f = makeDb();
    const { kv } = makeKv();
    const out = await sendApnsPush(DEVICE_TOKEN, PUSH, makeEnv(f.db, kv), T0);
    expect(out).toEqual({ kind: 'config-missing' });
    expect(calls).toHaveLength(0);
    // Partial config is still missing config — never a half-armed send.
    const partial = await sendApnsPush(
      DEVICE_TOKEN,
      PUSH,
      makeEnv(f.db, kv, { APNS_AUTH_KEY: P8_PEM, APNS_KEY_ID: KEY_ID }),
      T0,
    );
    expect(partial).toEqual({ kind: 'config-missing' });
    expect(calls).toHaveLength(0);
  });

  it('an unimportable .p8 fails typed — it never throws into the sweep', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const f = makeDb();
    const { kv } = makeKv();
    const out = await sendApnsPush(
      DEVICE_TOKEN,
      PUSH,
      makeEnv(f.db, kv, { ...apnsVars(), APNS_AUTH_KEY: 'not a key' }),
      T0,
    );
    expect(out.kind).toBe('failed');
    expect(calls).toHaveLength(0);
  });
});

// ── 3. The interruption hook: same decay schedule, transport-agnostic delivery ─

describe('interruption nag sweep × APNs', () => {
  it('APNs-only: a due ask pushes once, advances the SAME jittered stage as the webhook would, and dedupes', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, apnsVars()); // NO webhook — APNs is the only transport
    const row = seed(f.rows);
    seedDevice(f.devices);

    const r1 = await runInterruptionNagSweep(env, NOW, IO);
    expect(r1.nagsSent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('api.push.apple.com/3/device/');
    expect(calls[0]!.body.kind).toBe('nag');
    expect(calls[0]!.body.interruption_id).toBe(row.id);
    // The decay fixture from interruptions.test.ts, verbatim: stage-1 ceiling
    // for critical = 600s; rand 0.5 ⇒ due again at NOW+300. The push rode the
    // SAME schedule — no cadence of its own.
    expect(row.nag_count).toBe(1);
    expect(row.decay_stage).toBe(1);
    expect(row.next_nag_at).toBe(NOW + 300);
    expect(f.pages).toHaveLength(1); // one ledger row per delivered page decision

    // Before the jittered due time: silence (the stage dedupe).
    const r2 = await runInterruptionNagSweep(env, NOW + 60, IO);
    expect(r2.nagsSent).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('both transports: one webhook POST + one push, ONE ledger row, stage advances exactly once', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, { ...apnsVars(), MERCY_PAGE_WEBHOOK: WEBHOOK });
    const row = seed(f.rows);
    seedDevice(f.devices);

    const r = await runInterruptionNagSweep(env, NOW, IO);
    expect(r.nagsSent).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.url).sort()).toEqual(
      [`https://api.push.apple.com/3/device/${DEVICE_TOKEN}`, WEBHOOK].sort(),
    );
    expect(row.nag_count).toBe(1);
    expect(f.pages).toHaveLength(1);
  });

  it('a failed push does NOT advance the stage — retried next sweep at the SAME stage', async () => {
    stubFetch([{ status: 503 }]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, apnsVars());
    const row = seed(f.rows);
    seedDevice(f.devices);

    const r1 = await runInterruptionNagSweep(env, NOW, IO);
    expect(r1.nagsSent).toBe(0);
    expect(row.nag_count).toBe(0);
    expect(row.next_nag_at).toBe(NOW - 1); // unchanged — same stage stays due
    expect(f.pages).toHaveLength(0);

    vi.unstubAllGlobals();
    stubFetch([{ status: 200 }]);
    const r2 = await runInterruptionNagSweep(env, NOW + 300, IO);
    expect(r2.nagsSent).toBe(1);
    expect(row.nag_count).toBe(1); // delivered exactly once for stage 0
  });

  it('410 mid-sweep marks the token dead; the next sweep pushes nothing for it', async () => {
    const calls = stubFetch([{ status: 410, body: '{"reason":"Unregistered"}' }]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, apnsVars());
    const row = seed(f.rows);
    const dev = seedDevice(f.devices);

    const r1 = await runInterruptionNagSweep(env, NOW, IO);
    expect(r1.nagsSent).toBe(0);
    expect(dev.dead_at).not.toBeNull();
    expect(row.nag_count).toBe(0); // undelivered — same stage retries

    const r2 = await runInterruptionNagSweep(env, NOW + 300, IO);
    expect(r2.nagsSent).toBe(0);
    expect(calls).toHaveLength(1); // dead token never paid for again
    expect(r2.errors).toEqual([]);
  });

  it('the gave-up page also rides APNs, pinned by gave_up_paged_at', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, apnsVars());
    const row = seed(f.rows, { nag_count: MAX_NAGS, decay_stage: MAX_NAGS });
    seedDevice(f.devices);

    const r1 = await runInterruptionNagSweep(env, NOW, IO);
    expect(r1.expired).toBe(1);
    expect(r1.gaveUpSent).toBe(1);
    expect(row.state).toBe('expired');
    expect(row.gave_up_paged_at).toBe(NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.kind).toBe('gave-up');

    const r2 = await runInterruptionNagSweep(env, NOW + 3600, IO);
    expect(r2.gaveUpSent + r2.nagsSent + r2.digestsSent).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('CONFIG-MISSING PIN: without APNs secrets the sweep is byte-identical to before — expiry still happens, zero pushes', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const f = makeDb();
    const { kv } = makeKv();
    expect(apnsConfigured(makeEnv(f.db, kv))).toBe(false);
    const row = seed(f.rows, { nag_count: MAX_NAGS });
    seedDevice(f.devices); // a registered device changes nothing without secrets
    const r = await runInterruptionNagSweep(makeEnv(f.db, kv), NOW, IO);
    expect(r.expired).toBe(1);
    expect(row.state).toBe('expired');
    expect(calls).toHaveLength(0); // nobody paged — honestly
    expect(r.errors).toEqual([]);
  });

  it('an operator with no registered devices delivers nothing via APNs (attempted=false)', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const f = makeDb();
    const { kv } = makeKv();
    const out = await sendInterruptionPushes(makeEnv(f.db, kv, apnsVars()), 'u1', PUSH);
    expect(out).toEqual({ attempted: false, delivered: false });
    expect(calls).toHaveLength(0);
  });
});

// ── 4. Device registry endpoints ─────────────────────────────────────────────

describe('APNs device registry API', () => {
  const URL_BASE = 'https://relay.example/v1/push/apns/devices';

  it('rejects unauthenticated registration, listing, and unregistration', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv);
    const post = await handleRegisterApnsDevice(
      new Request(URL_BASE, { method: 'POST', body: JSON.stringify({ device_token: DEVICE_TOKEN, device_id: 'x' }) }),
      env,
    );
    expect(post.status).toBe(401);
    expect((await handleListApnsDevices(new Request(URL_BASE), env)).status).toBe(401);
    expect((await handleUnregisterApnsDevice(new Request(`${URL_BASE}/x`, { method: 'DELETE' }), env, 'x')).status).toBe(401);
  });

  it('registers a device bound to the authenticated account, echoing only the token suffix', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const res = await handleRegisterApnsDevice(
      bearerReq(URL_BASE, {
        method: 'POST',
        body: JSON.stringify({ device_token: DEVICE_TOKEN.toUpperCase(), device_id: 'iphone-1', platform: 'ios' }),
      }),
      makeEnv(f.db, kv),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { device: { deviceId: string; tokenSuffix: string; dead: boolean } };
    expect(body.device.deviceId).toBe('iphone-1');
    expect(body.device.tokenSuffix).toBe(DEVICE_TOKEN.slice(-8));
    expect(body.device.dead).toBe(false);
    expect(JSON.stringify(body)).not.toContain(DEVICE_TOKEN); // suffix only
    expect(f.devices).toHaveLength(1);
    expect(f.devices[0]!).toMatchObject({ user_id: 'u1', device_id: 'iphone-1', token: DEVICE_TOKEN, platform: 'ios' });
  });

  it('re-registering the same device replaces its token and revives a dead row', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    seedDevice(f.devices, { dead_at: NOW - 100 });
    const newToken = 'ff'.repeat(32);
    const res = await handleRegisterApnsDevice(
      bearerReq(URL_BASE, { method: 'POST', body: JSON.stringify({ device_token: newToken, device_id: 'iphone-1' }) }),
      makeEnv(f.db, kv),
    );
    expect(res.status).toBe(200);
    expect(f.devices).toHaveLength(1);
    expect(f.devices[0]!.token).toBe(newToken);
    expect(f.devices[0]!.dead_at).toBeNull();
  });

  // The invariant under test is a schema property, not a behaviour of this
  // handler: (user_id, device_id) is the primary key and the token column is
  // uniquely indexed, so one physical device can hold exactly one live token.
  // Re-registering it under a new id must therefore EVICT the stale row rather
  // than leave a second address Apple would still accept deliveries for.
  it('a token re-registered under a different device evicts the stale claim (one token = one device)', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    seedDevice(f.devices, { device_id: 'old-phone' });
    await handleRegisterApnsDevice(
      bearerReq(URL_BASE, { method: 'POST', body: JSON.stringify({ device_token: DEVICE_TOKEN, device_id: 'new-phone' }) }),
      makeEnv(f.db, kv),
    );
    expect(f.devices).toHaveLength(1);
    expect(f.devices[0]!.device_id).toBe('new-phone');
  });

  it('rejects malformed tokens, missing device ids, and non-JSON bodies', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const env = makeEnv(f.db, kv);
    const badToken = await handleRegisterApnsDevice(
      bearerReq(URL_BASE, { method: 'POST', body: JSON.stringify({ device_token: 'not-hex!', device_id: 'x' }) }),
      env,
    );
    expect(badToken.status).toBe(400);
    const noDevice = await handleRegisterApnsDevice(
      bearerReq(URL_BASE, { method: 'POST', body: JSON.stringify({ device_token: DEVICE_TOKEN }) }),
      env,
    );
    expect(noDevice.status).toBe(400);
    const notJson = await handleRegisterApnsDevice(bearerReq(URL_BASE, { method: 'POST', body: 'nope' }), env);
    expect(notJson.status).toBe(400);
    expect(f.devices).toHaveLength(0);
  });

  // TENANT ISOLATION BOUNDARY. The user_id filter this asserts is the whole
  // control: another account's device tokens must never appear in this
  // listing. Named explicitly because a boundary that reads as an incidental
  // WHERE clause is one a later refactor "simplifies" away.
  it('lists only the account’s devices, suffix-only, live and dead flagged', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    seedDevice(f.devices, { device_id: 'iphone-1', last_seen_at: NOW - 10 });
    seedDevice(f.devices, { device_id: 'ipad-1', token: 'ee'.repeat(32), platform: 'ipados', dead_at: NOW, last_seen_at: NOW - 5 });
    seedDevice(f.devices, { user_id: 'u2', device_id: 'their-phone', token: 'dd'.repeat(32) });

    const res = await handleListApnsDevices(bearerReq(URL_BASE), makeEnv(f.db, kv));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { devices: Array<{ deviceId: string; dead: boolean }> };
    expect(body.devices.map((d) => d.deviceId)).toEqual(['ipad-1', 'iphone-1']); // last_seen desc
    expect(body.devices.find((d) => d.deviceId === 'ipad-1')!.dead).toBe(true);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(DEVICE_TOKEN);
    expect(raw).not.toContain('their-phone'); // cross-tenant rows never leak
  });

  it('unregisters idempotently, scoped to the owner', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    seedDevice(f.devices);
    seedDevice(f.devices, { user_id: 'u2', device_id: 'iphone-1', token: 'cc'.repeat(32) });
    const env = makeEnv(f.db, kv);

    const res = await handleUnregisterApnsDevice(
      bearerReq(`${URL_BASE}/iphone-1`, { method: 'DELETE' }),
      env,
      'iphone-1',
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { removed: number }).removed).toBe(1);
    expect(f.devices).toHaveLength(1);
    expect(f.devices[0]!.user_id).toBe('u2'); // the other tenant's row survives

    const again = await handleUnregisterApnsDevice(
      bearerReq(`${URL_BASE}/iphone-1`, { method: 'DELETE' }),
      env,
      'iphone-1',
    );
    expect(((await again.json()) as { removed: number }).removed).toBe(0);
  });
});

// The JWT cache key must be injective: two different credential sets can never
// map to the same key, or the cache serves one team's provider token for
// another team's credentials. Apple's id format makes a bare join safe today;
// this pins the property independent of that format.
describe('jwtFingerprint — cache key injectivity', () => {
  it('distinct credential sets never share a cache key, even with separators in the ids', () => {
    const a = jwtFingerprint({ APNS_KEY_ID: 'a|b', APNS_TEAM_ID: 'c', APNS_AUTH_KEY: 'k' } as never);
    const b = jwtFingerprint({ APNS_KEY_ID: 'a', APNS_TEAM_ID: 'b|c', APNS_AUTH_KEY: 'k' } as never);
    expect(a).not.toBe(b);
  });

  it('changing any single credential changes the key', () => {
    const base = { APNS_KEY_ID: 'K1', APNS_TEAM_ID: 'T1', APNS_AUTH_KEY: 'k1' } as never;
    const key = jwtFingerprint(base);
    expect(jwtFingerprint({ ...(base as object), APNS_KEY_ID: 'K2' } as never)).not.toBe(key);
    expect(jwtFingerprint({ ...(base as object), APNS_TEAM_ID: 'T2' } as never)).not.toBe(key);
    expect(jwtFingerprint({ ...(base as object), APNS_AUTH_KEY: 'k2' } as never)).not.toBe(key);
  });

  it('the same credentials produce the same key (the cache can actually hit)', () => {
    const env = { APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_AUTH_KEY: 'k' } as never;
    expect(jwtFingerprint(env)).toBe(jwtFingerprint({ ...(env as object) } as never));
  });
});
