/**
 * Unit tests for lib/auth.ts — env validation, private-key decode, and the
 * installation-token cache.
 *
 * No real network. We:
 *   - generate a throwaway RSA keypair in-process so the REAL JWT-signing path
 *     (node:crypto createSign) runs deterministically — no GitHub key needed;
 *   - mock global `fetch` so the installation-token mint returns a controlled
 *     token + `expires_at`, and so we can COUNT calls to assert the cache.
 *
 * The cache contract under test (auth.ts):
 *   - a token whose expiry is more than REFRESH_MARGIN_MS (60s) in the future
 *     is reused with NO second network call;
 *   - a token within that margin (or expired) is re-minted.
 */

import { jest } from '@jest/globals'
import { generateKeyPairSync } from 'node:crypto'

const {
  assertGitHubAppEnv,
  getInstallationToken,
  getAppJwt,
  clearTokenCache,
} = await import('../lib/auth.js')

// A real RSA private key so RS256 signing actually works in getAppJwt.
const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const BASE64_PEM = Buffer.from(PEM, 'utf8').toString('base64')

function setGoodEnv(opts: { key?: string } = {}) {
  process.env.GITHUB_APP_ID = '123456'
  process.env.GITHUB_APP_INSTALLATION_ID = '42'
  process.env.GITHUB_APP_PRIVATE_KEY = opts.key ?? PEM
}

const ORIGINAL_ENV = { ...process.env }
let fetchSpy: ReturnType<typeof jest.fn>

beforeEach(() => {
  // Reset env to a clean slate (drop the three vars; restore everything else).
  delete process.env.GITHUB_APP_ID
  delete process.env.GITHUB_APP_INSTALLATION_ID
  delete process.env.GITHUB_APP_PRIVATE_KEY
  clearTokenCache()

  // Mock fetch to mint a token expiring 1 hour out by default.
  fetchSpy = jest.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({
      token: `ghs_tok_${fetchSpy.mock.calls.length}`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
    text: async () => '',
  })) as never
  // @ts-expect-error assign onto global
  global.fetch = fetchSpy
})

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(() => {
  // Restore the original process.env keys we touched.
  for (const k of ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY']) {
    if (k in ORIGINAL_ENV) process.env[k] = ORIGINAL_ENV[k]
    else delete process.env[k]
  }
})

// ---------------------------------------------------------------------------
// assertGitHubAppEnv

describe('assertGitHubAppEnv', () => {
  it('passes when all three vars are well-formed (raw PEM)', () => {
    setGoodEnv()
    expect(() => assertGitHubAppEnv()).not.toThrow()
  })

  it('passes with a base64-encoded private key', () => {
    setGoodEnv({ key: BASE64_PEM })
    expect(() => assertGitHubAppEnv()).not.toThrow()
  })

  it('throws naming GITHUB_APP_ID when it is missing', () => {
    process.env.GITHUB_APP_INSTALLATION_ID = '42'
    process.env.GITHUB_APP_PRIVATE_KEY = PEM
    expect(() => assertGitHubAppEnv()).toThrow(/GITHUB_APP_ID/)
  })

  it('throws naming GITHUB_APP_PRIVATE_KEY when it is missing', () => {
    process.env.GITHUB_APP_ID = '123456'
    process.env.GITHUB_APP_INSTALLATION_ID = '42'
    expect(() => assertGitHubAppEnv()).toThrow(/GITHUB_APP_PRIVATE_KEY/)
  })

  it('throws naming GITHUB_APP_INSTALLATION_ID when it is missing', () => {
    process.env.GITHUB_APP_ID = '123456'
    process.env.GITHUB_APP_PRIVATE_KEY = PEM
    expect(() => assertGitHubAppEnv()).toThrow(/GITHUB_APP_INSTALLATION_ID/)
  })

  it('throws on a private key that is neither raw PEM nor valid base64 PEM', () => {
    process.env.GITHUB_APP_ID = '123456'
    process.env.GITHUB_APP_INSTALLATION_ID = '42'
    process.env.GITHUB_APP_PRIVATE_KEY = 'this-is-not-a-pem-or-base64-pem'
    expect(() => assertGitHubAppEnv()).toThrow(/not a recognizable PEM/)
  })
})

