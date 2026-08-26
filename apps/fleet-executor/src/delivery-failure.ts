/**
 * Why a lost fleet delivery has to say WHAT killed it.
 *
 * The fail-closed contract in `index.ts` is sound: a job that throws is
 * retried, and after `max_retries` it dead-letters, where `dlq.ts` completes
 * the stuck 'Port Daddy Fleet' check as `failure` so a lost blocking run can
 * never leave a green or absent gate. What that contract did NOT do is say
 * anything about the failure. The only artifact an operator could see was one
 * sentence — "was lost (job exhausted retries / dead-lettered)" — with the
 * actual error confined to a `console.error` in a Worker log nobody reads
 * after the fact. Three PRs sat blocked on exactly that sentence with no way
 * to tell a token-mint outage from a D1 hiccup from a bug in a ship, because
 * the surfaces that survive a run (the check run, the transcript, the run
 * page) recorded none of it.
 *
 * This module closes that. Every retry writes one `delivery-failed` transcript
 * step naming the attempt and the error, and the DLQ handler reads the last one
 * back and puts it in the check-run summary. The gate's behaviour is unchanged
 * — a lost run still fails closed — but the failure now carries its cause to
 * the one place the operator is already looking.
 *
 * Every write here is BEST-EFFORT and never throws: this runs on the path that
 * is *already* failing, and an error thrown while recording an error would
 * swallow the `message.retry()` that follows it.
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import { ensureRunRow } from './execute.js';
import { DEAD_LETTER_MARKER } from './dead-letter-marker.js';

/** `fleet_run_steps.kind` for a failed queue delivery attempt. */
export const DELIVERY_FAILURE_KIND = 'delivery-failed';

/**
 * Seq floor for delivery-failure steps.
 *
 * The `Transcript` recorder restarts `seq` at 0 on every delivery and writes
 * `INSERT OR REPLACE`, so attempt N+1's steps overwrite attempt N's row for
 * row. Parking failures above any seq a real run reaches keeps the record of
 * why attempt N died readable after attempt N+1 has rewritten the transcript —
 * which matters precisely because the LAST attempt is usually the least
 * informative one.
 */
export const DELIVERY_FAILURE_SEQ_BASE = 1_000_000;

/** Cap on the recorded error text, so one enormous throw cannot fill a row. */
const MAX_ERROR_CHARS = 600;

/** `fleet_run_steps.kind` for a delivery attempt that BEGAN (see below). */
export const DELIVERY_ATTEMPT_KIND = 'delivery-attempt';

/**
 * Seq floor for attempt-start markers — its own band above the failure band.
 *
 * WHY START MARKERS EXIST (2026-08-19, issue #7743): recording failures in the
 * consumer's catch block can only ever see THROWN errors. The dead-letter
 * class that survived #7377 dies uncatchably — the platform terminates the
 * isolate (memory/CPU kill) and no catch runs, so the transcript said nothing
 * and the gate read "No per-attempt failure was recorded", indistinguishable
 * from "no attempt ever ran". A marker written at the START of each attempt
 * closes that gap structurally: started-but-no-failure is positive evidence of
 * an uncatchable termination, turning the next dead-letter into a
 * self-diagnosing artifact instead of log archaeology.
 */
export const DELIVERY_ATTEMPT_SEQ_BASE = 2_000_000;

/** A successful queue slice that deliberately schedules the next ship. */
export const DELIVERY_CONTINUATION_KIND = 'delivery-continuation';

/**
 * Seq floor for intentional continuations.
 *
 * This band sits between attempt starts and ship checkpoints. A start without
 * either a caught failure or a continuation is therefore an uncatchable
 * platform termination; a start with a continuation is ordinary cumulative
 * progress and must never be presented to the operator as a failed attempt.
 */
export const DELIVERY_CONTINUATION_SEQ_BASE = 2_500_000;

/** The deterministic run id both the main consumer and the DLQ handler use. */
export function runIdForDelivery(deliveryId: string): string {
  return `run:${deliveryId}`;
}

/** One recorded failed delivery attempt. */
export interface DeliveryFailure {
  /** Cloudflare's 1-based attempt counter (0 when the platform did not say). */
  attempt: number;
  /** One-line description of what was thrown. */
  error: string;
}

/**
 * Render a thrown value as one line of operator-readable text.
 *
 * Collapses whitespace (a stack trace pasted into a check-run summary is
 * unreadable and blows the size budget) and never returns '' — a thrown falsy
 * value is still a failure worth naming.
 */
