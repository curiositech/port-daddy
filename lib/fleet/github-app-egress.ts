/**
 * GitHub App egress credential (ADR-0053 Phase 0a — the confinement upgrade).
 *
 * Today the push path inherits the operator's `gh` token (`lib/fleet/
 * github-output.ts`): the agent's box holds a credential that can touch every
 * repo the operator can. Phase 0a replaces that for the *push broker* with a
 * **narrowly-scoped, short-lived GitHub App installation token** that the daemon
 * mints server-side and the agent never sees.
 *
 * "Narrowly-scoped" is the upgrade over `getInstallationToken`
 * (`apps/github-app-fleet/lib/auth.ts`), which mints a full-installation token.
 * Here we pass `repositories` + `permissions` in the mint request, so the token
 * GitHub returns can ONLY do `contents:write` on ONE repo. Even if it leaked, it
 * cannot read Actions secrets, touch another repo, or administer anything — and
 * it dies within the hour. The macaroon discharge gate (Phase 1) decides
 * *whether* to mint; this decides *what the minted credential can do*.
 *
 * Dependency-injected by design: the caller supplies the App id + PEM (loaded
 * from the keychain, never an agent-readable env var) and may inject `fetchImpl`
 * + `nowMs` for testing. Nothing here reads `process.env`. The JWT clock defaults
 * to `Date.now()` when `nowMs` is omitted, but is fully injectable, so the
 * signing logic is deterministically testable.
 */

import { createSign } from 'node:crypto';

/** Back-date the JWT `iat` so a clock slightly ahead of GitHub's still produces
 *  an acceptable token (GitHub 401s a JWT whose `iat` is even 1s in its future). */
const JWT_BACKDATE_SECONDS = 60;
/** App JWT lifetime. GitHub's max is 10 min; 9 leaves margin. */
const JWT_LIFETIME_SECONDS = 540;

export interface AppCredentials {
  /** Numeric App id (from the App's settings page). */
  appId: number;
  /** The App's private key, PEM (raw, with real newlines). Loaded from the
   *  keychain by the caller — never from an agent-readable env var. */
  privateKeyPem: string;
}

export interface ScopedPushTokenRequest extends AppCredentials {
  /** Installation id for the target repo's owner. */
  installationId: number;
  /** Repo owner (org/user login). */
  owner: string;
  /** Repo name (without owner). */
  repo: string;
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected verification clock (unix ms); defaults to Date.now(). */
  nowMs?: number;
}

export interface ScopedPushToken {
  /** The installation access token — push-scoped to `owner/repo` only. */
  token: string;
  /** Epoch ms when GitHub says the token expires (~1 h out). */
  expiresAt: number;
  owner: string;
  repo: string;
}

/**
 * Sign a GitHub App JWT (RS256). Exposed for testing; the JWT authenticates AS
 * the App only long enough to mint an installation token — it never touches a
 * repo. Back-dated `iat` absorbs laptop-vs-GitHub clock skew.
 */
export function signAppJwt(creds: AppCredentials, nowMs: number): string {
  if (!Number.isInteger(creds.appId) || creds.appId <= 0) {
    throw new Error('github-app-egress: appId must be a positive integer');
  }
  const nowSec = Math.floor(nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: nowSec - JWT_BACKDATE_SECONDS,
    exp: nowSec + JWT_LIFETIME_SECONDS - JWT_BACKDATE_SECONDS,
    iss: String(creds.appId),
  };
  const b64u = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64u(header)}.${b64u(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(creds.privateKeyPem).toString('base64url');
  return `${unsigned}.${sig}`;
}

/**
 * Mint a push-scoped installation token: an App-authenticated POST to GitHub's
 * access-tokens endpoint, narrowed to ONE repo and `contents:write` only. The
 * returned token is the egress credential the push broker uses; it is never
 * handed to the agent.
 *
 * Throws on a non-2xx mint (with status + body) so a misconfigured App or a
 * revoked installation fails loud rather than silently yielding no token.
 */
export async function mintScopedPushToken(req: ScopedPushTokenRequest): Promise<ScopedPushToken> {
  if (!Number.isInteger(req.installationId) || req.installationId <= 0) {
    throw new Error('github-app-egress: installationId must be a positive integer');
  }
  if (!req.owner || !req.repo) {
    throw new Error('github-app-egress: owner and repo are required');
  }
  const fetchImpl = req.fetchImpl ?? fetch;
  const nowMs = req.nowMs ?? Date.now();
  const jwt = signAppJwt(req, nowMs);

  const res = await fetchImpl(
    `https://api.github.com/app/installations/${req.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pd-push-broker/github-app',
      },
      // The narrowing that makes this a confinement upgrade: one repo, push only.
      body: JSON.stringify({
        repositories: [req.repo],
        permissions: { contents: 'write' },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `github-app-egress: scoped-token mint failed: ${res.status} ${text.trim()}`,
    );
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  if (!data?.token || !data?.expires_at) {
    throw new Error('github-app-egress: mint response missing token/expires_at');
  }
  const expiresAt = new Date(data.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) {
    throw new Error(`github-app-egress: mint response has an unparseable expires_at: ${data.expires_at}`);
  }
  return {
    token: data.token,
    expiresAt,
    owner: req.owner,
    repo: req.repo,
  };
}
