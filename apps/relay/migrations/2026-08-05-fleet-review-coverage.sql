-- Fleet incremental review coverage — durable, append-only, exact-SHA ledger
-- (apps/fleet-executor/src/review-coverage.ts). Applied to staging by
-- deploy-relay.yml; prod via the migrations gate (ADR-0119). Storage
-- foundation only: nothing yet writes to these tables from a route,
-- `merge_group`, or AI execution.
--
--   fleet_review_coverage       — one immutable row per (subject, sha) that
--                                  reached a SHIP verdict. `predecessor_sha`
--                                  is the exact SHA `sha` was reviewed
--                                  against, so rows form a hash chain proving
--                                  every commit on the subject was covered —
--                                  no gaps, no forks. Rows are never updated
--                                  or deleted; the app layer
--                                  (review-coverage.ts) rejects non-SHIP,
--                                  malformed SHA, self-loop, predecessor
--                                  gap/mismatch, and conflicting replay
--                                  before anything reaches SQL, and accepts
--                                  an exact resubmission as an idempotent
--                                  no-op.
--   fleet_review_coverage_heads — one row per subject caching the current
--                                  chain tip, so continuity checks are an
--                                  O(1) point lookup instead of a scan.

CREATE TABLE IF NOT EXISTS fleet_review_coverage (
  subject         TEXT    NOT NULL,              -- opaque caller-defined key, e.g. 'owner/repo#123'
  sha             TEXT    NOT NULL CHECK (length(sha) = 40),
  predecessor_sha TEXT    NOT NULL CHECK (length(predecessor_sha) = 40),
  kind            TEXT    NOT NULL CHECK (kind = 'SHIP'),
  recorded_at     INTEGER NOT NULL,              -- unix seconds
  PRIMARY KEY (subject, sha)
);
CREATE INDEX IF NOT EXISTS fleet_review_coverage_subject_idx
  ON fleet_review_coverage (subject, recorded_at);

CREATE TABLE IF NOT EXISTS fleet_review_coverage_heads (
  subject    TEXT    PRIMARY KEY,
  head_sha   TEXT    NOT NULL CHECK (length(head_sha) = 40),
  updated_at INTEGER NOT NULL              -- unix seconds
);
