/**
 * Fleet Engine — Declarative fleet management from pd-fleet.yml
 *
 * Reads pd-fleet.yml, resolves template variables, and manages
 * agent lifecycles via pd spawn and pd watch.
 *
 * Design: ADR-0019 (Declarative Fleet Configuration)
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { parse as parseYaml } from 'yaml';
import type { CostTracker } from './cost-tracker.js';
import { resolveFleetChannel } from './fleet-channels.js';
import { collectSemanticAliases } from './semantic-terms.js';
import type { SemanticAlias } from './semantic-terms.js';
import type { SemanticResolver } from './semantic-resolver.js';
import type { Tuple, TupleSpace } from './tuples.js';
import { getDaemonTcpUrl } from '../shared/daemon-discovery.js';
import { deriveFleetAgentName } from './agent-names.js';
import { buildPortDaddyShellCommand, resolvePortDaddyInvocation } from './port-daddy-command.js';
import { resolveRawBackendName } from './llm-backend-resolver.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FleetAgent {
  name: string;
  schedule?: string;       // cron syntax
  trigger?: string;        // channel name
  triggerTuple?: unknown[]; // tuple pattern in harbor-scoped tuple space
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
  cooldownMs?: number;
  dedupeWindowMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  backoffMultiplier?: number;
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
  channels: Record<string, { description: string; consumers?: string[]; externalProducer?: string | boolean }>;
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
  source?: 'schedule' | 'trigger' | 'tuple' | 'inbox' | 'manual';
  channel?: string;
  from?: string | null;
  message?: unknown;
  messageContent?: string;
  tuple?: Tuple;
  tuplePattern?: unknown[];
  tupleHarbor?: string | null;
}

interface RunningAgent {
  name: string;
  type: 'scheduled' | 'triggered' | 'watcher' | 'manual';
  process?: ChildProcess;
  childProcesses?: Set<ChildProcess>;
  interval?: ReturnType<typeof setInterval>;
  tuplePollInterval?: ReturnType<typeof setInterval>;
  watchHandle?: () => void;
  startedAt: number;
}

interface AgentActivationState {
  lastStartedAt?: number;
  lastTriggerFingerprint?: string;
  lastTriggerAt?: number;
  consecutiveFailures: number;
  backoffUntil?: number;
  pendingContext?: FleetRunContext;
}

// ─── YAML Shapes ───────────────────────────────────────────────────────────

interface FleetYamlAgent {
  name?: string;
  schedule?: string;
  trigger?: string;
  trigger_tuple?: unknown[];
  backend?: string;
  model?: string;
  model_tier?: string;
  modelTier?: string;
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
  cooldown_ms?: number;
  dedupe_window_ms?: number;
  backoff_base_ms?: number;
  backoff_max_ms?: number;
  backoff_multiplier?: number;
}

interface FleetYamlRuntimeTarget {
  backend?: string;
  model?: string;
  model_tier?: string;
  modelTier?: string;
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
  external_producer?: string | boolean;
  externalProducer?: string | boolean;
}

interface FleetYamlLimits {
  max_concurrent_spawns?: number;
  max_spawns_per_hour?: number;
  budget_usd_per_day?: number;
}

interface FleetYamlDefaults {
  backend?: string;
  model?: string;
  model_tier?: string;
  modelTier?: string;
  /**
   * Override the per-agent worktree default. If unset, agents with
   * inferred edit intent (Write/Edit/MultiEdit/Bash in allowedTools, or
   * no allowedTools restriction at all) default to `worktree: true` —
   * which removes the shared-tree blast radius for parallel runs.
   */
  worktree?: boolean;
}

