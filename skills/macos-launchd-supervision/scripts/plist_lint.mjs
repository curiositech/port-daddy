#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_PATH_RE = /^\/(private\/)?tmp(\/|$)/;

function isUnderTmp(pathValue) {
  return typeof pathValue === 'string' && TMP_PATH_RE.test(pathValue);
}

function isAbsolutePath(pathValue) {
  return typeof pathValue === 'string' && pathValue.startsWith('/');
}

function keepAliveIsSet(keepAlive) {
  if (keepAlive === undefined || keepAlive === null) return false;
  if (typeof keepAlive === 'boolean') return keepAlive === true;
  if (typeof keepAlive === 'object') {
    return Object.values(keepAlive).some((v) => v === true);
  }
  return false;
}

/**
 * Lint a launchd job plan (see schemas/launchd-plan.schema.json) for the
 * defects that repeatedly bite real deployments: /tmp logging, missing
 * RunAtLoad, zero/absent ThrottleInterval, unpinned relative binary paths,
 * KeepAlive with no external supervision-integrity check, and
 * LaunchAgent/LaunchDaemon misplacement.
 *
 * @param {object} plan
 * @returns {{ pass: boolean, findings: Array<{severity: 'critical'|'warning', code: string, message: string}>, recommendations: string[] }}
 */
export function lintLaunchdPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('plan must be an object');
  }
  if (!plan.label || typeof plan.label !== 'string' || plan.label.trim() === '') {
    throw new Error('plan.label is required and must be a non-empty string');
  }
  if (!Array.isArray(plan.programArgs) || plan.programArgs.length === 0) {
    throw new Error('plan.programArgs is required and must be a non-empty array');
  }
  if (plan.agentVsDaemon !== 'agent' && plan.agentVsDaemon !== 'daemon') {
    throw new Error('plan.agentVsDaemon is required and must be "agent" or "daemon"');
  }

  const findings = [];
  const recommendations = [];

  function flag(severity, code, message, recommendation) {
    findings.push({ severity, code, message });
    recommendations.push(recommendation);
  }

  // 1. Label sanity: reverse-DNS-ish (has a dot, no whitespace).
  if (/\s/.test(plan.label)) {
    flag(
      'critical',
      'label-has-whitespace',
      `Label "${plan.label}" contains whitespace, which launchd will not accept as a valid job label.`,
      'Use a reverse-DNS label with no spaces, e.g. com.example.myapp.'
    );
  } else if (!plan.label.includes('.')) {
    flag(
      'warning',
      'label-not-reverse-dns',
      `Label "${plan.label}" is not reverse-DNS style, which risks collisions with other jobs.`,
      'Rename to a reverse-DNS label, e.g. com.example.myapp, to avoid collisions with other launchd jobs.'
    );
  }

  // 2. Absolute binary path vs pinned PATH.
  const argv0 = plan.programArgs[0];
  const pathIsPinned = Boolean(plan.env && typeof plan.env.PATH === 'string' && plan.env.PATH.trim() !== '');
  if (!isAbsolutePath(argv0) && !pathIsPinned) {
    flag(
      'critical',
      'unpinned-relative-binary',
      `ProgramArguments[0] "${argv0}" is a relative command name and no EnvironmentVariables.PATH is set. launchd's default PATH is minimal (/usr/bin:/bin:/usr/sbin:/sbin), so this will likely fail with "command not found".`,
      `Use an absolute path for "${argv0}" (e.g. resolve it with \`which ${argv0}\`) or set EnvironmentVariables.PATH explicitly.`
    );
  }

  // 3. RunAtLoad.
  if (plan.runAtLoad !== true) {
    flag(
      'warning',
      'missing-run-at-load',
      'RunAtLoad is not true, so this job will not automatically start on bootstrap/login/boot — only on-demand triggers (if any) will start it.',
      'Set RunAtLoad to true so the daemon survives a reboot or logout/login without manual intervention.'
    );
  }

  // 4. ThrottleInterval.
  const throttle = plan.throttleInterval;
  if (throttle === undefined || throttle === null || Number(throttle) <= 0) {
    flag(
      'warning',
      'missing-or-zero-throttle-interval',
      'ThrottleInterval is missing or 0, which allows launchd to respawn a crash-looping job as fast as it can exit, thrashing CPU and log volume.',
      'Set ThrottleInterval to at least 10 (seconds) to rate-limit respawns of a crash-looping job.'
    );
  }

  // 5. Log paths under /tmp.
  if (isUnderTmp(plan.stdoutPath)) {
    flag(
      'critical',
      'stdout-under-tmp',
      `StandardOutPath "${plan.stdoutPath}" is under /tmp or /private/tmp, which macOS purges on a schedule and on reboot — the log will vanish.`,
      'Route StandardOutPath to a durable directory: ~/Library/Logs/<app>/ for a LaunchAgent, or /Library/Logs/<app>/ (or /var/log/<app>/) for a LaunchDaemon.'
    );
  }
  if (isUnderTmp(plan.stderrPath)) {
    flag(
      'critical',
      'stderr-under-tmp',
      `StandardErrorPath "${plan.stderrPath}" is under /tmp or /private/tmp, which macOS purges on a schedule and on reboot — the log will vanish.`,
      'Route StandardErrorPath to a durable directory: ~/Library/Logs/<app>/ for a LaunchAgent, or /Library/Logs/<app>/ (or /var/log/<app>/) for a LaunchDaemon.'
    );
  }

  // 6. KeepAlive-only supervision with no external integrity check.
  if (keepAliveIsSet(plan.keepAlive) && plan.hasExternalIntegrityCheck !== true) {
    flag(
      'critical',
      'keepalive-without-external-integrity-check',
      'KeepAlive is set but there is no external supervision-integrity check. KeepAlive only supervises while the job is loaded — a brew upgrade, logout, or `launchctl bootout` unloads the job silently and nothing will resurrect the daemon.',
      'Add an external check (like `pd doctor supervision-integrity`) that runs `launchctl list <label>` on a schedule or on health-check invocation and alerts when the supervisor label itself is absent, not just when the process is unreachable.'
    );
  }

  // 7. Agent/Daemon misplacement.
  if (plan.agentVsDaemon === 'daemon' && plan.requiresGuiSession === true) {
    flag(
      'critical',
      'daemon-requires-gui-session',
      'agentVsDaemon is "daemon" but requiresGuiSession is true. LaunchDaemons run as root with no logged-in GUI session, so Aqua/notifications/keychain-UI/menu-bar calls will fail.',
      'Switch this job to a LaunchAgent (~/Library/LaunchAgents) so it runs inside the user GUI session, or strip the GUI dependency from the daemon.'
    );
  }
  if (plan.agentVsDaemon === 'agent' && plan.runsAtSystemBoot === true) {
    flag(
      'critical',
      'agent-cannot-run-at-system-boot',
      'agentVsDaemon is "agent" but runsAtSystemBoot is true. LaunchAgents only start at user login, not at system boot, so this job will not run before someone logs in.',
      'Switch this job to a LaunchDaemon (/Library/LaunchDaemons) if it must be running before any user session starts.'
    );
  }

  const pass = !findings.some((f) => f.severity === 'critical');

  return {
    label: plan.label,
    agentVsDaemon: plan.agentVsDaemon,
    pass,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: plist_lint.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(lintLaunchdPlan(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`plist_lint: ${error.message}\n`);
    process.exit(1);
  }
}
