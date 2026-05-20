# 0035. Dispatches — Intent-to-PR in One Command

## Status

Draft (Q6.2 of the Path B actor-system rebuild plan; sister ADRs 0036–0039
plus an in-place amendment to 0022 are tracked alongside).

Renumbered from 0034 after redteam pass: `0034-roadmap-claim-session-link.md`
already owns that slot. The ADR cluster repeats the existing 0028
collision pattern unless future ADRs are allocated against a single-writer
registry — see Phase A scope note in the plan.

## Context

The operator's recurring complaint about Port Daddy is that there is no
verb that takes a sentence-shaped goal ("fix the timeout bug in
`lib/spawner.ts`") and produces a reviewable PR without the human in the
loop for every intermediate step. Today the operator composes the result
by hand: `pd spawn` a worker, leave `pd note` breadcrumbs, poll `pd
status`, push a branch, open the PR, watch it, merge it. Each of those
steps is a useful primitive in isolation; together they are a chore.

The product the operator actually asked for, verbatim:

> pd sugar for asking the daemon to create a worktree, task an agent
> with a task, assigning another agent with assessment for completion
> (or self?), and then the urgency to complete and merge the PR as soon
> as they can.

That request is a single verb with three obligations and a clock:

1. Create a worktree off `origin/main`.
2. Route the work to a capable actor and start a body in that worktree.
3. Assign a reviewer (a different actor, or the operator) to assess the
   result and merge the resulting PR with whatever urgency was attached.

Today's stack has every piece except the verb that binds them: actors
(ADR-0028), bodies and leases (ADR-0022 once Phase A ships them), the
spawner (`lib/spawner.ts`), session notes, `gh` for PRs, the merge queue
that ADR-0036 will land. The dispatch is the shape of the request that
flows through all of them.

The cost of not having it is what the operator already lives with: every
worktree-and-PR loop is hand-rolled, no two are coordinated, and there
is no record-of-intent to look back at when the PR's diff has drifted
from the original ask.

## Decision

Introduce a first-class **dispatch** entity. A dispatch is an addressed,
durable record of "this actor should produce this artifact; that actor
(or the operator) should sign off; here is the urgency." The daemon owns
the state machine; the CLI, MCP, and HTTP surfaces all bind to the same
record. The operator-facing verb is `pd dispatch`.

### Data model

New table `dispatches` (migration `083_dispatches.sql`, sequenced after
`082_actor_model.sql` which lands the actor and lease tables; runner
guarantees each file runs in a single `BEGIN IMMEDIATE; ... COMMIT;`
transaction):

```sql
CREATE TABLE dispatches (
  id                  TEXT PRIMARY KEY,            -- d-<10-char-base32> (50 bits)
  requested_by        TEXT NOT NULL,               -- actor_id or 'operator'
  target_actor_id     TEXT REFERENCES actors(id),  -- NULL rejected at HTTP layer pre-gate
  worker_actor_id     TEXT REFERENCES actors(id),  -- filled at claim
  reviewer_actor_id   TEXT REFERENCES actors(id),  -- NULL until reviewer chosen
  required_caps       TEXT NOT NULL DEFAULT '[]',  -- JSON capability tokens
  goal                TEXT NOT NULL,
  artifacts_in        TEXT NOT NULL DEFAULT '[]',  -- JSON paths/refs
  state               TEXT NOT NULL,               -- see state machine
  teardown_state      TEXT NOT NULL DEFAULT 'pending',  -- forward-only reconciler
  claimed_lease_id    TEXT REFERENCES body_leases(id),
  result_session_id   TEXT REFERENCES sessions(id),
  result_artifact     TEXT,                        -- usually a PR ref
  worktree_path       TEXT,                        -- absolute path under ~/coding/tmp
  branch              TEXT,
  merge_policy        TEXT NOT NULL DEFAULT 'review', -- 'auto' | 'review' | 'never'
  max_lines           INTEGER NOT NULL DEFAULT 50, -- diff cap for merge_policy='auto'
  priority            INTEGER NOT NULL DEFAULT 0,
  deadline            INTEGER,                     -- unix ms; NULL = none
  parent_dispatch_id  TEXT REFERENCES dispatches(id),
  qa_verdict          TEXT,                        -- JSON QAVerdict; NULL until set
  budget_usd          REAL,                        -- cap, set at creation; NULL = no cap
  created_at          INTEGER NOT NULL,
  routed_at           INTEGER,
  closed_at           INTEGER
);

-- Per-dispatch cost is computed from body_leases (see ADR-0022 amendment),
-- not denormalized on dispatches. Retries attach new leases; multi-dispatch
-- bodies share one lease; querying SUM(cost_usd) FROM body_leases WHERE
-- dispatch_id = ? is the source of truth. `budget_usd` here is the cap,
-- not the running total.

CREATE INDEX idx_dispatches_state ON dispatches(state, created_at);
CREATE INDEX idx_dispatches_target ON dispatches(target_actor_id, state);
CREATE INDEX idx_dispatches_parent ON dispatches(parent_dispatch_id);
```

Replay defense for the encrypted envelope that addresses a dispatch to
an actor's body:

```sql
CREATE TABLE dispatch_nonces (
  nonce         TEXT PRIMARY KEY,
  dispatch_id   TEXT NOT NULL REFERENCES dispatches(id),
  expires_at    INTEGER NOT NULL
);
CREATE INDEX idx_dispatch_nonces_expiry ON dispatch_nonces(expires_at);
```

**Replay defense procedure** (the table alone is not the contract):

1. Sender generates `nonce = randomBytes(16)` and includes it in the
   envelope's associated data.
2. Receiver attempts `INSERT OR ABORT INTO dispatch_nonces(nonce,
   dispatch_id, expires_at = now() + lease_ttl)` **before** decrypt-verify.
3. On `ABORT` (PRIMARY KEY conflict), drop the envelope and log
   `replay_rejected{nonce, dispatch_id}`.
4. A daemon sweeper deletes `WHERE expires_at < now()` every 60s; rows are
   cheap and bounded by `(dispatches/hour × lease_ttl_hours)`.

**Crypto envelope is net-new surface, not a reuse of
`lib/coordination-crypto.ts`.** The existing module's AAD is bound to
`(fleet, project, round, ts)` and its keys are keyed by `(fleet, round)`,
loaded from macOS Keychain via `loadFleetKey`. The fleet/round model is
incompatible with the actor/generation model dispatches need:

- Per-actor key derivation (HKDF from a master, info string
  `dispatch/${actor_id}/${generation}`) — to be specified in a separate
  dispatch-crypto ADR before any code lands.
- New AAD shape `(dispatch_id, target_actor_id, generation, nonce)`.
- Lives at `lib/dispatch-crypto.ts` (new file in Phase B).

This ADR commits to the AAD shape and the nonce table; the key-tree
construction is deferred to the dispatch-crypto ADR so the crypto review
happens against a focused PR, not buried inside the dispatches state-
machine PR.

### State machine

```
pending ──route──► routed ──claim──► claimed ──work──► executing
                                                          │
                                                  mark_ready
                                                          ▼
                                                  review_ready
                                                          │
                          ┌─── (qa-gate, Phase B.5) ──────┤
                          ▼                                │
                  qa_passed | qa_failed                    │
                          │                                │
                          └─► human_review_ready ◄─────────┘
                                          │
                                  accept │ reject │ retry
                                          ▼
                                  human_approved
                                          │
                              handoff to harbormaster
                                          ▼
                                       closed
                                          ▲
                                  failed ─┘  (terminal on hard error)
```

Transitions are guarded by the Arbiter's `LEASE_VALID_FOR_ACTOR`
invariant (introduced in Phase A); only the claimed body can transition
its own dispatch through `executing → review_ready`.

### Worktree lifecycle

When a dispatch is routed the daemon creates
`~/coding/tmp/port-daddy-dispatch-<short-id>` via `git worktree add`,
branched from current `origin/main`. The worktree path and branch name
are recorded on the dispatch row. The path lives under `~/coding/tmp/`
(per the user-level rule against `/tmp`).

**Teardown is not atomic.** It spans four non-transactional systems —
the local filesystem (`git worktree remove`), git refs (`git branch -D`),
the GitHub API (`gh pr close`), and the SQLite dispatch row. No 2PC
exists across these. The previous draft of this ADR called teardown
"atomic"; that was wrong.

Instead, teardown is **forward-only, eventually reconciled**:

1. Add a `teardown_state` column to `dispatches` with the ordered enum
   `pending | pr_finalized | branch_deleted | worktree_removed | row_finalized`.
2. On `closed` or `failed`, the daemon advances `teardown_state` one
   step at a time via idempotent operations:
   - `pr_finalized`: ensure the PR is merged or closed (idempotent —
     `gh pr view --json state` first, only act on mismatch).
   - `branch_deleted`: `git branch -D` (idempotent — missing branch
     returns success in our wrapper).
   - `worktree_removed`: `git worktree remove --force` (idempotent
     similarly).
   - `row_finalized`: SET `closed_at = now()`, COMMIT.
3. A background sweeper runs every 30s: `SELECT * FROM dispatches
   WHERE state IN ('closed','failed') AND teardown_state != 'row_finalized'
   ORDER BY closed_at ASC LIMIT 10`. Retries the next step. Failures
   log and re-queue; no step is skipped.
4. Orphan worktree GC: if a path under `~/coding/tmp/port-daddy-dispatch-*`
   exists on disk but no dispatch row references it, delete after a 24h
   grace window. Surfaces a warning in `pd status` during the grace.

The ADR commits to "eventually reconciled, with a defined recovery
path." Do not call it atomic in marketing copy, CLI help, or anywhere
else; the word is reserved for things that actually are.

### Reviewer assignment (Path B fix #1)

The `--reviewer` flag selects who signs off when the worker marks
`review_ready`:

- `--reviewer self` (Phase B default): the operator reviews. The state
  machine collapses to `review_ready → human_review_ready` immediately;
  no qa sub-dispatch is created.
- `--reviewer qa` (target after Phase B.5): the daemon auto-creates a
  sub-dispatch addressed to the `qa` actor, with the original dispatch
  as `parent_dispatch_id`. The qa verdict is written into the parent's
  `qa_verdict` column; pass routes to `human_review_ready`, fail routes
  back to `pending` (with a 3-strike escalation to `human_review_ready`
  with `failed_qa_attempts: 3` so the operator can break the loop).
- `--reviewer <actor>` or `--reviewer qa,cartographer`: arbitrary actor
  set; all must pass.

The Phase B.5 gate is intentional: shipping the auto-qa step before
`qa` has been running as a long-lived body for a week creates a
bootstrap deadlock (every dispatch waits on a qa body that itself
needs a dispatch to start). **In Phase B the CLI rejects `--reviewer qa`
with a non-zero exit and a pointer to ADR-0038** — silent downgrade to
`--reviewer self` is a UX trap, because the operator's whole reason for
using `pd dispatch` is to walk away. Silent downgrade means they DO
walk away and discover later that no review ran. The hard reject is
consistent with the routing layer's hard reject for missing `--to`.

The flag accepts repetition, not comma-joined: `--reviewer qa
--reviewer cartographer` is legal; `--reviewer "qa,cartographer"` is
rejected with a message naming the repeat form. This mirrors the
existing `--files` fix (PR #79) so the operator's reflexes carry over.

### Routing (Path B fix #3)

The default for Phase B is `--to <actor>` required. Auto-routing via
`mcp__windags__windags_skill_search` (see ADR-0039) is behind a feature
flag with a quantitatively defined gate:

> Auto-routing enables when all three hold:
>
> 1. ≥100 dispatches have been labeled by the operator at `pd review`
>    time with one of `routed_correctly | wrong_actor | routing_irrelevant`.
> 2. Excluding `routing_irrelevant`, the **top-1** hit-rate is ≥70% with
>    a 95% Wilson lower bound ≥60% (at N=100 the Wilson interval pulls
>    the threshold honestly tight; at N=50 a 70% point estimate has a
>    95% CI of roughly ±13pp, which is theatre — that's why N≥100).
> 3. The labeled set spans ≥3 distinct actor types.

"Correctness" is defined as: the operator's would-have-chosen actor at
`pd review` time matches the router's top-1 pick. The same `pd review`
prompt captures the label.

Until the gate opens, `POST /dispatch` without `--to` is rejected at the
HTTP layer (422) before any row is written — the daemon does **not**
write a `routing_blocked` row and then sweep it. The CLI surfaces the
candidate actors (from `agents.skills` and recent `session_notes`) in
the error message so the operator's next attempt is informed.

Routing has two stages once the gate opens:

1. **Stage 1 — Skill match via Windags.** Call
   `mcp__windags__windags_skill_search` with the goal as query.
   Intersect the ranked skills with each actor's `agents.skills` array
   (the existing JSON column; the plan's earlier `windags_skills`
   framing was a phantom — `agents.skills` is the real column).
   Produce a ranked actor list.
2. **Stage 2 — Capability + availability filter.** Drop actors whose
   capability tokens don't satisfy `required_caps`. Drop actors with
   no live attached lease. Drop actors over their in-flight dispatch
   cap.

If Windags is unreachable, fall back to **MiniLM cosine similarity over
the actor profile string** `concat(purpose, skills, identity_context,
last-48h session_notes window capped at 500 notes)`, reusing the
embedder in `lib/shipwright/skill-index.ts`. Log
`routing_fallback_cosine`.

The previous draft of this ADR specified "BM25 over actor mission
strings via `lib/semantic-matcher.ts`." Both halves were wrong:
`semantic-matcher.ts` does not exist in the repo, and BM25 over the
~10 short actor profile strings is statistically degenerate (IDF
collapses on a corpus that small — every token has near-uniform
document frequency, so ranking degrades to keyword overlap with a
pretentious wrapper, which is exactly the NLP anti-pattern the
user-level CLAUDE.md bans). Cosine over a pre-trained embedding model
has no minimum-corpus-size threshold — the word statistics live in the
embedding's training corpus, not the ~10 actor strings. That's the
honest fix.

If MiniLM is also unavailable (model not yet downloaded, FS error),
refuse to auto-route and return 422. **Never** fall back to keyword
matching or substring search — that violates the user-level NLP ban
and would catastrophically misroute.

### Merge handoff (Path B fix #2)

When the operator accepts a dispatch (`pd review <id> --accept`), the
dispatch transitions to `human_approved` and is handed to
`harbormaster` (see ADR-0036). Harbormaster owns the merge queue **only
for dispatched work**; operator-authored PRs that did not originate
from a dispatch merge through the operator's normal workflow. This
narrowing means harbormaster's failure modes are scoped: a stuck merge
queue blocks new dispatches but does not block the operator from
shipping anything by hand.

The `merge_policy` column controls the handoff:

- `review` (default): always wait for `pd review --accept`.
- `auto`: only legal when the reviewer passed (`qa_passed` etc.) and
  the diff is under 50 lines. Skips the human-review step. Disabled by
  default; the operator opts in per-dispatch with `--merge auto`.
- `never`: the dispatch is informational; never merge. Used for
  redteam-review sub-dispatches whose only output is a verdict.

**Diff-counting contract for `auto`** (avoids ambiguity that broke
similar policies elsewhere): the check is `git diff --shortstat
origin/main...HEAD` parsed as `insertions + deletions ≤ 50`, EXCLUDING
any path matching `*.snap`, `*.lock`, `package-lock.json`,
`pnpm-lock.yaml`, `Cargo.lock`, `bun.lockb`. The operator can raise the
cap per-dispatch with `--merge auto --max-lines 200`. The default 50 is
the cap, not a recommendation; specs that "depend on judgement" rot.

### Surfaces

- **CLI**: `pd dispatch "<goal>" [--to <actor>] [--reviewer <actor|self>]
  [--urgency now|today|idle] [--merge auto|review|never]
  [--budget <usd>] [--deadline <when>] [--dry-run]` and `pd review <id>
  [--accept | --reject "<reason>" | --retry "<note>"]`.
- **HTTP**: `POST /dispatch`, `GET /dispatch/:id`, `POST
  /dispatch/:id/claim`, `POST /dispatch/:id/ready`, `POST
  /dispatch/:id/close`, `GET /dispatches?state=...`.
- **MCP**: tools `dispatch_work`, `claim_dispatch`, `close_dispatch`,
  `request_review`.
- **FleetBar**: review queue section in the popover; SF Symbol glyph
  changes when a dispatch enters `human_review_ready`. No emojis.

### Notification policy

Notifications fire on:

- `review_ready` (or `human_review_ready` if a qa gate ran first)
- `actor_dead_no_resurrect_within_2min`
- `budget_within_10pct_of_cap`
- `dispatch_rejected_by_qa`
- `dispatch_failed_terminal` — any transition into `failed`. The
  operator's reason for using `pd dispatch` is to walk away; silent
  terminal failure is exactly the case the operator must hear about.
- `dispatch_stuck_no_progress_30min` — claimed lease, zero new
  `session_notes` in 30 minutes, no `review_ready` transition. Catches
  workers that didn't trip the 2-minute heartbeat detector.

Every other state transition is silent — the operator can pull status
when they want it, but the system does not push. `pd quiet [duration]`
suppresses non-critical notifications.

## Consequences

### Positive

- One verb replaces the manual loop. The operator can walk away after
  `pd dispatch "<goal>"` and come back to a PR with a clear accept
  command.
- The dispatch row is durable record-of-intent: when a PR's diff drifts
  from the original goal, the goal string is right there on the
  dispatch.
- Sub-dispatches (qa-gate, conflict-resolution by worker after
  harbormaster fails a rebase) compose naturally without inventing new
  primitives.
- Routing telemetry (Path B fix #3) gives the system honest data about
  when auto-routing is trustworthy, rather than guessing.

### Negative

- A new state machine with eight states plus terminals is real
  surface area. Every guard transition needs a test; the Phase B
  integration test (`pd dispatch "fix typo" → routing → claim → PR →
  accept → merge`) is the contract.
- Worktree lifecycle is fiddly. Atomic teardown across `git worktree
  remove`, `git branch -D`, `gh pr close --delete-branch`, and the
  dispatch row update has to roll back cleanly on any step failure.
- Cyclic dispatch loops are possible (worker fails qa, retries, fails
  qa again). The 3-strike escalation rule is the only safety; if the
  operator ignores escalations, the loop continues until budget runs
  out.

### Neutral

- The dispatch surface adds three migration files and roughly 2000
  lines of TypeScript. It also deletes nothing — the existing `pd
  spawn`, `pd note`, and manual-PR paths remain valid; `pd dispatch`
  composes them.
- `--reviewer qa` accepting in Phase B but mapping to `self` is a
  deliberate UX continuity step. The flag does not change shape when
  B.5 lands; the behavior behind it does.

## Alternatives considered

1. **Ship `pd dispatch` as a shell alias over existing primitives.** A
   prototype was tried inline during planning; it cannot enforce the
   reviewer step (no record of who is supposed to assess) or the
   urgency clock (no deadline column), so it degrades to "spawn an
   agent and hope." Rejected.
2. **Skip the dispatch table; carry the same state on `sessions`.** The
   ADR-0028 three-layer model already says sessions are ephemeral
   bodies-of-work, not addressed requests. Reusing the table would
   conflate the two and break salvage continuity (a dispatch survives
   a body crash; a session does not). Rejected.
3. **Route every dispatch through Windags from day one.** The Path B
   adversarial review caught this: without a labeled corpus, the
   semantic router is faith-based. The telemetry gate (≥70%
   correctness on the first 50 labeled dispatches) is the cheapest
   honest answer. Adopted.

## Related ADRs

- **0022** (in-place amendment, Phase A): durable actor souls and body
  leases — the durable identities a dispatch addresses. Adds
  `body_leases.dispatch_id` for cost attribution.
- **0028**: actor / fleet-agent / session three layers — dispatches
  flow across all three.
- **0036** (draft): `pd-bosun` minimalist supervisor — keeps the
  daemon alive so dispatches can complete unattended (launchd + zsh
  for v1 per Path B fix #4).
- **0037** (draft): harbormaster — owns merges of dispatched work
  (narrowed scope per Path B fix #2).
- **0038** (draft): the qa gate — Phase B.5 reviewer that the
  dispatch state machine waits on when `--reviewer qa` is enabled.
- **0039** (draft): routing via Windags skill search — the auto-router
  the telemetry gate eventually opens.
- **dispatch-crypto ADR** (not yet numbered): per-actor HKDF key tree
  and AAD shape — separated from this ADR for focused crypto review.

## Notes

- The dispatch ID format is `d-<10-char-base32>` (50 bits, ~1.1 × 10¹⁵
  values). Birthday-bound 50% collision at ~37M rows; safe at any
  realistic single-operator throughput. Example: `d-a3f2b9c8x7`.
- `parent_dispatch_id` carries qa-gate and conflict-resolve sub-dispatch
  relationships **for the single-reviewer case**. Multi-reviewer
  configurations (e.g., `--reviewer qa --reviewer cartographer`) are
  expressed via a `dispatch_reviews` join table introduced in ADR-0038
  alongside the qa-gate; this ADR defers that schema so the dispatches
  table stays focused on the primary lifecycle.
- The state machine has eight live states (`pending`, `routed`,
  `claimed`, `executing`, `review_ready`, `human_review_ready`,
  `human_approved`, `closed`) plus `failed` terminal. They are not
  collapsible without losing safety guarantees: the Arbiter's
  `LEASE_VALID_FOR_ACTOR` invariant distinguishes `claimed` (lease
  attached but no work) from `executing` (lease attached, work in
  progress) so a body that crashes between claim and first note can be
  re-routed cleanly; `review_ready` vs `human_review_ready` differ in
  whether the qa-gate has signed off (rejecting human approval before
  qa is the whole point of Phase B.5). Future ADRs may revisit;
  collapsibility is not free.
- Migration runner contract: each migration file runs inside a single
  `BEGIN IMMEDIATE; ... COMMIT;` transaction (SQLite DDL is
  transactional). Migration 083 begins with `SELECT 1 FROM body_leases
  LIMIT 0;` as a guard so it fails fast if 082 didn't fully apply.
