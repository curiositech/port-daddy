# Ideas Trove

Last updated: 2026-05-16 18:45 UTC (Spark promotion — `orchestrator-decision-attribution` added to now-status immediate candidates as Phase 1.5 orchestrator observability unlocker; `symbol-staleness-merge-safety` deferred as specialization of `operator-hint-engine` via `EXTENDS:` marking. Fresh 2026-05-16 raw Spark/Spider exhaust: orchestrator-decision-attribution survives novelty gate (new instrumentation data source, new API surface, new dashboard/CLI actuator, distinct operator payoff); symbol-staleness-merge-safety marked for extension rather than standalone. Prior: 2026-05-15 16:46 UTC Cartographer mapping pass; 2026-05-14 13:47 UTC Extended Spark promotion.)

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
- fresh 2026-05-16 raw Spark/Spider exhaust
  - present on disk, but still awaiting Spark/Spider dedupe; do not promote directly from the raw drops
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
  - `.spark/ideas/2026-05-12-symbol-claim-isolation-validator.md`
  - `.spark/ideas/2026-05-12-orchestrator-plugin-lifecycle.md`
  - promoted `symbol-graph-visualization`, `incremental-symbol-index-refresh`, `operator-hint-engine`, `symbol-claim-isolation-validator`, and `orchestrator-plugin-lifecycle` as new backlog slugs and execution-wave now items

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

### `tuple-store-query-api`

- status: `now`
- why it matters:
  - Phase 3 fleet-health-scorecard (status: now) requires queue-depth metric; this provides safe queryable access to tuple-store visibility
  - aggregates tuple stats (total pending, by-type distribution, age), enabling predictive work-queue transparency without exposing raw tuples
  - distinct from daemon-introspection-api (daemon-level WAL/IPC/session stats) — this is *work-unit* queue visibility
- implementation sketch:
  - `lib/tuple-store-queries.ts` (~80 LOC): getTupleStats(), getPendingTuples(), getTupleDistribution() with timewindow buckets
  - `routes/tuples.ts` (~40 LOC): GET /tuples/stats, GET /tuples/pending, GET /tuples/distribution/:window
  - Dashboard panel (~60 LOC): queue depth with color coding, age distribution stacked bar, top 3 by-type counts, estimated backlog hours
  - ~20 test cases covering query accuracy, timewindow bucketing, edge cases (empty queue, stale tuples)
  - zero schema changes (uses existing tuples system)
- provenance:
  - uncurated 2026-05-14 Spark idea
  - distinct from daemon-introspection-api (which surfaces daemon health, not work-unit queue)
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 3: fleet visibility)

### `governance-coordination-hub`

- status: `now`
- why it matters:
  - three independent governance signal sources (S60 outcome disputes with dissent tracking, S61 liquidation warnings with hours-to-breach, S62 skills parliament votes) currently scattered across separate dashboard panels
  - operators making decisions need unified view: "Are there disputes? Running out of budget? Skills gated?" at a glance
  - distinct from fleet-health-scorecard (role-centric health) or coordination-ticker (alert-based) — this aggregates *governance state*
  - unblocks Phase 3 operator decision velocity by surfacing all governance context simultaneously
- implementation sketch:
  - `lib/governance-coordinator.ts` (~80 LOC): GovernanceSnapshot interface with outcome_disputes, liquidation_warnings, skill_governance nested structures
  - `routes/governance.ts` (~40 LOC): GET /governance/snapshot, GET /governance/disputes/:taskId, GET /governance/agent/:agentId/budget-status, GET /governance/skills/gated
  - Dashboard panel (~120 LOC): metric cards (total disputes, agents at risk, active votes), disputes table with voter count/dissent %, liquidation list with hours-to-breach color coding, active governance votes
  - ~15 test cases: aggregation correctness, decay handling, filtering, empty state graceful handling
  - zero schema changes (uses existing tuples, episodes, cost-tracker, pheromone)
- provenance:
  - uncurated 2026-05-14 Spark idea (promotes S60/S61/S62 Spider items to backlog)
  - integrates: outcome-dispute-resolution (S60), liquidation-threshold-prediction (S61), skills-parliament (S62)
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 3: visibility + governance)

### `phase-3-auto-remediation-executor`

- status: `now`
- why it matters:
  - governance-coordination-hub (visibility) and operator-hint-engine (hints) surface problems and suggest actions, but no system currently *executes* them
  - operators must manually pause roles, reschedule work, or escalate — response latency from hours (read email, decide, act) to seconds (auto-execute + notify) is blocked
  - closes the Phase 3 governance loop: visibility → insights → hints → **automatic response** with operator pre-approval gates
  - reduces toil, enables 24/7 response without always-on staff
