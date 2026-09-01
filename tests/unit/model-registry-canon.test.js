/**
 * Canonical model registry — structural invariants.
 *
 * These assertions exist because the 2026-08-22 audit found a PHANTOM model id
 * (`@cf/moonshotai/kimi-k2-instruct`) sitting in the registry's cloudflare
 * high/max-thinking slots. On Workers AI an unknown id does not 404 — `ai.run()`
 * HANGS — so the phantom silently killed the fleet reviewer on 2026-07-03 rather
 * than failing loudly. The root cause was that a model id had to be
 * independently correct in four separately-editable places. `config/models.yaml`
 * collapses those into one, and this suite is what makes the collapse
 * load-bearing: registry ⊆ priced ⊆ catalogued-and-GA is asserted, not merely
 * intended.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { execFileSync } from 'node:child_process';

const { MODEL_REGISTRY_DATA } = await import('../../lib/model-registry-data.js');
const {
  allRegisteredModelIds,
  embeddingProfileForModel,
  embeddingProfiles,
  resolveModel,
  CAPABILITIES,
} = await import('../../lib/model-registry.js');
const { CF_ADMITTED_MODELS, CF_EMBEDDING_PROFILES, CF_ROLE_MODELS } =
  await import('../../apps/shared/model-registry.generated.js');
const {
  EMBEDDING_SPACE_VERSION,
  canonicalEmbeddingPreprocessingInput,
  canonicalEmbeddingSpaceInput,
  computeEmbeddingPreprocessingDigest,
  computeEmbeddingSpaceId,
  embeddingPreprocessingIdentityFromProfile,
  embeddingSpaceIdentityFromProfile,
  findStaleRegistryArtifacts,
  materializeEmbeddingProfiles,
  validateSource,
} = await import('../../scripts/generate-model-registry.ts');
const { hasExactModelRate } = await import('../../lib/cost-tracker.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = parseYaml(readFileSync(join(ROOT, 'config', 'models.yaml'), 'utf8'));

const BGE_MODEL_ID = '@cf/baai/bge-base-en-v1.5';
const MINILM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const BGE_PROFILE = materializeEmbeddingProfiles(source)[BGE_MODEL_ID];
const BGE_IDENTITY = embeddingSpaceIdentityFromProfile(BGE_PROFILE);
const BGE_PREPROCESSING = embeddingPreprocessingIdentityFromProfile(
  source.embeddingProfiles[BGE_MODEL_ID],
);

function changedIdentity(coordinate, value) {
  return { ...BGE_IDENTITY, [coordinate]: value };
}

function materializedAfterSourceChange(coordinate, value) {
  const candidate = structuredClone(source);
  candidate.embeddingProfiles[BGE_MODEL_ID][coordinate] = value;
  return materializeEmbeddingProfiles(candidate)[BGE_MODEL_ID];
}

describe('canonical model registry', () => {
  it('every registered id has a catalog row', () => {
    const rows = new Set(Object.keys(source.models));
    const missing = allRegisteredModelIds().filter((id) => !rows.has(id));
    expect(missing).toEqual([]);
  });

  it('every registered id is priced (fail-closed telemetry admits it)', () => {
    // An unpriced id is refused at spawn admission by the telemetry policy, so
    // an unpriced registry entry is a launch failure waiting for its first use.
    const unpriced = allRegisteredModelIds().filter((id) => {
      const backend = Object.entries(MODEL_REGISTRY_DATA.backends).find(([, t]) =>
        Object.values(t).includes(id),
      )?.[0];
      return !hasExactModelRate(id, backend);
    });
    expect(unpriced).toEqual([]);
  });

  it('every registered id is GA — never deprecated or retired', () => {
    const notGa = allRegisteredModelIds().filter((id) => source.models[id].status !== 'ga');
    expect(notGa).toEqual([]);
  });

  it('every catalog row carries verification provenance', () => {
    const valid = new Set(['live-probe', 'vendor-docs', 'cf-catalog', 'carried']);
    for (const [id, row] of Object.entries(source.models)) {
      expect(`${id}:${row.verifiedBy}`).toBe(`${id}:${row.verifiedBy}`);
      expect(valid.has(row.verifiedBy)).toBe(true);
      expect(typeof row.verifiedAt).toBe('string');
      expect(row.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof row.contextWindow).toBe('number');
      expect(row.contextWindow).toBeGreaterThan(0);
    }
  });

  it('no catalog row is orphaned (nothing maps to it)', () => {
    // Three things make a row reachable: the capability ladder (`backends`), the
    // cloud plane's named roles, and — for Workers AI only — simply BEING a
    // Workers AI row, because that plane's rows are the executor's admission
    // universe and every one of them is pinnable by a ship. Requiring a role
    // there would rebuild the price ceiling that was retired on live spend data.
    const referenced = new Set([
      ...allRegisteredModelIds(),
      ...Object.values(source.cloudPlaneRoles),
      ...Object.keys(source.embeddingProfiles),
    ]);
    const orphans = Object.keys(source.models).filter(
      (id) => !referenced.has(id) && source.models[id].plane !== 'workers-ai',
    );
    expect(orphans).toEqual([]);
  });

  it('every cloud-plane role points at a GA, priced, workers-ai row', () => {
    // The Workers plane reaches these through env.AI and cannot import lib/, so
    // this is the only place the two planes' truth is checked against each other.
    for (const [role, id] of Object.entries(source.cloudPlaneRoles)) {
      const row = source.models[id];
      // Jest's expect takes no message argument; the role is in the failure via
      // the assertion below naming the row's own fields.
      expect(row ? `${role}:ok` : `${role} -> ${id} has no catalog row`).toBe(`${role}:ok`);
      expect(row.status).toBe('ga');
      expect(row.plane).toBe('workers-ai');
      expect(typeof row.priceIn).toBe('number');
      expect(typeof row.contextWindow).toBe('number');
    }
  });

  it('every admitted Workers AI model is priced and context-known', () => {
    // SUPPLANTS 'the pin allowlist cannot reach the review model'. That test
    // encoded a price ceiling — no ship may pin its way onto the most expensive
    // model — which was retired with production data: over a live 14-day window
    // the busiest ship's whole Workers AI spend was under $0.90, while the
    // ceiling was quietly demoting two pins an operator had deliberately tiered
    // up. Protecting pennies by degrading declared intent is the worse trade.
    //
    // What replaces it is the guard that was always the load-bearing one. A pin
    // is honored iff the id is REAL, because an unknown Workers AI id does not
    // 404 — it returns a blank the parser reads as a clean result, which is how
    // this fleet went silent twice. Admission therefore requires a price (an
    // unpriced honored model meters $0 and rides invisibly) and a context window
    // (chunk budgets are derived from it). Here those are the same row, so the
    // contract cannot be half-satisfied.
    const admitted = Object.entries(source.models)
      .filter(([, row]) => row.plane === 'workers-ai')
      .filter(([, row]) => (row.capabilities ?? []).includes('text-generation'));
    expect(admitted.length).toBeGreaterThan(0);
    for (const [id, row] of admitted) {
      expect(`${id}:${typeof row.priceIn === 'number' && row.priceIn >= 0 ? 'priced' : 'UNPRICED'}`)
        .toBe(`${id}:priced`);
      expect(`${id}:${typeof row.contextWindow === 'number' && row.contextWindow > 0 ? 'ctx' : 'NO-CTX'}`)
        .toBe(`${id}:ctx`);
    }
  });

  it('every backend resolves every capability', () => {
    for (const backend of Object.keys(MODEL_REGISTRY_DATA.backends)) {
      for (const capability of CAPABILITIES) {
        const id = resolveModel({ backend, capability });
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    }
  });

  it('backend aliases resolve to their canonical family', () => {
    for (const [alias, canonical] of Object.entries(MODEL_REGISTRY_DATA.backendAliases)) {
      for (const capability of CAPABILITIES) {
        expect(resolveModel({ backend: alias, capability })).toBe(
          resolveModel({ backend: canonical, capability }),
        );
      }
    }
  });

  it('the generated artifacts are in sync with config/models.yaml', () => {
    // Hand-editing a generated artifact is the drift this whole design removes;
    // --check exits non-zero when either artifact diverges from the source.
    expect(() =>
      execFileSync('npx', ['tsx', 'scripts/generate-model-registry.ts', '--check'], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('claude ladder is monotonically non-decreasing in price', () => {
    // The pre-supplant registry had `high` (opus-4-1) mapped to an OLDER, and in
    // one sense weaker, model than `max-thinking` (opus-4-8) while also being
    // cheaper — an incoherent ladder that made "high" ambiguous. Guard the shape.
    const price = (cap) => source.models[resolveModel({ backend: 'claude', capability: cap })].priceIn;
    expect(price('cheap')).toBeLessThanOrEqual(price('balanced'));
    expect(price('balanced')).toBeLessThanOrEqual(price('high'));
    expect(price('high')).toBeLessThanOrEqual(price('max-thinking'));
  });
});

describe('embedding profile registry', () => {
  it('pins a golden v2 space id from a fixed-order domain-separated preimage', () => {
    expect(computeEmbeddingSpaceId(BGE_IDENTITY)).toBe(
      'embed-v2:4c3eb8222853b8ab6bf24cac75ae7dca9bc5544acbdb7c48a93ffd9189b724bd',
    );
    expect(canonicalEmbeddingSpaceInput(BGE_IDENTITY)).toContain(
      'domain:26:port-daddy.embedding-space',
    );
    expect(canonicalEmbeddingSpaceInput(BGE_IDENTITY)).not.toContain('{');
  });

  it('is invariant to JavaScript key insertion order', () => {
    const reverseOrder = Object.fromEntries(Object.entries(BGE_IDENTITY).reverse());
    expect(canonicalEmbeddingSpaceInput(reverseOrder)).toBe(
      canonicalEmbeddingSpaceInput(BGE_IDENTITY),
    );
  });

  it.each([
    ['modelDigest', `sha256:${'b'.repeat(64)}`],
    ['modelConfigDigest', `sha256:${'c'.repeat(64)}`],
    ['preprocessingDigest', `sha256:${'d'.repeat(64)}`],
    ['dimensions', 769],
    ['normalization', 'none'],
    ['metric', 'dot-product'],
    ['pooling', 'cls-last-hidden-state-v1'],
    ['coordinatePrecision', 'float64'],
  ])('changes spaceId when identity coordinate %s changes', (coordinate, value) => {
    expect(computeEmbeddingSpaceId(changedIdentity(coordinate, value))).not.toBe(
      computeEmbeddingSpaceId(BGE_IDENTITY),
    );
  });

  it.each([
    ['tokenizerDigest', `sha256:${'d'.repeat(64)}`],
    ['tokenizerConfigDigest', `sha256:${'e'.repeat(64)}`],
    ['task', 'sentence-similarity'],
    ['queryPrefix', 'query: '],
    ['documentPrefix', 'passage: '],
    ['unicodeNormalization', 'nfc'],
    ['truncation', 'only-first'],
    ['maxTokens', 511],
  ])('changes spaceId when preprocessing coordinate %s changes', (coordinate, value) => {
    expect(materializedAfterSourceChange(coordinate, value).spaceId).not.toBe(BGE_PROFILE.spaceId);
  });

  it.each([
    ['servingProvider', 'another-serving-plane'],
    ['runtimeFamily', 'another-runtime'],
    ['runtimeVersion', 'another-runtime@1.0.0'],
    ['upstreamModelId', 'renamed/upstream-model'],
    ['modelRevision', 'b'.repeat(40)],
    ['modelArtifact', 'renamed-model.safetensors'],
    ['modelConfigArtifact', 'renamed-config.json'],
    ['tokenizerId', 'renamed/tokenizer'],
    ['tokenizerRevision', 'c'.repeat(40)],
    ['tokenizerArtifact', 'renamed-tokenizer.json'],
    ['tokenizerConfigArtifact', 'renamed-tokenizer-config.json'],
    ['transportEncoding', 'float32-array'],
    ['storageEncoding', 'float32-le'],
  ])('keeps provenance/execution metadata %s outside logical spaceId', (coordinate, value) => {
    expect(materializedAfterSourceChange(coordinate, value).spaceId).toBe(BGE_PROFILE.spaceId);
  });

  it('keeps the serving catalog alias outside logical spaceId', () => {
    const renamed = { ...BGE_PROFILE, modelId: `${BGE_MODEL_ID}-alias` };
    expect(computeEmbeddingSpaceId(embeddingSpaceIdentityFromProfile(renamed))).toBe(
      BGE_PROFILE.spaceId,
    );
  });

  it('rejects the superseded v1 identity namespace instead of aliasing it', () => {
    expect(() => computeEmbeddingSpaceId({ ...BGE_IDENTITY, version: 1 })).toThrow(
      'embedding profile version must be 2',
    );
  });

  it('rejects unknown or missing direct identity keys instead of silently ignoring them', () => {
    expect(() => computeEmbeddingSpaceId({
      ...BGE_IDENTITY,
      poolingKernel: 'unmasked-mean',
    })).toThrow('unknown: poolingKernel');
    const missing = { ...BGE_IDENTITY };
    delete missing.modelConfigDigest;
    expect(() => computeEmbeddingSpaceId(missing)).toThrow('missing: modelConfigDigest');
  });

  it('keeps policy and catalog provenance outside the identity hash', () => {
    const withMutableMetadata = {
      ...BGE_PROFILE,
      quality: 'approved',
      revisionBinding: 'runtime-pinned',
      runtimeBinding: 'runtime-enforced',
    };
    expect(computeEmbeddingSpaceId(embeddingSpaceIdentityFromProfile(withMutableMetadata))).toBe(
      BGE_PROFILE.spaceId,
    );

    const catalogChange = structuredClone(source);
    catalogChange.models[BGE_MODEL_ID].verifiedAt = '2099-01-01';
    catalogChange.models[BGE_MODEL_ID].notes = 'catalog provenance changed';
    catalogChange.models[BGE_MODEL_ID].priceIn = 999;
    expect(materializeEmbeddingProfiles(catalogChange)[BGE_MODEL_ID].spaceId).toBe(
      BGE_PROFILE.spaceId,
    );

    for (const profile of Object.values(materializeEmbeddingProfiles(source))) {
      expect(profile.quality).toBe('degraded-fallback');
      expect(profile.runtimeBinding).toBe('declarative-only');
    }
  });

  it.each([
    ['dimensions', 0, 'positive safe integer'],
    ['maxTokens', 0, 'maxTokens must be a positive safe integer'],
    ['normalization', 'unit-ish', 'normalization is invalid'],
    ['metric', 'near-enough', 'metric is invalid'],
    ['pooling', 'mean', 'pooling is invalid'],
    ['task', 'chat-completion', 'task is invalid'],
    ['unicodeNormalization', 'unicode-ish', 'unicodeNormalization is invalid'],
    ['truncation', 'maybe', 'truncation is invalid'],
    ['coordinatePrecision', 'provider-number', 'coordinatePrecision is invalid'],
    ['coordinateQuantization', 'int8', 'v2 permits only none'],
    ['transportEncoding', 'csv', 'transportEncoding is invalid'],
    ['storageEncoding', 'csv', 'storageEncoding is invalid'],
    ['storageQuantization', 'int8', 'v2 permits only none'],
    ['quality', 'approved', 'unknown profile field(s): quality'],
    ['revisionBinding', 'trust-me', 'revisionBinding is invalid'],
    ['runtimeBinding', 'runtime-enforced', 'unknown profile field(s): runtimeBinding'],
  ])('rejects malformed profile field %s', (field, value, message) => {
    const candidate = structuredClone(source);
    candidate.embeddingProfiles[BGE_MODEL_ID][field] = value;
    expect(() => validateSource(candidate)).toThrow(message);
  });

  it('rejects broken profile references, capabilities, and embed roles', () => {
    const missingRow = structuredClone(source);
    missingRow.embeddingProfiles['missing/embedder'] = {
      ...missingRow.embeddingProfiles[BGE_MODEL_ID],
    };
    expect(() => validateSource(missingRow)).toThrow('no matching models row');

    const wrongCapability = structuredClone(source);
    wrongCapability.models[BGE_MODEL_ID].capabilities = ['text-generation'];
    expect(() => validateSource(wrongCapability)).toThrow('does not declare embedding capability');

    const admittedEmbedding = structuredClone(source);
    admittedEmbedding.models[BGE_MODEL_ID].capabilities = ['embedding', 'text-generation'];
    expect(() => validateSource(admittedEmbedding)).toThrow(
      'embedding profile row must not declare text-generation capability',
    );

    const missingRoleProfile = structuredClone(source);
    delete missingRoleProfile.embeddingProfiles[BGE_MODEL_ID];
    expect(() => validateSource(missingRoleProfile)).toThrow('has no embedding profile');

    const missingReverseProfile = structuredClone(source);
    delete missingReverseProfile.embeddingProfiles[MINILM_MODEL_ID];
    expect(() => validateSource(missingReverseProfile)).toThrow(
      'embedding model row has no embedding profile',
    );
  });

  it('allows multiple catalog aliases to name one logical space', () => {
    const aliased = structuredClone(source);
    const aliasId = '@cf/baai/bge-base-en-v1.5-alias';
    aliased.models[aliasId] = structuredClone(aliased.models[BGE_MODEL_ID]);
    aliased.embeddingProfiles[aliasId] = structuredClone(
      aliased.embeddingProfiles[BGE_MODEL_ID],
    );

    expect(() => validateSource(aliased)).not.toThrow();
    expect(materializeEmbeddingProfiles(aliased)[aliasId].spaceId).toBe(
      materializeEmbeddingProfiles(aliased)[BGE_MODEL_ID].spaceId,
    );
  });

  it('bounds preprocessing maxTokens by the matching catalog context window', () => {
    const exactBoundary = structuredClone(source);
    exactBoundary.embeddingProfiles[MINILM_MODEL_ID].maxTokens =
      exactBoundary.models[MINILM_MODEL_ID].contextWindow;
    expect(() => validateSource(exactBoundary)).not.toThrow();

    const impossible = structuredClone(exactBoundary);
    impossible.embeddingProfiles[MINILM_MODEL_ID].maxTokens += 1;
    expect(() => validateSource(impossible)).toThrow('exceeds catalog contextWindow');
  });

  it.each([
    'main',
    'Main',
    'LATEST',
    'refs/heads/main',
    'refs/remotes/origin/main',
    'origin/main',
    ' main ',
  ])('rejects moving model and tokenizer revision %s', (revision) => {
    for (const field of ['modelRevision', 'tokenizerRevision']) {
      const moving = structuredClone(source);
      moving.embeddingProfiles[BGE_MODEL_ID][field] = revision;
      expect(() => validateSource(moving)).toThrow(
        `${field} must be an immutable lowercase 40-character commit SHA`,
      );
    }
  });

  it.each([
    'main',
    'Main',
    'LATEST',
    'refs/heads/main',
    'origin/main',
    ' main ',
    'transformers.js@latest',
    'transformers.js@^4.1.0',
    'transformers.js@4.x',
    '*',
  ])(
    'rejects moving runtime metadata %s instead of presenting it as a pin',
    (runtimeVersion) => {
      const moving = structuredClone(source);
      moving.embeddingProfiles[BGE_MODEL_ID].runtimeVersion = runtimeVersion;
      expect(() => validateSource(moving)).toThrow('runtimeVersion must be exact');
    },
  );

  it('rejects scalar capability declarations before profile admission checks', () => {
    const scalar = structuredClone(source);
    scalar.models[MINILM_MODEL_ID].capabilities = 'embedding';
    expect(() => validateSource(scalar)).toThrow('model capabilities must be string arrays');
  });

  it('rejects empty or non-digest revisions, unsafe artifacts, bad digests, and unknown fields', () => {
    const empty = structuredClone(source);
    empty.embeddingProfiles[BGE_MODEL_ID].modelRevision = '   ';
    expect(() => validateSource(empty)).toThrow('modelRevision must be a non-empty string');

    const notDigest = structuredClone(source);
    notDigest.embeddingProfiles[BGE_MODEL_ID].modelRevision = 'release-1.5';
    expect(() => validateSource(notDigest)).toThrow(
      'modelRevision must be an immutable lowercase 40-character commit SHA',
    );

    for (const artifact of [
      '../model.safetensors',
      './model.safetensors',
      'models//model.safetensors',
      'models/./model.safetensors',
      'models/',
      '.',
    ]) {
      const unsafeArtifact = structuredClone(source);
      unsafeArtifact.embeddingProfiles[BGE_MODEL_ID].modelArtifact = artifact;
      expect(() => validateSource(unsafeArtifact)).toThrow('normalized relative artifact path');
    }

    const badDigest = structuredClone(source);
    badDigest.embeddingProfiles[BGE_MODEL_ID].modelDigest = 'sha256:not-a-digest';
    expect(() => validateSource(badDigest)).toThrow('modelDigest must be sha256');

    const unknown = structuredClone(source);
    unknown.embeddingProfiles[BGE_MODEL_ID].loaderDtype = 'q8';
    expect(() => validateSource(unknown)).toThrow('unknown profile field(s): loaderDtype');
  });

  it('rejects transport or persistence encodings that narrow logical coordinate precision', () => {
    const lossyTransport = structuredClone(source);
    lossyTransport.embeddingProfiles[BGE_MODEL_ID].coordinatePrecision = 'float64';
    lossyTransport.embeddingProfiles[BGE_MODEL_ID].transportEncoding = 'float32-array';
    expect(() => validateSource(lossyTransport)).toThrow('v2 transport must be lossless');

    const lossyStorage = structuredClone(source);
    lossyStorage.embeddingProfiles[BGE_MODEL_ID].coordinatePrecision = 'float64';
    lossyStorage.embeddingProfiles[BGE_MODEL_ID].storageEncoding = 'float32-le';
    expect(() => validateSource(lossyStorage)).toThrow('v2 persistence must be lossless');
  });

  it('frames empty, Unicode, newline, and colon preprocessing bytes without conflating absence', () => {
    expect(canonicalEmbeddingPreprocessingInput(BGE_PREPROCESSING)).toContain('queryPrefix:0:');
    expect(canonicalEmbeddingPreprocessingInput(BGE_PREPROCESSING)).toContain('documentPrefix:0:');
    const opaque = { ...BGE_PREPROCESSING, queryPrefix: '模型:\nβ' };
    expect(canonicalEmbeddingPreprocessingInput(opaque)).toContain('queryPrefix:10:模型:\nβ');
    expect(computeEmbeddingPreprocessingDigest(opaque)).not.toBe(
      computeEmbeddingPreprocessingDigest(BGE_PREPROCESSING),
    );
    const absent = { ...BGE_PREPROCESSING };
    delete absent.queryPrefix;
    expect(() => computeEmbeddingPreprocessingDigest(absent)).toThrow('missing: queryPrefix');
  });

  it('pins the preprocessing recipe independently and with exact keys', () => {
    const profile = MODEL_REGISTRY_DATA.embeddingProfiles[BGE_MODEL_ID];
    expect(profile.preprocessingDigest).toBe(
      computeEmbeddingPreprocessingDigest(BGE_PREPROCESSING),
    );
    expect(profile.preprocessingDigest).toBe(
      'sha256:2e9cef6953fac4a1789917fc2653a5ad2c5bfc008ab310f2f887cf056d5c8961',
    );
    expect(() => computeEmbeddingPreprocessingDigest({
      ...BGE_PREPROCESSING,
      poolingKernel: 'unmasked-mean',
    })).toThrow('unknown: poolingKernel');
  });

  it('does not mint a ResourceScope compatibility descriptor from declarative profiles', () => {
    for (const profile of Object.values(MODEL_REGISTRY_DATA.embeddingProfiles)) {
      expect(profile).not.toHaveProperty('descriptorDigest');
      expect(profile.runtimeBinding).toBe('declarative-only');
      expect(profile.quality).toBe('degraded-fallback');
    }
  });

  it('prevents YAML from self-asserting approval or runtime enforcement', () => {
    for (const forbiddenField of ['quality', 'runtimeBinding', 'attestationReceiptId']) {
      const selfAsserted = structuredClone(source);
      selfAsserted.embeddingProfiles[BGE_MODEL_ID][forbiddenField] =
        forbiddenField === 'quality' ? 'approved' : 'trust-me';
      expect(() => validateSource(selfAsserted)).toThrow(`unknown profile field(s): ${forbiddenField}`);
    }

    const strongerBinding = structuredClone(source);
    strongerBinding.embeddingProfiles[BGE_MODEL_ID].revisionBinding = 'runtime-pinned';
    expect(() => validateSource(strongerBinding)).toThrow('revisionBinding is invalid');
  });

  it('emits byte-equivalent daemon and Workers profile data', () => {
    expect(JSON.stringify(MODEL_REGISTRY_DATA.embeddingProfiles)).toBe(
      JSON.stringify(CF_EMBEDDING_PROFILES),
    );
    expect(embeddingProfiles()).toEqual(CF_EMBEDDING_PROFILES);
    expect(Object.isFrozen(MODEL_REGISTRY_DATA.embeddingProfiles)).toBe(true);
    expect(Object.isFrozen(CF_EMBEDDING_PROFILES)).toBe(true);
    expect(Object.isFrozen(CF_EMBEDDING_PROFILES[BGE_MODEL_ID])).toBe(true);
    expect(Object.getOwnPropertyDescriptor(MODEL_REGISTRY_DATA, 'embeddingProfiles')).toMatchObject({
      writable: false,
      configurable: false,
    });
    expect(() => {
      MODEL_REGISTRY_DATA.embeddingProfiles = {};
    }).toThrow(TypeError);
  });

  it('keeps embedding profiles out of text-generation ladders and admission', () => {
    expect(typeof CF_ROLE_MODELS.embed).toBe('string');
    expect(CF_ROLE_MODELS.embed).toBe(BGE_MODEL_ID);
    for (const modelId of Object.keys(MODEL_REGISTRY_DATA.embeddingProfiles)) {
      expect(CF_ADMITTED_MODELS).not.toContain(modelId);
      expect(allRegisteredModelIds()).not.toContain(modelId);
    }
    expect(Object.values(MODEL_REGISTRY_DATA.backends).flatMap(Object.values)).not.toContain(
      MINILM_MODEL_ID,
    );
  });

  it('exposes frozen copies and marks both current loaders declarative-only', () => {
    expect(embeddingProfileForModel(MINILM_MODEL_ID)?.quality).toBe('degraded-fallback');
    expect(embeddingProfileForModel('not-an-embedder')).toBeUndefined();
    for (const profile of Object.values(embeddingProfiles())) {
      expect(profile.quality).toBe('degraded-fallback');
      expect(profile.revisionBinding).toBe('declared-upstream');
      expect(profile.runtimeBinding).toBe('declarative-only');
      expect(profile.runtimeFamily).toEqual(expect.any(String));
      expect(profile.runtimeVersion).toEqual(expect.any(String));
      expect(profile.storageEncoding).toBe('json-number-array');
    }
    expect(embeddingProfileForModel(BGE_MODEL_ID)?.coordinatePrecision).toBe('float32');
    expect(embeddingProfileForModel(BGE_MODEL_ID)?.transportEncoding).toBe('json-number-array');
    expect(embeddingProfileForModel(MINILM_MODEL_ID)?.transportEncoding).toBe('float32-array');
    expect(embeddingProfileForModel(BGE_MODEL_ID)?.coordinateQuantization).toBe('none');
    expect(source.models[BGE_MODEL_ID].priceIn).toBe(0.067);
    expect(Object.isFrozen(embeddingProfiles())).toBe(true);
  });

  it('detects daemon-only and Workers-only artifact drift independently', () => {
    const expected = { daemon: 'daemon-bytes', workers: 'worker-bytes' };
    expect(findStaleRegistryArtifacts(expected, expected)).toEqual([]);
    expect(findStaleRegistryArtifacts(expected, { ...expected, daemon: 'stale' })).toEqual([
      'daemon',
    ]);
    expect(findStaleRegistryArtifacts(expected, { ...expected, workers: 'stale' })).toEqual([
      'workers',
    ]);
    expect(findStaleRegistryArtifacts(expected, { daemon: 'stale', workers: 'stale' })).toEqual([
      'daemon',
      'workers',
    ]);
  });
});

describe('a catalogued model cannot be silently unreachable', () => {
  test('every Workers AI row declares what it is for', () => {
    // THE TRAP THIS CLOSES: admission to CF_ADMITTED_MODELS requires the
    // `text-generation` capability. A Workers AI row that declares NO
    // capabilities is therefore priced, catalogued, exempt from the orphan check
    // (that exemption is what makes the plane an admission universe) — and
    // admitted by nothing. A ship pinning it is not refused, it is silently
    // remapped to the default, which is the same silent-downgrade shape as a
    // tier name the resolver never reads. Declaring `[embedding]`, as the
    // ideas-store index does, is a fine answer. Declaring nothing is not.
    const workersAi = Object.entries(source.models).filter(
      ([, row]) => row.plane === 'workers-ai',
    );
    expect(workersAi.length).toBeGreaterThan(0);
    for (const [id, row] of workersAi) {
      const declared = Array.isArray(row.capabilities) && row.capabilities.length > 0;
      expect(`${id}:${declared ? 'declared' : 'NOTHING-DECLARED'}`).toBe(`${id}:declared`);
    }
  });

  test('a Workers AI row is either admitted or deliberately something else', () => {
    // The embedding index is the one row on this plane that is intentionally not
    // admitted; it must say so by declaring a non-text capability rather than by
    // omission, so "not admitted" is a decision in the file and not an accident.
    for (const [id, row] of Object.entries(source.models)) {
      if (row.plane !== 'workers-ai') continue;
      const admitted = row.capabilities.includes('text-generation');
      const deliberate = admitted || row.capabilities.length > 0;
      expect(`${id}:${deliberate ? 'ok' : 'ACCIDENTAL'}`).toBe(`${id}:ok`);
    }
  });

  test('every family nickname resolves to a catalogued id', () => {
    // A nickname that names nothing survives a ladder move looking correct, and
    // the first person to type it gets their literal word posted to a provider.
    // That is not hypothetical: `sol` did exactly this before the table existed.
    const aliases = source.vocabularies.modelAliases;
    expect(Object.keys(aliases).length).toBeGreaterThan(0);
    for (const [nickname, target] of Object.entries(aliases)) {
      expect(`${nickname} -> ${target in source.models ? target : 'NOT-IN-CATALOG'}`)
        .toBe(`${nickname} -> ${target}`);
    }
  });

  test('nicknames are offered to more than one vendor', () => {
    // The point of the table. `sonnet` worked before it existed, but only as an
    // accident of transport — the claude-code CLI accepts that word on its own
    // --model flag. No other vendor's names got the same courtesy, so one
    // vendor's CLI quirk read as a feature only that family had. If this ever
    // narrows back to a single provider, the asymmetry has returned.
    const providers = new Set(
      Object.values(source.vocabularies.modelAliases).map((id) => source.models[id].provider),
    );
    expect(providers.size).toBeGreaterThan(1);
  });

  test('a nickname never names a capability rung', () => {
    // `opus` names a model; `high` names a job. A nickname that collided with a
    // rung would make `--model high` ambiguous between "the strong rung" and
    // "some model literally called high", which is the confusion the capability
    // ladder exists to remove.
    for (const nickname of Object.keys(source.vocabularies.modelAliases)) {
      expect(source.vocabularies.capabilities).not.toContain(nickname);
      expect(Object.keys(source.vocabularies.tierAliases)).not.toContain(nickname);
      expect(Object.keys(source.vocabularies.harborTiers)).not.toContain(nickname);
    }
  });
});
