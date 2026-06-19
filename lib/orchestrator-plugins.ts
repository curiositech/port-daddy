/**
 * Orchestrator Plugin Registry
 *
 * Port Daddy is the "building department" — it issues permits, enforces
 * code (Arbiter invariants), inspects (post-merge checks), and maintains
 * records. Orchestrators are "architects" — they decompose tasks, assign
 * agents, decide merge ordering, choose prompts/strategies.
 *
 * Orchestrators are plugins. PD provides a default FIFO orchestrator,
 * but users can register custom ones with domain-specific intelligence.
 * Hot-swapping is supported — change the active orchestrator without restart.
 */

import type Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';

// =============================================================================
// Types — The contract between PD and orchestrators
// =============================================================================

/** Submitted merge request from an agent */
export interface MergeSubmission {
  agentId: string;
  sessionId?: string;
  branch: string;
  repository: string;
  baseBranch?: string;
  claims: FileClaim[];
  metadata?: Record<string, unknown>;
}

/** A file/symbol claim associated with a merge */
export interface FileClaim {
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  symbolPath?: string;
}

/** Decision returned by the orchestrator for a merge submission */
export interface MergeDecision {
  approved: boolean;
  priority?: number;
  reason?: string;
  conditions?: string[];
  metadata?: Record<string, unknown>;
}

/** An entry in the merge queue (post-persistence) */
export interface MergeQueueEntry {
  id: number;
  agentId: string;
  sessionId: string | null;
  branch: string;
  repository: string;
  baseBranch: string;
  claims: FileClaim[];
  conflictSurface: number;
  status: MergeStatus;
  priority: number;
  submittedAt: number;
  mergedAt: number | null;
  mergeCommit: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
}

export type MergeStatus = 'pending' | 'approved' | 'merging' | 'inspecting' | 'merged' | 'failed' | 'reverted' | 'rejected';

/** Ordered sequence of merges to execute */
export interface MergeSequence {
  order: number[];
  reasoning?: string;
}

/** Details about a merge failure */
export interface MergeFailure {
  entryId: number;
  agentId: string;
  branch: string;
  repository: string;
  failureType: 'conflict' | 'test_failure' | 'arbiter_violation' | 'inspection_failure';
  details: string;
  mergeCommit?: string;
}

/** What the orchestrator wants done after a failure */
export interface RecoveryAction {
  action: 'revert' | 'retry' | 'park' | 'reassign';
  reason: string;
  reassignTo?: string;
  retryAfterMs?: number;
  metadata?: Record<string, unknown>;
}

/** Snapshot of system state for adaptive behavior */
export interface SystemSnapshot {
  activeAgents: number;
  queueDepth: number;
  pendingMerges: MergeQueueEntry[];
  recentFailures: MergeFailure[];
  timestamp: number;
}

/** Actions the orchestrator can take during onTick */
export interface OrchestratorAction {
  type: 'reorder' | 'park' | 'notify' | 'spawn_agent';
  target?: number | string;
  payload?: Record<string, unknown>;
}

/** Agent info passed to lifecycle hooks */
export interface AgentInfo {
  id: string;
  name?: string;
  purpose?: string;
  identity?: string;
  worktreeId?: string;
  registeredAt: number;
  lastHeartbeat: number;
}

/** Session info passed to lifecycle hooks */
export interface SessionInfo {
  id: string;
  purpose: string;
  status: string;
  phase?: string;
  agentId?: string;
  notes: string[];
  fileClaims: string[];
}

/** Strategy for handling dead agent salvage */
export interface SalvageStrategy {
  action: 'auto_reassign' | 'queue' | 'dismiss';
  priority?: number;
  preferredAgent?: string;
  reason?: string;
}

// =============================================================================
// The OrchestratorPlugin interface
// =============================================================================

export interface OrchestratorPlugin {
  /** Plugin name (must be unique in registry) */
  name: string;
  /** Plugin version (semver) */
  version: string;

  /**
   * Called when work is submitted to the merge queue.
   * Return a decision: approve, reject, or approve with conditions.
   */
  onMergeSubmitted(submission: MergeSubmission): Promise<MergeDecision>;

  /**
   * Called when PD needs merge ordering for queued items.
   * Return an ordered array of entry IDs.
   */
  computeMergeOrder(queue: MergeQueueEntry[]): Promise<MergeSequence>;

