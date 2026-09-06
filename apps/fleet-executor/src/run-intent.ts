/**
 * Executor side of the durable Fleet admission ledger.
 *
 * The relay writes `fleet_run_intents` before queueing.  A consumer consults
 * that row before any GitHub fetch or model call: superseded/terminal messages
 * are acknowledged without spend, while active messages publish attempt and
 * terminal progress. Missing rows/D1 errors still enter an explicitly degraded
 * legacy path for rollout compatibility; that mode does not provide
 * single-generation concurrency guarantees.
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';

export type FleetIntentExecutionDecision = 'run' | 'skip' | 'legacy';

interface IntentStateRow {
  state: string;
}

const TERMINAL_OR_SUPERSEDED = new Set([
  'superseded',
  'success',
  'failure',
  'neutral',
  'cancelled',
]);

export class FleetIntentOwnershipError extends Error {
  readonly retryable = true;
  constructor(readonly deliveryId: string, readonly state: string) {
    super(`Fleet intent ${deliveryId} is not the current running generation (state=${state})`);
    this.name = 'FleetIntentOwnershipError';
  }
}

/** Read one intent state without mutating admission ownership. */
export async function readFleetIntentState(
  env: ExecutorEnv,
  deliveryId: string,
): Promise<string | null> {
  if (!env.DB || !deliveryId) return null;
  const row = await env.DB
    .prepare('SELECT state FROM fleet_run_intents WHERE delivery_id = ?')
    .bind(deliveryId)
    .first<IntentStateRow>();
  return row?.state ?? null;
}

/** Atomically claim the right for a DLQ delivery to fail its own GitHub gate. */
export async function claimFleetIntentForDlq(
  env: ExecutorEnv,
  deliveryId: string,
  error: string,
): Promise<boolean> {
  // Degraded installations without the ledger can only fall back to the exact
  // creator-run GitHub receipt. This is not generation-safe and is logged by
  // the DLQ caller. Production D1 normally reports `meta.changes`; adapters
  // without it remain degraded and the caller must not describe that path as
  // generation-safe.
  if (!env.DB || !deliveryId) return true;
  const now = Math.floor(Date.now() / 1000);
  const updated = await env.DB
    .prepare(
      `UPDATE fleet_run_intents
         SET state = 'failure', finished_at = ?, last_progress_at = ?, last_error = ?
       WHERE delivery_id = ?
         AND state IN ('admitting','queued','running','retrying','enqueue_failed')`,
    )
    .bind(now, now, error.slice(0, 600), deliveryId)
    .run();
  return (updated.meta?.changes ?? 1) === 1;
}

/** Strict hot-boundary proof for a delivery already admitted by the ledger. */
export async function assertFleetIntentCurrent(env: ExecutorEnv, job: FleetRunJob): Promise<void> {
  if (!env.DB || !job.deliveryId) {
    throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'authority-unavailable');
  }
  const row = await env.DB
    .prepare('SELECT state FROM fleet_run_intents WHERE delivery_id = ?')
    .bind(job.deliveryId)
    .first<IntentStateRow>();
  if (row?.state !== 'running') {
    throw new FleetIntentOwnershipError(job.deliveryId, row?.state ?? 'missing');
  }
}

/**
 * Decide whether this delivery is current and claim its attempt before spend.
 * The design requires a higher platform attempt to resume a running row, which
 * prevents concurrent duplicate delivery from entering model work.
 *
 * @param env - Executor bindings, including the shared D1 ledger.
 * @param job - Verified Fleet queue job.
 * @param attempt - Cloudflare delivery-attempt counter.
 * @returns Run, skip, or legacy-rollout behavior for this message.
 */
export async function beginFleetIntentAttempt(
  env: ExecutorEnv,
  job: FleetRunJob,
  attempt: number,
): Promise<FleetIntentExecutionDecision> {
  if (!env.DB || !job.deliveryId) return 'legacy';
  try {
    const row = await env.DB
      .prepare('SELECT state FROM fleet_run_intents WHERE delivery_id = ?')
      .bind(job.deliveryId)
      .first<IntentStateRow>();
    if (!row) return 'legacy';
    if (TERMINAL_OR_SUPERSEDED.has(row.state)) return 'skip';
    const now = Math.floor(Date.now() / 1000);
    const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
    const updated = await env.DB
      .prepare(
        `UPDATE fleet_run_intents
           SET state = 'running',
               attempt_count = MAX(attempt_count, ?),
               started_at = COALESCE(started_at, ?),
               last_progress_at = ?,
               finished_at = NULL
         WHERE delivery_id = ?
           AND (
             state IN ('admitting','queued','retrying','enqueue_failed')
             OR (state = 'running' AND attempt_count < ?)
           )`,
      )
      .bind(safeAttempt, now, now, job.deliveryId, safeAttempt)
      .run();
    // A newer generation can supersede this row between SELECT and UPDATE.
    // Treat the conditional write as the authority.  Missing meta is accepted
    // only for legacy/lightweight D1 adapters that do not report changes.
    if ((updated.meta?.changes ?? 1) === 0) return 'skip';
    return 'run';
  } catch (error) {
    console.error(
      `[fleet-executor] intent preflight degraded delivery=${job.deliveryId}: ${String(error)}`,
    );
    return 'legacy';
  }
}

