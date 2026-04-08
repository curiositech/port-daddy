# Current Recovery Work

Last updated: 2026-04-08
Owner: Codex working session

This is the active execution ledger. If a task is in flight, it belongs here before it belongs in chat.

## Current Thread

Stabilize the live Port Daddy operator loop so one daemon, one fleet runtime, one control plane, and one native companion all tell the same truth.

Latest committed slice: `af3e647` — Dogfood sorties and sync operator truth.
Current uncommitted slice: green the full Jest suite and harden parity/runtime edges:
- ignore generated `.spider/connections/*.md` residue by default unless a later docs feature explicitly curates one
- ignore generated `.dogfood/` run reports by default unless one is intentionally promoted into docs
- keep the full Jest suite honest; a passing exit code is necessary but still not enough if worker-leak warnings remain
- repair route/manifest/completion parity for the new `sortie` + operator surfaces instead of leaving them half-shipped
- keep runtime discovery, Ollama/Codex defaults, and fleet cost discipline aligned with the live daemon instead of only source truth
- keep `skills/port-daddy-cli/SKILL.md` and its API reference synced with every Port Daddy delegation/runtime change, not as a later cleanup
- keep `/Users/erichowens/port-daddy-stable` clean enough for `./scripts/promote-stable.sh`; stable is a promotion target, not a live fleet playground

## Active Tasks

1. Finish daemon discovery drift cleanup so `9876` is treated as the canonical preferred port, not a mandatory truth. The daemon can already fall back; the surrounding install/CLI/UI surfaces must stop pretending otherwise.
2. Finish the fleet lease recoverability pass so a project does not remain skipped forever when renewal sees `lock not held` and no other daemon owns the lease.
3. Finish the last raw project-trigger audit after `lib/fleet-channels.ts` + hook/template scoping so no checked-in path still publishes or inspects naked logical channels where a scoped physical channel is required.
4. Reload or relaunch old control-plane clients after bundle changes so daemon logs stop mixing stale naked-channel polling with fresh scoped-channel traffic.
5. Collapse duplicate chrome in Fleet Control Center when embedded:
   - FleetBar owns the outer nav
   - the embedded control plane must not render a second top-level nav/header stack
6. Make Activity, Channels, Inbox, and Sorties behave like real top-level pages instead of buried panels or empty shells. Fix te bug where there's no project or daemon switcher in fleet control center, and no instructions on how to add new project folders.
   - Fleet Control Center needs an explicit native project switcher, not a single sticky project badge
   - embedded mode must not auto-force the first project with no way back to an all-projects view
   - add obvious “Add project to Port Daddy” entry points with copyable `pd init`, `pd fleet init`, `pd fleet up`, and `pd mcp install` fragments
   - document what makes a project “real” in the control center: a repo with `pd-fleet.yml` that is started/registered on the current daemon
7. Upgrade agent detail surfaces to show high-signal recent work:
   - non-empty messages
   - recent mutations
   - touched files
   - last active time
8. Improve FleetBar popover so it shows recent per-agent facts instead of only launch shortcuts.
   - explicit Finder/editor actions for touched files are now shipped
   - next step is denser recent summaries without re-burying everything behind the full control center
9. Make sortie launch truthfully debuggable:
   - preserve chosen backend/model after a launch
   - surface actual `/spawn` errors inline instead of generic `400 Bad Request`
   - verify why a "ready" Claude SDK launch can still fail to produce a spawn record
   - ensure readiness probes check package installation as well as auth/env presence
10. Remove overlapping agent-detail surfaces:
   - Activity should focus agents in-page
   - the global slide-in inspector should stay a Flow tool, not persist across every tab
11. Respond to the newest operator UX feedback explicitly in-product:
   - show logical channel names and give examples for creating new event sources
   - show the actual project label next to the logical/physical channel truth so operators know what to publish against
   - ship copy-pasteable event-source snippets for TypeScript, Python, and CLI publishers
   - add an “Add new event sources” teaching surface in Flow and/or the agentic views instead of forcing users to reverse-engineer channel publishing from docs
   - make Channels expose a channel index/list, not just message traffic
   - list channels up top somewhere explorable, not only as a scrolling feed
   - decide whether Inbox belongs inside Agents/Channels instead of as a top-level tab
   - decide whether Channels should also be reachable as a Flow-side modal/alternate agent view instead of only as a separate page
   - add better field help/tooltips/tutorial guidance for agent publishing, tools, and sortie inputs
   - add a real tutorial mode for creating agents instead of expecting users to infer every field from sparse labels
   - add “add project to Port Daddy” flows in both FleetBar and the full app
   - design that add-project flow with curated starter fleets for common coding project types plus a bespoke “design my fleet with AI” mode
