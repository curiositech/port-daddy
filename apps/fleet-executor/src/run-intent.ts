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
export type FleetIntentWorkDecision =
  | { kind: 'run' }
  | { kind: 'repair-continuation'; sequence: number }
  | { kind: 'skip' };
export type FleetIntentDlqClaim =
  | { kind: 'claimed'; attempt: number }
  | { kind: 'skip'; reason: 'terminal' | 'superseded' | 'control-waiting' | 'continuation-stale' };

interface IntentStateRow {
  state: string;
  attempt_count: number;
  control_waiting_at: number | null;
  last_error: string | null;
  continuation_sequence: number;
  pending_continuation_sequence: number | null;
  pending_continuation_at: number | null;
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

// Before the structured marker existed, suspended attempts were left in raw
// `retrying` state with this bounded error prefix. Continue recognizing those
// rows as holds without rewriting history during the additive migration.
const LEGACY_CONTROL_WAIT_PREFIX = 'Fleet suspended:';

function isControlWaiting(row: IntentStateRow): boolean {
  return row.control_waiting_at != null
    || (row.state === 'retrying' && row.last_error?.startsWith(LEGACY_CONTROL_WAIT_PREFIX) === true);
}

function activeContinuationSequence(row: IntentStateRow): number {
  return Number.isSafeInteger(row.continuation_sequence) ? row.continuation_sequence : 0;
}

function pendingContinuationSequence(row: IntentStateRow): number | null {
  return Number.isSafeInteger(row.pending_continuation_sequence)
    ? row.pending_continuation_sequence
    : null;
}

function messageContinuationSequence(job: FleetRunJob): number {
  if (job.continuationSequence === undefined) return 0;
  if (Number.isSafeInteger(job.continuationSequence)
      && (job.continuationSequence ?? 0) > 0
      && (job.continuationSequence ?? 0) < 10_000) {
    return job.continuationSequence as number;
  }
  throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'continuation-sequence-invalid');
}

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
    `SELECT current.state, current.attempt_count, current.control_waiting_at, current.last_error,
            current.continuation_sequence, current.pending_continuation_sequence,
            current.pending_continuation_at
       FROM fleet_run_intents AS current
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
  if (row && isControlWaiting(row)) {
    return FLEET_WAITING_CONTROL;
  }
  return row?.state ?? null;
}

/** Atomically claim the right for a DLQ delivery to fail its own GitHub gate. */
export async function claimFleetIntentForDlq(
  env: ExecutorEnv,
  job: FleetRunJob,
  error: string,
): Promise<FleetIntentDlqClaim> {
  if (!env.DB) {
    throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'authority-unavailable');
  }
  const identity = intentIdentity(job);
  const exact = await readCurrentIntent(env, job, false);
  if (!exact) throw new FleetIntentOwnershipError(job.deliveryId, 'missing');
  if (isControlWaiting(exact)) return { kind: 'skip', reason: 'control-waiting' };
  if (TERMINAL_OR_SUPERSEDED.has(exact.state)) {
    return { kind: 'skip', reason: exact.state === 'superseded' ? 'superseded' : 'terminal' };
  }
  const messageSequence = messageContinuationSequence(job);
  const exactPending = pendingContinuationSequence(exact);
  const exactSequence = exactPending ?? activeContinuationSequence(exact);
  if (exactSequence !== messageSequence) {
    return { kind: 'skip', reason: 'continuation-stale' };
  }
  const current = await readCurrentIntent(env, job);
  if (!current) return { kind: 'skip', reason: 'superseded' };
  const claimedAttempt = current.attempt_count + 1;
  const now = Math.floor(Date.now() / 1000);
  const updated = await env.DB
    .prepare(
      `UPDATE fleet_run_intents
         SET state = 'running', attempt_count = ?, continuation_sequence = ?, finished_at = NULL,
             pending_continuation_sequence = NULL, pending_continuation_at = NULL,
             last_progress_at = ?, last_error = ?
       WHERE delivery_id = ? AND repo_full_name = ? AND pr_number = ?
         AND head_sha = ? AND event_type = ? AND COALESCE(action, '') = ?
         AND attempt_count = ?
         AND control_waiting_at IS NULL
         AND (
           (pending_continuation_sequence IS NULL AND continuation_sequence = ?)
           OR (pending_continuation_sequence = ? AND continuation_sequence = ?)
         )
         AND NOT (state = 'retrying' AND last_error LIKE 'Fleet suspended:%')
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
    .bind(claimedAttempt, messageSequence, now, error.slice(0, 600),
      identity.deliveryId, identity.repoFullName,
      identity.prNumber, identity.headSha, identity.eventType, identity.action,
      current.attempt_count, messageSequence, messageSequence, messageSequence - 1)
    .run();
  if (updated.meta?.changes === 1) return { kind: 'claimed', attempt: claimedAttempt };
  if (typeof updated.meta?.changes !== 'number') {
    throw new FleetIntentOwnershipError(job.deliveryId, 'write-unverified');
  }
  const afterExact = await readCurrentIntent(env, job, false);
  if (!afterExact) throw new FleetIntentOwnershipError(job.deliveryId, 'missing-after-claim');
  if (isControlWaiting(afterExact)) return { kind: 'skip', reason: 'control-waiting' };
  if (TERMINAL_OR_SUPERSEDED.has(afterExact.state)) {
    return { kind: 'skip', reason: afterExact.state === 'superseded' ? 'superseded' : 'terminal' };
  }
  const afterPending = pendingContinuationSequence(afterExact);
  if ((afterPending ?? activeContinuationSequence(afterExact)) !== messageSequence) {
    return { kind: 'skip', reason: 'continuation-stale' };
  }
  if (!await readCurrentIntent(env, job)) return { kind: 'skip', reason: 'superseded' };
  throw new FleetIntentOwnershipError(job.deliveryId, 'claim-raced');
}

