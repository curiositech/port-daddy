/**
 * Harbors — Named Permission Namespaces for Agent Coordination
 *
 * A harbor is a scoped coordination context that groups agents together
 * with declared capabilities and channel access. Think of it as a named
 * room that agents enter and leave. While inside a harbor, agents
 * advertise what they can do and which channels they communicate on.
 *
 * Enforcement is advisory in v1 — like file claims, harbors record
 * intent and enable discovery. Protocol-level enforcement (JWT capability
 * tokens) is deferred to v4.
 *
 * Analogy: A harbor is where ships (agents) dock. Each ship declares its
 * cargo (capabilities). The harbormaster (Port Daddy) keeps the manifest.
 */

import type Database from 'better-sqlite3';
import type { HarborTokens } from './harbor-tokens.js';
import {
  assessEnvelope,
  parseEnvelope,
  type EnvelopeAction,
  type EnvelopeVerdict,
  type HarborEnvelope,
} from './harbor-envelope.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HarborRow {
  name: string;
  scope: string | null;
  capabilities: string;      // JSON array of strings
  channels: string;          // JSON array of channel names
  agent_patterns: string;    // JSON array of identity glob patterns
  created_at: number;
  expires_at: number | null;
  metadata: string | null;
}

export interface HarborMemberRow {
  harbor_name: string;
  agent_id: string;
  identity: string | null;
  capabilities: string | null; // JSON — agent's self-declared capabilities
  joined_at: number;
}

export interface Harbor {
  name: string;
  scope: string | null;
  capabilities: string[];
  channels: string[];
  agentPatterns: string[];
  members: HarborMember[];
  createdAt: number;
  expiresAt: number | null;
  metadata: Record<string, unknown> | null;
}

export interface HarborMember {
  agentId: string;
  identity: string | null;
  capabilities: string[];
  joinedAt: number;
}

export interface CreateHarborOptions {
  scope?: string | null;
  capabilities?: string[];
  channels?: string[];
  agentPatterns?: string[];
  expiresIn?: number;  // ms
  metadata?: Record<string, unknown>;
}

export interface EnterHarborOptions {
  identity?: string;
  capabilities?: string[];
}

// ─── Module ──────────────────────────────────────────────────────────────────

export interface HarborsDeps {
  harborTokens?: HarborTokens;
}

/**
 * The sidecar projection hook for a canonical harbor membership write.
 *
 * The Harbor remains the membership authority; listeners only maintain
 * projections such as Whois. Accepting an async result lets an admission
 * await the durable projection when it is useful to the caller, while the
 * `enter()` boundary still protects the membership write from a failed
 * optional projection.
 *
 * @param agentId - Canonical agent identifier recorded in the membership.
 * @param harborName - Canonical Harbor namespace that owns the membership.
 * @param phrases - Declared capability phrases to project.
 * @returns Nothing, or a promise that settles once the projection attempt ends.
 */
type CapabilityListener = (
  agentId: string,
  harborName: string,
  phrases: string[],
) => void | Promise<void>;

