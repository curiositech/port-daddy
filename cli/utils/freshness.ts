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
  return !FRESHNESS_SKIP_COMMANDS.has(normalized);
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
