#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SYMPTOMS = [
  'crashloopbackoff',
  'oomkilled',
  'imagepullbackoff',
  'pending',
  'init-error',
  'no-endpoints',
  'dns-failure',
  'network-blocked',
  'hpa-not-scaling',
  'evictions',
];
const VALID_FIRST_ACTIONS = [
  'describe-pod',
  'logs-previous',
  'logs-current',
  'get-events',
  'check-endpoints',
  'run-debug-pod',
  'exec-into-pod',
  'restart-pod',
  'raise-limits',
];
const VALID_FIX_APPROACHES = ['manifest-change', 'config-change', 'kubectl-exec-hotfix', 'restart-only'];
const VALID_IMAGE_TAGS = ['pinned', 'latest'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Kubernetes triage plan against this runbook's rules: diagnose before
 * you mutate, read the *previous* container's logs on a CrashLoopBackOff, never
 * hotfix a pod with kubectl exec, and the resource/probe hygiene gates.
 * Rules operate on structured/enum/boolean fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/k8s-triage-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditKubernetesDebuggingRunbook(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_SYMPTOMS.includes(plan.symptom)) {
    throw new TypeError(`plan.symptom must be one of: ${VALID_SYMPTOMS.join(', ')}`);
  }
  if (!VALID_FIRST_ACTIONS.includes(plan.firstAction)) {
    throw new TypeError(`plan.firstAction must be one of: ${VALID_FIRST_ACTIONS.join(', ')}`);
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

  // --- Gate 1: mutate-first triage (restart / raise-limits before any diagnosis) ---
  if (plan.firstAction === 'restart-pod' || plan.firstAction === 'raise-limits') {
    fail(
      'mutation-before-diagnosis',
      'high',
      `firstAction is "${plan.firstAction}": mutating before reading describe/events/logs destroys the evidence and usually just reschedules the same failure.`,
      'Start with kubectl describe pod (events at the bottom answer 80% of cases), then logs, then events — mutate only once the cause is named.'
    );
  }

  // --- Gate 2: CrashLoopBackOff must read the PREVIOUS instance's logs ---
  if (plan.symptom === 'crashloopbackoff') {
    if (plan.firstAction === 'logs-current') {
      fail(
        'current-logs-on-crashloop',
        'critical',
        'symptom is crashloopbackoff but firstAction is logs-current: the current container has not crashed yet, so its logs are empty or misleading.',
        'Use kubectl logs POD --previous to read the crashed instance, and check Last State for the exit code.'
      );
    } else if (plan.usedPreviousLogs !== true) {
      fail(
        'previous-logs-not-planned',
        'high',
        'symptom is crashloopbackoff but usedPreviousLogs is not true: without --previous the crash evidence is never read.',
        'Plan kubectl logs POD --previous as a mandatory step of the CrashLoopBackOff playbook.'
      );
    }
  }

  // --- Gate 3: never kubectl-exec a fix into a running pod ---
  if (plan.fixApproach !== undefined && !VALID_FIX_APPROACHES.includes(plan.fixApproach)) {
    fail(
      'invalid-fix-approach',
      'medium',
      `fixApproach "${plan.fixApproach}" is not one of: ${VALID_FIX_APPROACHES.join(', ')}.`,
      'Declare the fix approach so snowflake risk can be audited.'
    );
  } else if (plan.fixApproach === 'kubectl-exec-hotfix') {
    fail(
      'exec-hotfix-snowflake',
      'critical',
      'fixApproach is kubectl-exec-hotfix: pods are ephemeral — the next restart wipes the change and the pod is now an undocumented snowflake.',
      'Reproduce in a transient debug pod (kubectl run --rm) and commit the fix to the manifest.'
    );
  } else if (plan.fixApproach === 'restart-only') {
    fail(
      'restart-only-fix',
      'high',
      'fixApproach is restart-only: restarting without a named root cause masks the failure until it recurs.',
      'Name the root cause from describe/events/logs first; a restart is a mitigation, not a fix.'
    );
  }

  // --- Gate 4: OOMKilled needs both requests AND limits reasoning ---
  if (plan.symptom === 'oomkilled') {
    if (plan.memoryRequestsSet !== true || plan.memoryLimitsSet !== true) {
      fail(
        'incomplete-memory-resources',
        'high',
        `symptom is oomkilled but memoryRequestsSet=${plan.memoryRequestsSet === true} / memoryLimitsSet=${plan.memoryLimitsSet === true}: a limit without requests lets the scheduler overpack the node; no limit makes the pod a noisy neighbor.`,
        'Set requests at or near typical usage (kubectl top pod) and limits at 1.5-2x requests, on every container.'
      );
    }
  }

  // --- Gate 5: liveness must not be the readiness probe ---
  if (plan.livenessSameAsReadiness === true) {
    fail(
      'liveness-conflated-with-readiness',
      'high',
      'livenessSameAsReadiness is true: a slow dependency or GC pause will make liveness kill healthy pods mid-flight.',
      'Liveness checks process aliveness only; readiness checks dependencies. Split the endpoints.'
    );
  }

  // --- Gate 6: HPA needs resource requests to compute utilization ---
  if (plan.symptom === 'hpa-not-scaling' && plan.hpaTargetsHaveRequests !== true) {
    fail(
      'hpa-without-requests',
      'high',
      'symptom is hpa-not-scaling but hpaTargetsHaveRequests is not true: without resources.requests the CPU-percentage HPA target is mathematically undefined (FailedGetResourceMetric).',
      'Set resources.requests on every container the HPA targets, and confirm metrics-server is serving (kubectl top pods).'
    );
  }

  // --- Gate 7: NetworkPolicy denials need a policy audit, not guesswork ---
  if ((plan.symptom === 'network-blocked' || plan.symptom === 'dns-failure') && plan.networkPolicyAudited !== true) {
    fail(
      'netpol-not-audited',
      'medium',
      `symptom is ${plan.symptom} but networkPolicyAudited is not true: NetworkPolicies are deny-by-default once any policy targets a pod — an unaudited default-deny is the usual culprit.`,
      'Run kubectl get netpol -n NS and verify explicit allows for monitoring, ingress controllers, and cross-namespace traffic.'
    );
  }

  // --- Gate 8: production images must be pinned, not :latest ---
  if (plan.imageTag !== undefined && !VALID_IMAGE_TAGS.includes(plan.imageTag)) {
    fail(
      'invalid-image-tag-kind',
      'medium',
      `imageTag "${plan.imageTag}" is not one of: ${VALID_IMAGE_TAGS.join(', ')}.`,
      'Declare whether the deployment pins an immutable tag/digest or floats on latest.'
    );
  } else if (plan.imageTag === 'latest') {
    fail(
      'latest-tag-in-production',
      'medium',
      'imageTag is latest: a floating tag makes ImagePullBackOff and behavior drift unreproducible across nodes and restarts.',
      'Pin to an immutable tag or digest.'
    );
  }

  // --- Gate 9: restart alerting must exist so the fix is verifiable ---
  if (plan.restartAlertingConfigured !== true) {
    fail(
      'no-restart-alerting',
      'low',
      'restartAlertingConfigured is not true: without an alert on kube_pod_container_status_restarts_total, the next regression is found by users.',
      'Add a Prometheus rule on restart counts, with OOMKilled alerting split out separately.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Triage plan follows the runbook: diagnose-then-mutate, --previous logs, manifest-committed fix, and the resource/probe hygiene gates. Verify the diagnosis against captured describe/events output before closing.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: kubernetes_debugging_runbook_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditKubernetesDebuggingRunbook(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`kubernetes_debugging_runbook_audit: ${e.message}\n`);
    process.exit(1);
  }
}
