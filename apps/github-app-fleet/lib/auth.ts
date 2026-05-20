/**
 * GitHub App authentication for the Port Daddy Fleet.
 *
 * Two layers of identity:
 *
 *   1. The App itself — authenticated via a JWT signed with the App's private
 *      key. Good for ~10 minutes. Used to enumerate installations and to mint
 *      installation tokens. NEVER used to actually post anything to a repo.
 *
 *   2. An installation token — scoped to a single installation of the App on
 *      one account/org. Good for ~1 hour. This is the token every fleet ship
 *      uses when it posts a PR comment or opens an issue. We cache it per
 *      installation_id and refresh on a small safety margin before expiry.
 *
 * The "bot identity" the operator sees in the GitHub UI (e.g. `pd-reviewer[bot]`,
 * `pd-redteam[bot]`) is NOT a separate token. GitHub Apps post under a single
 * `<app-slug>[bot]` username — the per-ship visual differentiation lives in:
 *
 *   - the comment body (the `[pd-${ship}]` prefix wrapper in `post-as.ts`)
 *   - the avatar (one App, one avatar — for now)
 *   - the ship's signed footer
 *
 * If GitHub later ships per-message bot identity (it's been rumored for years),
 * we swap the rendering layer; the auth layer here doesn't change.
 *
 * Requires:
 *   GITHUB_APP_ID                 — numeric App ID, visible on the App's settings page
 *   GITHUB_APP_PRIVATE_KEY        — PEM, base64-encoded or raw with literal newlines
 *   GITHUB_APP_INSTALLATION_ID    — numeric installation ID for the target repo's owner
 *                                   (default; per-call override is supported)
 */

import { createAppAuth, type AppAuthentication, type InstallationAccessTokenAuthentication } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

// ---------------------------------------------------------------------------
// Env loading

function readEnv(name: string, required = true): string | undefined {
  const v = process.env[name]
  if (!v && required) {
    throw new Error(
      `[github-app-fleet] missing env var ${name}. ` +
        `See apps/github-app-fleet/README.md for setup.`,
    )
  }
  return v
}

/**
 * Decode the App private key from env. Supports two encodings:
 *   - raw PEM (with literal '\n' newlines OR real newlines)
 *   - base64-encoded PEM
 * Both are common in deployment systems; we sniff and handle both.
 */
function decodePrivateKey(raw: string): string {
  // Cheap sniff: real PEMs start with -----BEGIN
  if (raw.startsWith('-----BEGIN')) {
    return raw.replace(/\\n/g, '\n')
  }
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8')
    if (decoded.startsWith('-----BEGIN')) return decoded
  } catch {
    // fall through
  }
  throw new Error(
    '[github-app-fleet] GITHUB_APP_PRIVATE_KEY is not a recognizable PEM ' +
      '(raw or base64). Re-export the PEM from the App settings and try again.',
  )
}

// ---------------------------------------------------------------------------
// Auth factory + token cache

interface CachedToken {
  token: string
  /** epoch ms when this token expires (per GitHub's response). */
  expiresAt: number
}

const tokenCache = new Map<number, CachedToken>()

/** Refresh tokens this many ms before they actually expire. */
const REFRESH_MARGIN_MS = 60_000 // 1 minute

let _auth: ReturnType<typeof createAppAuth> | null = null

function getAppAuth() {
  if (_auth) return _auth
  const appId = Number(readEnv('GITHUB_APP_ID')!)
  if (!Number.isFinite(appId)) {
    throw new Error('[github-app-fleet] GITHUB_APP_ID is not a number')
  }
  const privateKey = decodePrivateKey(readEnv('GITHUB_APP_PRIVATE_KEY')!)
  _auth = createAppAuth({ appId, privateKey })
  return _auth
}

// ---------------------------------------------------------------------------
// Public surface

/**
 * Get a short-lived JWT authenticated AS THE APP itself.
 * Use only for App-level operations (list installations, etc).
 * For actual posting, use `getInstallationToken` / `getOctokitForInstallation`.
 */
export async function getAppJwt(): Promise<string> {
  const auth = getAppAuth()
  const result = (await auth({ type: 'app' })) as AppAuthentication
  return result.token
}

/**
 * Get an installation access token for the given installation. Cached per
 * installation until its `expires_at` minus a small safety margin.
 */
export async function getInstallationToken(
  installationId?: number,
): Promise<string> {
  const id =
    installationId ??
    Number(readEnv('GITHUB_APP_INSTALLATION_ID')!)
  if (!Number.isFinite(id)) {
    throw new Error(
      '[github-app-fleet] GITHUB_APP_INSTALLATION_ID is not a number ' +
        '(and no installationId arg was passed).',
    )
  }

  const cached = tokenCache.get(id)
  const now = Date.now()
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now) {
    return cached.token
  }

  const auth = getAppAuth()
  const result = (await auth({
    type: 'installation',
    installationId: id,
  })) as InstallationAccessTokenAuthentication

  // expiresAt is ISO-8601
  const expiresAt = new Date(result.expiresAt).getTime()
  tokenCache.set(id, { token: result.token, expiresAt })
  return result.token
}

/**
 * Pre-authenticated Octokit client bound to an installation.
 * This is the right thing for every fleet ship to use.
 */
export async function getOctokitForInstallation(
  installationId?: number,
): Promise<Octokit> {
  const token = await getInstallationToken(installationId)
  return new Octokit({ auth: token })
}

/**
 * Clear the cache. Primarily for tests; useful in dev if a token was revoked
 * mid-process and we want to force a re-mint on the next call.
 */
export function clearTokenCache(): void {
  tokenCache.clear()
}

/**
 * Sanity check that the env is well-formed. Throws on any problem.
 * Call this once at process start so a misconfigured deploy fails loud
 * instead of failing on the first PR comment of the day.
 */
export function assertGitHubAppEnv(): void {
  readEnv('GITHUB_APP_ID')
  readEnv('GITHUB_APP_PRIVATE_KEY')
  readEnv('GITHUB_APP_INSTALLATION_ID')
  // Force a decode attempt now so a malformed PEM trips at boot.
  decodePrivateKey(readEnv('GITHUB_APP_PRIVATE_KEY')!)
}