12. Fix native-shell operator ergonomics that are still only half-captured:
   - Fleet Control Center must be a singleton window that refocuses instead of spawning duplicates
   - the native shell should appear and behave like a first-class app window, including sane Dock activation behavior
   - make stop/start or pause/enable fleet controls obvious in the native shell instead of hiding them inside secondary surfaces
   - put per-agent run / pause / stop controls near the agent itself in both FleetBar and the full control plane
   - support deployable subsets of a fleet so operators can turn on only the agents they want instead of treating "fleet up" as an all-or-nothing always-on mode
13. Make the control plane layout operator-grade instead of merely pretty:
   - support resizable split panes where Flow/activity/agent-detail density demands it
   - keep window chrome from eating the first row of meaningful content in dark mode
   - remove duplicate or redundant buttons where FleetBar chrome and embedded chrome overlap semantically
14. Clarify agent taxonomy in the UI:
   - Gardener and similar cron/scheduled workers should read as scheduled jobs, not normal conversational agents
   - channel/system noise should stop masquerading as meaningful agent activity
15. Make Activity truthful and useful by default:
   - kill the lingering “Waiting for activity” empty state when structured project activity exists
   - show per-agent last-active, non-empty messages, recent mutations, and artifacts in one obvious place
   - when focused agent changes, all surviving agent-detail surfaces should switch coherently instead of drifting out of sync
16. Model ad hoc project agents honestly in the product:
   - add a distinct UI bucket for manual/ad hoc jobs (`pd agent` and direct `pd spawn`) instead of pretending they are fleet agents or sorties
   - show these runs from spawned/session history even when they never persist in the live agent registry
   - let this dogfooding shape the UI: Port Daddy should be able to show its own ad hoc Port Daddy runs clearly
17. Remove the remaining inspector/focus confusion:
   - clicking Spark/Spider/etc. should not produce both an in-page “Agent Focus” view and a second overlapping slide-in detail/settings surface
   - the project log should not be covered by a detail drawer that is not itself project-log-specific
   - the agent detail slide pane persisting across unrelated top-level tabs is a bug until proven otherwise
18. Fix the surfaces the operator explicitly says are still not working:
   - Inbox should move into Agents or Channels if that is the more truthful model, but either way it must actually work
   - Sorties must be verified end-to-end from the live daemon/UI, not merely made pretty
   - the sortie mission builder must stop pretending its roster is real until recipes map to explicit agent definitions, editable roster selection, and a documented intra-mission coordination protocol
   - recipe labels like `investigate`, `fix`, `review`, and `creative` need first-class definitions exposed in-product and in docs, not just UI cards
   - root-cause the exact Claude SDK launch reset path where the UI said “ready,” attempted launch, then reverted to `claude-cli`
   - recent sortie outcomes need a denser, scrollable list with drill-in detail instead of tiny collapsed chips
   - add a real sortie status page and a real sortie results page
   - add explicit human-in-the-loop controls for approvals, pauses, resumes, and intervention
   - visualize sortie execution while it is in flight: steps, artifacts, messages, and mutations over time
19. Finish the operator file-action truthfulness pass:
   - touched-file actions must resolve relative mutation paths against the correct project/workdir
   - `Open in Finder` / `Open with default editor` should not degrade to a bare `Not Found` when the app already knows the project context
20. Put hard discipline around fleet spawn frequency:
   - runaway fleet spawn counts are a budget-control failure
   - tighten defaults around `singleton`, respawn/schedule churn, and project limits so background fleets cannot casually burn through scarce Claude/Codex quota
21. Finish Codex backend support as a real Port Daddy runtime:
   - daemon, CLI, SDK, readiness probes, and fleet model catalog all recognize `codex`
   - Codex runs capture `--output-last-message` instead of leaking CLI noise
   - Codex defaults stay spend-aware (`gpt-5.4-mini` low, `gpt-5.3-codex` mid, `gpt-5.4` high)
   - verify a real `port-daddy spawn --backend codex ...` launch from the live daemon, not just unit tests
