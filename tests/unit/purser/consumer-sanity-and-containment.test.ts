// the complete contents of tests/unit/purser/consumer-sanity-and-containment.test.ts
import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { embeddingProfileForModel } from '../../../lib/model-registry.ts';

/**
 * Minimal consumer‑side validator that enforces the containment contract
 * described in the PR. It is deliberately simple – the production code
 * validates the full JSON schema elsewhere – but it must reject any plan
 * that tries to treat a `declarative-only` profile as persistent or
 * comparable.
 *
 * @param plan The parsed plan JSON.
 * @throws When the plan violates quarantine rules.
 */
function assertPlanQuarantineCompliance(plan: any): void {
  // 1. The profile must be a v2 degraded‑fallback declarative‑only entry.
  const profile = plan.embeddingProfile;
  if (!profile) {
    throw new Error('plan must contain an embeddingProfile');
  }
  if (profile.version !== 2) {
    throw new Error('embeddingProfile.version must be 2');
  }
  if (profile.quality !== 'degraded-fallback') {
    throw new Error('embeddingProfile must be degraded-fallback');
  }
  if (profile.runtimeBinding !== 'declarative-only') {
    throw new Error('embeddingProfile.runtimeBinding must be declarative-only');
  }

  // 2. Vectors must be quarantined or ephemeral‑uncompared.
  const allowedDispositions = new Set(['ephemeral-uncompared', 'quarantined-uncompared']);
  if (!allowedDispositions.has(plan.vectorDisposition)) {
    throw new Error(
      `vectorDisposition must be one of ${Array.from(allowedDispositions).join(', ')}`,
    );
  }

  // 3. Similarity comparison must be explicitly disabled.
  if (plan.similarityComparisonEnabled !== false) {
    throw new Error('similarityComparisonEnabled must be false for declarative profiles');
  }
}

/**
 * Load the sample plan JSON shipped with the skill.
 */
function loadSamplePlan(): any {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const planPath = join(__dirname, '..', '..', '..', 'skills', 'transformers-js-onnx-pipelines', 'examples', 'sample-input.json');
  const raw = readFileSync(planPath, 'utf8');
  return JSON.parse(raw);
}

describe('Embedding profile registry consumer contract', () => {
  test('registry‑generated profile defaults are degraded‑fallback & declarative‑only', () => {
    // Pick a known embedding model from the registry.
    const modelId = '@cf/baai/bge-base-en-v1.5';
    const profile = embeddingProfileForModel(modelId);
    expect(profile).toBeDefined();
    // The profile must be a v2 entry.
    expect(profile?.version).toBe(2);
    // By generator contract it must be degraded‑fallback and declarative‑only.
    expect(profile?.quality).toBe('degraded-fallback');
    expect(profile?.runtimeBinding).toBe('declarative-only');
    // Sanity‑check that the spaceId follows the required format.
    expect(typeof profile?.spaceId).toBe('string');
    expect(profile?.spaceId).toMatch(/^embed-v2:[0-9a-f]{64}$/);
  });

  test('sample plan complies with quarantine constraints', () => {
    const plan = loadSamplePlan();

    // The plan references a model that exists in the registry.
    const registryProfile = embeddingProfileForModel(plan.loaderModelId);
    expect(registryProfile).toBeDefined();

    // The spaceId in the plan must match the canonical registry spaceId.
    expect(plan.embeddingProfile?.spaceId).toBe(registryProfile?.spaceId);

    // Run the minimal containment validator – it should not throw.
    expect(() => assertPlanQuarantineCompliance(plan)).not.toThrow();
  });

  test('consumer validation rejects non‑quarantined dispositions and enabled similarity', () => {
    const basePlan = loadSamplePlan();

    // ---- Violation 1: disallowed vectorDisposition ----
    const badDisposition = { ...basePlan, vectorDisposition: 'persisted' };
    expect(() => assertPlanQuarantineCompliance(badDisposition)).toThrow(
      /vectorDisposition must be one of/,
    );

    // ---- Violation 2: similarityComparisonEnabled true ----
    const badSimilarity = { ...basePlan, similarityComparisonEnabled: true };
    expect(() => assertPlanQuarantineCompliance(badSimilarity)).toThrow(
      /similarityComparisonEnabled must be false/,
    );

    // ---- Violation 3: profile claims approved quality (should be degraded) ----
    const badQuality = {
      ...basePlan,
      embeddingProfile: { ...basePlan.embeddingProfile, quality: 'approved' },
    };
    expect(() => assertPlanQuarantineCompliance(badQuality)).toThrow(
      /must be degraded-fallback/,
    );

    // ---- Violation 4: profile claims runtimeBinding other than declarative-only ----
    const badBinding = {
      ...basePlan,
      embeddingProfile: { ...basePlan.embeddingProfile, runtimeBinding: 'producer-attested' },
    };
    expect(() => assertPlanQuarantineCompliance(badBinding)).toThrow(
      /runtimeBinding must be declarative-only/,
    );
  });
});