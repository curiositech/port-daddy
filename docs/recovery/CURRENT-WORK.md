# Current Recovery Work

Last updated: 2026-04-07
Owner: Codex working session

This is the active execution ledger. If a task is in flight, it belongs here before it belongs in chat.

## Current Thread

Stabilize the live Port Daddy operator loop so one daemon, one fleet runtime, one control plane, and one native companion all tell the same truth.

Latest committed slice: `3ece95a` — roadmap/recovery doc rehabilitation, archaeology test promotion, and spawner heartbeat timer hygiene.
Current uncommitted slice: the remaining residue audit:
- decide whether `.spider/connections/*.md` should stay as generated notes or become curated docs
- either rewrite or delete `tests/unit/spawner-commit-0df9155-bugs.test.js` instead of pretending it is promotable truth
- continue the remaining control-plane product work from the feedback queue

## Active Tasks

1. Finish daemon discovery drift cleanup so `9876` is treated as the canonical preferred port, not a mandatory truth. The daemon can already fall back; the surrounding install/CLI/UI surfaces must stop pretending otherwise.
2. Finish the fleet lease recoverability pass so a project does not remain skipped forever when renewal sees `lock not held` and no other daemon owns the lease.
3. Finish the last raw project-trigger audit after `lib/fleet-channels.ts` + hook/template scoping so no checked-in path still publishes or inspects naked logical channels where a scoped physical channel is required.
4. Reload or relaunch old control-plane clients after bundle changes so daemon logs stop mixing stale naked-channel polling with fresh scoped-channel traffic.
5. Collapse duplicate chrome in Fleet Control Center when embedded:
   - FleetBar owns the outer nav
   - the embedded control plane must not render a second top-level nav/header stack
6. Make Activity, Channels, Inbox, and Sorties behave like real top-level pages instead of buried panels or empty shells.
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
   - make Channels expose a channel index/list, not just message traffic
   - decide whether Inbox belongs inside Agents/Channels instead of as a top-level tab
   - add better field help/tooltips/tutorial guidance for agent publishing, tools, and sortie inputs
   - add “add project to Port Daddy” flows in both FleetBar and the full app

## Immediate Next Cuts

1. Restart the current-checkout daemon against the latest server/runtime code and verify the lease-reacquire path actually recovers skipped fleets instead of leaving `/fleet` empty.
2. Kill or replace stale legacy `port-daddy-stable` watcher processes if they are still the source of cross-project `git:committed` bleed after the scoped channel audit.
3. Relaunch FleetBar against the latest build and verify the native wrapper picks up the committed activity attribution improvements plus the chrome-free embedded surfaces.
4. Relaunch FleetBar against the newest `public/fleet-ui` bundle so the live native shell stops carrying stale chrome/channel behavior from already-open WebViews.
5. Wire the React control plane to consume the newly explicit backend activity attribution so per-agent timelines, files touched, and recent mutations stop falling back to prose matching.
6. Decide the fate of the last repo dirt:
   - promote or quarantine `.spider/connections/*.md`
   - rewrite or drop `tests/unit/spawner-commit-0df9155-bugs.test.js`
7. Verify whether Jest still has a real open-handle warning after the spawner heartbeat timer `unref()` and any remaining daemon/test cleanup.
8. Commit the next control-plane/FleetBar UX slice once the relaunch verifies the native shell and daemon-served bundle still agree.
9. Verify the sortie launch path end-to-end from the live daemon after the new inline error handling so a failed attempt leaves operator-visible evidence instead of only resetting UI state.
10. Finish the remaining `9876` cleanup after the runtime callers:
   - diagnostics/startup doctor wording
   - docs/templates/website honesty sweep
   - any leftover FleetBar/operator labels

## Newly Confirmed Truths

- The operator surface now has a proper machine action for files, not just text: the daemon exposes `/operator/open-file`, the web control plane calls it, and FleetBar mirrors the same two affordances natively (`Open in Finder`, `Open with default editor`).
- `tests/unit/semantic-index.test.js` and `tests/unit/tunnel-lifecycle.test.js` were legitimate archaeology, not dead scratch. They passed and are now committed.
- `tests/unit/spawner-commit-0df9155-bugs.test.js` is not in the same category. It largely duplicates `tests/unit/spawner.test.js` and encodes known-bad behavior as the expected result, so it still needs editorial judgment before promotion.
- The spawner heartbeat timer was another real Jest open-handle culprit. `lib/spawner.ts` now `unref()`s that interval so blocked-spawn tests do not hold the process open just by reaching the concurrency ceiling.
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

## Explicit Non-Goals For This Pass

- New speculative agent products
- More website polishing unless it fixes a lie about live behavior
- Broad economy work beyond budget/cost truthfulness

## Operator Rules

- Update this file when the active recovery queue changes.
- Update `.cartographer/status.md` when the center of gravity moves or a track closes.
- If chat and this file disagree, fix this file first.
