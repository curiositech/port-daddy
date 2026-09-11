/**
 * GitHub App egress credential (ADR-0053 Phase 0a — the confinement upgrade).
 *
 * The push broker must not inherit an operator credential that can touch every
 * repo the operator can. This existing seam provides it with a
 * **narrowly-scoped, short-lived GitHub App installation token** that the daemon
 * mints server-side and the agent never sees.
 *
 * "Narrowly-scoped" is the upgrade over `getInstallationToken`
 * (`apps/github-app-fleet/lib/auth.ts`), which mints a full-installation token.
 * Here we pass `repositories` + `permissions` in the mint request, so the token
 * GitHub returns has `contents:write` on ONE repo; an explicitly authorized
 * workflow or PR publication may also opt into `workflows:write` or
 * `pull_requests:write`, respectively. No arbitrary
 * permission map is accepted. Returned scope and one-hour expiry (with bounded
 * clock skew) are checked before handing the token to its trusted caller.
 * The macaroon discharge gate (Phase 1) decides
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
  /** Explicit opt-in for an already-authorized workflow-file publication.
   *  Omitted/false keeps contents-only access; this is not publication authority. */
  workflowWrite?: boolean;
  /** Explicit opt-in for already-authorized PR publication/review actions.
   *  Omitted/false never requests pull-request write access. */
  pullRequestsWrite?: boolean;
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected verification clock (unix ms); defaults to Date.now(). */
  nowMs?: number;
}

export interface ScopedPushToken {
  /** The installation access token — verified grants on `owner/repo` only. */
  token: string;
  /** Epoch ms when GitHub says the token expires (~1 h out). */
  expiresAt: number;
  owner: string;
  repo: string;
}

/**
 * Sign a GitHub App JWT (RS256). Exposed for testing; the JWT authenticates AS
 * the App only long enough to mint an installation token — it never touches a
 * repo. Design intent: back-dated `iat` absorbs laptop-vs-GitHub clock skew.
 * @param creds App identity and its signing key, supplied by the trusted caller.
 * @param nowMs Verification clock in Unix milliseconds.
 * @returns A short-lived RS256 App JWT, not an installation credential.
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
  /** Design: JWT segments use URL-safe JSON encoding without padding.
   * @param o JSON-compatible JWT segment.
   * @returns The encoded segment.
   */
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
 * access-tokens endpoint, narrowed to ONE repo and contents-write, with an
 * explicit workflow/PR-write opt-ins. The design verifies the actual grant rather
 * than assuming the request proved scope. Implicit metadata-read is permitted.
 *
 * Mint and rejected-token cleanup are bounded, with no retries. A rejected
 * grant is revoked when a usable token was returned; only HTTP 204 confirms
 * that cleanup. Unknown mint outcomes cannot be cleaned up without the token.
 * The trusted caller must revoke a successful token in its own finally block;
 * expiry is the remaining limit if its process is lost. No error echoes remote
 * bodies, credentials or nested transport errors.
 *
 * @param req App credentials, exact repository and optional workflow/PR grants.
 * @returns A verified short-lived token; never grants authority to publish.
 */
