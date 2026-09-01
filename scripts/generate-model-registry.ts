#!/usr/bin/env tsx
/**
 * generate-model-registry — turn `config/models.yaml` into the committed
 * registry artifacts, and prove those artifacts still describe reality.
 *
 * WHY THIS EXISTS (supplant of scripts/refresh-model-registry.ts, 2026-08-23):
 * model IDs churn, and before this script the churn had to be chased through
 * four independently-editable surfaces — the daemon registry, the price table,
 * the context-window table, and the cloud plane's own hardcoded copies under
 * `apps/`. They drifted, and one drift was fatal in a specific way: Workers AI
 * `ai.run()` on an unknown model id HANGS instead of erroring, so a phantom id
 * silently killed the fleet reviewer on 2026-07-03. The design conclusion is
 * that a model id must have exactly ONE editable home (`config/models.yaml`),
 * with every consumer reading a GENERATED artifact that a test can prove is in
 * sync.
 *
 * The predecessor script's genuinely valuable half — asking providers what
 * exists right now and flagging ids that have disappeared — is preserved here
 * as `--probe` rather than discarded. Supplanting a mechanism means absorbing
 * its value, not dropping it.
 *
 * Two artifacts are emitted because the two planes cannot share an import:
 *   - `lib/model-registry-data.ts` for the daemon (a TS module, so it resolves
 *     identically under bun, @swc/jest, tsc, and the dist build — no runtime
 *     file read and no cwd fragility).
 *   - `apps/shared/model-registry.generated.ts` for the Cloudflare Workers,
 *     which physically cannot import from `lib/`. That impossibility is exactly
 *     why `apps/` grew its own hardcoded constants and drifted from the daemon.
 *
 * Usage:
 *   tsx scripts/generate-model-registry.ts --write   # regenerate both artifacts
 *   tsx scripts/generate-model-registry.ts --check   # exit 1 if either is stale
 *   tsx scripts/generate-model-registry.ts --probe   # live phantom-id hunt
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = join(ROOT, 'config', 'models.yaml');
const DAEMON_ARTIFACT = join(ROOT, 'lib', 'model-registry-data.ts');
const WORKERS_ARTIFACT = join(ROOT, 'apps', 'shared', 'model-registry.generated.ts');

export const EMBEDDING_SPACE_VERSION = 2 as const;
export const EMBEDDING_SPACE_DOMAIN = 'port-daddy.embedding-space' as const;

export type EmbeddingNormalization = 'none' | 'l2';
export type EmbeddingMetric = 'cosine' | 'dot-product' | 'euclidean';
export type EmbeddingPooling = 'mean' | 'cls';
export type EmbeddingCoordinateEncoding = 'json-number' | 'float32' | 'float16' | 'int8';
export type EmbeddingProfileQuality = 'approved' | 'degraded-fallback';
export type EmbeddingRevisionBinding =
  | 'provider-immutable'
  | 'runtime-pinned'
  | 'declared-upstream';
export type EmbeddingRuntimeBinding = 'declarative-only' | 'runtime-enforced';

/** The editable policy and identity coordinates for one embedding model. */
export interface EmbeddingProfileSource {
  provider: string;
  revision: string;
  dimensions: number;
  normalization: EmbeddingNormalization;
  metric: EmbeddingMetric;
  pooling: EmbeddingPooling;
  coordinateEncoding: EmbeddingCoordinateEncoding;
  quality: EmbeddingProfileQuality;
  revisionBinding: EmbeddingRevisionBinding;
  runtimeBinding: EmbeddingRuntimeBinding;
}

/** The generated, model-keyed embedding profile shared by daemon and Workers. */
export interface EmbeddingProfile extends EmbeddingProfileSource {
  version: typeof EMBEDDING_SPACE_VERSION;
  modelId: string;
  spaceId: string;
}

/** Only the coordinates that determine vector-space compatibility. */
export type EmbeddingSpaceIdentity = Omit<
  EmbeddingProfile,
  'quality' | 'revisionBinding' | 'runtimeBinding' | 'spaceId'
>;

/** Shared public type block emitted byte-for-byte into both generated planes. */
const EMBEDDING_PROFILE_TYPE_DECLARATION = `export type EmbeddingNormalization = 'none' | 'l2';
export type EmbeddingMetric = 'cosine' | 'dot-product' | 'euclidean';
export type EmbeddingPooling = 'mean' | 'cls';
export type EmbeddingCoordinateEncoding = 'json-number' | 'float32' | 'float16' | 'int8';
export type EmbeddingProfileQuality = 'approved' | 'degraded-fallback';
export type EmbeddingRevisionBinding = 'provider-immutable' | 'runtime-pinned' | 'declared-upstream';
export type EmbeddingRuntimeBinding = 'declarative-only' | 'runtime-enforced';

/** A declared vector-space target plus binding policy; inspect runtimeBinding before use as proof. */
export interface EmbeddingProfile {
  readonly version: ${EMBEDDING_SPACE_VERSION};
  readonly provider: string;
  readonly modelId: string;
  readonly revision: string;
  readonly dimensions: number;
  readonly normalization: EmbeddingNormalization;
  readonly metric: EmbeddingMetric;
  readonly pooling: EmbeddingPooling;
  readonly coordinateEncoding: EmbeddingCoordinateEncoding;
  readonly quality: EmbeddingProfileQuality;
  readonly revisionBinding: EmbeddingRevisionBinding;
  readonly runtimeBinding: EmbeddingRuntimeBinding;
  readonly spaceId: string;
}`;

