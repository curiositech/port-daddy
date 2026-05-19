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

The cartographer roadmap-progress screen and central feedback pipe are
already shipped, so the "Next Cuts" list below is the remaining backlog
rather than the old four-file FOMO check.

Fresh 2026-05-16 raw Spark/Spider exhaust exists on disk as research-only
provenance. It stays outside "Next Cuts" until Spark/Spider dedupe it into
`IDEAS-TROVE.md`.

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
  `lib/slo-evaluator.ts` that emits to `coordination:inconsistency` SSE +
  session notes + navigator inbox, dashboard `slo_violation` pins. Phase 2:
  z-score outlier detection against same-hour-last-week (depends on
  histogram persistence) with sustained-breach gating and an escalation
  ladder.

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

- **Clarification of Roles:** The dashboard is the *local* Control Plane served by the daemon (`localhost:9876` -> `pd.local`). The website (currently in `website-v2/`) is the *public-facing* marketing and documentation hub hosted on Cloudflare. We need to clearly separate their visual identities and routing to prevent confusion.

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
