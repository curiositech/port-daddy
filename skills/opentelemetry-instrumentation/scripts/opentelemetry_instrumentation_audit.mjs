#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_LOAD_ORDERS = ['preload-flag', 'entrypoint-import', 'after-app-imports'];
const SAMPLERS = ['parent-based-ratio', 'ratio-only', 'always-on', 'always-off'];
const EXPORTER_PROTOCOLS = ['otlp-grpc', 'otlp-http-protobuf', 'otlp-http-json', 'console'];
const SPAN_PROCESSORS = ['batch', 'simple'];
const ENVIRONMENTS = ['production', 'staging', 'development', 'test'];
const LATENCY_INSTRUMENTS = ['histogram', 'counter', 'gauge', 'none'];

function assertPlanObject(plan) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
}

/**
 * Audit an OpenTelemetry instrumentation plan against opentelemetry-instrumentation's
 * Anti-patterns and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/opentelemetry-instrumentation-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditOpentelemetryInstrumentation(plan) {
  assertPlanObject(plan);
  if (typeof plan.serviceNameSet !== 'boolean') {
    throw new TypeError('plan.serviceNameSet must be a boolean');
  }
  if (!SDK_LOAD_ORDERS.includes(plan.sdkLoadOrder)) {
    throw new TypeError(`plan.sdkLoadOrder must be one of: ${SDK_LOAD_ORDERS.join(', ')}`);
  }
  if (!SAMPLERS.includes(plan.sampler)) {
    throw new TypeError(`plan.sampler must be one of: ${SAMPLERS.join(', ')}`);
  }
  if (!EXPORTER_PROTOCOLS.includes(plan.exporterProtocol)) {
    throw new TypeError(`plan.exporterProtocol must be one of: ${EXPORTER_PROTOCOLS.join(', ')}`);
  }
  if (!SPAN_PROCESSORS.includes(plan.spanProcessor)) {
    throw new TypeError(`plan.spanProcessor must be one of: ${SPAN_PROCESSORS.join(', ')}`);
  }
  if (!ENVIRONMENTS.includes(plan.environment)) {
    throw new TypeError(`plan.environment must be one of: ${ENVIRONMENTS.join(', ')}`);
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

  // --- Gate 1: service.name is non-negotiable ---
  if (plan.serviceNameSet !== true) {
    fail('missing-service-name', 'critical',
      'serviceNameSet is not true: every trace collapses into "unknown_service" in the vendor UI.',
      'Set service.name (plus service.version and deployment.environment) via resourceFromAttributes; verify with the Console exporter locally before deploying.');
  }
  if (plan.serviceVersionSet !== true) {
    fail('missing-service-version', 'low',
      'serviceVersionSet is not true: no deploy markers in the backend.',
      'Set service.version (e.g. the git SHA) so deploys are visible as markers.');
  }
  if (plan.deploymentEnvironmentSet !== true) {
    fail('missing-deployment-environment', 'low',
      'deploymentEnvironmentSet is not true: environments cannot be filtered apart in the backend.',
      'Set deployment.environment so prod and staging traces are separable.');
  }

  // --- Gate 2: SDK must load before any instrumented module ---
  if (plan.sdkLoadOrder === 'after-app-imports') {
    fail('sdk-loaded-after-app-imports', 'critical',
      'sdkLoadOrder is "after-app-imports": auto-instrumentation patches modules at require/import time, so http/express requests get no spans for the life of the process.',
      'Load instrumentation via node -r ./instrumentation.js (CJS) or node --import @opentelemetry/auto-instrumentations-node/register (ESM) -- never after the app entry.');
  } else if (plan.sdkLoadOrder === 'entrypoint-import') {
    fail('sdk-imported-from-entrypoint', 'high',
      'sdkLoadOrder is "entrypoint-import": importing ./instrumentation from index is fragile -- any hoisted or earlier import of an instrumented module silently loses spans.',
      'Move SDK init to a preload flag (--require / --import) so ordering is guaranteed by the loader, not by import hoisting.');
  }

  // --- Gate 3: sampling drift across services ---
  if (plan.multiService === true && plan.sampler !== 'parent-based-ratio') {
    fail('sampler-not-parent-based', 'high',
      `multiService is true but sampler is "${plan.sampler}": services that ignore the upstream sampling decision produce traces with missing middle hops.`,
      'Use ParentBasedSampler on every service so children honor the root span\'s sampling decision.');
  }
  if (plan.sampler === 'always-off' && plan.environment === 'production') {
    fail('sampling-off-in-production', 'high',
      'sampler is "always-off" in production: no traces will ever be recorded.',
      'Head-sample at 1-10% with ParentBasedSampler(TraceIdRatioBasedSampler) and keep error traces via tail sampling in the Collector.');
  }

  // --- Gate 4: exporter protocol fit for the environment ---
  if (plan.environment === 'production' && plan.exporterProtocol === 'otlp-http-json') {
    fail('json-exporter-in-production', 'critical',
      'exporterProtocol is "otlp-http-json" in production: JSON payloads are ~10x larger than protobuf; this exporter is for debugging only.',
      'Use otlp-http-protobuf (default, proxy-friendly) or otlp-grpc (highest throughput) in production.');
  }
  if (plan.environment === 'production' && plan.exporterProtocol === 'console') {
    fail('console-exporter-in-production', 'high',
      'exporterProtocol is "console" in production: spans go to stdout, not to a backend.',
      'ConsoleSpanExporter is for local debugging; point production at an OTLP endpoint.');
  }

  // --- Gate 5: span processor ---
  if (plan.spanProcessor === 'simple' && plan.environment !== 'test') {
    fail('simple-processor-outside-tests', 'high',
      `spanProcessor is "simple" in ${plan.environment}: SimpleSpanProcessor exports synchronously per span and belongs only in tests.`,
      'Use BatchSpanProcessor so spans are batched and exported on a schedule.');
  }
  if (plan.spanProcessor === 'batch' && plan.maxQueueSizeSet !== true) {
    fail('unbounded-batch-queue', 'high',
      'maxQueueSizeSet is not true: with the collector down for hours, an uncapped buffer grows until the service OOMs.',
      'Set BatchSpanProcessor maxQueueSize to a finite value; dropping spans on overflow beats crashing the service.');
  }

  // --- Gate 6: error paths recorded ---
  if (plan.errorPathsRecordException !== true) {
    fail('errors-not-recorded-on-spans', 'medium',
      'errorPathsRecordException is not true: failures produce spans with no exception event and OK status.',
      'In every catch path call span.recordException(err) and setStatus({ code: SpanStatusCode.ERROR }).');
  }

  // --- Gate 7: right instrument for latency/value metrics ---
  if (LATENCY_INSTRUMENTS.includes(plan.latencyInstrument)) {
    if (plan.latencyInstrument === 'counter') {
      fail('counter-used-for-latency', 'high',
        'latencyInstrument is "counter": counters are monotonic sums; they cannot represent a latency distribution.',
        'Record latency with a Histogram -- averages hide tail latency, and counters cannot even give you an average.');
    } else if (plan.latencyInstrument === 'gauge') {
      fail('gauge-used-for-latency', 'medium',
        'latencyInstrument is "gauge": a gauge samples a current value and loses the distribution between observations.',
        'Record latency with a Histogram so p95/p99 are computable in the backend.');
    }
  }

  // --- Gate 8: context across async boundaries ---
  if (plan.crossAsyncBoundaries === true && plan.contextPropagatedAcrossBoundaries !== true) {
    fail('context-dropped-across-async-boundary', 'high',
      'crossAsyncBoundaries is true but contextPropagatedAcrossBoundaries is not: worker_threads and queue consumers will start orphan traces with no parent.',
      'Serialize the W3C traceparent across the message channel and re-establish it with context.with() on the other side; bind detached promises with context.bind().');
  }

  // --- Gate 9: browser fetch instrumentation needs a CORS allowlist ---
  if (plan.browserFetchInstrumentation === true && plan.corsPropagationAllowlistSet !== true) {
    fail('missing-cors-propagation-allowlist', 'medium',
      'browserFetchInstrumentation is true without corsPropagationAllowlistSet: traceparent is a custom header, so preflights fail against your API.',
      'Set propagateTraceHeaderCorsUrls to the API origins that allowlist the traceparent header.');
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still verify end-to-end with one real trace: a request through every service, assembled under one trace ID in the backend.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: opentelemetry_instrumentation_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditOpentelemetryInstrumentation(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`opentelemetry_instrumentation_audit: ${e.message}\n`);
    process.exit(1);
  }
}