/** Strict hot-boundary proof for one exact delivery attempt already admitted by the ledger. */
export async function assertFleetIntentCurrent(
  env: ExecutorEnv,
  job: FleetRunJob,
  expectedAttempt: number,
): Promise<void> {
  const row = await readCurrentIntent(env, job);
  const expectedSequence = Number.isSafeInteger(job.continuationSequence)
    ? Number(job.continuationSequence)
    : 0;
  if (row?.state !== 'running' || isControlWaiting(row) || row.attempt_count !== expectedAttempt
      || pendingContinuationSequence(row) != null
      || activeContinuationSequence(row) !== expectedSequence) {
    const state = row == null
      ? 'missing'
      : isControlWaiting(row)
        ? FLEET_WAITING_CONTROL
        : row.state !== 'running'
        ? row.state
        : row.attempt_count !== expectedAttempt
          ? `attempt-fenced:${row.attempt_count}`
          : pendingContinuationSequence(row) != null
            ? `continuation-pending:${pendingContinuationSequence(row)}`
            : `continuation-fenced:${activeContinuationSequence(row)}`;
    throw new FleetIntentOwnershipError(job.deliveryId, state);
  }
}

/**
 * Claim either ordinary work, the exact explicit successor of a durable
 * continuation permit, or the right to repair-send that successor. The permit
 * is state, not a lease: retries of the predecessor never reopen ship work.
 */
