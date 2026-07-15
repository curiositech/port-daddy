/**
 * GitHub login — Backend-For-Frontend (ADR-0101 Phase 1).
 *
 * The relay is a CONFIDENTIAL OAuth client: it holds the client secret and the
 * GitHub user-to-server token server-side, and the browser only ever receives
 * an opaque, HttpOnly `__Host-pd_session` cookie. No token, no client
 * credential, and no localStorage ever touch the browser (OAuth 2.1 + the IETF
 * browser-based-apps BCP: BFF pattern).
 *
 * GitHub is OAuth 2.0, NOT OIDC — there is no id_token and no `nonce`. Identity
 * comes from GET /user after the code exchange. CSRF on the redirect is
 * defended by a single-use `state` (minted here, stored in KV with a TTL, and
 * consumed exactly once at the callback). The redirect_uri is an exact match of
 * a value the GitHub App has registered.
 *
 *   GET  /auth/github/login     → 302 to GitHub authorize (state minted)
 *   GET  /auth/github/callback  → exchange code, upsert user, set session cookie
 *   GET  /auth/me               → { user } for the current session, or 401
 *   POST /auth/logout           → delete session, clear cookie
 *
 * Credentials reuse the existing GitHub App's OAuth client (no second app):
 *   GITHUB_OAUTH_CLIENT_ID  (var)     GITHUB_OAUTH_CLIENT_SECRET (secret)
 *   USER_TOKEN_WRAPPING_KEY (secret, 32-byte hex; AES-GCM wraps the gh token)
 *   PUBLIC_BASE_URL         (var, the relay's public origin; redirect_uri base)
 */

import { randomHex, hashHex, fromHex, toHex, base64UrlEncode, base64UrlDecode } from './crypto.js';
import { getWebSession, upsertUser, createWebSession, deleteWebSession, type UserRow } from './db.js';
import type { Env } from './types.js';

