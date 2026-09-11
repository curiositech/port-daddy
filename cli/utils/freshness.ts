import { resolve } from 'node:path';

const FRESHNESS_SKIP_COMMANDS = new Set([
  'start',
  'stop',
  'restart',
  'install',
  // install-bosun must stay in this skip list alongside install/uninstall.
  // Found live (v3.25.1 brew rollout, 2026-07-14): Homebrew's post_install
  // hook runs network-sandboxed, so the freshness probe's daemon fetch fails
  // with ECONNREFUSED/ENOENT; main()'s top-level handler misreads that as
  // "the daemon isn't running", attempts an auto-start-and-retry, and the
  // whole `port-daddy install-bosun` invocation exits non-zero — even though
  // installBosunOnly() itself needs no network at all and had already
  // finished writing the launchd job before the freshness check ever fires.
  'install-bosun',
  'uninstall',
  'status',
  'version',
  'dev',
  'daemon',
  'ci-gate',
  'doctor',
  'diagnose',
  'up',
  'down',
  'dashboard',
  'setup',
  'watch',
  'spawn',
  'spawned',
  'fleet',
  'mcp',
  'agent',
  'agents',
  'attention',
  'ideas',
  // The learn/tutorial handler is an operationally read-only orientation.
  // A freshness probe may restart a same-install daemon in an interactive
  // shell, which would violate that contract before the handler even runs.
  'learn',
  'tutorial',
]);

/**
 * Decide whether a command may run the interactive daemon-freshness probe.
 * The design centralizes exclusions so background, lifecycle, and explicitly
 * read-only commands cannot trigger daemon actuation before dispatch.
 *
 * @param command - Parsed top-level CLI verb, when present.
 * @param args - Full parsed argument vector used to detect direct mode.
 * @returns True only when the command is eligible for a freshness probe.
 */
export function shouldCheckDaemonFreshness(command: string | undefined, args: string[] = []): boolean {
  const normalized = (command || '').trim();
  if (!normalized) return false;
  if (args.includes('--direct')) return false;
  return !FRESHNESS_SKIP_COMMANDS.has(normalized);
}

/**
 * Detect an operator-selected daemon boundary. The purpose is to prevent a
 * foreign checkout or named berth from being treated as permission to inspect
 * or restart the canonical local daemon.
 *
 * @param env - Environment carrying URL, profile, or explicit skip selectors.
 * @returns True when daemon ownership was selected outside implicit discovery.
 */
export function hasExplicitDaemonTarget(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.PD_URL
    || env.PORT_DADDY_URL
    || env.PORT_DADDY_PROFILE
    || env.PORT_DADDY_SKIP_FRESHNESS_CHECK,
  );
}

/**
 * Gate freshness-driven restart to one interactive command from the daemon's
 * own install root. This design makes install-root identity and human-visible
 * interactivity necessary evidence before process actuation.
 *
 * @param opts - Daemon install root, caller install root, and TTY witness.
 * @returns True only when every restart-ownership predicate is satisfied.
 */
export function shouldAutoRestartDaemonForFreshness(opts: {
  daemonInstallDir?: string | null;
  localInstallDir: string;
  isInteractive: boolean;
}): boolean {
  const { daemonInstallDir, localInstallDir, isInteractive } = opts;
  if (!isInteractive) return false;
  if (!daemonInstallDir) return true;
  return resolve(daemonInstallDir) === resolve(localInstallDir);
}