- implementation sketch:
  - `lib/remediation-executor.ts` (~120 LOC): RemediationAuthorization interface with target/trigger/action/enabled fields; executeRemediations() checks active authorizations against governance state and executes matches
  - `routes/remediation.ts` (~50 LOC): POST /remediation/authorize (create playbook), GET /remediation/authorizations, POST /remediation/execute (daemon 30-sec call), PUT /remediation/authorizations/:id (enable/disable)
  - Dashboard panel (~60 LOC): list active/disabled remediations, enable/disable toggles, execution history (24h), one-click authorize form
  - ~20 test cases: trigger threshold matching, authorization enabled check, audit log generation, empty governance state graceful handling
  - zero schema breaks (uses existing remediation_authorizations table)
- provenance:
  - uncurated 2026-05-14 Spark idea
  - extends: governance-coordination-hub (reads from), operator-hint-engine (executes suggestions from), tuples (emits tuples), cost-tracker (liquidation signals), pheromone (harbor-health signals)
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 3: operational automation)

### `cost-aware-model-training-loop`

- status: `now`
- why it matters:
  - empirical-model-efficiency-routing (status: now) learns which model minimizes cost while maintaining success; operator-decision-journal (status: now) records all operator decisions
  - but: operator model-choice overrides are recorded but not fed back into efficiency recommendations; missing feedback loop
  - enables system to learn model preferences over time (e.g., "operator always overrides Haiku→Sonnet for analysis tasks, so bias Sonnet higher for that class")
  - completes cost-optimization feedback loop: cost-gated-spawning prevents overbudget → empirical-routing suggests model → operator decides → decision becomes training signal
- implementation sketch:
  - `lib/cost-tracker.ts` extension (~10 LOC): when canSpawn() false due to budget, call empirical-model-efficiency-routing.recommend(), if operator force-higher-cost-model, emit model-routing:override tuple
  - `lib/operator-decision-journal.ts` (~5 LOC): record override with metadata (task_class, original_model, forced_model, operator, reason)
  - Cartographer feedback harvest (~30 LOC): aggregate override patterns by task_class; if override_count/spawn_count > 0.10, emit INFO feedback suggesting higher baseline model tier for that task
  - tests (~15 LOC): override rate tracking, feedback emission, learned bias application
  - zero schema changes
- provenance:
  - uncurated 2026-05-14 Spark idea
  - extends: cost-gated-spawning, empirical-model-efficiency-routing, operator-decision-journal
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 2: cost optimization feedback)

### `skill-degradation-contagion-early-warning`

- status: `backlog` (valid extension of agent-skills-quality-gates, non-blocking)
- why it matters:
  - extends agent-skills-quality-gates (pre-spawn skill validation) with cross-harbor early-warning capability
  - when skill error rate spikes in harbor-a, system emits anomaly:skill-degradation tuple; if same skill degrades in harbor-b within 10min, emits cross-harbor-contagion signal
  - enables proactive decision-making in harbor-b operators before local failures occur
  - distinct from pre-spawn validation (which happens at spawn boundary); this is ambient cross-harbor signal sniffing
- implementation sketch:
  - `lib/skill-quality-tracker.ts` (~35 LOC): emit anomaly:skill-degradation when error_rate spike detected
  - `lib/ambient-anomaly-signaling.ts` extension (~25 LOC): subscribe to anomaly:skill-degradation with 10-min window counter, emit contagion if same skill in 2+ harbors
  - Cartographer feedback harvest (~15 LOC): emit CRITICAL feedback to block dependent work if contagion detected
  - Dashboard "Skill Health" panel (~40 LOC): render anomaly tuples as red banners with harbor metadata
  - ~12 test cases: single harbor degradation (no contagion), skill degrades harbor-a then harbor-b within 10min (trigger contagion), timeout past 10min then harbor-b (no contagion), timestamp precision, network partition handling
  - zero schema changes
- provenance:
  - uncurated 2026-05-14 Spark idea
  - extends: agent-skills-quality-gates (data source), ambient-anomaly-signaling (execution pattern), harbors
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 3: cross-harbor governance)

### `unified-spawn-risk-synthesis`

- status: `now` (Phase 4B preflight hardening, fills execution-gap in CURRENT-WORK.md)
- why it matters:
  - five independent spawn-gating items exist (cost-gated-spawning, agent-skills-quality-gates, symbol-claim-isolation-validator, empirical-model-efficiency-routing, cost-forecast-alert) but no synthesis
  - current preflight catches ~30% of spawn failures (backend readiness, budget); remaining ~70% fail during execution (skill degrades mid-task, symbol deleted by concurrent work, harbor capacity breached, learned model fails unexpectedly)
  - unified domain-weighted synthesis (cost 40%, skills 25%, dependencies 20%, harbor 10%, learning 5%) predicts cross-domain failures *before* spawn, preventing waste and churn
  - new API surface: POST /spawn/preflight with structured domain breakdown returning PASS/WARN/FAIL
