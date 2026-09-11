/**
 * Durable Cloud Fleet admission + logical-run projections.
 *
 * Cloudflare Queues is at-least-once and cannot replace an older queued
 * message. The relay records a monotonic admission generation before enqueueing
 * it. A newer generation projects older queued/running work as superseded after
 * its own queue send succeeds; the executor rechecks that ledger at guarded
 * publication boundaries. Degraded executor rollout mode and the non-atomic
 * webhook-to-queue/check interval remain explicit residuals. Reads merge the admission row with the eventual
 * `fleet_runs` transcript header so queued work is visible before a consumer
 * starts and historical rows remain readable after a rollback.
 */

import {
  deleteFleetRun,
  getFleetRunWithSteps,
  listFleetRuns,
  type FleetRunRow,
  type FleetRunStepRow,
} from './db.js';

export type FleetIntentState =
  | 'admitting'
  | 'queued'
  | 'running'
  | 'retrying'
  | 'superseded'
  | 'enqueue_failed'
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled';

export interface FleetRunIntentRow {
  delivery_id: string;
  repo_full_name: string;
  pr_number: number;
  pr_url: string;
  head_sha: string;
  event_type: string;
  action: string | null;
  generation: number;
  state: FleetIntentState;
  attempt_count: number;
  queued_at: number;
  started_at: number | null;
  last_progress_at: number;
  finished_at: number | null;
  superseded_by: string | null;
  last_error: string | null;
}

export interface FleetRunProjection extends FleetRunRow {
  logical_state: FleetIntentState | string;
  generation: number | null;
  attempt_count: number;
  queued_at: number;
  started_at: number | null;
  last_progress_at: number;
  finished_at: number | null;
  superseded_by: string | null;
  last_error: string | null;
  expected_start_at: number | null;
  expected_finish_at: number | null;
  queue_ahead_estimate: number | null;
  has_transcript: boolean;
}

export interface ReserveFleetIntentInput {
  deliveryId: string;
  repoFullName: string;
  prNumber: number;
  prUrl: string;
  headSha: string;
  eventType: string;
  action: string | null;
  now: number;
}

export interface FleetIntentReservation {
  shouldEnqueue: boolean;
  duplicate: boolean;
  state: FleetIntentState;
}

const ACTIVE_STATES = new Set<FleetIntentState>(['admitting', 'queued', 'running', 'retrying']);
const RESERVATION_COLLISION_RETRIES = 4;

/**
 * Detect only the additive-migration rollout gap. The design deliberately does
 * not hide unrelated D1 failures, because an empty control room is worse than a
 * visible outage.
 *
 * @param error - The D1 error raised by an intent-ledger operation.
 * @returns True only when the fleet_run_intents table is absent.
 */
function isMissingIntentTable(error: unknown): boolean {
  return /no such table:\s*fleet_run_intents/i.test(String(error));
}

/**
 * Reserve one delivery id and assign its monotonic per-PR generation. The
 * design retries unique-generation contention so simultaneous new heads never
 * turn into a silently dropped webhook.
 *
 * @param db - Relay D1 binding that owns admission truth.
 * @param input - Verified webhook identity, PR head, and injected clock.
 * @returns Whether this caller won the right to enqueue the delivery.
 */
