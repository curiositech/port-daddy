# Ideas Trove

Last updated: 2026-05-12 (Spark promotion pass — symbol-graph-visualization, incremental-symbol-index-refresh, and operator-hint-engine added to immediate candidates; Phase 1 operator visibility now has a direct visual slice, Phase 1 predictive coordination now stays live as files change, and Phase 3 decision velocity gains a hint layer; all pass novelty gate with new API surfaces, new data sources, and distinct operator payoffs)

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
- 2026-05-07 Spider extension pass
  - `.spider/connections/2026-05-07-connections.md`
  - `.spider/connections/2026-05-07-connections-extended.md`
  - `.spider/connections/2026-05-07-connections-s24-s26.md`
  - `.spider/connections/2026-05-07-connections-final.md`
  - `.spider/connections/2026-05-07-remaining-spaces.md`
  - extended the existing quorum / pheromone / graph / budget / incident families without minting a new standalone backlog slug from raw Spider exhaust
- 2026-05-08 Spark idea pass
  - `.spark/ideas/2026-05-08-fleet-health-scorecard.md`
  - `.spark/ideas/2026-05-08-telos-driven-model-selection.md`
  - `.spark/ideas/2026-05-08-tuple-namespace-hierarchies.md`
  - promoted `fleet-health-scorecard` as a new backlog slug and treated `tuple-namespace-hierarchies` as an extension of `tuple-driven-fleet`
- 2026-05-09 Spark idea pass
  - `.spark/ideas/2026-05-09-daemon-introspection-api.md`
  - `.spark/ideas/2026-05-09-ideas-trove-queryable-surface.md`
  - promoted `daemon-introspection-api` and `ideas-trove-queryable-surface` as new backlog slugs and execution-wave now items
- 2026-05-12 Spark idea pass
  - `.spark/ideas/2026-05-12-symbol-graph-visualization.md`
  - `.spark/ideas/2026-05-12-incremental-symbol-index-refresh.md`
  - `.spark/ideas/2026-05-11-operator-hint-engine.md`
  - promoted `symbol-graph-visualization`, `incremental-symbol-index-refresh`, and `operator-hint-engine` as new backlog slugs and execution-wave now items

Status meanings used here:

- `now`
  - worth implementing in the immediate next slices
- `backlog`
  - valid and worth preserving, but not the very next cut
- `parked`
  - interesting, but too speculative, too coupled, or downstream of other work
- `merge`
  - duplicate family; do not mint new standalone backlog items for this again

## Recently Shipped

### `cartographer-roadmap-progress-screen`

- status: `shipped`
- why it mattered:
  - the FOMO-killer is now real: the roadmap-progress screen and central feedback API landed in-tree, so operators no longer need to open four files to see what is pending
  - cartographer already maintains all of this; the missing piece was a single screen that surfaced it at a glance every dashboard open
- shipped via:
  - `7ba8d84`
  - `8fcf93e`
  - `4807cb5`
  - `bd4fc6f`
- provenance:
  - `.spark/feedback/2026-04-26-fomo-eradication-slice.md`

## Immediate Implementation Candidates

These are the highest-signal ideas from the corpus and should shape the next
runtime cuts.

### `daemon-introspection-api`

- status: `now`
- why it matters:
  - Operators lack a unified view of daemon health: SQLite WAL lag, IPC backlog, active session count, lock contention, role runtime stats
  - This blocks two "now"-queue dashboard items: `crew-screen-roles-not-pids` and `fleet-health-scorecard`, which both need aggregated role health (uptime, cost, status)
  - Unifying the introspection endpoint eliminates the need for dashboard code to stitch together fragments from `/agents`, `/fleet`, `/metrics/cost/recent`, `/sessions`
- implementation sketch:
  - `lib/daemon-introspection.ts` (~70 LOC): query WAL state, session/lock counts, IPC stats, fleet aggregation, Arbiter violations
  - `routes/daemon.ts` (~40 LOC): expose `GET /daemon/introspect` with optional filtering
  - ~10 test cases validating field accuracy and schema consistency
  - No database migrations, no schema changes
- provenance:
  - `.spark/ideas/2026-05-09-daemon-introspection-api.md`

### `ideas-trove-queryable-surface`

