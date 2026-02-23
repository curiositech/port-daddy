/**
 * Service Orchestrator
 *
 * Core engine for `port-daddy up` -- manages the lifecycle of multiple
 * services with dependency ordering, port claiming, environment injection,
 * health checking, and colored log output.
 *
 * This is CLI-only process management. The daemon stays stateless about
 * processes; the orchestrator owns its children.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import type { Transform } from 'node:stream';
import { createPrefixer, getServiceColor } from './log-prefix.js';

const DEFAULT_SOCK = '/tmp/port-daddy.sock';

// =============================================================================
// Internal types
// =============================================================================

interface SocketTarget {
  socketPath: string;
  host?: undefined;
  port?: undefined;
}

interface TcpTarget {
  socketPath?: undefined;
  host: string;
  port: number;
}

type DaemonTarget = SocketTarget | TcpTarget;

interface DaemonResponse {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
}

/** Raw service config as it appears in a port-daddy manifest */
interface RawServiceConfig {
  cmd?: string;
  dev?: string;
  port?: number;
  preferredPort?: number;
  healthPath?: string;
  health?: string;
  needs?: string[];
  noPort?: boolean;
  remote?: string | null;
  dir?: string | null;
  env?: Record<string, string>;
  stack?: string | null;
}

/** Normalized service config produced by normalizeServiceConfig */
export interface NormalizedServiceConfig {
  name: string;
  cmd: string | null;
  port: number | null;
  healthPath: string;
  needs: string[];
  noPort: boolean;
  remote: string | null;
  dir: string | null;
  env: Record<string, string>;
  stack: string | null;
}

type ServiceStatus = 'starting' | 'healthy' | 'crashed' | 'stopped';

/** A record mapping service names to service configs (raw or normalized) */
type ServiceMap = Record<string, RawServiceConfig | NormalizedServiceConfig>;

/** Options passed to createOrchestrator */
interface OrchestratorOptions {
  services: Record<string, NormalizedServiceConfig>;
  identities: Record<string, string>;
  config?: OrchestratorConfig;
}

interface OrchestratorConfig {
  noHealth?: boolean;
  healthTimeout?: number;
  targetService?: string | null;
}

/** Shape of the topologicalSort return */
interface TopoSortResult {
  order: string[];
  error?: string;
}

/** Shape of the resolveDependencies return */
interface ResolveDepsResult {
  deps: Set<string>;
  error?: string;
}

/** Prefixer factory type -- matches createPrefixer return */
type PrefixerFactory = (name: string, streamType?: 'stdout' | 'stderr') => Transform;

interface OrchestratorStatus {
  services: Record<string, ServiceStatus>;
  ports: Record<string, number>;
  stopping: boolean;
}

interface OrchestratorInstance {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getStatus: () => OrchestratorStatus;
  on: (event: string, fn: (...args: unknown[]) => void) => void;
}

/**
 * Resolve daemon connection target -- socket preferred, TCP fallback.
 */
function resolveDaemonTarget(): DaemonTarget {
  const sockPath = process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;
  if (process.env.PORT_DADDY_URL) {
    const url = new URL(process.env.PORT_DADDY_URL);
    return { host: url.hostname, port: parseInt(url.port, 10) || 9876 };
  }
  if (existsSync(sockPath)) {
    return { socketPath: sockPath };
  }
  return { host: 'localhost', port: 9876 };
}

/**
 * Make an HTTP request to the daemon via socket or TCP.
 * Returns { ok, status, data }.
 */
function daemonRequest(method: string, path: string, body?: Record<string, unknown>): Promise<DaemonResponse> {
  const target = resolveDaemonTarget();
  const jsonBody = body ? JSON.stringify(body) : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-PID': String(process.pid) };
  if (jsonBody) headers['Content-Length'] = String(Buffer.byteLength(jsonBody));

  return new Promise((resolve, reject) => {
    const reqOpts: http.RequestOptions = {
      method, path, headers, timeout: 10000,
      ...(target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port })
    };

    const req = http.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let data: Record<string, unknown> | null;
        try { data = JSON.parse(text) as Record<string, unknown>; } catch { data = null; }
        resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, data });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (jsonBody) req.write(jsonBody);
    req.end();
  });
}

