#!/usr/bin/env node

/**
 * Port Daddy Daemon Installer
 *
 * Cross-platform service installer for macOS (launchctl) and Linux (systemd).
 *
 * Usage:
 *   node install-daemon.js install   - Install and start Port Daddy daemon
 *   node install-daemon.js uninstall - Stop and uninstall Port Daddy daemon
 *   node install-daemon.js status    - Check daemon status
 */

import { spawnSync } from 'child_process';
import type { SpawnSyncReturns } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir, platform } from 'os';
import { getDaemonTcpUrl } from './shared/daemon-discovery.js';
import { daemonBinaryName, resolveDaemonLaunchCommand, resolveDistributionRoot, type DaemonLaunchCommand } from './shared/daemon-binary.js';

const MODULE_DIR: string = dirname(fileURLToPath(import.meta.url));
const __dirname: string = resolveDistributionRoot(MODULE_DIR);
const PLATFORM: string = platform();
const NODE_PATH: string = process.execPath;
const LOG_PATH: string = join(__dirname, 'port-daddy.log');
const ERROR_LOG_PATH: string = join(__dirname, 'port-daddy-error.log');
const DARWIN_OPERATOR_TOOL_PATHS = [
  '/Applications/Codex.app/Contents/Resources',
  '/opt/homebrew/bin',
];
const SYSTEM_TOOL_PATHS = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

// macOS paths
export const PLIST_LABEL: string = 'com.portdaddy.daemon';
// The Homebrew `brew services` launchd job that already supervises the daemon
// (KeepAlive=true). If this is loaded, our own com.portdaddy.daemon plist would
// be a SECOND, competing supervisor for the same :daemon-port listener — that
// duplicate is exactly what docs/operations/daemon-and-supervision.md flags as
// the recurring failure mode. Detect it and refuse to create the duplicate.
export const BREW_DAEMON_LABEL: string = 'homebrew.mxcl.port-daddy';
const LAUNCH_AGENTS: string = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH: string = join(LAUNCH_AGENTS, `${PLIST_LABEL}.plist`);

// macOS auto-freshness self-heal (ADR-0062). A LaunchAgent runs
// `pd self-update --tick` every 15 min: it brew-upgrades + restarts the daemon
// onto the current release and relaunches the FleetBar GUI, hands-off. This is
// the actor that finally consumes the daemon's long-standing
// `binary_drift_detected` warning instead of merely logging it.
const FRESHNESS_PLIST_LABEL: string = 'com.portdaddy.freshness';
const FRESHNESS_PLIST_PATH: string = join(LAUNCH_AGENTS, `${FRESHNESS_PLIST_LABEL}.plist`);
// 15 min, tightened from hourly (2026-06-23): a published brew release must land
// on the running machine promptly — auto-upgrade should be a *necessary*
// consequence of pushing a new version, not an eventual one. Lower latency
// without hammering brew; a tick is a ~6s no-op when already current and only
// does real work when a newer release actually exists.
export const FRESHNESS_INTERVAL_SECONDS = 900;
const FRESHNESS_LOG_PATH: string = join(homedir(), '.port-daddy', 'logs', 'freshness.log');

// Linux paths
const SYSTEMD_USER_DIR: string = join(homedir(), '.config', 'systemd', 'user');
const SYSTEMD_UNIT: string = join(SYSTEMD_USER_DIR, 'port-daddy.service');

function isPortDaddyProcess(command: string): boolean {
  return command.includes('server.ts') ||
    command.includes(daemonBinaryName()) ||
    command.includes('port-daddy') ||
    command.includes('port_daddy');
}

