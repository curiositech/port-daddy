# Cartographer Index — 2026-06-20T23:59:59Z

## Phase Summary

| Phase | Status | Signal | Next Cut |
|-------|--------|--------|----------|
| **0: Formal Foundation** | ✅ COMPLETE | Shipped (white papers, Rust core, Arbiter, PKI, Guard, Merkle-chain) | — |
| **1: Semantic Graph** | ✅ COMPLETE | Phase 1 closure verified; `graph_edges` table + 6 indexes + tests live | Symbol-graph visualization |
| **2: Economy & Cost** | 🔄 INFRA READY | Accounting complete (`cost-tracker`, `counters`, `/metrics/*`); pricing function π stale **81 days** | Pricing function (economist) |
| **3A: Fleet & Memory** | ✅ COMPLETE | Declarative fleet YAML, pheromone system, auto-respawn all shipped | Fleet auto-recovery |
| **3B: Episodic Memory** | 🟨 PARTIAL | Queued in execution wave; surfaces not yet wired | Memory query surfaces |
| **3C: Deep `pd scan`** | ⏸ BLOCKED | Downstream of Phase 2 | — |
| **3D: Fleet Dashboard** | 🔄 EVOLVED | Standalone Fleet Live + menu bar app + Config UI (WIP); exceeds spec | Metrics/scorecard wiring |
| **4A: Bun/Fastify** | 🟡 ACTIVE (OFF-MAIN) | Binary/doctor/distribution on feature branches; main shipping Parley+Coast Guard | Binary distribution unblock |
| **4B: IPC** | ✅ COMPLETE | MessagePack + backpressure shipped v3.8.2 | — |
| **4C: Radix Trie** | ✅ COMPLETE | Semantic index + harbor filtering v3.8.1 | — |
| **4D: Backpressure** | 🟨 PARTIAL | IPC-level ✅; HTTP-level pending | HTTP backpressure |
| **4E: Self-Test** | 🔴 STALE | No commits 80+ days; design complete | Sandboxed test harness |
| **4F: Windows IPC** | 🔴 STALE | No commits 80+ days; design complete | Post-4E reevaluation |
| **5: Network** | 🔄 ARCHITECTURE | Relay PKI + Merkle-chain + `pd tube` + quorum shipped; lighthouse v0 pending | — |
| **6: Life Integration** | 🔄 ACTIVE | Telos substrate landed; suggestion layer open | Telos-driven model selection |

---

## Top 3 Closest to Completion (Ready-to-Ship)

1. **`incremental-symbol-index-refresh`** (Spark 2026-05-12) — ~150 LOC file-watch watcher; unblocks Phase 1 merge-prediction freshness
2. **`symbol-graph-visualization`** (Spark 2026-05-12) — ~4 hours; Phase 1 operator visibility via `graph_edges` render
3. **`daemon-introspection-api`** (Spark 2026-05-09) — ~150 LOC `GET /daemon/introspect`; Phase 3 health aggregation unlocker

---

## Top 3 Blocked or Drifting (Risk Signals)

1. **Phase 2 Economist** — **81 days idle** (since 2026-03-30 contact with Thomas Youle); pricing function π is the gate. Workaround: ship real cost data to economist; unblock economics without blocking Fleet 3.
2. **Phase 4A Binary/Doctor** — Active off-main on `feat/binary-distribution-daemon-unblock` + `feat/doctor-binary-daemon-diagnostics` (5 commits), but main is absorbing Parley+Coast Guard energy. Risk: feature-branch drift. Monitor merge readiness.
3. **Phase 4E/4F Self-Test & Windows IPC** — **80+ days stale**. No blocking issues; design-complete lower-priority items. Unblock when `sandboxed-adversarial-test-harness` ships (Phase 4E unlocker from 2026-05-13 Spark promotion).

---

## Recent Commits Unmapped to Numbered Phases (Last 7 Days)

All recent cartographer-state commits are snapshot/digest updates (no new phase work). Main branch energy (HEAD `a03f4eee`):