export function createHarbors(db: Database.Database, deps: HarborsDeps = {}) {
  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS harbors (
      name        TEXT PRIMARY KEY,
      scope       TEXT,
      capabilities TEXT NOT NULL DEFAULT '[]',
      channels     TEXT NOT NULL DEFAULT '[]',
      agent_patterns TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER,
      metadata    TEXT
    );

    CREATE TABLE IF NOT EXISTS harbor_members (
      harbor_name TEXT NOT NULL REFERENCES harbors(name) ON DELETE CASCADE,
      agent_id    TEXT NOT NULL,
      identity    TEXT,
      capabilities TEXT,
      joined_at   INTEGER NOT NULL,
      PRIMARY KEY (harbor_name, agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_harbor_members_agent ON harbor_members(agent_id);

    -- Partial index: only non-null expires_at rows — supports deleteExpired query
    CREATE INDEX IF NOT EXISTS idx_harbors_expires ON harbors(expires_at)
      WHERE expires_at IS NOT NULL;

    -- Supports ORDER BY created_at DESC in list() / listAll query
    CREATE INDEX IF NOT EXISTS idx_harbors_created ON harbors(created_at);
  `);

  const harborColumns = db.prepare('PRAGMA table_info(harbors)').all() as Array<{ name: string }>;
  if (!harborColumns.some((column) => column.name === 'scope')) {
    db.prepare('ALTER TABLE harbors ADD COLUMN scope TEXT').run();
  }
  // Envelope: the vacuum-sealed resource boundary an agent operates inside while
  // docked here (filesystem roots, tool/skill/mcp/backend/channel allowlists,
  // spend ceiling). Stored as JSON. NULL means "no envelope set" — which
  // assertWithinEnvelope() treats as deny-all, never allow-all. See
  // lib/harbor-envelope.ts (ADR-0013 enforcement, filling the advisory-v1 gap).
  if (!harborColumns.some((column) => column.name === 'envelope')) {
    db.prepare('ALTER TABLE harbors ADD COLUMN envelope TEXT').run();
  }

  const stmts = {
    // INSERT OR IGNORE: routes enforce uniqueness (409 if exists), so conflicts only
    // occur in races. OR IGNORE means the loser silently no-ops rather than
    // CASCADE-deleting all harbor members as OR REPLACE would.
    insert: db.prepare(`
      INSERT OR IGNORE INTO harbors (name, scope, capabilities, channels, agent_patterns, created_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getByName: db.prepare('SELECT * FROM harbors WHERE name = ?'),
    setMissingScope: db.prepare('UPDATE harbors SET scope = ? WHERE name = ? AND scope IS NULL'),
    listAll: db.prepare('SELECT * FROM harbors ORDER BY created_at DESC LIMIT ?'),
    listByPattern: db.prepare("SELECT * FROM harbors WHERE name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?"),
    deleteByName: db.prepare('DELETE FROM harbors WHERE name = ?'),
    deleteExpired: db.prepare('DELETE FROM harbors WHERE expires_at IS NOT NULL AND expires_at < ?'),

    insertMember: db.prepare(`
      INSERT OR REPLACE INTO harbor_members (harbor_name, agent_id, identity, capabilities, joined_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    removeMember: db.prepare('DELETE FROM harbor_members WHERE harbor_name = ? AND agent_id = ?'),
    removeAllMembersOfAgent: db.prepare('DELETE FROM harbor_members WHERE agent_id = ?'),
    listMembers: db.prepare('SELECT * FROM harbor_members WHERE harbor_name = ? ORDER BY joined_at ASC'),
    listMemberships: db.prepare('SELECT * FROM harbor_members WHERE agent_id = ? ORDER BY joined_at DESC'),
    isMember: db.prepare('SELECT 1 FROM harbor_members WHERE harbor_name = ? AND agent_id = ?'),

    getEnvelope: db.prepare('SELECT envelope FROM harbors WHERE name = ?'),
    setEnvelope: db.prepare('UPDATE harbors SET envelope = ? WHERE name = ?'),
  };

  // Capability listener — fires when an agent enters a harbor with declared
  // capabilities. Wired by server.ts to ferry phrases into the whois sidecar
  // embedder without coupling harbors.ts to that module. (PR #122)
  let capabilityListener: CapabilityListener | null = null;

  // Shared envelope read so both getEnvelope() and assertWithinEnvelope() use
  // the same fail-closed parsing, and neither depends on `this` binding.
  function readEnvelope(name: string): HarborEnvelope | null {
    const row = stmts.getEnvelope.get(name) as { envelope: string | null } | undefined;
    if (!row || row.envelope == null) return null;
    try {
      return parseEnvelope(JSON.parse(row.envelope));
    } catch {
      // Corrupt JSON is fail-closed: "set but deny-all", never "not set".
      return parseEnvelope(null);
    }
  }

  function parseHarbor(row: HarborRow, members: HarborMemberRow[]): Harbor {
    return {
      name: row.name,
      scope: row.scope ?? null,
      capabilities: JSON.parse(row.capabilities) as string[],
      channels: JSON.parse(row.channels) as string[],
      agentPatterns: JSON.parse(row.agent_patterns) as string[],
      members: members.map(m => ({
        agentId: m.agent_id,
        identity: m.identity,
        capabilities: m.capabilities ? JSON.parse(m.capabilities) as string[] : [],
        joinedAt: m.joined_at,
      })),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    };
  }

  return {
    /**
     * Register a listener invoked when an agent enters a harbor with declared
     * capabilities. Used by the whois sidecar to embed capability phrases for
     * skill-routing lookup. (PR #122)
     */
    setCapabilityListener(fn: CapabilityListener): void {
      capabilityListener = fn;
    },

    /**
     * Create or update a harbor.
     */
    create(name: string, options: CreateHarborOptions = {}): { success: boolean; harbor?: Harbor; error?: string } {
      if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9._:/-]+$/.test(name)) {
        return { success: false, error: 'harbor name must be non-empty and contain only alphanumeric, :, ., -, _, /' };
      }
      if (name.length > 120) return { success: false, error: 'harbor name too long (max 120 chars)' };

      const now = Date.now();
      const expiresAt = options.expiresIn ? now + options.expiresIn : null;

      stmts.insert.run(
        name,
        options.scope ?? null,
        JSON.stringify(options.capabilities ?? []),
        JSON.stringify(options.channels ?? []),
        JSON.stringify(options.agentPatterns ?? []),
        now,
        expiresAt,
        options.metadata ? JSON.stringify(options.metadata) : null
      );
      if (options.scope) {
        stmts.setMissingScope.run(options.scope, name);
      }

      const row = stmts.getByName.get(name) as HarborRow;
      const members = stmts.listMembers.all(name) as HarborMemberRow[];
      return { success: true, harbor: parseHarbor(row, members) };
    },

    /**
     * Destroy a harbor (cascades to members).
     */
    destroy(name: string): { success: boolean; error?: string } {
      const existing = stmts.getByName.get(name);
      if (!existing) return { success: false, error: `harbor '${name}' not found` };
      stmts.deleteByName.run(name);
      return { success: true };
    },

    /**
     * Get a single harbor with its member list.
     */
    get(name: string): Harbor | null {
      const row = stmts.getByName.get(name) as HarborRow | undefined;
      if (!row) return null;
      const members = stmts.listMembers.all(name) as HarborMemberRow[];
      return parseHarbor(row, members);
    },

    /**
     * List harbors (with member details).
     */
    list(options: { limit?: number; pattern?: string } = {}): Harbor[] {
      const { limit = 50, pattern = null } = options;
      // Clean expired harbors first
      stmts.deleteExpired.run(Date.now());

      let rows: HarborRow[];
      if (pattern) {
        let sqlPattern: string;
        if (pattern.includes('*')) {
          sqlPattern = pattern.replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/\*/g, '%');
        } else {
          sqlPattern = pattern;
        }
        rows = stmts.listByPattern.all(sqlPattern, limit) as HarborRow[];
      } else {
        rows = stmts.listAll.all(limit) as HarborRow[];
      }

      return rows.map(row => {
        const members = stmts.listMembers.all(row.name) as HarborMemberRow[];
        return parseHarbor(row, members);
      });
    },

    /**
     * Agent enters a harbor, declaring capabilities.
     *
     * If `harborTokens` is provided in deps, issues the active Phase 2 harbor
     * card and returns it as `harborCard`. Legacy Phase 1 cards are
     * compatibility-only and are never minted from this flow.
     */
    async enter(harborName: string, agentId: string, options: EnterHarborOptions = {}): Promise<{ success: boolean; harbor?: Harbor; harborCard?: string; error?: string }> {
      if (!agentId || typeof agentId !== 'string') return { success: false, error: 'agentId required' };

      const row = stmts.getByName.get(harborName) as HarborRow | undefined;
      if (!row) return { success: false, error: `harbor '${harborName}' not found` };

      // Check expiry
      if (row.expires_at && row.expires_at < Date.now()) {
        return { success: false, error: `harbor '${harborName}' has expired` };
      }

      stmts.insertMember.run(
        harborName,
        agentId,
        options.identity ?? null,
        options.capabilities ? JSON.stringify(options.capabilities) : null,
        Date.now()
      );

      // Notify the capability listener before acknowledging `enter()`. This
      // gives a normal Sugar begin a bounded chance to discover a freshly
      // admitted peer immediately through the canonical Whois projection. The
      // Harbor write remains authoritative: projection errors are non-fatal.
      if (capabilityListener && options.capabilities && options.capabilities.length > 0) {
        try { await capabilityListener(agentId, harborName, options.capabilities); }
        catch { /* listener errors are not fatal */ }
      }

      const members = stmts.listMembers.all(harborName) as HarborMemberRow[];
      const harbor = parseHarbor(row, members);

      // Issue harbor card if harborTokens is wired
      if (deps.harborTokens) {
        const harborCard = await deps.harborTokens.issueHarborCard({
          agentId,
          harborName,
          capabilities: options.capabilities ?? [],
          lastHeartbeat: Date.now(),
        });
        return { success: true, harbor, harborCard };
      }

      return { success: true, harbor };
    },

    /**
     * Agent leaves a harbor.
     */
    leave(harborName: string, agentId: string): { success: boolean; error?: string } {
      if (!agentId) return { success: false, error: 'agentId required' };
      const existing = stmts.isMember.get(harborName, agentId);
      if (!existing) return { success: false, error: `agent '${agentId}' is not in harbor '${harborName}'` };
      stmts.removeMember.run(harborName, agentId);
      return { success: true };
    },

    /**
     * Remove an agent from all harbors (called on agent unregister/death).
     */
    leaveAll(agentId: string): number {
      const result = stmts.removeAllMembersOfAgent.run(agentId);
      return result.changes;
    },

    /**
     * Fast membership check. O(1) index lookup.
     *
     * Used by bond escrow, capability gates, and any other daemon-
     * internal enforcement that needs to answer "is this agent in
     * this harbor?" without pulling full harbor/member rows.
     *
     * @example
     *   harbors.isMember('port-daddy:fleet', 'hawk-3'); // true | false
     */
    isMember(harborName: string, agentId: string): boolean {
      if (!harborName || !agentId) return false;
      return stmts.isMember.get(harborName, agentId) !== undefined;
    },

    /**
     * Read the harbor's enforcement envelope, or null if none is set.
     *
     * The stored JSON is normalized through parseEnvelope() on the way out, so
     * callers always receive a complete, valid envelope (every dimension
     * present) — never a half-populated object.
     */
    getEnvelope(name: string): HarborEnvelope | null {
      return readEnvelope(name);
    },

    /**
     * Set (or replace) the harbor's enforcement envelope. The value is
     * normalized to a complete deny-all-by-default envelope before storage.
     */
    setEnvelope(name: string, envelope: unknown): { success: boolean; error?: string } {
      const existing = stmts.getByName.get(name);
      if (!existing) return { success: false, error: `harbor '${name}' not found` };
      const normalized = parseEnvelope(envelope);
      stmts.setEnvelope.run(JSON.stringify(normalized), name);
      return { success: true };
    },

    /**
     * The fail-closed capability check. Answer: may `agentId`, acting inside
     * harbor `name`, perform `action`?
     *
     * Order of gates (each is a permission boundary that can be shown to the
     * operator via the returned `boundary`):
     *   1. Harbor must exist and not be expired      → else deny(membership)
     *   2. Agent must be a docked member             → else deny(membership)
     *   3. Action must satisfy the harbor's envelope → assessEnvelope()
     *
     * A harbor with no envelope set denies every action (deny-all default).
     * This is the primitive that routes and the spawner call before letting an
     * agent touch the filesystem, a tool, a backend, a channel, or spend.
     */
    assertWithinEnvelope(name: string, agentId: string, action: EnvelopeAction): EnvelopeVerdict {
      const row = stmts.getByName.get(name) as HarborRow | undefined;
      if (!row) {
        return { allowed: false, boundary: 'membership', reason: `harbor '${name}' does not exist` };
      }
      if (row.expires_at && row.expires_at < Date.now()) {
        return { allowed: false, boundary: 'membership', reason: `harbor '${name}' has expired` };
      }
      if (stmts.isMember.get(name, agentId) === undefined) {
        return { allowed: false, boundary: 'membership', reason: `agent '${agentId}' is not docked in harbor '${name}'` };
      }
      const envelope = readEnvelope(name) ?? parseEnvelope(null); // unset → deny-all
      return assessEnvelope(envelope, action);
    },

    /**
     * List all harbors an agent is currently in.
     */
    memberships(agentId: string): Harbor[] {
      const memberRows = stmts.listMemberships.all(agentId) as HarborMemberRow[];
      return memberRows.map(m => {
        const row = stmts.getByName.get(m.harbor_name) as HarborRow | undefined;
        if (!row) return null;
        const members = stmts.listMembers.all(m.harbor_name) as HarborMemberRow[];
        return parseHarbor(row, members);
      }).filter((h): h is Harbor => h !== null);
    },
  };
}

export type Harbors = ReturnType<typeof createHarbors>;
