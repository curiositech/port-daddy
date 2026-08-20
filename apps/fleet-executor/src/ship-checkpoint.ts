/**
 * Per-ship attempt checkpoints — a retried delivery RESUMES instead of
 * restarting.
 *
 * The dead-letter class that survived #7377 (CPU ceiling) and #7849 (MAP
 * memory bounds) is an uncatchable platform kill: the isolate is terminated
 * mid-run, no catch block fires, and the queue redelivers. Before this module,
 * every retry re-ran EVERY ship from ship one — identical model spend, four
 * times over, each attempt marching into the same kill (run 103e3650 on
 * PR #7279, 2026-08-20: "4 delivery attempt(s) recorded a start marker but no
 * failure"). A kill that cannot be caught cannot be prevented by tuning; the
 * only robust posture is to make retries MONOTONIC — attempt N+1 starts where
 * attempt N died, so each attempt does strictly less work and the run
 * converges even when the ceiling never moves.
 *
 * Mechanism: after each ship completes, its {@link ShipResult} is written as a
 * `ship-checkpoint` row in `fleet_run_steps`, parked in its own seq band above
 * the delivery-failure (1M) and attempt-marker (2M) bands so the Transcript
 * recorder's seq-0 restart on redelivery can never overwrite it. The runId is
 * already deterministic per delivery (`run:<deliveryId>`), so retries — and
 * DLQ replays of the same delivery — read their predecessors' checkpoints,
 * reconstruct those ships' results without re-running them, and spend only on
 * ships that never finished. A NEW push is a new delivery and a new runId:
 * checkpoints never leak across heads.
 *
 * Every write and read here is BEST-EFFORT and never throws: a checkpoint
 * failure degrades to exactly the pre-checkpoint behaviour (the ship re-runs),
 * and a corrupt row is ignored rather than trusted — re-running a ship is
 * always safe; resuming a fabricated verdict is not.
 */

import type { ExecutorEnv } from './env.js';
import type { Finding, ShipResult, Verdict } from './verdict.js';

/** `fleet_run_steps.kind` for a completed ship's checkpointed result. */
export const SHIP_CHECKPOINT_KIND = 'ship-checkpoint';

/**
 * Seq floor for checkpoint rows — its own band above the failure (1M) and
 * attempt-marker (2M) bands, for the same reason those have bands: the
 * Transcript recorder restarts seq at 0 on every delivery and INSERT OR
 * REPLACEs, so anything that must SURVIVE a redelivery has to live where a
 * fresh attempt's seqs can never reach.
 */
export const SHIP_CHECKPOINT_SEQ_BASE = 3_000_000;

const VALID_VERDICTS: ReadonlySet<string> = new Set(['PASS', 'BLOCK']);
const VALID_SEVERITIES: ReadonlySet<string> = new Set(['HIGH', 'MEDIUM', 'LOW']);

/**
 * Validate the nested finding objects too. Checking only that `findings` is an
 * array would accept rows such as `[null]`; the final review builder later
 * dereferences every finding's path/line/body, turning a corrupt best-effort
 * checkpoint into a run-level exception instead of safely re-running the ship.
 */
function parseCheckpointFindings(value: unknown): Finding[] | null {
  if (!Array.isArray(value)) return null;
  const findings: Finding[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const finding = item as Record<string, unknown>;
    if (typeof finding.path !== 'string') return null;
    if (!Number.isInteger(finding.line) || (finding.line as number) < 1) return null;
    if (typeof finding.severity !== 'string' || !VALID_SEVERITIES.has(finding.severity)) {
      return null;
    }
    if (typeof finding.body !== 'string') return null;
    findings.push({
      path: finding.path,
      line: finding.line as number,
      severity: finding.severity as Finding['severity'],
      body: finding.body,
    });
  }
  return findings;
}