interface FleetYamlRoot {
  name?: string;
  harbor?: string;
  limits?: FleetYamlLimits;
  defaults?: FleetYamlDefaults;
  fleet?: {
    name?: string;
    harbor?: string;
    limits?: FleetYamlLimits;
    defaults?: FleetYamlDefaults;
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

function getTemplateVars(projectDir: string, projectName?: string): Record<string, string> {
  const project = projectName || basename(projectDir);
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
  cloudflare: {
    low: '@cf/zai-org/glm-4.7-flash',
    mid: '@cf/openai/gpt-oss-120b',
    high: '@cf/moonshotai/kimi-k2.6',
  },
  ollama: { low: 'qwen2.5-coder:7b', mid: 'llama3.1:8b', high: 'qwen2.5-coder:14b' },
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

function normalizePositiveMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function normalizeBackoffMultiplier(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? value
    : undefined;
}

function parseModelTier(value: string | undefined): FleetModelTier | undefined {
  const normalized = cleanEnvValue(value)?.toLowerCase() as FleetModelTier | undefined;
  return normalized && MODEL_TIERS.has(normalized) ? normalized : undefined;
}

function parseYamlModelTier(value: { model_tier?: string; modelTier?: string } | undefined): FleetModelTier | undefined {
  return parseModelTier(value?.model_tier) || parseModelTier(value?.modelTier);
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
  // Backend name comes from the unified resolver in lib/llm-backend-resolver.ts
  // — same env cascade every actor uses. Spawn-shape needs the raw form so it
  // can distinguish "claude" (SDK) from "claude-cli" (CLI subprocess).
  const { raw } = resolveRawBackendName();
  return {
    backend: raw ?? undefined,
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
      modelTier: parseYamlModelTier(fallback),
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

const EDIT_TOOL_PATTERN = /\b(?:Write|Edit|MultiEdit|NotebookEdit|Bash)\b/;

/**
 * Worktree-by-default: an agent with edit intent should run in its own
 * git worktree so a destructive `git reset --hard` / `git add -A` /
 * `git checkout -- .` in one slice cannot reach into another slice's
 * mid-flight edits. Edit intent is inferred from `allowedTools` (Write,
 * Edit, MultiEdit, Bash, NotebookEdit) or — conservatively — from the
 * absence of any allowedTools restriction at all.
 *
 * Operators can override per-agent via `worktree: false` or globally via
 * `fleet.defaults.worktree: false`. Pure-read agents (e.g. `gardener`
 * with `prompt: "git status --porcelain"` and no allowedTools) keep the
 * historical default of running in the shared tree.
 */
function inferWorktreeDefault(s: FleetYamlAgent): boolean {
  const allowed = (s.allowedTools || s.allowed_tools || '').trim();
  if (!allowed) {
    // Inferred edit intent for cron-only / trigger-only LLM agents that
    // ship without an allowedTools restriction. These default to a
    // worktree because they will probably write something.
    return Boolean(s.backend) && s.backend !== 'custom';
  }
  return EDIT_TOOL_PATTERN.test(allowed);
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

  const baseVars = getTemplateVars(projectDir);
  const initialParsed = parseFleetYaml(raw);
  const initialFleet = initialParsed ? (initialParsed.fleet || initialParsed) : null;
  const rawFleetName = initialFleet && typeof initialFleet.name === 'string'
    ? resolveTemplates(initialFleet.name, baseVars).trim()
    : '';
  const vars = getTemplateVars(projectDir, rawFleetName || undefined);
  const resolved = resolveTemplates(raw, vars);
  const parsed = parseFleetYaml(resolved);
  if (!parsed) return null;

  const fleet = parsed.fleet || parsed;
  const fleetDefaults = (parsed.fleet?.defaults ?? parsed.defaults) || {};

  // Resolve the worktree default once per agent, honoring three layers:
  // explicit per-agent `worktree:` -> fleet `defaults.worktree:` ->
  // inferred from edit intent (default: true for edit-capable agents).
  const resolveWorktree = (s: FleetYamlAgent): boolean => {
    if (typeof s.worktree === 'boolean') return s.worktree;
    if (typeof fleetDefaults.worktree === 'boolean') return fleetDefaults.worktree;
    return inferWorktreeDefault(s);
  };

  // Normalize agents (supports both object and array format)
  const agents: FleetAgent[] = [];
  const rawAgents = fleet.agents;
  const addAgent = (name: string, s: FleetYamlAgent): void => {
      const agentBackend = cleanEnvValue(s.backend) || cleanEnvValue(fleetDefaults.backend);
      const defaultsApplyToBackend = !s.backend || !fleetDefaults.backend || cleanEnvValue(s.backend) === cleanEnvValue(fleetDefaults.backend);
      const agentModel = cleanEnvValue(s.model) || (defaultsApplyToBackend ? cleanEnvValue(fleetDefaults.model) : undefined);
      const agentModelTier = parseYamlModelTier(s) || (defaultsApplyToBackend ? parseYamlModelTier(fleetDefaults) : undefined);
      const runtime = resolveFleetAgentRuntime({
        backend: agentBackend,
        model: agentModel,
        modelTier: agentModelTier,
      } as Pick<FleetAgent, 'backend' | 'model' | 'modelTier'>);
      agents.push({
        name,
        schedule: s.schedule,
        trigger: s.trigger,
        triggerTuple: Array.isArray(s.trigger_tuple) ? s.trigger_tuple : undefined,
        backend: runtime.backend || '',
        model: runtime.model,
        modelTier: runtime.modelTier,
        prompt: typeof s.prompt === 'string' ? s.prompt.trim() : String(s.prompt || ''),
        worktree: resolveWorktree(s),
        singleton: s.singleton || false,
        respawn: s.respawn || false,
        maxRespawns: s.max_respawns ?? 3,
        onSuccess: s.on_success,
        onFailure: s.on_failure,
        identity: s.identity,
      timeout: s.timeout,
      allowedTools: s.allowedTools || s.allowed_tools,
      fallbacks: parseFallbacks(s.fallbacks),
      cooldownMs: normalizePositiveMs(s.cooldown_ms),
      dedupeWindowMs: normalizePositiveMs(s.dedupe_window_ms),
      backoffBaseMs: normalizePositiveMs(s.backoff_base_ms),
      backoffMaxMs: normalizePositiveMs(s.backoff_max_ms),
      backoffMultiplier: normalizeBackoffMultiplier(s.backoff_multiplier),
      });
  };
  if (rawAgents && typeof rawAgents === 'object' && !Array.isArray(rawAgents)) {
    for (const [name, s] of Object.entries(rawAgents)) {
      addAgent(name, s);
    }
  } else if (Array.isArray(rawAgents)) {
    rawAgents.forEach((s, index) => {
      const derivedName = deriveFleetAgentName({
        name: cleanEnvValue(s.name),
        identity: cleanEnvValue(s.identity),
        prompt: typeof s.prompt === 'string' ? s.prompt : undefined,
        backend: cleanEnvValue(s.backend),
        index,
      });
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
        externalProducer: s.external_producer ?? s.externalProducer,
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
  for (const [channel, metadata] of Object.entries(config.channels)) {
    if (!producerOf.has(channel) && !metadata.externalProducer && !['git:committed'].includes(channel)) {
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
  type: 'agent_started' | 'agent_completed' | 'agent_failed' | 'agent_paused' | 'agent_resumed' | 'watcher_started' | 'watcher_triggered' | 'fleet_started' | 'fleet_stopped';
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
  initiallyPausedAgents?: string[];
  tuplePollMs?: number;
  tuples?: Pick<TupleSpace, 'out' | 'take' | 'count' | 'poll' | 'subscribe'>;
  semanticResolver?: Pick<SemanticResolver, 'observeAliases'>;
  messaging?: {
    subscribe(channel: string, callback: (message: unknown) => void): (() => void) | null;
  };
  /**
   * Daemon-wide concurrency permit. Called AFTER the per-runner `canSpawn`
   * quota check passes but BEFORE the spawner runs. Returns a release
   * function that the runner MUST call exactly once when the spawn finishes
   * (success or failure). When omitted, the runner enforces only its own
   * per-fleet cap — fine for tests, but the daemon always injects this so
   * project-wide limits hold across multiple runners. Spec:
   * docs/shipwright/FLEETCONTROL-HARDENING.md §5.
   */
  acquirePermit?: () => Promise<() => void>;
}

export function createFleetRunner(config: FleetConfig, projectDir: string, options?: FleetRunnerOptions) {
  const running = new Map<string, RunningAgent>();
  const emit = options?.onEvent ?? (() => {});
  const project = config.name;
  const agentIndex = new Map(config.agents.map(agent => [agent.name, agent]));
  const pausedAgents = new Set((options?.initiallyPausedAgents ?? []).filter((name) => agentIndex.has(name)));
  const tupleHarbor = config.harbor || `${project}:fleet`;
  const FLEET_TUPLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function resolveChannel(channel: string): string {
    return resolveFleetChannel(channel, projectDir, project);
  }

  function queueDepthFor(agentName: string): number {
    if (!options?.tuples) return stateFor(agentName).pendingContext ? 1 : 0;
    return options.tuples.count(['fleet:mailbox', agentName], tupleHarbor);
  }

  function writeTupleMailbox(agent: FleetAgent, context: FleetRunContext): void {
    if (!options?.tuples) return;
    options.tuples.out([
      'fleet:mailbox',
      agent.name,
      context.source || 'manual',
      {
        channel: context.channel ?? null,
        from: context.from ?? null,
        message: context.message ?? null,
        messageContent: context.messageContent ?? null,
        tuple: context.tuple ? {
          id: context.tuple.id,
          harbor: context.tuple.harbor,
          fields: context.tuple.fields,
          writtenBy: context.tuple.writtenBy,
          createdAt: context.tuple.createdAt,
          expiresAt: context.tuple.expiresAt,
        } : null,
        tuplePattern: context.tuplePattern ?? null,
        tupleHarbor: context.tupleHarbor ?? context.tuple?.harbor ?? null,
        timestamp: Date.now(),
      },
    ], {
      harbor: tupleHarbor,
      writtenBy: context.from ?? agent.identity ?? `${project}:fleet:${agent.name}`,
      ttlMs: FLEET_TUPLE_TTL_MS,
    });
  }

  function contextFromMailboxTuple(tuple: Tuple): FleetRunContext {
    const payload = (tuple.fields[3] && typeof tuple.fields[3] === 'object')
      ? tuple.fields[3] as Record<string, unknown>
      : {};
    const tuplePayload = (payload.tuple && typeof payload.tuple === 'object')
      ? payload.tuple as Record<string, unknown>
      : null;
    return {
      source: (typeof tuple.fields[2] === 'string' ? tuple.fields[2] : 'tuple') as FleetRunContext['source'],
      channel: typeof payload.channel === 'string' ? payload.channel : undefined,
      from: typeof payload.from === 'string' ? payload.from : null,
      message: payload.message,
      messageContent: typeof payload.messageContent === 'string' ? payload.messageContent : undefined,
      tuple: tuplePayload ? {
        id: typeof tuplePayload.id === 'number' ? tuplePayload.id : 0,
        harbor: typeof tuplePayload.harbor === 'string' ? tuplePayload.harbor : null,
        fields: Array.isArray(tuplePayload.fields) ? tuplePayload.fields : [],
        writtenBy: typeof tuplePayload.writtenBy === 'string' ? tuplePayload.writtenBy : null,
        createdAt: typeof tuplePayload.createdAt === 'number' ? tuplePayload.createdAt : tuple.createdAt,
        expiresAt: typeof tuplePayload.expiresAt === 'number' ? tuplePayload.expiresAt : null,
      } : undefined,
      tuplePattern: Array.isArray(payload.tuplePattern) ? payload.tuplePattern : undefined,
      tupleHarbor: typeof payload.tupleHarbor === 'string' ? payload.tupleHarbor : null,
    };
  }

  function contextFromTriggerTuple(pattern: unknown[], tuple: Tuple): FleetRunContext {
    const message = {
      tupleId: tuple.id,
      harbor: tuple.harbor,
      fields: tuple.fields,
      writtenBy: tuple.writtenBy,
      createdAt: tuple.createdAt,
      expiresAt: tuple.expiresAt,
      pattern,
    };
    return {
      source: 'tuple' as FleetRunContext['source'],
      from: tuple.writtenBy,
      message,
      messageContent: trimMessage(serializeMessage(message)),
      tuple,
      tuplePattern: pattern,
      tupleHarbor: tuple.harbor,
    };
  }

  function takeQueuedTupleContext(agent: FleetAgent): FleetRunContext | null {
    if (!options?.tuples) return null;
    const taken = options.tuples.take(['fleet:mailbox', agent.name], { harbor: tupleHarbor, limit: 1 });
    return taken[0] ? contextFromMailboxTuple(taken[0]) : null;
  }

  /**
   * Collect deterministic lexical aliases for one fleet task execution.
   */
  function semanticAliasesForTask(task: string, context?: FleetRunContext): SemanticAlias[] {
    return collectSemanticAliases([task, context?.messageContent]);
  }

  /**
   * Emit tuple aliases so other fleet participants can do cheap lexical joins.
   */
  function emitSemanticAliasTuples(agent: FleetAgent, task: string, context?: FleetRunContext): void {
    if (!options?.tuples) return;
    for (const alias of semanticAliasesForTask(task, context)) {
      options.tuples.out([
        'semantic:alias',
        'fleet',
        alias.raw,
        alias.canonical,
        {
          agent: agent.name,
          source: context?.source ?? 'manual',
          fingerprint: alias.fingerprint,
          tokens: alias.tokens,
        },
      ], {
        harbor: tupleHarbor,
        writtenBy: agent.identity ?? `${project}:fleet:${agent.name}`,
        ttlMs: FLEET_TUPLE_TTL_MS,
      });
    }
  }

  /**
   * Forward fleet task aliases to the embedding-based semantic resolver.
   */
  function observeSemanticAliases(agent: FleetAgent, task: string, context: FleetRunContext | undefined, runStartedAt: number): void {
    if (!options?.semanticResolver) return;
    options.semanticResolver.observeAliases({
      projectDir,
      harbor: tupleHarbor,
      sourceType: 'fleet_agent_task',
      sourceId: `${project}:${agent.name}:${runStartedAt}`,
      agentId: agent.identity ?? `${project}:fleet:${agent.name}`,
      aliases: semanticAliasesForTask(task, context),
    });
  }

  // ─── Resource quota enforcement (Ostrom Principle 2) ────────────────────
  let activeSpawns = 0;
  const activeAgentRuns = new Set<string>();
  const spawnTimestamps: number[] = [];  // rolling window for per-hour rate limit
  const activationState = new Map<string, AgentActivationState>();

  function stateFor(agentName: string): AgentActivationState {
    let state = activationState.get(agentName);
    if (!state) {
      state = { consecutiveFailures: 0 };
      activationState.set(agentName, state);
    }
    return state;
  }

  function formatDurationMs(durationMs: number): string {
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${Math.ceil(durationMs / 1000)}s`;
    return `${Math.ceil(durationMs / 60000)}m`;
  }

  function stopRunningRecord(name: string): void {
    const record = running.get(name);
    if (!record) return;
    if (record.interval) clearInterval(record.interval);
    if (record.tuplePollInterval) clearInterval(record.tuplePollInterval);
    if (record.watchHandle) {
      try { record.watchHandle(); } catch { /* ignore unsubscribe failures */ }
      record.watchHandle = undefined;
    }
    if (record.childProcesses) {
      for (const child of record.childProcesses) {
        if (!child.killed) {
          try { child.kill('SIGTERM'); } catch { /* already dead */ }
        }
      }
      record.childProcesses.clear();
    }
    if (record.process) {
      const pid = record.process.pid;
      if (pid) {
        try { process.kill(-pid, 'SIGTERM'); } catch {
          try { record.process.kill('SIGTERM'); } catch { /* already dead */ }
        }
      } else {
        try { record.process.kill('SIGTERM'); } catch { /* already dead */ }
      }
    }
    running.delete(name);
  }

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
    if (pausedAgents.has(agent.name)) return;
    if (running.has(agent.name)) return; // already running

    const record: RunningAgent = {
      name: agent.name,
      type: agent.schedule ? 'scheduled' : (agent.trigger || agent.triggerTuple) ? 'triggered' : 'manual',
      startedAt: Date.now(),
    };
    const cleanupHandles: Array<() => void> = [];

    if (agent.schedule) {
      // Scheduled agent: run immediately, then on interval
      // Convert cron to ms (simplified: support */N * * * * format)
      const intervalMs = parseCronInterval(agent.schedule);
      void requestAgentRun(agent, { source: 'schedule' });
      record.interval = setInterval(() => { void requestAgentRun(agent, { source: 'schedule' }); }, intervalMs);
    }

    if (agent.trigger) {
      const physicalTriggerChannel = resolveChannel(agent.trigger);
      // Prefer in-process subscriptions so trigger payload survives into the spawned task.
      const unsubscribe = options?.messaging?.subscribe(physicalTriggerChannel, (message: unknown) => {
        void requestAgentRun(agent, contextFromMessage(agent.trigger!, message));
      });

      if (unsubscribe) {
        cleanupHandles.push(unsubscribe);
      } else {
        // Fallback for standalone CLI/testing contexts.
        const invocation = resolvePortDaddyInvocation();
        const watchProc = spawn(invocation.command, [
          ...invocation.args,
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

    if (options?.tuples) {
      const tuplePollMs = Math.min(Math.max(options.tuplePollMs ?? 1000, 250), 60000);
      let tupleCursor = 0;

      if (agent.triggerTuple && options.tuples.subscribe) {
        const unsubscribe = options.tuples.subscribe(
          agent.triggerTuple,
          { harbor: tupleHarbor },
          (tuple) => {
            void requestAgentRun(agent, contextFromTriggerTuple(agent.triggerTuple!, tuple));
          },
        );
        if (unsubscribe) cleanupHandles.push(unsubscribe);
      }

      record.tuplePollInterval = setInterval(() => {
        if (agent.triggerTuple && (!options.tuples?.subscribe) && options.tuples?.poll) {
          const result = options.tuples.poll(agent.triggerTuple, {
            harbor: tupleHarbor,
            afterId: tupleCursor,
          });
          tupleCursor = result.lastId;
          if (result.tuple) {
            void requestAgentRun(agent, contextFromTriggerTuple(agent.triggerTuple, result.tuple));
          }
        }

        if (pausedAgents.has(agent.name) || activeAgentRuns.has(agent.name)) return;
        if (queueDepthFor(agent.name) === 0) return;
        const tupleContext = takeQueuedTupleContext(agent);
        if (tupleContext) void runAgentOnce(agent, tupleContext);
      }, tuplePollMs);
      record.tuplePollInterval.unref?.();
    }

    if (cleanupHandles.length > 0) {
      record.watchHandle = () => {
        for (const cleanup of cleanupHandles) {
          try {
            cleanup();
          } catch {
            // Best-effort cleanup only.
          }
        }
      };
    }

    if (!agent.schedule && !agent.trigger && !agent.triggerTuple) {
      void requestAgentRun(agent, { source: 'manual' });
    }

    running.set(agent.name, record);
  }

  function startWatcher(watcher: FleetWatcher): void {
    if (running.has(watcher.name)) return;
    const physicalTriggerChannel = resolveChannel(watcher.trigger);

    const unsubscribe = options?.messaging?.subscribe(physicalTriggerChannel, (message: unknown) => {
      triggerWatcherExec(watcher, physicalTriggerChannel, message);
    });

    if (unsubscribe) {
      running.set(watcher.name, {
        name: watcher.name,
        type: 'watcher',
        childProcesses: new Set(),
        watchHandle: unsubscribe,
        startedAt: Date.now(),
      });
      emit({
        type: 'watcher_started', agent: watcher.name, project,
        identity: `${project}:fleet:${watcher.name}`,
        timestamp: Date.now(), details: { trigger: watcher.trigger, physicalTrigger: physicalTriggerChannel, mode: 'in-process' },
      });
      return;
    }

    const invocation = resolvePortDaddyInvocation();
    const watchProc = spawn(invocation.command, [
      ...invocation.args,
      'watch', physicalTriggerChannel,
      '--exec', watcher.exec,
    ], {
      cwd: projectDir,
      env: { ...process.env, PD_URL: getFleetDaemonUrl() },
      stdio: 'ignore',
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
      timestamp: Date.now(), details: { trigger: watcher.trigger, physicalTrigger: physicalTriggerChannel, mode: 'external-pd-watch' },
    });
  }

  /**
   * Execute a YAML watcher command from the daemon-owned subscription path.
   *
   * Sample input:
   *
   * ```ts
   * triggerWatcherExec(
   *   { name: 'notify', trigger: 'qa:findings', exec: 'say "$PD_MESSAGE_CONTENT"' },
   *   'project:port-daddy-dev:abc:qa:findings',
   *   { payload: 'QA found issues' }
   * )
   * ```
   *
   * Sample output:
   *
   * ```json
   * {
   *   "type": "watcher_triggered",
   *   "agent": "notify",
   *   "details": { "physicalTrigger": "project:port-daddy-dev:abc:qa:findings" }
   * }
   * ```
   */
  function triggerWatcherExec(watcher: FleetWatcher, physicalTriggerChannel: string, message: unknown): void {
    const record = running.get(watcher.name);
    if (!record) return;

    const children = record.childProcesses ?? new Set<ChildProcess>();
    record.childProcesses = children;
    if (children.size >= 3) {
      console.error(`[Fleet] Watcher ${watcher.name} concurrency limit reached; dropping message`);
      return;
    }

    const dataStr = serializeMessage(message);
    const context = contextFromMessage(watcher.trigger, message);
    const messageContent = context.messageContent ?? dataStr;
    const child = spawn('/bin/sh', ['-c', watcher.exec], {
      cwd: projectDir,
      shell: false,
      stdio: 'ignore',
      env: {
        ...process.env,
        PD_MESSAGE: dataStr,
        PD_MESSAGE_CONTENT: messageContent,
        PD_CHANNEL: physicalTriggerChannel,
        PD_TIMESTAMP: new Date().toISOString(),
      },
    });

    children.add(child);
    const timer = setTimeout(() => {
      if (!child.killed) {
        try { child.kill('SIGTERM'); } catch { /* already dead */ }
      }
    }, 30_000);
    timer.unref?.();

    child.on('error', (err) => {
      console.error(`[Fleet] Watcher ${watcher.name} exec error:`, err.message);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      children.delete(child);
    });

    emit({
      type: 'watcher_triggered',
      agent: watcher.name,
      project,
      identity: `${project}:fleet:${watcher.name}`,
      timestamp: Date.now(),
      details: {
        trigger: watcher.trigger,
        physicalTrigger: physicalTriggerChannel,
        childPid: child.pid,
      },
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
    idempotencyKey: string,
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
      name: agent.name,
      idempotencyKey,
    };
    if (runtime.model) body.model = runtime.model;
    if (agent.timeout) body.timeout = agent.timeout;
    if (agent.allowedTools) body.allowedTools = agent.allowedTools;

    let res: Response;
    try {
      res = await fetch(`${getFleetDaemonUrl()}/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
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

  function hashTriggerContext(context?: FleetRunContext): string | null {
    if (!context || (context.source !== 'trigger' && context.source !== 'tuple')) return null;
    const messageText = (context.messageContent ?? serializeMessage(context.message)).trim();
    if (!messageText && !context.tuple) return null;

    return createHash('sha1')
      .update(JSON.stringify({
        source: context.source ?? null,
        channel: context.channel ?? null,
        from: context.from ?? null,
        message: messageText,
        tuplePattern: context.tuplePattern ?? null,
        tupleHarbor: context.tupleHarbor ?? null,
        tupleId: context.tuple?.id ?? null,
      }))
      .digest('hex');
  }

  function fleetSpawnIdempotencyKey(
    agent: FleetAgent,
    runtime: ResolvedFleetAgentRuntime,
    identity: string,
    context: FleetRunContext | undefined,
    triggerFingerprint: string | null,
    runStartedAt: number,
    attempt: number,
  ): string {
    const runWindow = triggerFingerprint || Math.floor(runStartedAt / 60000);
    return createHash('sha256')
      .update(JSON.stringify({
        v: 1,
        projectDir,
        project,
        agent: agent.name,
        identity,
        source: context?.source ?? 'manual',
        runWindow,
        backend: runtime.backend,
        model: runtime.model ?? null,
        modelTier: runtime.modelTier ?? null,
        attempt,
      }))
      .digest('hex')
      .slice(0, 32);
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
      context.tupleHarbor ? `- tuple harbor: ${context.tupleHarbor}` : null,
      context.tuplePattern ? `- tuple pattern: ${JSON.stringify(context.tuplePattern)}` : null,
      context.tuple ? `- tuple id: ${context.tuple.id}` : null,
      '- message:',
      messageText,
      '',
      'Take one bounded pass in response to this trigger. Use only your configured channels and stop after this pass.',
    ].filter((line): line is string => !!line);

    return lines.join('\n');
  }

  function mergePendingContext(existing: FleetRunContext | undefined, incoming: FleetRunContext): FleetRunContext {
    if (!existing) return incoming;
    if (incoming.source !== 'trigger' && incoming.source !== 'tuple') return incoming;

    const mergedMessage = [existing.messageContent, incoming.messageContent]
      .filter((value): value is string => !!value && value.trim().length > 0)
      .slice(-2)
      .join('\n\n---\n\n');

    return {
      source: incoming.source,
      channel: incoming.channel ?? existing.channel,
      from: incoming.from ?? existing.from,
      message: incoming.message ?? existing.message,
      messageContent: mergedMessage || incoming.messageContent || existing.messageContent,
      tuple: incoming.tuple ?? existing.tuple,
      tuplePattern: incoming.tuplePattern ?? existing.tuplePattern,
      tupleHarbor: incoming.tupleHarbor ?? existing.tupleHarbor,
    };
  }

  async function requestAgentRun(agent: FleetAgent, context?: FleetRunContext): Promise<{ success: boolean; error?: string; queued?: boolean }> {
    if (pausedAgents.has(agent.name)) {
      return { success: false, error: `${agent.name} is paused` };
    }

    const state = stateFor(agent.name);
    const hasPending = options?.tuples ? queueDepthFor(agent.name) > 0 : !!state.pendingContext;
    const shouldUseTupleMailbox = !!options?.tuples && !!context;

    if (shouldUseTupleMailbox) {
      writeTupleMailbox(agent, context);
    }

    if (activeAgentRuns.has(agent.name) || hasPending) {
      if (!options?.tuples) {
        state.pendingContext = mergePendingContext(state.pendingContext, context ?? { source: 'manual' });
      }
      return { success: true, queued: true };
    }

    if (shouldUseTupleMailbox) {
      const tupleContext = takeQueuedTupleContext(agent);
      if (tupleContext) return runAgentOnce(agent, tupleContext);
    }

    return runAgentOnce(agent, context);
  }

  async function runAgentOnce(agent: FleetAgent, context?: FleetRunContext): Promise<{ success: boolean; error?: string }> {
    const identity = agent.identity || `${project}:fleet:${agent.name}`;
    const attempts = buildRuntimeAttempts(agent);
    const primaryRuntime = attempts[0];
    const now = Date.now();
    const agentState = stateFor(agent.name);
    const triggerFingerprint = hashTriggerContext(context);

    if (agent.singleton && activeAgentRuns.has(agent.name)) {
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: Date.now(), details: { error: 'singleton already active' },
      });
      return { success: false, error: 'singleton already active' };
    }

    if (agentState.backoffUntil && now < agentState.backoffUntil) {
      const error = `backoff active for ${formatDurationMs(agentState.backoffUntil - now)}`;
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: now, details: { error, backoffUntil: agentState.backoffUntil },
      });
      return { success: false, error };
    }

    if (agent.cooldownMs && agentState.lastStartedAt && (now - agentState.lastStartedAt) < agent.cooldownMs) {
      const error = `cooldown active for ${formatDurationMs(agent.cooldownMs - (now - agentState.lastStartedAt))}`;
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: now, details: { error, cooldownMs: agent.cooldownMs },
      });
      return { success: false, error };
    }

    if (
      triggerFingerprint
      && agent.dedupeWindowMs
      && agentState.lastTriggerFingerprint === triggerFingerprint
      && agentState.lastTriggerAt
      && (now - agentState.lastTriggerAt) < agent.dedupeWindowMs
    ) {
      const error = `duplicate trigger suppressed for ${formatDurationMs(agent.dedupeWindowMs - (now - agentState.lastTriggerAt))}`;
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: now, details: { error, dedupeWindowMs: agent.dedupeWindowMs },
      });
      return { success: false, error };
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

    agentState.lastStartedAt = now;
    if (triggerFingerprint) {
      agentState.lastTriggerFingerprint = triggerFingerprint;
      agentState.lastTriggerAt = now;
    }

    // Daemon-wide concurrency permit. The per-runner `canSpawn()` quota check
    // above guards this fleet alone; the permit guards every fleet sharing a
    // project. Acquired AFTER all cheap rejections so we never park a waiter
    // for a spawn that would have been refused anyway. If acquisition itself
    // throws (e.g. registry was drained mid-shutdown), surface as a normal
    // agent_failed event — same shape as every other admission failure.
    let releasePermit: (() => void) | null = null;
    if (options?.acquirePermit) {
      try {
        releasePermit = await options.acquirePermit();
      } catch (err) {
        const reason = (err as Error).message || 'permit-acquire-failed';
        emit({
          type: 'agent_failed', agent: agent.name, identity, project,
          timestamp: Date.now(), details: { error: `quota: ${reason}` },
        });
        return { success: false, error: `quota: ${reason}` };
      }
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
      emitSemanticAliasTuples(agent, task, context);
      observeSemanticAliases(agent, task, context, now);

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
          fleetSpawnIdempotencyKey(agent, runtime, identity, context, triggerFingerprint, now, i + 1),
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
          agentState.consecutiveFailures = 0;
          agentState.backoffUntil = undefined;
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
      if (agent.backoffBaseMs) {
        agentState.consecutiveFailures += 1;
        const multiplier = agent.backoffMultiplier ?? 2;
        const baseDelay = agent.backoffBaseMs * Math.pow(multiplier, Math.max(0, agentState.consecutiveFailures - 1));
        const cappedDelay = Math.min(baseDelay, agent.backoffMaxMs ?? baseDelay);
        agentState.backoffUntil = Date.now() + cappedDelay;
      }
      return { success: false, error: errorMessage };
    } catch (err) {
      const message = (err as Error).message;
      emit({
        type: 'agent_failed', agent: agent.name, identity, project,
        timestamp: Date.now(), details: { error: message },
      });
      console.error(`[Fleet] Agent ${agent.name} error:`, message);
      if (agent.backoffBaseMs) {
        agentState.consecutiveFailures += 1;
        const multiplier = agent.backoffMultiplier ?? 2;
        const baseDelay = agent.backoffBaseMs * Math.pow(multiplier, Math.max(0, agentState.consecutiveFailures - 1));
        const cappedDelay = Math.min(baseDelay, agent.backoffMaxMs ?? baseDelay);
        agentState.backoffUntil = Date.now() + cappedDelay;
      }
      return { success: false, error: message };
    } finally {
      activeSpawns = Math.max(0, activeSpawns - 1);
      activeAgentRuns.delete(agent.name);
      // Release the daemon-wide permit BEFORE we re-enqueue any pending
      // context. If we held the permit while requeuing, a saturated semaphore
      // could deadlock the same agent against itself: it would await its own
      // released slot. Releasing first lets the FIFO advance one waiter.
      if (releasePermit) {
        try { releasePermit(); } catch { /* idempotent — second release is a no-op */ }
        releasePermit = null;
      }
      const pending = agentState.pendingContext;
      agentState.pendingContext = undefined;
      if (pending && !pausedAgents.has(agent.name)) {
        void requestAgentRun(agent, pending);
      }
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

    const args = [
      'spawn', '--backend', runtime.backend,
      '--identity', identity,
    ];
    if (runtime.model) args.push('--model', runtime.model);
    if (agent.allowedTools) args.push('--allowedTools', agent.allowedTools);
    args.push('-q', '--', agent.prompt);
    return buildPortDaddyShellCommand(args);
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
          scope: project,
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
    for (const name of [...running.keys()]) {
      stopRunningRecord(name);
    }
    emit({ type: 'fleet_stopped', project, timestamp: Date.now() });
  }

  function getStatus(): Array<{ name: string; type: string; status: string; running: boolean; paused: boolean; uptime: number; queueDepth: number }> {
    return config.agents.map((agent) => {
      const record = running.get(agent.name);
      const activeRun = activeAgentRuns.has(agent.name);
      const paused = pausedAgents.has(agent.name);
      const queueDepth = queueDepthFor(agent.name);
      let status = 'idle';
      if (activeRun) {
        status = 'running';
      } else if (queueDepth > 0) {
        status = 'queued';
      } else if (paused) {
        status = 'paused';
      } else if (record) {
        status = agent.schedule ? 'scheduled' : (agent.trigger || agent.triggerTuple) ? 'armed' : 'idle';
      }
      return {
        name: agent.name,
        type: agent.schedule ? 'scheduled' : (agent.trigger || agent.triggerTuple) ? 'triggered' : 'manual',
        status,
        running: activeRun,
        paused,
        uptime: record ? Date.now() - record.startedAt : 0,
        queueDepth,
      };
    });
  }

  async function hailAgent(agentName: string, context?: FleetRunContext): Promise<{ success: boolean; error?: string }> {
    const agent = agentIndex.get(agentName);
    if (!agent) {
      return { success: false, error: `No agent named ${agentName}` };
    }
    if (agent.singleton && activeAgentRuns.has(agentName)) {
      return { success: false, error: `${agentName} is singleton and already active` };
    }

    return requestAgentRun(agent, context ?? { source: 'manual' });
  }

  function pauseAgent(agentName: string): { success: boolean; error?: string } {
    const agent = agentIndex.get(agentName);
    if (!agent) return { success: false, error: `No agent named ${agentName}` };
    pausedAgents.add(agentName);
    stopRunningRecord(agentName);
    emit({
      type: 'agent_paused',
      agent: agent.name,
      identity: agent.identity || `${project}:fleet:${agent.name}`,
      project,
      timestamp: Date.now(),
      details: { info: 'paused by operator' },
    });
    return { success: true };
  }

  function resumeAgent(agentName: string): { success: boolean; error?: string } {
    const agent = agentIndex.get(agentName);
    if (!agent) return { success: false, error: `No agent named ${agentName}` };
    pausedAgents.delete(agentName);
    startAgent(agent);
    emit({
      type: 'agent_resumed',
      agent: agent.name,
      identity: agent.identity || `${project}:fleet:${agent.name}`,
      project,
      timestamp: Date.now(),
      details: { info: 'resumed by operator' },
    });
    return { success: true };
  }

  function setEnabledAgents(agentNames?: string[]): { success: boolean; error?: string } {
    const desired = new Set(agentNames ?? config.agents.map((agent) => agent.name));
    for (const name of desired) {
      if (!agentIndex.has(name)) return { success: false, error: `No agent named ${name}` };
    }
    for (const agent of config.agents) {
      if (desired.has(agent.name)) {
        pausedAgents.delete(agent.name);
        startAgent(agent);
      } else {
        pausedAgents.add(agent.name);
        stopRunningRecord(agent.name);
      }
    }
    return { success: true };
  }

  return { startAll, stopAll, startAgent, getStatus, hailAgent, pauseAgent, resumeAgent, setEnabledAgents, config };
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
