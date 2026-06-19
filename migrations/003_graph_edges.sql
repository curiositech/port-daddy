-- Phase 1: Unified semantic graph edges table
-- Stores dependency relationships between code entities, sessions, merges, and other runtime artifacts
CREATE TABLE graph_edges (
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

-- Query by scope (semantic term families)
CREATE INDEX idx_graph_edges_scope ON graph_edges(scope);

-- Query by project directory + recency (merge queue, symbol changes)
CREATE INDEX idx_graph_edges_project ON graph_edges(project_dir, updated_at DESC);

-- Query by source entity (what depends on this symbol/file)
CREATE INDEX idx_graph_edges_source ON graph_edges(source_type, source_id);

-- Query by target entity (what does this symbol/file depend on)
CREATE INDEX idx_graph_edges_target ON graph_edges(target_type, target_id);

-- Query by edge type + recency (all "calls" edges, all "imports" edges, etc.)
CREATE INDEX idx_graph_edges_type ON graph_edges(edge_type, updated_at DESC);

-- Uniqueness constraint: prevent duplicate edges for the same relationship
-- Edges are identified by (scope, source, edge_type, target) tuple
CREATE UNIQUE INDEX idx_graph_edges_unique
  ON graph_edges(scope, source_type, source_id, edge_type, target_type, target_id);
