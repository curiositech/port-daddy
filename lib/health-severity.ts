/**
 * Health severity — the single, shared severity vocabulary that the daemon's
 * `/health` + `/status` responses, `pd doctor`, the Rust console, and FleetBar
 * all speak. Three tiers, no more:
 *
 *   - `ok`        nominal; everything the surface can prove is healthy.
 *   - `warn`      degraded but functional (arbiter rule degraded, binary drift,
 *                 an unsupervised-but-reachable daemon, a missing optional
 *                 watchdog). The operator should act, but nothing is broken yet.
 *   - `critical`  core function broken: the daemon is 404'ing its own route
 *                 contract, the registry is corrupt, or the daemon is
 *                 unsupervised AND down. CI gates and UIs go red on this.
 *
 * Keeping the mapping in ONE module is the point: before this, the daemon said
 * `status: 'ok' | 'degraded'`, the console hard-coded "ok ? green : amber", and
 * `pd doctor` had no severity at all. Three surfaces, three private opinions of
 * what "unhealthy" means. Now they import the same function.
 */

export type Severity = 'ok' | 'warn' | 'critical';

/** Total order on severities so callers can fold a list into its worst member. */
export const SEVERITY_RANK: Record<Severity, number> = { ok: 0, warn: 1, critical: 2 };

/** The worst (highest-rank) severity in a list. Empty list ⇒ `ok`. */
export function worstSeverity(severities: Severity[]): Severity {
  let worst: Severity = 'ok';
  for (const s of severities) {
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

export interface DaemonHealthInputs {
  /** Are all of the daemon's critical routes registered? (route-health.ts) */
  routesOk: boolean;
  /** How many critical routes are missing (would 404). */
  routesMissing: number;
  /** Is the runtime degraded for any reason (arbiter rules, route health…)? */
  runtimeDegraded: boolean;
  /** Has the running binary drifted older than what `pd` resolves on disk? */
  binaryDrifted?: boolean;
}

/**
 * Reduce the daemon's own self-knowledge to a single severity. This is the
 * daemon-SIDE view (it knows its routes, its runtime, its binary) — supervision
 * integrity and install-layout checks live CLI-side in `pd doctor`, because the
 * daemon cannot see the launchd job that is (or isn't) supervising it.
 *
 * ```ts
 * daemonHealthSeverity({ routesOk: false, routesMissing: 2, runtimeDegraded: true });
 * // => 'critical'  (the daemon is 404'ing its own contract)
 * daemonHealthSeverity({ routesOk: true, routesMissing: 0, runtimeDegraded: true });
 * // => 'warn'      (functional, but something is degraded)
 * ```
 */
export function daemonHealthSeverity(i: DaemonHealthInputs): Severity {
  // A daemon that cannot serve its own route contract is broken, full stop.
  if (!i.routesOk) return 'critical';
  // Functional, but the operator should look: a degraded arbiter rule or a
  // running binary that no longer matches disk.
  if (i.runtimeDegraded || i.binaryDrifted) return 'warn';
  return 'ok';
}
