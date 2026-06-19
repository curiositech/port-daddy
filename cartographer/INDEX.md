# Cartographer Index — 2026-06-19T23:47:00Z

**Authority**: committed code + git log > curated markdown (recovery hub) > raw files (.spark)

**Latest snapshot**: origin/main `3ca3931f` (feat(install): prefetch embedding model); cartographer-state HEAD `42d820b2` (digest snapshot); divergence **1490 commits**. Live tuple-backed feedback queue empty (`open: 0`, `harvested: 11`). Fresh 2026-06-19 Spider waves 1-12 on disk (14 connection files), uncurated pending Spark/Spider dedupe pass.

---

## Phase Summary

| Phase | Status | Key Notes |
|-------|--------|-----------|
| **0: Formal Foundation** | ✅ COMPLETE | White papers, Rust core (harbor-card-rs), Arbiter, PKI, Coordination Guard, Merkle-chain, Bosun supervisor all shipped v3.8.2+ |
| **1: Semantic Graph** | ✅ COMPLETE | graph_edges table with 6 indexes, full schema, MCP tools live. Verification `f265fcb5` (2026-05-07) + reflection pass `2ad20f32` (2026-05-08) |
| **2: Economy & Cost** | 🔄 INFRASTRUCTURE READY | cost-tracker + counters + observability endpoints ✅ shipped v3.8.3; pricing function π **81 days idle** (since 2026-03-30). Cost data pipeline live; awaiting economist contact. |
| **3: Fleet & Memory** | 🔥 **HOTTEST MAPPED PHASE** | 3A: declarative fleet ✅; 3B: episodic-memory-query-surfaces queued now; 3D: Fleet Live dashboard evolved; 13 Phase 3 visibility/automation items in execution wave (2026-05-14 promotion). Phase 3 highest-ROI lane this quarter. |
| **4: Resilience & Performance** | 🟨 PARTIAL | 4A: Fastify ✅ + Bun binary/doctor ACTIVE on feature branches (5 commits, not yet promoted); 4B/4C: Complete (IPC v3.8.2, Radix Trie v3.8.1); 4D: Partial (IPC ✅, HTTP pending); 4E/4F: Stale 80+ days |
| **5: Network & Lighthouses** | 🔄 ARCHITECTURE | Relay PKI + Merkle-chain + `pd tube` + quorum primitives shipped; full lighthouse v0 not started |
| **6: Life Integration** | 🔄 ACTIVE | Telos substrate shipped; `telos-driven-model-selection` suggestion layer queued now |

---

## Top 3 Closest to Completion

1. **`incremental-symbol-index-refresh`** (Phase 1 supporting)
   - ~150 LOC incremental file-write watcher
   - Keeps Phase 1 graph conflict prediction current as files change
   - Spark 2026-05-12; high readiness

2. **`symbol-graph-visualization`** (Phase 1 operator visibility)
   - ~4 hours to implement
   - Force-directed visualization of graph_edges for Phase 1 graph explorer
   - Makes Phase 1 infrastructure legible (not query-only)
   - Spark 2026-05-12; high readiness (schema live)

3. **`daemon-introspection-api`** (Phase 3 foundation)
   - ~150 LOC `GET /daemon/introspect` unified health endpoint
   - Unlocks fleet-health-scorecard and crew-screen-roles-not-pids
   - Spark 2026-05-09; high readiness

---

## Top 3 Blocked or Drifting

1. **Phase 2 Economist** (⚠️ **81 days idle**)
   - Thomas Youle (Indiana U) proposed insurer-agent auction 2026-03-30
   - **No follow-up contact since initial proposal**
   - Cost-tracker infrastructure complete with live data available now
   - **Unblock:** Operator outreach required; cost pipeline ready to feed data

2. **Phase 4A Binary Distribution** (🟡 **Active but blocked off-main**)
   - 5 commits ready on `feat/binary-distribution-daemon-unblock` and `feat/doctor-binary-daemon-diagnostics`
   - Bun binary release + sign-and-notarize + LaunchAgent doctor diagnostics all ready
   - **Blocker:** origin/main spending energy on release-prep / metrics / docs-polish, not absorbing binary lane
   - **Signal:** v3.19.0 Parley + v3.20.0 Coast Guard + auto-freshness consuming merge bandwidth

