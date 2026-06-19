# Cartographer Index — 2026-06-19T21:30:00Z

**Snapshot Authority:** git log, committed code, `.cartographer/status.md` > `docs/V4-UNIFIED-ROADMAP.md` > recovery hub > raw files

**Current Daemon:** v3.20.0 (stable) | **Repo:** v3.7.0 (VERSION file) | **Last Sync:** 2026-06-19 20:45 UTC

---

## Phase Summary

| Phase | Status | Notes |
|-------|--------|-------|
| **0: Formal Foundation** | ✅ COMPLETE | White papers, Rust core, Arbiter, PKI, Merkle-chain, Coordination Guard shipped |
| **1: Semantic Graph** | ✅ COMPLETE (2026-05-07) | graph_edges table + 6 indexes + tests verified; Phase 1-adjacent support slices active |
| **2: Economy & Cost** | 🔄 INFRASTRUCTURE READY | cost-tracker + counters + observability endpoints live; pricing function π blocked on economist (77d idle since 2026-03-30) |
| **3A: Fleet & Memory** | ✅ COMPLETE | Declarative fleet YAML + pheromone system shipped; 3B episodic-memory-query-surfaces in curated wave |
| **3: Visibility & Automation** | 🔥 HOTTEST MAPPED PHASE | 12 curated items: daemon-introspection-api, crew-screen-roles-not-pids, fleet-health-scorecard, coordination-ticker, fleet-run-journal, daemon-fleet-auto-recovery, operator-hint-engine, tuple-store-query-api, governance-coordination-hub, phase-3-auto-remediation-executor, episodic-memory-query-surfaces, operator-manual-fleet-dispatch |
| **4A: Bun/Fastify** | 🟡 ACTIVE (OFF-MAIN) | Fastify migration + Bun binary/doctor on feature branches; origin/main not yet absorbed |
| **4B: IPC & Backpressure** | ✅ COMPLETE | Binary IPC + MessagePack shipped; HTTP-level backpressure partial |
| **4C–4D: Indexing** | ✅ COMPLETE | Radix trie + semantic index + harbor bitmask filtering shipped |
| **4E: pd self-test --adversarial** | 🔴 STALE (46d+) | Design complete; zero commits since 2026-03-31 |
| **4F: Windows IPC** | 🔴 STALE (46d+) | Design noted; zero commits since 2026-03-31 |
| **5: Network & Lighthouses** | 🔄 ARCHITECTURE | Relay PKI + Merkle-chain + pd tube + quorum primitives shipped; lighthouse v0 not started |
| **6: Life Integration** | 🔄 ACTIVE | Telos substrate landed; explicit suggestion layer (Phase 6 hero) in flux |

---

## Top 3 Closest to Completion

**By dependency readiness + scope clarity:**

1. **incremental-symbol-index-refresh** (~150 LOC) — keeps Phase 1 graph current as files change; gates symbol-staleness-merge-safety
2. **symbol-graph-visualization** (~4 hours) — Phase 1 graph explorer; makes graph_edges visible instead of query-only
3. **daemon-introspection-api** (~150 LOC) — unified GET /daemon/introspect endpoint; unblocks crew-screen-roles-not-pids + fleet-health-scorecard

---

## Top 3 Blocked / Drifting

1. **Phase 2 Economy** — Thomas Youle (economist, Indiana U) has not followed up since 2026-03-30 (77 days idle). Pricing function π is the gate for Phase 2 wallet and cost-aware routing. Cost infrastructure ships; pricing logic waits.

