import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { basename, dirname, join } from 'node:path';

export type DaemonLaunchMode = 'binary' | 'source' | 'self';

export interface DaemonLaunchCommand {
  mode: DaemonLaunchMode;
  program: string;
  args: string[];
  env?: Record<string, string>;
  binaryPath: string;
  sourceServerPath: string;
  sourceTsxPath: string;
  pathDirs: string[];
  reason: string;
}

export function daemonBinaryName(os: NodeJS.Platform = platform()): string {
  return os === 'win32' ? 'port-daddy-daemon.exe' : 'port-daddy-daemon';
}

export function sourceDaemonFallbackAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PORT_DADDY_ALLOW_SOURCE_DAEMON === '1' || env.PORT_DADDY_DEV_SOURCE_DAEMON === '1';
}

export function selfDaemonLaunchAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PORT_DADDY_CAN_SELF_DAEMON === '1';
}

export function isBunVirtualPath(path: string): boolean {
  return path.includes('/$bunfs/') || path.startsWith('/$bunfs/') || path.startsWith('$bunfs/');
}

export function resolveDistributionRoot(
  moduleDir: string,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string {
  const explicit = env.PORT_DADDY_RESOURCE_DIR?.trim();
  if (explicit) return explicit;
  if (!isBunVirtualPath(moduleDir)) return moduleDir;

  const execDir = dirname(execPath);
  const parentDir = dirname(execDir);
  if (basename(execDir) === 'daemon' && basename(parentDir) === 'dist') {
    return dirname(parentDir);
  }
  if (basename(execDir) === 'dist') {
    return parentDir;
  }
  return process.cwd();
}

export function daemonBinaryPath(rootDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PORT_DADDY_DAEMON_BINARY?.trim();
  if (explicit) return explicit;
  return join(rootDir, 'dist', 'daemon', daemonBinaryName());
}

export function resolveDaemonLaunchCommand(
  rootDir: string,
  options: { env?: NodeJS.ProcessEnv; allowSourceFallback?: boolean } = {},
): DaemonLaunchCommand {
  const env = options.env ?? process.env;
  const binaryPath = daemonBinaryPath(rootDir, env);
  const sourceTsxPath = join(rootDir, 'node_modules', '.bin', 'tsx');
  const sourceServerPath = join(rootDir, 'server.ts');

  if (env.PORT_DADDY_DAEMON_BINARY?.trim() && existsSync(binaryPath)) {
    return {
      mode: 'binary',
      program: binaryPath,
      args: [],
      binaryPath,
      sourceServerPath,
      sourceTsxPath,
      pathDirs: [dirname(binaryPath)],
      reason: 'explicit daemon binary found',
    };
  }

  if (selfDaemonLaunchAllowed(env)) {
    const resourceDir = resolveDistributionRoot(rootDir, env);
    return {
      mode: 'self',
      program: process.execPath,
      args: ['__daemon'],
      env: { PORT_DADDY_RESOURCE_DIR: resourceDir },
      binaryPath: process.execPath,
      sourceServerPath,
      sourceTsxPath,
      pathDirs: [dirname(process.execPath)],
      reason: 'single binary can self-host daemon',
    };
  }

  if (existsSync(binaryPath)) {
    return {
      mode: 'binary',
      program: binaryPath,
      args: [],
      binaryPath,
      sourceServerPath,
      sourceTsxPath,
      pathDirs: [dirname(binaryPath)],
      reason: 'daemon binary found',
    };
  }

  const allowSource = options.allowSourceFallback ?? sourceDaemonFallbackAllowed(env);
  if (allowSource) {
    return {
      mode: 'source',
      program: sourceTsxPath,
      args: [sourceServerPath],
      binaryPath,
      sourceServerPath,
      sourceTsxPath,
      pathDirs: [dirname(sourceTsxPath)],
      reason: 'source fallback explicitly allowed',
    };
  }

  throw new Error(
    `Port Daddy daemon binary missing at ${binaryPath}. ` +
    'Build it with `npm run build:daemon:dist`, or set PORT_DADDY_ALLOW_SOURCE_DAEMON=1 for a development-only source daemon.',
  );
}
