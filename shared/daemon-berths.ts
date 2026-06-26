/**
 * Port Daddy — Daemon Berths (ADR-0084)
 *
 * A *berth* is a single, addressable daemon instance pinned to a tier, a fixed
 * or claimed port, and a brand colour. The model replaces the old "one daemon,
 * constantly swapped between stable and dev" dance (see
 * `docs/operations/daemon-and-supervision.md` "Consolidation TODO") with three
 * named, side-by-side berths:
 *
 *   - **stable**      (RC, brew release)      → canonical lane, amber
 *   - **dev-latest**  (origin/main HEAD)      → :9886 fixed lane, blue
 *   - **codebase**    (your worktree/branch)  → a `port-daddy claim`-ed port, purple
 *
 * This module is the SINGLE source of truth for berth tiers, fixed lanes,
 * colours, and the env-var names a daemon reads at boot to self-identify. Both
 * the daemon (self-identity in `GET /health`) and the CLI (`pd dev`, `pd use`,
 * `pd --daemon`) import it. Do NOT hardcode `9886`, tier strings, or colours
 * elsewhere — resolve through here.
 */

import { DEFAULT_DAEMON_PORT } from './daemon-discovery.js';

/** The three berth tiers. `stable` is the canonical default. */
export type BerthTier = 'stable' | 'dev-latest' | 'codebase';

/**
 * Fixed TCP lane for `dev-latest` (origin/main HEAD). `stable` lives on
 * {@link DEFAULT_DAEMON_PORT}; `codebase` berths get a port from
 * `port-daddy claim` and have no fixed lane.
 */
export const DEV_LATEST_PORT = 9886;

/**
 * Env-var names a daemon reads at boot to learn which berth it is. When unset,
 * the daemon defaults to the **stable, canonical** berth — so the existing brew
 * daemon transparently reports as `stable` with no launch change.
 */
export const BERTH_ENV = {
  tier: 'PD_DAEMON_TIER',
  label: 'PD_DAEMON_LABEL',
  color: 'PD_DAEMON_COLOR',
  sourceDir: 'PD_DAEMON_SOURCE_DIR',
} as const;

/** Brand colours per tier (hex). Mirrors the website brand palette family. */
export const BERTH_COLORS: Record<BerthTier, string> = {
  stable: '#E6A23C', // brand amber — "as ever"
  'dev-latest': '#3B82F6', // blue — bleeding edge
  codebase: '#A855F7', // purple — your branch, ephemeral
};

/** Human-readable default labels per tier. */
export const BERTH_DEFAULT_LABEL: Record<BerthTier, string> = {
  stable: 'stable',
  'dev-latest': 'dev-latest',
  codebase: 'codebase',
};

/** A tier is canonical (the implicit default) only when it is `stable`. */
export function isCanonicalTier(tier: BerthTier): boolean {
  return tier === 'stable';
}

/**
 * The daemon's self-reported berth identity, surfaced on `GET /health` (and
 * `GET /whoami`). Sourced from {@link BERTH_ENV} at boot; git/build fields are
 * derived at boot when unset.
 */
export interface DaemonBerthIdentity {
  tier: BerthTier;
  label: string;
  color: string;
  sourceDir: string | null;
  gitBranch: string | null;
  gitRev: string | null;
  builtAt: string | null;
  port: number;
  canonical: boolean;
}

function normalizeTier(raw: string | undefined): BerthTier {
  switch ((raw || '').trim().toLowerCase()) {
    case 'dev':
    case 'dev-latest':
    case 'latest':
      return 'dev-latest';
    case 'codebase':
    case 'branch':
    case 'worktree':
      return 'codebase';
    case 'stable':
    case 'rc':
    case '':
      return 'stable';
    default:
      // Unknown values fall back to stable so an unset/garbled env can never
      // silently promote a non-canonical berth into the default position.
      return 'stable';
  }
}

/**
 * Resolve this daemon's berth identity from the environment + a derived git
 * snapshot. Defaults to the stable, canonical berth when {@link BERTH_ENV} is
 * unset.
 *
 * `port` is the port the daemon actually bound. `gitSnapshot` is injected so
 * the daemon can derive branch/rev/builtAt once at boot (and tests stay pure).
 */
export function resolveDaemonBerthIdentity(opts: {
  env?: NodeJS.ProcessEnv;
  port: number;
  gitSnapshot?: { branch: string | null; rev: string | null; builtAt: string | null };
}): DaemonBerthIdentity {
  const env = opts.env ?? process.env;
  const tier = normalizeTier(env[BERTH_ENV.tier]);
  const label = (env[BERTH_ENV.label]?.trim()) || BERTH_DEFAULT_LABEL[tier];
  const color = (env[BERTH_ENV.color]?.trim()) || BERTH_COLORS[tier];
  const sourceDir = env[BERTH_ENV.sourceDir]?.trim() || null;
  const snap = opts.gitSnapshot ?? { branch: null, rev: null, builtAt: null };
  return {
    tier,
    label,
    color,
    sourceDir,
    gitBranch: snap.branch,
    gitRev: snap.rev,
    builtAt: snap.builtAt,
    port: opts.port,
    canonical: isCanonicalTier(tier),
  };
}

