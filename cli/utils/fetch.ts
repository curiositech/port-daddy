/**
 * CLI Fetch Utilities
 *
 * HTTP client that routes through Unix socket when available,
 * with fallback to TCP for daemon communication.
 */

import http from 'node:http';
import type { IncomingMessage, ClientRequest } from 'node:http';

import { DEFAULT_SOCK } from '../../shared/paths.js';
import { maybeWarnNonProdPlane, isMutatingMethod, PLANE_PROBE_TIMEOUT_MS } from './plane-banner.js';
import { resolveDaemonTarget, resolveDaemonTcpTarget, resolvePublishedDaemonUrl } from '../../shared/daemon-discovery.js';
import type { DaemonTarget } from '../../shared/daemon-discovery.js';
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;
// Most legacy callers concatenate this with a relative path before handing it
// back to pdFetch(), which resolves the actual transport independently. Keep
// the compatibility prefix empty unless the operator selected an explicit URL;
// manufacturing a preferred-port URL here would reintroduce a port guess.
const PORT_DADDY_URL: string = process.env.PORT_DADDY_URL?.replace(/\/$/, '') ?? '';

export { PORT_DADDY_URL, SOCK_PATH };

/** @deprecated Use {@link DaemonTarget} from shared/daemon-discovery. Kept as a structural alias for back-compat importers. */
export type ConnectionTarget = DaemonTarget;

export interface PdFetchResponse {
  ok: boolean;
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  json: () => Promise<Record<string, unknown>>;
  text: () => Promise<string>;
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string | number>;
  body?: string | Buffer | null;
  timeout?: number;
  transport?: 'auto' | 'tcp';
  /** Disable launchd-window reconnect retries for optional latency-critical calls. */
  retry?: boolean;
  /** Abort the active socket/TCP request when a caller's total deadline expires. */
  signal?: AbortSignal;
}

/**
 * Resolve connection target: Unix socket or TCP.
 *
 * The design delegates to the ONE canonical resolver in shared/daemon-discovery. Before
 * this delegation, this copy ignored PORT_DADDY_SOCK entirely and checked the
 * URL before the socket — a different precedence than lib/request.ts. Now all
 * Node clients agree.
 *
 * @returns The selected Unix-socket or strictly published TCP target.
 */
export function resolveTarget(): ConnectionTarget {
  return resolveDaemonTarget();
}

/**
 * Get the daemon's display URL (for status messages, dashboard links, etc.).
 * The design returns an empty string when no endpoint is published so display
 * code cannot accidentally turn the preferred allocator port into evidence.
 *
 * @returns An explicit/published daemon URL, or an empty fail-closed value.
 */
export function getDaemonUrl(): string {
  try {
    return resolvePublishedDaemonUrl(process.env.PORT_DADDY_URL).replace(/\/$/, '');
  } catch {
    // Display callers may be initialized before the daemon publishes an
    // endpoint. Empty is fail-closed and avoids manufacturing a preferred port.
    return '';
  }
}

function requestTarget(target: ConnectionTarget, path: string, options: FetchOptions): Promise<PdFetchResponse> {
  const { method = 'GET', headers = {}, body = null, timeout = 10000 } = options;
  const requestPath = path.startsWith('http://') || path.startsWith('https://')
    ? new URL(path).pathname + (new URL(path).search || '')
    : path;
  const reqHeaders: Record<string, string | number> = { ...headers };
  if (body && !reqHeaders['Content-Length']) {
    reqHeaders['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const reqOpts: http.RequestOptions = {
      method,
      path: requestPath,
      headers: reqHeaders as http.OutgoingHttpHeaders,
      timeout,
      signal: options.signal,
      ...(target.socketPath
        ? { socketPath: target.socketPath }
        : { host: target.host, port: target.port }),
    };
    const req: ClientRequest = http.request(reqOpts, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text: string = Buffer.concat(chunks).toString();
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode,
          headers: res.headers,
          json: async () => JSON.parse(text) as Record<string, unknown>,
          text: async () => text,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) req.write(body);
    req.end();
  });
}

