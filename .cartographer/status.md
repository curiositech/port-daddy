# Cartographer Status — Port Daddy v4 Map

**Last Updated**: 2026-05-16 18:16 UTC (Cartographer mapping pass — branch HEAD `4e2a9f01`; Phase 4A active off-main on feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`); live tuple-backed feedback projection is empty (`open: 0`, `harvested: 11`); no new `.spark/feedback/` files found this pass; fresh 2026-05-16 raw Spark/Spider exhaust remains uncurated; execution wave 34 now-status items curated; `origin/main` is spending its 35 non-shared commits on release-prep / metrics / docs-polish work, not the binary slice; Phase 2 economist still idle 47 days; Phase 3 visibility/automation remains the hottest mapped phase with 5 curated additions in 2026-05-14 promotion)
**Authority**: Committed code + git log > curated markdown (recovery hub) > raw files (.spark)

---

## Current Snapshot

| Signal | Value |
|--------|-------|
| Phase Status | 0: ✅ COMPLETE \| 1: ✅ COMPLETE \| 2: 🔄 INFRA READY \| 3: 🔥 ACTIVE (hottest mapped phase) \| 4: 🟨 PARTIAL \| 5: 🔄 ARCHITECTURE \| 6: 🔄 ACTIVE |
| 7-Day Velocity | **Stable**: 1.3/day (9 commits last 7 days) \| **origin/main**: 35 unique commits not in stable (release-prep / metrics / docs-polish cluster) |
| HEAD Commit (Stable) | `4e2a9f01` (2026-05-14: Cartographer mapping pass — Phase 4A active, A5/A6 execution, 2026-05-14 work discovered) |
| Ahead on Main | 35 unique commits not in stable: v3.14.0 release-prep (`e254b047`, `0927aa28`, `4dc0818c`, `7ec3ad17`), Fleet UI Metrics tab / dashboard metrics (`5ca3b567`, `82a75872`), and docs/storybook voice cleanup (`0909c87d`, `973471ea`, `5d2bfdc4`, `350f881d`) |
| Daemon Status | ✅ Running (stable); tuple-backed feedback projection is empty (`open: 0`, `harvested: 11`) |
| Feedback Queue | **34 now-status items** curated in markdown; live tuple queue empty; open dogfood pair: `claim-preserving-git-safety` (now), `fleet-launchability-and-cadence` (now) |
| Stale Phases | Phase 4E (46 days, self-test); Phase 4F (46 days, Windows IPC) |
| Blocked Phases | Phase 2 economist (47 days idle, awaits Thomas Youle pricing function π) |
| Watch Signal | **Phase 4A binary / doctor slice is ACTIVE off-main on feature branches** — `feat/binary-distribution-daemon-unblock` and `feat/doctor-binary-daemon-diagnostics` carry the Bun / doctor / distribution work, but origin/main has not absorbed that lane yet. |
| Current phase | Phase 3 visibility / operational automation is the hottest mapped phase, now widened by `tuple-store-query-api`, `governance-coordination-hub`, and `phase-3-auto-remediation-executor`; Phase 1 COMPLETE is still verified 2026-05-07 (`f265fcb5`, `2ad20f32`); Phase 2 adds `cost-aware-model-training-loop`; Phase 4B adds `unified-spawn-risk-synthesis`; `skill-degradation-contagion-early-warning` stays backlog; the 2026-05-14 `tuple-driven-fleet` cut adds a lower-priority Phase 3 dispatch lane beneath that cluster, `operator-manual-fleet-dispatch` adds the proactive workbench for routing pending tuples before the lane auto-routes, `episodic-memory-query-surfaces` keeps the Phase 3B memory lane alive, and Phase 4A remains active off-main on feature branches while the latest origin/main work is release-prep / metrics / docs-polish rather than a V4 phase slice |

---

## Top 3

- **Closest to completion**: `incremental-symbol-index-refresh`, `symbol-graph-visualization`, `daemon-introspection-api`
- **Blocked or drifting**: Phase 2 economist, Phase 4A binary / doctor slice (active off-main, not yet promoted), Phase 4E/4F stale
- **Open dogfood now**: 2 entries, `claim-preserving-git-safety` and `fleet-launchability-and-cadence`

---

## Phase Status Grid

| Phase | Status | Last Commit | Notes |
|-------|--------|-------------|-------|
| **0: Formal Foundation** | ✅ COMPLETE | 2026-04-16 | White papers, Rust core, Arbiter, PKI, Coordination Guard, Merkle-chain shipped |
| **1: Semantic Graph** | ✅ COMPLETE | 2026-05-07 `f265fcb5` | graph_edges table + 6 indexes fully persisted + tested; reflection pass `2ad20f32` documented |
| **2: Economy & Cost** | 🔄 INFRASTRUCTURE READY | 2026-05-01 `8744e14` | cost-tracker + counters + observability endpoints ✅; pricing function π awaits economist |
| **3A: Fleet & Memory** | ✅ COMPLETE | 2026-05-01 | Declarative fleet YAML + pheromone system + auto-respawn shipped |
| **3B: Episodic Memory** | 🟨 PARTIAL | 2026-05-14 | Queued now item only; routes/CLI/UI have not landed in this checkout yet |
| **3C: Deep `pd scan`** | ⏸ BLOCKED | — | Downstream of Phase 2; not started |
| **3D: Fleet Dashboard** | 🔄 EVOLVED | 2026-05-02 | Standalone Fleet Live + menu bar app + Config UI (WIP); exceeds original "panel" spec |
| **4A: Bun/Fastify** | 🟡 ACTIVE (FEATURE BRANCHES) | 2026-05-14 off-main | Fastify migration ✅; Bun binary / doctor / distribution work is on feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`) with `0f3e2fbe`, `6a8c8bb1`, `0d99bdfe`, `cd283478`, and `72461802`; origin/main is spending its release energy on the v3.14.0 release-prep / metrics / docs cluster. |
| **4B: IPC** | ✅ COMPLETE | 2026-03-30 | Binary IPC + MessagePack + Backpressure all shipped v3.8.2 |
| **4C: Radix Trie** | ✅ COMPLETE | 2026-03-31 | Semantic index + harbor bitmask filtering shipped |
| **4D: Backpressure** | 🟨 PARTIAL | 2026-03-31 | IPC-level ✅; HTTP-level not started |
| **4E: `pd self-test --adversarial`** | 🔴 STALE | 2026-03-31 | Design complete; zero commits for 46 days |
| **4F: Windows IPC Hardening** | 🔴 STALE | 2026-03-31 | Design noted; zero commits for 46 days |
| **5: Network & Lighthouses** | 🔄 ARCHITECTURE | 2026-05-06 `60f72edd` | Relay PKI + Merkle-chain + `pd tube` + quorum primitives shipped; full lighthouse v0 not started |
| **6: Life Integration** | 🔄 ACTIVE | 2026-05-01 | Telos substrate landed; explicit suggestion layer remains open |

