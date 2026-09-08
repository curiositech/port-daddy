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
 * Startup may prefer this port, but connection code must never treat the
 * preference as evidence that a daemon actually bound it.
 */
export const PREFERRED_DAEMON_PORT = DEFAULT_DAEMON_PORT;

/**
 * @deprecated Prefer {@link DEFAULT_DAEMON_PORT}. Retained as a back-compat
 * alias for existing importers (lib/client.ts, cli/utils/fetch.ts, etc.).
 */
export const CANONICAL_TCP_PORT = DEFAULT_DAEMON_PORT;
export const LOOPBACK_TCP_HOST = process.env.PORT_DADDY_TCP_HOST?.trim() || '127.0.0.1';

const DECIMAL_PORT = /^[0-9]+$/;

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

export interface DaemonTargetDiscoveryOptions extends DaemonPortDiscoveryOptions {
  /** Injectable canonical socket path for hermetic component tests. */
  socketPath?: string;
}

/**
 * Parse an endpoint publication as one strict decimal TCP port. The design
 * rejects coercible junk so malformed state cannot redirect a client.
 *
 * @param raw - Untrusted environment or file content.
 * @param sourceLabel - Human-readable source included in failures.
 * @returns A validated TCP port from 1 through 65535.
 */
function parsePort(raw: string, sourceLabel: string): number {
  const value = raw.trim();
  if (!DECIMAL_PORT.test(value)) {
    throw new DaemonEndpointDiscoveryError(
      'INVALID_PUBLISHED_PORT',
      `${sourceLabel} must contain one decimal TCP port and nothing else`,
    );
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new DaemonEndpointDiscoveryError(
      'INVALID_PUBLISHED_PORT',
      `${sourceLabel} published out-of-range TCP port ${value}; expected 1..65535`,
    );
  }
  return port;
}

/**
 * Discover a TCP endpoint the selected daemon actually published.
 *
 * Missing publication returns null. Malformed or unreadable state throws so a
 * client cannot silently connect to an unrelated listener on the preferred
 * allocator port.
 *
 * @param options - Injectable environment, path, and reader for deterministic discovery.
 * @returns The selected daemon's publication, or null when no publication exists.
 */
export function discoverPublishedDaemonPort(options: DaemonPortDiscoveryOptions = {}): PublishedDaemonPort | null {
  const env = options.env ?? process.env;
  const envPort = env.PORT_DADDY_PORT?.trim();
  if (envPort) {
    return { port: parsePort(envPort, 'PORT_DADDY_PORT'), source: 'env', portFile: null };
  }

  const portFile = options.portFile ?? env.PORT_DADDY_PORT_FILE ?? DEFAULT_PORT_FILE;
  const readTextFile = options.readTextFile ?? ((path: string) => readFileSync(path, 'utf-8'));
  try {
    return {
      port: parsePort(readTextFile(portFile), `Selected daemon port file ${portFile}`),
      source: 'port-file',
      portFile,
    };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
    if (code === 'ENOENT') return null;
    if (error instanceof DaemonEndpointDiscoveryError) throw error;
    throw new DaemonEndpointDiscoveryError(
      'INVALID_PUBLISHED_PORT',
      `Could not read the selected daemon port file at ${portFile}`,
      { cause: error },
    );
  }
}

/**
 * Require positive evidence of the selected daemon's TCP endpoint. The
 * purpose is a fail-closed boundary for clients that cannot use a Unix socket.
 *
 * @param options - Injectable discovery inputs.
 * @returns A validated published port and its provenance.
 */
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
 *   3. {@link DEFAULT_DAEMON_PORT}
 */