export async function claimFleetIntentWork(
  env: ExecutorEnv,
  job: FleetRunJob,
  expectedAttempt: number,
  explicitContinuation: number | null,
): Promise<FleetIntentWorkDecision> {
  if (!env.DB) {
    throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'authority-unavailable');
  }
  const identity = intentIdentity(job);
  const row = await readCurrentIntent(env, job, false);
  if (!row) throw new FleetIntentOwnershipError(job.deliveryId, 'missing');
  if (isControlWaiting(row) || TERMINAL_OR_SUPERSEDED.has(row.state)) return { kind: 'skip' };

  if (explicitContinuation == null) {
    const pending = pendingContinuationSequence(row);
    if (pending != null) {
      const latest = await readCurrentIntent(env, job);
      const latestPending = latest == null ? null : pendingContinuationSequence(latest);
      return latest != null && latestPending != null
        ? { kind: 'repair-continuation', sequence: latestPending }
        : { kind: 'skip' };
    }
    const decision = await beginFleetIntentAttempt(env, job, expectedAttempt);
    if (decision === 'run') return { kind: 'run' };
    // A concurrent predecessor may have installed the permit after our read
    // but before the ordinary-attempt CAS. Re-read so this retry repairs the
    // handoff rather than acknowledging the only remaining queue delivery.
    const after = await readCurrentIntent(env, job);
    const afterPending = after == null ? null : pendingContinuationSequence(after);
    return after != null && afterPending != null && !isControlWaiting(after)
      ? { kind: 'repair-continuation', sequence: afterPending }
      : { kind: 'skip' };
  }

  const safeAttempt = Number.isSafeInteger(expectedAttempt) && expectedAttempt > 0
    ? expectedAttempt
    : 0;
  const now = Math.floor(Date.now() / 1000);
  const claimed = await env.DB.prepare(
    `UPDATE fleet_run_intents
       SET state = 'running', attempt_count = ?, continuation_sequence = ?,
           pending_continuation_sequence = NULL, pending_continuation_at = NULL,
           started_at = COALESCE(started_at, ?), last_progress_at = ?,
           finished_at = NULL, last_error = NULL
     WHERE delivery_id = ? AND repo_full_name = ? AND pr_number = ?
       AND head_sha = ? AND event_type = ? AND COALESCE(action, '') = ?
       AND control_waiting_at IS NULL
       AND (
         (state IN ('retrying','admitting','queued')
           AND pending_continuation_sequence = ? AND continuation_sequence = ?)
         OR (state IN ('admitting','queued')
           AND pending_continuation_sequence IS NULL AND continuation_sequence = ?)
       )
       AND attempt_count < ?
       AND NOT EXISTS (
         SELECT 1 FROM fleet_run_intents AS newer
         WHERE newer.repo_full_name = fleet_run_intents.repo_full_name
           AND newer.pr_number = fleet_run_intents.pr_number
           AND newer.generation > fleet_run_intents.generation
           ${newerGenerationScope('fleet_run_intents', 'newer')}
           AND newer.state NOT IN (${NON_FENCING_GENERATION_STATES})
       )`,
  ).bind(safeAttempt, explicitContinuation, now, now, identity.deliveryId,
    identity.repoFullName, identity.prNumber, identity.headSha, identity.eventType,
    identity.action, explicitContinuation, explicitContinuation - 1,
    explicitContinuation, safeAttempt).run();
  if (claimed.meta?.changes === 1) return { kind: 'run' };
  if (typeof claimed.meta?.changes !== 'number') {
    throw new FleetIntentOwnershipError(job.deliveryId, 'continuation-claim-unverified');
  }

  // Once an explicit successor owns the row, only a strictly higher platform
  // retry of that same successor may recover a thrown infrastructure failure.
  const current = await readCurrentIntent(env, job);
  if (current?.state === 'retrying' && !isControlWaiting(current)
      && pendingContinuationSequence(current) == null
      && activeContinuationSequence(current) === explicitContinuation
      && current.attempt_count < safeAttempt) {
    const retry = await beginFleetIntentAttempt(env, job, safeAttempt);
    return retry === 'run' ? { kind: 'run' } : { kind: 'skip' };
  }
  return { kind: 'skip' };
}

/** CAS an exact running predecessor into one durable successor permit. */
export async function prepareFleetIntentContinuation(
  env: ExecutorEnv,
  job: FleetRunJob,
  expectedAttempt: number,
  nextSequence: number,
): Promise<void> {
  if (!env.DB) {
    throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'authority-unavailable');
  }
  const identity = intentIdentity(job);
  const currentSequence = Number.isSafeInteger(job.continuationSequence)
    ? Number(job.continuationSequence)
    : 0;
  if (!Number.isSafeInteger(nextSequence) || nextSequence <= 0 || nextSequence >= 10_000
      || nextSequence !== currentSequence + 1) {
    throw new FleetIntentOwnershipError(job.deliveryId, 'continuation-sequence-invalid');
  }
  const now = Math.floor(Date.now() / 1000);
  const updated = await env.DB.prepare(
    `UPDATE fleet_run_intents
       SET state = 'retrying', pending_continuation_sequence = ?,
           pending_continuation_at = ?, last_progress_at = ?,
           last_error = ?
     WHERE delivery_id = ? AND repo_full_name = ? AND pr_number = ?
       AND head_sha = ? AND event_type = ? AND COALESCE(action, '') = ?
       AND state = 'running' AND attempt_count = ?
       AND continuation_sequence = ? AND pending_continuation_sequence IS NULL
       AND control_waiting_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM fleet_run_intents AS newer
         WHERE newer.repo_full_name = fleet_run_intents.repo_full_name
           AND newer.pr_number = fleet_run_intents.pr_number
           AND newer.generation > fleet_run_intents.generation
           ${newerGenerationScope('fleet_run_intents', 'newer')}
           AND newer.state NOT IN (${NON_FENCING_GENERATION_STATES})
       )`,
  ).bind(nextSequence, now, now, `Continuation ${nextSequence} pending queue handoff`,
    identity.deliveryId, identity.repoFullName, identity.prNumber, identity.headSha,
    identity.eventType, identity.action, expectedAttempt, currentSequence).run();
  if (updated.meta?.changes !== 1) {
    throw new FleetIntentOwnershipError(job.deliveryId, 'continuation-permit-write-fenced');
  }
}

