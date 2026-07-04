#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_STATE_KINDS = ['server-state', 'client-state'];
const VALID_KEY_SOURCES = ['typed-factory', 'inline-literals'];
const VALID_INVALIDATION_SCOPES = ['prefix', 'exact', 'none'];
const MIN_SANE_POLL_MS = 5000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a TanStack Query v5 layer plan against tanstack-query-server-state's
 * anti-patterns and Quality Gates. All rules operate on structured
 * enum/boolean/number fields -- no free-text matching.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/query-layer-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditTanstackQuery(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_STATE_KINDS.includes(plan.stateKind)) {
    throw new TypeError(`plan.stateKind must be one of: ${VALID_STATE_KINDS.join(', ')}`);
  }
  if (!VALID_KEY_SOURCES.includes(plan.queryKeySource)) {
    throw new TypeError(`plan.queryKeySource must be one of: ${VALID_KEY_SOURCES.join(', ')}`);
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

  // --- Gate: TanStack Query is for server state only ---
  if (plan.stateKind === 'client-state') {
    fail(
      'query-cache-for-client-state',
      'critical',
      'stateKind is client-state: form drafts, modal flags, and other pure client state gain nothing from a stale-while-revalidate cache and inherit weird invalidation semantics.',
      'Use useState / useReducer / Zustand for client state; reserve TanStack Query for data the server owns.'
    );
  }

  // --- Gate: typed query-key factory, not inline literals ---
  if (plan.queryKeySource === 'inline-literals') {
    fail(
      'inline-query-keys',
      'high',
      'queryKeySource is inline-literals: sprinkled string keys mean typos invalidate nothing and refactors break silently.',
      'Build a typed key factory in one file (all -> lists -> list(filters) -> details -> detail(id)) and import it everywhere.'
    );
  }

  // --- Gate: staleTime set deliberately, not the 0 default ---
  if (plan.staleTimeExplicit !== true) {
    fail(
      'default-stale-time-zero',
      'high',
      'staleTimeExplicit is not true: the v5 default staleTime of 0 makes every mount re-hit the server for data a sibling fetched 50ms ago.',
      "Set staleTime per query family from actual change frequency ('static' for reference data, minutes for profiles, seconds for feeds)."
    );
  }

  // --- Gate: mutations invalidate by prefix (or run the full optimistic flow) ---
  if (plan.hasMutations === true) {
    if (!VALID_INVALIDATION_SCOPES.includes(plan.invalidationScope)) {
      fail(
        'invalidation-scope-unspecified',
        'high',
        `hasMutations is true but invalidationScope is not one of: ${VALID_INVALIDATION_SCOPES.join(', ')}.`,
        'Declare how mutations invalidate the cache so the list/detail divergence gate can be checked.'
      );
    } else if (plan.invalidationScope === 'exact') {
      fail(
        'exact-invalidation-after-mutation',
        'high',
        'invalidationScope is exact: updating only the exact key leaves every list variant showing the stale row.',
        "Invalidate by prefix at the factory's parent level; the cost is one refetch per active observer, not per cached entry."
      );
    } else if (plan.invalidationScope === 'none' && plan.optimisticUpdates !== true) {
      fail(
        'mutation-without-invalidation',
        'high',
        'invalidationScope is none and there is no optimistic-update flow: the mutation succeeds but the UI never reflects it.',
        'Either invalidate via factory prefix in onSettled, or run the full optimistic flow.'
      );
    }
  }

  // --- Gate: optimistic updates run cancel -> snapshot -> write -> rollback -> settle ---
  if (plan.optimisticUpdates === true) {
    if (plan.cancelsInFlightQueriesFirst !== true) {
      fail(
        'optimistic-without-cancel',
        'critical',
        'optimisticUpdates is true but cancelsInFlightQueriesFirst is not: an in-flight GET lands after your setQueryData and overwrites the optimistic value -- the appear/disappear/reappear flicker.',
        'Always `await queryClient.cancelQueries(...)` before writing the optimistic value.'
      );
    }
    if (plan.snapshotsForRollback !== true) {
      fail(
        'optimistic-without-snapshot',
        'critical',
        'optimisticUpdates is true but snapshotsForRollback is not: cache state cannot be reconstructed from mutation variables (server IDs, timestamps, computed fields), so onError has nothing safe to restore.',
        'Snapshot getQueryData in onMutate and return it as context for the onError rollback.'
      );
    }
    if (plan.settledInvalidation !== true) {
      fail(
        'no-settled-invalidation',
        'high',
        'optimisticUpdates is true but settledInvalidation is not: even successful mutations can diverge from server truth (normalization, conflict resolution) without an onSettled invalidate.',
        'Invalidate the affected prefix in onSettled -- it runs on success and failure, unlike onSuccess.'
      );
    }
  }

  // --- Gate: per-request QueryClient on the server ---
  if (plan.ssr === true && plan.queryClientPerRequest !== true) {
    fail(
      'shared-query-client-across-requests',
      'critical',
      'ssr is true but queryClientPerRequest is not: a module-level QueryClient shared across server requests leaks one user\'s data into another\'s response.',
      'Create a fresh QueryClient per request on the server; keep the singleton only on the client.'
    );
  }

  // --- Gate: polling is not a real-time substitute ---
  if (plan.realtimeViaPollingIntervalMs !== undefined) {
    if (typeof plan.realtimeViaPollingIntervalMs !== 'number' || plan.realtimeViaPollingIntervalMs <= 0) {
      fail(
        'invalid-polling-interval',
        'low',
        'realtimeViaPollingIntervalMs must be a positive number when provided.',
        'Report the refetchInterval in milliseconds, or omit the field if not polling.'
      );
    } else if (plan.realtimeViaPollingIntervalMs < MIN_SANE_POLL_MS) {
      fail(
        'polling-for-realtime',
        'medium',
        `realtimeViaPollingIntervalMs is ${plan.realtimeViaPollingIntervalMs} (< ${MIN_SANE_POLL_MS}ms): aggressive refetchInterval burns server budget and still misses events between polls.`,
        'Use SSE/WebSocket for actual real-time; keep polling only as a coarse fallback.'
      );
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still run the Devtools timeline test: one navigation round-trip should show <=1 fetch per query family within its staleTime window.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: tanstack_query_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditTanstackQuery(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`tanstack_query_audit: ${e.message}\n`);
    process.exit(1);
  }
}
