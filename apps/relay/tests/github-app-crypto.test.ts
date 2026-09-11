import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getGitHubAppIdentity,
  githubAppPrivateKeyDer,
  mintRepositoryInstallationToken,
} from '../src/github-app.js';

afterEach(() => vi.unstubAllGlobals());

function fixtures(): { pkcs1: string; pkcs8: string; pkcs8Der: Uint8Array } {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  return {
    pkcs1: key.export({ type: 'pkcs1', format: 'pem' }) as string,
    pkcs8: key.export({ type: 'pkcs8', format: 'pem' }) as string,
    pkcs8Der: new Uint8Array(key.export({ type: 'pkcs8', format: 'der' })),
  };
}

describe('shared GitHub App key parser parity', () => {
  it('accepts PKCS#1, PKCS#8, escaped newlines, and base64-wrapped PEM', () => {
    const { pkcs1, pkcs8, pkcs8Der } = fixtures();
    expect(githubAppPrivateKeyDer(pkcs8)).toEqual(pkcs8Der);
    expect(githubAppPrivateKeyDer(pkcs1)).toEqual(pkcs8Der);
    expect(githubAppPrivateKeyDer(pkcs1.replace(/\n/g, '\\n'))).toEqual(pkcs8Der);
    expect(githubAppPrivateKeyDer(Buffer.from(pkcs8, 'utf8').toString('base64'))).toEqual(pkcs8Der);
  });

  it('rejects malformed and mislabeled key material', () => {
    const { pkcs1, pkcs8 } = fixtures();
    expect(() => githubAppPrivateKeyDer('-----BEGIN PRIVATE KEY-----\n!!!\n-----END PRIVATE KEY-----')).toThrow();
    expect(() => githubAppPrivateKeyDer(pkcs1
      .replace('BEGIN RSA PRIVATE KEY', 'BEGIN PRIVATE KEY')
      .replace('END RSA PRIVATE KEY', 'END PRIVATE KEY'))).toThrow(/PKCS#8/);
    expect(() => githubAppPrivateKeyDer(pkcs8
      .replace('BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY')
      .replace('END PRIVATE KEY', 'END RSA PRIVATE KEY'))).toThrow(/PKCS#1/);
    expect(() => githubAppPrivateKeyDer(`${pkcs8}\n${pkcs8}`)).toThrow(/one unencrypted/);
  });
});
describe('repository-scoped GitHub App authority', () => {
  it('uses the Bot user id, not the App id, for commit attribution', async () => {
    const { pkcs8 } = fixtures();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/app')) {
        return new Response(JSON.stringify({ id: 3_810_450, slug: 'port-daddy' }));
      }
      if (url.endsWith('/users/port-daddy%5Bbot%5D')) {
        return new Response(JSON.stringify({ id: 286_963_017, login: 'port-daddy[bot]', type: 'Bot' }));
      }
      return new Response('', { status: 404 });
    }));
    const cache = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string) => cache.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { cache.set(key, value); }),
    } as unknown as KVNamespace;

    await expect(getGitHubAppIdentity('3810450', pkcs8, kv)).resolves.toEqual({
      id: 286_963_017,
      slug: 'port-daddy',
      botName: 'port-daddy[bot]',
      botEmail: '286963017+port-daddy[bot]@users.noreply.github.com',
    });
    expect(calls.map(({ url }) => url)).toEqual([
      'https://api.github.com/app',
      'https://api.github.com/users/port-daddy%5Bbot%5D',
    ]);
    expect(calls.every(({ init }) => init.redirect === 'error' && init.signal instanceof AbortSignal)).toBe(true);
  });

  it('mints only the exact repository and permissions with bounded no-redirect I/O', async () => {
    const { pkcs8 } = fixtures();
    let request: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({
        token: 'installation-token',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        repositories: [{ id: 1, name: 'port-daddy', full_name: 'curiositech/port-daddy' }],
        permissions: { contents: 'write', pull_requests: 'write' },
      }));
    }));

    await expect(mintRepositoryInstallationToken(
      '3810450', pkcs8, 123, 'curiositech', 'port-daddy',
      { contents: 'write', pull_requests: 'write' },
    )).resolves.toMatchObject({ token: 'installation-token' });
    expect(request?.redirect).toBe('error');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request?.body))).toEqual({
      repositories: ['port-daddy'],
      permissions: { contents: 'write', pull_requests: 'write' },
    });
  });

  it('revokes an issued token when GitHub returns broader authority', async () => {
    const { pkcs8 } = fixtures();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({
        token: 'must-not-leak',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        repositories: [{ id: 1, name: 'port-daddy', full_name: 'curiositech/port-daddy' }],
        permissions: { contents: 'write', pull_requests: 'write', issues: 'write' },
      }));
    }));

    await expect(mintRepositoryInstallationToken(
      '3810450', pkcs8, 123, 'curiositech', 'port-daddy',
      { contents: 'write', pull_requests: 'write' },
    )).rejects.toThrow(/exact requested permissions; issued token revocation confirmed/);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      url: 'https://api.github.com/installation/token',
      init: { method: 'DELETE', redirect: 'error' },
    });
    expect(calls[1]?.init.signal).toBeInstanceOf(AbortSignal);
  });
});
