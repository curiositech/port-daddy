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

import { randomHex, hashHex, fromHex, base64UrlEncode, base64UrlDecode } from './crypto.js';
import {
  getWebSession,
  upsertUser,
  createWebSession,
  deleteWebSession,
  countUserSessions,
  eraseUser,
  listShipwrightMessages,
  type UserRow,
} from './db.js';
import type { Env } from './types.js';
// Import cycle note: roadmap-mirror.ts imports isSameOrigin from this module
// and this module imports exportRoadmapMirrors back. Both bindings are hoisted
// function declarations used only at request time, so the ESM cycle is inert
// by design — flagged here so a refactor does not accidentally make either
// side a top-level evaluation.
import { exportRoadmapMirrors } from './roadmap-mirror.js';

// External GitHub JSON shapes (OAuth token endpoint + REST). These are a trust
// boundary: rather than `as`-casting `unknown` JSON into a type and hoping,
// each response is run through a parse-guard that validates every consumed
// field and returns null (or []) on any mismatch — the same tri-state parse
// idiom the executor uses for model output (parseShipFindings). Fail-closed.
interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
}
interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}
interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}
const orNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function parseGitHubToken(x: unknown): GitHubTokenResponse | null {
  if (!isRecord(x)) return null;
  if (x.access_token !== undefined && typeof x.access_token !== 'string') return null;
  return {
    access_token: typeof x.access_token === 'string' ? x.access_token : undefined,
    error: typeof x.error === 'string' ? x.error : undefined,
  };
}

function parseGitHubUser(x: unknown): GitHubUser | null {
  if (!isRecord(x)) return null;
  if (typeof x.id !== 'number' || typeof x.login !== 'string') return null;
  return { id: x.id, login: x.login, name: orNull(x.name), avatar_url: orNull(x.avatar_url), email: orNull(x.email) };
}

function parseGitHubEmail(x: unknown): GitHubEmail | null {
  if (!isRecord(x)) return null;
  if (typeof x.email !== 'string' || typeof x.primary !== 'boolean' || typeof x.verified !== 'boolean') return null;
  return { email: x.email, primary: x.primary, verified: x.verified };
}

function parseGitHubEmails(x: unknown): GitHubEmail[] {
  if (!Array.isArray(x)) return [];
  return x.map(parseGitHubEmail).filter((e): e is GitHubEmail => e !== null);
}

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

/**
 * An Env in which GitHub login is fully configured. `loginConfigured` narrows
 * `Env` to this, so downstream code reads the four fields as `string` — no `as`
 * casts, and adding a fifth required field is a compile error until every call
 * site is updated.
 */
type ConfiguredLoginEnv = Env & {
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  USER_TOKEN_WRAPPING_KEY: string;
  PUBLIC_BASE_URL: string;
};

/** Type guard: narrows Env to ConfiguredLoginEnv when all four values are set. */
function loginConfigured(env: Env): env is ConfiguredLoginEnv {
  return Boolean(
    env.GITHUB_OAUTH_CLIENT_ID &&
      env.GITHUB_OAUTH_CLIENT_SECRET &&
      env.USER_TOKEN_WRAPPING_KEY &&
      env.PUBLIC_BASE_URL,
  );
}

/** Redirect_uri is an EXACT registered value — never derived from the request. */
function redirectUri(env: ConfiguredLoginEnv): string {
  const base = env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  return `${base}/auth/github/callback`;
}

// ── AES-GCM envelope for the GitHub user-to-server token ──────────────────────

