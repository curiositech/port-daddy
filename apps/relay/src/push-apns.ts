/**
 * APNs PUSH — the iOS delivery channel for operator interruptions.
 *
 * The relay's HITL nag engine (src/interruptions.ts) pages the operator when
 * an agent files a blocking ask. Today that page is a JSON webhook
 * (MERCY_PAGE_WEBHOOK); this module adds Apple Push Notification service as a
 * SECOND transport so the iOS app hears the same pages, on the SAME decaying
 * full-jitter schedule — never a cadence of its own. The nag engine calls
 * `sendInterruptionPushes` at its three delivery decision points (nag,
 * gave-up, digest); "delivered" for stage advancement means AT LEAST ONE
 * transport delivered, and that single bit is what advances `next_nag_at` and
 * writes the page ledger (see interruptions.ts `deliverPage`).
 *
 * CONFIGURATION — Worker secrets/vars (all optional; while ANY is missing the
 * module is a silent config-missing no-op, so the relay works without APNs):
 *   APNS_AUTH_KEY  (secret) — the .p8 token-auth signing key from the Apple
 *                             Developer portal, PKCS#8 PEM (ES256 / P-256).
 *   APNS_KEY_ID    (secret) — the 10-character key id of that .p8 key.
 *   APNS_TEAM_ID   (secret) — the 10-character Apple Developer team id.
 *   APNS_TOPIC     (var)    — the iOS app bundle id (the `apns-topic` header).
 *   APNS_HOST      (var, optional) — origin override; defaults to the
 *                             production APNs HTTP/2 endpoint. Point it at
 *                             https://api.sandbox.push.apple.com for dev builds.
 *
 * TOKEN AUTH (provider JWT): one ES256 JWT signed with the .p8 key via
 * WebCrypto — header {alg:'ES256', kid}, claims {iss: teamId, iat}. Apple
 * requires refreshing no more often than every 20 minutes and at least every
 * 60; the JWT is cached in module state for APNS_JWT_TTL_SECONDS (50 min) and
 * re-minted after that, or immediately after a 403 (Expired/InvalidProviderToken).
 *
 * SEND OUTCOMES (typed — `sendApnsPush` never throws):
 *   delivered      — APNs accepted the notification (200).
 *   token-gone     — 410 Unregistered (or 400 BadDeviceToken): the device
 *                    token is dead; it is marked dead_at in D1 so the sweep
 *                    stops paying for it. Registration revives it.
 *   retryable      — 429 / 5xx / network / timeout / 403 provider-token
 *                    trouble (cache dropped). No in-call retry: the nag
 *                    engine's "retry next sweep at the SAME stage" dedupe is
 *                    the retry loop, exactly as for the webhook transport.
 *   failed         — any other 4xx: permanent for this request; not retried.
 *   config-missing — secrets absent; nothing sent, nothing logged loudly.
 *
 * PRIORITY is honest to the interruption class: critical/high pages send
 * apns-priority 10 (immediate, with sound); normal/low and digests send 5
 * (power-considerate). apns-push-type is always 'alert' — these are
 * user-visible pages, never silent background pushes.
 *
 * DEVICE REGISTRY (migration 2026-08-20-apns-device-tokens.sql):
 *   POST   /v1/push/apns/devices            — register/refresh (pdu_ bearer or session)
 *   GET    /v1/push/apns/devices            — list the account's devices
 *   DELETE /v1/push/apns/devices/:deviceId  — unregister
 * Auth follows the house pattern: `resolveUserFromRequest` (pdu_ bearer OR
 * session cookie), rows scoped to the authenticated user — never anyone
 * else's. The full device token is never echoed back (suffix only).
 */

import type { Env } from './types.js';
import { hashHex } from './crypto.js';
import { resolveUserFromRequest } from './device-flow.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Mirrors interruptions.ts InterruptionUrgency (kept local: no import cycle). */
export type ApnsUrgency = 'low' | 'normal' | 'high' | 'critical';
export type ApnsPushKind = 'nag' | 'gave-up' | 'digest';