/** Prove that an exact pending permit still authorizes only its queue send. */
export async function assertFleetContinuationPending(
  env: ExecutorEnv,
  job: FleetRunJob,
  sequence: number,
): Promise<void> {
  const row = await readCurrentIntent(env, job);
  if (!row || row.state !== 'retrying' || isControlWaiting(row)
      || pendingContinuationSequence(row) !== sequence
      || activeContinuationSequence(row) !== sequence - 1) {
    throw new FleetIntentOwnershipError(
      job.deliveryId,
      row == null || pendingContinuationSequence(row) == null
        ? row?.state ?? 'missing'
        : `continuation-pending:${pendingContinuationSequence(row)}`,
    );
  }
}

/** Convert a pending handoff into the same durable fail-closed control hold. */
export async function holdFleetContinuationForControl(
  env: ExecutorEnv,
  job: FleetRunJob,
  sequence: number,
  reason: string,
): Promise<void> {
  if (!env.DB) {
    throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'authority-unavailable');
  }
  const identity = intentIdentity(job);
  const now = Math.floor(Date.now() / 1000);
  const updated = await env.DB.prepare(
    `UPDATE fleet_run_intents
       SET state = 'cancelled', control_waiting_at = ?,
           control_wait_count = control_wait_count + 1, requeue_revision = NULL,
           last_progress_at = ?, last_error = ?, finished_at = NULL
     WHERE delivery_id = ? AND repo_full_name = ? AND pr_number = ?
       AND head_sha = ? AND event_type = ? AND COALESCE(action, '') = ?
       AND state = 'retrying' AND control_waiting_at IS NULL
       AND pending_continuation_sequence = ? AND continuation_sequence = ?
       AND NOT EXISTS (
         SELECT 1 FROM fleet_run_intents AS newer
         WHERE newer.repo_full_name = fleet_run_intents.repo_full_name
           AND newer.pr_number = fleet_run_intents.pr_number
           AND newer.generation > fleet_run_intents.generation
           ${newerGenerationScope('fleet_run_intents', 'newer')}
           AND newer.state NOT IN (${NON_FENCING_GENERATION_STATES})
       )`,
  ).bind(now, now, reason.slice(0, 600), identity.deliveryId, identity.repoFullName,
    identity.prNumber, identity.headSha, identity.eventType, identity.action,
    sequence, sequence - 1).run();
  if (updated.meta?.changes !== 1) {
    throw new FleetIntentOwnershipError(job.deliveryId, 'continuation-control-hold-fenced');
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
    if (isControlWaiting(row) || TERMINAL_OR_SUPERSEDED.has(row.state)) return 'skip';
    const now = Math.floor(Date.now() / 1000);
    const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
    const expectedSequence = Number.isSafeInteger(job.continuationSequence)
      ? Number(job.continuationSequence)
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
           AND repo_full_name = ? AND pr_number = ? AND head_sha = ? AND event_type = ?
           AND COALESCE(action, '') = ?
           AND control_waiting_at IS NULL
           AND pending_continuation_sequence IS NULL
           AND continuation_sequence = ?
           AND NOT (state = 'retrying' AND last_error LIKE 'Fleet suspended:%')
           AND (
             state IN ('admitting','queued','enqueue_failed')
             OR (state IN ('running','retrying') AND attempt_count < ?)
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
        identity.prNumber, identity.headSha, identity.eventType, identity.action,
        expectedSequence, safeAttempt)
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
           AND state = 'running' AND attempt_count = ? AND control_waiting_at IS NULL
           AND pending_continuation_sequence IS NULL
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
  env: ExecutorEnv,
  job: FleetRunJob,
  expectedAttempt: number,
  reason: string,
): Promise<void> {
  if (!env.DB || !job.deliveryId) throw new Error('Suspension ledger unavailable');
  const identity = intentIdentity(job);
  const now = Math.floor(Date.now() / 1000);
  const updated = await env.DB.prepare(
    `UPDATE fleet_run_intents SET state = 'cancelled', control_waiting_at = ?,
       control_wait_count = control_wait_count + 1, requeue_revision = NULL,
       last_progress_at = ?, last_error = ?, finished_at = NULL
     WHERE delivery_id = ? AND repo_full_name = ? AND pr_number = ?
       AND head_sha = ? AND event_type = ? AND COALESCE(action, '') = ?
       AND state = 'running' AND attempt_count = ? AND control_waiting_at IS NULL
       AND pending_continuation_sequence IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM fleet_run_intents AS newer
         WHERE newer.repo_full_name = fleet_run_intents.repo_full_name
           AND newer.pr_number = fleet_run_intents.pr_number
           AND newer.generation > fleet_run_intents.generation
           ${newerGenerationScope('fleet_run_intents', 'newer')}
           AND newer.state NOT IN (${NON_FENCING_GENERATION_STATES})
       )`,
  ).bind(now, now, reason.slice(0, 600), identity.deliveryId, identity.repoFullName,
    identity.prNumber, identity.headSha, identity.eventType, identity.action, expectedAttempt).run();
  if (updated.meta?.changes !== 1) {
    throw new FleetIntentOwnershipError(job.deliveryId, 'waiting-for-control-write-fenced');
  }
}

