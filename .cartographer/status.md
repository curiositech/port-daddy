# Cartographer Status

**Last updated:** 2026-04-07
**Updated by:** Cartographer (manual invocation)
**HEAD:** `e7eba7b` (Fix project activity attribution and hook upgrades)
**Previous HEAD:** `e82f096` — 1 new commit since last run

---

## Current Phase

**Recovery Track dominates. V4 roadmap phases are secondary.**

Active work ledger lives at `docs/recovery/CURRENT-WORK.md`. Keep the in-flight queue there, then reflect major closures or drift here.

The last 7 commits map overwhelmingly to the Recovery Roadmap (`docs/recovery/UNIFIED-ROADMAP.md`), not the V4 phase structure. Track 1 (Cost & Observability) was closed. Tracks 2 (FleetBar) and 3 (Fleet Config UI) received active work. The V4 phases are background context; the Recovery Roadmap is the active execution authority.

Active threads, ranked by commit recency:

1. **Recovery Track 2 / 3 — FleetBar + control plane truth** — `a41f18f`, `e82f096`, `1aeb2b1`, `809816e`, and now `e7eba7b` unified FleetBar with the real fleet-config-ui via WebView, collapsed duplicate embedded chrome, pushed more runtime callers onto shared daemon discovery, and fixed the backend attribution contract those surfaces depend on. Session/sugar/file activity now carries explicit `agentId`, `targetId`, and `identityProject`, and legacy Port Daddy post-commit hooks are upgraded in place instead of silently preserving the pre-scope naked `git:committed` behavior.

2. **Recovery Track 1 — CLOSED** — `8744e14` committed `lib/counters.ts`, completing the observability trifecta (cost-tracker + counters + observability routes). All `/metrics/*` endpoints are now populated with real data. Fleet budget gates actively stop spawns. Released as v3.8.3.

3. **Fleet runtime safety** — `3b818d2` (readiness checks), `71fc446` (autopilot + sortie), `0cc5e6` (setup onboarding). Backend fallbacks, spawn preflight, budget enforcement. These map to Recovery 3.8.3 criteria.

4. **Fleet Config UI refinement** — multiple fleet-config-ui component files modified (uncommitted). ActivityPanel, ActivityRail, AgentCard, AgentConfigPanel, ChannelLog, DMPanel, App.tsx, and the new `activityFeed.ts` are under active refactoring. Embedded Flow and Activity have now both been re-verified from the daemon-served bundle with settled screenshots; the inner duplicate nav is gone in embed mode. The remaining gap is layout quality, per-agent inspect richness, resizable panes, and consuming the newly explicit backend activity attribution instead of free-text heuristics. The build is green again after the latest layout pass (`npm run typecheck`, `fleet-config-ui` build, FleetBar Swift build).

V4 Phase activity:
- **Phase 1 (Semantic Graph):** Zero commits. 7 days since last commit (2026-03-30). **7 days to stale threshold (2026-04-13).**
- **Phase 2 (Economy):** `lib/counters.ts` committed — observability trifecta complete. Pricing function still blocked on economist.
- **Phase 3 (Fleet & Memory):** 3A/3D active via Recovery tracks. 3B (episodic memory) and 3C (deep scan) untouched.
- **Phase 4 (Resilience):** No new commits. Bun binary stalled since 2026-04-01 (5 days). 4B/4C complete. 4E/4F not started.

---

## Velocity

**62 commits in the 7-day window** (2026-03-30 to 2026-04-06)
**8.9 commits/day** average (up from 8.4 — the Apr 5-6 burst added 11 commits)

| Date | Commits | Driver |
|------|---------|--------|
| 2026-03-30 | 31 | IPC Waves 1-4, security hardening, parallel agents, website compression |
| 2026-03-31 | 6 | Security fixes, fleet daemon, FleetBar app |
| 2026-04-01 | 10 | Bun binary, `pd mcp install`/`pd init`, FleetBar, blog content, CTA redesign |
| 2026-04-02 | 0 | -- |
| 2026-04-03 | 0 | -- |
| 2026-04-04 | 1 | CLI aliases + test hardening |
| 2026-04-05 | 11 | Cost-tracker, fleet safety, recovery docs, tutorials, blog, hero, VHS GIFs |
| 2026-04-06 | 4 | Track 1 closure, FleetBar unification, sortie surfaces, control plane hardening |