2. **Phase 4A Binary Distribution** — Fastify migration is complete; Bun binary / doctor / signing work is active on feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`) but has not been promoted to origin/main or stable.

3. **Phase 4E & 4F (Self-Test & Windows IPC)** — Designs complete since 2026-03-31; zero commits for 46+ days. Unblocked by Phase 4A; likely blocked by capacity rather than technical debt.

---

## Recent Commits Unmapped to Roadmap (Last 7 Days)

**High-level category:** Release prep + operator-surface polish

| Commit | Date | Category | Notes |
|--------|------|----------|-------|
| a7a547ab | 2026-06-19 03:00 | Cartographer snapshot | Marked Phase 1 COMPLETE, Phase 3 HOT, 35+ commits since 2026-05-16 |
| 77985eb2, d63a105d, 826b39c4, f51b4034, f615b956 | 2026-06-19 | Cartographer INDEX refresh | Automated daily snapshots (new output format) |
| (upstream from main, not in cartographer-state) | 2026-05-16 → 2026-06-19 | v3.19.0 Parley, v3.20.0 Coast Guard | Release cycle: Parley (bounded multi-agent debate), Coast Guard (sandboxed spawns), metrics dashboard, FleetBar polish, docs prose |

**Signal:** Unplanned product energy (releases + operator surfaces) is real and ship-blocking Phase 4A integration. Monitor whether Phase 3 execution-wave items get crowded out by release cadence.

---

## Open Dogfood Feedback at "Now" (Count + Slugs)

**Live count: 2 now-status items**

1. **claim-preserving-git-safety** — wrap `git add -A` / `reset --hard` / `cherry-pick` with claim guardrails so advisory claims don't get steamrolled. 2–3 days.

2. **fleet-launchability-and-cadence** — surface `launchable` vs `blocked` state in `pd status`, show exact blocking gate in spawn/preflight. 1–2 days.

**Tuple-backed feedback:**
- Live projection: empty (`open: 0`, `harvested: 11`)
- Daemon-mediated `pd feedback list --status open --json` hits EPERM on `~/.port-daddy/daemon.sock` from this checkout
- Direct `.spark/feedback/` tree not present in cartographer-state

**Total curated execution wave:** 34 items (Phase 1-adjacent + Phase 2 + Phase 3 visibility + Phase 4B + Phase 6 extensions)

---

## Key Planning Tensions

### Tension 1: Release Cadence vs. Phase Sequencing

**Observation:** v3.19.0 (Parley) and v3.20.0 (Coast Guard) shipped this month. Real features, real product. But origin/main has absorbed 35 commits for release prep / metrics / docs polish that have not been integrated into V4 phase lanes. Phase 4A binary work remains on feature branches.

**Trade-off:** Releasing valuable operator features (Parley debate, Coast Guard sandbox) vs. shipping Phase 4A (binary distribution, doctor diagnostics) which unblocks Phase 5 (network) and Phase 4E/F (self-test, Windows).

**Cartographer note:** Product velocity is real and healthy. Ensure Phase 3 execution-wave items don't get starved by backlogged release work.

### Tension 2: Economist Stale (77 Days)

**Observation:** Thomas Youle (Indiana U) was contacted 2026-03-30 with initial pricing-function π proposal. No follow-up. Phase 2 wallet / cost-aware routing / spend-aware model selection are all waiting.

**Trade-off:** Continue with Phase 2 infrastructure as-is (accounting works; routing doesn't optimize) vs. attempt a different pricing-function pathway or accept the 2–3 month delay.

**Cartographer note:** Phase 2 is not a blocker on Phase 3 (visibility) or Phase 4 (reliability). Consider it a parallel lane. But if you want Phase 2 shipping before EOY, contact action is needed now.

### Tension 3: Phase 4E/F Staleness

**Observation:** Design complete (ADR-0049 et al), zero commits since 2026-03-31 (46+ days). Self-test harness and Windows IPC hardening are not blocking anything except themselves.

**Trade-off:** Deprioritize (backlog until Phase 5 is closer) vs. resume now (prove Phase 4 robustness before shipping Phase 5 network).

**Cartographer note:** ADR-0049 and isolated sandbox test harness design are solid. The work is clear. Capacity decision, not technical risk.

---

## Execution Wave Health

**34 curated now-status items**, organized by phase dependency:

- **Phase 1-adjacent** (graph visualization & incremental refresh): 4 items
- **Phase 2** (cost optimization & feedback): 4 items
- **Phase 3** (visibility & automation): 12 items + 1 dispatch lane
- **Phase 4** (reliability & hardening): 6 items
- **Phase 6** (suggestion layer): 1 item
- **Dogfood** (foundational safety): 2 items
- **Cross-cutting** (governance & memory): 5 items

**Velocity:** 1.3/day (9 commits last 7 days, post-May-1 burst). Trending stable.

**Next cut priority:** Incremental symbol refresh → graph visualization → daemon-introspection-api (gates crew-screen + fleet-health). Then operator-hint-engine (gates governance rollup).

---

## Unplanned Work (Healthy Signal Leak)

**Categories consuming real capacity outside named phase lanes:**

1. **Release cycles** — v3.19.0 Parley, v3.20.0 Coast Guard shipped; metric dashboard, FleetBar polish, docs prose refined
2. **Operator surfaces** — FleetBar CostDashboard, Parley UI, session-list row polish
3. **Docs content** — 15+ new leaf pages in `/docs/concepts`, `/docs/best-practices`
4. **Architecture clarity** — relay/harbor mesh ADR, whitepaper v2.5 + proof appendix, conformance follow-through
5. **Skills hygiene** — `windags_skill_induct`, skill trust gates, deprecation trails

**Signal:** Product is shipping real features and operator value. Ensure Phase 3 execution items (which feed this momentum) get sequenced into the next releases rather than competing with them.

---

## Next Cartographer Action

1. **Watch for Phase 4A promotion** — When feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`) are promoted to origin/main / stable, reflect that in this phase status grid.

2. **Monitor Phase 3 velocity** — 12 curated items are the current hottest lane. Track whether execution starts this week and whether release prep crowding (v3.21.0 planning?) affects the timeline.

3. **Economist follow-up check** — If Phase 2 pricing is essential to H2 roadmap, escalate the Thomas Youle contact gap now. Otherwise, accept it as a parallel lane with a later ETA.

4. **Phase 4E/F decision** — Clarify capacity intent: backlog until Phase 5, or resume now? The design is clear; the work is knowable. This is a sequencing call, not a risk call.

---

**Generated by:** Cartographer (autonomous agent)  
**Branch:** cartographer-state  
**Next sync:** 2026-06-20 automatic harvest (daily cron)
