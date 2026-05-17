# 0033. Roadmap Pop — Atomic Claim from the Curated Pile

## Status

Accepted

## Context

`pd roadmap` (see ADR-0023, Cartographer/Navigator) surfaces four piles of
work the operator might pull next: live feedback tuples, ROADMAP.md "Next
Cuts", IDEAS-TROVE.md entries flagged `now`, and DOGFOOD-FEEDBACK.md curated
entries. Today the surfaces are read-only — the operator (or agent) reads
the list, picks a slug by eye, and either runs `pd roadmap ack <id>` for a
tuple-backed feedback row or just `pd begin --purpose "<slug>: ..."` and
hopes nobody else picked the same one.

That gap shows up the moment more than one agent (or human + agent, or two
worktrees of one human) hits the pile in the same minute. The roadmap is
the central coordination substrate Cartographer/Navigator exists to defend
(ADR-0023); leaving the *claim* mechanism unmodeled defeats it. We need a
verb that does the obvious thing and does it atomically:

> Pop the next thing off the pile, mark it claimed so nobody else pops it,
> tell me what I just took.

## Decision

Add a third roadmap verb — `pd roadmap pop` — backed by an atomic claim
table in SQLite. The claim is the boundary between "Cartographer surfaced
it" and "an operator owns it now."

### Verb shape

```
pd roadmap pop [--kind <kind>] [--slug <slug>] [--as <identity>]
               [--begin] [--dry-run] [--json] [--quiet]
```

- `--kind` one of `live | next-cut | now | feedback | any` (default `any`)
- `--slug` claim a specific entry; fail (409) if already claimed
- `--as <identity>` records claimant (default `pd whoami` agent, else `operator-cli`)
- `--begin` chain into `pd begin --identity <as> --purpose "<slug>: <summary>"`
- `--dry-run` preview what would be claimed without writing
- `--json` machine-readable
- `--quiet` print slug only

Two adjacent verbs round out the lifecycle:

```
pd roadmap release <slug> [--as <identity>] [--reason "<why>"]
pd roadmap claims [--mine] [--all] [--json]
```

`release` voids the active claim so the entry can be re-popped. `claims`
shows the current claim map (open by default, `--all` includes released
history).

### Precedence (default kind=any)

`live` → `next-cut` → `now` → `feedback`

Rationale: live feedback is the freshest agentic signal (someone *just*
hit something); next cuts are Cartographer's promoted "do this next";
ideas-now is curated but slower-moving; dogfood feedback is the long tail.

### Storage: `roadmap_claims` table

```sql
CREATE TABLE IF NOT EXISTS roadmap_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  feedback_id TEXT,         -- nullable; populated when kind='live'
  claimed_by TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  released_at INTEGER,
  released_by TEXT,
  release_reason TEXT,
  summary TEXT,             -- captured at claim time so release/history is readable
  surface TEXT,
  payload TEXT              -- JSON snapshot of the source roadmap entry
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmap_claims_active_slug
  ON roadmap_claims(slug) WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_roadmap_claims_claimed_by
  ON roadmap_claims(claimed_by) WHERE released_at IS NULL;
```

A claim is a row. A release sets `released_at` and lifts the partial
UNIQUE index, allowing a re-pop. The slug is the universal key — same
slug across kinds (e.g., promoted from `ideas-now` to `next-cut`) is
still one logical thing.

### Atomicity model

Single-daemon serialization. Port Daddy is a per-machine daemon (ADR-0024
daemon profiles); concurrent HTTP requests serialize through one Node
event loop and one SQLite file. The pop algorithm is:

1. Read roadmap progress (existing `getRoadmapProgress`).
2. Walk candidates in precedence order (or one specific candidate when
   `--slug` is set).
3. For each candidate, attempt `INSERT INTO roadmap_claims (slug, ...)
   VALUES (?, ...)` inside `db.transaction(...)`.
4. If the partial UNIQUE index rejects the insert (`SQLITE_CONSTRAINT`),
   that slug is already claimed — skip and try the next candidate.
5. First successful insert wins. Return the entry plus the claim row id.
6. If no candidate succeeds, return `404` (`pile empty` or `everything claimed`).

This makes the unique index — not application logic — the contention
boundary. Two callers racing on the same slug result in one INSERT and
one constraint violation. No application-level read-modify-write window.

