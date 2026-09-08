/**
 * Tunnel Module - Expose local services to the internet
 *
 * Supports: ngrok, cloudflared (Cloudflare Tunnel), localtunnel
 */

import { spawn, spawnSync, ChildProcess } from 'child_process';
import type Database from 'better-sqlite3';
import { withSecretsInChildEnv } from './secret-env.js';

export type TunnelProvider = 'ngrok' | 'cloudflared' | 'localtunnel';

const DEFAULT_TUNNEL_MAX_ACTIVE = 3;
const DEFAULT_TUNNEL_MAX_LIFETIME_MS = 30 * 60 * 1000;
const DEFAULT_TUNNEL_CLEANUP_INTERVAL_MS = 30 * 1000;
const TUNNEL_METADATA_KEY = 'portDaddyTunnel';

type TunnelCleanupReason = 'expired' | 'orphan-process' | 'stale-record';

interface TunnelMetadata {
  pid: number | null;
  provider: TunnelProvider;
  startedAt: number;
  expiresAt: number;
}

interface TunnelServiceRow {
  id: string;
  port: number;
  tunnel_provider: string | null;
  tunnel_url: string | null;
  metadata: string | null;
}

interface TunnelManagerOptions {
  cleanupIntervalMs?: number;
  clock?: () => number;
  isPidAlive?: (pid: number) => boolean;
  maxActiveTunnels?: number;
  maxLifetimeMs?: number;
  readProcessCommand?: (pid: number) => string | null;
  terminatePid?: (pid: number) => void;
}

interface TunnelProcess {
  provider: TunnelProvider;
  serviceId: string;
  port: number;
  process: ChildProcess;
  url: string | null;
  expiresAt: number;
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
  expiresAt?: number;
  ageMs?: number;
  cleanupReason?: TunnelCleanupReason;
  error?: string;
}

/**
 * Create the tunnel manager
 */
