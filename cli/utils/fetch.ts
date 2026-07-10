/**
 * CLI Fetch Utilities
 *
 * HTTP client that routes through Unix socket when available,
 * with fallback to TCP for daemon communication.
 */

import http from 'node:http';
import type { IncomingMessage, ClientRequest } from 'node:http';

import { DEFAULT_SOCK, DEFAULT_PORT_FILE } from '../../shared/paths.js';
import { maybeWarnNonProdPlane, isMutatingMethod, PLANE_PROBE_TIMEOUT_MS } from './plane-banner.js';
import { CANONICAL_TCP_PORT, LOOPBACK_TCP_HOST, getDaemonTcpUrl, readDaemonPort, resolveDaemonTarget, resolveDaemonTcpTarget } from '../../shared/daemon-discovery.js';
import type { DaemonTarget } from '../../shared/daemon-discovery.js';
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;
const PORT_FILE: string = process.env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE;
const PORT_DADDY_URL: string = getDaemonTcpUrl(process.env.PORT_DADDY_URL);

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
}

/**
 * Resolve connection target: Unix socket or TCP.
 *
 * Delegates to the ONE canonical resolver in shared/daemon-discovery. Before
 * this delegation, this copy ignored PORT_DADDY_SOCK entirely and checked the
 * URL before the socket — a different precedence than lib/request.ts. Now all
 * Node clients agree.
 */
export function resolveTarget(): ConnectionTarget {
  return resolveDaemonTarget();
}

/**
 * Get the daemon's display URL (for status messages, dashboard links, etc.)
 */
export function getDaemonUrl(): string {
  if (process.env.PORT_DADDY_URL) return process.env.PORT_DADDY_URL;
  return `http://${LOOPBACK_TCP_HOST}:${readDaemonPort(PORT_FILE) || CANONICAL_TCP_PORT}`;
}

function requestTarget(target: ConnectionTarget, path: string, options: FetchOptions): Promise<PdFetchResponse> {
  const { method = 'GET', headers = {}, body = null, timeout = 10000 } = options;
  const requestPath = path.startsWith('http://') || path.startsWith('https://')
    ? new URL(path).pathname + (new URL(path).search || '')
    : path;
  const safeTarget: ConnectionTarget = target.socketPath && /^https?:\/\//.test(target.socketPath)
    ? { host: LOOPBACK_TCP_HOST, port: readDaemonPort(PORT_FILE) }
    : target;

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
      ...(safeTarget.socketPath
        ? { socketPath: safeTarget.socketPath }
        : { host: safeTarget.host, port: safeTarget.port }),
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
    const fallbackTarget: ConnectionTarget = {
      host: LOOPBACK_TCP_HOST,
      port: readDaemonPort(PORT_FILE),
    };
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

  const noRetry = process.env.PORT_DADDY_NO_RETRY === '1';
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
