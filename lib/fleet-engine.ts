/**
 * Fleet Engine — Declarative fleet management from pd-fleet.yml
 *
 * Reads pd-fleet.yml, resolves template variables, and manages
 * agent lifecycles via pd spawn and pd watch.
 *
 * Design: ADR-0019 (Declarative Fleet Configuration)
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { parse as parseYaml } from 'yaml';
import { parseFleetSource, astToConfig } from './fleet-ast.js';
import type { CostTracker } from './cost-tracker.js';
import { resolveFleetChannel } from './fleet-channels.js';
import { collectSemanticAliases } from './semantic-terms.js';
import type { SemanticAlias } from './semantic-terms.js';
import type { SemanticResolver } from './semantic-resolver.js';
import type { Tuple, TupleSpace } from './tuples.js';
import { getDaemonTcpUrl } from '../shared/daemon-discovery.js';
import { buildPortDaddyShellCommand, resolvePortDaddyInvocation } from './port-daddy-command.js';
import { resolveLLMBackend } from './llm-backend-resolver.js';
import { createLLMClient } from './llm-call.js';
import { transportToAdapter } from './coordination-judge.js';
import { IoDispatch, type DispatchOutputResult, type IoDispatchDeps } from './fleet/io-dispatch.js';
import { evaluateTrustGate, type TrustPolicy, type TrustTier } from './fleet/trust.js';
import { createSkillGraftIndex, renderSkillGraftContext, type SkillGraftIndex } from './skill-graft.js';
import { PD_HOME } from '../shared/paths.js';
import {
  loadWatcherPidRegistry,
  saveWatcherPidRegistry,
  sweepStaleWatcherPids,
  watcherPidKey,
  toExecSnippet,
  getCommandLineForPid,
} from './watcher-pid-registry.js';
import {
  cleanEnvValue,
  parseModelTier,
  parseYamlModelTier,
  resolveFleetAgentRuntime,
  type FleetModelTier,
  type FleetRuntimeTarget,
  type ResolvedFleetAgentRuntime,
} from './fleet-runtime.js';
export {
  BUILTIN_MODEL_TIERS,
  getFleetRuntimeDefaults,
  resolveFleetAgentRuntime,
  type FleetModelTier,
  type FleetRuntimeDefaults,
  type FleetRuntimeTarget,
  type ResolvedFleetAgentRuntime,
} from './fleet-runtime.js';

/**
 * Durable sidecar tracking external `pd watch --exec` children spawned by
 * `startWatcher()`'s fallback path (see watcher-pid-registry.ts). Overridable
 * via env for tests so they never touch the real ~/.port-daddy directory.
 */
const WATCHER_PID_FILE = process.env.PD_WATCHER_PID_FILE || join(PD_HOME, 'watcher-pids.json');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FleetAgent {
  name: string;
  schedule?: string;       // cron syntax
  runOnStart?: boolean;    // scheduled agents opt in to firing during fleet boot
  trigger?: string;        // channel name (singular sugar; also folded into `triggers`)
  /**
   * Plural trigger list (additive). Each entry is a trigger-spec string in
   * the `kind:type(filters)` grammar (e.g. `file:changed(~/notes/)`) OR a
   * legacy coordination channel name. Registry-kind specs (file/webhook/
   * email/sms/calendar) are dispatched through the pluggable trigger
   * registry; legacy/coordination kinds (pd/git/github/schedule) stay on
   * the engine's existing channel/cron path. A singular `trigger:` is
   * folded in as the first element so both shapes coexist.
   */
  triggers?: string[];
  /**
   * Output target list (additive). Each entry is an output-target string in
   * the `kind:type(arg)` grammar (e.g. `file:append(~/notes/digest.md)`,
   * `notify:os`). Dispatched through the pluggable output registry on agent
   * completion. Consent gating happens inside each sink.
   */
  outputs?: string[];
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
  /** Opt-in: splice a windags-pattern skill shortlist (lib/skill-graft.ts)
   *  into this ship's task text before it spawns. `astToConfig()` (the YAML
   *  path, i.e. every real pd-fleet.yml ship) always normalizes this to a
   *  concrete boolean, defaulting to `false`; the `?:` here only matters for
   *  hand-constructed `FleetConfig`s (e.g. tests) that omit the field
   *  entirely. Either way, falsy means existing ships are byte-for-byte
   *  unaffected. */
  skillGraft?: boolean;
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
  /** Operator-configured trust policy for the event→spawn gate (ADR-0093). */
  trust?: FleetTrustConfig;
  agents: FleetAgent[];
  watchers: FleetWatcher[];
  channels: Record<string, { description: string; consumers?: string[]; externalProducer?: string | boolean }>;
}

/**
 * Fleet-level trust policy (pd-fleet.yml `trust:` block, ADR-0093 §4).
 * `allowlistedAuthors` names content authors (email address, GH login, phone
 * number) whose VERIFIED identity upgrades an external trigger from
 * ANONYMOUS_EXTERNAL to AUTHENTICATED_EXTERNAL. The allowlist alone never
 * upgrades anyone — the trigger source must also set
 * `metadata.consent_verified` after a content-level author verification
 * (transport HMAC does not count).
 */
