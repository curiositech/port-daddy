/**
 * CLI Daemon Berths Commands (ADR-0084)
 *
 * `pd dev up | down | list` — spin tiered, colour-coded, side-by-side daemon
 * berths next to the canonical stable daemon, without ever swapping the brew
 * daemon off its canonical lane (DEFAULT_DAEMON_PORT).
 *
 * `pd use <tier|label>` — per-shell targeting: emit a shell snippet that exports
 * PORT_DADDY_URL + a PD_ACTIVE_DAEMON marker for the prompt/console banner.
 *
 * Berths are built from the daemon BINARY (never tsx — see the project rule),
 * via `scripts/build-daemon-binary.mjs` → `dist/daemon/port-daddy-daemon`, and
 * launched detached with their berth identity env (PD_DAEMON_*) set. Running
 * berths are recorded in `~/.port-daddy/dev-daemons.json`.
 */

import { existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, isAbsolute, basename } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DEFAULT_DAEMON_PORT } from '../../shared/daemon-discovery.js';
import {
  BERTH_COLORS,
  BERTH_ENV,
  BERTH_IDLE_TTL_MS,
  DEV_LATEST_PORT,
  classifyBerth,
  describeVerdict,
  pruneDaemonBerthRegistry,
  resolveBerthTargetUrl,
  shouldReap,
  writeDaemonBerthRegistry,
  type BerthTier,
  type BerthVerdict,
  type DevDaemonRecord,
} from '../../shared/daemon-berths.js';
import {
  buildDaemonProfileEnv,
  ensureDaemonProfileDir,
  getDaemonProfilesRoot,
  isProcessRunning,
  resolveDaemonProfile,
  writeDaemonProfileState,
} from '../../lib/daemon-profiles.js';
import { mergeJscSafeModeEnv, resolveDaemonLaunchCommand } from '../../shared/daemon-binary.js';
import { seedBerthDbFromProd, describeSeedResult } from '../../lib/seed-berth-db.js';
import * as ui from '../utils/ui.js';
import { posixShellQuote } from '../../lib/shell-quote.js';
import { readDevDaemonRegistry } from '../utils/berth-registry.js';
import type { CLIOptions } from '../types.js';

// Repo root: this file lives at <root>/cli/commands/berths.ts in source, and at
// <root>/dist/... when bundled. The binary build script lives at the repo root.
const __dirname = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

// Registry read/write/prune now lives in shared/daemon-berths.ts (the
// daemon itself writes here too, at boot — see registerDaemonBerth). These
// are thin local aliases so the ~10 call sites below don't need renaming.
const readRegistry = readDevDaemonRegistry;
const writeRegistry = writeDaemonBerthRegistry;
const pruneRegistry = pruneDaemonBerthRegistry;

// ---------------------------------------------------------------------------
// Garbage collection — reap dead / orphaned / idle berths and free their state
// ---------------------------------------------------------------------------

/** A berth's profile dir is keyed by the sanitized label (mirrors devUp). */
function profileNameFor(label: string): string {
  return label.replace(/[^A-Za-z0-9._-]/g, '-');
}

