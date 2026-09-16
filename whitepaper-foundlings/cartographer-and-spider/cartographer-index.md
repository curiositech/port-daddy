# Cartographer Index — 2026-06-15T00:30:00Z

**Map Authority:** docs/V4-UNIFIED-ROADMAP.md (historical) → docs/recovery/UNIFIED-ROADMAP.md (2026-05-15, active execution authority)

**Current Release:** v3.18.0 (2026-06-05) — Coast Guard safety + tube router multi-backend

**Session Date:** 2026-06-15 (Cartographer mapping pass)

---

## Phase Summary

| Phase | Status | Last Update | Key Items |
|-------|--------|-----|-----------|
| **0: Foundation** | ✅ COMPLETE | 2026-03-31 | Anchor Protocol, Bonded Commons, Merkle chain, Arbiter, PDI, proofs all verified |
| **1: Semantic Graph** | ✅ COMPLETE | 2026-05-07 | `graph_edges` migration (f265fcb5), symbol index, `lib/db.ts` CORE_SCHEMA_SQL fully wired |
| **1.5: Graph Tooling** | 🔥 ACTIVE | 2026-05-12+ | `symbol-graph-visualization`, `incremental-symbol-index-refresh`, `orchestrator-plugin-lifecycle`, 5 curated candidates ready |
| **2: Economy** | ⏸️ IDLE 47d | 2026-04-06 | Cost-tracker + counters + `/metrics/*` shipped; economist (Thomas Youle) unresponsive since 2026-03-30 |
| **3: Fleet & Memory** | 🔥 HOTTEST | 2026-05-15+ | `daemon-introspection-api`, `crew-screen-roles-not-pids`, `fleet-health-scorecard`, `episodic-memory-query-surfaces`, 10 curated items |
| **4A: Bun/Fastify** | ⚠️ ACTIVE OFF-MAIN | 2026-05-15 | Feature branches carry v3.14.0 work; NOT on origin/main or stable |
| **4B/4C: Resilience** | ✅ SHIPPED | 2026-03-31 | Fastify ✅, Radix Trie ✅, Binary IPC ✅, backpressure ✅ |
| **4E/4F: Adversarial** | ❌ STALE 46d | 2026-03-31 | Design complete, zero commits; unstarted |
| **5: Architecture** | 📋 GROUNDWORK | 2026-05-15 | Relay PKI, quorum, daemon profiles shipped; Accounts Arc active |
| **6: Telos** | 🔥 ACTIVE | 2026-05-15+ | Model selection, suggestion layer, substrate activation research phase |

---

## Top 3 Closest to Completion

1. **`incremental-symbol-index-refresh`** (Phase 1 tooling)
   - ~150 LOC filesystem watcher + graph update
   - Unblocks merge-risk prediction staying current as files change
   - Depends: Phase 1 complete ✅

2. **`symbol-graph-visualization`** (Phase 1 operator surface)
   - ~4 hours visual graph explorer + export route
   - Enables graph-backed merge-risk legibility
   - Depends: Phase 1 complete ✅

3. **`daemon-introspection-api`** (Phase 3 visibility)
   - ~150 LOC unified endpoint for daemon health
   - Unblocks crew-screen-roles-not-pids + fleet-health-scorecard
   - Depends: daemon health monitoring infrastructure ✅

---

## Top 3 Blocked / Drifting

1. **Phase 2 Economy: Pricing Function π**
   - Economist (Thomas Youle) unresponsive **47 days** (since 2026-03-30)
   - Cost-tracker + counters + observability complete; pricing design awaited
   - **Unblock:** direct contact / alternate economist / operator override

2. **Phase 4A Binary / Doctor / Distribution**
   - Feature branches carry v3.14.0 work, NOT promoted to origin/main or stable
   - 5 commits on branches, 35 commits behind origin/main
   - **Unblock:** merge binary/doctor branch, rebase stable, cut v3.19.0

3. **Phase 4E/4F: Adversarial Testing & Windows IPC**
   - Zero commits since 2026-03-31 (**46 days**, longest stale block)
   - Design complete; implementation not started
   - **Unblock:** prioritize over Phase 4A release bundling

---

## Planning Conflicts Detected

### 🔴 CONFLICT: Planned Phase 3 Visibility vs Actual Energy to Phase 4/0 Hardening