export interface ApnsPushMessage {
  kind: ApnsPushKind;
  /** Alert title — the interruption title or the digest summary line. */
  title: string;
  /** Optional alert body line. */
  body?: string;
  /** Drives apns-priority (honest to the interruption class). */
  urgency: ApnsUrgency;
  /** The ask this page is about (null for digests with nothing open). */
  interruptionId?: string | null;
  /** Digest pages: how many asks are waiting. */
  openCount?: number;
  /** Nag pages: delivered nags so far. */
  nagCount?: number;
  /** Override the apns-collapse-id (defaults derived from kind + id). */
  collapseId?: string;
}

export type ApnsSendOutcome =
  | { kind: 'delivered' }
  | { kind: 'token-gone' }
  | { kind: 'retryable'; retryAfterSec: number | null }
  | { kind: 'failed'; status: number; reason: string | null }
  | { kind: 'config-missing' };

// ── Tuning ────────────────────────────────────────────────────────────────────

/** Provider-JWT cache lifetime — inside Apple's 20..60-minute refresh window. */
export const APNS_JWT_TTL_SECONDS = 50 * 60;
/** Per-request APNs timeout (matches the webhook transport's 5s). */
const APNS_TIMEOUT_MS = 5000;
/** At most this many live device tokens are paged per operator per decision. */
export const MAX_PUSH_DEVICES = 10;
/** Retry-After ceiling on 429 — mirrors the webhook transport's 1h cap. */
const RETRY_AFTER_CAP_SECONDS = 60 * 60;
const DEFAULT_APNS_HOST = 'https://api.push.apple.com';

const DEVICE_ID_MAX = 120;
const DEVICE_TOKEN_RE = /^[0-9a-f]{16,200}$/i;
const PLATFORMS = ['ios', 'ipados', 'macos'] as const;
export type ApnsPlatform = (typeof PLATFORMS)[number];

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** True iff every APNs credential piece is present — the module's arm switch. */
export function apnsConfigured(env: Env): boolean {
  return Boolean(env.APNS_AUTH_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC);
}

/** apns-priority honest to the interruption class: page loudly only when the ask is. */
export function apnsPriority(urgency: ApnsUrgency): '10' | '5' {
  return urgency === 'critical' || urgency === 'high' ? '10' : '5';
}

// ── Provider JWT (ES256 via WebCrypto, cached ~50 min) ───────────────────────

interface JwtCache {
  token: string;
  mintedAtMs: number;
  /** keyId|teamId|key-hash — a rotated secret re-mints immediately. */
  fingerprint: string;
}

let jwtCache: JwtCache | null = null;

