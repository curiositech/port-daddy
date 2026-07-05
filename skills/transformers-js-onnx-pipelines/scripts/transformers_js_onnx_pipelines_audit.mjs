#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_PIPELINE_TYPES = ['bi-encoder', 'cross-encoder', 'classification'];
const VALID_ENVIRONMENTS = ['node', 'browser'];
const VALID_POOLING = ['mean', 'cls', 'none'];
const SEVERITY_WEIGHTS = { critical: 30, high: 15, medium: 8, low: 3 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

  // --- Gate: bi-encoder cosine needs normalized mean-pooled vectors ---
  if (plan.pipelineType === 'bi-encoder') {
    if (plan.normalizeEmbeddings !== true) {
      fail(
        'embeddings-not-normalized',
        'high',
        'normalizeEmbeddings is not true: raw dot products bias toward longer strings and cosine ordering is subtly wrong.',
        'Always call the pipeline with { pooling: "mean", normalize: true } so cosine equals dot product.'
      );
    }
    if (plan.pooling !== undefined && !VALID_POOLING.includes(plan.pooling)) {
      fail(
        'invalid-pooling',
        'medium',
        `pooling "${plan.pooling}" is not one of: ${VALID_POOLING.join(', ')}.`,
        'Use pooling: "mean" (average token embeddings) or "cls" ([CLS] token) for sentence embeddings.'
      );
    } else if (plan.pooling === 'none') {
      fail(
        'no-pooling-for-sentence-embeddings',
        'high',
        'pooling is "none": the output is per-token embeddings, not a sentence vector, so cosine search over it is meaningless.',
        'Set pooling: "mean" (or "cls") to reduce token embeddings to one sentence vector.'
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

  // --- Gate: quantized unless full precision is justified ---
  if (plan.quantized !== true && plan.fullPrecisionJustified !== true) {
    fail(
      'unquantized-without-justification',
      'medium',
      'quantized is not true and fullPrecisionJustified is not true: full-precision weights multiply download size and memory for little accuracy gain in most retrieval tasks.',
      'Use { quantized: true } unless a measured accuracy regression justifies full precision (then set fullPrecisionJustified: true).'
    );
  }

  // --- Gate: smoke test on known queries ---
  if (plan.ciSmokeTest !== true) {
    fail(
      'no-ci-smoke-test',
      'low',
      'ciSmokeTest is not true: nothing exercises the model on known queries each build, so a broken cache or model change ships silently.',
      'Run the model on 3 known queries in CI and assert stable top-1 results.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still verify end-to-end: run the pipeline on a known query and confirm scores/vectors match a recorded baseline.');
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
