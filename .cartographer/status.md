# Cartographer Status — Port Daddy v4 Map

**Last Updated**: 2026-05-12 14:55 UTC (Cartographer verification pass — daemon feedback PROJECTION LIVE; execution wave confirmed 18 items (13 now-status) with 2 new Spark additions `graph-based-merge-conflict-predictor` and `ambient-anomaly-signaling`; 7-day velocity 7.7/day stable; 0 feature implementation commits since May 9; raw 2026-05-10 Spider exhaust remains as S41/S42/S43)
**Authority**: Committed code + git log > curated markdown (recovery hub) > raw files (.spark)

---

## Current Snapshot

| Signal | Value |
|--------|-------|
| Phase Status | 0: ✅ COMPLETE \| 1: ✅ COMPLETE \| 2: 🔄 INFRA READY \| 3: 🔥 ACTIVE (hottest mapped phase) \| 4: 🟨 PARTIAL \| 5: 🔄 ARCHITECTURE \| 6: 🔄 ACTIVE |
| 7-Day Velocity | 7.7 commits/day (54 commits trailing 7 days, stable post-May-1) |
| HEAD Commit | `5ee873cd` (Spark: Promote merge-conflict-predictor and anomaly-signaling ideas) |
| Most Recent Code | `f265fcb5` (Phase 1 complete: Unified semantic graph edges table, 2026-05-07) |
| Daemon Status | ✅ Operational (v3.13.0, PID 25155); tuple-backed feedback projection LIVE — 18 execution-ready items visible |
| Feedback Queue | **18 total next-cuts items**; 13 now-status in the execution wave (2 dogfood + 11 trove), with 5 additional now-status trove entries lower in the curated backlog; execution wave lives in curated markdown; open dogfood now-items: `claim-preserving-git-safety`, `fleet-launchability-and-cadence` |
| Stale Phases (≥39 days) | Phase 4A (41 days, Bun binary); Phase 4E (42 days, self-test); Phase 4F (42 days, Windows IPC) |
| Blocked Phases | Phase 2 economist (no follow-up since 2026-03-30 — 43 days idle — Thomas Youle pricing function π); Phase 4A Bun binary (waiting on shipping decision); Phase 4E/4F stale (self-test + Windows IPC) |

---

## Top 3

- **Closest to completion**: `claim-preserving-git-safety`, `daemon-introspection-api`, `ideas-trove-queryable-surface`
- **Blocked or drifting**: Phase 2 economist, Phase 4A Bun binary, Phase 4E/4F stale
- **Open dogfood now**: 2 entries, `claim-preserving-git-safety` and `fleet-launchability-and-cadence`

---

## Phase Status Grid

| Phase | Status | Last Commit | Notes |
|-------|--------|-------------|-------|
| **0: Formal Foundation** | ✅ COMPLETE | 2026-04-16 | White papers, Rust core, Arbiter, PKI, Coordination Guard, Merkle-chain shipped |
| **1: Semantic Graph** | ✅ COMPLETE | 2026-05-07 `f265fcb5` | graph_edges table + 6 indexes fully persisted + tested; reflection pass `2ad20f32` documented |
| **2: Economy & Cost** | 🔄 INFRASTRUCTURE READY | 2026-05-01 `8744e14` | cost-tracker + counters + observability endpoints ✅; pricing function π awaits economist |
| **3A: Fleet & Memory** | ✅ COMPLETE | 2026-05-01 | Declarative fleet YAML + pheromone system + auto-respawn shipped |
| **3B: Episodic Memory** | ⏸ BLOCKED | — | Downstream of Phase 2; design exists, no commits |
| **3C: Deep `pd scan`** | ⏸ BLOCKED | — | Downstream of Phase 2; not started |
| **3D: Fleet Dashboard** | 🔄 EVOLVED | 2026-05-02 | Standalone Fleet Live + menu bar app + Config UI (WIP); exceeds original "panel" spec |
| **4A: Bun/Fastify** | 🟨 PARTIAL | 2026-04-01 | Fastify migration ✅; Bun binary build scripts exist but no shipped binary |
| **4B: IPC** | ✅ COMPLETE | 2026-03-30 | Binary IPC + MessagePack + Backpressure all shipped v3.8.2 |
| **4C: Radix Trie** | ✅ COMPLETE | 2026-03-31 | Semantic index + harbor bitmask filtering shipped |
| **4D: Backpressure** | 🟨 PARTIAL | 2026-03-31 | IPC-level ✅; HTTP-level not started |
| **4E: `pd self-test --adversarial`** | 🔴 STALE | 2026-03-31 | Design complete; zero commits for 42 days |
| **4F: Windows IPC Hardening** | 🔴 STALE | 2026-03-31 | Design noted; zero commits for 42 days |
| **5: Network & Lighthouses** | 🔄 ARCHITECTURE | 2026-05-06 `60f72edd` | Relay PKI + Merkle-chain + `pd tube` + quorum primitives shipped; full lighthouse v0 not started |
| **6: Life Integration** | 🔄 ACTIVE | 2026-05-01 | Telos substrate landed; explicit suggestion layer remains open |

---

## Execution Wave (13 now-status items — from `pd roadmap --feedback-status open --json`)

**High-priority next cuts** (ordered by dependency/readiness):

