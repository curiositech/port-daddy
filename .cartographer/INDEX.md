# Cartographer Index — 2026-06-19T22:30:00Z

**Authority**: committed code + git log > curated markdown (recovery hub) > raw files (.spark)

**Update Summary**: Cartographer scanned daemon feedback queue; discovered 8 open now-status roadmap items (ADR-0050 4-phase security/accountability suite + idea-intake-consult-core + mcp-parity + swarm-coordination-parley). Previous pass showed empty tuple projection (`open: 0`); this pass shows active execution planning for security accountability. Phase 3 visibility remains hottest mapped lane. v3.20.0 Coast Guard and v3.19.0 Parley shipped on origin/main; binary work still active on feature branches.

---

## Phase Summary

| Phase | Status | Notes |
|-------|--------|-------|
| **0: Formal Foundation** | ✅ COMPLETE | White papers, Rust core (harbor-card-rs), Arbiter (6 invariants), note encryption, Merkle-chain, PKI, Coordination Guard, quorum primitives all shipped |
| **1: Semantic Graph** | ✅ COMPLETE (2026-05-07) | `graph_edges` table with 6 indexes, full schema, tests, MCP tools live. Verification pass `2ad20f32` completed |
| **2: Economy & Cost** | 🔄 INFRASTRUCTURE READY | cost-tracker + counters + observability endpoints all working (v3.8.3); pricing function π from economist still idle **81 days** (since 2026-03-30) |
| **3: Fleet & Memory** | 🔥 HOTTEST MAPPED PHASE | 3A declarative fleet ✅; 3B episodic-memory-query-surfaces queued now; 3D fleet UI evolved; 5 curated Phase 3 visibility/automation items in active execution wave |
| **4: Resilience & Performance** | 🟨 PARTIAL | 4A fastify ✅ + bun binary ACTIVE on feature branches; 4B/4C complete; 4D partial (IPC ✅, HTTP pending); 4E/4F stale 80+ days |
| **5: Network & Lighthouses** | 🔄 ARCHITECTURE GROUNDWORK | Relay PKI + Merkle-chain + `pd tube` + quorum primitives shipped; full lighthouse v0 not started |
| **6: Life Integration** | 🔄 ACTIVE | Telos substrate landed; explicit `telos-driven-model-selection` suggestion layer remains open |

---

## Top 3 Closest to Completion

1. **`daemon-introspection-api`** (Spark 2026-05-09) — ~150 LOC `GET /daemon/introspect` endpoint. Unlocks Crew panel + Fleet Health Scorecard aggregation. Readiness: high (well-scoped, no dependencies).

2. **`symbol-graph-visualization`** (Spark 2026-05-12) — ~4 hours; Phase 1 graph_edges visual panel. Operators can see contention instead of only querying. Readiness: high (graph schema live).

3. **`incremental-symbol-index-refresh`** (Spark 2026-05-12) — ~150 LOC filesystem-driven file-watch watcher. Keeps merge-risk predictions current as code changes. Readiness: high (symbol-index.ts exists).

---

## Top 3 Blocked / Drifting

1. **Phase 2 Pricing Function π** — Economist (Thomas Youle, Indiana U) **81 days idle** since 2026-03-30. No follow-up. Cost-tracker infrastructure is ready; pricing awaits. **Blocker: operator follow-up required**.

