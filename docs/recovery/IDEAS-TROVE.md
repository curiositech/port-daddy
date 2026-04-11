# Ideas Trove

Last updated: 2026-04-11

This is the canonical ideation index and curated backlog for Port Daddy.

On 2026-04-11, the active checkout reviewed the full Spark corpus under
`.spark/ideas/` (98 files) and collapsed it into a smaller set of real
backlog families. Raw Spark and Spider files still exist locally as
provenance, but they are not repo truth by default and they should not be
allowed to multiply duplicate backlog items forever.

## Authority And Status

- `CURRENT-WORK.md`
  - active execution queue
- `IDEAS-TROVE.md`
  - canonical ideation index, dedupe surface, and curated backlog
- `pd ideas list|search|show`
  - repo-local CLI surface over the canonical trove
  - `search` can also federate local `.spark/.spider` residue, live daemon notes/tuples, and random repo markdown
- raw `.spark/ideas/` and `.spider/connections/`
  - local provenance and research exhaust
  - useful as input, not authoritative backlog on their own

Status meanings used here:

- `now`
  - worth implementing in the immediate next slices
- `backlog`
  - valid and worth preserving, but not the very next cut
- `parked`
  - interesting, but too speculative, too coupled, or downstream of other work
- `merge`
  - duplicate family; do not mint new standalone backlog items for this again

## Immediate Implementation Candidates

These are the highest-signal ideas from the corpus and should shape the next
runtime cuts.

### `capability-discovery-dns-harbor`

- status: `now`
- why it matters:
  - turns existing DNS and harbor capability data into actual agent discovery
  - removes hard-coded peer naming from delegation paths
- next cut:
  - add query surface for capability-aware discovery
  - prove it against current DNS + harbor tables, not whitepaper aspiration
- provenance:
  - `.spark/ideas/spider-capability-discovery-dns-harbor.md`

### `fleet-run-journal`

- status: `now`
- why it matters:
  - the fleet currently forgets its own history on restart
  - this blocks real briefings, analytics, and `pd fleet history`
- next cut:
  - persist fleet run lifecycle into SQLite
  - surface recent runs through existing fleet routes and operator views
- provenance:
  - `.spark/ideas/spider-fleet-run-journal.md`
  - `.spark/ideas/2026-04-06-fleet-run-persistence.md`

### `forensic-context-windows`

- status: `now`
- why it matters:
  - Arbiter violations are currently facts without narrative
  - adding recent timeline context makes violations explain themselves
- next cut:
  - attach recent correlation timeline context to violation records
  - keep it cheap and synchronous enough for enforcement paths
- provenance:
  - `.spark/ideas/spider-forensic-context-windows.md`

### `ipc-disconnect-instant-salvage`

- status: `now`
- why it matters:
  - IPC disconnect is already a death signal
  - waiting 10-20 minutes for salvage and stale cleanup is operational waste
- next cut:
  - trigger immediate salvage on IPC disconnect
  - treat IPC activity as implicit heartbeat for connected agents
- provenance:
  - `.spark/ideas/2026-04-05-spider-ipc-disconnect-instant-salvage.md`
  - `.spark/ideas/spider-ipc-disconnect-instant-salvage-and-implicit-heartbeat.md`
  - `.spark/ideas/spider-2026-04-05-ipc-native-liveness.md`

### `tuple-driven-fleet`

- status: `now`
- why it matters:
  - this is the most direct path from “fleet” to actual swarm task routing
  - tuples provide durable work handoff semantics that pub/sub does not
- next cut:
  - add tuple-triggered fleet agents
  - then add IPC tuple fast path so the coordination path is not HTTP-bound
- provenance:
  - `.spark/ideas/spider-tuple-triggered-fleet-agents.md`
  - `.spark/ideas/spider-ipc-tuple-fast-path.md`

### Recommended First Two Builds

If only one or two of the above move immediately, the best first cuts are:

