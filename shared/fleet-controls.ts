/** Cloud Fleet's single control contract. No KV allows, caches or runtime startup. */
export interface FleetControl {
  scope: string;
  enabled: boolean;
  revision: number;
  available: boolean;
}

/** Minimal primary-session contract, usable by Workers and Node typecheck graphs. */
export interface FleetControlDatabase {
  withSession(constraint: 'first-primary'): { prepare(query: string): FleetControlStatement };
}

/** D1's structural query surface; no ambient Worker globals leak into shared code. */
interface FleetControlStatement {
  bind(...values: unknown[]): FleetControlStatement;
  all<T>(): Promise<{ success: boolean; results: T[] }>;
  first<T>(): Promise<T | null>;
}

/** Purpose: identify the billed installation, never a caller's login alias.
 * @param id Verified positive GitHub installation ID.
 * @returns Its canonical storage key; invalid identities throw.
 */
export function installationScope(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID_INSTALLATION');
  return `installation:${id}`;
}

/** Design: only the global switch and positive installation IDs inhabit this table.
 * @param scope Proposed control key.
 * @returns Whether the key is canonical and bounded.
 */
function validScope(scope: string): boolean {
  return scope === 'global' || /^installation:[1-9]\d*$/.test(scope)
    && Number.isSafeInteger(Number(scope.slice(13)));
}

/** Purpose: parse storage as untrusted data; only the exact integer 1 means on.
 * @param scope Expected key from the authorized request.
 * @param row Database row or absence.
 * @returns Valid control state; malformed records throw instead of allowing work.
 */
function decode(scope: string, row: Record<string, unknown> | undefined): FleetControl {
  if (!row) return { scope, enabled: false, revision: 0, available: true };
  if (row.scope !== scope || (row.enabled !== 0 && row.enabled !== 1)
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1) {
    throw new Error('INVALID_CONTROL');
  }
  return { scope, enabled: row.enabled === 1, revision: Number(row.revision), available: true };
}

/**
 * Purpose: one fresh primary query per boundary, including both levels together.
 * @param db Shared relay/executor D1 binding, never a cached session.
 * @param scopes Exact server-derived control keys.
 * @returns Validated current settings; missing rows are off, failures throw.
 */
async function readControls(db: FleetControlDatabase | undefined, scopes: string[]): Promise<FleetControl[]> {
  if (!db || scopes.some(scope => !validScope(scope))) throw new Error('CONTROL_UNAVAILABLE');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      db.withSession('first-primary').prepare(
        `SELECT scope, enabled, revision FROM fleet_controls WHERE scope IN (${scopes.map(() => '?').join(',')})`,
      ).bind(...scopes).all<Record<string, unknown>>(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('CONTROL_TIMEOUT')), 2000); }),
    ]);
    if (!result.success || !Array.isArray(result.results)) throw new Error('CONTROL_UNAVAILABLE');
    if (result.results.some(row => !row || !scopes.includes(String(row.scope)))
      || new Set(result.results.map(row => row.scope)).size !== result.results.length) throw new Error('INVALID_CONTROL');
    return scopes.map(scope => decode(scope, result.results.find(row => row.scope === scope)));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Read-side purpose: an unavailable control is unknown, never a saved stop.
 * @param db Shared primary database, potentially absent.
 * @param scope Exact server-derived control key.
 * @returns Displayable state that distinguishes missing from unavailable.
 */
export async function readFleetControl(db: FleetControlDatabase | undefined, scope: string): Promise<FleetControl> {
  try { return (await readControls(db, [scope]))[0]!; }
  catch { return { scope, enabled: false, revision: 0, available: false }; }
}

/**
 * Purpose: positive admission requires both explicit enables, never a free-tier exception.
 * @param db Shared D1, checked afresh including queued/continuation work.
 * @param installationId Trusted webhook/job installation identity.
 * @returns False on absent, malformed, unreadable or stopped control state.
 */
export async function fleetMayRun(db: FleetControlDatabase | undefined, installationId: number | null | undefined): Promise<boolean> {
  try {
    if (installationId == null) return false;
    return (await readControls(db, ['global', installationScope(installationId)])).every(control => control.enabled);
  } catch { return false; }
}

/** A stop is a terminal admission refusal, not a model failure to retry. */
export class FleetStoppedError extends Error {
  constructor() { super('FLEET_STOPPED'); this.name = 'FleetStoppedError'; }
}

/** Purpose: check each guarded action boundary; a prior allow is not a lease.
 * @param db Shared primary database, potentially absent.
 * @param installationId Verified logical run's installation.
 * @returns Completion only while both controls allow; otherwise a terminal stop error.
 */
export async function assertFleetMayRun(db: FleetControlDatabase | undefined, installationId: number | null | undefined): Promise<void> {
  if (!(await fleetMayRun(db, installationId))) throw new FleetStoppedError();
}

/**
 * Purpose: compare-and-swap prevents a stale form from reversing a later stop.
 * SQL triggers write the audit in the same transaction; failure rolls back both.
 * @param db Shared D1 primary binding.
 * @param scope Server-authorized target; this helper does not authenticate callers.
 * @param enabled Explicit requested setting.
 * @param revision Exact revision displayed by the page (zero means absent).
 * @param actor Authenticated account id, never supplied by the form.
 * @returns The durable updated row; a failed precondition throws STALE_CONTROL.
 */
export async function writeFleetControl(db: FleetControlDatabase, scope: string, enabled: boolean, revision: number, actor: string): Promise<FleetControl> {
  if (!validScope(scope) || typeof enabled !== 'boolean' || !Number.isSafeInteger(revision)
    || revision < 0 || revision >= Number.MAX_SAFE_INTEGER || !actor.trim()) throw new Error('INVALID_CONTROL');
  const row = await db.withSession('first-primary').prepare(`
    INSERT INTO fleet_controls(scope, enabled, revision, updated_by, updated_at)
    SELECT ?, ?, 1, ?, ? WHERE ? = 0 OR EXISTS(SELECT 1 FROM fleet_controls WHERE scope = ?)
    ON CONFLICT(scope) DO UPDATE SET enabled = excluded.enabled,
      revision = fleet_controls.revision + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    WHERE fleet_controls.revision = ?
    RETURNING scope, enabled, revision
  `).bind(scope, enabled ? 1 : 0, actor, Math.floor(Date.now() / 1000), revision, scope, revision)
    .first<Record<string, unknown>>();
  if (!row) throw new Error('STALE_CONTROL');
  return decode(scope, row);
}
