import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { PD_HOME } from '../shared/paths.js';
import { STATE_PLANE_ENV } from './state-plane.js';

export const DAEMON_PROFILE_DIRNAME = 'instances';
export const RESERVED_DAEMON_PROFILES = new Set(['canonical', 'default', 'stable']);
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface DaemonProfilePaths {
  name: string;
  runtimeDir: string;
  dbPath: string;
  sockPath: string;
  ipcPath: string;
  pidFile: string;
  portFile: string;
  heartbeatFile: string;
  logFile: string;
  stateFile: string;
}

export interface DaemonProfileState {
  name: string;
  pid: number | null;
  port: number | null;
  preferredPort: number | null;
  runtimeDir: string;
  socketPath: string;
  ipcPath: string;
  dbPath: string;
  startedAt: string | null;
  cwd: string | null;
  fleetEnabled: boolean;
  fleetBarEnabled: boolean;
}

export interface DaemonProfileEnvOptions {
  baseEnv?: NodeJS.ProcessEnv;
  port?: number | null;
  enableFleet?: boolean;
  enableFleetBar?: boolean;
  nodeEnv?: string;
}

export function getDaemonProfilesRoot(homeDir: string = PD_HOME): string {
  return join(homeDir, DAEMON_PROFILE_DIRNAME);
}

export function normalizeDaemonProfileName(rawName: string): string {
  const name = rawName.trim();
  if (!name) {
    throw new Error('Daemon profile name is required');
  }
  if (RESERVED_DAEMON_PROFILES.has(name.toLowerCase())) {
    throw new Error(`"${name}" is reserved for the canonical daemon`);
  }
  if (!PROFILE_RE.test(name) || name.includes('..')) {
    throw new Error('Daemon profile names may contain only letters, numbers, dot, underscore, and hyphen');
  }
  return name;
}

export function resolveDaemonProfile(rawName: string, opts: { homeDir?: string } = {}): DaemonProfilePaths {
  const name = normalizeDaemonProfileName(rawName);
  const runtimeDir = join(getDaemonProfilesRoot(opts.homeDir), name);
  return {
    name,
    runtimeDir,
    dbPath: join(runtimeDir, 'port-daddy.db'),
    sockPath: join(runtimeDir, 'port-daddy.sock'),
    ipcPath: join(runtimeDir, 'port-daddy.ipc'),
    pidFile: join(runtimeDir, 'daemon.pid'),
    portFile: join(runtimeDir, 'daemon.port'),
    heartbeatFile: join(runtimeDir, 'heartbeat'),
    logFile: join(runtimeDir, 'daemon.log'),
    stateFile: join(runtimeDir, 'profile.json'),
  };
}

/**
 * Resolve the private runtime directory selected by a client-side
 * `PD_ACTIVE_DAEMON` marker.
 *
 * `pd use` and the global `pd --daemon` flag intentionally do not export
 * `PORT_DADDY_PREFIX`: that variable changes database/state ownership for the
 * whole CLI process. Diagnostics still need the selected berth's PID, port,
 * and heartbeat files, though, so they resolve the marker narrowly here.
 * Unknown/raw-URL targets return null and must be reported as unverifiable;
 * they must never fall back to the stable daemon's files.
 */
export function resolveActiveDaemonRuntimeDir(
  env: NodeJS.ProcessEnv = process.env,
  opts: { homeDir?: string } = {},
): string | null {
  const explicitPrefix = env.PORT_DADDY_PREFIX?.trim();
  if (explicitPrefix) return explicitPrefix;

  const marker = env.PD_ACTIVE_DAEMON?.trim();
  if (!marker || RESERVED_DAEMON_PROFILES.has(marker.toLowerCase())) return null;

  // Dev labels may contain branch separators; devUp uses the same replacement
  // when creating ~/.port-daddy/instances/<label>.
  const profileName = marker.replace(/[^A-Za-z0-9._-]/g, '-');
  try {
    const profile = resolveDaemonProfile(profileName, opts);
    return existsSync(profile.runtimeDir) ? profile.runtimeDir : null;
  } catch {
    return null;
  }
}

/**
 * Put a named berth's matching feature CLI ahead of Homebrew for daemon
 * descendants. A dev daemon tested with a stale installed `pd` is not a valid
 * backend proof: routes, flags, and discovery contracts can change together.
 */
