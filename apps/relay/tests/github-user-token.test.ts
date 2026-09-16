import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  githubCredentialNeedsRefresh,
  githubTokenKeyring,
  openGitHubUserCredential,
  parseGitHubUserCredential,
  refreshGitHubUserCredential,
  sealGitHubUserCredential,
  type GitHubCredentialBinding,
} from '../src/github-user-token.js';

const KEY_ONE = '11'.repeat(32);
const KEY_TWO = '22'.repeat(32);
const NOW = 1_788_620_000;
const BINDING: GitHubCredentialBinding = {
  kind: 'device-token',
  rowId: 'aa'.repeat(32),
  userId: `u_${'bb'.repeat(16)}`,
};

function expiring(source: 'web' | 'device' = 'device') {
  return parseGitHubUserCredential({
    access_token: 'ghu_access_1',
    expires_in: 28_800,
    refresh_token: 'ghr_refresh_1',
    refresh_token_expires_in: 15_897_600,
    scope: '',
    token_type: 'bearer',
  }, source, NOW);
}

afterEach(() => vi.unstubAllGlobals());

describe('GitHub App user-token envelope', () => {
  it('accepts only unscoped GitHub App credentials and preserves expiration', () => {
    expect(expiring()).toMatchObject({
      schema: 'pd.github-user-credential.v1',
      source: 'device',
      accessToken: 'ghu_access_1',
      accessExpiresAt: NOW + 28_800,
      refreshToken: 'ghr_refresh_1',
      refreshExpiresAt: NOW + 15_897_600,
    });
    expect(() => parseGitHubUserCredential({
      access_token: 'ghu_access_1',
      scope: 'repo',
    }, 'device', NOW)).toThrow(/unexpectedly contains OAuth scopes/);
    expect(() => parseGitHubUserCredential({ access_token: 'gho_wrong_family' }, 'device', NOW)).toThrow(/ghu_/);
    expect(() => parseGitHubUserCredential({
      access_token: 'ghu_access_1',
      expires_in: 28_800,
    }, 'device', NOW)).toThrow(/access and refresh expirations together/);
  });

  it('fails closed when ciphertext is transplanted across row, user, or kind', async () => {
    const keys = githubTokenKeyring({ USER_TOKEN_WRAPPING_KEY: KEY_ONE });
    const wrapped = await sealGitHubUserCredential(keys, BINDING, expiring());
    expect((await openGitHubUserCredential(keys, BINDING, wrapped))?.credential.accessToken).toBe('ghu_access_1');
    expect(await openGitHubUserCredential(keys, { ...BINDING, rowId: 'cc'.repeat(32) }, wrapped)).toBeNull();
    expect(await openGitHubUserCredential(keys, { ...BINDING, userId: `u_${'dd'.repeat(16)}` }, wrapped)).toBeNull();
    expect(await openGitHubUserCredential(keys, { ...BINDING, kind: 'web-session' }, wrapped)).toBeNull();
  });

  it('opens an explicitly retained prior version and requests atomic resealing', async () => {
    const oldKeys = githubTokenKeyring({
      USER_TOKEN_WRAPPING_KEY: KEY_ONE,
      USER_TOKEN_WRAPPING_KEY_VERSION: '1',
    });
    const wrapped = await sealGitHubUserCredential(oldKeys, BINDING, expiring());
    const rotated = githubTokenKeyring({
      USER_TOKEN_WRAPPING_KEY: KEY_TWO,
      USER_TOKEN_WRAPPING_KEY_VERSION: '2',
      USER_TOKEN_WRAPPING_PREVIOUS_KEYS: JSON.stringify({ 1: KEY_ONE }),
    });
    expect(await openGitHubUserCredential(rotated, BINDING, wrapped)).toMatchObject({ needsReseal: true });
    expect(await openGitHubUserCredential(
      githubTokenKeyring({ USER_TOKEN_WRAPPING_KEY: KEY_TWO, USER_TOKEN_WRAPPING_KEY_VERSION: '2' }),
      BINDING,
      wrapped,
    )).toBeNull();
  });

  it('refreshes device credentials without a client secret and rotates both tokens', async () => {
    let sent: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = init;
      return Response.json({
        access_token: 'ghu_access_2',
        expires_in: 28_800,
        refresh_token: 'ghr_refresh_2',
        refresh_token_expires_in: 15_897_600,
        scope: '',
        token_type: 'bearer',
      });
    }));

    const refreshed = await refreshGitHubUserCredential(expiring(), { clientId: 'Iv23.app', now: NOW + 28_700 });

    expect(refreshed.accessToken).toBe('ghu_access_2');
    expect(githubCredentialNeedsRefresh(expiring(), NOW + 28_700)).toBe(true);
    expect(sent?.redirect).toBe('error');
    expect(sent?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(sent?.body))).toEqual({
      client_id: 'Iv23.app',
      grant_type: 'refresh_token',
      refresh_token: 'ghr_refresh_1',
    });
  });

  it('requires a client secret for web refresh and never falls back after expiry', async () => {
    await expect(refreshGitHubUserCredential(expiring('web'), {
      clientId: 'Iv23.app',
      now: NOW,
    })).rejects.toThrow(/client secret/);
    await expect(refreshGitHubUserCredential({
      ...expiring(),
      refreshExpiresAt: NOW,
    }, { clientId: 'Iv23.app', now: NOW })).rejects.toThrow(/reauthorization/);
  });
});
