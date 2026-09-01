// tests/unit/purser/immutability-and-referential-integrity.test.ts

import {
  CF_ADMITTED_MODELS,
  CF_EMBEDDING_PROFILES,
  CF_ROLE_MODELS,
} from '../../../apps/shared/model-registry.generated.ts';
import { MODEL_REGISTRY_DATA } from '../../../lib/model-registry-data.ts';

describe('Canonical Embedding Profile Registry – immutability & referential integrity', () => {
  // -------------------------------------------------------------------------
  // Helper utilities
  // -------------------------------------------------------------------------
  const isSpaceIdValid = (id: string) => /^embed-v2:[0-9a-f]{64}$/.test(id);

  // -------------------------------------------------------------------------
  // Immutability checks
  // -------------------------------------------------------------------------
  test('Top‑level registry objects are frozen and non‑extensible', () => {
    // Registry containers
    const containers = [
      { name: 'CF_ADMITTED_MODELS', obj: CF_ADMITTED_MODELS },
      { name: 'CF_EMBEDDING_PROFILES', obj: CF_EMBEDDING_PROFILES },
      { name: 'CF_ROLE_MODELS', obj: CF_ROLE_MODELS },
    ];

    for (const { name, obj } of containers) {
      expect(Object.isFrozen(obj)).toBe(
        true,
        `${name} should be frozen at the top level`,
      );
      expect(Object.isExtensible(obj)).toBe(
        false,
        `${name} should not be extensible`,
      );
    }
  });

  test('Each embedding profile object is frozen and contains required default fields', () => {
    for (const [profileId, profile] of Object.entries(CF_EMBEDDING_PROFILES)) {
      // Immutability
      expect(Object.isFrozen(profile)).toBe(
        true,
        `Embedding profile ${profileId} must be frozen`,
      );

      // Required default fields (contract mandates these when no attestation exists)
      expect(profile).toHaveProperty('quality', 'degraded-fallback');
      expect(profile).toHaveProperty('runtimeBinding', 'declarative-only');

      // Space‑ID format
      expect(profile).toHaveProperty('spaceId');
      const spaceId = (profile as any).spaceId;
      expect(typeof spaceId).toBe('string');
      expect(isSpaceIdValid(spaceId)).toBe(
        true,
        `spaceId "${spaceId}" of profile ${profileId} must match embed-v2:<64‑hex>`,
      );
    }
  });

  test('Attempting to mutate a frozen profile throws', () => {
    const someProfileKey = Object.keys(CF_EMBEDDING_PROFILES)[0];
    const profile = CF_EMBEDDING_PROFILES[someProfileKey] as any;

    // In strict mode, assigning to a frozen object throws a TypeError.
    // Wrap in a function to capture the exception.
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      profile.malicious = 'attack';
    }).toThrow(TypeError);
  });

  // -------------------------------------------------------------------------
  // Referential integrity checks
  // -------------------------------------------------------------------------
  test('Every embedding profile references a model that advertises embedding capability', () => {
    for (const profile of Object.values(CF_EMBEDDING_PROFILES) as any[]) {
      // The contract states that a profile must be tied to a model entry.
      // The field name used by the generator is `modelId` (verified by the
      // generated source). If the field is missing we treat it as a failure.
      expect(profile).toHaveProperty('modelId');

      const modelId = profile.modelId as string;
      const model = (CF_ADMITTED_MODELS as Record<string, any>)[modelId];
      expect(model).toBeDefined();

      // The model must list `embedding` among its capabilities.
      const capabilities = model.capabilities ?? [];
      expect(Array.isArray(capabilities)).toBe(true);
      expect(capabilities).toContain('embedding');
    }
  });

  test('Role models that depend on an embedding profile bind to an existing profile', () => {
    for (const role of Object.values(CF_ROLE_MODELS) as any[]) {
      // Roles that require embedding expose a `defaultEmbeddingProfileId` field.
      if (!('defaultEmbeddingProfileId' in role)) continue;

      const embedId = role.defaultEmbeddingProfileId as string;
      expect(embedId).toBeDefined();

      const profile = (CF_EMBEDDING_PROFILES as Record<string, any>)[embedId];
      expect(profile).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // Consistency between raw data and generated, frozen artifacts
  // -------------------------------------------------------------------------
  test('Generated artifacts reflect the source data without mutation', () => {
    // The raw data object is the source of truth for the generator.
    // It should contain the same keys as the frozen export.
    const rawProfiles = (MODEL_REGISTRY_DATA as any).embeddingProfiles;
    expect(rawProfiles).toBeDefined();

    const rawKeys = Object.keys(rawProfiles).sort();
    const generatedKeys = Object.keys(CF_EMBEDDING_PROFILES).sort();

    expect(generatedKeys).toEqual(
      rawKeys,
      'Generated embedding profile keys must exactly match the source data keys',
    );

    // Spot‑check that a random profile's deep structure matches.
    const sampleKey = generatedKeys[0];
    if (sampleKey) {
      expect(CF_EMBEDDING_PROFILES[sampleKey]).toStrictEqual(
        rawProfiles[sampleKey],
      );
    }
  });
});