- implementation sketch:
  - `lib/spawn-risk-synthesis.ts` (~120 LOC): SpawnRiskDomain and SpawnRiskAssessment interfaces; synthesizeSpawnRisk() aggregates five domain scores with weighted scoring
  - `routes/spawn.ts` addition (~30 LOC): POST /spawn/preflight returns 200 for PASS, 207 Multi-Status with assessment for FAIL, new POST /spawn/preflight-override logs to operator-decision-journal
  - Dashboard panel (~25 LOC): pending preflight assessments with domain breakdown, required override explanations, one-click override button
  - ~20 test cases: domain weight accuracy, synthesis correctness, PASS/WARN/FAIL boundary conditions, override recording
  - zero schema changes
- provenance:
  - uncurated 2026-05-14 Spark idea
  - synthesizes: cost-gated-spawning, agent-skills-quality-gates, symbol-claim-isolation-validator, empirical-model-efficiency-routing, cost-forecast-alert (all status: now)
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 4B: bounded execution)

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

### `symbol-claim-isolation-validator`

- status: `now`
- why it matters:
  - agents currently discover claim conflicts at merge time, wasting effort
  - Phase 1 semantic graph already knows which symbols are claimed by active sessions
  - this fills the gap: early-warning before an agent claims a symbol that another session owns
  - complements `graph-based-merge-conflict-predictor` (reactive) with proactive validation
- next cut:
  - new API `POST /graph/validate-claim-safety` returning isolation risk and conflicting claims
  - new CLI `pd graph validate-claim <symbol-path>` for pre-flight checks
  - ~120 LOC, zero schema changes, leverages Phase 1 graph
  - agents can query before `pd begin` to check symbol availability
  - dashboard integration: show "symbol claim health" when planning work
- provenance:
  - `.spark/ideas/2026-05-12-symbol-claim-isolation-validator.md`
  - fills gap identified in Phase 1 completion + Phase 4 merge-infrastructure lane
  - distinct from intent-tuples (speculative), merge-predictor (post-facto), graph-viz (visual)
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `orchestrator-plugin-lifecycle`

- status: `now`
- why it matters:
  - Phase 1 wired the orchestrator registry and default FIFO orchestrator, but users can't load custom orchestrators without forking the daemon
  - V4 thesis says "users bring private orchestrators with domain intelligence," but there's no surface for that yet
  - this unblocks domain-specific task assignment (e.g., "bind read-only tasks to Spark, writes to QA") without daemon rebuilds
- next cut:
  - new CLI `pd orchestrator load <path> | test | list | set-active`
  - new API `GET /orchestrator, POST /orchestrator/load, GET /orchestrator/test`
  - hot-load custom orchestrators from `.portdaddy/orchestrators/` with interface validation
  - ~180 LOC, zero schema changes, one-session achievable
  - test scenarios before activation, persist choice across daemon cycles
- provenance:
  - `.spark/ideas/2026-05-12-orchestrator-plugin-lifecycle.md`
  - explicit gap from V4-UNIFIED-ROADMAP.md section "Orchestrator plugins + Merge queue": "routes pending orchestrator plugin wire"
  - Phase 1 completion: registry wired; Phase 1.5: user-facing loader
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `orchestrator-decision-attribution`

- status: `now`
- why it matters:
  - `orchestrator-plugin-lifecycle` (Phase 1.5, now-status) lets users load custom orchestrators without forking the daemon, but once loaded there's zero visibility into orchestrator behavior
  - operators have no way to diagnose whether a custom orchestrator is working, what decisions it's making, or if performance has regressed
  - decision attribution surfaces orchestrator correctness and latency trends, enabling validation of custom routers
- implementation sketch:
  - `lib/orchestrator-stats.ts` (~50 LOC): aggregate stats from decision tuples (success rate, latency p50/p95/p99, error rate by task class)
  - `routes/orchestrator.ts` (~50 LOC): GET /orchestrator/:id/stats, GET /orchestrator/:id/decisions with filtering by outcome/latency/task class
  - `lib/orchestrator.ts` instrumentation (~40 LOC): emit attribution tuples on every decide() call with latencyMs, selectedAgent, confidence, context
  - Dashboard panel (~40 LOC): show active orchestrator, decision count, latency trends, error rate badge, by-task-class breakdown
  - CLI (~10 LOC): `pd orchestrator stats|decisions` with filtering
  - ~20 tests covering stats accuracy, filtering, edge cases (no decisions yet, all failed)
  - zero schema changes (uses existing tuple system + optional new orchestrator_decisions audit table)
  - one session (~220 LOC)
