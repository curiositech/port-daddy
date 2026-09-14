/**
 * Executor side of the durable Fleet admission ledger.
 *
 * The relay writes `fleet_run_intents` before queueing.  A consumer consults
 * that row before any GitHub fetch or model call: superseded/terminal messages
 * are acknowledged without spend, while active messages publish attempt and
 * terminal progress. Database errors block execution so they cannot bypass a
 * control hold. Missing bindings, missing rows, and adapters that cannot prove
 * their conditional write are unavailable authority, never a legacy permit.
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import { FLEET_WAITING_CONTROL } from '../../shared/fleet-suspension.js';

export type FleetIntentExecutionDecision = 'run' | 'skip';

interface IntentStateRow {
  state: string;
}

interface IntentIdentity {
  deliveryId: string;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  eventType: string;
  action: string;
}

const TERMINAL_OR_SUPERSEDED = new Set([
  FLEET_WAITING_CONTROL,
  'superseded',
  'success',
  'failure',
  'neutral',
  'cancelled',
]);

// A newer delivery keeps fencing an older generation even after it finishes.
// Otherwise a failed Relay supersession projection could let obsolete paid
// work become current again as soon as the replacement reaches a terminal
// state. Only a delivery that never reached the queue, or one already recorded
// as superseded itself, is incapable of owning the newer generation.
const NON_FENCING_GENERATION_STATES = "'enqueue_failed','superseded'";

// Pull-request generations share one scope per PR. Merge-group deliveries do
// not: every distinct queue commit needs its own required check, even when
// another base branch or queue head is admitted later. The exact queue SHA is
// therefore the merge-group scope without introducing a lossy numeric hash.
const newerGenerationScope = (currentAlias: string, newerAlias: string): string => `
           AND (
             ${currentAlias}.event_type <> 'merge_group'
             OR (
               ${newerAlias}.event_type = 'merge_group'
               AND ${newerAlias}.head_sha = ${currentAlias}.head_sha
             )
           )`;

function intentIdentity(job: FleetRunJob): IntentIdentity {
  const pull = job.payloadMinimal?.pull_request as { head?: { sha?: unknown } } | undefined;
  const group = job.payloadMinimal?.merge_group as { head_sha?: unknown } | undefined;
  const headSha = job.eventType === 'merge_group' ? group?.head_sha : pull?.head?.sha;
  const prNumber = job.eventType === 'merge_group' ? 0 : job.prNumber;
  if (!job.deliveryId || !job.repoFullName || !Number.isInteger(prNumber)
      || typeof headSha !== 'string' || !headSha || !job.eventType) {
    throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'identity-unavailable');
  }
  return { deliveryId: job.deliveryId, repoFullName: job.repoFullName,
    prNumber: prNumber as number, headSha, eventType: job.eventType,
    action: job.action ?? '' };
}

async function readCurrentIntent(
  env: ExecutorEnv,
  job: FleetRunJob,
  requireLatestGeneration = true,
): Promise<IntentStateRow | null> {
  if (!env.DB) throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'authority-unavailable');
  const identity = intentIdentity(job);
  const latestGeneration = requireLatestGeneration ? `
       AND NOT EXISTS (
         SELECT 1 FROM fleet_run_intents AS newer
         WHERE newer.repo_full_name = current.repo_full_name
           AND newer.pr_number = current.pr_number
           AND newer.generation > current.generation
           ${newerGenerationScope('current', 'newer')}
           AND newer.state NOT IN (${NON_FENCING_GENERATION_STATES})
       )` : '';
  return env.DB.prepare(
    `SELECT current.state FROM fleet_run_intents AS current
     WHERE current.delivery_id = ? AND current.repo_full_name = ?
       AND current.pr_number = ? AND current.head_sha = ? AND current.event_type = ?
       AND COALESCE(current.action, '') = ?
       ${latestGeneration}`,
  ).bind(identity.deliveryId, identity.repoFullName, identity.prNumber,
    identity.headSha, identity.eventType, identity.action).first<IntentStateRow>();
}

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
  job: FleetRunJob,
): Promise<string | null> {
  const row = await readCurrentIntent(env, job);
  return row?.state ?? null;
}

/** Atomically claim the right for a DLQ delivery to fail its own GitHub gate. */
export async function claimFleetIntentForDlq(
  env: ExecutorEnv,
  job: FleetRunJob,
  error: string,
): Promise<boolean> {
  // No durable row means no proof that this dead letter owns the current
  // generation. Leaving an existing required check unresolved is safer than a
  // stale delivery mutating another generation's receipt.
  if (!env.DB) return false;
  const identity = intentIdentity(job);
  const now = Math.floor(Date.now() / 1000);
  const updated = await env.DB
    .prepare(
      `UPDATE fleet_run_intents
         SET state = 'failure', finished_at = ?, last_progress_at = ?, last_error = ?
       WHERE delivery_id = ? AND repo_full_name = ? AND pr_number = ?
         AND head_sha = ? AND event_type = ? AND COALESCE(action, '') = ?
         AND state IN ('admitting','queued','running','retrying','enqueue_failed')
         AND NOT EXISTS (
           SELECT 1 FROM fleet_run_intents AS newer
           WHERE newer.repo_full_name = fleet_run_intents.repo_full_name
             AND newer.pr_number = fleet_run_intents.pr_number
             AND newer.generation > fleet_run_intents.generation
             ${newerGenerationScope('fleet_run_intents', 'newer')}
             AND newer.state NOT IN (${NON_FENCING_GENERATION_STATES})
         )`,
    )
    .bind(now, now, error.slice(0, 600), identity.deliveryId, identity.repoFullName,
      identity.prNumber, identity.headSha, identity.eventType, identity.action)
    .run();
  return updated.meta?.changes === 1;
}

