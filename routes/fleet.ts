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
 * GET    /fleet/events     — SSE stream of all fleet lifecycle events
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { isMap, parse as parseYaml, parseDocument } from 'yaml';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { createFleetDaemon } from '../lib/fleet-daemon.js';
import {
  BUILTIN_MODEL_TIERS,
  findFleetConfigPath,
  loadFleetConfig,
  validateTopology,
  type FleetConfig,
} from '../lib/fleet-engine.js';
import { ensureStarterFleetProject } from '../lib/fleet-bootstrap.js';
import { resolveFleetChannel } from '../lib/fleet-channels.js';
import { assessBackendReadiness } from '../lib/backend-readiness.js';
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
}

const BACKEND_CATALOG = [
  { id: 'claude-cli', name: 'Claude CLI', models: ['haiku', 'sonnet', 'opus'] },
  { id: 'claude', name: 'Claude SDK', models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805'] },
  { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.0-flash-exp', 'gemini-2.5-flash', 'gemini-2.5-pro'] },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-70b-instruct', '@cf/openai/gpt-oss-120b'] },
  { id: 'codex', name: 'OpenAI Codex CLI', models: ['gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.4'] },
  { id: 'ollama', name: 'Ollama (local)', models: [] as string[] },
  { id: 'aider', name: 'Aider', models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5'] },
  { id: 'custom', name: 'Custom command', models: ['custom-low', 'custom-mid', 'custom-high'] },
] as const;

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

export const fleetPlugin: FastifyPluginAsync<{ deps: FleetRouteDeps }> = async (fastify, opts) => {
  const { fleetDaemon, messaging, projects } = opts.deps;

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
    return { success: true, ...status };
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
      } else if (existsSync(project) && statSync(project).isDirectory()) {
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
        return {
          id: backend.id,
          name: backend.name,
          models,
          modelTiers: tierDefaults || undefined,
          supported: true,
          readinessStatus: readiness.status,
          readinessSummary: readiness.summary,
          readinessNextStep: readiness.nextStep,
          credentialKeys: readiness.credentialKeys,
          credentialAlternates: readiness.credentialAlternates,
          setupCommand: readiness.setupCommand,
          setupFiles: readiness.setupFiles,
          restartRequired: readiness.restartRequired,
        };
      })
    );

    return { success: true, backends };
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

    // Subscribe to the fleet-wide event channel
    const unsub = messaging.subscribe('fleet:events', (msg: unknown) => {
      try {
        const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
        raw.write(`data: ${payload}\n\n`);
      } catch {
        // Client disconnected
      }
    });

    if (!unsub) {
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
      unsub();
      untrackConnection(clientIp, 'sse', raw as any);
    });
  });
};
