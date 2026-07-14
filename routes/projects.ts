/**
 * Projects & Scan Routes
 *
 * POST /scan         - Deep scan directory, register project, return results + guidance
 * GET  /projects     - List all known Port Daddy projects
 * GET  /projects/:id - Get project details
 * DELETE /projects/:id - Remove a project
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { scanProject, buildConfigFromScan } from '../lib/scan.js';
import { saveConfig } from '../lib/config.js';
import type { PortDaddyRcConfig } from '../lib/config.js';
import { loadFleetConfig, validateTopology } from '../lib/fleet-engine.js';
import type { Transcripts } from '../lib/transcripts.js';
import {
  buildTranscriptEmergencyFromSources,
  type TranscriptEmergencyReport,
  type TranscriptEmergencySourceDeps,
} from '../lib/transcript-emergency.js';

interface ProjectEntry {
  id: string;
  root: string;
  type: string;
  services: Record<string, unknown> | null;
  config: unknown;
  last_scanned: string;
  created_at: string;
  metadata: { frameworks?: string[]; [key: string]: unknown } | null;
  displayName?: string;
  signals?: string[];
  sources?: string[];
  exists?: boolean;
  worktree?: {
    id: string;
    name: string;
    branch: string | null;
    isMain: boolean;
    repoKey: string;
    repoRoot: string | null;
    siblingCount: number;
  } | null;
}

type FleetConfigStatus = 'ready' | 'missing_budget' | 'invalid' | 'missing';
type ProjectOperatorState = 'running' | 'ready' | 'blocked' | 'service_only' | 'context_only' | 'missing';
type ProjectRemediationAction = 'start_fleet' | 'set_budget' | 'fix_yaml' | 'create_fleet' | 'run_scan';

const PROJECTS_ROUTE_CACHE_TTL_MS = 2_000;

interface ProjectRemediation {
  action: ProjectRemediationAction;
  title: string;
  detail: string;
  command?: string;
  suggestedBudgetUsdPerDay?: number;
}

interface ProjectReadiness {
  operatorState: ProjectOperatorState;
  operatorSummary: string;
  operatorNextAction: string;
  fleetConfigStatus: FleetConfigStatus;
  budgetUsdPerDay: number | null;
  configError: string | null;
  configWarnings: string[];
  remediation: ProjectRemediation | null;
  transcriptEmergency?: TranscriptEmergencyReport;
}

interface ProjectsRouteDeps {
  projects: {
    register(entry: Record<string, unknown>): void;
    get(id: string): ProjectEntry | undefined;
    list(options?: { pattern?: string }): ProjectEntry[];
    listKnown?(options?: {
      pattern?: string;
      runtimeRoots?: string[];
      serviceRoots?: string[];
      discoveryRoots?: string[];
      maxDepth?: number;
    }): ProjectEntry[];
    remove(id: string): boolean;
  };
  services?: {
    list?(): {
      services: Array<{ cwd?: string | null }>;
    };
    find?(pattern?: string, options?: Record<string, unknown>): {
      success?: boolean;
      services?: Array<{ cwd?: string | null }>;
    };
  };
  fleetDaemon?: {
    getStatus(): {
      fleets: Array<{ projectDir: string }>;
    };
  };
  transcripts?: Pick<Transcripts, 'listTranscripts' | 'getTranscript'>;
  spawner?: TranscriptEmergencySourceDeps['spawner'];
  cloudAppTelemetry?: TranscriptEmergencySourceDeps['cloudAppTelemetry'];
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  activityLog: {
    log?(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
  };
}

/**
 * Create projects routes
 *
 * @param deps - Route dependencies
 * @returns Express router with project routes
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const projectsPlugin: FastifyPluginAsync<{ deps: ProjectsRouteDeps }> = async (fastify, opts) => {
  const { projects, metrics, logger, activityLog } = opts.deps;
  let projectsRouteCache: {
    key: string;
    expiresAt: number;
    body: unknown;
  } | null = null;

  function invalidateProjectsRouteCache(): void {
    projectsRouteCache = null;
  }

  function cacheKeyForProjectsRoute(pattern: string | undefined): string {
    return JSON.stringify({ pattern: pattern ?? '' });
  }

  function shellQuotePath(path: string): string {
    return `'${path.replace(/'/g, `'\\''`)}'`;
  }

  function buildProjectReadiness(
    project: ProjectEntry,
    running: boolean,
    config: ReturnType<typeof loadFleetConfig>,
    configError: string | null,
    transcriptEmergency?: TranscriptEmergencyReport,
  ): ProjectReadiness {
    const signals = project.signals ?? [];
    const hasFleetSignal = signals.includes('fleet');
    const hasServiceConfig = signals.includes('config');
    const hasContext = signals.includes('context');
    const budgetUsdPerDay = config?.limits?.budgetUsdPerDay ?? null;
    const configWarnings = config ? validateTopology(config).warnings : [];
    const cd = `cd ${shellQuotePath(project.root)}`;

    function foldTranscriptEmergency(readiness: ProjectReadiness): ProjectReadiness {
      if (!transcriptEmergency?.hitlEmergency) return readiness;
      const emergencyNextAction = 'Open /transcripts/emergency and restore transcript flow before launching more agents.';
      return {
        ...readiness,
        transcriptEmergency,
        operatorSummary: `Transcript emergency: ${transcriptEmergency.summary.hitl} HITL issue${transcriptEmergency.summary.hitl === 1 ? '' : 's'} need attention. ${readiness.operatorSummary}`,
        operatorNextAction: readiness.operatorNextAction
          ? `${readiness.operatorNextAction} ${emergencyNextAction}`
          : emergencyNextAction,
      };
    }

    if (configError) {
      return foldTranscriptEmergency({
        operatorState: 'blocked',
        operatorSummary: 'Fleet YAML is present but cannot be parsed.',
        operatorNextAction: 'Fix pd-fleet.yml before starting this fleet.',
        fleetConfigStatus: 'invalid',
        budgetUsdPerDay,
        configError,
        configWarnings,
        remediation: {
          action: 'fix_yaml',
          title: 'Fix fleet YAML',
          detail: configError,
          command: `${cd}\npd fleet validate`,
        },
      });
    }

    if (config && config.agents.length > 0 && budgetUsdPerDay === null) {
      return foldTranscriptEmergency({
        operatorState: 'blocked',
        operatorSummary: `${config.agents.length} agents configured, but launches fail closed without limits.budget_usd_per_day.`,
        operatorNextAction: 'Set a positive daily budget, then start the fleet.',
        fleetConfigStatus: 'missing_budget',
        budgetUsdPerDay,
        configError: null,
        configWarnings,
        remediation: {
          action: 'set_budget',
          title: 'Set $5/day budget',
          detail: 'Adds limits.budget_usd_per_day: 5 to pd-fleet.yml so agent launches are allowed.',
          command: `${cd}\n# Add under fleet.limits or limits:\n# budget_usd_per_day: 5\npd fleet validate\npd fleet up`,
          suggestedBudgetUsdPerDay: 5,
        },
      });
    }

    if (config) {
      return foldTranscriptEmergency({
        operatorState: running ? 'running' : 'ready',
        operatorSummary: running
          ? `${config.agents.length} configured agents are visible to the daemon.`
          : `${config.agents.length} agents configured and budgeted; fleet is stopped.`,
        operatorNextAction: running ? 'Inspect agents, channels, and recent work.' : 'Start this fleet on the current daemon.',
        fleetConfigStatus: 'ready',
        budgetUsdPerDay,
        configError: null,
        configWarnings,
        remediation: running ? null : {
          action: 'start_fleet',
          title: 'Start fleet',
          detail: 'Starts this pd-fleet.yml on the current daemon.',
          command: `${cd}\npd fleet up`,
        },
      });
    }

    if (hasFleetSignal) {
      return foldTranscriptEmergency({
        operatorState: 'blocked',
        operatorSummary: 'Fleet marker exists, but no usable fleet config was loaded.',
        operatorNextAction: 'Open pd-fleet.yml and validate it.',
        fleetConfigStatus: 'invalid',
        budgetUsdPerDay: null,
        configError: 'pd-fleet.yml is empty or did not parse to a fleet object',
        configWarnings,
        remediation: {
          action: 'fix_yaml',
          title: 'Validate fleet YAML',
          detail: 'Port Daddy found a fleet marker but could not load a usable config.',
          command: `${cd}\npd fleet validate`,
        },
      });
    }

    if (hasServiceConfig) {
      return foldTranscriptEmergency({
        operatorState: 'service_only',
        operatorSummary: 'This repo has pd up service config, but no agent fleet yet.',
        operatorNextAction: 'Create pd-fleet.yml when you want agent automation here.',
        fleetConfigStatus: 'missing',
        budgetUsdPerDay: null,
        configError: null,
        configWarnings,
        remediation: {
          action: 'create_fleet',
          title: 'Create starter fleet',
          detail: '.portdaddyrc remains useful for service orchestration; pd-fleet.yml is the agent control surface.',
          command: `${cd}\npd fleet init\npd fleet up`,
        },
      });
    }

    if (hasContext) {
      return foldTranscriptEmergency({
        operatorState: 'context_only',
        operatorSummary: 'Only Port Daddy context state was found.',
        operatorNextAction: 'Add .portdaddyrc or pd-fleet.yml to make this actionable.',
        fleetConfigStatus: 'missing',
        budgetUsdPerDay: null,
        configError: null,
        configWarnings,
        remediation: {
          action: 'run_scan',
          title: 'Scan project',
          detail: 'Generate .portdaddyrc service config first, or create pd-fleet.yml for agents.',
          command: `${cd}\npd scan\npd fleet init`,
        },
      });
    }

    return foldTranscriptEmergency({
      operatorState: 'missing',
      operatorSummary: 'No actionable Port Daddy config was found.',
      operatorNextAction: 'Run pd scan or create pd-fleet.yml.',
      fleetConfigStatus: 'missing',
      budgetUsdPerDay: null,
      configError: null,
      configWarnings,
      remediation: {
        action: 'run_scan',
        title: 'Initialize project',
        detail: 'Create durable Port Daddy config so this repo can be managed.',
        command: `${cd}\npd scan\npd fleet init`,
      },
    });
  }

  function extractServiceRoots(): string[] {
    const servicesDep = opts.deps.services;
    if (!servicesDep) return [];

    if (typeof servicesDep.list === 'function') {
      return servicesDep.list().services
        .map((service) => service.cwd ?? null)
        .filter((cwd): cwd is string => typeof cwd === 'string' && cwd.trim().length > 0);
    }

    if (typeof servicesDep.find === 'function') {
      const result = servicesDep.find('*', { limit: 500 });
      if (!result?.success || !Array.isArray(result.services)) return [];
      return result.services
        .map((service) => service.cwd ?? null)
        .filter((cwd): cwd is string => typeof cwd === 'string' && cwd.trim().length > 0);
    }

    return [];
  }

  // POST /scan - Deep scan a directory for services
  fastify.post('/scan', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { dir, save = true, dryRun = false, useBranch = false } = request.body as any;
      const targetDir: string = dir || process.cwd();

      const result = scanProject(targetDir, { useBranch });
      const config = buildConfigFromScan(result);

      if (!dryRun) {
        projects.register({
          id: result.project,
          root: result.root,
          type: result.type,
          config,
          services: result.services,
          metadata: {
            workspaceType: result.workspaceType,
            serviceCount: result.serviceCount,
            frameworks: Object.values(result.services).map((s: Record<string, unknown>) => (s.stack as Record<string, unknown>).name)
          }
        });
        invalidateProjectsRouteCache();
      }

      let savedPath: string | null = null;
      if (save && !dryRun && result.serviceCount > 0) {
        savedPath = saveConfig(config as PortDaddyRcConfig, targetDir);
      }

      logger.info('project_scanned', {
        project: result.project,
        type: result.type,
        serviceCount: result.serviceCount,
        saved: !!savedPath
      });

      if (activityLog?.log) {
        activityLog.log('project_scan', {
          details: `Scanned ${result.project}: ${result.serviceCount} services found`,
          metadata: { project: result.project, type: result.type }
        });
      }

      return {
        success: true,
        project: result.project,
        root: result.root,
        type: result.type,
        serviceCount: result.serviceCount,
        services: Object.fromEntries(
          Object.entries(result.services).map(([name, svc]: [string, Record<string, unknown>]) => [
            name,
            {
              dir: svc.relativePath || svc.dir,
              framework: (svc.stack as Record<string, unknown>).name,
              dev: svc.dev,
              health: svc.health,
              preferredPort: svc.preferredPort
            }
          ])
        ),
        suggestions: result.suggestions,
        config,
        saved: !!savedPath,
        savedPath,
        dryRun,
        guidance: result.guidance,
        existingConfig: result.existingConfig ? {
          path: (result.existingConfig as Record<string, unknown>)._path,
          serviceCount: Object.keys((result.existingConfig as Record<string, unknown>).services || {}).length
        } : null
      };
    } catch (error) {
      metrics.errors++;
      logger.error('scan_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /projects - List all known Port Daddy projects
  fastify.get('/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pattern } = request.query as any;
      const normalizedPattern = typeof pattern === 'string' ? pattern : undefined;
      const cacheKey = cacheKeyForProjectsRoute(normalizedPattern);
      const now = Date.now();
      if (projectsRouteCache && projectsRouteCache.key === cacheKey && projectsRouteCache.expiresAt > now) {
        return projectsRouteCache.body;
      }

      const runtimeRoots = opts.deps.fleetDaemon?.getStatus().fleets.map((fleet) => fleet.projectDir) ?? [];
      const serviceRoots = extractServiceRoots();

      const all = projects.listKnown
        ? projects.listKnown({
            pattern: normalizedPattern,
            runtimeRoots,
            serviceRoots,
          })
        : projects.list({
            pattern: normalizedPattern
          });

      const runningRoots = new Set(runtimeRoots);
      const readinessByRoot = new Map<string, ProjectReadiness>();
      const fleetConfigByRoot = new Map<string, ReturnType<typeof loadFleetConfig>>();
      const transcriptEmergency = buildTranscriptEmergencyFromSources(opts.deps);

      for (const project of all) {
        let config: ReturnType<typeof loadFleetConfig> = null;
        let configError: string | null = null;
        try {
          config = loadFleetConfig(project.root);
        } catch (err) {
          configError = (err as Error).message;
        }
        fleetConfigByRoot.set(project.root, config);
        readinessByRoot.set(
          project.root,
          buildProjectReadiness(project, runningRoots.has(project.root), config, configError, transcriptEmergency),
        );
      }

      const body = {
        success: true,
        count: all.length,
        projects: all.map((p: ProjectEntry) => ({
          id: p.id,
          displayName: p.displayName || p.id,
          root: p.root,
          type: p.type,
          serviceCount: p.services ? Object.keys(p.services).length : 0,
          lastScanned: p.last_scanned,
          createdAt: p.created_at,
          frameworks: p.metadata?.frameworks || [],
          signals: p.signals || [],
          sources: p.sources || ['registered'],
          exists: p.exists ?? true,
          worktree: p.worktree ?? null,
          running: runningRoots.has(p.root),
          configuredAgentCount: fleetConfigByRoot.get(p.root)?.agents.length ?? 0,
          configuredWatcherCount: fleetConfigByRoot.get(p.root)?.watchers.length ?? 0,
          ...readinessByRoot.get(p.root),
        }))
      };
      projectsRouteCache = {
        key: cacheKey,
        expiresAt: Date.now() + PROJECTS_ROUTE_CACHE_TTL_MS,
        body,
      };
      return body;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /projects/:id - Get project details
  fastify.get('/projects/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const project = projects.get((request.params as any).id as string);

      if (!project) {
        reply.code(404);
        return {
          success: false,
          error: 'Project not found',
          suggestion: 'Run port-daddy scan from the project directory'
        };
      }

      return {
        success: true,
        project: {
          id: project.id,
          root: project.root,
          type: project.type,
          config: project.config,
          services: project.services,
          lastScanned: project.last_scanned,
          createdAt: project.created_at,
          metadata: project.metadata
        }
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /projects/:id - Remove a project
  fastify.delete('/projects/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const removed = projects.remove((request.params as any).id as string);

      if (!removed) {
        reply.code(404);
        return {
          success: false,
          error: 'Project not found'
        };
      }

      logger.info('project_removed', { id: (request.params as any).id as string });
      invalidateProjectsRouteCache();

      return {
        success: true,
        message: `Project "${(request.params as any).id as string}" removed`
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
