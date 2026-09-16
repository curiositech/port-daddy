import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { EmbeddingProfile } from './model-registry-data.js';

export const EMBEDDING_RUNTIME_RECEIPT_VERSION = 1 as const;

export interface EmbeddingRuntimeReceipt {
  readonly version: typeof EMBEDDING_RUNTIME_RECEIPT_VERSION;
  readonly verification: 'local-artifact-and-output-contract';
  readonly modelId: string;
  readonly spaceId: string;
  readonly runtimeFamily: string;
  readonly runtimeVersion: string;
  readonly modelDigest: string;
  readonly modelConfigDigest: string;
  readonly tokenizerDigest: string;
  readonly tokenizerConfigDigest: string;
  readonly preprocessingDigest: string;
  readonly dimensions: number;
  readonly normalization: EmbeddingProfile['normalization'];
  readonly metric: EmbeddingProfile['metric'];
  readonly verifiedAt: string;
  readonly receiptDigest: string;
}

export class EmbeddingConformanceError extends Error {
  readonly code = 'EMBEDDING_CONFORMANCE_FAILED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingConformanceError';
  }
}

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const L2_TOLERANCE = 1e-3;

/**
 * Hash one pinned artifact exactly as stored. The design uses raw bytes so
 * formatting or serialization changes cannot masquerade as the declared model.
 *
 * @param path Real filesystem path to the artifact.
 * @returns A lowercase sha256-prefixed digest.
 */