22. Finish the all-backend model-tier contract:
   - every backend must have a distinct low/mid/high ladder
   - `aider` must honor selected models at execution time instead of ignoring them
   - `custom` must receive resolved model + tier in env so wrapper commands can act on it
   - `/fleet/models`, `pd agent`, and raw `pd spawn` must all expose the same tier truth
23. `pd fleet validate` is now back:
   - parses `pd-fleet.yml`
   - resolves templates
   - checks topology cycles
   - performs a dry run without spawning agents
24. Curate the best Spark/Spider suggestions into the real roadmap instead of leaving them as residue:
   - network identity for fleet agents: service claim + DNS + tunnel cascade on spawn/exit
   - merge queue event bus bridge into ambient messaging
   - durable tuple-space service offers / acceptance for integration readiness
   - Arbiter pre-dispatch IPC checks instead of post-hoc-only violation logging
   - suspend merge-queue branches when the submitting agent dies until salvage/resume
   - symbol-aware spawn preflight and hot-zone/instability signals for fleet gating
25. Keep Port Daddy dogfooding honest:
   - use `pd agent` and `pd sortie` on Port Daddy itself while building delegation surfaces
   - if a dogfood launch fails, log the exact failure in the recovery hub instead of just saying “it failed”
   - current truth: `port-daddy sortie run ...` against the live daemon returned `ERROR: Not Found`, so the CLI surface exists but the daemon/runtime route is not reliably there in the canonical live path yet
26. Build a real system-wide observability dashboard instead of pretending scattered metrics cards are enough:
   - chart primitive Port Daddy calls over time
   - chart service/API call volume and error rate over time
   - show spawn rate, failure rate, duration, message traffic, and service churn in one operator view
   - distinguish live claims from stale/zombie claims so “72 active ports” cannot quietly mean “72 database rows”
   - make this available both in the control plane and from a direct daemon-served route
27. Finish cleaning the full-suite warning path even though the suite now exits green:
   - current truth on 2026-04-08: `npm test` passes `103/103` suites and `4510/4511` tests, but the parallel run still prints `A worker process has failed to exit gracefully`
   - repaired in this slice:
     - messaging route now accepts `body.message`, not just `payload` / `content`
     - client tests now use daemon discovery truth instead of hardcoded `http://localhost:9876`
     - `sortie` parity is repaired across CLI, completions, manifest, and MCP category coverage
     - stale spawner `node:fs` mocks now include `mkdtempSync`
     - integration helper now normalizes oversized-body `EPIPE` / `ECONNRESET` on the Unix socket into the 413 rejection the daemon actually means
     - reactive orchestrator exec rules now avoid leaking piped child-process handles under Jest
   - remaining cleanup:
     - identify the last parallel-worker leak behind the force-exit warning instead of letting "green enough" become the new lie
28. Rehabilitate the stable promotion checkout:
   - stop treating `/Users/erichowens/port-daddy-stable` as a live fleet/daemon workspace
   - remove or quarantine tracked build garbage like `fleet-live-app/build`
   - decide whether the lingering stable source edits are worth salvaging or should be discarded before the next promotion
   - ensure future Spark/Spider/fleet outputs land only in the active dev checkout, not stable
29. Curate the stable-only Spark/Spider residue and elevate the winners into real roadmap work if still missing here:
   - `spider-capability-discovery-dns-harbor` -> capability-aware service discovery
   - `spider-fleet-run-journal` -> persistent fleet history / `pd fleet history`
   - `spider-forensic-context-windows` -> Arbiter violations with timeline context
   - `spider-ipc-cascade-cleanup` / `2026-04-05-spider-ipc-disconnect-instant-salvage` -> immediate lock/salvage cleanup on IPC death
   - `spider-ipc-tuple-fast-path` + `spider-tuple-triggered-fleet-agents` -> tuple-driven fleet execution path
   - reject or merge older/duplicative ideas instead of blindly copying stable residue into this repo

## Immediate Next Cuts

