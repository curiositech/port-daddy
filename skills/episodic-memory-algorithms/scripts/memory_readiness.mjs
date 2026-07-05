#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_MEMORY_TYPES = new Set(['core', 'short', 'long', 'episodic', 'procedural']);

// Sane single-node upper bound on entryCount per index algorithm, per the skill's own
// "Vector Search Algorithm Selection" decision tree (SKILL.md #2). Beyond these bounds
// the algorithm is mismatched to scale and should be replaced by the next tier.
const ALGO_SCALE_CEILING = {
  flat: 100_000,
  hnsw: 10_000_000,
  'ivf-pq': Infinity,
  diskann: Infinity,
};

const CHECK_WEIGHTS = {
  memoryTypes: 10,
  vectorIndex: 12,
  retrievalWeights: 12,
  similarityThreshold: 16,
  tokenBudget: 16,
  stalePollution: 14,
  forgetting: 12,
  coldStart: 8,
  keywordFallback: 8,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function normalizeAlgo(algo) {
  if (typeof algo !== 'string') return null;
  return algo.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * Audit a memory-architecture plan against this skill's Quality Gates and
 * documented failure modes (SKILL.md "Failure Modes" and "Quality Gates").
 *
 * Expected shape of `plan`:
 * {
 *   memoryTypes: string[],                 // subset of core/short/long/episodic/procedural
 *   vectorIndex: { algo: string, entryCount: number },
 *   retrievalWeights: {                    // keyed by query-context name
 *     [context: string]: { relevance: number, recency: number, importance: number }
 *   },
 *   forgetting: {
 *     coreNeverForget: boolean,
 *     policiesByImportance: Array<{ minImportance: number, maxImportance: number, policy: string }>
 *   },
 *   biTemporal: boolean,
 *   contradictionDetection: boolean,
 *   tokenBudgetFraction: number,            // fraction of context window reserved for memory
 *   similarityThreshold: number,            // hard cosine-similarity floor for factual claims
 *   coldStartLoadsIdentity: boolean,
 *   degradesToKeywordFallback: boolean,
 * }
 *
 * @param {unknown} plan - parsed JSON memory-architecture plan.
 * @returns {{pass: boolean, score: number, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditMemoryDesign(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }

  const findings = [];
  const recommendations = [];
  let score = 0;
  let criticalHit = false;
  let highHit = false;

  function fail(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    if (severity === 'high') highHit = true;
  }

  // --- memoryTypes ---
  const memoryTypes = plan.memoryTypes;
  if (!isNonEmptyArray(memoryTypes)) {
    fail('missing-memory-types', 'high', 'memoryTypes is missing or empty: the plan does not declare which memory tiers exist.', 'Declare memoryTypes as a non-empty subset of core/short/long/episodic/procedural.');
  } else {
    const invalid = memoryTypes.filter((t) => !VALID_MEMORY_TYPES.has(t));
    if (invalid.length > 0) {
      fail('invalid-memory-types', 'medium', `memoryTypes contains unrecognized values: ${invalid.join(', ')}.`, 'Use only core/short/long/episodic/procedural memory-type labels.');
      score += CHECK_WEIGHTS.memoryTypes * 0.5;
    } else {
      score += CHECK_WEIGHTS.memoryTypes;
    }
  }

  // --- vectorIndex: algo vs. entryCount scale mismatch ---
  const vectorIndex = plan.vectorIndex;
  if (!isPlainObject(vectorIndex) || typeof vectorIndex.entryCount !== 'number') {
    fail('missing-vector-index', 'high', 'vectorIndex.algo/entryCount is missing: cannot assess whether the chosen index scales.', 'Declare vectorIndex.algo (flat/hnsw/ivf-pq/diskann) and vectorIndex.entryCount.');
  } else {
    const algo = normalizeAlgo(vectorIndex.algo);
    const ceiling = algo ? ALGO_SCALE_CEILING[algo] : undefined;
    if (!algo || ceiling === undefined) {
      fail('unknown-index-algo', 'medium', `vectorIndex.algo "${vectorIndex.algo}" is not a recognized algorithm (flat/hnsw/ivf-pq/diskann).`, 'Pick a documented algorithm so scale ceilings can be verified.');
      score += CHECK_WEIGHTS.vectorIndex * 0.4;
    } else if (vectorIndex.entryCount > ceiling) {
      fail(
        'index-algo-scale-mismatch',
        'high',
        `${algo} is sized for up to ~${ceiling.toLocaleString()} entries but entryCount is ${vectorIndex.entryCount.toLocaleString()}: query latency and recall will degrade.`,
        algo === 'flat'
          ? 'Move to HNSW once past ~100K entries.'
          : 'Move to IVF-PQ or DiskANN once past ~10M entries on a single node.'
      );
    } else {
      score += CHECK_WEIGHTS.vectorIndex;
    }
  }

  // --- retrievalWeights per query-context ---
  const retrievalWeights = plan.retrievalWeights;
  if (!isPlainObject(retrievalWeights) || Object.keys(retrievalWeights).length === 0) {
    fail('missing-retrieval-weights', 'medium', 'retrievalWeights is missing: no query-context-adaptive scoring is declared.', 'Declare retrievalWeights per query-context (e.g. specific-recall, cold-start) with relevance/recency/importance.');
  } else {
    const contexts = Object.entries(retrievalWeights);
    const bad = [];
    for (const [ctx, weights] of contexts) {
      if (!isPlainObject(weights)) {
        bad.push(`${ctx} (not an object)`);
        continue;
      }
      const { relevance, recency, importance } = weights;
      if (typeof relevance !== 'number' || typeof recency !== 'number' || typeof importance !== 'number') {
        bad.push(`${ctx} (missing relevance/recency/importance)`);
        continue;
      }
      const total = relevance + recency + importance;
      if (Math.abs(total - 1) > 0.05) {
        bad.push(`${ctx} (weights sum to ${total.toFixed(2)}, not ~1.0)`);
      }
    }
    if (bad.length > 0) {
      fail('invalid-retrieval-weights', 'medium', `retrievalWeights has malformed context(s): ${bad.join('; ')}.`, 'Every query-context must specify relevance+recency+importance summing to ~1.0.');
      score += CHECK_WEIGHTS.retrievalWeights * Math.max(0, 1 - bad.length / contexts.length) * 0.7;
    } else {
      score += CHECK_WEIGHTS.retrievalWeights;
    }
  }

  // --- Failure mode 1: Memory Retrieval Hallucination ---
  const threshold = plan.similarityThreshold;
  if (typeof threshold !== 'number') {
    fail('missing-similarity-threshold', 'critical', 'No similarityThreshold declared: factual claims have no hard floor and are exposed to retrieval hallucination.', 'Set similarityThreshold >= 0.75 as a hard floor for factual claims.');
  } else if (threshold < 0.75) {
    fail('weak-similarity-threshold', 'critical', `similarityThreshold is ${threshold}, below the 0.75 floor: low-relevance memories can be presented as fact.`, 'Raise similarityThreshold to 0.75+ for factual claims, and add an "I don\'t have specific information" fallback below it.');
  } else {
    score += CHECK_WEIGHTS.similarityThreshold;
  }

  // --- Failure mode 2: Token Budget Overflow ---
  const fraction = plan.tokenBudgetFraction;
  if (typeof fraction !== 'number') {
    fail('no-token-aware-budgeting', 'high', 'No tokenBudgetFraction declared: retrieval has no token-aware scoring, risking context overflow.', 'Declare tokenBudgetFraction and score = (relevance * importance) / token_cost so retrieval is token-aware.');
  } else if (fraction > 0.3) {
    fail('token-budget-overflow', 'high', `tokenBudgetFraction is ${fraction}, above the 0.30 ceiling for retrieved memories.`, 'Cap tokenBudgetFraction at 0.30 of the context window and use hierarchical summarization to compress old conversations.');
  } else {
    score += CHECK_WEIGHTS.tokenBudget;
  }

  // --- Failure mode 3: Stale Memory Pollution ---
  const biTemporal = plan.biTemporal === true;
  const contradictionDetection = plan.contradictionDetection === true;
  if (!biTemporal && !contradictionDetection) {
    fail('stale-pollution-risk', 'high', 'Neither biTemporal tracking nor contradictionDetection is enabled: superseded facts can be retrieved as current.', 'Enable biTemporal validity tracking (Zep-style validFrom/ingestedAt) or contradictionDetection so changed facts are marked superseded.');
  } else {
    score += CHECK_WEIGHTS.stalePollution;
  }

  // --- Forgetting policy: importance-tiered with core=never_forget ---
  const forgetting = plan.forgetting;
  if (!isPlainObject(forgetting)) {
    fail('missing-forgetting-policy', 'critical', 'No forgetting block: there is no importance-tiered retention policy at all.', 'Add forgetting.coreNeverForget=true and forgetting.policiesByImportance covering the remaining importance tiers.');
  } else if (forgetting.coreNeverForget !== true) {
    fail('core-memory-not-protected', 'critical', 'forgetting.coreNeverForget is not true: core identity facts (importance 9-10) can be forgotten.', 'Set forgetting.coreNeverForget=true so the agent cannot lose its identity facts.');
  } else if (!isNonEmptyArray(forgetting.policiesByImportance)) {
    fail('forgetting-policy-incomplete', 'medium', 'forgetting.policiesByImportance is missing or empty: only the core tier has a policy, everything else has none.', 'Add decay policies (e.g. 30-day / 7-day / 1-day half-life) for the non-core importance tiers.');
    score += CHECK_WEIGHTS.forgetting * 0.5;
  } else {
    score += CHECK_WEIGHTS.forgetting;
  }

  // --- Cold start ---
  if (plan.coldStartLoadsIdentity !== true) {
    fail('cold-start-no-identity', 'high', 'coldStartLoadsIdentity is not true: a new session will not load core identity facts up front.', 'On cold start, retrieve with importance-dominant weighting (e.g. importance=0.7) so identity facts load within the first few queries.');
  } else {
    score += CHECK_WEIGHTS.coldStart;
  }

  // --- Keyword fallback when index empty ---
  if (plan.degradesToKeywordFallback !== true) {
    fail('no-keyword-fallback', 'medium', 'degradesToKeywordFallback is not true: an empty or unavailable vector index has no fallback path.', 'Add a keyword-search fallback so the system degrades gracefully instead of returning nothing when the vector index is empty or down.');
    score += 0;
  } else {
    score += CHECK_WEIGHTS.keywordFallback;
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && !highHit && clampedScore >= 80;

  if (findings.length === 0) {
    recommendations.push('Plan clears all documented failure modes. Spot-check recall@10 and P95 latency against the Quality Gates before calling the design production-ready.');
  }

  return {
    pass,
    score: clampedScore,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: memory_readiness.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditMemoryDesign(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`memory_readiness: ${error.message}\n`);
    process.exit(1);
  }
}