export function installDaemonProfileCliShim(
  profile: DaemonProfilePaths,
  cliBinary: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!existsSync(cliBinary)) {
    throw new Error(`feature CLI binary is missing: ${cliBinary}`);
  }
  const binDir = join(profile.runtimeDir, 'feature-bin');
  mkdirSync(binDir, { recursive: true, mode: 0o700 });

  for (const command of ['pd', 'port-daddy']) {
    const shimPath = join(binDir, platform === 'win32' ? `${command}.cmd` : command);
    rmSync(shimPath, { force: true });
    if (platform === 'win32') {
      writeFileSync(shimPath, `@"${cliBinary}" %*\r\n`, { mode: 0o700 });
    } else {
      symlinkSync(cliBinary, shimPath);
    }
  }

  env.PORT_DADDY_CLI = cliBinary;
  env.PATH = [binDir, env.PATH].filter(Boolean).join(delimiter);
  return binDir;
}

export function ensureDaemonProfileDir(profile: DaemonProfilePaths): void {
  mkdirSync(profile.runtimeDir, { recursive: true, mode: 0o700 });
}

export function readNumberFile(path: string): number | null {
  try {
    const parsed = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function isProcessRunning(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readDaemonProfileState(profile: DaemonProfilePaths): DaemonProfileState | null {
  try {
    const raw = JSON.parse(readFileSync(profile.stateFile, 'utf8')) as Partial<DaemonProfileState>;
    return {
      name: profile.name,
      pid: typeof raw.pid === 'number' ? raw.pid : readNumberFile(profile.pidFile),
      port: typeof raw.port === 'number' ? raw.port : readNumberFile(profile.portFile),
      preferredPort: typeof raw.preferredPort === 'number' ? raw.preferredPort : null,
      runtimeDir: profile.runtimeDir,
      socketPath: profile.sockPath,
      ipcPath: profile.ipcPath,
      dbPath: profile.dbPath,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
      cwd: typeof raw.cwd === 'string' ? raw.cwd : null,
      fleetEnabled: raw.fleetEnabled === true,
      fleetBarEnabled: raw.fleetBarEnabled === true,
    };
  } catch {
    return null;
  }
}

export function writeDaemonProfileState(profile: DaemonProfilePaths, state: DaemonProfileState): void {
  ensureDaemonProfileDir(profile);
  writeFileSync(profile.stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export function listDaemonProfiles(opts: { homeDir?: string } = {}): DaemonProfilePaths[] {
  const root = getDaemonProfilesRoot(opts.homeDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolveDaemonProfile(entry.name, opts))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildDaemonProfileEnv(
  profile: DaemonProfilePaths,
  opts: DaemonProfileEnvOptions = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(opts.baseEnv ?? process.env) };
  for (const key of [
    'PD_URL',
    'PD_ACTIVE_DAEMON',
    'PORT_DADDY_URL',
    'PORT_DADDY_DB',
    'PORT_DADDY_SOCK',
    'PORT_DADDY_IPC',
    'PORT_DADDY_PID_FILE',
    'PORT_DADDY_PORT_FILE',
    'PORT_DADDY_HEARTBEAT_FILE',
    // An inherited plane override (PORT_DADDY_PLANE) would poison the child
    // daemon's state-plane classification — strip it so the berth self-classifies
    // from its own prefix/port/profile signals (lib/state-plane.ts).
    STATE_PLANE_ENV,
  ]) {
    delete env[key];
  }

  env.PORT_DADDY_PROFILE = profile.name;
  env.PORT_DADDY_PREFIX = profile.runtimeDir;
  // Publish the profile's IPC paths, not only its TCP URL. Sandboxed agent
  // shells commonly deny loopback networking while allowing the daemon's Unix
  // socket. Descendants must therefore inherit the exact named socket and port
  // file or their first `pd attention` can fail despite a healthy daemon.
  env.PORT_DADDY_SOCK = profile.sockPath;
  env.PORT_DADDY_IPC = profile.ipcPath;
  env.PORT_DADDY_PID_FILE = profile.pidFile;
  env.PORT_DADDY_PORT_FILE = profile.portFile;
  env.PORT_DADDY_HEARTBEAT_FILE = profile.heartbeatFile;
  env.PORT_DADDY_NO_FLEET = opts.enableFleet ? '0' : '1';
  env.PORT_DADDY_NO_FLEETBAR = opts.enableFleetBar ? '0' : '1';
  env.PD_ACTIVE_DAEMON = profile.name;
  if (typeof opts.port === 'number') {
    env.PORT_DADDY_PORT = String(opts.port);
    // The daemon is also the parent of hooks and provider-neutral spawned
    // bodies. Give those descendants the address of THIS profile, not the
    // caller shell's canonical/default daemon. Without this a named berth can
    // register a body locally while the body's own `pd` calls mutate another
    // state plane.
    env.PORT_DADDY_URL = `http://127.0.0.1:${opts.port}`;
  }
  if (opts.nodeEnv) {
    env.NODE_ENV = opts.nodeEnv;
  }
  return env;
}
