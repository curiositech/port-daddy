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
  canonicalEmbeddingSpaceInput,
  computeEmbeddingSpaceId,
  findStaleRegistryArtifacts,
  materializeEmbeddingProfiles,
  validateSource,
} = await import('../../scripts/generate-model-registry.ts');
const { hasExactModelRate } = await import('../../lib/cost-tracker.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = parseYaml(readFileSync(join(ROOT, 'config', 'models.yaml'), 'utf8'));

const BGE_MODEL_ID = '@cf/baai/bge-base-en-v1.5';
const MINILM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const BGE_IDENTITY = {
  version: EMBEDDING_SPACE_VERSION,
  provider: 'baai',
  modelId: BGE_MODEL_ID,
  revision: 'a5beb1e3e68b9ab74eb54cfd186867f64f240e1a',
  dimensions: 768,
  normalization: 'l2',
  metric: 'cosine',
  pooling: 'mean',
  coordinateEncoding: 'json-number',
};

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
      'embed-v2:d0cbf2162aea9fc4bab0d377fa42c44a5536feb1495f410c943048924937f57f',
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
    ['provider', 'baai-hosted'],
    ['modelId', `${BGE_MODEL_ID} `],
    ['revision', BGE_IDENTITY.revision.toUpperCase()],
    ['dimensions', 769],
    ['normalization', 'none'],
    ['metric', 'dot-product'],
    ['pooling', 'cls'],
    ['coordinateEncoding', 'float32'],
  ])('changes spaceId when identity coordinate %s changes', (coordinate, value) => {
    expect(computeEmbeddingSpaceId({ ...BGE_IDENTITY, [coordinate]: value })).not.toBe(
      computeEmbeddingSpaceId(BGE_IDENTITY),
    );
  });

  it('rejects the superseded v1 identity namespace instead of aliasing it', () => {
    expect(() => computeEmbeddingSpaceId({ ...BGE_IDENTITY, version: 1 })).toThrow(
      'embedding profile version must be 2',
    );
  });

  it('keeps quality and catalog provenance outside the identity hash', () => {
    const withMutableMetadata = {
      ...BGE_IDENTITY,
      quality: 'degraded-fallback',
      revisionBinding: 'runtime-pinned',
      runtimeBinding: 'runtime-enforced',
      verifiedAt: '2099-01-01',
      notes: 'policy changed without changing coordinates',
      priceIn: 999,
    };
    expect(computeEmbeddingSpaceId(withMutableMetadata)).toBe(
      computeEmbeddingSpaceId(BGE_IDENTITY),
    );

    const changedQuality = structuredClone(source);
    changedQuality.embeddingProfiles[BGE_MODEL_ID].quality = 'approved';
    changedQuality.embeddingProfiles[BGE_MODEL_ID].revisionBinding = 'runtime-pinned';
    changedQuality.embeddingProfiles[BGE_MODEL_ID].runtimeBinding = 'runtime-enforced';
    expect(materializeEmbeddingProfiles(changedQuality)[BGE_MODEL_ID].spaceId).toBe(
      MODEL_REGISTRY_DATA.embeddingProfiles[BGE_MODEL_ID].spaceId,
    );
  });

  it.each([
    ['dimensions', 0, 'positive safe integer'],
    ['normalization', 'unit-ish', 'normalization is invalid'],
    ['metric', 'near-enough', 'metric is invalid'],
    ['pooling', 'last-token', 'pooling is invalid'],
    ['coordinateEncoding', 'q8', 'coordinateEncoding is invalid'],
    ['quality', 'best-effort', 'invalid quality'],
    ['revisionBinding', 'trust-me', 'invalid revisionBinding'],
    ['runtimeBinding', 'probably', 'invalid runtimeBinding'],
  ])('rejects malformed profile field %s', (field, value, message) => {
    const candidate = structuredClone(source);
    candidate.embeddingProfiles[BGE_MODEL_ID][field] = value;
    expect(() => validateSource(candidate)).toThrow(message);
  });

  it('rejects broken profile references, capabilities, providers, and embed roles', () => {
    const missingRow = structuredClone(source);
    missingRow.embeddingProfiles['missing/embedder'] = {
      ...missingRow.embeddingProfiles[BGE_MODEL_ID],
    };
    expect(() => validateSource(missingRow)).toThrow('no matching models row');

    const wrongCapability = structuredClone(source);
    wrongCapability.models[BGE_MODEL_ID].capabilities = ['text-generation'];
    expect(() => validateSource(wrongCapability)).toThrow('does not declare embedding capability');

    const wrongProvider = structuredClone(source);
    wrongProvider.embeddingProfiles[BGE_MODEL_ID].provider = 'cloudflare';
    expect(() => validateSource(wrongProvider)).toThrow('does not match models row');

    const missingRoleProfile = structuredClone(source);
    delete missingRoleProfile.embeddingProfiles[BGE_MODEL_ID];
    expect(() => validateSource(missingRoleProfile)).toThrow('has no embedding profile');

    const missingReverseProfile = structuredClone(source);
    delete missingReverseProfile.embeddingProfiles[MINILM_MODEL_ID];
    expect(() => validateSource(missingReverseProfile)).toThrow(
      'embedding model row has no embedding profile',
    );
  });

  it.each([
    'main',
    'Main',
    'LATEST',
    'refs/heads/main',
    'refs/remotes/origin/main',
    'origin/main',
    ' main ',
  ])('rejects moving revision %s', (revision) => {
    const moving = structuredClone(source);
    moving.embeddingProfiles[BGE_MODEL_ID].revision = revision;
    expect(() => validateSource(moving)).toThrow('revision must be immutable');
  });

  it('rejects empty, non-digest upstream revisions and unknown profile fields', () => {
    const empty = structuredClone(source);
    empty.embeddingProfiles[BGE_MODEL_ID].revision = '   ';
    expect(() => validateSource(empty)).toThrow('revision must be a non-empty string');

    const notDigest = structuredClone(source);
    notDigest.embeddingProfiles[BGE_MODEL_ID].revision = 'release-1.5';
    expect(() => validateSource(notDigest)).toThrow(
      'declared-upstream revision must be a lowercase 40-character commit SHA',
    );

    const unknown = structuredClone(source);
    unknown.embeddingProfiles[BGE_MODEL_ID].loaderDtype = 'q8';
    expect(() => validateSource(unknown)).toThrow('unknown profile field(s): loaderDtype');
  });

  it('frames Unicode, newlines, and colons by UTF-8 byte length', () => {
    const opaque = {
      ...BGE_IDENTITY,
      modelId: '模型:\nβ',
      revision: 'rev:\n雪',
    };
    const canonical = canonicalEmbeddingSpaceInput(opaque);
    expect(canonical).toContain('modelId:10:模型:\nβ');
    expect(canonical).toContain('revision:8:rev:\n雪');
    expect(computeEmbeddingSpaceId(opaque)).not.toBe(computeEmbeddingSpaceId(BGE_IDENTITY));
  });

  it('keeps binding evidence outside the hash and fails approved declarations closed', () => {
    const changedBinding = structuredClone(source);
    changedBinding.embeddingProfiles[BGE_MODEL_ID].revisionBinding = 'runtime-pinned';
    changedBinding.embeddingProfiles[BGE_MODEL_ID].runtimeBinding = 'runtime-enforced';
    expect(materializeEmbeddingProfiles(changedBinding)[BGE_MODEL_ID].spaceId).toBe(
      MODEL_REGISTRY_DATA.embeddingProfiles[BGE_MODEL_ID].spaceId,
    );

    const unboundApproval = structuredClone(source);
    unboundApproval.embeddingProfiles[BGE_MODEL_ID].quality = 'approved';
    expect(() => validateSource(unboundApproval)).toThrow(
      'approved quality requires provider-immutable or runtime-pinned',
    );

    const unenforcedApproval = structuredClone(source);
    unenforcedApproval.embeddingProfiles[BGE_MODEL_ID].quality = 'approved';
    unenforcedApproval.embeddingProfiles[BGE_MODEL_ID].revisionBinding = 'runtime-pinned';
    expect(() => validateSource(unenforcedApproval)).toThrow(
      'approved quality requires runtime-enforced behavior',
    );
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
    expect(CF_ADMITTED_MODELS).not.toContain(BGE_MODEL_ID);
    expect(CF_ADMITTED_MODELS).not.toContain(MINILM_MODEL_ID);
    expect(allRegisteredModelIds()).not.toContain(BGE_MODEL_ID);
    expect(allRegisteredModelIds()).not.toContain(MINILM_MODEL_ID);
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
      expect(profile.coordinateEncoding).toBe('json-number');
    }
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
