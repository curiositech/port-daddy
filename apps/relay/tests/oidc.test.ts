/**
 * Tests for OIDC token verification (ADR-0049)
 *
 * These test the fail-closed validation logic without hitting real GitHub.
 * We construct synthetic JWTs signed with a known test key.
 */

import { describe, it, expect } from 'vitest';
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
  await verifyOidcToken({} as never, makeUnsignedJwt(payload), issuerRow, fakeJwks);
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
});
