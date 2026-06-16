/**
 * Unit tests for the GitHub App egress credential (ADR-0053 Phase 0a).
 *
 * The whole point is a *narrowly-scoped* token: these tests pin that the mint
 * request asks GitHub for ONE repo + `contents:write` only (the confinement
 * upgrade), and that the App JWT is well-formed and actually signed by the key.
 */
import { describe, expect, test, jest } from '@jest/globals';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { signAppJwt, mintScopedPushToken } from '../../lib/fleet/github-app-egress.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const CREDS = { appId: 123456, privateKeyPem: privateKey };
const NOW = 1_700_000_000_000;

function decodeJwt(jwt) {
  const [h, p, s] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
    signingInput: `${h}.${p}`,
    signature: s,
  };
}

describe('signAppJwt', () => {
  test('produces an RS256 JWT issued by the app id, with back-dated iat', () => {
    const jwt = signAppJwt(CREDS, NOW);
    const { header, payload } = decodeJwt(jwt);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload.iss).toBe('123456');
    const nowSec = Math.floor(NOW / 1000);
    expect(payload.iat).toBe(nowSec - 60); // back-dated 60s
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600); // GitHub's 10-min cap
  });

  test('the signature actually verifies against the public key', () => {
    const { signingInput, signature } = decodeJwt(signAppJwt(CREDS, NOW));
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  test('rejects a non-numeric app id', () => {
    expect(() => signAppJwt({ appId: NaN, privateKeyPem: privateKey }, NOW)).toThrow(/appId/);
  });
});

describe('mintScopedPushToken', () => {
  function okFetch(captured) {
    return async (url, init) => {
      captured.url = url;
      captured.init = init;
      return {
        ok: true,
        status: 201,
        json: async () => ({ token: 'ghs_scopedtoken', expires_at: '2026-06-15T17:00:00Z' }),
      };
    };
  }

  test('requests a token scoped to ONE repo + contents:write only', async () => {
    const captured = {};
    const result = await mintScopedPushToken({
      ...CREDS,
      installationId: 42,
      owner: 'curiositech',
      repo: 'port-daddy',
      fetchImpl: okFetch(captured),
      nowMs: NOW,
    });

    // The confinement: the mint body narrows scope.
    expect(captured.url).toBe('https://api.github.com/app/installations/42/access_tokens');
    const body = JSON.parse(captured.init.body);
    expect(body).toEqual({ repositories: ['port-daddy'], permissions: { contents: 'write' } });
    expect(captured.init.headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);

    expect(result.token).toBe('ghs_scopedtoken');
    expect(result.owner).toBe('curiositech');
    expect(result.repo).toBe('port-daddy');
    expect(result.expiresAt).toBe(new Date('2026-06-15T17:00:00Z').getTime());
  });

  test('throws (loud) on a non-2xx mint', async () => {
    const failFetch = async () => ({
      ok: false,
      status: 403,
      text: async () => 'installation not found',
    });
    await expect(
      mintScopedPushToken({
        ...CREDS,
        installationId: 42,
        owner: 'o',
        repo: 'r',
        fetchImpl: failFetch,
        nowMs: NOW,
      }),
    ).rejects.toThrow(/403 installation not found/);
  });

  test('throws when the mint response is missing a token', async () => {
    const badFetch = async () => ({ ok: true, status: 201, json: async () => ({}) });
    await expect(
      mintScopedPushToken({
        ...CREDS,
        installationId: 42,
        owner: 'o',
        repo: 'r',
        fetchImpl: badFetch,
        nowMs: NOW,
      }),
    ).rejects.toThrow(/missing token/);
  });

  test('validates installationId and owner/repo', async () => {
    const noop = async () => ({ ok: true, status: 201, json: async () => ({}) });
    await expect(
      mintScopedPushToken({ ...CREDS, installationId: NaN, owner: 'o', repo: 'r', fetchImpl: noop }),
    ).rejects.toThrow(/installationId/);
    await expect(
      mintScopedPushToken({ ...CREDS, installationId: 1, owner: '', repo: 'r', fetchImpl: noop }),
    ).rejects.toThrow(/owner and repo/);
  });
});
