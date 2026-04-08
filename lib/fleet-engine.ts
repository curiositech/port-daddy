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
import { get as httpGet } from 'node:http';
import { parse as parseYaml } from 'yaml';
import type { CostTracker } from './cost-tracker.js';
import { resolveFleetChannel } from './fleet-channels.js';
import { getDaemonTcpUrl } from '../shared/daemon-discovery.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FleetAgent {
  name: string;
  schedule?: string;       // cron syntax
  trigger?: string;        // channel name
  backend: string;         // ollama, claude, claude-cli, codex, custom
  model?: string;
  modelTier?: FleetModelTier;
  prompt: string;
  worktree?: boolean;
  singleton?: boolean;
  respawn?: boolean;       // auto-respawn on death
  maxRespawns?: number;    // circuit breaker (default: 3)
  onSuccess?: string;      // "publish channel:name"
  onFailure?: string;
  identity?: string;
  timeout?: number;
  allowedTools?: string;
  fallbacks?: FleetRuntimeTarget[];
}

export interface FleetWatcher {
  name: string;
  trigger: string;
  exec: string;
  condition?: string;
  confirm?: boolean;
}

export interface FleetLimits {
  /** Max concurrent spawns for this project's fleet (default: unlimited) */
  maxConcurrentSpawns?: number;
  /** Max spawns per hour (rate limit, default: unlimited) */
  maxSpawnsPerHour?: number;
  /** Required daily LLM spend ceiling for this project */
  budgetUsdPerDay?: number;
}

export interface FleetConfig {
  name: string;
  harbor?: string;
  limits?: FleetLimits;
  agents: FleetAgent[];
  watchers: FleetWatcher[];
  channels: Record<string, { description: string; consumers?: string[] }>;
}

export interface FleetRuntimeDefaults {
  backend?: string;
  model?: string;
}

export type FleetModelTier = 'low' | 'mid' | 'high';

export interface FleetRuntimeTarget {
  backend?: string;
  model?: string;
  modelTier?: FleetModelTier;
}

export interface ResolvedFleetAgentRuntime {
  backend: string | null;
  model?: string;
  modelTier?: FleetModelTier;
  backendSource: 'agent' | 'env' | 'missing';
  modelSource: 'agent' | 'tier' | 'env' | 'unset';
  warnings: string[];
}

export interface FleetRunContext {
  source?: 'schedule' | 'trigger' | 'inbox' | 'manual';
  channel?: string;
  from?: string | null;
  message?: unknown;
  messageContent?: string;
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
  name?: string;
  schedule?: string;
  trigger?: string;
  backend?: string;
  model?: string;
  model_tier?: string;
  prompt?: string | number;
  worktree?: boolean;
  singleton?: boolean;
  respawn?: boolean;
  max_respawns?: number;
  on_success?: string;
  on_failure?: string;
  identity?: string;
  timeout?: number;
  allowedTools?: string;
  allowed_tools?: string;
  fallbacks?: FleetYamlRuntimeTarget[];
}

