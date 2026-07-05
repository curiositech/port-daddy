#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_FANOUT = ['taskgroup', 'gather', 'gather-return-exceptions', 'wait', 'manual-create-task', 'none'];
const VALID_OFFLOAD = ['to-thread', 'run-in-executor-thread', 'run-in-executor-process', 'none'];
const VALID_TIMEOUT = ['asyncio-timeout', 'wait-for', 'none'];
const VALID_STATE = ['contextvars', 'thread-local', 'globals', 'none'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Python asyncio concurrency plan against python-asyncio-pitfalls'
 * trap catalog and Quality Gates: no blocking calls on the loop, TaskGroup
 * for cancellation-correct fan-out, version-gated 3.11+ primitives, bounded
 * queues, re-raised CancelledError, timeouts on external calls, startup-time
 * connection pools, and ContextVars for request-scoped state.
 *
 * @param {unknown} plan - parsed JSON, see schemas/python-asyncio-pitfalls-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditPythonAsyncioPitfalls(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (typeof plan.pythonMinor !== 'number' || !Number.isInteger(plan.pythonMinor) || plan.pythonMinor < 0) {
    throw new TypeError('plan.pythonMinor must be a non-negative integer (e.g. 11 for Python 3.11)');
  }
  if (!VALID_FANOUT.includes(plan.fanOutPrimitive)) {
    throw new TypeError(`plan.fanOutPrimitive must be one of: ${VALID_FANOUT.join(', ')}`);
  }
  if (typeof plan.blockingCallsPresent !== 'boolean') {
    throw new TypeError('plan.blockingCallsPresent must be a boolean');
  }
  if (plan.blockingOffload !== undefined && !VALID_OFFLOAD.includes(plan.blockingOffload)) {
    throw new TypeError(`plan.blockingOffload must be one of: ${VALID_OFFLOAD.join(', ')}`);
  }
  if (plan.timeoutPrimitive !== undefined && !VALID_TIMEOUT.includes(plan.timeoutPrimitive)) {
    throw new TypeError(`plan.timeoutPrimitive must be one of: ${VALID_TIMEOUT.join(', ')}`);
  }
  if (plan.requestScopedState !== undefined && !VALID_STATE.includes(plan.requestScopedState)) {
    throw new TypeError(`plan.requestScopedState must be one of: ${VALID_STATE.join(', ')}`);
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

  // Gate 1: a blocking call with no offload freezes the whole loop.
  if (plan.blockingCallsPresent === true && (plan.blockingOffload === undefined || plan.blockingOffload === 'none')) {
    fail(
      'blocking-call-on-loop',
      'critical',
      'blockingCallsPresent is true with blockingOffload none: one sync call freezes every other request on the loop — the number-one asyncio failure.',
      'Offload with asyncio.to_thread (I/O-bound) or loop.run_in_executor with a ProcessPoolExecutor (CPU-bound), or switch to an async library.'
    );
  }

  // Gate 2: sibling cancellation demands TaskGroup, not gather.
  if (plan.siblingCancellationRequired === true && plan.fanOutPrimitive !== 'taskgroup') {
    fail(
      'gather-where-taskgroup-needed',
      'high',
      `siblingCancellationRequired is true but fanOutPrimitive is "${plan.fanOutPrimitive}": gather/wait do not cancel siblings on first failure — they keep running detached.`,
      'Use asyncio.TaskGroup (3.11+): any task failure cancels all siblings and propagates an ExceptionGroup.'
    );
  }

  // Gate 3: 3.11+ primitives on an older interpreter.
  if (plan.fanOutPrimitive === 'taskgroup' && plan.pythonMinor < 11) {
    fail(
      'taskgroup-before-311',
      'critical',
      `fanOutPrimitive is taskgroup but pythonMinor is ${plan.pythonMinor}: asyncio.TaskGroup requires Python 3.11+.`,
      'Upgrade to 3.11+, or fall back to gather(*coros, return_exceptions=True) with manual sibling cancellation.'
    );
  }
  if (plan.timeoutPrimitive === 'asyncio-timeout' && plan.pythonMinor < 11) {
    fail(
      'asyncio-timeout-before-311',
      'high',
      `timeoutPrimitive is asyncio-timeout but pythonMinor is ${plan.pythonMinor}: asyncio.timeout() requires Python 3.11+.`,
      'Use asyncio.wait_for on older interpreters (and mind its double-cancel interaction).'
    );
  }

  // Gate 4: bare gather without return_exceptions leaves detached siblings.
  if (plan.fanOutPrimitive === 'gather') {
    fail(
      'bare-gather-fanout',
      'medium',
      'fanOutPrimitive is gather without return_exceptions: the first exception propagates while siblings keep running detached.',
      'Prefer TaskGroup; if gather is required, pass return_exceptions=True and handle results manually.'
    );
  }

  // Gate 5: sync queue in async code blocks the loop.
  if (plan.usesSyncQueue === true) {
    fail(
      'sync-queue-in-async-code',
      'critical',
      'usesSyncQueue is true: queue.Queue.get()/put() block the event loop; this is a sync primitive in an async world.',
      'Use asyncio.Queue (with maxsize) inside the loop; use queue.Queue only across real threads.'
    );
  }

  // Gate 6: unbounded asyncio.Queue has no backpressure.
  if (plan.usesQueue === true && plan.queueBounded !== true) {
    fail(
      'unbounded-queue',
      'medium',
      'usesQueue is true but queueBounded is not: a fast producer grows the queue until OOM.',
      'Set asyncio.Queue(maxsize=...) so the producer awaits put() and naturally backs off.'
    );
  }

  // Gate 7: CancelledError must be re-raised.
  if (plan.cancelledErrorReRaised !== true) {
    fail(
      'cancellederror-swallowed',
      'high',
      'cancelledErrorReRaised is not true: swallowing CancelledError is the classic source of "Task was destroyed but it is pending" at shutdown.',
      'Catch CancelledError only to clean up, then re-raise; use try/finally for cleanup that must always run.'
    );
  }

  // Gate 8: every external call gets a timeout.
  if (plan.externalCallsHaveTimeouts !== true) {
    fail(
      'external-calls-without-timeouts',
      'high',
      'externalCallsHaveTimeouts is not true: an awaited external call with no timeout hangs the task forever on a dead peer.',
      'Wrap every external call in asyncio.timeout(...) (3.11+) or asyncio.wait_for.'
    );
  }

  // Gate 9: connection pools belong at startup.
  if (plan.connectionPoolsAtStartup !== true) {
    fail(
      'per-request-connection-pools',
      'medium',
      'connectionPoolsAtStartup is not true: constructing httpx.AsyncClient/asyncpg pools per request pays connection setup on the hot path.',
      'Construct pools once at app startup and share them across requests.'
    );
  }

  // Gate 10: request-scoped state must be ContextVars.
  if (plan.requestScopedState === 'thread-local') {
    fail(
      'thread-local-request-state',
      'high',
      'requestScopedState is thread-local: threading.local does not follow tasks — many tasks share one thread, so state bleeds across requests.',
      'Use contextvars.ContextVar; spawned tasks inherit values automatically.'
    );
  } else if (plan.requestScopedState === 'globals') {
    fail(
      'global-request-state',
      'medium',
      'requestScopedState is globals: module-level mutable state is shared by every concurrent request.',
      'Move request-scoped data into contextvars.ContextVar.'
    );
  }

  // Gate 11: debug mode in dev catches slow callbacks early.
  if (plan.debugModeInDev !== true) {
    fail(
      'no-debug-mode-in-dev',
      'low',
      'debugModeInDev is not true: without loop.set_debug(True)/PYTHONASYNCIODEBUG=1 in dev, blocking-call regressions ship silently.',
      'Enable debug mode in dev and set loop.slow_callback_duration alerts (>100ms) in prod.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Design clears every quality gate this skill checks. Still verify under load with loop.set_debug(True) — the catalog exists because these traps hide until concurrency is real.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: python_asyncio_pitfalls_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditPythonAsyncioPitfalls(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`python_asyncio_pitfalls_audit: ${e.message}\n`);
    process.exit(1);
  }
}