export function describeDeliveryError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  if (!oneLine) return 'unknown error (a falsy value was thrown)';
  return oneLine.length > MAX_ERROR_CHARS ? `${oneLine.slice(0, MAX_ERROR_CHARS)}…` : oneLine;
}

/**
 * Record one failed delivery attempt against the run's transcript.
 *
 * Calls {@link ensureRunRow} first: a job that throws before the executor ever
 * wrote a `fleet_runs` row would otherwise leave a step with no run to hang
 * off, and the run page would 404 on the very link the failed gate publishes.
 *
 * @param attempt Cloudflare's `message.attempts` (1-based); 0 when unknown.
 */
export async function recordDeliveryFailure(
  env: ExecutorEnv,
  job: FleetRunJob,
  attempt: number,
  err: unknown,
): Promise<void> {
  try {
    if (!env.DB) return;
    const deliveryId = job?.deliveryId ?? '';
    if (!deliveryId) return;
    const runId = runIdForDelivery(deliveryId);
    const pr = job.payloadMinimal?.pull_request as { head?: { sha?: string } } | undefined;
    const headSha = pr?.head?.sha ?? '';
    await ensureRunRow(env, runId, deliveryId, job.repoFullName ?? null, job.prNumber ?? null, headSha);

    const error = describeDeliveryError(err);
    const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO fleet_run_steps (run_id, seq, kind, ship, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        runId,
        DELIVERY_FAILURE_SEQ_BASE + safeAttempt,
        DELIVERY_FAILURE_KIND,
        null,
        `Delivery attempt ${safeAttempt || '?'} failed: ${error}`,
        JSON.stringify({ attempt: safeAttempt, error }),
        Math.floor(Date.now() / 1000),
      )
      .run();
  } catch (recordErr) {
    // Never rethrow: the caller is mid-catch and must still reach message.retry().
    console.error(
      `[fleet-executor] recording delivery failure failed delivery=${job?.deliveryId}: ${String(recordErr)}`,
    );
  }
}

/**
 * Record that a delivery attempt BEGAN, before any work is done.
 *
 * DESIGN: mirrors {@link recordDeliveryFailure}'s discipline exactly — ensure
 * the run row first, best-effort, never throws — because this too runs on the
 * consumer's hot path and must never be the reason a delivery fails. Written
 * unconditionally on every attempt (successful ones included): one small D1
 * row per delivery is the price of being able to prove, after an uncatchable
 * kill, that the attempt existed at all. See {@link DELIVERY_ATTEMPT_SEQ_BASE}
 * for why that proof matters.
 *
 * @param env - Worker environment (needs DB; silently a no-op without it).
 * @param job - The fleet job being attempted.
 * @param attempt - Cloudflare's `message.attempts` (1-based); 0 when unknown.
 * @returns Resolves always; failures are logged, never thrown.
 */
export async function recordDeliveryAttemptStart(
  env: ExecutorEnv,
  job: FleetRunJob,
  attempt: number,
): Promise<void> {
  try {
    if (!env.DB) return;
    const deliveryId = job?.deliveryId ?? '';
    if (!deliveryId) return;
    const runId = runIdForDelivery(deliveryId);
    const pr = job.payloadMinimal?.pull_request as { head?: { sha?: string } } | undefined;
    const headSha = pr?.head?.sha ?? '';
    await ensureRunRow(env, runId, deliveryId, job.repoFullName ?? null, job.prNumber ?? null, headSha);

    const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO fleet_run_steps (run_id, seq, kind, ship, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        runId,
        DELIVERY_ATTEMPT_SEQ_BASE + safeAttempt,
        DELIVERY_ATTEMPT_KIND,
        null,
        `Delivery attempt ${safeAttempt || '?'} started`,
        JSON.stringify({ attempt: safeAttempt }),
        Math.floor(Date.now() / 1000),
      )
      .run();
  } catch (recordErr) {
    // Never rethrow: a marker that could kill its own delivery would be worse
    // than no marker.
    console.error(
      `[fleet-executor] recording attempt start failed delivery=${job?.deliveryId}: ${String(recordErr)}`,
    );
  }
}

/**
 * Persist that one bounded invocation completed a ship and intentionally
 * returned the message to the queue for the next checkpointed slice.
 */
