-- Migration 001: Initial Schema
-- Created: 2026-02-10
-- Description: Create port_assignments table with indexes

-- Create main table
CREATE TABLE IF NOT EXISTS port_assignments (
  port INTEGER PRIMARY KEY,
  project TEXT NOT NULL,
  pid INTEGER NOT NULL,
  started INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_project ON port_assignments(project);
CREATE INDEX IF NOT EXISTS idx_pid ON port_assignments(pid);

-- Create schema version table
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES (1, strftime('%s', 'now') * 1000);

-- Rollback SQL (for reference, not executed):
-- DROP TABLE port_assignments;
-- DROP TABLE schema_version;