function digestFile(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

/**
 * Resolve an artifact while enforcing cache-root containment. The purpose is
 * to prevent a registry path or symlink from turning verification into an
 * arbitrary-file hash oracle.
 *
 * @param root Real root of the selected model cache.
 * @param artifact Registry-declared relative artifact path.
 * @returns The contained artifact's canonical filesystem path.
 */
function assertContainedFile(root: string, artifact: string): string {
  const realRoot = realpathSync(root);
  const candidate = realpathSync(join(root, artifact));
  if (candidate !== realRoot && !candidate.startsWith(`${realRoot}${sep}`)) {
    throw new EmbeddingConformanceError(`embedding artifact escapes the selected model cache: ${artifact}`);
  }
  return candidate;
}

/**
 * Reconstruct the registry runtime pin from installed package versions. This
 * design makes version comparison exact rather than accepting semver ranges.
 *
 * @param transformersVersion Installed Transformers.js package version.
 * @param onnxRuntimeVersion Installed ONNX Runtime package version.
 * @returns The canonical compound runtime version string.
 */
function expectedRuntimeVersion(
  transformersVersion: string,
  onnxRuntimeVersion: string,
): string {
  return `transformers.js@${transformersVersion}+onnxruntime-node@${onnxRuntimeVersion}`;
}

/**
 * Verify the cached local artifacts and exact runtime before a loader may claim
 * the registry's logical space. The design upgrades only live producer evidence;
 * it does not rewrite the registry's declarative binding or mint benchmark
 * promotion.
 *
 * @param input Selected profile, cache, observed runtime versions, and optional clock.
 * @returns An immutable content-addressed runtime conformance receipt.
 */
export function verifyLocalEmbeddingRuntime(input: {
  cacheDir: string;
  profile: Readonly<EmbeddingProfile>;
  transformersVersion: string;
  onnxRuntimeVersion: string;
  now?: Date;
}): EmbeddingRuntimeReceipt {
  const { profile } = input;
  if (profile.executionClass !== 'local') {
    throw new EmbeddingConformanceError(
      `profile ${profile.modelId} is ${profile.executionClass}; local verification is forbidden`,
    );
  }
  const observedRuntime = expectedRuntimeVersion(
    input.transformersVersion,
    input.onnxRuntimeVersion,
  );
  if (observedRuntime !== profile.runtimeVersion) {
    throw new EmbeddingConformanceError(
      `embedding runtime mismatch: expected ${profile.runtimeVersion}, observed ${observedRuntime}`,
    );
  }
  const modelRoot = join(input.cacheDir, ...profile.modelId.split('/'));
  const artifacts = [
    ['modelDigest', profile.modelArtifact, profile.modelDigest],
    ['modelConfigDigest', profile.modelConfigArtifact, profile.modelConfigDigest],
    ['tokenizerDigest', profile.tokenizerArtifact, profile.tokenizerDigest],
    ['tokenizerConfigDigest', profile.tokenizerConfigArtifact, profile.tokenizerConfigDigest],
  ] as const;
  for (const [field, artifact, expected] of artifacts) {
    if (!SHA256_DIGEST.test(expected)) {
      throw new EmbeddingConformanceError(`registry ${field} is malformed`);
    }
    let actual: string;
    try {
      actual = digestFile(assertContainedFile(modelRoot, artifact));
    } catch (error) {
      if (error instanceof EmbeddingConformanceError) throw error;
      throw new EmbeddingConformanceError(
        `cannot verify embedding artifact ${artifact}: ${(error as Error).message}`,
      );
    }
    if (actual !== expected) {
      throw new EmbeddingConformanceError(
        `embedding artifact digest mismatch for ${artifact}: expected ${expected}, observed ${actual}`,
      );
    }
  }

  const verifiedAt = (input.now ?? new Date()).toISOString();
  const unsigned = {
    version: EMBEDDING_RUNTIME_RECEIPT_VERSION,
    verification: 'local-artifact-and-output-contract' as const,
    modelId: profile.modelId,
    spaceId: profile.spaceId,
    runtimeFamily: profile.runtimeFamily,
    runtimeVersion: profile.runtimeVersion,
    modelDigest: profile.modelDigest,
    modelConfigDigest: profile.modelConfigDigest,
    tokenizerDigest: profile.tokenizerDigest,
    tokenizerConfigDigest: profile.tokenizerConfigDigest,
    preprocessingDigest: profile.preprocessingDigest,
    dimensions: profile.dimensions,
    normalization: profile.normalization,
    metric: profile.metric,
    verifiedAt,
  };
  const receiptDigest = `sha256:${createHash('sha256')
    .update(JSON.stringify(unsigned), 'utf8')
    .digest('hex')}`;
  return Object.freeze({ ...unsigned, receiptDigest });
}

/**
 * Reject malformed, truncated, non-finite, or incorrectly normalized output.
 * The purpose is to stop a broken producer before its coordinates are persisted.
 *
 * @param profile Profile declaring the required output contract.
 * @param vector Candidate coordinate vector returned by the producer.
 * @returns Nothing; success means the vector conforms exactly.
 */
export function assertEmbeddingVectorConforms(
  profile: Readonly<EmbeddingProfile>,
  vector: readonly number[],
): void {
  if (!Array.isArray(vector) || vector.length !== profile.dimensions) {
    throw new EmbeddingConformanceError(
      `embedding vector dimensions mismatch: expected ${profile.dimensions}, observed ${vector?.length ?? 0}`,
    );
  }
  if (vector.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new EmbeddingConformanceError('embedding vector contains a non-finite coordinate');
  }
  if (profile.normalization === 'l2') {
    const norm = Math.sqrt(vector.reduce((sum, coordinate) => sum + coordinate * coordinate, 0));
    if (Math.abs(norm - 1) > L2_TOLERANCE) {
      throw new EmbeddingConformanceError(
        `embedding vector violates l2 normalization: observed norm ${norm}`,
      );
    }
  }
}

/**
 * Validate batch cardinality and every vector contract. The design prevents
 * silent text-to-vector misalignment when a producer drops an input.
 *
 * @param profile Profile declaring the output contract.
 * @param vectors Candidate vectors returned by the producer.
 * @param expectedCount Number of input texts submitted to the producer.
 * @returns Nothing; success means the whole batch conforms.
 */
export function assertEmbeddingBatchConforms(
  profile: Readonly<EmbeddingProfile>,
  vectors: readonly (readonly number[])[],
  expectedCount: number,
): void {
  if (vectors.length !== expectedCount) {
    throw new EmbeddingConformanceError(
      `embedding batch cardinality mismatch: expected ${expectedCount}, observed ${vectors.length}`,
    );
  }
  for (const vector of vectors) assertEmbeddingVectorConforms(profile, vector);
}
