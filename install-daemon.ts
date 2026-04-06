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
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, platform } from 'os';

const __dirname: string = dirname(fileURLToPath(import.meta.url));
const PLATFORM: string = platform();
const NODE_PATH: string = process.execPath;
const TSX_PATH: string = join(__dirname, 'node_modules', '.bin', 'tsx');
const SERVER_PATH: string = join(__dirname, 'server.ts');
const LOG_PATH: string = join(__dirname, 'port-daddy.log');
const ERROR_LOG_PATH: string = join(__dirname, 'port-daddy-error.log');

// macOS paths
const PLIST_LABEL: string = 'com.portdaddy.daemon';
const LAUNCH_AGENTS: string = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH: string = join(LAUNCH_AGENTS, `${PLIST_LABEL}.plist`);

// Linux paths
const SYSTEMD_USER_DIR: string = join(homedir(), '.config', 'systemd', 'user');
const SYSTEMD_UNIT: string = join(SYSTEMD_USER_DIR, 'port-daddy.service');

function isPortDaddyProcess(command: string): boolean {
  return command.includes('server.ts') ||
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

// =============================================================================
// macOS: LaunchAgent plist
// =============================================================================

function generatePlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${TSX_PATH}</string>
        <string>${SERVER_PATH}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>StandardOutPath</key>
    <string>${LOG_PATH}</string>

    <key>StandardErrorPath</key>
    <string>${ERROR_LOG_PATH}</string>

    <key>WorkingDirectory</key>
    <string>${__dirname}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${dirname(TSX_PATH)}:${dirname(NODE_PATH)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>`;
}

function installMacOS(): boolean {
  // Ensure LaunchAgents directory exists
  if (!existsSync(LAUNCH_AGENTS)) {
    mkdirSync(LAUNCH_AGENTS, { recursive: true });
  }

  stopExistingCanonicalDaemon();

  // Unload old service if present (handles label changes)
  const oldPlist: string = join(LAUNCH_AGENTS, 'com.erichowens.port-daddy.plist');
  if (existsSync(oldPlist)) {
    runCommand('launchctl', ['unload', oldPlist]);
    try { unlinkSync(oldPlist); } catch { /* ignore */ }
    console.log('  Removed legacy plist (com.erichowens.port-daddy)');
  }

  // Unload current if already installed
  if (existsSync(PLIST_PATH)) {
    runCommand('launchctl', ['unload', PLIST_PATH]);
  }

  // Write plist with correct paths
  writeFileSync(PLIST_PATH, generatePlist());
  console.log(`  Wrote ${PLIST_PATH}`);

  // Load
  const load: CommandResult = runCommand('launchctl', ['load', PLIST_PATH]);
  if (load.status === 0) {
    console.log('  LaunchAgent loaded');
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
    const kickstart = runCommand('launchctl', ['kickstart', '-k', `gui/${uid}/${PLIST_LABEL}`]);
    if (kickstart.status === 0) {
      console.log('  LaunchAgent started');
    } else if (kickstart.stderr.trim()) {
      console.log(`  LaunchAgent kickstart: ${kickstart.stderr.trim()}`);
    }
    return true;
  } else {
    console.error('  Failed to load LaunchAgent:', load.stderr.trim());
    return false;
  }
}

function uninstallMacOS(): boolean {
  // Unload both old and new labels
  for (const path of [PLIST_PATH, join(LAUNCH_AGENTS, 'com.erichowens.port-daddy.plist')]) {
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

function generateSystemdUnit(): string {
  return `[Unit]
Description=Port Daddy - Authoritative Port Management Daemon
After=network.target

[Service]
Type=simple
ExecStart=${TSX_PATH} ${SERVER_PATH}
WorkingDirectory=${__dirname}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_PATH}
StandardError=append:${ERROR_LOG_PATH}
Environment=PATH=${dirname(TSX_PATH)}:${dirname(NODE_PATH)}:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;
}

function installLinux(): boolean {
  // Ensure systemd user directory exists
  if (!existsSync(SYSTEMD_USER_DIR)) {
    mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
  }

  // Write unit file
  writeFileSync(SYSTEMD_UNIT, generateSystemdUnit());
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
  if (existsSync(SYSTEMD_UNIT)) {
    try {
      unlinkSync(SYSTEMD_UNIT);
      console.log(`  Removed ${SYSTEMD_UNIT}`);
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
  console.log(`  Node: ${NODE_PATH}`);
  console.log(`  Server: ${SERVER_PATH}`);
  console.log('');

  let success: boolean = false;

  if (PLATFORM === 'darwin') {
    success = installMacOS();
  } else if (PLATFORM === 'linux') {
    success = installLinux();
  } else {
    console.log(`  Platform "${PLATFORM}" does not support auto-start installation.`);
    console.log('  You can still run the daemon manually:');
    console.log(`    node ${SERVER_PATH}`);
    console.log('  Or: port-daddy start');
    return;
  }

  if (success) {
    console.log('');
    console.log('Port Daddy daemon installed successfully.');
    console.log('  Auto-starts on login');
    console.log('  Test: curl http://localhost:9876/health');
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
  const healthResult: CommandResult = runCommand('curl', ['-s', '--connect-timeout', '2', 'http://localhost:9876/health']);
  if (healthResult.status === 0 && healthResult.stdout.includes('"status":"ok"')) {
    console.log('  Daemon: responding on port 9876');
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

// Parse command
const command: string | undefined = process.argv[2];

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
  node install-daemon.js install   - Install and start daemon
  node install-daemon.js uninstall - Stop and uninstall daemon
  node install-daemon.js status    - Check daemon status

Supported platforms:
  macOS   - LaunchAgent (auto-start on login)
  Linux   - systemd user service (auto-start on login)
  Windows - Manual start only (port-daddy start)
    `);
}
