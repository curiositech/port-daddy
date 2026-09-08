-- 086_booty.sql — booty table: artifact harvest provenance (slice S4a).
--
-- Operator ruling: artifacts (design workups, images, HTMLs, videos,
-- shaders) are durable truth on ANY plane/branch — never quarantined,
-- always attributed.
--
-- The artifact bytes do NOT live here — they live in the existing
-- content-addressed blob store (lib/blob.ts, ~/.port-daddy/blobs/<sha256>).
-- A booty row is the provenance record: which blob, harvested from which
-- original path, on which branch/worktree, by which session/agent, and
-- optionally linked to a roadmap item.
--
-- Dedupe contract: UNIQUE(blob_hash, branch). Re-depositing the same bytes
-- on the same branch is idempotent; the same bytes on a different branch is
-- a new row (the artifact is truth on every plane it was harvested on).
--
-- Idempotent. The canonical applier is lib/booty.ts createBootyStore()
-- (CREATE TABLE IF NOT EXISTS at construction time, same as other
-- self-initializing modules); this file documents the same change for the
-- offline / sortie / fresh-install path.

CREATE TABLE IF NOT EXISTS booty (
  id TEXT PRIMARY KEY,
  blob_hash TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  original_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  branch TEXT NOT NULL DEFAULT '',
  worktree TEXT,
  session_id TEXT,
  agent_identity TEXT,
  roadmap_link TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(blob_hash, branch)
);

CREATE INDEX IF NOT EXISTS idx_booty_branch ON booty(branch, created_at);
CREATE INDEX IF NOT EXISTS idx_booty_session ON booty(session_id, created_at);