- status: `now`
- why it matters:
  - IDEAS-TROVE.md is canonical policy: "Spark and Spider are required to check it before minting new items"
  - But the trove is static markdown — not queryable. Spark/Spider have no programmatic way to check for duplicates
  - This blocks Spark/Spider deduplication enforcement (documented in AGENTS.md)
  - This is explicit infrastructure gap captured in CURRENT-WORK.md: "`pd ideas list|search|show` — repo-local CLI surface over the canonical trove"
- implementation sketch:
  - `lib/ideas-trove.ts` (~80 LOC): parse IDEAS-TROVE.md into structured `IdeaEntry[]` with slug, status, title, families, provenance
  - `cli/commands/ideas.ts` (~60 LOC): `pd ideas list [--status]`, `pd ideas search <keyword>`, `pd ideas show <slug>`
  - `routes/ideas.ts` (~40 LOC): HTTP endpoints for dashboard integration
  - ~15 test cases covering parsing, query, search, provenance accuracy
  - No database changes, no external dependencies
  - Deliverable: Spark/Spider call `pd ideas search "root cause"` and reliably check for duplicates before proposing
- provenance:
  - `.spark/ideas/2026-05-09-ideas-trove-queryable-surface.md`

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
  - `.spark/feedback/2026-04-26-coordination-guard-stale-hook-silent-fail.md`
  - `.spark/feedback/2026-04-28-coordination-guard-bypassed-by-cherry-pick.md`
  - `.spark/feedback/2026-04-28-claims-steamrolled-by-git-reset-hard.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

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
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `fleet-health-scorecard`

- status: `now`
- why it matters:
  - operators need one view that answers "is the swarm healthy?" without
    hopping between role status, cost, tuples, and violations
  - it extends the Phase 3 dashboard work into a real incident-response
    scorecard
- next cut:
  - add a Fleet Health Scorecard panel that aggregates role health,
    uptime, cost burn, queue depth, and recent violations
  - source it from fleet roles, heartbeat / restart data, recent cost
    metrics, tuple queue depth, and recent violations
  - keep the first slice observational only; no auto-remediation
- provenance:
  - `.spark/ideas/2026-05-08-fleet-health-scorecard.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

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
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `quorum-driven-dynamic-launch`

- status: `now` (Phase 2: auto-spawn); Phase 1 primitive shipped in `cea02e1`
- why it matters:
  - difference between "fleet of cron jobs" and "actual swarm" is
    that swarms can decide *what they need* and *spawn it*
  - the primitives are mostly here (tuples, `pd actor`, `pd say
    --broadcast`, harbor-scoped voting) — the proposal/vote object
    shipped in `cea02e1`; the remaining cut is auto-spawn routing
- next cut (Phase 1 — primitive, shipped in `cea02e1`):
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
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `telos-driven-model-selection`

- status: `now`
- why it matters:
  - the telos contract and shared backend resolver are already in tree, so the remaining friction is making spawn-time model choice explicit instead of manual
  - operators should not have to remember which roles are best served by Haiku, Sonnet, or Opus
- next cut:
  - surface a telos-driven model suggestion in `pd spawn`, FleetBar, and Fleet Control Center
  - keep the live model catalog and backend resolver as the source of truth, with explicit overrides
- provenance:
  - `.spark/ideas/2026-05-08-telos-driven-model-selection.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

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
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

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
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `salvage-root-cause-classifier`

- status: `now`
- why it matters:
  - Salvage records log *that* agents failed, not *why* they failed
  - Operators need to distinguish timeout (increase deadline) from OOM (reduce parallelism) from permission errors (audit IAM)
  - Complements `forensic-context-windows` (timeline context) with reason classification
- next cut:
  - New `root_cause_classify()` function in `lib/salvage.ts` with heuristic parsing (stderr, exit codes, signals)
  - New `/salvage/:id/root-cause` API endpoint returning enum: `timeout | oom | permission | network | logic_error | crash | unknown`
  - Dashboard badges + aggregate view in Salvage panel
  - ~80 LOC, one-session achievable
- provenance:
  - `.spark/ideas/2026-05-08-salvage-root-cause-classifier.md`
  - `.spark/ideas/2026-05-08-salvage-root-cause-promotion.md` (Spark meta-review)
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

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
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

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
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `tuple-driven-fleet`

- status: `now`
- why it matters:
  - this is the most direct path from “fleet” to actual swarm task routing
  - tuples provide durable work handoff semantics that pub/sub does not
- next cut:
  - add tuple-triggered fleet agents
  - then add IPC tuple fast path so the coordination path is not HTTP-bound
  - the raw `tuple-namespace-hierarchies` extension points at namespace-
    scoped queries and wildcard listeners for role-scoped work
- provenance:
  - `.spark/ideas/spider-tuple-triggered-fleet-agents.md`
  - `.spark/ideas/spider-ipc-tuple-fast-path.md`
  - `.spark/ideas/2026-05-08-tuple-namespace-hierarchies.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `graph-based-merge-conflict-predictor`

