/**
 * Unit tests for the GitHub App egress credential (ADR-0053 Phase 0a).
 *
 * The whole point is a *narrowly-scoped* token: these tests pin that the mint
 * request asks GitHub for ONE repo + contents-write by default, with explicit
 * workflow/PR opt-ins, verifies the returned grant, and bounds rejected-token
 * cleanup. The App JWT is well-formed and actually signed by the key.
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
  const REQUEST = { ...CREDS, installationId: 42, owner: 'curiositech', repo: 'port-daddy', nowMs: NOW };
  function grant(overrides = {}) {
    return {
      token: 'ghs_scopedtoken', expires_at: new Date(NOW + 3_600_000).toISOString(),
      permissions: { contents: 'write', metadata: 'read' },
      repository_selection: 'selected', repositories: [{ full_name: 'curiositech/port-daddy' }],
      ...overrides,
    };
  }
  function fixtureFetch(data = grant(), cleanupStatus = 204) {
    return jest.fn(async (_url, init) => init.method === 'DELETE'
      ? { status: cleanupStatus }
      : { status: 201, json: async () => data });
  }

  test.each([
    ['default', {}, { contents: 'write' }],
    ['explicit false', { workflowWrite: false, pullRequestsWrite: false }, { contents: 'write' }],
    ['workflow only', { workflowWrite: true }, { contents: 'write', workflows: 'write' }],
    ['PR only', { pullRequestsWrite: true }, { contents: 'write', pull_requests: 'write' }],
    ['workflow and PR', { workflowWrite: true, pullRequestsWrite: true },
      { contents: 'write', workflows: 'write', pull_requests: 'write' }],
  ])('requests and verifies exact ONE-repo permissions: %s', async (_name, options, permissions) => {
    const fetchImpl = fixtureFetch(grant({ permissions: { ...permissions, metadata: 'read' } }));
    const result = await mintScopedPushToken({ ...REQUEST, ...options, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // successful grant belongs to caller cleanup
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.github.com/app/installations/42/access_tokens');
    expect(JSON.parse(init.body)).toEqual({ repositories: ['port-daddy'], permissions });
    expect(init.headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ token: 'ghs_scopedtoken', expiresAt: NOW + 3_600_000,
      owner: REQUEST.owner, repo: REQUEST.repo });
  });

  test('does not accept an arbitrary permission map or caller repository list', async () => {
    const fetchImpl = fixtureFetch();
    await mintScopedPushToken({ ...REQUEST, fetchImpl,
      permissions: { administration: 'write' }, repositories: ['other-repo'] });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      repositories: ['port-daddy'], permissions: { contents: 'write' },
    });
  });

  test.each([
    ['missing permissions', { permissions: undefined }],
    ['read-only contents', { permissions: { contents: 'read' } }],
    ['extra workflow permission by default', { permissions: { contents: 'write', workflows: 'write' } }],
    ['extra PR permission by default', { permissions: { contents: 'write', pull_requests: 'write' } }],
    ['admin permission', { permissions: { contents: 'write', administration: 'write' } }],
    ['metadata write', { permissions: { contents: 'write', metadata: 'write' } }],
    ['permissions array', { permissions: ['contents'] }],
    ['wrong owner', { repositories: [{ full_name: 'someone/port-daddy' }] }],
    ['wrong repository', { repositories: [{ full_name: 'curiositech/other' }] }],
    ['two repositories', { repositories: [{ full_name: 'curiositech/port-daddy' }, { full_name: 'curiositech/other' }] }],
    ['missing repositories', { repositories: undefined }],
    ['empty repositories', { repositories: [] }],
    ['all-repository selection', { repository_selection: 'all' }],
    ['missing repository selection', { repository_selection: undefined }],
    ['missing expiry', { expires_at: undefined }],
    ['unparseable expiry', { expires_at: 'secret-remote-diagnostic' }],
    ['expired', { expires_at: new Date(NOW - 1).toISOString() }],
    ['expires now', { expires_at: new Date(NOW).toISOString() }],
    ['excess lifetime', { expires_at: new Date(NOW + 3_660_001).toISOString() }],
  ])('rejects and revokes a bad grant: %s', async (_name, overrides) => {
    const fetchImpl = fixtureFetch(grant(overrides));
    await expect(mintScopedPushToken({ ...REQUEST, fetchImpl })).rejects.toThrow(/cleanup confirmed/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe('https://api.github.com/installation/token');
    expect(init).toMatchObject({ method: 'DELETE', redirect: 'error', headers: { Authorization: 'Bearer ghs_scopedtoken' } });
    expect(init.body).toBeUndefined();
  });

  test.each([{ workflowWrite: true }, { pullRequestsWrite: true }])('rejects a missing explicit requested permission: %p', async (options) => {
    const fetchImpl = fixtureFetch();
    await expect(mintScopedPushToken({ ...REQUEST, ...options, fetchImpl })).rejects.toThrow(/permissions.*cleanup confirmed/);
  });

  test('allows only bounded expiry skew and case-insensitive GitHub names', async () => {
    const fetchImpl = fixtureFetch(grant({ expires_at: new Date(NOW + 3_660_000).toISOString(),
      repositories: [{ full_name: 'Curiositech/Port-Daddy' }] }));
    await expect(mintScopedPushToken({ ...REQUEST, fetchImpl })).resolves.toMatchObject({ expiresAt: NOW + 3_660_000 });
  });

  test.each([401, 403, 404, 422, 429, 500])('does not echo error bodies or retry HTTP %i', async (status) => {
    const text = jest.fn(async () => 'secret-remote-diagnostic ghs_scopedtoken');
    const fetchImpl = jest.fn(async () => ({ status, text }));
    await expect(mintScopedPushToken({ ...REQUEST, fetchImpl })).rejects.toThrow(`mint failed: HTTP ${status}; not retried`);
    expect(text).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test.each([{}, null, { token: 123 }, { token: 'ghs_unsafe\r\nheader' }])('missing/unusable token cannot be returned or used for cleanup: %p', async (data) => {
    const fetchImpl = fixtureFetch(data);
    await expect(mintScopedPushToken({ ...REQUEST, fetchImpl })).rejects.toThrow(/missing usable token; cleanup unavailable/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test.each([200, 401, 500])('only 204 confirms rejected-token cleanup, not %i', async (status) => {
    const fetchImpl = fixtureFetch(grant({ permissions: {} }), status);
    await expect(mintScopedPushToken({ ...REQUEST, fetchImpl })).rejects.toThrow(/permissions.*cleanup unconfirmed/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('transport failures preserve cleanup uncertainty without leaking credentials or reminting', async () => {
    const fetchImpl = fixtureFetch(grant({ permissions: {} }));
    fetchImpl.mockImplementationOnce(async () => ({ status: 201, json: async () => grant({ permissions: {} }) }))
      .mockImplementationOnce(async () => { throw new Error('secret-remote-diagnostic ghs_scopedtoken'); });
    const error = await mintScopedPushToken({ ...REQUEST, fetchImpl }).catch((e) => e);
    expect(error.message).toMatch(/permissions.*cleanup unconfirmed/);
    expect(error.message).not.toMatch(/secret-remote|ghs_scopedtoken/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test.each(['transport', 'json'])('sanitizes unknown mint outcome from %s failure without retry', async (stage) => {
    const fail = async () => { throw new Error('secret-remote-diagnostic'); };
    const fetchImpl = jest.fn(stage === 'transport' ? fail : async () => ({ status: 201, json: fail }));
    const error = await mintScopedPushToken({ ...REQUEST, fetchImpl }).catch((e) => e);
    expect(error.message).toMatch(/outcome unknown; cleanup unavailable; not retried/);
    expect(error.message).not.toContain('secret-remote');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test.each(['transport', 'json', 'cleanup'])('deadline bounds a stalled %s even when it ignores abort', async (stage) => {
    jest.useFakeTimers();
    try {
      const pending = () => new Promise(() => {});
      const fetchImpl = jest.fn(async (_url, init) => {
        if (stage === 'transport' || init.method === 'DELETE') return pending();
        return { status: 201, json: stage === 'json' ? pending : async () => grant({ permissions: {} }) };
      });
      const result = mintScopedPushToken({ ...REQUEST, fetchImpl }).catch((e) => e);
      await jest.advanceTimersByTimeAsync(stage === 'cleanup' ? 5_000 : 15_000);
      const error = await result;
      expect(error.message).toMatch(stage === 'cleanup' ? /cleanup unconfirmed/ : /outcome unknown/);
      expect(fetchImpl).toHaveBeenCalledTimes(stage === 'cleanup' ? 2 : 1);
      expect(fetchImpl.mock.calls.at(-1)[1].signal.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  test.each([
    [{ installationId: NaN }, /installationId/], [{ owner: '' }, /owner and repo/],
    [{ owner: 'a/b' }, /owner and repo/], [{ repo: ['r', 'other'] }, /owner and repo/],
    [{ repo: '..' }, /owner and repo/], [{ workflowWrite: 'true' }, /workflowWrite/],
    [{ pullRequestsWrite: 1 }, /pullRequestsWrite/], [{ nowMs: NaN }, /clock/],
  ])('validates input before contacting GitHub: %p', async (overrides, diagnostic) => {
    const fetchImpl = jest.fn();
    await expect(mintScopedPushToken({ ...REQUEST, ...overrides, fetchImpl })).rejects.toThrow(diagnostic);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