1. **claim-preserving-git-safety** (dogfood) — 2–3 days; wrap `git add -A` / `reset --hard` / `cherry-pick` with claim guardrails
2. **daemon-introspection-api** (Spark 2026-05-09) — ~150 LOC `GET /daemon/introspect`; unlocks Crew + Scorecard aggregation
3. **ideas-trove-queryable-surface** (Spark 2026-05-09) — ~180 LOC `pd ideas` CLI + HTTP API; unlocks trove dedupe enforcement
4. **coordination-guard-extended-enforcement** (trove) — 2–3 days; extend from pre-commit to SessionStart + PreToolUse + destructive verbs
5. **fleet-launchability-and-cadence** (dogfood) — 1–2 days; surface `launchable` vs `blocked` in spawn/preflight
6. **crew-screen-roles-not-pids** (trove) — dashboard: replace agents-by-PID with fleet roles view
7. **fleet-health-scorecard** (trove) — dashboard: single glance for swarm health (role health, cost burn, queue depth, violations)
8. **coordination-ticker-as-high-signal-feed** (trove) — dashboard: live ticker for `coordination:inconsistency` channel
9. **quorum-driven-dynamic-launch** (trove; Phase 1 shipped in `cea02e1`) — Phase 2 dependency: auto-spawn declared spawnable-on-quorum roles
10. **ipc-disconnect-instant-salvage** (trove) — treat IPC activity as heartbeat, salvage on disconnect (not 10–20 min window)
11. **telos-driven-model-selection** (trove) — Phase 6: spawn-time suggestion layer without hiding model overrides
12. **graph-based-merge-conflict-predictor** (Spark 2026-05-11) — ~200 LOC semantic symbol-level conflict detection; prevents merge surprises
13. **ambient-anomaly-signaling** (Spark 2026-05-11) — monitoring + alerting for rare/anomalous Fleet patterns; unblock Phase 4 self-test diagnostics

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

## Feedback Pipeline & Harvest Status (2026-05-09 14:22 UTC)

- **Daemon tuple feedback**: ⚠ unavailable in this shell — `pd roadmap --feedback-status open --json` and `pd feedback list --status open --json` both hit `connect EPERM` on `~/.port-daddy/daemon.sock`
- **Curated entries (DOGFOOD-FEEDBACK.md)**: 5 total entries
  - now (2 at status=now): `claim-preserving-git-safety`, `fleet-launchability-and-cadence`
  - backlog (3 at status=backlog): `session-context-cwd-reset`, `feedback-route-stable-gap`, `fleet-status-skipped-duplicates`
- **Ideas-Trove now-status (IDEAS-TROVE.md)**: 16 curated now items; 11 are already in the execution wave above, and 5 additional now-status trove entries remain lower-priority backlog (`fleet-run-journal`, `salvage-root-cause-classifier`, `forensic-context-windows`, `tuple-driven-fleet`, `capability-discovery-dns-harbor`)
- **Raw .spark/feedback/**: Tree not present in this checkout; next auto-harvest pending on agent contribution or commit
- **Spark/Spider residue**: `.spark/ideas/` and `.spider/connections/` exist locally; Spark pass (2026-05-08) promoted `fleet-health-scorecard` and `telos-driven-model-selection`; Spark pass (2026-05-09) promoted `daemon-introspection-api` and `ideas-trove-queryable-surface` (both "now" candidates); the 2026-05-11 Spark promotion added `graph-based-merge-conflict-predictor` and `ambient-anomaly-signaling`; the 2026-05-10 raw exhaust now remains as `S41`/`S42`/`S43` and is still uncurated
- **Trove-to-roadmap promotion**: 18 items queued in execution wave (13 now-status items: 6 dogfood/trove + 3 from 2026-05-08 Spark + 2 from 2026-05-09 Spark + 2 from 2026-05-11 Spark; 5 lower-priority now-status trove entries not yet scheduled)
- **Next harvest**: 2026-05-11 harvest complete (4 Spark ideas promoted); next automatic harvest on next commit via `pd feedback` daemon tuple stream when available, or when `.spark/feedback/` tree is populated

---

## Health Signals

| Metric | Status | Notes |
|--------|--------|-------|
| Test Suite | ✅ All passing | `npm test` baseline maintained |
| Velocity | ✅ 7.7/day (54 commits) | Stable post-May-1-burst. Previous burst: May 1-2 (7 commits fleet-model, 15+ docs content, cost-tracker aliases). |
| Phase 1 Completion | ✅ VERIFIED (2026-05-07 `f265fcb5`) | graph_edges table + 6 indexes + full schema + tests + MCP. Reflection pass `2ad20f32` completed 2026-05-08. |
| Blocking Dependencies | 🔴 Phase 2 economist (43 days idle) | Thomas Youle / pricing function π — no follow-up since 2026-03-30. |
| Stale Phases | 🔴 Phase 4A/4E/4F (41–42 days) | Bun binary: design complete, no binary distribution. Windows IPC/self-test: designs complete, zero implementation commits since 2026-03-31. |
| Coordination Guard | ✅ Enforce mode in stable | `.portdaddy/coordination-guard.json` live. Extended enforcement (SessionStart/PreToolUse/destructive-git) is #2 execution priority. |
| Daemon Tuple Feedback | ✅ LIVE | `pd roadmap --feedback-status open --json` returns 18-item execution projection (13 now-status + 5 backlog-priority trove). Tuple stream confirmed operational. |
| Unplanned Work Signal | 🟨 Healthy leak | Cartographer verification / status reconciliation (`f4624ebd`, `05e94639`, `3b9d17ce`, `e6bd1b88`, `670ab97b`) plus May 1 fleet-model/telos hardening (7 commits); docs content fill (15+ pages); relay/harbor mesh ADR; whitepaper rewrite; the 2026-05-11 Spark promotion (`5ee873cd`); and the fresh 2026-05-10 raw Spider exhaust (`S41/S42/S43`), all adding product signal outside named V4 phases. |

---

**Authority**: pd roadmap --feedback-status open --json (daemon tuples)
