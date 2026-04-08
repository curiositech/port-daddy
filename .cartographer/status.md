# Cartographer Status

**Last updated:** 2026-04-07
**Updated by:** Cartographer (manual invocation)
**HEAD:** `55258f6` (Sync ledgers after archaeology rehab)
**Previous HEAD:** `3ece95a` — 2 new commits since last run

---

## Current Phase

**Recovery Track dominates. V4 roadmap phases are secondary.**

Active work ledger lives at `docs/recovery/CURRENT-WORK.md`. Keep the in-flight queue there, then reflect major closures or drift here.

The last 7 commits map overwhelmingly to the Recovery Roadmap (`docs/recovery/UNIFIED-ROADMAP.md`), not the V4 phase structure. Track 1 (Cost & Observability) was closed. Tracks 2 (FleetBar) and 3 (Fleet Config UI) received active work. The V4 phases are background context; the Recovery Roadmap is the active execution authority.

Active threads, ranked by commit recency:

1. **Recovery runtime slice — Codex backend + all-backend model tiers** — uncommitted working tree. Port Daddy now has a real live `codex` backend path, a second daemon-backed smoke proved `pd spawn --backend codex --tier low` end-to-end, and the tier contract is being completed for every backend instead of only Claude/Gemini/Codex. The remaining important follow-on is budget discipline and operator truth around spawn frequency, not backend wiring.

2. **Recovery Track 2 / 3 — FleetBar + control plane truth** — `a41f18f`, `e82f096`, `1aeb2b1`, `809816e`, `e7eba7b`, `1ebe6e6`, `853cc57`, and now `83d1a22` pushed the runtime and UI toward one truthful control plane. The newest runtime slice added explicit file actions to the operator surfaces: the daemon now exposes `/operator/open-file`, the web control plane renders `Open in Finder` / `Open with default editor` for touched files, and FleetBar mirrors the same affordances natively instead of offering ambiguous file chips.

3. **Recovery Track 1 — CLOSED** — `8744e14` committed `lib/counters.ts`, completing the observability trifecta (cost-tracker + counters + observability routes). All `/metrics/*` endpoints are now populated with real data. Fleet budget gates actively stop spawns. Released as v3.8.3.

4. **Fleet/runtime archaeology rehab** — `3ece95a` promoted long-dirty roadmap/docs changes and two substantive untracked test suites (`semantic-index`, `tunnel-lifecycle`). It also shipped a small but real runtime hygiene fix: the spawner heartbeat interval now `unref()`s so blocked-spawn tests do not hold Jest open just by hitting the concurrency ceiling.

5. **Residual archaeology still on disk** — only one substantive file and one residue policy decision remain:
   - `tests/unit/spawner-commit-0df9155-bugs.test.js`, which is mostly redundant with `tests/unit/spawner.test.js` and still freezes known-bad behavior as expected output
   - the spider connection note pile under `.spider/connections/` is now explicitly moving into `.gitignore` rather than pretending to wait for promotion
   Everything else from the previously dirty runtime/test/doc slices has now been either committed or explicitly quarantined.

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

**Uncommitted inventory is now small enough to name explicitly.** The main in-flight slices are: lease self-healing verification, loopback host / daemon discovery cleanup, project-scoped trigger archaeology, FleetBar/control-plane density work, the native-shell singleton/resizing/operator-ergonomics fixes, and the redundant spawner bug-battery test. Treat `docs/recovery/CURRENT-WORK.md` as the operational source of truth instead of mentally diffing `git status`.

---

## Top 3 Closest to Completion

1. **Fleet Config UI v0.1** *(Mostly committed, still iterating)*
   - Backend endpoints committed (`8744e14`): `GET/PUT /fleet/config/:project`, `GET /fleet/prompt`, `GET /fleet/models`
   - FleetBar unified to consume this surface (`a41f18f`)
   - explicit file actions shipped (`83d1a22`)
   - Activity/Sortie truth fixes shipped (`853cc57`)
   - **Remaining: higher-level product/UX cleanup, not core wiring.**

2. **Daemon discovery + lease recoverability cleanup** *(UNCOMMITTED, high leverage)*
   - `shared/daemon-discovery.ts` now carries the shared loopback host
   - `cli/utils/fetch.ts`, `server.ts`, FleetBar `DaemonLocation.swift`, and fleet-ui API defaults were updated to stop sprinkling new `localhost:9876` assumptions
   - `lib/fleet-daemon.ts` now attempts lease reacquisition when renewal sees `lock not held` and no competing holder exists
   - regression coverage added in `tests/unit/fleet-daemon.test.js`
   - **Remaining: restart the live daemon and verify `/fleet` actually recovers instead of sitting in `skipped` with `owner: null`**

3. **Recovery 3.8.3 release cut** *(CRITERIA MOSTLY MET)*
   - Daemon startup: stable (committed)
   - Fleet backend/model selection: explicit with fallbacks (committed `3b818d2`)
   - Readiness/auth preflight: committed (`3b818d2`)
   - Cost/counter/observability: populated with real data (committed `8744e14`)
   - Fleet singleton enforcement: committed
   - **Remaining: verify all uncommitted test files pass, commit completions updates, cut the release. Most criteria from the Recovery Roadmap are satisfied.**

