/**
 * Agent Registry Module
 *
 * Tracks active agents, handles heartbeats, enforces resource limits.
 * Supported by a fully autonomous, reactive self-building swarm (v18).
 * Pure SQLite operations - no shell commands
 */

import type Database from 'better-sqlite3';
import { parseIdentity, patternToSql } from './identity.js';
import type { SemanticIndex } from './semantic-index.js';
import { getSharedApprovalStream } from './fleet/approval-stream.js';
import { createReaperSoulResolver, type SessionBindingLookup } from './agent-soul-binding.js';
import { haltActive } from './distress.js';

const DEFAULT_HEARTBEAT_INTERVAL = 30000;  // 30 seconds
const DEFAULT_AGENT_TTL = 120000;          // 2 minutes without heartbeat = display as inactive
const DEFAULT_DISPLAY_TTL = DEFAULT_AGENT_TTL;  // Renamed: display concern
const DEFAULT_MAX_SERVICES_PER_AGENT = 50;
const DEFAULT_MAX_LOCKS_PER_AGENT = 20;

const VALID_STATUSES = ['starting', 'ready', 'busy', 'draining'] as const;

// ─── Dead/Stale Threshold Ladder (SINGLE SOURCE OF TRUTH) ──────────────────
// Adaptive reaper thresholds by agent status (operational concern).
// Background Claude Code agents have no heartbeat loop — use 4h so sessions survive
// a long background job. Only the work being gone (worktree removed / branch merged)
// should kill a session; time alone does not (see session-liveness.ts).
//
// These are the authoritative dead/stale thresholds for the whole daemon.
// `lib/resurrection.ts` imports `getDeadThresholdForStatus` /
// `getStaleThresholdForStatus` from here instead of defining its own ladder,
// so the live reaper (agents.cleanup) and the resurrection sweep agree.
// stale = 0.6 × dead, by status.
export const DEAD_THRESHOLDS: Record<string, number> = {
  starting: 15 * 60 * 1000,
  ready:    4 * 60 * 60 * 1000,   // was 20m — background agents survive now
  busy:     4 * 60 * 60 * 1000,   // was 30m
  draining: 5 * 60 * 1000,
};
export const DEFAULT_DEAD_THRESHOLD = 4 * 60 * 60 * 1000;  // was 20m — see above
const DEFAULT_CLEANUP_TTL = DEFAULT_DEAD_THRESHOLD;


/** Held trust-gate spawns (ADR-0093 L2) — surfaced at every session start
 *  so a pending human gate cannot be missed. Fail-open: an error here must
 *  never block `pd begin`. */
function pendingApprovalsHint(): string | null {
  try {
    const pending = getSharedApprovalStream().list();
    if (pending.length === 0) return null;
    const head = pending.slice(0, 3).map((p) => `${p.agent} ← ${p.trigger}`).join('; ');
    const more = pending.length > 3 ? ` (+${pending.length - 3} more)` : '';
    return `HITL: ${pending.length} spawn approval(s) WAITING — ${head}${more}. Decide: pd fleet approvals`;
  } catch {
    return null;
  }
}

export function getDeadThresholdForStatus(status?: string): number {
  return DEAD_THRESHOLDS[status || ''] || DEFAULT_DEAD_THRESHOLD;
}

export function getStaleThresholdForStatus(status?: string): number {
  return Math.round(getDeadThresholdForStatus(status) * 0.6);
}

interface AgentRow {
  id: string;
  name: string | null;
  pid: number;
  type: string;
  registered_at: number;
  last_heartbeat: number;
  metadata: string | null;
  agent_card: string | null;
  max_services: number;
  max_locks: number;
  worktree_id: string | null;
  // Semantic identity: project:stack:context (stored as components for prefix matching)
  identity_project: string | null;
  identity_stack: string | null;
  identity_context: string | null;
  purpose: string | null;
  skills: string | null;
  // Liveness & readiness
  status: string;
  readiness: string | null;
  progress: string | null;
}

interface RegisterOptions {
  name?: string | null;
  pid?: number;
  type?: string;
  metadata?: Record<string, unknown> | null;
  agentCard?: Record<string, unknown> | null;
  skills?: string[] | string | null;
  maxServices?: number;
  maxLocks?: number;
  worktreeId?: string | null;
  identity?: string | null;   // Semantic identity: project:stack:context (parsed into components)
  purpose?: string | null;    // What this agent is doing
  status?: string;            // Agent status: starting, ready, busy, draining
}