1. `ipc-disconnect-instant-salvage`
2. `forensic-context-windows`

Reason:

- both are small
- both improve operator truth immediately
- neither requires speculative product expansion
- both make future salvage/arbiter work more legible

## Secondary Backlog Families

These ideas are valid, but they should be treated as grouped workstreams
instead of separate backlog tickets every time Spark or Spider rediscovers
them.

### Cost, Forecasting, And Shipping Economics

- status: `backlog`
- core themes:
  - budget fences and spend visibility
  - cost forecasting before fleet launch
  - priced changelog entries and work receipts
  - DORA and other derived metrics once counters are real
- representative provenance:
  - `.spark/ideas/2026-04-05-fleet-cost-fence.md`
  - `.spark/ideas/2026-04-05-pd-cost-cli-command.md`
  - `.spark/ideas/spider-2026-04-06-fleet-cost-forecast.md`
  - `.spark/ideas/spider-2026-04-06-priced-changelog-drafts.md`
  - `.spark/ideas/spider-fleet-work-receipts.md`

### Briefings, Inbox, And Recovery Handoffs

- status: `backlog`
- core themes:
  - salvage briefings
  - review protocol via inbox
  - richer briefings mixing narrative + live state
  - code-anchored notes and session ledger concepts
- representative provenance:
  - `.spark/ideas/2026-03-29-salvage-inbox-briefing.md`
  - `.spark/ideas/spider-salvage-inbox-briefing.md`
  - `.spark/ideas/spider-2026-04-05-review-protocol-via-inbox.md`
  - `.spark/ideas/spider-2026-04-06-code-anchored-notes.md`
  - `.spark/ideas/2026-03-31-session-ledger.md`

### Pheromones, Autonomic Signals, And Adaptive Dispatch

- status: `backlog`
- core themes:
  - make pheromones observable and usable
  - auto-spray from activity, health, fleet, and Arbiter events
  - use pheromone heat to influence model escalation and spawn gating
- representative provenance:
  - `.spark/ideas/2026-03-27-pheromone-cli.md`
  - `.spark/ideas/2026-03-31-arbiter-autosprays-anomaly.md`
  - `.spark/ideas/spider-fleet-pheromone-autospray.md`
  - `.spark/ideas/spider-2026-04-07-health-pheromone-trail.md`
  - `.spark/ideas/spider-2026-04-07-pheromone-model-escalation.md`
  - `.spark/ideas/spider-2026-04-07-violation-instability-pheromone.md`

### Harbor, Identity, And Network Surfaces

- status: `backlog`
- core themes:
  - harbor-aware spawn inheritance
  - capability-aware discovery
  - network identity and teardown for fleet agents
  - worktree-aware semantic identity
- representative provenance:
  - `.spark/ideas/spider-2026-03-31-harbor-spawn-capability.md`
  - `.spark/ideas/spider-2026-03-31-harbor-spawn-inheritance.md`
  - `.spark/ideas/spider-capability-discovery-dns-harbor.md`
  - `.spark/ideas/spider-2026-04-07-fleet-agent-network-identity.md`
  - `.spark/ideas/spider-2026-03-31-worktree-auto-namespace.md`

### Graph, Merge, And Predictive Coordination

- status: `backlog`
- core themes:
  - graph bootstrap and symbol-aware state
  - merge lifecycle eventing
  - intent tuples for conflict prevention
  - territory classification and work estimation
- representative provenance:
  - `.spark/ideas/2026-04-07-graph-edges-bootstrap.md`
  - `.spark/ideas/spider-2026-04-06-intent-tuples-conflict-prevention.md`
  - `.spark/ideas/spider-2026-04-07-merge-event-bus.md`
  - `.spark/ideas/spider-2026-04-07-territory-classification.md`
  - `.spark/ideas/spider-2026-04-07-work-estimation.md`

### Operational Gates, Invariants, And Runtime Governance

