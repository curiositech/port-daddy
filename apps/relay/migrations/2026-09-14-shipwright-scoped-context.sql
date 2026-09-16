-- Shipwright repository-scoped conversations and durable design records.
--
-- Forward-only and rollback-compatible: the legacy shipwright_chats table is
-- intentionally untouched so the previous Worker release can still run after
-- this migration. The new release never reads that user-only table into a
-- prompt or accepts it as proposal provenance.

CREATE TABLE IF NOT EXISTS shipwright_threads (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES users(id),
  installation_id INTEGER NOT NULL,
  repo_full_name  TEXT    NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shipwright_threads_scope_idx
  ON shipwright_threads (user_id, installation_id, repo_full_name, updated_at DESC);

-- Raw transcript rows are deliberately separate from durable structured
-- records. retention-sweep.ts prunes these after 30 days.
CREATE TABLE IF NOT EXISTS shipwright_thread_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  TEXT    NOT NULL REFERENCES shipwright_threads(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL REFERENCES users(id),
  role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shipwright_thread_messages_scope_idx
  ON shipwright_thread_messages (user_id, thread_id, id);
CREATE INDEX IF NOT EXISTS shipwright_thread_messages_created_idx
  ON shipwright_thread_messages (created_at);

-- Structured repo memory is state, not transcript. It survives transcript
-- retention and is removed only by an explicit repo clear or account erasure.
CREATE TABLE IF NOT EXISTS shipwright_repo_memory (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES users(id),
  installation_id INTEGER NOT NULL,
  repo_full_name  TEXT    NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  kind            TEXT    NOT NULL,
  body_json       TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (user_id, installation_id, repo_full_name, kind)
);
CREATE INDEX IF NOT EXISTS shipwright_repo_memory_scope_idx
  ON shipwright_repo_memory (user_id, installation_id, repo_full_name, updated_at DESC);

-- A proposal is durable provenance for one exact thread and repository.
-- Identical YAML emitted in repo A therefore cannot authorize publication in
-- repo B, even when the same user owns both installations.
CREATE TABLE IF NOT EXISTS shipwright_proposals (
  id              TEXT    PRIMARY KEY,
  thread_id       TEXT    NOT NULL REFERENCES shipwright_threads(id) ON DELETE CASCADE,
  user_id         TEXT    NOT NULL REFERENCES users(id),
  installation_id INTEGER NOT NULL,
  repo_full_name  TEXT    NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  yaml            TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE (thread_id, yaml)
);
CREATE INDEX IF NOT EXISTS shipwright_proposals_scope_idx
  ON shipwright_proposals (user_id, installation_id, repo_full_name, thread_id, created_at DESC);
