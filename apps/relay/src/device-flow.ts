/**
 * apps/relay/src/device-flow.ts — GitHub device-flow login for non-browser
 * surfaces (CLI, FleetBar, pd-console), ADR-0101 Phase 1.
 *
 *   POST /auth/device/start   → relay asks GitHub for a device+user code; returns
 *                               { user_code, verification_uri, device_code, interval }.
 *   POST /auth/device/token   → relay polls GitHub with the device_code; once the
 *                               user authorizes, it upserts the user and mints a
 *                               `pdu_` personal access token (only its hash stored
 *                               in user_tokens). Returns { token } exactly once.
 *   GET  /auth/whoami         → resolves a `Authorization: Bearer pdu_…` token (or
 *                               the browser session cookie) to the user.
 *
 * GitHub tokens never leave the relay: the device flow runs server-side and the
 * client only ever holds its own `pdu_` token (kept in the OS Keychain). The
 * device flow requires no client_secret (client_id is public); it does require
 * "Enable Device Flow" on the GitHub App.
 */

import type { Env } from './types.js';
import { randomHex, hashHex } from './crypto.js';
import { upsertUser, createUserToken, resolveUserToken, type UserRow } from './db.js';
import { resolveSession } from './auth-github.js';
import {
  githubTokenKeyring,
  parseGitHubUserCredential,
  sealGitHubUserCredential,
} from './github-user-token.js';

const GH_DEVICE_CODE = 'https://github.com/login/device/code';
const GH_TOKEN = 'https://github.com/login/oauth/access_token';
const GH_API = 'https://api.github.com';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const GITHUB_TIMEOUT_MS = 15_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function ghHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'port-daddy-relay' };
}

function configured(env: Env): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID && env.USER_TOKEN_WRAPPING_KEY);
}

async function fetchGitHub(input: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(input, init);
  } catch {
    return null;
  }
}

/** POST /auth/device/start — get a device + user code from GitHub. */
export async function handleDeviceStart(_request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return json(503, { code: 'LOGIN_UNCONFIGURED', error: 'device login is not configured' });
  const res = await fetchGitHub(GH_DEVICE_CODE, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    // GitHub App user access tokens do not use OAuth scopes. Their authority
    // is the intersection of the App installation and the authorizing user.
    body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID }),
    redirect: 'error',
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!res?.ok) return json(502, { code: 'DEVICE_START_FAILED', error: 'GitHub device-code request failed' });
  const d = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
  };
  if (!d.device_code || !d.user_code || !d.verification_uri) {
    // Most common cause: "Enable Device Flow" is off on the GitHub App.
    return json(502, { code: 'DEVICE_START_FAILED', error: d.error ?? 'device flow not enabled on the GitHub App' });
  }
  return json(200, {
    code: 'OK',
    device_code: d.device_code,
    user_code: d.user_code,
    verification_uri: d.verification_uri,
    expires_in: d.expires_in ?? 900,
    interval: d.interval ?? 5,
  });
}

interface GhUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}
function parseUser(x: unknown): GhUser | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'number' || typeof o.login !== 'string') return null;
  return {
    id: o.id,
    login: o.login,
    name: typeof o.name === 'string' ? o.name : null,
    avatar_url: typeof o.avatar_url === 'string' ? o.avatar_url : null,
    email: typeof o.email === 'string' ? o.email : null,
  };
}

/**
 * POST /auth/device/token — poll GitHub with the device_code. Returns
 * { pending: true } while the user hasn't authorized yet, or { token } once they
 * have (minted as a pdu_ personal access token bound to their account).
 */
