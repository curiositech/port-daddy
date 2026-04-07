import { readFileSync } from 'node:fs';
import { DEFAULT_PORT_FILE } from './paths.js';

export const CANONICAL_TCP_PORT = 9876;

export function readDaemonPort(portFile = process.env.PORT_DADDY_PORT_FILE || DEFAULT_PORT_FILE): number {
  try {
    const raw = readFileSync(portFile, 'utf-8').trim();
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) {
      return parsed;
    }
  } catch {
    // Fall through to the canonical preferred port.
  }
  return CANONICAL_TCP_PORT;
}

export function getDaemonTcpUrl(explicitUrl = process.env.PORT_DADDY_URL): string {
  if (explicitUrl && explicitUrl.trim()) return explicitUrl;
  return `http://localhost:${readDaemonPort()}`;
}

export function resolveDaemonTcpTarget(explicitUrl = process.env.PORT_DADDY_URL): { host: string; port: number } {
  const url = new URL(getDaemonTcpUrl(explicitUrl));
  return {
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || CANONICAL_TCP_PORT,
  };
}