/** One catalog row: everything true about a concrete model id in one place. */
export interface ModelCatalogEntry {
  provider: string;
  plane: 'direct-api' | 'workers-ai' | 'ai-gateway' | 'cli' | 'local';
  priceIn: number;
  priceOut: number;
  priceCachedIn?: number;
  contextWindow: number;
  capabilities: string[];
  status: 'ga' | 'deprecated' | 'retired';
  verifiedAt: string;
  verifiedBy: 'live-probe' | 'vendor-docs' | 'cf-catalog' | 'carried';
  priceBasis: 'vendor-docs' | 'estimate';
  /**
   * The reasoning-effort values this exact id accepts, live-probed.
   *
   * Not decoration: the values are model-specific and the API rejects an
   * unsupported one with a 400 before any token is spent. Pinning the id
   * without pinning its accepted parameter values is what let a hardcoded
   * `effort: 'minimal'` kill four of five OpenAI rungs while the registry
   * looked correct. Absent for models that take no effort parameter at all.
   */
  reasoningEfforts?: string[];
  /** The effort used when a caller names none — the cheapest supported rung. */
  defaultEffort?: string;
  notes?: string;
}

/** The parsed shape of `config/models.yaml`. */
export interface ModelSource {
  provenance: { generatedAt: string; generatedBy: string; source: string };
  vocabularies: {
    capabilities: string[];
    tierAliases: Record<string, string>;
    harborTiers: Record<string, string>;
    cliAliases: Record<string, Record<string, string>>;
    modelAliases: Record<string, string>;
  };
  backendAliases: Record<string, string>;
  models: Record<string, ModelCatalogEntry>;
  backends: Record<string, Record<string, string>>;
  cloudPlaneRoles: Record<string, string>;
  embeddingProfiles: Record<string, EmbeddingProfileSource>;
}

const NORMALIZATIONS = new Set<EmbeddingNormalization>(['none', 'l2']);
const METRICS = new Set<EmbeddingMetric>(['cosine', 'dot-product', 'euclidean']);
const POOLING_MODES = new Set<EmbeddingPooling>(['mean', 'cls']);
const COORDINATE_ENCODINGS = new Set<EmbeddingCoordinateEncoding>([
  'json-number',
  'float32',
  'float16',
  'int8',
]);
const PROFILE_QUALITIES = new Set<EmbeddingProfileQuality>(['approved', 'degraded-fallback']);
const REVISION_BINDINGS = new Set<EmbeddingRevisionBinding>([
  'provider-immutable',
  'runtime-pinned',
  'declared-upstream',
]);
const RUNTIME_BINDINGS = new Set<EmbeddingRuntimeBinding>([
  'declarative-only',
  'runtime-enforced',
]);
const PROFILE_FIELDS = new Set<keyof EmbeddingProfileSource>([
  'provider',
  'revision',
  'dimensions',
  'normalization',
  'metric',
  'pooling',
  'coordinateEncoding',
  'quality',
  'revisionBinding',
  'runtimeBinding',
]);
const MOVING_REVISION_NAMES = new Set(['head', 'latest', 'main', 'master']);
const UPSTREAM_COMMIT_SHA = /^[0-9a-f]{40}$/;

function isMovingRevision(value: string): boolean {
  const candidate = value.trim().toLowerCase();
  return (
    MOVING_REVISION_NAMES.has(candidate) ||
    candidate.startsWith('refs/heads/') ||
    candidate.startsWith('refs/remotes/') ||
    candidate.startsWith('origin/')
  );
}

/**
 * Frame one opaque coordinate without normalizing its bytes.
 *
 * The design uses UTF-8 byte lengths rather than separators alone so even an
 * identifier containing whitespace, punctuation, or newlines has one
 * unambiguous representation. Opaque model ids and revisions are deliberately
 * not trimmed or lowercased: changing their bytes changes the declared space.
 *
 * @param name Fixed field name in the v2 coordinate order.
 * @param value Exact opaque value to frame.
 * @returns A length-prefixed canonical field line.
 */
function frameEmbeddingCoordinate(name: string, value: string): string {
  return `${name}:${Buffer.byteLength(value, 'utf8')}:${value}`;
}

/**
 * Validate the runtime shape of embedding-space identity coordinates.
 *
 * TypeScript types disappear at the YAML boundary, so generation rejects bad
 * enums and dimensions before hashing. The purpose is to prevent a malformed
 * declaration from receiving a stable-looking compatibility id.
 *
 * @param identity Candidate compatibility coordinates.
 * @returns The same identity after fail-closed validation.
 * @throws If a required coordinate is malformed or unsupported.
 */
