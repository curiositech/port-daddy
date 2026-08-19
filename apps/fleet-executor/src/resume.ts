/**
 * RESUMABLE RUNS — a redelivered fleet job continues where the killed one
 * stopped, instead of starting over.
 *
 * WHY: on 2026-08-19 the platform began terminating fleet invocations
 * mid-run with no catchable error (start markers with no failure recorded —
 * see delivery-failure.ts). Every redelivery restarted from ship #1,
 * re-spent the whole roster, and was killed at roughly the same depth: four
 * attempts, zero cumulative progress, dead-letter. The kill was
 * size-independent (a two-file diff died identically to a seven-PDF one) and
 * uncorrelated with any deploy, so it cannot be fixed from this repo — but it
 * can be SURVIVED. If each attempt completes even one ship and the next
 * attempt skips finished ships, a 9-ship roster completes inside the existing
 * max_retries budget instead of wasting it.
 *
 * MECHANISM: after each ship completes, the executor writes one `ship-result`
 * transcript step whose detail is the full {@link ShipResult}, keyed at a seq
 * far above the narrative range (same trick, same reasoning as
 * delivery-failure.ts: the Transcript restarts seq at 0 per delivery and
 * writes INSERT OR REPLACE, so anything in the narrative range is overwritten
 * by the next attempt — checkpoints must live where no narrative seq
 * reaches). On redelivery, {@link loadShipCheckpoints} reads them back and
 * the ship loop skips any ship that already has a result. Ship comments are
 * edit-in-place and the final check completion is idempotent, so replaying
 * the tail of the pipeline on top of restored results is safe — that was
 * already the redelivery contract.
 *
 * FAIL-OPEN, DELIBERATELY: no DB, a write failure, or an unparseable
 * checkpoint degrades to "no checkpoint" — the ship re-runs, which is exactly
 * today's behavior. Resume can only ever REMOVE re-spend, never change a
 * verdict: restored results are the results the ship actually produced.
 */

import type { ExecutorEnv } from './env.js';
import type { ShipResult } from './verdict.js';

/** `fleet_run_steps.kind` for a per-ship completion checkpoint. */
export const SHIP_CHECKPOINT_KIND = 'ship-result';

/**
 * Seq floor for checkpoints. Above every narrative seq (a run writes tens of
 * steps, not hundreds of thousands) and disjoint from delivery-failure.ts's
 * 1,000,000 block so the two never collide. Each ship's checkpoint sits at
 * floor + its roster index, which is stable across attempts because the
 * roster order is derived deterministically from pd-fleet.yml.
 */
export const SHIP_CHECKPOINT_SEQ_BASE = 2_000_000;

/**
 * Record a ship's completed result so a later attempt can skip the ship.
 * Best-effort; never throws (a checkpoint failure must not fail a run that
 * just succeeded at real work).
 */
export async function recordShipCheckpoint(
  env: ExecutorEnv,
  runId: string,
  rosterIndex: number,
  result: ShipResult,
): Promise<void> {
  try {
    if (!env.DB) return;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO fleet_run_steps (run_id, seq, kind, ship, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        runId,
        SHIP_CHECKPOINT_SEQ_BASE + rosterIndex,
        SHIP_CHECKPOINT_KIND,
        result.ship,
        `checkpoint: pd-${result.ship} completed (${result.errored ? 'errored' : result.verdict})`,
        JSON.stringify(result),
        Math.floor(Date.now() / 1000),
      )
      .run();
  } catch (err) {
    console.error(`[fleet-executor] ship checkpoint failed run=${runId} ship=${result.ship}: ${String(err)}`);
  }
}

/**
 * Load all ship checkpoints for a run, keyed by ship name.
 *
 * A malformed detail drops THAT checkpoint only (the ship re-runs — fail-open),
 * never the whole map: one corrupt row must not turn a 7-ship resume back into
 * a from-scratch run.
 */
export async function loadShipCheckpoints(
  env: ExecutorEnv,
  runId: string,
): Promise<Map<string, ShipResult>> {
  const restored = new Map<string, ShipResult>();
  try {
    if (!env.DB) return restored;
    const rows = await env.DB.prepare(
      `SELECT ship, detail FROM fleet_run_steps WHERE run_id = ? AND kind = ? ORDER BY seq ASC`,
    )
      .bind(runId, SHIP_CHECKPOINT_KIND)
      .all();
    for (const row of (rows?.results ?? []) as Array<Record<string, unknown>>) {
      if (typeof row.detail !== 'string' || !row.detail) continue;
      try {
        const parsed = JSON.parse(row.detail) as ShipResult;
        // Minimal shape check: a checkpoint that cannot name its ship and
        // verdict is not evidence a ship completed.
        if (parsed && typeof parsed.ship === 'string' && parsed.ship && typeof parsed.verdict === 'string') {
          restored.set(parsed.ship, parsed);
        }
      } catch {
        // fall through — this ship re-runs
      }
    }
  } catch (err) {
    console.error(`[fleet-executor] loading ship checkpoints failed run=${runId}: ${String(err)}`);
  }
  return restored;
}
