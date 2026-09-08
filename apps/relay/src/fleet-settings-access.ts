/** Cloud Fleet administration is distinct from read access and legacy operator roles. */
import { resolveSession, type ResolvedSession } from './auth-github.js';
import { resolveUserTokenReadOnly, type UserRow } from './db.js';
import { hashHex } from './crypto.js';
import type { Env } from './types.js';

/**
 * Purpose: Cloudflare-owned exact numeric IDs, never request headers or usernames.
 * @param user Verified account row from the existing session/token resolver.
 * @param env Worker configuration; absent or malformed means nobody is an admin.
 * @returns Whether this immutable GitHub ID is explicitly allowlisted.
 */
export function isFleetAdmin(user: UserRow, env: Env): boolean {
  const ids = env.FLEET_ADMIN_GITHUB_IDS?.split(',').map(id => id.trim());
  if (!ids?.length || ids.length > 20 || ids.some(id => !/^[1-9]\d*$/.test(id)
    || !Number.isSafeInteger(Number(id)))) return false;
  return ids.includes(String(user.github_user_id));
}

/** Purpose: deny browser CSRF, including requests without a matching Origin.
 * @param request Incoming browser form request.
 * @param env Trusted public origin configuration.
 * @returns True only for an exact same-origin request.
 */
export function fleetSameOrigin(request: Request, env: Env): boolean {
  const origin = new URL(env.PUBLIC_BASE_URL ?? request.url).origin;
  return new URL(request.url).origin === origin && request.headers.get('Origin') === origin;
}

/**
 * Purpose: the old native global-control URL must not bypass the admin allowlist.
 * @param request Existing pdu_ bearer or same-origin authenticated browser request.
 * @param env Trusted Worker bindings/configuration.
 * @returns The authenticated allowlisted user, or a fail-closed response.
 */
export async function fleetAdminOnly(request: Request, env: Env): Promise<UserRow | Response> {
  try {
    const auth = request.headers.get('Authorization');
    let user: UserRow | null;
    if (auth) {
      const token = /^Bearer (pdu_[A-Za-z0-9]+)$/.exec(auth)?.[1];
      user = token ? await resolveUserTokenReadOnly(env.DB, hashHex(token), Math.floor(Date.now() / 1000)) : null;
    } else {
      if (request.method !== 'GET' && !fleetSameOrigin(request, env)) {
        return Response.json({ code: 'CROSS_ORIGIN', error: 'Same-origin form required' }, { status: 403 });
      }
      user = (await resolveSession(request, env))?.user ?? null;
    }
    if (!user) return Response.json({ code: 'UNAUTHORIZED', error: 'Sign in required' }, { status: 401 });
    if (!isFleetAdmin(user, env)) return Response.json({ code: 'FORBIDDEN', error: 'Fleet administrator required' }, { status: 403 });
    return user;
  } catch {
    return Response.json({ code: 'FLEET_AUTH_UNAVAILABLE', error: 'Authorization unavailable' }, { status: 503 });
  }
}

export interface ManagedFleetInstallation { id: number; name: string }
const GH_API = 'https://api.github.com';

/** Purpose: obtain a fresh GitHub authorization witness, never a cached read grant.
 * @param session Verified session holding its own OAuth credential.
 * @param path Server-constructed GitHub API path.
 * @param deadline Shared authorization deadline across pagination.
 * @param missingMembershipIsDenied Treat only a membership 404 as a local denial.
 * @returns GitHub JSON, validated by the caller; failed requests throw.
 */
async function githubRead(session: ResolvedSession, path: string, deadline: AbortSignal, missingMembershipIsDenied = false): Promise<any> {
  if (!session.ghToken) throw new Error('NO_GITHUB_AUTHORIZATION');
  const response = await fetch(`${GH_API}${path}`, {
    headers: { Authorization: `Bearer ${session.ghToken}`, Accept: 'application/vnd.github+json',
      'User-Agent': 'port-daddy-relay', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]),
  });
  // Accessible installations include outside collaborators. Their absent org
  // membership denies that installation, not independently verified controls.
  if (missingMembershipIsDenied && response.status === 404) return null;
  if (!response.ok) throw new Error('GITHUB_AUTHORIZATION_UNAVAILABLE');
  return response.json();
}

/**
 * Purpose: only personal owners or active organization admins may change Fleet.
 * GitHub's accessible-installations list alone is NOT an administration grant.
 * @param session Existing authenticated OAuth session.
 * @param onlyId Optional exact mutation target; still verified against live GitHub.
 * @returns Managed installations; null means unknown, never an empty success.
 */
export async function managedFleetInstallations(session: ResolvedSession, onlyId?: number): Promise<ManagedFleetInstallation[] | null> {
  try {
    const out: ManagedFleetInstallation[] = [];
    const deadline = AbortSignal.timeout(10000);
    let organizationChecks = 0;
    for (let page = 1; page <= 5; page++) {
      const body = await githubRead(session, `/user/installations?per_page=100&page=${page}`, deadline);
      if (!Array.isArray(body?.installations)) return null;
      for (const installation of body.installations) {
        if (!Number.isSafeInteger(installation?.id) || installation.id <= 0) return null;
        if (onlyId !== undefined && installation.id !== onlyId) continue;
        const account = installation.account;
        let allowed = account?.type === 'User' && account.id === session.user.github_user_id;
        if (account?.type === 'Organization' && typeof account.login === 'string'
          && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(account.login)) {
          if (++organizationChecks > 20) return null;
          const membership = await githubRead(session, `/user/memberships/orgs/${encodeURIComponent(account.login)}`, deadline, true);
          allowed = membership?.state === 'active' && membership?.role === 'admin';
        }
        if (allowed) out.push({ id: installation.id, name: typeof account.login === 'string' ? account.login : `Installation ${installation.id}` });
        if (onlyId !== undefined) return out;
        // Bounded account page, never silently pretend a truncated list is complete.
        if (out.length > 20) return null;
      }
      if (body.installations.length < 100) return out;
    }
    return null;
  } catch { return null; }
}