1. Restart the current-checkout daemon against the latest server/runtime code and verify the lease-reacquire path actually recovers skipped fleets instead of leaving `/fleet` empty.
2. Kill or replace stale legacy `port-daddy-stable` watcher processes if they are still the source of cross-project `git:committed` bleed after the scoped channel audit.
3. Relaunch FleetBar against the latest build and verify the native wrapper picks up the committed activity attribution improvements plus the chrome-free embedded surfaces.
4. Relaunch FleetBar against the newest `public/fleet-ui` bundle so the live native shell stops carrying stale chrome/channel behavior from already-open WebViews.
5. Wire the React control plane to consume the newly explicit backend activity attribution so per-agent timelines, files touched, and recent mutations stop falling back to prose matching.
6. Finish the last repo dirt decisions:
   - commit the `.gitignore` quarantine for generated spider connection notes
7. Root-cause the remaining full-suite worker-force-exit warning after the orchestrator exec cleanup instead of declaring victory on exit code alone.
8. Commit the next control-plane/FleetBar UX slice once the relaunch verifies the native shell and daemon-served bundle still agree.
9. Verify the sortie launch path end-to-end from the live daemon after the new inline error handling so a failed attempt leaves operator-visible evidence instead of only resetting UI state.
   - specifically reproduce and explain the “Claude SDK said ready, then launch reset to claude-cli” failure path from the operator report
10. Finish the remaining `9876` cleanup after the runtime callers:
   - diagnostics/startup doctor wording
   - docs/templates/website honesty sweep
   - any leftover FleetBar/operator labels
11. Rehabilitate the operator file-action bug shown in live use:
12. Root-cause why `port-daddy status` reports 72 active ports while `ports cleanup` frees 0:
   - inspect stale assigned claims with null/dead PIDs
   - decide whether cleanup should prune them or status should report them separately
   - add tests that catch zombie-claim inflation instead of only testing expired/running cleanup
   - Spark/Spider mutation cards are still surfacing relative paths that Finder cannot resolve
   - fix resolution in both the web control plane and FleetBar/native shell paths
12. Audit live fleet spawn counts against the declared fleet config and event traffic:
   - explain why the fleet reached 99 spawns
   - then add stricter defaults or caps so the fleet behaves within real Claude/Codex usage scarcity
   - manual upkeep runs also need room to execute; `pd fleet run documentarian` and `pd fleet run cartographer` should not be starved forever behind a saturated always-on fleet
   - the first local documentarian dogfood timed out on `ollama / qwen2.5-coder:7b` during a broad truth sweep, so we need a better policy for when cheap local docs agents are enough versus when an operator-triggered higher-tier run is warranted
13. Decide how dormant/registered fleet projects should appear in operator surfaces:
   - `/fleet` currently shows loaded/running fleets only
   - cost telemetry can mention a project that the Fleet Control Center cannot yet list
   - decide whether the UI should show dormant registered projects separately from active fleets
14. Keep the full test suite in the operator loop:
   - focused bundles are useful, but always re-run `npm test` before claiming broad repo health
   - when the full suite fails, write the concrete failing files and root-cause hypotheses here

## Newly Confirmed Truths

- The operator surface now has a proper machine action for files, not just text: the daemon exposes `/operator/open-file`, the web control plane calls it, and FleetBar mirrors the same two affordances natively (`Open in Finder`, `Open with default editor`).
- `tests/unit/semantic-index.test.js` and `tests/unit/tunnel-lifecycle.test.js` were legitimate archaeology, not dead scratch. They passed and are now committed.
- The old `tests/unit/spawner-commit-0df9155-bugs.test.js` archaeology file was retired instead of promoted. The only useful assertions were folded into `tests/unit/spawner.test.js`; the rest duplicated existing coverage or canonized known-bad behavior.
- The spawner heartbeat timer was another real Jest open-handle culprit. `lib/spawner.ts` now `unref()`s that interval so blocked-spawn tests do not hold the process open just by reaching the concurrency ceiling.
- Port Daddy now has a real `codex` backend path in source. It shells out to `codex exec`, captures the final assistant message from `--output-last-message`, and unit coverage now exercises readiness, spawn dispatch, model catalog, and opaque-cost estimation for that backend.
- The first live Codex dogfood launch succeeded end-to-end through Port Daddy after replacing the stale manual daemon on `127.0.0.1:9876`: backend `codex`, model `gpt-5.4-mini`, output `codex backend smoke from port-daddy`.
- A second live Codex smoke now also proves the tier plumbing through the daemon, not just the runner: `port-daddy spawn --backend codex --tier low ...` returned `codex tier smoke through port-daddy`.
- Distinct low/mid/high model tiers now exist for every backend instead of only the hosted runtimes:
  - Claude SDK: Haiku / Sonnet / Opus
  - Claude CLI: haiku / sonnet / opus
  - Gemini: 2.0 Flash / 2.5 Flash / 2.5 Pro
  - Codex: gpt-5.4-mini / gpt-5.3-codex / gpt-5.4
  - Ollama: qwen2.5-coder:7b / llama3.1:8b / qwen2.5-coder:14b
  - Aider: gpt-4.1-mini / gpt-4.1 / gpt-5
  - Custom: custom-low / custom-mid / custom-high (forwarded via env so wrappers can honor it)
