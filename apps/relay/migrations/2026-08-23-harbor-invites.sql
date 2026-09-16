-- X2 REMOTE HARBORS — single-use invites + the authority-epoch clock
-- (docs/adr/0122-harbor-authority.md §4; src/invites.ts). Lifts the v1
-- deferral named in src/harbors.ts ("signed single-use invite JTIs + /join").
-- Applied to staging by deploy-relay.yml; prod via the migrations gate
-- (ADR-0119). Additive and forward-only per this directory's README.
--
-- harbor_invites — one row per minted invite: a single-use JTI bound to a
--   harbor and an inviter, with a hard expiry.
--   * The bearer token NEVER touches this table: only its SHA-256 hash is
--     stored (user_tokens discipline), so a D1 dump yields no redeemable
--     invites.
--   * No key material rides an invite in either direction — an invite admits
--     a principal to the phone-book membership list; channel keys move
--     daemon-to-daemon (grand-plan §X2). The relay stays a phone book, never
--     a key holder.
--   * Single-use is enforced by compare-and-swap in the store (UPDATE ...
--     WHERE consumed_at IS NULL), never read-then-write; consumed_at /
--     consumed_by are written exactly once by the winning consume.
--   * role is pinned to 'member' by CHECK: an invite can only ever grant
--     plain membership (invariant I4 — a delegated credential never expands
--     rights). Widening this is a deliberate future migration, not a code
--     path.
--
-- harbors.authority_epoch — ADR-0122 §4's membership-change clock on the X2
--   registry row the relay already owns: it ticks on every membership write
--   (join, operator add-member). It is a change COUNTER of the phone book,
--   not an authority grant — the relay still signs nothing, holds no writer
--   lease, and authors no authority record; the signed record stays with the
--   owning daemon (ADR-0122 §2–3). Existing harbors backfill to epoch 1
--   (creation with the founding owner is epoch 1).

CREATE TABLE IF NOT EXISTS harbor_invites (
  jti         TEXT    PRIMARY KEY,                -- 'hi_' || randomHex(16); the listable/revocable handle
  harbor_id   TEXT    NOT NULL REFERENCES harbors(id),
  token_hash  TEXT    NOT NULL UNIQUE,            -- SHA-256 hex of the bearer token; the raw token is never stored
  invited_by  TEXT    NOT NULL REFERENCES users(id),
  role        TEXT    NOT NULL DEFAULT 'member' CHECK (role = 'member'),
  created_at  INTEGER NOT NULL,                   -- unix seconds
  expires_at  INTEGER NOT NULL,                   -- unix seconds; mandatory (invariant I3: bounded by exp)
  consumed_at INTEGER,                            -- unix seconds; set once by the winning CAS consume
  consumed_by TEXT,                               -- users.id of the joiner who won the CAS
  revoked_at  INTEGER,                            -- unix seconds (invariant I3: revocable)
  revoked_by  TEXT                                -- users.id of the revoker (the inviter or an owner)
);
CREATE INDEX IF NOT EXISTS harbor_invites_harbor_idx
  ON harbor_invites (harbor_id, created_at DESC);

ALTER TABLE harbors ADD COLUMN authority_epoch INTEGER NOT NULL DEFAULT 1;