---

## Execution Wave (34 now-status items — curated markdown; tuple projection empty here, `open: 0`, `harvested: 11`)

**High-priority next cuts** (ordered by dependency/readiness):

1. **incremental-symbol-index-refresh** (Spark 2026-05-12) — ~150 LOC incremental file-write watcher; keeps graph conflict prediction current as files change
2. **symbol-graph-visualization** (Spark 2026-05-12) — ~4 hours; graph_edges visualization for Phase 1 operator visibility
3. **daemon-introspection-api** (Spark 2026-05-09) — ~150 LOC `GET /daemon/introspect`; unlocks Crew + Scorecard aggregation
4. **operator-hint-engine** (Spark 2026-05-11) — ~160 LOC decision layer; turns daemon anomalies into suggested next actions
5. **ideas-trove-queryable-surface** (Spark 2026-05-09) — ~180 LOC `pd ideas` CLI + HTTP API; unlocks trove dedupe enforcement
6. **orchestrator-plugin-lifecycle** (Spark 2026-05-12) — user-facing Phase 1.5 orchestrator loader; hot-loads custom routing logic without a daemon fork
7. **daemon-fleet-auto-recovery** (Spark 2026-05-13) — Phase 3 automation cut; persistent roles come back after daemon restart
8. **graph-integrity-auditor** (Spark 2026-05-13) — Phase 1 health cut; daily audit keeps graph quality trustworthy
9. **agent-skills-quality-gates** (Spark 2026-05-13) — Phase 2.5 bridge; validates skill trust before spawn confidence is trusted
10. **cost-forecast-alert** (Spark 2026-05-13) — Phase 2 forward-visibility cut; projects spend before budget surprises
11. **ipc-queue-saturation-promotion** (Spark 2026-05-13) — Phase 4B backpressure cut; saturation-aware spawn gating
12. **cost-gated-spawning** (Spark 2026-05-13) — Phase 2 spawn-time budget gate; enforces role budgets before runs start
13. **empirical-model-efficiency-routing** (Spark 2026-05-13) — Phase 2 efficiency routing; chooses the cheapest successful model from history
14. **operator-decision-journal** (Spark 2026-05-13) — Phase 2/3 governance trail; records approvals, overrides, and pauses
15. **sandboxed-adversarial-test-harness** (Spark 2026-05-13) — Phase 4E/4F isolated chaos harness; runs hardening tests off the live daemon
16. **claim-preserving-git-safety** (dogfood) — 2–3 days; wrap `git add -A` / `reset --hard` / `cherry-pick` with claim guardrails
17. **fleet-launchability-and-cadence** (dogfood) — 1–2 days; surface `launchable` vs `blocked` in spawn/preflight
18. **coordination-guard-extended-enforcement** (trove) — 2–3 days; extend from pre-commit to SessionStart + PreToolUse + destructive verbs
19. **crew-screen-roles-not-pids** (trove) — dashboard: replace agents-by-PID with fleet roles view
20. **fleet-health-scorecard** (trove) — dashboard: single glance for swarm health (role health, cost burn, queue depth, violations)
21. **coordination-ticker-as-high-signal-feed** (trove) — dashboard: live ticker for `coordination:inconsistency` channel
22. **quorum-driven-dynamic-launch** (trove; Phase 1 shipped in `cea02e1`) — Phase 2 dependency: auto-spawn declared spawnable-on-quorum roles
23. **ipc-disconnect-instant-salvage** (trove) — treat IPC activity as heartbeat, salvage on disconnect (not 10–20 min window)
24. **telos-driven-model-selection** (trove) — Phase 6: spawn-time suggestion layer without hiding model overrides
25. **graph-based-merge-conflict-predictor** (Spark 2026-05-11) — ~200 LOC semantic symbol-level conflict detection; prevents merge surprises
26. **ambient-anomaly-signaling** (Spark 2026-05-11) — monitoring + alerting for rare/anomalous Fleet patterns; unblock Phase 4 self-test diagnostics
27. **symbol-claim-isolation-validator** (IDEAS-TROVE 2026-05-12) — pre-flight Phase 1/4 claim-safety validator; catches symbol ownership conflicts before a new lock or merge attempt
28. **tuple-store-query-api** (trove, 2026-05-14) — Phase 3 queue-depth substrate for fleet-health-scorecard; exposes tuple backlog truth without raw tuple spill
29. **governance-coordination-hub** (trove, 2026-05-14) — Phase 3 governance rollup; unifies dispute, liquidation, and skills-vote signals into one view
30. **phase-3-auto-remediation-executor** (trove, 2026-05-14) — Phase 3 operational automation; executes operator-approved remediations after visibility and hints
31. **cost-aware-model-training-loop** (trove, 2026-05-14) — Phase 2 cost feedback loop; teaches routing from operator overrides and budget breaches
32. **unified-spawn-risk-synthesis** (trove, 2026-05-14) — Phase 4B preflight synthesis; combines cost, skill, dependency, harbor, and learning risk before spawn
33. **episodic-memory-query-surfaces** (trove, 2026-05-14) — Phase 3B memory surface; exposes cross-session recall/search across the already-shipped fleet/memory substrate
34. **orchestrator-decision-attribution** (Spark, 2026-05-16) — Phase 1.5 orchestrator observability; instrument decision path and surface routing decisions so operators can validate custom orchestrators are working correctly