- The live Codex dogfood also surfaced two operator bugs that belong in the recovery queue, not chat memory:
  - file actions still fail on some relative mutation paths (`Not Found`)
  - fleet spawn counts can still run too hot for real model-usage scarcity
- Port Daddy's own `pd-fleet.yml` is now local-first by default: background/read-only agents use Ollama, code-changing agents use cheaper Codex tiers, and hosted backends are opt-in instead of the silent default.
- The local runtime ladder is now actually provisioned on this machine: Aider is installed, Ollama is healthy again, and the recommended Ollama models (`qwen2.5-coder:7b`, `llama3.1:8b`, `qwen2.5-coder:14b`) are pulled locally.
- Source truth and live-daemon truth still have to be checked separately for Ollama tiers. The repo now points mid-tier Ollama to `llama3.1:8b`, but stale manual daemons can still serve the old invalid `llama3.2:8b` mapping until the canonical runtime is restarted.
- Embedded FleetBar routing needs two signals, not one: query-param embed plus an explicit WebView identity. Relying on `?embed=fleetbar` alone is brittle enough that duplicate chrome can come back.
- The modern fleet engine already scopes logical channels like `git:committed` through `lib/fleet-channels.ts`. If cross-project triggers still bleed, the likely culprit is leaked legacy detached watcher processes, not missing scoping code in the current runner.
- `port-daddy status` and browser reachability are separate truths. The CLI can look healthy over the Unix socket while TCP/browser consumers are still pointed at a brittle loopback URL or stale port assumption.
- The daemon should not permanently skip a project when lease renewal returns `lock not held` and `locks.check()` reports no holder. That is an empty-holder recovery case, not proof another daemon owns the fleet.
- The richer native/control-plane detail views need briefing payloads to carry explicit `summary` and `files`, not just raw activity prose.
- The current daemon-served bundle now renders embedded `Flow` and `Activity` without the inner header/tab stack. The native shell owns surface navigation, theme, and daemon chrome.
- Activity is no longer the empty liar from the earlier screenshot. The served `Activity` surface now shows project-scoped notes again after restoring `story.agentId` attribution and surfacing meaningful event types.
- The concrete Activity bug was project filtering: story notes were still being matched on free text and `identityProject`, but not `story.agentId`, so valid project-scoped handoffs could disappear from the main timeline.
- `pd init` was still writing its own bespoke post-commit hook body. The installer now copies the shared scoped hook template so hook behavior can stop drifting by command surface.
- `pd fleet` status was still sampling naked logical channels like `git:committed`. The operator-facing recent-event check now resolves those through the project-scoped physical channel path.
- Remaining `9876` drift still exists in docs/templates and some operator labels even after the runtime callers were cleaned up.
- The earlier `embed-flow-after` proof was wrong because it captured a loading state. A fresh settled screenshot now confirms embedded `Flow` does render the graph and agent cards correctly from the daemon-served bundle.
- Session notes already carry `agentId` and `identityProject` on the backend; the remaining bug is frontend attribution code still dropping that metadata and guessing from content.
- The activity bug was deeper than the UI. Recent project activity was being queried by `target_id` prefix even though real session and sugar rows often had `target_id = null`, so project-scoped Activity and FleetBar recent work could lie by omission.
- The live installed `.git/hooks/post-commit` in this checkout was still the pre-scope Port Daddy hook, publishing naked `git:committed`. Shared templates were correct, but installers were treating any hook mentioning `git:committed` as already upgraded.
- The fix is now source-level, not cosmetic:
  - session/file/sugar activity stamps `agentId`, `targetId`, and `identityProject`
  - briefing rebuilds project activity from structured metadata, session membership, and active agents
  - legacy Port Daddy hooks auto-upgrade in `pd init` / `pd fleet init`