function stopExistingCanonicalDaemon(): void {
  const listeners = runCommand('lsof', ['-i', ':9876', '-sTCP:LISTEN', '-Fp']);
  const pids = new Set<number>();

  for (const line of listeners.stdout.split('\n')) {
    if (!line.startsWith('p')) continue;
    const pid = parseInt(line.slice(1), 10);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    pids.add(pid);
  }

  for (const pid of pids) {
    const ps = runCommand('ps', ['-p', String(pid), '-o', 'command=']);
    const command = (ps.stdout || '').trim().split('\n')[0] || '';
    if (!isPortDaddyProcess(command)) continue;

    runCommand('kill', ['-TERM', String(pid)]);
    console.log(`  Stopped existing Port Daddy daemon (PID ${pid})`);
  }

  const stalePaths = [
    join(homedir(), '.port-daddy', 'daemon.sock'),
    join(homedir(), '.port-daddy', 'daemon.ipc'),
  ];
  for (const stalePath of stalePaths) {
    if (!existsSync(stalePath)) continue;
    try {
      unlinkSync(stalePath);
      console.log(`  Removed stale ${stalePath}`);
    } catch {
      // Leave it if something still owns it.
    }
  }
}

/**
 * Is the Homebrew-managed daemon supervisor (`homebrew.mxcl.port-daddy`)
 * already loaded? If so, the daemon is already supervised with KeepAlive and we
 * must NOT install a second `com.portdaddy.daemon` launchd job on top of it.
 *
 * Returns false on any non-darwin platform or if `launchctl` is unavailable.
 */
function brewDaemonServiceLoaded(): boolean {
  if (PLATFORM !== 'darwin') return false;
  const list: CommandResult = runCommand('launchctl', ['list']);
  if (list.status !== 0 && !list.stdout) return false;
  return list.stdout.includes(BREW_DAEMON_LABEL);
}

interface CommandResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

function runCommand(command: string, args: string[], options: Record<string, unknown> = {}): CommandResult {
  const result: SpawnSyncReturns<string> = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status
  };
}

function servicePath(...requiredDirs: string[]): string {
  const platformToolPaths = PLATFORM === 'darwin' ? DARWIN_OPERATOR_TOOL_PATHS : [];
  return [...new Set([
    ...requiredDirs,
    ...platformToolPaths,
    ...SYSTEM_TOOL_PATHS,
  ].filter(Boolean))].join(':');
}

function resolveDaemonCommand(): DaemonLaunchCommand {
  return resolveDaemonLaunchCommand(__dirname);
}

function printDaemonCommandError(err: unknown): void {
  console.error(`  ${(err as Error).message}`);
  console.error('  Refusing to install a source-backed daemon without an explicit development override.');
}

// =============================================================================
// macOS: LaunchAgent plist
// =============================================================================