/**
 * Copy the mutable fleet_runs conclusion projection into the logical intent
 * row. The GitHub App-owned check receipt remains the verdict authority.
 *
 * @param env - Executor bindings, including the shared D1 ledger.
 * @param job - Completed Fleet queue job.
 * @param expectedAttempt - Exact durable attempt cursor that owns the transition.
 * @returns Completion after the fenced terminal projection.
 */
export async function finishFleetIntentFromRun(
  env: ExecutorEnv,
  job: FleetRunJob,
  expectedAttempt: number,
): Promise<void> {
  if (!env.DB || !job.deliveryId) {
    throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'authority-unavailable');
  }
  try {
    const run = await env.DB
      .prepare('SELECT conclusion FROM fleet_runs WHERE delivery_id = ?')
      .bind(job.deliveryId)
      .first<{ conclusion: string }>();
    const conclusion = run?.conclusion;
    if (!conclusion || conclusion === 'pending') {
      throw new FleetIntentOwnershipError(job.deliveryId, 'terminal-conclusion-unavailable');
    }
    await markFleetIntentTerminal(env, job, expectedAttempt, conclusion, null);
  } catch (error) {
    console.error(
      `[fleet-executor] intent completion marker failed delivery=${job.deliveryId}: ${String(error)}`,
    );
    throw error;
  }
}

/**
 * Mark an active delivery terminal, including the DLQ path. The design refuses
 * to overwrite superseded or previously terminal evidence with a late write.
 *
 * @param env - Executor bindings, including the shared D1 ledger.
 * @param job - Delivery identity whose current attempt owns the transition.
 * @param expectedAttempt - Exact durable attempt cursor that must still own the row.
 * @param conclusion - Allowed terminal Fleet conclusion.
 * @param error - Optional bounded terminal failure detail.
 * @returns Completion after the fenced terminal marker.
 */
export async function markFleetIntentTerminal(
  env: ExecutorEnv,
  job: FleetRunJob,
  expectedAttempt: number,
  conclusion: string,
  error: string | null,
): Promise<void> {
  if (!env.DB || !job.deliveryId) {
    throw new FleetIntentOwnershipError(job.deliveryId ?? '<missing>', 'authority-unavailable');
  }
  const identity = intentIdentity(job);
  const terminal = ['success', 'failure', 'neutral', 'cancelled'].includes(conclusion)
    ? conclusion
    : 'failure';
  const now = Math.floor(Date.now() / 1000);
  const updated = await env.DB
    .prepare(
      `UPDATE fleet_run_intents
         SET state = ?, control_waiting_at = NULL,
             finished_at = ?, last_progress_at = ?, last_error = ?
       WHERE delivery_id = ? AND repo_full_name = ? AND pr_number = ?
         AND head_sha = ? AND event_type = ? AND COALESCE(action, '') = ?
         AND state = 'running' AND attempt_count = ? AND control_waiting_at IS NULL
         AND pending_continuation_sequence IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM fleet_run_intents AS newer
           WHERE newer.repo_full_name = fleet_run_intents.repo_full_name
             AND newer.pr_number = fleet_run_intents.pr_number
             AND newer.generation > fleet_run_intents.generation
             ${newerGenerationScope('fleet_run_intents', 'newer')}
             AND newer.state NOT IN (${NON_FENCING_GENERATION_STATES})
         )`,
    )
    .bind(terminal, now, now, error?.slice(0, 600) ?? null, identity.deliveryId,
      identity.repoFullName, identity.prNumber, identity.headSha, identity.eventType,
      identity.action, expectedAttempt)
    .run();
  if (updated.meta?.changes !== 1) {
    throw new FleetIntentOwnershipError(job.deliveryId, 'terminal-write-fenced');
  }
}
