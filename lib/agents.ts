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

const DEFAULT_HEARTBEAT_INTERVAL = 30000;  // 30 seconds
const DEFAULT_AGENT_TTL = 120000;          // 2 minutes without heartbeat = display as inactive
const DEFAULT_DISPLAY_TTL = DEFAULT_AGENT_TTL;  // Renamed: display concern
const DEFAULT_MAX_SERVICES_PER_AGENT = 50;
const DEFAULT_MAX_LOCKS_PER_AGENT = 20;

const VALID_STATUSES = ['starting', 'ready', 'busy', 'draining'] as const;

/**
 * Server-only authority channel for binding a daemon-minted actor to its
 * canonical inbox registration. Symbols cannot arrive through HTTP, IPC, or
 * MessagePack, so a caller cannot manufacture this option with a body field.
 */
export const VERIFIED_ACTOR_INBOX_REGISTRATION: unique symbol = Symbol('verified-actor-inbox-registration');

export interface VerifiedActorInboxRegistration {
  actorId: string;
  harbor: string;
}

export interface LiveActorInboxBinding {
  actorId: string;
  harbor: string;
  inboxTarget: string;
  boundAt: number;
  lastHeartbeat: number;
}

export type LiveActorInboxResolution =
  | { success: true; binding: LiveActorInboxBinding }
  | {
      success: false;
      code: 'ACTOR_INBOX_UNBOUND' | 'ACTOR_INBOX_STALE';
      error: string;
    };

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
  verified_actor_id: string | null;
  verified_actor_harbor: string | null;
  verified_inbox_bound_at: number | null;
}