/**
 * Narrow validation of a checkpoint row's detail back into a {@link ShipResult}.
 * Anything malformed returns null (ship re-runs). The `ship` name must match
 * the row's own ship column — a band collision after a roster change between
 * attempts must lose the checkpoint, never mis-attribute it.
 */
export function parseShipCheckpoint(shipColumn: unknown, detailJson: unknown): ShipResult | null {
  if (typeof shipColumn !== 'string' || !shipColumn) return null;
  if (typeof detailJson !== 'string' || !detailJson) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(detailJson);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.ship !== shipColumn) return null;
  if (typeof r.blocking !== 'boolean') return null;
  if (typeof r.errored !== 'boolean') return null;
  if (typeof r.verdict !== 'string' || !VALID_VERDICTS.has(r.verdict)) return null;
  if (r.noUsableOutput !== undefined && typeof r.noUsableOutput !== 'boolean') return null;
  const findings =
    r.findings === undefined ? undefined : parseCheckpointFindings(r.findings);
  if (findings === null) return null;
  return {
    ship: shipColumn,
    blocking: r.blocking,
    verdict: r.verdict as Verdict,
    errored: r.errored,
    ...(r.noUsableOutput !== undefined ? { noUsableOutput: r.noUsableOutput as boolean } : {}),
    ...(findings !== undefined ? { findings } : {}),
  };
}

/**
 * Load every valid checkpoint for this run. Empty map on any failure — the
 * run then behaves exactly as before checkpoints existed.
 */
export async function loadShipCheckpoints(
  env: ExecutorEnv,
  runId: string,
): Promise<Map<string, ShipResult>> {
  const resumed = new Map<string, ShipResult>();
  if (!env.DB) return resumed;
  try {
    const rows = await env.DB.prepare(
      `SELECT ship, detail FROM fleet_run_steps WHERE run_id = ? AND kind = ?`,
    )
      .bind(runId, SHIP_CHECKPOINT_KIND)
      .all<{ ship: unknown; detail: unknown }>();
    for (const row of rows?.results ?? []) {
      const result = parseShipCheckpoint(row.ship, row.detail);
      if (result) resumed.set(result.ship, result);
    }
  } catch (err) {
    console.error(`[fleet-executor] checkpoint load failed run=${runId}: ${String(err)}`);
  }
  return resumed;
}

/**
 * Persist one completed ship's result (best-effort). `shipIndex` is the ship's
 * position in this attempt's ordered roster — it only disambiguates the seq
 * slot; identity is the `ship` column, which {@link parseShipCheckpoint}
 * cross-checks on read.
 */
export async function saveShipCheckpoint(
  env: ExecutorEnv,
  runId: string,
  shipIndex: number,
  result: ShipResult,
): Promise<void> {
  if (!env.DB) return;
  const safeIndex = Number.isInteger(shipIndex) && shipIndex >= 0 ? shipIndex : 0;
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO fleet_run_steps (run_id, seq, kind, ship, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        runId,
        SHIP_CHECKPOINT_SEQ_BASE + safeIndex,
        SHIP_CHECKPOINT_KIND,
        result.ship,
        `pd-${result.ship}: checkpointed — ${result.errored ? 'ERROR' : result.verdict}; a retried delivery resumes past this ship`,
        JSON.stringify(result),
        Math.floor(Date.now() / 1000),
      )
      .run();
  } catch (err) {
    console.error(
      `[fleet-executor] checkpoint write failed run=${runId} ship=${result.ship}: ${String(err)}`,
    );
  }
}

/**
 * Count this run's checkpointed ships (for the DLQ summary: a dead-lettered
 * run that completed N ships before the loss should say so). Zero on failure.
 */
export async function countShipCheckpoints(env: ExecutorEnv, runId: string): Promise<number> {
  if (!env.DB) return 0;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM fleet_run_steps WHERE run_id = ? AND kind = ?`,
    )
      .bind(runId, SHIP_CHECKPOINT_KIND)
      .first<{ n: number }>();
    return Number(row?.n) || 0;
  } catch {
    return 0;
  }
}
