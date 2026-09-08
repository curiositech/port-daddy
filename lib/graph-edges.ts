import type Database from 'better-sqlite3';

export interface GraphEdge {
  id: number;
  scope: string;
  projectDir: string | null;
  sourceType: string;
  sourceId: string;
  edgeType: string;
  targetType: string;
  targetId: string;
  weight: number;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdgeInput {
  scope: string;
  projectDir?: string | null;
  sourceType: string;
  sourceId: string;
  edgeType: string;
  targetType: string;
  targetId: string;
  weight?: number;
  metadata?: Record<string, unknown> | null;
}

interface GraphEdgeRow {
  id: number;
  scope: string;
  project_dir: string | null;
  source_type: string;
  source_id: string;
  edge_type: string;
  target_type: string;
  target_id: string;
  weight: number;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toEdge(row: GraphEdgeRow): GraphEdge {
  return {
    id: row.id,
    scope: row.scope,
    projectDir: row.project_dir,
    sourceType: row.source_type,
    sourceId: row.source_id,
    edgeType: row.edge_type,
    targetType: row.target_type,
    targetId: row.target_id,
    weight: row.weight,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createGraphEdges(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      project_dir TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_edges_scope ON graph_edges(scope);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_project ON graph_edges(project_dir, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_unique
      ON graph_edges(scope, source_type, source_id, edge_type, target_type, target_id);
  `);

  const stmts = {
    deleteScope: db.prepare(`DELETE FROM graph_edges WHERE scope = ?`),
    insert: db.prepare(`
      INSERT INTO graph_edges (
        scope, project_dir, source_type, source_id, edge_type, target_type, target_id,
        weight, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsert: db.prepare(`
      INSERT INTO graph_edges (
        scope, project_dir, source_type, source_id, edge_type, target_type, target_id,
        weight, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, source_type, source_id, edge_type, target_type, target_id)
      DO UPDATE SET
        project_dir = excluded.project_dir,
        weight = excluded.weight,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `),
    getExact: db.prepare(`
      SELECT * FROM graph_edges
      WHERE scope = ? AND source_type = ? AND source_id = ? AND edge_type = ? AND target_type = ? AND target_id = ?
      LIMIT 1
    `),
    deleteExact: db.prepare(`
      DELETE FROM graph_edges
      WHERE scope = ? AND source_type = ? AND source_id = ? AND edge_type = ? AND target_type = ? AND target_id = ?
    `),
    list: db.prepare(`
      SELECT * FROM graph_edges
      WHERE (? IS NULL OR project_dir = ?)
        AND (? IS NULL OR scope = ?)
        AND (? IS NULL OR source_type = ?)
        AND (? IS NULL OR source_id = ?)
        AND (? IS NULL OR edge_type = ?)
        AND (? IS NULL OR target_type = ?)
        AND (? IS NULL OR target_id = ?)
        AND (
          ? IS NULL OR
          source_id LIKE ? OR
          target_id LIKE ? OR
          COALESCE(project_dir, '') LIKE ?
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `),
    stats: db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT scope) AS scopes,
        COUNT(DISTINCT source_id) AS sources,
        COUNT(DISTINCT target_id) AS targets,
        MAX(updated_at) AS last_updated
      FROM graph_edges
      WHERE (? IS NULL OR project_dir = ?)
    `),
  };

  function replaceScope(scope: string, edges: GraphEdgeInput[]): GraphEdge[] {
    const tx = db.transaction(() => {
      stmts.deleteScope.run(scope);
      if (edges.length === 0) return [] as GraphEdge[];

      const now = Date.now();
      const written: GraphEdge[] = [];
      for (const edge of edges) {
        const result = stmts.insert.run(
          scope,
          edge.projectDir ?? null,
          edge.sourceType,
          edge.sourceId,
          edge.edgeType,
          edge.targetType,
          edge.targetId,
          edge.weight ?? 1,
          edge.metadata ? JSON.stringify(edge.metadata) : null,
          now,
          now,
        );
        written.push({
          id: Number(result.lastInsertRowid),
          scope,
          projectDir: edge.projectDir ?? null,
          sourceType: edge.sourceType,
          sourceId: edge.sourceId,
          edgeType: edge.edgeType,
          targetType: edge.targetType,
          targetId: edge.targetId,
          weight: edge.weight ?? 1,
          metadata: edge.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }
      return written;
    });

    return tx();
  }

  function remember(edge: GraphEdgeInput): GraphEdge {
    const now = Date.now();
    stmts.upsert.run(
      edge.scope,
      edge.projectDir ?? null,
      edge.sourceType,
      edge.sourceId,
      edge.edgeType,
      edge.targetType,
      edge.targetId,
      edge.weight ?? 1,
      edge.metadata ? JSON.stringify(edge.metadata) : null,
      now,
      now,
    );
    const row = stmts.getExact.get(
      edge.scope,
      edge.sourceType,
      edge.sourceId,
      edge.edgeType,
      edge.targetType,
      edge.targetId,
    ) as GraphEdgeRow;
    return toEdge(row);
  }

  /**
   * Forget one exact edge — the inverse of `remember`.
   *
   * Why a keyed single delete and not another `replaceScope`: link-style
   * edges (roadmap item → PR/doc/file/media) are individually authored facts,
   * so removal must be surgical. `replaceScope` is the right tool for derived
   * projections that converge to a plan; using it for authored links would
   * force every remover to re-read and re-write the whole scope, and a racing
   * writer would silently resurrect the removed edge. The design intent is
   * symmetry: what `remember` upserts by its unique key, `forget` deletes by
   * the same key.
   *
   * @param edge - The exact unique-key fields (scope, sourceType, sourceId,
   *   edgeType, targetType, targetId); weight/metadata are ignored.
   * @returns true when an edge existed and was deleted, false otherwise.
   */
  function forget(
    edge: Pick<GraphEdgeInput, 'scope' | 'sourceType' | 'sourceId' | 'edgeType' | 'targetType' | 'targetId'>,
  ): boolean {
    const result = stmts.deleteExact.run(
      edge.scope,
      edge.sourceType,
      edge.sourceId,
      edge.edgeType,
      edge.targetType,
      edge.targetId,
    );
    return result.changes > 0;
  }

  function list(options: {
    projectDir?: string;
    scope?: string;
    sourceType?: string;
    sourceId?: string;
    edgeType?: string;
    targetType?: string;
    targetId?: string;
    query?: string;
    limit?: number;
  } = {}): GraphEdge[] {
    const query = options.query?.trim() ? `%${options.query.trim()}%` : null;
    const rows = stmts.list.all(
      options.projectDir ?? null,
      options.projectDir ?? null,
      options.scope ?? null,
      options.scope ?? null,
      options.sourceType ?? null,
      options.sourceType ?? null,
      options.sourceId ?? null,
      options.sourceId ?? null,
      options.edgeType ?? null,
      options.edgeType ?? null,
      options.targetType ?? null,
      options.targetType ?? null,
      options.targetId ?? null,
      options.targetId ?? null,
      query,
      query,
      query,
      query,
      Math.min(Math.max(options.limit ?? 200, 1), 1000),
    ) as GraphEdgeRow[];
    return rows.map(toEdge);
  }

  function stats(projectDir?: string): {
    total: number;
    scopes: number;
    sources: number;
    targets: number;
    lastUpdated: number | null;
  } {
    const row = stmts.stats.get(projectDir ?? null, projectDir ?? null) as {
      total: number;
      scopes: number;
      sources: number;
      targets: number;
      last_updated: number | null;
    };
    return {
      total: row.total,
      scopes: row.scopes,
      sources: row.sources,
      targets: row.targets,
      lastUpdated: row.last_updated,
    };
  }

  return {
    replaceScope,
    remember,
    forget,
    list,
    stats,
  };
}

export type GraphEdges = ReturnType<typeof createGraphEdges>;