  /**
   * Called when a merge fails inspection (Arbiter violation, test failure).
   * Return a recovery action: revert, retry, park, or reassign.
   */
  onMergeFailure(failure: MergeFailure): Promise<RecoveryAction>;

  /**
   * Called periodically with system state for adaptive behavior.
   * Return any actions to take (reorder, park, notify, spawn).
   * Optional — default orchestrator does nothing.
   */
  onTick?(state: SystemSnapshot): Promise<OrchestratorAction[]>;

  /**
   * Called when a new agent registers.
   * Optional — for orchestrators that track agent pools.
   */
  onAgentRegistered?(agent: AgentInfo): Promise<void>;

  /**
   * Called when an agent dies (enters salvage queue).
   * Optional — return a strategy for how to handle the dead agent's work.
   */
  onAgentDied?(agent: AgentInfo, session: SessionInfo): Promise<SalvageStrategy>;
}

// =============================================================================
// Default FIFO Orchestrator
// =============================================================================

/**
 * The default orchestrator: FIFO ordering, always approve, revert on failure.
 * No adaptive behavior. This is the baseline that all custom orchestrators improve on.
 */
export const defaultOrchestrator: OrchestratorPlugin = {
  name: 'fifo',
  version: '1.0.0',

  async onMergeSubmitted(_submission: MergeSubmission): Promise<MergeDecision> {
    return { approved: true, priority: 0, reason: 'FIFO: all submissions auto-approved' };
  },

  async computeMergeOrder(queue: MergeQueueEntry[]): Promise<MergeSequence> {
    // FIFO: sort by submittedAt ascending
    const sorted = [...queue]
      .filter(e => e.status === 'pending' || e.status === 'approved')
      .sort((a, b) => a.submittedAt - b.submittedAt);
    return {
      order: sorted.map(e => e.id),
      reasoning: 'FIFO: first submitted, first merged',
    };
  },

  async onMergeFailure(failure: MergeFailure): Promise<RecoveryAction> {
    return {
      action: 'revert',
      reason: `FIFO default: reverting ${failure.branch} due to ${failure.failureType}: ${failure.details}`,
    };
  },

  async onAgentDied(_agent: AgentInfo, _session: SessionInfo): Promise<SalvageStrategy> {
    return { action: 'queue', reason: 'FIFO default: queued for manual salvage' };
  },
};

// =============================================================================
// Plugin Registry Factory
// =============================================================================

