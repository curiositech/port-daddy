-- migration 085 — PD Planner (ADR-0086): give roadmap_items the Jira-like issue
-- fields so a roadmap item is a real task node (project → epic → story → task →
-- subtask), with urgency distinct from workflow status, a durable owner, a rich
-- body, and scheduling inputs for the kernel CPM/Gantt scheduler.
--
-- Hierarchy, dependencies, supersedes, and artifact links (commit/PR/ADR/doc) do
-- NOT live here — they are graph_edges rows (migration 003), per ADR-0086 §3.
--
-- Idempotent: the canonical applier is the PRAGMA-guarded ALTER block in
-- lib/db.ts initDatabase(); this file documents the same change. SQLite ALTER
-- TABLE ADD COLUMN cannot carry a CHECK, so kind/priority CHECKs live in the
-- CREATE TABLE (CORE_SCHEMA_SQL, fresh DBs) and the app layer enforces them on
-- write for migrated DBs.

-- kind: the fixed-ladder issue type. Defaults 'task' so existing rows stay valid.
ALTER TABLE roadmap_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';

-- priority: urgency 1 (highest) .. 5 (lowest), ORTHOGONAL to status (the lane).
ALTER TABLE roadmap_items ADD COLUMN priority INTEGER NOT NULL DEFAULT 3;

-- assignee_id: durable plan-time owner (vs dispatch.worker_actor_id, the run-time claim).
ALTER TABLE roadmap_items ADD COLUMN assignee_id TEXT;

-- description_md: rich body (summary_md stays the title / short line).
ALTER TABLE roadmap_items ADD COLUMN description_md TEXT;

-- started_at / due_at: actual start + target finish (ms). Gantt date anchors.
ALTER TABLE roadmap_items ADD COLUMN started_at INTEGER;
ALTER TABLE roadmap_items ADD COLUMN due_at INTEGER;

-- estimate: abstract effort units = the scheduler's node duration.
ALTER TABLE roadmap_items ADD COLUMN estimate INTEGER;

-- Indexes for planner reads: by kind+priority (backlog grooming) and by assignee.
CREATE INDEX IF NOT EXISTS idx_roadmap_items_kind_priority
  ON roadmap_items(kind, priority);
CREATE INDEX IF NOT EXISTS idx_roadmap_items_assignee
  ON roadmap_items(assignee_id);