- operator payoff:
  - "Custom router made 0 decisions in 2 hours — looks like it crashed; dashboard shows error 100%"
  - "API tasks route at 80ms vs. finance at 320ms — suggests tuning the router's cost model"
  - "Custom orchestrator p95 latency is 50% higher than baseline FIFO — investigate performance regression"
- integration points:
  - Unblocks: orchestrator-plugin-lifecycle validation
  - Extends: daemon-introspection-api (health metrics), operator-hint-engine (can emit hints on orchestrator errors)
  - Enabled by: tuple-space (attribution tuples), operator-decision-journal (audit trail pattern)
  - Supports: empirical-model-efficiency-routing (can learn orchestrator + model combos), Phase 5 federated orchestration
- provenance:
  - `.spark/ideas/2026-05-16-orchestrator-decision-attribution.md`
  - new data source (orchestrator instrumentation), new API surface (/orchestrator/:id/{stats,decisions}), new actuator (dashboard + CLI)
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 1.5: orchestrator observability)

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

### `daemon-fleet-auto-recovery`

- status: `now`
- why it matters:
  - Phase 3 declarative fleet (complete, `.portdaddy/fleet.yaml`) only survives while the daemon runs
  - on daemon restart, operators must manually run `pd fleet up` — manual ceremony for what should be automatic
  - declaring `persistent: true` on a role *looks* like a promise, but the daemon doesn't enforce it automatically across restarts
  - completes the Phase 3 contract: declare once, daemon honors it across restarts and upgrades
- implementation sketch:
  - `lib/fleet-engine.ts` (~10 LOC): add `persistent: boolean` field to fleet role config (default: `true` for declared roles)
  - `server.ts` (~40 LOC): register `onDaemonStartup` hook that queries roles with `persistent=true` and re-spawns them with telemetry bypass
  - `routes/fleet.ts` (~25 LOC): `POST /fleet/redeploy-on-restart` for manual triggering (idempotent)
  - `cli/commands/fleet.ts` (~15 LOC): `pd fleet auto-recover` command
  - Dashboard badge (~20 LOC): show last daemon startup, recovered roles, success rate
  - Tests (~20 LOC): persistence flag logic, startup hook, idempotency
  - total: ~130 LOC, zero schema breaks, one-session achievable
- provenance:
  - `.spark/ideas/2026-05-13-daemon-fleet-auto-recovery.md`
- dependencies: **ZERO BLOCKERS** — orthogonal to Phase 3/4 work, immediately shippable
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 3: operational automation)

### `graph-integrity-auditor`

- status: `now`
- why it matters:
  - Phase 1 graph (`graph_edges` table with 6 indexes) is production-deployed and foundation for merge-conflict prediction, claim-isolation validation, and visualization
  - silent data corruption (orphaned edges, duplicates, cardinality mismatches, broken indexes) would silently degrade prediction accuracy and cause false negatives in safety checks
  - operators have no automated way to detect or repair corruption today; manual SQL queries and schema inspection required
  - blocks daily integrity audits, undermining confidence in downstream decisions that depend on graph quality
- implementation sketch:
  - `lib/graph-auditor.ts` (~100 LOC): validate `graph_edges` schema, detect orphaned edges, duplicates, cardinality issues, verify all 6 indexes exist and are populated
  - `routes/graph.ts` additions (~30 LOC): `GET /graph/audit` (last or run new), `POST /graph/audit` (run immediately), `POST /graph/audit/repair` (apply suggested repairs), `GET /graph/audit/schedule` (cron config)
  - `cli/commands/graph.ts` additions (~20 LOC): `pd graph audit`, `pd graph audit --repair`, `pd graph audit --json`
  - Dashboard panel (~50 LOC): last audit timestamp, severity badge, violations count, suggested repairs, daily audit toggle
  - Tests (~10 cases): corrupt and verify detection, repair idempotency, edge cases
  - total: ~260 LOC, zero schema changes, runs in <100ms on fresh graph
- provenance:
  - `.spark/ideas/2026-05-13-graph-integrity-auditor.md`
- dependencies: **ZERO BLOCKERS** — Phase 1 graph already complete and stable
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 1: health infrastructure)

### `agent-skills-quality-gates`

