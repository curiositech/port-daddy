/**
 * Fleet Daemon — Always-On Fleet Subsystem
 *
 * Runs inside the Port Daddy daemon process. Scans registered projects
 * for pd-fleet.yml configs and starts FleetRunners that survive terminal
 * closes, system sleep, and restarts (via launchd KeepAlive).
 *
 * The fleet is infrastructure, not a command you remember to run.
 *
 * Architecture:
 *   daemon boot → fleetDaemon.start() → scan projects → load configs → start runners
 *   SIGTERM     → fleetDaemon.stop()  → stopAll runners → graceful drain
 *   SIGHUP      → fleetDaemon.reload() → re-read configs → restart changed fleets
 *
 * Events are published to identity channels so menu bar / dashboard
 * can subscribe to wildcard patterns like *:fleet:* for global view.
 */

import { readFileSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { join, basename } from 'node:path';
import {
  loadFleetConfig,
  createFleetRunner,
  validateTopology,
  findFleetConfigPath,
  type FleetConfig,
  type FleetEvent,
} from './fleet-engine.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FleetDaemonDeps {
  /** Registered projects module (for scanning) */
  projects: {
    list(options?: { pattern?: string }): Array<{ id: string; root: string; tags?: string[] | null }>;
  };
  /** Pub/sub messaging (for lifecycle events) */
  messaging: {
    publish(channel: string, message: unknown): unknown;
  };
  /** Winston logger */
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Daemon's own project directory (always load its own fleet) */
  daemonDir: string;
}

interface ManagedFleet {
  projectDir: string;
  projectName: string;
  config: FleetConfig;
  runner: ReturnType<typeof createFleetRunner>;
  startedAt: number;
}

export interface FleetDaemonStatus {
  running: boolean;
  startedAt: number | null;
  fleets: Array<{
    project: string;
    projectDir: string;
    agents: Array<{ name: string; type: string; running: boolean; uptime: number }>;
    watchers: number;
    channels: number;
    startedAt: number;
  }>;
  totalAgents: number;
  totalWatchers: number;
}

// ─── Env Loading ────────────────────────────────────────────────────────────

/**
 * Load .env.local / .env files for API keys.
 * The daemon process may not have ANTHROPIC_API_KEY etc. in its launchd env,
 * so we load from the project directory and common locations.
 */