Burst-cool-burst pattern continues: 37 commits (Mar 30-31), 2 zero-commit days (Apr 2-3), then 15 commits (Apr 5-6). The Apr 5-6 burst was tightly focused on Recovery Track work — less scattered than the Mar 30 sprint.

### Energy Distribution (8-day window, Mar 30–Apr 6, 66 commits)

| Category | Commits | % | Roadmap Phase |
|----------|---------|---|---------------|
| Phase 4 (Fastify, IPC, Bun) | ~20 | 30% | 4A, 4B, 4C, 4D |
| Phase 3 extensions (fleet daemon, FleetBar, safety) | ~10 | 15% | 3A, 3D |
| Phase 2 (cost-tracker, counters, observability) | ~3 | 5% | 2A infrastructure |
| Recovery tracks (setup, readiness, sortie, unification) | ~5 | 8% | Recovery 3.8.3/3.8.4 |
| Security hardening | ~5 | 8% | Unplanned |
| Website / marketing / docs | ~15 | 23% | Unplanned |
| Maintenance / CI / test hardening | ~8 | 12% | Unplanned |

**Planned vs. unplanned: 58% / 42%.** Improvement over last run (was 35%/65%). The Recovery Roadmap's existence is helping — "recovery work" is now counted as planned.

**Uncommitted inventory is now explicitly tracked through `docs/recovery/CURRENT-WORK.md`.** The main in-flight slices are: project-scoped fleet channels, legacy hook auto-upgrade, structured activity attribution, daemon port discovery cleanup, FleetBar/control-plane density work, and lingering UI refinement in `fleet-config-ui` and FleetBar Swift files. Treat the recovery ledger as the operational source of truth instead of mentally diffing `git status`.

---

## Top 3 Closest to Completion

1. **Fleet Config UI v0.1** *(UNCOMMITTED, backend committed)*
   - Backend endpoints committed (`8744e14`): `GET/PUT /fleet/config/:project`, `GET /fleet/prompt`, `GET /fleet/models`
   - FleetBar unified to consume this surface (`a41f18f`)
   - 6 React components being actively refactored (uncommitted)
   - `activityFeed.ts` new utility module (untracked)
   - `public/fleet-ui/` assets rebuilt (2 deleted, 2 new, index.html modified)
   - **Remaining: stabilize component refactoring, commit. The backend is ready. The consumer (FleetBar) is ready. The UI itself is the gap.**

2. **Recovery 3.8.3 release cut** *(CRITERIA MOSTLY MET)*
   - Daemon startup: stable (committed)
   - Fleet backend/model selection: explicit with fallbacks (committed `3b818d2`)
   - Readiness/auth preflight: committed (`3b818d2`)
   - Cost/counter/observability: populated with real data (committed `8744e14`)
   - Fleet singleton enforcement: committed
   - **Remaining: verify all uncommitted test files pass, commit completions updates, cut the release. Most criteria from the Recovery Roadmap are satisfied.**

3. **`tests/unit/semantic-index.test.js`** *(UNTRACKED — 453 lines, validates Phase 1 stub)*
   - Test suite for the symbol index module
   - Has been uncommitted since 2026-03-30 (7 days)
   - Committing this would demonstrate the symbol index is validated, even if not yet activated
   - **Remaining: `git add` and commit. No code changes needed.**

---

## Top 3 Blocked or Drifting

1. **Phase 1 — Unified Edge Table (1A)** *(DRIFTING — 7 days, 7 days to stale threshold)*
   - Three Phase 1-adjacent modules on disk (~2500 lines): symbol-index, merge-queue, orchestrator-plugins
   - All wired into `server.ts` (committed `0ae2df6` on 2026-03-30)
   - But they depend on `graph_edges` table which has no migration
   - `tests/unit/semantic-index.test.js` (453 lines, uncommitted) validates symbol index
   - **The Apr 5-6 burst (7 commits) touched `server.ts` and `routes/index.ts` — the same files these modules are wired into. Merge friction risk is now elevated.**
   - **One migration away from activating ~2500 lines. 7 days to stale threshold.**

