/**
 * LEGACY episodic memory store — read-mostly transition surface.
 *
 * The surviving episode engine is lib/agent-harbor/memory-episodes.ts
 * (`persistEpisode`/`recallEpisodes`, ADR-0097): mandatory citations,
 * read-enforced validity, budget-capped hybrid retrieval. Session-note
 * harvesting (lib/session-harvest.ts) writes THERE, not here.
 *
 * This store's rows carry no citations and no validity intervals, so they
 * cannot be migrated losslessly into the v0 contract — we do not
 * fake-migrate. Legacy rows stay queryable via `pd memory episodes` behind
 * an honest expiry filter until the deprecation window closes (slice 3
 * drops the table). Remaining writers (handoff-capsule replay, sorties,
 * session-end handoff notes) migrate in slice 2.
 */
import type Database from 'better-sqlite3';
import type { GraphEdges } from './graph-edges.js';
import { collectSemanticAliases } from './semantic-terms.js';
import type { TupleSpace } from './tuples.js';
import type { SemanticResolver } from './semantic-resolver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Episode type taxonomy + TTLs
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

/** Canonical episode types — open string allowed for extensibility. */
export const EPISODE_TYPES = [
  'finding', 'design', 'handoff', 'note',
  'idea', 'prototype', 'plan', 'want', 'worry', 'syllogism',
] as const;
export type EpisodeTypeName = (typeof EPISODE_TYPES)[number];

/** Time-to-live in ms per episode type. Infinity = permanent, never archived. */
export const EPISODE_TTLS: Record<EpisodeTypeName, number> = {
  finding:   Infinity,
  design:    Infinity,
  syllogism: Infinity,
  idea:      365 * DAY,
  prototype: 365 * DAY,
  plan:      180 * DAY,
  want:      90 * DAY,
  worry:     60 * DAY,
  handoff:   30 * DAY,
  note:      30 * DAY,
};

/**
 * Compute ISO expiry for a given episode type, or null for permanent types.
 *
 * Unknown types default to 30d — unknown → forgettable, never → permanent.
 * (The old `null` default made every unrecognized type immortal, so sortie
 * noise like `blocked`/`completed`/`failed` accumulated forever.)
 */
export function episodeExpiresAt(type: string): string | null {
  const ttl = EPISODE_TTLS[type as EpisodeTypeName];
  if (ttl === undefined) return new Date(Date.now() + 30 * DAY).toISOString();
  if (!Number.isFinite(ttl)) return null;
  return new Date(Date.now() + ttl).toISOString();
}

/** Map note.type → episode type. */
export const NOTE_TYPE_TO_EPISODE: Record<string, EpisodeTypeName> = {
  handoff: 'handoff',
  finding: 'finding',
  idea:    'idea',
  design:  'design',
  plan:    'plan',
  want:    'want',
  worry:   'worry',
  prototype: 'prototype',
  syllogism: 'syllogism',
  note:    'note',
  scope:   'note',
  result:  'finding',
  // default for unknown types
};

/**
 * Durable memory episode promoted out of transient execution history.
 */
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
  /** Worktree slug where this episode originated. */
  worktreeId: string | null;
  /** Git branch at time of creation. */
  branchName: string | null;
  /** ISO timestamp after which the custodian may archive this episode. Null = permanent. */
  expiresAt: string | null;
  /** ID of a blob store artifact linked to this episode (for notes > 10KB). */
  blobId: string | null;
}

/**
 * Input used to promote a story beat into episodic memory.
 *
 * Example:
 * ```ts
 * {
 *   projectDir: '/Users/erichowens/coding/port-daddy',
 *   project: 'port-daddy',
 *   harbor: 'port-daddy:fleet',
 *   agentId: 'designer',
 *   episodeType: 'handoff',
 *   title: 'Port Daddy design system handoff',
 *   summary: 'Aligned CSS tokens and semantic joins for the website work.',
 *   sourceType: 'session',
 *   sourceId: 'session-css-1'
 * }
 * ```
 */
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
  worktreeId?: string | null;
  branchName?: string | null;
  expiresAt?: string | null;
  blobId?: string | null;
}

