# Cartographer Index — 2026-06-19 03:00 UTC

**Last Updated**: 2026-06-19 03:00 UTC (mapping pass HEAD `e5fc5b75`)  
**Authority**: committed code > curated markdown > raw files  
**Scope**: Port Daddy v3.19.1+ — v3.20.0 release path + Phase 4/6 infrastructure

---

## Phase Summary

| Phase | Status | Last Work | Notes |
|-------|--------|-----------|-------|
| **0: Formal Foundation** | ✅ COMPLETE | 2026-04-16 | All formal systems shipped and proven |
| **1: Semantic Graph** | ✅ COMPLETE | 2026-05-07 `f265fcb5` | graph_edges + symbol claim forest now live |
| **2: Economy** | 🔄 INFRASTRUCTURE READY | 2026-05-01 `8744e14` | Cost-tracker + counters; pricing function awaits economist |
| **3A: Fleet** | ✅ COMPLETE | 2026-05-01 | Declarative fleet YAML + auto-respawn shipped |
| **3B: Episodic Memory** | 🟨 PARTIAL | 2026-05-14 | queued but not yet landed in this branch |
| **3D: Fleet Dashboard** | 🔄 ACTIVE | Latest: fleet UI + metrics work ongoing | FleetBar is primary operator surface |
| **4A: Bun/Fastify** | 🟡 FASTIFY ✅, BUN ACTIVE (OFF-MAIN) | 2026-05-14+ | Fastify complete; binary/doctor on feature branches |
| **4B: IPC** | ✅ COMPLETE | 2026-03-30 | Binary IPC + MessagePack shipped |
| **4C: Radix Trie** | ✅ COMPLETE | 2026-03-31 | Semantic index shipped |
| **4D: Backpressure** | 🟨 PARTIAL | 2026-03-31 | IPC-level done; HTTP-level pending |
| **4E: Adversarial Testing** | 🔴 STALE (46d) | 2026-03-31 | Unblocked by sandboxed-test-harness |
| **4F: Windows IPC** | 🔴 STALE (46d) | 2026-03-31 | Design complete; lower priority |
| **5: Network** | 🔄 ARCHITECTURE | 2026-05-06 | Relay PKI + tube + quorum primitives live; lighthouse v0 not started |
| **6: Life Integration** | 🔄 ACTIVE | 2026-05-01+ | Telos substrate + parley coordination live |

---

## Top 3 Closest to Completion

1. **`daemon-introspection-api`** (Phase 3 health) — ~150 LOC `GET /daemon/introspect`; unlocks crew + scorecard visibility
2. **`symbol-graph-visualization`** (Phase 1 visibility) — graph_edges render as directed graph; ~4 hours
3. **`incremental-symbol-index-refresh`** (Phase 1 liveness) — filesystem watcher keeps conflict prediction current; ~150 LOC

---

## Top 3 Blocked / Drifting

1. **Phase 2 Economist** (47+ days) — Pricing function π awaits Thomas Youle follow-up since 2026-03-30
2. **Phase 4A Binary Distribution** (ACTIVE OFF-MAIN) — Bun binary / doctor / distribution on feature branches; origin/main spent release energy on v3.14.0 / v3.19.1+ prep instead
3. **Phase 4E/4F** (46+ days stale) — Adversarial testing + Windows IPC; unblocked by sandboxed-test-harness (now in execution wave) but no commits landed yet

---

## Recent Commits Unmapped to Phases (Last 7 Days)

**Release Infrastructure & Governance** (UNPLANNED ENERGY — phase-adjacent):
- `e5fc5b75` — fix(release): FleetBar zip naming correction
- `25e2f4bd` — feat(release): `pd cut --require-sign` fail-closed signing (ADR-0057)
- `a5e4f907` — chore(release): v3.20.0 auto-freshness self-heal (ADR-0062)
- `99607158` — feat(daemon): auto-freshness LaunchAgent + self-update (ADR-0062)

**FleetBar & Phase 3 UX** (Phase 3D ACTIVE):
- `388234a9` — feat(fleetbar): surface daemon berth identity in menu (ADR-0084 Phase 2)
- `01f6665b` — ci(release): make build-fleetbar-preview essential

**Security & Forensics** (Phase 4/6 adjacent):
- `092c717c` — feat(security): durable forensics journal (ADR-0060)
- `f49aa05c` — feat(tube): typed performative envelope (ADR-0047 Phase 0)

**Symbol System & Claims** (Phase 1 COMPLETE, now extending):
- `60591238` — feat(claims): claim forest read model
- `3439b305` — feat(symbols): full claim-type taxonomy
- `942a2ca7` — feat(surface-scan): live trigger (git-diff + worktree resolution)

