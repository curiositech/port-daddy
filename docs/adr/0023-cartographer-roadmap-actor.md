# 0023. Cartographer Roadmap Actor

## Status

Proposed (2026-04-24). Builds on ADR-0022 durable actor souls and body leases.

## Context

Port Daddy has accumulated multiple truth surfaces:

- roadmaps and recovery ledgers
- ADRs and plans
- `.cartographer/status.md`
- session notes and handoffs
- tuples, graph edges, memory episodes, and file claims
- git commits, test results, and promotion attempts
- Fleet Control Center and FleetBar views

The current `cartographer` fleet agent is useful, but it is still a
commit-triggered documentation updater. It reads a fixed set of files and edits
Markdown. That is not enough for a repo where multiple actors, worktrees,
claims, locks, promotions, and crash-recovery artifacts are all active sources
of truth.

The operator needs one canonical owner for:

- what ideas exist
- what has landed
- what is in flight
- what is blocked or stale
- who is building what, where, and on which files or symbols
- which future work depends on current slices

## Decision

Promote Cartographer from a prompt-only fleet agent into a durable roadmap
actor and event-driven projection. The maritime actor name for this role is
**Navigator**; `cartographer` remains the compatibility fleet-agent name until
the actor runtime has durable souls.

Cartographer has a durable soul:

- stable identity: `port-daddy:cartographer`
- mailbox for roadmap/work-state events
- persistent read model of roadmap items, work slices, evidence, blockers, and
  document authority
- graph edges that connect ideas, documents, actors, sessions, claims, files,
  symbols, commits, tests, and promotions
- tuples for machine-readable state changes

Cartographer may still use LLM bodies for synthesis, but routine ingestion must
be deterministic. It should not spend tokens to rediscover facts that Port Daddy
already emitted as structured events.

## Initial Batch Step

The first Cartographer body run is a bootstrap reconciliation pass. It should
not blindly rewrite all documents. It should:

1. Inventory authority surfaces:
   - `README.md`, `AGENTS.md`, `CHANGELOG.md`
   - `docs/V4-UNIFIED-ROADMAP.md`
   - `docs/recovery/**`
   - `docs/plans/**`
   - `docs/adr/**`
   - `.cartographer/**`
   - `skills/port-daddy-cli/**`
   - `docs/openapi.yaml`
   - website docs and tutorial registries
2. Classify each document:
   - authoritative
   - active ledger
   - release surface
   - historical
   - quarantined research
   - generated artifact
   - stale or conflicting
3. Extract candidate work items:
   - explicit roadmap items
   - TODO/FIXME/NEXT/COMPLETE markers
   - ADR migration steps
   - recovery ledger bullets
   - operator notes that imply durable tasks
4. Extract evidence:
   - commits that mention or touch the item
   - tests/builds/typechecks linked to the slice
   - promotion attempts and blockers
   - sessions, notes, claims, locks, and touched files
5. Emit structured state before prose:
   - `roadmap:item`
   - `work:slice`
   - `evidence:test`
   - `evidence:commit`
   - `blocker`
   - `supersedes`
   - `depends_on`
   - `doc:authority`
6. Propose cleanup as small patches:
   - mark stale docs as historical or superseded
   - move active truth into canonical docs
   - remove duplicated status claims only when evidence proves the replacement
   - never rewrite the roadmap voice or erase operator intent

The batch pass produces a report first. Applying edits is a separate action.

## Event Model

After bootstrap, Cartographer updates from events:

- `git:committed`: update changed-doc and changed-code evidence
- `session.start`, `session.note`, `session.end`: update in-flight work slices
- `file.claim`, `file.release`: connect actors and sessions to files/symbols
- `lock.acquire`, `lock.release`: expose scarce-resource blockers
- `test.completed`, `build.completed`, `typecheck.completed`: attach evidence
- `promotion.attempted`, `promotion.blocked`, `promotion.completed`: track
  release truth
- `semantic:alias` and `semantic:resolution`: collapse terminology with review
  guardrails
- `memory:episode`: pull durable decisions, failures, and handoffs into the map

The event loop should use cooldown, dedupe, and backoff. LLM synthesis should
only trigger when deterministic projections cross a useful threshold:

- new commit batch
- stale active work
- conflicting document authority
- promotion window
- operator ask
- graph/tuple evidence that an idea has become blocked, landed, or superseded

## Maritime Actor Roster

The same actor model applies to the sibling systems. Canonical one-word actor
names are:

- Navigator: roadmap and recovery-map steward
- Coxswain: claim, lock, and stale-work arbiter
- Signalman: validation, test, build, and evidence recorder
- Harbormaster: promotion and release-readiness gatekeeper
- Sounder: semantic graph, terminology, and synonymy curator
- Lookout: docs, skill, API, and public-surface drift watcher
- Breaker: failure propagation and circuit-breaker watcher
- Caulker: robustness, leak, and repair-debt closer
- Quartermaster: cost, budget, backend, and resource governor

Each should have a durable soul, mailbox, projection state, leases for live
bodies, and clear authority boundaries. They are not all necessarily expensive
LLM agents. Most should be deterministic actors most of the time, with LLM
bodies attached only for synthesis, review, or ambiguous classification.

## Consequences

### Positive

- Roadmap truth becomes queryable instead of buried in Markdown drift.
- Repo agents can cooperate through structured tuples and graph edges.
- Promotion blockers and stale claims become visible as first-class map facts.
- LLM calls decrease because deterministic projectors handle routine updates.
- Future FleetBar and Fleet Control Center views can ask Cartographer for the
  current landscape instead of scraping every subsystem.

### Negative

- The first bootstrap pass will surface conflicting documents and may make the
  repo look messier before it looks cleaner.
- A durable read model adds schema and migration work.
- If Cartographer edits docs without evidence gates, it can become a new source
  of drift. The batch pass must separate report generation from patching.

### Neutral

- `.cartographer/status.md` remains a human-readable projection, not the source
  of truth.
- Existing `pd-fleet.yml` cartographer behavior can continue as compatibility
  while the durable actor read model is built.
- The first implementation can write tuples and graph edges before adding a new
  `cartographer_items` table.

## Open Questions

- Should bootstrap output live in SQLite immediately, or begin as
  `.cartographer/bootstrap-report.json` plus tuples?
- What retention policy should apply to abandoned ideas and superseded work
  slices?
- Which surfaces can Cartographer patch automatically, and which require human
  approval?
- Should promotion status become Navigator-owned or Harbormaster-owned with
  Navigator subscribing as a projection?
