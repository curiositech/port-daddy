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

### `cartographer-roadmap-progress-screen`

- status: `now`
- why it matters:
  - the FOMO-killer. Right now ideas land in IDEAS-TROVE.md /
    DOGFOOD-FEEDBACK.md / ROADMAP.md "Next Cuts" and feel buried —
    operator has to remember to open four files to know what's pending
  - cartographer already maintains all of this; what's missing is a
    single screen that surfaces it at a glance every dashboard open
- next cut:
  - add a "Roadmap Progress" panel to `public/index.html` (or a new
    dedicated page) showing in one view:
    `Next Cuts` (from `docs/ROADMAP.md`), open dogfood feedback (from
    `DOGFOOD-FEEDBACK.md`), curated trove `now` items, `CURRENT-WORK.md`,
    velocity (commits/day last 7d), and the top 3 closest-to-shipping +
    top 3 blocked items (Cartographer already computes these for
    `.cartographer/status.md`)
  - server-side: a `/cartographer/roadmap-progress` endpoint that
    parses the markdown sources and returns structured JSON, so the
    panel doesn't fetch raw markdown from the client
- provenance:
  - operator request 2026-04-26 ("Can cartographer have a screen of just
    roadmap progress showing backlog, bugs, future ideas, future define
    roadmap...?")

### `coordination-guard-extended-enforcement`

- status: `now`
- why it matters:
  - Coordination Guard already exists (`cli/commands/guard.ts`, modes
    `off|warn|enforce`) but only fires on `git pre-commit`. Agents can
    edit, run shell, and ship work without ever calling `pd begin`
    or claiming files
  - the `pd note`/`pd say` ambiguous-session error this week was caused
    by exactly this: I made edits without a session, so notes had no
    home
- next cut:
  - enable Guard for this repo by default (`.portdaddy/coordination-guard.json`
    with `enabled: true, mode: enforce`)
  - extend Guard to fire on additional surfaces: SessionStart hook
    (Claude Code `~/.claude/hooks/SessionStart`), PreToolUse hook on
    `Edit`/`Write` (require active claim), PreToolUse hook on `Bash`
    matching `git commit|git push` (already covered, but explicit)
  - first-run for a repo with `pd-fleet.yml`: auto-emit
    `.portdaddy/coordination-guard.json` with `enabled:true, mode:warn`
- provenance:
  - operator question 2026-04-26 ("We have 'Coordination Guard', by
    the way, is that the enforcement you want?") → yes, this is the
    right primitive; just extend its reach

### `crew-screen-roles-not-pids`

- status: `now`
- why it matters:
  - dashboard currently shows agents-by-PID. Operators think in *roles*:
    Cartographer / Spark / Spider / QA / Lookout / Navigator /
    Shipwright / Promotion Coordinator
  - cross-session continuity for a role gets lost when the underlying
    agent process changes
- next cut:
  - add a "Crew" panel to the dashboard showing each declared fleet
    role with: last-run timestamp, last-run cost, currently
    doing/idle, blocked-reason if blocked
  - read sources: `/fleet`, `/agents/:id/inbox/stats`, recent cost
    events from `/metrics/cost/recent`, and the new fleet-launchability
    fields just landed
  - first-class abstraction is *role*; agent process is the runtime
    detail you click in for
- provenance:
  - operator question 2026-04-26 ("These roles, like promotion
    coordinator, can they be visible at a high level on the first
    project screen?")

### `coordination-ticker-as-high-signal-feed`

- status: `now`
- why it matters:
  - `coordination:inconsistency` is already the right channel for
    cross-cutting findings, but it's hidden behind SSE subscription
  - operators want a live ticker where they can scan recent agent-to-
    agent signal at a glance
- next cut:
  - add a "Coordination" ticker panel to the dashboard subscribed to
    `coordination:inconsistency` via SSE
  - severity-color entries (warning / critical), with a one-line
    summary + click-through to the full payload
  - signal/noise hygiene: routine progress belongs in notes; ticker
    is for cross-slice contradictions only (already enforced by
    AGENTS.md guidance, but the panel should reinforce by showing a
    "this looks like progress, not a contradiction" hint when an
    agent posts something low-severity)
- provenance:
  - operator question 2026-04-26 ("The agent group chat being a
    high-signal ticker?")

### `quorum-driven-dynamic-launch`

- status: `now` (Phase 1: primitive); `backlog` (Phase 2: auto-spawn)
- why it matters:
  - difference between "fleet of cron jobs" and "actual swarm" is
    that swarms can decide *what they need* and *spawn it*
  - the primitives are mostly here (tuples, `pd actor`, `pd say
    --broadcast`, harbor-scoped voting) — what's missing is a
    composable quorum proposal/vote object
- next cut (Phase 1 — primitive):
  - new module `lib/quorum.ts`: tuple-backed proposals
    `['quorum:proposal', proposalId, { role, reason, threshold,
      proposedBy, expiresAt }]` and votes
    `['quorum:vote', proposalId, voterId, { stance, weight, at }]`
  - new endpoints: `POST /quorum/propose`, `POST /quorum/vote`,
    `GET /quorum/proposals`, `GET /quorum/proposals/:id`
  - CLI: `pd quorum propose`, `pd quorum vote`, `pd quorum list`
- next cut (Phase 2 — auto-spawn):
  - role registry of "spawnable on quorum" roles (Promotion
    Coordinator, Crisis Response, etc.) — declared in `pd-fleet.yml`
    under `spawnable_roles:`
  - daemon background tick: when a proposal hits threshold +
    `auto_spawn: true`, fleet daemon spawns the role through
    the regular spawn pipeline (telemetry policy, wallet, bond all
    apply)
- provenance:
  - operator question 2026-04-26 ("Can port-daddy launch these
    things dynamically when a quorum of agents agree on need?")

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