// =============================================================================
// Pure Functions (exported for unit testing)
// =============================================================================

/**
 * Topological sort using Kahn's algorithm.
 * Returns services in dependency-first order.
 */
export function topologicalSort(services: ServiceMap): TopoSortResult {
  const names = Object.keys(services);
  if (names.length === 0) return { order: [] };

  // Build adjacency list and in-degree map
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep -> [services that depend on it]

  for (const name of names) {
    inDegree.set(name, 0);
    dependents.set(name, []);
  }

  for (const [name, svc] of Object.entries(services)) {
    const needs = svc.needs || [];
    for (const dep of needs) {
      if (!inDegree.has(dep)) {
        return { order: [], error: `Unknown dependency: "${name}" needs "${dep}" which is not defined` };
      }
      inDegree.set(name, inDegree.get(name)! + 1);
      dependents.get(dep)!.push(name);
    }
  }

  // Kahn's algorithm: start with nodes that have no dependencies
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);

    for (const dependent of dependents.get(current)!) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  // If we haven't visited all nodes, there's a cycle
  if (order.length !== names.length) {
    const cycleMembers = names.filter(n => !order.includes(n));
    // Trace the cycle for a clear error message
    const cyclePath = traceCycle(services, cycleMembers);
    return { order: [], error: `Circular dependency: ${cyclePath}` };
  }

  return { order };
}

/**
 * Trace a dependency cycle for error reporting.
 */
function traceCycle(services: ServiceMap, cycleMembers: string[]): string {
  const start = cycleMembers[0];
  const visited = new Set<string>();
  const path = [start];
  let current = start;

  while (true) {
    visited.add(current);
    const needs = (services[current]?.needs || []).filter(d => cycleMembers.includes(d));
    const next = needs.find(d => d === start) || needs.find(d => !visited.has(d));
    if (!next) break;
    path.push(next);
    if (next === start) break;
    current = next;
  }

  return path.join(' \u2192 ');
}

/**
 * Resolve transitive dependencies for a target service.
 * Used by `--service <name>` to start a service and all its deps.
 */
export function resolveDependencies(target: string, services: ServiceMap): ResolveDepsResult {
  if (!services[target]) {
    return { deps: new Set(), error: `Service "${target}" not found` };
  }

  const deps = new Set<string>();
  const stack = [target];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (deps.has(current)) continue;
    deps.add(current);

    const needs = services[current]?.needs || [];
    for (const dep of needs) {
      if (!services[dep]) {
        return { deps: new Set(), error: `Service "${current}" depends on "${dep}" which is not defined` };
      }
      if (!deps.has(dep)) {
        stack.push(dep);
      }
    }
  }

  return { deps };
}

/**
 * Normalize service config -- handle both old and new field names.
 *
 * Old: { dev, preferredPort, health }
 * New: { cmd, port, healthPath }
 */
export function normalizeServiceConfig(name: string, svc: RawServiceConfig): NormalizedServiceConfig {
  return {
    name,
    cmd: svc.cmd || svc.dev || null,
    port: svc.port ?? svc.preferredPort ?? null,
    healthPath: svc.healthPath || svc.health || '/',
    needs: svc.needs || [],
    noPort: svc.noPort || false,
    remote: svc.remote || null,
    dir: svc.dir || null,
    env: svc.env || {},
    stack: svc.stack || null
  };
}

/**
 * Build environment variable maps for all services.
 * Each service gets:
 * - PORT=<its own port>
 * - {SIBLING}_PORT=<port> and {SIBLING}_URL=<url> for every other local service
 * - {SIBLING}_URL=<remote url> for remote services (no PORT var)
 */
