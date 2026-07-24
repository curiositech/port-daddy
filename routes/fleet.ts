/**
 * Fleet Routes — Always-On Fleet Management
 *
 * GET    /fleet            — Aggregated fleet status across all projects
 * GET    /fleet/:project   — Specific project's fleet status
 * POST   /fleet/start      — Start all fleets (or specific project via body)
 * POST   /fleet/stop       — Stop all fleets (or specific project via body)
 * POST   /fleet/agent/run     — Run one fleet agent manually
 * POST   /fleet/agent/pause   — Pause one fleet agent inside a running fleet
 * POST   /fleet/agent/resume  — Resume one fleet agent inside a running fleet
 * POST   /fleet/bootstrap  — Create starter fleet files in a project and start it
 * POST   /fleet/reload     — Re-read all configs and restart changed fleets
 * POST   /fleet/register   — Register a project directory for fleet management
 * POST   /fleet/config/:project/budget — Set limits.budget_usd_per_day
 * POST   /fleet/config/:project/runtime — Apply one ready runtime to fleet agents
 * GET    /fleet/events     — SSE stream of all fleet lifecycle events
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { isMap, parse as parseYaml, parseDocument } from 'yaml';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { createFleetDaemon } from '../lib/fleet-daemon.js';
import type { Conductor } from '../lib/fleet/conductor.js';
import type { CloudAppTelemetry } from '../lib/cloud-app-telemetry.js';
import {
  BUILTIN_MODEL_TIERS,
  findFleetConfigPath,
  loadFleetConfig,
  validateTopology,
  type FleetConfig,
  type FleetModelTier,
} from '../lib/fleet-engine.js';
import { ensureStarterFleetProject } from '../lib/fleet-bootstrap.js';
import { resolveFleetChannel } from '../lib/fleet-channels.js';
import { IoDispatch } from '../lib/fleet/io-dispatch.js';
import { getSharedWebhookReceiver } from '../lib/fleet/webhook-receiver.js';
import { assessBackendReadiness } from '../lib/backend-readiness.js';
import {
  BACKEND_CATALOG as SHARED_BACKEND_CATALOG,
  KNOWN_BACKEND_IDS,
  detectForcedCliBackend,
  detectForcedCliBackendValue,
} from '../lib/backend-catalog.js';
import { managedSecretStorageStatus, saveManagedSecret } from '../lib/secret-env.js';
import { computeSpawnForecast, type ForecastInputFleet } from '../lib/spawn-forecast.js';
import type { Counters } from '../lib/counters.js';
import { validateProjectRoot } from '../lib/utils.js';
import {
  canOpenConnection,
  trackConnection,
  untrackConnection,
} from '../shared/connection-tracking.js';

interface FleetRouteDeps {
  fleetDaemon: ReturnType<typeof createFleetDaemon>;
  projects: {
    get(id: string): { id: string; root: string } | null;
    getByPath(root: string): { id: string; root: string } | null;
  };
  messaging: {
    subscribe(channel: string, callback: (msg: unknown) => void): (() => void) | null;
  };
  /**
   * The Daemon Fleet Conductor (ADR-0060). Optional — when present, the operator
   * control surface (`POST /fleet/halt|pause|resume`, `GET /fleet/tree/:rootId`)
   * is wired to the in-process conductor methods. Absent in legacy/test setups.
   */
  conductor?: Conductor;
  cloudAppTelemetry?: CloudAppTelemetry;
  /** Metric counters — powers the observed side of GET /fleet/forecast. */
  counters?: Counters;
}

// Backend catalog is shared with the CLI and FleetBar/dashboard surfaces;
// see lib/backend-catalog.ts for the source of truth.
const BACKEND_CATALOG = SHARED_BACKEND_CATALOG;

const BACKEND_SECRET_KEYS: Record<string, string[]> = {
  claude: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CF_ACCOUNT_ID'],
  openai: ['OPENAI_API_KEY'],
};

function allowedSecretKeysForBackend(backend: string): Set<string> {
  return new Set(BACKEND_SECRET_KEYS[backend] || []);
}

function extractPublishedChannel(command?: string): string | null {
  if (!command) return null;
  const trimmed = command.trim();
  if (!trimmed.startsWith('publish ')) return null;
  const channel = trimmed.slice('publish '.length).trim();
  return channel || null;
}

