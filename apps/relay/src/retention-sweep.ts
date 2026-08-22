/**
 * Relay retention + reaping sweep (ADR-0101; runtime-verification-for-agents).
 *
 * The local daemon has an Arbiter (`lib/arbiter.ts`) that runs invariant sweeps
 * on a `setInterval`. A Cloudflare Worker has no long-running process, so the
 * relay's equivalent is a **Cron Trigger** `scheduled()` handler that runs this
 * sweep periodically. It is scheduled *remediation/maintenance*, not a pure
 * monitor: it enforces three invariants Phase 1 introduced but left unbounded.
 *
 *   R1 retention   — events + fleet_run_steps + fleet_runs + terminal admission
 *                    receipts older than
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
// The Seamanship frontmatter cache (src/seamanship.ts) is served with a
// 5-minute freshness TTL, so anything older is already dead weight. One day is
// a generous floor that still keeps the table from growing without bound; the
// repo remains the source of truth, so a pruned row costs one GitHub read.
export const SEAMANSHIP_CACHE_RETENTION_DAYS = 1;
// The Engineman's chat keeps the same horizon as the relay's other
// conversation store: an operator returns to a half-formed proposal, but never
// forever. The page states this retention.
export const SNIPE_CHAT_RETENTION_DAYS = 30;
// Spent daily budget windows. Two days is one full rollover plus slack — long
// enough that a window is never pruned while it is still the current one, short
// enough that the counter table cannot grow without bound.
export const CHAT_SPEND_RETENTION_DAYS = 2;
// Finished suggestion jobs. The suggestions themselves are the operator's
// decisions and are NOT pruned here; only the run receipts age out.
export const SUGGESTION_JOB_RETENTION_DAYS = 30;

export interface SweepResult {
  now: number;
  retentionDays: number;
  eventsPruned: number;
  runStepsPruned: number;
  runsPruned: number;
  runIntentsPruned: number;
  sessionsReaped: number;
  usersHardDeleted: number;
  shipwrightChatsPruned: number;
  seamanshipCachePruned: number;
  snipeChatsPruned: number;
  chatSpendPruned: number;
  suggestionJobsPruned: number;
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
  // Active admission rows are never retention-pruned: they are the only durable
  // evidence that queued/retrying work exists before a transcript materializes.
  const runIntentsPruned = await deleteOlderThan(
    env.DB,
    `DELETE FROM fleet_run_intents
      WHERE state IN ('superseded','enqueue_failed','success','failure','neutral','cancelled')
        AND finished_at IS NOT NULL AND finished_at < ?`,
    retentionHorizon,
    errors,
    'fleet_run_intents',
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

  // R1c — the Seamanship frontmatter cache. A cache with no eviction is a
  // mirror, and a mirror of this catalog is exactly what the operator ruled
  // out — so it ages out on a horizon far shorter than its own usefulness.
  const seamanshipCachePruned = await deleteOlderThan(
    env.DB,
    'DELETE FROM seamanship_skill_cache WHERE fetched_at < ?',
    now - SEAMANSHIP_CACHE_RETENTION_DAYS * DAY_SECONDS,
    errors,
    'seamanship_skill_cache',
  );

  // R1d — the Engineman's chat, on the same stated horizon as the relay's
  // other conversation store.
  const snipeChatsPruned = await deleteOlderThan(
    env.DB,
    'DELETE FROM agent_chats WHERE created_at < ?',
    now - SNIPE_CHAT_RETENTION_DAYS * DAY_SECONDS,
    errors,
    'agent_chats',
  );

  // R1e — spent budget windows. Pruning these can only ever FORGIVE spend that
  // has already rolled over, never charge for it: a pruned window is one whose
  // day is long past, and the current window is keyed by today's midnight.
  const chatSpendPruned = await deleteOlderThan(
    env.DB,
    'DELETE FROM agent_chat_spend WHERE window_start < ?',
    now - CHAT_SPEND_RETENTION_DAYS * DAY_SECONDS,
    errors,
    'agent_chat_spend',
  );

  // R1f — finished suggestion-run receipts. Only receipts: the suggestions
  // themselves record what a person decided and are never aged out from here.
  const suggestionJobsPruned = await deleteOlderThan(
    env.DB,
    "DELETE FROM seamanship_suggestion_jobs WHERE state IN ('done','failed') AND requested_at < ?",
    now - SUGGESTION_JOB_RETENTION_DAYS * DAY_SECONDS,
    errors,
    'seamanship_suggestion_jobs',
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
  // Defensive, same shape: eraseUser already dropped the account's Seamanship
  // cache rows and its public listing. These catch anything a crash between
  // those writes left behind, so a hard-deleted user can never keep publishing.
  await deleteOlderThan(
    env.DB,
    'DELETE FROM seamanship_skill_cache WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
    erasureHorizon,
    errors,
    'seamanship_skill_cache(erased)',
  );
  await deleteOlderThan(
    env.DB,
    'DELETE FROM skill_listings WHERE namespace IN (SELECT login FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
    erasureHorizon,
    errors,
    'skill_listings(erased)',
  );
  // Defensive, same shape, for the Engineman's surfaces: conversation content
  // and proposal rows are user-authored, and a hard-deleted account must not
  // leave either behind — nor a build capability that could still fire.
  for (const sql of [
    'DELETE FROM agent_chats WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
    'DELETE FROM agent_chat_spend WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
    'DELETE FROM seamanship_build_grants WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
    'DELETE FROM seamanship_suggestions WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
    'DELETE FROM seamanship_suggestion_jobs WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
  ]) {
    await deleteOlderThan(env.DB, sql, erasureHorizon, errors, 'snipe(erased)');
  }
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
    runIntentsPruned,
    sessionsReaped,
    usersHardDeleted,
    shipwrightChatsPruned,
    seamanshipCachePruned,
    snipeChatsPruned,
    chatSpendPruned,
    suggestionJobsPruned,
    directoryDelistDropped,
    directorySignalsPruned,
    errors,
  };
}
