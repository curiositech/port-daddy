import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  // A named profile is an isolation boundary, not merely a presentation hint.
  // Set every mutable runtime path explicitly so child processes cannot fall
  // back to the canonical daemon's durable home if prefix inference changes or
  // a consumer only understands the dedicated path variables.
  env.PORT_DADDY_DB = profile.dbPath;
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