2. **Phase 4A Binary Distribution** — ACTIVE on feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`) with 5 commits (Bun binary, sign-and-notarize, doctor diagnostics). **Blocker: not yet promoted to `origin/main`**. Release-prep energy on main is spending capacity on v3.20.0 Coast Guard / v3.19.0 Parley + metrics/docs/console instead.

3. **Phase 4E/4F Stale** — `pd self-test --adversarial` (4E) and Windows IPC hardening (4F) have **zero commits for 80+ days**. Unblocked by `sandboxed-adversarial-test-harness` (queued now). Design complete; implementation pending.

---

## Recent Commits Unmapped to Roadmap (Last 7 Days)

| Commit | Summary | Category |
|--------|---------|----------|
| `e6555cd7` | cartographer: digest snapshot 2026-06-19 19:34 UTC | Meta (Cartographer) |
| `f3dd5eb4` | cartographer: digest snapshot 2026-06-19 23:45 UTC | Meta (Cartographer) |
| `05787b9c` | cartographer: index snapshot for 2026-06-19 23:30 UTC | Meta (Cartographer) |
| `995d82c2` | cartographer: refresh roadmap snapshot for 2026-06-19 18:30 UTC | Meta (Cartographer) |
| `b47f8fd9` | cartographer: refresh index snapshot for 2026-06-19 23:00 UTC | Meta (Cartographer) |

**Signal**: All recent energy on `cartographer-state` is the Cartographer agent itself refreshing snapshots. `origin/main` has not received shipboard Phase 4A or release-readiness work yet.

---

## Open Roadmap Items at `now` Status

**Count**: 8 entries (7 unique slugs)

| Slug | Status | Category | Summary |
|------|--------|----------|---------|
| `idea-intake-consult-core` | now | ADR-0085 Phase 1a | Pure consult/disposition core for Cartographer idea-intake grammar; semantic relatedness, dedup, clash-read, auto-commit/HiTL |
| `swarm-coordination-parley` | now | Release 3.19.0 | Fleet coordination governance: fit gate, council tally, tuple-backed parley, guard-enforced receipts, skill grafts (v3.19.0 shipped) |
| `mcp-parity-no-copouts` | now | Infrastructure | Agents are first-class MCP consumers; 19 tools/5 categories batch complete; genuine exemptions only (security/lifecycle) |
| `adr-0050-phase-0-pd-cutter-wrapper` | now | ADR-0050 | Phase 0: signed outcome wrapper for custody handoff and release attestation |
| `adr-0050-phase-1-secret-broker` | now | ADR-0050 | Phase 1: secrets vault with TTL enforcement, audit trail, revocation |
| `adr-0050-phase-2-dollar-metering` | now | ADR-0050 | Phase 2: token-backed metering, burn-on-spawn, budget-aware gating |
| `adr-0050-phase-3-signed-outcome-format` | now | ADR-0050 | Phase 3: signed outcome format for machine-verifiable custody and settlement |

**Tuples Projection**: Live tuple-backed feedback queue shows 8 open, 11 harvested. No new `.spark/feedback/` files found this pass. Fresh 2026-06-19 Spider waves 1-12 on disk but uncurated pending dedupe.

**New Dogfood Feedback at `now` Status** (from earlier pass):

| Slug | Status | Provenance | Summary |
|------|--------|-----------|---------|
| `claim-preserving-git-safety` | now | dogfood | Wrap `git add -A`, `reset --hard`, `cherry-pick` with claim guardrails; prevent silent bulldoze of other sessions' edits (2–3 days) |
| `fleet-launchability-and-cadence` | now | dogfood | Surface `launchable` vs `blocked` truth in `pd status` and spawn/preflight output; unblocks fleet readiness visibility (1–2 days) |

---

## Execution Wave Status (34 Items)

**Phase 1–3 infrastructure (10 items — 1–2 week span)**:
1. `incremental-symbol-index-refresh` (Phase 1)
2. `symbol-graph-visualization` (Phase 1)
3. `daemon-introspection-api` (Phase 3 visibility)
4. `operator-hint-engine` (Phase 3)
5. `ideas-trove-queryable-surface` (Phase 1)
6. `orchestrator-plugin-lifecycle` (Phase 1.5)
7. `daemon-fleet-auto-recovery` (Phase 3)
8. `graph-integrity-auditor` (Phase 1)
9. `agent-skills-quality-gates` (Phase 2.5)
10. `cost-forecast-alert` (Phase 2)

**Phase 2–4 spawning & cost (8 items — 1–2 week span)**:
11. `cost-gated-spawning` (Phase 2)
12. `empirical-model-efficiency-routing` (Phase 2)
13. `operator-decision-journal` (Phase 2/3)
14. `cost-aware-model-training-loop` (Phase 2)
15. `ipc-queue-saturation-promotion` (Phase 4B)
16. `sandboxed-adversarial-test-harness` (Phase 4E/4F unlocker)
17. `unified-spawn-risk-synthesis` (Phase 4B)
18. `claim-preserving-git-safety` (dogfood)

**Phase 3 visibility & governance (8 items — 1–2 week span)**:
19. `fleet-launchability-and-cadence` (dogfood)
20. `crew-screen-roles-not-pids` (Phase 3 Crew panel)
21. `fleet-health-scorecard` (Phase 3 Scorecard)
22. `coordination-ticker-as-high-signal-feed` (Phase 3)
23. `tuple-store-query-api` (Phase 3)
24. `governance-coordination-hub` (Phase 3)
25. `phase-3-auto-remediation-executor` (Phase 3)
26. `episodic-memory-query-surfaces` (Phase 3B)

**Phase 1–4 infrastructure refinement (8 items — 2–3 week span)**:
27. `graph-based-merge-conflict-predictor` (Phase 1/4)
28. `ambient-anomaly-signaling` (Phase 2/4)
29. `symbol-claim-isolation-validator` (Phase 1/4)
30. `quorum-driven-dynamic-launch` (Phase 2)
31. `ipc-disconnect-instant-salvage` (Phase 4B)
32. `telos-driven-model-selection` (Phase 6)
33. `orchestrator-decision-attribution` (Phase 1.5)
34. `coordination-guard-extended-enforcement` (Phase 3/4)

---

## Key Signals

| Signal | Status | Next Action |
|--------|--------|-------------|
| **Phase 1 verified complete** | ✅ | Maintain graph integrity; no work needed. |
| **Phase 2 awaiting economist** | 🔴 | Operator: follow up with Thomas Youle on pricing function π. Cost infrastructure is ready. |
| **Phase 3 is hottest lane** | 🔥 | 13 queued now items span visibility/automation; Phase 3 is the highest-ROI lane this quarter. |
| **Phase 4A binary active off-main** | 🟨 | Feature branches have 5 commits; await merge to main via PR. Release prep is consuming main's energy. |
| **New: ADR-0050 security suite** | 🆕 8 now items | Custody/settlement accountability: pd-cutter-wrapper (phase 0) → secret-broker (phase 1) → dollar-metering (phase 2) → signed-outcome-format (phase 3). High-priority roadmap inflation. |
| **Coordination Guard enforce mode** | ✅ | Live in stable; extended enforcement (SessionStart/PreToolUse/destructive-git) is #2 priority after daemon-introspection-api. |
| **Roadmap tuple projection** | 🔄 8 open, 11 harvested | Daemon feedback now active with 8 now-status items (vs. previous empty projection). Tuple-backed planning now live. |
| **Unplanned work signal** | 🟨 | v3.20.0 Coast Guard + v3.19.0 Parley shipped; release infrastructure (ADR-0084 pd cut, ADR-0062 auto-freshness, ADR-0057/61) consuming main energy. Phase 6 still seeing release/lifecycle work. |

---

## Cartographer Process Notes

**Current Pass**: 2026-06-19 22:30 UTC
- Authority sources: committed code + git log ✅, V4-UNIFIED-ROADMAP.md ✅, recovery hub ✅, daemon feedback queue ✅
- **NEW DISCOVERY**: 8 open roadmap items in daemon projection (vs. previous empty); ADR-0050 security suite (4 phases) + idea-intake-consult-core + mcp-parity + swarm-coordination-parley all at "now" status
- 34 marked items still in markdown execution wave; 8 new daemon-backed items now visible
- Phase 3 visibility/automation confirmed hottest *mapped* lane with 13 queued items; ADR-0050 security suite represents parallel high-priority tier
- Phase 4A binary work active on feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`); awaiting promotion to main
- Economist feedback awaiting operator follow-up (81 days idle since 2026-03-30)
- Fresh 2026-06-19 Spider waves 1-12 on disk; pending curation into IDEAS-TROVE.md
- **Recent Main Work** (origin/main): v3.20.0 Coast Guard, v3.19.0 Parley shipped with release infrastructure (ADR-0084 pd cut, ADR-0062 auto-freshness, transcript durability ADR-0058, security forensics ADR-0060)

**Signal**: Roadmap inflation from daemon feedback is genuine architecture work (security accountability), not noise. Executor should prioritize mapping ADR-0050 phases into delivery timeline alongside Phase 3 visibility items.

**Deferred to next pass**:
- Fresh Spider exhaust curation into IDEAS-TROVE.md
- Phase 4A feature branch promotion status (awaiting PR review/merge signal)
- ADR-0050 phase sequencing and dependency analysis
- Cost-aware feedback loop progress (awaiting economist pricing function)

---

**Cartographer Authority**: This index is derived from committed code, git log, and curated markdown (recovery hub). The roadmap documents in `docs/recovery/` are canonical. This index is a snapshot for operator visibility — not authoritative for edit direction.