4. **`tests/unit/spawner-commit-0df9155-bugs.test.js`** *(UNTRACKED — ambiguous value)*
   - Covers real regression scenarios, but duplicates much of `tests/unit/spawner.test.js`
   - Encodes known-bad behavior as expected output instead of defining the corrected contract
   - **Remaining: either convert it into normative regression coverage or leave it out.**

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
- **The channel scoping bug is now split into “engine” versus “archaeology.”** `lib/fleet-channels.ts` already scopes logical fleet channels by `projectDir`, and current tests cover `global:` bypass semantics. The reactive dashboard now also resolves logical names to physical scoped channels before polling/publishing. If `expunge-my-arrest` still wakes on a Port Daddy website commit, stale detached watcher processes or already-open stale UI clients are the first suspects, not missing scoping in the modern fleet engine.
- **Socket truth and TCP truth can diverge.** `port-daddy status` talks over the Unix socket and can report healthy while browser/FleetBar TCP consumers still fail or drift. Operator validation now needs both surfaces checked, not just the CLI.
- **Freshness authority was too broad.** The monolithic CLI still had an old freshness auto-restart path that could SIGTERM the canonical daemon from foreign checkouts or non-interactive watcher commands. `1ebe6e6` narrowed that authority to interactive commands from the same install root as the live daemon.
- **The next UI truth bug is still sortie-specific.** The control plane no longer resets runtimes after launch, but the end-to-end sortie path still needs fresh live verification now that daemon-side errors surface inline.
- **Backend-tier truth is now wider than the UI currently shows.** The runtime now carries low/mid/high ladders for Claude SDK, Claude CLI, Gemini, Codex, Ollama, Aider, and Custom. `aider` now honors the selected model at execution time, and `custom` receives the resolved model/tier via env so wrappers can act on it. The next honesty task is exposing that same tier truth clearly in operator surfaces, not letting it stay backend-only knowledge.
- **Claude SDK readiness was lying by omission.** The readiness probe only checked `ANTHROPIC_API_KEY`, not whether `@anthropic-ai/sdk` was installed, so the UI could honestly-ish say “ready” and then fail at launch for a missing package. The active fix makes dependency presence part of readiness.
- **Activity had a second lie after project attribution was fixed.** Even when the project log had meaningful work, the left rail could still say “No non-empty agent signals yet” because it only rendered agents with precomputed signals. The current UI patch switches Activity to always list configured agents and use feed fallback when structured signals are sparse.
- **Operator file affordances were too vague.** Showing touched files without explicit machine actions forced operators back into manual path copying. The control plane and FleetBar now expose Finder/editor actions directly off surfaced file mentions.
- **Lease loss with `owner: null` is recoverable, not terminal.** The daemon should reacquire in that case instead of leaving the project permanently skipped. That fix is now in the working tree with regression coverage.
- **Shared hook templates were ahead of live installs.** The repo templates already published scoped `project:<slug>:<hash>:git:committed`, but existing checkouts were still carrying the pre-scope Port Daddy hook in `.git/hooks/post-commit`, and installers were treating any hook mentioning `git:committed` as already current. The active fix is legacy-hook replacement in `pd init` / `pd fleet init`, not more template churn.
- **Daemon logs can mix generations of client truth.** After the latest `fleet-ui` channel fix, a fresh Playwright-driven load polled `/msg/project:...:` channels correctly, while older already-open clients continued to hit naked logical channels until they reloaded. Log archaeology now has to distinguish stale client traffic from current bundle behavior.
- **Not all repo dirt deserves promotion.** The spider markdown pile is generated research output and now belongs in `.gitignore` by default, not in suspense as pseudo-canonical docs. The extra spawner bug-battery test is only promotable once it stops asserting broken behavior as success.

- **Phase 1 stale clock: 7 days.** Equal to the time remaining before the threshold. The `graph_edges` migration is a 1-hour task. Every commit to `server.ts` (2 this burst) increases friction. The symbol index test suite sitting uncommitted for 7 days is a smell — someone validated the code but didn't commit the validation.

- **Feedback audit surfaced a real ledger gap.** Several operator asks were implemented or discussed in chat but were not explicitly captured in the recovery queue: singleton Fleet Control Center behavior, Dock/native-window expectations, obvious stop/start controls, split-pane resizing, scheduled-job vs agent taxonomy, and concrete event-source examples/snippets. Those are now promoted into `docs/recovery/CURRENT-WORK.md` instead of relying on memory.
- **Dogfooding exposed a fourth runtime truth surface.** `pd agent` is not just “sortie lite.” It creates a sugar session plus a single spawned-agent record and can disappear from the live agent registry immediately after completion/failure. The control plane therefore needs to distinguish configured fleet agents, ad hoc manual jobs (`pd agent` / direct `pd spawn`), and sorties instead of flattening them into one generic “agent” concept.

- **Document authority: now clearer.** The Recovery Roadmap at `docs/recovery/UNIFIED-ROADMAP.md` is the execution authority (with explicit release criteria). The V4 Roadmap at `docs/V4-UNIFIED-ROADMAP.md` is the strategic context (phase structure, appendix, unplanned work log). This division is workable as long as the cartographer maintains both. The V4 roadmap's redirect header to the recovery docs is appropriate.

- **Uncommitted file count trending down: 103 → 76 → 50.** Two consecutive cartographer runs showing improvement. The Track 1 closure committed the most structurally important changes. Remaining uncommitted work is mostly UI refinement (fleet-config-ui, FleetBar Swift) and test files — lower risk than the `server.ts` + `routes/*.ts` changes that were in the previous batch.
