/**
 * Fleet Engine — Declarative fleet management from pd-fleet.yml
 *
 * Reads pd-fleet.yml, resolves template variables, and manages
 * agent lifecycles via pd spawn and pd watch.
 *
 * Design: ADR-0019 (Declarative Fleet Configuration)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FleetAgent {
  name: string;
  schedule?: string;       // cron syntax
  trigger?: string;        // channel name
  backend: string;         // ollama, claude, claude-cli, custom
  model?: string;
  prompt: string;
  worktree?: boolean;
  singleton?: boolean;
  onSuccess?: string;      // "publish channel:name"
  onFailure?: string;
  identity?: string;
  timeout?: number;
  allowedTools?: string;
}

export interface FleetWatcher {
  name: string;
  trigger: string;
  exec: string;
  condition?: string;
  confirm?: boolean;
}

export interface FleetConfig {
  name: string;
  harbor?: string;
  agents: FleetAgent[];
  watchers: FleetWatcher[];
  channels: Record<string, { description: string; consumers?: string[] }>;
}

interface RunningAgent {
  name: string;
  type: 'scheduled' | 'triggered' | 'watcher';
  process?: ChildProcess;
  interval?: ReturnType<typeof setInterval>;
  watchHandle?: () => void;
  startedAt: number;
}

// ─── YAML Shapes ───────────────────────────────────────────────────────────

interface FleetYamlAgent {
  schedule?: string;
  trigger?: string;
  backend?: string;
  model?: string;
  prompt?: string | number;
  worktree?: boolean;
  singleton?: boolean;
  on_success?: string;
  on_failure?: string;
  identity?: string;
  timeout?: number;
  allowedTools?: string;
  allowed_tools?: string;
}

interface FleetYamlWatcher {
  trigger: string;
  exec: string;
  condition?: string;
  confirm?: boolean;
}

interface FleetYamlChannel {
  description?: string;
  consumers?: string[];
}

interface FleetYamlRoot {
  name?: string;
  harbor?: string;
  fleet?: {
    name?: string;
    harbor?: string;
    agents?: Record<string, FleetYamlAgent> | FleetYamlAgent[];
    watchers?: Record<string, FleetYamlWatcher>;
    channels?: Record<string, FleetYamlChannel>;
  };
  agents?: Record<string, FleetYamlAgent> | FleetYamlAgent[];
  watchers?: Record<string, FleetYamlWatcher>;
  channels?: Record<string, FleetYamlChannel>;
}

// ─── YAML Parser ────────────────────────────────────────────────────────────

function parseFleetYaml(text: string): FleetYamlRoot | null {
  const result = parseYaml(text);
  if (!result || typeof result !== 'object') return null;
  return result as FleetYamlRoot;
}

// ─── Template Resolution ────────────────────────────────────────────────────

function resolveTemplates(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key) => vars[key] || match);
}

function getTemplateVars(projectDir: string): Record<string, string> {
  const project = basename(projectDir);
  let branch = 'main';
  let sha = 'unknown';

  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    sha = execSync('git rev-parse --short HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
  } catch {
    // Not a git repo or git not available — defaults are fine
  }

  return {
    project,
    project_dir: projectDir,
    branch,
    sha,
  };
}

// ─── Fleet Config Loader ────────────────────────────────────────────────────

export function loadFleetConfig(projectDir: string): FleetConfig | null {
  const candidates = [
    join(projectDir, 'pd-fleet.yml'),
    join(projectDir, 'pd-fleet.yaml'),
    join(projectDir, '.portdaddy', 'fleet.yml'),
    join(projectDir, '.portdaddy', 'fleet.yaml'),
  ];

  let configPath: string | null = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) return null;

  const raw = readFileSync(configPath, 'utf-8');
  if (!raw.trim()) return null;  // Bug 4 fix: empty file

  const vars = getTemplateVars(projectDir);
  const resolved = resolveTemplates(raw, vars);
  const parsed = parseFleetYaml(resolved);
  if (!parsed) return null;

  const fleet = parsed.fleet || parsed;

  // Normalize agents (supports both object and array format)
  const agents: FleetAgent[] = [];
  const rawAgents = fleet.agents;
  if (rawAgents && typeof rawAgents === 'object' && !Array.isArray(rawAgents)) {
    for (const [name, s] of Object.entries(rawAgents)) {
      agents.push({
        name,
        schedule: s.schedule,
        trigger: s.trigger,
        backend: s.backend || 'claude-cli',
        model: s.model,
        prompt: typeof s.prompt === 'string' ? s.prompt.trim() : String(s.prompt || ''),
        worktree: s.worktree || false,
        singleton: s.singleton || false,
        onSuccess: s.on_success,
        onFailure: s.on_failure,
        identity: s.identity,
        timeout: s.timeout,
        allowedTools: s.allowedTools || s.allowed_tools,
      });
    }
  }

  // Normalize watchers
  const watchers: FleetWatcher[] = [];
  if (fleet.watchers && typeof fleet.watchers === 'object') {
    for (const [name, s] of Object.entries(fleet.watchers)) {
      watchers.push({
        name,
        trigger: s.trigger,
        exec: s.exec,
        condition: s.condition,
        confirm: s.confirm || false,
      });
    }
  }

  // Channels
  const channels: FleetConfig['channels'] = {};
  if (fleet.channels && typeof fleet.channels === 'object') {
    for (const [name, s] of Object.entries(fleet.channels)) {
      channels[name] = {
        description: s.description || '',
        consumers: s.consumers,
      };
    }
  }

  return {
    name: fleet.name || basename(projectDir),
    harbor: fleet.harbor,
    agents,
    watchers,
    channels,
  };
}

// ─── Topology Validation (CSP DAG Property) ────────────────────────────────

export interface TopologyValidation {
  valid: boolean;
  cycles: string[][];
  warnings: string[];
}

/**
 * Validate that the fleet's trigger graph is a DAG (no cycles).
 * A cycle means Agent A triggers Agent B which triggers Agent A — infinite loop.
 */
