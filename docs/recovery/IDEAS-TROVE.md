# Ideas Trove

Last updated: 2026-04-05

This is the organized trove for Port Daddy ideas during recovery. It preserves raw Spark and Spider output while grouping it into decision-ready clusters.

## How To Read This

- `Now`
  - ideas that should shape the current recovery sequence
- `Soon`
  - ideas that become timely once the current blocking plumbing ships
- `Later`
  - ideas worth preserving but not pulling into the active trunk yet

Raw source streams remain canonical evidence:

- `.spark/ideas/`
- `.spider/connections/`
- `.cartographer/status.md`

## Cluster 1: Cost, Observability, And Economic Guardrails

Why it matters:
- this is the most actionable backlog in the repo
- multiple modules already exist and just need wiring

Now:
- Observability ignition
  - first `counters.bump()` and `costTracker.record()` callsites
  - source: `.spark/ideas/spider-2026-04-05-observability-ignition.md`
- Cost-gated fleet spawning
  - per-project daily budget enforcement in fleet spawn path
  - source: `.spark/ideas/2026-04-05-cost-gated-fleet-spawning.md`
- Spawn counter and lifecycle instrumentation
  - multiple Spider runs depend on this data becoming real
  - sources include:
    - `.spark/ideas/spider-2026-04-05-spawn-counter-instrumentation.md`
    - `.spark/ideas/spider-2026-04-05-spawn-lifecycle-instrumentation.md`
    - `.spider/connections/2026-04-05-observability-era-connections.md`

Soon:
- Fleet UI live cost projection while editing YAML
  - source: `S8` in `.spider/connections/2026-04-05-observability-era-connections.md`
- Budget blackboard via tuple space for self-throttling agents
  - source: `S7` in `.spider/connections/2026-04-05-observability-era-connections.md`
- DORA-style and golden signal rollups from counters
  - source: `.spark/ideas/spider-2026-04-05-dora-metrics-from-counters.md`

Later:
- full Phase 2 credit system using live cost data as substrate

## Cluster 2: Briefings, Suggestibility, And Ambient Guidance

Why it matters:
- users need the daemon to feel alive and helpful, not just configured

Now:
- Operational tempo briefings
  - add spend/rate/weather to catch-up and arrival surfaces
  - source: `.spark/ideas/spider-2026-04-05-operational-tempo-briefings.md`
- Launch hints in GUI surfaces
  - sources:
    - `S64` in `.spider/connections/2026-04-05-seventh-wave-connections.md`
    - existing `launch-hints` endpoint
- Salvage and review surfaced as guided next actions
  - sources:
    - `.spark/ideas/spider-2026-03-31-salvage-inbox-briefing.md`
    - `.spark/ideas/spider-2026-04-05-review-protocol-via-inbox.md`

Soon:
- FleetBar as suggestion presenter
  - QA findings, Spark prompts, Spider links, documentarian deltas
- enriched briefings mixing narrative timeline with operational tempo

Later:
- richer approval and intervention flows once quality gates solidify

## Cluster 3: Fleet Control Plane, Inbox, And Review Protocols

Why it matters:
- this is where the user feels orchestration quality directly

Now:
- Preserve dense activity and channel visibility
  - driven by the control-plane recovery work already underway
- Review protocol via inbox
  - source: `.spark/ideas/spider-2026-04-05-review-protocol-via-inbox.md`
- make wake, trigger, DM, and channel causality inspectable

Soon:
- live feedback loop for YAML editing using counters and cost history
  - source: `S8` in `.spider/connections/2026-04-05-observability-era-connections.md`
- stronger sortie and DM panel semantics in `fleet-config-ui`

Later:
- deeper human review gates and explicit evaluator routing

## Cluster 4: Semantic Graph, Stigmergy, And Dormant Phase 1 Work

Why it matters:
- too much dormant code is waiting behind one missing table

Now:
- keep this cluster visible in planning so it does not silently rot
- preserve the graph-adjacent ideas while Track 5 is blocked

Soon:
- `graph_edges` migration
- graph-centric watch
- semantic synonym registry
- merge queue activation

Key sources:
- `docs/V4-UNIFIED-ROADMAP.md`
- `.cartographer/status.md`
- prior Spider connection runs around symbols, merge queue, and stigmergy

Later:
- janitor-style stigmergic merge automation once graph truth is stable

## Cluster 5: Workspace, Service, And Fleet Orchestration

Why it matters:
- Port Daddy should coordinate both services and agents cleanly

Soon:
- zero-config workspace fleet registration
  - source: `S60` in `.spider/connections/2026-04-05-seventh-wave-connections.md`
- service orchestration joined with fleet orchestration
  - source: `S65` in `.spider/connections/2026-04-05-seventh-wave-connections.md`
- better worktree and namespace automation
  - sources in `.spark/ideas/spider-2026-03-31-worktree-auto-namespace.md`

Later:
- tighter service dependency modeling inside fleet config

## Cluster 6: Repo, Docs, Skill Sync, And Distribution

Why it matters:
- recovery fails if the product improves but the repo stays confusing

Now:
- establish one roadmap and one ideas authority
- define one canonical skill source
- make app-surface keep/merge/retire decisions explicit

Soon:
- documentarian sync contract across README, skill, website, and manifest
- package the external-developer subset of the repo
- clarify signed binary release path after the repo shape stabilizes

Primary sources:
- `public/app-surgery.html`
- `.cartographer/status.md`
- `skills/port-daddy-cli/SKILL.md`

## Cluster 7: Mission Authoring, Sorties, And Guided Delegation

Why it matters:
- users need a clean path between "always-on fleet" and "raw spawn"
- Port Daddy should let distracted developers hand off a bounded mission and come back to a readable result

Now:
- turn `pd agent` into the safe one-shot wrapper that auto-does begin/spawn/done/salvage
- expose backend readiness, auth state, and sandbox-sensitive warnings before a sortie launches
- stop treating `SortiePanel` as a raw backend/model form

Soon:
- recipe-driven sorties for investigate, review, fix, and creative work
- mission state and event model for single-use multi-agent work
- prompt scaffolds and suggestion chips that teach users what to ask for

Later:
- saved sortie templates on disk
- approval-gated creative/prototype missions
- richer mission timelines and artifact views in FleetBar and fleet UI

Primary sources:
- `docs/recovery/PD-AGENT-SORTIE-PLAN.md`
- `docs/MULTI-ENTRY-STRATEGY.md`
- `fleet-config-ui/src/components/SortiePanel.tsx`

## Raw Source Preservation Policy

1. Do not delete Spark or Spider raw files because a summary doc exists.
2. When a new idea cluster appears, add it here with direct source references.
3. When an idea is shipped, move it from `Now` or `Soon` into the relevant roadmap or cleanup doc rather than deleting its lineage.