- status: `now`
- why it matters:
  - merge failures are painful: two agents edit the same symbol, git conflict ensues, operators debug manually
  - the semantic graph (Phase 1, complete) now tracks *what each session touches* at the symbol level
  - no pre-merge risk prediction exists yet — operators trial-and-error merge attempts
  - this enables safe automation: "auto-merge if risk < 0.1" becomes possible, and prevents merge failures before git attempts them
- implementation sketch:
  - `lib/graph-conflict-detector.ts` (~60 LOC): query semantic graph for overlapping symbol claims, score risk as overlap_count / max(a_claims, b_claims)
  - `routes/graph.ts` addition (~30 LOC): `POST /graph/predict-conflicts` returning `ConflictReport` with safe boolean, riskScore, and symbol-level conflict details
  - CLI command `pd graph predict <session-a> <session-b>` via HTTP endpoint
  - ~12 test cases: no conflicts, single/multiple overlaps, cross-file overlaps, nested hierarchy overlaps, edge cases (no claims, same symbol different claim types)
  - no schema changes; leverages existing graph_edges table
- provenance:
  - `.spark/ideas/2026-05-10-graph-based-merge-conflict-predictor.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 4: merge infrastructure)

### `ambient-anomaly-signaling`

- status: `now`
- why it matters:
  - transforms coordination from orchestrator-driven (active probing) to ambient (passive signal sniffing)
  - roles can make smart avoidance decisions autonomously without polling
  - enables faster mean-time-to-avoidance than salvage operator round-trip
  - prerequisite for downstream self-healing work (namespace cascading, market pricing)
- implementation sketch:
  - wire daemon-introspection-api (Phase 2 backlog, ~150 LOC, already in "now" queue) to coordination-judge every SSE tick (every 5-10 sec)
  - when judge detects anomaly (orphaned session >24h, broken claim, cost overrun, split-brain quorum, missing capability), spray pheromone signal on affected role(s): `anomaly:{kind}` with strength inversely proportional to age (fresh = 1.0, stale = decay over 10 min window)
  - roles sniff `anomaly:*` signals before spawning work; if sniff strength > 0.5, escalate to salvage instead of direct spawn
  - no schema changes; pheromone system already deployed
  - ~50 lines total (25 daemon + 15 preflight + 10 dashboard)
- provenance:
  - `.spark/ideas/2026-05-10-s41-ambient-anomaly-signaling.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 2: foundation for self-healing)

### `symbol-graph-visualization`

- status: `now`
- why it matters:
  - Phase 1 graph infrastructure exists (semantic graph, `graph_edges` table fully indexed) but is invisible to operators
  - `graph-based-merge-conflict-predictor` (also in "now" queue) calculates *numeric* risk; this provides *visual* risk so operators understand *why* a merge is risky
  - enables "symbol-level locking" downstream — operators spot contention visually and can declare claims proactively
  - instant swarm topology comprehension replaces JSON query interpretation
- implementation sketch:
  - `lib/graph-export.ts` (~80 LOC): query `graph_edges`, serialize to D3-ready format (nodes, links, metadata)
  - `routes/graph.ts` addition (~20 LOC): `GET /graph/export?scope=<project|session|all>` endpoint
  - `public/src/panels/SymbolGraph.tsx` (~120 LOC): D3 force-directed graph, zoom/pan, click-to-highlight-claims
  - dashboard integration (~20 LOC): add "Symbol Graph" panel, live SSE subscription to graph mutations
  - tests (~15 cases): export format, cardinality, filtering, recency decay
  - total: ~4 hours, one session achievable