function generatePlist(daemon: DaemonLaunchCommand): string {
  const programArguments = [daemon.program, ...daemon.args]
    .map(arg => `        <string>${arg}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
${programArguments}
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <!--
      ThrottleInterval provides a floor between launchd respawns. Without it,
      launchd's built-in default (10s) is the only floor between respawns.
      This is NOT a fix for the Bun 1.2.21 native-crash family the daemon can
      hit under load (issue #676) — that crash needs minutes of production
      state to trigger, so 15s does nothing to the crash itself. It is a
      cheap safety net against a *fast* boot-time crash loop (e.g. a bad
      binary that dies in <1s) burning CPU/log space with rapid restarts.
    -->
    <key>ThrottleInterval</key>
    <integer>15</integer>

    <key>StandardOutPath</key>
    <string>${LOG_PATH}</string>

    <key>StandardErrorPath</key>
    <string>${ERROR_LOG_PATH}</string>

    <key>WorkingDirectory</key>
    <string>${__dirname}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${servicePath(...daemon.pathDirs, dirname(NODE_PATH))}</string>
        <key>PORT_DADDY_RESOURCE_DIR</key>
        <string>${__dirname}</string>
        <key>PORT_DADDY_DB</key>
        <string>${join(homedir(), '.port-daddy', 'port-registry.db')}</string>
${jscSafeModeEnvXml()}
    </dict>
</dict>
</plist>`;
}

/**
 * EXPERIMENTAL, UNVALIDATED mitigation for the Bun 1.2.21 native-crash family
 * (issue #676: JSC GC segfault under concurrent-connection load —
 * `MarkedBlock::Handle::sweep` / `SlotVisitor::drain` / `LocalAllocator::
 * tryAllocateIn`, reproduced across many Bun versions through the current
 * latest). Both `useConcurrentGC` and `useConcurrentJIT` are real, documented
 * JavaScriptCore Options (WebKit's OptionsList.h; default `true` on both) that
 * move GC marking/sweeping and DFG/FTL JIT compilation onto background
 * threads running concurrently with the mutator (JS execution) thread. The
 * observed crash traces are IN that exact concurrent GC machinery, so forcing
 * both to run synchronously on the main thread instead removes the specific
 * background-thread/mutator race the crash signatures point at.
 *
 * HONEST SCOPE: this is a mechanistically-reasoned hypothesis, not a
 * confirmed fix. The crash is state/load-dependent and needs production-scale
 * memory pressure to trigger (see scripts/soak-binary.sh) — nobody, including
 * this change's author, has been able to reproduce it in a clean sandbox to
 * prove these settings prevent it. What IS validated: the compiled binary
 * boots cleanly with these env vars set (no "unknown option" warning), serves
 * requests correctly, and survives a 50-held-connection + concurrent-burst
 * load pattern mirroring the 2026-07-07 incident without any functional
 * regression. The trade-off is real and unavoidable: disabling concurrent
 * GC/JIT trades some throughput/latency for removing an entire class of
 * concurrency bug — for a coordination daemon that otherwise crashes and
 * takes minutes to recover, that trade is likely worth it, but it has not
 * been measured under real production load.
 *
 * Set PORT_DADDY_JSC_SAFE_MODE=0 before `port-daddy install` to opt out
 * (requires reinstalling the LaunchAgent to take effect).
 */
export function jscSafeModeEnvXml(): string {
  if (process.env.PORT_DADDY_JSC_SAFE_MODE === '0') return '';
  return `        <key>BUN_JSC_useConcurrentGC</key>
        <string>0</string>
        <key>BUN_JSC_useConcurrentJIT</key>
        <string>0</string>`;
}

/**
 * Resolve the absolute path to the `pd` CLI launcher for the freshness
 * LaunchAgent. launchd jobs run with a minimal PATH, so an absolute path is
 * required. Prefer `which pd` (the Homebrew symlink, typically
 * /opt/homebrew/bin/pd); fall back to the common Homebrew prefixes.
 */
function resolvePdLauncherPath(): string | null {
  const which = runCommand('which', ['pd']);
  const resolved = (which.stdout || '').trim().split('\n')[0]?.trim();
  if (resolved && existsSync(resolved)) return resolved;
  for (const candidate of ['/opt/homebrew/bin/pd', '/usr/local/bin/pd']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function generateFreshnessPlist(pdPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${FRESHNESS_PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${pdPath}</string>
        <string>self-update</string>
        <string>--tick</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>StartInterval</key>
    <integer>${FRESHNESS_INTERVAL_SECONDS}</integer>

    <key>StandardOutPath</key>
    <string>${FRESHNESS_LOG_PATH}</string>

    <key>StandardErrorPath</key>
    <string>${FRESHNESS_LOG_PATH}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${servicePath(dirname(pdPath))}</string>
        <key>PORT_DADDY_DB</key>
        <string>${join(homedir(), '.port-daddy', 'port-registry.db')}</string>
    </dict>
</dict>
</plist>`;
}

/**
 * Install the auto-freshness LaunchAgent (ADR-0062; 15-min cadence). macOS-only; the
 * `pd self-update` it runs is itself a no-op off macOS. Best-effort: a missing
 * `pd` launcher (e.g. a source checkout that hasn't `brew install`ed) skips
 * cleanly rather than failing the whole install.
 */
function installFreshnessMacOS(): boolean {
  const pdPath = resolvePdLauncherPath();
  if (!pdPath) {
    console.log('  Freshness self-heal skipped: `pd` launcher not found on PATH.');
    console.log('  It installs automatically once Port Daddy is on PATH (brew install).');
    return true;
  }

  // Ensure the freshness log directory exists so launchd can open the file.
  mkdirSync(dirname(FRESHNESS_LOG_PATH), { recursive: true });

  if (existsSync(FRESHNESS_PLIST_PATH)) {
    runCommand('launchctl', ['unload', FRESHNESS_PLIST_PATH]);
  }

  writeFileSync(FRESHNESS_PLIST_PATH, generateFreshnessPlist(pdPath));
  console.log(`  Wrote ${FRESHNESS_PLIST_PATH} (self-update every ${FRESHNESS_INTERVAL_SECONDS}s via ${pdPath})`);
  return loadLaunchAgent(FRESHNESS_PLIST_LABEL, FRESHNESS_PLIST_PATH);
}

function loadLaunchAgent(label: string, plistPath: string): boolean {
  const load: CommandResult = runCommand('launchctl', ['load', plistPath]);
  if (load.status !== 0) {
    console.error(`  Failed to load ${label}:`, load.stderr.trim());
    return false;
  }

  console.log(`  LaunchAgent loaded (${label})`);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  const kickstart = runCommand('launchctl', ['kickstart', '-k', `gui/${uid}/${label}`]);
  if (kickstart.status === 0) {
    console.log(`  LaunchAgent started (${label})`);
  } else if (kickstart.stderr.trim()) {
    console.log(`  LaunchAgent kickstart (${label}): ${kickstart.stderr.trim()}`);
  }
  return true;
}

function installMacOS(daemon: DaemonLaunchCommand): boolean {
  // Ensure LaunchAgents directory exists
  if (!existsSync(LAUNCH_AGENTS)) {
    mkdirSync(LAUNCH_AGENTS, { recursive: true });
  }

  // Unload old service if present (handles label changes)
  const oldPlist: string = join(LAUNCH_AGENTS, 'com.erichowens.port-daddy.plist');
  if (existsSync(oldPlist)) {
    runCommand('launchctl', ['unload', oldPlist]);
    try { unlinkSync(oldPlist); } catch { /* ignore */ }
    console.log('  Removed legacy plist (com.erichowens.port-daddy)');
  }

  // DEDUP GUARD: if Homebrew's `brew services` already supervises the daemon
  // (homebrew.mxcl.port-daddy, KeepAlive=true), do NOT install a second
  // launchd supervisor. Two KeepAlive jobs racing for the same listener is the
  // recurring "two daemons fighting over :daemon-port" failure. Leave the brew
  // service as the single supervisor.
  if (brewDaemonServiceLoaded()) {
    console.log(`  Detected supervised daemon via Homebrew (${BREW_DAEMON_LABEL}).`);
    console.log('  Skipping com.portdaddy.daemon launchd job to avoid a duplicate supervisor.');
    console.log('  Your daemon is already supervised; manage it with: brew services restart port-daddy');
    if (existsSync(PLIST_PATH)) {
      runCommand('launchctl', ['unload', PLIST_PATH]);
      try {
        unlinkSync(PLIST_PATH);
        console.log(`  Removed redundant ${PLIST_PATH}`);
      } catch { /* leave it if something still owns it */ }
    }
    return installFreshnessMacOS();
  }

  stopExistingCanonicalDaemon();

  // Unload current if already installed
  if (existsSync(PLIST_PATH)) {
    runCommand('launchctl', ['unload', PLIST_PATH]);
  }

  // Write plist with correct paths
  writeFileSync(PLIST_PATH, generatePlist(daemon));
  console.log(`  Wrote ${PLIST_PATH}`);

  return loadLaunchAgent(PLIST_LABEL, PLIST_PATH) && installFreshnessMacOS();
}

function uninstallMacOS(): boolean {
  // Unload both old and new labels
  for (const path of [PLIST_PATH, FRESHNESS_PLIST_PATH, join(LAUNCH_AGENTS, 'com.erichowens.port-daddy.plist')]) {
    if (existsSync(path)) {
      runCommand('launchctl', ['unload', path]);
      try {
        unlinkSync(path);
        console.log(`  Removed ${path}`);
      } catch (err: unknown) {
        console.error(`  Failed to remove ${path}: ${(err as Error).message}`);
      }
    }
  }
  return true;
}

type ServiceState = 'running' | 'installed' | 'failed' | 'not-installed' | 'legacy' | 'unsupported' | 'unknown';

function statusMacOS(): ServiceState {
  if (!existsSync(PLIST_PATH)) {
    // Check for legacy plist
    const oldPlist: string = join(LAUNCH_AGENTS, 'com.erichowens.port-daddy.plist');
    if (existsSync(oldPlist)) {
      console.log('  Legacy plist found (com.erichowens.port-daddy)');
      console.log('  Run "port-daddy install" to upgrade to new format');
      return 'legacy';
    }
    return 'not-installed';
  }

  const list: CommandResult = runCommand('launchctl', ['list']);
  return list.stdout.includes(PLIST_LABEL) ? 'running' : 'installed';
}

// =============================================================================
// Linux: systemd user service
// =============================================================================

function generateSystemdUnit(daemon: DaemonLaunchCommand): string {
  return `[Unit]
Description=Port Daddy - Authoritative Port Management Daemon
After=network.target

[Service]
Type=simple
ExecStart=${[daemon.program, ...daemon.args].join(' ')}
WorkingDirectory=${__dirname}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_PATH}
StandardError=append:${ERROR_LOG_PATH}
Environment=PATH=${servicePath(...daemon.pathDirs, dirname(NODE_PATH))}
Environment=PORT_DADDY_RESOURCE_DIR=${__dirname}

[Install]
WantedBy=default.target
`;
}

function installLinux(daemon: DaemonLaunchCommand): boolean {
  // Ensure systemd user directory exists
  if (!existsSync(SYSTEMD_USER_DIR)) {
    mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
  }

  // Write unit file
  writeFileSync(SYSTEMD_UNIT, generateSystemdUnit(daemon));
  console.log(`  Wrote ${SYSTEMD_UNIT}`);

  // Reload systemd
  const reload: CommandResult = runCommand('systemctl', ['--user', 'daemon-reload']);
  if (reload.status !== 0) {
    console.error('  Failed to reload systemd:', reload.stderr.trim());
    return false;
  }

  // Enable (start on login)
  const enable: CommandResult = runCommand('systemctl', ['--user', 'enable', 'port-daddy.service']);
  if (enable.status !== 0) {
    console.error('  Failed to enable service:', enable.stderr.trim());
    return false;
  }
  console.log('  Service enabled (auto-start on login)');

  // Start now
  const start: CommandResult = runCommand('systemctl', ['--user', 'start', 'port-daddy.service']);
  if (start.status === 0) {
    console.log('  Service started');
    return true;
  } else {
    console.error('  Failed to start service:', start.stderr.trim());
    return false;
  }
}

function uninstallLinux(): boolean {
  // Stop
  runCommand('systemctl', ['--user', 'stop', 'port-daddy.service']);
  console.log('  Service stopped');

  // Disable
  runCommand('systemctl', ['--user', 'disable', 'port-daddy.service']);
  console.log('  Service disabled');

  // Remove unit file
  for (const unit of [SYSTEMD_UNIT]) {
    if (!existsSync(unit)) continue;
    try {
      unlinkSync(unit);
      console.log(`  Removed ${unit}`);
    } catch (err: unknown) {
      console.error(`  Failed to remove unit file: ${(err as Error).message}`);
    }
  }

  // Reload
  runCommand('systemctl', ['--user', 'daemon-reload']);
  return true;
}

function statusLinux(): ServiceState {
  if (!existsSync(SYSTEMD_UNIT)) {
    return 'not-installed';
  }

  const status: CommandResult = runCommand('systemctl', ['--user', 'is-active', 'port-daddy.service']);
  const state: string = status.stdout.trim();

  if (state === 'active') return 'running';
  if (state === 'inactive') return 'installed';
  if (state === 'failed') return 'failed';
  return 'installed';
}

// =============================================================================
// Cross-platform dispatch
// =============================================================================

function install(): void {
  console.log('Installing Port Daddy daemon...');
  console.log(`  Platform: ${PLATFORM}`);
  let daemon: DaemonLaunchCommand;
  try {
    daemon = resolveDaemonCommand();
  } catch (err) {
    printDaemonCommandError(err);
    process.exit(1);
  }
  console.log(`  Mode: ${daemon.mode}`);
  console.log(`  Program: ${daemon.program}`);
  if (daemon.args.length > 0) console.log(`  Args: ${daemon.args.join(' ')}`);
  if (daemon.mode === 'source') {
    console.log('  WARNING: source daemon fallback is development-only.');
  }
  console.log('');

  let success: boolean = false;

  if (PLATFORM === 'darwin') {
    success = installMacOS(daemon);
  } else if (PLATFORM === 'linux') {
    success = installLinux(daemon);
  } else {
    console.log(`  Platform "${PLATFORM}" does not support auto-start installation.`);
    console.log('  You can still run the daemon manually:');
    console.log(`    ${[daemon.program, ...daemon.args].join(' ')}`);
    console.log('  Or: pd start');
    return;
  }

  if (success) {
    const daemonUrl = getDaemonTcpUrl();
    console.log('');
    console.log('Port Daddy daemon installed successfully.');
    console.log('  Auto-starts on login');
    console.log(`  Test: curl ${daemonUrl}/health`);
    console.log('  Logs: tail -f ' + LOG_PATH);
  }
}

function uninstall(): void {
  console.log('Uninstalling Port Daddy daemon...');

  if (PLATFORM === 'darwin') {
    uninstallMacOS();
  } else if (PLATFORM === 'linux') {
    uninstallLinux();
  } else {
    console.log(`  No system service to uninstall on "${PLATFORM}".`);
    return;
  }

  console.log('');
  console.log('Port Daddy daemon uninstalled.');
}

function status(): void {
  console.log('Checking Port Daddy status...\n');

  // Platform-specific service check
  let serviceState: ServiceState = 'unknown';
  if (PLATFORM === 'darwin') {
    serviceState = statusMacOS();
  } else if (PLATFORM === 'linux') {
    serviceState = statusLinux();
  } else {
    serviceState = 'unsupported';
  }

  switch (serviceState) {
    case 'running':
      console.log('  System service: installed and running');
      break;
    case 'installed':
      console.log('  System service: installed but not running');
      break;
    case 'failed':
      console.log('  System service: installed but failed');
      console.log('  Check logs: tail -f ' + ERROR_LOG_PATH);
      break;
    case 'legacy':
      // Already printed details
      break;
    case 'not-installed':
      console.log('  System service: not installed');
      console.log('  Install with: port-daddy install');
      break;
    case 'unsupported':
      console.log(`  System service: not available on ${PLATFORM}`);
      break;
  }

  // Check if daemon is actually responding
  console.log('');
  const daemonUrl = getDaemonTcpUrl();
  const healthResult: CommandResult = runCommand('curl', ['-s', '--connect-timeout', '2', `${daemonUrl}/health`]);
  if (healthResult.status === 0 && healthResult.stdout.includes('"status":"ok"')) {
    console.log(`  Daemon: responding at ${daemonUrl}`);
    try {
      const data: { version?: string; uptime_seconds?: number; active_ports?: number } = JSON.parse(healthResult.stdout);
      console.log(`  Version: ${data.version || 'unknown'}`);
      console.log(`  Uptime: ${data.uptime_seconds ? Math.round(data.uptime_seconds) + 's' : 'unknown'}`);
      console.log(`  Active ports: ${data.active_ports ?? 'unknown'}`);
    } catch { /* ignore parse errors */ }
  } else {
    console.log('  Daemon: not responding');
  }
}

export function runInstallDaemonCli(command: string | undefined = process.argv[2]): void {
  switch (command) {
    case 'install':
      install();
      break;
    case 'uninstall':
      uninstall();
      break;
    case 'status':
      status();
      break;
    default:
      console.log(`
Port Daddy Daemon Installer

Usage:
  node install-daemon.js install        - Install and start daemon
  node install-daemon.js uninstall      - Stop and uninstall daemon
  node install-daemon.js status         - Check daemon status

Supported platforms:
  macOS   - LaunchAgent (auto-start on login)
  Linux   - systemd user service (auto-start on login)
  Windows - Manual start only (port-daddy start)
    `);
  }
}

function isDirectCliInvocation(): boolean {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectCliInvocation()) {
  runInstallDaemonCli();
}
