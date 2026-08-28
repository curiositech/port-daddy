/**
 * Executor side of the durable Fleet admission ledger.
 *
 * The relay writes `fleet_run_intents` before queueing.  A consumer consults
 * that row before any GitHub fetch or model call: superseded/terminal messages
 * are acknowledged without spend, while active messages publish attempt and
 * terminal progress.  Every D1 operation is fail-soft so a migration rollout
 * gap can only fall back to the legacy execution path, never drop a required
 * check.
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

/**
 * Decide whether this delivery is current and claim its attempt before spend.
 * The design requires a higher monotonic delivery cursor to resume a running
 * row. Explicit continuation messages restart the platform attempt at one, so
 * the cursor includes both continuation sequence and platform attempt; this
 * prevents concurrent duplicate delivery from entering model work.
 *
 * @param env - Executor bindings, including the shared D1 ledger.
 * @param job - Verified Fleet queue job.
 * @param attemptCursor - Internal monotonic delivery cursor, not a public attempt count.
 * @returns Run, skip, or legacy-rollout behavior for this message.
 */
export async function beginFleetIntentAttempt(
  env: ExecutorEnv,
  job: FleetRunJob,
  attemptCursor: number,
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
    const safeCursor = Number.isInteger(attemptCursor) && attemptCursor > 0
      ? attemptCursor
      : 0;
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
      .bind(safeCursor, now, now, job.deliveryId, safeCursor)
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
 * @param attemptCursor - Internal monotonic delivery cursor, not a public attempt count.
 * @param error - Infrastructure failure recorded for the operator.
 * @returns Completion after the best-effort marker attempt.
 */
export async function markFleetIntentRetrying(
  env: ExecutorEnv,
  job: FleetRunJob,
  attemptCursor: number,
  error: unknown,
): Promise<void> {
  if (!env.DB || !job.deliveryId) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    const safeCursor = Number.isInteger(attemptCursor) && attemptCursor > 0
      ? attemptCursor
      : 0;
    const message = String(error).replace(/\s+/g, ' ').trim().slice(0, 600) || 'unknown error';
    await env.DB
      .prepare(
        `UPDATE fleet_run_intents
           SET state = 'retrying', attempt_count = MAX(attempt_count, ?),
               last_progress_at = ?, last_error = ?
         WHERE delivery_id = ?
           AND state IN ('admitting','queued','running','retrying')`,
      )
      .bind(safeCursor, now, message, job.deliveryId)
      .run();
  } catch (writeError) {
    console.error(
      `[fleet-executor] intent retry marker failed delivery=${job.deliveryId}: ${String(writeError)}`,
    );
  }
}

/**
 * Copy the authoritative fleet_runs conclusion into the logical intent row.
 * The purpose is to keep transcript truth and admission truth convergent.
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