export function createTunnel(db: Database.Database, options: TunnelManagerOptions = {}) {
  // Active tunnel processes (in-memory, lost on restart)
  const activeTunnels = new Map<string, TunnelProcess>();
  const clock = options.clock || (() => Date.now());
  const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_TUNNEL_CLEANUP_INTERVAL_MS;
  const maxActiveTunnels = options.maxActiveTunnels ?? DEFAULT_TUNNEL_MAX_ACTIVE;
  const maxLifetimeMs = options.maxLifetimeMs ?? DEFAULT_TUNNEL_MAX_LIFETIME_MS;
  const isPidAlive = options.isPidAlive || defaultIsPidAlive;
  const readProcessCommand = options.readProcessCommand || defaultReadProcessCommand;
  const terminatePid = options.terminatePid || defaultTerminatePid;

  const stmts = {
    getById: db.prepare(`
      SELECT id, port, tunnel_provider, tunnel_url, metadata
      FROM services
      WHERE id = ?
    `),
    getWithTunnelState: db.prepare(`
      SELECT id, port, tunnel_provider, tunnel_url, metadata
      FROM services
      WHERE tunnel_provider IS NOT NULL
         OR tunnel_url IS NOT NULL
         OR metadata LIKE '%"portDaddyTunnel"%'
    `),
    updateTunnel: db.prepare(`
      UPDATE services SET tunnel_provider = ?, tunnel_url = ?, metadata = ?, last_seen = ?
      WHERE id = ?
    `),
    clearTunnel: db.prepare(`
      UPDATE services SET tunnel_provider = NULL, tunnel_url = NULL, metadata = ?, last_seen = ?
      WHERE id = ?
    `)
  };

  const cleanupTimer = cleanupIntervalMs > 0
    ? setInterval(() => {
      sweepTunnelState(clock());
    }, cleanupIntervalMs)
    : null;

  if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  function safeParseMetadata(value: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  function buildMetadataString(
    rawMetadata: string | null,
    tunnelMetadata: TunnelMetadata | null
  ): string | null {
    const metadata = safeParseMetadata(rawMetadata);
    if (tunnelMetadata) {
      metadata[TUNNEL_METADATA_KEY] = tunnelMetadata;
    } else {
      delete metadata[TUNNEL_METADATA_KEY];
    }
    return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
  }

  function readTunnelMetadata(rawMetadata: string | null): TunnelMetadata | null {
    const metadata = safeParseMetadata(rawMetadata);
    const rawTunnel = metadata[TUNNEL_METADATA_KEY];
    if (!rawTunnel || typeof rawTunnel !== 'object' || Array.isArray(rawTunnel)) {
      return null;
    }
    const tunnel = rawTunnel as Record<string, unknown>;
    const provider = tunnel.provider;
    const startedAt = tunnel.startedAt;
    const expiresAt = tunnel.expiresAt;
    const pid = tunnel.pid;
    if (
      (provider === 'ngrok' || provider === 'cloudflared' || provider === 'localtunnel')
      && typeof startedAt === 'number'
      && typeof expiresAt === 'number'
      && (pid === null || typeof pid === 'number')
    ) {
      return {
        pid,
        provider,
        startedAt,
        expiresAt
      };
    }
    return null;
  }

  function getService(serviceId: string): TunnelServiceRow | undefined {
    return stmts.getById.get(serviceId) as TunnelServiceRow | undefined;
  }

  function writeTunnelState(
    service: TunnelServiceRow,
    provider: TunnelProvider | null,
    url: string | null,
    tunnelMetadata: TunnelMetadata | null,
    now: number
  ): void {
    const metadata = buildMetadataString(service.metadata, tunnelMetadata);
    if (provider && url) {
      stmts.updateTunnel.run(provider, url, metadata, now, service.id);
      return;
    }
    stmts.clearTunnel.run(metadata, now, service.id);
  }

  function buildActiveStatus(tunnel: TunnelProcess, now: number): TunnelStatus {
    return {
      serviceId: tunnel.serviceId,
      provider: tunnel.provider,
      port: tunnel.port,
      url: tunnel.url,
      status: tunnel.url ? 'running' : 'starting',
      pid: tunnel.process.pid,
      startedAt: tunnel.startedAt,
      expiresAt: tunnel.expiresAt,
      ageMs: Math.max(0, now - tunnel.startedAt)
    };
  }

  function buildStoppedStatus(
    serviceId: string,
    service?: TunnelServiceRow,
    cleanupReason?: TunnelCleanupReason
  ): TunnelStatus {
    return {
      serviceId,
      provider: ((service?.tunnel_provider || 'ngrok') as TunnelProvider),
      port: service?.port || 0,
      url: null,
      status: 'stopped',
      cleanupReason
    };
  }

  function isManagedTunnelCommand(command: string | null, provider: TunnelProvider, port: number): boolean {
    if (!command) return false;
    const normalized = command.replace(/\s+/g, ' ').trim();
    switch (provider) {
      case 'ngrok':
        return /\bngrok\b/.test(normalized)
          && /\bhttp\b/.test(normalized)
          && new RegExp(`\\b${port}\\b`).test(normalized);
      case 'cloudflared':
        return /\bcloudflared\b/.test(normalized)
          && normalized.includes(`http://localhost:${port}`);
      case 'localtunnel':
        return /\blt\b/.test(normalized)
          && (
            normalized.includes(`--port ${port}`)
            || normalized.includes(`-p ${port}`)
          );
      default:
        return false;
    }
  }

  function reconcileServiceTunnelState(
    service: TunnelServiceRow | undefined,
    now: number
  ): TunnelCleanupReason | null {
    if (!service || activeTunnels.has(service.id)) return null;

    const tunnelMetadata = readTunnelMetadata(service.metadata);
    const hasPersistedTunnelState = Boolean(service.tunnel_provider || service.tunnel_url || tunnelMetadata);
    if (!hasPersistedTunnelState) return null;

    let cleanupReason: TunnelCleanupReason = tunnelMetadata && tunnelMetadata.expiresAt <= now
      ? 'expired'
      : 'stale-record';

    if (tunnelMetadata?.pid && isPidAlive(tunnelMetadata.pid)) {
      const command = readProcessCommand(tunnelMetadata.pid);
      if (isManagedTunnelCommand(command, tunnelMetadata.provider, service.port)) {
        try {
          terminatePid(tunnelMetadata.pid);
          cleanupReason = tunnelMetadata.expiresAt <= now ? 'expired' : 'orphan-process';
        } catch {
          cleanupReason = 'stale-record';
        }
      }
    }

    writeTunnelState(service, null, null, null, now);
    return cleanupReason;
  }

  function reapExpiredActiveTunnels(now: number): void {
    for (const [serviceId, tunnel] of activeTunnels.entries()) {
      if (tunnel.expiresAt > now) continue;
      try {
        tunnel.process.kill();
      } catch {
        // Best-effort kill; DB state is still cleared below.
      }
      activeTunnels.delete(serviceId);
      const service = getService(serviceId);
      if (service) {
        writeTunnelState(service, null, null, null, now);
      }
    }
  }

  function sweepTunnelState(now: number): void {
    reapExpiredActiveTunnels(now);
    const rows = stmts.getWithTunnelState.all() as TunnelServiceRow[];
    for (const row of rows) {
      reconcileServiceTunnelState(row, now);
    }
  }

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
  ): Promise<{ success: boolean; url?: string; error?: string; expiresAt?: number }> {
    const now = clock();
    sweepTunnelState(now);

    // Check if tunnel already exists
    if (activeTunnels.has(serviceId)) {
      const existing = activeTunnels.get(serviceId)!;
      if (existing.url) {
        return { success: true, url: existing.url, expiresAt: existing.expiresAt };
      }
      return { success: false, error: 'Tunnel is starting, please wait' };
    }

    if (activeTunnels.size >= maxActiveTunnels) {
      return {
        success: false,
        error: `Tunnel budget exhausted: ${activeTunnels.size} active tunnel(s) already running (limit ${maxActiveTunnels}). Stop one or raise PORT_DADDY_TUNNEL_MAX_ACTIVE.`
      };
    }

    // Get service to find port
    const service = getService(serviceId);
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
      startedAt: now,
      expiresAt: now + maxLifetimeMs
    };

    activeTunnels.set(serviceId, tunnelProcess);

    // Handle process exit
    proc.on('exit', (code) => {
      const tunnel = activeTunnels.get(serviceId);
      if (tunnel && tunnel.process === proc) {
        activeTunnels.delete(serviceId);
        const latestService = getService(serviceId);
        if (latestService) {
          writeTunnelState(latestService, null, null, null, clock());
        }
      }
    });

    // Wait for URL with timeout
    let startupTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = await Promise.race([
        urlPromise,
        new Promise<string>((_, reject) => {
          startupTimeout = setTimeout(() => reject(new Error('Timeout waiting for tunnel URL')), 30000);
          if (typeof startupTimeout.unref === 'function') startupTimeout.unref();
        })
      ]);

      tunnelProcess.url = url;
      const latestService = getService(serviceId);
      if (latestService) {
        writeTunnelState(
          latestService,
          provider,
          url,
          {
            pid: proc.pid ?? null,
            provider,
            startedAt: tunnelProcess.startedAt,
            expiresAt: tunnelProcess.expiresAt
          },
          clock()
        );
      }

      return { success: true, url, expiresAt: tunnelProcess.expiresAt };
    } catch (err) {
      // Kill the process on error
      proc.kill();
      activeTunnels.delete(serviceId);
      return { success: false, error: (err as Error).message };
    } finally {
      if (startupTimeout) clearTimeout(startupTimeout);
    }
  }

  /**
   * Stop a tunnel for a service
   */
  function stop(serviceId: string): { success: boolean; error?: string } {
    const now = clock();
    const tunnel = activeTunnels.get(serviceId);
    if (!tunnel) {
      // Check if there's a stale tunnel in DB
      const service = getService(serviceId);
      if (service) {
        writeTunnelState(service, null, null, null, now);
      }
      return { success: true };
    }

    tunnel.process.kill();
    activeTunnels.delete(serviceId);
    const service = getService(serviceId);
    if (service) {
      writeTunnelState(service, null, null, null, now);
    }

    return { success: true };
  }

  /**
   * Get status of a tunnel
   */
  function status(serviceId: string): TunnelStatus {
    const now = clock();
    reapExpiredActiveTunnels(now);
    const tunnel = activeTunnels.get(serviceId);

    if (tunnel) {
      return buildActiveStatus(tunnel, now);
    }

    const service = getService(serviceId);
    const cleanupReason = reconcileServiceTunnelState(service, now);
    return buildStoppedStatus(serviceId, service, cleanupReason || undefined);
  }

  /**
   * List all active tunnels
   */
  function list(): TunnelStatus[] {
    const now = clock();
    sweepTunnelState(now);
    return Array.from(activeTunnels.values()).map(tunnel => buildActiveStatus(tunnel, now));
  }

  /**
   * Stop all tunnels (for cleanup on shutdown)
   */
  function stopAll(): number {
    const now = clock();
    let count = 0;
    for (const [serviceId, tunnel] of activeTunnels) {
      tunnel.process.kill();
      const service = getService(serviceId);
      if (service) {
        writeTunnelState(service, null, null, null, now);
      }
      count++;
    }
    activeTunnels.clear();
    return count;
  }

  function dispose(): void {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
    }
  }

  return {
    start,
    stop,
    status,
    list,
    stopAll,
    dispose,
    checkProvider
  };
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultTerminatePid(pid: number): void {
  process.kill(pid, 'SIGTERM');
}

function defaultReadProcessCommand(pid: number): string | null {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8'
  });
  if (result.status !== 0) return null;
  const output = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return output || null;
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
      // Inject cached secrets (notably NGROK_AUTHTOKEN) into the child's env
      // — they were scrubbed from process.env at daemon startup (see
      // lib/secret-env.ts F-05) so raw env inheritance would leave ngrok
      // unauthenticated.
      proc = spawn('ngrok', ['http', port.toString(), '--log', 'stdout'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: withSecretsInChildEnv(process.env, ['NGROK_AUTHTOKEN']),
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
      // Same rationale as ngrok: cloudflared may expect CLOUDFLARE_API_TOKEN
      // in its env for authenticated tunnels, and that was scrubbed on
      // daemon startup. Re-inject from the cache.
      proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: withSecretsInChildEnv(process.env, [
          'CLOUDFLARE_ACCOUNT_ID',
          'CLOUDFLARE_API_TOKEN',
          'CLOUDFLARE_API_KEY',
          'CF_ACCOUNT_ID',
          'CF_API_TOKEN',
        ]),
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
