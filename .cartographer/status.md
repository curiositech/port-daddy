# Cartographer Status

> Manual sync note — 2026-04-06:
> Commit `8744e14` closed Recovery Track 1 by promoting `cost-tracker`, `counters`, spawn preflight enforcement, and the live `/metrics/*` surface. It also shipped the first `SortiePanel` mission workspace slice plus the FleetBar native control-center window. Treat the counters-related warnings below as historical context from the prior hour, not current truth.

**Last updated:** 2026-04-05 (second run — same day, no new commits since last run)
**Updated by:** Cartographer (manual invocation)
**HEAD:** `0169b17` (unchanged since last run)

---

## Current Phase

**No dominant phase. Energy is split four ways — and none of them are Phase 1.**

Active threads, ranked by uncommitted diff size:

1. **Fleet as first-class daemon subsystem** — The biggest uncommitted thread. `server.ts`, `routes/fleet.ts`, `routes/index.ts`, `cli/commands/fleet.ts`, `lib/fleet-daemon.ts`, `lib/fleet-engine.ts` all modified. New modules: `lib/fleetbar-launcher.ts` (launch FleetBar from daemon), `lib/ui-preferences.ts` (persist UI prefs), `cli/commands/setup.ts` (new onboarding command), `public/fleet-ui/` (fleet management UI served from daemon). Fleet Config UI (`fleet-config-ui/`) being refactored (3 components deleted, 8 new ones). FleetBar macOS app gaining CostDashboard + CostStore + Preferences. This is evolving Fleet from "background agents" toward a product with its own UI, launcher, and setup flow — none of which is in the V4 roadmap.

2. **Test hardening** — 6 test files modified, 3 new test files untracked (`spawner-commit-0df9155-bugs.test.js`, `tunnel-lifecycle.test.js`, `tutorials.test.ts`). `tests/setup-unit.js` modified. Good hygiene work.

3. **Website/distribution** — `website-v2/package.json` and `vite.config.ts` modified. 8 of 11 commits today were website. The content debt treadmill continues.

4. **Spider output** — 10 new connection files from 2026-04-05 (largest batch to date). The spider is productive; its output is never committed.

Phase 1 (Semantic Graph): **zero commits since 2026-03-30 (6 days).** Stale threshold: 2026-04-13.
Phase 2 (Economy): First commit landed today (`0169b17`). `lib/counters.ts` still untracked. Blocked on economist for pricing function.
Phase 3 (Fleet & Memory): 3A/3D shipped. 3B (episodic memory) and 3C (deep scan) untouched. Fleet Config UI is unplanned work that supersedes 3D.
Phase 4 (Resilience): 4A (Bun binary) stalled since 2026-04-01 (4 days). 4B/4C complete. 4D partial. 4E/4F not started.

---

## Velocity

**59 commits in the 7-day window** (2026-03-30 to 2026-04-05)
**8.4 commits/day** average (down from 11.0/day — Mar 29 spike dropped out of the window)

| Date | Commits | Driver |
|------|---------|--------|
| 2026-03-30 | 31 | IPC Waves 1-4, security hardening, parallel agents, website compression |
| 2026-03-31 | 6 | Security fixes, fleet daemon, FleetBar app |
| 2026-04-01 | 10 | Bun binary, `pd mcp install`/`pd init`, FleetBar, blog content, CTA redesign |
| 2026-04-02 | 0 | -- |
| 2026-04-03 | 0 | -- |
| 2026-04-04 | 1 | CLI aliases + test hardening |
| 2026-04-05 | 11 | Cost-tracker committed, fleet safety, recovery docs, tutorials, blog, hero, VHS GIFs |

The post-sprint cooling pattern persists: 37 commits in 2 days (Mar 30-31), then 2 zero-commit days (Apr 2-3), then recovery. Burst-cool-burst. The bursts are productive but the gaps mean uncommitted work accumulates in the dark.

### Energy Distribution (full 8-day window, Mar 29–Apr 5, 77 commits)

| Category | Commits | % | Roadmap Phase |
|----------|---------|---|---------------|
| Phase 4 (Fastify, IPC, Bun) | ~20 | 26% | 4A, 4B, 4C, 4D |
| Phase 3 extensions (fleet daemon, FleetBar, safety) | ~6 | 8% | 3A, 3D |
| Phase 2 (cost-tracker) | 1 | 1% | 2A infrastructure |
| Security hardening | ~5 | 6% | Unplanned |
| Website / marketing / docs | ~35 | 45% | Unplanned |
| Maintenance / CI / test hardening | ~10 | 13% | Unplanned |

**Planned vs. unplanned: 35% / 65%.** The Mar 29-30 sprint was heavily roadmap-aligned (Phase 4). Since Mar 31, energy has been ~80% unplanned. Today: 2 of 11 commits map to a roadmap phase.

**Uncommitted inventory: ~37 untracked + ~39 modified/deleted = 76 files.** Down from ~103 after `.gitignore` cleaned build output (`9f1e32b`). The composition shifted: fewer stray untracked files, more deliberate modifications to core daemon files (`server.ts`, `routes/*.ts`, `lib/*.ts`). The uncommitted work is becoming more structurally important — it's not just spider outputs and new modules sitting idle, it's active wiring of features into the daemon's main entry points.

---

## Top 3 Closest to Completion

