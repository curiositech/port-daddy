-- X4 PARLEY v1 — signed multi-party agreements over harbors
-- (docs/proposals/relay-grand-plan.md §X4; src/parleys.ts). Applied to staging
-- by deploy-relay.yml; prod via the migrations gate (ADR-0119).
--
--   parleys          — one artifact per convened parley: which harbor, what
--                      subject, who proposed it, a hard deadline, and a
--                      three-state machine: open → agreed | lapsed. AGREED
--                      requires every NAMED party to have signed 'accept';
--                      once agreed (or lapsed) the artifact is IMMUTABLE —
--                      no route writes to a non-open parley. Expiry is
--                      checked lazily on read/write (no per-parley timer):
--                      parley is never a liveness hole.
--   parley_positions — one row per participant identity. Rows with
--                      is_party=1 are NAMED parties whose signed 'accept' is
--                      required for agreement; is_party=0 rows are reserved
--                      observers — v1 reserves the tier-labeled
--                      'pd-mediator' seat here with NO auto-behavior (the
--                      mediator's real body is gated by the plan). A signed
--                      position (stance + free text + signed_at) is
--                      write-once: signatures are never edited.

CREATE TABLE IF NOT EXISTS parleys (
  id             TEXT    PRIMARY KEY,            -- 'p_' || randomHex(16)
  harbor_id      TEXT    NOT NULL REFERENCES harbors(id),
  subject        TEXT    NOT NULL,               -- what is being agreed (free text, bounded)
  proposer_id    TEXT    NOT NULL REFERENCES users(id),
  proposer_label TEXT    NOT NULL,               -- login captured at convene time
  state          TEXT    NOT NULL CHECK (state IN ('open','agreed','lapsed')),
  deadline_at    INTEGER NOT NULL,               -- unix seconds; default now + 24h
  created_at     INTEGER NOT NULL,               -- unix seconds
  resolved_at    INTEGER                         -- unix seconds when agreed/lapsed; NULL while open
);
CREATE INDEX IF NOT EXISTS parleys_harbor_idx ON parleys (harbor_id, created_at);

CREATE TABLE IF NOT EXISTS parley_positions (
  parley_id   TEXT    NOT NULL REFERENCES parleys(id),
  party_kind  TEXT    NOT NULL CHECK (party_kind IN ('user','daemon','mediator')),
  party_id    TEXT    NOT NULL,                  -- users.id / identities.daemon_fingerprint / 'pd-mediator'
  party_label TEXT    NOT NULL,                  -- login / fingerprint / 'pd-mediator'
  tier        TEXT    NOT NULL,                  -- 'human' | identity proof_method | 'mediator'
  is_party    INTEGER NOT NULL,                  -- 1 = named party (accept required); 0 = reserved observer
  stance      TEXT    CHECK (stance IN ('accept','reject')),  -- NULL until signed
  position    TEXT,                              -- free text signed alongside the stance
  signed_at   INTEGER,                           -- unix seconds; NULL until signed (write-once)
  PRIMARY KEY (parley_id, party_kind, party_id)
);
