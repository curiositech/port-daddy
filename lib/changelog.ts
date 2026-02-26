/**
 * Hierarchical Changelog System
 *
 * Agents report changes at the most specific level (product:service:feature).
 * The system rolls up changes to parent levels automatically:
 *   product:service:feature → product:service → product
 *
 * Design decisions:
 * - DB-first storage (no race conditions, queryable, survives restarts)
 * - Export to markdown on demand (for git commits, READMEs)
 * - Identity-based hierarchy using colon separators
 * - Session/agent linkage for attribution
 */

import type Database from 'better-sqlite3';

export interface ChangelogEntry {
  id: number;
  identity: string;           // e.g., "myapp:api:auth"
  sessionId: string | null;
  agentId: string | null;
  type: 'feature' | 'fix' | 'refactor' | 'docs' | 'chore' | 'breaking';
  summary: string;            // One-line summary
  description: string | null; // Detailed description (markdown)
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

interface ChangelogRow {
  id: number;
  identity: string;
  session_id: string | null;
  agent_id: string | null;
  type: string;
  summary: string;
  description: string | null;
  metadata: string | null;
  created_at: number;
}

export interface RollupEntry {
  identity: string;
  entries: ChangelogEntry[];
  children: RollupEntry[];
}

export function createChangelog(db: Database.Database) {
  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identity TEXT NOT NULL,
      session_id TEXT,
      agent_id TEXT,
      type TEXT NOT NULL DEFAULT 'feature',
      summary TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_changelog_identity ON changelog(identity)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_changelog_created ON changelog(created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_changelog_session ON changelog(session_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_changelog_agent ON changelog(agent_id)`);

  const stmts = {
    add: db.prepare(`
      INSERT INTO changelog (identity, session_id, agent_id, type, summary, description, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    get: db.prepare(`SELECT * FROM changelog WHERE id = ?`),
    listByIdentity: db.prepare(`
      SELECT * FROM changelog WHERE identity = ? ORDER BY created_at DESC LIMIT ?
    `),
    listByPrefix: db.prepare(`
      SELECT * FROM changelog WHERE identity LIKE ? ORDER BY created_at DESC LIMIT ?
    `),
    listRecent: db.prepare(`
      SELECT * FROM changelog ORDER BY created_at DESC LIMIT ?
    `),
    listBySession: db.prepare(`
      SELECT * FROM changelog WHERE session_id = ? ORDER BY created_at DESC
    `),
    listByAgent: db.prepare(`
      SELECT * FROM changelog WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
    `),
    listSince: db.prepare(`
      SELECT * FROM changelog WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?
    `),
    distinctIdentities: db.prepare(`
      SELECT DISTINCT identity FROM changelog ORDER BY identity
    `),
    cleanup: db.prepare(`DELETE FROM changelog WHERE created_at < ?`),
  };

  function formatEntry(row: ChangelogRow): ChangelogEntry {
    return {
      id: row.id,
      identity: row.identity,
      sessionId: row.session_id,
      agentId: row.agent_id,
      type: row.type as ChangelogEntry['type'],
      summary: row.summary,
      description: row.description,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
    };
  }

  /**
   * Get parent identity (one level up)
   * "myapp:api:auth" → "myapp:api"
   * "myapp:api" → "myapp"
   * "myapp" → null
   */
  function getParentIdentity(identity: string): string | null {
    const lastColon = identity.lastIndexOf(':');
    if (lastColon === -1) return null;
    return identity.substring(0, lastColon);
  }

  /**
   * Get all ancestor identities
   * "myapp:api:auth" → ["myapp:api", "myapp"]
   */
  function getAncestors(identity: string): string[] {
    const ancestors: string[] = [];
    let current = getParentIdentity(identity);
    while (current) {
      ancestors.push(current);
      current = getParentIdentity(current);
    }
    return ancestors;
  }

  /**
   * Get identity depth (number of colons + 1)
   * "myapp" → 1
   * "myapp:api" → 2
   * "myapp:api:auth" → 3
   */
  function getDepth(identity: string): number {
    return identity.split(':').length;
  }

  return {
    /**
     * Add a changelog entry
     */
    add(options: {
      identity: string;
      summary: string;
      type?: ChangelogEntry['type'];
      description?: string;
      sessionId?: string;
      agentId?: string;
      metadata?: Record<string, unknown>;
    }) {
      const now = Date.now();
      const result = stmts.add.run(
        options.identity,
        options.sessionId || null,
        options.agentId || null,
        options.type || 'feature',
        options.summary,
        options.description || null,
        options.metadata ? JSON.stringify(options.metadata) : null,
        now
      );

      return {
        success: true,
        id: result.lastInsertRowid as number,
        identity: options.identity,
        ancestors: getAncestors(options.identity),
      };
    },

    /**
     * Get a single entry by ID
     */
    get(id: number) {
      const row = stmts.get.get(id) as ChangelogRow | undefined;
      if (!row) {
        return { success: false, error: 'Entry not found' };
      }
      return { success: true, entry: formatEntry(row) };
    },

    /**
     * List entries for an identity (exact match)
     */
    list(identity: string, limit: number = 50) {
      const rows = stmts.listByIdentity.all(identity, limit) as ChangelogRow[];
      return {
        success: true,
        identity,
        entries: rows.map(formatEntry),
        count: rows.length,
      };
    },

    /**
     * List entries for an identity and all children
     * "myapp" returns entries for "myapp", "myapp:api", "myapp:api:auth", etc.
     */
    listTree(identity: string, limit: number = 100) {
      const rows = stmts.listByPrefix.all(`${identity}%`, limit) as ChangelogRow[];
      return {
        success: true,
        identity,
        entries: rows.map(formatEntry),
        count: rows.length,
      };
    },

    /**
     * List recent entries across all identities
     */
    recent(limit: number = 50) {
      const rows = stmts.listRecent.all(limit) as ChangelogRow[];
      return {
        success: true,
        entries: rows.map(formatEntry),
        count: rows.length,
      };
    },

    /**
     * List entries for a session
     */
    listBySession(sessionId: string) {
      const rows = stmts.listBySession.all(sessionId) as ChangelogRow[];
      return {
        success: true,
        sessionId,
        entries: rows.map(formatEntry),
        count: rows.length,
      };
    },

    /**
     * List entries for an agent
     */
    listByAgent(agentId: string, limit: number = 50) {
      const rows = stmts.listByAgent.all(agentId, limit) as ChangelogRow[];
      return {
        success: true,
        agentId,
        entries: rows.map(formatEntry),
        count: rows.length,
      };
    },

    /**
     * List entries since a timestamp
     */
    since(timestamp: number, limit: number = 100) {
      const rows = stmts.listSince.all(timestamp, limit) as ChangelogRow[];
      return {
        success: true,
        since: timestamp,
        entries: rows.map(formatEntry),
        count: rows.length,
      };
    },

    /**
     * Build hierarchical rollup for an identity
     * Returns a tree structure with entries grouped by identity level
     */
    rollup(rootIdentity: string): RollupEntry {
      const allRows = stmts.listByPrefix.all(`${rootIdentity}%`, 1000) as ChangelogRow[];
      const allEntries = allRows.map(formatEntry);

      // Group entries by identity
      const byIdentity = new Map<string, ChangelogEntry[]>();
      for (const entry of allEntries) {
        const existing = byIdentity.get(entry.identity) || [];
        existing.push(entry);
        byIdentity.set(entry.identity, existing);
      }

      // Build tree recursively
      function buildNode(identity: string): RollupEntry {
        const entries = byIdentity.get(identity) || [];
        const prefix = identity + ':';
        const childIdentities = Array.from(byIdentity.keys())
          .filter(id => id.startsWith(prefix) && getDepth(id) === getDepth(identity) + 1);

        return {
          identity,
          entries,
          children: childIdentities.map(buildNode),
        };
      }

      return buildNode(rootIdentity);
    },

    /**
     * Export changelog to markdown format
     * Supports multiple formats for different use cases
     */
    export(options: {
      identity?: string;
      since?: number;
      limit?: number;
      format?: 'flat' | 'tree' | 'keep-a-changelog';
    } = {}) {
      const format = options.format || 'flat';
      const limit = options.limit || 100;

      let entries: ChangelogEntry[];
      if (options.identity) {
        const rows = stmts.listByPrefix.all(`${options.identity}%`, limit) as ChangelogRow[];
        entries = rows.map(formatEntry);
      } else if (options.since) {
        const rows = stmts.listSince.all(options.since, limit) as ChangelogRow[];
        entries = rows.map(formatEntry);
      } else {
        const rows = stmts.listRecent.all(limit) as ChangelogRow[];
        entries = rows.map(formatEntry);
      }

      if (format === 'flat') {
        return this.exportFlat(entries);
      } else if (format === 'tree') {
        return this.exportTree(options.identity || '', entries);
      } else {
        return this.exportKeepAChangelog(entries);
      }
    },

    /**
     * Export as flat markdown list
     */
    exportFlat(entries: ChangelogEntry[]): string {
      const lines: string[] = ['# Changelog', ''];

      for (const entry of entries) {
        const date = new Date(entry.createdAt).toISOString().split('T')[0];
        const typeLabel = entry.type.toUpperCase();
        lines.push(`- **[${typeLabel}]** ${entry.summary} (${entry.identity}, ${date})`);
        if (entry.description) {
          lines.push(`  ${entry.description.split('\n').join('\n  ')}`);
        }
      }

      return lines.join('\n');
    },

    /**
     * Export as tree structure (grouped by identity hierarchy)
     */
    exportTree(rootIdentity: string, entries: ChangelogEntry[]): string {
      const rollup = this.rollup(rootIdentity || entries[0]?.identity.split(':')[0] || 'unknown');
      const lines: string[] = ['# Changelog', ''];

      function renderNode(node: RollupEntry, depth: number) {
        const indent = '  '.repeat(depth);
        const heading = '#'.repeat(Math.min(depth + 2, 6));

        if (node.entries.length > 0 || node.children.length > 0) {
          lines.push(`${heading} ${node.identity}`);
          lines.push('');

          for (const entry of node.entries) {
            const typeLabel = entry.type.toUpperCase();
            lines.push(`${indent}- **[${typeLabel}]** ${entry.summary}`);
            if (entry.description) {
              lines.push(`${indent}  ${entry.description.split('\n').join(`\n${indent}  `)}`);
            }
          }

          if (node.entries.length > 0) {
            lines.push('');
          }

          for (const child of node.children) {
            renderNode(child, depth + 1);
          }
        }
      }

      renderNode(rollup, 0);
      return lines.join('\n');
    },

    /**
     * Export in Keep a Changelog format (grouped by type)
     * https://keepachangelog.com/
     */
    exportKeepAChangelog(entries: ChangelogEntry[]): string {
      const lines: string[] = [
        '# Changelog',
        '',
        'All notable changes to this project are documented in this file.',
        '',
        'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).',
        '',
      ];

      // Group by type
      const byType = new Map<string, ChangelogEntry[]>();
      const typeOrder = ['breaking', 'feature', 'fix', 'refactor', 'docs', 'chore'];

      for (const entry of entries) {
        const existing = byType.get(entry.type) || [];
        existing.push(entry);
        byType.set(entry.type, existing);
      }

      const typeLabels: Record<string, string> = {
        breaking: 'Breaking Changes',
        feature: 'Added',
        fix: 'Fixed',
        refactor: 'Changed',
        docs: 'Documentation',
        chore: 'Maintenance',
      };

      for (const type of typeOrder) {
        const typeEntries = byType.get(type);
        if (typeEntries && typeEntries.length > 0) {
          lines.push(`### ${typeLabels[type] || type}`);
          lines.push('');
          for (const entry of typeEntries) {
            lines.push(`- ${entry.summary} (\`${entry.identity}\`)`);
          }
          lines.push('');
        }
      }

      return lines.join('\n');
    },

    /**
     * Get distinct identities (for discovery)
     */
    identities() {
      const rows = stmts.distinctIdentities.all() as { identity: string }[];
      return {
        success: true,
        identities: rows.map(r => r.identity),
        count: rows.length,
      };
    },

    /**
     * Cleanup old entries
     */
    cleanup(olderThan: number = 90 * 24 * 60 * 60 * 1000) {
      const cutoff = Date.now() - olderThan;
      const result = stmts.cleanup.run(cutoff);
      return { cleaned: result.changes };
    },

    // Expose helpers for testing
    getParentIdentity,
    getAncestors,
    getDepth,
  };
}