export function validateEmbeddingSpaceIdentity(
  identity: EmbeddingSpaceIdentity,
): EmbeddingSpaceIdentity {
  if (identity.version !== EMBEDDING_SPACE_VERSION) {
    throw new Error(`embedding profile version must be ${EMBEDDING_SPACE_VERSION}`);
  }
  for (const [name, value] of [
    ['provider', identity.provider],
    ['modelId', identity.modelId],
    ['revision', identity.revision],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`embedding profile ${name} must be a non-empty string`);
    }
  }
  if (isMovingRevision(identity.revision)) {
    throw new Error(`embedding profile revision must be immutable, not ${identity.revision}`);
  }
  if (!Number.isSafeInteger(identity.dimensions) || identity.dimensions <= 0) {
    throw new Error('embedding profile dimensions must be a positive safe integer');
  }
  if (!NORMALIZATIONS.has(identity.normalization)) {
    throw new Error(
      `embedding profile normalization is invalid: ${String(identity.normalization)}`,
    );
  }
  if (!METRICS.has(identity.metric)) {
    throw new Error(`embedding profile metric is invalid: ${String(identity.metric)}`);
  }
  if (!POOLING_MODES.has(identity.pooling)) {
    throw new Error(`embedding profile pooling is invalid: ${String(identity.pooling)}`);
  }
  if (!COORDINATE_ENCODINGS.has(identity.coordinateEncoding)) {
    throw new Error(
      `embedding profile coordinateEncoding is invalid: ${String(identity.coordinateEncoding)}`,
    );
  }
  return identity;
}

/**
 * Encode the v2 embedding-space identity in one fixed, domain-separated order.
 *
 * This intentionally does not use `JSON.stringify(object)`: object key order is
 * an incidental JavaScript representation, not a public compatibility
 * protocol. Every coordinate is fixed by name and length-framed instead.
 *
 * @param input Exact vector-space compatibility coordinates.
 * @returns Canonical UTF-8 preimage for SHA-256.
 */
export function canonicalEmbeddingSpaceInput(input: EmbeddingSpaceIdentity): string {
  const identity = validateEmbeddingSpaceIdentity(input);
  return [
    frameEmbeddingCoordinate('domain', EMBEDDING_SPACE_DOMAIN),
    frameEmbeddingCoordinate('version', String(identity.version)),
    frameEmbeddingCoordinate('provider', identity.provider),
    frameEmbeddingCoordinate('modelId', identity.modelId),
    frameEmbeddingCoordinate('revision', identity.revision),
    frameEmbeddingCoordinate('dimensions', String(identity.dimensions)),
    frameEmbeddingCoordinate('normalization', identity.normalization),
    frameEmbeddingCoordinate('metric', identity.metric),
    frameEmbeddingCoordinate('pooling', identity.pooling),
    frameEmbeddingCoordinate('coordinateEncoding', identity.coordinateEncoding),
  ].join('\n');
}

/**
 * Derive the public embedding-space compatibility id.
 *
 * Quality and binding evidence are absent from the input by type and by
 * construction. Policy or proof can improve without pretending the vectors
 * changed; any true coordinate change produces a different SHA-256 id.
 *
 * @param input Exact vector-space compatibility coordinates.
 * @returns `embed-v2:<sha256>` compatibility id.
 */
export function computeEmbeddingSpaceId(input: EmbeddingSpaceIdentity): string {
  const digest = createHash('sha256')
    .update(canonicalEmbeddingSpaceInput(input), 'utf8')
    .digest('hex');
  return `embed-v${EMBEDDING_SPACE_VERSION}:${digest}`;
}

/**
 * Materialize source profiles into generated, model-keyed public profiles.
 *
 * @param doc Validated canonical registry source.
 * @returns Profiles with injected model ids, schema version, and space ids.
 */
export function materializeEmbeddingProfiles(doc: ModelSource): Record<string, EmbeddingProfile> {
  return Object.fromEntries(
    Object.entries(doc.embeddingProfiles).map(([modelId, profile]) => {
      const identity: EmbeddingSpaceIdentity = {
        version: EMBEDDING_SPACE_VERSION,
        provider: profile.provider,
        modelId,
        revision: profile.revision,
        dimensions: profile.dimensions,
        normalization: profile.normalization,
        metric: profile.metric,
        pooling: profile.pooling,
        coordinateEncoding: profile.coordinateEncoding,
      };
      return [
        modelId,
        {
          ...identity,
          quality: profile.quality,
          revisionBinding: profile.revisionBinding,
          runtimeBinding: profile.runtimeBinding,
          spaceId: computeEmbeddingSpaceId(identity),
        },
      ];
    }),
  );
}

/**
 * Validate referential, compatibility, and policy invariants for a parsed source.
 *
 * @param doc Parsed `config/models.yaml` candidate.
 * @returns The same document after validation.
 * @throws If model, backend, role, alias, or embedding-profile invariants fail.
 */