- status: `now` (Phase 1–2 immediately: registry + validation; Phase 3–4 follow-on)
- why it matters:
  - operators spawn agents for specific roles but have no quality assurance surface before spawning
  - no skills inventory, no skill trust chain, no skill performance tracking, no pre-spawn safety check
  - this blocks swarms from being confident in delegated work, skill version management, and cross-harbor skill sharing
  - directly supports Phase 2 spawning work (`quorum-driven-dynamic-launch`) by giving agents confidence they're equipped
- implementation sketch (Phase 1–2):
  - `lib/skills-registry.ts` (~80 LOC): load skills manifest, track skill ID, version, owner, quality scores (test coverage, latency p50/p95, error rate), maturity [alpha|beta|stable|deprecated], cost, timestamp
  - `lib/skill-quality-tracker.ts` (~80 LOC): hook cost/error logs, compute rolling metrics, emit `skill:quality-change` tuples at thresholds
  - `db/migrations/004_skills_registry.sql` (~40 LOC): `skills` table + `skill_quality_history` table for time-series
  - `routes/skills.ts` (~70 LOC): `GET /skills/list`, `GET /skills/:id/quality`, `POST /skills/validate?role&backend`, `POST /skills/validate-set`
  - `lib/spawn-skill-validator.ts` (~50 LOC): pre-spawn validation, check existence, quality thresholds, deprecation
  - `cli/commands/spawn.ts` changes (~30 LOC): add `--validate-skills` flag, call validator before spawn
  - Tests (~28 cases): registry CRUD, quality updates, policy enforcement, pre-spawn validation flow
  - Phase 1–2 total: ~450 LOC, one-session achievable, Phase 3–4 (dashboard panel + harbor governance) follow-on
- provenance:
  - `.spark/ideas/2026-05-13-agent-skills-quality-gates.md`
- dependencies: no blocking dependencies for Phase 1–2; Phase 4 (cross-harbor) requires Phase 5 network infrastructure
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 2.5: Quality & Trust bridge to Phase 3 visibility)

### `cost-forecast-alert`

- status: `now` (Phase 2 unlocker, unblocked by stale economist)
- why it matters:
  - Phase 2 cost-tracker landed but economist follow-up is stale (43 days); operators have historical spend visibility but no forward visibility
  - "you spent $45 so far" vs "you'll hit your $100 budget in 2h 15m" — no early warning exists, cost overruns surprise operators
  - unblocks budget-aware spawn decisions without waiting for full pricing function π
  - foundation for priced changelog entries and agent self-gating on cost signals
- implementation sketch:
  - `lib/cost-forecast.ts` (~80 LOC): query `cost_log` table, compute rolling hourly/5-min burn rate (EWMA), project to budget ceiling with ETA and confidence
  - `routes/cost.ts` (~60 LOC): `GET /cost/forecast?horizon=1h&budget=<usd>`, `GET /cost/forecast/alert?threshold=0.8` returning `{projected_spend, budget, eta, burn_rate, confidence}`
  - `lib/pheromone-auto-spray.ts` extension (~30 LOC): wire forecast into daemon heartbeat, spray `cost:approaching-limit` at 80% projected (agents sniff before spawn)
  - Dashboard (~40 LOC): spend history + projected trajectory + budget line, alert badge when ETA < 30min, live SSE update
  - CLI (~20 LOC): `pd cost forecast --budget 100 --horizon 2h`, `pd cost alert --threshold 0.9`
  - total: ~230 LOC, zero schema migrations, one-session achievable
- provenance:
  - `.spark/ideas/2026-05-13-cost-forecast-alert.md`
- dependencies: **ZERO BLOCKERS** — complements cost-tracker, doesn't require economist, doesn't block pricing work
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 2: forward cost visibility without π)

### `ipc-queue-saturation-promotion`

- status: `now` (Phase 4B backpressure, fills explicit gap in CURRENT-WORK.md)
- why it matters:
  - Phase 4 is active (Fastify ✅, Trie ✅, Binary IPC ✅) but HTTP-level backpressure (`ipc-disconnect-instant-salvage` handles drop, not saturation) is missing
  - CURRENT-WORK.md explicitly notes: "Phase 4B is in-progress but has no execution item in the 'now' queue"
  - under high-frequency agent triggers (git post-commit fleet dispatch, rapid spawn cycles), daemon IPC queue can saturate with no feedback loop
  - result: daemon becomes bottleneck instead of fleet adapting gracefully; no cascading failure prevention