export interface FleetTrustConfig {
  allowlistedAuthors?: string[];
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
  run_on_start?: boolean;
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

function getTemplateVars(projectDir: string, projectName?: string, includeGitVars = true): Record<string, string> {
  const project = projectName || basename(projectDir);
  let branch = 'main';
  let sha = 'unknown';

  if (includeGitVars) {
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
      sha = execSync('git rev-parse --short HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    } catch {
      // Not a git repo or git not available — defaults are fine
    }
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

function needsGitTemplateVars(text: string): boolean {
  return /\{(?:branch|sha)\}/.test(text);
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
  if (!raw.trim()) return null;

  // Template resolution: parse name first with base vars, then re-resolve the
  // whole file with the fully-qualified fleet name so {project} etc. expand.
  const includeGitVars = needsGitTemplateVars(raw);
  const baseVars = getTemplateVars(projectDir, undefined, includeGitVars);
  const initialParsed = parseFleetYaml(raw);
  const initialFleet = initialParsed ? (initialParsed.fleet || initialParsed) : null;
  const rawFleetName = initialFleet && typeof initialFleet.name === 'string'
    ? resolveTemplates(initialFleet.name, baseVars).trim()
    : '';
  const vars    = getTemplateVars(projectDir, rawFleetName || undefined, includeGitVars);
  const resolved = resolveTemplates(raw, vars);

  // Delegate YAML walking + FleetConfig projection to fleet-ast.ts.
  const ast = parseFleetSource(resolved);
  if (!ast) return null;
  const base = astToConfig(ast);

  // Apply env-var runtime resolution (backend env fallback, tier→model mapping).
  const agents = base.agents.map(agent => {
    const rt = resolveFleetAgentRuntime({
      backend:   agent.backend || undefined,
      model:     agent.model,
      modelTier: agent.modelTier,
    } as Pick<FleetAgent, 'backend' | 'model' | 'modelTier'>);
    return { ...agent, backend: rt.backend || '', model: rt.model, modelTier: rt.modelTier };
  });

  return { ...base, name: base.name || basename(projectDir), agents };
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
  type: 'agent_started' | 'agent_completed' | 'agent_failed' | 'agent_paused' | 'agent_resumed' | 'watcher_started' | 'watcher_triggered' | 'fleet_started' | 'fleet_stopped' | 'trust_gate_refused' | 'trust_gate_queued';
  agent?: string;
  identity?: string;
  project?: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

/**
 * A spawn the trust gate held for operator approval (ADR-0093 L2). The
 * runner hands this to `options.enqueueForApproval`; the daemon wires that
 * to its HITL proposal queue. Without an injected queue the runner refuses
 * the spawn outright (fail-closed) — approval-required work is never
 * silently auto-run.
 */
export interface FleetApprovalProposal {
  /** Unique proposal id — the handle approve/reject decisions reference. */
  id: string;
  project: string;
  agent: string;
  /** The raw trigger spec string that fired (e.g. `webhook:deploy-hook`). */
  trigger: string;
  tier: TrustTier;
  reason: string;
  /** The tier's safe tool set — what the spawn would be limited to. */
  safeTools: string[];
  /** The engine run context; pass to `hailAgent(name, context)` on approval. */
  context: FleetRunContext;
  timestamp: number;
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
  /**
   * Inbound webhook receiver registration (I/O wiring Phase 2). The daemon
   * owns the HTTP surface; it injects this so `webhook:<channel>` triggers
   * can register handlers with the receiver route. Absent (tests, bare CLI
   * runners) the webhook trigger source registers into a no-op and never
   * fires — honest inertness, not an error.
   */
  registerWebhookHandler?: IoDispatchDeps['registerWebhookHandler'];
  /**
   * L2 approval seam (ADR-0093). Called when the trust gate demands operator
   * approval for a trigger-fired spawn (any external provenance). The daemon
   * wires this to its HITL proposal queue. When absent the runner REFUSES
   * the spawn (fail-closed) and emits `trust_gate_refused` — it never runs
   * approval-required work unattended.
   */
  enqueueForApproval?: (proposal: FleetApprovalProposal) => void | Promise<void>;
  /**
   * Native, local skill-injection index (lib/skill-graft.ts) for ships that
   * set `skill_graft: true`. When omitted, the runner lazily constructs a
   * real one (real local MiniLM embedder + this repo's skills/ directory,
   * BM25 + Tool2Vec hybrid ranking — see that module for why it's not just
   * cosine-vs-description) the first time an opted-in agent actually
   * spawns — so a fleet with no opted-in ships never pays for it. Tests
   * inject a narrow fake here to avoid the real embedder and filesystem scan.
   */
  skillGraft?: Pick<SkillGraftIndex, 'craft'>;
  /**
   * Hard latency bound (ms) on the advisory skill-graft enrichment that runs
   * on the live spawn path. If `craft()` hasn't produced context within this
   * budget, the ship spawns on the un-grafted task (fail-open). Defaults to
   * {@link DEFAULT_SKILL_GRAFT_SPAWN_BUDGET_MS}; tests override it to prove the
   * bound without waiting seconds.
   */
  skillGraftBudgetMs?: number;
}

/**
 * Default ceiling for how long the first skill-graft `craft()` on a live spawn
 * path may take before we give up and spawn without enrichment. The first call
 * in a process pays a one-time cost — a full skills/ catalog scan, plus a local
 * MiniLM model load/download when the semantic tier is configured — and this
 * enrichment is strictly advisory, so it must never hold a spawn hostage.
 */
const DEFAULT_SKILL_GRAFT_SPAWN_BUDGET_MS = 8_000;

/** Unambiguous race sentinel: the skill-graft budget elapsed before craft(). */
const SKILL_GRAFT_TIMED_OUT: unique symbol = Symbol('skill-graft-timeout');

export function createFleetRunner(config: FleetConfig, projectDir: string, options?: FleetRunnerOptions) {
  const running = new Map<string, RunningAgent>();
  // Lifecycle guard for async I/O-registry trigger starts. `startAgent` kicks
  // off `ioDispatch.startTrigger(...)` which resolves asynchronously; without
  // tracking, a resolution that lands after the runner is stopped would (a)
  // leak an open watcher and (b) log via console.error after the surrounding
  // context (e.g. a jest test) has torn down. We track every in-flight start
  // promise so the runner can await them, and flip `stopped` so late
  // resolutions self-suppress.
  let stopped = false;
  const pendingTriggerStarts = new Set<Promise<void>>();
  const emit = options?.onEvent ?? (() => {});
  const project = config.name;
  const agentIndex = new Map(config.agents.map(agent => [agent.name, agent]));
  const pausedAgents = new Set((options?.initiallyPausedAgents ?? []).filter((name) => agentIndex.has(name)));
  const tupleHarbor = config.harbor || `${project}:fleet`;
  const FLEET_TUPLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  // ─── Skill Graft (opt-in per-ship context injection) ─────────────────────
  // Only ever constructed if some agent actually sets `skill_graft: true` in
  // pd-fleet.yml AND that agent runs — a bare `createFleetRunner()` with no
  // opted-in ships never touches the embedder or the skill catalog. Tests
  // inject `options.skillGraft` directly to avoid the real embedder/fs scan.
  let skillGraftIndex: Pick<SkillGraftIndex, 'craft'> | undefined = options?.skillGraft;
  const skillGraftBudgetMs = options?.skillGraftBudgetMs ?? DEFAULT_SKILL_GRAFT_SPAWN_BUDGET_MS;
  function getSkillGraftIndex(): Pick<SkillGraftIndex, 'craft'> {
    if (!skillGraftIndex) {
      // Resolve a real request-shape LLM backend for Tool2Vec's
      // synthetic-query generation, same convention lib/coordination-judge.ts
      // uses (lib/llm-backend-resolver.ts + createLLMClient) — but
      // deliberately MORE conservative than the judge's own resolution:
      //
      // 1. Only `cloudflare`/`ollama` count as usable. `resolveLLMBackend()`
      //    still returns a non-null result for `claude`/`codex`/`custom`
      //    (a `notSupportedTransport` that always fails at call time) — if
      //    we treated that as "configured," every centroid build would
      //    silently fail, the centroidStore would exist for nothing, and
      //    craft() would misreport `semanticTier: 'hybrid'` (Copilot review
      //    finding on this fix's own diff).
      // 2. Only an EXPLICIT `PD_SKILL_GRAFT_BACKEND` pin (source ===
      //    'actor-env') counts — NOT an inherited `PD_FLEET_DEFAULT_BACKEND`.
      //    Tool2Vec centroid generation is a heavier, less-obviously-
      //    anticipated cost than the judge's per-request completions (a
      //    burst of LLM calls across the whole skill catalog the first time
      //    `refresh()` runs); an operator enabling `skill_graft: true` on a
      //    ship should opt into that cost explicitly, not inherit it from an
      //    unrelated judge/fleet-default configuration.
      //
      // When neither holds, `createSkillGraftIndex` gets no llmClient and
      // craft() gracefully degrades to BM25-only ranking (never reintroduces
      // the vocabulary-mismatch bug as a silent "fallback").
      const resolved = resolveLLMBackend({ actor: 'skill-graft' });
      const usable = resolved
        && resolved.source === 'actor-env'
        && (resolved.backend === 'cloudflare' || resolved.backend === 'ollama')
        ? resolved
        : null;
      const llmClient = usable
        ? createLLMClient({ adapter: transportToAdapter(usable.transport), model: usable.model, timeoutMs: 15_000 })
        : undefined;
      skillGraftIndex = createSkillGraftIndex({
        projectRoot: projectDir,
        llmClient,
        llmModel: usable?.model,
      });
    }
    return skillGraftIndex;
  }

  function resolveChannel(channel: string): string {
    return resolveFleetChannel(channel, projectDir, project);
  }

  // ─── I/O dispatch bridge (pluggable trigger/output registry) ─────────────
  // Wires lib/fleet/triggers/* and lib/fleet/outputs/* into the engine.
  // Phase 1 owns `file` (real, no creds) end-to-end; `webhook` is registered
  // but inert until a receiver registerHandler dep is injected (Phase 2);
  // `email`/`sms`/`calendar` resolve through the registry and are honestly
  // refused at available() until their connectors ship (ROADMAP).
  const ioDispatch = new IoDispatch({
    channelSubscribe: options?.messaging?.subscribe,
    resolveChannel,
    // schedule registry kind stays on the legacy cron path (see startAgent);
    // a no-op scheduleCron keeps the CronTriggerSource registerable for the
    // future designer/health-board surfaces without double-firing.
    scheduleCron: () => () => {},
    // Phase 2: the daemon injects its inbound receiver so webhook:<channel>
    // triggers fire for real; absent, the source registers into a no-op.
    registerWebhookHandler: options?.registerWebhookHandler,
  });

  // ─── Trust gate (ADR-0093 L1) ─────────────────────────────────────────────
  // Every registry-trigger fire passes through evaluateTrustGate BEFORE
  // requestAgentRun. The policy's author allowlist comes from the fleet
  // config's `trust:` block; it only upgrades an external event when the
  // trigger source ALSO verified the content author (consent_verified).
  const trustPolicy: TrustPolicy = {
    allowlistedAuthors: config.trust?.allowlistedAuthors ?? [],
  };

  function isGithubLegacyTrigger(raw: string): boolean {
    const trigger = raw.trim().toLowerCase();
    return trigger.startsWith('github:') || trigger.startsWith('global:github:');
  }

  function trustEventFromGithubMessage(channel: string, message: unknown): {
    source: 'github';
    type: string;
    timestamp: number;
    payload: unknown;
    metadata: { sender?: string; subject?: string; correlation_id?: string; consent_verified?: boolean };
  } {
    const envelope = (message && typeof message === 'object') ? message as Record<string, unknown> : {};
    const payload = (envelope.payload && typeof envelope.payload === 'object')
      ? envelope.payload as Record<string, unknown>
      : envelope;
    const repository = (envelope.repository && typeof envelope.repository === 'object')
      ? envelope.repository as Record<string, unknown>
      : (payload.repository && typeof payload.repository === 'object')
        ? payload.repository as Record<string, unknown>
        : null;
    const sender = typeof envelope.sender === 'string'
      ? envelope.sender
      : (payload.sender && typeof payload.sender === 'object' && typeof (payload.sender as Record<string, unknown>).login === 'string')
        ? (payload.sender as Record<string, string>).login
        : undefined;
    const pullRequest = (payload.pull_request && typeof payload.pull_request === 'object')
      ? payload.pull_request as Record<string, unknown>
      : null;
    const issue = (payload.issue && typeof payload.issue === 'object')
      ? payload.issue as Record<string, unknown>
      : null;
    const action = typeof envelope.action === 'string'
      ? envelope.action
      : typeof payload.action === 'string'
        ? payload.action
        : undefined;
    const eventType = typeof envelope.event === 'string'
      ? envelope.event
      : channel.replace(/^global:/i, '').replace(/^github:webhook:/i, '').replace(/^github:/i, '') || 'webhook';
    const correlation = typeof pullRequest?.html_url === 'string'
      ? pullRequest.html_url
      : typeof issue?.html_url === 'string'
        ? issue.html_url
        : typeof repository?.full_name === 'string'
          ? repository.full_name
          : undefined;

    return {
      source: 'github',
      type: action ? `${eventType}:${action}` : eventType,
      timestamp: Date.now(),
      payload: message,
      metadata: {
        correlation_id: correlation,
        sender,
        subject: typeof pullRequest?.title === 'string'
          ? pullRequest.title
          : typeof issue?.title === 'string'
            ? issue.title
            : undefined,
        consent_verified: envelope.__originVerified === true || payload.__originVerified === true,
      },
    };
  }

  function handleTrustGatedTrigger(agent: FleetAgent, trigger: string, event: Parameters<typeof evaluateTrustGate>[0]['event'], context: FleetRunContext): void {
    const gate = evaluateTrustGate({
      event,
      allowedTools: agent.allowedTools,
      policy: trustPolicy,
    });
    if (!gate.allowed) {
      emit({
        type: 'trust_gate_refused',
        agent: agent.name,
        project,
        timestamp: Date.now(),
        details: {
          trigger,
          tier: gate.tier,
          reason: gate.reason,
          offendingTools: gate.offendingTools,
        },
      });
      console.error(
        `[Fleet] Trust gate REFUSED trigger "${trigger}" for agent "${agent.name}" ` +
        `(tier ${gate.tier}): ${gate.reason}`,
      );
      return; // never spawn; reason only, never how-to-bypass
    }
    if (gate.requiresApproval) {
      const proposal: FleetApprovalProposal = {
        id: randomUUID(),
        project,
        agent: agent.name,
        trigger,
        tier: gate.tier,
        reason: gate.reason,
        safeTools: gate.safeTools,
        context,
        timestamp: Date.now(),
      };
      const enqueue = options?.enqueueForApproval;
      if (!enqueue) {
        // Fail closed: approval-required work is never auto-run just
        // because no approval queue happens to be wired.
        emit({
          type: 'trust_gate_refused',
          agent: agent.name,
          project,
          timestamp: Date.now(),
          details: {
            trigger,
            tier: gate.tier,
            reason: 'requires operator approval and no approval queue is wired (fail-closed)',
          },
        });
        console.error(
          `[Fleet] Trust gate REFUSED trigger "${trigger}" for agent "${agent.name}" ` +
          `(tier ${gate.tier}): requires operator approval and no approval queue is wired`,
        );
        return;
      }
      emit({
        type: 'trust_gate_queued',
        agent: agent.name,
        project,
        timestamp: Date.now(),
        details: { trigger, tier: gate.tier, safeTools: gate.safeTools },
      });
      // async wrapper so a SYNCHRONOUSLY throwing enqueue is captured
      // too — a broken queue must not crash the trigger handler.
      void (async () => enqueue(proposal))().catch((err: Error) => {
        console.error(
          `[Fleet] Approval enqueue failed for agent "${agent.name}" trigger "${trigger}":`,
          err.message,
        );
      });
      return;
    }

    void requestAgentRun(agent, context);
  }

  /** True if the agent has any event trigger (singular, plural, or tuple). */
  function agentIsTriggered(agent: FleetAgent): boolean {
    return Boolean(agent.trigger || (agent.triggers && agent.triggers.length > 0) || agent.triggerTuple);
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
      type: agent.schedule ? 'scheduled' : agentIsTriggered(agent) ? 'triggered' : 'manual',
      startedAt: Date.now(),
    };
    const cleanupHandles: Array<() => void> = [];

    if (agent.schedule) {
      // Scheduled agent: arm the interval. Fleet daemon boot must stay cheap;
      // agents that truly need a boot-time pass can opt in with run_on_start.
      // Convert cron to ms (simplified: support */N * * * * format)
      const intervalMs = parseCronInterval(agent.schedule);
      if (agent.runOnStart) {
        void requestAgentRun(agent, { source: 'schedule' });
      }
      record.interval = setInterval(() => { void requestAgentRun(agent, { source: 'schedule' }); }, intervalMs);
    }

    // Resolve the agent's trigger list. `triggers:` is the canonical plural
    // form (already folded with any singular `trigger:` in astToConfig); fall
    // back to the bare singular field for configs built without the AST.
    const triggerList = agent.triggers ?? (agent.trigger ? [agent.trigger] : []);
    const registryTriggers: string[] = [];
    const legacyTriggers: string[] = [];
    for (const raw of triggerList) {
      const classification = ioDispatch.classifyTrigger(raw);
      (classification.kind === 'registry' ? registryTriggers : legacyTriggers).push(raw);
    }

    // ── Registry-backed triggers (file/webhook/email/sms/calendar) ─────────
    // Started through the pluggable trigger registry. Honest about
    // availability: a not-ready source (e.g. email/sms/calendar stub) is
    // refused with a clear log line, never silently dropped.
    for (const raw of registryTriggers) {
      const startPromise = ioDispatch
        .startTrigger(raw, (event) => {
          // Late-firing watchers must not wake a stopped runner.
          if (stopped || !running.has(agent.name)) return;

          // ── Trust gate (ADR-0093 §4.3): classify provenance and validate
          // the ship's tools against the tier's safe set BEFORE any spawn.
          // This is the L1 boundary between an inbound event and an agent
          // holding tools — the hard dependency of every untrusted-ingress
          // phase (webhook receiver, inbound email/SMS).
          handleTrustGatedTrigger(agent, raw, event, contextFromTriggerEvent(event));
        })
        .then((result) => {
          // The runner (or this agent) may have been torn down while the
          // async start was in flight. If so, dispose any handle we got and
          // stay silent — logging here would land after the surrounding
          // context (e.g. a test) has finished ("Cannot log after tests are
          // done") and a live handle would leak.
          const aborted = stopped || !running.has(agent.name);
          if (result.started) {
            const stopHandle = result.handle;
            if (aborted) {
              void stopHandle.stop();
            } else {
              cleanupHandles.push(() => { void stopHandle.stop(); });
            }
          } else if (!aborted) {
            const requires = result.requires?.length ? ` (requires: ${result.requires.join(', ')})` : '';
            console.error(
              `[Fleet] Trigger "${raw}" for agent "${agent.name}" not started: ${result.reason}${requires}`,
            );
          }
        })
        .catch((err: Error) => {
          if (stopped || !running.has(agent.name)) return;
          console.error(`[Fleet] Trigger "${raw}" for agent "${agent.name}" failed to start:`, err.message);
        });
      // Track so stopAll()/whenTriggersReady() can await settlement.
      pendingTriggerStarts.add(startPromise);
      void startPromise.finally(() => { pendingTriggerStarts.delete(startPromise); });
    }

    // ── Legacy coordination-channel triggers (pd/git/github + bare names) ──
    for (const legacyTrigger of legacyTriggers) {
      const physicalTriggerChannel = resolveChannel(legacyTrigger);
      // Prefer in-process subscriptions so trigger payload survives into the spawned task.
      const unsubscribe = options?.messaging?.subscribe(physicalTriggerChannel, (message: unknown) => {
        const context = contextFromMessage(legacyTrigger, message);
        if (isGithubLegacyTrigger(legacyTrigger)) {
          handleTrustGatedTrigger(
            agent,
            legacyTrigger,
            trustEventFromGithubMessage(legacyTrigger, message),
            context,
          );
          return;
        }
        void requestAgentRun(agent, context);
      });

      if (unsubscribe) {
        cleanupHandles.push(unsubscribe);
      } else if (isGithubLegacyTrigger(legacyTrigger)) {
        console.error(
          `[Fleet] Trigger "${legacyTrigger}" for agent "${agent.name}" not started: ` +
          'github triggers require in-process messaging so the trust gate can inspect the payload before spawning',
        );
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

    if (!agent.schedule && !agentIsTriggered(agent)) {
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

    // Record this child's PID (+ an exec-command fragment used to confirm
    // identity before a future kill, guarding against PID recycling — see
    // watcher-pid-registry.ts) so a FUTURE boot of this daemon (after a
    // crash that never ran stopRunningRecord()) can find and kill it instead
    // of leaving it orphaned indefinitely.
    if (watchProc.pid) {
      try {
        const registry = loadWatcherPidRegistry(WATCHER_PID_FILE);
        registry[watcherPidKey(project, watcher.name)] = {
          pid: watchProc.pid,
          startedAt: Date.now(),
          execSnippet: toExecSnippet(watcher.exec),
        };
        saveWatcherPidRegistry(WATCHER_PID_FILE, registry);
      } catch {
        // Best-effort — a registry write failure must not block the watcher.
      }
    }
    watchProc.on('exit', () => {
      try {
        const registry = loadWatcherPidRegistry(WATCHER_PID_FILE);
        delete registry[watcherPidKey(project, watcher.name)];
        saveWatcherPidRegistry(WATCHER_PID_FILE, registry);
      } catch {
        // Best-effort cleanup only.
      }
    });

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

  /**
   * Dispatch an agent's declared `outputs:` through the pluggable output
   * registry on successful completion. Fire-and-forget and never throws —
   * each sink result/error is logged independently so one broken output
   * does not affect the agent run or the other outputs.
   *
   * Phase-1 honesty: the spawn returns `status: 'spawned'` (the agent runs
   * asynchronously), so the dispatched body reports the run that fired the
   * output rather than the agent's final text. Sinks that need the full
   * agent transcript will be fed it in a later phase once the engine
   * collects completion output.
   */
  function dispatchAgentOutputs(
    agent: FleetAgent,
    runMeta: { status?: string; agentId?: string; backend?: string | null },
  ): void {
    const targets = agent.outputs;
    if (!targets || targets.length === 0) return;
    const status = runMeta.status ?? 'completed';
    const body = [
      `Fleet agent "${agent.name}" ${status}.`,
      runMeta.agentId ? `agentId: ${runMeta.agentId}` : null,
      runMeta.backend ? `backend: ${runMeta.backend}` : null,
    ].filter(Boolean).join('\n');
    void ioDispatch
      .dispatchOutputs(targets, {
        title: `${agent.name} ${status}`,
        body,
        // Default-deny posture: agent-run summaries are operator-local
        // metadata, not third-party PII. Real PII-bearing outputs are a
        // later phase and will set pii explicitly.
        pii: 'low',
      })
      .then((results: DispatchOutputResult[]) => {
        for (const r of results) {
          if (!r.ok) {
            const requires = r.requires?.length ? ` (requires: ${r.requires.join(', ')})` : '';
            console.error(
              `[Fleet] Output "${r.target}" for agent "${agent.name}" not dispatched: ${r.reason}${requires}`,
            );
          }
        }
      })
      .catch((err: Error) => {
        console.error(`[Fleet] Output dispatch failed for agent "${agent.name}":`, err.message);
      });
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

  /**
   * Convert a registry FleetTriggerEvent (file/webhook/email/...) into the
   * engine's FleetRunContext so the spawned agent sees the trigger payload.
   */
  function contextFromTriggerEvent(event: {
    source: string;
    type: string;
    timestamp: number;
    payload: unknown;
    metadata?: { correlation_id?: string; sender?: string; subject?: string; [k: string]: unknown };
  }): FleetRunContext {
    const messageContent = trimMessage(serializeMessage(event.payload));
    return {
      source: 'trigger',
      channel: `${event.source}:${event.type}`,
      from: event.metadata?.sender ?? null,
      message: event.payload,
      messageContent,
    };
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

  /**
   * Returns a plain `string` synchronously whenever `agent.skillGraft` is not
   * set — i.e. for every ship today, byte-for-byte identical to this
   * function's pre-skill-graft behavior, with ZERO extra microtask ticks.
   * That matters: several existing tests assert exact scheduling/backoff/
   * singleton timing by counting `await Promise.resolve()` ticks, and
   * unconditionally making this function `async` (even with no internal
   * `await`) shifts those counts by one tick per the spec's Promise
   * resolution semantics — it broke two such tests during development.
   * Returning `Promise<string>` only on the opt-in path keeps the fast path
   * perfectly synchronous; see the call site below for how it's consumed
   * without forcing an `await` on the common case either.
   */
  function buildAgentTask(agent: FleetAgent, context?: FleetRunContext): string | Promise<string> {
    const basePrompt = agent.prompt.trim();
    const messageText = context ? (context.messageContent ?? serializeMessage(context.message)).trim() : '';

    let task = basePrompt;
    if (context && messageText) {
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
      task = lines.join('\n');
    }

    if (!agent.skillGraft) return task;
    return appendSkillGraftContext(agent, task);
  }

  /**
   * Append a windags-pattern "relevant skills" section to `task` using
   * lib/skill-graft.ts, keyed on the ship's own task text as the query.
   *
   * This runs on the live spawn path (`buildAgentTask` awaits it before the
   * ship starts), and the FIRST call in a process pays a one-time cost — a full
   * skills/ catalog scan, plus a local MiniLM model load/download when the
   * semantic tier is configured. Because the enrichment is strictly advisory it
   * is both fail-open AND time-boxed, so it can never fail *or* stall a spawn:
   *   - never *fails* a spawn: any skill-graft error (embedder failure,
   *     unreadable skills/ dir, etc.) logs and returns the unmodified task; and
   *   - never *stalls* a spawn: if `craft()` hasn't produced context within
   *     `skillGraftBudgetMs`, the ship spawns on the un-grafted task and the
   *     enrichment is skipped for that run (the timer is `unref`'d so it never
   *     keeps the process alive on its own).
   * Same fail-open posture the rest of this engine uses for advisory enrichment
   * (see emitSemanticAliasTuples/observeSemanticAliases below), now with an
   * explicit latency bound so advisory enrichment can't hold a spawn hostage.
   */
  async function appendSkillGraftContext(agent: FleetAgent, task: string): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const budget = new Promise<typeof SKILL_GRAFT_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(SKILL_GRAFT_TIMED_OUT), skillGraftBudgetMs);
        timer.unref?.();
      });
      const result = await Promise.race([getSkillGraftIndex().craft(task), budget]);
      if (result === SKILL_GRAFT_TIMED_OUT) {
        console.error(`[Fleet] skill-graft exceeded ${skillGraftBudgetMs}ms for agent "${agent.name}" (spawning without it)`);
        return task;
      }
      const rendered = renderSkillGraftContext(result);
      return rendered ? `${task}\n\n${rendered}` : task;
    } catch (err) {
      console.error(`[Fleet] skill-graft failed for agent "${agent.name}" (continuing without it):`, (err as Error).message);
      return task;
    } finally {
      if (timer) clearTimeout(timer);
    }
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
      // Only await when skill-graft actually returned a Promise (agent.skillGraft
      // is set) — see buildAgentTask's doc comment for why the fast path must
      // stay perfectly synchronous.
      const taskResult = buildAgentTask(agent, context);
      const task = typeof taskResult === 'string' ? taskResult : await taskResult;
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
          // Dispatch declared registry outputs (file/notify/webhook/...).
          // Fire-and-forget: a failing sink must not fail the agent run.
          dispatchAgentOutputs(agent, {
            status: outcome.data.status,
            agentId: outcome.data.agentId,
            backend: runtime.backend,
          });
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

  /**
   * Kill + drop any `pd watch --exec` children this project left behind from
   * a PREVIOUS, ungraceful exit (segfault, SIGKILL) before starting fresh
   * ones. A graceful shutdown already reaps these via stopRunningRecord(); this
   * sweep exists for the case that didn't run one. See watcher-pid-registry.ts.
   *
   * Only kills a PID whose LIVE command line still matches the exec fragment
   * recorded when it was spawned (sweepStaleWatcherPids' identity check) —
   * without that, a PID the OS recycled onto an unrelated process since the
   * watcher child died would get `process.kill(-pid, 'SIGTERM')`'d, taking
   * out a stranger's process group (Copilot review on PR #879). Entries that
   * can't be confirmed are reported, not killed.
   */
  function sweepOrphanedWatcherChildren(): void {
    try {
      const registry = loadWatcherPidRegistry(WATCHER_PID_FILE);
      // Nothing to do (and nothing to persist) if this project has no
      // entries at all — this is the common case (a fresh install, a test
      // run, or a project whose watchers have never hit the external-spawn
      // fallback). Without this guard, saveWatcherPidRegistry() would
      // mkdirSync + writeFileSync an empty/unchanged registry on EVERY
      // fleet boot, including from unit tests that call startAll() — a
      // pure side effect against ~/.port-daddy/watcher-pids.json with
      // nothing gained (Copilot review on PR #879).
      const prefix = `${project}:`;
      const hasProjectEntries = Object.keys(registry).some((key) => key.startsWith(prefix));
      if (!hasProjectEntries) return;

      const { registry: swept, killed, unconfirmed } = sweepStaleWatcherPids(
        registry,
        project,
        getCommandLineForPid,
        (pid) => {
          try {
            process.kill(-pid, 'SIGTERM'); // detached spawn -> own process group
          } catch {
            try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
          }
        },
      );
      saveWatcherPidRegistry(WATCHER_PID_FILE, swept);
      if (killed.length > 0) {
        console.error(
          `[Fleet] Swept ${killed.length} orphaned watcher child(ren) from a previous ungraceful exit: ` +
          killed.map((k) => `${k.key} (pid ${k.pid})`).join(', '),
        );
      }
      if (unconfirmed.length > 0) {
        console.error(
          `[Fleet] ${unconfirmed.length} watcher-pid registry entr(y/ies) had a live PID whose command line no ` +
          `longer matches the recorded watcher — likely PID reuse by an unrelated process, so NOT killed: ` +
          unconfirmed.map((u) => `${u.key} (pid ${u.pid})`).join(', '),
        );
      }
    } catch (err) {
      // Best-effort — a sweep failure must never block fleet boot.
      console.error('[Fleet] Orphaned-watcher sweep failed (non-fatal):', (err as Error).message);
    }
  }

  function startAll(): void {
    sweepOrphanedWatcherChildren();
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
    stopped = true;
    respawnWatcherStopped = true;
    for (const name of [...running.keys()]) {
      stopRunningRecord(name);
    }
    emit({ type: 'fleet_stopped', project, timestamp: Date.now() });
    // Settle any in-flight async trigger starts so a late resolution does not
    // leak a watcher or log after teardown. Fire-and-forget: the per-promise
    // handlers already self-suppress because `stopped` is now true; this just
    // disposes any handle that resolves after this point.
    void whenTriggersReady();
  }

  /**
   * Resolve once every in-flight I/O-registry trigger start has settled. The
   * daemon does not need this, but it makes the async trigger wiring
   * deterministically testable: `startAgent` returns synchronously while the
   * registry start runs in the background; tests await this to observe the
   * outcome (or to guarantee no log/handle escapes the test).
   */
  async function whenTriggersReady(): Promise<void> {
    while (pendingTriggerStarts.size > 0) {
      await Promise.allSettled([...pendingTriggerStarts]);
    }
  }

  function getStatus(): Array<{
    name: string; type: string; status: string; running: boolean; paused: boolean;
    uptime: number; queueDepth: number;
    // Lifecycle enrichment (P1) — powers the pd-console fleet pane. Additive: every
    // field below is new; existing consumers that read name/status/etc. are unaffected.
    trigger?: string; schedule?: string; backend: string; modelTier?: string;
    maxRespawns: number; consecutiveFailures: number; backoffUntil?: number; lifecycle: string;
  }> {
    const now = Date.now();
    return config.agents.map((agent) => {
      const record = running.get(agent.name);
      const activeRun = activeAgentRuns.has(agent.name);
      const paused = pausedAgents.has(agent.name);
      const queueDepth = queueDepthFor(agent.name);
      const act = activationState.get(agent.name);
      const consecutiveFailures = act?.consecutiveFailures ?? 0;
      const backoffUntil = act?.backoffUntil;
      const maxRespawns = agent.maxRespawns ?? 3;
      let status = 'idle';
      if (activeRun) {
        status = 'running';
      } else if (queueDepth > 0) {
        status = 'queued';
      } else if (paused) {
        status = 'paused';
      } else if (record) {
        status = agent.schedule ? 'scheduled' : agentIsTriggered(agent) ? 'armed' : 'idle';
      }
      // Derived lifecycle for the operator console (resolved to an ICS maritime flag
      // in pd-console). Precedence is deliberate — a ship that is actively running
      // reads as "sailing" even if it has failed before:
      //   sailing  — a run is active right now
      //   dry-dock — retries exhausted (consecutiveFailures ≥ maxRespawns); needs the operator
      //   cooldown — backing off after a failure, not yet exhausted
      //   paused   — operator-paused
      //   else     — mirrors `status` (queued | armed | scheduled | idle)
      let lifecycle: string;
      if (activeRun) {
        lifecycle = 'sailing';
      } else if (maxRespawns > 0 && consecutiveFailures >= maxRespawns) {
        lifecycle = 'dry-dock';
      } else if (backoffUntil && backoffUntil > now) {
        lifecycle = 'cooldown';
      } else if (paused) {
        lifecycle = 'paused';
      } else {
        lifecycle = status;
      }
      return {
        name: agent.name,
        type: agent.schedule ? 'scheduled' : agentIsTriggered(agent) ? 'triggered' : 'manual',
        status,
        running: activeRun,
        paused,
        uptime: record ? Date.now() - record.startedAt : 0,
        queueDepth,
        trigger: agent.trigger,
        schedule: agent.schedule,
        backend: agent.backend,
        modelTier: agent.modelTier,
        maxRespawns,
        consecutiveFailures,
        backoffUntil,
        lifecycle,
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

  return { startAll, stopAll, startAgent, getStatus, hailAgent, pauseAgent, resumeAgent, setEnabledAgents, whenTriggersReady, config };
}

// ─── Cron Helpers ───────────────────────────────────────────────────────────

export function parseCronInterval(cron: string): number {
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
