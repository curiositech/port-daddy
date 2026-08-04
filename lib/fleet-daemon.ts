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
import { readFileSync, realpathSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, basename, resolve } from 'node:path';
import {
  loadFleetConfig,
  createFleetRunner,
  validateTopology,
  findFleetConfigPath,
  type FleetConfig,
  type FleetEvent,
  type FleetRunContext,
  type FleetApprovalProposal,
} from './fleet-engine.js';
import { getSharedWebhookReceiver } from './fleet/webhook-receiver.js';
import { getSharedApprovalStream } from './fleet/approval-stream.js';
import { getSharedPushNotifier, setSharedPushNotifier, FleetPushNotifier } from './fleet/push-notifications.js';
import { MacOSNotificationSink } from './fleet/outputs/notify-macos.js';
import { assessBackendTelemetryPolicy } from './backend-telemetry-policy.js';
import { loadEnvFiles } from './env-loader.js';
import { createProjectSemaphoreRegistry, type ProjectSemaphoreRegistry } from './concurrency-semaphore.js';
import type { CostTracker } from './cost-tracker.js';
import type { SemanticResolver } from './semantic-resolver.js';
import type { TupleSpace } from './tuples.js';

/**
 * Categorize fleet agents by whether their declared backend/model is currently
 * launchable under the fail-closed telemetry policy. Returns counts plus a list
 * of (agent, reason) pairs for blocked agents so the warning log line tells
 * operators *why* their fleet is silent.
 */
function summarizeLaunchability(config: FleetConfig): {
  total: number;
  launchable: number;
  blocked: Array<{ agent: string; backend: string; reason: string }>;
} {
  let launchable = 0;
  const blocked: Array<{ agent: string; backend: string; reason: string }> = [];
  for (const agent of config.agents) {
    if (!agent.backend) continue;
    const policy = assessBackendTelemetryPolicy(agent.backend, agent.model ?? null);
    if (policy.launchAllowed) {
      launchable++;
    } else {
      blocked.push({
        agent: agent.name,
        backend: agent.backend,
        reason: policy.summary,
      });
    }
  }
  return { total: config.agents.length, launchable, blocked };
}

function logLaunchability(logger: FleetDaemonDeps['logger'], project: string, config: FleetConfig): void {
  const launchability = summarizeLaunchability(config);
  logger.info('fleet_started', {
    project,
    agents: config.agents.length,
    watchers: config.watchers.length,
    launchable: launchability.launchable,
  });
  // If no agent in this fleet has a launchable backend under the
  // current telemetry policy, the fleet will silently arm but
  // refuse every spawn. Surface that loudly at startup so
  // operators see the wall instead of walking into it.
  if (launchability.launchable === 0 && launchability.total > 0) {
    logger.warn('fleet_no_launchable_backend', {
      project,
      total: launchability.total,
      blocked: launchability.blocked,
      hint: 'Every agent is blocked by the fail-closed telemetry policy. See AGENTS.md (Operator-facing agent launches are fail-closed on telemetry).',
    });
  } else if (launchability.blocked.length > 0) {
    logger.warn('fleet_partial_launchable', {
      project,
      launchable: launchability.launchable,
      total: launchability.total,
      blocked: launchability.blocked,
    });
  }
}

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
  tuples?: Pick<TupleSpace, 'out' | 'take' | 'count' | 'poll' | 'subscribe'>;
  semanticResolver?: Pick<SemanticResolver, 'observeAliases'>;
  /** Winston logger */
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Daemon's own project directory. Stable install roots are protected by default. */
  daemonDir: string;
  /** Explicitly allow fleet management inside /port-daddy-stable install roots. */
  allowStableInstallFleet?: boolean;
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
  /**
   * The Ink Cloud reconcile loop (lib/squid/reconcile.ts). OPTIONAL so existing
   * fleet-daemon unit tests (and embedded uses) construct without it. When
   * present, fleet-daemon is its single lifecycle owner: start() after the
   * approval stream is configured (so the first tick projects real state),
   * stop() on daemon shutdown — a stopped loop stops heartbeating and every
   * matrix reader fails open on staleness.
   */
  reconcile?: { start(): void; stop(): void; poke(reason: string): void };
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
    /** How many declared agents have a backend that passes the fail-closed telemetry policy. */
    launchableAgents: number;
    /** Per-agent block reason for any agent whose backend is currently policy-blocked. */
    blockedAgents: Array<{ agent: string; backend: string; reason: string }>;
  }>;
  skipped: SkippedFleet[];
  totalAgents: number;
  totalWatchers: number;
  /** Aggregate across all fleets — operators want a single yes/no signal in pd status. */
  totalLaunchableAgents: number;
}