interface EpisodicMemoryOptions {
  tuples?: Pick<TupleSpace, 'out'>;
  graphEdges?: Pick<GraphEdges, 'remember'>;
  semanticResolver?: Pick<SemanticResolver, 'observeAliases'>;
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
  worktree_id: string | null;
  branch_name: string | null;
  expires_at: string | null;
  blob_id: string | null;
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

/**
 * Convert a SQLite row into the public episode shape.
 */
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
    worktreeId: row.worktree_id ?? null,
    branchName: row.branch_name ?? null,
    expiresAt: row.expires_at ?? null,
    blobId: row.blob_id ?? null,
  };
}

const MEMORY_TUPLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Choose the harbor used for tuple projections from the richest project scope
 * available on the episode input.
 */
function projectTupleHarbor(input: EpisodeInput): string | null {
  return input.harbor ?? input.project ?? input.projectDir ?? null;
}

/**
 * Create the durable episodic memory store.
 *
 * Example write:
 * ```ts
 * const episode = memory.remember({
 *   projectDir: '/Users/erichowens/coding/port-daddy',
 *   project: 'port-daddy',
 *   episodeType: 'finding',
 *   title: 'Semantic threshold looked too loose',
 *   summary: 'Review backlog spiked after enabling embeddings.',
 *   sourceType: 'session',
 *   sourceId: 'session-42',
 * });
 * ```
 *
 * Example result:
 * ```ts
 * {
 *   id: 7,
 *   episodeType: 'finding',
 *   title: 'Semantic threshold looked too loose',
 *   ...
 * }
 * ```
 */
