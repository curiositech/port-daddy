/**
 * Fleet Routes — Always-On Fleet Management
 *
 * GET    /fleet            — Aggregated fleet status across all projects
 * GET    /fleet/:project   — Specific project's fleet status
 * POST   /fleet/start      — Start all fleets (or specific project via body)
 * POST   /fleet/stop       — Stop all fleets (or specific project via body)
 * POST   /fleet/reload     — Re-read all configs and restart changed fleets
 * POST   /fleet/register   — Register a project directory for fleet management
 * GET    /fleet/events     — SSE stream of all fleet lifecycle events
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { createFleetDaemon } from '../lib/fleet-daemon.js';
import {
  BUILTIN_MODEL_TIERS,
  findFleetConfigPath,
  loadFleetConfig,
  validateTopology,
  type FleetConfig,
} from '../lib/fleet-engine.js';
import { resolveFleetChannel } from '../lib/fleet-channels.js';
import { assessBackendReadiness } from '../lib/backend-readiness.js';
import {
  canOpenConnection,
  trackConnection,
  untrackConnection,
} from '../shared/connection-tracking.js';

interface FleetRouteDeps {
  fleetDaemon: ReturnType<typeof createFleetDaemon>;
  messaging: {
    subscribe(channel: string, callback: (msg: unknown) => void): (() => void) | null;
  };
}

const BACKEND_CATALOG = [
  { id: 'claude-cli', name: 'Claude CLI', models: ['haiku', 'sonnet', 'opus'] },
  { id: 'claude', name: 'Claude SDK', models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805'] },
  { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.0-flash-exp', 'gemini-2.5-flash', 'gemini-2.5-pro'] },
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

export const fleetPlugin: FastifyPluginAsync<{ deps: FleetRouteDeps }> = async (fastify, opts) => {
  const { fleetDaemon, messaging } = opts.deps;

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
    const { projectDir } = (request.body as { projectDir?: string }) || {};

    if (projectDir) {
      const result = fleetDaemon.startProject(projectDir);
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
    const fleet = resolveFleetRecord(project, reply);
    if (!fleet) return null;
    const configPath = findFleetConfigPath(fleet.projectDir);
    if (!configPath) { reply.code(404).send({ success: false, error: 'No pd-fleet.yml found' }); return null; }
    return { fleet, configPath };
  }

  // GET /fleet/config/:project — raw YAML + parsed config + topology validation
  fastify.get('/fleet/config/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    const resolved = resolveFleetConfig((request.params as { project: string }).project, reply);
    if (!resolved) return;
    const { fleet, configPath } = resolved;
    const yaml = readFileSync(configPath, 'utf-8');
    const parsed = loadFleetConfig(fleet.projectDir);
    const topology = parsed ? validateTopology(parsed) : null;
    const resolvedChannels = parsed ? buildResolvedChannels(parsed, fleet.projectDir) : {};
    return { success: true, yaml, path: configPath, projectDir: fleet.projectDir, parsed, topology, resolvedChannels };
  });

  // PUT /fleet/config/:project — write YAML, validate, reload
  fastify.put('/fleet/config/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    const { yaml } = (request.body as { yaml?: string }) || {};
    if (!yaml || typeof yaml !== 'string') { reply.code(400); return { success: false, error: 'yaml required' }; }
    const resolved = resolveFleetConfig((request.params as { project: string }).project, reply);
    if (!resolved) return;
    const { fleet, configPath } = resolved;
    try {
      const test = parseYaml(yaml);
      if (!test || typeof test !== 'object') { reply.code(400); return { success: false, error: 'Invalid YAML object' }; }
    } catch (err) { reply.code(400); return { success: false, error: `Parse error: ${(err as Error).message}` }; }
    writeFileSync(configPath, yaml, 'utf-8');
    fleetDaemon.reload();
    const newParsed = loadFleetConfig(fleet.projectDir);
    const topology = newParsed ? validateTopology(newParsed) : null;
    return { success: true, topology };
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
        };
      })
    );

    return { success: true, backends };
  });

  // GET /fleet/events — SSE stream of fleet lifecycle events
  fastify.get('/fleet/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp: string = request.ip || 'unknown';

    if (!canOpenConnection(clientIp, 'sse')) {
      reply.code(429);
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
