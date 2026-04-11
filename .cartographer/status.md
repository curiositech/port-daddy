# Cartographer Status

**Last updated:** 2026-04-11
**Updated by:** Cartographer (manual invocation)
**HEAD:** `50fe92f` (Harden session context and explicit note scoping)
**Previous HEAD:** `e70d614` — 1 new commit since last run

---

## Current Phase

**Recovery Track dominates. V4 roadmap phases are secondary.**

Active work ledger lives at `docs/recovery/CURRENT-WORK.md`. Keep the in-flight queue there, then reflect major closures or drift here.

The latest committed work still maps overwhelmingly to the Recovery Roadmap (`docs/recovery/UNIFIED-ROADMAP.md`), not the V4 phase structure. Track 1 (Cost & Observability) is closed. Tracks 2 (FleetBar) and 3 (Fleet Config UI) remain active. The working tree now also contains a real Phase 1 / memory slice, so the old claim that graph work was untouched is no longer true.

Active threads, ranked by commit recency:

1. **Semantic graph + episodic memory slice** — uncommitted working tree. The repo now has a real `graph_edges` implementation plus an `episodic_memory` store, HTTP routes for both, tests for both, and a new Memory surface in `fleet-config-ui` / FleetBar. Existing systems are being wired into it: symbol indexing writes file/symbol/dependency edges, merge-queue writes merge-entry/branch/file/status edges, sessions promote handoffs/findings/decisions/results/failures into episodes, sorties promote blocked/completed/failed mission moments into episodes, and tuple scanning now supports filtered search for the Memory view.
   - This means the live working tree has already crossed the boundary from “Phase 1 is blocked on `graph_edges`” into “Phase 1 plumbing exists but is uncommitted and undocumented.”
   - The immediate truth task is no longer inventing the feature; it is deciding whether this slice is the next real cut or crash residue that needs quarantine.
   - `docs/recovery/CURRENT-WORK.md` and this status file both needed an honesty update because they were still describing the pre-graph state.

2. **Recovery docs/runtime truth sync** — still active, now partly committed and partly merged with the graph/memory slice. README, MCP docs, OpenAPI, the Port Daddy skill bundle, and the website’s core spawn/fleet/tutorial surfaces were being pushed onto the same local-first contract: Ollama + Codex as first-class backends, mandatory budget ceilings, explicit model tiers, and “9876 is the default, not a universal truth.” The same slice also fixed `pd fleet run <agent>` so one-shot fleet runs inherit a real budget ceiling instead of hard-failing preflight.
   - `pd fleet validate` is live again in the CLI. It parses YAML, resolves templates, checks trigger topology, and exits without spawning agents. The remaining work there was discoverability drift: README, skill docs, and the website CLI page all needed to mention it again.
   - Port Daddy dogfooding surfaced another live drift: `port-daddy sortie run ...` from the installed shim returned `ERROR: Not Found`. Treat that as a runtime-route availability bug in the canonical daemon path until proven otherwise.
   - The session-context hardening cut is now committed at `50fe92f`: slot-scoped `.portdaddy/contexts/<slot>.json`, compatibility-only `current.json`, and fail-closed explicit note/session targeting.
   - The lingering Jest teardown debt is also now repaired in the working tree: IPC client timeout/reconnect timers and the SDK heartbeat are `unref()`ed, webhook retries are owned/disposable, and the serialized handle hunt is clean on 2026-04-11 (`npm test -- --runInBand --detectOpenHandles` => `109/109` suites, `4523/4524` tests, `1` intentional skip, no open-handle warning).
   - The next working-tree runtime cut now pushes IPC into the real operator loop instead of leaving it as a niche agent path: router support for `sugar.whoami` + `fleet.prompt`, SDK ephemeral IPC request fast paths for `done`/`whoami`/`note`/file claims, and CLI delegation to those SDK paths. The important constraint is now explicit in code: IPC is only allowed when talking to the canonical local daemon. Explicit TCP URLs or alternate socket targets must stay on their declared transport.
   - Broad test truth after that IPC tranche: targeted router/client/CLI tests and `tests/integration/cli.test.js` are green, and `npm test` passes `109/109` suites + `4529/4530` tests. But the parallel suite still prints `A worker process has failed to exit gracefully`, so there is still unresolved worker-teardown debt even though `--runInBand --detectOpenHandles` is clean.
   - Stable checkout archaeology is now explicitly recognized as operator contamination. `/Users/erichowens/port-daddy-stable` was being used as a live daemon/fleet workspace, so its `.spark`, `.spider`, logs, DB, and tracked build outputs are not authoritative. Unique Spark/Spider markdowns have been copied into the active checkout so further curation can happen in one place.

