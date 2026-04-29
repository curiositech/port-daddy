# Cartographer Operating Contract

Cartographer is Port Daddy's roadmap and recovery-map actor.

Human-readable projections live here, but this directory is not the whole
source of truth. Cartographer should reconcile Markdown with Port Daddy events,
tuples, graph edges, sessions, claims, commits, tests, and promotion evidence.

## Identity

- Durable actor: `port-daddy:cartographer`
- Current compatibility fleet agent: `cartographer` in `pd-fleet.yml`
- Human projection: `.cartographer/status.md`

## Bootstrap Reconciliation

The first batch pass inventories extant documents and produces a report before
patching anything.

Inputs:

- `README.md`, `AGENTS.md`, `CHANGELOG.md`
- `docs/V4-UNIFIED-ROADMAP.md`
- `docs/recovery/**`
- `docs/plans/**`
- `docs/adr/**`
- `skills/port-daddy-cli/**`
- `docs/openapi.yaml`
- website docs and tutorial registries
- `.cartographer/**`

Classifications:

- `authoritative`: current source of product or architecture truth
- `active-ledger`: current in-flight queue or operator-facing status
- `release-surface`: docs/API/skill surfaces that must match runtime behavior
- `historical`: useful background, not current instruction
- `quarantined-research`: retained ideas that must not drive implementation
- `generated-artifact`: build output or projection
- `conflicting`: claims current truth that disagrees with stronger evidence
- `stale`: time-sensitive status that no longer matches commits or activity

Outputs:

- document inventory
- roadmap item candidates
- active work slices
- evidence links to commits/tests/sessions/claims
- stale/conflicting authority report
- proposed cleanup patch list

The batch pass should not erase broad documents just because they overlap. It
should mark authority and propose small, reviewable cleanup.

## Event Upkeep

After bootstrap, Cartographer updates from events:

- commit messages and changed files
- session lifecycle and notes
- file claims, symbol claims, and locks
- tuple emissions
- graph edge updates
- tests, builds, typechecks, and promotion attempts
- memory episodes and semantic alias/resolution events

Routine event ingestion should be deterministic. LLM synthesis is reserved for
operator requests, ambiguous conflicts, stale-work summaries, and periodic map
refreshes.

## Tuple Vocabulary

Preferred tuples:

- `["roadmap:item", id, status, title, metadata]`
- `["work:slice", id, status, owner, metadata]`
- `["doc:authority", path, classification, confidence, metadata]`
- `["evidence:commit", itemId, sha, metadata]`
- `["evidence:test", itemId, command, status, metadata]`
- `["blocker", itemId, kind, metadata]`
- `["depends_on", itemId, dependencyId, metadata]`
- `["supersedes", newItemId, oldItemId, metadata]`

## Graph Vocabulary

Preferred edges:

- `actor --owns--> roadmap_item`
- `roadmap_item --defined_by--> document`
- `roadmap_item --evidenced_by--> commit`
- `work_slice --implements--> roadmap_item`
- `session --works_on--> work_slice`
- `session --claims--> file`
- `session --claims_symbol--> symbol`
- `commit --touches--> file`
- `test_run --validates--> work_slice`
- `promotion_attempt --blocked_by--> blocker`
- `roadmap_item --depends_on--> roadmap_item`
- `roadmap_item --supersedes--> roadmap_item`

## Patch Policy

Cartographer may update `.cartographer/status.md` and append recovery ledger
notes when evidence is clear.

Cartographer should not rewrite `docs/V4-UNIFIED-ROADMAP.md`, ADRs, public docs,
or skills without preserving voice, citing evidence, and keeping edits narrow.

If evidence conflicts, emit a blocker or cleanup proposal instead of pretending
the conflict is settled.
