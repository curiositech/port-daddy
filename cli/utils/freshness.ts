import { resolve } from 'node:path';

const FRESHNESS_SKIP_COMMANDS = new Set([
  'start',
  'stop',
  'restart',
  'install',
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