3. **Phase 4E & 4F Stale** (🔴 **80+ days since 2026-03-31**)
   - 4E: `pd self-test --adversarial` — design complete, zero commits
   - 4F: Windows Named Pipe IPC hardening — design noted, zero commits
   - **Unblock:** `sandboxed-adversarial-test-harness` (2026-05-13 Spark promotion, now in execution wave) enables 4E/4F implementation

---

## Recent Commits (Last 7 Days — Unmapped to Roadmap)

**All energy on cartographer-state is Cartographer self-snapshots.** 
Last 19 commits on cartographer-state: all digest/index snapshots or verification passes (2026-06-19 19:56 UTC through 23:47 UTC).

**On origin/main (mapped category summary):**
- v3.19.0 Parley + v3.20.0 Coast Guard: ADR-0061 embedding prefetch, ADR-0058 durable transcripts, ADR-0057 release orchestration, ADR-0062 auto-freshness, ADR-0084 phase 2/3 daemon identity + release cuts
- Metrics/FleetBar/docs polish: Absorbed merge capacity intended for Phase 4A binary work

**Pattern**: Release cycles + operator-surface polish = genuine product energy (visibility/governance), but consuming main's merge bandwidth. Phase 4A feature branches idle waiting for main lane.

---

## Open Dogfood Feedback at `now` Status

**Count: 2 items**

| Slug | Status | Next Cut | Estimate |
|------|--------|----------|----------|
| `claim-preserving-git-safety` | now | Safe `pd add` + destructive-git guardrails that consult live claims before bulldozing another session's edits. Wrap `git add -A`, `reset --hard`, `cherry-pick`. | 2–3 days |
| `fleet-launchability-and-cadence` | now | Surface `launchable` vs `blocked` truth in `pd status` and spawn/preflight output. Unblocks fleet readiness visibility. | 1–2 days |

**Tuple projection status**: Live daemon queue empty (`open: 0`, `harvested: 11`). No new `.spark/feedback/` tree in this checkout.

---

## Execution Wave Snapshot (34 Items)

**Full list in `docs/recovery/CURRENT-WORK.md`** (LOC estimates, blocking deps, phase associations).

**Grouped by readiness window:**

- **Phase 1–3 infrastructure (10 items, 1–2 week span):**
  1. `incremental-symbol-index-refresh`
  2. `symbol-graph-visualization`
  3. `daemon-introspection-api`
  4. `operator-hint-engine`
  5. `ideas-trove-queryable-surface`
  6. `orchestrator-plugin-lifecycle`
  7. `daemon-fleet-auto-recovery`
  8. `graph-integrity-auditor`
  9. `agent-skills-quality-gates`
  10. `cost-forecast-alert`

- **Phase 2–4 spawning & cost (8 items, 1–2 week span):**
  11–18: cost-gated-spawning, empirical-model-efficiency-routing, operator-decision-journal, cost-aware-model-training-loop, ipc-queue-saturation-promotion, sandboxed-adversarial-test-harness, unified-spawn-risk-synthesis, claim-preserving-git-safety

- **Phase 3 visibility & governance (8 items, 1–2 week span):**
  19–26: fleet-launchability-and-cadence, crew-screen-roles-not-pids, fleet-health-scorecard, coordination-ticker-as-high-signal-feed, tuple-store-query-api, governance-coordination-hub, phase-3-auto-remediation-executor, episodic-memory-query-surfaces

- **Phase 1–4 refinement (8 items, 2–3 week span):**
  27–34: graph-based-merge-conflict-predictor, ambient-anomaly-signaling, symbol-claim-isolation-validator, quorum-driven-dynamic-launch, ipc-disconnect-instant-salvage, telos-driven-model-selection, orchestrator-decision-attribution, coordination-guard-extended-enforcement

---

## Fresh Spider Research Harvest (2026-06-19)

**14 connection files** discovered in `.spider/connections/` (waves 2-14 + base):
- `2026-06-19-connections-wave-2.md` through `2026-06-19-connections-wave-14.md`
- `2026-06-19-connections.md` (base)

**Status**: Uncurated. Pending Spark/Spider dedupe pass and novelty-gate filtering into `docs/recovery/IDEAS-TROVE.md`.