function shouldFallbackFromSocket(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : '';
  const message = error instanceof Error ? error.message : '';
  return code === 'ENOENT' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    message.includes('timed out');
}

/**
 * "The daemon isn't accepting connections right now." Distinct from
 * `shouldFallbackFromSocket` (which also triggers on ECONNRESET / timeout
 * — those can mean a hung-but-reachable daemon). Only ECONNREFUSED and
 * ENOENT (socket file missing) mean "process is gone, wait for respawn."
 */
function isDaemonDownError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : '';
  return code === 'ECONNREFUSED' || code === 'ENOENT';
}

/**
 * Backoff for retrying after the daemon goes ECONNREFUSED. Sized for the
 * launchd respawn window: clean SIGTERMs from `promote-stable.sh` cause
 * ~1s of unavailability before `KeepAlive` brings the daemon back.
 * Total budget ≈ 2.9s across 4 retries.
 *
 * Disable with `PORT_DADDY_NO_RETRY=1` (tests, debugging, pointing at a
 * known-dead remote daemon).
 */
const DAEMON_RECONNECT_DELAYS_MS: readonly number[] = [200, 400, 800, 1500];

function singleRequest(path: string, options: FetchOptions): Promise<PdFetchResponse> {
  const target: ConnectionTarget = options.transport === 'tcp'
    ? resolveDaemonTcpTarget(process.env.PORT_DADDY_URL)
    : resolveTarget();
  return requestTarget(target, path, options).catch((error: unknown) => {
    if (!target.socketPath || process.env.PORT_DADDY_URL || !shouldFallbackFromSocket(error)) {
      throw error;
    }
    const fallbackTarget = resolveDaemonTcpTarget(process.env.PORT_DADDY_URL);
    return requestTarget(fallbackTarget, path, options);
  });
}

/**
 * Drop-in replacement for fetch() that routes through Unix socket when available.
 * On ECONNREFUSED / ENOENT, retries with exponential backoff to absorb the
 * launchd respawn window. Other errors (timeouts, 4xx/5xx, ECONNRESET) fail
 * fast — those mean a different problem than "daemon temporarily down."
 */
export async function pdFetch(urlOrPath: string, options: FetchOptions = {}): Promise<PdFetchResponse> {
  // Extract just the path from a full URL or use as-is if already a path
  let path: string;
  if (urlOrPath.startsWith('/')) {
    path = urlOrPath;
  } else {
    try {
      path = new URL(urlOrPath).pathname + (new URL(urlOrPath).search || '');
    } catch {
      path = urlOrPath;
    }
  }

  // S1 plane banner: before this process's FIRST mutating request, probe
  // /version once and warn on stderr when the resolved daemon's state plane
  // is not `prod` ("⚠ writes → dev-latest (http://…)"). Read-only commands
  // skip outright; the probe is once-per-process, short-timeout, and silent
  // on any failure — see cli/utils/plane-banner.ts for the full contract.
  if (isMutatingMethod(options.method)) {
    await maybeWarnNonProdPlane({
      method: options.method,
      fetchVersion: async () => {
        const res = await singleRequest('/version', { timeout: PLANE_PROBE_TIMEOUT_MS });
        return res.ok ? await res.json() : null;
      },
      daemonUrl: getDaemonUrl,
    });
  }

  const noRetry = options.retry === false || process.env.PORT_DADDY_NO_RETRY === '1';
  const delays: readonly number[] = noRetry ? [] : DAEMON_RECONNECT_DELAYS_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await singleRequest(path, options);
    } catch (error) {
      lastError = error;
      if (!isDaemonDownError(error) || attempt === delays.length) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  // Unreachable — the loop either returns or throws — but TS needs the explicit throw.
  throw lastError;
}

/**
 * Check if daemon is reachable
 */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await pdFetch('/health');
    return res.ok;
  } catch {
    return false;
  }
}
