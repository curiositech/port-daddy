/**
 * CLI Fetch Utilities
 *
 * HTTP client that routes through Unix socket when available,
 * with fallback to TCP for daemon communication.
 */

import http from 'node:http';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { existsSync } from 'node:fs';

import { DEFAULT_SOCK, DEFAULT_PORT_FILE } from '../../shared/paths.js';
import { CANONICAL_TCP_PORT, LOOPBACK_TCP_HOST, getDaemonTcpUrl, readDaemonPort, resolveDaemonTcpTarget } from '../../shared/daemon-discovery.js';
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;
const PORT_FILE: string = process.env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE;
const PORT_DADDY_URL: string = getDaemonTcpUrl(process.env.PORT_DADDY_URL);
const BARNACLE_URL: string = process.env.PORT_DADDY_BARNACLE_URL || 'http://localhost:9875';

export { PORT_DADDY_URL, BARNACLE_URL, SOCK_PATH };

export interface ConnectionTarget {
  socketPath?: string;
  host?: string;
  port?: number;
}

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
  body?: string | null;
}

/**
 * Resolve connection target: Unix socket or TCP.
 */
export function resolveTarget(): ConnectionTarget {
  // Explicit TCP URL overrides socket
  if (process.env.PORT_DADDY_URL) {
    return resolveDaemonTcpTarget(process.env.PORT_DADDY_URL);
  }
  // Use socket if it exists
  if (existsSync(SOCK_PATH)) {
    return { socketPath: SOCK_PATH };
  }
  // Fallback to TCP — read actual port from port file
  return { host: LOOPBACK_TCP_HOST, port: readDaemonPort(PORT_FILE) };
}

/**
 * Get the daemon's display URL (for status messages, dashboard links, etc.)
 */
export function getDaemonUrl(): string {
  if (process.env.PORT_DADDY_URL) return process.env.PORT_DADDY_URL;
  return `http://${LOOPBACK_TCP_HOST}:${readDaemonPort(PORT_FILE) || CANONICAL_TCP_PORT}`;
}

/**
 * Drop-in replacement for fetch() that routes through Unix socket when available.
 * Returns an object matching the subset of the fetch Response API that the CLI uses.
 */
export function pdFetch(urlOrPath: string, options: FetchOptions = {}): Promise<PdFetchResponse> {
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

  const target: ConnectionTarget = resolveTarget();
  const { method = 'GET', headers = {}, body = null } = options;

  const reqHeaders: Record<string, string | number> = { ...headers };
  if (body && !reqHeaders['Content-Length']) {
    reqHeaders['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const reqOpts: http.RequestOptions = {
      method,
      path,
      headers: reqHeaders as http.OutgoingHttpHeaders,
      timeout: 10000,
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