2. **Phase 2 — The Economy** *(BLOCKED on economist, infrastructure now complete)*
   - Bond pricing function pi is the open problem
   - Thomas Youle (Indiana U) proposed insurer-agent auction 2026-03-30 — no follow-up in 7 days
   - The observability trifecta gives real cost data to calibrate against
   - Fleet budget gates are enforced but use static pricing
   - **Unblocked path: export cost data from `/metrics/cost` and send to Youle. Real numbers accelerate the conversation.**

3. **Phase 4A — Bun binary** *(STALLED — 5 days since last commit)*
   - `6a8c8bb` (Apr 1) added build scripts and GH Actions workflow
   - `db4c315` (Apr 4) included "Bun prep"
   - No confirmed working single-file binary distribution
   - No commits since Apr 4
   - **Not yet at stale threshold, but the Apr 5-6 burst went to Recovery work, not Bun. If the next burst also skips Bun, it risks stalling permanently.**

---

## Observations

- **The Recovery Roadmap is the real execution authority.** 5 of 7 new commits map directly to Recovery Track criteria (Track 1 closure, Track 2 FleetBar, 3.8.3 runtime safety). The V4 phase structure is becoming a reference taxonomy rather than an active execution plan. This is fine — as long as both documents are maintained. The cartographer should update both.

- **Track 1 closure broke a 3-run pattern.** `lib/counters.ts` was flagged as "one commit away" in three consecutive cartographer runs (Apr 5 first run, Apr 5 second run, and the manual sync note). It finally shipped in `8744e14`. The pattern suggests: cartographer flagging alone doesn't drive commits, but having a "Recovery Track" with explicit closure criteria does. Recovery Tracks are more motivating than cartographer warnings.

- **FleetBar architecture is now correct.** `a41f18f` eliminated the "shadow dashboard" anti-pattern — FleetBar shells the daemon's fleet-config-ui instead of reimplementing it in SwiftUI. One fleet UI, two consumers (browser + native). This is the architecture that should have been built from the start. The hardening commit (`e82f096`) immediately followed, which is good discipline.
- **The deeper Activity bug was backend attribution, not just UI layout.** Briefing and project-scoped activity views were querying by `target_id` prefix even though real `session.start`, `session.end`, `session.note`, and sugar rows often had `target_id = null`. The active fix is to stamp scope into the activity writers and read structured metadata back out, rather than teaching more UI code to regex prose.
- **Shared hook templates were ahead of live installs.** The repo templates already published scoped `project:<slug>:<hash>:git:committed`, but existing checkouts were still carrying the pre-scope Port Daddy hook in `.git/hooks/post-commit`, and installers were treating any hook mentioning `git:committed` as already current. The active fix is legacy-hook replacement in `pd init` / `pd fleet init`, not more template churn.

- **Phase 1 stale clock: 7 days.** Equal to the time remaining before the threshold. The `graph_edges` migration is a 1-hour task. Every commit to `server.ts` (2 this burst) increases friction. The symbol index test suite sitting uncommitted for 7 days is a smell — someone validated the code but didn't commit the validation.

- **Spider output: still uncommitted, still ambiguous.** 10 new connection files from Apr 5. Zero spider output has ever been committed. The noise in `git status` is now 10/50 files (20%). Decision needed: `.gitignore` or commit. Previous recommendation stands from 2 runs ago.

- **Document authority: now clearer.** The Recovery Roadmap at `docs/recovery/UNIFIED-ROADMAP.md` is the execution authority (with explicit release criteria). The V4 Roadmap at `docs/V4-UNIFIED-ROADMAP.md` is the strategic context (phase structure, appendix, unplanned work log). This division is workable as long as the cartographer maintains both. The V4 roadmap's redirect header to the recovery docs is appropriate.

- **Uncommitted file count trending down: 103 → 76 → 50.** Two consecutive cartographer runs showing improvement. The Track 1 closure committed the most structurally important changes. Remaining uncommitted work is mostly UI refinement (fleet-config-ui, FleetBar Swift) and test files — lower risk than the `server.ts` + `routes/*.ts` changes that were in the previous batch.