export function validateSource(doc: ModelSource): ModelSource {
  if (!doc || typeof doc !== 'object') {
    throw new Error('config/models.yaml: root must be an object');
  }
  if (
    !doc.embeddingProfiles ||
    typeof doc.embeddingProfiles !== 'object' ||
    Array.isArray(doc.embeddingProfiles)
  ) {
    throw new Error('config/models.yaml: embeddingProfiles must be an object');
  }

  const profileErrors: string[] = [];
  const materializedIds = new Set<string>();
  for (const [modelId, profile] of Object.entries(doc.embeddingProfiles)) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      profileErrors.push(`${modelId}: profile must be an object`);
      continue;
    }
    const unknownFields = Object.keys(profile).filter(
      (field) => !PROFILE_FIELDS.has(field as keyof EmbeddingProfileSource),
    );
    if (unknownFields.length) {
      profileErrors.push(`${modelId}: unknown profile field(s): ${unknownFields.join(', ')}`);
    }
    const row = doc.models?.[modelId];
    if (!row) {
      profileErrors.push(`${modelId}: no matching models row`);
      continue;
    }
    if (!(row.capabilities ?? []).includes('embedding')) {
      profileErrors.push(`${modelId}: models row does not declare embedding capability`);
    }
    if (profile.provider !== row.provider) {
      profileErrors.push(
        `${modelId}: profile provider ${String(profile.provider)} does not match models row ${row.provider}`,
      );
    }
    if (!PROFILE_QUALITIES.has(profile.quality)) {
      profileErrors.push(`${modelId}: invalid quality ${String(profile.quality)}`);
    }
    if (!REVISION_BINDINGS.has(profile.revisionBinding)) {
      profileErrors.push(
        `${modelId}: invalid revisionBinding ${String(profile.revisionBinding)}`,
      );
    }
    if (
      profile.revisionBinding === 'declared-upstream' &&
      !UPSTREAM_COMMIT_SHA.test(profile.revision)
    ) {
      profileErrors.push(
        `${modelId}: declared-upstream revision must be a lowercase 40-character commit SHA`,
      );
    }
    if (!RUNTIME_BINDINGS.has(profile.runtimeBinding)) {
      profileErrors.push(`${modelId}: invalid runtimeBinding ${String(profile.runtimeBinding)}`);
    }
    if (
      profile.quality === 'approved' &&
      profile.revisionBinding !== 'provider-immutable' &&
      profile.revisionBinding !== 'runtime-pinned'
    ) {
      profileErrors.push(
        `${modelId}: approved quality requires provider-immutable or runtime-pinned revision binding`,
      );
    }
    if (profile.quality === 'approved' && profile.runtimeBinding !== 'runtime-enforced') {
      profileErrors.push(`${modelId}: approved quality requires runtime-enforced behavior`);
    }
    try {
      const identity: EmbeddingSpaceIdentity = {
        version: EMBEDDING_SPACE_VERSION,
        provider: profile.provider,
        modelId,
        revision: profile.revision,
        dimensions: profile.dimensions,
        normalization: profile.normalization,
        metric: profile.metric,
        pooling: profile.pooling,
        coordinateEncoding: profile.coordinateEncoding,
      };
      const spaceId = computeEmbeddingSpaceId(identity);
      if (materializedIds.has(spaceId)) {
        profileErrors.push(`${modelId}: duplicate spaceId ${spaceId}`);
      }
      materializedIds.add(spaceId);
    } catch (error) {
      profileErrors.push(`${modelId}: ${(error as Error).message}`);
    }
  }
  for (const [modelId, row] of Object.entries(doc.models ?? {})) {
    if (row.capabilities?.includes('embedding') && !doc.embeddingProfiles[modelId]) {
      profileErrors.push(`${modelId}: embedding model row has no embedding profile`);
    }
  }
  if (profileErrors.length) {
    throw new Error(
      `config/models.yaml: invalid embedding profile(s): ${profileErrors.join('; ')}`,
    );
  }

  if (typeof doc.cloudPlaneRoles?.embed !== 'string') {
    throw new Error('config/models.yaml: cloudPlaneRoles.embed must remain a model-id string');
  }
  if (!doc.embeddingProfiles[doc.cloudPlaneRoles.embed]) {
    throw new Error(
      `config/models.yaml: cloudPlaneRoles.embed (${doc.cloudPlaneRoles.embed}) has no embedding profile`,
    );
  }
  return doc;
}

/**
 * Read and structurally validate the canonical source.
 *
 * The design is deliberately fail-closed rather than best-effort: a model id
 * referenced by the `backends` map with no catalog row is precisely the phantom
 * shape that caused the 2026-07-03 outage, so it must abort generation rather
 * than emit an artifact that looks plausible. Orphan rows abort too — a catalog
 * entry nothing points at is dead weight that will rot unnoticed.
 *
 * @returns The validated source document.
 * @throws If the file is unparseable, or referential integrity fails.
 */
