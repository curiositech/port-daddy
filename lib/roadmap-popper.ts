/**
 * Roadmap-popper — autonomous task puller.
 *
 * The operator tags roadmap items `nightshift_eligible=1`. The popper picks
 * the next one (by status='backlog', no dispatch yet, dependencies satisfied),
 * hands it to the dispatch queue (lib/dispatch/queue.ts on PR #143/#163), and
 * stamps the dispatch id back on the roadmap row.
 *
 * Discipline: the popper is a PRODUCER of dispatch.state='proposed' rows.
 * It never spawns work itself, never bypasses the dispatch state machine,
 * never auto-merges. The downstream chain (runner → adversarial review →
 * harbormaster) carries the work the rest of the way.
 *
 * Safety properties:
 *   - Only items explicitly opted-in via nightshift_eligible=1 are touched.
 *   - Items with unmet dependencies are skipped (dependencies_json is read).
 *   - Same item is never popped twice (dispatch_id IS NOT NULL gate).
 *   - daily_cap_usd lives on the dispatched ship, not the popper itself.
 *
 * Wiring: in production the daemon supplies a `dispatchProposer` that calls
 * lib/dispatch/queue.ts. In tests we inject a mock. Same factory pattern as
 * createSpawner / createSugar in lib/.
 */

import type { Database } from 'better-sqlite3';

export interface RoadmapItemRow {
  id: string;
  slug: string;
  summary_md: string;
  status: 'now' | 'backlog' | 'parked' | 'merge' | 'done';
  nightshift_eligible: 0 | 1;
  dispatch_id: string | null;
  dependencies_json: string;
  last_touched_at: number;
  harbor: string;
  created_at: number;
}

export interface PopperDeps {
  /** SQLite handle (better-sqlite3). */
  db: Database;
  /** Called with the roadmap-item text → returns the new dispatch id. */
  dispatchProposer: (input: {
    goal: string;
    roadmapItemId: string;
    requestedBy: string;
  }) => Promise<{ dispatchId: string }>;
  /** Identity the popper records on the dispatch. Defaults to 'roadmap-popper'. */
  popperIdentity?: string;
  /** Logger; defaults to console.log. */
  log?: (msg: string, ...rest: unknown[]) => void;
}

export interface PoppedResult {
  itemId: string;
  itemSlug: string;
  dispatchId: string;
}

export interface PopperStatus {
  eligibleCount: number;
  poppedCount: number;
  nextCandidate: RoadmapItemRow | null;
  pausedByFlag: boolean;
}

export function createRoadmapPopper(deps: PopperDeps) {
  const db = deps.db;
  const log = deps.log ?? ((msg: string, ...rest: unknown[]) => console.log(`[popper] ${msg}`, ...rest));
  const popperIdentity = deps.popperIdentity ?? 'roadmap-popper';

  /**
   * Return the next item the popper would pop, without actually popping.
   * Useful for dry-runs and the `pd popper next` CLI command.
   */
  function nextCandidate(harbor?: string): RoadmapItemRow | null {
    const stmt = harbor
      ? db.prepare(`SELECT * FROM roadmap_items
                    WHERE nightshift_eligible = 1
                      AND status = 'backlog'
                      AND dispatch_id IS NULL
                      AND harbor = ?
                    ORDER BY last_touched_at DESC`)
      : db.prepare(`SELECT * FROM roadmap_items
                    WHERE nightshift_eligible = 1
                      AND status = 'backlog'
                      AND dispatch_id IS NULL
                    ORDER BY last_touched_at DESC`);
    const rows = (harbor ? stmt.all(harbor) : stmt.all()) as RoadmapItemRow[];
    // Filter by dependency satisfaction: skip items whose deps are not all 'done'.
    for (const row of rows) {
      if (dependenciesSatisfied(row)) return row;
    }
    return null;
  }

  /**
   * Pop one item: select the next eligible, ask the dispatch queue to create
   * a proposed dispatch, stamp dispatch_id on the roadmap row. Atomic via
   * transaction so a crash mid-pop doesn't double-write.
   */
  async function popNext(harbor?: string): Promise<PoppedResult | null> {
    const candidate = nextCandidate(harbor);
    if (!candidate) {
      log('no eligible candidate; nothing to pop');
      return null;
    }
    log(`popping ${candidate.slug} (${candidate.id})`);

    const { dispatchId } = await deps.dispatchProposer({
      goal: candidate.summary_md,
      roadmapItemId: candidate.id,
      requestedBy: popperIdentity,
    });

    // Stamp the dispatch id on the row. Use the row's current dispatch_id IS NULL
    // as a race-safety guard so two popper runs can't double-assign.
    const result = db.prepare(
      `UPDATE roadmap_items
         SET dispatch_id = ?, last_touched_at = ?
         WHERE id = ? AND dispatch_id IS NULL`
    ).run(dispatchId, Date.now(), candidate.id);

    if (result.changes === 0) {
      // Lost the race; another popper instance got there first. The dispatch
      // we just created is now orphaned — log and let the dispatch's own
      // teardown_state reconciler reap it.
      log(`race lost on ${candidate.id}; dispatch ${dispatchId} orphaned, reconciler will reap`);
      return null;
    }

    return { itemId: candidate.id, itemSlug: candidate.slug, dispatchId };
  }

  /**
   * Operator status: how many eligible items, how many popped this session,
   * what would pop next, is the disable flag set.
   */
  function status(harbor?: string): PopperStatus {
    const eligibleSql = harbor
      ? `SELECT COUNT(*) AS n FROM roadmap_items
           WHERE nightshift_eligible = 1 AND status = 'backlog' AND dispatch_id IS NULL AND harbor = ?`
      : `SELECT COUNT(*) AS n FROM roadmap_items
           WHERE nightshift_eligible = 1 AND status = 'backlog' AND dispatch_id IS NULL`;
    const poppedSql = harbor
      ? `SELECT COUNT(*) AS n FROM roadmap_items WHERE dispatch_id IS NOT NULL AND harbor = ?`
      : `SELECT COUNT(*) AS n FROM roadmap_items WHERE dispatch_id IS NOT NULL`;

    const eligibleCount = (
      harbor
        ? (db.prepare(eligibleSql).get(harbor) as { n: number })
        : (db.prepare(eligibleSql).get() as { n: number })
    ).n;
    const poppedCount = (
      harbor
        ? (db.prepare(poppedSql).get(harbor) as { n: number })
        : (db.prepare(poppedSql).get() as { n: number })
    ).n;

    return {
      eligibleCount,
      poppedCount,
      nextCandidate: nextCandidate(harbor),
      pausedByFlag: false,
    };
  }

  /** Roadmap row's dependencies_json names other roadmap_items.slug values.
   *  All must be status='done' for the item to be eligible. */
  function dependenciesSatisfied(row: RoadmapItemRow): boolean {
    let deps: string[];
    try { deps = JSON.parse(row.dependencies_json); }
    catch { deps = []; }
    if (!Array.isArray(deps) || deps.length === 0) return true;
    const placeholders = deps.map(() => '?').join(',');
    const incomplete = db.prepare(
      `SELECT COUNT(*) AS n FROM roadmap_items
         WHERE slug IN (${placeholders}) AND harbor = ? AND status != 'done'`
    ).get(...deps, row.harbor) as { n: number };
    return incomplete.n === 0;
  }

  return { popNext, nextCandidate, status, dependenciesSatisfied };
}
