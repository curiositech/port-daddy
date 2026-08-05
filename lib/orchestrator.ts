/**
 * Service Orchestrator
 *
 * Core engine for `port-daddy up` -- manages the lifecycle of multiple
 * services with dependency ordering, port claiming, environment injection,
 * health checking, and colored log output.
 *
 * Also includes the Reactive Orchestrator for daemon-side event-driven triggers.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import type { Transform } from 'node:stream';
import { createPrefixer } from './log-prefix.js';

import { DEFAULT_SOCK } from '../shared/paths.js';
import { resolveDaemonTcpTarget } from '../shared/daemon-discovery.js';

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
export interface RawServiceConfig {
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
  daemonRequest?: DaemonRequestFn;
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

type DaemonRequestFn = (
  method: string,
  path: string,
  body?: Record<string, unknown>
) => Promise<DaemonResponse>;

/**
 * Resolve daemon connection target -- socket preferred, TCP fallback.
 */
function resolveDaemonTarget(): DaemonTarget {
  const sockPath = process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;
  if (process.env.PORT_DADDY_URL) {
    return resolveDaemonTcpTarget(process.env.PORT_DADDY_URL);
  }
  if (existsSync(sockPath)) {
    return { socketPath: sockPath };
  }
  return resolveDaemonTcpTarget();
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

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

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

  if (order.length !== names.length) {
    const cycleMembers = names.filter(n => !order.includes(n));
    const cyclePath = traceCycle(services, cycleMembers);
    return { order: [], error: `Circular dependency: ${cyclePath}` };
  }

  return { order };
}

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

export function buildEnvMap(
  services: Record<string, NormalizedServiceConfig>,
  portMap: Record<string, number>
): Record<string, Record<string, string>> {
  const envMaps: Record<string, Record<string, string>> = {};

  for (const [name, svc] of Object.entries(services)) {
    const env: Record<string, string> = { ...svc.env };
    if (portMap[name]) env.PORT = String(portMap[name]);

    for (const [siblingName, siblingSvc] of Object.entries(services)) {
      if (siblingName === name) continue;
      const varPrefix = siblingName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      if (siblingSvc.remote) {
        env[`${varPrefix}_URL`] = siblingSvc.remote;
      } else if (portMap[siblingName]) {
        env[`${varPrefix}_PORT`] = String(portMap[siblingName]);
        env[`${varPrefix}_URL`] = `http://localhost:${portMap[siblingName]}`;
      }
    }
    envMaps[name] = env;
  }

  return envMaps;
}

// =============================================================================
// CLI Process Orchestrator
// =============================================================================