/** Drop the cached provider JWT (tests; 403 ExpiredProviderToken recovery). */
export function resetApnsJwtCache(): void {
  jwtCache = null;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** Accepts full PEM armor or bare base64 body; returns PKCS#8 DER bytes. */
function pemToPkcs8Der(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

/**
 * Cache key for the provider JWT: it must change whenever ANY credential
 * changes, and two different credential sets must never map to one key.
 *
 * Length-prefixed rather than a bare `a|b|c` join. Apple's key and team ids are
 * 10-char alphanumerics today, so a separator cannot appear in them and a plain
 * join happens to be safe — but "happens to be safe" is a property of Apple's
 * format, not of this code, and a cache that serves one team's JWT for another
 * team's credentials would be a confusing way to find that out. The framing is
 * injective for any input instead.
 */
export function jwtFingerprint(env: Env): string {
  return [
    env.APNS_KEY_ID ?? '',
    env.APNS_TEAM_ID ?? '',
    hashHex(env.APNS_AUTH_KEY ?? '').slice(0, 16),
  ]
    .map((part) => `${part.length}:${part}`)
    .join('|');
}

/**
 * The cached APNs provider JWT: ES256 over {iss: teamId, iat}, kid in the
 * header, signed with the .p8 key. Re-minted when the cache is older than
 * APNS_JWT_TTL_SECONDS or the credentials changed. `nowMs` is injectable so
 * tests pin cache reuse/refresh exactly. Throws when unconfigured or the key
 * cannot be imported — callers (sendApnsPush) turn that into a typed outcome.
 */
export async function getApnsJwt(env: Env, nowMs: number = Date.now()): Promise<string> {
  if (!apnsConfigured(env)) throw new Error('APNs is not configured');
  const fingerprint = jwtFingerprint(env);
  if (
    jwtCache &&
    jwtCache.fingerprint === fingerprint &&
    nowMs - jwtCache.mintedAtMs < APNS_JWT_TTL_SECONDS * 1000
  ) {
    return jwtCache.token;
  }

  const header = { alg: 'ES256', kid: env.APNS_KEY_ID };
  const claims = { iss: env.APNS_TEAM_ID, iat: Math.floor(nowMs / 1000) };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;

  const der = pemToPkcs8Der(env.APNS_AUTH_KEY!);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto ECDSA emits the raw r||s (64-byte) signature — exactly the JOSE
  // ES256 format, no DER re-encoding needed.
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  const token = `${signingInput}.${b64url(sig)}`;
  jwtCache = { token, mintedAtMs: nowMs, fingerprint };
  return token;
}

// ── Send path ─────────────────────────────────────────────────────────────────

function defaultCollapseId(push: ApnsPushMessage): string {
  if (push.collapseId) return push.collapseId.slice(0, 64);
  if (push.kind === 'digest') return 'pd-interruptions-digest';
  return (push.interruptionId ? `pd-oi-${push.interruptionId}` : 'pd-interruptions').slice(0, 64);
}

function buildApnsBody(push: ApnsPushMessage): Record<string, unknown> {
  const loud = apnsPriority(push.urgency) === '10';
  return {
    aps: {
      alert: { title: push.title, ...(push.body ? { body: push.body } : {}) },
      ...(loud ? { sound: 'default' } : {}),
      'thread-id': 'pd-interruptions',
    },
    source: 'port-daddy-relay/interruptions',
    kind: push.kind,
    interruption_id: push.interruptionId ?? null,
    ...(push.openCount !== undefined ? { open_count: push.openCount } : {}),
    ...(push.nagCount !== undefined ? { nag_count: push.nagCount } : {}),
    url: '/account/interruptions',
  };
}

function parseRetryAfterSec(res: Response): number | null {
  const raw = res.headers.get('Retry-After');
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, RETRY_AFTER_CAP_SECONDS);
  return null;
}

/** Best-effort {reason} from an APNs error body. Never throws. */
async function apnsReason(res: Response): Promise<string | null> {
  try {
    const parsed = (await res.json()) as { reason?: unknown };
    return typeof parsed.reason === 'string' ? parsed.reason : null;
  } catch {
    return null;
  }
}

/** Mark a device token dead in D1 (best-effort; a lost mark just costs one 410). */
async function markTokenDead(env: Env, deviceToken: string, nowSec: number): Promise<void> {
  try {
    await env.DB.prepare(
      'UPDATE apns_device_tokens SET dead_at = ? WHERE token = ? AND dead_at IS NULL',
    )
      .bind(nowSec, deviceToken.toLowerCase())
      .run();
  } catch {
    // Registry write is best-effort; delivery accounting never depends on it.
  }
}

/**
 * One notification to one device. Exactly ONE attempt — the nag engine's
 * "retry next sweep at the same stage" dedupe is the retry loop, matching the
 * webhook transport's sweep-level semantics. Never throws.
 */
export async function sendApnsPush(
  deviceToken: string,
  push: ApnsPushMessage,
  env: Env,
  nowMs: number = Date.now(),
): Promise<ApnsSendOutcome> {
  if (!apnsConfigured(env)) return { kind: 'config-missing' };
  if (!DEVICE_TOKEN_RE.test(deviceToken)) {
    return { kind: 'failed', status: 0, reason: 'malformed device token' };
  }

  let jwt: string;
  try {
    jwt = await getApnsJwt(env, nowMs);
  } catch (e) {
    // An unimportable .p8 is a config problem, not a transient — do not retry
    // in-call, and never throw into the sweep.
    return { kind: 'failed', status: 0, reason: `jwt-mint: ${msg(e)}` };
  }

  const host = env.APNS_HOST?.trim().replace(/\/+$/, '') || DEFAULT_APNS_HOST;
  let res: Response;
  try {
    res = await fetch(`${host}/3/device/${deviceToken.toLowerCase()}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': env.APNS_TOPIC!,
        'apns-push-type': 'alert',
        'apns-priority': apnsPriority(push.urgency),
        'apns-collapse-id': defaultCollapseId(push),
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildApnsBody(push)),
      signal: AbortSignal.timeout(APNS_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'retryable', retryAfterSec: null }; // network / timeout
  }

  if (res.ok) return { kind: 'delivered' };

  const nowSec = Math.floor(nowMs / 1000);
  if (res.status === 410) {
    // Unregistered: the app was deleted or the token rotated. Stop paying.
    await markTokenDead(env, deviceToken, nowSec);
    return { kind: 'token-gone' };
  }
  if (res.status === 429 || res.status >= 500) {
    return { kind: 'retryable', retryAfterSec: parseRetryAfterSec(res) };
  }

  const reason = await apnsReason(res);
  if (res.status === 400 && reason === 'BadDeviceToken') {
    await markTokenDead(env, deviceToken, nowSec);
    return { kind: 'token-gone' };
  }
  if (res.status === 403) {
    // Expired/InvalidProviderToken: drop the cached JWT so the next sweep
    // mints fresh; retryable at the sweep's own cadence.
    resetApnsJwtCache();
    return { kind: 'retryable', retryAfterSec: null };
  }
  return { kind: 'failed', status: res.status, reason };
}

// ── The interruption-lifecycle hook ──────────────────────────────────────────

/**
 * Fan one page decision out to every live device the operator registered.
 * Called by the nag sweep at its existing delivery decision points ONLY — the
 * pushes therefore ride the interruption engine's decaying full-jitter
 * schedule (next_nag_at), never a schedule of their own.
 *
 * Returns { attempted, delivered }: `delivered` is true when AT LEAST ONE
 * device accepted the page — the bit the sweep folds into its transport-
 * agnostic "delivered" that advances stages and writes the ledger.
 * config-missing, a registry read failure, or zero live tokens all come back
 * as { attempted: false, delivered: false } — a silent no-op, never a throw.
 */
export async function sendInterruptionPushes(
  env: Env,
  userId: string,
  push: ApnsPushMessage,
): Promise<{ attempted: boolean; delivered: boolean }> {
  if (!apnsConfigured(env)) return { attempted: false, delivered: false };

  let tokens: string[] = [];
  try {
    const r = await env.DB.prepare(
      'SELECT token FROM apns_device_tokens WHERE user_id = ? AND dead_at IS NULL ORDER BY last_seen_at DESC LIMIT ?',
    )
      .bind(userId, MAX_PUSH_DEVICES)
      .all<{ token: string }>();
    tokens = (r.results ?? []).map((t) => t.token);
  } catch {
    return { attempted: false, delivered: false };
  }
  if (tokens.length === 0) return { attempted: false, delivered: false };

  let delivered = false;
  for (const token of tokens) {
    const outcome = await sendApnsPush(token, push, env);
    if (outcome.kind === 'delivered') delivered = true;
    // token-gone already marked dead; retryable/failed ride the sweep's
    // same-stage retry dedupe — no in-call retry, no extra state.
  }
  return { attempted: true, delivered };
}

// ── Device registration API ──────────────────────────────────────────────────

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

interface DeviceRow {
  user_id: string;
  device_id: string;
  token: string;
  platform: string;
  created_at: number;
  last_seen_at: number;
  dead_at: number | null;
}

function publicDevice(row: DeviceRow): Record<string, unknown> {
  return {
    deviceId: row.device_id,
    platform: row.platform,
    // Suffix only — the registry never echoes a full push token back out.
    tokenSuffix: row.token.slice(-8),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    dead: row.dead_at !== null,
  };
}

/**
 * POST /v1/push/apns/devices — register (or refresh) a device token, bound to
 * the authenticated account + device. Idempotent per (user, device): the same
 * device re-registering replaces its token and clears dead_at. A token that
 * moved to a different device/account evicts its old row first (one token =
 * one live device+app instance, APNs' own model).
 */
export async function handleRegisterApnsDevice(request: Request, env: Env): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return json(401, { code: 'UNAUTHENTICATED', error: 'a pdu_ bearer token or session is required' });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'body must be JSON' });
  }
  if (typeof raw !== 'object' || raw === null) {
    return json(400, { code: 'BAD_REQUEST', error: 'body must be a JSON object' });
  }
  const b = raw as Record<string, unknown>;

  const token = typeof b.device_token === 'string' ? b.device_token.trim().toLowerCase() : '';
  if (!DEVICE_TOKEN_RE.test(token)) {
    return json(400, { code: 'BAD_REQUEST', error: 'device_token must be the hex APNs token' });
  }
  const deviceId = typeof b.device_id === 'string' ? b.device_id.trim() : '';
  if (!deviceId || deviceId.length > DEVICE_ID_MAX) {
    return json(400, { code: 'BAD_REQUEST', error: `device_id is required (1..${DEVICE_ID_MAX} chars)` });
  }
  const platform: ApnsPlatform =
    typeof b.platform === 'string' && (PLATFORMS as readonly string[]).includes(b.platform)
      ? (b.platform as ApnsPlatform)
      : 'ios';

  const now = Math.floor(Date.now() / 1000);
  // A token belongs to exactly one live (device, account) — evict stale claims.
  await env.DB.prepare(
    'DELETE FROM apns_device_tokens WHERE token = ? AND NOT (user_id = ? AND device_id = ?)',
  )
    .bind(token, user.id, deviceId)
    .run();
  await env.DB.prepare(
    `INSERT INTO apns_device_tokens (user_id, device_id, token, platform, created_at, last_seen_at, dead_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (user_id, device_id) DO UPDATE SET
       token = excluded.token, platform = excluded.platform,
       last_seen_at = excluded.last_seen_at, dead_at = NULL`,
  )
    .bind(user.id, deviceId, token, platform, now, now)
    .run();

  return json(200, {
    code: 'OK',
    error: null,
    device: { deviceId, platform, tokenSuffix: token.slice(-8), createdAt: now, lastSeenAt: now, dead: false },
  });
}

/** DELETE /v1/push/apns/devices/:deviceId — unregister (idempotent). */
export async function handleUnregisterApnsDevice(
  request: Request,
  env: Env,
  deviceId: string,
): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return json(401, { code: 'UNAUTHENTICATED', error: 'a pdu_ bearer token or session is required' });
  const res = await env.DB.prepare(
    'DELETE FROM apns_device_tokens WHERE user_id = ? AND device_id = ?',
  )
    .bind(user.id, deviceId)
    .run();
  return json(200, { code: 'OK', error: null, removed: res.meta?.changes ?? 0 });
}

/** GET /v1/push/apns/devices — the account's devices (the future Devices page). */
export async function handleListApnsDevices(request: Request, env: Env): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return json(401, { code: 'UNAUTHENTICATED', error: 'a pdu_ bearer token or session is required' });
  const r = await env.DB.prepare(
    `SELECT user_id, device_id, token, platform, created_at, last_seen_at, dead_at
     FROM apns_device_tokens WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 50`,
  )
    .bind(user.id)
    .all<DeviceRow>();
  const rows = r.results ?? [];
  return json(200, { code: 'OK', error: null, devices: rows.map(publicDevice) });
}