export function buildEnvMap(
  services: Record<string, NormalizedServiceConfig>,
  portMap: Record<string, number>
): Record<string, Record<string, string>> {
  const envMaps: Record<string, Record<string, string>> = {};

  for (const [name, svc] of Object.entries(services)) {
    const env: Record<string, string> = { ...svc.env };

    // Own port
    if (portMap[name]) {
      env.PORT = String(portMap[name]);
    }

    // Sibling services
    for (const [siblingName, siblingSvc] of Object.entries(services)) {
      if (siblingName === name) continue;

      const varPrefix = siblingName.toUpperCase().replace(/[^A-Z0-9]/g, '_');

      if (siblingSvc.remote) {
        // Remote service -- inject URL only
        env[`${varPrefix}_URL`] = siblingSvc.remote;
      } else if (portMap[siblingName]) {
        // Local service -- inject both port and URL
        env[`${varPrefix}_PORT`] = String(portMap[siblingName]);
        env[`${varPrefix}_URL`] = `http://localhost:${portMap[siblingName]}`;
      }
    }

    envMaps[name] = env;
  }

  return envMaps;
}

// =============================================================================
// Orchestrator Factory (stateful, manages processes)
// =============================================================================

/**
 * Create an orchestrator instance.
 */
export function createOrchestrator(options: OrchestratorOptions): OrchestratorInstance {
  const {
    services,
    identities,
    config: orchestratorConfig = {}
  } = options;

  const {
    noHealth = false,
    healthTimeout = 30000,
    targetService = null
  } = orchestratorConfig;

  const emitter = new EventEmitter();
  const processes = new Map<string, ChildProcess>();       // name -> ChildProcess
  const portMap: Record<string, number> = {};              // name -> port number
  const statuses = new Map<string, ServiceStatus>();       // name -> status
  let stopping = false;

  /**
   * Determine which services to start (respecting --service flag).
   */
  function getServicesToStart(): Record<string, NormalizedServiceConfig> {
    if (targetService) {
      const { deps, error } = resolveDependencies(targetService, services);
      if (error) throw new Error(error);
      return Object.fromEntries(
        [...deps].map(name => [name, services[name]])
      );
    }
    return services;
  }

  /**
   * Claim a port from the daemon for a service.
   */
  async function claimPort(name: string, identity: string, preferredPort: number | null): Promise<number> {
    const body: Record<string, unknown> = { id: identity };
    if (preferredPort) body.port = preferredPort;

    const res = await daemonRequest('POST', '/claim', body);

    if (!res.ok) {
      const errorMsg = res.data && typeof res.data === 'object' && 'error' in res.data
        ? String((res.data as Record<string, unknown>).error)
        : 'unknown error';
      throw new Error(`Failed to claim port for ${name}: ${errorMsg}`);
    }

    return (res.data as Record<string, unknown>)!.port as number;
  }

  /**
   * Release a port back to the daemon.
   */
  async function releasePort(identity: string): Promise<void> {
    try {
      await daemonRequest('DELETE', '/release', { id: identity });
    } catch { /* best effort on shutdown */ }
  }

  /**
   * Spawn a service process.
   */
  function spawnService(
    name: string,
    svc: NormalizedServiceConfig,
    env: Record<string, string>,
    prefixer: PrefixerFactory | null
  ): ChildProcess | null {
    const cmd = svc.cmd;
    if (!cmd) {
      emitter.emit('error', { name, error: `No command defined for service "${name}"` });
      statuses.set(name, 'crashed');
      return null;
    }

    // Replace ${PORT} in command string
    const resolvedCmd = cmd.replace(/\$\{PORT\}/g, String(portMap[name] || ''));
    const [shell, shellFlag] = process.platform === 'win32'
      ? ['cmd', '/c'] as const
      : ['sh', '-c'] as const;

    const child = spawn(shell, [shellFlag, resolvedCmd], {
      cwd: svc.dir || process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Pipe through prefixer
    if (prefixer && child.stdout && child.stderr) {
      const stdoutPrefix = prefixer(name, 'stdout');
      const stderrPrefix = prefixer(name, 'stderr');
      child.stdout.pipe(stdoutPrefix).pipe(process.stdout, { end: false });
      child.stderr.pipe(stderrPrefix).pipe(process.stderr, { end: false });
    }

    // Track early crash: if process exits within 1.5s, it's a crash
    const startTime = Date.now();
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (stopping) return;

      const wasEarly = Date.now() - startTime < 1500;
      statuses.set(name, 'crashed');
      emitter.emit('exit', { name, code, signal, early: wasEarly });
    });

    processes.set(name, child);
    statuses.set(name, 'starting');
    return child;
  }

  /**
   * Poll health endpoint until healthy or timeout.
   */
  async function waitForHealth(name: string, port: number, healthPath: string): Promise<boolean> {
    if (noHealth || !port) return true;

    const url = `http://localhost:${port}${healthPath}`;
    const deadline = Date.now() + healthTimeout;

    while (Date.now() < deadline) {
      if (statuses.get(name) === 'crashed') return false;

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          statuses.set(name, 'healthy');
          return true;
        }
      } catch { /* not ready yet */ }

      await new Promise(r => setTimeout(r, 500));
    }

    return false;
  }

  /**
   * Start all services in dependency order.
   */
  async function start(): Promise<void> {
    const toStart = getServicesToStart();
    const serviceNames = Object.keys(toStart);

    // Filter out remote services (they don't get spawned)
    const localServices = Object.entries(toStart).filter(([, svc]) => !svc.remote);
    const remoteServices = Object.entries(toStart).filter(([, svc]) => svc.remote);

    // Topological sort
    const { order, error } = topologicalSort(toStart);
    if (error) throw new Error(error);

    // Claim ports for local services that need them
    for (const name of order) {
      const svc = toStart[name];
      if (svc.remote || svc.noPort) continue;

      const identity = identities[name] || name;
      const port = await claimPort(name, identity, svc.port);
      portMap[name] = port;
    }

    // Build environment maps
    const envMaps = buildEnvMap(toStart, portMap);

    // Create prefixer for all local services
    const localNames = localServices.map(([name]) => name);
    const prefixer: PrefixerFactory | null = localNames.length > 0 ? createPrefixer(localNames) : null;

    emitter.emit('portsReady', { portMap: { ...portMap } });

    // Spawn in topological order
    for (const name of order) {
      const svc = toStart[name];
      if ((svc.remote || svc.noPort) && !svc.cmd) continue;
      if (!svc.cmd) continue;

      spawnService(name, svc, envMaps[name], prefixer);

      // Wait for health before starting dependents
      if (!svc.noPort && portMap[name]) {
        const healthy = await waitForHealth(name, portMap[name], svc.healthPath || '/');
        if (healthy) {
          emitter.emit('healthy', { name, port: portMap[name] });
        } else if (statuses.get(name) === 'crashed') {
          emitter.emit('crash', { name, early: true });
          throw new Error(`Service "${name}" crashed during startup`);
        } else {
          emitter.emit('healthTimeout', { name, port: portMap[name] });
        }
      }
    }

    emitter.emit('allStarted', {
      services: serviceNames,
      ports: { ...portMap }
    });
  }

  /**
   * Stop all services gracefully.
   * SIGTERM in reverse order -> 5s grace -> SIGKILL survivors.
   */
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;

    const names = [...processes.keys()].reverse();

    // SIGTERM all
    for (const name of names) {
      const child = processes.get(name);
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM');
          statuses.set(name, 'stopped');
        } catch { /* already dead */ }
      }
    }

    // Wait up to 5s for graceful exit
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const alive = names.filter(name => {
        const child = processes.get(name);
        return child && !child.killed && child.exitCode === null;
      });
      if (alive.length === 0) break;
      await new Promise(r => setTimeout(r, 200));
    }

    // SIGKILL survivors
    for (const name of names) {
      const child = processes.get(name);
      if (child && child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch { /* already dead */ }
      }
    }

    // Release all ports
    for (const [name] of Object.entries(portMap)) {
      const identity = identities[name] || name;
      await releasePort(identity);
    }

    emitter.emit('stopped', { services: names });
  }

  function getStatus(): OrchestratorStatus {
    return {
      services: Object.fromEntries(statuses) as Record<string, ServiceStatus>,
      ports: { ...portMap },
      stopping
    };
  }

  return {
    start,
    stop,
    getStatus,
    on: (event: string, fn: (...args: unknown[]) => void) => emitter.on(event, fn)
  };
}