export async function reserveFleetRunIntent(
  db: D1Database,
  input: ReserveFleetIntentInput,
): Promise<FleetIntentReservation> {
  const existing = await getFleetRunIntent(db, input.deliveryId);
  if (existing) {
    if (existing.state === 'enqueue_failed') {
      const retried = await db
        .prepare(
          `UPDATE fleet_run_intents
             SET state = 'admitting', last_error = NULL, last_progress_at = ?
           WHERE delivery_id = ? AND state = 'enqueue_failed'`,
        )
        .bind(input.now, input.deliveryId)
        .run();
      const wonRetry = (retried.meta?.changes ?? 1) > 0;
      return { shouldEnqueue: wonRetry, duplicate: true, state: 'admitting' };
    }
    return { shouldEnqueue: false, duplicate: true, state: existing.state };
  }

  for (let collision = 0; collision < RESERVATION_COLLISION_RETRIES; collision += 1) {
    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO fleet_run_intents
           (delivery_id, repo_full_name, pr_number, pr_url, head_sha,
            event_type, action, generation, state, queued_at, last_progress_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(generation), 0) + 1,
                'admitting', ?, ?
         FROM fleet_run_intents
         WHERE repo_full_name = ? AND pr_number = ?`,
      )
      .bind(
        input.deliveryId,
        input.repoFullName,
        input.prNumber,
        input.prUrl,
        input.headSha,
        input.eventType,
        input.action,
        input.now,
        input.now,
        input.repoFullName,
        input.prNumber,
      )
      .run();

    // Real D1 always reports meta.changes. The default-to-one keeps lightweight
    // compatibility adapters working. A zero can be either same-delivery
    // idempotency or a concurrent generation collision; read back and retry only
    // the latter so a valid newer head is never silently dropped.
    if ((inserted.meta?.changes ?? 1) > 0) {
      return { shouldEnqueue: true, duplicate: false, state: 'admitting' };
    }
    const duplicate = await getFleetRunIntent(db, input.deliveryId);
    if (duplicate) {
      return { shouldEnqueue: false, duplicate: true, state: duplicate.state };
    }
  }
  throw new Error(`fleet intent generation contention for ${input.repoFullName}#${input.prNumber}`);
}

/**
 * Mark a successful queue send and supersede only strictly older generations.
 * The intent is to preserve the last valid review until replacement work is
 * durably owned by Cloudflare Queues.
 *
 * @param db - Relay D1 binding that owns admission truth.
 * @param deliveryId - Webhook delivery that was accepted by the queue.
 * @param now - Injected unix timestamp for the state transition.
 * @returns Completion after both ordered D1 statements finish.
 */
export async function markFleetRunIntentEnqueued(
  db: D1Database,
  deliveryId: string,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE fleet_run_intents
           SET state = 'queued', queued_at = ?, last_progress_at = ?, last_error = NULL
         WHERE delivery_id = ? AND state IN ('admitting', 'enqueue_failed')`,
      )
      .bind(now, now, deliveryId),
    db
      .prepare(
        `UPDATE fleet_run_intents
           SET state = 'superseded', finished_at = ?, last_progress_at = ?,
               superseded_by = ?
         WHERE repo_full_name = (
                 SELECT repo_full_name FROM fleet_run_intents WHERE delivery_id = ?
               )
           AND pr_number = (
                 SELECT pr_number FROM fleet_run_intents WHERE delivery_id = ?
               )
           AND generation < (
                 SELECT generation FROM fleet_run_intents WHERE delivery_id = ?
               )
           AND state IN ('admitting', 'queued', 'running', 'retrying')`,
      )
      .bind(now, now, deliveryId, deliveryId, deliveryId, deliveryId),
  ]);
}

/**
 * Keep failed queue admission visible without superseding prior work. This
 * design makes the required-check failure remediable and safe to retry.
 *
 * @param db - Relay D1 binding that owns admission truth.
 * @param deliveryId - Webhook delivery whose queue send failed.
 * @param error - Bounded operator-facing failure detail.
 * @param now - Injected unix timestamp for the failure.
 * @returns Completion after the failure receipt is durable.
 */
export async function markFleetRunIntentEnqueueFailed(
  db: D1Database,
  deliveryId: string,
  error: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE fleet_run_intents
         SET state = 'enqueue_failed', last_error = ?, last_progress_at = ?, finished_at = ?
       WHERE delivery_id = ?`,
    )
    .bind(error.slice(0, 600), now, now, deliveryId)
    .run();
}

/**
 * Read one delivery intent. The rollout design degrades only a missing additive
 * table; transient storage failures remain visible to callers.
 *
 * @param db - Relay D1 binding.
 * @param deliveryId - Webhook delivery idempotency key.
 * @returns The durable intent, or null when absent/pre-migration.
 */
export async function getFleetRunIntent(
  db: D1Database,
  deliveryId: string,
): Promise<FleetRunIntentRow | null> {
  try {
    return await db
      .prepare('SELECT * FROM fleet_run_intents WHERE delivery_id = ?')
      .bind(deliveryId)
      .first<FleetRunIntentRow>();
  } catch (error) {
    if (isMissingIntentTable(error)) return null;
    throw error;
  }
}

/**
 * List recent intents. The design lets old relay databases return an empty
 * ledger while refusing to disguise a real D1 outage as an empty queue.
 *
 * @param db - Relay D1 binding.
 * @param limit - Maximum number of newest admission rows.
 * @returns Newest-first durable intents.
 */
export async function listFleetRunIntents(
  db: D1Database,
  limit = 100,
): Promise<FleetRunIntentRow[]> {
  try {
    const rows = await db
      .prepare(
        `SELECT * FROM fleet_run_intents
         ORDER BY queued_at DESC, generation DESC
         LIMIT ?`,
      )
      .bind(limit)
      .all<FleetRunIntentRow>();
    return rows.results ?? [];
  } catch (error) {
    if (isMissingIntentTable(error)) return [];
    throw error;
  }
}