1. **`lib/counters.ts` — last piece of observability trifecta** *(UNTRACKED)*
   - `lib/counters.ts` (~314 lines): ODS-style time-bucketed operational metrics, in-memory batching -> SQLite
   - `tests/unit/counters.test.js` (~161 lines)
   - The cost-tracker and observability routes are committed. Counters is the last piece.
   - `features.manifest.json` already has `counters` and `observability` entries (uncommitted).
   - **Remaining: literally `git add lib/counters.ts tests/unit/counters.test.js` and commit.**
   - **This has been "one commit away" for two cartographer runs now.**
   - Completing this also finishes Recovery Roadmap Track 1 ("commit and promote cost-tracker, counters, and observability").

2. **Fleet Config backend endpoints** *(MODIFIED, not committed)*
   - 4 new fleet routes (`config read/write`, `prompt`, `models`) wired into `routes/fleet.ts`
   - `routes/index.ts` and `server.ts` modified to register them
   - `cli/commands/fleet.ts` modified with CLI surface
   - `features.manifest.json` updated
   - **Remaining: verify tests pass, commit. The code is wired but untested.**

3. **Fleet Config UI v0.1** *(UNTRACKED)*
   - 8 components: AgentCard, AgentConfigPanel, FlowGraph, YAMLEditor, SortiePanel, DMPanel, ChannelLog, ProjectPicker
   - api.ts, hooks/, types.ts — real React app scaffolding
   - Depends on Fleet Config backend endpoints (item 2) being committed first
   - **Remaining: commit as v0.1. Iterate in subsequent commits.**

---

## Top 3 Blocked or Drifting

1. **Phase 1 — Unified Edge Table (1A)** *(DRIFTING — 6 days, 8 days to stale threshold)*
   - Three Phase 1-adjacent modules on disk (~2500 lines): symbol-index, merge-queue, orchestrator-plugins
   - All wired into `server.ts` (committed `0ae2df6` on 2026-03-30)
   - But they depend on `graph_edges` table which has no migration
   - `tests/unit/semantic-index.test.js` (453 lines, uncommitted) validates symbol index
   - **One migration away from activating ~2500 lines. 8 days to stale threshold.**
   - **Risk: if Phase 1 goes stale, the wired-but-inactive modules become tech debt — code that's imported, initialized, but does nothing.**

2. **Phase 2 — The Economy** *(BLOCKED on economist, infrastructure now exists)*
   - Bond pricing function pi is the open problem
   - Thomas Youle (Indiana U) proposed insurer-agent auction 2026-03-30 — no follow-up in 6 days
   - The cost-tracker commit (`0169b17`) gives real data to calibrate against
   - Fleet budget gates (`budget_usd_per_day`) are enforced but use static pricing
   - **Unblocked path: ship cost data to Youle. Real numbers accelerate the conversation.**

3. **Uncommitted work backlog** *(76 files — composition shifted, risk elevated)*
   - Headline number improved (76 down from ~103), but that's `.gitignore` cleaning, not commits
   - The uncommitted work is now structurally deeper: `server.ts` modified, `routes/index.ts` modified, `routes/fleet.ts` modified — these are the daemon's main entry points
   - Pattern persists: work completes -> sits uncommitted for days -> risks drifting from codebase
   - **Previous cartographer runs have flagged this 4 times now. The pattern is durable.**

---

## Observations

- **Fleet is becoming a shadow roadmap.** `lib/fleetbar-launcher.ts`, `lib/ui-preferences.ts`, `cli/commands/setup.ts`, `public/fleet-ui/` — none of these appear in any V4 phase. They're building "Fleet as a Product" — a standalone fleet management experience with its own UI, macOS app, setup flow, and daemon integration. If this is the direction, it deserves its own roadmap item (Phase 3E? Or a separate "Distribution & Developer Experience" track). The roadmap says "agents run continuously and are managed declaratively" — the work is going well beyond that toward "fleet is the primary interface."

- **`lib/counters.ts` has been "one commit away" for two runs.** Still untracked. The cost-tracker shipped today; counters didn't ride along. Either it's not ready, or it keeps losing priority to more interesting work. The `/metrics/golden` endpoint exists but returns incomplete data without counters backing it.

- **Spider output: commit it or ignore it.** 10 connection files today — largest batch ever. Zero spider output has ever been committed. The current state (generated, visible in `git status`, never committed) is ambiguous. If it's meant to be ephemeral, add `.spider/connections/` to `.gitignore`. If it's meant to be preserved, commit it. The ambiguity adds noise to every `git status` reading.

- **Phase 1 stale clock: 8 days.** The `graph_edges` migration is a 1-hour task blocking ~2500 lines. The cost-tracker commit today proved that "commit the done work" is achievable. The symbol-index test suite (453 lines, uncommitted) suggests someone already validated the code. Wire it.

- **Website energy: round 6 since Mar 25.** Each round discovers more content debt. 8 of 11 commits today were website. Consider: declare a website content freeze date to reclaim bandwidth for Phases 1/2. The content treadmill is self-reinforcing and will never "finish" on its own.

- **Document authority is splitting.** Three roadmap-like files now exist: `docs/V4-UNIFIED-ROADMAP.md` (V4 phase tracker), `docs/V4-RECOVERY-MAP.md` (execution priorities), and `docs/recovery/UNIFIED-ROADMAP.md` (declared "active authority" as of `bfe30e1`). The V4 roadmap and Recovery Map both have redirect headers deferring to the recovery docs. The cartographer currently maintains the V4 roadmap and this status file. If the recovery roadmap is the real authority, it should also receive cartographer updates — or the V4 roadmap should drop its redirect and reclaim primacy. Two canonical docs with cross-references is a coordination smell.
