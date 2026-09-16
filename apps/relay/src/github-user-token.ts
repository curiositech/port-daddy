/**
 * One Relay-only envelope for GitHub App user access credentials.
 *
 * Ciphertext is bound to its D1 row, user, credential kind, and wrapping-key
 * version. Moving it to another account or session therefore fails
 * authentication. Key rotation retains explicitly configured prior keys and
 * asks callers to atomically re-seal after a successful read.
 */

import { base64UrlDecode, base64UrlEncode, fromHex } from './crypto.js';

const CREDENTIAL_SCHEMA = 'pd.github-user-credential.v1' as const;
const WRAPPING_KEY_AAD_SCHEMA = 'port-daddy:github-user-credential:v1';
const GH_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_TIMEOUT_MS = 15_000;
const REFRESH_EARLY_SECONDS = 5 * 60;

export type GitHubCredentialSource = 'web' | 'device';
export type GitHubCredentialKind = 'web-session' | 'device-token';

export interface GitHubUserCredential {
  schema: typeof CREDENTIAL_SCHEMA;
  source: GitHubCredentialSource;
  accessToken: string;
  accessExpiresAt: number | null;
  refreshToken: string | null;
  refreshExpiresAt: number | null;
}

export interface GitHubCredentialBinding {
  kind: GitHubCredentialKind;
  rowId: string;
  userId: string;
}

export interface WrappedGitHubUserCredential {
  enc: string;
  iv: string;
  keyVersion: number;
}

export interface GitHubTokenWrappingEnvironment {
  USER_TOKEN_WRAPPING_KEY?: string;
  USER_TOKEN_WRAPPING_KEY_VERSION?: string;
  USER_TOKEN_WRAPPING_PREVIOUS_KEYS?: string;
}

export interface GitHubTokenKeyring {
  currentVersion: number;
  keys: ReadonlyMap<number, string>;
}

interface GitHubUserTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

function positiveInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`GitHub ${field} must be a positive integer`);
  }
  return value as number;
}

function validateKey(keyHex: string, field: string): string {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error(`${field} must be exactly 32 bytes of hex`);
  return keyHex.toLowerCase();
}

function validateKeyVersion(value: unknown, field: string): number {
  const version = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(version) || (version as number) <= 0 || (version as number) > 2_147_483_647) {
    throw new Error(`${field} must be a positive 32-bit integer`);
  }
  return version as number;
}

/** Resolve the current wrapping key plus explicit older versions for rotation. */
export function githubTokenKeyring(env: GitHubTokenWrappingEnvironment): GitHubTokenKeyring {
  const currentKey = validateKey(env.USER_TOKEN_WRAPPING_KEY ?? '', 'USER_TOKEN_WRAPPING_KEY');
  const currentVersion = validateKeyVersion(env.USER_TOKEN_WRAPPING_KEY_VERSION ?? '1', 'USER_TOKEN_WRAPPING_KEY_VERSION');
  const keys = new Map<number, string>([[currentVersion, currentKey]]);
  if (env.USER_TOKEN_WRAPPING_PREVIOUS_KEYS) {
    let parsed: unknown;
    try { parsed = JSON.parse(env.USER_TOKEN_WRAPPING_PREVIOUS_KEYS); } catch {
      throw new Error('USER_TOKEN_WRAPPING_PREVIOUS_KEYS must be a JSON object');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('USER_TOKEN_WRAPPING_PREVIOUS_KEYS must be a JSON object');
    }
    for (const [rawVersion, rawKey] of Object.entries(parsed as Record<string, unknown>)) {
      const version = validateKeyVersion(rawVersion, 'previous wrapping-key version');
      if (version === currentVersion || keys.has(version) || typeof rawKey !== 'string') {
        throw new Error('USER_TOKEN_WRAPPING_PREVIOUS_KEYS contains a duplicate or invalid version');
      }
      keys.set(version, validateKey(rawKey, `wrapping key version ${version}`));
    }
  }
  return { currentVersion, keys };
}

function validateBinding(binding: GitHubCredentialBinding): void {
  if (!/^[0-9a-f]{64}$/i.test(binding.rowId)) throw new Error('credential row id must be one SHA-256 hex digest');
  if (!/^u_[0-9a-f]{32}$/i.test(binding.userId)) throw new Error('credential user id is invalid');
  if (binding.kind !== 'web-session' && binding.kind !== 'device-token') throw new Error('credential kind is invalid');
}