/** One earlier or later review generation of the same PR — a compact cross-reference, not a full projection. */
export interface FleetRunGenerationSummary {
  deliveryId: string;
  generation: number;
  state: FleetIntentState;
  queuedAt: number;
  finishedAt: number | null;
  /** The materialized `fleet_runs` id to link to, when this generation executed far enough to have one. */
  runId: string | null;
}

/**
 * Every review generation admitted for one `(repo, PR)` pair, newest first —
 * the answer to "show every session/attempt across this PR", which nothing
 * previously queried (a PR's full history is spread across one
 * `fleet_run_intents` row per push, by design; see this module's header
 * comment). Bounded and best-effort like every other read here: a pre-
 * migration relay without `fleet_run_intents` returns an empty list rather
 * than throwing, since the run page must still render without this strip.
 *
 * @param db - Relay D1 binding.
 * @param repoFullName - `owner/repo`, exactly as stored on the ledger.
 * @param prNumber - The pull request number.
 * @param limit - Maximum generations returned (newest first).
 * @returns Every known generation for this PR, most recent push first.
 */
export async function listFleetRunGenerationsForPr(
  db: D1Database,
  repoFullName: string,
  prNumber: number,
  limit = 25,
): Promise<FleetRunGenerationSummary[]> {
  try {
    const rows = await db
      .prepare(
        `SELECT i.delivery_id AS delivery_id, i.generation AS generation, i.state AS state,
                i.queued_at AS queued_at, i.finished_at AS finished_at, r.id AS run_id
         FROM fleet_run_intents i
         LEFT JOIN fleet_runs r ON r.delivery_id = i.delivery_id
         WHERE i.repo_full_name = ? AND i.pr_number = ?
         ORDER BY i.generation DESC
         LIMIT ?`,
      )
      .bind(repoFullName, prNumber, limit)
      .all<{
        delivery_id: string;
        generation: number;
        state: FleetIntentState;
        queued_at: number;
        finished_at: number | null;
        run_id: string | null;
      }>();
    return (rows.results ?? []).map(r => ({
      deliveryId: r.delivery_id,
      generation: r.generation,
      state: r.state,
      queuedAt: r.queued_at,
      finishedAt: r.finished_at,
      runId: r.run_id,
    }));
  } catch (error) {
    if (isMissingIntentTable(error)) return [];
    throw error;
  }
}

/**
 * Select a bounded nearest-rank percentile for ETA projection. This design uses
 * recorded service time rather than inventing a fixed queue duration.
 *
 * @param values - Positive observed durations.
 * @param fraction - Desired percentile in the inclusive zero-to-one range.
 * @returns The selected duration, or null without evidence.
 */
function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? null;
}

/**
 * Merge admission truth with an optional transcript header. The intent is to
 * expose one logical receipt before, during, and after queue execution.
 *
 * @param intent - Admission row, when the additive ledger exists.
 * @param run - Materialized transcript header, when execution has started.
 * @param now - Injected clock used for live elapsed time.
 * @returns One normalized logical Fleet run projection.
 */
function project(
  intent: FleetRunIntentRow | null,
  run: FleetRunRow | null,
  now: number,
): FleetRunProjection {
  if (!intent && !run) throw new Error('project requires an intent or run');
  const logicalState = run && run.conclusion !== 'pending'
    ? run.conclusion
    : (intent?.state ?? (run?.conclusion === 'pending' ? 'running' : run?.conclusion) ?? 'pending');
  const createdAt = intent?.queued_at ?? run?.created_at ?? now;
  const elapsedMs = run && run.ms > 0
    ? run.ms
    : intent?.started_at && ACTIVE_STATES.has(intent.state)
      ? Math.max(0, now - intent.started_at) * 1000
      : 0;
  return {
    id: run?.id ?? `intent:${intent!.delivery_id}`,
    delivery_id: intent?.delivery_id ?? run!.delivery_id,
    repo_full_name: intent?.repo_full_name ?? run!.repo_full_name,
    pr_number: intent?.pr_number ?? run!.pr_number,
    pr_url: intent?.pr_url ?? run!.pr_url,
    head_sha: intent?.head_sha ?? run!.head_sha,
    conclusion: logicalState,
    ships_csv: run?.ships_csv ?? '',
    neurons: run?.neurons ?? null,
    ms: elapsedMs,
    created_at: createdAt,
    logical_state: logicalState,
    generation: intent?.generation ?? null,
    attempt_count: intent?.attempt_count ?? 0,
    queued_at: createdAt,
    started_at: intent?.started_at ?? (run ? run.created_at : null),
    last_progress_at: intent?.last_progress_at ?? run?.created_at ?? createdAt,
    finished_at: intent?.finished_at ?? (
      run && run.conclusion !== 'pending'
        ? run.created_at + Math.ceil(Math.max(0, run.ms) / 1000)
        : null
    ),
    superseded_by: intent?.superseded_by ?? null,
    last_error: intent?.last_error ?? null,
    expected_start_at: null,
    expected_finish_at: null,
    queue_ahead_estimate: null,
    has_transcript: Boolean(run),
  };
}