function buildResolvedChannels(config: FleetConfig, projectDir: string): Record<string, string> {
  const resolved = new Map<string, string>();

  const add = (channel?: string | null) => {
    const trimmed = channel?.trim();
    if (!trimmed) return;
    resolved.set(trimmed, resolveFleetChannel(trimmed, projectDir, config.name));
  };

  Object.keys(config.channels ?? {}).forEach(add);
  config.agents.forEach((agent) => {
    add(agent.trigger);
    add(extractPublishedChannel(agent.onSuccess));
    add(extractPublishedChannel(agent.onFailure));
  });
  config.watchers.forEach((watcher) => add(watcher.trigger));

  return Object.fromEntries(resolved);
}

function setFleetYamlBudget(yaml: string, usdPerDay: number): string {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0) {
    throw new Error(doc.errors.map((err) => err.message).join('; '));
  }
  if (!isMap<string, unknown>(doc.contents)) {
    throw new Error('Invalid YAML object');
  }

  const nestedFleet = doc.contents.get('fleet', true);
  const target = isMap<string, unknown>(nestedFleet) ? nestedFleet : doc.contents;
  const limits = target.get('limits', true);

  if (isMap<string, unknown>(limits)) {
    limits.set('budget_usd_per_day', usdPerDay);
  } else {
    target.set('limits', { budget_usd_per_day: usdPerDay });
  }

  return String(doc);
}

interface FleetRuntimeYamlUpdate {
  backend: string;
  model?: string;
  modelTier?: FleetModelTier;
  agentNames?: string[];
  clearFallbacks: boolean;
  skipCustomAgents: boolean;
}

interface FleetRuntimeYamlUpdateResult {
  yaml: string;
  updatedAgents: string[];
  skippedAgents: string[];
}

const VALID_MODEL_TIERS = new Set<FleetModelTier>(['low', 'mid', 'high']);

function parseAgentName(key: unknown): string {
  return typeof key === 'string' ? key : String(key ?? '').trim();
}

function setFleetYamlRuntime(yaml: string, update: FleetRuntimeYamlUpdate): FleetRuntimeYamlUpdateResult {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0) {
    throw new Error(doc.errors.map((err) => err.message).join('; '));
  }
  if (!isMap<string, unknown>(doc.contents)) {
    throw new Error('Invalid YAML object');
  }

  const nestedFleet = doc.contents.get('fleet', true);
  const target = isMap<string, unknown>(nestedFleet) ? nestedFleet : doc.contents;
  const agents = target.get('agents', true);
  if (!isMap<string, unknown>(agents)) {
    throw new Error('Invalid YAML object: agents map is required');
  }

  const requestedAgents = update.agentNames?.length ? new Set(update.agentNames) : null;
  const updatedAgents: string[] = [];
  const skippedAgents: string[] = [];

  for (const item of agents.items) {
    const agentName = parseAgentName(item.key);
    if (!agentName) continue;
    if (requestedAgents && !requestedAgents.has(agentName)) continue;
    if (!isMap<string, unknown>(item.value)) {
      skippedAgents.push(agentName);
      continue;
    }
    if (!requestedAgents && update.skipCustomAgents && item.value.get('backend') === 'custom') {
      skippedAgents.push(agentName);
      continue;
    }

    item.value.set('backend', update.backend);
    if (update.modelTier) {
      item.value.delete('model');
      item.value.set('model_tier', update.modelTier);
    } else {
      item.value.delete('model_tier');
      item.value.delete('modelTier');
      if (update.model) item.value.set('model', update.model);
      else item.value.delete('model');
    }
    if (update.clearFallbacks) item.value.delete('fallbacks');
    updatedAgents.push(agentName);
  }

  if (requestedAgents) {
    for (const agentName of requestedAgents) {
      if (!updatedAgents.includes(agentName) && !skippedAgents.includes(agentName)) {
        skippedAgents.push(agentName);
      }
    }
  }

  return { yaml: String(doc), updatedAgents, skippedAgents };
}

