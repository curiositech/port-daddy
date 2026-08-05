#!/usr/bin/env node

/**
 * Port Daddy daemon service integration.
 *
 * One OS service manager owns resurrection:
 *
 * - macOS: Homebrew's `homebrew.mxcl.port-daddy` launchd service
 * - Linux: the `port-daddy.service` systemd user unit
 *
 * The daemon publishes PID, port, health, and heartbeat evidence. It does not
 * install another watchdog. A separate macOS freshness timer may ask Homebrew
 * to upgrade the formula, but it never starts or supervises the daemon itself.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDaemonUrl } from './shared/daemon-discovery.js';
import {
  jscSafeModeEnv,
  resolveDaemonLaunchCommand,
  resolveDistributionRoot,
  type DaemonLaunchCommand,
} from './shared/daemon-binary.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const RESOURCE_ROOT = resolveDistributionRoot(MODULE_DIR);
const PLATFORM = platform();
const DURABLE_HOME = join(homedir(), '.port-daddy');
const LOG_PATH = join(DURABLE_HOME, 'port-daddy.log');
const ERROR_LOG_PATH = join(DURABLE_HOME, 'port-daddy-error.log');
const LAUNCH_AGENTS = join(homedir(), 'Library', 'LaunchAgents');
const SYSTEMD_USER_DIR = join(homedir(), '.config', 'systemd', 'user');
const SYSTEMD_UNIT = join(SYSTEMD_USER_DIR, 'port-daddy.service');

export const BREW_DAEMON_LABEL = 'homebrew.mxcl.port-daddy';

// These labels are migration inputs only. Port Daddy 3.28 unloads and removes
// the jobs once; no current code emits or starts them. `com.bosun.daemon` is a
// separate product and is intentionally absent from this cleanup list.
export const RETIRED_PORT_DADDY_LABELS = [
  'com.portdaddy.daemon',
  'com.portdaddy.bosun',
  'com.erichowens.port-daddy',
] as const;
const RETIRED_SYSTEMD_UNITS = ['port-daddy-bosun.service'] as const;

const FRESHNESS_PLIST_LABEL = 'com.portdaddy.freshness';
const FRESHNESS_PLIST_PATH = join(LAUNCH_AGENTS, `${FRESHNESS_PLIST_LABEL}.plist`);
const FRESHNESS_LOG_PATH = join(DURABLE_HOME, 'logs', 'freshness.log');
export const FRESHNESS_INTERVAL_SECONDS = 900;

const DARWIN_OPERATOR_TOOL_PATHS = [
  '/Applications/Codex.app/Contents/Resources',
  '/opt/homebrew/bin',
];
const SYSTEM_TOOL_PATHS = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

interface CommandResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

type ServiceState = 'running' | 'installed' | 'failed' | 'not-installed' | 'unsupported';

function runCommand(command: string, args: string[], options: Record<string, unknown> = {}): CommandResult {
  const result: SpawnSyncReturns<string> = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

function servicePath(...requiredDirs: string[]): string {
  const platformDirs = PLATFORM === 'darwin' ? DARWIN_OPERATOR_TOOL_PATHS : [];
  return [...new Set([...requiredDirs, ...platformDirs, ...SYSTEM_TOOL_PATHS].filter(Boolean))].join(':');
}

/** Render the process-start JSC safety switches used by launchd fixtures. */
export function jscSafeModeEnvXml(): string {
  return Object.entries(jscSafeModeEnv())
    .map(([key, value]) => `        <key>${key}</key>\n        <string>${value}</string>`)
    .join('\n');
}

