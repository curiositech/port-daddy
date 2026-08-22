/**
 * Relay retention + reaping sweep (ADR-0101; runtime-verification-for-agents).
 *
 * The local daemon has an Arbiter (`lib/arbiter.ts`) that runs invariant sweeps
 * on a `setInterval`. A Cloudflare Worker has no long-running process, so the
 * relay's equivalent is a **Cron Trigger** `scheduled()` handler that runs this
 * sweep periodically. It is scheduled *remediation/maintenance*, not a pure
 * monitor: it enforces three invariants Phase 1 introduced but left unbounded.
 *
 *   R1 retention   — events + fleet_run_steps + fleet_runs older than
 *                    EVENT_RETENTION_DAYS are pruned (the knob was declared but
 *                    never read — fleet_run_steps grew unbounded; ADR-0101 OQ4).
 *   R2 session reap— expired web_sessions are deleted (resolveSession already
 *                    rejects them at read time, so this is bounded-growth, not a
 *                    security fix).
 *   R3 erasure     — users soft-deleted (deleted_at set) more than 30 days ago
 *                    are hard-deleted, completing the erasure the account-delete
 *                    endpoint promised.
 *
 * Every step is best-effort and independent: one failing DELETE never aborts the
 * others, and the sweep never throws. Deletes are bounded by a WHERE on an
 * indexed timestamp column, so each is O(rows-past-horizon), not a full scan.
 */

import type { Env } from './types.js';
import { DIRECTORY_SIGNAL_RETENTION_DAYS } from './directory.js';

const DAY_SECONDS = 24 * 60 * 60;
const ERASURE_HARD_DELETE_DAYS = 30;
// Shipwright conversations are kept longer than the 7-day event horizon (an
// operator returns to a half-designed fleet), but never forever — the page
// states this retention to the user (no silent unbounded growth; ground
// truth #7's incident class).
export const SHIPWRIGHT_RETENTION_DAYS = 30;

export interface SweepResult {
  now: number;
  retentionDays: number;
  eventsPruned: number;
  runStepsPruned: number;
  runsPruned: number;
  sessionsReaped: number;
  usersHardDeleted: number;
  shipwrightChatsPruned: number;
  // X5 directory (doctrine D3): derived rows must not exist for unlisted
  // operators, and every derived signal is retention-bounded.
  directoryDelistDropped: number;
  directorySignalsPruned: number;
  errors: string[];
}

function parseRetentionDays(env: Env): number {
  const n = parseInt(env.EVENT_RETENTION_DAYS ?? '', 10);
  // Fail safe: an unset/garbage knob must NOT delete everything (horizon 0) —
  // fall back to a conservative 30-day retention rather than pruning live data.
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** DELETE by an indexed timestamp horizon; returns rows removed (0 on error). */
async function deleteOlderThan(
  db: D1Database,
  sql: string,
  horizon: number,
  errors: string[],
  label: string,
): Promise<number> {
  try {
    const res = await db.prepare(sql).bind(horizon).run();
    return res.meta?.changes ?? 0;
  } catch (e) {
    errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

/** DELETE with arbitrary binds (0..n); returns rows removed (0 on error). */
async function deleteWhere(
  db: D1Database,
  sql: string,
  binds: unknown[],
  errors: string[],
  label: string,
): Promise<number> {
  try {
    const res = await db.prepare(sql).bind(...binds).run();
    return res.meta?.changes ?? 0;
  } catch (e) {
    errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

/**
 * Run the sweep once. `now` (unix seconds) is injected — never read from the
 * system clock here — so the invariant is testable at a fixed time (the same
 * discipline the daemon Arbiter's monitors use for their clock).
 */
export async function runRetentionSweep(env: Env, now: number): Promise<SweepResult> {
  const errors: string[] = [];
  const retentionDays = parseRetentionDays(env);
  const retentionHorizon = now - retentionDays * DAY_SECONDS;

  // R1 — retention. Prune transcript steps first, then the run headers, then the
  // event chain rows, each past the retention horizon on an indexed column.
  const runStepsPruned = await deleteOlderThan(
    env.DB,
    'DELETE FROM fleet_run_steps WHERE run_id IN (SELECT id FROM fleet_runs WHERE created_at < ?)',
    retentionHorizon,
    errors,
    'fleet_run_steps',
  );
  const runsPruned = await deleteOlderThan(
    env.DB,
    'DELETE FROM fleet_runs WHERE created_at < ?',
    retentionHorizon,
    errors,
    'fleet_runs',
  );
  const eventsPruned = await deleteOlderThan(
    env.DB,
    'DELETE FROM events WHERE arrived_at < ?',
    retentionHorizon,
    errors,
    'events',
  );

  // R1b — Shipwright chats age out on their own (longer, stated) horizon.
  const shipwrightChatsPruned = await deleteOlderThan(
    env.DB,
    'DELETE FROM shipwright_chats WHERE created_at < ?',
    now - SHIPWRIGHT_RETENTION_DAYS * DAY_SECONDS,
    errors,
    'shipwright_chats',
  );

  // R-X5 — directory D3 invariants (src/directory.ts). First the delist-drop:
  // capability_index rows for unlisted operators MUST NOT EXIST — the delist
  // write already dropped them, and the sweep re-enforces the invariant so no
  // code path (crash between writes, a future bug) can leave a shadow index.
  const directoryDelistDropped = await deleteWhere(
    env.DB,
    'DELETE FROM capability_index WHERE daemon_fingerprint NOT IN (SELECT daemon_fingerprint FROM harbor_cards WHERE listed = 1)',
    [],
    errors,
    'capability_index(delist-drop)',
  );
  // Then the retention bound: every derived signal ages out.
  const directorySignalsPruned = await deleteOlderThan(
    env.DB,
    'DELETE FROM capability_index WHERE observed_at < ?',
    now - DIRECTORY_SIGNAL_RETENTION_DAYS * DAY_SECONDS,
    errors,
    'capability_index(retention)',
  );

  // R2 — reap expired web sessions (bounded growth; not a security fix).
  const sessionsReaped = await deleteOlderThan(
    env.DB,
    'DELETE FROM web_sessions WHERE expires_at < ?',
    now,
    errors,
    'web_sessions',
  );

  // R3 — complete erasure: hard-delete users soft-deleted > 30 days ago, and
  // any sessions still attached to them (defensive; erase already purged them).
  const erasureHorizon = now - ERASURE_HARD_DELETE_DAYS * DAY_SECONDS;
  await deleteOlderThan(
    env.DB,
    'DELETE FROM web_sessions WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
    erasureHorizon,
    errors,
    'web_sessions(erased)',
  );
  // Defensive: eraseUser already purged the account's Shipwright chats at
  // delete time; this catches rows soft-deleted users somehow still own so the
  // hard-delete below never orphans conversation content.
  await deleteOlderThan(
    env.DB,
    'DELETE FROM shipwright_chats WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
    erasureHorizon,
    errors,
    'shipwright_chats(erased)',
  );
  const usersHardDeleted = await deleteOlderThan(
    env.DB,
    'DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    erasureHorizon,
    errors,
    'users(hard-delete)',
  );

  return {
    now,
    retentionDays,
    eventsPruned,
    runStepsPruned,
    runsPruned,
    sessionsReaped,
    usersHardDeleted,
    shipwrightChatsPruned,
    directoryDelistDropped,
    directorySignalsPruned,
    errors,
  };
}