- provenance:
  - `.spark/ideas/2026-05-12-symbol-graph-visualization.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 1: operator visibility)

### `incremental-symbol-index-refresh`

- status: `now` (HIGHEST PRIORITY — zero blockers, unlocks downstream)
- why it matters:
  - Phase 1 graph is complete; symbol index is currently static. Filesystem changes are invisible to the merge-conflict predictor until someone manually calls `POST /graph/predict-conflicts`
  - real-time filesystem watching + incremental tree-sitter re-indexing keeps the semantic graph *live* as code changes
  - transforms `graph-based-merge-conflict-predictor` from reactive ("predict only when asked") to predictive ("always current")
  - unlocks `ambient-anomaly-signaling` to detect graph staleness and emit `anomaly:outdated-claims` when agent knowledge diverges from reality
  - foundation for self-healing: agents detect their own claims are obsolete and escalate autonomously
- implementation sketch:
  - `lib/symbol-watcher.ts` (~60 LOC): fs.watch on project root, debounce within 200ms window, enqueue re-index jobs
  - `lib/incremental-index.ts` (~80 LOC): tree-sitter diff on changed files, update `graph_edges` with new symbol boundaries, handle race conditions (skip during active claims)
  - `routes/*` additions (~30 LOC): `GET /index/status`, `POST /index/watch|unwatch`
  - extend `daemon-introspection-api` to include index staleness (enables anomaly signals)
  - tests (~12 cases): file write triggers index, symbol boundary updates, race condition handling, cleanup
  - total: ~150 LOC, one session
- provenance:
  - `.spark/ideas/2026-05-12-incremental-symbol-index-refresh.md`
- dependencies: **ZERO BLOCKERS**. Phase 1 graph complete, fs.watch is stdlib. Immediately shippable.
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 1: foundation for predictive coordination)

### `operator-hint-engine`

- status: `now` (follow-on to `daemon-introspection-api`)
- why it matters:
  - `daemon-introspection-api` gives operators *what is happening* (WAL lag, stuck sessions, cost overruns, IPC queue depth)
  - this gives them *what to do about it* — closing the feedback loop from observation → decision
  - without hints, operators see raw anomalies; with hints, they see actionable suggestions ("Pause fleet 30s", "Check for deadlock", "Cost will exceed budget in 2h")
  - distinct from `ambient-anomaly-signaling` (role-to-role, async) — this is daemon-to-operator, synchronous, human-friendly
- implementation sketch:
  - `lib/operator-hints.ts` (~100 LOC): heuristics for anomalies (WAL >50MB → pause fleet; stuck >3 → check deadlock; cost >95% budget → pause non-critical; IPC >80% → CLI degraded; salvage spike → check health; lock contention >0.5/sec → reduce concurrency)
  - `routes/operator-hints.ts` (~60 LOC): `GET /daemon/hints` (current), `GET /daemon/hints/forecast` (trend-based projections in next N min)
  - dashboard: hint ticker in header with severity badges + escalation suggestions
  - tests (~8-10 cases): each heuristic branch
  - total: ~160 LOC, one session
- provenance:
  - `.spark/ideas/2026-05-11-operator-hint-engine.md`
- dependencies: blocks on `daemon-introspection-api` shipping (Phase 3, "now" queue, ~5 days out)
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 3: operator decision velocity)

### Recommended First Two Builds

If only one or two of the above move immediately, the best first cuts are:

1. `incremental-symbol-index-refresh`
2. `symbol-graph-visualization`

Reason:

- both are small
- both keep Phase 1 coordination live and legible
- neither requires speculative product expansion
- incremental refresh keeps the graph-risk predictor current while the visual panel makes contention obvious

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
  - `.spark/feedback/2026-04-26-claude-sdk-wired-final-gate-is-wallet.md`
  - `.spark/feedback/2026-04-26-pd-say-error-mismatch-and-policy-walls.md`
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
  - `.spark/feedback/2026-04-28-session-drops-on-cwd-reset.md`

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
  - `.spark/feedback/2026-04-26-cartographer-cadence-investigation.md`
  - `.spark/feedback/2026-04-27-stable-blocks-dogfooding-new-routes.md`
  - `.spark/ideas/spider-2026-04-07-ipc-capability-bitmask.md`
  - `.spark/ideas/spider-2026-04-07-auditable-lock-history.md`
  - `.spark/feedback/2026-04-26-cartographer-cadence-investigation.md`
  - `.spark/feedback/2026-04-27-stable-blocks-dogfooding-new-routes.md`

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