function resolvePdLauncherPath(): string | null {
  const resolved = runCommand('which', ['pd']).stdout.trim().split('\n')[0]?.trim();
  if (resolved && existsSync(resolved)) return resolved;
  for (const candidate of ['/opt/homebrew/bin/pd', '/usr/local/bin/pd']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Render the updater-only LaunchAgent. It never supervises the daemon. */
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
        <string>${join(DURABLE_HOME, 'port-registry.db')}</string>
    </dict>
</dict>
</plist>`;
}

function launchdDomain(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  return `gui/${uid}`;
}

function bootoutLaunchAgent(label: string, plistPath: string): void {
  runCommand('launchctl', ['bootout', `${launchdDomain()}/${label}`]);
  if (!existsSync(plistPath)) return;
  try {
    unlinkSync(plistPath);
    console.log(`  Removed retired ${plistPath}`);
  } catch (error) {
    console.error(`  Failed to remove ${plistPath}: ${(error as Error).message}`);
  }
}

/**
 * Remove only Port Daddy-owned legacy jobs. This is idempotent release
 * migration, not a second supervisor or a broad launchd cleanup.
 */
export function cleanupRetiredMacOSJobs(): void {
  for (const label of RETIRED_PORT_DADDY_LABELS) {
    bootoutLaunchAgent(label, join(LAUNCH_AGENTS, `${label}.plist`));
  }
}

function installFreshnessMacOS(): boolean {
  const pdPath = resolvePdLauncherPath();
  if (!pdPath) {
    console.log('  Freshness timer skipped: `pd` is not installed on PATH.');
    return true;
  }

  mkdirSync(LAUNCH_AGENTS, { recursive: true });
  mkdirSync(dirname(FRESHNESS_LOG_PATH), { recursive: true });
  runCommand('launchctl', ['bootout', `${launchdDomain()}/${FRESHNESS_PLIST_LABEL}`]);
  writeFileSync(FRESHNESS_PLIST_PATH, generateFreshnessPlist(pdPath));
  const bootstrap = runCommand('launchctl', ['bootstrap', launchdDomain(), FRESHNESS_PLIST_PATH]);
  if (bootstrap.status !== 0) {
    console.error(`  Failed to install freshness timer: ${bootstrap.stderr.trim()}`);
    return false;
  }
  console.log(`  Freshness timer installed (${FRESHNESS_INTERVAL_SECONDS}s cadence)`);
  return true;
}

function installMacOS(): boolean {
  cleanupRetiredMacOSJobs();
  const brew = runCommand('brew', ['services', 'start', 'port-daddy']);
  if (brew.status !== 0) {
    console.error(`  Homebrew service start failed: ${brew.stderr.trim() || brew.stdout.trim()}`);
    console.error('  Port Daddy refuses to install a competing LaunchAgent.');
    return false;
  }
  console.log(`  Homebrew launchd service owns daemon resurrection (${BREW_DAEMON_LABEL})`);
  return installFreshnessMacOS();
}

function uninstallMacOS(): boolean {
  runCommand('brew', ['services', 'stop', 'port-daddy']);
  bootoutLaunchAgent(FRESHNESS_PLIST_LABEL, FRESHNESS_PLIST_PATH);
  cleanupRetiredMacOSJobs();
  return true;
}

function statusMacOS(): ServiceState {
  const result = runCommand('launchctl', ['print', `${launchdDomain()}/${BREW_DAEMON_LABEL}`]);
  if (result.status !== 0) return 'not-installed';
  return /^\s*state\s*=\s*running\s*$/m.test(result.stdout) ? 'running' : 'installed';
}

/** Render the single Linux systemd user service. */
export function generateSystemdUnit(daemon: DaemonLaunchCommand): string {
  const env = { ...jscSafeModeEnv(), ...(daemon.env ?? {}) };
  const envLines = Object.entries(env)
    .map(([key, value]) => `Environment=${key}=${value}`)
    .join('\n');
  return `[Unit]
Description=Port Daddy daemon
After=network.target

[Service]
Type=simple
ExecStart=${[daemon.program, ...daemon.args].join(' ')}
WorkingDirectory=${RESOURCE_ROOT}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_PATH}
StandardError=append:${ERROR_LOG_PATH}
Environment=PATH=${servicePath(...daemon.pathDirs, dirname(process.execPath))}
Environment=PORT_DADDY_RESOURCE_DIR=${RESOURCE_ROOT}
${envLines}

[Install]
WantedBy=default.target
`;
}

function cleanupRetiredLinuxJobs(): void {
  for (const unit of RETIRED_SYSTEMD_UNITS) {
    runCommand('systemctl', ['--user', 'disable', '--now', unit]);
    const path = join(SYSTEMD_USER_DIR, unit);
    if (existsSync(path)) unlinkSync(path);
  }
}

function installLinux(daemon: DaemonLaunchCommand): boolean {
  mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
  cleanupRetiredLinuxJobs();
  writeFileSync(SYSTEMD_UNIT, generateSystemdUnit(daemon));
  const reload = runCommand('systemctl', ['--user', 'daemon-reload']);
  if (reload.status !== 0) {
    console.error(`  systemd reload failed: ${reload.stderr.trim()}`);
    return false;
  }
  const enable = runCommand('systemctl', ['--user', 'enable', '--now', 'port-daddy.service']);
  if (enable.status !== 0) {
    console.error(`  systemd service start failed: ${enable.stderr.trim()}`);
    return false;
  }
  console.log('  systemd user service owns daemon resurrection (port-daddy.service)');
  return true;
}

function uninstallLinux(): boolean {
  runCommand('systemctl', ['--user', 'disable', '--now', 'port-daddy.service']);
  cleanupRetiredLinuxJobs();
  if (existsSync(SYSTEMD_UNIT)) unlinkSync(SYSTEMD_UNIT);
  runCommand('systemctl', ['--user', 'daemon-reload']);
  return true;
}

function statusLinux(): ServiceState {
  const result = runCommand('systemctl', ['--user', 'is-active', 'port-daddy.service']);
  const state = result.stdout.trim();
  if (state === 'active') return 'running';
  if (state === 'failed') return 'failed';
  return existsSync(SYSTEMD_UNIT) ? 'installed' : 'not-installed';
}

function resolveLinuxDaemonCommand(): DaemonLaunchCommand {
  try {
    return resolveDaemonLaunchCommand(RESOURCE_ROOT);
  } catch (error) {
    console.error(`  ${(error as Error).message}`);
    console.error('  Build the daemon binary, or use `pd dev up` for source development.');
    throw error;
  }
}

function install(): void {
  console.log('Installing Port Daddy daemon service...');
  let success = false;
  if (PLATFORM === 'darwin') {
    success = installMacOS();
  } else if (PLATFORM === 'linux') {
    success = installLinux(resolveLinuxDaemonCommand());
  } else {
    console.log(`  Platform ${PLATFORM} has no automatic service integration.`);
    return;
  }
  if (!success) {
    process.exitCode = 1;
    return;
  }
  console.log(`  Runtime endpoint: ${resolveDaemonUrl()}`);
}

function installFreshness(): void {
  if (PLATFORM !== 'darwin') return;
  cleanupRetiredMacOSJobs();
  if (!installFreshnessMacOS()) process.exitCode = 1;
}

function uninstall(): void {
  if (PLATFORM === 'darwin') uninstallMacOS();
  else if (PLATFORM === 'linux') uninstallLinux();
  else console.log(`  No system service to uninstall on ${PLATFORM}.`);
}

function status(): void {
  const serviceState = PLATFORM === 'darwin'
    ? statusMacOS()
    : PLATFORM === 'linux'
      ? statusLinux()
      : 'unsupported';
  console.log(`System supervisor: ${serviceState}`);
  const daemonUrl = resolveDaemonUrl();
  const health = runCommand('curl', ['-sS', '--connect-timeout', '2', `${daemonUrl}/health`]);
  if (health.status === 0 && health.stdout.includes('"status":"ok"')) {
    console.log(`Daemon: responding at ${daemonUrl}`);
  } else {
    console.log(`Daemon: not responding at ${daemonUrl}`);
  }
}

export function runInstallDaemonCli(command: string | undefined = process.argv[2]): void {
  switch (command) {
    case 'install':
      install();
      break;
    case 'install-freshness':
      installFreshness();
      break;
    case 'uninstall':
      uninstall();
      break;
    case 'status':
      status();
      break;
    default:
      console.log(`Port Daddy daemon service integration

Usage:
  port-daddy install             Install/start the one OS-managed daemon service
  port-daddy install-freshness   Install the updater-only macOS cadence job
  port-daddy uninstall           Stop and remove Port Daddy-owned service jobs
  port-daddy status              Inspect the OS supervisor and resolved endpoint`);
  }
}

function isDirectCliInvocation(): boolean {
  return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectCliInvocation()) runInstallDaemonCli();
