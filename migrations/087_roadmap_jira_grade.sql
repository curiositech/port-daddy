-- migration 087 — Jira-grade roadmap items (operator-mandated roadmap
-- command-center program, 2026-08-22): tags, actual effort, and a completion
-- stamp so a roadmap item carries the full planned-vs-actual story a Jira card
-- does.
--
-- Owner (assignee_id, migration 085) stays a single column — it is validated
-- against the durable-agent roster at the write boundary (routes/roadmap.ts),
-- NOT duplicated into a parallel owner field. Artifact/media links live in
-- graph_edges (migration 003) under the planner:links scope with the
-- links_pr / links_doc / links_file / links_media edge vocabulary
-- (lib/planner-edges.ts), per ADR-0086 §3.
--
-- Idempotent: the canonical applier is the PRAGMA-guarded ALTER block in
-- lib/db.ts initDatabase(); this file documents the same change. SQLite ALTER
-- TABLE ADD COLUMN cannot carry a CHECK, so normalization lives in the app
-- layer (lib/roadmap-items.ts); fresh DBs get defaults from CORE_SCHEMA_SQL.

-- tags_json: JSON array of free-form label strings. Filterable in list reads
-- via json_each (`?tag=` on GET /roadmap/items).
ALTER TABLE roadmap_items ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

-- actual: effort actually spent, in the SAME abstract units as estimate, so
-- planned-vs-actual is a same-unit subtraction — no unit conversion layer.
ALTER TABLE roadmap_items ADD COLUMN actual INTEGER;

-- completed_at: stamped when status transitions into 'done', cleared when the
-- item reopens. Cycle time (started_at → completed_at) becomes derivable
-- without replaying the roadmap_item_status_events audit trail.
ALTER TABLE roadmap_items ADD COLUMN completed_at INTEGER;

-- ── dependencies_json retirement (ADR-0086 §3, data migration) ───────────────
-- Blocking relations move to graph_edges (scope 'planner:deps', edge_type
-- 'depends_on', roadmap:item → roadmap:item). The write path
-- (lib/roadmap-items.ts) authors edges and no longer fills the JSON column;
-- reads derive dependencies from edges ∪ any legacy JSON residue (the bridge
-- for rows arriving from old replicas). This backfill converts remaining JSON
-- into edges idempotently, then clears the JSON to the '[]' sentinel so the
-- bridge can never resurrect a dependency later removed through the edge
-- write path. The column physically remains (NOT NULL DEFAULT '[]') for
-- old-replica union-merge compatibility, but it is dead as a source of truth.
INSERT INTO graph_edges (
  scope, project_dir, source_type, source_id, edge_type, target_type, target_id,
  weight, metadata, created_at, updated_at
)
SELECT 'planner:deps', NULL, 'roadmap:item', r.slug, 'depends_on', 'roadmap:item', je.value,
       1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000
  FROM roadmap_items r, json_each(r.dependencies_json) je
 WHERE r.dependencies_json != '[]'
   AND json_valid(r.dependencies_json)
   AND je.type = 'text'
   AND je.value != ''
ON CONFLICT(scope, source_type, source_id, edge_type, target_type, target_id) DO NOTHING;

UPDATE roadmap_items SET dependencies_json = '[]'
 WHERE dependencies_json != '[]' AND json_valid(dependencies_json);

-- Known limitation (named follow-up, not silently ignored): the reunify tool
-- (scripts/registry-reunify.ts) union-merges roadmap_items ROWS but does not
-- yet merge graph_edges, so authored planner:deps/planner:links edges from a
-- secondary replica do not ride a reunify pass. Rows still carrying legacy
-- JSON reunify fine (the next boot backfills them); edge reunification is the
-- follow-up slice (roadmap: reunify-planner-graph-edges).
