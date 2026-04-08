import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

export type SortieStatus = 'planned' | 'blocked' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Sortie {
  id: string;
  projectDir: string;
  project: string;
  harbor: string;
  goal: string;
  recipe: string | null;
  status: SortieStatus;
  backend: string;
  model: string | null;
  modelTier: string | null;
  budgetUsd: number;
  expectedOutput: string | null;
  spawnAgentId: string | null;
  resultOutput: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
}

export interface SortieEvent {
  id: number;
  sortieId: string;
  type: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

interface SortieRow {
  id: string;
  project_dir: string;
  project: string;
  harbor: string;
  goal: string;
  recipe: string | null;
  status: SortieStatus;
  backend: string;
  model: string | null;
  model_tier: string | null;
  budget_usd: number;
  expected_output: string | null;
  spawn_agent_id: string | null;
  result_output: string | null;
  error: string | null;
  metadata: string | null;
  created_at: number;
  started_at: number | null;
  updated_at: number;
  completed_at: number | null;
}

interface SortieEventRow {
  id: number;
  sortie_id: string;
  type: string;
  summary: string | null;
  metadata: string | null;
  created_at: number;
}

export interface CreateSortieInput {
  projectDir: string;
  project: string;
  harbor: string;
  goal: string;
  recipe?: string | null;
  backend: string;
  model?: string | null;
  modelTier?: string | null;
  budgetUsd: number;
  expectedOutput?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateSortieInput {
  harbor?: string;
  status?: SortieStatus;
  model?: string | null;
  modelTier?: string | null;
  spawnAgentId?: string | null;
  resultOutput?: string | null;
  error?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  metadata?: Record<string, unknown> | null;
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toSortie(row: SortieRow): Sortie {
  return {
    id: row.id,
    projectDir: row.project_dir,
    project: row.project,
    harbor: row.harbor,
    goal: row.goal,
    recipe: row.recipe,
    status: row.status,
    backend: row.backend,
    model: row.model,
    modelTier: row.model_tier,
    budgetUsd: row.budget_usd,
    expectedOutput: row.expected_output,
    spawnAgentId: row.spawn_agent_id,
    resultOutput: row.result_output,
    error: row.error,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function toSortieEvent(row: SortieEventRow): SortieEvent {
  return {
    id: row.id,
    sortieId: row.sortie_id,
    type: row.type,
    summary: row.summary,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at,
  };
}

export function createSorties(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sorties (
      id TEXT PRIMARY KEY,
      project_dir TEXT NOT NULL,
      project TEXT NOT NULL,
      harbor TEXT NOT NULL,
      goal TEXT NOT NULL,
      recipe TEXT,
      status TEXT NOT NULL,
      backend TEXT NOT NULL,
      model TEXT,
      model_tier TEXT,
      budget_usd REAL NOT NULL,
      expected_output TEXT,
      spawn_agent_id TEXT,
      result_output TEXT,
      error TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sorties_project_dir ON sorties(project_dir, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sorties_status ON sorties(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sorties_project ON sorties(project, created_at DESC);

    CREATE TABLE IF NOT EXISTS sortie_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sortie_id TEXT NOT NULL REFERENCES sorties(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      summary TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sortie_events_sortie ON sortie_events(sortie_id, created_at ASC);
  `);
  const sortieColumns = db.prepare(`PRAGMA table_info(sorties)`).all() as Array<{ name: string }>;
  if (!sortieColumns.some((column) => column.name === 'started_at')) {
    db.exec(`ALTER TABLE sorties ADD COLUMN started_at INTEGER`);
  }

  const stmts = {
    insert: db.prepare(`
      INSERT INTO sorties (
        id, project_dir, project, harbor, goal, recipe, status, backend, model, model_tier,
        budget_usd, expected_output, spawn_agent_id, result_output, error, metadata,
        created_at, started_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    get: db.prepare(`SELECT * FROM sorties WHERE id = ?`),
    listByProjectDir: db.prepare(`SELECT * FROM sorties WHERE project_dir = ? ORDER BY created_at DESC LIMIT ?`),
    listAll: db.prepare(`SELECT * FROM sorties ORDER BY created_at DESC LIMIT ?`),
    update: db.prepare(`
      UPDATE sorties
      SET harbor = ?,
          status = ?,
          model = ?,
          model_tier = ?,
          spawn_agent_id = ?,
          result_output = ?,
          error = ?,
          metadata = ?,
          started_at = ?,
          updated_at = ?,
          completed_at = ?
      WHERE id = ?
    `),
    insertEvent: db.prepare(`
      INSERT INTO sortie_events (sortie_id, type, summary, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    listEvents: db.prepare(`
      SELECT * FROM sortie_events WHERE sortie_id = ? ORDER BY created_at ASC LIMIT ?
    `),
  };

  return {
    create(input: CreateSortieInput): Sortie {
      const now = Date.now();
      const id = `sortie-${randomBytes(6).toString('hex')}`;
      stmts.insert.run(
        id,
        input.projectDir,
        input.project,
        input.harbor,
        input.goal,
        input.recipe ?? null,
        'planned',
        input.backend,
        input.model ?? null,
        input.modelTier ?? null,
        input.budgetUsd,
        input.expectedOutput ?? null,
        null,
        null,
        null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        null,
        now,
        null,
      );
      return toSortie(stmts.get.get(id) as SortieRow);
    },

    get(id: string): Sortie | null {
      const row = stmts.get.get(id) as SortieRow | undefined;
      return row ? toSortie(row) : null;
    },

    list(options: { projectDir?: string; limit?: number } = {}): Sortie[] {
      const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
      const rows = options.projectDir
        ? (stmts.listByProjectDir.all(options.projectDir, limit) as SortieRow[])
        : (stmts.listAll.all(limit) as SortieRow[]);
      return rows.map(toSortie);
    },

    update(id: string, input: UpdateSortieInput): Sortie | null {
      const current = stmts.get.get(id) as SortieRow | undefined;
      if (!current) return null;
      const updatedAt = Date.now();
      stmts.update.run(
        input.harbor ?? current.harbor,
        input.status ?? current.status,
        input.model ?? current.model,
        input.modelTier ?? current.model_tier,
        input.spawnAgentId ?? current.spawn_agent_id,
        input.resultOutput ?? current.result_output,
        input.error ?? current.error,
        input.metadata ? JSON.stringify(input.metadata) : current.metadata,
        input.startedAt ?? current.started_at,
        updatedAt,
        input.completedAt ?? current.completed_at,
        id,
      );
      return toSortie(stmts.get.get(id) as SortieRow);
    },

    addEvent(sortieId: string, type: string, summary?: string | null, metadata?: Record<string, unknown> | null): SortieEvent {
      const createdAt = Date.now();
      stmts.insertEvent.run(
        sortieId,
        type,
        summary ?? null,
        metadata ? JSON.stringify(metadata) : null,
        createdAt,
      );
      const row = db.prepare(`SELECT * FROM sortie_events WHERE sortie_id = ? AND created_at = ? ORDER BY id DESC LIMIT 1`).get(sortieId, createdAt) as SortieEventRow;
      return toSortieEvent(row);
    },

    events(sortieId: string, limit = 100): SortieEvent[] {
      const rows = stmts.listEvents.all(sortieId, Math.min(Math.max(limit, 1), 500)) as SortieEventRow[];
      return rows.map(toSortieEvent);
    },
  };
}

export type Sorties = ReturnType<typeof createSorties>;
