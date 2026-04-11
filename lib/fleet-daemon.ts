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

import { createHash } from 'node:crypto';
import { readFileSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { join, basename } from 'node:path';
import {
  loadFleetConfig,
  createFleetRunner,
  validateTopology,
  findFleetConfigPath,
  type FleetConfig,
  type FleetEvent,
  type FleetRunContext,
} from './fleet-engine.js';
import type { CostTracker } from './cost-tracker.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FleetDaemonDeps {
  /** Registered projects module (for scanning) */
  projects: {
    list(options?: { pattern?: string }): Array<{ id: string; root: string; tags?: string[] | null }>;
  };
  /** Pub/sub messaging (for lifecycle events) */
  messaging: {
    publish(channel: string, message: unknown): unknown;
    subscribe(channel: string, callback: (message: unknown) => void): (() => void) | null;
  };
  /** Winston logger */
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Daemon's own project directory (always load its own fleet) */
  daemonDir: string;
  /** Optional cost tracker for fleet budget enforcement */
  costTracker?: CostTracker;
  /** Distributed lock manager used to enforce fleet ownership across daemons */
  locks: {
    acquire(name: string, options?: {
      owner?: string;
      pid?: number;
      ttl?: number;
      metadata?: Record<string, unknown> | null;
    }): {
      success: boolean;
      error?: string;
      holder?: string;
      expiresAt?: number | null;
    };
    release(name: string, options?: {
      owner?: string | null;
      force?: boolean;
    }): {
      success: boolean;
      error?: string;
      holder?: string;
    };
    extend(name: string, options?: {
      owner?: string | null;
      ttl?: number;
    }): {
      success: boolean;
      error?: string;
      expiresAt?: number;
    };
    check(name: string): {
      success: boolean;
      held?: boolean;
      owner?: string;
      expiresAt?: number | null;
      metadata?: Record<string, unknown> | null;
      error?: string;
    };
  };
}

interface ManagedFleet {
  projectDir: string;
  projectName: string;
  config: FleetConfig;
  runner: ReturnType<typeof createFleetRunner>;
  startedAt: number;
}

interface FleetProjectLease {
  lockName: string;
  owner: string;
  projectDir: string;
  projectName: string;
}

interface SkippedFleet {
  project: string;
  projectDir: string;
  reason: string;
  owner: string | null;
}

export interface FleetDaemonStatus {
  running: boolean;
  startedAt: number | null;
  fleets: Array<{
    project: string;
    projectDir: string;
    running: boolean;
    agents: Array<{ name: string; type: string; status: string; running: boolean; paused: boolean; uptime: number; queueDepth: number }>;
    watchers: number;
    channels: number;
    startedAt: number;
  }>;
  skipped: SkippedFleet[];
  totalAgents: number;
  totalWatchers: number;
}