export function validateTopology(config: FleetConfig): TopologyValidation {
  // Build adjacency list: agent -> agents it can trigger
  // An agent "triggers" another if it publishes to a channel that the other consumes
  const producerOf = new Map<string, string[]>(); // channel -> agents that publish to it
  const consumerOf = new Map<string, string[]>(); // channel -> agents triggered by it

  for (const agent of config.agents) {
    // Agent publishes via onSuccess/onFailure
    for (const hook of [agent.onSuccess, agent.onFailure]) {
      if (!hook) continue;
      const [action, channel] = hook.split(' ');
      if (action === 'publish' && channel) {
        const list = producerOf.get(channel) || [];
        list.push(agent.name);
        producerOf.set(channel, list);
      }
    }

    // Agent consumes via trigger
    if (agent.trigger) {
      const list = consumerOf.get(agent.trigger) || [];
      list.push(agent.name);
      consumerOf.set(agent.trigger, list);
    }
  }

  // Build directed graph: producer -> consumer (via shared channel)
  const adj = new Map<string, Set<string>>();
  for (const [channel, producers] of producerOf) {
    const consumers = consumerOf.get(channel) || [];
    for (const p of producers) {
      for (const c of consumers) {
        if (p === c) continue; // self-trigger is not a cycle
        const edges = adj.get(p) || new Set();
        edges.add(c);
        adj.set(p, edges);
      }
    }
  }

  // Detect cycles via DFS with coloring
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of adj.get(node) || []) {
      const c = color.get(neighbor) || WHITE;
      if (c === GRAY) {
        // Found cycle — extract it from path
        const cycleStart = path.indexOf(neighbor);
        cycles.push([...path.slice(cycleStart), neighbor]);
      } else if (c === WHITE) {
        dfs(neighbor, path);
      }
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const agent of config.agents) {
    if ((color.get(agent.name) || WHITE) === WHITE) {
      dfs(agent.name, []);
    }
  }

  // Warnings
  const warnings: string[] = [];

  // Check for orphan channels (declared but no producer)
  for (const [channel] of Object.entries(config.channels)) {
    if (!producerOf.has(channel) && !['git:committed'].includes(channel)) {
      warnings.push(`Channel "${channel}" has no producer in the fleet`);
    }
  }

  // Check for orphan producers (publish to undeclared channels)
  for (const [channel] of producerOf) {
    if (!config.channels[channel]) {
      warnings.push(`Agent publishes to "${channel}" which is not declared in channels`);
    }
  }

  return {
    valid: cycles.length === 0,
    cycles,
    warnings,
  };
}

