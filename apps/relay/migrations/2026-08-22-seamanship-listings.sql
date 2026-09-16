-- SEAMANSHIP (src/seamanship.ts, src/seamanship-page.ts) — the operator's own
-- skill catalog at GET /account/seamanship, and the opt-in public directory at
-- GET /skills. Applied on staging by CI (deploy-relay.yml), then on prod once
-- the ledger gate passes.
--
-- THE RULE THESE TABLES EXIST TO ENFORCE, verbatim from the operator:
--
--   "Skills need to be particular to a person and a repo for now. We do not
--    distribute these 300 skills, they're Erich Owens' and they are particular
--    to his repos."
--
-- So: the repo stays the source of truth and NEITHER table below is a mirror of
-- the corpus. There is no `body` column anywhere in this migration, and that is
-- a deliberate structural guarantee rather than a convention — a column that
-- does not exist cannot be filled in by a later careless write.
--
--   seamanship_skill_cache — a SHORT-TTL (5 minutes, src/seamanship.ts
--     SKILL_CACHE_TTL_SECONDS) cache of parsed SKILL.md FRONTMATTER, scoped to
--     the signed-in user who fetched it under their own GitHub App
--     installation. It exists so one page view is not forty GitHub round-trips.
--     It is a cache in the strict sense: every row is reconstructible from the
--     repo, and dropping the table costs latency and nothing else.
--
--   skill_listings — the listed-tier PROJECTION. One row per skill whose author
--     wrote `visibility: listed` (or `public`) into its own SKILL.md and then
--     published. The row IS the listed payload: a name and a description. The
--     repo coordinates ride along so the public-tier route can fetch a body on
--     demand, and are never serialized into a public response.
--
-- Forward-only and additive (migrations/README.md rule 3): two new tables, no
-- column drops, no rewrites. A rollback to the previous Worker release simply
-- stops reading them.

-- ── The frontmatter cache ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seamanship_skill_cache (
  -- Scoped per user: the frontmatter was read under THIS user's installation
  -- grant, so it is answerable to that grant and never shared across tenants.
  user_id         TEXT    NOT NULL REFERENCES users(id),
  repo_full_name  TEXT    NOT NULL,           -- 'owner/name'
  source_path     TEXT    NOT NULL,           -- 'skills/<id>/SKILL.md'
  skill_id        TEXT    NOT NULL,           -- frontmatter `name`
  name            TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  category        TEXT    NOT NULL DEFAULT '',
  tags_json       TEXT    NOT NULL DEFAULT '[]',
  owner           TEXT,                       -- frontmatter `owner`; NULL = none recorded
  repos_json      TEXT    NOT NULL DEFAULT '[]',
  -- The tier AS WRITTEN in the repo. Re-parsed through parseVisibility on read
  -- (never trusted as a raw column), so a value that predates a parser change
  -- still narrows rather than widens.
  visibility      TEXT    NOT NULL DEFAULT 'private',
  pairs_with_json TEXT    NOT NULL DEFAULT '[]',
  fetched_at      INTEGER NOT NULL,           -- unix seconds; TTL is (now - fetched_at)
  PRIMARY KEY (user_id, repo_full_name, source_path)
);
-- The retention sweep prunes stale cache rows by age.
CREATE INDEX IF NOT EXISTS seamanship_skill_cache_age_idx
  ON seamanship_skill_cache (fetched_at);

-- ── The listed-tier public projection ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_listings (
  -- The GitHub login that owns the namespace: public ids are '@<namespace>/<skill_id>'.
  -- Not a users(id) FK on purpose — the namespace is the durable public name,
  -- and erasure removes these rows explicitly (db.ts eraseUser) rather than
  -- letting a cascade decide.
  namespace      TEXT    NOT NULL,
  skill_id       TEXT    NOT NULL,
  -- The listed payload, in full. Nothing else about the skill belongs here.
  name           TEXT    NOT NULL,
  description    TEXT    NOT NULL,
  -- Coordinates for the on-demand public-tier body fetch. NEVER serialized to a
  -- public response: "particular to his repos" means the repo names are not the
  -- public's business either.
  repo_full_name TEXT    NOT NULL,
  source_path    TEXT    NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (namespace, skill_id)
);
CREATE INDEX IF NOT EXISTS skill_listings_updated_idx ON skill_listings (updated_at);