/** Remove a berth's isolated runtime dir (~/.port-daddy/instances/<label>/). */
function removeProfileDir(label: string): void {
  try {
    const profile = resolveDaemonProfile(profileNameFor(label));
    rmSync(profile.runtimeDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}

/** Release a codebase berth's claimed port back to the stable daemon's manager. */
async function releaseCodebasePort(label: string): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${DEFAULT_DAEMON_PORT}/ports/release`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: `pd-dev-${label}` }),
    });
  } catch {
    /* stable daemon down — best effort */
  }
}

/** The daemon's most recent activity timestamp (epoch ms), or null. Cheap probe. */
async function probeLastActivity(port: number): Promise<number | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { history?: { lastActivityAt?: number | null } };
    return body.history?.lastActivityAt ?? null;
  } catch {
    return null;
  }
}

/** Stop one berth and release its port. Profile state survives unless the caller
 * explicitly requested destructive garbage collection. */
async function reapBerth(rec: DevDaemonRecord, purgeState = false): Promise<void> {
  if (rec.port === DEFAULT_DAEMON_PORT) return; // never the stable lane
  try { process.kill(rec.pid, 'SIGTERM'); } catch { /* already gone */ }
  if (rec.tier === 'codebase') await releaseCodebasePort(rec.label);
  if (purgeState) removeProfileDir(rec.label);
}

export interface BerthReapResult { label: string; tier: BerthTier; port: number; verdict: BerthVerdict }

/**
 * Sweep the registry: classify every berth, reap the non-live ones (process gone,
 * worktree deleted, or a codebase berth idle past the TTL), and persist the
 * survivors. Returns what was reaped. Pure-ish: the decision is {@link classifyBerth}
 * (unit-tested); this only gathers signals + performs the teardown.
 */
async function gcBerths(opts: {
  now?: number;
  ttlMs?: number;
  sweepOrphanDirs?: boolean;
  purgeState?: boolean;
} = {}): Promise<BerthReapResult[]> {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? BERTH_IDLE_TTL_MS;
  const records = readRegistry();
  const reaped: BerthReapResult[] = [];
  const survivors: DevDaemonRecord[] = [];

  for (const rec of records) {
    const pidAlive = isProcessRunning(rec.pid);
    const worktreeExists = existsSync(rec.sourceDir);
    // Only probe activity when it could matter (a live-pid codebase berth).
    const lastActivityMs =
      pidAlive && worktreeExists && rec.tier === 'codebase' ? await probeLastActivity(rec.port) : null;
    const verdict = classifyBerth(rec, { pidAlive, worktreeExists, lastActivityMs }, now, ttlMs);
    if (shouldReap(verdict)) {
      await reapBerth(rec, opts.purgeState === true);
      reaped.push({ label: rec.label, tier: rec.tier, port: rec.port, verdict });
    } else {
      survivors.push(rec);
    }
  }
  writeRegistry(survivors);

  // Explicit destructive GC also removes offline profile dirs with no surviving
  // registry entry. Automatic sweeps never do this: an offline named berth is a
  // resumable durable ledger, not garbage.
  if (opts.sweepOrphanDirs) {
    const keep = new Set(survivors.map((r) => profileNameFor(r.label)));
    reaped.push(...sweepOrphanProfileDirs(keep));
  }
  return reaped;
}

/** Remove instances/<dir> whose name matches no surviving berth. Returns reaps. */
function sweepOrphanProfileDirs(keepNames: Set<string>): BerthReapResult[] {
  const reaped: BerthReapResult[] = [];
  let dirs: string[] = [];
  try {
    const root = getDaemonProfilesRoot();
    dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const name of dirs) {
      if (keepNames.has(name)) continue;
      rmSync(join(root, name), { recursive: true, force: true });
      reaped.push({ label: name, tier: 'codebase', port: 0, verdict: 'reap-orphan-dir' });
    }
  } catch {
    /* no instances dir yet — nothing to sweep */
  }
  return reaped;
}

/** Auto-sweep used by `dev up`/`dev list`: GC quietly, then surface what was reaped. */
async function autoSweep(): Promise<void> {
  const reaped = await gcBerths();
  for (const r of reaped) {
    ui.info(`  ⤬ reaped berth "${r.label}" (:${r.port}) — ${describeVerdict(r.verdict)}`);
  }
}

/** `pd dev gc` — explicit sweep with a summary; also clears the profile-dir graveyard. */
async function devGc(): Promise<void> {
  const reaped = await gcBerths({ sweepOrphanDirs: true, purgeState: true });
  if (reaped.length === 0) {
    ui.success('No stale berths — every dev berth is live.');
    return;
  }
  ui.info(`Reaped ${reaped.length} stale berth(s):`);
  for (const r of reaped) {
    ui.info(`  ⤬ "${r.label}" (${r.tier}, :${r.port}) — ${describeVerdict(r.verdict)}`);
  }
  ui.success('Stale berths torn down; ports + profile dirs freed.');
}

/**
 * Resolve the Port Daddy source-tree root (the dir containing
 * scripts/build-daemon-binary.mjs). Robust across two runtimes:
 *   - tsx/dev: `moduleDir` is inside the real tree, so the upward walk finds it.
 *   - bun-compiled binary: `moduleDir` points inside the bundle's virtual FS
 *     (e.g. "/"), so the walk fails. Previously this fell through to
 *     resolve(moduleDir,'..','..') → "/", yielding a bogus
 *     "/scripts/build-daemon-binary.mjs" and breaking `pd dev up` entirely.
 *     The operator runs `pd dev up` from inside their checkout, so we resolve
 *     from the cwd's git toplevel, then by walking up from cwd.
 * Exported for unit testing the compiled-binary fallback (pass a bogus moduleDir).
 */
export function resolveRepoRoot(moduleDir: string, cwd: string): string {
  // 1) Walk up from the module dir (works when running from the source tree).
  let dir = moduleDir;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'scripts', 'build-daemon-binary.mjs'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // 2) Compiled binary: resolve from the cwd's git checkout.
  try {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8', timeout: 2000 });
    const top = r.status === 0 ? r.stdout.trim() : '';
    if (top && existsSync(join(top, 'scripts', 'build-daemon-binary.mjs'))) return top;
  } catch { /* not a git checkout */ }
  // 3) Last resort: walk up from cwd looking for the build script.
  let here = cwd;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(here, 'scripts', 'build-daemon-binary.mjs'))) return here;
    const parent = resolve(here, '..');
    if (parent === here) break;
    here = parent;
  }
  return cwd;
}

function repoRoot(): string {
  return resolveRepoRoot(__dirname, process.cwd());
}

function gitRevOf(dir: string): string | null {
  try {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf-8', timeout: 2000 });
    if (r.status === 0) return r.stdout.trim() || null;
  } catch {
    /* not a checkout */
  }
  return null;
}

function gitBranchOf(dir: string): string | null {
  try {
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf-8', timeout: 2000 });
    if (r.status === 0) return r.stdout.trim() || null;
  } catch {
    /* not a checkout */
  }
  return null;
}

/** PURE: pick the effective `--from` when the operator passed none. On `main`/
 *  `master` (or a detached/unknown branch) keep the shared dev-latest default;
 *  on any feature branch, default to a codebase berth for THIS worktree (the
 *  common case — and the fix for the `--label`-without-`--from` footgun). */
export function defaultFrom(explicitFrom: string | undefined, branch: string | null, root: string): string {
  if (explicitFrom !== undefined) return explicitFrom;
  if (branch && branch !== 'main' && branch !== 'master' && branch !== 'HEAD') return root;
  return 'main';
}

/**
 * Resolve `--from <main|branch|worktree-path>` to a source directory + tier.
 *   - `main` (default)              → dev-latest tier, built from origin/main HEAD
 *   - an absolute/relative dir path → codebase tier, built from that worktree
 *   - a branch name                 → codebase tier, built from the current repo
 *     after checking the branch is the one checked out (we do not switch
 *     branches; the operator must already be on it or pass a worktree path)
 */
function resolveSource(from: string | undefined, root: string): { sourceDir: string; tier: BerthTier; defaultLabel: string } {
  const value = (from || 'main').trim();
  if (value.toLowerCase() === 'main') {
    return { sourceDir: root, tier: 'dev-latest', defaultLabel: 'dev-latest' };
  }
  // A path (absolute, or relative, or contains a slash) → treat as worktree dir.
  if (isAbsolute(value) || value.startsWith('.') || value.includes('/')) {
    const dir = resolve(process.cwd(), value);
    if (!existsSync(join(dir, 'scripts', 'build-daemon-binary.mjs')) && !existsSync(join(dir, 'server.ts'))) {
      throw new Error(`--from path is not a Port Daddy source tree: ${dir}`);
    }
    return { sourceDir: dir, tier: 'codebase', defaultLabel: basename(dir) };
  }
  // A bare branch name → build from the current checkout (operator is expected
  // to be on it). We label the berth by the branch name.
  return { sourceDir: root, tier: 'codebase', defaultLabel: value };
}

/**
 * Build the daemon binary from `sourceDir` and return the output path. Reuses
 * the canonical `scripts/build-daemon-binary.mjs` so the binary, manifest, and
 * smoke test are identical to a release build. Never uses tsx.
 */
function buildDaemonBinary(sourceDir: string): string {
  const buildScript = join(sourceDir, 'scripts', 'build-daemon-binary.mjs');
  const outfile = join(sourceDir, 'dist', 'daemon', 'port-daddy-daemon');
  if (!existsSync(buildScript)) {
    throw new Error(`build script missing in source tree: ${buildScript}`);
  }
  ui.info(`Building daemon binary from ${sourceDir} (bun build --compile)…`);
  // --no-smoke: the build script's smoke test binds a scratch port; we run our
  // own /health smoke after launching the berth on its real port below.
  const r = spawnSync('node', [buildScript, '--no-smoke'], {
    cwd: sourceDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error('daemon binary build failed (see output above)');
  }
  if (!existsSync(outfile)) {
    throw new Error(`build reported success but binary is missing: ${outfile}`);
  }
  return outfile;
}

/**
 * Resolve the exact compiled daemon launch contract for a codebase berth.
 *
 * Design intent: a codebase berth deliberately runs the binary just built from `sourceDir`,
 * not the caller's self-hosted CLI.  Going through the shared launch resolver
 * keeps its resource-root and native-runtime environment identical to every
 * other compiled daemon path.
 *
 * @param sourceDir Source tree whose freshly built daemon is authoritative.
 * @param binary Absolute path to that freshly built daemon binary.
 * @param profileEnv Isolated profile and berth environment for the child.
 * @returns The canonical program, arguments, and merged child environment.
 */
export function resolveCodebaseBerthLaunch(
  sourceDir: string,
  binary: string,
  profileEnv: NodeJS.ProcessEnv,
): { program: string; args: string[]; env: NodeJS.ProcessEnv } {
  const command = resolveDaemonLaunchCommand(sourceDir, {
    // The explicit binary must win over PORT_DADDY_CAN_SELF_DAEMON inherited
    // from an interactive compiled CLI. A berth is proof for its source tree.
    env: { ...profileEnv, PORT_DADDY_DAEMON_BINARY: binary },
  });
  return {
    program: command.program,
    args: command.args,
    env: mergeJscSafeModeEnv(profileEnv, command.env),
  };
}

/** Claim a codebase berth port via the running stable daemon's port manager. */
async function claimCodebasePort(label: string): Promise<number> {
  const identity = `pd-dev-${label}`;
  const url = `http://127.0.0.1:${DEFAULT_DAEMON_PORT}/ports/request`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: identity }),
  });
  if (!res.ok) {
    throw new Error(`could not claim a port for ${identity}: HTTP ${res.status} (is the stable daemon on :${DEFAULT_DAEMON_PORT}?)`);
  }
  const body = (await res.json()) as { port?: number };
  if (typeof body.port !== 'number') {
    throw new Error(`port claim returned no port for ${identity}`);
  }
  return body.port;
}