const FLEET_PROJECT_LEASE_TTL_MS = 30000;
const FLEET_PROJECT_LEASE_RENEW_MS = 10000;
const STABLE_INSTALL_DIR_NAME = 'port-daddy-stable';
const STABLE_INSTALL_FLEET_SKIP_REASON =
  'Stable install checkout is protected from fleet writes; use an editable worktree or set PORT_DADDY_ALLOW_STABLE_FLEET=1 to opt in.';

function hasPathSegment(path: string, segment: string): boolean {
  const resolvedPath = resolve(path);
  let canonicalPath = resolvedPath;
  try {
    canonicalPath = realpathSync.native(resolvedPath);
  } catch {
    // The path may not exist yet during validation; resolved text is still
    // enough for direct stable-install paths.
  }
  return canonicalPath.replace(/\\/g, '/').split('/').includes(segment);
}

function isStableInstallDir(path: string): boolean {
  return hasPathSegment(path, STABLE_INSTALL_DIR_NAME);
}

// ─── Env Loading ────────────────────────────────────────────────────────────

// .env loading lives in lib/env-loader.ts so it can run from server.ts
// before snapshotSensitiveEnv() — otherwise project-local API keys never
// land in the secret cache.

// ─── Factory ────────────────────────────────────────────────────────────────

