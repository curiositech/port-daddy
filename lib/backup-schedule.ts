/**
 * Scheduled backups — ADR-0037 §Scheduling.
 *
 * `pd backup` is a one-shot snapshot. To get the durability the 758 MB live
 * coordination DB actually needs, the snapshot has to run on a timer with GFS
 * retention pruning automatically. This module installs a per-user launchd
 * agent on macOS that runs `pd backup` once a day at a fixed local time.
 *
 * Design notes:
 *   - launchd `StartCalendarInterval` fires at a wall-clock time and, unlike a
 *     bare cron entry, catches up a missed run if the machine was asleep at the
 *     scheduled minute (launchd runs it on next wake). That matters for a
 *     laptop that isn't on at 03:00.
 *   - The agent invokes the SAME `pd` binary the operator is using
 *     (resolved by the caller, see resolvePdBinary), so a Homebrew install and
 *     a dev checkout both schedule against their own binary.
 *   - Retention is left to `pd backup`'s default GFS spec; override via
 *     `--retention` baked into the installed args.
 *   - Cross-platform: only macOS (launchd) is wired here. On Linux the same
 *     `pd backup` command belongs in a user systemd timer or crontab; we print
 *     a ready-to-paste crontab line instead of failing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const SCHEDULE_LABEL = 'com.portdaddy.backup';

export interface ScheduleOptions {
  /** Absolute path to the `pd` binary the agent should invoke. */
  pdBinary: string;
  /** Hour (0-23) of the daily run. Default 3 (03:00 local). */
  hour?: number;
  /** Minute (0-59) of the daily run. Default 17. */
  minute?: number;
  /** Extra args appended after `backup` (e.g. ['--retention', 'daily=14']). */
  extraArgs?: string[];
  /** Override the LaunchAgents dir (tests). */
  launchAgentsDir?: string;
  /** Override the log dir (tests). Default ~/.port-daddy. */
  logDir?: string;
}

function launchAgentsDir(opts: ScheduleOptions): string {
  return opts.launchAgentsDir ?? join(homedir(), 'Library', 'LaunchAgents');
}

export function plistPath(opts: ScheduleOptions): string {
  return join(launchAgentsDir(opts), `${SCHEDULE_LABEL}.plist`);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render the launchd plist XML. Pure — exported so tests can assert the
 * generated document without touching the filesystem.
 */
export function renderSchedulePlist(opts: ScheduleOptions): string {
  const hour = opts.hour ?? 3;
  const minute = opts.minute ?? 17;
  const logDir = opts.logDir ?? join(homedir(), '.port-daddy');
  const args = ['backup', ...(opts.extraArgs ?? [])];
  const programArgs = [opts.pdBinary, ...args]
    .map((a) => `        <string>${xmlEscape(a)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SCHEDULE_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>

    <!-- Daily at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} local.
         launchd catches up a run missed while asleep on next wake. -->
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>${hour}</integer>
        <key>Minute</key>
        <integer>${minute}</integer>
    </dict>

    <key>RunAtLoad</key>
    <false/>

    <key>Nice</key>
    <integer>10</integer>

    <key>ProcessType</key>
    <string>Background</string>

    <key>StandardOutPath</key>
    <string>${xmlEscape(join(logDir, 'backup-schedule.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(join(logDir, 'backup-schedule.log'))}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT_DADDY_DB</key>
        <string>${xmlEscape(join(homedir(), '.port-daddy', 'port-registry.db'))}</string>
    </dict>
</dict>
</plist>
`;
}

/** Ready-to-paste crontab line for Linux / non-launchd hosts. */
export function cronLine(opts: ScheduleOptions): string {
  const hour = opts.hour ?? 3;
  const minute = opts.minute ?? 17;
  const args = ['backup', ...(opts.extraArgs ?? [])].join(' ');
  return `${minute} ${hour} * * * ${opts.pdBinary} ${args}`;
}

export interface InstallScheduleResult {
  installed: boolean;
  platform: NodeJS.Platform;
  plistPath?: string;
  cronLine?: string;
  message: string;
}

/**
 * Install (and load) the daily-backup launchd agent on macOS. On other
 * platforms, returns the crontab line to install manually rather than failing.
 */
export function installSchedule(opts: ScheduleOptions): InstallScheduleResult {
  if (platform() !== 'darwin') {
    return {
      installed: false,
      platform: platform(),
      cronLine: cronLine(opts),
      message:
        'launchd scheduling is macOS-only. Add this line to your crontab (crontab -e) ' +
        'or a systemd timer to run a daily backup.',
    };
  }

  const dir = launchAgentsDir(opts);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = plistPath(opts);
  writeFileSync(path, renderSchedulePlist(opts), { mode: 0o644 });

  // Reload: bootout (ignore errors if not loaded) then bootstrap.
  const uid = process.getuid ? process.getuid() : 0;
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}/${SCHEDULE_LABEL}`], { stdio: 'ignore' });
  } catch {
    /* not loaded yet — fine */
  }
  let loaded = true;
  let loadNote = 'loaded into launchd';
  try {
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, path], { stdio: 'ignore' });
  } catch (err) {
    loaded = false;
    loadNote = `plist written but launchctl bootstrap failed (${(err as Error).message}); ` +
      `load it with: launchctl bootstrap gui/${uid} ${path}`;
  }

  return {
    installed: true,
    platform: 'darwin',
    plistPath: path,
    message: loaded
      ? `Daily backup scheduled (${loadNote}).`
      : loadNote,
  };
}

export interface UninstallScheduleResult {
  removed: boolean;
  message: string;
}

/** Uninstall the launchd agent (bootout + delete the plist). */
export function uninstallSchedule(opts: ScheduleOptions): UninstallScheduleResult {
  if (platform() !== 'darwin') {
    return { removed: false, message: 'No launchd agent on this platform; remove your crontab/systemd entry manually.' };
  }
  const path = plistPath(opts);
  const uid = process.getuid ? process.getuid() : 0;
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}/${SCHEDULE_LABEL}`], { stdio: 'ignore' });
  } catch {
    /* not loaded — fine */
  }
  const existed = existsSync(path);
  if (existed) rmSync(path, { force: true });
  return {
    removed: existed,
    message: existed ? `Removed ${path} and unloaded the agent.` : 'No backup schedule was installed.',
  };
}