---

## Unplanned Work (Where Energy Actually Went)

- May 1 (7 commits): Fleet-model / telos hardening cluster (`ffe098fe` through `2fc96f8b`) — agent telos contracts, shared backend resolver, YAML inheritance, coordination-judge, lease reclaim. Substrate for `telos-driven-model-selection` but not the full suggestion layer.
- May 1–2: Docs content fill (`/docs/concepts`, `/docs/best-practices`) — 15+ new leaf pages sourced from code.
- May 6: Docs/reference-architecture cleanup (`8a869a03`, `dc64054c`) — sidebar navigation map and operator examples tightened.
- May 3: Cost-tracker tier aliases (`1459c0d4`, `2ee5976a`) — claude-cli backend support.
- May 4–5: Whitepaper rewrite (`e5226d1a`, `f9a422f5`, `637cecce`) — clarity pass + v2.5 mechanization status appendix.
- May 6: Relay harbor mesh ADR (`60f72edd`, `48b6c54d`) — architecture documented.
- May 7: Phase 1 completion (`f265fcb5`) — semantic graph edges table with full schema, indexes, tests.
- May 8: Cartographer reflection pass (`2ad20f32`, `670ab97b`) — roadmap updates, status finalization.

**Signal**: Docs content, fleet-model tightening, and relay/harbor architecture are all escaping the formal V4 lanes but represent genuine product evolution.

---