export function createFleetDaemon(deps: FleetDaemonDeps) {
  const { projects, messaging, logger, daemonDir, costTracker, locks, tuples, semanticResolver } = deps;
  const allowStableInstallFleet = deps.allowStableInstallFleet === true;
  const fleets = new Map<string, ManagedFleet>();
  const configWatchers = new Map<string, FSWatcher>();
  const projectLeases = new Map<string, FleetProjectLease>();
  const projectPausedAgents = new Map<string, Set<string>>();
  const skippedProjects = new Map<string, SkippedFleet>();
  // Project-wide concurrency semaphore registry. One Semaphore per project name.
  // Capacity follows the canonical fleet's `limits.max_concurrent_spawns`. When
  // multiple runners share a project (sub-fleets, monorepo packages), they all
  // acquire from the same Semaphore, so the project-level cap is honored across
  // runners. Spec: docs/shipwright/FLEETCONTROL-HARDENING.md §5.
  const concurrency: ProjectSemaphoreRegistry = createProjectSemaphoreRegistry();
  let isRunning = false;
  let startedAt: number | null = null;
  let leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
  let approvalSweepTimer: ReturnType<typeof setInterval> | null = null;

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

    const managed = event.project
      ? [...fleets.values()].find((fleet) => fleet.projectName === event.project)
      : null;
    tuples?.out([
      'fleet:event',
      event.type,
      event.project ?? null,
      event.agent ?? null,
      event.identity ?? null,
      {
        timestamp: event.timestamp,
        details: event.details ?? null,
      },
    ], {
      harbor: managed?.config.harbor || (event.project ? `${event.project}:fleet` : undefined),
      writtenBy: event.identity ?? event.agent ?? 'fleetd',
      ttlMs: 7 * 24 * 60 * 60 * 1000,
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

  function isProtectedStableProjectDir(projectDir: string): boolean {
    return !allowStableInstallFleet && isStableInstallDir(projectDir);
  }

  function markProtectedStableProject(
    projectDir: string,
    projectName: string,
    source: 'daemon' | 'registered' | 'manual',
  ): boolean {
    if (!isProtectedStableProjectDir(projectDir)) return false;

    markSkippedProject(projectDir, projectName, STABLE_INSTALL_FLEET_SKIP_REASON);
    logger.warn('fleet_stable_install_skipped', {
      project: projectName,
      projectDir,
      source,
      reason: STABLE_INSTALL_FLEET_SKIP_REASON,
    });
    return true;
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

  function resolveCanonicalPidFile(): string {
    if (process.env.PORT_DADDY_PID_FILE) return process.env.PORT_DADDY_PID_FILE;
    if (process.env.PORT_DADDY_SOCK) return join(dirname(process.env.PORT_DADDY_SOCK), 'daemon.pid');
    return join(homedir(), '.port-daddy', 'daemon.pid');
  }

  function readCanonicalDaemonPid(): number | null {
    try {
      const raw = readFileSync(resolveCanonicalPidFile(), 'utf8').trim();
      const pid = Number.parseInt(raw, 10);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  function getReclaimableFleetLeaseHolder(holder: string | null): {
    reclaim: boolean;
    reason?: 'dead_pid' | 'noncanonical_daemon_pid';
    pid?: number;
    canonicalPid?: number | null;
  } {
    if (!holder?.startsWith('fleetd:')) return { reclaim: false };
    const pid = Number.parseInt(holder.split(':').at(-1) || '', 10);
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return { reclaim: false };

    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        return { reclaim: true, reason: 'dead_pid', pid, canonicalPid: readCanonicalDaemonPid() };
      }
      return { reclaim: false };
    }

    const canonicalPid = readCanonicalDaemonPid();
    if (canonicalPid === process.pid && pid !== canonicalPid) {
      return { reclaim: true, reason: 'noncanonical_daemon_pid', pid, canonicalPid };
    }

    return { reclaim: false };
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
    let result = locks.acquire(lockName, {
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
      const reclaimable = getReclaimableFleetLeaseHolder(holder);
      if (reclaimable.reclaim) {
        logger.warn('fleet_project_stale_lease_reclaimed', {
          project: projectName,
          projectDir,
          holder,
          reason: reclaimable.reason,
          holderPid: reclaimable.pid,
          canonicalPid: reclaimable.canonicalPid,
        });
        locks.release(lockName, { force: true });
        result = locks.acquire(lockName, {
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
        if (result.success) {
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
      }
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

    // Register or update the project-wide concurrency semaphore for this
    // project's cap. If another runner already exists for the same project
    // name (rare but possible — daemonDir + a registered project pointing at
    // a sibling fleet), the registry resizes the existing Semaphore so all
    // runners share the same gate.
    const projectCap = config.limits?.maxConcurrentSpawns;
    const projectSemaphore = concurrency.for(config.name, projectCap);

    const runner = createFleetRunner(config, projectDir, {
      onEvent: handleEvent,
      costTracker,
      initiallyPausedAgents: [...(projectPausedAgents.get(projectDir) ?? new Set<string>())],
      tuples,
      semanticResolver,
      messaging: {
        subscribe: messaging.subscribe.bind(messaging),
      },
      acquirePermit: () => projectSemaphore.acquire(),
      // I/O wiring Phase 2: webhook:<channel> triggers register with the
      // daemon's inbound receiver (routes/fleet-webhooks.ts posts into it).
      registerWebhookHandler: (channel, handler) =>
        getSharedWebhookReceiver().registerHandler(channel, handler),
      // ADR-0093 L2 approval seam. Two surfaces per proposal:
      //   1. a durable fleet:approval tuple (7d TTL, keyed by proposal id)
      //      — the record of truth that survives daemon restarts;
      //   2. the live approval stream (lib/fleet/approval-stream.ts) that
      //      the /fleet/approvals WebSocket + REST surfaces broadcast from
      //      and that decisions resolve through.
      // The fleet HITL proposal queue (PR #648) can consume the same seam.
      enqueueForApproval: (proposal: FleetApprovalProposal) => {
        // Stream first: enqueue() is the dedup authority (id + content
        // fingerprint). Writing the tuple only for ACCEPTED proposals keeps
        // duplicates out of the durable record — an orphan tuple for a
        // collapsed duplicate would resurrect as a ghost gate on the next
        // restart, after its twin was already decided.
        const accepted = getSharedApprovalStream().enqueue(proposal);
        if (!accepted) {
          logger.info('fleet_approval_deduped', {
            id: proposal.id,
            project: proposal.project,
            agent: proposal.agent,
            trigger: proposal.trigger,
          });
          return;
        }
        tuples?.out([
          'fleet:approval',
          proposal.id,
          proposal.agent,
          proposal.trigger,
          {
            project: proposal.project,
            tier: proposal.tier,
            reason: proposal.reason,
            safeTools: proposal.safeTools,
            context: proposal.context,
            timestamp: proposal.timestamp,
          },
        ], {
          harbor: config.harbor || `${config.name}:fleet`,
          writtenBy: 'fleetd:trust-gate',
          ttlMs: APPROVAL_TUPLE_TTL_MS,
        });
        logger.info('fleet_approval_requested', {
          id: proposal.id,
          project: proposal.project,
          agent: proposal.agent,
          trigger: proposal.trigger,
          tier: proposal.tier,
        });
      },
    });

    // Crash-safety: resurface any approvals that were pending when the
    // daemon last died. Replay-safe (enqueue dedupes by id).
    rehydrateApprovals(config.name, config.harbor || `${config.name}:fleet`);

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

    // 1. Check the daemon's own directory unless it is the protected
    // stable install checkout. Stable serves runtime; editable worktrees
    // run fleets.
    if (
      findFleetConfigPath(daemonDir) &&
      !markProtectedStableProject(daemonDir, basename(daemonDir), 'daemon')
    ) {
      discovered.push({ dir: daemonDir, name: basename(daemonDir), source: 'daemon' });
    }

    // 2. Scan registered projects
    try {
      const registered = projects.list();
      for (const proj of registered) {
        if (proj.root === daemonDir) continue; // already added
        if (
          findFleetConfigPath(proj.root) &&
          !markProtectedStableProject(proj.root, proj.id, 'registered')
        ) {
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

    // Fail-closed TTL sweep: a gate unanswered for PD_APPROVAL_TTL_HOURS
    // (default 24h) expires rather than accumulating as stale context an
    // operator might approve days later. Swept every 10 minutes; lifecycle-
    // bound (cleared in stop()).
    const approvalTtlMs = Math.max(1, Number(process.env.PD_APPROVAL_TTL_HOURS ?? 24)) * 3_600_000;
    approvalSweepTimer = setInterval(() => {
      const expired = getSharedApprovalStream().expireOlderThan(approvalTtlMs);
      if (expired > 0) {
        logger.info('fleet_approvals_expired', { expired, ttlHours: approvalTtlMs / 3_600_000 });
      }
    }, 10 * 60_000);
    approvalSweepTimer.unref?.();

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
        logLaunchability(logger, managed.projectName, managed.config);
      } else {
        releaseProjectLease(dir);
      }
    }

    isRunning = true;
    startedAt = Date.now();

    // Start the reconcile loop LAST: the approval stream was configured during
    // createFleetDaemon() and projects/fleets are loaded, so the loop's
    // immediate first tick projects real state, not a half-booted daemon's.
    try {
      deps.reconcile?.start();
    } catch (err) {
      logger.warn('reconcile_start_failed', { error: (err as Error).message });
    }

    logger.info('fleet_daemon_ready', { fleets: fleets.size });
  }

  /** Stop all fleets. Called from daemon shutdown(). */
  function stop(): void {
    if (!isRunning) return;

    // Stop the reconcile loop first: no more matrix projections (or heartbeat
    // refreshes) once shutdown begins — readers fail open on staleness.
    try {
      deps.reconcile?.stop();
    } catch {
      /* advisory surface; never blocks shutdown */
    }

    unwatchAll();
    logger.info('fleet_daemon_stopping', { fleets: fleets.size });
    if (leaseRenewTimer) {
      clearInterval(leaseRenewTimer);
      leaseRenewTimer = null;
    }
    if (approvalSweepTimer) {
      clearInterval(approvalSweepTimer);
      approvalSweepTimer = null;
    }
    for (const dir of [...fleets.keys()]) {
      stopManagedFleet(dir, { releaseLease: true });
    }
    // Drain every project semaphore. Reject waiters with a clear shutdown
    // reason so any inflight `acquirePermit` resolves to an `agent_failed`
    // event instead of hanging forever. Holders aren't affected — their
    // child processes have already been SIGTERM'd by `stopManagedFleet`.
    concurrency.drainAll('fleet daemon stopping');
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
  function startProject(
    projectDir: string,
    options: { enabledAgents?: string[]; allowStableInstallFleet?: boolean } = {}
  ): { success: boolean; error?: string } {
    if (!options.allowStableInstallFleet && markProtectedStableProject(projectDir, basename(projectDir), 'manual')) {
      return { success: false, error: STABLE_INSTALL_FLEET_SKIP_REASON };
    }
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
    logLaunchability(logger, managed.projectName, managed.config);
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
    let totalLaunchableAgents = 0;

    for (const [, managed] of fleets) {
      const agentStatus = managed.runner.getStatus();
      const watcherCount = managed.config.watchers.length;
      const launchability = summarizeLaunchability(managed.config);
      totalAgents += agentStatus.length;
      totalWatchers += watcherCount;
      totalLaunchableAgents += launchability.launchable;

      fleetList.push({
        project: managed.projectName,
        projectDir: managed.projectDir,
        running: true,
        agents: agentStatus,
        watchers: watcherCount,
        channels: Object.keys(managed.config.channels).length,
        startedAt: managed.startedAt,
        launchableAgents: launchability.launchable,
        blockedAgents: launchability.blocked,
      });
    }

    return {
      running: isRunning,
      startedAt,
      fleets: fleetList,
      skipped: [...skippedProjects.values()],
      totalAgents,
      totalWatchers,
      totalLaunchableAgents,
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

  /**
   * Snapshot of every project's concurrency semaphore. Surfaces inflight,
   * waiters, and current capacity so `pd fleet status` and the FleetControl
   * dashboard can show "this project is at the cap, N waiting." Read-only.
   */
  function getConcurrencySnapshot(): Array<{ project: string; capacity: number; inflight: number; waiters: number }> {
    return concurrency.snapshot();
  }

  /**
   * Operator-driven resize of a project's concurrency cap. Used by SIGHUP
   * config reload (when `limits.max_concurrent_spawns` changes) and by a
   * future `pd fleet resize-cap <project> <n>` CLI. No-op if the project
   * has no registered semaphore yet — caller should ensure the fleet is
   * loaded first.
   */
  function resizeProjectConcurrency(project: string, newCapacity: number): void {
    concurrency.resize(project, newCapacity);
  }

  // Wire the approval stream's decision actions to THIS daemon's spawn
  // path. Approve = hail the agent with the proposal's stored context;
  // both decisions drop the durable tuple. Until configure() runs the
  // stream refuses decisions (fail-closed), so a half-booted daemon can
  // never approve a spawn it cannot execute.
  function approvalHarbor(proposal: FleetApprovalProposal): string {
    const managed = [...fleets.values()].find((f) => f.projectName === proposal.project);
    return managed?.config.harbor || `${proposal.project}:fleet`;
  }

  const APPROVAL_TUPLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  getSharedApprovalStream().configure({
    hail: (proposal) =>
      hailAgent(proposal.agent, { ...proposal.context, project: proposal.project }),
    // Atomic claim: take() deletes and returns the record in one step, so
    // two surfaces deciding the same proposal race on the tuple, not on
    // the spawn. No tuple space → nothing to claim → true.
    claimDurable: (proposal) => {
      if (!tuples?.take) return true;
      const taken = tuples.take(['fleet:approval', proposal.id], { harbor: approvalHarbor(proposal) });
      return taken.length > 0;
    },
    // Compensation for a failed hail: put the record back so the proposal
    // survives retries and daemon restarts.
    restoreDurable: (proposal) => {
      tuples?.out([
        'fleet:approval',
        proposal.id,
        proposal.agent,
        proposal.trigger,
        {
          project: proposal.project,
          tier: proposal.tier,
          reason: proposal.reason,
          safeTools: proposal.safeTools,
          context: proposal.context,
          timestamp: proposal.timestamp,
        },
      ], {
        harbor: approvalHarbor(proposal),
        writtenBy: 'fleetd:trust-gate',
        ttlMs: APPROVAL_TUPLE_TTL_MS,
      });
    },
  });

  /**
   * Boot-time rehydration (the in-memory queue must not die with the
   * process): replay every durable fleet:approval record for a project
   * into the live stream. enqueue() is replay-safe, so re-loading a
   * project is idempotent.
   */
  function rehydrateApprovals(projectName: string, harbor: string): void {
    if (!tuples?.poll) return;
    let cursor = 0;
    for (let i = 0; i < 500; i += 1) { // hard bound, not a silent cap: 200 pending is the queue ceiling
      const result = tuples.poll(['fleet:approval'], { harbor, afterId: cursor });
      cursor = result.lastId;
      const tuple = result.tuple;
      if (!tuple) break;
      const [, id, agent, trigger] = tuple.fields as [string, string, string, string];
      const payload = (tuple.fields[4] ?? {}) as {
        project?: string; tier?: string; reason?: string;
        safeTools?: string[]; context?: FleetRunContext; timestamp?: number;
      };
      if (typeof id !== 'string' || typeof agent !== 'string' || typeof trigger !== 'string') continue;
      getSharedApprovalStream().enqueue({
        id,
        project: payload.project ?? projectName,
        agent,
        trigger,
        tier: (payload.tier ?? 'ANONYMOUS_EXTERNAL') as FleetApprovalProposal['tier'],
        reason: payload.reason ?? 'rehydrated after daemon restart',
        safeTools: payload.safeTools ?? [],
        context: payload.context ?? { source: 'trigger' },
        timestamp: payload.timestamp ?? tuple.createdAt,
      });
    }
  }

  // Approval gates → the operator's devices. Web Push to every registered
  // fleet-ui subscription, plus a best-effort local macOS banner (pii:low —
  // the push body is agent/trigger/tier only, never event content).
  const macNotify = new MacOSNotificationSink();
  setSharedPushNotifier(new FleetPushNotifier({
    localNotify: async (title, body) => {
      if ((await macNotify.available()).ready) {
        await macNotify.dispatch({ sink: 'notify', type: 'os', title, body, pii: 'low' });
      }
    },
  }));
  getSharedPushNotifier().bindApprovalStream(getSharedApprovalStream());

  // Unmissable HITL: the pending-approvals count is mirrored into the Ink
  // Cloud matrix as PD_ALERT_FLEET_APPROVALS by the reconcile loop
  // (lib/squid/reconcile.ts) — the single owner of every projected matrix key
  // class. The loop subscribes to this approval stream for its event
  // fast-path, so a held spawn still lands in front of the operator/agent
  // within one poke. The inline syncApprovalAlert writer that used to live
  // here was migrated there (single-owner rule) with a byte-compatible message.

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
    getConcurrencySnapshot,
    resizeProjectConcurrency,
  };
}