function loadEnvFiles(projectDir: string): void {
  const searchDirs = [
    projectDir,
    process.env.HOME || '',
  ];

  const fileNames = ['.env.local', '.env', '.port-daddy-env'];

  for (const dir of searchDirs) {
    if (!dir) continue;
    for (const name of fileNames) {
      try {
        const lines = readFileSync(join(dir, name), 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          // Don't overwrite existing env vars (explicit launchd config takes priority)
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      } catch {
        // Non-critical — file likely doesn't exist
      }
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createFleetDaemon(deps: FleetDaemonDeps) {
  const { projects, messaging, logger, daemonDir } = deps;
  const fleets = new Map<string, ManagedFleet>();
  const configWatchers = new Map<string, FSWatcher>();
  let isRunning = false;
  let startedAt: number | null = null;

  // ─── Event handler: publish to identity channels ────────────────────────

  function handleEvent(event: FleetEvent): void {
    // Publish to the agent's identity channel for targeted subscriptions
    if (event.identity) {
      messaging.publish(event.identity, {
        type: event.type,
        agent: event.agent,
        project: event.project,
        timestamp: event.timestamp,
        details: event.details,
      });
    }

    // Also publish to the fleet-wide channel for global subscribers
    messaging.publish('fleet:events', {
      type: event.type,
      agent: event.agent,
      identity: event.identity,
      project: event.project,
      timestamp: event.timestamp,
      details: event.details,
    });

    // Log lifecycle events
    const level = event.type === 'agent_failed' ? 'warn' : 'info';
    logger[level](`fleet_${event.type}`, {
      agent: event.agent,
      identity: event.identity,
      project: event.project,
      ...event.details,
    });
  }

  // ─── Load a single project's fleet ──────────────────────────────────────

  function loadProject(projectDir: string): ManagedFleet | null {
    const config = loadFleetConfig(projectDir);
    if (!config) return null;

    // Validate topology (no cycles in trigger graph)
    const topo = validateTopology(config);
    if (!topo.valid) {
      logger.warn('fleet_topology_invalid', {
        project: config.name,
        cycles: topo.cycles,
      });
      // Still start — cycles are a warning, not a hard block
    }
    for (const w of topo.warnings) {
      logger.warn('fleet_topology_warning', { project: config.name, warning: w });
    }

    const runner = createFleetRunner(config, projectDir, { onEvent: handleEvent });

    return {
      projectDir,
      projectName: config.name,
      config,
      runner,
      startedAt: Date.now(),
    };
  }

  // ─── Scan and discover fleet configs ────────────────────────────────────

  function discoverFleets(): Array<{ dir: string; name: string }> {
    const discovered: Array<{ dir: string; name: string }> = [];

    // 1. Always check the daemon's own directory
    if (findFleetConfigPath(daemonDir)) {
      discovered.push({ dir: daemonDir, name: basename(daemonDir) });
    }

    // 2. Scan registered projects
    try {
      const registered = projects.list();
      for (const proj of registered) {
        if (proj.root === daemonDir) continue; // already added
        if (findFleetConfigPath(proj.root)) {
          discovered.push({ dir: proj.root, name: proj.id });
        }
      }
    } catch (err) {
      logger.error('fleet_project_scan_failed', { error: (err as Error).message });
    }

    return discovered;
  }

  // ─── Config File Watcher (edit mid-sail → auto-reload) ──────────────────

  function watchConfig(projectDir: string): void {
    const configPath = findFleetConfigPath(projectDir);
    if (!configPath) return;

    // Don't double-watch
    if (configWatchers.has(projectDir)) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      const watcher = fsWatch(configPath, () => {
        // Debounce: collapse rapid saves (editor save + formatter = 2 events)
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          logger.info('fleet_config_changed', { project: projectDir, file: configPath });

          // Load new config first — only stop old runner if replacement is ready
          loadEnvFiles(projectDir);
          const managed = loadProject(projectDir);
          if (managed) {
            const existing = fleets.get(projectDir);
            if (existing) {
              try { existing.runner.stopAll(); } catch {}
            }
            managed.runner.startAll();
            fleets.set(projectDir, managed);
            logger.info('fleet_reloaded', {
              project: managed.projectName,
              agents: managed.config.agents.length,
              watchers: managed.config.watchers.length,
            });
            messaging.publish('fleet:events', {
              type: 'fleet_reloaded',
              project: managed.projectName,
              timestamp: Date.now(),
              agents: managed.config.agents.length,
            });
          } else {
            logger.warn('fleet_reload_skipped', {
              project: projectDir,
              reason: 'config parse failed — keeping existing fleet',
            });
          }
        }, 500);
      });

      configWatchers.set(projectDir, watcher);
    } catch (err) {
      logger.warn('fleet_config_watch_failed', {
        project: projectDir,
        error: (err as Error).message,
      });
    }
  }

  function unwatchAll(): void {
    for (const [, watcher] of configWatchers) {
      try { watcher.close(); } catch {}
    }
    configWatchers.clear();
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /** Start all discovered fleets. Called from daemon onReady(). */
  function start(): void {
    if (isRunning) return;

    const discovered = discoverFleets();
    logger.info('fleet_daemon_starting', {
      projects: discovered.map(d => d.name),
      count: discovered.length,
    });

    for (const { dir } of discovered) {
      loadEnvFiles(dir);
      const managed = loadProject(dir);
      if (managed) {
        managed.runner.startAll();
        fleets.set(dir, managed);
        watchConfig(dir); // Auto-reload on pd-fleet.yml change
        logger.info('fleet_started', {
          project: managed.projectName,
          agents: managed.config.agents.length,
          watchers: managed.config.watchers.length,
        });
      }
    }

    isRunning = true;
    startedAt = Date.now();
    logger.info('fleet_daemon_ready', { fleets: fleets.size });
  }

  /** Stop all fleets. Called from daemon shutdown(). */
  function stop(): void {
    if (!isRunning) return;

    unwatchAll();
    logger.info('fleet_daemon_stopping', { fleets: fleets.size });
    for (const [dir, managed] of fleets) {
      try {
        managed.runner.stopAll();
        logger.info('fleet_stopped', { project: managed.projectName });
      } catch (err) {
        logger.error('fleet_stop_failed', {
          project: managed.projectName,
          error: (err as Error).message,
        });
      }
    }
    fleets.clear();
    isRunning = false;
    startedAt = null;
  }

  /** Reload all fleet configs (SIGHUP equivalent). */
  function reload(): void {
    logger.info('fleet_daemon_reloading');
    stop();
    start();
  }

  /** Start a specific project's fleet by directory path. */
  function startProject(projectDir: string): { success: boolean; error?: string } {
    if (fleets.has(projectDir)) {
      return { success: false, error: `Fleet already running for ${projectDir}` };
    }
    loadEnvFiles(projectDir);
    const managed = loadProject(projectDir);
    if (!managed) {
      return { success: false, error: `No pd-fleet.yml found in ${projectDir}` };
    }
    managed.runner.startAll();
    fleets.set(projectDir, managed);
    watchConfig(projectDir);
    if (!isRunning) {
      isRunning = true;
      startedAt = Date.now();
    }
    return { success: true };
  }

  /** Stop a specific project's fleet. */
  function stopProject(projectDir: string): { success: boolean; error?: string } {
    const managed = fleets.get(projectDir);
    if (!managed) {
      return { success: false, error: `No fleet running for ${projectDir}` };
    }
    managed.runner.stopAll();
    fleets.delete(projectDir);
    const watcher = configWatchers.get(projectDir);
    if (watcher) { try { watcher.close(); } catch {} configWatchers.delete(projectDir); }
    if (fleets.size === 0) {
      isRunning = false;
      startedAt = null;
    }
    return { success: true };
  }

  /** Get aggregated status across all fleets. */
  function getStatus(): FleetDaemonStatus {
    const fleetList = [];
    let totalAgents = 0;
    let totalWatchers = 0;

    for (const [, managed] of fleets) {
      const agentStatus = managed.runner.getStatus();
      const watcherCount = managed.config.watchers.length;
      totalAgents += agentStatus.length;
      totalWatchers += watcherCount;

      fleetList.push({
        project: managed.projectName,
        projectDir: managed.projectDir,
        agents: agentStatus,
        watchers: watcherCount,
        channels: Object.keys(managed.config.channels).length,
        startedAt: managed.startedAt,
      });
    }

    return {
      running: isRunning,
      startedAt,
      fleets: fleetList,
      totalAgents,
      totalWatchers,
    };
  }

  /** List all managed project directories. */
  function listProjects(): string[] {
    return [...fleets.keys()];
  }

  return {
    start,
    stop,
    reload,
    startProject,
    stopProject,
    getStatus,
    listProjects,
  };
}
