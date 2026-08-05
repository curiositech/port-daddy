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

export const LOOPBACK_TCP_HOST = process.env.PORT_DADDY_TCP_HOST?.trim() || '127.0.0.1';

function parsePort(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : null;
}

/** Read only the endpoint witness a daemon published; never consult overrides. */
export function readPublishedDaemonPort(portFile = DEFAULT_PORT_FILE): number | null {
  try {
    return parsePort(readFileSync(portFile, 'utf-8'));
  } catch {
    return null;
  }
}

/** Resolve the Homebrew-supervised stable daemon independently of a named profile. */
export function resolveCanonicalDaemonPort(portFile = DEFAULT_PORT_FILE): number {
  return readPublishedDaemonPort(portFile) ?? DEFAULT_DAEMON_PORT;
}

export function resolveCanonicalDaemonUrl(
  portFile = DEFAULT_PORT_FILE,
  host = LOOPBACK_TCP_HOST,
): string {
  return `http://${host}:${resolveCanonicalDaemonPort(portFile)}`;
}

/**
 * Resolve the daemon's TCP port.
 *
 * Resolution order:
 *   1. `PORT_DADDY_PORT` env var (explicit override)
 *   2. The `~/.port-daddy/daemon.port` file the daemon writes on bind
 *      (override the path with `PORT_DADDY_PORT_FILE`)
 *   3. {@link DEFAULT_DAEMON_PORT}
 *
 * The design keeps the preferred bind seed out of consumers: clients observe
 * the port the daemon actually published instead of assuming the seed won.
 *
 * @param portFile - Atomically published daemon port file to inspect.
 * @returns The explicit, published, or preferred daemon TCP port.
 */
export function resolveDaemonPort(portFile = process.env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE): number {
  return parsePort(process.env.PORT_DADDY_PORT) ?? readPublishedDaemonPort(portFile) ?? DEFAULT_DAEMON_PORT;
}

/**
 * Resolve the daemon's base TCP URL.
 *
 * Resolution order: `PORT_DADDY_URL` env var → `http://<host>:<resolveDaemonPort()>`.
 * The intent is to make every URL-rendering consumer share port-file discovery.
 *
 * @param explicitUrl - Optional caller-selected daemon URL.
 * @returns The selected daemon's normalized base TCP URL.
 */
export function resolveDaemonUrl(explicitUrl = process.env.PORT_DADDY_URL): string {
  if (explicitUrl && explicitUrl.trim()) return explicitUrl;
  return `http://${LOOPBACK_TCP_HOST}:${resolveDaemonPort()}`;
}

/**
 * Resolve the selected TCP endpoint into request-ready host and port fields.
 * The design deliberately reuses {@link resolveDaemonUrl} so a client cannot
 * bypass dynamic port discovery while translating URL syntax.
 *
 * @param explicitUrl - Optional caller-selected daemon URL.
 * @returns Host and port for the selected daemon TCP endpoint.
 */
export function resolveDaemonTcpTarget(explicitUrl = process.env.PORT_DADDY_URL): { host: string; port: number } {
  const url = new URL(resolveDaemonUrl(explicitUrl));
  return {
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || DEFAULT_DAEMON_PORT,
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
 *
 * @param env - Environment carrying explicit socket, URL, or transport intent.
 * @param fileExists - Socket-existence probe, injectable for deterministic tests.
 * @returns Exactly one Unix-socket or dynamically resolved TCP target.
 */
export function resolveDaemonTarget(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): DaemonTarget {
  if (env.PORT_DADDY_FORCE_TCP === '1') return resolveDaemonTcpTarget(env.PORT_DADDY_URL);
  if (env.PORT_DADDY_SOCK) return { socketPath: env.PORT_DADDY_SOCK };
  if (env.PORT_DADDY_URL) return resolveDaemonTcpTarget(env.PORT_DADDY_URL);
  if (fileExists(DEFAULT_SOCK)) return { socketPath: DEFAULT_SOCK };
  return resolveDaemonTcpTarget(env.PORT_DADDY_URL);
}
