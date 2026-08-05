/**
 * Port Daddy HTTP Request Helper
 *
 * Routes requests through Unix domain socket (default) or TCP.
 * This is the single point of connection configuration for all
 * CLI commands and the SDK.
 *
 * Priority:
 *   1. PORT_DADDY_SOCK env var -> Unix socket path
 *   2. PORT_DADDY_URL env var -> TCP URL
 *   3. Default: ~/.port-daddy/daemon.sock (Unix socket)
 *   4. Fallback: discovered localhost TCP port from ~/.port-daddy/daemon.port,
 *      or the canonical preferred port when no port file exists
 */

import http from 'node:http';

import { resolveDaemonUrl, resolveDaemonTarget } from '../shared/daemon-discovery.js';
import type { DaemonTarget as ConnectionTarget } from '../shared/daemon-discovery.js';

/** Options accepted by pdRequest */
interface PdRequestOptions {
  method?: string;
  body?: Record<string, unknown> | null;
  headers?: Record<string, string>;
  timeout?: number;
}

/** Shape returned by every pdRequest call */
export interface PdResponse {
  ok: boolean;
  status: number;
  data: unknown;
  text: string;
  headers: http.IncomingHttpHeaders;
}

/**
 * Resolve connection target — delegates to the ONE canonical resolver in
 * shared/daemon-discovery. (This used to be a hand-rolled copy; it was the
 * reference for the canonical precedence, now deduplicated.)
 * Returns { socketPath } for Unix socket or { host, port } for TCP.
 */
export function resolveTarget(): ConnectionTarget {
  return resolveDaemonTarget();
}

/**
 * Get the base URL for display/logging purposes.
 */
export function getDisplayUrl(): string {
  const target = resolveTarget();
  if (target.socketPath) {
    return `unix:${target.socketPath}`;
  }
  return resolveDaemonUrl(target.port ? `http://${target.host}:${target.port}` : undefined);
}

/**
 * Make an HTTP request to the Port Daddy daemon.
 * Works over Unix socket or TCP transparently.
 */
export function pdRequest(path: string, options: PdRequestOptions = {}): Promise<PdResponse> {
  const {
    method = 'GET',
    body = null,
    headers = {},
    timeout = 5000
  } = options;

  const target = resolveTarget();
  const jsonBody = body ? JSON.stringify(body) : null;

  const reqHeaders: Record<string, string | number> = {
    ...headers,
    ...(jsonBody ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(jsonBody) } : {})
  };

  return new Promise((resolve, reject) => {
    const reqOpts: http.RequestOptions = {
      method,
      path,
      headers: reqHeaders,
      timeout,
      ...(target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port })
    };

    const req = http.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let data: unknown;
        try { data = JSON.parse(text); } catch { data = text; }

        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          data,
          text,
          headers: res.headers
        });
      });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error(
          `Port Daddy daemon is not running. Start it with: port-daddy start\n` +
          `  (tried: ${target.socketPath || `${target.host}:${target.port}`})`
        ));
      } else {
        reject(err);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeout}ms`));
    });

    if (jsonBody) req.write(jsonBody);
    req.end();
  });
}

/**
 * Convenience: GET with JSON response
 */
export async function pdGet(path: string): Promise<PdResponse> {
  return pdRequest(path);
}

/**
 * Convenience: POST with JSON body
 */
export async function pdPost(path: string, body?: Record<string, unknown>): Promise<PdResponse> {
  return pdRequest(path, { method: 'POST', body });
}

/**
 * Convenience: DELETE with optional JSON body
 */
export async function pdDelete(path: string, body?: Record<string, unknown>): Promise<PdResponse> {
  return pdRequest(path, { method: 'DELETE', ...(body ? { body } : {}) });
}

/**
 * Convenience: PUT with JSON body
 */
export async function pdPut(path: string, body?: Record<string, unknown>): Promise<PdResponse> {
  return pdRequest(path, { method: 'PUT', body });
}

/**
 * Check if the daemon is reachable.
 */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await pdGet('/health');
    return res.ok;
  } catch {
    return false;
  }
}