3. **Recovery Track 2 / 3 — FleetBar + control plane truth** — `a41f18f`, `e82f096`, `1aeb2b1`, `809816e`, `e7eba7b`, `1ebe6e6`, `853cc57`, `83d1a22`, and the current uncommitted Memory tab wiring continue pushing the runtime and UI toward one truthful control plane. The latest UI drift is no longer only chrome/activity polish; it now includes exposing semantic memory as a first-class operator surface.
   - The latest uncommitted operator-truth fix closes a real product lie: FleetBar and the web control plane were deriving “projects” from `/fleet`, so “no running fleets” rendered as “no projects.” The working tree now merges registered `/projects` with live `/fleet` state and broadens `/fleet/config/:project` so stopped registered projects still resolve.

4. **Spawn discipline + virtual-actor scheduling direction** — newly active in the working tree after the “190 spawns today” thread and cross-check against `docs/plans/agentsd_ai_technical_architecture.md`. The repo now has a first concrete pass on per-agent cooldown, trigger dedupe, and exponential backoff in `lib/fleet-engine.ts`, with regression coverage in `tests/unit/fleet-engine.test.js`.
   - This is not the whole answer. The deeper architectural move is to stop letting every watcher/subscriber behave like an equal peer and instead introduce actor-like mailboxes for `project`, `fleet`, `agent`, `harbor`, `sortie`, and trigger keys. The shared medium primitives (pub/sub, tuples, trie, graph, pheromones) stay; activation policy moves into mailbox-owned scheduling.
   - The recovery implication is clear: cooldown/dedupe/backoff are no longer isolated safety hacks. They are the first production cuts toward an actor-governed fleet runtime that can collapse repeated wakes, preserve budgets, and stop spawn storms by construction.

5. **Cloudflare AI backend adoption** — newly active in the working tree as an immediate runtime slice, with the broader infra follow-on still queued.
   - The source now has a first Cloudflare Workers AI backend path: model tiers in `lib/fleet-engine.ts`, runtime execution in `lib/spawner.ts`, readiness in `lib/backend-readiness.ts`, and operator/backend catalog updates in `routes/fleet.ts`, `routes/spawn.ts`, `cli/commands/spawn.ts`, `mcp/server.ts`, and `docs/openapi.yaml`.
   - This is intentionally scoped to the runtime path first. The larger Cloudflare opportunity set still needs explicit planning: AI Gateway for centralized policy/observability/caching, Vectorize + AI Search for retrieval surfaces, and remote-harbor-friendly auth/key/registry patterns that align with the TAD's delegated PKI story.

6. **Current-session drift hardening** — newly active and now partly fixed in the working tree.
   - Root cause was architectural, not incidental: CLI sugar/session commands treated `.portdaddy/current.json` as one mutable repo-global truth, so concurrent shells or agents in the same checkout could overwrite each other's current agent/session identity.
   - The working tree now replaces that with slot-scoped local context under `.portdaddy/contexts/<slot>.json`, keeps `current.json` only as a compatibility pointer, and prevents slot readers from falling through into some other slot's latest context.
   - The note path is also stricter now: `sessions.quickNote()` accepts explicit `sessionId`, direct-mode `pd note` forwards current slot context, and ambiguous unscoped worktree notes fail closed instead of drifting to global "most recent active".
   - Live-path verification already passed against the canonical daemon with two concurrent slots in one checkout (`live-a`, `live-b`): `pd whoami` and `pd note` stayed bound to the correct session in each slot.
   - The next honesty task is docs/help alignment: installed CLI behavior is now ahead of user-facing prose that still describes `current.json` as the sole authority.