export function resolveDaemonPort(portFile = process.env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE): number {
  const envPort = process.env.PORT_DADDY_PORT?.trim();
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
 * Resolution order: explicit URL → `PD_URL`/`PORT_DADDY_URL` env var →
 * `http://<host>:<resolveDaemonPort()>`.
 */
export function resolveDaemonUrl(explicitUrl?: string): string {
  const selectedUrl = explicitUrl?.trim() || process.env.PD_URL?.trim() || process.env.PORT_DADDY_URL?.trim();
  if (selectedUrl) return selectedUrl;
  return `http://${LOOPBACK_TCP_HOST}:${resolveDaemonPort()}`;
}

/**
 * Resolve only an explicit or actually published TCP endpoint. The design
 * never turns the preferred allocator port into proof of a running daemon.
 *
 * @param explicitUrl - Caller-selected HTTP(S) endpoint, when present.
 * @param options - Injectable publication discovery inputs.
 * @returns The explicit or published daemon URL.
 */
export function resolvePublishedDaemonUrl(
  explicitUrl?: string,
  options: DaemonPortDiscoveryOptions = {},
): string {
  const env = options.env ?? process.env;
  const selectedUrl = explicitUrl?.trim() || env.PD_URL?.trim() || env.PORT_DADDY_URL?.trim();
  if (selectedUrl?.trim()) {
    const value = selectedUrl.trim();
    let url: URL;
    try {
      url = new URL(value);
    } catch (cause) {
      throw new DaemonEndpointDiscoveryError(
        'UNSUPPORTED_DAEMON_URL',
        'PORT_DADDY_URL must be an absolute HTTP URL',
        { cause },
      );
    }
    // The current Node clients use node:http. Accepting https here would send
    // plaintext bytes to a TLS port, so fail closed until every transport can
    // carry the protocol as an explicit interface field.
    if (url.protocol !== 'http:') {
      throw new DaemonEndpointDiscoveryError(
        'UNSUPPORTED_DAEMON_URL',
        `PORT_DADDY_URL must use http: with the current daemon transport, got ${url.protocol}`,
      );
    }
    return value;
  }
  const host = env.PORT_DADDY_TCP_HOST?.trim() || LOOPBACK_TCP_HOST;
  return `http://${host}:${requirePublishedDaemonPort(options).port}`;
}

/**
 * @deprecated Prefer {@link resolvePublishedDaemonUrl}. This compatibility
 * display helper never manufactures the preferred port and returns an empty
 * value when no endpoint is published, so eager legacy imports stay inert.
 */
export function getDaemonTcpUrl(
  explicitUrl?: string,
  options: DaemonPortDiscoveryOptions = {},
): string {
  try {
    return resolvePublishedDaemonUrl(explicitUrl, options);
  } catch (error) {
    if (error instanceof DaemonEndpointDiscoveryError && error.code === 'ENDPOINT_NOT_PUBLISHED') return '';
    throw error;
  }
}

/**
 * Convert a proven daemon URL into Node HTTP connection coordinates. The
 * purpose is strict protocol and default-port handling without a 9876 guess.
 *
 * @param explicitUrl - Caller-selected HTTP(S) endpoint, when present.
 * @param options - Injectable publication discovery inputs.
 * @returns Validated host and TCP port coordinates.
 */
export function resolveDaemonTcpTarget(
  explicitUrl?: string,
  options: DaemonPortDiscoveryOptions = {},
): { host: string; port: number } {
  const url = new URL(resolvePublishedDaemonUrl(explicitUrl, options));
  if (url.protocol !== 'http:') {
    throw new DaemonEndpointDiscoveryError(
      'UNSUPPORTED_DAEMON_URL',
      `PORT_DADDY_URL must use http: with the current daemon transport, got ${url.protocol}`,
    );
  }
  return {
    host: url.hostname,
    port: url.port ? parsePort(url.port, 'PORT_DADDY_URL') : 80,
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
 *   2. `PD_URL` / `PORT_DADDY_URL` env → explicit TCP URL (`PD_URL` wins)
 *   3. the daemon's socket file ({@link DEFAULT_SOCK}) exists → Unix socket
 *   4. loopback TCP from the selected daemon's published port file
 *   5. otherwise fail closed (never guess the allocator preference)
 *
 * `env` and `fileExists` are injectable so callers/tests are deterministic
 * regardless of whether a real socket file happens to exist on the box.
 */
export function resolveDaemonTarget(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
  options: Omit<DaemonTargetDiscoveryOptions, 'env'> = {},
): DaemonTarget {
  const { socketPath = DEFAULT_SOCK, ...portOptions } = options;
  const discoveryOptions: DaemonPortDiscoveryOptions = { ...portOptions, env };
  const explicitUrl = env.PD_URL?.trim() || env.PORT_DADDY_URL?.trim() || undefined;
  if (env.PORT_DADDY_FORCE_TCP === '1') return resolveDaemonTcpTarget(explicitUrl, discoveryOptions);
  if (env.PORT_DADDY_SOCK) return { socketPath: env.PORT_DADDY_SOCK };
  if (explicitUrl) return resolveDaemonTcpTarget(explicitUrl, discoveryOptions);
  if (fileExists(socketPath)) return { socketPath };
  return resolveDaemonTcpTarget(explicitUrl, discoveryOptions);
}