// ---------------------------------------------------------------------------
// getAppJwt — exercises the real signing + private-key decode paths

describe('getAppJwt', () => {
  it('produces a well-formed 3-segment JWT with the App ID as issuer (raw PEM)', async () => {
    setGoodEnv()
    const jwt = await getAppJwt()
    const parts = jwt.split('.')
    expect(parts).toHaveLength(3)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    expect(payload.iss).toBe('123456')
    // back-dated iat, ~9 minute window
    expect(payload.exp - payload.iat).toBe(540)
    expect(payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
  })

  it('decodes a base64-encoded private key (decode path)', async () => {
    setGoodEnv({ key: BASE64_PEM })
    const jwt = await getAppJwt()
    expect(jwt.split('.')).toHaveLength(3)
  })

  it('decodes a PEM with escaped \\n newlines', async () => {
    setGoodEnv({ key: PEM.replace(/\n/g, '\\n') })
    const jwt = await getAppJwt()
    expect(jwt.split('.')).toHaveLength(3)
  })

  it('throws when GITHUB_APP_ID is not numeric', async () => {
    setGoodEnv()
    process.env.GITHUB_APP_ID = 'not-a-number'
    await expect(getAppJwt()).rejects.toThrow(/GITHUB_APP_ID is not a number/)
  })
})

// ---------------------------------------------------------------------------
// getInstallationToken — the cache

describe('getInstallationToken cache', () => {
  it('mints a token via fetch and returns it', async () => {
    setGoodEnv()
    const tok = await getInstallationToken()
    expect(tok).toBe('ghs_tok_1')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // Hit the GitHub access_tokens endpoint for installation 42.
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain('/app/installations/42/access_tokens')
  })

  it('reuses a cached token still outside the refresh margin (no 2nd fetch)', async () => {
    setGoodEnv()
    const first = await getInstallationToken()
    const second = await getInstallationToken()
    expect(second).toBe(first)
    expect(fetchSpy).toHaveBeenCalledTimes(1) // cache hit, no re-mint
  })

  it('re-mints when the cached token is within the refresh margin', async () => {
    setGoodEnv()
    // First mint: token that expires only 30s out — inside the 60s margin,
    // so the very next call must refresh.
    fetchSpy.mockImplementationOnce(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        token: 'ghs_soon_to_expire',
        expires_at: new Date(Date.now() + 30_000).toISOString(),
      }),
      text: async () => '',
    }))
    const first = await getInstallationToken()
    expect(first).toBe('ghs_soon_to_expire')

    const second = await getInstallationToken()
    expect(second).not.toBe(first) // refreshed
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('re-mints after clearTokenCache()', async () => {
    setGoodEnv()
    await getInstallationToken()
    clearTokenCache()
    await getInstallationToken()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('caches per installation id (distinct ids do not share a token)', async () => {
    setGoodEnv()
    const a = await getInstallationToken(100)
    const b = await getInstallationToken(200)
    expect(a).not.toBe(b)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    // and each id is independently cached on a repeat call
    await getInstallationToken(100)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('throws a clear error when the mint request fails', async () => {
    setGoodEnv()
    fetchSpy.mockImplementationOnce(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'Bad credentials',
    }))
    await expect(getInstallationToken()).rejects.toThrow(/installation-token mint failed: 401/)
  })

  it('throws when no installation id is resolvable', async () => {
    process.env.GITHUB_APP_ID = '123456'
    process.env.GITHUB_APP_PRIVATE_KEY = PEM
    process.env.GITHUB_APP_INSTALLATION_ID = 'not-a-number'
    await expect(getInstallationToken()).rejects.toThrow(/GITHUB_APP_INSTALLATION_ID is not a number/)
  })

  it('an explicit installationId arg overrides a missing env var', async () => {
    process.env.GITHUB_APP_ID = '123456'
    process.env.GITHUB_APP_PRIVATE_KEY = PEM
    // No GITHUB_APP_INSTALLATION_ID set, but we pass one explicitly.
    const tok = await getInstallationToken(777)
    expect(tok).toBe('ghs_tok_1')
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain('/app/installations/777/access_tokens')
  })
})
