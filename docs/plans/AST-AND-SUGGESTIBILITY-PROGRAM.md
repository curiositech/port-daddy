# AST and Suggestibility Program

Status: active execution plan

This document is the canonical execution plan for Port Daddy's AST-backed
coordination brain and ADR-0039/ADR-0092 suggestibility surfaces. It supersedes
the stale statuses in `docs/roadmap/roadmap.snapshot.json`; roadmap entries must
be reconciled to this plan as slices land.

## Outcome

Port Daddy continuously maintains a trustworthy cross-file semantic graph,
uses it to prevent or explain conflicting work before edits land, renders that
truth in the Rust GPUI console, and offers bounded, attributable suggestions
through the existing attention surface.

## Shipped baseline

- A0 intra-file call edges: shipped in #544.
- A1.1 cross-file import resolution: shipped in #576 and hardened in #593.
- A1.3 cross-file call resolution: shipped in #594.
- A2.1 blocking symbol-claim isolation: shipped in #983.
- A2.2 GPUI pre-write conflict wedge: shipped substantially in #728.
- A3.1 diff-to-symbol surface maps: shipped in #425.
- A3.2 unclaimed-edit overlap detection: shipped in #426.
- A3.3 multi-worktree surface scanning: shipped in #463.
- Suggestion persistence, lifecycle, overlap broker, attention delivery, and
  accept/decline paths are shipped. The semantic classifier and remaining
  candidate generators are not.

## Execution DAG

### Wave 0: truth repair

- Reconcile roadmap statuses with merged code and PR evidence.
- Collapse duplicate or superseded items instead of preserving obsolete work.
- Restore daemon health before live end-to-end acceptance testing.

### Wave 1: graph trust

#### A1.4 Incremental index refresh — critical path

Watch or receive dirty-file events, reparse only affected files, atomically
replace their symbols and dependencies, remove stale rows after deletes, and
publish refresh telemetry. Acceptance requires proof that one changed file does
not trigger a full-project reparse and that old edges disappear.

#### A1.5 Graph integrity auditor — parallel

Audit dangling target files/symbols, orphaned dependency rows, deleted-source
rows, duplicate edges, and aggregate-count drift. Produce structured findings
usable by doctor/health without mutating the index. Acceptance requires seeded
corruption fixtures and a clean-index zero-finding case.

#### A1.2 Reference edges — follows A1.4 integration

Extract non-call identifier and type uses as `references` edges. Cover imported
types, local type annotations, generic constraints, and ordinary identifier
reads without duplicating `calls`, `extends`, or `implements` edges.

#### Resolver completion

Add aliased imports, namespace imports, re-exports, barrel exports, and explicit
ambiguous-resolution diagnostics. Never silently invent an edge.

### Wave 2: operator enforcement and explanation

#### A2.3 Durable conflict advice

When claim acquisition is rejected or warned, emit an attributable suggestion
and attention item containing severity, holder/session, reason, symbol path,
dependency chain, and a safe next action such as parley or handoff. Do not add a
second conflict engine; consume `predictConflicts` output.

#### GPUI semantic graph overlay

Extend the existing Harbor Editor wedge into navigable “calls this”, “imports
this”, “referenced by”, and blast-radius views. All new GPUI work requires dark
and light screenshots plus a GIF or screen recording in the PR test plan.

### Wave 3: semantic suggestibility

#### B1.2 Topical classifier

Build bounded session-context classification over purpose, notes, claims, and
diff. Reuse `createLocalEmbedder()` and the shared MiniLM cache. Store topic,
embedding provenance, confidence, staleness, and source-session identity. No
remote embedding model and no lexical-only matcher.

#### B2.2 Remaining generators

Implement group-chat proposals, prior-art documents, and salvage candidates.
Keep claim-overlap as the deterministic floor. Each generator needs crafted
positive, negative, cooldown, mute, and attribution fixtures.

#### B3.2 Reactive, opt-in delivery

Add project-level opt-in and bounded periodic/reactive scans. Default remains
off until the operator enables it. Delivery continues through `pd attention`;
do not create a competing notification system.

### Wave 4: language breadth

Add Go and Rust grammars only after refresh and integrity gates are reliable.
Language adapters must emit the same normalized symbol/dependency contracts and
pass shared conformance fixtures.

## Parallel ownership

| Lane | Initial ownership | Write boundary | Depends on |
| --- | --- | --- | --- |
| Graph refresh | Codex AST Refresh | `lib/symbol-index.ts` and focused tests | shipped baseline |
| Integrity | Codex Graph Auditor | new integrity module and focused tests | current schema |
| Advice | Codex Conflict Advisor | claim/advice integration and tests | A2.1 |
| Classifier | Codex Suggestibility | new classifier module and tests | shared embedder |
| Program integration | Codex AST Steward | roadmap/docs, reviews, integration | all lanes |

No two workers edit the same implementation file in the same wave. Cross-lane
contract changes are proposed to the steward before editing shared surfaces.

## Pause-point checklist

### Before implementation

- Confirm the item is not already shipped under another name.
- Confirm an isolated worktree and narrow ownership boundary.
- Confirm graph and wire contracts remain backward-compatible or are explicitly
  supplanted in the same slice.
- Confirm no second embedder, matcher, conflict engine, or notification surface.
- Confirm tests include deletion, stale-state, and negative cases.

### Before PR

- Rebase on current `origin/main` and inspect the active-file diff for erosion.
- Run focused tests, typecheck, and relevant parity/compiled gates.
- Add one roadmap trailer and update this plan when scope changed.
- For GPUI changes, attach screenshots and motion evidence.
- Obtain adversarial review without waiting for Copilot.

### Before merge

- Resolve every actionable review finding with code or a recorded rejection.
- Confirm required checks on the current head and merge-group SHA.
- Confirm the daemon/live UI acceptance path when runtime code changed.
- Update roadmap status and leave a durable handoff.

## Definition of program completion

The program is complete when edits refresh the graph incrementally, graph
integrity is continuously auditable, imports/calls/references resolve across
supported files, blocking claims fail before writes, operators can inspect and
navigate the causal graph in GPUI, and suggestions are semantic, bounded,
attributable, opt-in, and actionable through attention.
