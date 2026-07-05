#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_CHUNK_STRATEGIES = ['fixed', 'recursive', 'semantic', 'structure-aware'];
const VALID_RETRIEVAL_MODES = ['dense-only', 'sparse-only', 'hybrid-rrf', 'hybrid-other'];
const VALID_CADENCES = ['hourly', 'daily', 'weekly', 'on-change', 'never'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a RAG retrieval-pipeline plan against rag-retrieval-pattern-design's
 * fixed order of work (chunking -> embeddings -> hybrid -> rerank -> eval ->
 * freshness) and its Quality Gates.
 *
 * @param {unknown} plan - parsed JSON, see schemas/rag-retrieval-pattern-design-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditRagRetrievalPatternDesign(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_CHUNK_STRATEGIES.includes(plan.chunkStrategy)) {
    throw new TypeError(`plan.chunkStrategy must be one of: ${VALID_CHUNK_STRATEGIES.join(', ')}`);
  }
  if (typeof plan.chunkSizeTokens !== 'number' || plan.chunkSizeTokens <= 0) {
    throw new TypeError('plan.chunkSizeTokens must be a positive number');
  }
  if (!VALID_RETRIEVAL_MODES.includes(plan.retrievalMode)) {
    throw new TypeError(`plan.retrievalMode must be one of: ${VALID_RETRIEVAL_MODES.join(', ')}`);
  }
  if (typeof plan.rerankerPresent !== 'boolean') {
    throw new TypeError('plan.rerankerPresent must be a boolean');
  }
  if (plan.reindexCadence !== undefined && !VALID_CADENCES.includes(plan.reindexCadence)) {
    throw new TypeError(`plan.reindexCadence must be one of: ${VALID_CADENCES.join(', ')}`);
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= { critical: 30, high: 15, medium: 8, low: 3 }[severity] ?? 5;
  }

  // Gate 1: single-retriever bias — hybrid + RRF is the standard.
  if (plan.retrievalMode === 'dense-only' || plan.retrievalMode === 'sparse-only') {
    fail(
      'single-retriever-bias',
      'high',
      `retrievalMode is ${plan.retrievalMode}: dense misses rare tokens (IDs, acronyms), sparse misses paraphrase — each alone leaves recall on the table.`,
      'Run BM25 + dense and fuse with RRF (k=60); start weights at 0.6 dense / 0.4 sparse and tune on the eval set.'
    );
  }

  // Gate 2: chunk size near the 512-token baseline.
  if (plan.chunkSizeTokens > 2048) {
    fail(
      'chunks-too-large',
      'high',
      `chunkSizeTokens is ${plan.chunkSizeTokens}: huge chunks dilute the relevant signal and drop faithfulness — the "more context" fallacy.`,
      'Target ~512 tokens with 10-20% overlap; let retrieval find a focused chunk instead of handing the LLM a haystack.'
    );
  } else if (plan.chunkSizeTokens < 128) {
    fail(
      'chunks-too-small',
      'high',
      `chunkSizeTokens is ${plan.chunkSizeTokens}: sub-paragraph chunks lose pronoun resolution and surrounding context.`,
      'Target ~512 tokens; extract pinned sentences in a separate pass if needed, keeping chunks self-contained.'
    );
  }

  // Gate 3: overlap in the 10-20% band (5-30 tolerated).
  if (typeof plan.chunkOverlapPct === 'number' && (plan.chunkOverlapPct < 5 || plan.chunkOverlapPct > 30)) {
    fail(
      'overlap-out-of-band',
      'medium',
      `chunkOverlapPct is ${plan.chunkOverlapPct}: outside the workable 5-30% band (10-20% is the documented baseline).`,
      'Set overlap to 10-20% so cross-boundary context survives without doubling index size.'
    );
  }

  // Gate 4: semantic chunking must be proven, not assumed.
  if (plan.chunkStrategy === 'semantic' && plan.semanticProvenBetter !== true) {
    fail(
      'semantic-chunking-unproven',
      'medium',
      'chunkStrategy is semantic but semanticProvenBetter is not true: recursive at 512 tokens beat semantic by 15 points on the reference benchmark, at lower cost.',
      'Start with recursive chunking; adopt semantic only after your own eval set shows a measurable win.'
    );
  }

  // Gate 5: the reranker — highest-ROI single change.
  if (plan.rerankerPresent !== true) {
    fail(
      'no-reranker',
      'high',
      'rerankerPresent is not true: bi-encoder retrieval has an accuracy ceiling; a cross-encoder rerank (top-20 -> top-5) is the highest-ROI change for under-performing RAG.',
      'Add a cross-encoder reranker (BGE reranker, Cohere/Voyage/Jina Rerank) between retrieval and the LLM.'
    );
  } else {
    if (typeof plan.preRerankTopK === 'number' && plan.preRerankTopK < 10) {
      fail(
        'candidate-set-too-small',
        'medium',
        `preRerankTopK is ${plan.preRerankTopK}: a candidate set this small defeats the reranker — the relevant doc is often not in it (documented sweet spot: 20).`,
        'Retrieve top-20 before reranking; it keeps rerank latency bounded while covering recall.'
      );
    }
    if (
      typeof plan.preRerankTopK === 'number' &&
      typeof plan.postRerankTopK === 'number' &&
      plan.postRerankTopK > plan.preRerankTopK
    ) {
      fail(
        'rerank-topk-inverted',
        'medium',
        `postRerankTopK (${plan.postRerankTopK}) exceeds preRerankTopK (${plan.preRerankTopK}): the reranker cannot emit more candidates than it receives.`,
        'Use the standard 20 -> 5 shape: retrieve top-20, return top-5 to the LLM.'
      );
    }
  }

  // Gate 6: eval set size — without it every claim is vibes.
  if (typeof plan.evalSetSize !== 'number' || plan.evalSetSize < 50) {
    fail(
      'no-meaningful-eval-set',
      'high',
      `evalSetSize is ${plan.evalSetSize ?? 'absent'}: below 50 questions no retrieval change is measurable — "I think it is better" is vibes.`,
      'Hand-curate 100+ representative questions with ground-truth answers and run RAGAS on every change.'
    );
  } else if (plan.evalSetSize < 100) {
    fail(
      'eval-set-below-gate',
      'medium',
      `evalSetSize is ${plan.evalSetSize}: the quality gate calls for 100+ questions so RAGAS deltas clear noise.`,
      'Grow the eval set to 100+ and use bootstrapped confidence intervals on RAGAS scores.'
    );
  }

  // Gate 7: RAGAS gating CI.
  if (plan.ragasInCi !== true) {
    fail(
      'ragas-not-in-ci',
      'medium',
      'ragasInCi is not true: without a CI gate, faithfulness/context-precision regressions ship silently.',
      'Fail the PR if faithfulness or context precision drops > 0.05 against the eval set.'
    );
  }

  // Gate 8: embedding model chosen by domain eval, not leaderboard hype.
  if (plan.embeddingChosenByDomainEval !== true) {
    fail(
      'embedding-chosen-by-hype',
      'medium',
      'embeddingChosenByDomainEval is not true: global MTEB rank is not your corpus — the leaderboard shifts, the criterion does not.',
      'Run the candidate embedding models against your own eval set before committing.'
    );
  }

  // Gate 9: freshness — the silent killer.
  if (plan.reindexCadence === undefined || plan.reindexCadence === 'never') {
    fail(
      'no-reindex-cadence',
      'high',
      'reindexCadence is never/absent: faithfulness stays high while answers go stale — the LLM faithfully reports an outdated index.',
      'Document a cadence per domain (hourly for real-time, daily for catalogs, weekly for internal docs) and feed it with CDC where possible.'
    );
  }

  // Gate 10: zero-result monitoring.
  if (plan.zeroResultRateMonitored !== true) {
    fail(
      'zero-result-rate-unmonitored',
      'medium',
      'zeroResultRateMonitored is not true: a zero-result rate > 5% is the earliest signal of index gaps or corpus drift, and nothing is watching it.',
      'Track zero-result rate per shard; warn at 5%, page at 15%.'
    );
  }

  // Gate 11: per-query structured logging.
  if (plan.perQueryLoggingStructured !== true) {
    fail(
      'no-per-query-logging',
      'low',
      'perQueryLoggingStructured is not true: without candidates+scores per retriever and rerank scores logged, failures cannot be triaged to a layer.',
      'Log query, per-retriever candidates with scores, rerank scores, final top-5, and generation latency for every request.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Pipeline clears every quality gate this skill checks. Still validate the hybrid weights and context ordering (sandwich) against the eval set before shipping.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: rag_retrieval_pattern_design_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditRagRetrievalPatternDesign(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`rag_retrieval_pattern_design_audit: ${e.message}\n`);
    process.exit(1);
  }
}