**Last curated Spark promotion**: 2026-05-16 (`orchestrator-decision-attribution` added to execution wave).

---

## Planning Conflicts Published

**Channel: `coordination:inconsistency`**

1. **Phase 4A vs Release Cycle Energy** — Binary/doctor work ready off-main but blocked awaiting merge lane. v3.19.0 Parley + v3.20.0 Coast Guard + auto-freshness consuming bandwidth. Phase 4A 5 commits idle on feature branches.

2. **Phase 2 Economist Stale** — 81 days without Thomas Youle contact. Cost infrastructure complete with live data available now. Pricing function π is the only remaining Phase 2 blocker.

3. **Cartographer Branch Divergence** — cartographer-state carries roadmap snapshots not in main (12+ commits behind vs 1490 commits ahead). Roadmap updates POSTing to detached branch instead of feeding PR lane.

4. **Phase 3 Lane Congestion** — 13 items queued in Phase 3 visibility/automation. May get crowded by release-prep energy if main stays in release mode. Phase 3 is highest-ROI lane; recommend protecting merge lane for Phase 3 execution.

5. **Fresh Spider Exhaust Uncurated** — 14 connection files on disk (2026-06-19 waves 1-14). Awaiting Spark/Spider curation; no new ideas promoted to execution wave since 2026-05-16.

---

## Key Signals for Operator

| Signal | Status | Recommended Action |
|--------|--------|-------------------|
| **Phase 1 verified complete** | ✅ | Maintain graph integrity; no work needed. Monitor via daily `graph-integrity-auditor` (queued now). |
| **Phase 2 awaiting economist** | 🔴 | Operator: follow up with Thomas Youle. Cost infrastructure ready; pricing function is only blocker. |
| **Phase 3 hottest lane** | 🔥 | 13 queued items span visibility/automation. Highest-ROI for Q2. Protect merge lane to prevent congestion. |
| **Phase 4A binary ready** | 🟡 | Feature branches have 5 commits ready. Await main merge lane availability. Do not hand-merge; use PR process. |
| **Coordination Guard enforce mode** | ✅ | Live in stable; extended enforcement (SessionStart/PreToolUse/destructive-git) is execution-wave priority #2 after daemon-introspection-api. |
| **Dogfood feedback queue** | ✅ (empty) | Tuple projection available but empty. No new `.spark/feedback/` files. Fresh 2026-06-19 Spider waves 1-14 pending curation. |
| **Unplanned work consuming capacity** | 🟨 | Release cycles (Parley, Coast Guard, auto-freshness) + operator-surface polish = genuine product energy but consuming main's merge bandwidth. Phase 3 items may need separate lane. |

---

## Cartographer Process Notes

**Last pass**: 2026-06-19 23:47 UTC

- **Authority sources**: committed code ✅, git log ✅, V4-UNIFIED-ROADMAP.md ✅, docs/recovery/UNIFIED-ROADMAP.md ✅, raw .spider/connections ⏳ (14 new files, uncurated)
- **New dogfood feedback**: No new `.spark/feedback/` files found
- **34 now-status items**: Verified live in execution wave; sorted by dependency & readiness
- **Phase 3 status**: Confirmed hottest lane with 13 visibility/automation items; highest-ROI this quarter
- **Phase 4A status**: Binary work confirmed active on feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`); 5 commits ready; awaiting main merge lane
- **Phase 2 economist**: 81 days since contact (2026-03-30); cost pipeline now live and producing real data; unblocking requires operator outreach
- **Fresh Spider exhaust**: 2026-06-19 waves 1-14 on disk (14 connection files); pending Spark/Spider curation and novelty-gate filtering into IDEAS-TROVE

**Deferred to next pass:**
- Fresh Spider exhaust curation and novelty-gate filtering into IDEAS-TROVE
- Phase 4A feature branch promotion status (when merge lane becomes available)
- Phase 2 economist contact follow-up results
- Phase 3 lane capacity/congestion monitoring as release energy subsides

---

**Cartographer Authority:** Roadmap snapshot derived from committed code, git log, and curated markdown recovery hub. Canonical planning documents live in `docs/recovery/`. This index is a glyph for operator visibility — not the editability surface.
