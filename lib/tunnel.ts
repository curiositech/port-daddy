/**
 * Tunnel Module - Expose local services to the internet
 *
 * Supports: ngrok, cloudflared (Cloudflare Tunnel), localtunnel
 */

import { spawn, ChildProcess } from 'child_process';
import type Database from 'better-sqlite3';

export type TunnelProvider = 'ngrok' | 'cloudflared' | 'localtunnel';

interface TunnelProcess {
  provider: TunnelProvider;
  serviceId: string;
  port: number;
  process: ChildProcess;
  url: string | null;
  startedAt: number;
}

interface TunnelStatus {
  serviceId: string;
  provider: TunnelProvider;
  port: number;
  url: string | null;
  status: 'starting' | 'running' | 'stopped' | 'error';
  pid?: number;
  startedAt?: number;
  error?: string;
}

/**
 * Create the tunnel manager
 */
export function createTunnel(db: Database.Database) {
  // Active tunnel processes (in-memory, lost on restart)
  const activeTunnels = new Map<string, TunnelProcess>();

  const stmts = {
    getById: db.prepare('SELECT * FROM services WHERE id = ?'),
    updateTunnel: db.prepare(`
      UPDATE services SET tunnel_provider = ?, tunnel_url = ?, last_seen = ?
      WHERE id = ?
    `),
    clearTunnel: db.prepare(`
      UPDATE services SET tunnel_provider = NULL, tunnel_url = NULL, last_seen = ?
      WHERE id = ?
    `)
  };

  /**
   * Check if a provider is installed
   */
  async function checkProvider(provider: TunnelProvider): Promise<boolean> {
    const commands: Record<TunnelProvider, string> = {
      ngrok: 'ngrok',
      cloudflared: 'cloudflared',
      localtunnel: 'lt'
    };

    return new Promise(resolve => {
      const proc = spawn('which', [commands[provider]]);
      proc.on('close', code => resolve(code === 0));
    });
  }

  /**
   * Start a tunnel for a service
   */
  async function start(
    serviceId: string,
    provider: TunnelProvider = 'ngrok'
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    // Check if tunnel already exists
    if (activeTunnels.has(serviceId)) {
      const existing = activeTunnels.get(serviceId)!;
      if (existing.url) {
        return { success: true, url: existing.url };
      }
      return { success: false, error: 'Tunnel is starting, please wait' };
    }

    // Get service to find port
    const service = stmts.getById.get(serviceId) as { id: string; port: number } | undefined;
    if (!service) {
      return { success: false, error: 'Service not found' };
    }

    // Check if provider is installed
    const installed = await checkProvider(provider);
    if (!installed) {
      const installHints: Record<TunnelProvider, string> = {
        ngrok: 'brew install ngrok/ngrok/ngrok  OR  npm i -g ngrok',
        cloudflared: 'brew install cloudflare/cloudflare/cloudflared',
        localtunnel: 'npm i -g localtunnel'
      };
      return {
        success: false,
        error: `${provider} not installed. Install with: ${installHints[provider]}`
      };
    }

    // Start the tunnel process
    const { process: proc, urlPromise } = spawnTunnel(provider, service.port);

    const tunnelProcess: TunnelProcess = {
      provider,
      serviceId,
      port: service.port,
      process: proc,
      url: null,
      startedAt: Date.now()
    };

    activeTunnels.set(serviceId, tunnelProcess);

    // Handle process exit
    proc.on('exit', (code) => {
      const tunnel = activeTunnels.get(serviceId);
      if (tunnel && tunnel.process === proc) {
        activeTunnels.delete(serviceId);
        stmts.clearTunnel.run(Date.now(), serviceId);
      }
    });

    // Wait for URL with timeout
    try {
      const url = await Promise.race([
        urlPromise,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for tunnel URL')), 30000)
        )
      ]);

      tunnelProcess.url = url;
      stmts.updateTunnel.run(provider, url, Date.now(), serviceId);

      return { success: true, url };
    } catch (err) {
      // Kill the process on error
      proc.kill();
      activeTunnels.delete(serviceId);
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Stop a tunnel for a service
   */
  function stop(serviceId: string): { success: boolean; error?: string } {
    const tunnel = activeTunnels.get(serviceId);
    if (!tunnel) {
      // Check if there's a stale tunnel in DB
      stmts.clearTunnel.run(Date.now(), serviceId);
      return { success: true };
    }

    tunnel.process.kill();
    activeTunnels.delete(serviceId);
    stmts.clearTunnel.run(Date.now(), serviceId);

    return { success: true };
  }

  /**
   * Get status of a tunnel
   */
  function status(serviceId: string): TunnelStatus {
    const tunnel = activeTunnels.get(serviceId);

    if (!tunnel) {
      // Check if there's a URL in DB (from previous run)
      const service = stmts.getById.get(serviceId) as {
        tunnel_provider: string | null;
        tunnel_url: string | null;
        port: number;
      } | undefined;

      if (service?.tunnel_url) {
        return {
          serviceId,
          provider: (service.tunnel_provider || 'unknown') as TunnelProvider,
          port: service.port,
          url: service.tunnel_url,
          status: 'stopped' // Was running, now stopped
        };
      }

      return {
        serviceId,
        provider: 'ngrok',
        port: 0,
        url: null,
        status: 'stopped'
      };
    }

    return {
      serviceId,
      provider: tunnel.provider,
      port: tunnel.port,
      url: tunnel.url,
      status: tunnel.url ? 'running' : 'starting',
      pid: tunnel.process.pid,
      startedAt: tunnel.startedAt
    };
  }

  /**
   * List all active tunnels
   */
  function list(): TunnelStatus[] {
    return Array.from(activeTunnels.values()).map(tunnel => ({
      serviceId: tunnel.serviceId,
      provider: tunnel.provider,
      port: tunnel.port,
      url: tunnel.url,
      status: tunnel.url ? 'running' : 'starting',
      pid: tunnel.process.pid,
      startedAt: tunnel.startedAt
    }));
  }

  /**
   * Stop all tunnels (for cleanup on shutdown)
   */
  function stopAll(): number {
    let count = 0;
    for (const [serviceId, tunnel] of activeTunnels) {
      tunnel.process.kill();
      stmts.clearTunnel.run(Date.now(), serviceId);
      count++;
    }
    activeTunnels.clear();
    return count;
  }

  return {
    start,
    stop,
    status,
    list,
    stopAll,
    checkProvider
  };
}

/**
 * Spawn a tunnel process and return a promise that resolves to the public URL
 */
function spawnTunnel(
  provider: TunnelProvider,
  port: number
): { process: ChildProcess; urlPromise: Promise<string> } {
  let proc: ChildProcess;
  let urlPromise: Promise<string>;

  switch (provider) {
    case 'ngrok':
      proc = spawn('ngrok', ['http', port.toString(), '--log', 'stdout'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      urlPromise = new Promise((resolve, reject) => {
        let output = '';

        proc.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
          // ngrok outputs URL in various formats, look for https://
          const match = output.match(/url=(https:\/\/[^\s]+)/);
          if (match) {
            resolve(match[1]);
          }
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const str = data.toString();
          if (str.includes('ERR') || str.includes('error')) {
            reject(new Error(str.trim()));
          }
        });

        proc.on('error', reject);
        proc.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            reject(new Error(`ngrok exited with code ${code}`));
          }
        });
      });
      break;

    case 'cloudflared':
      proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      urlPromise = new Promise((resolve, reject) => {
        let output = '';

        // cloudflared outputs to stderr
        proc.stderr?.on('data', (data: Buffer) => {
          output += data.toString();
          // Look for the trycloudflare.com URL
          const match = output.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
          if (match) {
            resolve(match[1]);
          }
        });

        proc.on('error', reject);
        proc.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            reject(new Error(`cloudflared exited with code ${code}`));
          }
        });
      });
      break;

    case 'localtunnel':
      proc = spawn('lt', ['--port', port.toString()], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      urlPromise = new Promise((resolve, reject) => {
        let output = '';

        proc.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
          // localtunnel outputs: your url is: https://xxx.loca.lt
          const match = output.match(/your url is:\s*(https:\/\/[^\s]+)/i);
          if (match) {
            resolve(match[1]);
          }
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const str = data.toString();
          if (str.includes('error')) {
            reject(new Error(str.trim()));
          }
        });

        proc.on('error', reject);
        proc.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            reject(new Error(`localtunnel exited with code ${code}`));
          }
        });
      });
      break;
  }

  return { process: proc, urlPromise };
}
