import { renameSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * Publish the bound TCP port as one replace operation. Readers see either the
 * previous complete value or the new complete value, never a truncated file.
 */
export function publishDaemonEndpoint(
  portFile: string,
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  host = '127.0.0.1',
): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`refusing to publish invalid daemon port: ${port}`);
  }
  const temporary = `${portFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, String(port), { mode: 0o644 });
    renameSync(temporary, portFile);
    // The daemon is also the parent of hooks and spawned CLI agents. Make its
    // descendants inherit the listener that actually won, not the preferred
    // candidate that may have been occupied.
    const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    env.PORT_DADDY_PORT = String(port);
    env.PORT_DADDY_URL = `http://${urlHost}:${port}`;
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}
