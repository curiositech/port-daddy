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
export const PREFERRED_DAEMON_PORT = 9876;

/**
 * @deprecated Startup/allocator code should use {@link PREFERRED_DAEMON_PORT};
 * connection code must use a published endpoint. Retained only while legacy
 * consumers are migrated off the old name.
 */
export const DEFAULT_DAEMON_PORT = PREFERRED_DAEMON_PORT;

/**
 * @deprecated Prefer {@link DEFAULT_DAEMON_PORT}. Retained as a back-compat
 * alias for existing importers (lib/client.ts, cli/utils/fetch.ts, etc.).
 */
export const CANONICAL_TCP_PORT = DEFAULT_DAEMON_PORT;
export const LOOPBACK_TCP_HOST = process.env.PORT_DADDY_TCP_HOST?.trim() || '127.0.0.1';

const PORT_RE = /^[0-9]+$/;

export type PublishedDaemonPortSource = 'env' | 'port-file';

export interface PublishedDaemonPort {
  port: number;
  source: PublishedDaemonPortSource;
  portFile: string | null;
}

export class DaemonEndpointDiscoveryError extends Error {
  readonly code: 'INVALID_PUBLISHED_PORT' | 'ENDPOINT_NOT_PUBLISHED' | 'UNSUPPORTED_DAEMON_URL';

  constructor(
    code: DaemonEndpointDiscoveryError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DaemonEndpointDiscoveryError';
    this.code = code;
  }
}

export interface DaemonPortDiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  portFile?: string;
  readTextFile?: (path: string) => string;
}

function parsePublishedPort(raw: string, sourceLabel: string): number {
  const value = raw.trim();
  if (!PORT_RE.test(value)) {
    throw new DaemonEndpointDiscoveryError(
      'INVALID_PUBLISHED_PORT',
      `${sourceLabel} must contain one decimal TCP port and nothing else`,
    );
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new DaemonEndpointDiscoveryError(
      'INVALID_PUBLISHED_PORT',
      `${sourceLabel} published out-of-range TCP port ${value}; expected 1024..65535`,
    );
  }
  return port;
}

function parseExplicitUrlPort(raw: string): number {
  if (!PORT_RE.test(raw)) {
    throw new DaemonEndpointDiscoveryError(
      'INVALID_PUBLISHED_PORT',
      'PORT_DADDY_URL must contain one decimal TCP port and nothing else',
    );
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new DaemonEndpointDiscoveryError(
      'INVALID_PUBLISHED_PORT',
      `PORT_DADDY_URL published out-of-range TCP port ${raw}; expected 1..65535`,
    );
  }
  return port;
}

/**
 * Discover a TCP port that the selected daemon actually published.
 *
 * This deliberately has no preferred-port fallback. The preferred port is an
 * allocator seed; it is not evidence that a daemon bound there. Missing
 * publication returns `null`; malformed explicit state throws so callers do
 * not silently connect to an unrelated listener.
 */
export function discoverPublishedDaemonPort(options: DaemonPortDiscoveryOptions = {}): PublishedDaemonPort | null {
  const env = options.env ?? process.env;
  const envPort = env.PORT_DADDY_PORT?.trim();
  if (envPort) {
    return {
      port: parsePublishedPort(envPort, 'PORT_DADDY_PORT'),
      source: 'env',
      portFile: null,
    };
  }

  const portFile = options.portFile ?? env.PORT_DADDY_PORT_FILE ?? DEFAULT_PORT_FILE;
  const readTextFile = options.readTextFile ?? ((path: string) => readFileSync(path, 'utf-8'));
  let raw: string;
  try {
    raw = readTextFile(portFile);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
    if (code === 'ENOENT') return null;
    throw new DaemonEndpointDiscoveryError(
      'INVALID_PUBLISHED_PORT',
      `Could not read the selected daemon port file at ${portFile}`,
      { cause: error },
    );
  }
  return {
    port: parsePublishedPort(raw, `Selected daemon port file ${portFile}`),
    source: 'port-file',
    portFile,
  };
}

export function requirePublishedDaemonPort(options: DaemonPortDiscoveryOptions = {}): PublishedDaemonPort {
  const published = discoverPublishedDaemonPort(options);
  if (published) return published;
  const env = options.env ?? process.env;
  const portFile = options.portFile ?? env.PORT_DADDY_PORT_FILE ?? DEFAULT_PORT_FILE;
  throw new DaemonEndpointDiscoveryError(
    'ENDPOINT_NOT_PUBLISHED',
    `No selected daemon TCP endpoint is published. Set PORT_DADDY_URL, set PORT_DADDY_PORT, or start a daemon that writes ${portFile}.`,
  );
}

