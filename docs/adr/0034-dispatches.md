# 0034. Dispatches — Intent-to-PR in One Command

## Status

Draft (Q6.2 of the Path B actor-system rebuild plan; sister ADRs 0035–0038
plus an in-place amendment to 0022 are tracked alongside).

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
`082_actor_model.sql` which lands the actor and lease tables):

```sql
CREATE TABLE dispatches (
  id                  TEXT PRIMARY KEY,            -- d-<short-id>
  requested_by        TEXT NOT NULL,               -- actor_id or 'operator'
  target_actor_id     TEXT REFERENCES actors(id),  -- NULL = auto-route
  worker_actor_id     TEXT REFERENCES actors(id),  -- filled at claim
  reviewer_actor_id   TEXT REFERENCES actors(id),  -- NULL until reviewer chosen
  required_caps       TEXT NOT NULL DEFAULT '[]',  -- JSON capability tokens
  goal                TEXT NOT NULL,
  artifacts_in        TEXT NOT NULL DEFAULT '[]',  -- JSON paths/refs
  state               TEXT NOT NULL,               -- see state machine
  claimed_lease_id    TEXT REFERENCES body_leases(id),
  result_session_id   TEXT REFERENCES sessions(id),
  result_artifact     TEXT,                        -- usually a PR ref
  worktree_path       TEXT,                        -- absolute path under ~/coding/tmp
  branch              TEXT,
  merge_policy        TEXT NOT NULL DEFAULT 'review', -- 'auto' | 'review' | 'never'
  priority            INTEGER NOT NULL DEFAULT 0,
  deadline            INTEGER,                     -- unix ms; NULL = none
  parent_dispatch_id  TEXT REFERENCES dispatches(id),
  qa_verdict          TEXT,                        -- JSON QAVerdict; NULL until set
  cost_usd            REAL NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  routed_at           INTEGER,
  closed_at           INTEGER
);

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

The envelope itself reuses `lib/coordination-crypto.ts` (AES-256-GCM
with AD bound to `(dispatch_id, target_actor_id, generation, nonce)`).
No new crypto surface.

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
are recorded on the dispatch row. Teardown is atomic with dispatch
closure: `closed` and `failed` both trigger `git worktree remove
--force` and `git branch -D` of the dispatch branch *only after* the
PR has been merged or explicitly abandoned. The path lives under
`~/coding/tmp/` (per the user-level rule against `/tmp`).

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
needs a dispatch to start). The CLI accepts `--reviewer qa` in Phase B
and silently maps it to `--reviewer self` with a deprecation note until
B.5 enables it.

### Routing (Path B fix #3)

The default for the first ~50 dispatches is `--to <actor>` required.
Auto-routing via `mcp__windags__windags_skill_search` (see ADR-0038) is
behind a feature flag that flips on only after a labeled set of the
first ~50 dispatches shows ≥70% routing correctness. Until the gate
opens, dispatches without an explicit `--to` are rejected at submission
with a message naming the candidate actors plus their declared
`windags_skills`.

Routing has two stages once enabled:

1. **Stage 1 — Skill match via Windags.** Call
   `mcp__windags__windags_skill_search` with the goal as query.
   Intersect the ranked skills with each actor's declared
   `windags_skills` array; produce a ranked actor list.
2. **Stage 2 — Capability + availability filter.** Drop actors whose
   capability tokens don't satisfy `required_caps`. Drop actors with
   no live attached lease. Drop actors over their in-flight dispatch
   cap.

If Windags is unreachable, fall back to BM25 over actor mission strings
(via `lib/semantic-matcher.ts`) and log `routing_fallback_bm25`. **Never
fall back to keyword matching** — that violates the user-level NLP ban
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

Notifications fire on `review_ready` (or `human_review_ready` if a qa
gate ran first), `actor_dead_no_resurrect_within_2min`,
`budget_within_10pct_of_cap`, and `dispatch_rejected_by_qa`. Every
other state transition is silent — the operator can pull status when
they want it, but the system does not push. `pd quiet [duration]`
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
  leases — the durable identities a dispatch addresses.
- **0028**: actor / fleet-agent / session three layers — dispatches
  flow across all three.
- **0035** (draft): `pd-bosun` minimalist supervisor — keeps the
  daemon alive so dispatches can complete unattended (launchd + zsh
  for v1 per Path B fix #4).
- **0036** (draft): harbormaster — owns merges of dispatched work.
- **0037** (draft): the qa gate — Phase B.5 reviewer that the
  dispatch state machine waits on when `--reviewer qa` is enabled.
- **0038** (draft): routing via Windags skill search — the auto-router
  the telemetry gate eventually opens.

## Notes

- The dispatch ID format is `d-<8-char-base32>` for human-readable use
  in CLI and PR descriptions (`pd review d-a3f2b9c8 --accept`).
- `parent_dispatch_id` is what makes the qa-gate and conflict-resolve
  sub-dispatches composable without a separate table. The same column
  carries any future "fan-out" patterns.
- `cost_usd` is updated by the body backend (`lib/llm-backend-resolver.ts`)
  on each work increment; it is not the source of truth for billing,
  just for the budget cap check.
