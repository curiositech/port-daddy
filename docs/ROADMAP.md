# Port Daddy Roadmap & Future Ideas

**Last updated:** 2026-05-16 18:16 UTC (Cartographer mapping pass — source verification complete; curated now dogfood pair still `claim-preserving-git-safety` and `fleet-launchability-and-cadence`; 2 new Spark now items promoted into the wave on 2026-05-09: `daemon-introspection-api` and `ideas-trove-queryable-surface`; 2 more Spark now items promoted on 2026-05-11: `graph-based-merge-conflict-predictor` and `ambient-anomaly-signaling`; 2026-05-12 added `symbol-graph-visualization`, `incremental-symbol-index-refresh`, `operator-hint-engine`, `symbol-claim-isolation-validator`, and `orchestrator-plugin-lifecycle` as the Phase 1/3 support cuts; 2026-05-13 added `daemon-fleet-auto-recovery`, `graph-integrity-auditor`, `agent-skills-quality-gates`, `cost-forecast-alert`, and `ipc-queue-saturation-promotion` as the latest curated Spark batch; the 2026-05-13 extended promotion added `cost-gated-spawning`, `empirical-model-efficiency-routing`, `operator-decision-journal`, and `sandboxed-adversarial-test-harness` to the immediate queue; the 2026-05-14 promotion adds `tuple-store-query-api`, `governance-coordination-hub`, `phase-3-auto-remediation-executor`, `cost-aware-model-training-loop`, and `unified-spawn-risk-synthesis` to the curated wave while `skill-degradation-contagion-early-warning` stays backlog; the Phase 3 visibility cluster now spans `daemon-introspection-api`, `crew-screen-roles-not-pids`, `fleet-health-scorecard`, `coordination-ticker-as-high-signal-feed`, and `fleet-run-journal`; the 2026-05-14 curated trove also surfaced `operator-manual-fleet-dispatch` as the proactive Phase 3 dispatch workbench beside the `tuple-driven-fleet` lane; the 2026-05-14 `tuple-driven-fleet` routing cut adds a lower-priority Phase 3 dispatch lane beneath that cluster; raw 2026-05-10 Spider exhaust remains uncurated; the live tuple-backed feedback queue was empty (`open: 0`, `harvested: 11`), and the direct `pd feedback list --status open --json` shell path still hits `EPERM` on `~/.port-daddy/daemon.sock`; continuation passes `857f225c` and `d017bc28`, verification pass `f0398b9a`, extended promotion pass `bbbd19be`, and mapping pass `4e2a9f01` now head the branch)

This document captures the ambitious, industry-defining vision for Port Daddy as the definitive "Agentic OS" Control Plane. It outlines "things for later" and serves as a living synthesis of conceptual ideas.

## Inputs Into This Roadmap

Three live streams feed this document. None of them is roadmap truth on its
own — items are promoted up only after the curated index has them.

| Stream | Raw drop site | Curated index | Promoted into |
|---|---|---|---|
| Spark / Spider research | `.spark/ideas/`, `.spider/connections/` | `docs/recovery/IDEAS-TROVE.md` | "Next Cuts (From Curated Trove)" below |
| Agent dogfooding feedback | `.spark/feedback/` | `docs/recovery/DOGFOOD-FEEDBACK.md` | same — "Next Cuts" below |
| Active execution | (none) | `docs/recovery/CURRENT-WORK.md` | sections 1–7 of this doc |

Tooling: `pd ideas list|search|show` federates the trove plus live notes,
tuples, and repo markdown. Run it before minting new backlog items.

