-- The Harbor Work Register: shared occupancy for the agents working one repo.
--
-- What this is FOR, stated before the columns, because the distinction is the
-- whole design and it is the one this repository keeps losing:
--
--   The REGISTRY says what work exists. That is `roadmap_items` in the daemon,
--   projected append-only to docs/roadmap/roadmap.snapshot.json, and this
--   Worker never writes it. When an agent asks the register what there is to
--   do, the answer is read from that projection through the repo, live.
--
--   The REGISTER says who is on it right now. That is these tables, and
--   nothing else. A row here is a claim over a slug, not the existence of the
--   slug -- exactly the Claim/roadmap-item distinction the Book draws so that
--   a coordination record cannot quietly become a second constitution.
--
-- The practical consequence: with the daemon halted, the registry cannot be
-- written and the register still works. Agents can coordinate over the work
-- that is already recorded, and a slug they propose that has no row lands in
-- `proposed` -- visibly second-class, and the same queue that
-- docs/roadmap/unregistered.json counts in-tree.
--
-- THE SHARING KEY IS THE REPOSITORY, not the account. The first draft of this
-- schema keyed every table on (user_id, repo, slug), which quietly made the
-- board per-operator: two accounts' agents working one repository would have
-- held the same slug at the same time and each been told it was free. That is
-- the failure the register exists to prevent, so the key moved to the repo and
-- `work_board_members` carries the access question separately. Membership is
-- not the same question as occupancy, and conflating them cost the product its
-- only guarantee.

-- Who may reach a board without a GitHub credential of their own.
--
-- A signed-in session is checked against the live GitHub ACL on every request
-- and needs no row here. A `pdu_` device bearer -- what an agent carries --
-- has no GitHub token to check, so it is admitted only to a repository this
-- account has already opened in a browser, which is what a row here records.
-- An agent therefore cannot use its device token to discover repositories its
-- operator never brought here, and the operator's own read access is still
-- re-checked live every time they visit.
CREATE TABLE IF NOT EXISTS work_board_members (
  repo_full_name TEXT    NOT NULL,
  user_id        TEXT    NOT NULL REFERENCES users(id),
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  PRIMARY KEY (repo_full_name, user_id)
);

-- One row per (repo, slug). The primary key is why two agents cannot both hold
-- one slug: the second INSERT ... ON CONFLICT sees the first.
CREATE TABLE IF NOT EXISTS work_claims (
  repo_full_name TEXT    NOT NULL,
  slug           TEXT    NOT NULL,

  -- 'registered' when the repo's committed snapshot carries this slug;
  -- 'proposed' when an agent named work the registry has never admitted. A
  -- proposed row is a queue entry, not a schedule, and the page says so.
  provenance     TEXT    NOT NULL DEFAULT 'registered'
    CHECK (provenance IN ('registered', 'proposed')),

  -- The claim's own lifecycle. 'open' means nobody holds it and the row exists
  -- only to carry notes or a proposal; every other state names a holder.
  state          TEXT    NOT NULL
    CHECK (state IN ('open', 'held', 'blocked', 'review', 'done', 'abandoned')),

  -- Who holds it. `agent` is the address another agent would message; it is
  -- free text on purpose (a session id, a fleet ship name, a person) because
  -- the register must not become an identity authority as well.
  agent          TEXT,
  agent_kind     TEXT
    CHECK (agent_kind IS NULL OR agent_kind IN ('session', 'human', 'fleet')),

  -- What the holder is actually doing, in their words, plus where to look.
  headline       TEXT    NOT NULL DEFAULT '',
  branch         TEXT,
  pr_number      INTEGER,

  -- Unix seconds. `heartbeat_at` is what makes a dead agent's claim
  -- salvageable rather than held forever: a claim whose heartbeat has gone
  -- quiet past the TTL is offered to the next agent that asks, and the taking
  -- is recorded as a salvage rather than a hand-off.
  claimed_at     INTEGER,
  heartbeat_at   INTEGER,
  finished_at    INTEGER,
  updated_at     INTEGER NOT NULL,

  PRIMARY KEY (repo_full_name, slug)
);

-- The board's read path: everything not finished, most recently touched first.
CREATE INDEX IF NOT EXISTS idx_work_claims_board
  ON work_claims(repo_full_name, state, updated_at DESC);

-- What each agent currently holds, for "who is on what" and for the heartbeat
-- sweep that finds stale claims.
CREATE INDEX IF NOT EXISTS idx_work_claims_holder
  ON work_claims(repo_full_name, agent, heartbeat_at);

-- Append-only. A note is how an agent leaves the next one something that the
-- diff cannot say: what it tried, what it ruled out, what it would do next.
-- The register keeps them because a claim released without a note is work
-- somebody has to redo from the beginning.
CREATE TABLE IF NOT EXISTS work_notes (
  id             TEXT    NOT NULL PRIMARY KEY,
  repo_full_name TEXT    NOT NULL,
  slug           TEXT    NOT NULL,
  at             INTEGER NOT NULL
    CHECK (typeof(at) = 'integer' AND at > 0),
  agent          TEXT    NOT NULL,
  -- 'note' is an agent talking; the rest are the register recording what it
  -- did, so a thread reads as a history rather than as prose with gaps.
  kind           TEXT    NOT NULL
    CHECK (kind IN ('note', 'claimed', 'released', 'salvaged', 'state', 'finished')),
  body           TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_work_notes_thread
  ON work_notes(repo_full_name, slug, at DESC);

-- The registry projection, cached so an agent holding only a device token can
-- ask what work exists without carrying a GitHub credential of its own.
--
-- This is a CACHE and the page says the word: the authority is the committed
-- snapshot in the repo, read through a signed-in operator's own GitHub token,
-- and every read here is stamped with the ref it came from and the moment it
-- was taken. A stale cache is shown as stale rather than served as current --
-- the failure this whole design exists to avoid is a projection that reads as
-- truth after its source moved.
CREATE TABLE IF NOT EXISTS work_registry_cache (
  repo_full_name TEXT    NOT NULL,
  slug           TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT '',
  kind           TEXT    NOT NULL DEFAULT '',
  priority       INTEGER,
  summary        TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (repo_full_name, slug)
);

CREATE TABLE IF NOT EXISTS work_registry_cache_meta (
  repo_full_name TEXT    NOT NULL PRIMARY KEY,
  ref            TEXT    NOT NULL,          -- the branch the snapshot was read at
  path           TEXT    NOT NULL,          -- where in the repo it was read from
  read_at        INTEGER NOT NULL,          -- relay clock, unix seconds
  item_count     INTEGER NOT NULL,
  -- Which account's GitHub token was used for the read that produced this row.
  -- Kept because "the cache is this old" is only half an answer; the other half
  -- is whose view of the repository it is.
  refreshed_by   TEXT    NOT NULL DEFAULT ''
);
