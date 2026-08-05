import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type DaemonEnvironment = Record<string, string | undefined>;
type PortFileReader = (path: string, encoding: 'utf8') => string;

/**
 * Resolve the daemon selected for this process.
 *
 * Named development daemons export PORT_DADDY_URL or PORT_DADDY_PORT_FILE. A
 * stable Homebrew daemon atomically publishes the port it actually bound. There
 * is deliberately no guessed-port fallback: an absent publication is an absent
 * endpoint, not permission to contact an unrelated process.
 */
export function resolveDaemonUrl(
  environment: DaemonEnvironment = process.env,
  readPortFile: PortFileReader = readFileSync,
): string {
  const explicit = environment.PORT_DADDY_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const portFile = environment.PORT_DADDY_PORT_FILE?.trim()
    || join(homedir(), '.port-daddy', 'daemon.port');
  let published: string;
  try {
    published = readPortFile(portFile, 'utf8').trim();
  } catch {
    throw new Error(
      `No Port Daddy endpoint is published. Start or select a daemon, or set PORT_DADDY_URL (looked for ${portFile}).`,
    );
  }

  const port = Number.parseInt(published, 10);
  if (!/^\d+$/.test(published) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid Port Daddy port publication in ${portFile}: ${JSON.stringify(published)}`);
  }

  const host = environment.PORT_DADDY_HOST?.trim() || '127.0.0.1';
  return `http://${host}:${port}`;
}
