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

// ─── YAML Parser ────────────────────────────────────────────────────────────

function parseFleetYaml(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    return parseYaml(text) as Record<string, unknown>;
  }
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
  } catch {}

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
  const parsed = parseFleetYaml(resolved) as any;
  if (!parsed || typeof parsed !== 'object') return null;

  const fleet = parsed.fleet || parsed;

  // Normalize agents (supports both object and array format)
  const agents: FleetAgent[] = [];
  if (fleet.agents && typeof fleet.agents === 'object' && !Array.isArray(fleet.agents)) {
    for (const [name, spec] of Object.entries(fleet.agents)) {
      const s = spec as any;
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
    for (const [name, spec] of Object.entries(fleet.watchers)) {
      const s = spec as any;
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
    for (const [name, spec] of Object.entries(fleet.channels)) {
      const s = spec as any;
      channels[name] = {
        description: s.description || '',
        consumers: s.consumers,
      };
    }
  }

  return {
    name: fleet.name || basename(projectDir),
    agents,
    watchers,
    channels,
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

      const data = await res.json() as any;

      // Handle on_success / on_failure
      if (data.status === 'completed' && agent.onSuccess) {
        const [action, channel] = agent.onSuccess.split(' ');
        if (action === 'publish' && channel) {
          await fetch(`${PD_URL}/msg/${channel}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: `${agent.name} completed` }),
          });
        }
      } else if (data.status === 'failed' && agent.onFailure) {
        const [action, channel] = agent.onFailure.split(' ');
        if (action === 'publish' && channel) {
          await fetch(`${PD_URL}/msg/${channel}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: `${agent.name} failed: ${data.error?.slice(0, 200)}` }),
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

  function startAll(): void {
    for (const agent of config.agents) {
      startAgent(agent);
    }
    for (const watcher of config.watchers) {
      startWatcher(watcher);
    }
  }

  function stopAll(): void {
    for (const [name, record] of running) {
      if (record.interval) clearInterval(record.interval);
      if (record.process) {
        try { process.kill(-record.process.pid!, 'SIGTERM'); } catch {
          try { record.process.kill('SIGTERM'); } catch {}
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
