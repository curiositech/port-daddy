// tests/unit/purser/script-validation.test.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as yamlStringify } from 'yaml';

// Resolve __dirname in an ES‑module context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to load the raw YAML source from the repository
function loadRawModelsYaml(): string {
  const yamlPath = join(__dirname, '..', '..', '..', 'config', 'models.yaml');
  return readFileSync(yamlPath, 'utf8');
}

// -----------------------------------------------------------------------------
// 1️⃣  BASIC VALIDATION – the canonical config must pass the generator’s
//     strict schema checks without throwing.
// -----------------------------------------------------------------------------
describe('generate-model-registry – strict schema validation', () => {
  let originalYaml: string;
  let originalDoc: any;

  beforeAll(async () => {
    originalYaml = loadRawModelsYaml();
    const { validateSource, loadSource } = await import(
      '../../../scripts/generate-model-registry.js'
    );

    // The generator offers two entry points; both must succeed on the
    // untouched configuration.
    expect(() => validateSource(originalYaml)).not.toThrow();
    const loaded = loadSource(originalYaml);
    expect(loaded).toBeTruthy();

    // Keep the parsed document for later mutation tests.
    originalDoc = parseYaml(originalYaml);
  });

  // -------------------------------------------------------------------------
  // 2️⃣  REVISION IMMUTABILITY – any change to a model’s revision SHA must be
  //     rejected.  The test mutates the first embedding profile’s `revision`
  //     field to an obviously invalid value and expects a validation error.
  // -------------------------------------------------------------------------
  test('rejects changed revision hashes (immutability enforcement)', async () => {
    const mutated = JSON.parse(JSON.stringify(originalDoc)); // deep clone
    const profile = mutated.embeddingProfiles?.[0];
    if (!profile) {
      // If the fixture does not contain embeddingProfiles we cannot test this
      // branch – fail loudly so the contract is not silently bypassed.
      throw new Error('No embeddingProfiles found in config/models.yaml');
    }

    // Corrupt the revision – use a non‑hex string to guarantee schema failure.
    profile.revision = 'invalid-revision‑hash';

    const mutatedYaml = yamlStringify(mutated);
    const { validateSource } = await import(
      '../../../scripts/generate-model-registry.js'
    );

    expect(() => validateSource(mutatedYaml)).toThrow(
      /revision|hash|invalid/i,
    );
  });

  // -------------------------------------------------------------------------
  // 3️⃣  PATH NORMALISATION – artifact paths must be strictly normalized.
  //     Introducing a double‑slash or a relative segment should trigger a
  //     validation error.
  // -------------------------------------------------------------------------
  test('rejects non‑canonical artifact paths', async () => {
    const mutated = JSON.parse(JSON.stringify(originalDoc));
    const profile = mutated.embeddingProfiles?.[0];
    if (!profile) {
      throw new Error('No embeddingProfiles found in config/models.yaml');
    }

    // Introduce a double‑slash in the artifactPath (common normalization bug).
    if (typeof profile.artifactPath === 'string') {
      profile.artifactPath = profile.artifactPath.replace(
        /([^/])$/i,
        '$1//malformed',
      );
    } else {
      // If the field is missing we create a deliberately malformed one.
      profile.artifactPath = 's3://bucket//malformed';
    }

    const mutatedYaml = yamlStringify(mutated);
    const { validateSource } = await import(
      '../../../scripts/generate-model-registry.js'
    );

    expect(() => validateSource(mutatedYaml)).toThrow(
      /artifactPath|path.*canonical/i,
    );
  });

  // -------------------------------------------------------------------------
  // 4️⃣  SPACE‑ID DERIVATION – the generator must emit a space identifier that
  //     conforms to the `embed-v2:<64‑hex>` format and must be reproducible from
  //     the logical profile fields alone.
  // -------------------------------------------------------------------------
  test('computes a correctly formatted embed‑v2 spaceId', async () => {
    const { computeEmbeddingSpaceId } = await import(
      '../../../scripts/generate-model-registry.js'
    );

    const profile = originalDoc.embeddingProfiles?.[0];
    if (!profile) {
      throw new Error('No embeddingProfiles found in config/models.yaml');
    }

    const spaceId = computeEmbeddingSpaceId(profile);
    expect(typeof spaceId).toBe('string');
    expect(spaceId).toMatch(/^embed-v2:[0-9a-f]{64}$/i);
  });
});

// -----------------------------------------------------------------------------
// 5️⃣  IMMUTABILITY OF GENERATED ARTIFACTS – runtime objects emitted by the
//     generator must be frozen, preventing any post‑generation mutation that
//     could bypass the canonical validator.
// -----------------------------------------------------------------------------
describe('generated model‑registry artifacts are immutable', () => {
  test('top‑level registry export is frozen and all nested profiles are frozen', async () => {
    // The generation script writes its output to `apps/shared/model-registry.generated.ts`.
    // Import the compiled module (Jest runs with ts‑node, so .ts works as .js).
    const generated = await import(
      '../../../apps/shared/model-registry.generated.js'
    );

    // The generated module is expected to export a single object (e.g. `registry`
    // or `embeddingProfiles`).  We conservatively freeze‑check every exported
    // property.
    for (const exportKey of Object.keys(generated)) {
      const exportedValue = (generated as any)[exportKey];
      expect(Object.isFrozen(exportedValue)).toBe(
        true,
        `Export "${exportKey}" should be frozen`,
      );

      // If the export is an array or object containing individual profiles,
      // each entry must also be frozen.
      if (Array.isArray(exportedValue)) {
        exportedValue.forEach((item, idx) => {
          expect(Object.isFrozen(item)).toBe(
            true,
            `Item ${idx} of "${exportKey}" should be frozen`,
          );
        });
      } else if (
        exportedValue !== null &&
        typeof exportedValue === 'object'
      ) {
        for (const nestedKey of Object.keys(exportedValue)) {
          const nested = (exportedValue as any)[nestedKey];
          expect(Object.isFrozen(nested)).toBe(
            true,
            `Nested "${nestedKey}" of "${exportKey}" should be frozen`,
          );
        }
      }
    }
  });
});