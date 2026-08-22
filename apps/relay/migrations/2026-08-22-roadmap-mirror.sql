-- Roadmap command-center mirror — PR 1 of the operator-mandated (2026-08-22)
-- relay roadmap program: the D1 mirror a daemon PUSHES its per-repo roadmap
-- into (`PUT /v1/roadmap/snapshot`), account-scoped like repo settings.
-- Additive and forward-only per this directory's README (ADR-0119): staging
-- first via deploy-relay.yml, recorded in applied-staging.json, then prod.
--
-- Design notes:
--   * PUSH-sync was chosen over repo-snapshot files or a live tunnel: the
--     daemon is the single writer of its roadmap; the relay stores a REPLICA
--     the operator can read from anywhere, never a second source of truth.
--   * The watermark is honest: generated_at is the DAEMON's clock (unix ms,
--     stored verbatim), received_at is the RELAY's clock (unix seconds). A
--     reader can always tell how stale the mirror is and never mistakes
--     relay arrival time for daemon truth.
--   * Every ingest is a FULL REPLACE per (user_id, repo_full_name) in one
--     D1 batch (transactional), so a mirror is always exactly one daemon
--     snapshot — never an interleaving of two pushes.
--   * Tombstoned items (deleted_at set) are INCLUDED: the daemon's registry
--     union-merges replicas, so a tombstone is data — the mirror must show
--     "deleted" rather than silently resurrecting or hiding the row.
--   * item timestamps (started_at, due_at, last_touched_at, created_at,
--     deleted_at) and activity `at` are daemon-clock values passed through
--     verbatim (the daemon writes unix ms) — the mirror never rewrites them.
--
-- ADR-0115 replication classes (the binder's vocabulary for replicated
-- state), declared per table:
--   * roadmap_mirrors, roadmap_mirror_items, roadmap_mirror_edges —
--     LWW-register class: the last daemon snapshot wins wholesale, keyed by
--     the generated_at watermark (full-replace ingest IS the LWW fold; the
--     daemon's SQLite stays the source of record, per ADR-0115's
--     "current is last-writer" doctrine).
--   * roadmap_mirror_activity — append-only class (G-Set-shaped history
--     tail), bounded to ~200 rows per repo by ingest + the retention sweep.
-- The write-intent queue the command center's write path will need is NOT in
-- this migration (it arrives with the write-path PR) and is new vocabulary
-- relative to ADR-0115 — that PR must carry the ADR amendment.

-- One row per mirrored (account, repo): the mirror header + watermark.
CREATE TABLE IF NOT EXISTS roadmap_mirrors (
  user_id        TEXT    NOT NULL REFERENCES users(id),
  repo_full_name TEXT    NOT NULL,
  harbor         TEXT    NOT NULL,               -- daemon-declared harbor label
  daemon_label   TEXT,                            -- which daemon pushed (display only)
  generated_at   INTEGER NOT NULL,               -- DAEMON clock, unix ms (watermark)
  received_at    INTEGER NOT NULL,               -- RELAY clock, unix seconds
  item_count     INTEGER NOT NULL,
  edge_count     INTEGER NOT NULL,
  harbor_id      TEXT    REFERENCES harbors(id), -- resolved remote harbor, when one matches
  PRIMARY KEY (user_id, repo_full_name)
);

-- The mirrored roadmap items, tombstones included. status mirrors the
-- daemon's closed lane enum (lib/db.ts roadmap_items) and is CHECK-enforced;
-- kind/priority stay open-shaped (a newer daemon may grow the ladder — the
-- mirror's job is fidelity, not gatekeeping).
CREATE TABLE IF NOT EXISTS roadmap_mirror_items (
  user_id           TEXT    NOT NULL REFERENCES users(id),
  repo_full_name    TEXT    NOT NULL,
  slug              TEXT    NOT NULL,
  harbor            TEXT    NOT NULL,
  status            TEXT    NOT NULL
    CHECK (status IN ('now','backlog','parked','merge','done')),
  kind              TEXT    NOT NULL DEFAULT 'task',
  priority          INTEGER NOT NULL DEFAULT 3,
  summary_md        TEXT    NOT NULL,
  description_md    TEXT,
  assignee_id       TEXT,
  started_at        INTEGER,
  due_at            INTEGER,
  estimate          INTEGER,
  last_touched_at   INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  deleted_at        INTEGER,                      -- tombstone; excluded from the board, queryable as deleted
  dependencies_json TEXT    NOT NULL DEFAULT '[]'
    CHECK (json_valid(dependencies_json)),
  notes_json        TEXT    NOT NULL DEFAULT '[]'
    CHECK (json_valid(notes_json)),
  PRIMARY KEY (user_id, repo_full_name, harbor, slug)
);

-- The board read: one repo's live lanes, freshest activity first.
CREATE INDEX IF NOT EXISTS idx_roadmap_mirror_items_board
  ON roadmap_mirror_items(user_id, repo_full_name, status, last_touched_at DESC);

-- Mirrored graph edges (the daemon's graph_edges projection): hierarchy +
-- dependency structure between roadmap items.
CREATE TABLE IF NOT EXISTS roadmap_mirror_edges (
  user_id        TEXT NOT NULL REFERENCES users(id),
  repo_full_name TEXT NOT NULL,
  scope          TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  edge_type      TEXT NOT NULL
    CHECK (edge_type IN ('parent_of','depends_on')),
  target_id      TEXT NOT NULL,
  PRIMARY KEY (user_id, repo_full_name, scope, source_id, edge_type, target_id)
);

-- Recent roadmap activity tail (touches, promotions, status moves) — capped
-- (~200 per repo) at ingest AND re-enforced by the retention sweep; the
-- mirrors themselves persist (they are current state, not history).
CREATE TABLE IF NOT EXISTS roadmap_mirror_activity (
  user_id        TEXT    NOT NULL REFERENCES users(id),
  repo_full_name TEXT    NOT NULL,
  at             INTEGER NOT NULL,               -- daemon clock, unix ms
  slug           TEXT    NOT NULL,
  kind           TEXT    NOT NULL,               -- e.g. 'touch' | 'promote' | 'status'
  by_id          TEXT,                            -- daemon-side actor id, when known
  detail_json    TEXT,
  PRIMARY KEY (user_id, repo_full_name, at, slug, kind)
);
