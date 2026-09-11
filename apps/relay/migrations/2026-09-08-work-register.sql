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

  -- Who ANSWERS for it, which is not who is typing. An agent holds a slug for
  -- an hour; the owner is whoever the work belongs to across every agent that
  -- ever touches it, and survives release, salvage and hand-off. Keeping them
  -- in one column would have meant losing the owner every time a claim moved,
  -- which is exactly when you most want to know who to ask.
  owner          TEXT,

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

-- What else is about this slug: the PR that carries it, the ADR that decided
-- it, the plan it came out of, the CI run that proves it.
--
-- A separate table rather than more columns on the claim, for two reasons. A
-- slug routinely has several of these and exactly one claim, so columns would
-- mean `pr_number_2`. And links outlive claims: the PR that carried a slug is
-- still the answer to "where did this go" long after the agent released it,
-- and would be erased by a release if it lived on the claim. `pr_number` stays
-- on the claim as the holder's current PR -- what they are working in now --
-- which is a different question from what this slug is linked to.
CREATE TABLE IF NOT EXISTS work_links (
  repo_full_name TEXT    NOT NULL,
  slug           TEXT    NOT NULL,
  -- 'pr' and 'issue' carry a number in `ref`; the rest carry a repo-relative
  -- path or a URL. The kind is closed so a board can render them differently
  -- without guessing from the string.
  kind           TEXT    NOT NULL
    CHECK (kind IN ('pr', 'issue', 'doc', 'adr', 'run', 'branch', 'other')),
  ref            TEXT    NOT NULL,
  title          TEXT    NOT NULL DEFAULT '',
  added_by       TEXT    NOT NULL DEFAULT '',
  at             INTEGER NOT NULL,
  -- Same link added twice is one link, whoever added it. Agents re-post what
  -- they know on every turn, and a board that grew a row each time would bury
  -- the thread it is meant to summarise.
  PRIMARY KEY (repo_full_name, slug, kind, ref)
);

CREATE INDEX IF NOT EXISTS idx_work_links_slug
  ON work_links(repo_full_name, slug, at DESC);

-- NO REGISTRY TABLE HERE, and that is the point.
--
-- The first draft of this migration carried `work_registry_cache` and
-- `work_registry_cache_meta`: a copy of the repository's roadmap, read out of
-- `docs/roadmap/roadmap.snapshot.json` through a signed-in operator's GitHub
-- token. It was a second copy of something this database already stores.
-- `2026-08-22-roadmap-mirror.sql` (applied) holds `roadmap_mirrors` and
-- `roadmap_mirror_items`, which the daemon pushes to directly.
--
-- Reading that instead is better on three counts, and the migration is the
-- honest place to record them because the tables that are ABSENT here are the
-- decision:
--
--   * an agent holding only a `pdu_` device token has no GitHub credential, so
--     it could never fill the cache; the mirror is already populated by the
--     time an agent asks;
--   * the mirror carries the DAEMON's clock beside the relay's, so staleness is
--     measured against when the roadmap was true rather than when this Worker
--     happened to read a file;
--   * the mirror sees what the daemon has recorded, not only what has reached
--     the default branch.
--
-- The cost is stated rather than hidden: the mirror is account-scoped, so each
-- operator's board shows the roadmap THEY pushed while the claims above stay
-- shared across the repository. For one operator running many agents these are
-- the same set. For two operators they are not.