- implementation sketch:
  - `lib/ipc-queue-tracker.ts` (~40 LOC): track queue depth and latency in IPC message handler, maintain rolling P50/P95/P99 buckets
  - `routes/daemon.ts` extension (~30 LOC): `GET /daemon-pressure` endpoint returning `{queue_depth, latency_p50, latency_p95, saturation_signal: 0.0–1.0}`
  - `lib/spawn-preflight.ts` (~50 LOC): check `/daemon-pressure` before claiming spawn; if saturation > 0.8, return `{escalate_shed_decision: true}`
  - `lib/orchestrator.ts` (~80 LOC): orchestrator receives shed recommendation, can defer spawn, queue it, or shed lower-priority work
  - Tests (~20 LOC): queue tracking, endpoint accuracy, preflight gating, orchestrator dispatch
  - total: ~220 LOC, zero schema changes, no external dependencies
- provenance:
  - `.spark/ideas/2026-05-13-ipc-queue-saturation-promotion.md`
- dependencies: **ZERO BLOCKERS** — pure value-add, no breaking changes
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 4B: HTTP-level backpressure)

### `cost-gated-spawning`

- status: `now` (Phase 2 unlocker, unblocked by stale economist)
- why it matters:
  - Phase 2 cost-tracker landed but binding spend enforcement is missing
  - operators can see historical spend but cannot prevent overruns at spawn time
  - declaring `role.budget = $50/month` looks like a promise, but daemon doesn't enforce it — cost surprises are still possible
  - unblocks budget-aware spawn decisions without requiring economist follow-up; enables static budgets now while π (dynamic pricing) lands later
- implementation sketch:
  - `lib/spend-budget.ts` (~40 LOC): tuple-backed budget registry, `setRoleBudget()`, `getSpentThisWindow()`, `getRemainingBudget()`
  - `routes/spawn.ts` addition (~60 LOC): `POST /spawn/budget-check` returning approved/rejected + reasoning + remaining headroom
  - `lib/spawner.ts` integration (~50 LOC): pre-spawn budget validation, throw if rejected, emit `coordination:inconsistency` for overrideable rejections
  - CLI commands (~20 LOC): `pd budget set <role> <limit>`, `pd budget show`, `pd budget approve-override <spawn-id>`
  - Dashboard widget (~10 LOC): per-role budget progress bars, monthly reset date
  - total: ~180 LOC, zero schema migrations, one-session achievable
- test cases: within-limit approved, at/over limit rejected, monthly reset, override logging, multi-role isolation, no-budget degradation
- provenance:
  - `.spark/ideas/2026-05-13-cost-gated-spawning.md`
- dependencies: **ZERO BLOCKERS** — complements cost-tracker, doesn't require economist, orthogonal to Phase 2/3/4 work
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 2: binding spend enforcement)

### `sandboxed-adversarial-test-harness`

- status: `now` (Phase 4E/4F unlocker, unblocks 43-day stall)
- why it matters:
  - Phase 4E/4F (adversarial testing + Windows IPC hardening) has been idle 43 days — design is complete but execution blocked
  - running chaos tests against a live daemon risks crashes and unrecoverable state
  - no safe isolation between test failures and running fleet
  - developers avoid adversarial tests locally because they might corrupt daemon state
  - result: adversarial tests remain unwritten, Phase 4E/4F stalled, hardening unvalidated
- implementation sketch:
  - `lib/test-sandbox.ts` (~60 LOC): `createTestDaemon()` spawning isolated subprocess, separate port, separate SQLite DB, timeout, auto-cleanup
  - `lib/adversarial-payloads.ts` (~80 LOC): chaos payload generators — malformed requests, concurrency chaos, resource bombs, IPC edge cases, state corruption
  - `lib/test-harness.ts` (~50 LOC): `runAdversarialSuite()` executing payloads, tracking crashes/hangs/assertions/resource peaks
  - CLI command (~20 LOC): `pd test adversarial [--payload] [--timeout] [--verbose]`, `pd test adversarial list`, `pd test adversarial <name>`
  - API surface (~10 LOC): `POST /test/adversarial/run`, `GET /test/adversarial/status/:id`
  - Dashboard widget (~30 LOC): "Resilience" panel showing last run timestamp, crash/hang counts, resource peaks, one-click "Run Suite"
  - total: ~250 LOC, zero schema changes, one-session achievable
- test cases: isolated spawn, graceful malformed handling, no race conditions under chaos, OOM/timeout not system crash, IPC resilience, daemon crash recovery, Windows edge cases
- provenance:
  - `.spark/ideas/2026-05-13-sandboxed-adversarial-test-harness.md`
- dependencies: **ZERO BLOCKERS** — uses existing spawn infrastructure, immediately shippable
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 4E/4F: Testing & Hardening)

### `operator-decision-journal`

- status: `now` (Phase 3 + Phase 2 governance)
- why it matters:
  - Port Daddy records *what happened* (cost-tracker logs spend, tuples coordinate work, anomaly signals flag broken state) but operators leave no trace of *why* or *who decided*
  - when a cost gate was bypassed, which operator approved it? When a role was paused, what reasoning? Forensics require manual git+chat history search
  - audit gap blocks compliance, prevents learning from decision patterns, makes governance non-traceable
  - quorum votes exist but live transiently in tuples; operator commands are CLI events with no persistent record
