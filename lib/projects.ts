/**
 * Projects Module
 *
 * Central registry for projects known to Port Daddy.
 * Lightweight — the source of truth is still .portdaddyrc.
 * This table exists so the dashboard can show "all known projects"
 * without scanning the filesystem.
 */

import type Database from 'better-sqlite3';

interface ProjectRow {
  id: string;
  root: string;
  type: string;
  config: string | null;
  services: string | null;
  last_scanned: number;
  created_at: number;
  metadata: string | null;
}

interface ProjectDeserialized {
  id: string;
  root: string;
  type: string;
  config: Record<string, unknown> | null;
  services: Record<string, unknown> | null;
  last_scanned: number;
  created_at: number;
  metadata: Record<string, unknown> | null;
}

interface RegisterInput {
  id: string;
  root: string;
  type?: string;
  config?: Record<string, unknown> | null;
  services?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Initialize the projects module with a database connection.
 */
export function createProjects(db: Database.Database) {
  // Prepared statements
  const stmts = {
    getById: db.prepare('SELECT * FROM projects WHERE id = ?'),
    getByPath: db.prepare('SELECT * FROM projects WHERE root = ?'),
    getAll: db.prepare('SELECT * FROM projects ORDER BY last_scanned DESC'),
    upsert: db.prepare(`
      INSERT INTO projects (id, root, type, config, services, last_scanned, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        root = excluded.root,
        type = excluded.type,
        config = excluded.config,
        services = excluded.services,
        last_scanned = excluded.last_scanned,
        metadata = excluded.metadata
    `),
    deleteById: db.prepare('DELETE FROM projects WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) as count FROM projects')
  };

  /**
   * Register or update a project.
   */
  function register(project: RegisterInput): ProjectDeserialized | null {
    const now = Date.now();
    const existing = stmts.getById.get(project.id) as ProjectRow | undefined;

    stmts.upsert.run(
      project.id,
      project.root,
      project.type || 'single',
      project.config ? JSON.stringify(project.config) : null,
      project.services ? JSON.stringify(project.services) : null,
      now,
      existing?.created_at || now,
      project.metadata ? JSON.stringify(project.metadata) : null
    );

    return get(project.id);
  }

  /**
   * Get a project by ID.
   */
  function get(id: string): ProjectDeserialized | null {
    const row = stmts.getById.get(id) as ProjectRow | undefined;
    return row ? deserialize(row) : null;
  }

  /**
   * Get a project by its root directory path.
   */
  function getByPath(root: string): ProjectDeserialized | null {
    const row = stmts.getByPath.get(root) as ProjectRow | undefined;
    return row ? deserialize(row) : null;
  }

  /**
   * List all registered projects.
   */
  function list(): ProjectDeserialized[] {
    return (stmts.getAll.all() as ProjectRow[]).map(deserialize);
  }

  /**
   * Remove a project by ID.
   */
  function remove(id: string): boolean {
    const result = stmts.deleteById.run(id);
    return result.changes > 0;
  }

  /**
   * Get the count of registered projects.
   */
  function count(): number {
    return (stmts.count.get() as { count: number }).count;
  }

  /**
   * Deserialize JSON fields from a database row.
   */
  function safeJsonParse(value: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function deserialize(row: ProjectRow): ProjectDeserialized {
    return {
      ...row,
      config: safeJsonParse(row.config),
      services: safeJsonParse(row.services),
      metadata: safeJsonParse(row.metadata)
    };
  }

  return { register, get, getByPath, list, remove, count };
}
