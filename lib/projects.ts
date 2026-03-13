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
  tags: string | null;
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
  tags: string[] | null;
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
  tags?: string[] | string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Initialize the projects module with a database connection.
 */
export function createProjects(db: Database.Database) {
  // Migrations
  try {
    db.exec('ALTER TABLE projects ADD COLUMN tags TEXT');
  } catch { /* already exists */ }

  // Prepared statements
  const stmts = {
    getById: db.prepare('SELECT * FROM projects WHERE id = ?'),
    getByPath: db.prepare('SELECT * FROM projects WHERE root = ?'),
    getAll: db.prepare('SELECT * FROM projects ORDER BY last_scanned DESC'),
    getByPattern: db.prepare(`
      SELECT * FROM projects 
      WHERE (id LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
      ORDER BY last_scanned DESC
    `),
    upsert: db.prepare(`
      INSERT INTO projects (id, root, type, config, services, tags, last_scanned, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        root = excluded.root,
        type = excluded.type,
        config = excluded.config,
        services = excluded.services,
        tags = COALESCE(excluded.tags, tags),
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
    const tagsValue = Array.isArray(project.tags) ? project.tags.join(',') : (project.tags || null);

    stmts.upsert.run(
      project.id,
      project.root,
      project.type || 'single',
      project.config ? JSON.stringify(project.config) : null,
      project.services ? JSON.stringify(project.services) : null,
      tagsValue,
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
   * List registered projects.
   */
  function list(options: { pattern?: string } = {}): ProjectDeserialized[] {
    const { pattern = null } = options;
    let rows: ProjectRow[];

    if (pattern) {
      const sqlPattern = pattern.includes('*') ? pattern.replace(/\*/g, '%') : `%${pattern}%`;
      rows = stmts.getByPattern.all(sqlPattern, sqlPattern) as ProjectRow[];
    } else {
      rows = stmts.getAll.all() as ProjectRow[];
    }

    return rows.map(deserialize);
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
      tags: row.tags ? row.tags.split(',').map(t => t.trim()) : [],
      metadata: safeJsonParse(row.metadata)
    };
  }

  return { register, get, getByPath, list, remove, count };
}
