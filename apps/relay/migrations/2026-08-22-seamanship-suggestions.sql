-- SNIPE SUGGESTIONS (src/snipe-suggestions.ts, src/snipe-builder.ts) — the
-- Engineman's advisory proposals for an operator's own repo, and the
-- approval-gated path from a proposal to a pull request.
--
-- THE RULE THESE TABLES EXIST TO ENFORCE
--
--   No approval ⇒ no build ⇒ no pull request. Not by convention, by structure.
--
-- That rule is spread across the three tables below on purpose, so that no
-- single careless UPDATE can produce a built skill:
--
--   seamanship_suggestions  — one row per proposed skill, per (account, repo).
--       `status` is the only lifecycle field and its CHECK constraint is the
--       outer fence: a value outside proposed|approved|dismissed|built cannot
--       be written at all. The transitions BETWEEN those values are enforced
--       one layer in, by conditional UPDATEs that name the required prior
--       state in their WHERE clause (src/snipe-suggestions.ts,
--       `applySuggestionTransition`) — so "proposed → built" is not a
--       forbidden-by-policy write, it is a write that matches zero rows.
--
--   seamanship_build_grants — the capability. Exactly one row can ever exist
--       per suggestion (suggestion_id is the PRIMARY KEY), it is minted ONLY
--       by the approval transition, and it is spent by a conditional UPDATE on
--       `consumed_at IS NULL`. The builder cannot start without claiming one,
--       and a claim is single-use: a replayed build request finds the grant
--       already consumed and does nothing. Revocation (the operator dismisses
--       an approved suggestion) sets `revoked_at`, which the same conditional
--       claim excludes — an approval can be taken back right up until the
--       moment a build actually starts.
--
--   seamanship_suggestion_jobs — the async admission receipt for a suggestion
--       run, mirroring `fleet_run_intents`: the row exists BEFORE any work
--       starts, so a job lost to an isolate eviction leaves a visible
--       'running' row that the sweep can reap, never a silent nothing.
--
-- WHAT IS DELIBERATELY ABSENT: there is no column here that holds a skill
-- BODY. A built skill lives in the operator's repo, reached through a pull
-- request they merged; this database holds the proposal and the PR url that
-- links to it. A column that does not exist cannot be filled in later by a
-- careless write, and cannot become a second, divergent catalog.
--
-- Forward-only and additive (migrations/README.md rule 3): three new tables,
-- no column drops, no rewrites. A rollback to the previous Worker release
-- simply stops reading them — the rows keep their meaning for the release
-- that comes back.

-- ── The proposals ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seamanship_suggestions (
  id              TEXT    PRIMARY KEY,          -- 'sug_<random>'
  -- The ACCOUNT half of (account, repo). Every read is scoped by this column;
  -- it is the whole of the tenancy story, exactly as shipwright_chats is.
  user_id         TEXT    NOT NULL REFERENCES users(id),
  -- The REPO half: 'owner/name'. A suggestion is particular to one repo of one
  -- person — the same catalog rule the Seamanship page is built on.
  repo_full_name  TEXT    NOT NULL,
  -- The proposed skill's id/directory name (lower-kebab), e.g. 'migration-backfill-verify'.
  skill_name      TEXT    NOT NULL,
  -- What the skill would do — the frontmatter `description` a built skill gets.
  description     TEXT    NOT NULL,
  -- WHY this repo needs it: the recurring friction the proposal claims to end.
  -- Advisory reasoning, shown to the operator so approval is an informed act.
  rationale       TEXT    NOT NULL,
  -- The lifecycle. The CHECK is the outer fence; the legal transitions between
  -- these values live in conditional UPDATEs (see the banner above).
  status          TEXT    NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed', 'approved', 'dismissed', 'built')),
  created_at      INTEGER NOT NULL,             -- unix seconds
  updated_at      INTEGER NOT NULL,
  -- Set by the approval transition, and only by it. NULL for every row that a
  -- human has not explicitly approved.
  approved_at     INTEGER,
  -- The users(id) of the operator who approved. Recorded so "a human approved
  -- this" is answerable from the row itself, not inferred from status alone.
  approved_by     TEXT,
  -- The pull request the builder opened. NULL until a build succeeds; it is
  -- what the page links back to. Nothing reaches the catalog except through it.
  pr_url          TEXT,
  -- The last build failure, if any — kept so a failed build is legible on the
  -- page rather than looking like an approval that quietly did nothing.
  build_error     TEXT,
  -- The suggestion job that produced this row (seamanship_suggestion_jobs.job_id).
  job_id          TEXT,
  -- DEDUP, AT THE STORAGE LAYER. The application also de-dupes against the
  -- live catalog before proposing anything, but this constraint is what makes
  -- "the same skill proposed twice for the same repo" impossible rather than
  -- merely unlikely — including across two jobs racing each other.
  UNIQUE (user_id, repo_full_name, skill_name)
);
CREATE INDEX IF NOT EXISTS seamanship_suggestions_scope_idx
  ON seamanship_suggestions (user_id, repo_full_name, status);