export async function mintScopedPushToken(req: ScopedPushTokenRequest): Promise<ScopedPushToken> {
  if (!Number.isInteger(req.installationId) || req.installationId <= 0) {
    throw new Error('github-app-egress: installationId must be a positive integer');
  }
  if (typeof req.owner !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(req.owner)
    || typeof req.repo !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(req.repo)
    || req.repo === '.' || req.repo === '..') {
    throw new Error('github-app-egress: owner and repo must be single repository identifiers');
  }
  if (req.workflowWrite !== undefined && typeof req.workflowWrite !== 'boolean') {
    throw new Error('github-app-egress: workflowWrite must be an explicit boolean');
  }
  if (req.pullRequestsWrite !== undefined && typeof req.pullRequestsWrite !== 'boolean') {
    throw new Error('github-app-egress: pullRequestsWrite must be an explicit boolean');
  }
  const fetchImpl = req.fetchImpl ?? fetch;
  const nowMs = req.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new Error('github-app-egress: invalid verification clock');
  const jwt = signAppJwt(req, nowMs);
  const permissions: Record<string, string> = req.workflowWrite === true
    ? { contents: 'write', workflows: 'write' } : { contents: 'write' };
  if (req.pullRequestsWrite === true) permissions.pull_requests = 'write';
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pd-push-broker/github-app',
  };
  /** Bound both transport and body reads; motivation: injected transports may
   * ignore abort, so a signal alone does not enforce the caller's deadline.
   * @param run One attempt accepting an abort signal.
   * @param timeoutMs Maximum duration of this attempt.
   * @returns The attempt result, or a private timeout rejection.
   */
  async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')); }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  let result: { status: number; data?: Record<string, unknown> };
  try {
    result = await bounded(async (signal) => {
      const res = await fetchImpl(
        `https://api.github.com/app/installations/${req.installationId}/access_tokens`,
        {
          method: 'POST', redirect: 'error', signal,
          headers: { ...headers, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ repositories: [req.repo], permissions }),
        },
      );
      return { status: res.status, data: res.status === 201 ? await res.json() : undefined };
    }, 15_000);
  } catch {
    throw new Error('github-app-egress: scoped-token mint outcome unknown; cleanup unavailable; not retried');
  }
  if (result.status !== 201) {
    throw new Error(`github-app-egress: scoped-token mint failed: HTTP ${result.status}; not retried`);
  }
  const data = result.data;
  if (!data || typeof data.token !== 'string' || !data.token || /\s/.test(data.token)) {
    throw new Error('github-app-egress: mint response missing usable token; cleanup unavailable');
  }
  const token = data.token;
  /** Reject a minted capability without leaking it; motivation: invalid scope
   * must not leave a known live credential silently abandoned.
   * @param reason Fixed local diagnostic, never provider-controlled text.
   * @returns Never; throws after a bounded cleanup witness.
   */
  async function rejectGrant(reason: string): Promise<never> {
    let cleanup = 'unconfirmed';
    try {
      const status = await bounded(async (signal) => {
        const response = await fetchImpl('https://api.github.com/installation/token', {
          method: 'DELETE', redirect: 'error', signal,
          headers: { ...headers, Authorization: `Bearer ${token}` },
        });
        return response.status;
      }, 5_000);
      if (status === 204) cleanup = 'confirmed';
    } catch { /* Preserve the original rejection; cleanup remains unconfirmed. */ }
    throw new Error(`github-app-egress: ${reason}; rejected-token cleanup ${cleanup}`);
  }
  const expiresAt = typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : NaN;
  // GitHub's one-hour grant plus at most 60 seconds of clock skew; never unbounded.
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs || expiresAt > nowMs + 3_660_000) {
    return rejectGrant('mint response expiry outside the one-hour bounded lifetime');
  }
  const granted = data.permissions;
  if (!granted || typeof granted !== 'object' || Array.isArray(granted)
    || Object.entries(permissions).some(([name, level]) => (granted as Record<string, unknown>)[name] !== level)
    || Object.entries(granted).some(([name, level]) => permissions[name] !== level
      && !(name === 'metadata' && level === 'read'))) {
    return rejectGrant('mint response permissions do not match the requested scope');
  }
  const repositories = data.repositories;
  const repository = Array.isArray(repositories) && repositories.length === 1 ? repositories[0] : null;
  if (data.repository_selection !== 'selected' || !repository
    || typeof repository.full_name !== 'string'
    || repository.full_name.toLowerCase() !== `${req.owner}/${req.repo}`.toLowerCase()) {
    return rejectGrant('mint response does not identify the exact single repository');
  }
  return {
    token,
    expiresAt,
    owner: req.owner,
    repo: req.repo,
  };
}
