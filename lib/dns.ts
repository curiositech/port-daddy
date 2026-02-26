/**
 * Local DNS for Ports
 *
 * Registers services via mDNS (Bonjour on macOS, Avahi on Linux)
 * so you can access `myapp:api` as `myapp-api.local` instead of `localhost:9234`
 */

import { spawn, ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
import Database from 'better-sqlite3';

interface DnsRegistration {
  identity: string;
  hostname: string;
  port: number;
  pid: number | null;
  registeredAt: number;
}

interface DnsModule {
  register(identity: string, port: number): Promise<{ success: boolean; hostname: string; error?: string }>;
  unregister(identity: string): Promise<{ success: boolean }>;
  list(): DnsRegistration[];
  cleanup(): void;
}

// Track child processes for cleanup
const processes = new Map<string, ChildProcess>();

/**
 * Convert identity to valid mDNS hostname
 * myapp:api:main → myapp-api-main
 */
function identityToHostname(identity: string): string {
  return identity
    .replace(/:/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase()
    .slice(0, 63); // mDNS limit
}

export function createDns(db: Database.Database): DnsModule {
  // Create table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS dns_registrations (
      identity TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      port INTEGER NOT NULL,
      pid INTEGER,
      registered_at INTEGER NOT NULL
    )
  `);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO dns_registrations (identity, hostname, port, pid, registered_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const deleteStmt = db.prepare(`DELETE FROM dns_registrations WHERE identity = ?`);
  const listStmt = db.prepare(`SELECT * FROM dns_registrations`);
  const getStmt = db.prepare(`SELECT * FROM dns_registrations WHERE identity = ?`);

  return {
    async register(identity: string, port: number) {
      const hostname = identityToHostname(identity);
      const os = platform();

      if (os !== 'darwin' && os !== 'linux') {
        return { success: false, hostname, error: 'mDNS only supported on macOS and Linux' };
      }

      // Kill existing registration if any
      const existing = processes.get(identity);
      if (existing) {
        existing.kill();
        processes.delete(identity);
      }

      try {
        let child: ChildProcess;

        if (os === 'darwin') {
          // macOS: Use dns-sd -P (proxy registration) to create hostname mapping
          // -P: Register a service with a proxy (creates A record for hostname)
          // Format: dns-sd -P <name> <type> <domain> <port> <host> <ip>
          child = spawn('dns-sd', [
            '-P', hostname, '_http._tcp', 'local', String(port),
            `${hostname}.local`, '127.0.0.1'
          ], {
            stdio: 'ignore',
            detached: true
          });
        } else {
          // Linux: Use avahi-publish with address
          child = spawn('avahi-publish', [
            '-a', `${hostname}.local`, '127.0.0.1'
          ], {
            stdio: 'ignore',
            detached: true
          });
        }

        child.unref();
        processes.set(identity, child);

        // Store in database
        insertStmt.run(identity, hostname, port, child.pid ?? null, Date.now());

        return { success: true, hostname: `${hostname}.local` };
      } catch (error) {
        return { success: false, hostname, error: String(error) };
      }
    },

    async unregister(identity: string) {
      const child = processes.get(identity);
      if (child) {
        child.kill();
        processes.delete(identity);
      }
      deleteStmt.run(identity);
      return { success: true };
    },

    list() {
      const rows = listStmt.all() as any[];
      return rows.map(row => ({
        identity: row.identity,
        hostname: `${row.hostname}.local`,
        port: row.port,
        pid: row.pid,
        registeredAt: row.registered_at
      }));
    },

    cleanup() {
      // Kill all dns-sd/avahi processes
      for (const [identity, child] of processes) {
        child.kill();
        processes.delete(identity);
      }
      db.exec('DELETE FROM dns_registrations');
    }
  };
}