/**
 * Merge queued intents and executed run headers into one newest-first feed.
 * The design derives explicit estimates from recent p50 service time and the
 * D1-known serial queue; callers must label them as estimates.
 *
 * @param db - Relay D1 binding.
 * @param limit - Maximum projected rows returned to the caller.
 * @param now - Injected clock for elapsed time and ETA calculation.
 * @returns Logical Fleet receipts with transcript and queue state merged.
 */
export async function listFleetRunProjections(
  db: D1Database,
  limit = 100,
  now = Math.floor(Date.now() / 1000),
): Promise<FleetRunProjection[]> {
  const [runs, intents] = await Promise.all([
    listFleetRuns(db, limit),
    listFleetRunIntents(db, Math.max(limit, 500)),
  ]);
  const runByDelivery = new Map(runs.map((run) => [run.delivery_id, run]));
  const projections: FleetRunProjection[] = intents.map((intent) =>
    project(intent, runByDelivery.get(intent.delivery_id) ?? null, now),
  );
  const known = new Set(intents.map((intent) => intent.delivery_id));
  for (const run of runs) {
    if (!known.has(run.delivery_id)) projections.push(project(null, run, now));
  }

  const durations = runs.map((run) => run.ms).filter((ms) => Number.isFinite(ms) && ms > 0);
  const serviceMs = percentile(durations, 0.5);
  if (serviceMs !== null) {
    const serviceSec = Math.max(1, Math.ceil(serviceMs / 1000));
    let cursor = now;
    let ahead = 0;
    const active = projections
      .filter((row) => ACTIVE_STATES.has(row.logical_state as FleetIntentState))
      .sort((a, b) => a.queued_at - b.queued_at || (a.generation ?? 0) - (b.generation ?? 0));
    for (const row of active) {
      const inService = ['running', 'retrying'].includes(row.logical_state) && row.started_at !== null;
      const start = inService
        ? row.started_at!
        : cursor;
      const finish = inService
        ? Math.max(now, start + serviceSec)
        : Math.max(now, start) + serviceSec;
      row.expected_start_at = start;
      row.expected_finish_at = finish;
      row.queue_ahead_estimate = ahead;
      cursor = finish;
      ahead += 1;
    }
  }

  return projections
    .sort((a, b) => b.queued_at - a.queued_at || (b.generation ?? 0) - (a.generation ?? 0))
    .slice(0, limit);
}

/**
 * Read one logical run and its transcript, including intent-only queued work.
 * The purpose is to make admission a first-class receipt rather than a 404.
 *
 * @param db - Relay D1 binding.
 * @param id - Materialized run id or synthetic intent-prefixed id.
 * @param now - Injected clock for live elapsed time.
 * @returns The normalized receipt and ordered steps, or null when unknown.
 */
export async function getFleetRunProjectionWithSteps(
  db: D1Database,
  id: string,
  now = Math.floor(Date.now() / 1000),
): Promise<{ run: FleetRunProjection; steps: FleetRunStepRow[] } | null> {
  const direct = await getFleetRunWithSteps(db, id);
  if (direct) {
    const intent = await getFleetRunIntent(db, direct.run.delivery_id);
    return { run: project(intent, direct.run, now), steps: direct.steps };
  }

  if (!id.startsWith('intent:')) return null;
  const deliveryId = id.slice('intent:'.length);
  const intent = await getFleetRunIntent(db, deliveryId);
  if (!intent) return null;
  const run = await db
    .prepare(
      `SELECT id, delivery_id, repo_full_name, pr_number, pr_url, head_sha,
              conclusion, ships_csv, neurons, ms, created_at
       FROM fleet_runs WHERE delivery_id = ?`,
    )
    .bind(deliveryId)
    .first<FleetRunRow>();
  if (run) {
    const found = await getFleetRunWithSteps(db, run.id);
    if (found) return { run: project(intent, found.run, now), steps: found.steps };
  }
  return { run: project(intent, null, now), steps: [] };
}

