#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SYMPTOMS = ['high-cpu', 'memory-leak', 'allocation-churn', 'goroutine-leak', 'latency-spikes', 'lock-contention'];
const VALID_PROFILE_TYPES = ['cpu', 'heap-inuse', 'heap-alloc', 'goroutine', 'block', 'mutex', 'trace'];
const VALID_BIND = ['localhost', 'private-interface', 'public'];
const VALID_ENVIRONMENTS = ['dev', 'staging', 'production'];

// The symptom -> profile-type map from this skill: CPU profile says where time
// goes, heap profile says where allocations happen, trace says when things
// happen, goroutine dump says what is stuck, mutex/block say what is contended.
const SYMPTOM_PROFILES = {
  'high-cpu': ['cpu'],
  'memory-leak': ['heap-inuse'],
  'allocation-churn': ['heap-alloc'],
  'goroutine-leak': ['goroutine'],
  'latency-spikes': ['trace'],
  'lock-contention': ['mutex', 'block'],
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Go profiling plan against go-pprof-profiling's core rules: match
 * the profile type to the symptom, profile under representative load, never
 * expose pprof publicly, inuse vs alloc for leaks vs churn, sane sampling
 * rates in production, and GOMEMLIMIT in containers. All rules operate on
 * structured enum/boolean/number fields -- see
 * schemas/go-pprof-profiling-plan.schema.json.
 *
 * @param {unknown} plan
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditGoPprofProfiling(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_SYMPTOMS.includes(plan.symptom)) {
    throw new TypeError(`plan.symptom must be one of: ${VALID_SYMPTOMS.join(', ')}`);
  }
  if (!VALID_PROFILE_TYPES.includes(plan.profileType)) {
    throw new TypeError(`plan.profileType must be one of: ${VALID_PROFILE_TYPES.join(', ')}`);
  }
  if (typeof plan.underRepresentativeLoad !== 'boolean') {
    throw new TypeError('plan.underRepresentativeLoad must be a boolean');
  }
  if (!VALID_BIND.includes(plan.pprofBindAddress)) {
    throw new TypeError(`plan.pprofBindAddress must be one of: ${VALID_BIND.join(', ')}`);
  }
  if (plan.environment !== undefined && !VALID_ENVIRONMENTS.includes(plan.environment)) {
    throw new TypeError(`plan.environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
  }

  const { symptom, profileType } = plan;
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

  // --- Gate: profile type matched to the symptom ---
  const expected = SYMPTOM_PROFILES[symptom];
  if (!expected.includes(profileType)) {
    if (symptom === 'memory-leak' && profileType === 'heap-alloc') {
      fail(
        'alloc-space-for-a-leak',
        'high',
        'symptom is memory-leak but profileType is heap-alloc: alloc_space counts total bytes ever allocated (churn), not current residency, so allocate-then-free noise buries the leak.',
        'Use the inuse_space heap profile (the default) to find what is still resident; reserve alloc_space for GC-pressure hunts.'
      );
    } else if (symptom === 'allocation-churn' && profileType === 'heap-inuse') {
      fail(
        'inuse-space-for-churn',
        'high',
        'symptom is allocation-churn but profileType is heap-inuse: objects that are allocated and freed never show in inuse_space, so the GC pressure source stays invisible.',
        'Use go tool pprof -alloc_space to see total allocation volume since process start.'
      );
    } else {
      fail(
        'profile-mismatched-to-symptom',
        'high',
        `profileType "${profileType}" does not answer symptom "${symptom}". Expected one of: ${expected.join(', ')}.`,
        'Match the profile to the question: cpu=where time goes, heap=where allocations live, goroutine=what is stuck, trace=when things happen, mutex/block=what is contended.'
      );
    }
  }

  // --- Gate: profile under representative load, not startup/idle ---
  if (plan.underRepresentativeLoad !== true) {
    fail(
      'profiling-without-representative-load',
      'critical',
      'underRepresentativeLoad is not true: a profile captured at startup or with no traffic shows initialization code, not the hot path.',
      'Run a load test (or capture during peak) for the full ?seconds=N window before trusting the profile.'
    );
  }

  // --- Gate: never expose pprof publicly ---
  if (plan.pprofBindAddress === 'public') {
    fail(
      'pprof-exposed-publicly',
      'critical',
      'pprofBindAddress is "public": /debug/pprof leaks stack traces and heap contents, and the CPU-profile endpoint is a DoS vector.',
      'Bind the pprof mux to localhost or a private interface; require auth on any proxy that exposes it.'
    );
  }

  // --- Gate: block/mutex sample rate 1 is for staging, not production ---
  if (
    plan.environment === 'production' &&
    (profileType === 'block' || profileType === 'mutex') &&
    typeof plan.blockMutexSampleRate === 'number' &&
    plan.blockMutexSampleRate === 1
  ) {
    fail(
      'full-sampling-in-production',
      'high',
      'blockMutexSampleRate is 1 in production: sampling every blocking/contention event adds measurable overhead to every lock operation.',
      'Set SetBlockProfileRate/SetMutexProfileFraction to ~100 in production; reserve rate 1 for dev/staging.'
    );
  }

  // --- Gate: GOMEMLIMIT in containers ---
  if (plan.runsInContainer === true && plan.gomemlimitSet !== true) {
    fail(
      'container-without-gomemlimit',
      'medium',
      'runsInContainer is true but gomemlimitSet is not: the GC does not know about the cgroup limit, so the kernel OOMKills the process instead of the GC working harder.',
      'Set GOMEMLIMIT (or debug.SetMemoryLimit) to just under the container memory limit.'
    );
  }

  // --- Gate: read CPU profiles cumulatively, not by leaf self-time ---
  if (profileType === 'cpu' && plan.usedCumulativeView === false) {
    fail(
      'cpu-profile-read-without-cum',
      'medium',
      'usedCumulativeView is false for a CPU profile: plain top is dominated by leaf runtime functions (mallocgc, schedule), hiding your own hot path.',
      'Use top -cum or the flamegraph view (go tool pprof -http=:8080) to see cumulative time by call tree.'
    );
  }

  // --- Gate: goroutine-leak plans need a cancellation story ---
  if (symptom === 'goroutine-leak' && plan.contextCancellationPropagated === false) {
    fail(
      'no-cancellation-propagation',
      'high',
      'contextCancellationPropagated is false: goroutines blocked in chan receive/select with no ctx.Done() case can never be reclaimed, so the leak recurs after every fix.',
      'Pass a context.Context into every spawned goroutine and select on ctx.Done() so cancellation propagates.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still confirm the diagnosis against a captured artifact (pprof top -cum output, goroutine dump counts, trace timeline) before shipping the fix.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: go_pprof_profiling_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditGoPprofProfiling(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`go_pprof_profiling_audit: ${e.message}\n`);
    process.exit(1);
  }
}