interface ListOptions {
  activeOnly?: boolean;
  worktreeId?: string | null;   // Filter by worktree
  identityPrefix?: string | null;  // Filter by identity prefix (project or project:stack)
  purpose?: string | null;      // Filter by purpose pattern
  skills?: string | null;       // Filter by skills pattern
}

interface ReadinessCheck {
  name: string;
  ok: boolean;
  reason?: string;
}

interface HeartbeatOptions {
  pid?: number;
  status?: string;
  readiness?: ReadinessCheck[];
  progress?: string;
  [key: string]: unknown;
}

interface AgentFormatted {
  id: string;
  name: string | null;
  pid: number;
  type: string;
  registeredAt: number;
  lastHeartbeat: number;
  isActive: boolean;
  maxServices: number;
  maxLocks: number;
  metadata: Record<string, unknown> | null;
  agentCard: Record<string, unknown> | null;
  worktreeId: string | null;
  // Semantic identity components
  identity: string | null;  // Full identity string (computed from components)
  identityProject: string | null;
  identityStack: string | null;
  identityContext: string | null;
  purpose: string | null;
  skills: string[];
  // Liveness & readiness
  status: string;
  readiness: ReadinessCheck[] | null;
  isReady: boolean;
  progress: string | null;
  healthAssessment: {
    liveness: 'alive' | 'stale' | 'dead';
    graceRemaining: number;
  };
}

interface ResourceCheck {
  allowed: boolean;
  error?: string;
  current?: number;
  max?: number;
}

interface LocksLike {
  list(options: { owner: string }): { locks?: Array<{ name: string; metadata?: unknown }> };
  release(name: string, options: { force: boolean }): void;
}

/**
 * How `cleanup()` decides whether a dying DISPLAY handle is allowed to take a
 * lock with it.
 *
 * See the long note in cleanup() itself. Either supply `agentOwnsSoul`
 * directly, or the `sessions` manager and one is built for you via
 * lib/agent-soul-binding.ts.
 */
export interface CleanupOptions {
  /**
   * Membership predicate: does a dying display handle bind to `actorId`? Keyed
   * to the specific soul so a display handle shared by several souls cannot let
   * one soul's session decide another soul's lock. Defaults to a session-stamp
   * predicate built from `sessions`.
   */
  agentOwnsSoul?: (agentId: string, actorId: string) => boolean;
  sessions?: (SessionBindingLookup & {
    activeDurableSessionIdsByAgent?(agentId: string, options: { verifiedOnly: boolean }): string[];
  }) | null;
}

interface AgentsOptions {
  semanticIndex?: SemanticIndex;
  /**
   * ADR-0132 A0: is a halt hoisted? Defaults to the real sentinel check in
   * lib/distress.ts; injectable so tests can flip it without touching the
   * operator's home directory.
   */
  haltActive?: () => boolean;
}

/**
 * Initialize agent registry with database connection
 */