- The monolithic CLI still had an old freshness auto-restart path in `bin/port-daddy-cli.ts`. Without a same-install-root guard, stale watcher processes from another checkout could decide the canonical daemon was "stale" and SIGTERM it. That path now only restarts for interactive commands from the same checkout as the live daemon.
- Detached watcher archaeology is real. Killing the old top-level `port-daddy-cli watch ...` roots removed the repeated cross-checkout daemon killings; background commands must not get daemon freshness authority back.
- Runtime discovery now drives more of the real product surface: the JS SDK, MCP server, and FleetBar stores no longer default inline to `http://localhost:9876`; they resolve the live daemon URL through the shared discovery path or the user port file.
- A fresh control-plane load now resolves logical channel names like `git:committed` to physical project-scoped channels before polling or publishing. Older already-open FleetBar/browser clients can still hit naked channels until they reload, so mixed daemon logs after a bundle change do not automatically mean the new bundle is wrong.
- Only `Flow` still warrants the persistent project rail. `Activity`, `Channels`, `Inbox`, `Sorties`, and `YAML` behave better as full-width top-level pages.
- FleetBar popover usefulness is now part of the active scope: recent per-agent summaries and touched files belong in the menu bar companion, not only in the full control center.
- Current build state after the latest control-plane and FleetBar edits: root `npm run typecheck`, `cd fleet-config-ui && npm run build`, and `cd apps/FleetBar && env CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache swift build` all passed.
- The sortie composer had a truth bug: after launch it recreated a fresh draft with the hardcoded `claude-cli` default, which made a Claude SDK attempt look like it silently reverted runtimes even when the real outcome was elsewhere.
- Generic `POST /spawn: 400 Bad Request` UI errors are not acceptable operator feedback. The control plane must surface the daemon’s actual `error` / preflight blocked reason inline.
- Claude SDK readiness was also lying by omission: env presence alone was enough to show “ready” even when `@anthropic-ai/sdk` was not installed.
- Activity cannot key its entire left rail off “agents with signals” only. If the project log has meaningful work but the left rail says “no signals,” the operator experience is lying by omission.
- Activity click behavior should focus the in-page activity view, not reopen the global slide-in Flow inspector. Overlapping detail surfaces are harder to reason about than one truthful one.
- Spark scratch was already correctly treated as local residue via `.gitignore`; the analogous spider connection note pile belongs in the same default-ignore bucket unless later curated intentionally.
- `.dogfood/` is the same class of residue as `.spark/` and `.spider/connections/`: useful locally, not repo truth by default.
- We copied the unique stable-only Spark/Spider markdown outputs into this checkout so idea archaeology now lives in one place. That does not make every copied file roadmap truth; it just removes the excuse to keep mining the stable repo for “one more missing note.”
- `/Users/erichowens/port-daddy-stable` was used as a live Port Daddy workspace. It has its own `pd-fleet.yml`, daemon DB/logs, `.spark/`, `.spider/`, and tracked build garbage. Promotion failures there are partly operator contamination, not just merge luck.
- The stable checkout is not secretly better than current main. The salvageable pieces are discrete Spark/Spider ideas and maybe a few source edits, not the checkout as a whole.
- The full Jest suite is green again as of `2737816`: `103/103` suites, `4510/4511` tests, `1` skipped. The remaining lie to hunt is the parallel-run worker-force-exit warning, not red suite failures.

## Explicit Non-Goals For This Pass

- New speculative agent products
- More website polishing unless it fixes a lie about live behavior
- Broad economy work beyond budget/cost truthfulness

## Operator Rules

- Update this file when the active recovery queue changes.
- Update `.cartographer/status.md` when the center of gravity moves or a track closes.
- If chat and this file disagree, fix this file first.