async function smokeHealth(port: number, deadlineMs = 15000): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        if (body?.status === 'ok' || body?.status === 'degraded') return body;
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// ---------------------------------------------------------------------------
// pd dev up
// ---------------------------------------------------------------------------

async function devUp(options: CLIOptions): Promise<void> {
  // Reap stale berths first, so a relaunch can reuse a label/port a dead or
  // worktree-orphaned berth was holding.
  await autoSweep();
  const root = repoRoot();
  // No --from on a feature branch → a codebase berth for this worktree (not the
  // shared dev-latest). Explicit --from always wins.
  const from = defaultFrom(options.from as string | undefined, gitBranchOf(root), root);
  if (options.from === undefined && from === root) {
    ui.info(`No --from on branch "${gitBranchOf(root)}" → codebase berth for this worktree.`);
  }
  const { sourceDir, tier, defaultLabel } = resolveSource(from, root);
  const label = ((options.label as string | undefined) || defaultLabel).trim();
  const color = BERTH_COLORS[tier];

  // Decide the port. Fixed lanes for stable/dev-latest; claimed for codebase.
  let port: number;
  if (options.port) {
    port = parseInt(String(options.port), 10);
  } else if (tier === 'dev-latest') {
    port = DEV_LATEST_PORT;
  } else {
    port = await claimCodebasePort(label);
  }

  // SAFETY RAIL: never bind the canonical stable lane.
  if (port === DEFAULT_DAEMON_PORT) {
    ui.error(`Refusing to bind :${DEFAULT_DAEMON_PORT} — that is the canonical stable daemon's lane.`);
    ui.info(`The stable berth is supervised by brew; never replace it to test. Pick another --port, or use 'dev-latest' (:${DEV_LATEST_PORT}) / a codebase berth (claimed port).`);
    process.exit(1);
  }

  // Already a berth on this label? Bail rather than double-launch.
  const existing = pruneRegistry().find((r) => r.label === label);
  if (existing) {
    ui.warn(`Berth "${label}" already running (pid ${existing.pid}, :${existing.port}). Stop it first: pd dev down ${label}`);
    process.exit(0);
  }

  const binary = buildDaemonBinary(sourceDir);
  const gitRev = gitRevOf(sourceDir);

  // Each berth gets its own isolated runtime dir / DB / socket via the daemon
  // profile machinery (~/.port-daddy/instances/<label>/), plus its berth env.
  const profile = resolveDaemonProfile(label.replace(/[^A-Za-z0-9._-]/g, '-'));
  ensureDaemonProfileDir(profile);

  // Seed the berth's (empty) DB from a point-in-time copy of the prod registry
  // so it has real board data to test against — the surfacing bug ADR-0090 §1
  // names ("a board route lived on a dev daemon; data lived on the brew
  // daemon"). One-time bootstrap via VACUUM INTO; LOCAL-ONLY tables (port
  // claims/locks) are scrubbed so the berth owns a clean port slate. Never
  // clobbers an existing berth DB. Best-effort: a fresh machine with no prod
  // registry just starts empty.
  try {
    const seed = seedBerthDbFromProd({ targetDbPath: profile.dbPath });
    ui.info(`  DB: ${describeSeedResult(seed)}`);
  } catch (err) {
    ui.warn(`  DB seed skipped (${(err as Error).message}); berth starts empty.`);
  }

  const enableFleet = options.fleet === true;
  const env = buildDaemonProfileEnv(profile, {
    port,
    nodeEnv: 'development',
    enableFleet,
  });
  env[BERTH_ENV.tier] = tier;
  env[BERTH_ENV.label] = label;
  env[BERTH_ENV.color] = color;
  env[BERTH_ENV.sourceDir] = sourceDir;
  const launch = resolveCodebaseBerthLaunch(sourceDir, binary, env);

  ui.info(`Launching ${tier} berth "${label}" on :${port} (${color})`);
  const child = spawn(launch.program, launch.args, {
    cwd: sourceDir,
    env: launch.env,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  const health = await smokeHealth(port);
  if (!health) {
    ui.error(`Berth "${label}" did not become healthy on :${port} within 15s.`);
    try { if (child.pid) process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }
    process.exit(1);
  }

  const record: DevDaemonRecord = {
    label,
    tier,
    port,
    sourceDir,
    pid: child.pid as number,
    gitRev,
    color,
    startedAt: new Date().toISOString(),
  };
  const records = pruneRegistry().filter((r) => r.label !== label);
  records.push(record);
  writeRegistry(records);
  writeDaemonProfileState(profile, {
    name: profile.name, pid: child.pid ?? null, port, preferredPort: port,
    runtimeDir: profile.runtimeDir, socketPath: profile.sockPath, ipcPath: profile.ipcPath,
    dbPath: profile.dbPath, startedAt: record.startedAt, cwd: sourceDir,
    fleetEnabled: enableFleet, fleetBarEnabled: false,
  });

  const berth = (health.daemon ?? {}) as Record<string, unknown>;
  ui.success(`${tier} berth "${label}" up — :${port}  pid ${child.pid}  ${gitRev ? `@${gitRev}` : ''}`);
  ui.info(`  version ${health.version ?? '?'}  •  branch ${berth.gitBranch ?? '?'}`);
  ui.info(`  fleet worker ${enableFleet ? 'armed' : 'disabled'}${enableFleet ? '  •  governed launches enabled' : '  •  add --fleet for governed launches'}`);
  ui.info(`  Target this shell at it:  eval "$(pd use ${label})"`);
  ui.info(`  One command against it:   pd --daemon ${label} status`);
  ui.info(`  Stop it:                  pd dev down ${label}`);
}

// ---------------------------------------------------------------------------
// pd dev down
// ---------------------------------------------------------------------------

/** Destructive berth state removal is always explicit. */
export function shouldPurgeBerthState(options: CLIOptions): boolean {
  return options.purge === true || options.reset === true;
}

async function devDown(positional: string[], options: CLIOptions): Promise<void> {
  const records = pruneRegistry();
  const all = options.all === true;
  const purgeState = shouldPurgeBerthState(options);
  const label = positional[0];

  if (!all && !label) {
    ui.error('Usage: pd dev down <label> | --all');
    process.exit(1);
  }

  const targets = all ? records : records.filter((r) => r.label === label);
  if (targets.length === 0) {
    ui.warn(all ? 'No dev berths running.' : `No dev berth labelled "${label}".`);
    process.exit(0);
  }

  for (const rec of targets) {
    // NEVER touch the stable lane.
    if (rec.port === DEFAULT_DAEMON_PORT) {
      ui.warn(`Skipping ${rec.label}: it claims the stable lane :${DEFAULT_DAEMON_PORT} (will not stop the brew daemon).`);
      continue;
    }
    try {
      process.kill(rec.pid, 'SIGTERM');
      ui.success(`Stopped berth "${rec.label}" (pid ${rec.pid}, :${rec.port}).`);
    } catch {
      ui.warn(`Berth "${rec.label}" was not running (cleaning registry).`);
    }
    // A stop releases execution resources but preserves the cool-bus ledger.
    // State destruction is a separate, explicit operator action.
    if (rec.tier === 'codebase') await releaseCodebasePort(rec.label);
    if (purgeState) {
      removeProfileDir(rec.label);
      ui.info(`  state purged: ${rec.label}`);
    } else {
      ui.info(`  state preserved: ${resolveDaemonProfile(profileNameFor(rec.label)).runtimeDir}`);
    }
  }

  const remaining = records.filter((r) => !targets.some((t) => t.label === r.label));
  writeRegistry(remaining);
}

// ---------------------------------------------------------------------------
// pd dev list
// ---------------------------------------------------------------------------

async function probeStable(): Promise<{ up: boolean; version?: string; gitRev?: string | null }> {
  try {
    const res = await fetch(`http://127.0.0.1:${DEFAULT_DAEMON_PORT}/health`);
    if (!res.ok) return { up: false };
    const body = (await res.json()) as Record<string, unknown>;
    const berth = (body.daemon ?? {}) as Record<string, unknown>;
    return { up: true, version: body.version as string | undefined, gitRev: (berth.gitRev as string | null) ?? null };
  } catch {
    return { up: false };
  }
}

async function devList(options: CLIOptions): Promise<void> {
  // Sweep before listing so the table never shows berths that are dead, orphaned,
  // or idle past the TTL. (Quiet for --json so the output stays pure JSON.)
  if (options.json === true || options.j === true) {
    await gcBerths();
  } else {
    await autoSweep();
  }
  const records = pruneRegistry();
  const stable = await probeStable();

  if (options.json === true || options.j === true) {
    console.log(JSON.stringify({
      stable: { tier: 'stable', port: DEFAULT_DAEMON_PORT, canonical: true, color: BERTH_COLORS.stable, ...stable },
      berths: records,
    }, null, 2));
    return;
  }

  ui.info('BERTH         TIER         PORT    COLOR     STATE     SOURCE');
  ui.info('────────────  ───────────  ──────  ────────  ────────  ──────────────────────────');
  const stableState = stable.up ? `up v${stable.version ?? '?'}` : 'down';
  console.log(`${pad('stable', 12)}  ${pad('stable', 11)}  ${pad(String(DEFAULT_DAEMON_PORT), 6)}  ${pad(BERTH_COLORS.stable, 8)}  ${pad(stableState, 8)}  brew release (canonical)`);
  for (const r of records) {
    const state = isProcessRunning(r.pid) ? `up` : 'dead';
    console.log(`${pad(r.label, 12)}  ${pad(r.tier, 11)}  ${pad(String(r.port), 6)}  ${pad(r.color, 8)}  ${pad(state, 8)}  ${r.sourceDir}${r.gitRev ? ` @${r.gitRev}` : ''}`);
  }
  if (records.length === 0) {
    ui.info('(no dev berths — spin one with `pd dev up --from main`)');
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

// ---------------------------------------------------------------------------
// pd dev ensure — idempotently guarantee the standing fleet (prod + dev-latest)
// ---------------------------------------------------------------------------

/**
 * Make sure the two always-on daemons exist:
 *   - stable/prod (DEFAULT_DAEMON_PORT) — brew/launchd-supervised; we only report it (never
 *     auto-manage the brew daemon), and tell the operator how to start it.
 *   - dev-latest (:9886) — a berth built from main; brought up if it is not
 *     already running (reusing `devUp` so it gets a prod-seeded DB).
 *
 * Named dev-feature berths stay opt-in (`pd dev up --from <worktree>`); this
 * only guarantees the standing pair the cut/orchestrator and FleetBar expect.
 * Idempotent: a no-op when both are already healthy.
 */
async function devEnsure(options: CLIOptions): Promise<void> {
  const stable = await probeStable();
  if (stable.up) {
    ui.success(`stable (:${DEFAULT_DAEMON_PORT}) up — v${stable.version ?? '?'}`);
  } else {
    ui.warn(`stable (:${DEFAULT_DAEMON_PORT}) is down — start it with: brew services start port-daddy  (or: pd daemon start)`);
  }

  const devLatest = pruneRegistry().find((r) => r.tier === 'dev-latest');
  if (devLatest && isProcessRunning(devLatest.pid)) {
    ui.success(`dev-latest (:${devLatest.port}) already up — pid ${devLatest.pid}.`);
    return;
  }

  ui.info('dev-latest berth not running — bringing it up from main…');
  // Force the shared dev-latest lane regardless of which branch we're on.
  await devUp({ ...options, from: 'main', label: undefined } as CLIOptions);
}

// ---------------------------------------------------------------------------
// pd dev (dispatcher)
// ---------------------------------------------------------------------------

export async function handleDevBerth(positional: string[], options: CLIOptions): Promise<void> {
  const sub = (positional[0] || '').toLowerCase();
  const rest = positional.slice(1);
  switch (sub) {
    case 'up':
    case 'start': // back-compat alias for the legacy `pd dev start`
      await devUp(options);
      break;
    case 'down':
    case 'stop': // back-compat alias for the legacy `pd dev stop`
      await devDown(rest, options);
      break;
    case 'list':
    case 'status': // back-compat alias for the legacy `pd dev status`
      await devList(options);
      break;
    case 'gc':
    case 'prune': // alias
      await devGc();
      break;
    case 'ensure': // idempotently guarantee the standing fleet (prod + dev-latest)
      await devEnsure(options);
      break;
    default:
      ui.info('Daemon Berths (ADR-0084) — tiered, colour-coded, side-by-side daemons.');
      ui.info('');
      ui.info('  pd dev up [--from main|<branch>|<worktree-path>] [--label <name>] [--port <n>] [--fleet]');
      ui.info('      Build the daemon binary from the source and launch a berth.');
      ui.info('      (no --from on a feature branch → codebase berth for THIS worktree)');
      ui.info('      --from main      → dev-latest berth on :' + DEV_LATEST_PORT + ' (blue)');
      ui.info('      --from <branch>  → codebase berth on a claimed port (purple)');
      ui.info('      --fleet          → arm the berth fleet worker for governed launches');
      ui.info('  pd dev down <label> | --all   Stop a berth and preserve its ledger.');
      ui.info('      --purge | --reset             Explicitly delete that berth ledger.');
      ui.info('  pd dev ensure                 Guarantee the standing fleet (prod + dev-latest) is up.');
      ui.info('  pd dev gc                     Destructively reap dead/orphaned/idle berth state.');
      ui.info('  pd dev list                   Show the stable berth + every dev berth.');
      ui.info('');
      ui.info('  Target a shell:   eval "$(pd use <tier|label>)"');
      ui.info('  One command:      pd --daemon <tier|label|url> <cmd>');
      break;
  }
}

// ---------------------------------------------------------------------------
// pd use — per-shell targeting
// ---------------------------------------------------------------------------

/**
 * Emit a shell snippet to `eval`. Sets PORT_DADDY_URL (so the CLI, MCP, SDK and
 * the Rust console's DaemonClient::discover all follow) + a PD_ACTIVE_DAEMON
 * marker the shell prompt / console banner can surface. `pd use stable` resets
 * to the canonical lane and clears the marker.
 *
 * Per-shell ONLY: we never write a global file that would switch all shells. A
 * non-stable berth must never become the implicit default — it is opt-in, and
 * visibly marked, per shell.
 */
export async function handleUse(positional: string[], options: CLIOptions): Promise<void> {
  const target = positional[0];
  if (!target) {
    // No arg: report the current target (human-readable, to stderr so eval is safe).
    const active = process.env.PD_ACTIVE_DAEMON || 'stable';
    const url = process.env.PORT_DADDY_URL || `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`;
    process.stderr.write(`# pd use: this shell targets "${active}" (${url})\n`);
    process.stderr.write(`# Usage: eval "$(pd use <stable|dev|dev-latest|<label>|<url>>)"\n`);
    return;
  }

  if (target.toLowerCase() === 'stable' || target.toLowerCase() === 'rc') {
    // Reset to canonical: unset the override + marker.
    process.stdout.write('unset PORT_DADDY_URL PD_ACTIVE_DAEMON;\n');
    process.stderr.write(`# pd use: shell reset to stable (:${DEFAULT_DAEMON_PORT})\n`);
    return;
  }

  const registry = pruneRegistry();
  const resolved = resolveBerthTargetUrl(target, registry);
  if (!resolved) {
    process.stderr.write(`# pd use: unknown target "${target}". Known: stable, dev, dev-latest, a label from 'pd dev list', or a URL.\n`);
    process.exit(1);
  }

  process.stdout.write(`export PORT_DADDY_URL=${posixShellQuote(resolved.url)};\n`);
  process.stdout.write(`export PD_ACTIVE_DAEMON=${posixShellQuote(resolved.label)};\n`);
  process.stderr.write(`# pd use: shell now targets "${resolved.label}" (${resolved.url}) — non-stable, marked for your prompt.\n`);
}
