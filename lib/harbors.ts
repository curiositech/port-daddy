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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HarborRow {
  name: string;
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

export function createHarbors(db: Database.Database, deps: HarborsDeps = {}) {
  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS harbors (
      name        TEXT PRIMARY KEY,
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

  const stmts = {
    // INSERT OR IGNORE: routes enforce uniqueness (409 if exists), so conflicts only
    // occur in races. OR IGNORE means the loser silently no-ops rather than
    // CASCADE-deleting all harbor members as OR REPLACE would.
    insert: db.prepare(`
      INSERT OR IGNORE INTO harbors (name, capabilities, channels, agent_patterns, created_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getByName: db.prepare('SELECT * FROM harbors WHERE name = ?'),
    listAll: db.prepare('SELECT * FROM harbors ORDER BY created_at DESC LIMIT ?'),
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
  };

  function parseHarbor(row: HarborRow, members: HarborMemberRow[]): Harbor {
    return {
      name: row.name,
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
        JSON.stringify(options.capabilities ?? []),
        JSON.stringify(options.channels ?? []),
        JSON.stringify(options.agentPatterns ?? []),
        now,
        expiresAt,
        options.metadata ? JSON.stringify(options.metadata) : null
      );

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
     * List all harbors (with member counts, no member details).
     */
    list(limit = 50): Harbor[] {
      // Clean expired harbors first
      stmts.deleteExpired.run(Date.now());
      const rows = stmts.listAll.all(limit) as HarborRow[];
      return rows.map(row => {
        const members = stmts.listMembers.all(row.name) as HarborMemberRow[];
        return parseHarbor(row, members);
      });
    },

    /**
     * Agent enters a harbor, declaring capabilities.
     *
     * If `harborTokens` is provided in deps, issues a signed JWT harbor card
     * and returns it as `harborCard`. The card proves the agent's authorization
     * to operate within this harbor during its TTL.
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
