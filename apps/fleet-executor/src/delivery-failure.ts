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
): string {
  const base =
    `pd-fleet: run for ${owner}/${repo} PR #${prNumber ?? '?'} was lost (job exhausted retries / ` +
    `dead-lettered). This gate is failed rather than left stuck in-progress.`;
  if (!failure) {
    return (
      `${base}\n\nNo per-attempt failure was recorded for this delivery, so the cause is not in ` +
      `the transcript — check the fleet-executor Worker logs.`
    );
  }
  const which = failure.attempt > 0 ? `attempt ${failure.attempt}` : 'the last attempt';
  return `${base}\n\nLast recorded failure (${which}): ${failure.error}`;
}
