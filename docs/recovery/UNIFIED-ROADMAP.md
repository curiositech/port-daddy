# Unified Recovery Roadmap

Last updated: 2026-05-13 23:24 UTC (Cartographer verification pass — Phase 1 closure, Phase 3 visibility, Phase 6 telos suggestion, the 2026-05-11 Spark promotion of `graph-based-merge-conflict-predictor` + `ambient-anomaly-signaling`, the 2026-05-12 Spark promotion of `symbol-graph-visualization`, `incremental-symbol-index-refresh`, `operator-hint-engine`, and `symbol-claim-isolation-validator`, the 2026-05-13 Spark promotion of `graph-integrity-auditor`, `daemon-fleet-auto-recovery`, `cost-forecast-alert`, `agent-skills-quality-gates`, and `ipc-queue-saturation-promotion`, plus the 2026-05-12 continuation passes (`857f225c`, `d017bc28`) and verification pass (`f0398b9a`))

This is the single execution-order roadmap for the active Port Daddy recovery and consolidation effort.

## Project Thesis

Port Daddy should feel like one coherent system:

- one daemon users understand
- one ambient native companion
- one rich web control plane
- one install path
- one documentation authority
- one repo shape that outside developers can navigate

## Current Decisions

- Stable preferred daemon port: `9876`, with runtime discovery required whenever that port is unavailable
- Native companion: `apps/FleetBar`
- Deep fleet control plane: `fleet-config-ui`
- Canonical Port Daddy skill doc: `skills/port-daddy-agent-skill/SKILL.md`
- Raw idea streams remain useful local inputs, but curated recovery docs are the authority: `.spark/ideas/`, `.spider/connections/`, `.cartographer/status.md`

The 2026-05-13 Spark promotion added `graph-integrity-auditor`,
`daemon-fleet-auto-recovery`, `cost-forecast-alert`,
`agent-skills-quality-gates`, and `ipc-queue-saturation-promotion` to the
curated queue; the raw files remain on disk as provenance.

The 2026-05-11 Spark promotion added `graph-based-merge-conflict-predictor` and
`ambient-anomaly-signaling` to the curated queue; the 2026-05-10 raw Spider
exhaust (`S41`/`S42`/`S43`) remains uncurated.

The 2026-05-12 Spark promotion added `symbol-graph-visualization` as the
Phase 1 visual operator slice.

The same 2026-05-12 Spark promotion added `incremental-symbol-index-refresh`
as the Phase 1 predictive coordination cut and `operator-hint-engine` as
the Phase 3 operator decision-velocity cut.

The same 2026-05-12 curation pass added `symbol-claim-isolation-validator`
as the Phase 1/4 claim-safety cut.

## Near-Term Release Cuts

### `3.8.3` — Fleet Runtime Safety And Legibility

Cut `3.8.3` when all of these are true:

- daemon startup on the canonical user port is stable and repeatable
- fleet backend/model selection is explicit, tiered, or visibly unresolved; no silent premium-default inheritance
- ordered fallback backends/models exist for fleet agents and failures are emitted as structured attempt data
- backend readiness/auth preflight exists for configured fleet runtimes
- sandbox/permission preflight exists for local socket, IPC, and port-claim operations
- cost/counter/observability endpoints are populated with real spawn data
- per-project fleet singleton enforcement is live across competing daemons

Do not hold `3.8.3` for:

- FleetBar polish beyond consuming the new readiness/cost signals
- broad `fleet-config-ui` visual rehydration
- `graph_edges`
- signed distribution work

### `3.8.4` — Human Surfaces And Recovery UX

Cut `3.8.4` when all of these are true:

- FleetBar is the default glanceable operator surface for daemon health, fleet warnings, and budget trouble
- `fleet-config-ui` regains dense activity, channel story, and suggestion affordances from the older HTML surfaces
- inbox wake, trigger causality, and recent fleet decisions are inspectable without reading logs
- onboarding/remediation guidance is visible in the UI and not buried in terminal-only output