7. **Recovery Track 1 — CLOSED** — `8744e14` committed `lib/counters.ts`, completing the observability trifecta (cost-tracker + counters + observability routes). All `/metrics/*` endpoints are now populated with real data. Fleet budget gates actively stop spawns. Released as v3.8.3.

8. **Fleet/runtime archaeology rehab** — `3ece95a` promoted long-dirty roadmap/docs changes and two substantive untracked test suites (`semantic-index`, `tunnel-lifecycle`). It also shipped a small but real runtime hygiene fix: the spawner heartbeat interval now `unref()`s so blocked-spawn tests do not hold Jest open just by hitting the concurrency ceiling.

9. **Residual archaeology still on disk** — now down to residue policy, not test limbo:
   - the spider connection note pile under `.spider/connections/` is now explicitly moving into `.gitignore` rather than pretending to wait for promotion
   - the redundant `spawner-commit-0df9155-bugs` battery was retired after folding its only useful assertions into `tests/unit/spawner.test.js`
   Everything else from the previously dirty runtime/test/doc slices has now been either committed, merged into normative coverage, or explicitly quarantined.

V4 Phase activity:
- **Phase 1 (Semantic Graph):** No new committed slice yet, but the working tree now contains real `graph_edges` + semantic-memory plumbing. The stale-clock concern has changed from “nobody started this” to “this is half-landed and needs an explicit commit-or-quarantine decision quickly.”
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

**Uncommitted inventory is no longer just cleanup.** The main in-flight slices are now: semantic graph + episodic-memory plumbing, lease self-healing verification, loopback host / daemon discovery cleanup, project-scoped trigger archaeology, FleetBar/control-plane density work, and native-shell/operator-ergonomics fixes. Treat `docs/recovery/CURRENT-WORK.md` as the operational source of truth instead of mentally diffing `git status`.

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

4. **Residual test archaeology** *(MOSTLY RESOLVED)*
   - The redundant `spawner-commit-0df9155-bugs` battery was not promoted as-is
   - Its missing normative assertions now live in `tests/unit/spawner.test.js`
   - **Remaining: keep trimming any future archaeology down to durable contract tests instead of one-off bug museums.**

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
- **The full-suite red slice was mostly parity drift plus one real transport edge.** The repaired failures were not random: `routes/messaging.ts` had stopped honoring `body.message`, the client test still assumed a hardcoded daemon URL, completions/manifest/MCP parity did not fully know about `sortie`, stale spawner mocks no longer matched the `node:fs` import surface, and the Unix-socket integration helper needed to normalize oversized-body `EPIPE` / `ECONNRESET` into the daemon's actual 413 intent.
- **The orchestrator leak was real runtime debt, not just Jest drama.** Reactive `exec` rules spawned child processes with no cleanup contract and piped their output under Jest, which produced late console logs and open pipe handles. The current working tree now suppresses piped stdio under Jest, `unref()`s child handles, and exposes a shutdown path for the reactive orchestrator. The remaining full-suite worker-force-exit warning is now a different leak, not the same one.

- **Track 1 closure broke a 3-run pattern.** `lib/counters.ts` was flagged as "one commit away" in three consecutive cartographer runs (Apr 5 first run, Apr 5 second run, and the manual sync note). It finally shipped in `8744e14`. The pattern suggests: cartographer flagging alone doesn't drive commits, but having a "Recovery Track" with explicit closure criteria does. Recovery Tracks are more motivating than cartographer warnings.