CREATE INDEX IF NOT EXISTS seamanship_suggestions_created_idx
  ON seamanship_suggestions (created_at);

-- ── The build capability ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seamanship_build_grants (
  -- One grant per suggestion, forever. Not an id of its own: making the
  -- suggestion the PRIMARY KEY is what forbids a second grant for the same
  -- proposal, so "approve twice, build twice" cannot be expressed.
  suggestion_id   TEXT    PRIMARY KEY REFERENCES seamanship_suggestions(id),
  grant_id        TEXT    NOT NULL UNIQUE,      -- 'grant_<random>'; the claim key
  user_id         TEXT    NOT NULL REFERENCES users(id),
  repo_full_name  TEXT    NOT NULL,
  -- The GitHub App installation the APPROVING SESSION was proven to own, at
  -- approval time. The build runs later, on a sweep with no session, so the
  -- ownership proof cannot be re-taken then — it is recorded here, by the one
  -- request that could actually establish it, and the build uses no other.
  installation_id INTEGER NOT NULL,
  issued_at       INTEGER NOT NULL,
  -- Who approved. The grant carries it independently of the suggestion row so
  -- the capability is self-describing wherever it is read.
  issued_by       TEXT    NOT NULL,
  -- Build attempts spent against this grant. Bounded: a build that keeps
  -- failing before it can reach GitHub is retried a few times and then stops,
  -- rather than re-queueing forever.
  attempts        INTEGER NOT NULL DEFAULT 0,
  -- Set by the single-use claim. A grant with a non-NULL consumed_at can never
  -- start another build: the claim's WHERE requires consumed_at IS NULL. It is
  -- released again ONLY for a failure that provably happened before the pull
  -- request call — never for one where a PR may already exist.
  consumed_at     INTEGER,
  -- Set when the operator dismisses an approved suggestion before its build
  -- starts. The same claim WHERE excludes it, so approval is retractable.
  revoked_at      INTEGER
);
CREATE INDEX IF NOT EXISTS seamanship_build_grants_open_idx
  ON seamanship_build_grants (user_id, consumed_at);

-- ── The suggestion job's admission receipt ───────────────────────────────────
CREATE TABLE IF NOT EXISTS seamanship_suggestion_jobs (
  job_id          TEXT    PRIMARY KEY,          -- 'sjob_<random>'
  user_id         TEXT    NOT NULL REFERENCES users(id),
  repo_full_name  TEXT    NOT NULL,
  state           TEXT    NOT NULL DEFAULT 'queued'
                    CHECK (state IN ('queued', 'running', 'done', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  requested_at    INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER,
  -- How many suggestions this run actually stored (after dedup, boundary
  -- rejection and the ten-suggestion cap). Zero is a legitimate result and is
  -- recorded as one — silence from the Engineman is an answer, not a failure.
  produced        INTEGER NOT NULL DEFAULT 0,
  -- How many candidates the run threw away, and why, so an empty result is
  -- explainable on the page instead of looking like a broken job.
  rejected_dupe     INTEGER NOT NULL DEFAULT 0,
  rejected_boundary INTEGER NOT NULL DEFAULT 0,
  rejected_capped   INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);
-- ONE active job per (account, repo). A partial unique index is the structural
-- form of "don't run two of these at once": a second enqueue for a repo that
-- already has queued/running work fails the INSERT instead of racing it.
CREATE UNIQUE INDEX IF NOT EXISTS seamanship_suggestion_jobs_active_idx
  ON seamanship_suggestion_jobs (user_id, repo_full_name)
  WHERE state IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS seamanship_suggestion_jobs_state_idx
  ON seamanship_suggestion_jobs (state, requested_at);