export async function recordDeliveryContinuation(
  env: ExecutorEnv,
  job: FleetRunJob,
  attempt: number,
  completedShip: string,
  remainingShips: string[],
): Promise<boolean> {
  try {
    if (!env.DB) return false;
    const deliveryId = job?.deliveryId ?? '';
    if (!deliveryId) return false;
    const runId = runIdForDelivery(deliveryId);
    const pr = job.payloadMinimal?.pull_request as { head?: { sha?: string } } | undefined;
    const headSha = pr?.head?.sha ?? '';
    await ensureRunRow(env, runId, deliveryId, job.repoFullName ?? null, job.prNumber ?? null, headSha);

    const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
    const boundedRemaining = remainingShips.filter(Boolean).slice(0, 50);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO fleet_run_steps (run_id, seq, kind, ship, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        runId,
        DELIVERY_CONTINUATION_SEQ_BASE + safeAttempt,
        DELIVERY_CONTINUATION_KIND,
        completedShip || null,
        `Delivery slice ${safeAttempt || '?'} completed pd-${completedShip || 'unknown'}; ` +
          `${boundedRemaining.length} ship(s) remain. The next checkpointed slice was scheduled; this is progress, not a failure.`,
        JSON.stringify({
          attempt: safeAttempt,
          completedShip,
          remainingShips: boundedRemaining,
        }),
        Math.floor(Date.now() / 1000),
      )
      .run();
    return true;
  } catch (recordErr) {
    console.error(
      `[fleet-executor] recording delivery continuation failed delivery=${job?.deliveryId}: ${String(recordErr)}`,
    );
    return false;
  }
}

/**
 * Read the durable continuation count, preserving storage failure as `null`.
 * Explicit continuation messages use this fail-closed form for deduplication:
 * treating an unavailable ledger as zero could either drop valid progress or
 * accept a duplicate message and fan out another continuation.
 */
export async function readDeliveryContinuationCount(
  env: ExecutorEnv,
  runId: string,
): Promise<number | null> {
  try {
    if (!env.DB) return null;
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM fleet_run_steps WHERE run_id = ? AND kind = ?`,
    )
      .bind(runId, DELIVERY_CONTINUATION_KIND)
      .first();
    const n = Number((row as Record<string, unknown> | null)?.n);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (err) {
    console.error(`[fleet-executor] counting continuations failed run=${runId}: ${String(err)}`);
    return null;
  }
}

/** Count intentional checkpoint continuations already completed for a run. */
export async function countDeliveryContinuations(
  env: ExecutorEnv,
  runId: string,
): Promise<number> {
  return (await readDeliveryContinuationCount(env, runId)) ?? 0;
}

/**
 * Count the attempt-start markers recorded for a run.
 *
 * PURPOSE: the DLQ handler pairs this with {@link readLastDeliveryFailure} to
 * distinguish three worlds in the gate summary: attempts threw (failure rows
 * name the cause), attempts began and died silently (start markers with no
 * failure rows — an uncatchable platform kill), or nothing ran at all (neither).
 * Returns 0 on any error or missing binding — the summary then degrades to the
 * honest pre-existing copy rather than guessing.
 *
 * @param env - Worker environment (needs DB).
 * @param runId - The run whose markers to count.
 * @returns The marker count; 0 when unbound, on error, or when none exist.
 */
export async function countDeliveryAttemptStarts(
  env: ExecutorEnv,
  runId: string,
): Promise<number> {
  try {
    if (!env.DB) return 0;
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM fleet_run_steps WHERE run_id = ? AND kind = ?`,
    )
      .bind(runId, DELIVERY_ATTEMPT_KIND)
      .first();
    const n = Number((row as Record<string, unknown> | null)?.n);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (err) {
    console.error(`[fleet-executor] counting attempt starts failed run=${runId}: ${String(err)}`);
    return 0;
  }
}

/**
 * Read back the highest-numbered recorded failure for a run, or null.
 *
 * Ordered by seq rather than created_at: seq encodes the attempt number, and
 * two attempts inside the same wall-clock second would otherwise tie.
 */
export async function readLastDeliveryFailure(
  env: ExecutorEnv,
  runId: string,
): Promise<DeliveryFailure | null> {
  try {
    if (!env.DB) return null;
    const row = await env.DB.prepare(
      `SELECT seq, title, detail FROM fleet_run_steps
        WHERE run_id = ? AND kind = ?
        ORDER BY seq DESC LIMIT 1`,
    )
      .bind(runId, DELIVERY_FAILURE_KIND)
      .first();
    if (!row) return null;

    const record = row as Record<string, unknown>;
    const seq = Number(record.seq);
    let attempt = Number.isFinite(seq) ? Math.max(0, seq - DELIVERY_FAILURE_SEQ_BASE) : 0;
    let error = '';
    if (typeof record.detail === 'string' && record.detail) {
      try {
        const parsed = JSON.parse(record.detail) as { attempt?: unknown; error?: unknown };
        if (typeof parsed.error === 'string') error = parsed.error;
        if (Number.isInteger(parsed.attempt)) attempt = parsed.attempt as number;
      } catch {
        // Malformed detail is not a reason to lose the row — fall through to title.
      }
    }
    if (!error) error = typeof record.title === 'string' ? record.title : '';
    if (!error) return null;
    return { attempt, error };
  } catch (err) {
    console.error(`[fleet-executor] reading delivery failure failed run=${runId}: ${String(err)}`);
    return null;
  }
}

