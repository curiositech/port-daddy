#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_LOADER_SCOPES = ['request', 'module-singleton'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a GraphQL DataLoader plan against graphql-n-plus-one-dataloader's
 * core rules: per-request loader construction, the same-length/same-order
 * batch contract, batching-not-caching, layered depth + cost defenses, the
 * introspection escape hatch, and the 2-round-trip invariant. All rules
 * operate on structured enum/boolean/number fields -- see
 * schemas/graphql-n-plus-one-dataloader-plan.schema.json.
 *
 * @param {unknown} plan
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditGraphqlNPlusOneDataloader(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_LOADER_SCOPES.includes(plan.loaderScope)) {
    throw new TypeError(`plan.loaderScope must be one of: ${VALID_LOADER_SCOPES.join(', ')}`);
  }
  if (typeof plan.batchFnReordersByKey !== 'boolean') {
    throw new TypeError('plan.batchFnReordersByKey must be a boolean');
  }
  if (typeof plan.batchFnReturnsKeyLengthArray !== 'boolean') {
    throw new TypeError('plan.batchFnReturnsKeyLengthArray must be a boolean');
  }
  if (typeof plan.roundTripsForListQuery !== 'number' || plan.roundTripsForListQuery < 1) {
    throw new TypeError('plan.roundTripsForListQuery must be a number >= 1');
  }
  if (typeof plan.depthLimitEnabled !== 'boolean' || typeof plan.costAnalysisEnabled !== 'boolean') {
    throw new TypeError('plan.depthLimitEnabled and plan.costAnalysisEnabled must be booleans');
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

  // --- Gate: loaders constructed per request, never at module scope ---
  if (plan.loaderScope === 'module-singleton') {
    fail(
      'singleton-loader-cross-request-poisoning',
      'critical',
      'loaderScope is "module-singleton": DataLoader\'s cache is request-scoped memoization; shared across requests, user B reads rows cached from user A\'s request -- a cross-tenant data leak.',
      'Construct every DataLoader inside the request context factory: context: () => ({ loaders: { ... } }).'
    );
  }

  // --- Gate: the batch contract -- same length, same order ---
  if (plan.batchFnReordersByKey !== true) {
    fail(
      'batch-order-contract-violated',
      'critical',
      'batchFnReordersByKey is not true: SELECT ... WHERE id IN (...) does not guarantee row order, and DataLoader matches values to keys BY INDEX, so user 1 silently receives user 2\'s row.',
      'Build a Map(rows.map((r) => [r.id, r])) and return keys.map((k) => byId.get(k) ?? new Error(...)); test with shuffled key order.'
    );
  }
  if (plan.batchFnReturnsKeyLengthArray !== true) {
    fail(
      'batch-length-contract-violated',
      'critical',
      'batchFnReturnsKeyLengthArray is not true: the batch function must resolve an array exactly keys.length long, with null or an Error at each missing index.',
      'Return keys.map((k) => byId.get(k) ?? null) so missing keys hold a placeholder instead of shifting every later index.'
    );
  }

  // --- Gate: the 2-round-trip invariant for a list query ---
  if (plan.roundTripsForListQuery > 2) {
    fail(
      'unbatched-list-field',
      'high',
      `roundTripsForListQuery is ${plan.roundTripsForListQuery}: a batched list-plus-association query resolves in at most 2 round trips regardless of N; more means a resolver still loads parent-by-parent.`,
      'Wrap the per-parent lookup in a DataLoader (or refactor to a batchable WHERE id IN (...) query) and assert the query log emits exactly 2 lines in a test.'
    );
  }

  // --- Gate: DataLoader is batching, not an application cache ---
  if (plan.usedAsApplicationCache === true) {
    fail(
      'dataloader-as-application-cache',
      'high',
      'usedAsApplicationCache is true: DataLoader\'s cache only deduplicates loads within one request; treating it as Redis/Memcache yields stale reads that shadow fresh data.',
      'Keep cross-request caching in Redis/Memcache; let DataLoader do per-request batching only.'
    );
  }

  // --- Gate: layered defenses -- depth alone cannot stop breadth bombs ---
  if (plan.depthLimitEnabled && !plan.costAnalysisEnabled) {
    fail(
      'depth-limit-only-defense',
      'high',
      'depthLimitEnabled without costAnalysisEnabled: users(first: 10000) { posts(first: 10000) } is depth 2 but a cartesian explosion at the database -- depth limits cannot see list-argument breadth.',
      'Layer cost analysis with argument multipliers (@cost, GraphQL Armor) on top of the depth limit.'
    );
  } else if (!plan.depthLimitEnabled && plan.costAnalysisEnabled) {
    fail(
      'no-depth-limit',
      'medium',
      'costAnalysisEnabled without depthLimitEnabled: recursion bombs (deeply self-referential queries) are cheapest to kill at parse time with a depth limit.',
      'Add a depth limit (e.g. @graphile/depth-limit, GraphQL Armor MaxDepth) as the cheap parse-time first line.'
    );
  } else if (!plan.depthLimitEnabled && !plan.costAnalysisEnabled) {
    fail(
      'no-query-abuse-defense',
      'high',
      'Neither depthLimitEnabled nor costAnalysisEnabled: any client can send recursion bombs or breadth bombs straight to the database.',
      'Enable both: a depth limit for recursion bombs and cost analysis with multipliers for breadth bombs.'
    );
  }

  // --- Gate: the introspection escape hatch ---
  if (plan.depthLimitEnabled && plan.introspectionExempt !== true) {
    fail(
      'introspection-not-exempt',
      'medium',
      'depthLimitEnabled but introspectionExempt is not true: __schema/__type queries are deeper than your data queries, so the limit breaks Playground/IDE tooling.',
      "Exempt introspection: depthLimit(7, { ignore: ['__schema', '__type'] })."
    );
  }

  // --- Gate: APQ for external/mobile clients ---
  if (plan.clientsExternal === true && plan.apqEnabled !== true) {
    fail(
      'no-apq-for-external-clients',
      'low',
      'clientsExternal is true but apqEnabled is not: full query strings ride every request from bandwidth-constrained clients, and GET/CDN cacheability is left on the table.',
      'Enable Automatic Persisted Queries (sha256 hash protocol) with useGETForHashedQueries for cacheable reads.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still run the validation test: trace the datastore query log during a list query and assert exactly 2 lines.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: graphql_n_plus_one_dataloader_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditGraphqlNPlusOneDataloader(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`graphql_n_plus_one_dataloader_audit: ${e.message}\n`);
    process.exit(1);
  }
}