export async function handleDeviceToken(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return json(503, { code: 'LOGIN_UNCONFIGURED', error: 'device login is not configured' });
  let body: { device_code?: string; label?: string };
  try {
    body = (await request.json()) as { device_code?: string; label?: string };
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body with device_code required' });
  }
  if (!body.device_code) return json(400, { code: 'BAD_REQUEST', error: 'device_code required' });

  const res = await fetchGitHub(GH_TOKEN, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID, device_code: body.device_code, grant_type: DEVICE_GRANT }),
    redirect: 'error',
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!res?.ok) return json(502, { code: 'TOKEN_POLL_FAILED', error: 'GitHub token poll failed' });
  const t = (await res.json()) as { access_token?: string; error?: string };

  // GitHub signals not-yet-authorized via an `error` field, not an HTTP status.
  if (!t.access_token) {
    // authorization_pending | slow_down | expired_token | access_denied
    const pending = t.error === 'authorization_pending' || t.error === 'slow_down';
    return json(pending ? 200 : 400, { code: pending ? 'PENDING' : 'DEVICE_ERROR', pending, error: t.error ?? 'no access_token' });
  }

  const now = Math.floor(Date.now() / 1000);
  let credential;
  try {
    credential = parseGitHubUserCredential(t, 'device', now);
  } catch {
    return json(502, { code: 'TOKEN_EXCHANGE_FAILED', error: 'GitHub did not return a valid App user credential' });
  }

  // Authorized. Resolve identity, upsert the user, mint a pdu_ token.
  const userRes = await fetchGitHub(`${GH_API}/user`, {
    headers: ghHeaders(credential.accessToken),
    redirect: 'error',
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!userRes?.ok) return json(502, { code: 'USERINFO_FAILED', error: 'GET /user failed' });
  const gh = parseUser(await userRes.json());
  if (!gh) return json(502, { code: 'USERINFO_FAILED', error: 'GET /user returned an unexpected shape' });

  let primaryEmail = gh.email;
  let emailVerified = false;
  const emailRes = await fetchGitHub(`${GH_API}/user/emails`, {
    headers: ghHeaders(credential.accessToken),
    redirect: 'error',
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (emailRes?.ok) {
    const emails = (await emailRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
    const chosen = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (chosen) {
      primaryEmail = chosen.email;
      emailVerified = chosen.verified;
    }
  }

  const user = await upsertUser(env.DB, {
    githubUserId: gh.id,
    login: gh.login,
    displayName: gh.name,
    avatarUrl: gh.avatar_url,
    primaryEmail,
    emailVerified,
    now,
  });

  const token = `pdu_${randomHex(32)}`;
  const tokenHash = hashHex(token);
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : 'pd device token';
  const wrapped = await sealGitHubUserCredential(githubTokenKeyring(env), {
    kind: 'device-token',
    rowId: tokenHash,
    userId: user.id,
  }, credential);
  await createUserToken(env.DB, {
    tokenHash,
    userId: user.id,
    label,
    createdAt: now,
    expiresAt: null,
    ghCredentialEnc: wrapped.enc,
    ghCredentialIv: wrapped.iv,
    ghCredentialKeyVersion: wrapped.keyVersion,
  });

  return json(200, { code: 'OK', pending: false, token, login: user.login });
}

/** Read a `Authorization: Bearer pdu_…` token from the request, or null. */
export function readBearerToken(request: Request): string | null {
  const h = request.headers.get('Authorization');
  if (!h) return null;
  const m = h.match(/^Bearer\s+(pdu_[0-9a-f]{64})$/i);
  return m?.[1] ?? null;
}

/**
 * Resolve a request to its user via EITHER a pdu_ bearer token or the browser
 * session cookie. Bearer wins when present. Returns null if neither authenticates.
 */
export async function resolveUserFromRequest(request: Request, env: Env): Promise<UserRow | null> {
  const bearer = readBearerToken(request);
  if (bearer) return resolveUserToken(env.DB, hashHex(bearer), Math.floor(Date.now() / 1000));
  const session = await resolveSession(request, env);
  return session?.user ?? null;
}

/** GET /auth/whoami — the user behind a pdu_ bearer or the session cookie. */
export async function handleWhoami(request: Request, env: Env): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return json(401, { code: 'UNAUTHENTICATED', error: 'no session or token' });
  return json(200, {
    code: 'OK',
    user: {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      email: user.primary_email,
      emailVerified: user.email_verified === 1,
    },
  });
}