/** Strict hot-boundary proof for a delivery already admitted by the ledger. */
export async function assertFleetIntentCurrent(env: ExecutorEnv, job: FleetRunJob): Promise<void> {
  const row = await readCurrentIntent(env, job);
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
 * @returns Run or skip for a durably admitted message.
 */
export async function beginFleetIntentAttempt(
  env: ExecutorEnv,
  job: FleetRunJob,
  attempt: number,
): Promise<FleetIntentExecutionDecision> {
  if (!env.DB) throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'authority-unavailable');
  try {
    const identity = intentIdentity(job);
    const row = await readCurrentIntent(env, job, false);
    if (!row) throw new FleetIntentOwnershipError(job.deliveryId, 'missing');
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
           AND repo_full_name = ? AND pr_number = ? AND head_sha = ? AND event_type = ?
           AND COALESCE(action, '') = ?
           AND (
             state IN ('admitting','queued','retrying','enqueue_failed')
             OR (state = 'running' AND attempt_count < ?)
           )
           AND NOT EXISTS (
             SELECT 1 FROM fleet_run_intents AS newer
             WHERE newer.repo_full_name = fleet_run_intents.repo_full_name
               AND newer.pr_number = fleet_run_intents.pr_number
               AND newer.generation > fleet_run_intents.generation
               ${newerGenerationScope('fleet_run_intents', 'newer')}
               AND newer.state NOT IN (${NON_FENCING_GENERATION_STATES})
           )`,
      )
      .bind(safeAttempt, now, now, identity.deliveryId, identity.repoFullName,
        identity.prNumber, identity.headSha, identity.eventType, identity.action, safeAttempt)
      .run();
    // A newer generation can supersede this row between SELECT and UPDATE.
    // Treat the conditional write as the authority. An adapter that cannot
    // report the write count cannot prove ownership and must fail closed.
    if (updated.meta?.changes === 0) return 'skip';
    if (updated.meta?.changes !== 1) {
      throw new FleetIntentOwnershipError(job.deliveryId, 'write-unverified');
    }
    return 'run';
  } catch (error) {
    console.error(
      `[fleet-executor] intent preflight unavailable delivery=${job.deliveryId}: ${String(error)}`,
    );
    // A database outage must not bypass a durable waiting-for-control hold.
    throw error;
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
    const identity = intentIdentity(job);
    const now = Math.floor(Date.now() / 1000);
    const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
    const message = String(error).replace(/\s+/g, ' ').trim().slice(0, 600) || 'unknown error';
    await env.DB
      .prepare(
        `UPDATE fleet_run_intents
           SET state = 'retrying', attempt_count = MAX(attempt_count, ?),
               last_progress_at = ?, last_error = ?
         WHERE delivery_id = ?
           AND repo_full_name = ? AND pr_number = ? AND head_sha = ? AND event_type = ?
           AND COALESCE(action, '') = ?
           AND state = 'running' AND attempt_count = ?
           AND NOT EXISTS (
             SELECT 1 FROM fleet_run_intents AS newer
             WHERE newer.repo_full_name = fleet_run_intents.repo_full_name
               AND newer.pr_number = fleet_run_intents.pr_number
               AND newer.generation > fleet_run_intents.generation
               ${newerGenerationScope('fleet_run_intents', 'newer')}
               AND newer.state NOT IN (${NON_FENCING_GENERATION_STATES})
           )`,
      )
      .bind(safeAttempt, now, message, identity.deliveryId, identity.repoFullName,
        identity.prNumber, identity.headSha, identity.eventType, identity.action, safeAttempt)
      .run();
  } catch (writeError) {
    console.error(
      `[fleet-executor] intent retry marker failed delivery=${job.deliveryId}: ${String(writeError)}`,
    );
  }
}

/** Acknowledged control hold: no automatic retry and no review verdict. */
export async function markFleetIntentWaitingForControl(
  env: ExecutorEnv, job: FleetRunJob, reason: string,
): Promise<void> {
  if (!env.DB || !job.deliveryId) throw new Error('Suspension ledger unavailable');
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE fleet_run_intents SET state = 'waiting_for_control',
       control_wait_count = control_wait_count + 1, last_progress_at = ?, last_error = ?, finished_at = NULL
     WHERE delivery_id = ? AND state = 'running'`,
  ).bind(now, reason.slice(0, 600), job.deliveryId).run();
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
