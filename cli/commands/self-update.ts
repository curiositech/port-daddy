/**
 * `pd self-update` — auto-freshness self-heal.
 *
 * Keeps the live daemon AND the FleetBar GUI current and running. Run hourly by
 * the `com.portdaddy.freshness` LaunchAgent (ADR-0062), or manually. Operator
 * directive (2026-06-18): auto-upgrade + restart, hands-off — a new release should
 * land on the running machine without a manual `brew upgrade`.
 *
 * Each tick:
 *   1. `brew update`, then check `brew outdated port-daddy`.
 *   2. If a newer release exists → `brew upgrade port-daddy` + `brew services
 *      restart port-daddy` (relaunch the daemon onto current code), then relaunch
 *      FleetBar onto the new version.
 *   3. Ensure the daemon is up (resurrect via `brew services start` if down).
 *   4. Ensure FleetBar is running (launch the app if not).
 *
 * This is the "freshness self-heal" the daemon's `binary_drift_detected` warning
 * has long detected but nothing acted on (docs/operations/daemon-and-supervision.md
 * Consolidation TODO #3). It is fail-soft + loud: every action is logged to
 * `~/.port-daddy/logs/freshness.log`; a failed step never aborts the others.
 *
 * macOS-only (launchd + Homebrew + a .app GUI). A no-op elsewhere.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_DAEMON_PORT } from '../../shared/daemon-discovery.js';

const FORMULA = 'port-daddy';
const FLEETBAR_APP = join(homedir(), 'Applications', 'Port Daddy', 'FleetBar.app');
// Freshness always targets the canonical stable daemon on the default port — not
// a per-shell berth override — since it manages the brew-supervised install. The
// port literal lives ONLY in shared/daemon-discovery.ts (DEFAULT_DAEMON_PORT).
const DAEMON_HEALTH = `http://127.0.0.1:${DEFAULT_DAEMON_PORT}/health`;

/**
 * PURE decision: given `brew outdated <formula>`'s stdout, is an upgrade available?
 * `brew outdated <formula>` prints the formula when outdated and nothing when current.
 *
 * CRITICAL: for a *tapped* formula brew prints the TAP-QUALIFIED name
 * (`curiositech/tap/port-daddy`), not the bare `port-daddy` — and that is exactly
 * what the unattended freshness tick sees (non-TTY pipe). The original matcher only
 * accepted the bare name, so every tick after a release logged "already current" and
 * never upgraded. Match the formula as the last `/`-segment of the line's first token,
 * which accepts both the bare and tap-qualified forms, with or without trailing
 * version info ("… (3.20.0) < 3.21.0"). Extracted so this is unit-tested without shelling.
 */
export function isUpgradeAvailable(brewOutdatedStdout: string): boolean {
  return brewOutdatedStdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .some((l) => {
      const firstToken = l.split(/\s+/)[0] ?? '';
      const leaf = firstToken.split('/').pop(); // bare name OR last segment of tap/name
      return leaf === FORMULA;
    });
}

function logPath(): string {
  return join(homedir(), '.port-daddy', 'logs', 'freshness.log');
}

function log(message: string, now: () => Date = () => new Date()): void {
  try {
    mkdirSync(join(homedir(), '.port-daddy', 'logs'), { recursive: true });
    appendFileSync(logPath(), `[${now().toISOString()}] ${message}\n`);
  } catch {
    /* logging is best-effort */
  }
}

interface ShResult { code: number; stdout: string; stderr: string }
function sh(cmd: string, args: string[], timeoutMs = 600_000): ShResult {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * The currently-installed keg version of the formula, or null if unknown.
 * `brew list --versions port-daddy` → "port-daddy 3.21.0"; we take the last token.
 * PURE-ish: only reads, never mutates. Parser extracted + tested via {@link parseInstalledVersion}.
 */
function installedVersion(): string | null {
  const r = sh('brew', ['list', '--versions', FORMULA], 30_000);
  return r.code === 0 ? parseInstalledVersion(r.stdout) : null;
}

/** PURE: extract the version from `brew list --versions <formula>` stdout. */
export function parseInstalledVersion(brewListVersionsStdout: string): string | null {
  const line = brewListVersionsStdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${FORMULA} `));
  if (!line) return null;
  const tokens = line.split(/\s+/);
  return tokens.length > 1 ? tokens[tokens.length - 1] : null;
}

/**
 * Best-effort macOS notification so an auto-upgrade — especially a FAILED one —
 * is loud rather than silent. A silent failure is the difference between "the
 * machine self-heals" and "the machine has been stale for a week and nobody
 * knew". Escapes `osascript` string syntax; never throws.
 */
function notify(title: string, message: string): void {
  if (process.platform !== 'darwin') return;
  const esc = (s: string): string => s.replace(/["\\]/g, '\\$&');
  sh('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`], 8_000);
}