**Signal:** v3.18.0 (2026-06-05) shipped Coast Guard safety + tube router (Phase 0 security + Phase 4 resilience), not Phase 3 visibility.

**Analysis:** Hardening is a genuine prerequisite for production fleet. But roadmap planned Phase 3 as next cut, operator chose Phase 0/4 instead. Correct priority (safety before breadth), but V4 phases need resequencing.

**Recommendation:** Resequence Phase 3 as Phase 3.1 (hardening prerequisites, complete) → Phase 3.2 (visibility, next cut).

### 🟡 CONFLICT: Phase 4A Binary Distribution Still Off-Main

**Signal:** Binary/doctor work on feature branches, not promoted. v3.18.0 shipped green from main but users still installing from source.

**Recommendation:** Merge binary/doctor branches into main, rebase stable, cut v3.19.0 with binary distribution.

### 🟡 CONFLICT: Economist Idle 47 Days, Phase 2 Stalled

**Signal:** Cost-tracker shipped; pricing function π awaits economist (Thomas Youle).

**Analysis:** Without pricing function, no budget enforcement, no spawn-gated cost, no efficiency routing. Economy is a shell.

**Recommendation:** Pursue alternate: (a) contact economist again, (b) hire interim, (c) operator specifies default pricing, (d) defer Phase 2 and ship Phase 3 visibility first.

---

## Curated Execution Wave (34 Now-Status Items)

**Phase 1 Tooling (5):** incremental-symbol-index-refresh, symbol-graph-visualization, symbol-claim-isolation-validator, orchestrator-plugin-lifecycle, graph-integrity-auditor

**Phase 2 Cost & Routing (6):** cost-forecast-alert, cost-gated-spawning, empirical-model-efficiency-routing, cost-aware-model-training-loop, ambient-anomaly-signaling, agent-skills-quality-gates

**Phase 3 Visibility & Automation (12) ← HOTTEST:** daemon-introspection-api, daemon-fleet-auto-recovery, crew-screen-roles-not-pids, fleet-health-scorecard, coordination-ticker-as-high-signal-feed, tuple-store-query-api, governance-coordination-hub, phase-3-auto-remediation-executor, operator-hint-engine, operator-manual-fleet-dispatch, tuple-driven-fleet, episodic-memory-query-surfaces

**Phase 3 Graph & Predictive (2):** graph-based-merge-conflict-predictor, ideas-trove-queryable-surface

**Phase 4 Hardening & Preflight (4):** unified-spawn-risk-synthesis, ipc-queue-saturation-promotion, sandboxed-adversarial-test-harness, quorum-driven-dynamic-launch

**Dogfood Immediates (2):** claim-preserving-git-safety, fleet-launchability-and-cadence

**Phase 1/3 Intersection (3):** coordination-guard-extended-enforcement, ipc-disconnect-instant-salvage, salvage-root-cause-classifier

---

## Open Dogfood Feedback (2 items, "now" status)

1. **`claim-preserving-git-safety`**
   - Advisory claims steamrolled by `git add -A` / `git reset --hard` / `git cherry-pick`
   - Next cut: `pd add` safe path + destructive-verb guardrails

2. **`fleet-launchability-and-cadence`**
   - Launchability state hidden behind cadence routing + channel-slug drift + wallet gate
   - Next cut: surface `launchable` vs `blocked` in `pd status`, show exact blocking gate

**Live tuple-backed feedback queue:** Empty (`open: 0`, `harvested: 11`)

---

## Velocity & Burndown

| Metric | Value | Trend |
|--------|-------|-------|
| Commits (last 7d) | ~9 est. | ↘️ Post-burst |
| Execution wave items | 34 now | → Stable |
| Blocked items | 3 | ↗️ +1 (binary not merged) |
| Active phases | 3 hot (1.5, 3, 6) | → Stable |

---

## Map Metadata

- **Authority:** git log → committed code → V4-UNIFIED-ROADMAP.md
- **Cartographer owner:** Fleet agent in `pd-fleet.yml`, triggered on `git:committed`
- **Fresh research:** 2026-05-16 raw Spark/Spider exhaust present but uncurated
- **Feedback queue:** Empty; no `.spark/feedback/` tree on this checkout
- **Last full audit:** 2026-05-16 18:16 UTC
- **This snapshot:** 2026-06-15 00:30 UTC