Do not hold `3.8.4` for:

- `graph_edges` and graph-backed coordination
- broader economy/mechanism design work
- extra website polish not required for onboarding

## Track 1: Closed — Cost And Observability Foundation

Status:
- Closed on 2026-04-06 after `cost-tracker`, `counters`, and the `/metrics/*` observability surface were promoted together and wired into FleetBar plus the fleet control plane.

Why now:
- the code already exists
- it is tested and wired
- multiple Spark and Spider ideas depend on it
- FleetBar and fleet budgets are weaker until the data path is real

Immediate ships:
- commit and promote `cost-tracker`, `counters`, and `observability`
- wire first real instrumentation callsites
- expose live spend, rate, and budget status to FleetBar and fleet UI

Representative idea pressure:
- cost-gated fleet spawning
- observability ignition
- operational tempo briefings
- spawn lifecycle instrumentation

Done when:
- `/metrics/*` endpoints are populated with real data
- FleetBar cost surfaces show non-zero live values
- fleet budget gates can actually stop spawns

## Track 2: Finish FleetBar As The Ambient Information Layer

Why now:
- the menu bar is the right human bridge to an always-on daemon
- it should surface trouble, briefings, and suggestions without forcing a browser tab

Immediate ships:
- daemon health and error surfacing
- fleet config warnings
- cost warnings and budget exhaustion
- `cost-forecast-alert` so FleetBar can show projected budget trouble before the economist layer catches up
- native control window that shells the real `/fleet-ui/` surface instead of a second shadow dashboard
- QA/Spark/Spider/documentarian briefings
- suggestion cards for onboarding and remediation

Representative idea pressure:
- operational tempo briefings
- arbiter warning tinting
- launch hints in control surfaces

Done when:
- FleetBar is the default glanceable status surface
- operators can spot daemon, budget, and fleet issues without opening the terminal

## Track 3: Rehydrate The Rich Fleet Control Plane

Why now:
- the old HTML surfaces had product energy the newer React app lost
- users miss the activity density and story of "what just happened"

Immediate ships:
- preserve the main-screen activity rail
- keep real channel logs alive
- make Flow, YAML, inbox, and sortie surfaces deep-linkable from the native companion
- restore stronger story, causality, and suggestion affordances
- surface `daemon-introspection-api` as the shared health rollup for Crew and Scorecard
- surface `operator-hint-engine` as the synchronous "what to do next" hint layer on top of daemon introspection
- surface `symbol-graph-visualization` as the visual companion to graph-backed merge risk and Phase 1 contentions
- surface `fleet-health-scorecard` as the one-glance swarm health panel in the same fleet UI shell
- persist `fleet-run-journal` so role history survives restarts instead of disappearing with the process table
- surface `salvage-root-cause-classifier` in the Salvage panel so operators can see why agents failed, not just that they failed
- surface `ambient-anomaly-signaling` as the passive anomaly feed that powers the same control-plane shell
- `daemon-fleet-auto-recovery` so persistent fleet roles come back after daemon restarts without manual `pd fleet up` ceremony
- merge the best of `public/fleet-live.html` and `public/fleet-config.html` into `fleet-config-ui`
- turn `SortiePanel` into a mission workspace, not just a raw launch form

Representative idea pressure:
- launch hints in the fleet UI
- live feedback for YAML editing
- better inbox/channel/review protocols
- `PD-AGENT-SORTIE-PLAN.md`

Done when:
- the React control plane feels as alive as the old HTML surfaces
- a DM, trigger, or agent wake is inspectable in the UI

## Track 4: Make Fleet Execution Bounded And Legible

Why now:
- the fork-bomb incident already proved the product needs explicit boundaries
- editing agent topology without guardrails is not acceptable