For tuple-backed `live` feedback we *also* keep the existing
`feedback:harvested` tuple flow. The pop writes a `roadmap_claims` row;
when the operator finishes, `pd roadmap release --harvest` (or a
finishing verb in a follow-up ADR) writes the harvested tuple so
Cartographer can promote the row from open to harvested. That separation
keeps "I'm working on this" (claim) distinct from "this work landed in
the roadmap" (harvest).

### Multi-daemon and future-proofing

Out of scope for this ADR. If a future relay-harbor mesh (ADR-0027)
gives us multiple daemons writing into a shared store, the same partial
UNIQUE index continues to enforce per-slug exclusion at the storage
layer. Cross-daemon coordination on *which slug to try next* would need
gossip or a coordinator, but that's a different problem from atomicity.

### Integration with `pd begin`

The pop verb stays single-purpose by default — claim, return, exit. The
`--begin` flag chains into the existing sugar layer:

```
pd roadmap pop --begin
  -> POST /cartographer/roadmap-pop
  <- { entry, claimId }
  -> POST /agents (creates session via pd begin)
```

This keeps the endpoint composable. CI scripts that just want to know
"what's next" can call pop without spinning up a session.

### Server-side surface

```
POST /cartographer/roadmap-pop
  body: { claimedBy, kind?, slug?, root? }
  201: { success: true, entry, claim: { id, claimedBy, claimedAt, kind } }
  404: { success: false, error: 'pile empty' }
  409: { success: false, error: 'slug already claimed', claim: {...} }

POST /cartographer/roadmap-release
  body: { slug, releasedBy, reason? }
  200: { success: true, released: true }
  404: { success: false, error: 'no active claim for slug' }

GET /cartographer/roadmap-claims?status=open|released|all&claimedBy=<id>
  200: { success: true, claims: [...] }
```

All three routes mount under the `cartographer` namespace because that
actor owns roadmap state (ADR-0023).

## Rationale

Three competing approaches were considered:

1. **Mark via tuples** (`['roadmap:claim', slug, {...}]`).
   Append-only with no unique constraint — second writer doesn't fail,
   they both succeed and both think they won. Race-prone unless we add a
   read-back-and-decide step, which puts the contention boundary in JS
   instead of SQLite.

2. **Reuse `take()` to destructively remove a tuple.**
   Works for tuple-backed feedback only — next-cuts and ideas-now live
   in markdown, not tuples. Forcing every pile through tuples would
   require Cartographer to mirror its markdown into tuples and stay
   consistent, which is a much larger change than needed.

3. **Partial UNIQUE index on a claims table.** *(chosen)*
   SQLite enforces the atomicity. Slug is the natural key whether the
   source is markdown or tuple. Release/history come for free. The
   `roadmap_claims` table sits alongside `tuples` and `sessions` as
   another first-class coordination table — exactly the substrate
   Cartographer was created to defend.

## Consequences

### Positive

- Operators can pull from the roadmap with the same confidence they
  already have around `pd claim` for ports: someone-owns-this is a
  storage fact, not a hope.
- Two agents popping at the same instant get two different entries, by
  construction.
- `pd roadmap claims --mine` makes "what did I take from the pile?"
  trivially answerable, mirroring `pd sessions` for session state.
- Cartographer can subscribe to claim writes (tuple-like subscription
  in a follow-up) and react: e.g., auto-promote a popped `ideas-now`
  entry to `next-cut` so the trove order stays clean.

### Negative

- Adds another first-class table. `lib/db.ts` grows; migrations need to
  account for it.
- Claims drift if operators forget to `release` after abandoning work.
  Mitigation: claims have no TTL today, but `pd roadmap claims` will
  show ages, and a follow-up ADR can add a "stale claim sweeper"
  similar to dead-agent salvage if needed.
- Slug collisions across piles (same slug in `ideas-now` and
  `next-cut`) are treated as one logical thing. If two different
  entries genuinely share a slug, only one can be claimed at a time.
  This is intentional — slug duplication should be fixed in
  Cartographer's curated files.

### Neutral

- The harvest flow for tuple-backed feedback is unchanged. Pop is a
  layer above harvest, not a replacement.
- ADR-0023 already names Cartographer as the roadmap actor; this ADR
  is the concrete enforcement primitive it gets to wield.

## Out of scope

- Auto-release on session end (claims survive session abandonment).
- Cross-daemon coordination.
- Priority scoring within a kind (FIFO by surfacing order for now).
- A web/FleetBar surface for the claims map (the data is there; the UI
  is a follow-up).