- **FleetBar architecture is now correct.** `a41f18f` eliminated the "shadow dashboard" anti-pattern — FleetBar shells the daemon's fleet-config-ui instead of reimplementing it in SwiftUI. One fleet UI, two consumers (browser + native). This is the architecture that should have been built from the start. The hardening commit (`e82f096`) immediately followed, which is good discipline.
- **The deeper Activity bug was backend attribution, not just UI layout.** Briefing and project-scoped activity views were querying by `target_id` prefix even though real `session.start`, `session.end`, `session.note`, and sugar rows often had `target_id = null`. The active fix is to stamp scope into the activity writers and read structured metadata back out, rather than teaching more UI code to regex prose.
- **The channel scoping bug is now split into “engine” versus “archaeology.”** `lib/fleet-channels.ts` already scopes logical fleet channels by `projectDir`, and current tests cover `global:` bypass semantics. The reactive dashboard now also resolves logical names to physical scoped channels before polling/publishing. If `expunge-my-arrest` still wakes on a Port Daddy website commit, stale detached watcher processes or already-open stale UI clients are the first suspects, not missing scoping in the modern fleet engine.
- **Socket truth and TCP truth can diverge.** `port-daddy status` talks over the Unix socket and can report healthy while browser/FleetBar TCP consumers still fail or drift. Operator validation now needs both surfaces checked, not just the CLI.
- **Freshness authority was too broad.** The monolithic CLI still had an old freshness auto-restart path that could SIGTERM the canonical daemon from foreign checkouts or non-interactive watcher commands. `1ebe6e6` narrowed that authority to interactive commands from the same install root as the live daemon.
- **The next UI truth bug is still sortie-specific.** The control plane no longer resets runtimes after launch, but the end-to-end sortie path still needs fresh live verification now that daemon-side errors surface inline.
- **Backend-tier truth is now wider than the UI currently shows.** The runtime now carries low/mid/high ladders for Claude SDK, Claude CLI, Gemini, Codex, Ollama, Aider, and Custom. `aider` now honors the selected model at execution time, and `custom` receives the resolved model/tier via env so wrappers can act on it. The next honesty task is exposing that same tier truth clearly in operator surfaces, not letting it stay backend-only knowledge.
- **Port Daddy's own fleet now embodies the budget doctrine in source.** `pd-fleet.yml` is switched to local-first defaults: Ollama for background/read-only agents, cheaper Codex tiers for code-changing agents, and hosted backends as opt-in. The next operator truth task is keeping the live daemon aligned with that source choice instead of letting stale manual runtimes serve outdated model mappings.
- **Local model provisioning is now real, not aspirational.** Aider is installed, Ollama has been upgraded back to a healthy daemon, and the recommended local ladder models are present on this machine. The remaining gap is live-daemon alignment and UI/operator truth, not missing local runtimes.
- **Claude SDK readiness was lying by omission.** The readiness probe only checked `ANTHROPIC_API_KEY`, not whether `@anthropic-ai/sdk` was installed, so the UI could honestly-ish say “ready” and then fail at launch for a missing package. The active fix makes dependency presence part of readiness.
- **Activity had a second lie after project attribution was fixed.** Even when the project log had meaningful work, the left rail could still say “No non-empty agent signals yet” because it only rendered agents with precomputed signals. The current UI patch switches Activity to always list configured agents and use feed fallback when structured signals are sparse.
- **Operator file affordances were too vague.** Showing touched files without explicit machine actions forced operators back into manual path copying. The control plane and FleetBar now expose Finder/editor actions directly off surfaced file mentions.
- **Manual fleet upkeep had a hidden budget bug.** `pd fleet run documentarian` and friends were still launching through `/spawn` without a budget even after global budget enforcement landed. The CLI now forwards `limits.budget_usd_per_day`, and a regression test covers that path.
- **Selective fleet upkeep now exposes the next bottleneck instead of silently failing.** After the budget fix, `pd fleet run cartographer` was blocked by the live active-agent cap (20 running agents), and the cheap local `documentarian` pass timed out on a broad docs sweep. That is product signal: subset deployment / pause controls and a better cheap-vs-expensive maintenance-agent policy belong in the recovery queue.
- **Lease loss with `owner: null` is recoverable, not terminal.** The daemon should reacquire in that case instead of leaving the project permanently skipped. That fix is now in the working tree with regression coverage.
- **Shared hook templates were ahead of live installs.** The repo templates already published scoped `project:<slug>:<hash>:git:committed`, but existing checkouts were still carrying the pre-scope Port Daddy hook in `.git/hooks/post-commit`, and installers were treating any hook mentioning `git:committed` as already current. The active fix is legacy-hook replacement in `pd init` / `pd fleet init`, not more template churn.
- **Daemon logs can mix generations of client truth.** After the latest `fleet-ui` channel fix, a fresh Playwright-driven load polled `/msg/project:...:` channels correctly, while older already-open clients continued to hit naked logical channels until they reloaded. Log archaeology now has to distinguish stale client traffic from current bundle behavior.
- **Not all repo dirt deserves promotion.** The spider markdown pile is generated research output and now belongs in `.gitignore` by default, not in suspense as pseudo-canonical docs. The extra spawner bug-battery test proved that the right move is often to merge missing assertions into the canonical suite and delete the museum piece.

