import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EmbeddingConformanceError,
  assertEmbeddingBatchConforms,
  assertEmbeddingVectorConforms,
  verifyLocalEmbeddingRuntime,
} from '../../lib/embedding-runtime-conformance.js';
import { embeddingProfiles } from '../../lib/model-registry.js';
import type { EmbeddingProfile } from '../../lib/model-registry-data.js';

function digest(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function runtimeVersions(profile: EmbeddingProfile): {
  transformersVersion: string;
  onnxRuntimeVersion: string;
} {
  const [transformersPart, onnxPart] = profile.runtimeVersion.split('+');
  return {
    transformersVersion: transformersPart.split('@').at(-1)!,
    onnxRuntimeVersion: onnxPart.split('@').at(-1)!,
  };
}

describe('local embedding runtime conformance', () => {
  let root: string;
  let profile: EmbeddingProfile;

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), '.embedding-conformance-test-'));
    const local = Object.values(embeddingProfiles()).find((row) => row.executionClass === 'local');
    if (!local) throw new Error('fixture requires one registered local embedding profile');
    const contents = {
      model: 'model-bytes',
      config: 'config-bytes',
      tokenizer: 'tokenizer-bytes',
      tokenizerConfig: 'tokenizer-config-bytes',
    };
    profile = {
      ...local,
      modelArtifact: 'onnx/model.onnx',
      modelDigest: digest(contents.model),
      modelConfigArtifact: 'config.json',
      modelConfigDigest: digest(contents.config),
      tokenizerArtifact: 'tokenizer.json',
      tokenizerDigest: digest(contents.tokenizer),
      tokenizerConfigArtifact: 'tokenizer_config.json',
      tokenizerConfigDigest: digest(contents.tokenizerConfig),
    };
    const modelRoot = join(root, ...profile.modelId.split('/'));
    mkdirSync(join(modelRoot, 'onnx'), { recursive: true });
    writeFileSync(join(modelRoot, profile.modelArtifact), contents.model);
    writeFileSync(join(modelRoot, profile.modelConfigArtifact), contents.config);
    writeFileSync(join(modelRoot, profile.tokenizerArtifact), contents.tokenizer);
    writeFileSync(join(modelRoot, profile.tokenizerConfigArtifact), contents.tokenizerConfig);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('binds matching local artifacts and exact runtime to the selected space', () => {
    const receipt = verifyLocalEmbeddingRuntime({
      cacheDir: root,
      profile,
      ...runtimeVersions(profile),
      now: new Date('2026-09-11T00:00:00.000Z'),
    });

    expect(receipt.spaceId).toBe(profile.spaceId);
    expect(receipt.modelDigest).toBe(profile.modelDigest);
    expect(receipt.verification).toBe('local-artifact-and-output-contract');
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('rejects artifact drift before a model can load', () => {
    writeFileSync(join(root, ...profile.modelId.split('/'), profile.modelArtifact), 'tampered');
    expect(() => verifyLocalEmbeddingRuntime({
      cacheDir: root,
      profile,
      ...runtimeVersions(profile),
    })).toThrow(EmbeddingConformanceError);
  });

  test('rejects runtime drift instead of stamping the declared space', () => {
    expect(() => verifyLocalEmbeddingRuntime({
      cacheDir: root,
      profile,
      ...runtimeVersions(profile),
      transformersVersion: '999.0.0',
    })).toThrow(/runtime mismatch/);
  });

  test('rejects truncated, non-finite, and non-normalized vectors', () => {
    expect(() => assertEmbeddingVectorConforms(profile, [1, 0])).toThrow(/dimensions mismatch/);
    expect(() => assertEmbeddingVectorConforms(profile, [
      Number.NaN,
      ...Array.from({ length: profile.dimensions - 1 }, () => 0),
    ])).toThrow(/non-finite/);
    expect(() => assertEmbeddingVectorConforms(
      profile,
      Array.from({ length: profile.dimensions }, () => 1),
    )).toThrow(/normalization/);
  });

  test('rejects a batch cardinality mismatch', () => {
    expect(() => assertEmbeddingBatchConforms(profile, [], 1)).toThrow(/cardinality mismatch/);
  });
});
