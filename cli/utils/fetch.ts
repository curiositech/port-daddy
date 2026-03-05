/**
 * CLI Fetch Utilities
 *
 * HTTP client that routes through Unix socket when available,
 * with fallback to TCP for daemon communication.
 */

import http from 'node:http';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';

// Default Unix socket path — the primary transport for CLI->daemon communication.
const DEFAULT_SOCK: string = '/tmp/port-daddy.sock';
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;
const PORT_FILE: string = process.env.PORT_DADDY_PORT_FILE || '/tmp/port-daddy-port';
const PORT_DADDY_URL: string = process.env.PORT_DADDY_URL || 'http://localhost:9876';

export { PORT_DADDY_URL, SOCK_PATH };

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
 * Read actual daemon port from port file (daemon writes this on startup).
 * Falls back to 9876 if file doesn't exist or can't be read.
 */
function readPortFile(): number {
  try {
    const raw = readFileSync(PORT_FILE, 'utf-8').trim();
    const port = parseInt(raw, 10);
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
      return port;
    }
  } catch {}
  return 9876;
}

/**
 * Resolve connection target: Unix socket or TCP.
 */
export function resolveTarget(): ConnectionTarget {
  // Explicit TCP URL overrides socket
  if (process.env.PORT_DADDY_URL) {
    const url = new URL(process.env.PORT_DADDY_URL);
    return { host: url.hostname, port: parseInt(url.port, 10) || 9876 };
  }
  // Use socket if it exists
  if (existsSync(SOCK_PATH)) {
    return { socketPath: SOCK_PATH };
  }
  // Fallback to TCP — read actual port from port file
  return { host: 'localhost', port: readPortFile() };
}

/**
 * Get the daemon's display URL (for status messages, dashboard links, etc.)
 */
export function getDaemonUrl(): string {
  if (process.env.PORT_DADDY_URL) return process.env.PORT_DADDY_URL;
  return `http://localhost:${readPortFile()}`;
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