/**
 * Resolve a `pd use <target>` / `pd --daemon <target>` token to a daemon URL.
 *
 * Resolution:
 *   - `stable` / `rc`        → http://127.0.0.1:<DEFAULT_DAEMON_PORT>
 *   - `dev` / `dev-latest`   → http://127.0.0.1:<DEV_LATEST_PORT>
 *   - a full `http(s)://…`   → returned verbatim
 *   - a bare port number     → http://127.0.0.1:<port>
 *   - any other token        → looked up by label in `registry` (a recorded
 *     codebase berth); returns null if not found.
 *
 * `host` defaults to loopback. `registry` is the list of recorded dev berths
 * (see {@link DevDaemonRecord}); pass it so labels resolve.
 */
export function resolveBerthTargetUrl(
  target: string,
  registry: DevDaemonRecord[] = [],
  host = '127.0.0.1',
): { url: string; tier: BerthTier; label: string } | null {
  const t = target.trim();
  if (!t) return null;

  if (/^https?:\/\//i.test(t)) {
    return { url: t.replace(/\/$/, ''), tier: 'codebase', label: t };
  }
  const lower = t.toLowerCase();
  if (lower === 'stable' || lower === 'rc') {
    return { url: `http://${host}:${DEFAULT_DAEMON_PORT}`, tier: 'stable', label: 'stable' };
  }
  if (lower === 'dev' || lower === 'dev-latest' || lower === 'latest') {
    return { url: `http://${host}:${DEV_LATEST_PORT}`, tier: 'dev-latest', label: 'dev-latest' };
  }
  if (/^\d+$/.test(t)) {
    return { url: `http://${host}:${t}`, tier: 'codebase', label: `:${t}` };
  }
  // Label lookup against recorded codebase berths.
  const rec = registry.find((r) => r.label === t);
  if (rec) {
    return { url: `http://${host}:${rec.port}`, tier: rec.tier, label: rec.label };
  }
  return null;
}

/**
 * A recorded running dev berth, persisted to
 * `~/.port-daddy/dev-daemons.json`. The stable (brew) berth is NEVER recorded
 * here — it is discovered by probing {@link DEFAULT_DAEMON_PORT}.
 */
export interface DevDaemonRecord {
  label: string;
  tier: BerthTier;
  port: number;
  sourceDir: string;
  pid: number;
  gitRev: string | null;
  color: string;
  startedAt: string;
}

/** Default idle window before a codebase berth is auto-reaped (24h). */
export const BERTH_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The verdict for a single recorded dev berth during garbage collection:
 *   - `live`           → keep it.
 *   - `reap-dead`      → its process is gone; clean up the registry + profile dir.
 *   - `reap-orphaned`  → its source worktree was deleted; the berth has no home.
 *   - `reap-idle`      → a *codebase* berth with no activity past the TTL.
 * Stable/dev-latest are standing berths and are never idle-reaped (only dead/orphaned).
 */
export type BerthVerdict = 'live' | 'reap-dead' | 'reap-orphaned' | 'reap-idle' | 'reap-orphan-dir';

/** Why a verdict, in operator-facing words. */
export function describeVerdict(v: BerthVerdict): string {
  switch (v) {
    case 'reap-dead': return 'process gone';
    case 'reap-orphaned': return 'worktree deleted';
    case 'reap-idle': return 'idle past TTL';
    case 'reap-orphan-dir': return 'orphaned profile dir (no registry entry)';
    case 'live': return 'live';
  }
}

/** True for any verdict that should be reaped (anything but `live`). */
export function shouldReap(v: BerthVerdict): boolean {
  return v !== 'live';
}

/**
 * PURE decision: classify a berth for GC from injected signals. No IO — the caller
 * supplies liveness/worktree/activity facts so this is fully unit-tested.
 *
 * Precedence: dead > orphaned > idle > live. A berth is idle only when it is a
 * `codebase` tier AND the most recent of {last daemon activity, its own start time}
 * is older than `ttlMs` — so a freshly-launched-but-quiet berth gets a grace period
 * (its startedAt counts as a liveness signal until the TTL elapses).
 */
export function classifyBerth(
  rec: DevDaemonRecord,
  signals: { pidAlive: boolean; worktreeExists: boolean; lastActivityMs: number | null },
  now: number,
  ttlMs: number = BERTH_IDLE_TTL_MS,
): BerthVerdict {
  if (!signals.pidAlive) return 'reap-dead';
  if (!signals.worktreeExists) return 'reap-orphaned';
  // Only ephemeral per-branch (codebase) berths are idle-reaped; stable/dev-latest
  // are standing lanes meant to persist even when quiet.
  if (rec.tier === 'codebase') {
    const startedMs = Date.parse(rec.startedAt);
    const lastAlive = Math.max(signals.lastActivityMs ?? 0, Number.isNaN(startedMs) ? 0 : startedMs);
    if (now - lastAlive > ttlMs) return 'reap-idle';
  }
  return 'live';
}
