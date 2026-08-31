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
]);

export function shouldCheckDaemonFreshness(command: string | undefined, args: string[] = []): boolean {
  const normalized = (command || '').trim();
  if (!normalized) return false;
  if (args.includes('--direct')) return false;
  if (isHelpInvocation(command, args)) return false;
  return !FRESHNESS_SKIP_COMMANDS.has(normalized);
}

/** Detect global help flags exactly as the CLI option parser does. */
export function hasHelpFlag(args: string[] = []): boolean {
  for (const arg of args) {
    if (arg === '--') return false;
    if (arg === '--help' || arg.startsWith('--help=')) return true;
    if (arg.startsWith('--')) continue;
    if (!arg.startsWith('-') || arg === '-') continue;

    const flagPart = arg.slice(1);
    const eqIndex = flagPart.indexOf('=');
    if (eqIndex !== -1) {
      if (flagPart.slice(0, eqIndex) === 'h') return true;
      continue;
    }
    if (flagPart.includes('h')) return true;
  }
  return false;
}

function firstParsedPositional(args: string[]): string | undefined {
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return args[i + 1];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).split('=', 1)[0];
      if (key === 'files' && !arg.includes('=')) {
        while (args[i + 1] && args[i + 1] !== '--' && !args[i + 1].startsWith('-')) i++;
      } else if (!arg.includes('=') && args[i + 1] && !args[i + 1].startsWith('-')) {
        i++;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const flagPart = arg.slice(1);
      if (!flagPart.includes('=') && ['p', 'e'].includes(flagPart)
          && args[i + 1] && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    return arg;
  }
  return undefined;
}

/**
 * Classify a help-only invocation before freshness, staleness, or telemetry.
 * Raw Parley owns three positional help forms in addition to global flags:
 * bare `pd parley`, `pd parley help`, and its positional `--help`/`-h` aliases.
 */
export function isHelpInvocation(command: string | undefined, args: string[] = []): boolean {
  if (hasHelpFlag(args)) return true;
  if ((command || '').trim() !== 'parley') return false;
  const sub = firstParsedPositional(args);
  return sub === undefined || sub === 'help' || sub === '--help' || sub === '-h';
}

export function hasExplicitDaemonTarget(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.PD_URL
    || env.PORT_DADDY_URL
    || env.PORT_DADDY_PROFILE
    || env.PORT_DADDY_SKIP_FRESHNESS_CHECK,
  );
}

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
