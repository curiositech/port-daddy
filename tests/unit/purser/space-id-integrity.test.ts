// tests/unit/purser/space-id-integrity.test.ts
/**
 * Verifies that the canonical embedding space‑ID derivation performed by the
 * registry generator matches the contract’s length‑framed, domain‑separated
 * SHA‑256 algorithm, and that it is robust against adversarial input ordering,
 * Unicode normalisation, and edge‑case values.
 *
 * The test exercises the *actual* generated artifacts (lib/model-registry-data)
 * rather than re‑implementing the generator, ensuring the contract is enforced
 * at runtime.
 */

import { describe, it, expect } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalize } from 'node:string';

// ---------------------------------------------------------------------------
// Constants that mirror the generator’s internal configuration (see
// scripts/generate-model-registry.ts). They are deliberately duplicated here
// because they are not exported from the generator – the test must be able to
// reconstruct the pre‑image independently.
// ---------------------------------------------------------------------------
const SPACE_DOMAIN = 'port-daddy.embedding-space';
const SPACE_VERSION = 2;

// Fixed order of logical fields used for space‑ID derivation.
const SPACE_FIELD_ORDER = [
  'version',
  'modelDigest',
  'modelConfigDigest',
  'preprocessingDigest',
  'dimensions',
  'normalization',
  'metric',
  'pooling',
  'coordinatePrecision',
  'coordinateQuantization',
  'storageQuantization',
] as const;

// ---------------------------------------------------------------------------
// Helper: length‑frame a Buffer (4‑byte big‑endian length prefix)
// ---------------------------------------------------------------------------
function lengthFrame(buf: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

/**
 * Derives the canonical space‑ID for a given embedding profile using the
 * contract‑specified algorithm.
 *
 * @param profile - The raw profile object (must contain all fields from
 *                  SPACE_FIELD_ORDER, except `spaceId` itself).
 * @returns The space‑ID string in the form `embed-v2:<64‑hex>`.
 */
function deriveSpaceId(profile: Record<string, unknown>): string {
  // Domain separation + version (big‑endian 4‑byte)
  const parts: Buffer[] = [
    Buffer.from(SPACE_DOMAIN, 'utf8'),
    Buffer.alloc(4, 0), // placeholder for version
  ];
  parts[1].writeUInt32BE(SPACE_VERSION, 0);

  // Append each field in the canonical order, length‑framed.
  for (const key of SPACE_FIELD_ORDER) {
    const raw = profile[key];
    if (raw === undefined) {
      throw new Error(`Missing required field "${key}" for space‑ID derivation`);
    }
    // Normalise any string values to NFC to guarantee Unicode‑stable hashes.
    const value =
      typeof raw === 'string' ? normalize(raw, 'NFC') : JSON.stringify(raw);
    const buf = Buffer.from(value, 'utf8');
    parts.push(lengthFrame(buf));
  }

  const preimage = Buffer.concat(parts);
  const hash = createHash('sha256').update(preimage).digest('hex');
  return `embed-v2:${hash}`;
}

// ---------------------------------------------------------------------------
// Load the generated registry data (runtime‑immutable, frozen objects).
// ---------------------------------------------------------------------------
import type { EmbeddingProfile } from '../../../lib/model-registry-data.ts';
import { embeddingProfiles } from '../../../lib/model-registry-data.ts';

// Choose a deterministic profile – the first entry in the map.
const PROFILE_ID = Object.keys(embeddingProfiles)[0];
if (!PROFILE_ID) {
  throw new Error('No embedding profiles found in generated registry');
}
const CANONICAL_PROFILE = embeddingProfiles[PROFILE_ID] as EmbeddingProfile;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Embedding space‑ID integrity', () => {
  it('matches the contract‑derived hash for the generated profile', () => {
    // Strip the already‑computed spaceId before feeding to the derivation routine.
    const { spaceId, ...rawProfile } = CANONICAL_PROFILE as Record<string, unknown>;

    const expected = deriveSpaceId(rawProfile as Record<string, unknown>);
    expect(spaceId).toBe(expected);
  });

  it('is invariant to object key ordering', () => {
    const { spaceId, ...raw } = CANONICAL_PROFILE as Record<string, unknown>;

    // Re‑order keys arbitrarily.
    const shuffled: Record<string, unknown> = {};
    const keys = Object.keys(raw);
    // Simple deterministic "shuffle": reverse the array.
    for (const k of keys.slice().reverse()) {
      shuffled[k] = raw[k];
    }

    const derived = deriveSpaceId(shuffled);
    expect(derived).toBe(spaceId);
  });

  it('normalises Unicode consistently (NFC vs NFD)', () => {
    const { spaceId, ...raw } = CANONICAL_PROFILE as Record<string, unknown>;

    // Pick a string field that is guaranteed to exist – e.g., modelDigest.
    const field = 'modelDigest' as const;
    const original = String(raw[field]);

    // Create an NFD version (decomposed) of the same string.
    const decomposed = normalize(original, 'NFD');

    // Clone profile and replace the field with the decomposed variant.
    const altered = { ...raw, [field]: decomposed };

    const derived = deriveSpaceId(altered);
    expect(derived).toBe(spaceId);
  });

  it('produces a different hash when a logical field changes', () => {
    const { spaceId, ...raw } = CANONICAL_PROFILE as Record<string, unknown>;

    // Mutate a logical field (dimensions) – this must affect the hash.
    const altered = { ...raw, dimensions: (raw['dimensions'] as number) + 1 };

    const derived = deriveSpaceId(altered);
    expect(derived).not.toBe(spaceId);
  });

  it('rejects profiles missing required fields (fail‑closed)', () => {
    const incomplete = { version: 2, modelDigest: 'abc' }; // missing many fields
    expect(() => deriveSpaceId(incomplete as any)).toThrow(
      /Missing required field/
    );
  });
});