export function createAgents(db: Database.Database, options?: AgentsOptions) {
  const semanticIndex = options?.semanticIndex;
  const isHalted = options?.haltActive ?? (() => haltActive());
  // Ensure agents table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      pid INTEGER,
      type TEXT DEFAULT 'cli',
      registered_at INTEGER NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      metadata TEXT,
      agent_card TEXT,
      skills TEXT,
      max_services INTEGER DEFAULT ${DEFAULT_MAX_SERVICES_PER_AGENT},
      max_locks INTEGER DEFAULT ${DEFAULT_MAX_LOCKS_PER_AGENT},
      worktree_id TEXT,
      identity_project TEXT,
      identity_stack TEXT,
      identity_context TEXT,
      purpose TEXT,
      status TEXT DEFAULT 'ready',
      readiness TEXT,
      progress TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(last_heartbeat);
    CREATE INDEX IF NOT EXISTS idx_agents_worktree ON agents(worktree_id);
    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(identity_project);
  `);

  // Migrations: add columns if missing
  const migrations = [
    'ALTER TABLE agents ADD COLUMN worktree_id TEXT',
    'ALTER TABLE agents ADD COLUMN identity_project TEXT',
    'ALTER TABLE agents ADD COLUMN identity_stack TEXT',
    'ALTER TABLE agents ADD COLUMN identity_context TEXT',
    'ALTER TABLE agents ADD COLUMN purpose TEXT',
    "ALTER TABLE agents ADD COLUMN status TEXT DEFAULT 'ready'",
    'ALTER TABLE agents ADD COLUMN readiness TEXT',
    'ALTER TABLE agents ADD COLUMN progress TEXT',
    'ALTER TABLE agents ADD COLUMN agent_card TEXT',
    'ALTER TABLE agents ADD COLUMN skills TEXT',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* already exists */ }
  }

  const stmts = {
    get: db.prepare('SELECT * FROM agents WHERE id = ?'),
    register: db.prepare(`
      INSERT OR REPLACE INTO agents (id, name, pid, type, registered_at, last_heartbeat, metadata, agent_card, skills, max_services, max_locks, worktree_id, identity_project, identity_stack, identity_context, purpose, status, readiness, progress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    heartbeat: db.prepare('UPDATE agents SET last_heartbeat = ?, pid = ?, status = COALESCE(?, status), readiness = COALESCE(?, readiness), progress = COALESCE(?, progress) WHERE id = ?'),
    unregister: db.prepare('DELETE FROM agents WHERE id = ?'),
    list: db.prepare('SELECT * FROM agents ORDER BY last_heartbeat DESC'),
    listByWorktree: db.prepare('SELECT * FROM agents WHERE worktree_id = ? ORDER BY last_heartbeat DESC'),
    listByProject: db.prepare('SELECT * FROM agents WHERE identity_project = ? ORDER BY last_heartbeat DESC'),
    listByProjectStack: db.prepare('SELECT * FROM agents WHERE identity_project = ? AND identity_stack = ? ORDER BY last_heartbeat DESC'),
    listActive: db.prepare('SELECT * FROM agents WHERE last_heartbeat > ? ORDER BY last_heartbeat DESC'),
    listActiveByWorktree: db.prepare('SELECT * FROM agents WHERE last_heartbeat > ? AND worktree_id = ? ORDER BY last_heartbeat DESC'),
    listStale: db.prepare('SELECT * FROM agents WHERE last_heartbeat < ?'),
    listStaleByWorktree: db.prepare('SELECT * FROM agents WHERE last_heartbeat < ? AND worktree_id = ?'),
    listStaleByProject: db.prepare('SELECT * FROM agents WHERE last_heartbeat < ? AND identity_project = ?'),
    listByPattern: db.prepare(`
      SELECT * FROM agents 
      WHERE (
        identity_project || 
        CASE WHEN identity_stack IS NOT NULL THEN ':' || identity_stack ELSE '' END || 
        CASE WHEN identity_context IS NOT NULL THEN ':' || identity_context ELSE '' END
      ) LIKE ? ESCAPE '\\'
      ORDER BY last_heartbeat DESC
    `),
    listStaleByPattern: db.prepare(`
      SELECT * FROM agents 
      WHERE last_heartbeat < ? AND (
        identity_project || 
        CASE WHEN identity_stack IS NOT NULL THEN ':' || identity_stack ELSE '' END || 
        CASE WHEN identity_context IS NOT NULL THEN ':' || identity_context ELSE '' END
      ) LIKE ? ESCAPE '\\'
      ORDER BY last_heartbeat DESC
    `),
    listByComplexPattern: db.prepare(`
      SELECT * FROM agents
      WHERE (last_heartbeat > ? OR ? = 0)
        AND (worktree_id = ? OR ? IS NULL)
        AND (COALESCE(identity_project, '') || 
             CASE WHEN identity_stack IS NOT NULL THEN ':' || identity_stack ELSE '' END || 
             CASE WHEN identity_context IS NOT NULL THEN ':' || identity_context ELSE '' END) LIKE ? ESCAPE '\\'
        AND (purpose LIKE ? ESCAPE '\\' OR ? IS NULL)
        AND (skills LIKE ? ESCAPE '\\' OR ? IS NULL)
      ORDER BY last_heartbeat DESC
    `),
    deleteById: db.prepare('DELETE FROM agents WHERE id = ?'),
    deleteStale: db.prepare('DELETE FROM agents WHERE last_heartbeat < ?'),
    countServices: db.prepare("SELECT COUNT(*) as count FROM services WHERE metadata LIKE ? ESCAPE '\\'"),
    countLocks: db.prepare('SELECT COUNT(*) as count FROM locks WHERE owner = ?')
  };

  /**
   * Batch-fetch full agent rows by ID (for trie-accelerated lookups).
   */
  function batchFetchAgents(ids: string[]): AgentRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return db.prepare(
      `SELECT * FROM agents WHERE id IN (${placeholders}) ORDER BY last_heartbeat DESC`
    ).all(...ids) as AgentRow[];
  }

  /**
   * Register an agent
   */
  function register(agentId: string, options: RegisterOptions = {}) {
    if (!agentId || typeof agentId !== 'string') {
      return { success: false, error: 'agent ID must be a non-empty string' };
    }

    if (!/^[a-zA-Z0-9:_-]+$/.test(agentId)) {
      return { success: false, error: 'agent ID must be alphanumeric with dashes, underscores, or colons' };
    }

    if (agentId.length > 100) {
      return { success: false, error: 'agent ID too long (max 100 characters)' };
    }

    const now = Date.now();
    const {
      name = null,
      pid = process.pid,
      type = 'cli',
      metadata = null,
      agentCard = null,
      skills = null,
      maxServices = DEFAULT_MAX_SERVICES_PER_AGENT,
      maxLocks = DEFAULT_MAX_LOCKS_PER_AGENT,
      worktreeId = null,
      identity = null,
      purpose = null,
      status = 'ready'
    } = options;

    // Parse semantic identity into components
    let identityProject: string | null = null;
    let identityStack: string | null = null;
    let identityContext: string | null = null;

    if (identity) {
      const parsed = parseIdentity(identity);
      if (parsed.valid) {
        identityProject = parsed.project;
        identityStack = parsed.stack;
        identityContext = parsed.context;
      } else {
        return { success: false, error: `Invalid identity: ${parsed.error}`, code: 'VALIDATION_ERROR' };
      }
    }

    // Validate status
    if (!(VALID_STATUSES as readonly string[]).includes(status)) {
      return { success: false, error: `Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}` };
    }

    // Validate maxServices if provided
    if (options.maxServices !== undefined) {
      if (typeof maxServices !== 'number' || !Number.isInteger(maxServices) || maxServices < 1) {
        return { success: false, error: 'maxServices must be a positive integer', code: 'VALIDATION_ERROR' };
      }
    }

    // Validate maxLocks if provided
    if (options.maxLocks !== undefined) {
      if (typeof maxLocks !== 'number' || !Number.isInteger(maxLocks) || maxLocks < 1) {
        return { success: false, error: 'maxLocks must be a positive integer', code: 'VALIDATION_ERROR' };
      }
    }

    const existing = stmts.get.get(agentId) as AgentRow | undefined;

    try {
      const skillsValue = Array.isArray(skills) ? skills.join(',') : (skills || null);

      stmts.register.run(
        agentId,
        name,
        pid,
        type,
        existing?.registered_at || now,
        now,
        metadata ? JSON.stringify(metadata) : null,
        agentCard ? JSON.stringify(agentCard) : null,
        skillsValue,
        maxServices,
        maxLocks,
        worktreeId,
        identityProject,
        identityStack,
        identityContext,
        purpose,
        status,
        null,  // readiness (set via heartbeat)
        null   // progress (set via heartbeat)
      );

      // Keep trie in sync (1:N via entryId = agentId)
      if (semanticIndex && identityProject) {
        const identity = [identityProject, identityStack, identityContext].filter(Boolean).join(':');
        semanticIndex.index(identity, {
          type: 'agent', id: agentId, identity, status,
        }, agentId);
      }

      // Check for dead agents in the same project to alert the user
      let deadAgentsInProject = 0;
      if (identityProject) {
        const staleThreshold = now - DEFAULT_AGENT_TTL;
        const staleAgents = stmts.listStaleByProject.all(staleThreshold, identityProject) as AgentRow[];
        deadAgentsInProject = staleAgents.filter(a => a.id !== agentId).length;
      }

      return {
        success: true,
        agentId,
        registered: !existing,
        message: existing ? 'agent updated' : 'agent registered',
        // Include dead agent count so CLI can show a notice
        deadAgentsInProject,
        salvageHint: deadAgentsInProject > 0 ? `${deadAgentsInProject} dead agent(s) in ${identityProject}:*. Run: pd salvage --project ${identityProject}` : null,
        // Unmissable HITL: held spawn approvals surface at session start.
        approvalsHint: pendingApprovalsHint(),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Send heartbeat for an agent (enriched with status, readiness, progress)
   */
  function heartbeat(agentId: string, options: HeartbeatOptions = {}) {
    if (!agentId || typeof agentId !== 'string') {
      return { success: false, error: 'agent ID must be a non-empty string' };
    }

    const { pid = process.pid, status, readiness, progress } = options;
    const now = Date.now();

    const existing = stmts.get.get(agentId) as AgentRow | undefined;
    if (!existing) {
      // Auto-register on first heartbeat
      return register(agentId, { pid, ...options });
    }

    // Validate status if provided
    if (status !== undefined && !(VALID_STATUSES as readonly string[]).includes(status)) {
      return { success: false, error: `Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}` };
    }

    // Validate readiness checks if provided
    if (readiness !== undefined) {
      if (!Array.isArray(readiness)) {
        return { success: false, error: 'readiness must be an array of checks' };
      }
      for (const check of readiness) {
        if (!check || typeof check.name !== 'string' || typeof check.ok !== 'boolean') {
          return { success: false, error: 'Each readiness check must have a string "name" and boolean "ok"' };
        }
      }
    }

    // Build update values (null = keep existing via COALESCE)
    const statusValue = status !== undefined ? status : null;
    const readinessValue = readiness !== undefined ? JSON.stringify(readiness) : null;
    const progressValue = progress !== undefined ? progress : null;

    stmts.heartbeat.run(now, pid, statusValue, readinessValue, progressValue, agentId);

    // Compute health assessment for response
    const effectiveStatus = status || existing.status || 'ready';
    const effectiveReadiness = readiness || safeJsonParse(existing.readiness) as ReadinessCheck[] | null;
    const failingChecks = effectiveReadiness
      ? effectiveReadiness.filter(c => !c.ok).map(c => c.name)
      : [];
    const readinessState = failingChecks.length > 0 ? 'not_ready' : 'ready';

    return {
      success: true,
      agentId,
      lastHeartbeat: now,
      message: 'heartbeat recorded',
      health: {
        liveness: 'alive' as const,
        readiness: readinessState,
        failingChecks
      }
    };
  }

  /**
   * Unregister an agent
   */
  function unregister(agentId: string) {
    if (!agentId || typeof agentId !== 'string') {
      return { success: false, error: 'agent ID must be a non-empty string' };
    }

    const existing = stmts.get.get(agentId) as AgentRow | undefined;
    if (!existing) {
      return { success: true, unregistered: false, message: 'agent not found' };
    }

    stmts.unregister.run(agentId);

    // Remove from trie (targeted 1:N removal by entryId)
    if (semanticIndex) {
      const identity = [existing.identity_project, existing.identity_stack, existing.identity_context]
        .filter(Boolean).join(':');
      if (identity) semanticIndex.unindexEntry(identity, agentId);
    }

    return {
      success: true,
      unregistered: true,
      agentId,
      message: 'agent unregistered'
    };
  }

  /**
   * Format agent row for API response
   */
  function formatAgent(agent: AgentRow, now: number): AgentFormatted {
    const identity = [agent.identity_project, agent.identity_stack, agent.identity_context]
      .filter(Boolean).join(':') || null;

    const agentStatus = agent.status || 'ready';
    const readiness = safeJsonParse(agent.readiness) as ReadinessCheck[] | null;
    const sinceHeartbeat = now - agent.last_heartbeat;

    // Dormant directory presence is not dispatch readiness, even with stale passing checks.
    const statusReady = agentStatus === 'ready' || agentStatus === 'busy';
    const checksPass = !readiness || readiness.every(c => c.ok);
    const isReady = sinceHeartbeat < DEFAULT_AGENT_TTL && statusReady && checksPass;

    // Health assessment using adaptive thresholds
    const deadThreshold = getDeadThresholdForStatus(agentStatus);
    const staleThreshold = getStaleThresholdForStatus(agentStatus);
    let liveness: 'alive' | 'stale' | 'dead';
    if (sinceHeartbeat >= deadThreshold) {
      liveness = 'dead';
    } else if (sinceHeartbeat >= staleThreshold) {
      liveness = 'stale';
    } else {
      liveness = 'alive';
    }
    const graceRemaining = Math.max(0, deadThreshold - sinceHeartbeat);

    return {
      id: agent.id,
      name: agent.name,
      pid: agent.pid,
      type: agent.type,
      registeredAt: agent.registered_at,
      lastHeartbeat: agent.last_heartbeat,
      isActive: (now - agent.last_heartbeat) < DEFAULT_AGENT_TTL,
      maxServices: agent.max_services,
      maxLocks: agent.max_locks,
      metadata: safeJsonParse(agent.metadata),
      agentCard: safeJsonParse(agent.agent_card),
      skills: agent.skills ? agent.skills.split(',').map((s: string) => s.trim()) : [],
      worktreeId: agent.worktree_id,
      identity,
      identityProject: agent.identity_project,
      identityStack: agent.identity_stack,
      identityContext: agent.identity_context,
      purpose: agent.purpose,
      status: agentStatus,
      readiness,
      isReady,
      progress: agent.progress,
      healthAssessment: {
        liveness,
        graceRemaining
      }
    };
  }

  /**
   * Get agent info
   */
  function get(agentId: string) {
    if (!agentId || typeof agentId !== 'string') {
      return { success: false, error: 'agent ID must be a non-empty string' };
    }

    const agent = stmts.get.get(agentId) as AgentRow | undefined;
    if (!agent) {
      return { success: false, error: 'agent not found' };
    }

    const now = Date.now();
    return {
      success: true,
      agent: {
        ...formatAgent(agent, now),
        timeSinceHeartbeat: now - agent.last_heartbeat
      }
    };
  }

  /**
   * Safely parse JSON, returning null on failure
   */
  function safeJsonParse(value: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  /**
   * List all agents
   */
  function list(options: ListOptions = {}) {
    const { activeOnly = false, worktreeId = null, identityPrefix = null, purpose = null, skills = null } = options;
    const now = Date.now();
    const threshold = now - DEFAULT_AGENT_TTL;

    let agents: AgentRow[];

    // Use complex pattern matcher if wildcards are present or multiple filters are active
    if (identityPrefix?.includes('*') || purpose?.includes('*') || skills?.includes('*') ||
        (identityPrefix && purpose) || (identityPrefix && skills) || (purpose && skills)) {
      if (identityPrefix?.includes('*') && !purpose && !skills && semanticIndex) {
        // Trie-accelerated: identity-only wildcard with no purpose/skills filters
        const entries = semanticIndex.find(identityPrefix).filter(e => e.type === 'agent');
        agents = batchFetchAgents(entries.map(e => e.id));
        if (activeOnly) agents = agents.filter(a => a.last_heartbeat > threshold);
        if (worktreeId) agents = agents.filter(a => a.worktree_id === worktreeId);
      } else {
        const identityPattern = identityPrefix ? (identityPrefix.includes('*') ? patternToSql(identityPrefix) : identityPrefix + '%') : '%';
        const purposePattern = purpose ? (purpose.includes('*') ? purpose.replace(/\*/g, '%') : '%' + purpose + '%') : null;
        const skillsPattern = skills ? (skills.includes('*') ? skills.replace(/\*/g, '%') : '%' + skills + '%') : null;

        agents = stmts.listByComplexPattern.all(
          threshold,
          activeOnly ? 1 : 0,
          worktreeId,
          worktreeId,
          identityPattern,
          purposePattern,
          purposePattern,
          skillsPattern,
          skillsPattern
        ) as AgentRow[];
      }
    } else if (identityPrefix) {
      // Parse identity to get project (and optionally stack)
      const parsed = parseIdentity(identityPrefix);
      if (parsed.valid) {
        if (parsed.stack) {
          agents = stmts.listByProjectStack.all(parsed.project, parsed.stack) as AgentRow[];
        } else {
          agents = stmts.listByProject.all(parsed.project) as AgentRow[];
        }
      } else {
        agents = [];
      }
    } else if (worktreeId) {
      agents = (activeOnly
        ? stmts.listActiveByWorktree.all(threshold, worktreeId)
        : stmts.listByWorktree.all(worktreeId)) as AgentRow[];
    } else {
      agents = (activeOnly
        ? stmts.listActive.all(threshold)
        : stmts.list.all()) as AgentRow[];
    }

    // Apply active/worktree filter if needed and using simple identity filter (complex matcher already handles it)
    if (!identityPrefix?.includes('*') && !purpose?.includes('*') && !(identityPrefix && purpose)) {
      if (activeOnly && (identityPrefix || worktreeId)) {
        agents = agents.filter(a => a.last_heartbeat > threshold);
      }
      if (worktreeId && identityPrefix) {
        agents = agents.filter(a => a.worktree_id === worktreeId);
      }
    }

    return {
      success: true,
      agents: agents.map(a => formatAgent(a, now)),
      count: agents.length
    };
  }

  /**
   * List stale/dead agents (for resurrection) with optional filters
   */
  function listStale(options: { worktreeId?: string; identityPrefix?: string } = {}) {
    const now = Date.now();
    const threshold = now - DEFAULT_AGENT_TTL;

    let agents: AgentRow[];

    if (options.identityPrefix) {
      if (options.identityPrefix.includes('*')) {
        if (semanticIndex) {
          // Trie-accelerated: get matching agent IDs, batch-fetch, filter by staleness
          const entries = semanticIndex.find(options.identityPrefix).filter(e => e.type === 'agent');
          const allMatching = batchFetchAgents(entries.map(e => e.id));
          agents = allMatching.filter(a => a.last_heartbeat < threshold);
        } else {
          const sqlPattern = patternToSql(options.identityPrefix);
          agents = stmts.listStaleByPattern.all(threshold, sqlPattern) as AgentRow[];
        }
      } else {
        const parsed = parseIdentity(options.identityPrefix);
        if (parsed.valid) {
          agents = stmts.listStaleByProject.all(threshold, parsed.project) as AgentRow[];
          // Further filter by stack if provided
          if (parsed.stack) {
            agents = agents.filter(a => a.identity_stack === parsed.stack);
          }
        } else {
          agents = [];
        }
      }
    } else if (options.worktreeId) {
      agents = stmts.listStaleByWorktree.all(threshold, options.worktreeId) as AgentRow[];
    } else {
      agents = stmts.listStale.all(threshold) as AgentRow[];
    }

    return {
      success: true,
      agents: agents.map(a => formatAgent(a, now)),
      count: agents.length
    };
  }

  /**
   * Escape SQL LIKE pattern wildcards
   */
  function escapeLikePattern(str: string): string {
    // Escape SQL LIKE wildcards: % and _
    return str.replace(/[%_]/g, '\\$&');
  }

  /**
   * Check if agent can claim more services
   */
  function canClaimService(agentId: string): ResourceCheck {
    const agent = stmts.get.get(agentId) as AgentRow | undefined;
    if (!agent) return { allowed: true }; // Unregistered agents get default limits

    // Escape agentId to prevent SQL injection via LIKE wildcards
    const safeAgentId = escapeLikePattern(agentId);
    const countResult = stmts.countServices.get(`%"agent":"${safeAgentId}"%`) as { count: number };
    const currentCount = countResult?.count || 0;

    if (currentCount >= agent.max_services) {
      return {
        allowed: false,
        error: `agent has reached service limit (${agent.max_services})`,
        current: currentCount,
        max: agent.max_services
      };
    }

    return { allowed: true, current: currentCount, max: agent.max_services };
  }

  /**
   * Check if agent can acquire more locks
   */
  function canAcquireLock(agentId: string): ResourceCheck {
    const agent = stmts.get.get(agentId) as AgentRow | undefined;
    if (!agent) return { allowed: true }; // Unregistered agents get default limits

    const countResult = stmts.countLocks.get(agentId) as { count: number };
    const currentCount = countResult?.count || 0;

    if (currentCount >= agent.max_locks) {
      return {
        allowed: false,
        error: `agent has reached lock limit (${agent.max_locks})`,
        current: currentCount,
        max: agent.max_locks
      };
    }

    return { allowed: true, current: currentCount, max: agent.max_locks };
  }

  /**
   * Cleanup stale agents and release their resources
   */
  function cleanup(locks?: LocksLike, options: CleanupOptions = {}) {
    // ADR-0132 §2 rung 22: silence during a HALT is not a trigger. Every agent
    // was TOLD to go quiet, so a missed heartbeat proves compliance, not death.
    // While the sentinel is hoisted the reaper neither deletes handles nor
    // force-releases locks; the ladder resumes untouched when the halt lifts.
    if (isHalted()) {
      return {
        cleaned: 0,
        cleanedAgentIds: [] as string[],
        retainedAgentIds: [] as string[],
        releasedLocks: 0,
        halted: true,
        message: 'reaper idle: Port Daddy is halted (SECURITE HALT); silence is not death during a halt',
      };
    }
    const now = Date.now();
    // Cleanup is an operational death decision, not a display concern.
    // Agents may be "inactive" after 2 minutes for UI purposes while still
    // remaining eligible for resurrection/salvage until their dead threshold.
    const cleanupCandidates = (stmts.list.all() as AgentRow[]).filter(
      (agent) => (now - agent.last_heartbeat) > getDeadThresholdForStatus(agent.status)
    );

    let releasedLocks = 0;

    // Decide whether a dying display handle binds to a specific soul — the
    // daemon-written session stamp, NOT the alias table (see
    // lib/agent-soul-binding.ts for why the alias is not evidence here). This
    // is a MEMBERSHIP test keyed to the lock's stamped soul: a display handle
    // shared by several souls must not let one soul's session release another
    // soul's lock. `false` means "no ownership claim proved", NOT "unowned".
    const agentOwnsSoul = options.agentOwnsSoul
      ?? (options.sessions ? createReaperSoulResolver({ sessions: options.sessions }) : () => false);

    for (const agent of cleanupCandidates) {
      // Release locks owned by this agent.
      // Note: services don't track agent ownership (no agent_id column),
      // so service cleanup relies on expires_at TTL and PID liveness checks
      // in services.cleanup() instead.
      //
      // ─── Why this consults the lock's soul stamp ───────────────────────
      // `locks.owner` is a DISPLAY string and `agents.id` is a DISPLAY
      // handle that anyone can create with one uncredentialed
      // POST /agents/:id/heartbeat (it auto-registers). Matching those two
      // strings and calling release(force: true) skipped the soul-level
      // ownership check that makes the lock plane enforced
      // (routes/locks.ts' LOCK_OWNER_MISMATCH) — so the potent primitive was
      // not forging a heartbeat but WITHHOLDING one: register a handle equal
      // to a lock's owner string, stop heartbeating, and the reaper destroys
      // a lock held by a different, credentialed soul.
      //
      // The rule now: a lock carrying a stamped actorId is released only when
      // the dying handle resolves to THAT soul. When it does not — including
      // when nothing can prove the binding at all — the lock is left to its
      // TTL, which is the correct fail-closed outcome: expiry loses a few
      // minutes, force-release loses another agent's mutual exclusion.
      // Unstamped locks have no ownership claim to honour and keep the
      // historical owner-string behaviour.
      // Regression test: tests/unit/heartbeat-lock-invariant.test.js.
      if (locks) {
        const lockResult = locks.list({ owner: agent.id });
        const candidateLocks = lockResult.locks || [];
        for (const lock of candidateLocks) {
          const metadata = lock.metadata && typeof lock.metadata === 'object' && !Array.isArray(lock.metadata)
            ? lock.metadata as Record<string, unknown>
            : null;
          const stampedActor = typeof metadata?.actorId === 'string' && metadata.actorId
            ? metadata.actorId
            : null;
          // A stamped lock is force-released only when the dying handle is
          // proven to bind to THAT soul (membership among its session stamps).
          // A shared display handle carrying another soul's session must not
          // qualify; when nothing proves the binding, the lock is left to TTL.
          if (stampedActor && !agentOwnsSoul(agent.id, stampedActor)) continue;
          locks.release(lock.name, { force: true });
          releasedLocks++;
        }
      }
    }

    const retainedAgentIds: string[] = [];
    const cleanedAgentIds: string[] = [];
    for (const agent of cleanupCandidates) {
      if (options.sessions?.activeDurableSessionIdsByAgent?.(agent.id, { verifiedOnly: true }).length) {
        retainedAgentIds.push(agent.id);
        continue;
      }
      stmts.deleteById.run(agent.id);
      cleanedAgentIds.push(agent.id);
    }

    return {
      cleaned: cleanedAgentIds.length,
      cleanedAgentIds,
      retainedAgentIds,
      releasedLocks,
      halted: false,
      message: `cleaned ${cleanedAgentIds.length} stale agent(s)`
    };
  }

  return {
    register,
    heartbeat,
    unregister,
    get,
    list,
    listStale,
    canClaimService,
    canAcquireLock,
    cleanup,
    DEFAULT_HEARTBEAT_INTERVAL,
    DEFAULT_AGENT_TTL,
    DEFAULT_DISPLAY_TTL,
    DEFAULT_CLEANUP_TTL,
    VALID_STATUSES: VALID_STATUSES as unknown as string[]
  };
}
