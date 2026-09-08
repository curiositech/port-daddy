-- X3 PRESENCE + HELM v1 — presence first, the Helm without ballots (D5, D6)
-- (docs/proposals/relay-grand-plan.md §X3; src/presence.ts). Applied to staging
-- by deploy-relay.yml; prod via the migrations gate (ADR-0119).
--
-- Presence itself lives in the HarborChannel Durable Object (hot, TTL ~90s —
-- not a D1 concern). D1 holds only the AUTHORITY record and its audit trail:
--
--   harbor_helms — one explicit authority record per harbor: the holder plus
--                  an ORDERED succession list, owner-set. NO voting machinery,
--                  ever (grand-plan D6): the helm changes only by an owner's
--                  signed-in PUT or by the dead-man rule (holder presence
--                  expired past grace ⇒ helm passes to the next PRESENT
--                  successor). `seq` is the optimistic-concurrency guard for
--                  dead-man transitions.
--   helm_events  — append-only audit rows. Every helm change — owner set,
--                  dead-man pass, dead-man vacancy — lands here. A helm NEVER
--                  changes silently.

CREATE TABLE IF NOT EXISTS harbor_helms (
  harbor_id       TEXT    PRIMARY KEY REFERENCES harbors(id),
  holder_kind     TEXT    CHECK (holder_kind IN ('user','daemon')),  -- NULL when vacant
  holder_id       TEXT,                          -- users.id ('user') or identities.daemon_fingerprint ('daemon')
  holder_label    TEXT,                          -- display label captured at set time (login / fingerprint)
  succession_json TEXT    NOT NULL,              -- ordered JSON array of {kind,id,label}
  state           TEXT    NOT NULL CHECK (state IN ('held','vacant')),
  vacant_flagged  INTEGER NOT NULL DEFAULT 0,    -- 1 after a dead-man pass found NO present successor
  seq             INTEGER NOT NULL,              -- bumps on every change; dead-man CAS guard
  updated_at      INTEGER NOT NULL,              -- unix seconds
  updated_by      TEXT    NOT NULL               -- users.id (owner PUT) or 'relay:dead-man'
);

CREATE TABLE IF NOT EXISTS helm_events (
  id        TEXT    PRIMARY KEY,                 -- 'he_' || randomHex(8)
  harbor_id TEXT    NOT NULL REFERENCES harbors(id),
  at        INTEGER NOT NULL,                    -- unix seconds
  kind      TEXT    NOT NULL CHECK (kind IN ('helm_set','dead_man_pass','dead_man_vacant')),
  detail    TEXT    NOT NULL                     -- JSON: {from,to,...} — who held, who took over, why
);
CREATE INDEX IF NOT EXISTS helm_events_harbor_idx ON helm_events (harbor_id, at);