/**
 * Put a thrown infrastructure attempt back into visible retrying state. The
 * design never reopens a terminal or superseded receipt.
 *
 * @param env - Executor bindings, including the shared D1 ledger.
 * @param job - Fleet queue job being retried.
 * @param attempt - Cloudflare delivery-attempt counter.
 * @param error - Infrastructure failure recorded for the operator.
 * @returns Completion after the best-effort marker attempt.
 */
export async function markFleetIntentRetrying(
  env: ExecutorEnv,
  job: FleetRunJob,
  attempt: number,
  error: unknown,
): Promise<void> {
  if (!env.DB || !job.deliveryId) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
    const message = String(error).replace(/\s+/g, ' ').trim().slice(0, 600) || 'unknown error';
    await env.DB
      .prepare(
        `UPDATE fleet_run_intents
           SET state = 'retrying', attempt_count = MAX(attempt_count, ?),
               last_progress_at = ?, last_error = ?
         WHERE delivery_id = ?
           AND state IN ('admitting','queued','running','retrying')`,
      )
      .bind(safeAttempt, now, message, job.deliveryId)
      .run();
  } catch (writeError) {
    console.error(
      `[fleet-executor] intent retry marker failed delivery=${job.deliveryId}: ${String(writeError)}`,
    );
  }
}

/**
 * Copy the mutable fleet_runs conclusion projection into the logical intent
 * row. The GitHub App-owned check receipt remains the verdict authority.
 *
 * @param env - Executor bindings, including the shared D1 ledger.
 * @param job - Completed Fleet queue job.
 * @returns Completion after the best-effort terminal projection.
 */
export async function finishFleetIntentFromRun(
  env: ExecutorEnv,
  job: FleetRunJob,
): Promise<void> {
  if (!env.DB || !job.deliveryId) return;
  try {
    const run = await env.DB
      .prepare('SELECT conclusion FROM fleet_runs WHERE delivery_id = ?')
      .bind(job.deliveryId)
      .first<{ conclusion: string }>();
    const conclusion = run?.conclusion;
    if (!conclusion || conclusion === 'pending') return;
    await markFleetIntentTerminal(env, job.deliveryId, conclusion, null);
  } catch (error) {
    console.error(
      `[fleet-executor] intent completion marker failed delivery=${job.deliveryId}: ${String(error)}`,
    );
  }
}

/**
 * Mark an active delivery terminal, including the DLQ path. The design refuses
 * to overwrite superseded or previously terminal evidence with a late write.
 *
 * @param env - Executor bindings, including the shared D1 ledger.
 * @param deliveryId - Webhook delivery idempotency key.
 * @param conclusion - Allowed terminal Fleet conclusion.
 * @param error - Optional bounded terminal failure detail.
 * @returns Completion after the best-effort terminal marker.
 */
export async function markFleetIntentTerminal(
  env: ExecutorEnv,
  deliveryId: string,
  conclusion: string,
  error: string | null,
): Promise<void> {
  if (!env.DB || !deliveryId) return;
  const terminal = ['success', 'failure', 'neutral', 'cancelled'].includes(conclusion)
    ? conclusion
    : 'failure';
  try {
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(
        `UPDATE fleet_run_intents
           SET state = ?, finished_at = ?, last_progress_at = ?, last_error = ?
         WHERE delivery_id = ?
           AND state IN ('admitting','queued','running','retrying','enqueue_failed')`,
      )
      .bind(terminal, now, now, error?.slice(0, 600) ?? null, deliveryId)
      .run();
  } catch (writeError) {
    console.error(
      `[fleet-executor] intent terminal marker failed delivery=${deliveryId}: ${String(writeError)}`,
    );
  }
}