interface FleetYamlRuntimeTarget {
  backend?: string;
  model?: string;
  model_tier?: string;
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

interface FleetYamlLimits {
  max_concurrent_spawns?: number;
  max_spawns_per_hour?: number;
  budget_usd_per_day?: number;
}

interface FleetYamlRoot {
  name?: string;
  harbor?: string;
  limits?: FleetYamlLimits;
  fleet?: {
    name?: string;
    harbor?: string;
    limits?: FleetYamlLimits;
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

const FLEET_CONFIG_NAMES = ['pd-fleet.yml', 'pd-fleet.yaml', '.portdaddy/fleet.yml', '.portdaddy/fleet.yaml'];
const MODEL_TIERS = new Set<FleetModelTier>(['low', 'mid', 'high']);
export const BUILTIN_MODEL_TIERS: Partial<Record<string, Record<FleetModelTier, string>>> = {
  claude: {
    low: 'claude-haiku-4-5-20251001',
    mid: 'claude-sonnet-4-5-20250929',
    high: 'claude-opus-4-1-20250805',
  },
  'claude-cli': { low: 'haiku', mid: 'sonnet', high: 'opus' },
  codex: { low: 'gpt-5.4-mini', mid: 'gpt-5.3-codex', high: 'gpt-5.4' },
  gemini: { low: 'gemini-2.0-flash-exp', mid: 'gemini-2.5-flash', high: 'gemini-2.5-pro' },
  ollama: { low: 'qwen2.5-coder:7b', mid: 'llama3.2:8b', high: 'qwen2.5-coder:14b' },
  aider: { low: 'gpt-4.1-mini', mid: 'gpt-4.1', high: 'gpt-5' },
  custom: { low: 'custom-low', mid: 'custom-mid', high: 'custom-high' },
};

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBudgetUsdPerDay(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function parseModelTier(value: string | undefined): FleetModelTier | undefined {
  const normalized = cleanEnvValue(value)?.toLowerCase() as FleetModelTier | undefined;
  return normalized && MODEL_TIERS.has(normalized) ? normalized : undefined;
}

function normalizeBackendEnvKey(backend: string): string {
  return backend.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

function resolveTierModel(backend: string, modelTier: FleetModelTier): string | undefined {
  const envKey = `PD_MODEL_TIER_${normalizeBackendEnvKey(backend)}_${modelTier.toUpperCase()}`;
  const legacyEnvKey = `PORT_DADDY_MODEL_TIER_${normalizeBackendEnvKey(backend)}_${modelTier.toUpperCase()}`;
  return cleanEnvValue(process.env[envKey])
    || cleanEnvValue(process.env[legacyEnvKey])
    || BUILTIN_MODEL_TIERS[backend]?.[modelTier];
}

export function getFleetRuntimeDefaults(): FleetRuntimeDefaults {
  return {
    backend: cleanEnvValue(process.env.PD_FLEET_DEFAULT_BACKEND)
      || cleanEnvValue(process.env.PORT_DADDY_FLEET_DEFAULT_BACKEND),
    model: cleanEnvValue(process.env.PD_FLEET_DEFAULT_MODEL)
      || cleanEnvValue(process.env.PORT_DADDY_FLEET_DEFAULT_MODEL),
  };
}

function mergeRuntimeTarget(agent: Pick<FleetAgent, 'backend' | 'model' | 'modelTier'>, override?: FleetRuntimeTarget): FleetRuntimeTarget {
  const overrideBackend = cleanEnvValue(override?.backend);
  const baseBackend = cleanEnvValue(agent.backend);
  const sameBackend = !overrideBackend || overrideBackend === baseBackend;
  return {
    backend: overrideBackend || baseBackend,
    model: cleanEnvValue(override?.model) || (sameBackend ? cleanEnvValue(agent.model) : undefined),
    modelTier: parseModelTier(override?.modelTier) || (sameBackend ? parseModelTier(agent.modelTier) : undefined),
  };
}

export function resolveFleetAgentRuntime(agent: Pick<FleetAgent, 'backend' | 'model' | 'modelTier'> | FleetRuntimeTarget): ResolvedFleetAgentRuntime {
  const defaults = getFleetRuntimeDefaults();
  const explicitBackend = cleanEnvValue(agent.backend);
  const explicitModel = cleanEnvValue(agent.model);
  const explicitModelTier = parseModelTier(agent.modelTier);
  const backend = explicitBackend || defaults.backend || null;
  const tierModel = backend && explicitModelTier ? resolveTierModel(backend, explicitModelTier) : undefined;
  const model = explicitModel || tierModel || defaults.model;
  const warnings: string[] = [];

  if (!backend) {
    warnings.push('missing backend; set agent.backend or PD_FLEET_DEFAULT_BACKEND');
  }
  if (backend && explicitModelTier && !tierModel) {
    warnings.push(`no model mapping for ${backend}/${explicitModelTier}; set model explicitly or define PD_MODEL_TIER_${normalizeBackendEnvKey(backend)}_${explicitModelTier.toUpperCase()}`);
  } else if (backend === 'claude-cli' && !model) {
    warnings.push('model not pinned; claude-cli will use its local default');
  }

  return {
    backend,
    model,
    modelTier: explicitModelTier,
    backendSource: explicitBackend ? 'agent' : defaults.backend ? 'env' : 'missing',
    modelSource: explicitModel ? 'agent' : tierModel ? 'tier' : defaults.model ? 'env' : 'unset',
    warnings,
  };
}

function parseFallbacks(fallbacks: FleetYamlRuntimeTarget[] | undefined): FleetRuntimeTarget[] | undefined {
  if (!Array.isArray(fallbacks) || fallbacks.length === 0) return undefined;
  const parsed = fallbacks
    .filter((fallback) => fallback && typeof fallback === 'object')
    .map((fallback) => ({
      backend: cleanEnvValue(fallback.backend),
      model: cleanEnvValue(fallback.model),
      modelTier: parseModelTier(fallback.model_tier),
    }))
    .filter((fallback) => fallback.backend || fallback.model || fallback.modelTier);
  return parsed.length > 0 ? parsed : undefined;
}

function buildRuntimeAttempts(agent: Pick<FleetAgent, 'backend' | 'model' | 'modelTier' | 'fallbacks'>): ResolvedFleetAgentRuntime[] {
  const attempts = [resolveFleetAgentRuntime(agent)];
  for (const fallback of agent.fallbacks || []) {
    attempts.push(resolveFleetAgentRuntime(mergeRuntimeTarget(agent, fallback)));
  }
  return attempts;
}

/** Returns the first fleet config path that exists in projectDir, or null. */
export function findFleetConfigPath(projectDir: string): string | null {
  for (const name of FLEET_CONFIG_NAMES) {
    const p = join(projectDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadFleetConfig(projectDir: string): FleetConfig | null {
  const configPath = findFleetConfigPath(projectDir);
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
  const addAgent = (name: string, s: FleetYamlAgent): void => {
      const runtime = resolveFleetAgentRuntime({
        backend: s.backend,
        model: s.model,
        modelTier: parseModelTier(s.model_tier),
      } as Pick<FleetAgent, 'backend' | 'model' | 'modelTier'>);
      agents.push({
        name,
        schedule: s.schedule,
        trigger: s.trigger,
        backend: runtime.backend || '',
        model: runtime.model,
        modelTier: runtime.modelTier,
        prompt: typeof s.prompt === 'string' ? s.prompt.trim() : String(s.prompt || ''),
        worktree: s.worktree || false,
        singleton: s.singleton || false,
        respawn: s.respawn || false,
        maxRespawns: s.max_respawns ?? 3,
        onSuccess: s.on_success,
        onFailure: s.on_failure,
        identity: s.identity,
        timeout: s.timeout,
        allowedTools: s.allowedTools || s.allowed_tools,
        fallbacks: parseFallbacks(s.fallbacks),
      });
  };
  if (rawAgents && typeof rawAgents === 'object' && !Array.isArray(rawAgents)) {
    for (const [name, s] of Object.entries(rawAgents)) {
      addAgent(name, s);
    }
  } else if (Array.isArray(rawAgents)) {
    rawAgents.forEach((s, index) => {
      const derivedName = cleanEnvValue(s.name) || `agent-${index + 1}`;
      addAgent(derivedName, s);
    });
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

  // Parse limits
  const rawLimits = fleet.limits;
  const limits: FleetLimits | undefined = rawLimits ? {
    maxConcurrentSpawns: rawLimits.max_concurrent_spawns,
    maxSpawnsPerHour: rawLimits.max_spawns_per_hour,
    budgetUsdPerDay: normalizeBudgetUsdPerDay(rawLimits.budget_usd_per_day),
  } : undefined;

  return {
    name: fleet.name || basename(projectDir),
    harbor: fleet.harbor,
    limits,
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
        if (!producerOf.has(channel)) producerOf.set(channel, []);
        producerOf.get(channel)!.push(agent.name);
      }
    }

    // Agent consumes via trigger
    if (agent.trigger) {
      if (!consumerOf.has(agent.trigger)) consumerOf.set(agent.trigger, []);
      consumerOf.get(agent.trigger)!.push(agent.name);
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

  if (config.agents.length > 0 && config.limits?.budgetUsdPerDay === undefined) {
    warnings.push('Fleet limits.budgetUsdPerDay is required for every agentic launch.');
  }

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

function getFleetDaemonUrl(): string {
  return process.env.PD_URL || getDaemonTcpUrl(process.env.PORT_DADDY_URL);
}

// ─── Lifecycle Events ──────────────────────────────────────────────────────

export interface FleetEvent {
  type: 'agent_started' | 'agent_completed' | 'agent_failed' | 'watcher_started' | 'watcher_triggered' | 'fleet_started' | 'fleet_stopped';
  agent?: string;
  identity?: string;
  project?: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export type FleetEventCallback = (event: FleetEvent) => void;

export interface FleetRunnerOptions {
  onEvent?: FleetEventCallback;
  costTracker?: CostTracker;
  messaging?: {
    subscribe(channel: string, callback: (message: unknown) => void): (() => void) | null;
  };
}

export function createFleetRunner(config: FleetConfig, projectDir: string, options?: FleetRunnerOptions) {
  const running = new Map<string, RunningAgent>();
  const emit = options?.onEvent ?? (() => {});
  const project = config.name;
  const agentIndex = new Map(config.agents.map(agent => [agent.name, agent]));

  function resolveChannel(channel: string): string {
    return resolveFleetChannel(channel, projectDir, project);
  }

  // ─── Resource quota enforcement (Ostrom Principle 2) ────────────────────
  let activeSpawns = 0;
  const activeAgentRuns = new Set<string>();
  const spawnTimestamps: number[] = [];  // rolling window for per-hour rate limit

  function canSpawn(): { allowed: boolean; reason?: string } {
    const limits = config.limits;
    if (!limits || limits.budgetUsdPerDay === undefined) {
      return { allowed: false, reason: 'fleet limits.budgetUsdPerDay is required for every agentic launch' };
    }

    // Concurrency limit
    if (limits.maxConcurrentSpawns !== undefined && activeSpawns >= limits.maxConcurrentSpawns) {
      return { allowed: false, reason: `concurrent spawn limit (${limits.maxConcurrentSpawns}) reached` };
    }

    // Hourly rate limit
    if (limits.maxSpawnsPerHour !== undefined) {
      const oneHourAgo = Date.now() - 3600000;
      // Prune old timestamps
      while (spawnTimestamps.length > 0 && spawnTimestamps[0] < oneHourAgo) {
        spawnTimestamps.shift();
      }
      if (spawnTimestamps.length >= limits.maxSpawnsPerHour) {
        return { allowed: false, reason: `hourly spawn limit (${limits.maxSpawnsPerHour}/hr) reached` };
      }
    }

    // Daily budget limit
    if (limits.budgetUsdPerDay !== undefined && options?.costTracker) {
      const budget = options.costTracker.budgetStatus(project, limits.budgetUsdPerDay);
      if (budget.overBudget) {
        return {
          allowed: false,
          reason: `daily budget exceeded ($${budget.spentUsd.toFixed(2)} / $${budget.budgetUsdPerDay.toFixed(2)})`,
        };
      }
    }

    return { allowed: true };
  }

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
      void runAgentOnce(agent);
      record.interval = setInterval(() => runAgentOnce(agent), intervalMs);
    }

    if (agent.trigger) {
      const physicalTriggerChannel = resolveChannel(agent.trigger);
      // Prefer in-process subscriptions so trigger payload survives into the spawned task.
      const unsubscribe = options?.messaging?.subscribe(physicalTriggerChannel, (message: unknown) => {
        void runAgentOnce(agent, contextFromMessage(agent.trigger!, message));
      });

      if (unsubscribe) {
        record.watchHandle = unsubscribe;
      } else {
        // Fallback for standalone CLI/testing contexts.
        const watchProc = spawn('npx', [
          'tsx', join(projectDir, 'bin', 'port-daddy-cli.ts'),
          'watch', physicalTriggerChannel,
          '--exec', buildSpawnCommand(agent),
        ], {
          cwd: projectDir,
          env: { ...process.env, PD_URL: getFleetDaemonUrl() },
          stdio: 'pipe',
          detached: true,
        });
        watchProc.unref();
        record.process = watchProc;
      }
    }

    if (!agent.schedule && !agent.trigger) {
      void runAgentOnce(agent);
    }

    running.set(agent.name, record);
  }

  function startWatcher(watcher: FleetWatcher): void {
    if (running.has(watcher.name)) return;
    const physicalTriggerChannel = resolveChannel(watcher.trigger);

    const watchProc = spawn('npx', [
      'tsx', join(projectDir, 'bin', 'port-daddy-cli.ts'),
      'watch', physicalTriggerChannel,
      '--exec', watcher.exec,
    ], {
      cwd: projectDir,
      env: { ...process.env, PD_URL: getFleetDaemonUrl() },
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
    emit({
      type: 'watcher_started', agent: watcher.name, project,
      identity: `${project}:fleet:${watcher.name}`,
      timestamp: Date.now(), details: { trigger: watcher.trigger, physicalTrigger: physicalTriggerChannel },
    });
  }

  interface SpawnResponse {
    agentId?: string;
    status?: string;
    error?: string;
  }

  interface SpawnAttemptFailure {
    kind: 'config' | 'transport' | 'daemon' | 'spawn' | 'unexpected_status' | 'invalid_response';
    backend: string;
    model: string | null;
    attempt: number;
    message: string;
    httpStatus?: number;
    spawnStatus?: string;
  }

  async function spawnFleetAttempt(
    runtime: ResolvedFleetAgentRuntime,
    attempt: number,
    task: string,
    identity: string,
    purpose: string,
    agent: FleetAgent,
  ): Promise<{ ok: true; data: SpawnResponse } | { ok: false; failure: SpawnAttemptFailure }> {
    if (!runtime.backend) {
      return {
        ok: false,
        failure: {
          kind: 'config',
          backend: 'MISSING',
          model: runtime.model ?? null,
          attempt,
          message: 'missing backend; set agent.backend or PD_FLEET_DEFAULT_BACKEND',
        },
      };
    }

    const body: Record<string, unknown> = {
      backend: runtime.backend,
      budgetUsd: config.limits?.budgetUsdPerDay,
      task,
      identity,
      purpose,
    };
    if (runtime.model) body.model = runtime.model;
    if (agent.timeout) body.timeout = agent.timeout;
    if (agent.allowedTools) body.allowedTools = agent.allowedTools;

    let res: Response;
    try {
      res = await fetch(`${getFleetDaemonUrl()}/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        failure: {
          kind: 'transport',
          backend: runtime.backend,
          model: runtime.model ?? null,
          attempt,
          message: (err as Error).message,
        },
      };
    }

    let data: SpawnResponse;
    try {
      data = (await res.json()) as SpawnResponse;
    } catch (err) {
      return {
        ok: false,
        failure: {
          kind: 'invalid_response',
          backend: runtime.backend,
          model: runtime.model ?? null,
          attempt,
          message: `daemon returned invalid JSON: ${(err as Error).message}`,
          httpStatus: res.status,
        },
      };
    }

    const succeeded = data.status === 'spawned' || data.status === 'completed';
    if (succeeded) {
      return { ok: true, data };
    }

    if (!res.ok || data.status === 'failed') {
      return {
        ok: false,
        failure: {
          kind: !res.ok ? 'daemon' : 'spawn',
          backend: runtime.backend,
          model: runtime.model ?? null,
          attempt,
          message: data.error || `spawn failed via ${runtime.backend}`,
          httpStatus: res.status,
          spawnStatus: data.status,
        },
      };
    }

    return {
      ok: false,
      failure: {
        kind: 'unexpected_status',
        backend: runtime.backend,
        model: runtime.model ?? null,
        attempt,
        message: `unexpected status ${data.status ?? 'unknown'}`,
        httpStatus: res.status,
        spawnStatus: data.status,
      },
    };
  }

  function fireHook(hook: string, payload: string): void {
    const [action, channel] = hook.split(' ');
    if (action === 'publish' && channel) {
      const physicalChannel = resolveChannel(channel);
      void Promise.resolve(fetch(`${getFleetDaemonUrl()}/msg/${physicalChannel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      })).catch((err: Error) => {
        console.error('[Fleet] Hook publish failed:', {
          hook,
          channel: physicalChannel,
          error: err.message,
        });
      });
    }
  }

  function trimMessage(message: string, maxChars = 4000): string {
    if (message.length <= maxChars) return message;
    return `${message.slice(0, maxChars)}\n\n[truncated ${message.length - maxChars} chars]`;
  }

  function serializeMessage(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message === null || message === undefined) return '';
    try {
      return JSON.stringify(message, null, 2);
    } catch {
      return String(message);
    }
  }

  function contextFromMessage(channel: string, message: unknown): FleetRunContext {
    const isObj = typeof message === 'object' && message !== null;
    const event = isObj ? message as { payload?: unknown; sender?: string | null } : null;
    const resolved = event?.payload ?? message;
    return {
      source: 'trigger',
      channel,
      from: event?.sender ?? null,
      message: resolved,
      messageContent: trimMessage(serializeMessage(resolved)),
    };
  }

  function buildAgentTask(agent: FleetAgent, context?: FleetRunContext): string {
    const basePrompt = agent.prompt.trim();
    if (!context) return basePrompt;

    const messageText = (context.messageContent ?? serializeMessage(context.message)).trim();
    if (!messageText) return basePrompt;

    const lines = [
      basePrompt,
      '',
      'Trigger context:',
      `- source: ${context.source || 'trigger'}`,
      context.channel ? `- channel: ${context.channel}` : null,
      context.from ? `- sender: ${context.from}` : null,
      '- message:',
      messageText,
      '',
      'Take one bounded pass in response to this trigger. Use only your configured channels and stop after this pass.',
    ].filter((line): line is string => !!line);

    return lines.join('\n');
  }

  async function runAgentOnce(agent: FleetAgent, context?: FleetRunContext): Promise<{ success: boolean; error?: string }> {
    const identity = agent.identity || `${project}:fleet:${agent.name}`;
    const attempts = buildRuntimeAttempts(agent);
    const primaryRuntime = attempts[0];

    if (agent.singleton && activeAgentRuns.has(agent.name)) {
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: Date.now(), details: { error: 'singleton already active' },
      });
      return { success: false, error: 'singleton already active' };
    }

    // Enforce resource quotas before spawning
    const quota = canSpawn();
    if (!quota.allowed) {
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: Date.now(), details: { error: `quota: ${quota.reason}` },
      });
      console.error(`[Fleet] ${agent.name} blocked by quota: ${quota.reason}`);
      return { success: false, error: `quota: ${quota.reason}` };
    }

    if (!primaryRuntime?.backend) {
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: Date.now(),
        details: { error: 'missing backend; set agent.backend or PD_FLEET_DEFAULT_BACKEND' },
      });
      console.error(`[Fleet] ${agent.name} blocked: missing backend. Set agent.backend or PD_FLEET_DEFAULT_BACKEND.`);
      return { success: false, error: 'missing backend; set agent.backend or PD_FLEET_DEFAULT_BACKEND' };
    }

    activeAgentRuns.add(agent.name);
    activeSpawns++;
    if (config.limits?.maxSpawnsPerHour !== undefined) {
      spawnTimestamps.push(Date.now());
    }

    emit({
      type: 'agent_started', agent: agent.name, identity, project,
      timestamp: Date.now(),
      details: {
        backend: primaryRuntime.backend,
        model: primaryRuntime.model ?? null,
        fallbacks: attempts.slice(1).map((attempt) => ({
          backend: attempt.backend,
          model: attempt.model ?? null,
          modelTier: attempt.modelTier ?? null,
        })),
      },
    });

    try {
      const attemptErrors: SpawnAttemptFailure[] = [];
      const task = buildAgentTask(agent, context);

      for (let i = 0; i < attempts.length; i += 1) {
        const runtime = attempts[i];
        if (!runtime.backend) continue;
        const outcome = await spawnFleetAttempt(
          runtime,
          i + 1,
          task,
          identity,
          `Fleet agent: ${agent.name}`,
          agent,
        );

        if (outcome.ok) {
          emit({
            type: 'agent_completed', agent: agent.name, identity, project,
            timestamp: Date.now(),
            details: {
              agentId: outcome.data.agentId,
              status: outcome.data.status,
              backend: runtime.backend,
              model: runtime.model ?? null,
              attempt: i + 1,
            },
          });
          if (agent.onSuccess) {
            fireHook(agent.onSuccess, `${agent.name} spawned`);
          }
          return { success: true };
        }

        attemptErrors.push(outcome.failure);

        if (i < attempts.length - 1) {
          const next = attempts[i + 1];
          console.error(`[Fleet] ${agent.name} fallback:`, {
            failedAttempt: {
              backend: outcome.failure.backend,
              model: outcome.failure.model,
              attempt: outcome.failure.attempt,
              kind: outcome.failure.kind,
              message: outcome.failure.message,
            },
            nextAttempt: {
              backend: next.backend,
              model: next.model ?? null,
              attempt: i + 2,
            },
          });
        }
      }

      const errorMessage = 'all runtime attempts failed';
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: Date.now(),
        details: {
          error: errorMessage,
          attempts: attemptErrors,
        },
      });
      if (agent.onFailure) {
        const summary = attemptErrors
          .map((attempt) => `${attempt.backend}${attempt.model ? `/${attempt.model}` : ''} [${attempt.kind}]: ${attempt.message}`)
          .join(' ; ');
        fireHook(agent.onFailure, `${agent.name} failed: ${summary.slice(0, 200)}`);
      }
      return { success: false, error: errorMessage };
    } catch (err) {
      const message = (err as Error).message;
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: Date.now(), details: { error: message },
      });
      console.error(`[Fleet] Agent ${agent.name} error:`, message);
      return { success: false, error: message };
    } finally {
      activeSpawns = Math.max(0, activeSpawns - 1);
      activeAgentRuns.delete(agent.name);
    }
  }

  function buildSpawnCommand(agent: FleetAgent): string {
    // Validate identity to prevent shell injection via YAML config
    const identity = agent.identity || `fleet:${agent.name}`;
    const runtime = buildRuntimeAttempts(agent)[0];
    if (!/^[a-zA-Z0-9.:_*-]+$/.test(identity)) {
      throw new Error(`Invalid fleet agent identity: ${identity}`);
    }
    if (!runtime.backend) {
      throw new Error(`Fleet agent "${agent.name}" is missing a backend. Set agent.backend or PD_FLEET_DEFAULT_BACKEND.`);
    }

    const quote = (value: string): string => JSON.stringify(value);
    const parts = [
      'npx', 'tsx', quote(join(projectDir, 'bin', 'port-daddy-cli.ts')),
      'spawn', '--backend', quote(runtime.backend),
      '--identity', quote(identity),
    ];
    if (runtime.model) parts.push('--model', quote(runtime.model));
    if (agent.allowedTools) parts.push('--allowedTools', quote(agent.allowedTools));
    parts.push('-q', '--', quote(agent.prompt));
    return parts.join(' ');
  }

  async function ensureHarbor(): Promise<void> {
    if (!config.harbor) return;
    try {
      // Create harbor (idempotent — daemon returns existing if it already exists)
      const channels = Object.keys(config.channels);
      await fetch(`${getFleetDaemonUrl()}/harbors`, {
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
      await fetch(`${getFleetDaemonUrl()}/harbors/${encodeURIComponent(config.harbor)}/enter`, {
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

  // ─── Auto-Respawn ──────────────────────────────────────────────────────

  const respawnCounts = new Map<string, number>();
  let respawnWatcherStopped = false;

  function startRespawnWatcher(): void {
    const respawnAgents = config.agents.filter(a => a.respawn);
    if (respawnAgents.length === 0) return;

    // Build identity -> agent lookup
    const identityToAgent = new Map<string, FleetAgent>();
    for (const a of respawnAgents) {
      if (a.identity) identityToAgent.set(a.identity, a);
      identityToAgent.set(a.name, a);
    }

    // Subscribe to resurrection channel via SSE
    const url = new URL(`${getFleetDaemonUrl()}/msg/resurrection/subscribe`);

    function connect() {
      const req = httpGet(url, (res) => {
        res.setEncoding('utf-8');
        let buffer = '';

        res.on('data', (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.event !== 'dead' && event.event !== 'stale') continue;

              // Find the fleet agent by identity or name
              const deadId = event.agentId || '';
              let agent: FleetAgent | undefined;
              for (const [key, a] of identityToAgent) {
                if (deadId.includes(key) || deadId.includes(a.name)) {
                  agent = a;
                  break;
                }
              }

              if (!agent) continue;

              // Circuit breaker
              const count = respawnCounts.get(agent.name) || 0;
              if (count >= (agent.maxRespawns ?? 3)) {
                console.error(`[Fleet] ${agent.name} hit respawn limit (${count}/${agent.maxRespawns ?? 3}). Not respawning.`);
                continue;
              }

              console.error(`[Fleet] Auto-respawning ${agent.name} (death #${count + 1})`);
              respawnCounts.set(agent.name, count + 1);

              // Claim salvage first, then re-spawn
              fetch(`${getFleetDaemonUrl()}/salvage/claim/${encodeURIComponent(deadId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
              }).then(() => runAgentOnce(agent!)).catch(() => runAgentOnce(agent!));
            } catch (e) {
              if (!(e instanceof SyntaxError)) {
                console.error('[Fleet] Respawn handler error:', (e as Error).message);
              }
            }
          }
        });

        res.on('end', () => {
          if (!respawnWatcherStopped) setTimeout(connect, 5000);
        });
      });

      req.on('error', () => {
        if (!respawnWatcherStopped) setTimeout(connect, 5000);
      });

      req.setTimeout(0); // No timeout on SSE
    }

    connect();
    console.error(`[Fleet] Auto-respawn watcher active for: ${respawnAgents.map(a => a.name).join(', ')}`);
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
      startRespawnWatcher();
      emit({
        type: 'fleet_started', project, timestamp: Date.now(),
        details: { agents: config.agents.length, watchers: config.watchers.length },
      });
    }).catch((err: Error) => {
      console.error(`[Fleet] Failed to start fleet "${project}":`, err.message);
    });
  }

  function stopAll(): void {
    respawnWatcherStopped = true;
    for (const [name, record] of running) {
      if (record.interval) clearInterval(record.interval);
      if (record.watchHandle) {
        try { record.watchHandle(); } catch { /* ignore unsubscribe failures */ }
        record.watchHandle = undefined;
      }
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
    emit({ type: 'fleet_stopped', project, timestamp: Date.now() });
  }

  function getStatus(): Array<{ name: string; type: string; running: boolean; uptime: number }> {
    return [...running.values()].map(r => ({
      name: r.name,
      type: r.type,
      running: true,
      uptime: Date.now() - r.startedAt,
    }));
  }

  async function hailAgent(agentName: string, context?: FleetRunContext): Promise<{ success: boolean; error?: string }> {
    const agent = agentIndex.get(agentName);
    if (!agent) {
      return { success: false, error: `No agent named ${agentName}` };
    }
    if (agent.singleton && activeAgentRuns.has(agentName)) {
      return { success: false, error: `${agentName} is singleton and already active` };
    }

    return runAgentOnce(agent, context ?? { source: 'manual' });
  }

  return { startAll, stopAll, startAgent, getStatus, hailAgent, config };
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