/**
 * The check-run summary a dead-lettered job publishes.
 *
 * The first sentence is unchanged and load-bearing — it is what every existing
 * operator runbook, test and alert greps for. The cause is appended after it
 * rather than replacing it, so a dead-letter with no recorded failure still
 * reads exactly as it always did, and says so explicitly instead of leaving a
 * silent gap the reader has to interpret.
 */
export function deadLetterSummary(
  owner: string,
  repo: string,
  prNumber: number | null,
  failure: DeliveryFailure | null,
  attemptStarts = 0,
  checkpointedShips = 0,
  intentionalContinuations = 0,
): string {
  const base =
    `pd-fleet: run for ${owner}/${repo} PR #${prNumber ?? '?'} was lost (job exhausted retries / ` +
    `dead-lettered). This gate is failed rather than left stuck in-progress.`;
  // Resume progress (src/ship-checkpoint.ts): a dead-letter that completed N
  // ships before the loss should say so — it tells the operator a DLQ replay
  // will resume from ship N+1, not restart, and it distinguishes "died at the
  // first ship" from "died one ship short of done".
  const progress =
    checkpointedShips > 0
      ? `\n\n${checkpointedShips} ship(s) completed and checkpointed before the loss — a DLQ ` +
        `replay of this delivery resumes past them instead of re-running the whole fleet.`
      : '';
  const continuationProgress =
    intentionalContinuations > 0
      ? `\n\n${intentionalContinuations} delivery attempt(s) completed as intentional checkpoint ` +
        `continuations. Those slices succeeded and are not infrastructure failures.`
      : '';
  // The marker is what lets a later delivery tell this red gate apart from a
  // ship-decided one and run for real — see dead-letter-marker.ts.
  if (!failure) {
    // Attempt-start markers with no failure rows are positive evidence of an
    // UNCATCHABLE termination — the attempts began and the platform killed the
    // isolate (memory or CPU) before any catch could record a cause. Say that
    // instead of the ambiguous old copy, which read the same whether attempts
    // died silently or never ran at all (issue #7743's diagnostic gap).
    if (attemptStarts > 0) {
      const unaccountedStarts = Math.max(0, attemptStarts - intentionalContinuations);
      if (unaccountedStarts === 0) {
        return (
          `${base}\n\nEvery recorded attempt completed as an intentional checkpoint continuation, ` +
          `but the queue retry budget ended before a final verdict. The configured slice budget and ` +
          `fleet roster are inconsistent.${continuationProgress}${progress}\n\n${DEAD_LETTER_MARKER}`
        );
      }
      return (
        `${base}\n\n${unaccountedStarts} delivery attempt(s) recorded a start marker but no failure or ` +
        `intentional continuation — those attempts began and were terminated without a catchable error (a platform kill: ` +
        `memory or CPU limit). Check the fleet-executor Worker metrics/logs for the terminator.` +
        `${continuationProgress}${progress}\n\n${DEAD_LETTER_MARKER}`
      );
    }
    return (
      `${base}\n\nNo per-attempt failure was recorded for this delivery, so the cause is not in ` +
      `the transcript — check the fleet-executor Worker logs.${continuationProgress}${progress}\n\n${DEAD_LETTER_MARKER}`
    );
  }
  // A blank error would render "Last recorded failure (attempt 2): " — a
  // dangling colon that reads as truncation rather than as absence.
  // `readLastDeliveryFailure` never emits one, but this function is exported
  // and its contract should not depend on that.
  const error = failure.error.trim();
  if (!error) {
    return (
      `${base}\n\nA failure was recorded for this delivery but carried no readable cause.` +
      `${continuationProgress}${progress}\n\n${DEAD_LETTER_MARKER}`
    );
  }
  const which = failure.attempt > 0 ? `attempt ${failure.attempt}` : 'the last attempt';
  return `${base}\n\nLast recorded failure (${which}): ${error}${continuationProgress}${progress}\n\n${DEAD_LETTER_MARKER}`;
}
