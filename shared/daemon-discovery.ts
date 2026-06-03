import { readFileSync } from 'node:fs';
import { DEFAULT_PORT_FILE } from './paths.js';

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
 * Resolution order: `PORT_DADDY_URL` env var → `http://<host>:<resolveDaemonPort()>`.
 */
export function resolveDaemonUrl(explicitUrl = process.env.PORT_DADDY_URL): string {
  if (explicitUrl && explicitUrl.trim()) return explicitUrl;
  return `http://${LOOPBACK_TCP_HOST}:${resolveDaemonPort()}`;
}

/**
 * @deprecated Prefer {@link resolveDaemonUrl}. Back-compat alias.
 */
export const getDaemonTcpUrl = resolveDaemonUrl;

export function resolveDaemonTcpTarget(explicitUrl = process.env.PORT_DADDY_URL): { host: string; port: number } {
  const url = new URL(resolveDaemonUrl(explicitUrl));
  return {
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || DEFAULT_DAEMON_PORT,
  };
}