- **v3.20.0 Coast Guard** — Operator safety (OS sandbox, secret broker, egress metering) default-on per spawn
- **v3.19.0 Parley** — Bounded multi-agent debate surface, coordination-sensitive roadmap receipts
- **Metrics/FleetBar/Docs Polish** — Phase 3 visibility layer reinforcement
- **Fresh Spider Waves 1-14** — Uncurated connection research on disk

---

## Curated Execution Wave (Now-Status Items: 34)

**Recent Promotions & Shipping Status:**
- ✅ **v3.20.0 shipped** (2026-06-19) — Coast Guard (ADR-0050 Phases 0–3), sandbox, secret-broker, egress-cap
- ✅ **v3.19.0 shipped** (2026-06-15) — Parley (bounded debate, swarm-fit scoring, roadmap receipts)
- 🟨 **34 curated items** in execution queue; 8 live daemon roadmap tuples show open items: `idea-intake-consult-core`, `swarm-coordination-parley`, `mcp-parity-no-copouts`, `adr-0050-phase-0-pd-cutter-wrapper`, `adr-0050-phase-1-secret-broker`, `adr-0050-phase-2-dollar-metering`, `adr-0050-phase-3-signed-outcome-format`

**Spark/Spider Harvest:**
- 2026-05-14 promotion: 5 items → execution wave
- 2026-05-16 promotion: `orchestrator-decision-attribution` → now-candidates
- **Fresh 2026-06-19 Spider waves 1-14** present on disk but **uncurated** (pending Spark/Spider dedupe)

**No New Dogfood Feedback:** Curated now-pair remains `claim-preserving-git-safety` and `fleet-launchability-and-cadence`.

---

## Health Signals

| Metric | Status | Notes |
|--------|--------|-------|
| **Test Suite** | ✅ All passing | `npm test` baseline maintained |
| **Velocity** | ✅ Stable (1.3/day) | Release cycles + Phase 3 visibility feeding main; cartographer-state carries snapshot-only commits |
| **Phase 1 Completion** | ✅ VERIFIED | `graph_edges` table live; Phase 1 closure on 2026-05-07 |
| **Economist** | 🔴 **81 DAYS IDLE** | No follow-up since 2026-03-30; pricing function π still outstanding |
| **Stale Phases** | 🔴 4E/4F (80+ days) | Phase 4A active off-main but not yet merged; unblock with test harness |
| **Daemon Roadmap Tuples** | ✅ Available | 8 open now-status items; ADR-0050 security suite active |
| **Branch Divergence** | ⚠️ Growing | origin/main 1491 commits ahead; Phase 4A binary work + Parley/Coast Guard riding feature branches not yet merged |

---

## Unplanned Work Absorption (Real Product Energy)

Real capacity flowing **outside** formal V4 phase lanes but feeding Phase 3 visibility/automation:

- **Release Cycles** — v3.20.0 Coast Guard + v3.19.0 Parley (security, coordination, bounded work)
- **Operator-Surface Polish** — Metrics wiring, FleetBar integration, docs/console UX
- **Security Suite (ADR-0050)** — Not in formal phase map but now in active execution (daemon tuple projection shows 8 items)
- **Dispatch → Conductor Fold (ADR-0060)** — On cartographer-state branch, not yet folded into numbered phase map

**Signal:** Monitor that Phase 3 execution items don't get crowded out by release cycles. Consider bumping Phase 3 priority if new work displaces existing roadmap items.

---

## Coordination Status

- **Current Session:** Cartographer mapping pass (2026-06-20)
- **Feedback Pipeline:** No new `.spark/feedback/` files; live daemon projection shows 8 roadmap items
- **Unplanned Coverage:** ADR-0050 security suite, ADR-0060 dispatch fold, pd-console build/install/run
- **Consistency Alert:** None

---

## Next Cartographer Pulse

- **When:** Automatic on next commit, or on operator request
- **What to Check:** New Spider waves, daemon roadmap tuple updates, Phase 3 vs release-cycle capacity trade-off
- **Watch:** Phase 4A binary branch merge readiness; Phase 2 economist follow-up
