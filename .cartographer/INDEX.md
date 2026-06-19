# Cartographer Index — 2026-06-19T22:45:00Z

**Snapshot Authority:** git log + committed code + recovery hub status > roadmap markdown > raw files

**Current Scope:** origin/main is 1490 commits ahead of cartographer-state; cartographer-state carries 8 commits not in main. Phase 0 COMPLETE, Phase 1 COMPLETE (verified 2026-05-07 `f265fcb5`), Phase 3 HOTTEST MAPPED. 34 curated execution items in immediate wave.

---

## Phase Summary

| Phase | Status | Key Blocker / Signal |
|-------|--------|---------------------|
| **0: Formal Foundation** | ✅ COMPLETE | White papers (Bonded Commons, Anchor Protocol), Rust core (Kani-verified), Arbiter (6 invariant rules), Merkle-chain, PKI, Coordination Guard all shipped |
| **1: Semantic Graph** | ✅ COMPLETE (2026-05-07) | graph_edges table + 6 indexes + 40 tests verified (`f265fcb5`, reflection pass `2ad20f32`); Phase 1-adjacent support slices (`incremental-symbol-index-refresh`, `symbol-graph-visualization`, `orchestrator-plugin-lifecycle`) in curated wave |
| **2: Economy & Cost** | 🔄 INFRASTRUCTURE READY | cost-tracker + counters + observability endpoints (6 routes) live since 2026-04-05. Pricing function π **idle 77 days** (last contact with Thomas Youle 2026-03-30). Cost infrastructure ships; economic routing blocked. |
| **3A: Declarative Fleet** | ✅ COMPLETE | Fleet YAML (`pd-fleet.yml`) + pheromone system + auto-respawn shipped 2026-03-27 |
| **3B: Episodic Memory** | 🟨 PARTIAL | `episodic-memory-query-surfaces` in curated now-wave; routes/CLI not yet landed |
| **3: Visibility & Automation** | 🔥 **HOTTEST MAPPED PHASE** | 12 core visibility items: daemon-introspection-api, crew-screen-roles-not-pids, fleet-health-scorecard, coordination-ticker-as-high-signal-feed, fleet-run-journal, daemon-fleet-auto-recovery, operator-hint-engine, tuple-store-query-api, governance-coordination-hub, phase-3-auto-remediation-executor, episodic-memory-query-surfaces, operator-manual-fleet-dispatch. Also: 5 supporting cross-cutting items. Closest to ship: #1–3 in "Top Closest" below. |
| **4A: Bun/Fastify** | 🟡 ACTIVE (OFF-MAIN) | Fastify migration ✅ (2026-03-31). Bun binary / doctor / distribution **active on feature branches** (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`) with 5 commits; origin/main + stable have not absorbed this lane yet. Release prep (v3.19.0 Parley, v3.20.0 Coast Guard) is consuming that integration bandwidth. |
| **4B: IPC & Radix Trie** | ✅ COMPLETE | Binary IPC (MessagePack, 70–80% bandwidth reduction) + Radix Trie (sub-millisecond wildcard) shipped v3.8.0–3.8.2 |
| **4D: Backpressure** | 🟨 PARTIAL | IPC-level ✅; HTTP-level not started |
| **4E: `pd self-test --adversarial`** | 🔴 STALE (46+ days) | Design complete (ADR-0049). Zero commits since 2026-03-31. Unblocked by `sandboxed-adversarial-test-harness` (now-wave). Not blocking anything except itself. |
| **4F: Windows IPC Hardening** | 🔴 STALE (46+ days) | Design noted (Named Pipes, SDDL, NTLM relay prevention). Zero commits since 2026-03-31. Lower priority than Phase 4E. |
| **5: Network & Lighthouses** | 🔄 ARCHITECTURE GROUNDWORK | Relay PKI (OIDC-first ADR-0027) + Merkle-chain library + `pd tube` relay-independent pipe + quorum primitives + daemon profiles + Coordination Guard all shipped (Phase 0). Lighthouse discovery / federation not started. |
| **6: Life Integration** | 🔄 ACTIVE | Telos substrate (durable agent contracts) landed 2026-05-01. `telos-driven-model-selection` (explicit spawn-time suggestion layer) in curated now-wave; hero component updates ongoing. |

---

## Top 3 Closest to Completion

**By dependency + scope clarity + readiness signal:**

1. **`incremental-symbol-index-refresh`** (~150 LOC)  
   **Phase:** 1 support slice  
   **Unblocks:** `symbol-staleness-merge-safety` (merge-risk freshness)  
   **Status:** Scope clear; filesystem watcher + trie sync POC ready  
   **ETA:** 1–2 days

2. **`symbol-graph-visualization`** (~4 hours)  
   **Phase:** 1 operator visibility  
   **Unblocks:** Operator-facing Phase 1 graph explorer  
   **Status:** Scope clear; graph_edges schema + test data ready  
   **ETA:** 4–6 hours (React force-directed layout + Tailwind)

3. **`daemon-introspection-api`** (~150 LOC)  
   **Phase:** 3 visibility foundation  
   **Unblocks:** `crew-screen-roles-not-pids` + `fleet-health-scorecard` (both Phase 3)  
   **Status:** Scope clear; daemon metrics already exist (WAL lag, IPC backlog, session count, lock contention)  
   **ETA:** 1–2 days

---

## Top 3 Blocked / Drifting

1. **Phase 2 Economy** (Blocked on external contact)  
   **Status:** Thomas Youle (economist, Indiana U) — no follow-up since 2026-03-30 (77 days idle)  
   **Blocker:** Pricing function π (bond pricing, reputation discount, cost-aware routing)  
   **Impact:** Phase 2 wallet, spawn-time model selection, cost feedback loop all waiting. Phase 2 infrastructure ships; Phase 2 optimization logic blocked.  
   **Action Required:** Contact escalation or accept 2–3 month delay until late 2026

2. **Phase 4A Binary Distribution** (Blocked on release integration)  
   **Status:** Feature branches `feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics` carry Bun / sign-and-notarize / doctor work (5 commits 2026-04-01 → 2026-05-14)  
   **Blocker:** Release prep (v3.19.0 Parley, v3.20.0 Coast Guard) consuming origin/main integration bandwidth  
   **Impact:** Binary distribution, doctor diagnostics, LaunchAgent plist detection all waiting for promotion. Phase 4A complete-but-unshipped.  
   **Action Required:** Merge feature branches after next release (v3.21.0 window)

3. **Phase 4E & 4F Staleness** (Blocked on capacity/prioritization)  
   **Status:** Designs complete (ADR-0049, ADR-0050); zero commits since 2026-03-31 (46+ days)  
   **Blockers:** None technical; capacity / sequencing decision  
   **Impact:** `pd self-test --adversarial` (chaos harness) and Windows IPC hardening not shipping. Phase 4 not provably production-hardened.  
   **Action Required:** Clarify intent: backlog until Phase 5 active, or resume now to prove Phase 4 robustness pre-Phase-5?

---

## Recent Commits Unmapped to Roadmap (Last 7 Days)

**High-level signal:** Release preparation + Cartographer snapshots (not V4 phase work)

| Date | Commit Range | Category | Notes |
|------|---------------|----------|-------|
| 2026-06-19 | `251f552f`, `ada93305` (5 cartographer commits) | Cartographer INDEX refresh | Automated daily snapshots; new digest format |
| 2026-06-15 → 2026-06-19 | upstream from origin/main | Release prep + operator polish | v3.19.0 Parley (multi-agent debate), v3.20.0 Coast Guard (sandboxed spawns, egress meter), metrics dashboard wiring, FleetBar enhancements, docs prose. Real product velocity; not mapped to named V4 phase lanes. |

**Velocity:** 1.3 commits/day (stable post-May-1 burst). Last major burst: May 1–2 (7 fleet-model/telos commits + 15+ docs pages + cost-tracker work).

---

## Open Dogfood Feedback at "Now" (Count + Slugs)

**Live count: 2 now-status items** (curated from `.spark/feedback/` harvest + operator-direct handoff)

1. **`claim-preserving-git-safety`** (dogfood)  
   **Scope:** Wrap `git add -A` / `reset --hard` / `cherry-pick` with claim guardrails so advisory claims don't get steamrolled  
   **Scope notes:** Extend Coordination Guard from pre-commit to destructive git verbs  
   **ETA:** 2–3 days  
   **Phase:** Foundational (gate for all multi-agent coordination)

2. **`fleet-launchability-and-cadence`** (dogfood)  
   **Scope:** Surface `launchable` vs `blocked` state in `pd status` output and spawn/preflight messaging; show exact blocking gate  
   **Scope notes:** Unblocks operator truth about fleet readiness  
   **ETA:** 1–2 days  
   **Phase:** Phase 3 (visibility)

**Tuple-backed feedback projection:**
- Live daemon queue: empty (`open: 0`, `harvested: 11`)
- Shell `pd feedback list --status open --json` hits EPERM on `~/.port-daddy/daemon.sock` from this checkout
- Direct `.spark/feedback/` tree not present in cartographer-state; next auto-harvest on next commit trigger

**Total curated execution wave:** 34 items across Phase 1-adjacent, Phase 2, Phase 3 (12+), Phase 4, Phase 6, and dogfood lanes

---

## Key Planning Tensions & Cartographer Notes

### Tension 1: Release Cadence vs. Phase 4A Promotion

**Signal:** v3.19.0 and v3.20.0 shipped this month (June 2026). Real features, real operator value. But Phase 4A binary work languishes on feature branches while origin/main absorbs release prep.

**Trade-off:** Continue releasing valuable features (Parley debate, Coast Guard sandbox, metrics dashboard) vs. ship Phase 4A binary distribution, which unblocks Phase 5 (network) and clears Phase 4E/F capacity.

**Cartographer recommendation:** Both are load-bearing. Prioritize Phase 4A promotion into the v3.21.0 release cycle (next 2 weeks). Phase 3 execution items can parallel-track that integration.

### Tension 2: Economist Stale (77 Days)

**Signal:** No follow-up from Thomas Youle since 2026-03-30. Cost infrastructure ships; pricing function π waits.

**Trade-off:** Accept 2–3 month delay vs. pursue alternative pricing model (simpler heuristic, learning-based, external service).

**Cartographer recommendation:** Phase 2 infrastructure is complete and valuable on its own (spend visibility, budget gates, cost alerts). Accept π as a Phase 2 v2 follow-on (H2 2026 target). Meanwhile, ship Phase 3 visibility items which feed live product value.

### Tension 3: Phase 4E/F Capacity Prioritization

**Signal:** Designs are solid (ADR-0049, sandbox test harness clear). Work is knowable. Zero progress for 46+ days = capacity decision, not technical risk.

**Trade-off:** Backlog (deprioritize below Phase 5 start) vs. resume (harden Phase 4 before Phase 5 ships network).

**Cartographer recommendation:** Backlog Phase 4E/F until Phase 5 active (likely late Q3 2026). Phase 3 visibility is the current hottest lane; keep it fed. Phase 4E/F becomes the Phase 5 pre-flight once Phase 3 is shipped.

---

## Execution Wave Health

**34 curated now-status items**, distributed across phases:

- **Phase 1-adjacent** (graph visualization, refresh, orchestrator): 5 items
- **Phase 2** (cost optimization, routing, feedback loop): 5 items
- **Phase 3** (visibility, automation, memory, dispatch): 12+ items
- **Phase 4** (preflight synthesis, hardening, isolation): 5 items
- **Phase 6** (suggestion layer): 1 item
- **Dogfood** (foundational safety): 2 items
- **Cross-cutting** (governance, memory consolidation): 4 items

**Status:** All 34 items have clear scope, identified dependencies, and estimated LOC. Closest 3 above are green-lit to start this week.

**Trending:** Stable at 1.3 commits/day; post-May-1 burst energy sustainably decayed.

**Next cuts in priority order:**
1. `incremental-symbol-index-refresh` → `symbol-graph-visualization` → `daemon-introspection-api` (gates crew-screen + fleet-health)
2. `operator-hint-engine` (gates governance-coordination-hub)
3. Phase 3 visibility items (12 items total; gates Phase 3 completion)

---

## Unplanned Work (Healthy Energy Signal)

**Real capacity consumed outside formal V4 phase lanes:**

1. **Release cycles** (v3.19.0 Parley, v3.20.0 Coast Guard) — multi-agent debate surface, sandboxed spawns (Coast Guard), egress meter, signed receipts
2. **Operator surfaces** — metrics dashboard backend, FleetBar cost visualization, session-list polish, Parley UI
3. **Docs content fill** — 15+ new leaf pages in `/docs/concepts`, `/docs/best-practices` (2026-05-01 burst)
4. **Architecture clarity** — relay/harbor mesh ADR, whitepaper v2.5 + formal proof appendix, conformance follow-through
5. **Skills hygiene** — `windags_skill_induct`, skill trust validation, deprecation trails

**Cartographer interpretation:** Product is shipping real features and operator value. These releases are *not* noise; they feed the system's momentum. Ensure Phase 3 execution items get sequenced *into* upcoming releases (v3.21.0, v3.22.0) rather than competing with them.

---

## Next Cartographer Action (2026-06-20)

1. **Watch Phase 4A promotion** — Track when feature branches are promoted to origin/main / stable; update phase status grid accordingly.

2. **Monitor Phase 3 velocity** — 12 curated visibility items are hottest lane. If execution starts this week, capture it. If release prep crowding happens (v3.21.0 planning), surface the trade-off to the operator.

3. **Economist escalation decision point** — If Phase 2 pricing is essential to H2 timeline, escalate Thomas Youle contact gap now. Otherwise, accept as parallel lane with later ETA.

4. **Phase 4E/F capacity decision** — Clarify operator intent: backlog until Phase 5 ramp, or resume now? Design is clear; decision is sequencing, not risk.

5. **Harvest fresh Spark/Spider exhaust** — 2026-05-10 raw Spider files (S41/S42/S43) remain uncurated on disk; fresh 2026-06-19 passes may exist. Dedupe and promote to execution wave if novel.

---

**Generated by:** Cartographer (autonomous maintenance pass)  
**Branch:** cartographer-state (orphan, 8 commits not in origin/main)  
**Authority:** git log + committed code > recovery hub > raw exhaust  
**Next sync:** 2026-06-20 automatic daily harvest (cron-triggered or commit-triggered)