- implementation sketch:
  - `lib/operator-audit.ts` (~30 LOC): `recordDecision(actor, decisionType, context, outcome)` creating JSON record, storing via blob, writing metadata row to `audit_decisions` table
  - `routes/quorum.ts` integration (~15 LOC): after vote settlement, call `recordDecision()` with proposal + threshold + votes
  - `routes/spawn.ts` integration (~15 LOC): when operator approves cost override, record decision with role/cost/reason
  - `routes/fleet.ts` integration (~10 LOC): record role pause/resume decisions with metadata
  - Query endpoint (~40 LOC): `GET /audit/decisions?actor=<id>&type=<type>&from=<date>&to=<date>&outcome=<outcome>` with paginated results + blob retrieval
  - Dashboard panel (~20 LOC): recent approvals/rejections grouped by type + actor, click-through to full decision JSON
  - Tests (~15 LOC): recording correctness, blob storage/retrieval, query filters, timestamp accuracy
  - total: ~145 LOC, one new table `audit_decisions(id, blob_id, actor, decision_type, outcome, archived_at)`, one-session achievable
- test cases: decision recording, blob persistence, query filters, actor/timestamp accuracy, output format
- provenance:
  - `.spark/ideas/2026-05-13-operator-decision-journal.md`
- dependencies: **ZERO BLOCKERS** — uses existing blob storage, orthogonal to Phase 2/3/4
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 3: Visibility + Phase 2: Governance)

### `empirical-model-efficiency-routing`

- status: `now` (Phase 2 unlocker, cost optimization)
- why it matters:
  - Phase 0 cost-tracker already records per-spawn costs by model, tokens, role, project — we have thousands of prior tasks in each domain
  - current friction: operators manually choose Haiku/Sonnet/Opus at spawn time, no signal about which is most *efficient* for this task type
  - no optimization loop — successful role pairings aren't captured as reusable heuristics; cost optimization is left on the table
  - this closes the feedback loop: learn from empirical history, auto-select the model that minimizes cost while maintaining success rate
- implementation sketch:
  - `lib/cost-tracker.ts` addition (~40 LOC): `queryModelEfficiency(taskType, window='7d')` computing avg_cost, success_rate, efficiency_score = success_rate / (cost + baseline)
  - `routes/spawn.ts` addition (~30 LOC): `GET /spawn/model-efficiency/:task-type` returning ranked models with confidence thresholds (high: >100 samples, low: <10)
  - `lib/spawn-preflight.ts` integration (~35 LOC): check efficiency endpoint before spawn, pick top-ranked if no explicit model, log recommendation + confidence
  - Pheromone signaling (~30 LOC): spray `model-efficiency` signal on selected model with efficiency_score as strength
  - Dashboard (~40 LOC): spawn telemetry showing "Selected Sonnet (88% efficiency) over Haiku (72%) based on 423 prior tasks"
  - CLI (~20 LOC): `pd spawn --model auto` uses efficiency routing
  - Tests (~20 LOC): efficiency computation, ranking, confidence scoring
  - total: ~215 LOC, zero schema migrations, one-session achievable
- test cases: efficiency computation correctness, ranking accuracy, confidence thresholds, low-confidence fallback, pheromone signaling
- provenance:
  - `.spark/ideas/2026-05-13-empirical-model-efficiency-routing.md`
- dependencies: **ZERO BLOCKERS** — complements cost-tracker, doesn't require economist, orthogonal to Phase 2 work
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 2: Economy)

### `operator-manual-fleet-dispatch`

- status: `now` (Phase 3 dispatch operator surface)
- why it matters:
  - Phase 3 has comprehensive visibility (governance-coordination-hub, fleet-health-scorecard, daemon-introspection-api) and reactive automation (operator-hint-engine, phase-3-auto-remediation-executor)
  - but operators have NO way to *proactively* dispatch work units to specific agents before the system auto-routes them via tuple-driven-fleet
  - currently: system decides where work goes → operator reacts if it fails
  - proposed: operator can see pending work → intentionally route to specific agent/role/cost-tier → system executes
  - closes the Phase 3 operator toolkit: from reactive (hints, remediations) to deliberate (dispatch, then observe)
