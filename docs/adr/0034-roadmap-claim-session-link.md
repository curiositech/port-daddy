# 0034. Link Roadmap Claims to Sessions and Agents

## Status

Accepted

## Context

ADR-0033 introduced `roadmap_claims` as the atomicity boundary for popping
roadmap entries, with `claimed_by` as a free-form string. That string was
"good enough" to win the race; it is **not** good enough as a coordination
fact:

- `pd sessions` cannot say "this session is currently chewing roadmap slug
  X" because the claim row knows nothing about the session it created.
- `pd whois <slug>` (the talent-phonebook router from
  `project_pd_talent_phonebook` in memory) cannot resolve a slug back to an
  agent identity, because `claimed_by` is opaque text.
- `pop --begin` chains into `pd begin`, which writes a new session +
  registers a new agent — but the claim row never learns those IDs. The
  two coordination layers (`sessions` and `roadmap_claims`) sit beside
  each other instead of pointing at each other.

So a claim that says `claimed_by: "agent-foo"` is nominal — it can be
anything, and nothing else in the system uses it as a join key.

## Decision

Make the claim row know about the session and agent it spawned.

```sql
ALTER TABLE roadmap_claims ADD COLUMN session_id TEXT;
ALTER TABLE roadmap_claims ADD COLUMN agent_id   TEXT;
CREATE INDEX IF NOT EXISTS idx_roadmap_claims_session
  ON roadmap_claims(session_id) WHERE session_id IS NOT NULL;
```

Both columns are nullable. `pop` accepts `sessionId` and `agentId` in the
body; if present, they are written on the new row. `pop` also exposes
`linkClaim(claimId, { sessionId, agentId })` so the CLI can fill them in
after the fact when `--begin` chains.

### Lifecycle integration

`pd roadmap pop --begin` (the chain flag from ADR-0033) becomes:

1. `POST /cartographer/roadmap-pop` → claim row written, returns `claim.id`.
2. `pd begin` runs internally → returns the new agent + session.
3. `POST /cartographer/roadmap-claim-link` writes `session_id` + `agent_id`
   onto the claim row. Idempotent: if the claim already has a session, the
   request 409s unless `force: true` is set (this is the rebind escape
   hatch for operators who killed and restarted their session).
4. `pd sessions` and `pd whoami` read the claim back via the new index and
   surface "working on: <slug>".

A separate `POST /cartographer/roadmap-claim-link` keeps the linking step
optional: a CI script that popped without `--begin` can still record its
session later, and existing callers of `pop` keep working unchanged.

### Backward compatibility

- Existing rows have `session_id = NULL` / `agent_id = NULL`. They stay
  valid claims — they just can't be reverse-resolved beyond `claimed_by`.
- The `ALTER TABLE` runs unconditionally at module init; SQLite is silent
  about already-existing columns inside a guarded `PRAGMA table_info`
  check that the module performs. New databases get the columns from the
  primary `CREATE TABLE`.

### What this does NOT do

- **No file/region predictions.** A separate ADR will define
  `roadmap_claim_files` with `path` / `symbol` / `start_line` / `end_line`
  and the cartographer/symbol-index strategy for populating them on pop.
  That is the next seam (claim ↔ file claims). This ADR stops at claim ↔
  session because it unblocks `pd sessions` and the talent phonebook
  without dragging in the prediction pipeline.
- **No cross-check against `session_files`.** Claiming a roadmap slug does
  not yet contest file claims held by other sessions. That is the
  back-pressure question; it depends on file predictions being in place.

## Rationale

Two designs were considered:

1. **Make `claimed_by` the agent FK directly.** Rejected: `pop` is also
   called by humans and CI scripts that don't register an agent. A nullable
   `agent_id` next to `claimed_by` preserves the free-form receipt while
   adding the join key.

2. **Write the link inside the pop transaction.** Rejected: `pd begin` is
   a separate HTTP round-trip from `pop`. Coupling them at the storage
   layer means failure in either rolls back both. The two-step link
   endpoint accepts the failure mode (claim is held; begin failed; user
   can `pd roadmap release`) without locking the substrate.

## Consequences

### Positive

- `pd sessions` can surface roadmap context for any linked session, with
  one indexed lookup.
- `pd whois <slug>` (future) resolves cleanly through `agent_id`.
- Two coordination layers (sessions, roadmap claims) now reference each
  other — they stop being parallel structures.

### Negative

- One more table column to maintain. Migration is idempotent but adds a
  schema step.
- `pop --begin` is now a 3-call chain instead of 2; failure between
  step 2 and 3 leaves a session and claim that don't know about each
  other. Mitigated by `pd roadmap claim-link <slug> --session <id>`
  as a manual rebind verb.

### Neutral

- The existing `pop` endpoint and CLI keep working with no session/agent
  args. The new fields are purely additive.