export function createEpisodicMemory(db: Database.Database, options: EpisodicMemoryOptions = {}) {
  const tuples = options.tuples;
  const graphEdges = options.graphEdges;
  const semanticResolver = options.semanticResolver;
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

  // Migration: add durability columns (worktree_id, branch_name, expires_at, blob_id)
  try {
    const cols = db.prepare("PRAGMA table_info(episodic_memory)").all() as Array<{ name: string }>;
    const names = new Set(cols.map(c => c.name));
    if (!names.has('worktree_id')) db.prepare("ALTER TABLE episodic_memory ADD COLUMN worktree_id TEXT").run();
    if (!names.has('branch_name')) db.prepare("ALTER TABLE episodic_memory ADD COLUMN branch_name TEXT").run();
    if (!names.has('expires_at')) db.prepare("ALTER TABLE episodic_memory ADD COLUMN expires_at TEXT").run();
    if (!names.has('blob_id')) db.prepare("ALTER TABLE episodic_memory ADD COLUMN blob_id TEXT").run();
  } catch { /* idempotent */ }
  db.prepare("CREATE INDEX IF NOT EXISTS idx_episodic_memory_expires ON episodic_memory(expires_at) WHERE expires_at IS NOT NULL").run();

  const stmts = {
    upsert: db.prepare(`
      INSERT INTO episodic_memory (
        project_dir, project, harbor, agent_id, episode_type, title, summary,
        source_type, source_id, metadata, created_at, updated_at,
        worktree_id, branch_name, expires_at, blob_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_type, source_id, episode_type)
      DO UPDATE SET
        project_dir = excluded.project_dir,
        project = excluded.project,
        harbor = excluded.harbor,
        agent_id = excluded.agent_id,
        title = excluded.title,
        summary = excluded.summary,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at,
        worktree_id = COALESCE(excluded.worktree_id, worktree_id),
        branch_name = COALESCE(excluded.branch_name, branch_name),
        expires_at  = COALESCE(excluded.expires_at, expires_at),
        blob_id     = COALESCE(excluded.blob_id, blob_id)
    `),
    getBySource: db.prepare(`
      SELECT * FROM episodic_memory
      WHERE source_type = ? AND source_id = ? AND episode_type = ?
      LIMIT 1
    `),
    getById: db.prepare(`
      SELECT * FROM episodic_memory
      WHERE id = ?
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
        AND (expires_at IS NULL OR expires_at > ?)
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

  /**
   * Insert or update a durable episode, then project it into tuples, graph
   * edges, and semantic-resolution observation streams.
   */
  function remember(input: EpisodeInput): Episode {
    const now = Date.now();
    const expiresAt = input.expiresAt !== undefined ? input.expiresAt : episodeExpiresAt(input.episodeType);
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
      input.worktreeId ?? null,
      input.branchName ?? null,
      expiresAt,
      input.blobId ?? null,
    );

    const row = stmts.getBySource.get(
      input.sourceType,
      input.sourceId,
      input.episodeType,
    ) as EpisodeRow;
    const episode = toEpisode(row);
    const semanticAliases = collectSemanticAliases([input.title, input.summary]);
    const harbor = projectTupleHarbor(input);
    const scope = `memory:episode:${input.sourceType}:${input.sourceId}:${input.episodeType}`;
    const episodeNodeId = `${input.sourceType}:${input.sourceId}:${input.episodeType}`;

    if (tuples) {
      tuples.out([
        'memory:episode',
        episode.projectDir ?? null,
        episode.project ?? null,
        episode.episodeType,
        episode.sourceType,
        episode.sourceId,
        episode.title,
        episode.summary,
        semanticAliases.map((alias) => alias.canonical),
        episode.metadata ?? null,
      ], {
        harbor: harbor ?? undefined,
        writtenBy: episode.agentId ?? undefined,
        ttlMs: MEMORY_TUPLE_TTL_MS,
      });

      for (const alias of semanticAliases) {
        tuples.out([
          'semantic:alias',
          'memory',
          alias.raw,
          alias.canonical,
          {
            fingerprint: alias.fingerprint,
            tokens: alias.tokens,
            sourceType: episode.sourceType,
            sourceId: episode.sourceId,
            episodeType: episode.episodeType,
          },
        ], {
          harbor: harbor ?? undefined,
          writtenBy: episode.agentId ?? undefined,
          ttlMs: MEMORY_TUPLE_TTL_MS,
        });
      }
    }

    if (graphEdges) {
      for (const alias of semanticAliases) {
        graphEdges.remember({
          scope,
          projectDir: episode.projectDir ?? null,
          sourceType: 'memory_episode',
          sourceId: episodeNodeId,
          edgeType: 'about',
          targetType: 'semantic_term',
          targetId: alias.canonical,
          metadata: {
            raw: alias.raw,
            tokens: alias.tokens,
            fingerprint: alias.fingerprint,
          },
        });

        if (alias.raw !== alias.canonical) {
          graphEdges.remember({
            scope,
            projectDir: episode.projectDir ?? null,
            sourceType: 'semantic_term',
            sourceId: alias.raw,
            edgeType: 'alias_of',
            targetType: 'semantic_term',
            targetId: alias.canonical,
            metadata: {
              sourceType: episode.sourceType,
              sourceId: episode.sourceId,
              episodeType: episode.episodeType,
            },
          });
        }
      }
    }

    semanticResolver?.observeAliases({
      projectDir: episode.projectDir,
      harbor: episode.harbor,
      sourceType: episode.sourceType,
      sourceId: `${episode.sourceId}:${episode.episodeType}`,
      agentId: episode.agentId,
      aliases: semanticAliases,
    });

    return episode;
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
      new Date().toISOString(),
      Math.min(Math.max(options.limit ?? 100, 1), 500),
    ) as EpisodeRow[];
    return rows.map(toEpisode);
  }

  function get(id: number): Episode | null {
    if (!Number.isInteger(id) || id < 1) return null;
    const row = stmts.getById.get(id) as EpisodeRow | undefined;
    return row ? toEpisode(row) : null;
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

  function archiveExpired(before?: string): number {
    const cutoff = before ?? new Date().toISOString();
    // The archived-guard keeps this idempotent: without it every run
    // re-marked the same rows and reported phantom `changes` forever.
    const result = db.prepare(`
      UPDATE episodic_memory SET metadata = json_patch(COALESCE(metadata, '{}'), json_object('archived', 1, 'archivedAt', ?))
      WHERE expires_at IS NOT NULL AND expires_at < ?
        AND json_extract(COALESCE(metadata, '{}'), '$.archived') IS NULL
    `).run(cutoff, cutoff) as { changes: number };
    return result.changes;
  }

  return {
    remember,
    get,
    list,
    stats,
    archiveExpired,
  };
}

export type EpisodicMemory = ReturnType<typeof createEpisodicMemory>;
