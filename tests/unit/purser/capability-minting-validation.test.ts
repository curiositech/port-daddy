// tests/unit/purser/capability-minting-validation.test.ts

/**
 * This test suite aggressively validates the contract (CAP0) that
 * capability minting must reject any malformed or out‑of‑scope
 * claims.  It fuzzes the minting entry‑point with a variety of
 * deliberately invalid `op`, `repoId`, `protectedBranch`, `actor`,
 * `grantId`, `expiresMs`, `rootKey`, and `rentNonce` values and
 * asserts that the operation is rejected (i.e. throws).
 *
 * The purpose is to “GRILL” the implementation: the kernel must only
 * accept canonical Crockford‑base32 ULIDs (starting with 0‑7, length 26)
 * for actor, grant and repo identifiers, must enforce bounded text for
 * branch names and nonces, and must reject malformed expiration or
 * cryptographic material.  Any deviation would constitute a violation
 * of the specification.
 */

import { Buffer } from 'node:buffer';
import {
  mintActorBoundPushGrant,
  // The options type is exported for convenience; if it is not
  // exported we fall back to `any` in the helper below.
  type MintActorBoundPushGrantOptions,
} from '../../../lib/macaroon/index.ts';

// ---------------------------------------------------------------------------
// Helper – produce a fully‑valid set of options that we will then mutate
// for each negative test case.
function makeValidOptions(): MintActorBoundPushGrantOptions {
  // A canonical ULID (Crockford base‑32, 26 chars, starts with 0‑7)
  const ulid = '01F8MECHZX3TBDSZ7XRADM79A';

  return {
    rootKey: Buffer.from('deadbeefdeadbeefdeadbeefdeadbeef', 'hex'), // 16‑byte key
    grantId: ulid,
    repoId: ulid,
    actor: ulid,
    session: ulid,
    expiresMs: 60_000, // 1 minute
    caveatKey: Buffer.from('cafebabecafebabecafebabecafebabe', 'hex'),
    rentNonce: 'rent-nonce-001',
    protectedBranch: 'main',
    location: 'https://example.com/repo.git',
  };
}

// ---------------------------------------------------------------------------
// Negative test matrix – each entry mutates a single field to an
// invalid value.  The test runner will ensure that the minting function
// rejects the malformed request.
type InvalidCase = {
  /** Human‑readable description for the test output */
  name: string;
  /** Mutator that receives a copy of the valid options and returns a mutated version */
  mutate: (opts: MintActorBoundPushGrantOptions) => MintActorBoundPushGrantOptions;
};

const invalidCases: InvalidCase[] = [
  // -----------------------------------------------------------------------
  // Actor / Grant / Repo identifier violations (must be ULID, 0‑7 prefix)
  {
    name: 'actor ULID with illegal prefix (starts with 8)',
    mutate: (o) => ({
      ...o,
      actor: '81F8MECHZX3TBDSZ7XRADM79A', // starts with 8, illegal per spec
    }),
  },
  {
    name: 'grantId not a ULID (too short)',
    mutate: (o) => ({
      ...o,
      grantId: '01F8MECHZX3TBDSZ7XRA', // 20 chars instead of 26
    }),
  },
  {
    name: 'repoId contains non‑base32 characters',
    mutate: (o) => ({
      ...o,
      repoId: '01F8MECHZX3TBDSZ7XRADM79$', // illegal `$`
    }),
  },

  // -----------------------------------------------------------------------
  // Protected branch / location text bounds
  {
    name: 'protectedBranch empty string',
    mutate: (o) => ({
      ...o,
      protectedBranch: '',
    }),
  },
  {
    name: 'protectedBranch exceeds 512 characters',
    mutate: (o) => ({
      ...o,
      protectedBranch: 'a'.repeat(513),
    }),
  },

  // -----------------------------------------------------------------------
  // Expiration validation
  {
    name: 'expiresMs negative',
    mutate: (o) => ({
      ...o,
      expiresMs: -1,
    }),
  },
  {
    name: 'expiresMs zero',
    mutate: (o) => ({
      ...o,
      expiresMs: 0,
    }),
  },
  {
    name: 'expiresMs non‑integer (float)',
    mutate: (o) => ({
      ...o,
      expiresMs: 12345.67,
    }),
  },

  // -----------------------------------------------------------------------
  // Cryptographic material violations
  {
    name: 'rootKey empty buffer',
    mutate: (o) => ({
      ...o,
      rootKey: Buffer.alloc(0),
    }),
  },
  {
    name: 'caveatKey empty buffer',
    mutate: (o) => ({
      ...o,
      caveatKey: Buffer.alloc(0),
    }),
  },

  // -----------------------------------------------------------------------
  // Rent nonce bounds
  {
    name: 'rentNonce exceeds 512 characters',
    mutate: (o) => ({
      ...o,
      rentNonce: 'n'.repeat(513),
    }),
  },

  // -----------------------------------------------------------------------
  // Location URL malformed (optional but should be rejected if present)
  {
    name: 'location is not a URL',
    mutate: (o) => ({
      ...o,
      location: 'not a url',
    }),
  },
];

// ---------------------------------------------------------------------------
// Test runner – iterate over each invalid case and assert rejection.
describe('CAP0 – Capability minting must reject malformed claims', () => {
  // The minting function may be synchronous or asynchronous.  We treat
  // it as possibly async and always `await` the result.  If it throws
  // synchronously, the promise will be rejected automatically.
  for (const { name, mutate } of invalidCases) {
    test(name, async () => {
      const opts = mutate(makeValidOptions());

      // We deliberately use a wrapper to capture both sync throws and
      // async rejections.
      const mintPromise = (async () => mintActorBoundPushGrant(opts as any))();

      await expect(mintPromise).rejects.toThrow();
    });
  }
});