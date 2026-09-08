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

import { chmodSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DEFAULT_DAEMON_PORT } from './daemon-discovery.js';
import { PD_HOME } from './paths.js';

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
  /**
   * State plane this daemon classified itself onto at boot (S1 —
   * lib/state-plane.ts): 'prod' | 'dev-latest' | 'ephemeral:<label>'.
   * Optional: set by server.ts after classification (shared/ must not import
   * lib/, so the identity resolver cannot compute it here).
   */
  plane?: string;
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
  /** State plane of the registered daemon (S1). Absent on legacy records. */
  plane?: string;
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

// ---------------------------------------------------------------------------
// Berth registry (~/.port-daddy/dev-daemons.json) — the SINGLE read/write path
// ---------------------------------------------------------------------------
//
// Historically this file's read/write logic was duplicated across
// `cli/commands/berths.ts` (the `pd dev up` launch path, which wrote the
// registry from the CLI parent process after spawning the daemon) and
// `cli/utils/berth-registry.ts` (a read-only copy for the global `--daemon`
// resolver). That meant registration only ever happened for berths launched
// via `pd dev up` — any daemon started another way (a raw binary invocation,
// a test harness, a manually-run `bun run server.ts`) was invisible to
// FleetBar's berth picker forever, no matter how long it ran, because nothing
// ever wrote it into this file. `registerDaemonBerth`/`deregisterDaemonBerth`
// below let the daemon register ITSELF at boot (see server.ts's
// `tcpServer.on('listening', ...)` handler) and remove itself on clean
// shutdown, so berth visibility no longer depends on which command launched
// the process. `pd dev up` still writes eagerly too (so `pd dev up` prints a
// correct berth summary immediately, before the daemon finishes its own boot
// sequence) — both paths converge on the same file via the same functions.

const BERTH_REGISTRY_FILE = join(PD_HOME, 'dev-daemons.json');

function isPidAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

/**
 * Read the recorded dev/codebase berths. Returns [] when missing or corrupt.
 * `registryFile` defaults to the real `~/.port-daddy/dev-daemons.json` —
 * override it in tests so they never touch the operator's actual registry.
 */
export function readDaemonBerthRegistry(registryFile: string = BERTH_REGISTRY_FILE): DevDaemonRecord[] {
  try {
    const raw = JSON.parse(readFileSync(registryFile, 'utf8'));
    if (Array.isArray(raw)) return raw as DevDaemonRecord[];
  } catch {
    // Missing or corrupt — treat as empty.
  }
  return [];
}

/**
 * Overwrite the entire registry with `records`. Exported (unlike a purely
 * internal helper) because `pd dev down`/reap flows in `cli/commands/berths.ts`
 * legitimately need to replace the whole list at once (e.g. "every berth
 * except this one I'm tearing down") — a different shape than
 * {@link registerDaemonBerth}/{@link deregisterDaemonBerth}'s single-record
 * upsert/remove semantics.
 */
export function writeDaemonBerthRegistry(
  records: DevDaemonRecord[],
  registryFile: string = BERTH_REGISTRY_FILE,
): void {
  mkdirSync(dirname(registryFile), { recursive: true, mode: 0o700 });
  writeFileSync(registryFile, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(registryFile, 0o600); } catch {}
}

/** Prune records whose pid is gone. Returns the live set (and persists it). */
export function pruneDaemonBerthRegistry(registryFile: string = BERTH_REGISTRY_FILE): DevDaemonRecord[] {
  const live = readDaemonBerthRegistry(registryFile).filter((r) => isPidAlive(r.pid));
  writeDaemonBerthRegistry(live, registryFile);
  return live;
}

/**
 * Register this daemon's own berth in the registry — called from server.ts's
 * own boot sequence once it has actually bound its port, so registration
 * covers every daemon regardless of how it was launched. A no-op for the
 * `stable` tier: the stable (brew) berth is discovered by probing
 * {@link DEFAULT_DAEMON_PORT} directly and is deliberately never recorded
 * here (see {@link DevDaemonRecord}'s docstring) — registering it too would
 * just be redundant clutter for FleetBar's berth list, not a bug fix.
 *
 * Fail-soft: registration is a visibility nicety, never a boot-blocking
 * concern. Any error is swallowed (optionally reported via `opts.onError`)
 * rather than thrown, so a corrupt/unwritable registry file can never crash
 * daemon startup. Replaces any existing record with the same label OR the
 * same port (covers a berth restarting under the same identity) before
 * appending. `opts.registryFile` overrides the real path — tests only.
 */
export function registerDaemonBerth(
  identity: DaemonBerthIdentity,
  pid: number,
  opts: { onError?: (error: Error) => void; registryFile?: string } = {},
): void {
  if (identity.tier === 'stable') return;
  if (!identity.sourceDir) return; // nothing meaningful to register without a source dir
  const registryFile = opts.registryFile ?? BERTH_REGISTRY_FILE;
  try {
    const records = pruneDaemonBerthRegistry(registryFile).filter(
      (r) => r.label !== identity.label && r.port !== identity.port,
    );
    const record: DevDaemonRecord = {
      label: identity.label,
      tier: identity.tier,
      port: identity.port,
      sourceDir: identity.sourceDir,
      pid,
      gitRev: identity.gitRev,
      color: identity.color,
      startedAt: identity.builtAt ?? new Date().toISOString(),
      // State plane (S1) — spread conditionally so legacy records keep their
      // exact JSON shape when no plane was classified.
      ...(identity.plane ? { plane: identity.plane } : {}),
    };
    records.push(record);
    writeDaemonBerthRegistry(records, registryFile);
  } catch (err) {
    opts.onError?.(err as Error);
  }
}

/**
 * Remove this daemon's own record from the registry — called from server.ts's
 * shutdown handler so a cleanly-stopped berth doesn't linger as a stale entry
 * until the next `pruneDaemonBerthRegistry()` pass notices the dead pid.
 * Fail-soft, same rationale as {@link registerDaemonBerth}.
 */
export function deregisterDaemonBerth(
  pid: number,
  opts: { onError?: (error: Error) => void; registryFile?: string } = {},
): void {
  const registryFile = opts.registryFile ?? BERTH_REGISTRY_FILE;
  try {
    const records = readDaemonBerthRegistry(registryFile).filter((r) => r.pid !== pid);
    writeDaemonBerthRegistry(records, registryFile);
  } catch (err) {
    opts.onError?.(err as Error);
  }
}