export function loadSource(): ModelSource {
  const doc = validateSource(parseYaml(readFileSync(SOURCE_PATH, 'utf8')) as ModelSource);

  const referenced = new Set<string>();
  for (const table of Object.values(doc.backends)) {
    for (const id of Object.values(table)) referenced.add(id);
  }
  // Cloud-plane roles are references too. Without this the Workers plane could
  // name an uncatalogued id and reintroduce exactly the hang this file prevents.
  for (const id of Object.values(doc.cloudPlaneRoles)) referenced.add(id);
  // Embedding profiles are first-class references. This is what lets a local
  // fallback model exist without entering any text-generation capability rung.
  for (const id of Object.keys(doc.embeddingProfiles)) referenced.add(id);
  const rows = new Set(Object.keys(doc.models));

  const missing = [...referenced].filter((id) => !rows.has(id));
  if (missing.length) {
    throw new Error(
      `config/models.yaml: ${missing.length} id(s) mapped by \`backends\` have no \`models\` row: ` +
        `${missing.join(', ')}. Every referenced id needs a catalog row — that requirement is what ` +
        `makes a phantom id impossible to introduce silently.`,
    );
  }
  // A Workers AI row needs no rung or role to justify it: the set of such rows
  // IS the executor's admission universe, and every member is reachable as a
  // ship's declared pin. Requiring a role would recreate the price ratchet that
  // main retired on live spend data — silently demoting pins an operator had
  // deliberately tiered up. Rows on every OTHER plane still have to earn a
  // reference, because there is nothing else to make them reachable.
  const orphans = [...rows].filter(
    (id) => !referenced.has(id) && doc.models[id].plane !== 'workers-ai',
  );
  if (orphans.length) {
    throw new Error(
      `config/models.yaml: ${orphans.length} catalog row(s) are referenced by no backend: ` +
        `${orphans.join(', ')}. Remove them, or map them — an unreferenced row rots unnoticed.`,
    );
  }

  // A family nickname that names nothing is worse than no nickname: it survives
  // a ladder move looking correct, and the first person to type it gets their
  // literal word posted to a provider. `sol` did exactly that before this table
  // existed. Resolving to a catalogued id is the whole contract, so it is
  // enforced at generation rather than discovered at a 404.
  const danglingAliases = Object.entries(doc.vocabularies.modelAliases ?? {})
    .filter(([, target]) => !(target in doc.models))
    .map(([nickname, target]) => `${nickname} -> ${target}`);
  if (danglingAliases.length) {
    throw new Error(
      `config/models.yaml: ${danglingAliases.length} modelAliases entr(ies) name no catalog row: ` +
        `${danglingAliases.join(', ')}. A nickname must resolve to a real id, or it is a model ` +
        `name invented in a second place — the exact drift this file exists to end.`,
    );
  }

  // A Workers AI row with no declared capabilities is priced, catalogued, exempt
  // from the orphan check — and absent from CF_ADMITTED_MODELS, because
  // admission requires `text-generation`. A ship pinning it would be silently
  // remapped to the default: the row looks supported from every angle except
  // the one that decides. Declaring `[embedding]` (as the ideas-store index
  // does) is a fine answer; declaring nothing is not an answer at all.
  const uncapable = Object.entries(doc.models)
    .filter(([, row]) => row.plane === 'workers-ai')
    .filter(([, row]) => !Array.isArray(row.capabilities) || row.capabilities.length === 0)
    .map(([id]) => id);
  if (uncapable.length) {
    throw new Error(
      `config/models.yaml: ${uncapable.length} Workers AI row(s) declare no capabilities: ` +
        `${uncapable.join(', ')}. Say what the model is FOR — a row that declares nothing is ` +
        `admitted by nothing, and a pin to it is silently downgraded rather than refused.`,
    );
  }

  // A `defaultEffort` outside its own `reasoningEfforts` is a 400 waiting to
  // happen on the very first call — the same shape as a phantom id, one level
  // down. Catch it here rather than in production.
  const badDefaults = Object.entries(doc.models)
    .filter(([, row]) => row.defaultEffort !== undefined)
    .filter(([, row]) => !(row.reasoningEfforts ?? []).includes(row.defaultEffort as string))
    .map(([id, row]) => `${id} (default '${row.defaultEffort}')`);
  if (badDefaults.length) {
    throw new Error(
      `config/models.yaml: ${badDefaults.length} row(s) declare a defaultEffort the model does not ` +
        `accept: ${badDefaults.join(', ')}. The default must be one of that row's reasoningEfforts.`,
    );
  }

  const retired = [...referenced].filter((id) => doc.models[id].status !== 'ga');
  if (retired.length) {
    throw new Error(
      `config/models.yaml: backends map to non-GA model(s): ${retired.join(', ')}. ` +
        `A deprecated or retired id must not back a live capability.`,
    );
  }

  const nonWorkersRoles = Object.entries(doc.cloudPlaneRoles).filter(
    ([, id]) => doc.models[id].plane !== 'workers-ai',
  );
  if (nonWorkersRoles.length) {
    throw new Error(
      `config/models.yaml: cloud-plane role(s) point outside the workers-ai plane: ` +
        `${nonWorkersRoles.map(([r, id]) => `${r} -> ${id}`).join(', ')}. ` +
        `The Workers runtime reaches these through env.AI; a direct-api id would fail at call time.`,
    );
  }

  return doc;
}

/**
 * Render the daemon-plane artifact.
 *
 * The design intent: the emitted module keeps the historical `ModelRegistryData` field names so
 * `resolveModel()` and its callers need no change — the supplant is about where
 * the truth is EDITED, not about churning the read API. It gains one field,
 * `models`, so that consumers which previously kept their own parallel id lists
 * (the backend catalog's advertised `models[]`, price coverage checks) can
 * derive them instead of re-declaring them.
 *
 * @param doc The validated canonical source.
 * @returns TypeScript module text, ready to write.
 */
