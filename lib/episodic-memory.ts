import type Database from 'better-sqlite3';

export interface Episode {
  id: number;
  projectDir: string | null;
  project: string | null;
  harbor: string | null;
  agentId: string | null;
  episodeType: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface EpisodeInput {
  projectDir?: string | null;
  project?: string | null;
  harbor?: string | null;
  agentId?: string | null;
  episodeType: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
  metadata?: Record<string, unknown> | null;
}

interface EpisodeRow {
  id: number;
  project_dir: string | null;
  project: string | null;
  harbor: string | null;
  agent_id: string | null;
  episode_type: string;
  title: string;
  summary: string;
  source_type: string;
  source_id: string;
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

function toEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    projectDir: row.project_dir,
    project: row.project,
    harbor: row.harbor,
    agentId: row.agent_id,
    episodeType: row.episode_type,
    title: row.title,
    summary: row.summary,
    sourceType: row.source_type,
    sourceId: row.source_id,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createEpisodicMemory(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS episodic_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_dir TEXT,
      project TEXT,
      harbor TEXT,
      agent_id TEXT,
      episode_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_episodic_memory_source
      ON episodic_memory(source_type, source_id, episode_type);
    CREATE INDEX IF NOT EXISTS idx_episodic_memory_project
      ON episodic_memory(project_dir, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_episodic_memory_agent
      ON episodic_memory(agent_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_episodic_memory_type
      ON episodic_memory(episode_type, updated_at DESC);
  `);

  const stmts = {
    upsert: db.prepare(`
      INSERT INTO episodic_memory (
        project_dir, project, harbor, agent_id, episode_type, title, summary,
        source_type, source_id, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_type, source_id, episode_type)
      DO UPDATE SET
        project_dir = excluded.project_dir,
        project = excluded.project,
        harbor = excluded.harbor,
        agent_id = excluded.agent_id,
        title = excluded.title,
        summary = excluded.summary,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `),
    getBySource: db.prepare(`
      SELECT * FROM episodic_memory
      WHERE source_type = ? AND source_id = ? AND episode_type = ?
      LIMIT 1
    `),
    list: db.prepare(`
      SELECT * FROM episodic_memory
      WHERE (
          (? IS NULL AND ? IS NULL)
          OR (? IS NOT NULL AND ? IS NULL AND project_dir = ?)
          OR (? IS NULL AND ? IS NOT NULL AND project = ?)
          OR (? IS NOT NULL AND ? IS NOT NULL AND (project_dir = ? OR project = ?))
        )
        AND (? IS NULL OR harbor = ?)
        AND (? IS NULL OR agent_id = ?)
        AND (? IS NULL OR episode_type = ?)
        AND (
          ? IS NULL OR
          title LIKE ? OR
          summary LIKE ? OR
          source_id LIKE ?
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `),
    stats: db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT source_type) AS source_types,
        COUNT(DISTINCT episode_type) AS episode_types,
        MAX(updated_at) AS last_updated
      FROM episodic_memory
      WHERE (
          (? IS NULL AND ? IS NULL)
          OR (? IS NOT NULL AND ? IS NULL AND project_dir = ?)
          OR (? IS NULL AND ? IS NOT NULL AND project = ?)
          OR (? IS NOT NULL AND ? IS NOT NULL AND (project_dir = ? OR project = ?))
        )
    `),
  };

  function remember(input: EpisodeInput): Episode {
    const now = Date.now();
    stmts.upsert.run(
      input.projectDir ?? null,
      input.project ?? null,
      input.harbor ?? null,
      input.agentId ?? null,
      input.episodeType,
      input.title,
      input.summary,
      input.sourceType,
      input.sourceId,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    );

    const row = stmts.getBySource.get(
      input.sourceType,
      input.sourceId,
      input.episodeType,
    ) as EpisodeRow;
    return toEpisode(row);
  }

  function list(options: {
    projectDir?: string;
    project?: string;
    harbor?: string;
    agentId?: string;
    episodeType?: string;
    query?: string;
    limit?: number;
  } = {}): Episode[] {
    const query = options.query?.trim() ? `%${options.query.trim()}%` : null;
    const rows = stmts.list.all(
      options.projectDir ?? null,
      options.project ?? null,
      options.projectDir ?? null,
      options.project ?? null,
      options.projectDir ?? null,
      options.projectDir ?? null,
      options.project ?? null,
      options.project ?? null,
      options.projectDir ?? null,
      options.project ?? null,
      options.projectDir ?? null,
      options.project ?? null,
      options.harbor ?? null,
      options.harbor ?? null,
      options.agentId ?? null,
      options.agentId ?? null,
      options.episodeType ?? null,
      options.episodeType ?? null,
      query,
      query,
      query,
      query,
      Math.min(Math.max(options.limit ?? 100, 1), 500),
    ) as EpisodeRow[];
    return rows.map(toEpisode);
  }

  function stats(projectDir?: string, project?: string): {
    total: number;
    sourceTypes: number;
    episodeTypes: number;
    lastUpdated: number | null;
  } {
    const row = stmts.stats.get(
      projectDir ?? null,
      project ?? null,
      projectDir ?? null,
      project ?? null,
      projectDir ?? null,
      projectDir ?? null,
      project ?? null,
      project ?? null,
      projectDir ?? null,
      project ?? null,
      projectDir ?? null,
      project ?? null,
    ) as {
      total: number;
      source_types: number;
      episode_types: number;
      last_updated: number | null;
    };
    return {
      total: row.total,
      sourceTypes: row.source_types,
      episodeTypes: row.episode_types,
      lastUpdated: row.last_updated,
    };
  }

  return {
    remember,
    list,
    stats,
  };
}

export type EpisodicMemory = ReturnType<typeof createEpisodicMemory>;
