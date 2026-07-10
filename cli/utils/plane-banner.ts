/**
 * CLI Plane Banner (S1 — daemon plane identity)
 *
 * Before the FIRST mutating request a CLI process sends through the resolved
 * daemon, probe `GET /version` once and print a single stderr line when the
 * daemon's state plane is not `prod`:
 *
 *   ⚠ writes → dev-latest (http://127.0.0.1:9886)
 *
 * The operator hazard this guards: a shell pointed at a dev/ephemeral daemon
 * (PORT_DADDY_URL, `pd use dev`, a worktree berth) silently absorbs writes —
 * notes, sessions, claims — into disposable state. One cheap line makes the
 * blast radius visible without blocking anything.
 *
 * Cheapness contract (spec'd):
 *   - read-only commands never probe (GET/HEAD/OPTIONS skip outright);
 *   - at most ONE probe per process, with a short timeout;
 *   - fetch failures and legacy daemons (no `plane` field) stay silent;
 *   - `PORT_DADDY_NO_PLANE_BANNER=1` disables it (scripts, tests).
 *
 * All IO is injected so tests/unit/plane-banner.test.js covers this fully.
 */

/** Kill switch for scripts that legitimately hammer non-prod daemons. */
export const PLANE_BANNER_DISABLE_ENV = 'PORT_DADDY_NO_PLANE_BANNER';

/** Timeout for the one-shot /version probe. Short — the banner must be cheap. */
export const PLANE_PROBE_TIMEOUT_MS = 500;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True for HTTP verbs that write daemon state. Undefined/GET/HEAD → false. */
export function isMutatingMethod(method: string | undefined): boolean {
  return MUTATING_METHODS.has((method ?? '').toUpperCase());
}

/** The single warning line (no trailing newline). */
export function formatPlaneWarning(plane: string, url: string): string {
  return `⚠ writes → ${plane} (${url})`;
}

// Once-per-process latch. Set the moment a probe is attempted so a slow or
// failing daemon can never turn every subsequent command into a re-probe.
let checkedThisProcess = false;

/** Reset the once-per-process latch. Tests only. */
export function resetPlaneBannerForTests(): void {
  checkedThisProcess = false;
}

export interface PlaneBannerOptions {
  /** HTTP method of the command about to run. Only mutating verbs probe. */
  method: string | undefined;
  /** One-shot /version fetch. Must already carry its own short timeout. */
  fetchVersion: () => Promise<Record<string, unknown> | null>;
  /** Display URL of the resolved daemon (for the warning line). */
  daemonUrl: () => string;
  /** Line sink. Defaults to process.stderr. */
  write?: (line: string) => void;
  /** Env source. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Print the non-prod-plane warning if (and only if) this is the process's
 * first mutating command against a daemon that self-reports a non-prod plane.
 * Never throws; silent on any failure.
 */
export async function maybeWarnNonProdPlane(opts: PlaneBannerOptions): Promise<void> {
  const env = opts.env ?? process.env;
  if (checkedThisProcess) return;
  if (!isMutatingMethod(opts.method)) return;
  if (env[PLANE_BANNER_DISABLE_ENV] === '1') {
    checkedThisProcess = true;
    return;
  }
  checkedThisProcess = true;
  try {
    const version = await opts.fetchVersion();
    const plane = typeof version?.plane === 'string' ? version.plane : null;
    if (!plane || plane === 'prod') return;
    const write = opts.write ?? ((line: string) => { process.stderr.write(line); });
    write(`${formatPlaneWarning(plane, opts.daemonUrl())}\n`);
  } catch {
    // Silent by contract: the banner is advisory and must never break a command.
  }
}