/**
 * Delete an admission row while preserving pre-migration rollback support. The
 * design swallows only the known missing-table seam and surfaces real outages.
 *
 * @param db - Relay D1 binding.
 * @param deliveryId - Admission row idempotency key.
 * @returns Number of deleted intent rows.
 */
async function deleteIntentByDelivery(db: D1Database, deliveryId: string): Promise<number> {
  try {
    const result = await db
      .prepare('DELETE FROM fleet_run_intents WHERE delivery_id = ?')
      .bind(deliveryId)
      .run();
    return result.meta?.changes ?? 0;
  } catch (error) {
    // Rollback compatibility: a relay running before the additive migration
    // must still be able to delete legacy fleet_runs.
    if (isMissingIntentTable(error)) return 0;
    throw error;
  }
}

/**
 * Delete one logical run projection, including its admission receipt and any
 * materialized transcript.  Synthetic `intent:` ids are first-class operator
 * receipts, not undeletable implementation rows.
 *
 * @param db - Relay D1 binding.
 * @param id - Materialized run id or synthetic intent-prefixed id.
 * @returns One when the logical receipt was deleted, otherwise zero.
 */
export async function deleteFleetRunProjection(db: D1Database, id: string): Promise<number> {
  if (id.startsWith('intent:')) {
    const deliveryId = id.slice('intent:'.length);
    const intent = await getFleetRunIntent(db, deliveryId);
    if (!intent) return 0;

    const materialized = await db
      .prepare('SELECT id FROM fleet_runs WHERE delivery_id = ?')
      .bind(deliveryId)
      .first<{ id: string }>();
    if (materialized) await deleteFleetRun(db, materialized.id);
    return deleteIntentByDelivery(db, deliveryId);
  }

  let deliveryId: string | null = null;
  const row = await db
    .prepare('SELECT delivery_id FROM fleet_runs WHERE id = ?')
    .bind(id)
    .first<{ delivery_id: string }>();
  deliveryId = row?.delivery_id ?? null;

  const removed = await deleteFleetRun(db, id);
  if (removed > 0 && deliveryId) await deleteIntentByDelivery(db, deliveryId);
  return removed;
}

/**
 * Aggregate intent counts for the health/control-room summary. The design
 * reports D1-known work as an estimate without claiming Cloudflare internals.
 *
 * @param db - Relay D1 binding.
 * @param now - Injected clock for the oldest-queued age.
 * @returns Counts, admission failures, and the oldest active queue age.
 */
export async function fleetIntentHealth(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
): Promise<{
  known: number;
  queued: number;
  running: number;
  retrying: number;
  superseded: number;
  failedAdmission: number;
  oldestQueuedAgeSec: number | null;
}> {
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS known,
                SUM(CASE WHEN state IN ('admitting','queued') THEN 1 ELSE 0 END) AS queued,
                SUM(CASE WHEN state = 'running' THEN 1 ELSE 0 END) AS running,
                SUM(CASE WHEN state = 'retrying' THEN 1 ELSE 0 END) AS retrying,
                SUM(CASE WHEN state = 'superseded' THEN 1 ELSE 0 END) AS superseded,
                SUM(CASE WHEN state = 'enqueue_failed' THEN 1 ELSE 0 END) AS failed_admission,
                MIN(CASE WHEN state IN ('admitting','queued','retrying') THEN queued_at END) AS oldest_queued_at
         FROM fleet_run_intents`,
      )
      .first<{
        known: number;
        queued: number | null;
        running: number | null;
        retrying: number | null;
        superseded: number | null;
        failed_admission: number | null;
        oldest_queued_at: number | null;
      }>();
    return {
      known: row?.known ?? 0,
      queued: row?.queued ?? 0,
      running: row?.running ?? 0,
      retrying: row?.retrying ?? 0,
      superseded: row?.superseded ?? 0,
      failedAdmission: row?.failed_admission ?? 0,
      oldestQueuedAgeSec: row?.oldest_queued_at == null ? null : Math.max(0, now - row.oldest_queued_at),
    };
  } catch (error) {
    if (!isMissingIntentTable(error)) throw error;
    return {
      known: 0,
      queued: 0,
      running: 0,
      retrying: 0,
      superseded: 0,
      failedAdmission: 0,
      oldestQueuedAgeSec: null,
    };
  }
}