Immediate ships:
- editable incoming and outgoing edges
- finite step bounds after each initiation
- explicit spawn ceilings and rate ceilings
- per-agent cooldown, dedupe, and exponential backoff
- actor-style mailboxes for projects/fleets/agents so repeated triggers collapse before they fan out
- per-project cost ceilings
- inspectable inbox and wake behavior
- per-project fleet leases so only one daemon owns a project fleet at a time
- next event sources: `file:saved`, `build:error`, `test:result`
- next declarative trigger primitives: `trigger: webhook:<event>` and `trigger: files:<glob>`
- preflight-backed single-use mission launches so `pd agent` and sorties show readiness, budget, and fallback choices before work starts
- `incremental-symbol-index-refresh` — keep graph conflict prediction current as files change instead of waiting for explicit graph queries
- `graph-based-merge-conflict-predictor` — predict graph-backed merge risk before git attempts a merge so repeated trigger storms do not turn into repeated conflict churn
- `symbol-claim-isolation-validator` — validate symbol ownership before a claim or lock is accepted so pre-flight work can stop contention before merge time
- `graph-integrity-auditor` — audit the graph substrate so silent corruption does not poison merge prediction or claim safety
- `agent-skills-quality-gates` — validate skill trust before spawn confidence is trusted
- `ipc-queue-saturation-promotion` — shed load before the IPC queue becomes the daemon bottleneck

Representative idea pressure:
- budget-gated fleet spawning
- review protocol via inbox
- phase-gated harbors
- durable circuit breakers
- `PD-AGENT-SORTIE-PLAN.md`

Done when:
- fleet behavior can be edited and reasoned about without hidden runaway paths
- repeated trigger storms no longer translate directly into repeated spawns

## Track 5: Unblock Phase 1 By Landing `graph_edges`

Why now:
- substantial dormant code is already waiting on this
- symbol index, merge queue, and orchestrator-adjacent work will keep drifting until the table exists

Status:
- closed on 2026-05-07 after `f265fcb5` landed the `graph_edges` migration/schema slice and `2ad20f32` reflected it in the roadmaps

What landed:
- the `graph_edges` migration landed
- it was wired into symbol indexing and merge orchestration
- graph-aware coordination started becoming real instead of archival
- after the current locks / tuples tranche, session/file claims can upgrade from line-range overlap to Tree-sitter symbol-backed identity where symbol data exists
- line spans remain only as fallback and display data, not the durable semantic authority for indexed code

Representative idea pressure:
- graph-centric watch
- stigmergic merging
- semantic synonym registry

Outcome:
- graph-backed coordination features can ship against one shared edge table
- symbolic claims, graph edges, memory attribution, and control-plane visualizations agree on what code region an agent actually owns

## Track 6: Consolidate Onboarding And Install Behind `pd setup`

Why now:
- the primitives exist but the user path is fragmented
- trial mode and installed mode need to be clearly separated

Immediate ships:
- ensure `pd setup` is the documented top-level path
- fold daemon, MCP, skill, FleetBar, and project init into one flow
- keep `pd start` as a lightweight try-it mode
- make `pd agent` the obvious "do the right Port Daddy coordination for me" delegation entry point

Done when:
- a new macOS user has one obvious command for the full experience
- trial and installed modes are both clear and intentional

## Track 7: Clean The Repo For Humans And Future Distribution

Why now:
- docs, skills, and app surfaces have drifted
- outside developers need a navigable subset before signed distribution work matters

Immediate ships:
- establish this recovery hub as canonical
- collapse duplicate documentation authorities
- define keep/merge/retire for apps and legacy surfaces
- define canonical skill ownership and sync expectations

Done when:
- the repo has one obvious center of gravity
- future signed binary/distribution work has a clean substrate

## Not Doing Right Now

- broad A2A or network federation work
- new parallel native app experiments
- more website polish unless it directly unlocks onboarding or distribution
- speculative economy features before observability and budget instrumentation are live

## Weekly Recovery Test

1. What is the one thread being shipped this week?
2. What uncommitted work is older than 48 hours?
3. Which Spark or Spider ideas became actionable because core plumbing landed?
4. Did stable `9876` remain the actual user-facing truth?
5. Did docs and skills stay in sync with behavior?