export function renderDaemonArtifact(doc: ModelSource): string {
  return `/**
 * Model registry DATA — GENERATED. Do not hand-edit.
 *
 * Source of truth: config/models.yaml
 * Regenerate:      npx tsx scripts/generate-model-registry.ts --write
 *
 * This is a TS module (not a runtime-read JSON) so it resolves through the
 * import graph identically under bun, @swc/jest, tsc, and the dist build — no
 * fragile cwd/path resolution. Hand-editing it will be reverted by the next
 * generation and is caught by tests/unit/model-registry-canon.test.js.
 *
 * Capabilities: ${doc.vocabularies.capabilities.join(' / ')}.
 * NEVER hardcode a model ID elsewhere — declare a (backend, capability) and call
 * resolveModel() (lib/model-registry.ts).
 */

/** One catalog row: price, context, provenance, and lifecycle for a concrete id. */
export interface ModelCatalogEntry {
  provider: string;
  plane: 'direct-api' | 'workers-ai' | 'ai-gateway' | 'cli' | 'local';
  priceIn: number;
  priceOut: number;
  priceCachedIn?: number;
  contextWindow: number;
  capabilities: string[];
  status: 'ga' | 'deprecated' | 'retired';
  verifiedAt: string;
  verifiedBy: 'live-probe' | 'vendor-docs' | 'cf-catalog' | 'carried';
  priceBasis: 'vendor-docs' | 'estimate';
  /**
   * The reasoning-effort values this exact id accepts, live-probed.
   *
   * Not decoration: the values are model-specific and the API rejects an
   * unsupported one with a 400 before any token is spent. Pinning the id
   * without pinning its accepted parameter values is what let a hardcoded
   * \`effort: 'minimal'\` kill four of five OpenAI rungs while the registry
   * looked correct. Absent for models that take no effort parameter at all.
   */
  reasoningEfforts?: string[];
  /** The effort used when a caller names none — the cheapest supported rung. */
  defaultEffort?: string;
  notes?: string;
}

${EMBEDDING_PROFILE_TYPE_DECLARATION}

export interface ModelRegistryData {
  generatedAt: string;
  generatedBy: string;
  source: string;
  tierAliases: Record<string, string>;
  /** Legacy//external tier vocabularies mapped onto the capability ladder. */
  harborTiers: Record<string, string>;
  /** Transport-level model nicknames (e.g. the claude CLI's haiku/sonnet/opus). */
  cliAliases: Record<string, Record<string, string>>;
  /**
   * Human-typed family nicknames resolved on the \`explicit\` input — sonnet,
   * opus, sol, terra, luna. Every vendor with public nicknames gets a row, so
   * one vendor's CLI quirk does not read as a feature only that family has.
   */
  modelAliases: Record<string, string>;
  /**
   * Backend-name aliases resolved in exactly one place: canonicalBackend() in
   * lib/model-registry.ts. Aliased backends share a model family and differ only
   * in transport; a backend with a genuinely different lineup (codex) keeps its
   * own table instead.
   */
  backendAliases: Record<string, string>;
  /** Every concrete id, with the facts that used to live in four separate tables. */
  models: Record<string, ModelCatalogEntry>;
  backends: Record<string, Record<string, string>>;
  /** Declared embedding targets, separate from the text-generation capability ladder. */
  readonly embeddingProfiles: Readonly<Record<string, Readonly<EmbeddingProfile>>>;
}

export const MODEL_REGISTRY_DATA: ModelRegistryData = ${JSON.stringify(
    {
      generatedAt: doc.provenance.generatedAt,
      generatedBy: doc.provenance.generatedBy,
      source: doc.provenance.source,
      tierAliases: doc.vocabularies.tierAliases,
      harborTiers: doc.vocabularies.harborTiers,
      cliAliases: doc.vocabularies.cliAliases,
      modelAliases: doc.vocabularies.modelAliases,
      backendAliases: doc.backendAliases,
      models: doc.models,
      backends: doc.backends,
      embeddingProfiles: materializeEmbeddingProfiles(doc),
    },
    null,
    2,
  )};

for (const profile of Object.values(MODEL_REGISTRY_DATA.embeddingProfiles)) {
  Object.freeze(profile);
}
Object.freeze(MODEL_REGISTRY_DATA.embeddingProfiles);
Object.defineProperty(MODEL_REGISTRY_DATA, 'embeddingProfiles', {
  writable: false,
  configurable: false,
});
`;
}

/**
 * Render the Workers-plane artifact.
 *
 * The rationale for a SECOND artifact rather than one shared module: Cloudflare
 * Workers cannot import from `lib/` — that hard boundary is the
 * reason `apps/fleet-executor` and `apps/relay` each grew their own hardcoded
 * model constants, which then diverged from the daemon AND from each other
 * (the two workers disagreed about which model was "coder"). Rather than ask
 * humans to keep three lists aligned, the same source emits a self-contained
 * module for the bundlers, plus the KNOWN_GOOD set the executor needs as its
 * anti-phantom guard.
 *
 * @param doc The validated canonical source.
 * @returns TypeScript module text, ready to write.
 */