export interface OrchestratorRegistryDeps {
  activityLog?: {
    log(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
  };
}

export function createOrchestratorRegistry(db: Database.Database, deps: OrchestratorRegistryDeps = {}) {
  const { activityLog } = deps;
  const events = new EventEmitter();

  // Persist registered plugin metadata (not the code — that lives in-process)
  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestrator_plugins (
      name TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      registered_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 0,
      metadata TEXT
    );
  `);

  const stmts = {
    upsert: db.prepare(`
      INSERT INTO orchestrator_plugins (name, version, registered_at, is_active, metadata)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET version = excluded.version, registered_at = excluded.registered_at, metadata = excluded.metadata
    `),
    clearActive: db.prepare(`UPDATE orchestrator_plugins SET is_active = 0`),
    markActive: db.prepare(`UPDATE orchestrator_plugins SET is_active = 1 WHERE name = ?`),
    getActive: db.prepare(`SELECT * FROM orchestrator_plugins WHERE is_active = 1`),
    list: db.prepare(`SELECT * FROM orchestrator_plugins ORDER BY registered_at DESC`),
    remove: db.prepare(`DELETE FROM orchestrator_plugins WHERE name = ?`),
  };

  // In-memory plugin instances (keyed by name)
  const plugins = new Map<string, OrchestratorPlugin>();
  let activePlugin: OrchestratorPlugin = defaultOrchestrator;

  // Register default on startup
  plugins.set(defaultOrchestrator.name, defaultOrchestrator);
  stmts.upsert.run(defaultOrchestrator.name, defaultOrchestrator.version, Date.now(), 1, null);
  stmts.clearActive.run();
  stmts.markActive.run(defaultOrchestrator.name);

  // ─── Registration ──────────────────────────────────────────────────────────

  function register(plugin: OrchestratorPlugin): { success: boolean; name: string } {
    if (!plugin.name || !plugin.version) {
      throw new Error('Plugin must have name and version');
    }
    if (typeof plugin.onMergeSubmitted !== 'function' ||
        typeof plugin.computeMergeOrder !== 'function' ||
        typeof plugin.onMergeFailure !== 'function') {
      throw new Error('Plugin must implement onMergeSubmitted, computeMergeOrder, and onMergeFailure');
    }

    plugins.set(plugin.name, plugin);
    stmts.upsert.run(
      plugin.name,
      plugin.version,
      Date.now(),
      activePlugin.name === plugin.name ? 1 : 0,
      null
    );

    activityLog?.log('orchestrator.plugin_registered', {
      details: `Orchestrator plugin "${plugin.name}" v${plugin.version} registered`,
      metadata: { name: plugin.name, version: plugin.version },
    });

    events.emit('plugin:registered', { name: plugin.name, version: plugin.version });
    return { success: true, name: plugin.name };
  }

  function unregister(name: string): { success: boolean; removed: boolean } {
    if (name === 'fifo') {
      return { success: false, removed: false };
    }
    if (activePlugin.name === name) {
      // Fall back to default
      activePlugin = defaultOrchestrator;
      stmts.clearActive.run();
      stmts.markActive.run('fifo');
    }
    plugins.delete(name);
    const result = stmts.remove.run(name);
    events.emit('plugin:unregistered', { name });
    return { success: true, removed: result.changes > 0 };
  }

  // ─── Activation (hot-swap) ─────────────────────────────────────────────────

  function activate(name: string): { success: boolean; active: string } {
    const plugin = plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found. Register it first.`);
    }

    const previousName = activePlugin.name;
    activePlugin = plugin;

    stmts.clearActive.run();
    stmts.markActive.run(name);

    activityLog?.log('orchestrator.plugin_activated', {
      details: `Orchestrator switched from "${previousName}" to "${name}"`,
      metadata: { previous: previousName, active: name },
    });

    events.emit('plugin:activated', { name, previous: previousName });
    return { success: true, active: name };
  }

  // ─── Delegation (route all calls through active plugin) ────────────────────

  async function onMergeSubmitted(submission: MergeSubmission): Promise<MergeDecision> {
    return activePlugin.onMergeSubmitted(submission);
  }

  async function computeMergeOrder(queue: MergeQueueEntry[]): Promise<MergeSequence> {
    return activePlugin.computeMergeOrder(queue);
  }

  async function onMergeFailure(failure: MergeFailure): Promise<RecoveryAction> {
    return activePlugin.onMergeFailure(failure);
  }

  async function onTick(state: SystemSnapshot): Promise<OrchestratorAction[]> {
    if (activePlugin.onTick) {
      return activePlugin.onTick(state);
    }
    return [];
  }

  async function onAgentRegistered(agent: AgentInfo): Promise<void> {
    if (activePlugin.onAgentRegistered) {
      await activePlugin.onAgentRegistered(agent);
    }
  }

  async function onAgentDied(agent: AgentInfo, session: SessionInfo): Promise<SalvageStrategy> {
    if (activePlugin.onAgentDied) {
      return activePlugin.onAgentDied(agent, session);
    }
    return { action: 'queue', reason: 'No onAgentDied handler — default to queue' };
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  function getActive(): { name: string; version: string } {
    return { name: activePlugin.name, version: activePlugin.version };
  }

  function listPlugins(): Array<{ name: string; version: string; isActive: boolean; registeredAt: number }> {
    const rows = stmts.list.all() as Array<{
      name: string; version: string; is_active: number; registered_at: number; metadata: string | null;
    }>;
    return rows.map(r => ({
      name: r.name,
      version: r.version,
      isActive: r.is_active === 1,
      registeredAt: r.registered_at,
    }));
  }

  function getPlugin(name: string): OrchestratorPlugin | undefined {
    return plugins.get(name);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  return {
    // Plugin management
    register,
    unregister,
    activate,
    getActive,
    getPlugin,
    listPlugins,

    // Delegated orchestration calls (routed through active plugin)
    onMergeSubmitted,
    computeMergeOrder,
    onMergeFailure,
    onTick,
    onAgentRegistered,
    onAgentDied,

    // Events
    on: events.on.bind(events),
  };
}

export type OrchestratorRegistry = ReturnType<typeof createOrchestratorRegistry>;
