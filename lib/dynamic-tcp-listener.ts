import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface DynamicTcpBinding {
  server: Server;
  port: number;
  preferredPort: number;
  usedFallback: boolean;
}

function listenOnce(createServer: () => Server, port: number, host: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('TCP listener did not publish an IP port'));
        return;
      }
      resolve({ server, port: (address as AddressInfo).port });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Bind the preferred control port, then ask the OS for a free port if it is
 * occupied. Port identity is published separately; callers must never infer a
 * daemon's authority from whether it won the preferred seed.
 */
export async function listenWithDynamicTcpFallback(
  createServer: () => Server,
  preferredPort: number,
  host: string,
): Promise<DynamicTcpBinding> {
  try {
    const bound = await listenOnce(createServer, preferredPort, host);
    return { ...bound, preferredPort, usedFallback: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || preferredPort === 0) throw error;
    const bound = await listenOnce(createServer, 0, host);
    return { ...bound, preferredPort, usedFallback: true };
  }
}

/** Atomically replace the daemon endpoint witness consumed by every client. */
export function publishDaemonPort(portFile: string, port: number, pid = process.pid): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`cannot publish invalid daemon port: ${port}`);
  }
  mkdirSync(dirname(portFile), { recursive: true });
  const temporary = `${portFile}.${pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${port}\n`, { mode: 0o644 });
    renameSync(temporary, portFile);
  } finally {
    try { unlinkSync(temporary); } catch { /* rename already consumed it */ }
  }
}
