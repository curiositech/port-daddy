import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolve the local daemon for standalone public Node examples. */
export function resolveExampleDaemonUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PORT_DADDY_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const portFile = env.PORT_DADDY_PORT_FILE || join(homedir(), '.port-daddy', 'daemon.port');
  try {
    const port = Number.parseInt(readFileSync(portFile, 'utf8').trim(), 10);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // The actionable error below is clearer than leaking a filesystem error.
  }
  throw new Error('Port Daddy has not published an endpoint. Start it or set PORT_DADDY_URL.');
}
