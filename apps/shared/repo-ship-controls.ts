/** Repository-wide ship permissions, shared by the signed-in relay and executor.
 * These are admin-authored runtime gates, not per-user preferences or launches.
 * No saved override inherits the trusted fleet definition. Unknown storage is OFF.
 */
export interface RepoShipControl {
  ship: string;
  enabled: number;
  revision: number;
  updated_by: string;
  updated_at: number;
}

/** Minimal shared D1 surface; neither Worker imports the other's runtime. */
export interface ShipControlsDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ success?: boolean; results?: T[] }>;
      run(): Promise<{ success: boolean; meta: { changes?: number } }>;
    };
  };
}

export type RepoShipControls =
  | { available: true; rows: RepoShipControl[] }
  | { available: false; rows: []; reason: string };

/** Why validation is shared: a malformed scope must never read as an empty policy.
 * @param repo Repository full name, already authorized by the caller.
 * @returns Case-folded GitHub name, or null for invalid scope.
 */
export function shipControlRepo(repo: string): string | null {
  return /^[a-z0-9][a-z0-9-]{0,99}\/[a-z0-9._-]{1,100}$/i.test(repo) && !['.', '..'].includes(repo.split('/')[1] ?? '')
    ? repo.toLowerCase() : null;
}

/** Why a closed shape: '*' is the repository master gate; all other keys are
 * exact ship names. The UI separately verifies membership in trusted config.
 * @param ship Submitted or stored ship name.
 * @returns Whether this is a bounded control key.
 */
export function validShipControlName(ship: string): boolean {
  return typeof ship === 'string' && ship.length > 0 && ship.length <= 256 && !/[\u0000-\u001f\u007f]/.test(ship);
}

/** Read fresh at every ship boundary, without KV or process caching. Why:
 * queued retries must observe an operator's OFF instead of an earlier snapshot.
 * Missing binding/table, corrupt rows, and errors all stop execution.
 * @param db Shared relay database.
 * @param repo Exact repository scope.
 * @returns Known persisted overrides, or explicit unavailable/OFF.
 */
export async function readRepoShipControls(
  db: ShipControlsDb | undefined, repo: string,
): Promise<RepoShipControls> {
  const scope = shipControlRepo(repo);
  const unavailable = { available: false as const, rows: [] as [], reason: 'Ship controls unavailable; no new ship work is permitted.' };
  if (!db || !scope) return unavailable;
  try {
    const result = await db.prepare(
      'SELECT ship, enabled, revision, updated_by, updated_at FROM repo_ship_controls WHERE repo_full_name = ? ORDER BY ship LIMIT 257',
    ).bind(scope).all<RepoShipControl>();
    if (result.success === false || !Array.isArray(result.results) || result.results.length > 256) return unavailable;
    if (result.results.some(row => !validShipControlName(row.ship)
      || (row.enabled !== 0 && row.enabled !== 1)
      || !Number.isSafeInteger(row.revision) || row.revision < 1)) return unavailable;
    return { available: true, rows: result.results };
  } catch {
    return unavailable;
  }
}

/** Why master OFF wins: individual ON cannot bypass a repository stop or launch a ship.
 * @param controls Fresh database witness.
 * @param ship Exact executor ship name, or '*' for the repository gate.
 * @returns Permission for future work, not running status.
 */
export function repoShipEnabled(controls: RepoShipControls, ship: string): boolean {
  return controls.available && !controls.rows.some(row =>
    (row.ship === '*' || row.ship === ship) && row.enabled === 0);
}

/** Persist one admin decision with optimistic concurrency. Why: a stale ON form
 * must not undo a more recent OFF. The database trigger appends the audit event
 * in the same transaction; deleting a user's preferences never deletes a gate.
 * @param db Shared database.
 * @param repo Authorized repository.
 * @param ship Validated trusted ship name or repository gate.
 * @param enabled Explicit desired permission.
 * @param revision Revision the operator actually saw (0 when no row existed).
 * @param actor Verified signed-in user id.
 * @returns False on stale form, true only on a persisted mutation.
 */
export async function setRepoShipControl(
  db: ShipControlsDb, repo: string, ship: string, enabled: boolean, revision: number, actor: string,
): Promise<boolean> {
  const scope = shipControlRepo(repo);
  if (!scope || !validShipControlName(ship) || !Number.isSafeInteger(revision) || revision < 0 || !actor) {
    throw new Error('Invalid ship control');
  }
  const now = Math.floor(Date.now() / 1000);
  const result = revision === 0
    ? await db.prepare(`INSERT INTO repo_ship_controls (repo_full_name, ship, enabled, revision, updated_by, updated_at)
        VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(repo_full_name, ship) DO NOTHING`)
      .bind(scope, ship, enabled ? 1 : 0, actor, now).run()
    : await db.prepare(`UPDATE repo_ship_controls SET enabled = ?, revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE repo_full_name = ? AND ship = ? AND revision = ?`)
      .bind(enabled ? 1 : 0, actor, now, scope, ship, revision).run();
  if (!result.success) throw new Error('Ship control write failed');
  // D1 includes the audit trigger in total changes. Only this scoped CAS can
  // cause a write here; zero means stale, positive means decision + history.
  return typeof result.meta.changes === 'number' && result.meta.changes > 0;
}