/** True when the daemon answers /health. */
function daemonUp(): boolean {
  // curl is always present on macOS; -m caps the probe.
  return sh('curl', ['-s', '-m', '3', '-o', '/dev/null', '-w', '%{http_code}', DAEMON_HEALTH], 8_000)
    .stdout.trim() === '200';
}

/** True when the FleetBar GUI process is running. */
function fleetbarRunning(): boolean {
  return sh('pgrep', ['-f', 'FleetBar.app/Contents/MacOS/FleetBar'], 8_000).code === 0;
}

function launchFleetbar(): void {
  if (!existsSync(FLEETBAR_APP)) {
    log(`FleetBar app not found at ${FLEETBAR_APP} — skipping GUI launch`);
    return;
  }
  const r = sh('open', ['-a', FLEETBAR_APP], 15_000);
  log(r.code === 0 ? 'FleetBar launched' : `FleetBar launch failed (code ${r.code}): ${r.stderr.trim()}`);
}

export interface SelfUpdateOptions {
  /** When true (the LaunchAgent path), suppress human-facing console output — log only. */
  tick?: boolean;
}

export async function handleSelfUpdate(options: SelfUpdateOptions = {}): Promise<void> {
  const quiet = !!options.tick;
  const say = (m: string): void => { if (!quiet) console.log(m); };

  if (process.platform !== 'darwin') {
    log('self-update is macOS-only; no-op on this platform');
    say('pd self-update is macOS-only (launchd + Homebrew). No-op here.');
    return;
  }

  // 1. Refresh the tap + check for a newer release. A failed/timed-out `brew
  //    update` leaves the local formula cache stale, so `brew outdated` reports
  //    nothing and the upgrade silently never fires — masquerading as "already
  //    current". That is the exact failure that kept this machine on an old
  //    release through a published bump. Give it room (a busy machine with many
  //    outdated formulae routinely takes >120s) and log when it fails so a stuck
  //    refresh is visible instead of passing as healthy.
  const updated = sh('brew', ['update'], 300_000);
  if (updated.code !== 0) {
    log(`brew update failed (code ${updated.code}) — tap may be stale this tick, version check unreliable: ${updated.stderr.trim()}`);
  }
  const outdated = sh('brew', ['outdated', FORMULA], 60_000);

  if (isUpgradeAvailable(outdated.stdout)) {
    // Record what we're moving off of, so the log names the actual version
    // transition whenever the daemon is updated (not just "upgraded").
    const fromVersion = installedVersion();
    log(`newer ${FORMULA} available (on ${fromVersion ?? 'unknown'}) → upgrading`);
    say(`Upgrading ${FORMULA}…`);
    // 2. Upgrade + restart the daemon onto current code.
    const up = sh('brew', ['upgrade', FORMULA]);
    if (up.code === 0) {
      sh('brew', ['services', 'restart', FORMULA]);
      const toVersion = installedVersion();
      const transition = `${fromVersion ?? '?'} → ${toVersion ?? '?'}`;
      log(`daemon upgraded ${transition} + restarted`);
      say(`Daemon upgraded ${transition} + restarted.`);
      notify('Port Daddy upgraded', `${FORMULA} ${transition} installed and the daemon restarted onto it.`);
      // Relaunch FleetBar onto the new version (kill; step 4 below brings it back).
      sh('pkill', ['-f', 'FleetBar.app/Contents/MacOS/FleetBar'], 8_000);
    } else {
      log(`brew upgrade failed (code ${up.code}): ${up.stderr.trim()}`);
      say('Upgrade failed — see ~/.port-daddy/logs/freshness.log');
      // Loud, not silent: a failed auto-upgrade must not pass unnoticed, or the
      // machine stays stale indefinitely while believing it self-heals.
      notify('Port Daddy auto-upgrade FAILED', `brew upgrade ${FORMULA} exited ${up.code}. Upgrade manually; see ~/.port-daddy/logs/freshness.log.`);
    }
  } else {
    log('daemon already current');
    say('Daemon already current.');
  }

  // 3. Ensure the daemon is up (resurrect if down — e.g. after the restart, or a crash).
  if (!daemonUp()) {
    log('daemon down → starting');
    sh('brew', ['services', 'start', FORMULA]);
  }

  // 4. Ensure FleetBar is running.
  if (!fleetbarRunning()) {
    log('FleetBar not running → launching');
    launchFleetbar();
  }

  say('Freshness tick complete.');
}