export function renderWorkersArtifact(doc: ModelSource): string {
  const cf = doc.backends.cloudflare;
  const roleNames = Object.keys(doc.cloudPlaneRoles);
  const embeddingProfiles = materializeEmbeddingProfiles(doc);
  // The admitted universe: GA Workers AI rows that a ship can actually be
  // pointed at. The embedding model is on the same plane and is deliberately
  // NOT admitted — it is an index, not a body, and pinning a ship to it would
  // produce vectors where a review should be.
  const admittedIds = Object.entries(doc.models)
    .filter(([, row]) => row.plane === 'workers-ai' && row.status === 'ga')
    .filter(([, row]) => row.capabilities.includes('text-generation'))
    .map(([id]) => id);

  return `/**
 * Cloudflare-plane model registry — GENERATED. Do not hand-edit.
 *
 * Source of truth: config/models.yaml
 * Regenerate:      npx tsx scripts/generate-model-registry.ts --write
 *
 * Workers cannot import from the daemon's lib/, so this self-contained module is
 * emitted from the same source the daemon reads. Before it existed, the executor
 * and the relay each carried their own hardcoded model constants and drifted —
 * including a phantom id that made ai.run() hang rather than fail.
 */

export type CloudflareCapability = ${doc.vocabularies.capabilities
    .map((c) => `'${c}'`)
    .join(' | ')};

/** (capability → Workers AI model id) for the cloud plane. */
export const CF_MODELS: Record<CloudflareCapability, string> = ${JSON.stringify(cf, null, 2)};


/** Context windows, so a Worker can budget without a second table. */
export const CF_CONTEXT_WINDOWS: Record<string, number> = ${JSON.stringify(
    Object.fromEntries(
      Object.entries(doc.models)
        .filter(([, r]) => r.plane === 'workers-ai')
        .map(([id, r]) => [id, r.contextWindow]),
    ),
    null,
    2,
  )};

/** Workers AI unit prices in USD per MILLION tokens, for the spend meters. */
export const CF_PRICES: Record<string, { input: number; output: number }> = ${JSON.stringify(
    Object.fromEntries(
      Object.entries(doc.models)
        .filter(([, r]) => r.plane === 'workers-ai')
        .map(([id, r]) => [id, { input: r.priceIn, output: r.priceOut }]),
    ),
    null,
    2,
  )};

/** The named roles the cloud plane selects by. See config/models.yaml. */
export type CloudPlaneRole = ${roleNames.map((r) => `'${r}'`).join(' | ')};

/**
 * (role → Workers AI model id). The Workers plane selects by role, not by
 * capability rung, because the roles carry policy the ladder cannot express —
 * most importantly that the review model is reachable by role ONLY.
 */
export const CF_ROLE_MODELS: Record<CloudPlaneRole, string> = ${JSON.stringify(doc.cloudPlaneRoles, null, 2)};

${EMBEDDING_PROFILE_TYPE_DECLARATION}

/** Declared model-keyed profiles; inspect runtimeBinding before use as execution proof. */
const GENERATED_EMBEDDING_PROFILES: Record<string, EmbeddingProfile> = ${JSON.stringify(embeddingProfiles, null, 2)};
for (const profile of Object.values(GENERATED_EMBEDDING_PROFILES)) {
  Object.freeze(profile);
}
export const CF_EMBEDDING_PROFILES: Readonly<Record<string, Readonly<EmbeddingProfile>>> =
  Object.freeze(GENERATED_EMBEDDING_PROFILES);

/**
 * Read one declared embedding profile without exposing mutable registry state.
 *
 * @param modelId Exact model row key.
 * @returns A defensive copy, or undefined when the model has no vector profile.
 */
export function embeddingProfileForModel(modelId: string): EmbeddingProfile | undefined {
  const profile = CF_EMBEDDING_PROFILES[modelId];
  return profile ? { ...profile } : undefined;
}

/**
 * Every Workers AI id the executor admits as a ship's declared pin.
 *
 * This replaces an allowlist of PINNABLE ROLES that existed to stop a ship
 * pinning its way onto the most expensive model. That ceiling is gone on
 * purpose: over a live 14-day window the busiest ship's entire Workers AI spend
 * was under $0.90, while the ceiling was quietly remapping two pins the
 * operator had deliberately tiered up down to the cheap tier. Protecting
 * pennies by degrading declared intent is a worse trade than the spend it saved.
 *
 * What remains is the guard that was always load-bearing: an id must be REAL.
 * An unknown Workers AI id does not 404 — it returns a blank the parser reads
 * as a clean result, which is how two phantom ids silenced this fleet.
 */
export const CF_ADMITTED_MODELS: readonly string[] = ${JSON.stringify(admittedIds, null, 2)};

/**
 * Guard a requested Workers AI model id.
 *
 * @param requested The id a ship asked for.
 * @returns The requested id when it is admitted, else the ship default.
 */
export function resolveCfModel(requested: string): string {
  return CF_ADMITTED_MODELS.includes(requested)
    ? requested
    : CF_ROLE_MODELS.shipDefault;
}
`;
}

export interface RenderedRegistryArtifacts {
  daemon: string;
  workers: string;
}

/**
 * Identify each generated artifact whose bytes no longer match canonical output.
 *
 * @param expected Fresh generator output.
 * @param actual Bytes currently committed on each plane.
 * @returns Plane keys whose artifact is stale, in deterministic order.
 */
export function findStaleRegistryArtifacts(
  expected: RenderedRegistryArtifacts,
  actual: RenderedRegistryArtifacts,
): Array<keyof RenderedRegistryArtifacts> {
  return (['daemon', 'workers'] as const).filter((key) => actual[key] !== expected[key]);
}

/**
 * Ask each provider which models it actually serves, and flag registry ids that
 * have vanished.
 *
 * This is the half of the predecessor script worth keeping. It is intentionally
 * a REPORT rather than an auto-fix: which concrete model deserves the `high`
 * slot is a judgment call, and silently re-ranking tiers from an API listing
 * would let a vendor's naming change quietly redirect production spend. A
 * provider with no credential is skipped with a note, never treated as failure —
 * absence of a key is not evidence of a phantom.
 *
 * @param doc The validated canonical source.
 * @returns Exit-worthy summary: the phantom ids found, and providers skipped.
 */