## Feedback Pipeline & Harvest Status (2026-05-16 18:16 UTC)

- **Daemon tuple feedback**: ✅ available / empty — `pd roadmap --feedback-status open --json` reads successfully here; the live queue is `open: 0` after `11` harvested items. `pd feedback list --status open --json` still hits `EPERM` on `~/.port-daddy/daemon.sock` from this shell.
- **Curated entries (DOGFOOD-FEEDBACK.md)**: 5 total entries
  - now (2 at status=now): `claim-preserving-git-safety`, `fleet-launchability-and-cadence`
  - backlog (3 at status=backlog): `session-context-cwd-reset`, `feedback-route-stable-gap`, `fleet-status-skipped-duplicates`
- **Ideas-Trove now-status (IDEAS-TROVE.md)**: 37 curated now items; 32 trove entries are already in the execution wave above, and 5 additional now-status trove entries remain lower-priority backlog (`fleet-run-journal`, `salvage-root-cause-classifier`, `forensic-context-windows`, `tuple-driven-fleet`, `capability-discovery-dns-harbor`)
- **Raw .spark/feedback/**: Tree not present in this checkout; next auto-harvest pending on agent contribution or commit
- **Spark/Spider residue**: `.spark/ideas/` and `.spider/connections/` exist locally; Spark pass (2026-05-08) promoted `fleet-health-scorecard` and `telos-driven-model-selection`; Spark pass (2026-05-09) promoted `daemon-introspection-api` and `ideas-trove-queryable-surface` (both "now" candidates); the 2026-05-11 Spark promotion added `graph-based-merge-conflict-predictor` and `ambient-anomaly-signaling`; the 2026-05-12 Spark promotion added `symbol-graph-visualization`, `incremental-symbol-index-refresh`, `operator-hint-engine`, and `symbol-claim-isolation-validator`; the 2026-05-13 Spark promotion added `daemon-fleet-auto-recovery`, `graph-integrity-auditor`, `agent-skills-quality-gates`, `cost-forecast-alert`, and `ipc-queue-saturation-promotion`; the 2026-05-13 extended promotion added `cost-gated-spawning`, `empirical-model-efficiency-routing`, `operator-decision-journal`, and `sandboxed-adversarial-test-harness`; the 2026-05-14 promotion added `tuple-store-query-api`, `governance-coordination-hub`, `phase-3-auto-remediation-executor`, `cost-aware-model-training-loop`, and `unified-spawn-risk-synthesis`, and the 2026-05-14 Spark promotion surfaced `episodic-memory-query-surfaces` as the Phase 3B memory cut, while `skill-degradation-contagion-early-warning` stayed backlog; the 2026-05-10 raw exhaust now remains as `S41`/`S42`/`S43` and is still uncurated
- **Trove-to-roadmap promotion**: 39 items in the curated snapshot (34 now-status items: 2 dogfood + 32 trove in the execution wave; 5 lower-priority now-status trove entries not yet scheduled)
- **Next harvest**: 2026-05-13 extended promotion complete (4 Spark ideas promoted); next automatic harvest on next commit via `pd feedback` daemon tuple stream when available, or when `.spark/feedback/` tree is populated

---

## Health Signals

| Metric | Status | Notes |
|--------|--------|-------|
| Test Suite | ✅ All passing | `npm test` baseline maintained |
| Velocity | ✅ 1.3/day (9 commits) | Stable post-May-1-burst. Previous burst: May 1-2 (7 commits fleet-model, 15+ docs content, cost-tracker aliases). |
| Phase 1 Completion | ✅ VERIFIED (2026-05-07 `f265fcb5`) | graph_edges table + 6 indexes + full schema + tests + MCP. Reflection pass `2ad20f32` completed 2026-05-08. |
| Blocking Dependencies | 🔴 Phase 2 economist (47 days idle) | Thomas Youle / pricing function π — no follow-up since 2026-03-30. |
| Stale Phases | 🔴 Phase 4E/4F (46 days) | Phase 4A is active off-main on feature branches; Windows IPC/self-test remains design-only. |
| Coordination Guard | ✅ Enforce mode in stable | `.portdaddy/coordination-guard.json` live. Extended enforcement (SessionStart/PreToolUse/destructive-git) is #2 execution priority. |
| Daemon Tuple Feedback | ✅ available / empty | `pd roadmap --feedback-status open --json` reads successfully here; the live queue is `open: 0` after `11` harvested items. `pd feedback list --status open --json` still hits `EPERM` on `~/.port-daddy/daemon.sock` from this shell. |
| Unplanned Work Signal | 🟨 Healthy leak | Cartographer verification / status reconciliation (`f4624ebd`, `05e94639`, `3b9d17ce`, `e6bd1b88`, `670ab97b`, `f0398b9a`, `857f225c`, `d017bc28`, `bbbd19be`, `4e2a9f01`) plus May 1 fleet-model/telos hardening (7 commits); origin/main release-prep / metrics / docs-polish work (`e254b047`, `0927aa28`, `4dc0818c`, `7ec3ad17`, `350f881d`, `5ca3b567`, `82a75872`, `0909c87d`, `973471ea`, `5d2bfdc4`); feature-branch Phase 4A binary / doctor work (`6a8c8bb1`, `0d99bdfe`, `cd283478`, `72461802`); docs content fill (15+ pages); relay/harbor mesh ADR; whitepaper rewrite plus proof/conformance follow-through (`18198c46`, `36af999b`, `d4484135`, `e973bbd2`, `8ea60834`, `27dce34f`, `b4a0fe50`); the 2026-05-11 Spark promotion (`5ee873cd`); the 2026-05-13 extended Spark promotion (`bbbd19be`); the fresh 2026-05-10 raw Spider exhaust (`S41/S42/S43`); and the fresh 2026-05-16 raw Spark/Spider exhaust, all adding product signal outside named V4 phases. |

---

## Newly Discovered Work (2026-05-14 Cartographer Pass)

**Phase 4A Binary Distribution** — RESUMED and ACTIVE off-main
- `0f3e2fbe` (2026-05-14): skeptical-reviewer ship-blocker fixup for the binary daemon
- `6a8c8bb1` (2026-04-01): Bun binary release scaffolding + binary GH Actions
- `0d99bdfe` (2026-05-14): sign-and-notarize.mjs wrapper for binary daemon
- `cd283478` (2026-05-14): doctor feature — LaunchAgent plist detection + resource diagnostics
- `72461802` (2026-05-14): detect stale LaunchAgent plists + show resource-dir breakdown
- **Signal**: Distribution work is active on feature branches, while `origin/main` is spending its release energy on v3.14.0 prep / metrics / docs polish

**Appendix A5/A6 Economic Simulation** — NOW IN EXECUTION
- `631118fb` (2026-05-13): cuckoo filter + pollution-resistance property test (A3)
- `427353f7` (2026-05-14): A5 Sybil attack + A6 cartel folk-theorem sims (§8.4.4 extension)
- **Signal**: Swarm economics proofs are now part of the execution wave, not just aspirational appendix

**Phase 6 Hero Component Updates** — ACTIVE
- `57c2ff9c` (2026-05-14): remove evaluator-signal strip and preview pill
- `19cb2ab6` (2026-05-14): add Fleet Control Center onboarding walkthrough
- **Signal**: Hero component simplification and UX hardening ongoing

**Phase 3D Fleet UI** — IN PROGRESS (uncommitted)
- Branch: `feat/fleet-ui-metrics-tab`
- Latest: `4244c971` (Copilot review fixes)
- **Signal**: Metrics tab WIP on feat branch, not yet merged to main

**Release/CI Work Surge** — UNPLANNED ENERGY ALLOCATION
- v3.14.0 release prep on `origin/main` (bump, bun-install workflow, release playbook rewrite, Metrics tab, dashboard metrics wiring, docs/storybook voice cleanup)
- 35 commits on `origin/main` are not in stable; stable also has 117 commits not in `origin/main`
- **Signal**: Release prep and operator-surface polish are consuming real capacity, but they are not V4 phase work

**Fresh 2026-05-16 Spark Ideas** — CURATED TO EXECUTION WAVE
- `orchestrator-decision-attribution` (Phase 1.5 unlocker): instrument orchestrator.decide() to emit attribution tuples and surface decision history via API. Enables operators to validate custom orchestrators work correctly. Promotes from `.spark/ideas/2026-05-16-orchestrator-decision-attribution.md`.
- `symbol-staleness-merge-safety` (Phase 3 extension): wire symbol-index staleness into daemon-introspection-api and emit operator hints when merge predictions become unreliable. Marked as EXTENDS: operator-hint-engine rather than standalone backlog slug. Promotes from `.spark/ideas/2026-05-16-symbol-staleness-merge-safety.md`.
- **Signal**: Fresh Spark pass captured two new ideas; one (orchestrator-decision-attribution) survives novelty gate and enters execution wave; one (symbol-staleness-merge-safety) is correctly scoped as an extension rather than a new backlog entry.

---

**Authority**: committed code + git log > curated markdown (recovery hub) > raw files (.spark)
