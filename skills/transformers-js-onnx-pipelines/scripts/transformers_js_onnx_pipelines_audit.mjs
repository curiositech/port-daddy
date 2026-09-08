#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_PIPELINE_TYPES = ['bi-encoder', 'cross-encoder', 'classification'];
const VALID_ENVIRONMENTS = ['node', 'browser'];
const VALID_POOLING = ['mean-attention-mask-v1', 'cls-last-hidden-state-v1'];
const VALID_DTYPES = ['auto', 'fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'bnb4', 'q4f16', 'q2', 'q2f16', 'q1', 'q1f16'];
const REQUIRED_EMBEDDING_PROFILE_FIELDS = [
  'version',
  'servingProvider',
  'modelId',
  'runtimeFamily',
  'runtimeVersion',
  'upstreamModelId',
  'modelRevision',
  'modelArtifact',
  'modelDigest',
  'modelConfigArtifact',
  'modelConfigDigest',
  'tokenizerId',
  'tokenizerRevision',
  'tokenizerArtifact',
  'tokenizerDigest',
  'tokenizerConfigArtifact',
  'tokenizerConfigDigest',
  'task',
  'queryPrefix',
  'documentPrefix',
  'unicodeNormalization',
  'truncation',
  'maxTokens',
  'pooling',
  'normalization',
  'metric',
  'dimensions',
  'coordinatePrecision',
  'coordinateQuantization',
  'transportEncoding',
  'storageEncoding',
  'storageQuantization',
  'preprocessingDigest',
  'spaceId',
  'quality',
  'revisionBinding',
  'runtimeBinding',
];
const LEGACY_EMBEDDING_PROFILE_FIELDS = [
  'provider',
  'revision',
  'distanceMetric',
  'dtype',
  'qualityTier',
  'degradedFallbackLabel',
];
const VALID_UNICODE_NORMALIZATIONS = ['none', 'nfc', 'nfkc', 'tokenizer-defined'];
const VALID_TRUNCATION = ['longest-first', 'only-first'];
const VALID_TASKS = ['feature-extraction', 'sentence-similarity'];
const VALID_NORMALIZATIONS = ['none', 'l2'];
const VALID_METRICS = ['cosine', 'dot-product', 'euclidean'];
const VALID_COORDINATE_PRECISIONS = ['float16', 'float32', 'float64'];
const VALID_TRANSPORT_ENCODINGS = ['json-number-array', 'float32-array'];
const VALID_QUANTIZATIONS = ['none'];
const VALID_STORAGE_ENCODINGS = ['json-number-array', 'float32-le'];
const VALID_VECTOR_DISPOSITIONS = ['ephemeral-uncompared', 'quarantined-uncompared'];
const FORBIDDEN_ATTESTATION_FIELDS = [
  'producerAttestation',
  'producerAttestationVerified',
  'attestationReceiptId',
];
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const EMBED_V2_ID = /^embed-v2:[0-9a-f]{64}$/;
const IMMUTABLE_COMMIT = /^[0-9a-f]{40}$/;
const RELATIVE_ARTIFACT = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/+@=-]+$/;
const SEVERITY_WEIGHTS = { critical: 30, high: 15, medium: 8, low: 3 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function profileFieldErrors(profile) {
  if (!isPlainObject(profile)) return [...REQUIRED_EMBEDDING_PROFILE_FIELDS];

  const knownFields = new Set(REQUIRED_EMBEDDING_PROFILE_FIELDS);
  const errors = REQUIRED_EMBEDDING_PROFILE_FIELDS.filter((field) => {
    const value = profile[field];
    if (field === 'queryPrefix' || field === 'documentPrefix') return typeof value !== 'string';
    if (field === 'version' || field === 'maxTokens' || field === 'dimensions') return false;
    return !isNonEmptyString(value);
  });
  for (const field of Object.keys(profile)) {
    if (!knownFields.has(field)) errors.push(`unknown:${field}`);
  }
  if (profile.version !== 2) errors.push('version=2');
  if (!Number.isSafeInteger(profile.maxTokens) || profile.maxTokens < 1) errors.push('maxTokens>0');
  if (!Number.isSafeInteger(profile.dimensions) || profile.dimensions < 1) errors.push('dimensions>0');
  if (!IMMUTABLE_COMMIT.test(profile.modelRevision ?? '')) errors.push('modelRevision=immutable-sha');
  if (!IMMUTABLE_COMMIT.test(profile.tokenizerRevision ?? '')) errors.push('tokenizerRevision=immutable-sha');
  for (const field of [
    'modelArtifact',
    'modelConfigArtifact',
    'tokenizerArtifact',
    'tokenizerConfigArtifact',
  ]) {
    if (!RELATIVE_ARTIFACT.test(profile[field] ?? '')) errors.push(`${field}=relative-path`);
  }
  for (const field of [
    'modelDigest',
    'modelConfigDigest',
    'tokenizerDigest',
    'tokenizerConfigDigest',
    'preprocessingDigest',
  ]) {
    if (!SHA256_DIGEST.test(profile[field] ?? '')) errors.push(`${field}=sha256`);
  }
  if (!EMBED_V2_ID.test(profile.spaceId ?? '')) errors.push('spaceId=embed-v2');
  if (!VALID_TASKS.includes(profile.task)) errors.push('task');
  if (!VALID_UNICODE_NORMALIZATIONS.includes(profile.unicodeNormalization)) errors.push('unicodeNormalization');
  if (!VALID_TRUNCATION.includes(profile.truncation)) errors.push('truncation');
  if (!VALID_POOLING.includes(profile.pooling)) errors.push('pooling');
  if (!VALID_NORMALIZATIONS.includes(profile.normalization)) errors.push('normalization');
  if (!VALID_METRICS.includes(profile.metric)) errors.push('metric');
  if (!VALID_COORDINATE_PRECISIONS.includes(profile.coordinatePrecision)) errors.push('coordinatePrecision');
  if (!VALID_QUANTIZATIONS.includes(profile.coordinateQuantization)) errors.push('coordinateQuantization');
  if (!VALID_TRANSPORT_ENCODINGS.includes(profile.transportEncoding)) errors.push('transportEncoding');
  if (!VALID_STORAGE_ENCODINGS.includes(profile.storageEncoding)) errors.push('storageEncoding');
  if (!VALID_QUANTIZATIONS.includes(profile.storageQuantization)) errors.push('storageQuantization');
  if (profile.quality !== 'degraded-fallback') errors.push('quality=degraded-fallback');
  if (profile.revisionBinding !== 'declared-upstream') errors.push('revisionBinding=declared-upstream');
  if (profile.runtimeBinding !== 'declarative-only') errors.push('runtimeBinding=declarative-only');
  return [...new Set(errors)];
}

/**
 * Audit a Transformers.js ONNX pipeline plan against this skill's
 * anti-patterns and Quality Gates. Structured/enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/transformers-js-onnx-pipelines-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditTransformersJsOnnxPipelines(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_PIPELINE_TYPES.includes(plan.pipelineType)) {
    throw new TypeError(`plan.pipelineType must be one of: ${VALID_PIPELINE_TYPES.join(', ')}`);
  }
  if (!VALID_ENVIRONMENTS.includes(plan.environment)) {
    throw new TypeError(`plan.environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
  }
  if (typeof plan.runsInCI !== 'boolean') {
    throw new TypeError('plan.runsInCI must be a boolean');
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= SEVERITY_WEIGHTS[severity] ?? 5;
  }

  // --- Gate: cross-encoder must bypass the high-level pipeline ---
  if (plan.pipelineType === 'cross-encoder') {
    if (plan.usesHighLevelPipeline === true && plan.readsRawLogits !== true) {
      fail(
        'cross-encoder-softmax-over-1',
        'critical',
        'A cross-encoder routed through the text-classification pipeline softmaxes a single-logit head; softmax over one value collapses every score to 1.0.',
        'Bypass the pipeline: AutoTokenizer + AutoModelForSequenceClassification, then read outputs.logits.data directly as raw scores.'
      );
    } else if (plan.readsRawLogits !== true) {
      fail(
        'cross-encoder-scores-not-raw-logits',
        'high',
        'readsRawLogits is not true for a cross-encoder: scores must come from outputs.logits.data, not a task wrapper.',
        'Read outputs.logits.data directly; for num_labels=1 heads use data[i], for 2-class heads use the positive-class logit.'
      );
    }
    if (typeof plan.maxCandidateTokens === 'number' && plan.maxCandidateTokens > 512) {
      fail(
        'reranker-input-over-512-tokens',
        'high',
        `maxCandidateTokens is ${plan.maxCandidateTokens}: cross-encoders truncate at 512 tokens jointly across (query, candidate), so long candidates lose context or throw RangeError.`,
        'Truncate candidate text to ~400 tokens before tokenizing; feed description + name only, skip the body.'
      );
    }
  }

  // --- Gate: bi-encoder execution must match one complete registry profile ---
  if (plan.pipelineType === 'bi-encoder') {
    if (plan.normalizeEmbeddings !== true) {
      fail(
        'embeddings-not-normalized',
        'high',
        'normalizeEmbeddings is not true: raw dot products bias toward longer strings and cosine ordering is subtly wrong.',
        'Map the profile pooling recipe to its loader primitive and normalize according to the profile.'
      );
    }
    if (plan.pooling !== undefined && !VALID_POOLING.includes(plan.pooling)) {
      fail(
        'invalid-pooling',
        'medium',
        `pooling "${plan.pooling}" is not one of: ${VALID_POOLING.join(', ')}.`,
        'Use the exact versioned recipe from the registry profile; generic mean/cls labels do not identify the pooling kernel.'
      );
    }
    if (Object.hasOwn(plan, 'embeddingSpace')) {
      fail(
        'legacy-embedding-space-declaration',
        'critical',
        'embeddingSpace is the retired local identity shape; it cannot prove the canonical registry profile or a verified producer.',
        'Remove embeddingSpace and attach the complete registry-provided embeddingProfile v2 record.'
      );
    }

    const profile = plan.embeddingProfile;
    const legacyProfileFields = isPlainObject(profile)
      ? LEGACY_EMBEDDING_PROFILE_FIELDS.filter((field) => Object.hasOwn(profile, field))
      : [];
    if (legacyProfileFields.length > 0 || /^embed-v(?!2:)/.test(String(profile?.spaceId ?? ''))) {
      fail(
        'legacy-embedding-profile-v1',
        'critical',
        `embeddingProfile carries retired v1 fields or id: ${legacyProfileFields.join(', ') || String(profile?.spaceId)}.`,
        'Load the complete v2 profile from the canonical registry; do not translate or locally derive a compatibility id.'
      );
    }
    const invalidProfileFields = profileFieldErrors(profile);
    if (invalidProfileFields.length > 0) {
      fail(
        'embedding-profile-v2-incomplete',
        'critical',
        `embeddingProfile is missing or invalid for: ${invalidProfileFields.join(', ')}.`,
        'Pass through the complete registry-produced v2 profile, including model/tokenizer config artifacts and preprocessing digest. The skill auditor never computes those digests or treats the profile as producer proof.'
      );
    } else {
      if (plan.loaderModelId !== profile.modelId) {
        fail(
          'embedding-loader-profile-model-mismatch',
          'critical',
          `loaderModelId "${plan.loaderModelId}" does not match embeddingProfile.modelId "${profile.modelId}".`,
          'Load the exact model named by the registry profile; never substitute an alias or fallback.'
        );
      }
      if (plan.loaderRevision !== profile.modelRevision) {
        fail(
          'embedding-loader-profile-revision-mismatch',
          'critical',
          `loaderRevision "${plan.loaderRevision}" does not match embeddingProfile.modelRevision "${profile.modelRevision}".`,
          'Pass the profile modelRevision to the loader and refuse a moving or substituted revision.'
        );
      }
      if (plan.pooling !== profile.pooling) {
        fail(
          'embedding-loader-profile-pooling-mismatch',
          'critical',
          `pooling "${plan.pooling}" does not match embeddingProfile.pooling "${profile.pooling}".`,
          'Use the same registry pooling recipe for both corpus and query vectors, then map it to the loader primitive at execution.'
        );
      }
      const observedNormalization = plan.normalizeEmbeddings === true ? 'l2' : 'none';
      if (profile.normalization !== observedNormalization) {
        fail(
          'embedding-loader-profile-normalization-mismatch',
          'critical',
          `embeddingProfile.normalization "${profile.normalization}" does not match configured output normalization "${observedNormalization}".`,
          'Make the loader invocation and canonical profile agree before indexing.'
        );
      }
      if (plan.maxInputTokens !== profile.maxTokens) {
        fail(
          'embedding-loader-profile-token-limit-mismatch',
          'critical',
          `maxInputTokens "${plan.maxInputTokens}" does not match embeddingProfile.maxTokens "${profile.maxTokens}".`,
          'Use the profile truncation and token limit for both corpus and query inputs.'
        );
      }
    }

    if (Object.hasOwn(plan, 'degradedFallbackLabeled')) {
      fail(
        'legacy-fallback-quality-flag',
        'critical',
        'degradedFallbackLabeled is a retired self-asserted quality flag and has no authority.',
        'Remove the boolean. Current registry profiles remain degraded-fallback/declarative-only until a separate runtime attestation receipt promotes them.'
      );
    }
    const selfAssertedAttestationFields = FORBIDDEN_ATTESTATION_FIELDS.filter((field) =>
      Object.hasOwn(plan, field)
    );
    if (selfAssertedAttestationFields.length > 0) {
      fail(
        'producer-attestation-self-asserted',
        'critical',
        `The plan self-asserts unsupported producer-attestation fields: ${selfAssertedAttestationFields.join(', ')}.`,
        'Remove those fields. A separately verified producer-attestation path is roadmap-only and is not implemented by this skill.'
      );
    }
    if (profile?.runtimeBinding === 'declarative-only') {
      if (!VALID_VECTOR_DISPOSITIONS.includes(plan.vectorDisposition)) {
        fail(
          'declarative-profile-disposition-invalid',
          'critical',
          `vectorDisposition must be one of ${VALID_VECTOR_DISPOSITIONS.join(', ')} for a declarative-only profile.`,
          'Keep generated vectors ephemeral and uncompared, or persist them only as an explicitly quarantined-uncompared fixture.'
        );
      }
      if (plan.similarityComparisonEnabled !== false) {
        fail(
          'declarative-profile-comparison-forbidden',
          'critical',
          'similarityComparisonEnabled must be false because a declarative-only profile is not verified producer evidence.',
          'Do not compare these vectors. A separately verified producer-attestation path is roadmap-only.'
        );
      }
      if (plan.persistsVectors === true && plan.vectorDisposition !== 'quarantined-uncompared') {
        fail(
          'declarative-profile-persistence-not-quarantined',
          'critical',
          'A declarative-only vector may not enter ordinary index storage; persisted output must be explicitly quarantined-uncompared.',
          'Set persistsVectors false for ephemeral output, or quarantine the artifact outside every search/index path.'
        );
      }
      if (plan.vectorDisposition === 'quarantined-uncompared' && plan.persistsVectors !== true) {
        fail(
          'declarative-profile-quarantine-not-persisted',
          'critical',
          'vectorDisposition is quarantined-uncompared but persistsVectors is not true, so the declared lifecycle state is internally inconsistent.',
          'Use ephemeral-uncompared with persistsVectors false, or quarantined-uncompared with persistsVectors true.'
        );
      }
    }
    if (plan.rejectsIncompatibleSpaces !== true) {
      fail(
        'incompatible-spaces-not-rejected',
        'critical',
        'rejectsIncompatibleSpaces is not true: a future attested comparison path would not fail closed on different declared spaces.',
        'Preserve spaceId mismatch rejection as a future-path invariant; this flag does not authorize comparison now.'
      );
    }
  }

  // --- Gate: first-load Promise cached (no double-download, no import-time block) ---
  if (plan.lazyLoadPromiseCached !== true) {
    fail(
      'first-load-promise-not-cached',
      'high',
      'lazyLoadPromiseCached is not true: concurrent first calls double-download the model, or a top-level await blocks startup for the whole download.',
      'Lazy-load inside a function and cache the Promise so concurrent first calls share one load.'
    );
  }

  // --- Gate: CI cache configuration ---
  if (plan.runsInCI) {
    if (plan.allowLocalModels === true) {
      fail(
        'allow-local-models-in-ci',
        'critical',
        'allowLocalModels is true in CI: the SDK looks for model files on disk first, and with no disk model in CI the load fails with "model not found".',
        'Keep env.allowLocalModels = false (the default) and rely on the remote download plus a CI cache.'
      );
    }
    if (plan.cacheDirConfigured !== true || plan.ciCachePersisted !== true) {
      fail(
        'ci-model-cache-missing',
        'high',
        'cacheDirConfigured and ciCachePersisted must both be true in CI: without env.cacheDir pointed at a workspace path persisted by actions/cache, every CI run re-downloads the model.',
        'Set env.cacheDir to a workspace-local path and persist it with actions/cache keyed on the model version.'
      );
    }
  }

  // --- Gate: persisted vectors must be copied out of the reused tensor buffer ---
  if (plan.persistsVectors === true && plan.copiesOutputBuffer !== true) {
    fail(
      'persisted-vectors-not-copied',
      'high',
      'persistsVectors is true but copiesOutputBuffer is not: some pipelines return a view into a reused tensor buffer, so the next call silently overwrites stored vectors.',
      'Copy on capture: new Float32Array(out.data) before storing or buffering the vector.'
    );
  }

  // --- Gate: model versions pinned ---
  if (plan.modelVersionPinned !== true) {
    fail(
      'model-version-not-pinned',
      'medium',
      'modelVersionPinned is not true: an unpinned model id can silently change weights and invalidate every stored embedding.',
      'Pin the exact model id/revision in code; never "latest". Re-embed the corpus on any model change.'
    );
  }

  // --- Gate: v4 dtype is explicit; full precision needs evidence ---
  if (!VALID_DTYPES.includes(plan.dtype)) {
    fail(
      'transformers-v4-dtype-missing',
      'medium',
      `dtype "${plan.dtype}" is not a supported explicit Transformers.js v4 dtype.`,
      'Set dtype to a supported concrete value such as q8 or q4; do not use the removed quantized boolean option.'
    );
  } else if (['fp32', 'fp16'].includes(plan.dtype) && plan.fullPrecisionJustified !== true) {
    fail(
      'unquantized-without-justification',
      'medium',
      `dtype is ${plan.dtype} and fullPrecisionJustified is not true: full-precision weights require measured evidence.`,
      'Use an appropriate q8/q4 dtype unless a measured quality regression justifies full precision.'
    );
  }

  // --- Gate: smoke test on known queries ---
  if (plan.ciSmokeTest !== true) {
    fail(
      'no-ci-smoke-test',
      'low',
      'ciSmokeTest is not true: nothing exercises the model on known queries each build, so a broken cache or model change ships silently.',
      'Run the model on 3 known inputs in CI, assert load success, dimensions, and finite coordinates, then discard or quarantine the output without similarity comparison.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Keep declarative-only vectors ephemeral-uncompared or quarantined-uncompared until a separate verified producer-attestation path exists.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: transformers_js_onnx_pipelines_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditTransformersJsOnnxPipelines(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`transformers_js_onnx_pipelines_audit: ${e.message}\n`);
    process.exit(1);
  }
}