async function wrapKey(wrappingKeyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromHex(wrappingKeyHex), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

async function sealToken(env: ConfiguredLoginEnv, token: string): Promise<{ enc: string; iv: string }> {
  const key = await wrapKey(env.USER_TOKEN_WRAPPING_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
  );
  return { enc: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

async function openToken(wrappingKeyHex: string, enc: string, iv: string): Promise<string | null> {
  try {
    const key = await wrapKey(wrappingKeyHex);
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

/**
 * The web session's OAuth scope. `repo` is required — not merely
 * convenient — because every repo-access check this session's token backs
 * (`userCanReadRepo`, `userIsRepoAdmin` in this file) calls
 * `GET /repos/:owner/:repo` and treats a 404 as "not readable." GitHub
 * returns 404 (not 403) for a private repository the token's scope can't
 * see, which is indistinguishable from the repo not existing — so a token
 * scoped to only `read:user user:email` silently fails every private-repo
 * check, including a repo the user personally owns. `permissions.admin` in
 * that same response (which `userIsRepoAdmin` reads) is also only populated
 * for a sufficiently-scoped, authenticated request. `public_repo` alone
 * would fix public repos but not private ones, which is exactly the
 * lockout an operator with private repos hits.
 */
const WEB_SESSION_SCOPE = 'read:user user:email repo';

/** GET /auth/github/login — mint single-use state, 302 to GitHub. */
export async function handleGithubLogin(request: Request, env: Env): Promise<Response> {
  if (!loginConfigured(env)) return json(503, { code: 'LOGIN_UNCONFIGURED', error: 'GitHub login is not configured' });

  const state = randomHex(32);
  // Single-use: stored in KV with a short TTL, consumed exactly once at callback.
  await env.KV.put(`oauth_state:${state}`, '1', { expirationTtl: STATE_TTL_SECONDS });

  const url = new URL(GH_AUTHORIZE);
  url.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri(env));
  url.searchParams.set('scope', WEB_SESSION_SCOPE);
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
  const tok = parseGitHubToken(await tokRes.json());
  if (!tok?.access_token) return json(502, { code: 'TOKEN_EXCHANGE_FAILED', error: tok?.error ?? 'no access_token' });
  const accessToken = tok.access_token;

  // Identity from GET /user (+ verified primary email). GitHub is OAuth2, not
  // OIDC: there is no id_token to validate.
  const userRes = await fetch(`${GH_API}/user`, { headers: ghHeaders(accessToken) });
  if (!userRes.ok) return json(502, { code: 'USERINFO_FAILED', error: 'GET /user failed' });
  const ghUser = parseGitHubUser(await userRes.json());
  if (!ghUser) return json(502, { code: 'USERINFO_FAILED', error: 'GET /user returned an unexpected shape' });

  let primaryEmail: string | null = ghUser.email;
  let emailVerified = false;
  const emailRes = await fetch(`${GH_API}/user/emails`, { headers: ghHeaders(accessToken) });
  if (emailRes.ok) {
    const emails = parseGitHubEmails(await emailRes.json());
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
  const { enc, iv } = await sealToken(env, accessToken);
  await createWebSession(env.DB, {
    tokenHash: hashHex(sessionValue),
    userId: user.id,
    ghTokenEnc: enc,
    ghTokenIv: iv,
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
    userAgent: request.headers.get('User-Agent'),
  });

  // Land the freshly-signed-in user on their account page (not the bare root).
  const dest = (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '') + '/account';
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

/**
 * GET /auth/status — the minimal signed-in probe for the marketing site's
 * header chip (portdaddy.dev fetches this cross-origin with credentials).
 * Session cookie ONLY — this is strictly a browser surface, so pdu_ bearer
 * tokens are deliberately not honored here. The body carries nothing beyond
 * the public GitHub profile pair {login, avatarUrl}: no email, no ids, no
 * token material, no session metadata (no secrets — the response is readable
 * from another origin by design).
 */
export async function handleAuthStatus(request: Request, env: Env): Promise<Response> {
  const resolved = await resolveSession(request, env);
  const body = resolved
    ? { code: 'OK', login: resolved.user.login, avatarUrl: resolved.user.avatar_url }
    : { code: 'UNAUTHENTICATED', login: null, avatarUrl: null };
  return new Response(JSON.stringify(body), {
    status: resolved ? 200 : 401,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function safeOrigin(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

/**
 * Defense-in-depth CSRF guard for state-changing POSTs, layered over the
 * SameSite=Lax session cookie. Browsers always send `Origin` on POST, so a
 * cross-site form/fetch fails this check even if the cookie policy ever loosens.
 * A request with neither `Origin` nor `Referer` is a non-browser client (e.g.
 * curl with an explicit cookie) and is allowed — the Lax cookie already blocks
 * cross-site cookie delivery for browsers.
 */
export function isSameOrigin(request: Request, env: Env): boolean {
  const expected = safeOrigin(env.PUBLIC_BASE_URL) ?? safeOrigin(request.url);
  const origin = request.headers.get('Origin');
  if (origin) return origin === expected;
  const referer = request.headers.get('Referer');
  if (referer) return safeOrigin(referer) === expected;
  return true;
}

/** POST /auth/logout — delete the session and clear the cookie. */
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  const value = readSessionCookie(request);
  if (value) await deleteWebSession(env.DB, hashHex(value));
  return new Response(JSON.stringify({ code: 'OK', error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionSetCookie('', 0) },
  });
}

// ── Self-service account export + erasure (ADR-0101 team-tier controls) ───────

/**
 * GET /account/export — the signed-in user downloads their own stored data
 * (team tier). Returns the user row + session metadata; NEVER the sealed GitHub
 * token or any other user's data. This is the export half of the tenancy
 * export/delete gate for the team tier.
 */
export async function handleAccountExport(request: Request, env: Env): Promise<Response> {
  const resolved = await resolveSession(request, env);
  if (!resolved) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  const { user } = resolved;
  const sessionCount = await countUserSessions(env.DB, user.id);
  // Shipwright conversation history is the user's own content — it leaves with
  // them (ADR-0101 export control). Bounded to the same window the chat reads.
  const shipwrightChats = (await listShipwrightMessages(env.DB, user.id, 500)).map((m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.created_at,
  }));
  // Roadmap mirrors are the user's own pushed roadmaps (ADR-0101 Critical-2
  // export/delete matrix, team tier) — all four mirror tables leave with them.
  const roadmapMirrors = await exportRoadmapMirrors(env, user.id);
  const body = {
    code: 'OK',
    error: null,
    exportedAt: Math.floor(Date.now() / 1000),
    account: {
      id: user.id,
      githubUserId: user.github_user_id,
      login: user.login,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      email: user.primary_email,
      emailVerified: user.email_verified === 1,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    },
    sessions: { active: sessionCount },
    shipwrightChats,
    roadmapMirrors,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="port-daddy-account-${user.id}.json"`,
    },
  });
}

/**
 * POST /account/delete — the signed-in user erases their own account (team
 * tier). Soft-deletes the row + nulls PII now, purges every session (logs out
 * everywhere), clears this cookie; a retention job hard-deletes within 30 days.
 */
export async function handleAccountDelete(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  const resolved = await resolveSession(request, env);
  if (!resolved) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  const purged = await eraseUser(env.DB, resolved.user.id, Math.floor(Date.now() / 1000));
  return new Response(JSON.stringify({ code: 'OK', error: null, erased: true, sessionsPurged: purged }), {
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
  // The wrapping key is required to decrypt the gh token; without it (login
  // unconfigured) there is no token to hand back, but the session still resolves.
  const ghToken =
    env.USER_TOKEN_WRAPPING_KEY && row.gh_token_enc && row.gh_token_iv
      ? await openToken(env.USER_TOKEN_WRAPPING_KEY, row.gh_token_enc, row.gh_token_iv)
      : null;
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

/**
 * Does the session's user have ADMIN permission on `owner/repo`, per GitHub's
 * own judgment? Reads the same `GET /repos/:owner/:repo` response
 * `userCanReadRepo` already makes (its `permissions.admin` field reflects the
 * CALLING user's own access level, not the repo's public visibility), cached
 * separately in KV for 5 minutes keyed by (user_id, repo).
 *
 * Why this exists: `repo_settings` writes that only affect the writer's own
 * account (e.g. the sitrep dial) only need read access to gate against
 * enumeration. A setting fleet-executor treats as authoritative for EVERY
 * user of a repository — like the Workers AI call deadline — is different: a
 * mere read-access gate would let any GitHub user who can merely see a public
 * repository silently change execution behavior for every installation that
 * reviews it (the DO-NOT-SHIP finding on PR #9800). Requiring admin here is
 * the cheapest correct gate available without building a real
 * installation-authority record; `userOwnsInstallation` was considered but
 * would need an App-authenticated (not user-token) lookup this handler does
 * not otherwise make, and is deliberately left as a named follow-up.
 *
 * @param env - Worker bindings (KV cache, used the same way as userCanReadRepo).
 * @param session - The resolved session carrying the caller's GitHub token.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @returns True iff GitHub reports `permissions.admin: true` for this user.
 */
export async function userIsRepoAdmin(
  env: Env,
  session: ResolvedSession,
  owner: string,
  repo: string,
): Promise<boolean> {
  if (!session.ghToken) return false;
  const cacheKey = `repo_admin:${session.user.id}:${owner}/${repo}`;
  const cached = await env.KV.get(cacheKey);
  if (cached === '1') return true;
  if (cached === '0') return false;
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}`, { headers: ghHeaders(session.ghToken) });
  let admin = false;
  if (res.status === 200) {
    const body = await res.json().catch(() => null) as { permissions?: { admin?: boolean } } | null;
    admin = body?.permissions?.admin === true;
  }
  await env.KV.put(cacheKey, admin ? '1' : '0', { expirationTtl: 300 });
  return admin;
}

/**
 * Does the session's user have access to GitHub App installation `installationId`?
 * GitHub is the single source of truth: `GET /user/installations` lists exactly
 * the app installations the authenticated user can act on. Fail-closed (no token
 * → false), cached in KV for 5 minutes keyed by (user_id, installationId). This
 * is the tenant-ownership gate for the billing endpoints (ADR-0116): a signed-in
 * user may only touch billing for an installation GitHub says they own.
 */
export async function userOwnsInstallation(
  env: Env,
  session: ResolvedSession,
  installationId: number,
): Promise<boolean> {
  if (!session.ghToken) return false;
  const cacheKey = `inst_owner:${session.user.id}:${installationId}`;
  const cached = await env.KV.get(cacheKey);
  if (cached === '1') return true;
  if (cached === '0') return false;
  // Paginate defensively; a user with 100+ installations is unusual but possible.
  let ok = false;
  for (let page = 1; page <= 5 && !ok; page++) {
    const res = await fetch(`${GH_API}/user/installations?per_page=100&page=${page}`, {
      headers: ghHeaders(session.ghToken),
    });
    if (!res.ok) break;
    const body = (await res.json()) as { installations?: Array<{ id?: number }> };
    const list = Array.isArray(body.installations) ? body.installations : [];
    if (list.some((i) => i.id === installationId)) ok = true;
    if (list.length < 100) break; // last page
  }
  await env.KV.put(cacheKey, ok ? '1' : '0', { expirationTtl: 300 });
  return ok;
}

/** One GitHub App installation the signed-in user can act on. */
export interface UserInstallation {
  id: number;
  /** The org/user the app is installed on (e.g. 'acme'); null if GitHub omits it. */
  accountLogin: string | null;
  /** 'Organization' | 'User' per GitHub; null if omitted. */
  accountType: string | null;
}

function parseUserInstallation(x: unknown): UserInstallation | null {
  if (!isRecord(x) || typeof x.id !== 'number' || !Number.isInteger(x.id) || x.id <= 0) return null;
  const account = isRecord(x.account) ? x.account : null;
  return {
    id: x.id,
    accountLogin: account ? orNull(account.login) : null,
    accountType: account ? orNull(account.type) : null,
  };
}

/**
 * List the GitHub App installations the session's user can act on — the SAME
 * `GET /user/installations` source of truth `userOwnsInstallation` gates on, so
 * the billing page can only ever surface installations GitHub says are the
 * user's own (tenant boundary, ADR-0116). Returns `null` (never `[]`) when the
 * list could not be established — no token, GitHub error, unparseable body — so
 * callers can render an honest "unknown" instead of a fabricated empty state
 * (D12: reads degrade with reasons). Each returned id also warms the
 * `inst_owner` KV cache the ownership gate reads.
 */
export async function listUserInstallations(
  env: Env,
  session: ResolvedSession,
): Promise<UserInstallation[] | null> {
  if (!session.ghToken) return null;
  const out: UserInstallation[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${GH_API}/user/installations?per_page=100&page=${page}`, {
      headers: ghHeaders(session.ghToken),
    });
    if (!res.ok) return null; // degraded, not empty — fail with "unknown"
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return null;
    }
    const list =
      isRecord(body) && Array.isArray(body.installations) ? body.installations : null;
    if (!list) return null;
    for (const raw of list) {
      const inst = parseUserInstallation(raw);
      if (inst) out.push(inst);
    }
    if (list.length < 100) break; // last page
  }
  // Positive-only cache warm: these ids just came from GitHub for this user.
  for (const inst of out) {
    await env.KV.put(`inst_owner:${session.user.id}:${inst.id}`, '1', { expirationTtl: 300 });
  }
  return out;
}
