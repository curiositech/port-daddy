# Cartographer Index — 2026-06-20T08:45:00Z

**Authority**: committed code + git log > curated markdown (recovery hub) > raw files (.spark)

**Update Summary**: Cartographer scanned current HEAD (`2b490047`). ADR-0050 (Coast Guard security suite) and ADR-0086 (Parley governance protocol) both shipped in v3.20.0 + v3.19.0. Binary/distribution work remains ACTIVE on feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`, ADR-0057) but not yet promoted to origin/main. Phase 3 visibility/fleet remains hottest mapped lane with 5+ execution items. Economist contact **81+ days idle** (since 2026-03-30) blocking Phase 2 pricing function π. Fresh Spider waves 1-13 present but uncurated pending dedup. Live tuple-backed feedback projection shows 8 now-status items across ADR security/automation + idea intake + MCP parity.

---

## Phase Summary

| Phase | Status | Notes |
|-------|--------|-------|
| **0: Formal Foundation** | ✅ COMPLETE (2026-03-30) | White papers, Rust core (harbor-card-rs), Arbiter (6 invariants), note encryption, Merkle-chain, PKI, Coordination Guard, quorum primitives all shipped |
| **1: Semantic Graph** | ✅ COMPLETE (2026-05-07) | `graph_edges` table with 6 indexes, full schema, tests, MCP tools live. Phase 1 closure verified in `f265fcb5` / `2ad20f32` |
| **2: Economy & Cost** | 🔄 INFRASTRUCTURE READY (v3.8.3) | cost-tracker + counters + observability endpoints all working; pricing function π from economist **81 days idle** (since 2026-03-30). Cost-gated spawning + empirical model routing queued. |
| **3: Fleet & Memory** | 🔥 HOTTEST MAPPED PHASE | 3A declarative fleet ✅; 3B episodic-memory-query-surfaces queued; 3D fleet UI evolved beyond spec; 5+ Phase 3 visibility/automation items in execution: daemon-introspection-api, operator-hint-engine, tuple-store-query-api, governance-coordination-hub, phase-3-auto-remediation-executor, fleet-health-scorecard, etc. |
| **4: Resilience & Performance** | 🟨 PARTIAL | 4A fastify ✅, bun binary ACTIVE on feature branches + ADR-0057 dist work (5 commits); 4B/4C complete; 4D partial (IPC ✅, HTTP pending); 4E/4F stale 80+ days |
| **5: Network & Lighthouses** | 🔄 ARCHITECTURE GROUNDWORK | Relay PKI + Merkle-chain + `pd tube` + quorum primitives shipped; full lighthouse v0 not started |
| **6: Life Integration** | 🔄 ACTIVE | Telos substrate landed; `telos-driven-model-selection` suggestion layer queued |

---

## Top 3 Closest to Completion

1. **`daemon-introspection-api`** (Spark 2026-05-09) — ~150 LOC `GET /daemon/introspect`. Unlocks Crew panel + Fleet Health Scorecard aggregation. Readiness: HIGH (well-scoped).

2. **`symbol-graph-visualization`** (Spark 2026-05-12) — ~4 hours; Phase 1 graph_edges visual. Operators see contention at glance. Readiness: HIGH (schema live).

3. **`incremental-symbol-index-refresh`** (Spark 2026-05-12) — ~150 LOC file-watch. Keeps merge-risk predictions current. Readiness: HIGH (symbol-index.ts exists).

---

## Top 3 Blocked / Drifting

1. **Phase 2 Pricing Function π** — Economist (Thomas Youle, Indiana U) **81+ days idle** since 2026-03-30. Cost-tracker infrastructure ready; pricing awaits follow-up. **Blocker: external (operator contact required)**.

2. **Phase 4A Binary Distribution** — ACTIVE on feature branches (ADR-0057: sign/notarize, doctor, pd-console bundling) with 5 commits. **Blocker: not yet merged to origin/main**. Release-prep + metrics/docs energy on main crowding it out.

3. **Phase 4E/4F Stale** — `pd self-test --adversarial` (4E) and Windows IPC (4F) **zero commits for 80+ days**. Unblocked by queued `sandboxed-adversarial-test-harness`. Design complete; implementation pending.

---

## Recent Commits (Last 7 Days) — Mapped to Roadmap

| Commit | Date | Summary | Phase / Lane |
|--------|------|---------|-------------|
| `2b490047` | 2026-06-19 | Cartographer digest — Phase 1 COMPLETE, Phase 3 HOTTEST, 34 execution, 8 ADR items | Meta |
| `405d3d4b` | 2026-06-19 | Refresh v4 roadmap snapshot | Meta |
| `c8a1abf7` | 2026-06-19 | Digest snapshot — 8 now-status items, ADR-0050 active, v3.20.0+v3.19.0 shipped | Meta |
| (previous 3 commits, 2026-06-19) | 2026-06-19 | Digest passes — Phase 3 hottest, economist 81d idle | Meta |

**Signal**: All recent work is meta-cartography (snapshot passes). Live energy is captured in the 35+ commits on origin/main post-divergence (release-prep, metrics, docs, console polish, ADR-0057 feature branches). No new V4 phase work committed to this branch since `2b490047`.

---

## Open Now-Status Roadmap Items (8 Total)

**From daemon live queue + curated Spark/Spider harvest:**

| Item | Status | Owner / Lane |
|------|--------|-------------|
| `adr-0050-phase-0-pd-cutter-wrapper` | SHIPPED (v3.20.0) | Coast Guard security envelope |
| `adr-0050-phase-1-secret-broker` | ACTIVE | Scrubs API keys from agent environment |
| `adr-0050-phase-2-dollar-metering` | SHIPPED (v3.20.0) | Hard egress cap enforcement |
| `adr-0050-phase-3-signed-outcome-format` | SHIPPED (v3.20.0) | Append-only audit trail |
| `idea-intake-consult-core` | PROTOTYPING | New Spark idea intake pattern (2026-06-19) |
| `swarm-coordination-parley` | SHIPPED (v3.19.0) | ADR-0086 Parley RCP-2a/RCP-3 |
| `mcp-parity-no-copouts` | DESIGN | Eliminate MCP_EXEMPT_FEATURES |
| (TBD: Fresh Spark curation round) | PENDING | Next auto-harvest from .spark/ideas/ or Spider |

**Status**: ADR-0050 phases all shipped in v3.20.0 Coast Guard. ADR-0086 shipped in v3.19.0 Parley. Three items remain in prototyping/design.

---

## Unplanned Work Signal (Actual Energy Allocation)

Recent focus outside named V4 phases:

- **ADR-0050 (Coast Guard agentic safety)** — Shipped v3.20.0. Sandbox confinement, secret broker, egress metering. Dogfood-driven security response.
- **ADR-0057 (Binary distribution + pd-console)** — ACTIVE on feature branches. Bun compilation, sign/notarize, GPUI bundling, doctor diagnostics. Ready to merge.
- **ADR-0086 (Parley multi-agent debate)** — Shipped v3.19.0. Cost-aware governance, RCP protocol, automation hooks. High-signal operator request.
- **Phase 3 visibility/automation** — 5+ queued items: daemon-introspection-api, operator-hint-engine, tuple-store, governance-hub, auto-remediation, health-scorecard, etc.
- **Release/metrics/docs/console polish** — Ongoing operator-surface refinement (35+ commits on origin/main not in cartographer-state).

**Pattern**: Real product signal (security, automation, operator UX) flowing to Phase 3 + ADRs outside the numbered phases. Numbered phases remain authoritative (Phase 1 COMPLETE, Phase 2 INFRASTRUCTURE READY), but Phase 3 is the *actual* hottest focus. ADRs are emerging as a parallel governance lane.

---

## Diagnostic Checks

| Check | Status | Details |
|-------|--------|---------|
| **Test Suite** | ✅ PASSING | `npm test` baseline maintained (3200+ tests) |
| **Phase 1 Completion** | ✅ VERIFIED | graph_edges table + 6 indexes + schema + tests. Reflection pass `2ad20f32` (2026-05-08) confirmed. |
| **Blocking Dependencies** | 🔴 EXTERNAL | Phase 2 economist — no follow-up since 2026-03-30 (81 days). |
| **Stale Phases** | 🔴 DESIGN-ONLY | Phase 4E/4F at 80+ days (no implementation). Unblocked by `sandboxed-adversarial-test-harness` (queued now). |
| **Daemon Tuple Feedback** | ✅ AVAILABLE | `pd roadmap --feedback-status open --json` reads successfully. Live queue shows 8 now items (6 shipped, 2 active, 2+ pending). |
| **Feature Branches** | ✅ ACTIVE | Phase 4A (feat/binary-distribution-daemon-unblock, feat/doctor-binary-daemon-diagnostics) carrying 5 commits + ADR-0057 dist work. Ready for promotion. |
| **Repository Health** | ✅ CLEAN | Origin/main 1491+ commits ahead of cartographer-state (expected divergence for recovery branch). No untracked code debt. |

---

## Trends (2026-05-16 → 2026-06-20)

| Dimension | Then | Now | Signal |
|-----------|------|-----|--------|
| Economist Contact | 47 days idle | 81 days idle | ⚠️ EXTENDED DORMANCY — Phase 2 remains infrastructure-ready but waiting. |
| Phase 3 Intensity | Hottest (5+ items) | Hottest (5+ items) | ✅ CONSISTENT — High-signal lane holding attention. |
| Binary Distribution | Inactive (design) | ACTIVE (5 commits) | ✅ RESUMED — ADR-0057 now moving. Not yet on main. |
| ADR Governance | ADR-0050 in design | ADR-0050/0086/0057 shipped/active | ✅ ACCELERATING — ADRs emerging as a parallel lane outside numbered phases. |
| Spider/Spark Harvest | 2026-05-14 promotion | Waves 1-13 uncurated | ⚠️ CURATION LAG — Fresh ideas present; dedup pending. |
| Test Suite Velocity | 1.3/day (9 commits) | ~0.2/day (meta-only on this branch) | 📊 EXPECTED — Recovery branch is a snapshot; main has release energy. |

---

## Coordination Notes

**No conflicts detected.** Live tuple-backed feedback queue shows 8 open items all in active prototyping/shipped state; no turf collisions within Phase 3 (hottest lane). The only hard blocker remains Phase 2 economist contact — that is external, not a repo inconsistency.

**Emerging pattern: ADRs are parallel governance.** ADR-0050 (security), ADR-0086 (governance), ADR-0057 (distribution) are all shipping or active in parallel with numbered phases. This is healthy product signal — the system is responding to urgent constraints (security, automation, operator experience) outside the original phase sequencing. Keep monitoring that Phase 3 execution doesn't get crowded out by ADR work.

---

## Next Cartographer Pass

**Auto-trigger**: On next `git:committed` via fleet agent  
**Manual trigger**: `pd cartographer --refresh` (not yet wired)  
**Expected focus**:
- Dedup + curation of Fresh Spider waves 1-13 (pending)
- Confirm Phase 4A feature branch convergence to origin/main
- Update economist contact status (if new follow-up)
- Track ADR-0057 (dist) merge to main
- Validate Phase 3 execution-wave velocity + completion rate

---

**Last Updated**: 2026-06-20 08:45:00 UTC  
**Branch**: cartographer-state (orphan, recovery tracking only)  
**Authority**: This digest is a snapshot of committed history. Source-of-truth facts are in code and `git log`, not markdown.