**Fleet Governance** (Phase 3 governance lane):
- `fbead5e7` — feat(fleet): The Steward — review/landing agent (ADR-0056)

**Phase 6 & LLM Infrastructure**:
- `e397e7a4` — feat: Parley swarm coordination surface (multi-agent debate)
- `37b0d3a8` — feat(llm): semantic response cache tier (ADR-0059)
- `c686c356` — feat(models): declarative model registry (ADR-0057)

**Macaroon / Anchor Hardening** (Phase 0 extension):
- `ea829e84` — feat(macaroon): koffi client (ADR-0054 P4)
- `40f57a36` — build(core): ship libpd_anchor to dist/core (ADR-0054 P5)

---

## Open Dogfood Feedback (Now Status)

**Count**: 2 curated now-status items (from `.spark/feedback/` harvest)
- `claim-preserving-git-safety` — safe git add/reset/cherry-pick wrapping
- `fleet-launchability-and-cadence` — surface launchable vs blocked in spawn/preflight

**Open Tuple Queue**: `pd roadmap --feedback-status open --json` → `open: 0, harvested: 11`

---

## Health Signals

| Signal | Status | Notes |
|--------|--------|-------|
| **Velocity** | ✅ High | 30+ commits in last 7 days (release sprint); previously 1.3/day stable |
| **Phase 1 Completion** | ✅ VERIFIED | `f265fcb5` (2026-05-07) graph_edges + 6 indexes + symbol claims forest |
| **Release Path** | ✅ Active | v3.19.1 → v3.20.0 (auto-freshness, FleetBar, release tooling) |
| **Blocking Dependencies** | 🔴 Phase 2 economist | 47+ days; no follow-up on pricing function π since 2026-03-30 |
| **Stale Phases** | 🔴 Phase 4E/4F | 46+ days; unblocked by `sandboxed-adversarial-test-harness` now in execution wave |
| **Coordination Guard** | ✅ Enforce mode | Live in stable; extended enforcement (SessionStart/PreToolUse) queued |
| **Daemon Health** | ✅ Running | Auto-update LaunchAgent live (ADR-0062); freshness.log tracking |

---

## Execution Wave Status

**34 curated now-status items**; 2 dogfood-backed high-priority:
1. `claim-preserving-git-safety` — wrap destructive git with claim guards
2. `fleet-launchability-and-cadence` — surface readiness truth in spawn output

**Next in queue** (Phase 1 operator-visibility):
- `incremental-symbol-index-refresh` — keep conflict prediction current
- `symbol-graph-visualization` — render graph_edges as visual graph
- `daemon-introspection-api` — unified daemon health endpoint

**Phase 3 visibility cluster** (hottest mapped lane):
- `tuple-store-query-api` — fleet scorecard queue-depth substrate
- `governance-coordination-hub` — dispute/liquidation/vote rollup
- `phase-3-auto-remediation-executor` — operator-approved automation after hints
- `operator-manual-fleet-dispatch` — intentional tuple routing before auto-lane

---

## Mapping Notes

**Current Divergence**: 
- `origin/main`: 35 commits ahead of stable (v3.14.0 release-prep, now resolved in v3.19.1 / v3.20.0)
- Feature branches: `feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics` carry Phase 4A work
- Stable has absorbed latest release energy; Phase 4A binary slice still pending promotion to main

**Unplanned Work (Well-Justified)**:
- Release orchestration (ADR-0057, pd cut, require-sign, v3.20.0 auto-freshness) — infrastructure quality work
- Parley coordination surface — Phase 6 life-integration governance
- Steward agent (ADR-0056) — Phase 3 governance automation
- Macaroon koffi + libpd_anchor distribution — Phase 0 hardening
- Semantic response cache (ADR-0059) — Phase 6 performance layer
- Durable forensics journal (ADR-0060) — security/audit trail

**Signal**: Release infrastructure and governance work are accelerating beyond the formal V4 phase roadmap, representing genuine product-maturity investment.

---

## Authority & Continuity

- **Committed code** is the source of truth; git log + CHANGELOG reflect actual shipped work
- **Curated markdown** (this file + recovery docs) is the planning/roadmap surface
- **Raw files** (.spark/ideas, .spider/connections) are input streams; harvested via Spark passes
- **Next automated harvest**: when `.spark/feedback/` tree is populated or daemon tuple-backed feedback queue opens

---

**End Cartographer Mapping Pass — 2026-06-19 03:00 UTC**
