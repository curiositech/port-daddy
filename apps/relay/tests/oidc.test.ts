/**
 * Tests for OIDC token verification (ADR-0049)
 *
 * These test the fail-closed validation logic without hitting real GitHub.
 * We construct synthetic JWTs signed with a known test key.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { OidcError } from '../src/oidc.js';

// ── Synthetic JWT helper ──────────────────────────────────────────────────────

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeUnsignedJwt(payload: Record<string, unknown>): string {
  const header = b64url({ alg: 'RS256', kid: 'test-kid' });
  const body = b64url(payload);
  return `${header}.${body}.invalidsig`;
}

const TRUST_POLICY = JSON.stringify({
  repositoryOwnerIds: ['12345'],
  repositories: ['testorg/testrepo'],
  jobWorkflowRefs: ['testorg/testrepo/.github/workflows/ci.yml@refs/heads/main'],
  refs: ['refs/heads/main'],
  environments: [null, 'production'],
  runnerEnvironments: ['github-hosted'],
  eventNames: ['push'],
});

// ── Claim validation (no sig check — we test claim logic only) ───────────────

async function validateClaims(payload: Record<string, unknown>, expectedAud = 'https://github.com/testorg'): Promise<void> {
  const { verifyOidcToken } = await import('../src/oidc.js');
  // We can't test full sig verification without a real key in unit tests.
  // Instead, test the claim validation path by mocking verifyJwtSignature
  // indirectly: these tests focus on the claim checks that run BEFORE signature.
  // For now we test the error paths directly.
  const issuerRow = {
    issuer_id: 'https://token.actions.githubusercontent.com',
    jwks_uri: 'https://token.actions.githubusercontent.com/.well-known/jwks',
    audience: expectedAud,
    disabled: false,
  };
  // We pass a fake JWKS — the test will fail on sig, but we check claim errors
  // reach us BEFORE the sig check (enforced by order in verifyOidcToken).
  const fakeJwks = { keys: [] };
  await verifyOidcToken(
    { OIDC_GITHUB_TRUST_POLICY_JSON: TRUST_POLICY } as never,
    makeUnsignedJwt(payload),
    issuerRow,
    fakeJwks,
  );
}

async function expectClaimError(payload: Record<string, unknown>, code: string): Promise<void> {
  await expect(validateClaims(payload)).rejects.toMatchObject({ code });
}

describe('OIDC claim validation', () => {
  const baseClaims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'https://github.com/testorg',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: 'test-jti-123',
    sub: 'repo:testorg/testrepo:ref:refs/heads/main',
    repository: 'testorg/testrepo',
    repository_owner: 'testorg',
    repository_owner_id: '12345',
    workflow: 'CI',
    ref: 'refs/heads/main',
    sha: 'abc123',
    run_id: '1',
    run_number: '1',
    job_workflow_ref: 'testorg/testrepo/.github/workflows/ci.yml@refs/heads/main',
    actor: 'testorg',
    event_name: 'push',
    runner_environment: 'github-hosted',
  };

  it('rejects wrong issuer', async () => {
    await expect(validateClaims({ ...baseClaims, iss: 'https://evil.com' }))
      .rejects.toThrow(OidcError);
    await expect(validateClaims({ ...baseClaims, iss: 'https://evil.com' }))
      .rejects.toMatchObject({ code: 'WRONG_ISSUER' });
  });

  it('rejects wrong audience', async () => {
    await expect(validateClaims({ ...baseClaims, aud: 'https://github.com/wrongorg' }))
      .rejects.toMatchObject({ code: 'WRONG_AUDIENCE' });
  });

  it('rejects a multi-audience token even when one value matches', async () => {
    await expect(validateClaims({
      ...baseClaims,
      aud: ['https://github.com/testorg', 'https://evil.example'],
    })).rejects.toMatchObject({ code: 'WRONG_AUDIENCE' });
  });

  it('rejects wildcard audience', async () => {
    await expect(validateClaims({ ...baseClaims, aud: '*' }))
      .rejects.toMatchObject({ code: 'WILDCARD_AUDIENCE' });
  });

  it('rejects empty audience', async () => {
    await expect(validateClaims({ ...baseClaims, aud: '' }))
      .rejects.toMatchObject({ code: 'WILDCARD_AUDIENCE' });
  });

  it('rejects expired token', async () => {
    await expect(validateClaims({ ...baseClaims, exp: Math.floor(Date.now() / 1000) - 10 }))
      .rejects.toMatchObject({ code: 'EXPIRED' });
  });

  it('rejects missing jti', async () => {
    const { jti: _, ...noJti } = baseClaims;
    await expect(validateClaims(noJti))
      .rejects.toMatchObject({ code: 'MISSING_JTI' });
  });

  it('rejects missing repository_owner', async () => {
    const { repository_owner: _, ...noOwner } = baseClaims;
    await expect(validateClaims(noOwner))
      .rejects.toMatchObject({ code: 'UNKNOWN_OWNER' });
  });

  it('rejects future nbf', async () => {
    await expect(validateClaims({ ...baseClaims, nbf: Math.floor(Date.now() / 1000) + 100 }))
      .rejects.toMatchObject({ code: 'NOT_YET_VALID' });
  });

  it('fails closed when the workload trust policy is absent', async () => {
    const { verifyOidcToken } = await import('../src/oidc.js');
    await expect(verifyOidcToken(
      {} as never,
      makeUnsignedJwt(baseClaims),
      {
        issuer_id: baseClaims.iss,
        jwks_uri: 'https://token.actions.githubusercontent.com/.well-known/jwks',
        audience: baseClaims.aud,
        disabled: false,
      },
      { keys: [] },
    )).rejects.toMatchObject({ code: 'OIDC_POLICY_UNCONFIGURED' });
  });

  it('rejects a non-numeric or untrusted immutable owner id', async () => {
    await expectClaimError({ ...baseClaims, repository_owner_id: 'testorg' }, 'INVALID_OWNER_ID');
    await expectClaimError({ ...baseClaims, repository_owner_id: '99999' }, 'UNTRUSTED_OWNER_ID');
  });

  it('rejects a repository outside the exact allowlist', async () => {
    await expectClaimError({
      ...baseClaims,
      repository: 'testorg/other',
      sub: 'repo:testorg/other:ref:refs/heads/main',
    }, 'UNTRUSTED_REPOSITORY');
  });

  it('rejects a mutable owner login that disagrees with the repository claim', async () => {
    await expectClaimError({ ...baseClaims, repository_owner: 'renamed-org' }, 'REPOSITORY_OWNER_MISMATCH');
  });

  it('rejects an untrusted workflow, ref, environment, runner, event, or subject', async () => {
    await expectClaimError({
      ...baseClaims,
      job_workflow_ref: 'testorg/testrepo/.github/workflows/evil.yml@refs/heads/main',
    }, 'UNTRUSTED_WORKFLOW');
    await expectClaimError({ ...baseClaims, ref: 'refs/heads/feature' }, 'UNTRUSTED_REF');
    await expectClaimError({
      ...baseClaims,
      environment: 'preview',
      sub: 'repo:testorg/testrepo:environment:preview',
    }, 'UNTRUSTED_ENVIRONMENT');
    await expectClaimError({ ...baseClaims, runner_environment: 'self-hosted' }, 'UNTRUSTED_RUNNER_ENVIRONMENT');
    await expectClaimError({ ...baseClaims, event_name: 'pull_request_target' }, 'UNTRUSTED_EVENT');
    await expectClaimError({ ...baseClaims, sub: 'repo:testorg/other:ref:refs/heads/main' }, 'SUBJECT_MISMATCH');
  });

  it('rejects wildcard and unknown policy fields rather than widening trust', async () => {
    const { verifyOidcToken } = await import('../src/oidc.js');
    const issuer = {
      issuer_id: baseClaims.iss,
      jwks_uri: 'https://token.actions.githubusercontent.com/.well-known/jwks',
      audience: baseClaims.aud,
      disabled: false,
    };
    for (const policy of [
      { ...JSON.parse(TRUST_POLICY), repositories: ['testorg/*'] },
      { ...JSON.parse(TRUST_POLICY), permitEverything: true },
      null,
    ]) {
      await expect(verifyOidcToken(
        { OIDC_GITHUB_TRUST_POLICY_JSON: JSON.stringify(policy) } as never,
        makeUnsignedJwt(baseClaims),
        issuer,
        { keys: [] },
      )).rejects.toMatchObject({ code: 'OIDC_POLICY_INVALID' });
    }
  });
});

describe('OIDC JWKS key rotation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('performs exactly one forced JWKS refresh for an unknown kid', async () => {
    const ed = await import('@noble/ed25519');
    const privateKey = new Uint8Array(32).fill(23);
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const encodeBytes = (bytes: Uint8Array) => {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    };
    const header = b64url({ alg: 'EdDSA', kid: 'rotated-kid' });
    const claims = {
      iss: 'https://token.actions.githubusercontent.com',
      aud: 'https://github.com/testorg',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      jti: 'rotated-key-jti',
      sub: 'repo:testorg/testrepo:ref:refs/heads/main',
      repository: 'testorg/testrepo',
      repository_owner: 'testorg',
      repository_owner_id: '12345',
      workflow: 'CI',
      ref: 'refs/heads/main',
      sha: 'abc123',
      run_id: '2',
      run_number: '2',
      job_workflow_ref: 'testorg/testrepo/.github/workflows/ci.yml@refs/heads/main',
      actor: 'testorg',
      event_name: 'push',
      runner_environment: 'github-hosted',
    };
    const payload = b64url(claims);
    const signingInput = `${header}.${payload}`;
    const signature = await ed.signAsync(new TextEncoder().encode(signingInput), privateKey);
    const token = `${signingInput}.${encodeBytes(signature)}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      keys: [{
        kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', kid: 'rotated-kid', x: encodeBytes(publicKey),
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const kv = new Map<string, string>();
    const env = {
      OIDC_GITHUB_TRUST_POLICY_JSON: TRUST_POLICY,
      JWKS_CACHE_TTL_SECONDS: '600',
      JWKS_FAIL_SOFT_SECONDS: '3600',
      KV: {
        get: async (key: string) => kv.get(key) ?? null,
        put: async (key: string, value: string) => { kv.set(key, value); },
      },
      DB: {
        prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }),
      },
    };
    const issuer = {
      issuer_id: claims.iss,
      jwks_uri: 'https://token.actions.githubusercontent.com/.well-known/jwks',
      audience: claims.aud,
      disabled: false,
    };

    const { verifyOidcToken } = await import('../src/oidc.js');
    await expect(verifyOidcToken(env as never, token, issuer, {
      keys: [{ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', kid: 'old-kid', x: encodeBytes(publicKey) }],
    })).resolves.toMatchObject({ jti: 'rotated-key-jti' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