/**
 * Resolve the daemon's TCP port.
 *
 * Resolution order:
 *   1. `PORT_DADDY_PORT` env var (explicit override)
 *   2. The `~/.port-daddy/daemon.port` file the daemon writes on bind
 *      (override the path with `PORT_DADDY_PORT_FILE`)
 *   3. {@link PREFERRED_DAEMON_PORT} (legacy compatibility only)
 *
 * @deprecated Connection code must use {@link requirePublishedDaemonPort} or
 * {@link resolveDaemonTarget}. This wrapper retains the old preferred-port
 * fallback only until its remaining callers are migrated.
 */
export function resolveDaemonPort(portFile = process.env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE): number {
  let published: PublishedDaemonPort | null = null;
  try {
    published = discoverPublishedDaemonPort({ portFile });
  } catch {
    // This deprecated alias deliberately preserves the old forgiving fallback.
    // Strict consumers use requirePublishedDaemonPort/resolveDaemonTarget above.
  }
  return published?.port ?? PREFERRED_DAEMON_PORT;
}

/**
 * @deprecated Prefer {@link resolveDaemonPort}. Back-compat alias.
 */
export const readDaemonPort = resolveDaemonPort;

/**
 * Resolve the daemon's base TCP URL.
 *
 * Resolution order: explicit `PORT_DADDY_URL` → legacy dynamic port helper.
 *
 * @deprecated Connection code must migrate to {@link resolvePublishedDaemonUrl}
 * or {@link resolveDaemonTarget}. This compatibility alias retains the old
 * preferred-port fallback until those consumers move in focused slices.
 */
export function resolveDaemonUrl(
  explicitUrl?: string,
  options: DaemonPortDiscoveryOptions = {},
): string {
  const env = options.env ?? process.env;
  const selectedUrl = explicitUrl ?? env.PORT_DADDY_URL;
  if (selectedUrl && selectedUrl.trim()) return selectedUrl.trim();
  const host = env.PORT_DADDY_TCP_HOST?.trim() || LOOPBACK_TCP_HOST;
  let published: PublishedDaemonPort | null = null;
  try {
    published = discoverPublishedDaemonPort(options);
  } catch {
    // This deprecated alias deliberately preserves the old forgiving fallback.
    // Strict consumers use resolvePublishedDaemonUrl/resolveDaemonTarget below.
  }
  return `http://${host}:${published?.port ?? PREFERRED_DAEMON_PORT}`;
}

/**
 * Resolve only an explicit or actually published TCP endpoint. Unlike the
 * deprecated compatibility alias above, this helper never guesses the
 * preferred allocator seed.
 */
export function resolvePublishedDaemonUrl(
  explicitUrl?: string,
  options: DaemonPortDiscoveryOptions = {},
): string {
  const env = options.env ?? process.env;
  const selectedUrl = explicitUrl ?? env.PORT_DADDY_URL;
  if (selectedUrl && selectedUrl.trim()) return selectedUrl.trim();
  const host = env.PORT_DADDY_TCP_HOST?.trim() || LOOPBACK_TCP_HOST;
  return `http://${host}:${requirePublishedDaemonPort(options).port}`;
}

/**
 * @deprecated Prefer {@link resolveDaemonUrl}. Back-compat alias.
 */
export const getDaemonTcpUrl = resolveDaemonUrl;

export function resolveDaemonTcpTarget(
  explicitUrl?: string,
  options: DaemonPortDiscoveryOptions = {},
): { host: string; port: number } {
  const url = new URL(resolvePublishedDaemonUrl(explicitUrl, options));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DaemonEndpointDiscoveryError(
      'UNSUPPORTED_DAEMON_URL',
      `PORT_DADDY_URL must use http: or https:, got ${url.protocol}`,
    );
  }
  const port = url.port
    ? parseExplicitUrlPort(url.port)
    : url.protocol === 'https:' ? 443 : 80;
  return {
    host: url.hostname,
    port,
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
 *   4. loopback TCP from the selected daemon's published port file
 *   5. otherwise fail closed with ENDPOINT_NOT_PUBLISHED (never guess)
 *
 * `env` and `fileExists` are injectable so callers/tests are deterministic
 * regardless of whether a real socket file happens to exist on the box.
 */
export function resolveDaemonTarget(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
  options: Omit<DaemonPortDiscoveryOptions, 'env'> = {},
): DaemonTarget {
  const discoveryOptions: DaemonPortDiscoveryOptions = { ...options, env };
  if (env.PORT_DADDY_FORCE_TCP === '1') return resolveDaemonTcpTarget(env.PORT_DADDY_URL, discoveryOptions);
  if (env.PORT_DADDY_SOCK) return { socketPath: env.PORT_DADDY_SOCK };
  if (env.PORT_DADDY_URL) return resolveDaemonTcpTarget(env.PORT_DADDY_URL, discoveryOptions);
  if (fileExists(DEFAULT_SOCK)) return { socketPath: DEFAULT_SOCK };
  return resolveDaemonTcpTarget(env.PORT_DADDY_URL, discoveryOptions);
}