export async function probeProviders(
  doc: ModelSource,
): Promise<{ phantoms: string[]; skipped: string[]; checked: string[] }> {
  const phantoms: string[] = [];
  const skipped: string[] = [];
  const checked: string[] = [];

  /**
   * Every id served by the given backends.
   *
   * The design point is which axis to group on: probe by SERVING backend, not by
   * model author. `openai/gpt-oss-120b` is an OpenAI-authored model SERVED by
   * Groq — checking it against OpenAI's own API reports a phantom that isn't
   * one. The `backends` map is the serving truth.
   *
   * @param backends Backend keys whose tables to union.
   * @returns The de-duped concrete ids those backends serve.
   */
  const idsFor = (...backends: string[]) => {
    const ids = new Set<string>();
    for (const b of backends) {
      for (const id of Object.values(doc.backends[b] || {})) ids.add(id);
    }
    return [...ids];
  };

  // OpenAI — a flat id list, exact-match comparable.
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      });
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      const live = new Set((body.data || []).map((m) => m.id));
      checked.push('openai');
      for (const id of idsFor('openai', 'codex')) {
        if (!live.has(id)) phantoms.push(`openai:${id}`);
      }
    } catch (err) {
      skipped.push(`openai (probe failed: ${(err as Error).message})`);
    }
  } else {
    skipped.push('openai (no OPENAI_API_KEY)');
  }

  // Gemini — ids are returned namespaced as `models/<id>`.
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=200`,
      );
      const body = (await res.json()) as { models?: Array<{ name: string }> };
      const live = new Set((body.models || []).map((m) => m.name.replace(/^models\//, '')));
      checked.push('gemini');
      for (const id of idsFor('gemini')) {
        if (!live.has(id)) phantoms.push(`gemini:${id}`);
      }
    } catch (err) {
      skipped.push(`gemini (probe failed: ${(err as Error).message})`);
    }
  } else {
    skipped.push('gemini (no GEMINI_API_KEY/GOOGLE_API_KEY)');
  }

  // Cloudflare Workers AI — the plane where a phantom is most dangerous, since
  // an unknown id hangs rather than 404s. Probed by a minimal real inference.
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const cfToken =
    process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY || process.env.CF_API_TOKEN;
  if (cfAccount && cfToken) {
    checked.push('cloudflare');
    for (const id of idsFor('cloudflare')) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/${id}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cfToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
            signal: controller.signal,
          },
        );
        clearTimeout(timer);
        if (!res.ok) phantoms.push(`cloudflare:${id} (HTTP ${res.status})`);
      } catch (err) {
        // An abort here IS the phantom signature: unknown ids hang.
        phantoms.push(`cloudflare:${id} (no response — ${(err as Error).name})`);
      }
    }
  } else {
    skipped.push('cloudflare (no CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)');
  }

  return { phantoms, skipped, checked };
}

/**
 * CLI entry point.
 *
 * The intent of splitting write/check/probe into flags of ONE script (rather
 * than three) is that they share the same load-and-validate front half, so a
 * source that fails referential integrity fails all three the same way.
 *
 * @returns Process exit code — non-zero when artifacts are stale (`--check`) or
 *          a phantom id was found (`--probe`), so CI can gate on either.
 */
async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  const doc = loadSource();

  const daemon = renderDaemonArtifact(doc);
  const workers = renderWorkersArtifact(doc);

  if (args.has('--write')) {
    mkdirSync(dirname(WORKERS_ARTIFACT), { recursive: true });
    writeFileSync(DAEMON_ARTIFACT, daemon);
    writeFileSync(WORKERS_ARTIFACT, workers);
    console.log(`generate-model-registry: wrote ${DAEMON_ARTIFACT}`);
    console.log(`generate-model-registry: wrote ${WORKERS_ARTIFACT}`);
  }

  if (args.has('--check')) {
    const staleKeys = findStaleRegistryArtifacts(
      { daemon, workers },
      {
        daemon: readFileSync(DAEMON_ARTIFACT, 'utf8'),
        workers: readFileSync(WORKERS_ARTIFACT, 'utf8'),
      },
    );
    const artifactPath = {
      daemon: DAEMON_ARTIFACT,
      workers: WORKERS_ARTIFACT,
    } as const;
    const stale = staleKeys.map((key) => artifactPath[key]);
    if (stale.length) {
      console.error(
        `generate-model-registry: STALE artifact(s):\n  ${stale.join('\n  ')}\n` +
          `Run: npx tsx scripts/generate-model-registry.ts --write`,
      );
      return 1;
    }
    console.log('generate-model-registry: artifacts in sync with config/models.yaml');
  }

  if (args.has('--probe')) {
    const { phantoms, skipped, checked } = await probeProviders(doc);
    console.log(`generate-model-registry: probed [${checked.join(', ') || 'none'}]`);
    for (const s of skipped) console.log(`  skipped: ${s}`);
    if (phantoms.length) {
      console.error(`generate-model-registry: PHANTOM ID(S) FOUND:\n  ${phantoms.join('\n  ')}`);
      return 1;
    }
    console.log('generate-model-registry: no phantom ids among probed providers');
  }

  if (!args.has('--write') && !args.has('--check') && !args.has('--probe')) {
    console.log('usage: generate-model-registry.ts [--write] [--check] [--probe]');
  }
  return 0;
}

const invokedAsScript =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`generate-model-registry: ${err.message}`);
      process.exit(1);
    },
  );
}