The dogfooding feedback channel is described in `CLAUDE.md` ("Dogfooding
Feedback Channel"). Every agent working in this repo is invited to drop a
file in `.spark/feedback/` whenever a Port Daddy primitive surprises them.
The **Cartographer** fleet agent (declared in `pd-fleet.yml`, triggered on
`git:committed`) owns the harvest into `DOGFOOD-FEEDBACK.md` and the
promotion of `now`-status entries into the section directly below.
On this checkout, the live tuple-backed feedback queue is empty:
`pd roadmap --feedback-status open --json` shows `open: 0` after 11 harvested
items, while `pd feedback list --status open --json` still hits `EPERM` on
`~/.port-daddy/daemon.sock`. This checkout also does not contain a
`.spark/feedback/` tree, so the curated harvest stayed unchanged this pass.
The current now-status dogfood pair remains `claim-preserving-git-safety`
and `fleet-launchability-and-cadence`. The 2026-05-11 Spark promotion
added `graph-based-merge-conflict-predictor` and
`ambient-anomaly-signaling` to the curated wave; the fresh 2026-05-10 raw
Spider exhaust (`S41/S42/S43`) is still uncurated, so it stays outside the
Next Cuts list for now.

The 2026-05-09 Spark harvest promoted `daemon-introspection-api` and
`ideas-trove-queryable-surface` into the same now wave.

The 2026-05-12 Spark idea pass added `symbol-graph-visualization` as the
Phase 1 operator-visibility cut.

The same 2026-05-12 Spark idea pass added `incremental-symbol-index-refresh`
as the Phase 1 predictive-coordination cut and `operator-hint-engine` as
the Phase 3 decision-velocity cut.

The same 2026-05-12 Spark idea pass added `orchestrator-plugin-lifecycle`
as the Phase 1 user-extensibility cut.

The 2026-05-13 Spark promotion moved `daemon-fleet-auto-recovery`,
`graph-integrity-auditor`, `agent-skills-quality-gates`,
`cost-forecast-alert`, and `ipc-queue-saturation-promotion` into the
curated immediate-candidate wave, so they now sit in Next Cuts rather than
the raw-exhaust pile.

The 2026-05-13 extended Spark promotion moved
`cost-gated-spawning`, `empirical-model-efficiency-routing`,
`operator-decision-journal`, and `sandboxed-adversarial-test-harness`
into the same immediate-candidate wave.

The 2026-05-14 Spark promotion moved `tuple-store-query-api`,
`governance-coordination-hub`, `phase-3-auto-remediation-executor`,
`cost-aware-model-training-loop`, and `unified-spawn-risk-synthesis`
into the curated wave; `skill-degradation-contagion-early-warning`
remains a backlog extension of `agent-skills-quality-gates` and
`ambient-anomaly-signaling`.

The same 2026-05-14 Spark promotion also surfaced
`episodic-memory-query-surfaces` as the Phase 3B memory cut, so Fleet &
Memory can finally recall learned knowledge across sessions instead of
staying a spec.

**Cartographer Mapping Pass (2026-05-16 18:16 UTC):** No new dogfood feedback files found this pass. `origin/main` and stable are heavily diverged: `origin/main` has 35 commits not in stable, led by v3.14.0 release-prep / metrics / docs-polish work, while the Phase 4A binary / doctor / distribution slice lives on feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`) and has not landed on `origin/main` or stable. Tuple-backed feedback projection is available and empty (`open: 0`, `harvested: 11`). 34 now-status items in execution wave; Phase 3 visibility/automation is hottest mapped lane. That release-prep cluster is unplanned work relative to the V4 phases and is tracked here as such rather than being relabeled as a roadmap phase.

The curated trove also surfaced `operator-manual-fleet-dispatch` as the
proactive Phase 3 dispatch workbench beside `tuple-driven-fleet`, so
operators can route pending work intentionally before auto-routing takes
over.

The live tuple-backed `pd roadmap --feedback-status open --json`
projection is the authoritative open queue for feedback-harvest work; the
plain `pd feedback list --status open --json` form remains the fallback when
the roadmap projection is unavailable.

The cartographer roadmap-progress screen and central feedback pipe are
already shipped, so the "Next Cuts" list below is the remaining backlog
rather than the old four-file FOMO check.

Fresh 2026-05-16 raw Spark/Spider exhaust exists on disk as research-only
provenance. It stays outside "Next Cuts" until Spark/Spider dedupe it into
`IDEAS-TROVE.md`.

## Operator-Direct: Accounts Arc (2026-05-23)

**Provenance:** operator-direct, not Spark/Spider promoted. Cartographer should preserve this section verbatim across mapping passes.

The cryptographic substrate is in tree (`lib/merkle-chain.ts`, the delegation walker from PR #66, Ed25519 helpers, daemon fingerprint). The design is in tree as two ADRs: [`0029-user-accounts-and-merkle-audit.md`](adr/0029-user-accounts-and-merkle-audit.md) (local primitives) and [`0039-portdaddy-dev-account-surface.md`](adr/0039-portdaddy-dev-account-surface.md) (web surface, security model, version-skew dance). What's left is to actually build it. Phases below are independently shippable.

### Phase A0 — `pd account create` (LOCAL, ~150 LOC)
**The smallest meaningful piece.** Local Ed25519 keypair generation, written to `~/.port-daddy/account.json`. Derives the accountId as `pd_acc_<base58btc(SHA-256(pubkey))>`. No daemon changes. No web changes. After this lands, every later piece has an accountId to bind to.

### Phase A1 — `pd account pair` + `~/.portdaddy.dev/account/devices` (LOCAL + DAEMON)
Daemon side of the pairing-receipt ceremony. Daemon signs a `PairingReceipt` over `{daemonFingerprint, accountId, nonce, deviceLabel, expiresAt}`. CLI displays a 4-digit confirmation code; daemon writes the receipt to `~/.port-daddy/account/pairings/<accountId>.json` once both sides verify.

### Phase W0 — portdaddy.dev account page (WEB, ~2 weeks)
GitHub OIDC sign-in. `/account` page: profile, device list, pairing flow that accepts the receipt from `pd account pair`. CSP, rate limits, Sentry-equivalent. Per ADR-0039 §III security model.

### Phase A2 — Audit-tree sealing + signed receipts (DAEMON, ~1 week)
Daemon writes monthly audit trees per `(accountId, repoRoot, calendarMonth)`. Each sortie completion writes a signed leaf. `pd verify --account <id> --since <date>` runs the verification locally.

### Phase W1 — Receipts as URLs (WEB, ~3 weeks)
`pd receipt publish <id>` uploads a signed receipt to portdaddy.dev. `portdaddy.dev/r/<receiptId>` resolves it and verifies in-browser via Ed25519. The minimum-viable cultural moment for accounts: a shareable, verifiable URL for agent work.

### Phase W2 — Audit page + scoped sharing (WEB, ~4 weeks)
`portdaddy.dev/audit` for the owner. `…/audit/share/<token>` for auditors, time-limited, scoped to a repo or date range. Renders the per-month Merkle tree as a timeline.

### Phase W3 — Fleet steering from web/phone (WEB + DAEMON, ~3 weeks)
The phone is an operator surface. Spawn / steer / note / approve / budget from any paired device, via the relay. Write operations require 4-digit-code confirmation for sensitive surfaces (cancel agent, drain fleet). Per ADR-0039 §II surface 3.

### Phase W4 — Fleet ship marketplace (WEB + DAEMON, ~3 weeks)
`pd fleet publish` packages signed fleet YAML + skills + prompts; `pd fleet install @user/name` pulls and forks. `portdaddy.dev/@<account>/fleets/<name>` resolves the signed package. Account is the publisher identity.

### Phase W5 — Localhost tunnel for interactive web/phone (WEB + DAEMON + RELAY, ~2 weeks)
`pd tunnel expose <port> --to relay --label <name>` registers an HTTP tunnel. `portdaddy.dev/devices/<label>/at/<port>/` is a **full bidirectional proxy** — touch becomes click, hardware keyboard types, WebSocket upgrades for HMR, file uploads pipe back. Phone-as-operator for a dev server running on a laptop.

### Phase W6 — Transparency log opt-in (WEB, ~6 weeks)
Optional: publish Merkle roots to a Rekor-style transparency log. Closes the "trust no one, not even the operator" backstop. Unlocks the AI-safety-auditor pitch concretely.

**Total scope:** roughly 4–5 months of focused work, but each phase ships standalone. After **A0 + A1** the substrate exists; after **W0 + W1** the cultural artifact (verifiable receipt URL) exists; after **W3 + W5** the phone-as-operator story closes.

**Open process questions:**
- Should each phase get its own ADR (so deviations from 0029/0039 are tracked) or share these two? My current take: yes for W4 (marketplace abuse policy), W5 (tunnel-security defaults), W6 (transparency log architecture). The rest fold into 0029/0039.
- Custodial publish-key model (W1) vs full non-custodial — needs a separate decision before W1 starts.

---

## Next Cuts (From Curated Trove)

Mirrored from `docs/recovery/IDEAS-TROVE.md` § Immediate Implementation
Candidates. Keep this short and rotated — it is the "what we cut next"
list, not the full backlog. When an item ships, move its line into the
appropriate phase section below and delete it here.

- **`incremental-symbol-index-refresh`** — Phase 1 graph infrastructure is
  static after initial indexing. Add filesystem-driven incremental refresh
  so merge-risk predictions stay current as files change instead of going
  stale between explicit graph queries.
- **`symbol-graph-visualization`** — Phase 1 graph infrastructure exists,
  but operators still cannot see the symbol graph. Add a visual graph panel
  and export route so contention is legible instead of only queryable.
- **`daemon-introspection-api`** — Operators lack a unified view of daemon
  health: SQLite WAL lag, IPC backlog, active session count, lock
  contention, role runtime stats. Add `GET /daemon/introspect` so the Crew
  panel and Fleet Health Scorecard can stop stitching fragments together.
- **`operator-hint-engine`** — `daemon-introspection-api` tells operators
  what is happening; this adds the "what to do next" hint layer so the
  dashboard can suggest pause/check/escalate actions instead of only showing
  raw anomaly data.
- **`ideas-trove-queryable-surface`** — `IDEAS-TROVE.md` is canonical
  policy, but it is static markdown. Add `pd ideas list|search|show` plus
  HTTP routes so Spark/Spider can query the trove for deduplication instead
  of doing brittle string matching.
- **`orchestrator-plugin-lifecycle`** — Phase 1 wired the orchestrator
  registry and default FIFO orchestrator, but users still can't hot-load
  custom orchestrators without forking the daemon. Add the loader /
  lifecycle wire so domain-specific routing can be tested and activated at
  runtime.
- **`daemon-fleet-auto-recovery`** — Phase 3 declarative fleet survives only
  while the daemon is up. Add automatic recovery so persistent roles come
  back after restart instead of requiring manual `pd fleet up` ceremony.
- **`graph-integrity-auditor`** — Phase 1 graph quality needs daily
  integrity audits so silent corruption does not undermine merge
  prediction or claim safety.
- **`agent-skills-quality-gates`** — validate skill inventory and quality
  before spawn confidence is trusted. This is the Phase 2.5 bridge from
  skill trust to more confident launches.
- **`cost-forecast-alert`** — Phase 2 spend visibility is historical only
  today. Add forward budget alerts so operators see projected overages
  before the economist pricing layer catches up.
- **`cost-gated-spawning`** — Phase 2 cost-tracker exists, but spend
  enforcement is still advisory. Add a spawn-time budget gate so budget
  promises are enforced before a run starts.
- **`empirical-model-efficiency-routing`** — We already have historical
  cost and success data, but spawn-time model selection is still manual.
  Use the empirical history to recommend the model that minimizes cost
  while keeping success rates high.
- **`operator-decision-journal`** — The system records what happened, but
  not why. Persist operator approvals, overrides, and pause decisions so
  governance and forensics are auditable.
- **`operator-manual-fleet-dispatch`** — Phase 3 still auto-routes too
  much. Add an operator workbench for intentionally routing pending work
  to a chosen agent or role before `tuple-driven-fleet` takes over.
- **`cost-aware-model-training-loop`** — The existing model-efficiency
  routing and operator decision trail need a feedback loop. Feed operator
  overrides back into model routing so the spawn policy learns from the
  decisions already being made.
- **`ipc-queue-saturation-promotion`** — the IPC backpressure story still
  lacks a saturation-aware spawn gate. Add load shedding so the queue can
  warn before the daemon becomes the bottleneck.
- **`sandboxed-adversarial-test-harness`** — Phase 4E/4F still needs a safe
  isolated daemon harness. Add sandboxed adversarial runs so hardening work
  can execute without risking the live daemon.
- **`unified-spawn-risk-synthesis`** — the spawn gate still reasons about
  cost, skills, dependencies, harbor capacity, and learned model behavior
  separately. Add a preflight synthesis so operators see the combined risk
  before the daemon starts a run.
- **`claim-preserving-git-safety`** — Advisory file claims can still be
  steamrolled by `git add -A`, `git reset --hard`, and `git cherry-pick`.
  Add a safe `pd add` path plus destructive-git guardrails that consult
  claims before they bulldoze another session's edits.
- **`fleet-launchability-and-cadence`** — Cartographer can be wired but
  still blocked by cadence routing, slug drift, and the wallet /
  telemetry wall; surface `launchable` vs `blocked` truth in `pd
  status` and spawn/preflight output.
- **`coordination-guard-extended-enforcement`** — Coordination Guard
  already exists and this repo now ships it in enforce mode
  (`.portdaddy/coordination-guard.json`), but it still only fires on
  git pre-commit. Extend it to SessionStart + PreToolUse hooks so
  agents can't edit without `pd begin` + claims. Also cover destructive
  git verbs (`git add -A`, `git reset --hard`, `git cherry-pick`) so
  claims can't be bulldozed by closeout flows.
- **`crew-screen-roles-not-pids`** — Dashboard currently shows
  agents-by-PID; operators think in *roles*. New Crew panel: each
  fleet role with last-run / last-cost / currently-doing / blocked.
- **`fleet-health-scorecard`** — Operators still have to stitch role
  health, cost burn, queue depth, and recent violations together by
  hand. Add one Fleet Health Scorecard panel that answers "is the
  swarm healthy?" in a single glance.
- **`coordination-ticker-as-high-signal-feed`** — Surface
  `coordination:inconsistency` as a live ticker on the dashboard with
  severity coloring. The channel exists; the panel doesn't.
- **`ambient-anomaly-signaling`** — Turn daemon introspection plus
  coordination-judge anomalies into ambient pheromone signals so roles can
  avoid bad spawns before they happen.
- **`governance-coordination-hub`** — Combine the governance signals
  already split across dispute, liquidation, and skills vote surfaces into
  one operator view so the control plane can answer "what governance is
  active right now?" without stitching panels together.
- **`phase-3-auto-remediation-executor`** — Visibility and hints already
  exist; this adds the operator-approved automation step so the daemon can
  execute bounded remediation playbooks instead of only suggesting them.
- **`episodic-memory-query-surfaces`** — Phase 3B is still write-only;
  expose store/recall/forget/episodes so Fleet & Memory can actually search
  learned experience across sessions.
- **`quorum-driven-dynamic-launch`** — Phase 1 tuple-backed
  proposal/vote primitive (`lib/quorum.ts` + 4 endpoints) shipped in
  `cea02e1`; Phase 2 remains the auto-spawn of declared
  spawnable-on-quorum roles when threshold hits.
- **`ipc-disconnect-instant-salvage`** — IPC drop is already a death
  signal; treat IPC activity as implicit heartbeat and trigger immediate
  salvage on disconnect instead of the 10–20 minute stale window.
- **`graph-based-merge-conflict-predictor`** — Use the Phase 1 semantic
  graph to score pre-merge overlap and warn before git attempts a conflict.
- **`symbol-claim-isolation-validator`** — Phase 1 graph-backed claim
  safety still needs a pre-flight check. Validate symbol ownership before
  agents lock work so conflict risk is caught before merge time.
- **`forensic-context-windows`** — Attach recent correlation timeline
  context to Arbiter violation records so violations narrate themselves
  instead of being bare facts.
- **`tuple-store-query-api`** — `fleet-health-scorecard` needs queue-depth
  visibility, but the tuple store is still write-only to operators. Add a
  narrow stats/query surface so the scorecard can read backlog truth without
  exposing raw tuples.
- **`fleet-run-journal`** — Persist fleet run lifecycle into SQLite so
  `pd fleet history` and briefings stop forgetting on restart.
- **`salvage-root-cause-classifier`** — Salvage records log *that* agents
  failed, not *why*. Add classification by root cause (timeout, OOM,
  permission, network, logic error) to help operators distinguish tuning
  from audit from redesign.
- **`telos-driven-model-selection`** — The telos contract and shared
  backend resolver already exist; the next cut is an explicit spawn-time
  suggestion layer that recommends a model from durable telos without
  hiding overrides.
- **`fleetbar-secret-management-with-provider-deeplinks`** — FleetBar
  still assumes the operator will hand-edit the right `.env.local`.
  Add a credentials panel with per-backend status, Keychain-backed
  storage, and provider deeplinks so backend setup happens in the
  console instead of through silent 401 archaeology.
- **`tuple-driven-fleet`** — Tuple-triggered fleet agents, then IPC tuple
  fast path. Most direct path from "fleet" to actual swarm task routing.
  The raw `tuple-namespace-hierarchies` extension points at
  namespace-scoped queries and wildcard listeners for role-scoped work.
- **`capability-discovery-dns-harbor`** — Turn existing DNS + harbor
  capability data into real agent discovery; remove hard-coded peer
  naming from delegation paths.
- **`metrics-histogram-persistence`** — `MetricsRegistry` (PR #44) is
  in-memory only; daemon restart drops every per-route bucket. Persist
  per-minute bucket counts to a new `metric_histograms` SQLite table and
  add `GET /metrics/http/timeseries` so percentiles survive restarts and
  the dashboard can drop its client-side rolling buffer. Prerequisite for
  `slo-alerts-and-outlier-detection`.
- **`slo-alerts-and-outlier-detection`** — PR #44 ships percentiles but no
  alerting. Phase 1: per-route SLO config in `config.json`,
  `lib/slo-evaluator.ts` <!-- cite-exempt: phase-1 build target, not yet shipped --> that emits to `coordination:inconsistency` SSE +
  session notes + navigator inbox, dashboard `slo_violation` pins. Phase 2:
  z-score outlier detection against same-hour-last-week (depends on
  histogram persistence) with sustained-breach gating and an escalation
  ladder.

### Recursive Control Plane kernels (from Ledger § D, 2026-06-19)

The **PORTABLE** rows of `docs/research/north-star/00-THE-LEDGER-open-problems.md`
§ D — the recursive-control-plane kernels that a source repo already ships
(`erichowens/soma`, `curiositech/windags`), verified in
`docs/research/grafts/2026-06-19-soma-windags-source-audit.md` and mapped to the
port-daddy surface they lift onto. These are lift-and-adapt builds, not research.
The OPEN / ABSENT / DESIGN-ONLY rows stay in the Ledger until a source repo builds
them.

- **`rcp-discourse-typed-bus`** (RCP-3b) — the tube envelope (`lib/tube.ts`,
  `lib/messaging.ts`) is untyped today (`kind: 'tube.msg'`, opaque body). Add a
  FIPA-style `act` performative enum (inform / propose / counter / refine /
  synthesize / query) + a `relationship` field (supports / contradicts / extends
  / narrows / synthesizes) on the envelope, back-compat, surfaced through
  `pd tube` and the `publish_message` MCP tool. Ports windags' `SwarmDiscourse`
  (`packages/core/src/topologies/swarm.ts`). The substrate RCP-3 (parley) and
  RCP-14 (lineage) build on.
- **`rcp-parley-trigger`** (RCP-2a) — port windags' economic gate
  (`P(fail) × waste > cost`, `packages/core/src/observability/evaluation-engine.ts`)
  as the decision to escalate a detected work-overlap into a structured parley
  rather than convene eagerly (resists MAS-overhead Goodhart). Shares the Signal
  Detection spine with Ledger RQ-7.
- **`rcp-convergence-cascade`** (RCP-1a) — adapt the existing semantic infra
  (`lib/semantic-resolver.ts` MiniLM embeddings + `lib/ideas-search.ts` BM25) into
  a task-shape similarity cascade (BM25 → cosine-RRF → rerank), the plan-time half
  of the convergence detector. (Runtime-overlap RCP-1b stays OPEN in the Ledger.)
- **`rcp-argumentative-lineage`** (RCP-14) — record Toulmin discourse spans
  (claim / data / warrant) keyed to the cost/outcome ledger (`lib/cost-ledger.ts`)
  so reasoning provenance is zoomable. Ports windags' `SwarmTracer`. Consumes
  `rcp-discourse-typed-bus`.
- **`rcp-coverage-epistemic-scan`** (RCP-12) — an innate coverage drive over the
  pheromone blackboard (`lib/pheromone.ts`): fire on under-visited entities
  (P ∝ unseen/total) so no surface stays permanently invisible. Ports soma's
  epistemic scan. Relates to Ledger RQ-2 (forced-zoom sampling).
- **`rcp-resolution-traces`** (RCP-7a) — inverse-pheromone damping on
  `lib/pheromone.ts`: deposit a "resolved — stop converging here" trace after a fix
  so agents stop piling onto solved work. Ports soma's anti-inflammatory
  resolution traces.
- **`rcp-wave-reconvention`** (RCP-3a) — schedule parleys at natural turn / wave
  boundaries when tentative or premortem-risky work is in flight, not ad-hoc.
  Ports windags' wave-by-wave reconvention.
- **`rcp-halt-gate`** (RCP-10) — a pre-coordination validity check that must pass
  before work decomposes or a bond is written (a problem must be well-defined
  before it can be coordinated or traded). Ports windags' Polya halt gate.

### Substrate Activation Track (2026-05-19 audit + research)

Audit on 2026-05-19 against the production stable DB (`~/port-daddy-stable/port-registry.db`)
showed PD already has the substrates for ambient coordination — the pheromone module
(`lib/pheromone.ts`), the semantic resolver with real embeddings
(`Xenova/all-MiniLM-L6-v2` in `lib/semantic-resolver.ts`, 8k events/wk), the Tube
performative envelopes, the bond/budget plumbing, the human-source feedback pipeline,
and the harbor capability registry — but the *verbs and surfaces* are missing. Three
research docs in `.scratch/` (pheromone-visualization-research.md,
multiplayer-input-research.md, agent-coordination-research.md) plus the parallel
transcript-recon.md and transcript-ingestion-design.md anchor this track.

- **`coordination-counter-coverage`** — `metric_counters` has 154k rows but only
  22 distinct keys, all `spawn.*`/`usage.*`/`semantic.*`. Zero counters on tuples
  writes, messages, session_notes, session_files claims, episodic_memory writes,
  agent_inbox, activity_log, sortie_events, locks, resurrection. Add ~13 keys at
  each write path so ongoing coordination-primitive telemetry replaces one-time audits.
- **`pd-whois-phonebook-surface`** — Surface the existing semantic-resolver as the
  expertise phonebook. `pd whois <query>` embeds the query via the existing local
  all-MiniLM-L6-v2 path and does cosine across capability phrases in
  `harbor_members.capabilities` + earned-capability evidence from activity. Returns
  ranked actors with matched phrase + similarity + freshness gate. Composes with
  the existing `capability-discovery-dns-harbor` slug — that one is the wire, this
  is the verb.
- **`earned-capabilities-index`** — Extend the phonebook beyond self-declared
  capabilities. Background job embeds touched-file patterns, claimed symbols,
  completed-episode titles, and skill-graft history per actor. Cosine over these
  evidences makes "frontend" match an agent who has merged 30 React/Tailwind PRs
  even if they never said "frontend." Avoids the lying-about-capabilities failure mode.
- **`actor-subscription-streams`** — `pd subscribe actor:<id>` follows another
  agent's events (claims, notes, sprays, done/fail). Per-kind filter. Mastodon-style
  asymmetric; mutual edges emerge as implicit working groups. Persists in a new
  `actor_subscriptions` table. Subscribed events feed the ambient-context broker.
- **`ambient-context-broker`** — One unified subscription model over five stream
  kinds: `actor:<id>`, `capability:<query>`, `channel:<name>`, `tuple:<pattern>`,
  `pheromone:<target>`. Daemon allocates per-turn ambient context budget (~800
  tokens default), ranks by urgency × spatial-relevance × recency × subscription-strength,
  compresses progressively, drops at floor. `pd context --preview` shows the operator
  what would inject in the next turn. Generalizes inbox-pops-in-context to all streams.
- **`pheromone-vocabulary-v1`** — Lock the kind catalog (~15-20 kinds): topological
  (`hot:editing`, `cold:abandoned`, `flow:hot-path`), economic (`cost:burning`,
  `attention:human-blocked`), reputational (`experience:succeeded`,
  `experience:failed`, `quality:test-failing`, `freshness:stale-doc`). Each kind
  carries a half-life, a `decay_during_idle` flag, and a set of clear-events. Rule
  that emerged from multiplayer-input research: **pheromones for graded attention,
  never for facts.** Facts go to `feedback.drop()` + raw `tuples.out(...)`.
- **`pheromone-decay-per-kind`** — Replace `lib/pheromone.ts`'s single
  `decayRate` config with kind-keyed half-life. Add activity-gated decay (clock
  pauses when sessions in the project are idle — vibe-coding bursts shouldn't lose
  state overnight). Add event-clearing for stateful kinds (`quality:test-failing`
  clears on `test:passed-at-target`).
- **`pheromone-spray-wiring`** — Today: 0 known production sprays. Add automatic
  spray points: file-claim → `hot:editing`, claim-release → faded `hot:editing`,
  `pd done` → `experience:succeeded`, session-death-in-resurrection → `cold:abandoned`,
  cost-cap-hit → `cost:burning`, CI red on touched file → `quality:test-failing`.
  Activates dormant substrate.
- **`heat-tree-viz`** — Recursive per-kind aggregation (`max`, never collapsed to
  scalar) over the file tree. Renders in fleet-config-ui (web console) and a
  glance tile in FleetBar. CodeScene + Datadog convergence: one dimension drives
  color, kinds carry glyphs — avoid RGB-per-kind visual mud. See
  `.scratch/pheromone-visualization-research.md` for the five-mode design.
- **`pd-sniff-enriched-read`** — Today `pd sniff` returns a scalar bag. Enrich with
  rank-percentile, trend, dominant-kind, neighbor context, deterministic advice
  array. Turn the read into something an agent can act on without hallucinating a
  threshold. (Mode E from viz research.)
- **`transcript-events-wiring`** — `lib/transcript-store.ts` is defined-but-not-wired;
  `lib/cost-ledger.ts:117-118` already SELECTs from `transcript_events` as if it
  exists. Production stable DB does not have the table. Build a daemon-side tailer
  for `~/.claude/projects/**/*.jsonl` + `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`,
  attribute by cwd → active session, persist excerpts. Designs already in
  `.scratch/transcript-recon.md` + `.scratch/transcript-ingestion-design.md`.
  Unblocks salvage digestion and Tube INFORM projection.
- **`salvage-digest`** — Background LLM job (Haiku-class, cents per dead session)
  reads notes + transcript_events + claims + pheromones for a session entering
  `resurrection_queue` and emits `{intent, progress, open_threads, last_blocker,
  touched_files, claims_held, pheromones_sprayed, chronology[]}`. Takeover agent
  gets the digest in ~500 tokens of context, drills into raw via
  `pd salvage drill <id>` / `pd salvage transcript <id>`. Same compactor primitive
  as the nightly episodic-memory consolidation — build once, reuse.
- **`memory-consolidator-primitive`** — One service that takes
  `(source_table, source_ids[], scope) → summary_record`. Used nightly for
  episodic-memory compaction (50 individual `handoff` episodes → one
  `pattern:failure` episode) and on-death for salvage digestion. Adds an
  `embedding BLOB` column to `episodic_memory` for semantic recall via the
  existing resolver.
- **`handoff-consolidation`** — `session_notes` (74% type=`handoff`) and
  `episodic_memory` (99% type=`handoff`) are duplicates of one concept. Kill
  `session_notes`, migrate its 7 types to `episodic_memory.episode_type`. Adapt
  `pd note` to write episodic memory.
- **`multiplayer-input-bookmarklet`** — Browser bookmarklet, dev-mode-only, lasso
  DOM region → resolve to source file via React fiber `_debugSource` (no source
  maps needed; default in CRA/Vite/Next/Remix) → call `feedback.drop()` with
  `source='human'` (already supported in `lib/feedback.ts`, already Cartographer-
  harvested). Marker.io-style redundant anchors (selector + xpath + text snippet
  + bbox-pct). MVP <300 LOC. Sequencing per research:
  dashboard-click → FleetBar screen-region → DOM overlay.
- **`fleetbar-feedback-region`** — Swift + Vision OCR screen-region capture from
  FleetBar; resolves to source file when possible, otherwise stores OCR text.
  Writes to the same `feedback.drop()` pipeline.
- **`implicit-working-groups`** — Groups exist by virtue of overlap (shared file
  claims, shared roadmap item, shared harbor) and only materialize into a
  `groups` table on query or promotion. Default conscription is observer-only
  (no compelled response, no bond). Compelled response requires REQUEST + bond,
  refundable on response (including REFUSE). Mutual-subscription edges count as
  implicit groups for free.
- **`group-chat-four-modes`** — Channel (pull, default), huddle (push to
  non-idle), REQUEST (compelled response, bonded, with timeout), observer
  (lurk). All four map onto existing primitives — no new transport.
- **`ast-claim-wiring`** — `lib/symbol-index.ts` (1,457 lines, uses web-tree-sitter WASM
  dependency) is defined but not wired into `server.ts`. 0 of 1,637 production
  claims use `start_line` / `end_line` / `symbol`. Phase 1: audit parser, settle
  language coverage (TS/JS/Python/Go for v1). Phase 2: lazy-index on first claim
  per file, persist to `symbols`. Phase 3: `pd claim <path>:<symbol>` as
  first-class verb, surface symbol candidates in claim responses. Phase 4: wire
  `merge_queue` + `orchestrator_rules` for symbol-overlap conflict resolution.
  Unblocks Mode B (AST-level pheromone overlay) in viz work.
- **`pd-roadmap-pop-production-trigger`** — `lib/roadmap-pop.ts` self-inits its
  table, ADR-0033 declares SHIPPED, the verbs exist (`pd roadmap pop / release /
  claims`) but `roadmap_claims` does not exist in the production stable DB.
  Conclusion: the verbs have never been invoked against production. Force the
  table to materialize on daemon startup (move CREATE TABLE to early init) so
  the substrate is available even if no one calls the verbs yet.
- **`heartbeat-tmp-cleanup`** — Stale `.heartbeat.<pid>.<ts>.tmp` files in
  `~/.port-daddy/` from an older file-based liveness mechanism. Current daemon
  uses the socket; the tmp files are zombies. Janitorial: clean on daemon start.
- **`pheromone-promotion-and-axis`** — Pick a pheromone primacy axis (drives
  heat-tree color: urgency / attention / cost — strawman: urgency) and an
  always-visible kind list (strawman: `attention:human-blocked`,
  `quality:test-failing`, `cost:burning`). Lock the visual grammar before any
  surface renders pheromones.
- **`rust-core-adr`** — ADR draft proposing the kernel seams: event bus, claim
  store with built-in AST index (tree-sitter native, not WASM), tuple +
  pheromone substrate, session state, episodic + harbor memory. TS daemon
  becomes a shim during transition; CLI/MCP/web/FleetBar all consume the
  Rust core via the existing Unix socket. JSON-RPC initially; protobuf later
  if measured. Design only — code starts after seams agreed.
- **`identity-consolidation-actors-table`** — Identity sprawls across `agents`,
  `sessions.agent_id`, `harbor_members`, `endpoints`, `services`, `harbor_issued_tokens`
  — six surfaces for one concept. Long-arc cleanup: one `actors` table with the
  union, FKs migrated. Pairs naturally with the Rust core migration (do them in
  the same wave to amortize the schema churn).
- **`note-abstraction-consolidation`** — `agent_inbox` has 46 rows lifetime;
  decide invest vs delete. `dns_records` has 0 rows; same call. Three doctrine
  ghosts to either build or strip from docs: `pheromones` (table-less but
  module-real), `signals`, `coordination_inconsistencies`. Track in
  `.scratch/note-abstraction-audit.md`.

Secondary backlog families (status `backlog`, see IDEAS-TROVE.md §
Secondary Backlog Families for full lists):

## Core Philosophical Architecture

- **Data Structures for Swarms:** Avoid monolithic, mistake-prone trees for writing overlapping diffs. Instead, lean into *event-sourcing* and *pub/sub messaging*. Agents communicate intentions, acquire distributed locks for exclusive resources, and rely on Git (via `lib/worktree.ts`) as the ultimate concurrent data store. 
- **The "Shared Whiteboard" & Memory:** Rather than a giant key/value store, use a **Shared Neural Memory** (like an embedding-backed contextual ledger) and a semantic **Whiteboard** (via `SessionNotes`) for high-level state handoffs.
- **Values & Policy Models:** As swarms grow, a shared RL-style value model ensures agents align on quality (e.g., "is this code idiomatic?") while policy models guide immediate actions.

## 1. Network & Naming (The Local DNS Revolution)

- **Abstracting Port Numbers:** The dashboard and daemon should be accessible via `.local` addresses (e.g., `dashboard.pd.local`, `api.pd.local`) instead of numeric ports.
- **Harbor Addresses:** "Do harbors have addresses?" Yes! In V4, Remote Harbors will be addressable via the Anchor Protocol (Lighthouses). Locally, they should bind to subdomains (e.g., `harbor1.pd.local`).
- **Implementation:** Extend `lib/dns.ts` to hook into system DNS resolvers (`/etc/resolver/pd.local` on macOS) seamlessly.
- **Local DNS Proxy:** Build a tiny, `sudo`-powered reverse proxy on port 80/443 that routes traffic based on hostnames (e.g., `dashboard.pd.local` -> `:3144`), allowing users to drop port numbers entirely.

## 2. Infrastructure & Tooling

- **VHS Automation:** Integrate Charmbracelet's `vhs` for rich, scripted GIFs and tutorials. Wire `.tape` files to GitHub Actions to regenerate visual documentation automatically whenever code changes, establishing a visual "gold set".
- **Multi-Verse Harvesting:** Create background agents to continuously scan `.claude/worktrees/` to harvest unique features and divergent timelines into the main trunk.
- **Maritime Aesthetic Revival:** Reintroduce maritime signal flags to the CLI and tools. The aesthetic should be ambitious, industry-defining, clearly CUTE and CHARMING.

## 3. Dedicated Background Agents

To sustain development, Port Daddy needs its own "crew":
- **The Cartographer:** An agent responsible for maintaining this Roadmap and scanning the horizon for new ideas.
- **The Archivist:** An agent that tends to `README.md`, `McpPage.tsx`, and the documentation hub.
- **The Shipwright:** A background agent dedicated exclusively to fixing bugs and squashing regressions.
- **The Vibe Matcher:** An agent that ensures the "purring and beautiful" Tailwind UI remains coherent.

## 4. Website vs. Local Dashboard

- **Clarification of Roles:** The dashboard is the *local* Control Plane served at the selected daemon's published endpoint (with `pd.local` as a human alias where configured). The website in `website-v2/` is the *public-facing* marketing and documentation hub hosted on Cloudflare. Their visual identities and routing must remain distinct.

## 5. The "Wild West" & Agentic Criminality (V4 Vision)

As swarms grow beyond local machines, we need a "Code of the Sea" for agents.

- **Float Plans & Manifests:** Agents must declare a "Float Plan" (what they intend to do) and a "Manifest" (what resources they need) before entering a Harbor.
- **Agentic Escrow:** Use Port Daddy locks as escrows. Payouts (messages, file access, tokens) are released only when a "Quality Judge" agent (The Arbiter) verifies the work meets the manifest criteria.
- **Agentic Piracy:** Any deviation from the Float Plan or unauthorized resource consumption is flagged as "Piracy", leading to automatic "Brig" isolation or salvage.
- **Agent OAuth:** Cryptographic identity verification for remote agents to prevent "hailing hacks" or spoofing.
- **Ephemeral Data Harbors (FUSE):** Attach ephemeral data storage to Harbors. When a venture ends, the FUSE drive is unmounted and the data is archived or shredded based on the manifest.

## 6. Secure Networking & P2P

- **Noise Protocol Tunnels:** V4 will prioritize P2P encrypted tunnels between Harbors, allowing agents to coordinate across the global internet as if they were on the same local network.

## 7. Formal Verification & Cryptographic Soundness

As Port Daddy evolves to support Agentic Escrows and secure P2P Harbors (V4), we must mathematically prove our security models. Relying purely on unit tests is insufficient for adversarial multi-agent networks.

### Proof of Protocol (The Design)
- **Tooling:** Use **ProVerif** or **Tamarin Prover** to formally verify the Port Daddy Anchor Protocol (the P2P handshake and JWT Harbor Card exchange).
- **Goal:** Mathematically prove that the protocol prevents man-in-the-middle (MITM) attacks, token replay, and unauthorized Harbor ingress.
- **Why?** Remote agents (especially untrusted ones) will attempt to forge identity tokens. We must prove our HS256/Asymmetric JWT rotation scheme is fundamentally sound.

### Proof of Implementation (The Code)
- **Tooling:** Explore **F*** (F-star) or **Dafny** for verifying critical cryptographic pathways (e.g., the JWT signing and validation logic).
- **Goal:** Prove memory safety, absence of timing side-channels, and strict algorithmic pinning (e.g., preventing CVE-2026-22817 style algorithm confusion attacks) in the compiled artifact.
- **Why?** A sound protocol can still be ruined by a flawed implementation.

## 8. Substrate Activation — The Ambient Context Broker (2026-05-19)

This section captures a unifying architectural pattern that emerged from a substrate audit on 2026-05-19 plus three parallel research lines (pheromone visualization, multiplayer human input, agent coordination & expertise phonebook).

### The thesis

Port Daddy has been quietly more complete than its surface suggests. The pheromone module, the embedding-based semantic resolver, the Tube performatives, the bond / budget plumbing, the human-source feedback pipeline, the harbor capability registry, the Linda tuple space — all already exist in `lib/`. What's missing is **verbs, surfaces, and a unified context broker**.

The next strategic move is not "add more primitives." It is **collapse the existing primitives into one subscription model and make the daemon the ambient context server for every active agent.**

### The architectural picture

```
Streams (uniform subscription model):
  actor:<id>            — follow another agent's events (claims, notes, sprays, done/fail)
  capability:<query>    — dynamic set via the existing semantic resolver
  channel:<name>        — traditional pub/sub
  tuple:<pattern>       — Linda shape match
  pheromone:<target>    — graded attention near a file/region/symbol
  feedback:<scope>      — annotations from humans (DOM lasso, FleetBar region) and agents in scope
  group:<id>            — implicit (overlap-detected) or explicit working group

         │
         ▼
  Context broker (new):
    • allocates per-turn ambient budget (~800 tokens default, configurable per-actor)
    • ranks: urgency × spatial-relevance × recency × subscription-strength
    • compresses progressively as budget tightens; drops only at floor
    • `pd context --preview` surfaces what would inject in the next turn
         │
         ▼
  Projection / renderer:
    • Web console (fleet-config-ui) → heat tree + AST overlay + dashboard tile
    • FleetBar → glance tile (Mode D from viz research)
    • CLI (`pd sniff`, `pd context`, `pd whois`)
    • TUI (Rust, future)
    • Agent turn (injection by spawner / IPC stream)
```

### The three typing rules that fall out

1. **Pheromones for graded attention; never for facts.** Facts → `feedback.drop()` + raw `tuples.out(...)`. Graded state → `pheromone.spray()`. Discovered by triangulating the multiplayer-input and pheromone-viz research.
2. **Subscription edges are durable; presence is ephemeral.** Follow-graph persists; live cursors / typing indicators / "I'm here" never hit disk.
3. **Color drives one dimension; kinds carry glyphs.** RGB-per-kind is the visual mud trap CodeScene and Datadog independently warned against. Pick a primacy axis (urgency / attention / cost — strawman urgency); kinds become shape/badges.

### The economic-honesty rule

Conscription into a working group is observer-only by default (no compelled response, no bond charged). Compelled response requires REQUEST + bond, refundable on response (including REFUSE). PD already has the bond substrate (`lib/bonds.ts`, `bond_escrow`, `project_wallets`). This avoids "free dragooning" turning coordination into poll-spam, which is how the FIPA Directory Facilitator pattern rots in practice.

### The "ride the busy rail" principle

`agent_inbox` has 46 messages lifetime; `semantic_resolution_events` runs 8k/week. Two orders of magnitude. **Any new coordination primitive must hook into already-active rails or it dies the same death as the inbox.** Practical implications:
- The phonebook rides the existing semantic-resolver (already 8k events/wk + 5k embedding-cache-hits/wk)
- Multiplayer annotations ride the existing `feedback.drop()` (already Cartographer-harvested)
- Subscriptions ride the existing pub/sub channel infrastructure
- The ambient-context broker injects via the existing IPC turn stream, not via a new poll loop

### Cross-cutting design decisions

| # | Decision | Lean | Failure mode if wrong |
|---|---|---|---|
| 1 | Heat-tree aggregation rule | `max` per-kind retained up the tree | Scalar-collapse hides hotspots in averaged dirs |
| 2 | Pheromone primacy axis (drives color) | Urgency (`attention:human-blocked`, `quality:test-failing`, `cost:burning`) | Wrong axis makes the viz mostly noise |
| 3 | Always-visible pheromone kinds | `attention:human-blocked`, `quality:test-failing`, `cost:burning` | Too many = mud; too few = miss critical state |
| 4 | Implicit working-group formation | Lazy: detected by overlap, materialized only on query/promotion | Eager floods `groups` table with zombie groups |
| 5 | Conscription default | Observer-only without bond; REQUEST + bond for compelled response | "Free dragooning" = poll-spam swarm |
| 6 | Ambient context budget per turn | 800 tokens default, per-actor configurable | Too low = inbox-fate; too high = blown context |
| 7 | DOM-annotation surface MVP | Bookmarklet first; browser extension v2 | Extension is 3× the work for a feature that may not stick |
| 8 | Phonebook freshness gate | Live = heartbeat in last 30 min; decayed weight further out | Stale entries route requests to dead agents |
| 9 | Memory consolidation cadence | Nightly job for episodic; on-death for salvage | Background load + LLM cost trade |
| 10 | Shared structure: blackboard vs CRDT | Blackboard (HEARSAY-II modernized); CRDT is heavyweight at our scale | CRDT is dragons for code-shaped collaboration |
| 11 | `pd whois` ranks humans alongside agents? | Yes, with `--kind agent\|human\|any` filter | Splitting team-directory from agent-directory creates two of everything |

### Phased sequencing

**Phase 1 — Verbs over existing substrate (~1 week, mostly mechanical):**
`coordination-counter-coverage`, `pd-whois-phonebook-surface`,
`transcript-events-wiring`, `pheromone-vocabulary-v1`,
`pd-roadmap-pop-production-trigger`, `heartbeat-tmp-cleanup`.

**Phase 2 — Ambient streams + viz + salvage digest (~2-3 weeks):**
`ambient-context-broker`, `actor-subscription-streams`, `pheromone-spray-wiring`,
`pheromone-decay-per-kind`, `heat-tree-viz`, `pd-sniff-enriched-read`,
`salvage-digest`, `memory-consolidator-primitive`, `handoff-consolidation`,
`earned-capabilities-index`, `pheromone-promotion-and-axis`.

**Phase 3 — Multiplayer input + groups + AST claims (~3-4 weeks):**
`multiplayer-input-bookmarklet`, `fleetbar-feedback-region`,
`implicit-working-groups`, `group-chat-four-modes`, `ast-claim-wiring`.

**Phase 4 — Rust core (separate track, starts as design now):**
`rust-core-adr`, `identity-consolidation-actors-table`,
`note-abstraction-consolidation`.

### Research anchors

Five scratch docs that anchor this track (read these before re-deciding any
slug in §8):

- `.scratch/note-abstraction-audit.md` — production substrate inventory: 47 tables, 6 doctrine ghosts, 0/1637 AST claims using region/symbol, handoff duplication, 22 metric_counters keys covering only spawn/usage/semantic
- `.scratch/transcript-recon.md` — Claude Code + Codex CLI transcript formats, sizes, schemas, redaction priorities
- `.scratch/transcript-ingestion-design.md` — PD-side ingestion architecture for the orphan `transcript_events` table
- `.scratch/pheromone-visualization-research.md` — five visualization modes, four rendering surfaces, multi-kind composition strategies
- `.scratch/multiplayer-input-research.md` — DOM lasso → `feedback.drop()` via React fiber `_debugSource`, FleetBar Vision-OCR region capture, multi-human concerns
- `.scratch/agent-coordination-research.md` — FIPA-DF / Mastodon / LangGraph / Slack patterns; phonebook substrate; ad-hoc working groups; conscription model; blackboard vs CRDT decision

## 9. Design system — story palette rollout (2026-06-18)

The brand palette was rounded out into a harmonious **story palette** where each
hue maps to an ADR-0048 stack layer (cobalt = L0 kernel/truth, health-green = L1
ready, teal = L2 legibility, violet = L3 identity/continuity, indigo =
federation, rust = reputation/Elo, amber = economy). Tokens shipped in
`website-v2/src/styles/tokens.semantic.css` (light + dark, all WCAG AA+) and are
documented with rationale in `website-v2/docs/design/BRAND.md`.

Concrete fix-it tasks to roll the new hues across charts, the L0→L3 stack table,
the library map / agent-ecosystem viz, fleet-health/reputation/identity feature
accents, Mermaid classDefs, Storybook, and OG cards live in
**`website-v2/docs/design/color-rollout.md`** (7 scoped tasks + acceptance
gates). Spec sheet: `website-v2/docs/design/story-palette-spec.png`. These
graduate into a roadmap wave via `pd ideas` / the Cartographer harvest if they
need sequencing.

These docs survive session compaction and are the source of truth for the design choices summarized above.