function aad(binding: GitHubCredentialBinding, keyVersion: number): Uint8Array {
  validateBinding(binding);
  return new TextEncoder().encode([
    WRAPPING_KEY_AAD_SCHEMA,
    binding.kind,
    binding.rowId.toLowerCase(),
    binding.userId.toLowerCase(),
    String(keyVersion),
  ].join(':'));
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromHex(keyHex), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function validGitHubAccessToken(token: unknown): token is string {
  return typeof token === 'string' && /^ghu_[A-Za-z0-9_]+$/.test(token) && token.length <= 1024;
}

function validGitHubRefreshToken(token: unknown): token is string {
  return typeof token === 'string' && /^ghr_[A-Za-z0-9_]+$/.test(token) && token.length <= 1024;
}

/** Parse the documented GitHub App token response and reject OAuth-App scopes. */
export function parseGitHubUserCredential(
  raw: unknown,
  source: GitHubCredentialSource,
  now: number,
): GitHubUserCredential {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('GitHub user-token response is malformed');
  const row = raw as GitHubUserTokenResponse;
  if (!validGitHubAccessToken(row.access_token)) throw new Error('GitHub App user-token response has no valid ghu_ access token');
  if (row.scope !== undefined && row.scope !== '') throw new Error('GitHub App user-token response unexpectedly contains OAuth scopes');
  if (row.token_type !== undefined && row.token_type !== 'bearer') throw new Error('GitHub App user-token response has an invalid token type');

  const expiresIn = positiveInteger(row.expires_in, 'expires_in');
  const refreshExpiresIn = positiveInteger(row.refresh_token_expires_in, 'refresh_token_expires_in');
  const refreshToken = row.refresh_token === undefined || row.refresh_token === null
    ? null
    : validGitHubRefreshToken(row.refresh_token)
      ? row.refresh_token
      : (() => { throw new Error('GitHub App user-token response has an invalid refresh token'); })();
  if ((expiresIn === null) !== (refreshToken === null) || (refreshToken === null) !== (refreshExpiresIn === null)) {
    throw new Error('GitHub App expiring credential must include access and refresh expirations together');
  }
  return {
    schema: CREDENTIAL_SCHEMA,
    source,
    accessToken: row.access_token,
    accessExpiresAt: expiresIn === null ? null : now + expiresIn,
    refreshToken,
    refreshExpiresAt: refreshExpiresIn === null ? null : now + refreshExpiresIn,
  };
}

function parseStoredCredential(raw: string): GitHubUserCredential {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('stored GitHub credential is malformed'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('stored GitHub credential is malformed');
  const row = parsed as Record<string, unknown>;
  if (row.schema !== CREDENTIAL_SCHEMA || (row.source !== 'web' && row.source !== 'device')
      || !validGitHubAccessToken(row.accessToken)
      || (row.accessExpiresAt !== null && (!Number.isSafeInteger(row.accessExpiresAt) || (row.accessExpiresAt as number) <= 0))
      || (row.refreshToken !== null && !validGitHubRefreshToken(row.refreshToken))
      || (row.refreshExpiresAt !== null && (!Number.isSafeInteger(row.refreshExpiresAt) || (row.refreshExpiresAt as number) <= 0))
      || ((row.accessExpiresAt === null) !== (row.refreshToken === null))
      || ((row.refreshToken === null) !== (row.refreshExpiresAt === null))) {
    throw new Error('stored GitHub credential has an invalid shape');
  }
  return row as unknown as GitHubUserCredential;
}

function serializeCredential(credential: GitHubUserCredential): string {
  return JSON.stringify({
    schema: credential.schema,
    source: credential.source,
    accessToken: credential.accessToken,
    accessExpiresAt: credential.accessExpiresAt,
    refreshToken: credential.refreshToken,
    refreshExpiresAt: credential.refreshExpiresAt,
  });
}

export async function sealGitHubUserCredential(
  keyring: GitHubTokenKeyring,
  binding: GitHubCredentialBinding,
  credential: GitHubUserCredential,
): Promise<WrappedGitHubUserCredential> {
  const keyHex = keyring.keys.get(keyring.currentVersion);
  if (!keyHex) throw new Error('current GitHub credential wrapping key is missing');
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(binding, keyring.currentVersion) },
    key,
    new TextEncoder().encode(serializeCredential(credential)),
  ));
  return { enc: base64UrlEncode(cipher), iv: base64UrlEncode(iv), keyVersion: keyring.currentVersion };
}

export async function openGitHubUserCredential(
  keyring: GitHubTokenKeyring,
  binding: GitHubCredentialBinding,
  wrapped: WrappedGitHubUserCredential,
): Promise<{ credential: GitHubUserCredential; needsReseal: boolean } | null> {
  try {
    const version = validateKeyVersion(wrapped.keyVersion, 'stored wrapping-key version');
    const keyHex = keyring.keys.get(version);
    if (!keyHex) return null;
    const key = await importKey(keyHex);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlDecode(wrapped.iv), additionalData: aad(binding, version) },
      key,
      base64UrlDecode(wrapped.enc),
    );
    return {
      credential: parseStoredCredential(new TextDecoder().decode(plaintext)),
      needsReseal: version !== keyring.currentVersion,
    };
  } catch {
    return null;
  }
}

export function githubCredentialNeedsRefresh(credential: GitHubUserCredential, now: number): boolean {
  return credential.accessExpiresAt !== null && credential.accessExpiresAt <= now + REFRESH_EARLY_SECONDS;
}

/** Exchange one single-use refresh token for the next expiring credential. */
export async function refreshGitHubUserCredential(
  credential: GitHubUserCredential,
  options: { clientId: string; clientSecret?: string; now: number },
): Promise<GitHubUserCredential> {
  if (!credential.refreshToken || credential.refreshExpiresAt === null) {
    throw new Error('GitHub credential requires operator reauthorization');
  }
  if (credential.refreshExpiresAt <= options.now) throw new Error('GitHub credential refresh expired; operator reauthorization required');
  if (credential.source === 'web' && !options.clientSecret) {
    throw new Error('GitHub web credential refresh requires the App client secret');
  }
  const body: Record<string, string> = {
    client_id: options.clientId,
    grant_type: 'refresh_token',
    refresh_token: credential.refreshToken,
  };
  if (credential.source === 'web') body.client_secret = options.clientSecret!;
  const response = await fetch(GH_TOKEN, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub user-token refresh failed ${response.status}`);
  return parseGitHubUserCredential(await response.json(), credential.source, options.now);
}