- status: `backlog`
- core themes:
  - runtime operational health gates
  - backend readiness as ambient state
  - lock history and fairness
  - IPC capability checks and service negotiation
- representative provenance:
  - `.spark/ideas/spider-2026-04-07-operational-health-gate.md`
  - `.spark/ideas/spider-2026-04-07-operational-preflight-gate.md`
  - `.spark/ideas/spider-2026-04-07-backend-readiness-pheromones.md`
  - `.spark/ideas/spider-2026-04-07-ipc-capability-bitmask.md`
  - `.spark/ideas/spider-2026-04-07-auditable-lock-history.md`

## Duplicate Families To Collapse

These are the main duplicate or near-duplicate families in the current corpus.
New raw files should not mint new backlog items for these unless they introduce
materially new actuators or data sources.

- `salvage-briefing`
  - `2026-03-29-salvage-inbox-briefing`
  - `spider-2026-03-31-salvage-inbox-briefing`
  - `spider-salvage-inbox-briefing`
- `ipc-liveness-and-salvage`
  - `2026-04-05-spider-ipc-disconnect-instant-salvage`
  - `spider-ipc-disconnect-instant-salvage-and-implicit-heartbeat`
  - `spider-2026-04-05-ipc-native-liveness`
  - `spider-ipc-cascade-cleanup`
  - `spider-2026-04-05-crash-safe-lock-release`
- `fleet-history`
  - `2026-04-06-fleet-run-persistence`
  - `spider-fleet-run-journal`
- `health-to-pheromone`
  - `2026-04-06-spider-health-pheromone-gradual-degradation`
  - `spider-health-pheromone-autoobservability`
  - `spider-2026-04-07-health-pheromone-auto-observability`
  - `spider-2026-04-07-health-pheromone-trail`
- `dora-from-counters`
  - `spider-2026-04-05-dora-metrics-from-counters`
  - `spider-2026-04-06-dora-metrics-from-counters`
- `territory-classification`
  - `spider-2026-04-07-territorial-classification`
  - `spider-2026-04-07-territory-classification`
- `operational-health-gates`
  - `spider-2026-04-07-operational-health-gate`
  - `spider-2026-04-07-operational-preflight-gate`
  - `spider-2026-04-07-operational-spawn-gate`
- `fleet-agent-network-identity`
  - `spider-2026-04-07-fleet-agent-network-identity`
  - `spider-2026-04-07-fleet-agent-full-network-identity`

## Spark And Spider Rules

Spark and Spider should use this file as their first dedupe/index surface.

Before creating a new raw idea or connection file:

1. Read this file first.
2. If command execution is available, run `pd ideas list --json` and `pd ideas search <query> --include-raw --json`.
   Use `--sources` when you need to check notes, tuples, or markdown specifically.
3. Search this file for matching slugs, aliases, and representative filenames.
4. Search raw filenames in `.spark/ideas/` and `.spider/connections/`.
5. If the candidate is already represented here, do not mint a new standalone
   backlog concept.
6. Only emit a new idea if it introduces at least one of:
   - a new actuator
   - a new data source
   - a new API surface
   - a materially different operator payoff

If a run is only a refinement of an existing idea, prefer one of these labels:

- `EXTENDS: <slug>`
- `MERGE_INTO: <slug>`
- `DUPLICATE_OF: <slug>`

Do not rename an existing concept and pretend it is new.

Spider-specific output discipline:

- cap normal runs at 1-3 syllogisms, not 5-10
- each syllogism must name the canonical backlog item it extends or differs from
- if a run finds no real novelty, it should say so instead of forcing output

## Preservation Policy

1. Keep raw Spark and Spider files locally if they contain useful thinking.
2. Do not treat raw files as repo backlog authority on their own.
3. Promote real ideas here, then into `CURRENT-WORK.md` or code/tests when they
   become active work.
4. Prefer merging duplicate families over preserving infinite markdown lineage.