const FLEET_PROJECT_LEASE_TTL_MS = 30000;
const FLEET_PROJECT_LEASE_RENEW_MS = 10000;

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
  const { projects, messaging, logger, daemonDir, costTracker, locks } = deps;
  const fleets = new Map<string, ManagedFleet>();
  const configWatchers = new Map<string, FSWatcher>();
  const projectLeases = new Map<string, FleetProjectLease>();
  const projectPausedAgents = new Map<string, Set<string>>();
  const skippedProjects = new Map<string, SkippedFleet>();
  let isRunning = false;
  let startedAt: number | null = null;
  let leaseRenewTimer: ReturnType<typeof setInterval> | null = null;

  const daemonOwner = [
    'fleetd',
    sanitizeToken(basename(daemonDir) || 'daemon'),
    sanitizeToken(process.env.PORT_DADDY_PORT || process.env.PORT || 'unknown'),
    String(process.pid),
  ].join(':');

  // ─── Recent event ring buffer per project (for prompt endpoint) ─────────
  const MAX_RECENT = 20;
  const recentEvents = new Map<string, FleetEvent[]>();

  function recordEvent(event: FleetEvent): void {
    const project = event.project || '_global';
    let ring = recentEvents.get(project);
    if (!ring) { ring = []; recentEvents.set(project, ring); }
    ring.push(event);
    if (ring.length > MAX_RECENT) ring.shift();
  }

  // ─── Event handler: publish to identity channels ────────────────────────

  function handleEvent(event: FleetEvent): void {
    recordEvent(event);
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

  function sanitizeToken(value: string): string {
    return value.replace(/[^a-zA-Z0-9._:-]/g, '_');
  }

  function getProjectLeaseName(projectDir: string): string {
    const digest = createHash('sha256')
      .update(projectDir.replace(/\\/g, '/'))
      .digest('hex')
      .slice(0, 16);
    return `fleet:project:${digest}`;
  }

  function clearSkippedProject(projectDir: string): void {
    skippedProjects.delete(projectDir);
  }

  function updateLeaseName(projectDir: string, projectName: string): void {
    const lease = projectLeases.get(projectDir);
    if (lease) lease.projectName = projectName;
  }

  function markSkippedProject(projectDir: string, projectName: string, reason: string, owner: string | null = null): void {
    skippedProjects.set(projectDir, {
      project: projectName,
      projectDir,
      reason,
      owner,
    });
  }

  function stopLeaseRenewalIfIdle(): void {
    if (leaseRenewTimer && projectLeases.size === 0) {
      clearInterval(leaseRenewTimer);
      leaseRenewTimer = null;
    }
  }

  function unwatchProject(projectDir: string): void {
    const watcher = configWatchers.get(projectDir);
    if (!watcher) return;
    try { watcher.close(); } catch {}
    configWatchers.delete(projectDir);
  }

  function releaseProjectLease(projectDir: string): void {
    const lease = projectLeases.get(projectDir);
    if (!lease) return;

    const result = locks.release(lease.lockName, { owner: lease.owner });
    if (!result.success) {
      logger.warn('fleet_project_lease_release_failed', {
        project: lease.projectName,
        projectDir,
        holder: result.holder,
        error: result.error,
      });
    }

    projectLeases.delete(projectDir);
    stopLeaseRenewalIfIdle();
  }

  function tryReacquireProjectLease(lease: FleetProjectLease): { success: boolean; holder?: string | null; error?: string } {
    const result = locks.acquire(lease.lockName, {
      owner: lease.owner,
      pid: process.pid,
      ttl: FLEET_PROJECT_LEASE_TTL_MS,
      metadata: {
        projectDir: lease.projectDir,
        projectName: lease.projectName,
        daemonOwner,
        daemonDir,
        daemonPort: process.env.PORT_DADDY_PORT || process.env.PORT || null,
      },
    });

    if (!result.success) {
      return {
        success: false,
        holder: result.holder || null,
        error: result.error,
      };
    }

    projectLeases.set(lease.projectDir, lease);
    clearSkippedProject(lease.projectDir);
    logger.warn('fleet_project_lease_reacquired', {
      project: lease.projectName,
      projectDir: lease.projectDir,
      owner: lease.owner,
    });
    return { success: true };
  }

  function stopManagedFleet(projectDir: string, options: { releaseLease?: boolean } = {}): boolean {
    const { releaseLease = true } = options;
    const managed = fleets.get(projectDir);
    if (!managed) {
      if (releaseLease) releaseProjectLease(projectDir);
      return false;
    }

    try {
      managed.runner.stopAll();
      logger.info('fleet_stopped', { project: managed.projectName });
    } catch (err) {
      logger.error('fleet_stop_failed', {
        project: managed.projectName,
        error: (err as Error).message,
      });
    }

    fleets.delete(projectDir);
    unwatchProject(projectDir);
    if (releaseLease) releaseProjectLease(projectDir);
    return true;
  }

  function startLeaseRenewal(): void {
    if (leaseRenewTimer || projectLeases.size === 0) return;

    leaseRenewTimer = setInterval(() => {
      for (const [projectDir, lease] of projectLeases) {
        const result = locks.extend(lease.lockName, {
          owner: lease.owner,
          ttl: FLEET_PROJECT_LEASE_TTL_MS,
        });

        if (result.success) continue;

        const state = locks.check(lease.lockName);
        let holder = state.success && state.held ? state.owner || null : null;
        if (!holder) {
          const reacquired = tryReacquireProjectLease(lease);
          if (reacquired.success) continue;
          holder = reacquired.holder || null;
        }
        logger.warn('fleet_project_lease_lost', {
          project: lease.projectName,
          projectDir,
          holder,
          error: result.error,
        });
        markSkippedProject(
          projectDir,
          lease.projectName,
          holder
            ? `fleet lease lost to ${holder}`
            : `fleet lease lost: ${result.error || 'unknown'}`,
          holder,
        );
        stopManagedFleet(projectDir, { releaseLease: false });
        projectLeases.delete(projectDir);
      }

      stopLeaseRenewalIfIdle();
    }, FLEET_PROJECT_LEASE_RENEW_MS);
    leaseRenewTimer.unref?.();
  }

  function acquireProjectLease(projectDir: string, projectName: string): { success: boolean; error?: string } {
    const lockName = getProjectLeaseName(projectDir);
    const result = locks.acquire(lockName, {
      owner: daemonOwner,
      pid: process.pid,
      ttl: FLEET_PROJECT_LEASE_TTL_MS,
      metadata: {
        projectDir,
        projectName,
        daemonOwner,
        daemonDir,
        daemonPort: process.env.PORT_DADDY_PORT || process.env.PORT || null,
      },
    });

    if (!result.success) {
      const holder = result.holder || null;
      const reason = holder
        ? `fleet lease already held by ${holder}`
        : `fleet lease unavailable: ${result.error || 'unknown'}`;
      markSkippedProject(projectDir, projectName, reason, holder);
      logger.info('fleet_project_skipped', {
        project: projectName,
        projectDir,
        holder,
        reason,
      });
      return { success: false, error: reason };
    }

    projectLeases.set(projectDir, {
      lockName,
      owner: daemonOwner,
      projectDir,
      projectName,
    });
    clearSkippedProject(projectDir);
    startLeaseRenewal();
    return { success: true };
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

    const runner = createFleetRunner(config, projectDir, {
      onEvent: handleEvent,
      costTracker,
      initiallyPausedAgents: [...(projectPausedAgents.get(projectDir) ?? new Set<string>())],
      messaging: {
        subscribe: messaging.subscribe.bind(messaging),
      },
    });

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
    const discovered: Array<{ dir: string; name: string; source: 'daemon' | 'registered' }> = [];

    // 1. Always check the daemon's own directory
    if (findFleetConfigPath(daemonDir)) {
      discovered.push({ dir: daemonDir, name: basename(daemonDir), source: 'daemon' });
    }

    // 2. Scan registered projects
    try {
      const registered = projects.list();
      for (const proj of registered) {
        if (proj.root === daemonDir) continue; // already added
        if (findFleetConfigPath(proj.root)) {
          discovered.push({ dir: proj.root, name: proj.id, source: 'registered' });
        }
      }
    } catch (err) {
      logger.error('fleet_project_scan_failed', { error: (err as Error).message });
    }

    const preferred = new Map<string, { dir: string; name: string; source: 'daemon' | 'registered' }>();

    for (const candidate of discovered) {
      const config = loadFleetConfig(candidate.dir);
      const fleetName = config?.name || candidate.name;
      const existing = preferred.get(fleetName);

      if (!existing) {
        preferred.set(fleetName, { ...candidate, name: fleetName });
        clearSkippedProject(candidate.dir);
        continue;
      }

      const candidateWins = existing.source === 'daemon' && candidate.source === 'registered';
      if (candidateWins) {
        markSkippedProject(
          existing.dir,
          fleetName,
          `Skipped duplicate fleet "${fleetName}" in favor of registered project ${candidate.dir}`
        );
        preferred.set(fleetName, { ...candidate, name: fleetName });
        clearSkippedProject(candidate.dir);
        continue;
      }

      markSkippedProject(
        candidate.dir,
        fleetName,
        `Skipped duplicate fleet "${fleetName}" already managed from ${existing.dir}`
      );
    }

    return [...preferred.values()].map(({ dir, name }) => ({ dir, name }));
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
            updateLeaseName(projectDir, managed.projectName);
            clearSkippedProject(projectDir);
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
      const lease = acquireProjectLease(dir, basename(dir));
      if (!lease.success) continue;

      loadEnvFiles(dir);
      const managed = loadProject(dir);
      if (managed) {
        managed.runner.startAll();
        fleets.set(dir, managed);
        updateLeaseName(dir, managed.projectName);
        watchConfig(dir); // Auto-reload on pd-fleet.yml change
        clearSkippedProject(dir);
        logger.info('fleet_started', {
          project: managed.projectName,
          agents: managed.config.agents.length,
          watchers: managed.config.watchers.length,
        });
      } else {
        releaseProjectLease(dir);
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
    if (leaseRenewTimer) {
      clearInterval(leaseRenewTimer);
      leaseRenewTimer = null;
    }
    for (const dir of [...fleets.keys()]) {
      stopManagedFleet(dir, { releaseLease: true });
    }
    fleets.clear();
    projectLeases.clear();
    skippedProjects.clear();
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
  function startProject(projectDir: string, options: { enabledAgents?: string[] } = {}): { success: boolean; error?: string } {
    if (fleets.has(projectDir)) {
      if (options.enabledAgents) {
        return setProjectEnabledAgents(projectDir, options.enabledAgents);
      }
      return { success: false, error: `Fleet already running for ${projectDir}` };
    }
    const lease = acquireProjectLease(projectDir, basename(projectDir));
    if (!lease.success) {
      return { success: false, error: lease.error };
    }
    loadEnvFiles(projectDir);
    if (options.enabledAgents) {
      if (!loadFleetConfig(projectDir)) {
        releaseProjectLease(projectDir);
        return { success: false, error: `No pd-fleet.yml found in ${projectDir}` };
      }
      const subsetResult = setProjectEnabledAgents(projectDir, options.enabledAgents);
      if (!subsetResult.success) {
        releaseProjectLease(projectDir);
        return subsetResult;
      }
    } else {
      projectPausedAgents.delete(projectDir);
    }
    const managed = loadProject(projectDir);
    if (!managed) {
      releaseProjectLease(projectDir);
      return { success: false, error: `No pd-fleet.yml found in ${projectDir}` };
    }
    const duplicate = [...fleets.values()].find((fleet) => fleet.projectName === managed.projectName);
    if (duplicate) {
      markSkippedProject(
        projectDir,
        managed.projectName,
        `Skipped duplicate fleet "${managed.projectName}" already managed from ${duplicate.projectDir}`
      );
      releaseProjectLease(projectDir);
      return { success: false, error: `Duplicate fleet name "${managed.projectName}" already running from ${duplicate.projectDir}` };
    }
    managed.runner.startAll();
    fleets.set(projectDir, managed);
    updateLeaseName(projectDir, managed.projectName);
    watchConfig(projectDir);
    clearSkippedProject(projectDir);
    if (!isRunning) {
      isRunning = true;
      startedAt = Date.now();
    }
    return { success: true };
  }

  /** Stop a specific project's fleet. */
  function stopProject(projectDir: string): { success: boolean; error?: string } {
    if (!fleets.has(projectDir)) {
      return { success: false, error: `No fleet running for ${projectDir}` };
    }
    stopManagedFleet(projectDir, { releaseLease: true });
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
        running: true,
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
      skipped: [...skippedProjects.values()],
      totalAgents,
      totalWatchers,
    };
  }

  /** List all managed project directories. */
  function listProjects(): string[] {
    return [...fleets.keys()];
  }

  /** Get recent events for a project (for prompt endpoint). */
  function getRecentEvents(project: string, since?: number): FleetEvent[] {
    const ring = recentEvents.get(project);
    if (!ring) return [];
    if (since) return ring.filter(e => e.timestamp > since);
    return [...ring];
  }

  /**
   * Get a one-line prompt string for a project's fleet status.
   * Returns empty string if nothing worth showing.
   *
   * Format: "fleet: qa ✓  tests ✓  docs updated"
   * Only shows events since `since` timestamp (prevents stale output).
   */
  function getPromptLine(project: string, since?: number): string {
    // Find the fleet by project name (not dir path)
    const managed = [...fleets.values()].find(f => f.projectName === project);
    if (!managed) return '';

    const cutoff = since || (Date.now() - 60000); // default: last 60 seconds
    const recent = getRecentEvents(project, cutoff);
    if (recent.length === 0) return '';

    // Collapse to latest event per agent
    const byAgent = new Map<string, FleetEvent>();
    for (const e of recent) {
      if (e.agent) byAgent.set(e.agent, e);
    }

    const parts: string[] = [];
    for (const [agent, event] of byAgent) {
      switch (event.type) {
        case 'agent_started':
          parts.push(`${agent} ...`);
          break;
        case 'agent_completed':
          parts.push(`${agent} \u2713`);
          break;
        case 'agent_failed': {
          const reason = (event.details as Record<string, unknown>)?.error;
          const short = typeof reason === 'string' ? reason.slice(0, 30) : 'failed';
          parts.push(`${agent} \u2717 ${short}`);
          break;
        }
        default:
          break;
      }
    }

    if (parts.length === 0) return '';
    return `fleet: ${parts.join('  ')}`;
  }

  function resolveManagedAgent(agentId: string, project?: string) {
    const candidates: Array<{
      managed: ManagedFleet;
      agentName: string;
    }> = [];

    for (const managed of fleets.values()) {
      if (project && managed.projectName !== project && managed.projectDir !== project) continue;

      for (const agent of managed.config.agents) {
        const defaultIdentity = `${managed.projectName}:fleet:${agent.name}`;
        if (
          agent.name === agentId ||
          agent.identity === agentId ||
          defaultIdentity === agentId
        ) {
          candidates.push({ managed, agentName: agent.name });
        }
      }
    }

    if (candidates.length === 0) {
      return { success: false as const, error: `No running fleet agent matches ${agentId}` };
    }

    if (candidates.length > 1) {
      return {
        success: false as const,
        error: `Agent "${agentId}" is ambiguous across ${candidates.length} fleets; specify a project`,
      };
    }

    return {
      success: true as const,
      managed: candidates[0].managed,
      agentName: candidates[0].agentName,
    };
  }

  async function hailAgent(agentId: string, context: FleetRunContext & { project?: string } = {}): Promise<{
    success: boolean;
    error?: string;
    project?: string;
    agent?: string;
  }> {
    const resolved = resolveManagedAgent(agentId, context.project);
    if (!resolved.success) {
      return { success: false, error: resolved.error };
    }

    const result = await resolved.managed.runner.hailAgent(resolved.agentName, context);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      project: resolved.managed.projectName,
      agent: resolved.agentName,
    };
  }

  function pauseAgent(agentId: string, project?: string): { success: boolean; error?: string; project?: string; agent?: string } {
    const resolved = resolveManagedAgent(agentId, project);
    if (!resolved.success) return { success: false, error: resolved.error };
    const result = resolved.managed.runner.pauseAgent(resolved.agentName);
    if (!result.success) return result;

    const paused = projectPausedAgents.get(resolved.managed.projectDir) ?? new Set<string>();
    paused.add(resolved.agentName);
    projectPausedAgents.set(resolved.managed.projectDir, paused);

    return {
      success: true,
      project: resolved.managed.projectName,
      agent: resolved.agentName,
    };
  }

  function resumeAgent(agentId: string, project?: string): { success: boolean; error?: string; project?: string; agent?: string } {
    const resolved = resolveManagedAgent(agentId, project);
    if (!resolved.success) return { success: false, error: resolved.error };
    const result = resolved.managed.runner.resumeAgent(resolved.agentName);
    if (!result.success) return result;

    const paused = projectPausedAgents.get(resolved.managed.projectDir);
    paused?.delete(resolved.agentName);
    if (paused && paused.size === 0) projectPausedAgents.delete(resolved.managed.projectDir);

    return {
      success: true,
      project: resolved.managed.projectName,
      agent: resolved.agentName,
    };
  }

  function setProjectEnabledAgents(projectDir: string, enabledAgents?: string[]): { success: boolean; error?: string } {
    const managed = fleets.get(projectDir);
    const config = managed?.config ?? loadFleetConfig(projectDir);
    if (!config) return { success: false, error: `No pd-fleet.yml found in ${projectDir}` };

    const allowed = new Set(config.agents.map((agent) => agent.name));
    const requested = new Set(enabledAgents ?? config.agents.map((agent) => agent.name));
    for (const name of requested) {
      if (!allowed.has(name)) return { success: false, error: `No agent named ${name}` };
    }

    const paused = new Set(config.agents.map((agent) => agent.name).filter((name) => !requested.has(name)));
    if (paused.size > 0) {
      projectPausedAgents.set(projectDir, paused);
    } else {
      projectPausedAgents.delete(projectDir);
    }

    if (managed) {
      return managed.runner.setEnabledAgents([...requested]);
    }

    return { success: true };
  }

  return {
    start,
    stop,
    reload,
    startProject,
    stopProject,
    getStatus,
    listProjects,
    getRecentEvents,
    getPromptLine,
    hailAgent,
    pauseAgent,
    resumeAgent,
    setProjectEnabledAgents,
  };
}