// ─── Fleet Runner ───────────────────────────────────────────────────────────

const PD_URL = process.env.PD_URL || process.env.PORT_DADDY_URL || 'http://localhost:9876';

export function createFleetRunner(config: FleetConfig, projectDir: string) {
  const running = new Map<string, RunningAgent>();

  function startAgent(agent: FleetAgent): void {
    if (running.has(agent.name)) return; // already running

    const record: RunningAgent = {
      name: agent.name,
      type: agent.schedule ? 'scheduled' : 'triggered',
      startedAt: Date.now(),
    };

    if (agent.schedule) {
      // Scheduled agent: run immediately, then on interval
      // Convert cron to ms (simplified: support */N * * * * format)
      const intervalMs = parseCronInterval(agent.schedule);
      runAgentOnce(agent);
      record.interval = setInterval(() => runAgentOnce(agent), intervalMs);
    }

    if (agent.trigger) {
      // Triggered agent: subscribe to channel via pd watch
      const watchProc = spawn('npx', [
        'tsx', join(projectDir, 'bin', 'port-daddy-cli.ts'),
        'watch', agent.trigger,
        '--exec', buildSpawnCommand(agent),
      ], {
        cwd: projectDir,
        env: { ...process.env, PD_URL },
        stdio: 'pipe',
        detached: true,
      });
      watchProc.unref();
      record.process = watchProc;
    }

    running.set(agent.name, record);
  }

  function startWatcher(watcher: FleetWatcher): void {
    if (running.has(watcher.name)) return;

    const watchProc = spawn('npx', [
      'tsx', join(projectDir, 'bin', 'port-daddy-cli.ts'),
      'watch', watcher.trigger,
      '--exec', watcher.exec,
    ], {
      cwd: projectDir,
      env: { ...process.env, PD_URL },
      stdio: 'pipe',
      detached: true,
    });
    watchProc.unref();

    running.set(watcher.name, {
      name: watcher.name,
      type: 'watcher',
      process: watchProc,
      startedAt: Date.now(),
    });
  }

  interface SpawnResponse {
    agentId?: string;
    status?: string;
    error?: string;
  }

  async function runAgentOnce(agent: FleetAgent): Promise<void> {
    try {
      const body: Record<string, unknown> = {
        backend: agent.backend,
        task: agent.prompt,
        identity: agent.identity,
        purpose: `Fleet agent: ${agent.name}`,
      };
      if (agent.model) body.model = agent.model;
      if (agent.timeout) body.timeout = agent.timeout;
      if (agent.allowedTools) body.allowedTools = agent.allowedTools;

      const res = await fetch(`${PD_URL}/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as SpawnResponse;

      // /spawn returns status='spawned' immediately (async). Trigger callbacks
      // on spawn acknowledgment — the actual completion is tracked by PD.
      const succeeded = data.status === 'spawned' || data.status === 'completed';
      const failed = data.status === 'failed' || !res.ok;

      if (succeeded && agent.onSuccess) {
        const [action, channel] = agent.onSuccess.split(' ');
        if (action === 'publish' && channel) {
          await fetch(`${PD_URL}/msg/${channel}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: `${agent.name} spawned` }),
          });
        }
      } else if (failed && agent.onFailure) {
        const [action, channel] = agent.onFailure.split(' ');
        if (action === 'publish' && channel) {
          await fetch(`${PD_URL}/msg/${channel}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: `${agent.name} failed: ${(data.error ?? 'unknown').slice(0, 200)}` }),
          });
        }
      }
    } catch (err) {
      console.error(`[Fleet] Agent ${agent.name} error:`, (err as Error).message);
    }
  }

  function buildSpawnCommand(agent: FleetAgent): string {
    const parts = [
      'npx', 'tsx', join(projectDir, 'bin', 'port-daddy-cli.ts'),
      'spawn', '--backend', agent.backend,
      '--identity', agent.identity || `fleet:${agent.name}`,
      '-q', '--', JSON.stringify(agent.prompt),
    ];
    return parts.join(' ');
  }

  async function ensureHarbor(): Promise<void> {
    if (!config.harbor) return;
    try {
      // Create harbor (idempotent — daemon returns existing if it already exists)
      const channels = Object.keys(config.channels);
      await fetch(`${PD_URL}/harbors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.harbor,
          capabilities: config.agents.map(a => a.name),
          channels,
          agentPatterns: config.agents
            .map(a => a.identity)
            .filter(Boolean),
        }),
      });
      console.error(`[Fleet] Harbor "${config.harbor}" ready`);
    } catch (err) {
      console.error(`[Fleet] Harbor setup failed:`, (err as Error).message);
    }
  }

  async function enrollInHarbor(agentIdentity: string): Promise<void> {
    if (!config.harbor) return;
    try {
      await fetch(`${PD_URL}/harbors/${encodeURIComponent(config.harbor)}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agentIdentity,
          identity: agentIdentity,
        }),
      });
    } catch {
      // Non-critical — harbor enrollment is advisory
    }
  }

  function startAll(): void {
    // Create the fleet harbor first, then start agents
    ensureHarbor().then(() => {
      for (const agent of config.agents) {
        startAgent(agent);
        if (agent.identity) enrollInHarbor(agent.identity);
      }
      for (const watcher of config.watchers) {
        startWatcher(watcher);
      }
    });
  }

  function stopAll(): void {
    for (const [name, record] of running) {
      if (record.interval) clearInterval(record.interval);
      if (record.process) {
        const pid = record.process.pid;
        if (pid) {
          try { process.kill(-pid, 'SIGTERM'); } catch {
            // Process group kill failed; try direct kill
            try { record.process.kill('SIGTERM'); } catch { /* already dead */ }
          }
        } else {
          try { record.process.kill('SIGTERM'); } catch { /* already dead */ }
        }
      }
      running.delete(name);
    }
  }

  function getStatus(): Array<{ name: string; type: string; running: boolean; uptime: number }> {
    return [...running.values()].map(r => ({
      name: r.name,
      type: r.type,
      running: true,
      uptime: Date.now() - r.startedAt,
    }));
  }

  return { startAll, stopAll, startAgent, getStatus, config };
}

// ─── Cron Helpers ───────────────────────────────────────────────────────────

function parseCronInterval(cron: string): number {
  const MIN_INTERVAL = 60000;  // 1 minute minimum — prevents runaway agents
  const DEFAULT_INTERVAL = 600000;  // 10 minutes

  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return DEFAULT_INTERVAL;

  const [minute, hour] = parts;

  if (minute.startsWith('*/')) {
    const n = parseInt(minute.slice(2), 10);
    if (isNaN(n) || n <= 0) return DEFAULT_INTERVAL;
    return Math.max(n * 60 * 1000, MIN_INTERVAL);
  }
  if (hour.startsWith('*/')) {
    const n = parseInt(hour.slice(2), 10);
    if (isNaN(n) || n <= 0) return DEFAULT_INTERVAL;
    return Math.max(n * 60 * 60 * 1000, MIN_INTERVAL);
  }
  if (minute === '0' && hour === '*') {
    return 3600000; // every hour
  }

  return DEFAULT_INTERVAL;
}
