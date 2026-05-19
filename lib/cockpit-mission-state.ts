import type Database from 'better-sqlite3';

export interface MissionState {
  missionId: string;
  projectDir: string;
  dismissedAt: number | null;
  snoozedUntil: number | null;
  plannedSortieId: string | null;
  notes: string | null;
  updatedAt: number;
}

interface MissionStateRow {
  mission_id: string;
  project_dir: string;
  dismissed_at: number | null;
  snoozed_until: number | null;
  planned_sortie_id: string | null;
  notes: string | null;
  updated_at: number;
}

function toMissionState(row: MissionStateRow): MissionState {
  return {
    missionId: row.mission_id,
    projectDir: row.project_dir,
    dismissedAt: row.dismissed_at,
    snoozedUntil: row.snoozed_until,
    plannedSortieId: row.planned_sortie_id,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export interface SetStateInput {
  missionId: string;
  projectDir: string;
  dismissedAt?: number | null;
  snoozedUntil?: number | null;
  plannedSortieId?: string | null;
  notes?: string | null;
}

export function createCockpitMissionState(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cockpit_mission_state (
      mission_id TEXT NOT NULL,
      project_dir TEXT NOT NULL,
      dismissed_at INTEGER,
      snoozed_until INTEGER,
      planned_sortie_id TEXT,
      notes TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_dir, mission_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cockpit_mission_state_project
      ON cockpit_mission_state(project_dir, updated_at DESC);
  `);

  const stmts = {
    get: db.prepare(
      `SELECT * FROM cockpit_mission_state WHERE project_dir = ? AND mission_id = ?`,
    ),
    listForProject: db.prepare(
      `SELECT * FROM cockpit_mission_state WHERE project_dir = ?`,
    ),
    upsert: db.prepare(`
      INSERT INTO cockpit_mission_state
        (mission_id, project_dir, dismissed_at, snoozed_until, planned_sortie_id, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_dir, mission_id) DO UPDATE SET
        dismissed_at = COALESCE(excluded.dismissed_at, cockpit_mission_state.dismissed_at),
        snoozed_until = COALESCE(excluded.snoozed_until, cockpit_mission_state.snoozed_until),
        planned_sortie_id = COALESCE(excluded.planned_sortie_id, cockpit_mission_state.planned_sortie_id),
        notes = COALESCE(excluded.notes, cockpit_mission_state.notes),
        updated_at = excluded.updated_at
    `),
    clearDismissed: db.prepare(
      `UPDATE cockpit_mission_state SET dismissed_at = NULL, updated_at = ? WHERE project_dir = ? AND mission_id = ?`,
    ),
    clearSnoozed: db.prepare(
      `UPDATE cockpit_mission_state SET snoozed_until = NULL, updated_at = ? WHERE project_dir = ? AND mission_id = ?`,
    ),
    clearPlannedSortie: db.prepare(
      `UPDATE cockpit_mission_state SET planned_sortie_id = NULL, updated_at = ? WHERE project_dir = ? AND mission_id = ?`,
    ),
    delete: db.prepare(
      `DELETE FROM cockpit_mission_state WHERE project_dir = ? AND mission_id = ?`,
    ),
  };

  function get(projectDir: string, missionId: string): MissionState | null {
    const row = stmts.get.get(projectDir, missionId) as MissionStateRow | undefined;
    return row ? toMissionState(row) : null;
  }

  function listForProject(projectDir: string): Map<string, MissionState> {
    const rows = stmts.listForProject.all(projectDir) as MissionStateRow[];
    const map = new Map<string, MissionState>();
    for (const row of rows) map.set(row.mission_id, toMissionState(row));
    return map;
  }

  function set(input: SetStateInput): MissionState {
    const now = Date.now();
    stmts.upsert.run(
      input.missionId,
      input.projectDir,
      input.dismissedAt === undefined ? null : input.dismissedAt,
      input.snoozedUntil === undefined ? null : input.snoozedUntil,
      input.plannedSortieId === undefined ? null : input.plannedSortieId,
      input.notes === undefined ? null : input.notes,
      now,
    );
    return get(input.projectDir, input.missionId)!;
  }

  function dismiss(projectDir: string, missionId: string, notes?: string | null): MissionState {
    return set({ missionId, projectDir, dismissedAt: Date.now(), notes: notes ?? null });
  }

  function snooze(
    projectDir: string,
    missionId: string,
    until: number,
    notes?: string | null,
  ): MissionState {
    return set({ missionId, projectDir, snoozedUntil: until, notes: notes ?? null });
  }

  function clear(
    projectDir: string,
    missionId: string,
    field: 'dismissed' | 'snoozed' | 'plannedSortie' | 'all',
  ): MissionState | null {
    const now = Date.now();
    if (field === 'all') {
      stmts.delete.run(projectDir, missionId);
      return null;
    }
    if (field === 'dismissed') stmts.clearDismissed.run(now, projectDir, missionId);
    else if (field === 'snoozed') stmts.clearSnoozed.run(now, projectDir, missionId);
    else stmts.clearPlannedSortie.run(now, projectDir, missionId);
    return get(projectDir, missionId);
  }

  return { get, listForProject, set, dismiss, snooze, clear };
}

export type CockpitMissionStateModule = ReturnType<typeof createCockpitMissionState>;
