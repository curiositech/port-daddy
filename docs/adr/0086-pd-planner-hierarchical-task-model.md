# 0086. PD Planner — a hierarchical task model (projects → DAGs of tasks) with a kernel-canonical scheduler

- Status: Proposed
- Date: 2026-06-19
- Deciders: Operator (Erich), Cartographer (navigator actor, ADR-0023)
- Related: ADR-0023 (navigator/cartographer), ADR-0033 (roadmap_items DB-of-record),
  ADR-0035 (roadmap popper / nightshift dispatch), ADR-0043 (ADR↔roadmap matrix),
  ADR-0050 (coordination rent), ADR-0054 (Rust kernel + koffi FFI + TS byte-parity fallback),
  ADR-0085 (Cartographer idea-intake grammar — writes *into* this model)

## Context

`roadmap_items` (ADR-0033) is a **flat list**: `slug`, `summary_md`, `status`
(`now`/`backlog`/`parked`/`merge`/`done`), a denormalized `dependencies_json` slug list, and
audit columns. The intake grammar (ADR-0085) commits ideas into it. But to plan real work the
operator wants what Jira gives: **projects containing a hierarchy of tasks, a dependency DAG
with a critical path / Gantt, priorities distinct from workflow status, descriptions,
assignments, and links to the commits / PRs / ADRs / documents each task produced.**

Most of the substrate already exists, just unwired:

- **`graph_edges`** (migration 003, `lib/graph-edges.ts`) — a general
  `(scope, source_type/id, edge_type, target_type/id, weight, metadata)` edge table with a
  uniqueness constraint. It is *exactly* a hierarchy + DAG + link store, and the Cartographer's
  tuple vocabulary already names the edge types (`depends_on`, `blocker`, `supersedes`,
  `parent_of`, `doc:authority`, `evidence:commit`) — but nothing persists them there yet.
- **`dispatches`** (migration 083) — execution-time assignment (`target/worker/reviewer_actor_id`)
  + a 10-state lifecycle + branch/PR/cost. One roadmap item ↔ one dispatch.
- **The Rust kernel** (`core/kernel`, ADR-0054), reached from TS via koffi
  (`lib/macaroon-ffi.ts`) with a TS byte-parity fallback, and the **Rust GPUI tool**
  (`core/pd-console`) that will render the Gantt.

Missing: hierarchy, priority, dates/estimates, a real edge store in use, the scheduler
(critical path / Gantt), and durable assignment on the item itself.

## Decision

### 1. Issue nodes — scalar fields on `roadmap_items`

A roadmap item becomes a Jira-like **issue node**. Add scalar columns (migration + the inline
`CREATE TABLE` / PRAGMA-guarded `ALTER` idiom in `lib/db.ts`):

| Column | Type | Meaning |
|--------|------|---------|
| `kind` | TEXT, CHECK in the ladder set, default `task` | issue type (see ladder) |
| `priority` | INTEGER 1–5, default 3 | urgency, **distinct from `status`** (1 = highest) |
| `assignee_id` | TEXT, nullable | durable plan-time owner (vs `dispatch.worker_actor_id`, the run-time claim) |
| `description_md` | TEXT, nullable | rich body (`summary_md` stays the title/short line) |
| `started_at` | INTEGER, nullable | actual start (ms) |
| `due_at` | INTEGER, nullable | target finish (ms) |
| `estimate` | INTEGER, nullable | abstract effort units = the scheduler's node duration |

`status` stays the workflow lane; `priority` is the new orthogonal urgency axis.

### 2. Fixed Jira ladder (hierarchy)

Hierarchy is a **fixed, validated ladder** — a child's parent kind is constrained:

| kind | rank | parent must be |
|------|------|----------------|
| `project` | 0 | (root — no parent) |
| `epic` | 1 | `project` |
| `story` (also `bug`, `chore` — standard issues) | 2 | `epic` |
| `task` | 3 | `story` / `bug` / `chore` |
| `subtask` | 4 | `task` |

The canonical spine is **Project → Epic → Story → Task → Subtask**; `bug` and `chore` are
standard issues at the story rank. Validation rejects parent edges that skip or invert ranks.

### 3. All relations + artifact links → `graph_edges` (retire `dependencies_json`)

Every relation becomes a `graph_edges` row, unifying structure and artifact links into one
queryable, bidirectional store:

| edge_type | source → target | meaning |
|-----------|-----------------|---------|
| `parent_of` | item → item | the Jira-ladder hierarchy |
| `depends_on` | item → item | blocking DAG edge (the critical path runs over these) |
| `supersedes` | item → item | replacement |
| `links` | item → `commit`/`pr`/`adr`/`doc` | related artifacts (commit SHA, PR #, ADR-NNNN, URL) in `metadata` |

`dependencies_json` is **migrated into `depends_on` edges and retired** (one source of truth).
This is the load-bearing change: the nightshift **popper** (`lib/roadmap-popper.ts`) reads
`dependencies_json` today and must be refactored to query `graph_edges` — see the matrix.

### 4. Scheduler — canonical in the Rust kernel, TS via koffi (ADR-0054 pattern)

The scheduler (topological sort + cycle detection + **Critical Path Method**: earliest/latest
start-finish, slack, critical path, makespan; plus the ladder validator) is **canonical in
`core/kernel`** and exposed over the C ABI (a `schedule_dag(json) -> json` cdylib export). It is
consumed by:

- **`core/pd-console` (Rust GPUI)** — natively, no round-trip, to render the Gantt + critical path;
- **the TS daemon** — via koffi (a `planner-schedule-ffi` binding, Phase 1d), with a **pure TS
  byte-parity fallback** (`lib/planner-schedule.ts`) when the binding is unavailable. A CI **parity gate**
  asserts Rust and TS produce identical output on shared fixtures.

The scheduler is pure compute (input: nodes with `estimate` + `depends_on` edges; output: per-node
schedule + critical path). A wrong schedule is a UX bug, not a security breach — so unlike the
macaroon kernel the *forcing* reason is the **native GPUI Gantt**, not a trust boundary; the TS
fallback is therefore a first-class peer, not a degraded mode.

### 5. Consumers

- **`idea_commit` (ADR-0085)** gains `kind` / `parent` / `priority` / `assignee` and writes the
  scalar fields + the `parent_of` / `depends_on` edges. The consult's `suggestedPlacement` can
  now also infer the parent epic and a priority.
- **`work_next`** becomes genuinely smart: the highest-priority **unblocked leaf on the critical
  path** matching the asking agent's identity.
- **The popper** pops by readiness computed from `graph_edges` + the schedule.

## Consequences

- One coherent planner: hierarchy + DAG + Gantt + priorities + assignment + artifact links, all
  durable and queryable; the Cartographer's tuple vocabulary finally backed by `graph_edges`.
- The GPUI tool renders a real Gantt/critical-path from kernel-native compute.
- **Cost / risk:** (a) refactoring the autonomous nightshift **popper** off `dependencies_json`
  is load-bearing — gate it behind tests + a data migration that backfills edges before the
  popper switches reads; (b) a new kernel cdylib export + koffi binding + TS fallback + parity
  gate is real surface (mitigated by copying the macaroon/harbor-card pattern exactly);
  (c) the fixed ladder adds validation that must reject malformed hierarchies cleanly.

## Implementation Matrix

| Phase | Slug | Status | Depends-on | Description |
|-------|------|--------|------------|-------------|
| 1a | planner-scheduler-kernel | now | — | Pure scheduler in `core/kernel` (topo + cycle detect + CPM + Jira-ladder validation) with cargo tests; a `schedule_dag(json)->json` cdylib export. |
| 1b | planner-scheduler-ts-parity | now | planner-scheduler-kernel | Pure TS byte-parity fallback `lib/planner-schedule.ts` + jest tests; the canonical reference for the parity gate. |
| 1c | planner-schema-columns | now | — | Migration: kind/priority/assignee_id/description_md/started_at/due_at/estimate on roadmap_items (CREATE-TABLE + inline ALTER + companion .sql), CHECK constraints, indexes. |
| 1d | planner-scheduler-ffi-bridge | backlog | planner-scheduler-kernel, planner-scheduler-ts-parity | koffi binding (`planner-schedule-ffi`, new) + build wiring + the CI parity gate (Rust output == TS fallback on shared fixtures). |
| 2 | planner-edges-graph-adoption | backlog | planner-schema-columns | Write parent_of/depends_on/supersedes/links to graph_edges; backfill dependencies_json → depends_on edges. |
| 3 | planner-popper-refactor | backlog | planner-edges-graph-adoption | Refactor the nightshift popper to compute readiness from graph_edges + the schedule; retire dependencies_json reads. |
| 4 | planner-intake-integration | backlog | planner-edges-graph-adoption | ADR-0085 idea_commit writes kind/parent/priority/assignee + edges; consult infers parent epic + priority. |
| 5 | planner-cli-mcp-surfaces | backlog | planner-edges-graph-adoption | `pd task …` CLI + MCP tools + SDK for the hierarchy/links/schedule, with parity. |
| 6 | planner-gantt-gpui | backlog | planner-scheduler-kernel, planner-edges-graph-adoption | pd-console renders the Gantt + critical path from kernel-native schedule; big ADHD-friendly controls. |