const SESSION_COOKIE = '__Host-pd_session';
const STATE_TTL_SECONDS = 600; // 10 min to complete the redirect round-trip
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const GH_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GH_TOKEN = 'https://github.com/login/oauth/access_token';
const GH_API = 'https://api.github.com';

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'port-daddy-relay',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Redirect_uri is an EXACT registered value — never derived from the request. */
function redirectUri(env: Env): string {
  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/auth/github/callback`;
}

function loginConfigured(env: Env): boolean {
  return Boolean(
    env.GITHUB_OAUTH_CLIENT_ID &&
      env.GITHUB_OAUTH_CLIENT_SECRET &&
      env.USER_TOKEN_WRAPPING_KEY &&
      env.PUBLIC_BASE_URL,
  );
}

// ── AES-GCM envelope for the GitHub user-to-server token ──────────────────────

async function wrapKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromHex(env.USER_TOKEN_WRAPPING_KEY as string), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

async function sealToken(env: Env, token: string): Promise<{ enc: string; iv: string }> {
  const key = await wrapKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
  );
  return { enc: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

async function openToken(env: Env, enc: string, iv: string): Promise<string | null> {
  try {
    const key = await wrapKey(env);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlDecode(iv) },
      key,
      base64UrlDecode(enc),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

/** __Host- prefix REQUIRES Secure + Path=/ + no Domain; browsers reject otherwise. */
function sessionSetCookie(value: string, maxAge: number): string {
  return (
    `${SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`
  );
}

function readSessionCookie(request: Request): string | null {
  const raw = request.headers.get('Cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/** GET /auth/github/login — mint single-use state, 302 to GitHub. */
export async function handleGithubLogin(request: Request, env: Env): Promise<Response> {
  if (!loginConfigured(env)) return json(503, { code: 'LOGIN_UNCONFIGURED', error: 'GitHub login is not configured' });

  const state = randomHex(32);
  // Single-use: stored in KV with a short TTL, consumed exactly once at callback.
  await env.KV.put(`oauth_state:${state}`, '1', { expirationTtl: STATE_TTL_SECONDS });

  const url = new URL(GH_AUTHORIZE);
  url.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID as string);
  url.searchParams.set('redirect_uri', redirectUri(env));
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return Response.redirect(url.toString(), 302);
}

/** GET /auth/github/callback — validate state, exchange code, set session. */
export async function handleGithubCallback(request: Request, env: Env): Promise<Response> {
  if (!loginConfigured(env)) return json(503, { code: 'LOGIN_UNCONFIGURED', error: 'GitHub login is not configured' });

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return json(400, { code: 'BAD_REQUEST', error: 'code and state required' });

  // CSRF: the state must be one we minted, and it is consumed exactly once.
  const stateKey = `oauth_state:${state}`;
  const seen = await env.KV.get(stateKey);
  if (!seen) return json(400, { code: 'BAD_STATE', error: 'state did not match or expired (possible CSRF)' });
  await env.KV.delete(stateKey);

  // Exchange the authorization code for a user-to-server token.
  const tokRes = await fetch(GH_TOKEN, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri(env),
    }),
  });
  if (!tokRes.ok) return json(502, { code: 'TOKEN_EXCHANGE_FAILED', error: 'GitHub token exchange failed' });
  const tok = (await tokRes.json()) as { access_token?: string; error?: string };
  if (!tok.access_token) return json(502, { code: 'TOKEN_EXCHANGE_FAILED', error: tok.error ?? 'no access_token' });

  // Identity from GET /user (+ verified primary email). GitHub is OAuth2, not
  // OIDC: there is no id_token to validate.
  const userRes = await fetch(`${GH_API}/user`, { headers: ghHeaders(tok.access_token) });
  if (!userRes.ok) return json(502, { code: 'USERINFO_FAILED', error: 'GET /user failed' });
  const ghUser = (await userRes.json()) as {
    id: number;
    login: string;
    name?: string | null;
    avatar_url?: string | null;
    email?: string | null;
  };

  let primaryEmail: string | null = ghUser.email ?? null;
  let emailVerified = false;
  const emailRes = await fetch(`${GH_API}/user/emails`, { headers: ghHeaders(tok.access_token) });
  if (emailRes.ok) {
    const emails = (await emailRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
    const chosen = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (chosen) {
      primaryEmail = chosen.email;
      emailVerified = chosen.verified;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const user = await upsertUser(env.DB, {
    githubUserId: ghUser.id,
    login: ghUser.login,
    displayName: ghUser.name ?? null,
    avatarUrl: ghUser.avatar_url ?? null,
    primaryEmail,
    emailVerified,
    now,
  });

  // Opaque session id; only its SHA-256 is stored. The gh token is sealed.
  const sessionValue = randomHex(32);
  const { enc, iv } = await sealToken(env, tok.access_token);
  await createWebSession(env.DB, {
    tokenHash: hashHex(sessionValue),
    userId: user.id,
    ghTokenEnc: enc,
    ghTokenIv: iv,
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
    userAgent: request.headers.get('User-Agent'),
  });

  const dest = (env.PUBLIC_BASE_URL ?? '/').replace(/\/+$/, '') + '/';
  return new Response(null, {
    status: 302,
    headers: { Location: dest, 'Set-Cookie': sessionSetCookie(sessionValue, SESSION_TTL_SECONDS) },
  });
}

/** GET /auth/me — the signed-in user, or 401. Never returns the gh token. */
export async function handleAuthMe(request: Request, env: Env): Promise<Response> {
  const resolved = await resolveSession(request, env);
  if (!resolved) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  const { user } = resolved;
  return json(200, {
    code: 'OK',
    error: null,
    user: {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      email: user.primary_email,
      emailVerified: user.email_verified === 1,
    },
  });
}

/** POST /auth/logout — delete the session and clear the cookie. */
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const value = readSessionCookie(request);
  if (value) await deleteWebSession(env.DB, hashHex(value));
  return new Response(JSON.stringify({ code: 'OK', error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionSetCookie('', 0) },
  });
}

// ── Session resolution + repo-access authz (used by the run page) ─────────────

export interface ResolvedSession {
  user: UserRow;
  /** The decrypted GitHub user-to-server token — repo-access checks ONLY. */
  ghToken: string | null;
}

/** Resolve the __Host-pd_session cookie to a live, unexpired session, or null. */
export async function resolveSession(request: Request, env: Env): Promise<ResolvedSession | null> {
  const value = readSessionCookie(request);
  if (!value) return null;
  const row = await getWebSession(env.DB, hashHex(value));
  if (!row) return null;
  if (row.expires_at <= Math.floor(Date.now() / 1000)) return null;
  const ghToken = row.gh_token_enc && row.gh_token_iv ? await openToken(env, row.gh_token_enc, row.gh_token_iv) : null;
  return { user: row.user, ghToken };
}

/**
 * Does the session's user have read access to `owner/repo` on GitHub? Cached in
 * KV for 5 minutes keyed by (user_id, repo) so GitHub stays the single source of
 * authz truth without a request per page view. 200/404 from GET /repos decides.
 */
export async function userCanReadRepo(
  env: Env,
  session: ResolvedSession,
  owner: string,
  repo: string,
): Promise<boolean> {
  if (!session.ghToken) return false;
  const cacheKey = `repo_access:${session.user.id}:${owner}/${repo}`;
  const cached = await env.KV.get(cacheKey);
  if (cached === '1') return true;
  if (cached === '0') return false;
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}`, { headers: ghHeaders(session.ghToken) });
  const ok = res.status === 200;
  await env.KV.put(cacheKey, ok ? '1' : '0', { expirationTtl: 300 });
  return ok;
}