- implementation sketch:
  - `lib/operator-dispatch.ts` (~60 LOC): `canDispatch(tupleId, targetAgent)`, `recordDispatch(tupleId, targetAgent, reason)`, `queryPendingWork(filters)`
  - `routes/dispatch.ts` (~50 LOC): `GET /fleet/dispatch/pending`, `POST /fleet/dispatch/{tupleId}`, `GET /fleet/dispatch/history`
  - `operator_dispatch_log` table (idempotent schema): `tuple_id, target_agent, reason, timestamp, cost_override`
  - Dashboard "Dispatch Workbench" panel (~100 LOC): pending work units with queue position, suggested agents, dispatch form with role/agent picker and reason input, 24h history
  - Tuples integration: emit `['dispatch:routed-by-operator', { tupleId, operatorId, targetAgent, reason, timestamp }]` marker (1-week decay)
  - CLI: `pd fleet dispatch pending --format=json`, `pd fleet dispatch route <tupleId> --to <agent> --reason <text>`
  - ~15 test cases: dispatch validation, ledger recording, pending query filters, history accuracy
- test cases: canDispatch validation, dispatch recording, pending work filtering, history queries, operator-routed tuple markers, graceful fallback to auto-routing when operator doesn't intervene
- avoids duplication:
  - tuple-driven-fleet: system auto-routing (this is manual override)
  - operator-hint-engine: reactive suggestions (this is proactive action)
  - phase-3-auto-remediation-executor: auto-execute after problems (this prevents problems via intentional routing)
- provenance:
  - `.spark/ideas/2026-05-14-operator-manual-fleet-dispatch.md`
- dependencies: **ZERO BLOCKERS** — complements tuple-driven-fleet, governance-coordination-hub, operator-hint-engine. Works with existing tuple system
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (Phase 3: Fleet & Governance)

### `episodic-memory-query-surfaces`

- status: `now` (Phase 3B unimplemented, closes Phase 3 spec)
- why it matters:
  - Phase 3 spec (V4-UNIFIED-ROADMAP.md section 3B) explicitly declares Episodic Memory but daemon has zero routes, zero CLI commands, zero semantics today
  - operators and agents cannot access learned knowledge across sessions, blocking coaching use cases (Phase 6) and role continuity
  - semantic recall (embeddings-based fuzzy search) unblocks non-keyword-based discovery (follows CLAUDE.md ban on keyword NLP)
  - closes Phase 3 delivery: "Fleet & Memory" is 50% done (fleet shipped, memory unbuilt)
- implementation sketch:
  - `lib/episodic-memory.ts` (~80 LOC): memory CRUD, scoping by agent identity wildcards, TTL, encryption
  - `lib/memory-embeddings.ts` (~60 LOC): Ollama embeddings on store, cosine similarity on recall, graceful degradation if Ollama unavailable
  - `lib/memory-auto-summarize.ts` (~40 LOC): background summarization when episode count > threshold (configurable, default 500)
  - `routes/memory.ts` (~80 LOC): `POST /memory/store`, `GET /memory/recall?query=&limit=5&scope=`, `DELETE /memory/forget`, `GET /memory/episodes`
  - `cli/commands/memory.ts` (~40 LOC): `pd memory store`, `pd memory recall`, `pd memory forget`, `pd memory episodes`
  - Dashboard widget (~40 LOC): search interface, recent episodes, summarization status
  - `episodic_memory` + `memory_embeddings` tables (idempotent schema)
  - ~25 test cases: CRUD, scoping, embedding accuracy, summarization, TTL cleanup, encryption
  - zero breaking changes
- provenance:
  - V4-UNIFIED-ROADMAP.md Phase 3 section 3B (explicit spec, unimplemented 60+ days)
  - distinct from operator-decision-journal (audit trail vs. learning log)
  - distinct from fleet-run-journal (fleet history vs. agent knowledge)
  - unblocks Phase 6 coaching agent and cross-session continuity
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove` (completes 3B)

### Recommended First Two Builds

If only one or two of the above move immediately, the best first cuts are:

1. `incremental-symbol-index-refresh`
2. `symbol-graph-visualization`

Reason:

- both are small
- both keep Phase 1 coordination live and legible
- neither requires speculative product expansion
- incremental refresh keeps the graph-risk predictor current while the visual panel makes contention obvious

**For Phase 2–3 infrastructure**: prioritize `daemon-fleet-auto-recovery` (zero blockers, completes Phase 3), then `graph-integrity-auditor` (Phase 1 health), then Phase 1–2 slice of `agent-skills-quality-gates` (bridges to confident spawning).

**For Phase 2 forward motion**: ship `cost-forecast-alert` (unblocks budget-aware spawn decisions), then Phase 1–2 slice of `agent-skills-quality-gates` (skill validation before spawn).

**For Phase 4B resilience**: ship `ipc-queue-saturation-promotion` (fills backpressure gap, enables graceful degradation).

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