- **Phase 1 stale clock: 7 days.** Equal to the time remaining before the threshold. The `graph_edges` migration is a 1-hour task. Every commit to `server.ts` (2 this burst) increases friction. The symbol index test suite sitting uncommitted for 7 days is a smell — someone validated the code but didn't commit the validation.

- **Feedback audit surfaced a real ledger gap.** Several operator asks were implemented or discussed in chat but were not explicitly captured in the recovery queue: singleton Fleet Control Center behavior, Dock/native-window expectations, obvious stop/start controls, split-pane resizing, scheduled-job vs agent taxonomy, and concrete event-source examples/snippets. Those are now promoted into `docs/recovery/CURRENT-WORK.md` instead of relying on memory.
- **Dogfooding exposed a fourth runtime truth surface.** `pd agent` is not just “sortie lite.” It creates a sugar session plus a single spawned-agent record and can disappear from the live agent registry immediately after completion/failure. The control plane therefore needs to distinguish configured fleet agents, ad hoc manual jobs (`pd agent` / direct `pd spawn`), and sorties instead of flattening them into one generic “agent” concept.
- **The Fleet Control Center regression was architectural, not cosmetic.** Embedded mode was auto-selecting the first project while the native shell exposed no real project chooser, so operators could get stranded on one project with no way back to all-projects or sibling fleets. The fix belongs in native chrome plus embedded routing behavior, not just React styling.
- **Add-project flow is now a first-class recovery item.** “Project exists on disk” and “project is real in Port Daddy” are different states. The latter needs a starter fleet, MCP/skill install guidance, and an explicit `pd fleet up`/registration moment that the UI teaches instead of hiding.
- **Project truth is now split correctly in source, but still needs relaunch verification in the live app.** `/projects` is the durable registry, `/fleet` is live runtime state, and operator surfaces must combine them instead of conflating them. The current working tree does that in FleetBar and the React control plane; the next verification step is to relaunch the daemon/UI and confirm the live shell stops saying “no projects” when the registry is non-empty.
- **Docs drift around `pd fleet validate` was real.** ADRs and help text had described a validate/dry-run command that the installed CLI did not actually ship. That is a product lie, not an optional enhancement.
- **The strongest Spark/Spider suggestions have converged on operator leverage, not novelty.** The suggestions worth promotion are the ones that tighten fleet identity, event propagation, durable service offers, pre-dispatch invariant gating, dead-agent merge suspension, and spawn preflight/hot-zone awareness. Those are now roadmap material, not just creative residue.
- **Hidden scratch dirs need a sharper rule than “ignore dot folders.”** `.spark/`, `.spider/connections/`, and now `.dogfood/` are local residue and belong in `.gitignore` by default. But tracked dotdirs like `.cartographer/` and `.claude-plugin/` are canonical repo surfaces, so a blanket `.*` ignore rule would be self-sabotage.

- **Document authority: now clearer.** The Recovery Roadmap at `docs/recovery/UNIFIED-ROADMAP.md` is the execution authority (with explicit release criteria). The V4 Roadmap at `docs/V4-UNIFIED-ROADMAP.md` is the strategic context (phase structure, appendix, unplanned work log). This division is workable as long as the cartographer maintains both. The V4 roadmap's redirect header to the recovery docs is appropriate.

- **Uncommitted file count trending down: 103 → 76 → 50.** Two consecutive cartographer runs showing improvement. The Track 1 closure committed the most structurally important changes. Remaining uncommitted work is mostly UI refinement (fleet-config-ui, FleetBar Swift) and test files — lower risk than the `server.ts` + `routes/*.ts` changes that were in the previous batch.