interface RegisterOptions {
  [VERIFIED_ACTOR_INBOX_REGISTRATION]?: VerifiedActorInboxRegistration;
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

interface UnregisterOptions {
  [VERIFIED_ACTOR_INBOX_REGISTRATION]?: VerifiedActorInboxRegistration;
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
  actorInboxBinding: {
    verified: true;
    actorId: string;
    harbor: string;
    inboxTarget: string;
    boundAt: number;
  } | null;
}

interface ResourceCheck {
  allowed: boolean;
  error?: string;
  current?: number;
  max?: number;
}

interface LocksLike {
  list(options: { owner: string }): { locks?: Array<{ name: string }> };
  release(name: string, options: { force: boolean }): void;
}

interface AgentsOptions {
  semanticIndex?: SemanticIndex;
}

/**
 * Initialize agent registry with database connection
 */
export function createAgents(db: Database.Database, options?: AgentsOptions) {
  const semanticIndex = options?.semanticIndex;
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
      progress TEXT,
      verified_actor_id TEXT,
      verified_actor_harbor TEXT,
      verified_inbox_bound_at INTEGER
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
    'ALTER TABLE agents ADD COLUMN verified_actor_id TEXT',
    'ALTER TABLE agents ADD COLUMN verified_actor_harbor TEXT',
    'ALTER TABLE agents ADD COLUMN verified_inbox_bound_at INTEGER',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* already exists */ }
  }

  const stmts = {
    get: db.prepare('SELECT * FROM agents WHERE id = ?'),
    register: db.prepare(`
      INSERT OR REPLACE INTO agents (id, name, pid, type, registered_at, last_heartbeat, metadata, agent_card, skills, max_services, max_locks, worktree_id, identity_project, identity_stack, identity_context, purpose, status, readiness, progress, verified_actor_id, verified_actor_harbor, verified_inbox_bound_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    const rawInboxRegistration = options[VERIFIED_ACTOR_INBOX_REGISTRATION];
    let inboxRegistration: VerifiedActorInboxRegistration | null = null;
    if (rawInboxRegistration !== undefined) {
      const actorId = typeof rawInboxRegistration?.actorId === 'string'
        ? rawInboxRegistration.actorId.trim()
        : '';
      const harbor = typeof rawInboxRegistration?.harbor === 'string'
        ? rawInboxRegistration.harbor.trim()
        : '';
      if (!actorId || !harbor || actorId !== agentId) {
        return {
          success: false,
          error: 'verified actor inbox registration must bind this exact canonical actor and harbor',
          code: 'ACTOR_INBOX_BINDING_INVALID',
        };
      }
      inboxRegistration = { actorId, harbor };
    }
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

    if (existing?.verified_actor_id && !inboxRegistration) {
      return {
        success: false,
        error: 'this agent id is reserved by a verified actor inbox registration',
        code: 'ACTOR_INBOX_CREDENTIAL_REQUIRED',
      };
    }
    if (
      existing?.verified_actor_id
      && inboxRegistration
      && (
        existing.verified_actor_id !== inboxRegistration.actorId
        || existing.verified_actor_harbor !== inboxRegistration.harbor
      )
    ) {
      return {
        success: false,
        error: 'this canonical actor inbox is already bound in another authority scope',
        code: 'ACTOR_INBOX_BINDING_CONFLICT',
      };
    }

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
        null,  // progress (set via heartbeat)
        inboxRegistration?.actorId ?? null,
        inboxRegistration?.harbor ?? null,
        inboxRegistration
          ? existing?.verified_inbox_bound_at ?? now
          : null,
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
  function unregister(agentId: string, options: UnregisterOptions = {}) {
    if (!agentId || typeof agentId !== 'string') {
      return { success: false, error: 'agent ID must be a non-empty string' };
    }

    const existing = stmts.get.get(agentId) as AgentRow | undefined;
    if (!existing) {
      return { success: true, unregistered: false, message: 'agent not found' };
    }

    if (existing.verified_actor_id) {
      const release = options[VERIFIED_ACTOR_INBOX_REGISTRATION];
      const releaseActorId = typeof release?.actorId === 'string' ? release.actorId.trim() : '';
      const releaseHarbor = typeof release?.harbor === 'string' ? release.harbor.trim() : '';
      if (
        releaseActorId !== existing.verified_actor_id
        || releaseHarbor !== existing.verified_actor_harbor
        || releaseActorId !== agentId
      ) {
        return {
          success: false,
          unregistered: false,
          agentId,
          error: 'verified actor inbox release requires the matching server authority',
          code: 'ACTOR_INBOX_CREDENTIAL_REQUIRED',
        };
      }
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

    // isReady: status must be ready|busy AND all readiness checks must pass (or none reported)
    const statusReady = agentStatus === 'ready' || agentStatus === 'busy';
    const checksPass = !readiness || readiness.every(c => c.ok);
    const isReady = statusReady && checksPass;

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
      },
      actorInboxBinding: agent.verified_actor_id
        && agent.verified_actor_harbor
        && typeof agent.verified_inbox_bound_at === 'number'
        ? {
            verified: true,
            actorId: agent.verified_actor_id,
            harbor: agent.verified_actor_harbor,
            inboxTarget: agent.id,
            boundAt: agent.verified_inbox_bound_at,
          }
        : null,
    };
  }

  /**
   * Resolve only a fresh, server-bound inbox registration. Session agentId,
   * display aliases, and caller-selected targets are deliberately absent from
   * this lookup: the canonical endpoint is the verified actor's own registry
   * row, scoped to the harbor that authenticated it.
   */
  function resolveLiveActorInbox(actorId: string, harbor: string): LiveActorInboxResolution {
    const canonicalActorId = typeof actorId === 'string' ? actorId.trim() : '';
    const canonicalHarbor = typeof harbor === 'string' ? harbor.trim() : '';
    if (!canonicalActorId || !canonicalHarbor) {
      return {
        success: false,
        code: 'ACTOR_INBOX_UNBOUND',
        error: 'actor inbox lookup requires a canonical actor and harbor',
      };
    }

    const row = stmts.get.get(canonicalActorId) as AgentRow | undefined;
    if (
      !row
      || row.verified_actor_id !== canonicalActorId
      || row.verified_actor_harbor !== canonicalHarbor
      || typeof row.verified_inbox_bound_at !== 'number'
    ) {
      return {
        success: false,
        code: 'ACTOR_INBOX_UNBOUND',
        error: `actor '${canonicalActorId}' has no server-bound inbox in harbor '${canonicalHarbor}'`,
      };
    }

    // DEFAULT_AGENT_TTL is display-only. Delivery liveness uses the registry's
    // authoritative status ladder so background agents without a heartbeat
    // loop remain reachable until they are operationally dead.
    if (Date.now() - row.last_heartbeat >= getDeadThresholdForStatus(row.status)) {
      return {
        success: false,
        code: 'ACTOR_INBOX_STALE',
        error: `actor '${canonicalActorId}' has no live inbox registration in harbor '${canonicalHarbor}'`,
      };
    }

    return {
      success: true,
      binding: {
        actorId: canonicalActorId,
        harbor: canonicalHarbor,
        inboxTarget: row.id,
        boundAt: row.verified_inbox_bound_at,
        lastHeartbeat: row.last_heartbeat,
      },
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
  function cleanup(locks?: LocksLike) {
    const now = Date.now();
    // Cleanup is an operational death decision, not a display concern.
    // Agents may be "inactive" after 2 minutes for UI purposes while still
    // remaining eligible for resurrection/salvage until their dead threshold.
    const cleanupCandidates = (stmts.list.all() as AgentRow[]).filter(
      (agent) => (now - agent.last_heartbeat) > getDeadThresholdForStatus(agent.status)
    );

    let releasedLocks = 0;

    for (const agent of cleanupCandidates) {
      // Release locks owned by this agent.
      // Note: services don't track agent ownership (no agent_id column),
      // so service cleanup relies on expires_at TTL and PID liveness checks
      // in services.cleanup() instead.
      if (locks) {
        const lockResult = locks.list({ owner: agent.id });
        for (const lock of lockResult.locks || []) {
          locks.release(lock.name, { force: true });
          releasedLocks++;
        }
      }
    }

    for (const agent of cleanupCandidates) {
      stmts.deleteById.run(agent.id);
    }

    return {
      cleaned: cleanupCandidates.length,
      cleanedAgentIds: cleanupCandidates.map((agent) => agent.id),
      releasedLocks,
      message: `cleaned ${cleanupCandidates.length} stale agent(s)`
    };
  }

  return {
    register,
    heartbeat,
    unregister,
    get,
    resolveLiveActorInbox,
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
