#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_PROPAGATORS = ['w3c', 'b3', 'composite', 'vendor'];
const VALID_SAMPLING = ['head', 'tail', 'both', 'always-on'];
const VALID_DB_SYSTEMS = ['postgres', 'mysql', 'oracle', 'sqlserver', 'sqlite', 'other'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a distributed-tracing propagation plan against
 * distributed-tracing-w3c-context's rules: W3C traceparent hygiene, composite
 * propagators during migration, head-vs-tail sampling fit, and sqlcommenter
 * posture. Rules operate on structured enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/trace-propagation-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditTracePropagation(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_PROPAGATORS.includes(plan.propagator)) {
    throw new TypeError(`plan.propagator must be one of: ${VALID_PROPAGATORS.join(', ')}`);
  }
  if (!VALID_SAMPLING.includes(plan.samplingStrategy)) {
    throw new TypeError(`plan.samplingStrategy must be one of: ${VALID_SAMPLING.join(', ')}`);
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

  // --- Gate: new parent-id (span_id) per local span ---
  if (plan.newParentIdPerSpan !== true) {
    fail(
      'parent-id-reused-across-services',
      'critical',
      "newParentIdPerSpan is not true: W3C §3.4 requires 'the parent-id field MUST be set to a new value' on outgoing requests; reusing the upstream parent-id collapses the trace tree.",
      'Generate a fresh span_id per local span and write it into the outgoing traceparent; SDK propagators do this — never hand-forward the incoming header.'
    );
  }

  // --- Gate: lowercase-hex traceparent validated at boundaries ---
  if (plan.traceparentLowercaseHexValidated !== true) {
    fail(
      'traceparent-format-unvalidated',
      'high',
      'traceparentLowercaseHexValidated is not true: uppercase hex or malformed fields make receiving vendors MUST-ignore the header, silently breaking the trace at the service boundary.',
      'Add a boundary test asserting emitted traceparent headers are exactly 55 chars of lowercase hex with correct separators; never string-format the header manually.'
    );
  }

  // --- Gate: migration off legacy headers needs a composite propagator ---
  if (plan.legacyUpstreamsRemain === true && plan.propagator !== 'composite') {
    fail(
      'legacy-upstreams-without-composite',
      'high',
      `legacyUpstreamsRemain is true but propagator is '${plan.propagator}': hops that still emit B3/X-Ray/vendor headers will drop the trace mid-migration.`,
      'Run a CompositePropagator (W3C primary + legacy fallback) until the last legacy upstream is migrated, then drop the legacy entry.'
    );
  }

  // --- Gate: vendor-proprietary propagation is lock-in ---
  if (plan.propagator === 'vendor') {
    fail(
      'vendor-proprietary-propagator',
      'high',
      "propagator is 'vendor': proprietary headers (x-datadog-*, X-Amzn-Trace-Id) lock trace continuity to one backend and break in polyglot stacks.",
      'Use the OTel SDK with W3CTraceContextPropagator (plus a vendor exporter); W3C is what every modern vendor extracts.'
    );
  }

  // --- Gate: error sampling needs tail sampling ---
  if (plan.needErrorSampling === true && (plan.samplingStrategy === 'head' || plan.samplingStrategy === 'always-on')) {
    fail(
      'error-sampling-needs-tail',
      'high',
      `needErrorSampling is true but samplingStrategy is '${plan.samplingStrategy}': head sampling decides before the trace completes, so it cannot guarantee that traces containing errors are sampled.`,
      "Add the OTel Collector tailsamplingprocessor with an error policy (strategy 'tail' or 'both')."
    );
  }

  // --- Gate: tail sampling without a head-sampling safety net ---
  if (plan.samplingStrategy === 'tail') {
    fail(
      'tail-without-head-fallback',
      'medium',
      "samplingStrategy is 'tail' with no head-sampling baseline: the tail-sampling collector is stateful, and when it dies, all traces drop.",
      "Pair a small always-on head-sampling ratio (e.g. ParentBased(TraceIDRatio(0.01))) with tail sampling — strategy 'both'."
    );
  }

  // --- Gate: 100% sampling in production ---
  if (typeof plan.productionSampleRatePercent === 'number' && plan.productionSampleRatePercent >= 100) {
    fail(
      'full-sampling-in-production',
      'medium',
      `productionSampleRatePercent is ${plan.productionSampleRatePercent}: sampling everything in production explodes trace-storage cost and saturates the collector.`,
      'Start at a 1-10% baseline and raise the rate only for specific routes or tenants.'
    );
  }

  // --- Gate: sqlcommenter is opt-in and DB-system-aware ---
  if (plan.sqlCommenterEnabled === true) {
    if (plan.sqlCommenterDefaultOn === true) {
      fail(
        'sqlcommenter-on-by-default',
        'medium',
        'sqlCommenterDefaultOn is true: the OTel spec says SQL-commenter propagation SHOULD NOT be enabled by default — it is an explicit opt-in.',
        'Ship sqlcommenter behind an explicit opt-in config flag, per the OTel semconv MAY/SHOULD-NOT language.'
      );
    }
    if (plan.dbSystem !== undefined && !VALID_DB_SYSTEMS.includes(plan.dbSystem)) {
      fail(
        'invalid-db-system',
        'low',
        `dbSystem "${plan.dbSystem}" is not one of: ${VALID_DB_SYSTEMS.join(', ')}.`,
        'Name the database system so the plan-cache impact rule can be checked.'
      );
    } else if (['mysql', 'oracle', 'sqlserver'].includes(plan.dbSystem)) {
      fail(
        'sqlcommenter-plan-cache-impact',
        'medium',
        `sqlCommenterEnabled is true with dbSystem '${plan.dbSystem}': high-cardinality comments degrade prepared-statement/plan-cache performance on MySQL, Oracle, and SQL Server per the OTel spec.`,
        'Benchmark on this stack before enabling, or restrict the comment to non-prepared paths; Postgres normalizes comments out and is safe.'
      );
    }
  }

  // --- Gate: no PII in tracestate ---
  if (plan.piiInTracestate === true) {
    fail(
      'pii-in-tracestate',
      'critical',
      'piiInTracestate is true: tracestate is forwarded and logged at every hop by every vendor in the path — user attributes there leak PII and explode cardinality.',
      'Keep tracestate for trace-routing data only; user attributes belong in span attributes behind your attribute filters.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still run the timeline test: an error in the deepest service should yield one trace spanning every hop plus its SQL, findable in seconds.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: trace_propagation_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditTracePropagation(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`trace_propagation_audit: ${e.message}\n`);
    process.exit(1);
  }
}