export const fleetPlugin: FastifyPluginAsync<{ deps: FleetRouteDeps }> = async (fastify, opts) => {
  const { fleetDaemon, messaging, projects, conductor, cloudAppTelemetry, counters } = opts.deps;

  // ── Conductor operator control surface (ADR-0060) ──────────────────────────
  // halt = total (SIGTERM→SIGKILL the scope, refund-not-slash); pause = soft
  // (stop admitting, leave running agents alive); resume = reopen; tree/inspect
  // = render the lineage tree for a rootId. All call the in-process conductor
  // methods that already exist; they no-op gracefully (503) if no conductor is
  // wired (legacy / test setups without ADR-0060).
  function requireConductor(reply: FastifyReply): Conductor | null {
    if (!conductor) {
      reply.code(503).send({ success: false, error: 'Fleet Conductor not wired (ADR-0060)' });
      return null;
    }
    return conductor;
  }
  function scopeFromBody(body: unknown): { rootId?: string } {
    const b = (body as Record<string, unknown>) || {};
    const rootId = typeof b.rootId === 'string' && b.rootId.trim() ? b.rootId.trim() : undefined;
    return rootId ? { rootId } : {};
  }

  fastify.post('/fleet/halt', async (request: FastifyRequest, reply: FastifyReply) => {
    const c = requireConductor(reply);
    if (!c) return;
    const scope = scopeFromBody(request.body);
    const result = c.halt(scope);
    return { success: true, scope: scope.rootId ?? 'global', halted: result.halted, count: result.halted.length };
  });

  fastify.post('/fleet/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const c = requireConductor(reply);
    if (!c) return;
    const scope = scopeFromBody(request.body);
    c.pause(scope);
    return { success: true, scope: scope.rootId ?? 'global', paused: true };
  });

  fastify.post('/fleet/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    const c = requireConductor(reply);
    if (!c) return;
    const scope = scopeFromBody(request.body);
    c.resume(scope);
    return { success: true, scope: scope.rootId ?? 'global', resumed: true };
  });

  fastify.get('/fleet/tree/:rootId', async (request: FastifyRequest, reply: FastifyReply) => {
    const c = requireConductor(reply);
    if (!c) return;
    const { rootId } = request.params as { rootId: string };
    const nodes = c.tree(rootId);
    return { success: true, rootId, count: nodes.length, tree: nodes };
  });

  // GET /fleet/conductor — every launch across all roots (newest first, bounded).
  // Powers the operator console's Conductor pane (ADR-0060).
  fastify.get('/fleet/conductor', async (request: FastifyRequest, reply: FastifyReply) => {
    const c = requireConductor(reply);
    if (!c) return;
    const q = (request.query as { limit?: string }) || {};
    const limit = q.limit ? Number.parseInt(q.limit, 10) : 200;
    const launches = c.allLaunches(Number.isFinite(limit) ? limit : 200);
    return { success: true, count: launches.length, launches };
  });

  function resolveFleetRecord(projectOrDir: string, reply: FastifyReply) {
    const fleets = fleetDaemon.getStatus().fleets;
    const exactDirMatch = fleets.find((fleet) => fleet.projectDir === projectOrDir);
    if (exactDirMatch) return exactDirMatch;

    const nameMatches = fleets.filter((fleet) => fleet.project === projectOrDir);
    if (nameMatches.length === 1) return nameMatches[0];
    if (nameMatches.length > 1) {
      reply.code(409).send({
        success: false,
        error: `Fleet "${projectOrDir}" is ambiguous across multiple directories`,
        code: 'AMBIGUOUS_FLEET',
        matches: nameMatches.map((fleet) => ({
          project: fleet.project,
          projectDir: fleet.projectDir,
        })),
      });
      return null;
    }

    reply.code(404).send({ success: false, error: `No fleet running for project: ${projectOrDir}` });
    return null;
  }

  // GET /fleet — Aggregated status
  fastify.get('/fleet', async () => {
    const status = fleetDaemon.getStatus();
    const remoteAgents = cloudAppTelemetry?.agents({ since: Date.now() - 86_400_000, limit: 500 }) ?? [];
    if (remoteAgents.length === 0) {
      return { success: true, ...status };
    }
    const localTotalAgents = typeof status.totalAgents === 'number' ? status.totalAgents : 0;
    const remoteActiveAgentCount = remoteAgents.filter((agent) => agent.isActive).length;
    return {
      success: true,
      ...status,
      totalAgents: localTotalAgents + remoteAgents.length,
      localTotalAgents,
      remoteAgentCount: remoteAgents.length,
      remoteActiveAgentCount,
      remoteAgents,
      remote: {
        cloudApp: {
          agentCount: remoteAgents.length,
          activeAgentCount: remoteActiveAgentCount,
          agents: remoteAgents,
        },
      },
    };
  });

  // GET /fleet/sources — I/O channel health board (I/O wiring Phase 2).
  // Probes every registered trigger source and output sink for availability
  // with the daemon's REAL deps (the shared webhook receiver), so what the
  // operator sees is what a fleet would actually get: STUB channels show
  // their honest {ready:false, reason, requires}; armed webhook channels are
  // listed by slug.
  fastify.get('/fleet/sources', async () => {
    const probe = new IoDispatch({
      registerWebhookHandler: (channel, handler) =>
        getSharedWebhookReceiver().registerHandler(channel, handler),
    });
    const channels = await probe.health();
    return {
      success: true,
      channels,
      webhookChannels: getSharedWebhookReceiver().channels(),
    };
  });

  // GET /fleet/forecast — "how many LLM calls per hour, on which models, is
  // this machine armed to make?" Deterministic side: cron-scheduled agents at
  // the ENGINE's real cadence (interval parser, cooldown-damped, capped by
  // max_spawns_per_hour), with the forced-CLI override applied to every
  // agent's effective backend/model. Observed side: spawn.started counters —
  // last hour and trailing 24h, grouped by model and backend — which is the
  // only honest rate for event-triggered agents.
  //
  // Keep literal `/fleet/...` routes above `/fleet/:project`; otherwise
  // Fastify treats `forecast` as a project id and FleetBar polls get 404s.
  fastify.get('/fleet/forecast', async () => {
    const status = fleetDaemon.getStatus();
    const fleets = status.fleets
      .map((f) => {
        const config = loadFleetConfig(f.projectDir);
        return config
          ? { project: f.project, projectDir: f.projectDir, running: f.running, config }
          : null;
      })
      .filter((f): f is ForecastInputFleet => f !== null);

    const forecast = computeSpawnForecast(fleets, {
      forcedCliBackend: detectForcedCliBackend(),
    });

    let observed: {
      lastHour: number;
      last24h: number;
      last24hPerHour: number;
      byModelLastHour: Array<{ value: string; count: number }>;
      byBackendLastHour: Array<{ value: string; count: number }>;
      byModelLast24h: Array<{ value: string; count: number }>;
    } | null = null;
    if (counters) {
      const hourAgo = Date.now() - 3_600_000;
      const dayAgo = Date.now() - 86_400_000;
      const lastHour = counters.queryTotals(['spawn.started'], { since: hourAgo }).get('spawn.started') ?? 0;
      const last24h = counters.queryTotals(['spawn.started'], { since: dayAgo }).get('spawn.started') ?? 0;
      observed = {
        lastHour,
        last24h,
        last24hPerHour: +(last24h / 24).toFixed(2),
        byModelLastHour: counters.topN('spawn.started', 'model', 8, hourAgo),
        byBackendLastHour: counters.topN('spawn.started', 'backend', 8, hourAgo),
        byModelLast24h: counters.topN('spawn.started', 'model', 8, dayAgo),
      };
    }

    return { success: true, ...forecast, observed };
  });

  // GET /fleet/:project — Specific project status
  fastify.get('/fleet/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    const { project } = request.params as { project: string };
    const fleet = resolveFleetRecord(project, reply);
    if (!fleet) return;
    return { success: true, fleet };
  });

  // POST /fleet/start — Start fleets
  fastify.post('/fleet/start', async (request: FastifyRequest) => {
    const { projectDir, enabledAgents } = (request.body as { projectDir?: string; enabledAgents?: string[] }) || {};

    if (projectDir) {
      const result = fleetDaemon.startProject(projectDir, { enabledAgents });
      return { success: result.success, error: result.error };
    }

    fleetDaemon.start();
    const status = fleetDaemon.getStatus();
    return {
      success: true,
      message: `Fleet daemon started with ${status.fleets.length} project(s)`,
      fleets: status.fleets.map(f => f.project),
    };
  });

  // POST /fleet/stop — Stop fleets
  fastify.post('/fleet/stop', async (request: FastifyRequest) => {
    const { projectDir } = (request.body as { projectDir?: string }) || {};

    if (projectDir) {
      const result = fleetDaemon.stopProject(projectDir);
      return { success: result.success, error: result.error };
    }

    fleetDaemon.stop();
    return { success: true, message: 'All fleets stopped' };
  });

  // POST /fleet/agent/run — Manually hail one fleet agent
  fastify.post('/fleet/agent/run', async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectDir, agentName } = (request.body as { projectDir?: string; agentName?: string }) || {};
    if (!agentName || typeof agentName !== 'string') {
      reply.code(400);
      return { success: false, error: 'agentName is required' };
    }
    const result = await fleetDaemon.hailAgent(agentName, { project: projectDir, source: 'manual' });
    if (!result.success) reply.code(400);
    return result;
  });

  // POST /fleet/agent/pause — Pause one fleet agent
  fastify.post('/fleet/agent/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectDir, agentName } = (request.body as { projectDir?: string; agentName?: string }) || {};
    if (!agentName || typeof agentName !== 'string') {
      reply.code(400);
      return { success: false, error: 'agentName is required' };
    }
    const result = fleetDaemon.pauseAgent(agentName, projectDir);
    if (!result.success) reply.code(400);
    return result;
  });

  // POST /fleet/agent/resume — Resume one fleet agent
  fastify.post('/fleet/agent/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectDir, agentName } = (request.body as { projectDir?: string; agentName?: string }) || {};
    if (!agentName || typeof agentName !== 'string') {
      reply.code(400);
      return { success: false, error: 'agentName is required' };
    }
    const result = fleetDaemon.resumeAgent(agentName, projectDir);
    if (!result.success) reply.code(400);
    return result;
  });

  // POST /fleet/bootstrap — Create starter fleet assets, then start the fleet
  fastify.post('/fleet/bootstrap', async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectDir, start = true } = (request.body as { projectDir?: string; start?: boolean }) || {};
    if (!projectDir || typeof projectDir !== 'string') {
      reply.code(400);
      return { success: false, error: 'projectDir is required' };
    }

    const validation = validateProjectRoot(projectDir);
    if (!validation.ok) {
      reply.code(400);
      return { success: false, error: validation.error };
    }

    if (!existsSync(projectDir)) {
      reply.code(404);
      return { success: false, error: `Project directory does not exist: ${projectDir}` };
    }

    try {
      if (!statSync(projectDir).isDirectory()) {
        reply.code(400);
        return { success: false, error: `Project path is not a directory: ${projectDir}` };
      }
    } catch (err) {
      reply.code(400);
      return { success: false, error: `Could not inspect project directory: ${(err as Error).message}` };
    }

    const bootstrap = ensureStarterFleetProject(projectDir);
    const startResult = start ? fleetDaemon.startProject(projectDir) : { success: true as const };
    if (!startResult.success) {
      reply.code(400);
    }

    return {
      success: startResult.success,
      error: startResult.success ? undefined : startResult.error,
      bootstrap,
    };
  });

  // POST /fleet/reload — Re-read configs and restart
  fastify.post('/fleet/reload', async () => {
    fleetDaemon.reload();
    const status = fleetDaemon.getStatus();
    return {
      success: true,
      message: `Fleet daemon reloaded with ${status.fleets.length} project(s)`,
      fleets: status.fleets.map(f => f.project),
    };
  });

  // POST /fleet/register — Register a project for fleet management
  fastify.post('/fleet/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectDir } = (request.body as { projectDir?: string }) || {};
    if (!projectDir || typeof projectDir !== 'string') {
      reply.code(400);
      return { success: false, error: 'projectDir is required' };
    }

    const result = fleetDaemon.startProject(projectDir);
    if (!result.success) {
      reply.code(400);
    }
    return { success: result.success, error: result.error };
  });

  // GET /fleet/prompt — One-line fleet status for shell integration
  fastify.get('/fleet/prompt', async (request: FastifyRequest) => {
    const query = request.query as { project?: string; since?: string };
    const project = query.project;
    if (!project) {
      return { success: false, error: 'project query param required' };
    }
    const since = query.since ? parseInt(query.since, 10) : undefined;
    const line = fleetDaemon.getPromptLine(project, since);
    return { success: true, line };
  });

  /** Resolve fleet + config path, or send 404. Returns null if reply was sent. */
  function resolveFleetConfig(project: string, reply: FastifyReply) {
    const fleets = fleetDaemon.getStatus().fleets;
    const exactDirMatch = fleets.find((fleet) => fleet.projectDir === project);
    const exactRootMatch = projects.getByPath(project);
    const exactIdMatch = projects.get(project);

    let projectName: string | null = null;
    let projectDir: string | null = null;

    if (exactDirMatch) {
      projectName = exactDirMatch.project;
      projectDir = exactDirMatch.projectDir;
    } else if (exactRootMatch) {
      projectName = exactRootMatch.id;
      projectDir = exactRootMatch.root;
    } else if (exactIdMatch) {
      projectName = exactIdMatch.id;
      projectDir = exactIdMatch.root;
    } else {
      const nameMatches = fleets.filter((fleet) => fleet.project === project);
      if (nameMatches.length === 1) {
        projectName = nameMatches[0].project;
        projectDir = nameMatches[0].projectDir;
      } else if (nameMatches.length > 1) {
        reply.code(409).send({
          success: false,
          error: `Fleet "${project}" is ambiguous across multiple directories`,
          code: 'AMBIGUOUS_FLEET',
          matches: nameMatches.map((fleet) => ({
            project: fleet.project,
            projectDir: fleet.projectDir,
          })),
        });
        return null;
      } else if (project.includes('\0')) {
        reply.code(400).send({ success: false, error: 'projectRoot contains invalid characters' });
        return null;
      } else if (project.startsWith('/')) {
        const validation = validateProjectRoot(project);
        if (!validation.ok) {
          reply.code(400).send({ success: false, error: validation.error });
          return null;
        }
        if (!existsSync(project) || !statSync(project).isDirectory()) {
          reply.code(404).send({ success: false, error: `Project directory does not exist: ${project}` });
          return null;
        }
        const discoveredConfig = loadFleetConfig(project);
        if (discoveredConfig) {
          projectName = discoveredConfig.name || basename(project);
          projectDir = project;
        }
      }
    }

    if (!projectDir || !projectName) {
      reply.code(404).send({ success: false, error: `No registered project or running fleet found for: ${project}` });
      return null;
    }

    const configPath = findFleetConfigPath(projectDir);
    if (!configPath) { reply.code(404).send({ success: false, error: 'No pd-fleet.yml found' }); return null; }
    return { project: projectName, projectDir, configPath };
  }

  // GET /fleet/config/:project — raw YAML + parsed config + topology validation
  fastify.get('/fleet/config/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    const resolved = resolveFleetConfig((request.params as { project: string }).project, reply);
    if (!resolved) return;
    const { project, projectDir, configPath } = resolved;
    const yaml = readFileSync(configPath, 'utf-8');
    const parsed = loadFleetConfig(projectDir);
    const topology = parsed ? validateTopology(parsed) : null;
    const resolvedChannels = parsed ? buildResolvedChannels(parsed, projectDir) : {};
    return { success: true, project, yaml, path: configPath, projectDir, parsed, topology, resolvedChannels };
  });

  // PUT /fleet/config/:project — write YAML, validate, reload
  fastify.put('/fleet/config/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    const { yaml } = (request.body as { yaml?: string }) || {};
    if (!yaml || typeof yaml !== 'string') { reply.code(400); return { success: false, error: 'yaml required' }; }
    const resolved = resolveFleetConfig((request.params as { project: string }).project, reply);
    if (!resolved) return;
    const { projectDir, configPath } = resolved;
    try {
      const test = parseYaml(yaml);
      if (!test || typeof test !== 'object') { reply.code(400); return { success: false, error: 'Invalid YAML object' }; }
    } catch (err) { reply.code(400); return { success: false, error: `Parse error: ${(err as Error).message}` }; }
    writeFileSync(configPath, yaml, 'utf-8');
    fleetDaemon.reload();
    const newParsed = loadFleetConfig(projectDir);
    const topology = newParsed ? validateTopology(newParsed) : null;
    return { success: true, topology };
  });

  // POST /fleet/config/:project/budget — set launch budget without hand-editing YAML
  fastify.post('/fleet/config/:project/budget', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as { usdPerDay?: unknown }) || {};
    const usdPerDay = typeof body.usdPerDay === 'number' ? body.usdPerDay : Number(body.usdPerDay);
    if (!Number.isFinite(usdPerDay) || usdPerDay <= 0) {
      reply.code(400);
      return { success: false, error: 'usdPerDay must be a positive finite number' };
    }

    const resolved = resolveFleetConfig((request.params as { project: string }).project, reply);
    if (!resolved) return;
    const { projectDir, configPath } = resolved;

    try {
      const currentYaml = readFileSync(configPath, 'utf-8');
      const nextYaml = setFleetYamlBudget(currentYaml, usdPerDay);
      writeFileSync(configPath, nextYaml, 'utf-8');
      fleetDaemon.reload();
      const newParsed = loadFleetConfig(projectDir);
      const topology = newParsed ? validateTopology(newParsed) : null;
      return { success: true, budgetUsdPerDay: usdPerDay, topology };
    } catch (err) {
      reply.code(400);
      return { success: false, error: (err as Error).message };
    }
  });

  // POST /fleet/config/:project/runtime — bulk-apply one ready backend/model to fleet agents
  fastify.post('/fleet/config/:project/runtime', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as Record<string, unknown>) || {};
    const backend = typeof body.backend === 'string' ? body.backend.trim() : '';
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
    const rawModelTier = typeof body.modelTier === 'string' && body.modelTier.trim()
      ? body.modelTier.trim()
      : undefined;
    const modelTier = rawModelTier && VALID_MODEL_TIERS.has(rawModelTier as FleetModelTier)
      ? rawModelTier as FleetModelTier
      : undefined;
    const clearFallbacks = body.clearFallbacks === true;
    const agentNames = Array.isArray(body.agentNames)
      ? [...new Set(body.agentNames
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean))]
      : undefined;

    if (!backend) {
      reply.code(400);
      return { success: false, error: 'backend is required' };
    }
    if (!KNOWN_BACKEND_IDS.has(backend)) {
      reply.code(400);
      return { success: false, error: `Unknown backend "${backend}"` };
    }
    if (rawModelTier && !modelTier) {
      reply.code(400);
      return { success: false, error: 'modelTier must be one of: low, mid, high' };
    }
    if (model && modelTier) {
      reply.code(400);
      return { success: false, error: 'Choose either model or modelTier, not both' };
    }

    const readinessModel = model || (modelTier ? BUILTIN_MODEL_TIERS[backend]?.[modelTier] : undefined);
    const readiness = await assessBackendReadiness(backend, { model: readinessModel ?? null });
    if (readiness.status !== 'ready') {
      reply.code(400);
      return {
        success: false,
        error: `Backend "${backend}" is not ready: ${readiness.summary}`,
        readiness,
      };
    }

    const resolved = resolveFleetConfig((request.params as { project: string }).project, reply);
    if (!resolved) return;
    const { projectDir, configPath } = resolved;

    try {
      const currentYaml = readFileSync(configPath, 'utf-8');
      const result = setFleetYamlRuntime(currentYaml, {
        backend,
        model,
        modelTier,
        agentNames,
        clearFallbacks,
        skipCustomAgents: body.skipCustomAgents !== false,
      });
      if (result.updatedAgents.length === 0) {
        reply.code(400);
        return { success: false, error: 'No matching agent definitions were updated', skippedAgents: result.skippedAgents };
      }

      writeFileSync(configPath, result.yaml, 'utf-8');
      fleetDaemon.reload();
      const newParsed = loadFleetConfig(projectDir);
      const topology = newParsed ? validateTopology(newParsed) : null;
      return {
        success: true,
        backend,
        model: model ?? null,
        modelTier: modelTier ?? null,
        clearFallbacks,
        updatedAgents: result.updatedAgents,
        skippedAgents: result.skippedAgents,
        topology,
      };
    } catch (err) {
      reply.code(400);
      return { success: false, error: (err as Error).message };
    }
  });

  // Ollama model list — cached to avoid 2s timeout penalty when Ollama is down
  let ollamaCache: { models: string[]; at: number } | null = null;
  const OLLAMA_TTL = 60_000;

  // GET /fleet/models — available backend + model catalog
  fastify.get('/fleet/models', async () => {
    const now = Date.now();
    let ollamaModels: string[];
    if (ollamaCache && now - ollamaCache.at < OLLAMA_TTL) {
      ollamaModels = ollamaCache.models;
    } else {
      ollamaModels = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) })
        .then(r => r.json())
        .then(d => (d.models || []).map((m: { name: string }) => m.name))
        .catch(() => []);
      ollamaCache = { models: ollamaModels, at: now };
    }

    const forcedCliBackend = detectForcedCliBackend();
    const pdUseCliBackend = detectForcedCliBackendValue();
    const backends = await Promise.all(
      BACKEND_CATALOG.map(async (backend) => {
        const readiness = await assessBackendReadiness(backend.id);
        const tierDefaults = BUILTIN_MODEL_TIERS[backend.id];
        let models = [...backend.models];
        if (tierDefaults) {
          models = [...new Set([...models, ...Object.values(tierDefaults)])];
        }
        if (backend.id === 'ollama') {
          models = [...new Set([...ollamaModels, ...models])];
        }
        const isReady =
          readiness.status === 'ready' || readiness.status === 'manual_check';
        return {
          id: backend.id,
          name: backend.name,
          models,
          modelTiers: tierDefaults || undefined,
          supported: true,
          // `launchable` historically meant "credentials are present"; we keep
          // that strict definition, but expose `available` as the broader
          // "PD can spawn through this right now (binary present / key present
          // / SDK installed)" signal that UIs should branch on.
          launchable: readiness.status === 'ready',
          available: isReady,
          // New shared-catalog metadata. Drives FleetBar + dashboard framing.
          costModel: backend.costModel,
          framing: backend.framing,
          description: backend.description,
          tagline: backend.tagline,
          recommended: Boolean(backend.recommended),
          pdUseCliBackendValue: backend.pdUseCliBackendValue,
          adapter: backend.adapter,
          isForcedByEnv: forcedCliBackend === backend.id,
          readinessStatus: readiness.status,
          readinessSummary: readiness.summary,
          readinessNextStep: readiness.nextStep,
          credentialKeys: readiness.credentialKeys,
          credentialAlternates: readiness.credentialAlternates,
          setupLinks: readiness.setupLinks,
          setupCommand: readiness.setupCommand,
          setupFiles: readiness.setupFiles,
          restartRequired: readiness.restartRequired,
        };
      })
    );

    return {
      success: true,
      forcedCliBackend,
      pdUseCliBackend,
      backends,
    };
  });

  // POST /fleet/backend-secrets - save provider credentials in encrypted local storage.
  fastify.post('/fleet/backend-secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as Record<string, unknown>) || {};
    const backend = typeof body.backend === 'string' ? body.backend.trim() : '';
    const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values)
      ? body.values as Record<string, unknown>
      : null;

    if (!backend || !values) {
      reply.code(400);
      return { success: false, error: 'backend and values are required' };
    }

    const allowedKeys = allowedSecretKeysForBackend(backend);
    if (allowedKeys.size === 0) {
      reply.code(400);
      return { success: false, error: `No console-managed secrets are registered for backend "${backend}"` };
    }

    const entries = Object.entries(values)
      .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
      .map(([key, value]) => [key, (value as string).trim()] as const);
    if (entries.length === 0) {
      reply.code(400);
      return { success: false, error: 'At least one non-empty secret value is required' };
    }

    const rejected = entries.map(([key]) => key).filter((key) => !allowedKeys.has(key));
    if (rejected.length > 0) {
      reply.code(400);
      return { success: false, error: `Unsupported secret key for ${backend}: ${rejected.join(', ')}` };
    }

    try {
      const saved = entries.map(([key, value]) => saveManagedSecret(key, value));
      return {
        success: true,
        backend,
        savedKeys: saved.map((entry) => entry.key),
        encryptedAtRest: saved.every((entry) => entry.encryptedAtRest),
        storage: managedSecretStorageStatus(),
      };
    } catch (error) {
      reply.code(503);
      return { success: false, error: (error as Error).message, storage: managedSecretStorageStatus() };
    }
  });

  // GET /fleet/events — SSE stream of fleet lifecycle events
  fastify.get('/fleet/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp: string = request.ip || 'unknown';

    if (!canOpenConnection(clientIp, 'sse')) {
      reply
        .code(429)
        .header('Retry-After', '10')
        .header('Cache-Control', 'no-store');
      return { error: 'too many concurrent SSE connections' };
    }

    reply.hijack();
    const raw = reply.raw;

    trackConnection(clientIp, 'sse', raw as any);

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('data: {"type":"connected"}\n\n');

    // Subscribe to the fleet-wide event channel AND the Conductor's lifecycle
    // channels (ADR-0060). The conductor broadcasts admission / state-transition /
    // breaker-trip / halt events on `fleet:launch` + `fleet:state`; without a
    // consumer those broadcasts went nowhere. Forward them all onto this SSE so
    // an operator (or the console pane) sees the live fleet, including halts.
    const write = (type: string, msg: unknown): void => {
      try {
        const body = typeof msg === 'string' ? msg : JSON.stringify(msg);
        // fleet:events already carries its own shape; conductor channels are
        // tagged so a consumer can distinguish them.
        raw.write(`data: ${type === 'fleet:events' ? body : JSON.stringify({ channel: type, ...(typeof msg === 'object' && msg ? msg : { value: msg }) })}\n\n`);
      } catch {
        // Client disconnected
      }
    };
    const unsubEvents = messaging.subscribe('fleet:events', (msg) => write('fleet:events', msg));
    const unsubState = messaging.subscribe('fleet:state', (msg) => write('fleet:state', msg));
    const unsubLaunch = messaging.subscribe('fleet:launch', (msg) => write('fleet:launch', msg));

    if (!unsubEvents) {
      unsubState?.();
      unsubLaunch?.();
      untrackConnection(clientIp, 'sse', raw as any);
      raw.end();
      return;
    }

    // Heartbeat to detect dead connections
    const heartbeat = setInterval(() => {
      try { raw.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 30000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubEvents();
      unsubState?.();
      unsubLaunch?.();
      untrackConnection(clientIp, 'sse', raw as any);
    });
  });
};
