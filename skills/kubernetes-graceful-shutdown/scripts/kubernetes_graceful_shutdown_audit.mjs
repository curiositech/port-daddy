#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Audit a Kubernetes graceful-shutdown plan against this skill's timing rules:
 * the preStop sleep must exist to cover the EndpointSlice/LB convergence race,
 * the grace-period budget is SHARED between preStop and the post-SIGTERM drain,
 * SIGTERM must actually reach the app (PID 1), and the drain needs a hard
 * ceiling. Rules operate on structured boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/graceful-shutdown-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditKubernetesGracefulShutdown(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!isFiniteNumber(plan.preStopSleepSeconds) || plan.preStopSleepSeconds < 0) {
    throw new TypeError('plan.preStopSleepSeconds must be a non-negative number (0 = no preStop hook)');
  }
  if (!isFiniteNumber(plan.terminationGracePeriodSeconds) || plan.terminationGracePeriodSeconds <= 0) {
    throw new TypeError('plan.terminationGracePeriodSeconds must be a positive number');
  }
  if (!isFiniteNumber(plan.drainBudgetSeconds) || plan.drainBudgetSeconds < 0) {
    throw new TypeError('plan.drainBudgetSeconds must be a non-negative number');
  }
  if (typeof plan.sigtermHandlerRegistered !== 'boolean') {
    throw new TypeError('plan.sigtermHandlerRegistered must be a boolean');
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

  const { preStopSleepSeconds, terminationGracePeriodSeconds, drainBudgetSeconds } = plan;

  // --- Gate 1: a preStop sleep must exist to cover the endpoint-removal race ---
  if (preStopSleepSeconds <= 0) {
    fail(
      'no-prestop-sleep',
      'critical',
      'preStopSleepSeconds is 0: the EndpointSlice controller marks the endpoint terminating before kube-proxy/LB convergence completes, so traffic still arrives after the app starts draining — connection refused during every rolling deploy.',
      'Add a preStop sleep (5s small cluster, 10-15s with a cloud LB, 30s+ for large clusters/slow xDS) so the data plane converges while the app still serves.'
    );
  }

  // --- Gate 2: the grace budget is SHARED: preStop + drain must fit inside it ---
  if (preStopSleepSeconds >= terminationGracePeriodSeconds) {
    fail(
      'prestop-consumes-entire-grace',
      'critical',
      `preStopSleepSeconds (${preStopSleepSeconds}) >= terminationGracePeriodSeconds (${terminationGracePeriodSeconds}): the preStop hook never finishes before the kubelet SIGKILLs straight through — the app gets no SIGTERM window at all.`,
      'Keep preStop well below the grace period: terminationGracePeriodSeconds must exceed preStop sleep + drain budget + margin.'
    );
  } else if (preStopSleepSeconds + drainBudgetSeconds > terminationGracePeriodSeconds) {
    fail(
      'grace-budget-overcommitted',
      'critical',
      `preStopSleepSeconds (${preStopSleepSeconds}) + drainBudgetSeconds (${drainBudgetSeconds}) = ${preStopSleepSeconds + drainBudgetSeconds}s exceeds terminationGracePeriodSeconds (${terminationGracePeriodSeconds}): the budget is shared, so the drain is cut short by SIGKILL and in-flight requests die mid-response.`,
      'Size terminationGracePeriodSeconds = preStop sleep + drain budget + safety margin (e.g. sleep 15 + drain 25 → grace 60).'
    );
  }

  // --- Gate 3: SIGTERM must be handled, and must not be an immediate exit ---
  if (plan.sigtermHandlerRegistered !== true) {
    fail(
      'no-sigterm-handler',
      'critical',
      'sigtermHandlerRegistered is false: the app ignores SIGTERM, hangs until the deadline, and is SIGKILL\'d with in-flight work aborted.',
      'Register a SIGTERM handler that stops accepting connections and drains (server.close() / srv.Shutdown(ctx)).'
    );
  } else if (plan.immediateExitOnSigterm === true) {
    fail(
      'immediate-exit-on-sigterm',
      'high',
      'immediateExitOnSigterm is true: exiting on the first SIGTERM resets every in-flight connection — the kill -9 anti-pattern with extra steps.',
      'Drain first (server.close() / Shutdown(ctx)), then exit; keep a hard deadline shorter than the grace period.'
    );
  }

  // --- Gate 4: SIGTERM must actually REACH the app (PID 1 shell trap) ---
  if (plan.pid1IsApp !== true) {
    fail(
      'shell-is-pid1',
      'high',
      'pid1IsApp is not true: when a shell wrapper (npm start, sh -c) is PID 1 it may not forward SIGTERM, so the handler never fires and the pod rides to SIGKILL.',
      'Run the runtime directly as PID 1 (exec-form CMD ["node","server.js"]) or use tini as the init process.'
    );
  }

  // --- Gate 5: the drain needs a hard ceiling inside the grace period ---
  if (plan.hardDeadlineShorterThanGrace !== true) {
    fail(
      'no-drain-hard-deadline',
      'high',
      'hardDeadlineShorterThanGrace is not true: a stuck request keeps the process alive until the kubelet SIGKILLs it — the app should force-close and exit on its own terms first.',
      'Set an in-app drain ceiling (setTimeout + closeAllConnections / context.WithTimeout + srv.Close) shorter than terminationGracePeriodSeconds.'
    );
  }

  // --- Gate 6: readiness flips on shutdown — as a complement, never a substitute ---
  if (plan.readinessFlipsOnShutdown !== true) {
    fail(
      'readiness-stays-green',
      'medium',
      'readinessFlipsOnShutdown is not true: the readiness probe keeps reporting healthy during the drain, so the endpoint stays eligible longer than it needs to.',
      'Flip /readyz to 503 on SIGTERM — in addition to the preStop sleep, not instead of it.'
    );
  }
  if (plan.readinessFlipReplacesSleep === true) {
    fail(
      'readiness-flip-substituted-for-sleep',
      'high',
      'readinessFlipReplacesSleep is true: the readiness gate only helps the NEXT propagation cycle; it does not cover traffic already routed during the current convergence window.',
      'Keep the preStop sleep; the readiness flip is a complement, not a replacement.'
    );
  }

  // --- Gate 7: background workers must obey the same shutdown signal ---
  if (plan.backgroundWorkersHandleShutdown !== true) {
    fail(
      'workers-ignore-shutdown',
      'medium',
      'backgroundWorkersHandleShutdown is not true: queue consumers and cron loops keep popping jobs after the HTTP server closed, then die mid-task at SIGKILL.',
      'Cancel one shutdown context everywhere — HTTP, queue consumers, cron, DB pools — not just the listener.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Budget math and signal path check out. Still verify empirically: roll a deploy under synthetic traffic and count post-SIGTERM requests in access logs — the target is zero client-visible errors.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: kubernetes_graceful_shutdown_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditKubernetesGracefulShutdown(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`kubernetes_graceful_shutdown_audit: ${e.message}\n`);
    process.exit(1);
  }
}