export function createOrchestrator(options: OrchestratorOptions): OrchestratorInstance {
  const {
    services,
    identities,
    config: orchestratorConfig = {},
    daemonRequest: daemonRequestImpl = daemonRequest
  } = options;
  const { noHealth = false, healthTimeout = 30000, targetService = null } = orchestratorConfig;

  const emitter = new EventEmitter();
  const processes = new Map<string, ChildProcess>();
  const portMap: Record<string, number> = {};
  const statuses = new Map<string, ServiceStatus>();
  let stopping = false;

  function getServicesToStart(): Record<string, NormalizedServiceConfig> {
    if (targetService) {
      const { deps, error } = resolveDependencies(targetService, services);
      if (error) throw new Error(error);
      return Object.fromEntries([...deps].map(name => [name, services[name]]));
    }
    return services;
  }

  async function claimPort(name: string, identity: string, preferredPort: number | null): Promise<number> {
    const body: Record<string, unknown> = { id: identity };
    if (preferredPort) body.port = preferredPort;
    const res = await daemonRequestImpl('POST', '/claim', body);
    if (!res.ok) {
      const errorMsg = res.data && typeof res.data === 'object' && 'error' in res.data ? String((res.data as any).error) : 'unknown error';
      throw new Error(`Failed to claim port for ${name}: ${errorMsg}`);
    }
    return (res.data as any).port as number;
  }

  async function releasePort(identity: string): Promise<void> {
    try { await daemonRequestImpl('DELETE', '/release', { id: identity }); } catch { }
  }

  function spawnService(name: string, svc: NormalizedServiceConfig, env: Record<string, string>, prefixer: PrefixerFactory | null): ChildProcess | null {
    const cmd = svc.cmd;
    if (!cmd) {
      emitter.emit('error', { name, error: `No command defined for service "${name}"` });
      statuses.set(name, 'crashed');
      return null;
    }
    const resolvedCmd = cmd.replace(/\$\{PORT\}/g, String(portMap[name] || ''));
    const [shell, shellFlag] = process.platform === 'win32' ? ['cmd', '/c'] as const : ['sh', '-c'] as const;
    const child = spawn(shell, [shellFlag, resolvedCmd], {
      cwd: svc.dir || process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (prefixer && child.stdout && child.stderr) {
      child.stdout.pipe(prefixer(name, 'stdout')).pipe(process.stdout, { end: false });
      child.stderr.pipe(prefixer(name, 'stderr')).pipe(process.stderr, { end: false });
    }
    const startTime = Date.now();
    child.on('exit', (code, signal) => {
      if (stopping) return;
      const wasEarly = Date.now() - startTime < 1500;
      statuses.set(name, 'crashed');
      emitter.emit('exit', { name, code, signal, early: wasEarly });
    });
    processes.set(name, child);
    statuses.set(name, 'starting');
    return child;
  }

  async function waitForHealth(name: string, port: number, healthPath: string): Promise<boolean> {
    if (noHealth || !port) return true;
    const url = `http://localhost:${port}${healthPath}`;
    const deadline = Date.now() + healthTimeout;
    while (Date.now() < deadline) {
      if (statuses.get(name) === 'crashed') return false;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) { statuses.set(name, 'healthy'); return true; }
      } catch { }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  async function start(): Promise<void> {
    const toStart = getServicesToStart();
    const { order, error } = topologicalSort(toStart);
    if (error) throw new Error(error);

    for (const name of order) {
      const svc = toStart[name];
      if (svc.remote || svc.noPort) continue;
      portMap[name] = await claimPort(name, identities[name] || name, svc.port);
    }

    const envMaps = buildEnvMap(toStart, portMap);
    const localNames = Object.keys(toStart).filter(n => !toStart[n].remote);
    const prefixer = localNames.length > 0 ? createPrefixer(localNames) : null;

    emitter.emit('portsReady', { portMap: { ...portMap } });

    for (const name of order) {
      const svc = toStart[name];
      if (!svc.cmd) continue;
      spawnService(name, svc, envMaps[name], prefixer);
      if (!svc.noPort && portMap[name]) {
        const healthy = await waitForHealth(name, portMap[name], svc.healthPath || '/');
        if (healthy) emitter.emit('healthy', { name, port: portMap[name] });
        else if (statuses.get(name) === 'crashed') throw new Error(`Service "${name}" crashed`);
        else emitter.emit('healthTimeout', { name, port: portMap[name] });
      }
    }
    emitter.emit('allStarted', { services: Object.keys(toStart), ports: { ...portMap } });
  }

  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    const names = [...processes.keys()].reverse();
    for (const name of names) {
      const child = processes.get(name);
      if (child && !child.killed) {
        child.kill('SIGTERM');
        statuses.set(name, 'stopped');
      }
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const alive = names.filter(n => { const c = processes.get(n); return c && !c.killed && c.exitCode === null; });
      if (alive.length === 0) break;
      await new Promise(r => setTimeout(r, 200));
    }
    for (const name of names) {
      const child = processes.get(name);
      if (child && child.exitCode === null) child.kill('SIGKILL');
    }
    for (const name of Object.keys(portMap)) await releasePort(identities[name] || name);
    emitter.emit('stopped', { services: names });
  }

  return { start, stop, getStatus: () => ({ services: Object.fromEntries(statuses) as any, ports: { ...portMap }, stopping }), on: (e, f) => emitter.on(e, f) };
}

// =============================================================================
// Reactive Orchestrator (Daemon Engine)
// =============================================================================

export interface OrchestratorRule {
  id?: number;
  name: string;
  channelPattern: string;
  condition?: string;
  action: 'spawn' | 'exec';
  payload: any;
  enabled: boolean;
}

/**
 * The reactive orchestrator (the autonomous, event-driven spawn surface). It
 * keeps its TRIGGER logic (channel rules → action) but, per ADR-0060, no longer
 * owns LAUNCH: when a `conductor` is supplied, a `spawn` action routes through
 * `conductor.launch(intent)` — the one spawn primitive — so even the least-
 * supervised surface inherits the bond/lineage/breaker/halt envelope. When no
 * conductor is supplied (legacy wiring, unit tests), it falls back to the direct
 * `spawner.spawn` it used before, byte-identically.
 */
export function createReactiveOrchestrator(db: any, messaging: any, spawner: any, conductor?: any) {
  const events = new EventEmitter();
  const execChildren = new Set<ChildProcess>();
  let closed = false;
  db.exec(`CREATE TABLE IF NOT EXISTS orchestrator_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, channel_pattern TEXT NOT NULL, condition TEXT, action TEXT NOT NULL, payload TEXT NOT NULL, enabled INTEGER DEFAULT 1);`);
  const stmts = {
    insert: db.prepare(`INSERT INTO orchestrator_rules (name, channel_pattern, condition, action, payload, enabled) VALUES (?, ?, ?, ?, ?, ?)`),
    list: db.prepare(`SELECT * FROM orchestrator_rules`),
    delete: db.prepare(`DELETE FROM orchestrator_rules WHERE id = ?`)
  };

  function addRule(rule: OrchestratorRule) {
    const result = stmts.insert.run(rule.name, rule.channelPattern, rule.condition || null, rule.action, JSON.stringify(rule.payload), rule.enabled ? 1 : 0);
    return { success: true, id: Number(result.lastInsertRowid) };
  }

  function listRules() {
    return (stmts.list.all() as any[]).map(r => ({ ...r, channelPattern: r.channel_pattern, payload: JSON.parse(r.payload), enabled: Boolean(r.enabled) }));
  }

  function removeRule(id: number) {
    const result = stmts.delete.run(id);
    return {
      success: result.changes > 0,
      deleted: result.changes > 0,
      id,
    };
  }

  const unsubscribe = messaging.subscribe('*', (msg: any) => {
    if (closed) return;
    for (const rule of listRules().filter(r => r.enabled)) {
      if (matchesPattern(msg.channel, rule.channelPattern)) {
        handleRule(rule, msg);
      }
    }
  });

  function matchesPattern(channel: string, pattern: string) {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return channel.startsWith(pattern.slice(0, -1));
    return channel === pattern;
  }

  async function handleRule(rule: any, msg: any) {
    if (rule.condition) {
      const p = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
      if (!p.includes(rule.condition)) return;
    }
    try {
      if (rule.action === 'spawn') {
        const spec = { ...rule.payload };
        if (typeof spec.task === 'string') spec.task = spec.task.replace('{{msg}}', JSON.stringify(msg.payload));
        let spawnResult;
        if (conductor) {
          // Route the autonomous spawn through the ONE spawn primitive (ADR-0060).
          // The conductor rebuilds the byte-identical spawn spec from the intent
          // and reaches `spawner.spawn` itself. An orchestrator-triggered launch
          // is source:'orchestrator', runs in place (inherit), and settles with no
          // review gate (never) — matching the legacy fire-and-forget behavior.
          const launchResult = await conductor.launch({
            source: 'orchestrator',
            goal: typeof spec.task === 'string' && spec.task.trim()
              ? spec.task
              : `orchestrator:${rule.name}`,
            task: typeof spec.task === 'string' ? spec.task : undefined,
            backend: spec.backend,
            model: spec.model,
            modelTier: spec.modelTier,
            identity: spec.identity,
            purpose: spec.purpose,
            workdir: spec.workdir,
            allowedTools: spec.allowedTools,
            // Forward the rule's declared capabilities so the conductor path
            // matches the legacy spawner.spawn(spec) behaviour. Without this they
            // were dropped and (with the empty-caps→full default) the agent ran
            // UNrestricted. Conductor admission still narrows-only against any parent.
            capabilities: Array.isArray(spec.capabilities) ? spec.capabilities : undefined,
            deadlineMs: typeof spec.deadlineMs === 'number' ? spec.deadlineMs : undefined,
            maxTokens: spec.maxTokens,
            harborName: spec.harborName,
            worktree: 'inherit',
            mergePolicy: 'never',
          });
          spawnResult = launchResult.spawn ?? {
            status: launchResult.admitted ? 'failed' : 'refused',
            error: launchResult.refusedReason ?? undefined,
          };
        } else {
          spawnResult = await spawner.spawn(spec);
        }
        if (spawnResult && typeof spawnResult === 'object' && 'status' in spawnResult && spawnResult.status !== 'completed' && !closed) {
          console.error(`[orchestrator:${rule.name}] spawn ${spawnResult.status}: ${spawnResult.error || 'unknown error'}`);
          events.emit('rule:spawn_failed', {
            ruleId: rule.id,
            channel: msg.channel,
            status: spawnResult.status,
            error: spawnResult.error,
            backend: spawnResult.backend,
            model: spawnResult.model,
          });
        }
      } else if (rule.action === 'exec') {
        const cmd = rule.payload.cmd;
        // Split command into executable + args — no shell interpretation
        const parts = cmd.split(/\s+/).filter(Boolean);
        if (parts.length === 0) return;
        const env = { ...process.env, PD_CHANNEL: msg.channel, PD_MESSAGE: JSON.stringify(msg.payload) };
        const shouldLogChildOutput = !process.env.JEST_WORKER_ID;
        const child = spawn(parts[0], parts.slice(1), {
          shell: false,
          env,
          stdio: shouldLogChildOutput ? 'pipe' : 'ignore'
        });
        execChildren.add(child);
        child.unref?.();
        (child.stdout as any)?.unref?.();
        (child.stderr as any)?.unref?.();

        if (shouldLogChildOutput) {
          child.stdout?.on('data', (d: Buffer) => {
            if (!closed) console.log(`[orchestrator:${rule.name}] ${d}`);
          });
          child.stderr?.on('data', (d: Buffer) => {
            if (!closed) console.error(`[orchestrator:${rule.name}] ${d}`);
          });
        } else {
          child.stdout?.resume();
          child.stderr?.resume();
        }

        child.once('close', () => {
          execChildren.delete(child);
          child.stdout?.removeAllListeners('data');
          child.stderr?.removeAllListeners('data');
        });
      }
      events.emit('rule:fired', { ruleId: rule.id, channel: msg.channel });
    } catch (err) { console.error(`Rule "${rule.name}" failed:`, err); }
  }

  async function shutdown() {
    closed = true;
    if (typeof unsubscribe === 'function') {
      try { unsubscribe(); } catch {}
    }
    for (const child of execChildren) {
      child.stdout?.removeAllListeners('data');
      child.stderr?.removeAllListeners('data');
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
      }
    }
    execChildren.clear();
  }

  return { addRule, listRules, removeRule, on: events.on.bind(events), shutdown };
}
