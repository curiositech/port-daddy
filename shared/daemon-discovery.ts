import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_PORT_FILE, DEFAULT_SOCK } from './paths.js';

/**
 * The single source of truth for the canonical Port Daddy daemon port.
 *
 * `9876` is the *well-known preferred* control port, not a guaranteed runtime
 * value — the daemon can fall back to another port (CI, multi-machine, custom
 * installs). Runtime code must NEVER hardcode `9876`; it must resolve through
 * the helpers in this module (`resolveDaemonPort` / `resolveDaemonUrl`). This
 * file is the ONLY place the literal may appear in runtime source, enforced by
 * `tests/unit/no-hardcoded-daemon-port.test.js`.
 */
export const DEFAULT_DAEMON_PORT = 9876;

/**
 * @deprecated Prefer {@link DEFAULT_DAEMON_PORT}. Retained as a back-compat
 * alias for existing importers (lib/client.ts, cli/utils/fetch.ts, etc.).
 */
export const CANONICAL_TCP_PORT = DEFAULT_DAEMON_PORT;
export const LOOPBACK_TCP_HOST = process.env.PORT_DADDY_TCP_HOST?.trim() || '127.0.0.1';

/**
 * Resolve the daemon's TCP port.
 *
 * Resolution order:
 *   1. `PORT_DADDY_PORT` env var (explicit override)
 *   2. The `~/.port-daddy/daemon.port` file the daemon writes on bind
 *      (override the path with `PORT_DADDY_PORT_FILE`)
 *   3. {@link DEFAULT_DAEMON_PORT}
 */
export function resolveDaemonPort(
  portFile = process.env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envPort = env.PORT_DADDY_PORT?.trim();
  if (envPort) {
    const parsed = Number.parseInt(envPort, 10);
    if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) {
      return parsed;
    }
  }
  try {
    const raw = readFileSync(portFile, 'utf-8').trim();
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) {
      return parsed;
    }
  } catch {
    // Fall through to the canonical preferred port.
  }
  return DEFAULT_DAEMON_PORT;
}

/**
 * @deprecated Prefer {@link resolveDaemonPort}. Back-compat alias.
 */
export const readDaemonPort = resolveDaemonPort;

/**
 * Resolve the daemon's base TCP URL.
 *
 * Resolution order: `PORT_DADDY_URL` env var → `http://<host>:<resolveDaemonPort()>`.
 */
export function resolveDaemonUrl(
  explicitUrl = process.env.PORT_DADDY_URL,
  portFile = process.env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (explicitUrl && explicitUrl.trim()) return explicitUrl;
  const host = env.PORT_DADDY_TCP_HOST?.trim() || LOOPBACK_TCP_HOST;
  return `http://${host}:${resolveDaemonPort(portFile, env)}`;
}

/**
 * @deprecated Prefer {@link resolveDaemonUrl}. Back-compat alias.
 */
export const getDaemonTcpUrl = resolveDaemonUrl;

export function resolveDaemonTcpTarget(
  explicitUrl = process.env.PORT_DADDY_URL,
  portFile = process.env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE,
  env: NodeJS.ProcessEnv = process.env,
): { host: string; port: number } {
  const url = new URL(resolveDaemonUrl(explicitUrl, portFile, env));
  return {
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80),
  };
}

/** A daemon connection target: EITHER a Unix socket OR a loopback TCP host:port. */
export interface SocketTarget {
  socketPath: string;
  host?: undefined;
  port?: undefined;
}
export interface TcpTarget {
  socketPath?: undefined;
  host: string;
  port: number;
}
export type DaemonTarget = SocketTarget | TcpTarget;

/**
 * THE one canonical socket-vs-TCP resolver. Every Node client (CLI `pdFetch`,
 * SDK, `lib/request`) routes through this so there is a single place that
 * decides how to reach the daemon.
 *
 * Precedence (do not reorder — pinned by tests/unit/daemon-target.test.js and
 * the long-standing lib/request.test.js):
 *   0. `PORT_DADDY_FORCE_TCP=1` → loopback TCP, bypassing Unix socket
 *   1. `PORT_DADDY_SOCK` env  → explicit Unix socket (wins even over a URL)
 *   2. `PORT_DADDY_URL`  env  → explicit TCP URL
 *   3. the daemon's socket file ({@link DEFAULT_SOCK}) exists → Unix socket
 *   4. loopback TCP from the port file (or {@link DEFAULT_DAEMON_PORT})
 *
 * `env` and `fileExists` are injectable so callers/tests are deterministic
 * regardless of whether a real socket file happens to exist on the box.
 */
export function resolveDaemonTarget(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): DaemonTarget {
  const portFile = env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE;
  const tcpTarget = () => resolveDaemonTcpTarget(env.PORT_DADDY_URL, portFile, env);
  if (env.PORT_DADDY_FORCE_TCP === '1') return tcpTarget();
  if (env.PORT_DADDY_SOCK) return { socketPath: env.PORT_DADDY_SOCK };
  if (env.PORT_DADDY_URL) return tcpTarget();
  if (fileExists(DEFAULT_SOCK)) return { socketPath: DEFAULT_SOCK };
  return tcpTarget();
}
