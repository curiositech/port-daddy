# Port Daddy Roadmap Tool — Design for a Real Jira

**Status:** Proposal. **Origin:** operator directive — "design for me an easy/breezy
roadmap tool in pd-console. Make it intuitive and comprehensive, like a Jira. Project
view, Gantt, boards, dependencies, task details linking to owning agent/PRs/docs/skills/
instructions/sessions, transcripts... give things nice typeaheads powered by our search/
suggestibility/embeddings... Make search a first-class powerful part of port-daddy."

**What's already shipped, grounding this design in reality rather than a clean-slate
fantasy:** the dependency graph populator (PR #3591, `writePlanEdges` → `GET
/roadmap/board`), the honest Gantt (PR #3592, real `roadmap_items.estimate` instead of a
hardcoded `1`), snapshot-staleness detection (PR #3593, `pd doctor`), a duplicate-slug
cleanup + prevention fix (PR #3679, closed a real cross-harbor data-integrity bug), and
the pd-console Board pane (PR #3657, Jira-style status columns, visually iterated via the
CPU Block-raster capture). This document is the synthesis that was missing: the data
model, the search/embeddings layer, and the phased plan tying those pieces — and the
still-unbuilt views — into one coherent tool.

---

## The core insight: most of "Jira" already exists as infrastructure

The single biggest risk in this design is proposing new schema for things the daemon
already has. Two tables already do almost everything a Jira clone needs:

- **`roadmap_items`** (`lib/db.ts:504`) — already has `kind` (project/epic/story/task/
  subtask/bug/chore, ADR-0086), `priority` (1–5, orthogonal to workflow status),
  `assignee_id`, `description_md`, `started_at`/`due_at`/`estimate`, `status`
  (now/backlog/parked/merge/done), `dependencies_json`, `notes_json`, `harbor`.
- **`graph_edges`** (`lib/db.ts:479`, `lib/graph-edges.ts`) — already generic:
  `(scope, source_type, source_id, edge_type, target_type, target_id, weight, metadata)`
  with a unique index on the 6-tuple. This is not a roadmap-specific table — it's a
  general cross-entity link store, already used for other graph relationships in the
  daemon.

The "task details linking to owning agent/PRs/docs/skills/instructions/sessions,
transcripts" requirement in the original ask is **not a new feature to build — it's
rows to populate** in a table that already exists. A roadmap item linking to a PR is
`graph_edges(source_type='roadmap_item', source_id=<slug>, edge_type='implemented_by',
target_type='pr', target_id='3828')`. An agent linking to the item it's working is the
inverse edge. A skill a task depended on is `edge_type='used_skill'`. None of this needs
a new table, a new migration, or a new concept — it needs edge-writers at the points
where these relationships are already known (PR creation via `pd roadmap upsert`'s
`--as` agent-id, session-file-claims, skill-graft invocations) and a UI that reads them.

**This reframes the whole project.** The work is: (1) write edges at the moments this
repo's own coordination discipline already produces the information, (2) extend the
existing embeddings infrastructure to two more entity types, (3) build the views that
read both. Not: invent a data model from scratch.

---

## Part 1 — Data model: extend, don't invent

### 1a. Edge types to standardize (new convention, zero schema change)

`graph_edges.edge_type` is a free-text column — nothing enforces a vocabulary today. Define
and document a fixed set for roadmap linking, written into `lib/roadmap-edges.ts` (new,
thin, alongside the existing `lib/planner-edges.ts` which already writes `depends_on`
edges for the Gantt):

| edge_type | source_type | target_type | Written at |
|---|---|---|---|
| `depends_on` | roadmap_item | roadmap_item | Already exists (`lib/planner-edges.ts`) |
| `implemented_by` | roadmap_item | pr | `pd roadmap touch` when a PR references `Roadmap-Item:` (the trailer this repo's own `pr-requirements-guard`/`roadmap-link` CI checks already parse — the parser exists, it just doesn't write an edge yet) |
| `documented_by` | roadmap_item | doc | Manual `pd roadmap link` command (new, thin CLI verb), or auto-detected when a commit touching the item also touches `docs/` |
| `used_skill` | roadmap_item | skill | Written by `windags_skill_graft`/`skill-graft` invocations that already know which roadmap item they're serving (from the active session's sidequest/roadmap link) |
| `owned_by_session` | roadmap_item | session | Written at `pd begin`/`pd roadmap upsert --as` time — the agent-id is already captured, this just also writes the edge |
| `referenced_in_transcript` | roadmap_item | transcript | Written by the existing transcript-indexing pipeline (`lib/agent-harbor/transcript-search.ts`'s `indexPending()`) when it detects a roadmap slug mentioned in transcript text |
| `blocks` | roadmap_item | roadmap_item | Inverse of `depends_on`, derived not stored (a view, not a write) |
| `child_of` | roadmap_item | roadmap_item | Epic/story/task hierarchy, distinct from `depends_on` (hierarchy ≠ sequencing) |

The `child_of` distinction matters: today `kind` (epic/story/task) exists as a field but
nothing links a task to its parent epic — that relationship has no home yet. This is the
one genuinely new edge type in the whole design; everything else is "start writing edges
at points that already have the information."

### 1b. Embeddings: extend `semantic_terms`, don't build a parallel store

`lib/semantic-resolver.ts` already has a working, model-agnostic embedding cache
(`semantic_terms` table, `Xenova/all-MiniLM-L6-v2`, 384-dim, persisted as JSON in a TEXT
column, lazy-loaded with a filesystem cache under `~/.port-daddy/transformers-cache`).
This is the same infrastructure that already embeds skills. Extending it to roadmap
items, tasks, and agents means exactly what it meant for skills: **compute a canonical
text representation and feed it through the existing resolver** — no new model, no new
cache table, no new infra.

Canonical text per entity type:
- **roadmap_item**: `${kind}: ${slug}\n${summary_md}\n${description_md ?? ''}` — re-embed
  on `upsert`/`touch` (the same events that already bump `last_touched_at`).
- **session/agent**: the session's `purpose` string + its accumulated `pd note` bodies —
  re-embed on session end (`pd done`), not per-note (notes are frequent, session-end is
  bounded).
- **transcript**: already embedded — `transcript-search.ts` is the reference
  implementation this whole extension is copying.

### 1c. Search: the hybrid pattern already exists — apply it, don't reinvent it

`lib/agent-harbor/transcript-search.ts` is the gold-standard pattern in this codebase:
BM25 (Okapi, k1=1.2/b=0.75) + dense cosine, fused with Reciprocal Rank Fusion (k=60).
**`lib/ideas-search.ts` was found to be a policy violation during earlier grounding work**
— pure substring scoring, zero embedder calls, in direct violation of this repo's own
"no keyword-based NLP, ever" rule. Roadmap items currently have **no search at all.**

The prescription: a new `lib/roadmap-search.ts`, structurally identical to
`transcript-search.ts` (same BM25 constants, same RRF fusion, same tokenizer) but scoped
to `roadmap_items` + the `semantic_terms` rows from 1b. This is not a design decision to
debate — it's copying a pattern this repo has already validated in production, applied to
a table that currently has zero search coverage. `lib/ideas-search.ts` should be migrated
onto the same pattern in the same pass, since it's the other offender and fixing one
without the other leaves an inconsistency a future session will trip on.

**Typeaheads** (the "nice typeaheads powered by our search/suggestibility/embeddings" ask)
are a thin HTTP layer on top of this: `GET /roadmap/search?q=<partial>&type=item|agent|
skill|pr` returning top-k hybrid results, debounced client-side. No new ranking logic —
the same `roadmap-search.ts` function, called with partial query strings instead of full
ones (BM25 tolerates prefix-heavy short queries reasonably; the dense leg helps precisely
when the prefix is too short for lexical match to be confident).

---

## Part 2 — Views

### 2a. Already shipped
- **Board** (PR #3657) — Jira-style status columns (backlog/parked → now → merge → done),
  card detail panel. Currently has a placeholder for "linked agent/PR/docs/skills/
  sessions" — Part 1's edges are exactly what fills that placeholder in; no new UI
  concept needed, just a query against `graph_edges` where `source_id = selected_item`.
- **Gantt** (PRs #3591/#3592, `GET /roadmap/board`'s CPM output) — real dependency edges,
  real estimates. Missing: `started_at`/`due_at` are still unwired to the scheduler (noted
  as an explicit gap when #3592 shipped) — `lib/planner-schedule.ts`'s `schedule()` is a
  purely relative CPM engine with no absolute-date anchor. Closing this is a small,
  well-scoped follow-up (anchor the relative schedule to `started_at` where set, else to
  "now"), not part of this document's new-view scope.

### 2b. New: Project view
A grouped-by-`kind` rollup: epics at the top, their `child_of` descendants nested, status/
priority/assignee visible per row, collapsible. This is the one view that genuinely needs
the new `child_of` edge type from 1a — without it, "project view" degenerates into "board
view sorted differently," which isn't what a Jira user expects (they expect hierarchy).
Read-only to start; inline status/assignee edits are a v2 concern once the view proves
useful.

### 2c. New: task detail panel (pd-console + web)
The payoff view for Part 1's edges. One panel, four sections, each a query against
`graph_edges` filtered by `edge_type`:
- **Implementation** — linked PRs (`implemented_by`), their CI/merge state fetched live
  from `gh` (cached, not polled per-render).
- **Provenance** — owning session(s) (`owned_by_session`), the agents that touched it,
  linking through to `pd sessions`/transcript viewers that already exist in Beacon/
  FleetBar.
- **Knowledge** — docs (`documented_by`), skills used (`used_skill`) — this is where
  "instructions" from the original ask lives, since skills *are* this repo's instruction
  system.
- **Mentions** — transcript excerpts (`referenced_in_transcript`), truncated with a
  link-through to the full transcript viewer (Beacon already has one — don't build a
  second).

This panel is pure read/query composition over infrastructure that Part 1 makes real. It
is the single highest-leverage UI piece in this whole design because every other view
(Board, Gantt, Project) is a *list* of items; this is the only place an operator actually
answers "what happened here, who did it, and what does it touch" — which is the actual
Jira-replacement job, not the column-sorting.

### 2d. New: search-as-navigation
Not a separate "search page" — a command-palette-style overlay (⌘K-equivalent) available
from every view, backed by `lib/roadmap-search.ts` (1c) scoped across roadmap items,
sessions, skills, and transcripts simultaneously (one query, `RRF`-fused across entity
types, grouped by type in the results list). This is the literal implementation of "make
search a first-class powerful part of port-daddy" — not a feature bolted onto the roadmap
tool, but the roadmap tool's primary navigation surface, with the roadmap being the first
entity type it's wired to and the others (sessions/skills/transcripts) following the same
pattern once `roadmap-search.ts` proves out.

---

## Part 3 — Phased plan

| Phase | Scope | Depends on |
|---|---|---|
| 1 | `lib/roadmap-edges.ts` — write `implemented_by`/`owned_by_session` at the two points that already have the data (`pd roadmap touch`'s PR-trailer parse, `pd roadmap upsert --as`). No UI yet — just start accumulating real edges so later phases have data to render against. | Nothing — ships standalone this week |
| 2 | `lib/roadmap-search.ts` (copy `transcript-search.ts`'s pattern), embed roadmap items into `semantic_terms` on upsert/touch, migrate `lib/ideas-search.ts` onto the same pattern | Nothing — parallel to Phase 1 |
| 3 | Task detail panel (2c) reading Phases 1–2's data, wired into the Board pane's existing placeholder | Phase 1 (needs edges to exist) |
| 4 | `documented_by`/`used_skill`/`referenced_in_transcript` edge-writers (the harder integrations — skill-graft hook, transcript-indexer hook) | Phase 1's pattern proven |
| 5 | `child_of` edge type + Project view (2b) | Phase 1's pattern proven; independent of 3–4 |
| 6 | Command-palette search-as-navigation (2d), typeaheads on the Board/Project views | Phase 2 |
| 7 | `started_at`/`due_at` → CPM anchor (closes the Gantt's known gap) | Independent — can slot in anywhere |

Phases 1 and 2 are the only true prerequisites (data must exist before it can be
displayed or searched); everything past that can run in whatever order matches available
attention. Nothing in this plan requires new schema, a new embedding model, or a new
search algorithm — the entire design is "point existing, validated infrastructure
(`graph_edges`, `semantic_terms`, the BM25+RRF hybrid pattern) at a table that hasn't used
it yet."
