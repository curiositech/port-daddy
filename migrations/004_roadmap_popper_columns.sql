-- migration 004 — give roadmap_items the columns the popper needs to:
--   (a) decide whether an item is autonomous-eligible
--   (b) link a popped item to the dispatch row that's now executing it
-- Idempotent. Re-running is a no-op (SQLite ALTER TABLE ADD COLUMN is
-- declarative; we guard with PRAGMA inspection so re-applying doesn't error).

-- nightshift_eligible: explicit opt-in flag. Defaults FALSE so existing items
-- stay operator-curated until the operator tags them. The popper ONLY looks
-- at rows where this is 1.
ALTER TABLE roadmap_items ADD COLUMN nightshift_eligible INTEGER NOT NULL DEFAULT 0;

-- dispatch_id: when the popper hands an item to the dispatch queue
-- (lib/dispatch/queue.ts, PR #143 / #163), it stamps the dispatch's id here
-- so the operator can navigate roadmap_item ↔ dispatch in either direction.
-- Nullable: most items never get dispatched.
ALTER TABLE roadmap_items ADD COLUMN dispatch_id TEXT;

-- Index for the popper's hot path: SELECT … WHERE nightshift_eligible=1
-- AND status='backlog' AND dispatch_id IS NULL ORDER BY last_touched_at DESC.
CREATE INDEX IF NOT EXISTS idx_roadmap_items_popper_eligible
  ON roadmap_items(nightshift_eligible, status, dispatch_id);
